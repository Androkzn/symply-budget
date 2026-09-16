/**
 * Central receipt AI extraction — used by Scan Receipt HTTP and Budget chat.
 * Prompt/schema stay in ai/prompts; this service owns mime sniff, AI call,
 * normalization, fee-attach, and code-merge. Nothing is persisted here.
 */
import type { ClaudeProvider } from '../../../ai/claude-provider';
import { generateWithFallback } from '../../../ai/fallback';
import {
  SCAN_GROCERY_RECEIPT_SCHEMA,
  SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
  buildScanReceiptUserPrompt,
  type RawGroceryReceipt,
  type RawGroceryReceiptFee,
  type RawGroceryReceiptItem,
} from '../../../ai/prompts/scan-grocery-receipt';
import type { AIProvider, GenerateMessage, GenerateResult } from '../../../ai/provider';
import { createProviderAdapter } from '../../../ai/provider-factory';
import type { Env } from '../../../types';
import { analyzeAssetQuality, budgetDebug, newTraceId } from '../../../utils/budget-debug';
import { ValidationError } from '../../../utils/errors';
import { hasUsableProviderKey, resolveProviderApiKey } from '../../ai-credential-resolver';
import { usageRecorderFor } from '../../ai-usage-service';
import { BudgetService } from '../../budget-service';

import {
  attachFeesAndMerge,
  classifyFeeKind,
  normalizeCode,
  type FeeKind,
  type FeeLineInput,
} from './fee-attribution';
import { attributeItemTaxes, getTaxProfile } from './tax-attribution';
import { normalizeReceiptCurrency } from './currency';
import type {
  ReceiptAliasHint,
  ReceiptCategorySuggestion,
  ReceiptScanFee,
  ReceiptScanItem,
  ReceiptScanMimeType,
  ReceiptScanResult,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCAN_MAX_TOKENS = 8192;
const SCAN_RETRY_MAX_TOKENS = 16384;

/** One uploaded file/segment of a receipt (a long receipt may be several). */
export interface ReceiptScanSegment {
  data: ArrayBuffer;
  mimeType: ReceiptScanMimeType;
}

/** Optional caller-supplied region override for the tax-rate fallback. */
export interface ScanRegion {
  country?: string | null;
  stateProvince?: string | null;
}

/**
 * Live progress from a scan in flight. `items` is how many receipt lines the
 * model has WRITTEN so far — a monotonic counter, not a percentage: nothing
 * knows the receipt's length until the model reaches the end. The final scan
 * result can hold fewer lines, because fee/discount rows merge into their
 * parent item afterwards. Callers should present it as a count read so far.
 */
export interface ReceiptScanProgress {
  stage: 'reading';
  items: number;
}

export interface ReceiptScanInput {
  segments: ReceiptScanSegment[];
  region?: ScanRegion;
  aliases?: ReceiptAliasHint[];
  /**
   * Opt into streamed extraction. Supplying this switches the AI call to a
   * streamed transport so item counts arrive while the model writes; omitting
   * it leaves the original single-shot request untouched.
   */
  onProgress?: (progress: ReceiptScanProgress) => void;
}

/**
 * Receipt lines the model has emitted into a partial (still-streaming) tool
 * JSON. Every item carries exactly one `"raw_name"` key and neither `fees` nor
 * `tax_summary` entries have one, so counting that key counts items — without
 * needing parseable JSON, which a half-written object never is.
 */
export function countStreamedReceiptItems(partialJson: string): number {
  return partialJson.match(/"raw_name"\s*:/g)?.length ?? 0;
}

export class ReceiptScanService {
  private env: Env;
  private d1: D1Database;
  private budgetService: BudgetService;
  private injectedAi?: AIProvider;

  /** `aiProvider` is injectable for tests; production call sites omit it. */
  constructor(env: Env, d1: D1Database, aiProvider?: AIProvider) {
    this.env = env;
    this.d1 = d1;
    this.budgetService = new BudgetService(env, d1);
    this.injectedAi = aiProvider;
  }

  /**
   * Anthropic provider bound to the acting user: their own connected BYOK key
   * when present, otherwise the SimpleHouse-managed key. A test-injected
   * provider always wins.
   */
  private async aiFor(
    householdId: string,
    userId: string | null | undefined
  ): Promise<AIProvider> {
    if (this.injectedAi) return this.injectedAi;
    const { apiKey } = await resolveProviderApiKey(this.env, userId, 'anthropic');
    return createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'grocery_receipt',
          householdId,
          userId: userId ?? null,
        }),
      },
    });
  }

  async scanReceipt(
    householdId: string,
    userId: string,
    input: ReceiptScanSegment | ReceiptScanInput
  ): Promise<ReceiptScanResult> {
    const segments: ReceiptScanSegment[] = 'segments' in input ? input.segments : [input];
    const regionOverride: ScanRegion | undefined = 'segments' in input ? input.region : undefined;
    const aliases: ReceiptAliasHint[] = 'segments' in input ? input.aliases ?? [] : [];
    const onProgress = 'segments' in input ? input.onProgress : undefined;
    const trace = newTraceId();
    const startedAt = Date.now();

    if (segments.length === 0) {
      throw new ValidationError('A receipt image is required.');
    }

    const totalBytes = segments.reduce((s, seg) => s + seg.data.byteLength, 0);
    const aiConfigured =
      !!this.injectedAi || (await hasUsableProviderKey(this.env, userId, 'anthropic'));
    budgetDebug(this.env, 'scan', {
      trace,
      stage: 'start',
      householdId,
      userId,
      segmentCount: segments.length,
      declaredMimes: segments.map((s) => s.mimeType),
      totalByteLength: totalBytes,
      aiConfigured,
      aliasCount: aliases.length,
    });

    if (!aiConfigured) {
      throw new ValidationError('AI is not configured for receipt scanning.');
    }

    for (const seg of segments) {
      if (seg.data.byteLength / (1024 * 1024) > 32) {
        throw new ValidationError('File exceeds 32MB limit for receipt scanning.');
      }
    }
    if (totalBytes / (1024 * 1024) > 100) {
      throw new ValidationError('Combined receipt files exceed the 100MB limit.');
    }

    const quality = analyzeAssetQuality(segments[0].data, segments[0].mimeType);
    budgetDebug(this.env, 'scan.asset', { trace, segmentCount: segments.length, ...quality });

    const { pool: categoryPool, grocery } = await this.budgetService.resolveScanCategories(
      householdId,
      userId
    );
    const categoryByName = new Map<string, { id: string; name: string }>();
    const categoryById = new Map<string, { id: string; name: string }>();
    for (const cat of categoryPool) {
      categoryByName.set(cat.name.trim().toLowerCase(), cat);
      categoryById.set(cat.id, cat);
    }

    const resolveItemCategory = (
      rawCategory: string | null | undefined
    ): { id: string | null; name: string | null } => {
      const key = typeof rawCategory === 'string' ? rawCategory.trim().toLowerCase() : '';
      const matched = key ? categoryByName.get(key) : undefined;
      if (matched) return { id: matched.id, name: matched.name };
      return { id: grocery?.id ?? null, name: grocery?.name ?? null };
    };

    const userPrompt = buildScanReceiptUserPrompt(categoryPool.map((c) => c.name));

    const decoded = segments.map((seg) => ({
      effectiveMime: this.detectMimeType(seg.data) ?? seg.mimeType,
      base64: this.arrayBufferToBase64(seg.data),
    }));
    const singlePdf = decoded.length === 1 && decoded[0].effectiveMime === 'application/pdf';

    let raw: RawGroceryReceipt;
    try {
      if (singlePdf) {
        raw = await this.extractViaDocument(
          decoded[0].base64,
          householdId,
          trace,
          userId,
          userPrompt,
          onProgress
        );
      } else {
        const images = decoded
          .filter((d) => d.effectiveMime !== 'application/pdf')
          .map((d) => ({
            base64: d.base64,
            mime: d.effectiveMime as 'image/jpeg' | 'image/png' | 'image/webp',
          }));
        if (images.length === 0) {
          throw new ValidationError('Could not read the receipt. Try a clearer photo.');
        }
        raw = await this.extractViaProvider(
          images,
          householdId,
          trace,
          userId,
          userPrompt,
          onProgress
        );
      }
    } catch (err) {
      budgetDebug(this.env, 'scan.ai', {
        trace,
        stage: 'error',
        elapsedMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const rawItems = raw.items ?? [];
    const parsed: FeeLineInput[] = [];
    const dropped: Array<{ index: number; name: unknown; reason: string }> = [];
    rawItems.forEach((item, index) => {
      const line = this.normalizeItem(item, resolveItemCategory);
      if (line) parsed.push(line);
      else dropped.push({ index, name: item?.name ?? item?.raw_name, reason: this.dropReason(item) });
    });

    const attached = attachFeesAndMerge(parsed);
    const aliasHits: Array<{ key: string; name: string }> = [];
    const withAliases = attached.map((line) =>
      this.applyAlias(line, aliases, categoryById, aliasHits)
    );

    const printedRegion: ScanRegion | undefined =
      raw.receipt_country || raw.receipt_region
        ? { country: raw.receipt_country ?? null, stateProvince: raw.receipt_region ?? null }
        : undefined;
    const profile = await this.resolveTaxProfile(householdId, regionOverride, printedRegion);
    const attribution = attributeItemTaxes(
      withAliases.map((l) => ({
        amount: l.amount,
        tax_base: l.tax_base,
        tax_codes: l.tax_codes,
      })),
      Array.isArray(raw.tax_summary) ? raw.tax_summary : [],
      profile
    );

    const items: ReceiptScanItem[] = withAliases.map((l, i) => {
      const tax = attribution.lineTaxes[i] ?? 0;
      return {
        raw_name: l.raw_name,
        raw_code: l.raw_code,
        name: l.name,
        name_suggestions: l.name_suggestions,
        amount: l.amount + tax,
        tax_amount: tax,
        saved_amount: l.saved_amount,
        deposit_amount: l.deposit_amount,
        fees: l.fees as ReceiptScanFee[],
        category_id: l.category_id,
        category_name: l.category_name,
        category_suggestions: l.category_suggestions.filter((c) => c.id !== l.category_id).slice(0, 3),
      };
    });

    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
    const totalTax = items.reduce((sum, i) => sum + i.tax_amount, 0);
    const subtotal = totalAmount - totalTax;
    const vendor = raw.vendor?.trim() || 'Other';

    budgetDebug(this.env, 'scan.result', {
      trace,
      elapsedMs: Date.now() - startedAt,
      vendor,
      purchaseDate: raw.purchase_date ?? null,
      segmentCount: segments.length,
      rawItemCount: rawItems.length,
      keptItemCount: items.length,
      droppedItemCount: dropped.length,
      dropped,
      rawCodes: items.map((i) => i.raw_code),
      nameSuggestions: items.map((i) => i.name_suggestions),
      fees: items.map((i) => i.fees),
      aliasHits,
      subtotalCents: subtotal,
      taxCents: totalTax,
      totalCents: totalAmount,
      receiptTotalCents: typeof raw.total === 'number' ? raw.total : null,
      taxSource: attribution.source,
      regionKnown: !!profile,
      taxBreakdown: attribution.breakdown,
      assetVerdict: quality.verdict,
      receiptCountry: raw.receipt_country ?? null,
      receiptRegion: raw.receipt_region ?? null,
      receiptCurrency: normalizeReceiptCurrency(raw.receipt_currency),
    });

    return {
      vendor,
      purchase_date:
        typeof raw.purchase_date === 'string' && ISO_DATE.test(raw.purchase_date)
          ? raw.purchase_date
          : null,
      category_id: grocery?.id ?? null,
      category_name: grocery?.name ?? null,
      items,
      subtotal_amount: subtotal,
      tax_amount: totalTax,
      total_amount: totalAmount,
      tax_breakdown: attribution.breakdown,
      tax_source: attribution.source,
      region_known: !!profile,
      receipt_country: raw.receipt_country ?? null,
      receipt_region: raw.receipt_region ?? null,
      receipt_currency: normalizeReceiptCurrency(raw.receipt_currency),
    };
  }

  private async resolveTaxProfile(
    householdId: string,
    override?: ScanRegion,
    printed?: ScanRegion
  ): Promise<ReturnType<typeof getTaxProfile>> {
    if (override && (override.country || override.stateProvince)) {
      const p = getTaxProfile(override.country ?? null, override.stateProvince ?? null);
      if (p) return p;
    }
    if (printed && (printed.country || printed.stateProvince)) {
      const p = getTaxProfile(printed.country ?? null, printed.stateProvince ?? null);
      if (p) return p;
    }
    try {
      const row = await this.d1
        .prepare('SELECT country, state_province FROM households WHERE id = ?')
        .bind(householdId)
        .first<{ country: string | null; state_province: string | null }>();
      return getTaxProfile(row?.country ?? null, row?.state_province ?? null);
    } catch {
      return null;
    }
  }

  private async extractViaProvider(
    images: Array<{ base64: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' }>,
    householdId: string,
    trace: string,
    userId: string | null | undefined,
    userPrompt: string,
    onProgress?: (progress: ReceiptScanProgress) => void
  ): Promise<RawGroceryReceipt> {
    const primaryModel = this.env.AIHOUSEKEEPER_BRIEFING_MODEL || this.env.AIHOUSEKEEPER_NUDGE_MODEL;
    const fallbackModel = this.env.AIHOUSEKEEPER_FALLBACK_MODEL;
    const aiStart = Date.now();
    budgetDebug(this.env, 'scan.ai', {
      trace,
      stage: 'request',
      path: 'image',
      imageCount: images.length,
      mimeTypes: images.map((i) => i.mime),
      primaryModel,
      fallbackModel,
      maxTokens: SCAN_MAX_TOKENS,
    });
    const messages: GenerateMessage[] = [
      {
        role: 'user',
        content: [
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mime, data: img.base64 },
          })),
          { type: 'text', text: userPrompt },
        ],
      },
    ];

    const ai = await this.aiFor(householdId, userId);
    // Edge-triggered: the model emits many JSON fragments per item, and only a
    // change in the item count is worth a frame on the client. High-water rather
    // than raw count, because the `max_tokens` retry below starts a SECOND
    // stream from zero — reporting that verbatim would walk the user's counter
    // backwards mid-scan.
    let reported = 0;
    const onToolJsonDelta = onProgress
      ? (accumulatedJson: string): void => {
          const items = countStreamedReceiptItems(accumulatedJson);
          if (items <= reported) return;
          reported = items;
          onProgress({ stage: 'reading', items });
        }
      : undefined;
    const args = {
      systemPrompt: SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
      messages,
      tools: [
        {
          name: 'output',
          description: 'Return the structured receipt matching the JSON schema.',
          input_schema: SCAN_GROCERY_RECEIPT_SCHEMA,
        },
      ],
      toolChoice: { type: 'tool' as const, name: 'output' },
      maxTokens: SCAN_MAX_TOKENS,
      onToolJsonDelta,
    };

    let result: GenerateResult = await generateWithFallback(ai, primaryModel, fallbackModel, args);
    if (result.stopReason === 'max_tokens') {
      budgetDebug(this.env, 'scan.ai', {
        trace,
        stage: 'retry',
        reason: 'max_tokens',
        maxTokens: SCAN_RETRY_MAX_TOKENS,
      });
      result = await generateWithFallback(ai, primaryModel, fallbackModel, {
        ...args,
        maxTokens: SCAN_RETRY_MAX_TOKENS,
      });
    }

    const toolBlock = result.content.find((b) => b.type === 'tool_use');
    budgetDebug(this.env, 'scan.ai', {
      trace,
      stage: 'response',
      path: 'image',
      elapsedMs: Date.now() - aiStart,
      model: result.model ?? null,
      stopReason: result.stopReason ?? null,
      contentBlockTypes: result.content.map((b) => b.type),
      hasToolUse: !!toolBlock,
      rawToolInput: toolBlock && toolBlock.type === 'tool_use' ? toolBlock.input : null,
    });
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new ValidationError('Could not read the receipt. Try a clearer photo.');
    }
    return toolBlock.input as RawGroceryReceipt;
  }

  private async extractViaDocument(
    base64Data: string,
    householdId: string,
    trace: string,
    userId: string | null | undefined,
    userPrompt: string,
    onProgress?: (progress: ReceiptScanProgress) => void
  ): Promise<RawGroceryReceipt> {
    const provider = (await this.aiFor(householdId, userId)) as ClaudeProvider;
    const model =
      this.env.AIHOUSEKEEPER_BRIEFING_MODEL ||
      this.env.AIHOUSEKEEPER_NUDGE_MODEL ||
      'claude-sonnet-4-5-20250929';
    const aiStart = Date.now();
    budgetDebug(this.env, 'scan.ai', {
      trace,
      stage: 'request',
      path: 'document',
      model,
      maxTokens: SCAN_MAX_TOKENS,
    });

    let reported = 0;
    const raw = await provider.generateToolFromDocument<RawGroceryReceipt>({
      systemPrompt: SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
      userText: userPrompt,
      documentBase64: base64Data,
      tool: {
        name: 'output',
        description: 'Return the structured receipt matching the JSON schema.',
        input_schema: SCAN_GROCERY_RECEIPT_SCHEMA,
      },
      model,
      maxTokens: SCAN_MAX_TOKENS,
      onToolJsonDelta: onProgress
        ? (accumulatedJson) => {
            const items = countStreamedReceiptItems(accumulatedJson);
            if (items <= reported) return;
            reported = items;
            onProgress({ stage: 'reading', items });
          }
        : undefined,
    });

    budgetDebug(this.env, 'scan.ai', {
      trace,
      stage: 'response',
      path: 'document',
      elapsedMs: Date.now() - aiStart,
      model,
      hasToolUse: true,
      rawToolInput: raw,
    });
    return raw;
  }

  private dropReason(raw: RawGroceryReceiptItem): string {
    if (!raw || (typeof raw.name !== 'string' && typeof raw.raw_name !== 'string')) {
      return 'missing/invalid name';
    }
    const name = (raw.name || raw.raw_name || '').trim();
    if (!name) return 'empty name';
    if (this.toCents(raw.amount) === null) return `invalid amount: ${String(raw.amount)}`;
    return 'unknown';
  }

  private normalizeItem(
    raw: RawGroceryReceiptItem,
    resolveCategory: (name: string | null | undefined) => { id: string | null; name: string | null }
  ): FeeLineInput | null {
    if (!raw) return null;
    const rawName = (typeof raw.raw_name === 'string' ? raw.raw_name : raw.name ?? '').trim();
    const nameIn = (typeof raw.name === 'string' ? raw.name : rawName).trim();
    if (!rawName && !nameIn) return null;

    const amount = this.toCents(raw.amount);
    if (amount === null) return null;

    const saved = this.toCents(raw.saved_amount) ?? 0;
    const category = resolveCategory(raw.category);
    const categorySuggestions = this.mapCategorySuggestions(
      raw.category_suggestions,
      resolveCategory,
      category.id
    );
    const tax_codes = Array.isArray(raw.tax_codes)
      ? raw.tax_codes
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      : [];
    const printed = rawName || nameIn;
    const title = this.capitalizeName(printed);
    const nameSuggestions = this.ensureNameSuggestions(
      printed,
      Array.isArray(raw.name_suggestions) ? raw.name_suggestions : []
    );
    const fees = this.normalizeFees(raw.fees);

    return {
      raw_name: printed,
      raw_code: normalizeCode(raw.raw_code),
      name: this.capitalizeName(nameIn || printed),
      name_suggestions: nameSuggestions.length > 0 ? nameSuggestions : [title],
      amount,
      saved_amount: Math.max(0, saved),
      tax_codes,
      fees,
      category_id: category.id,
      category_name: category.name,
      category_suggestions: categorySuggestions,
    };
  }

  private applyAlias(
    line: ReturnType<typeof attachFeesAndMerge>[number],
    aliases: ReceiptAliasHint[],
    categoryById: Map<string, { id: string; name: string }>,
    hits: Array<{ key: string; name: string }>
  ): ReturnType<typeof attachFeesAndMerge>[number] {
    if (aliases.length === 0) return line;
    const keys = [line.raw_code, line.raw_name.trim().toLowerCase()].filter(
      (k): k is string => !!k
    );
    const hit = aliases.find((a) => keys.includes(a.key.trim().toLowerCase()) || keys.includes(a.key));
    if (!hit) return line;
    hits.push({ key: hit.key, name: hit.name });
    const aliasCat = hit.categoryId ? categoryById.get(hit.categoryId) : undefined;
    return {
      ...line,
      name: hit.name.trim() || line.name,
      category_id: aliasCat?.id ?? line.category_id,
      category_name: aliasCat?.name ?? line.category_name,
    };
  }

  private mapCategorySuggestions(
    raw: string[] | undefined,
    resolveCategory: (name: string | null | undefined) => { id: string | null; name: string | null },
    selectedId: string | null
  ): ReceiptCategorySuggestion[] {
    if (!Array.isArray(raw)) return [];
    const out: ReceiptCategorySuggestion[] = [];
    const seen = new Set<string>();
    for (const name of raw) {
      const mapped = resolveCategory(name);
      if (!mapped.id || !mapped.name) continue;
      if (mapped.id === selectedId || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      out.push({ id: mapped.id, name: mapped.name });
      if (out.length >= 3) break;
    }
    return out;
  }

  private normalizeFees(raw: RawGroceryReceiptFee[] | undefined): ReceiptScanFee[] {
    if (!Array.isArray(raw)) return [];
    const out: ReceiptScanFee[] = [];
    for (const fee of raw) {
      const amount = this.toCents(fee?.amount);
      if (amount === null || amount <= 0) continue;
      const kind = (FEE_KINDS.has(fee.kind as FeeKind) ? fee.kind : classifyFeeKind(fee.label ?? '')) ??
        'other';
      out.push({
        kind,
        label: typeof fee.label === 'string' && fee.label.trim() ? fee.label.trim() : kind,
        amount,
      });
    }
    return out;
  }

  private ensureNameSuggestions(rawName: string, suggestions: string[]): string[] {
    const title = this.capitalizeName(rawName);
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (value: string): void => {
      const t = value.trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    for (const s of suggestions) {
      if (typeof s === 'string') add(s);
    }
    if (!seen.has(title.toLowerCase())) {
      if (out.length >= 7) out[6] = title;
      else out.push(title);
    }
    return out.slice(0, 7);
  }

  private capitalizeName(value: string): string {
    return value
      .toLowerCase()
      .split(/\s+/)
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(' ');
  }

  private detectMimeType(buffer: ArrayBuffer): ReceiptScanMimeType | null {
    const b = new Uint8Array(buffer);
    if (b.length < 4) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50
    ) {
      return 'image/webp';
    }
    return null;
  }

  private toCents(value: unknown): number | null {
    let n: number;
    if (typeof value === 'number') {
      n = value;
    } else if (typeof value === 'string') {
      n = parseFloat(value.replace(/[^0-9.-]/g, ''));
    } else {
      return null;
    }
    if (!Number.isFinite(n) || n < 0) return null;
    if (!Number.isInteger(n)) n = n * 100;
    return Math.round(n);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

const FEE_KINDS = new Set<FeeKind>(['deposit', 'environmental', 'bag', 'crv', 'other']);

/** @deprecated Prefer {@link ReceiptScanService}. */
export const GroceryReceiptService = ReceiptScanService;
