import type { GroceryReceiptScanResult, SuggestedSpending } from '@api/budget';
import type { MortgageStatementDraft } from '@api/mortgage';
import type {
  ExtractedRegisteredStatement,
  SavingsImportDraft,
  SavingsImportScope,
} from '@api/savings';

import { getLocalLedgerFor } from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';
import { applyAliasHints, listAliasHints } from '../receiptAliases';

import {
  buildReceiptDraftFromParsed,
  buildReceiptDraftFromRaw,
  resolveReceiptCategoryIds,
  type RawReceiptDraft,
} from './buildReceiptDraft';
import { normalizeSavingsImportDraft, savingsDraftHasRows } from './buildSavingsDraft';
import { countStreamedReceiptItems } from './countStreamedReceiptItems';
import type { ImportAttachment } from './formDataParts';
import { byokLog, generateStructuredByok, resolveLocalByokProvider } from './localByokClient';
import { readAttachmentAsBase64, readAttachmentAsText } from './localTextExtract';
import { normalizeMortgageDraftLocal } from './normalizeMortgageDraftLocal';
import {
  normalizeRegisteredDraftLocal,
  parseRegisteredStatementText,
} from './normalizeRegisteredDraftLocal';
import { parseBudgetItemsText } from './parseBudgetItemsText';
import { parseReceiptText } from './parseReceiptText';
import { parseSavingsText } from './parseSavingsText';
import {
  BUDGET_ITEMS_IMPORT_SCHEMA,
  BUDGET_ITEMS_IMPORT_SYSTEM,
  buildBudgetItemsImportUserPrompt,
} from './prompts/budgetItemsImport';
import {
  buildMortgageStatementImportUserPrompt,
  MORTGAGE_STATEMENT_IMPORT_SCHEMA,
  MORTGAGE_STATEMENT_IMPORT_SYSTEM,
} from './prompts/mortgageStatementImport';
import {
  buildReceiptImportUserPrompt,
  RECEIPT_IMPORT_SCHEMA,
  RECEIPT_IMPORT_SYSTEM,
} from './prompts/receiptImport';
import {
  buildRegisteredStatementImportUserPrompt,
  REGISTERED_STATEMENT_IMPORT_SCHEMA,
  REGISTERED_STATEMENT_IMPORT_SYSTEM,
} from './prompts/registeredStatementImport';
import {
  buildSavingsImportUserPrompt,
  SAVINGS_IMPORT_SCHEMA,
  SAVINGS_IMPORT_SYSTEM,
} from './prompts/savingsImport';

export type { ImportAttachment };

export interface ReceiptImportInput {
  householdId: string;
  files: ImportAttachment | ImportAttachment[];
  pastedText?: string;
  /**
   * Receipt lines read so far, while the provider is still writing. Only the
   * BYOK stage can report this (the local text parse is instant), and only for
   * providers whose streamed transport we speak — treat it as optional.
   */
  onItemsRead?: (count: number) => void;
}

export interface SavingsImportInput {
  householdId: string;
  text: string;
  scope?: SavingsImportScope;
  file?: ImportAttachment;
}

export interface AiDetectItemsInput {
  householdId: string;
  text?: string;
  file?: ImportAttachment;
  year?: number;
  month?: number;
}

export interface MortgageExtractInput {
  text?: string | null;
  file?: ImportAttachment | null;
}

export interface RegisteredExtractInput {
  text?: string;
  file?: ImportAttachment;
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function isVisionMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime.toLowerCase());
}

/**
 * The named household's visible categories — the vocabulary every stage of the
 * ladder maps model output onto.
 *
 * `getLocalLedgerFor(householdId)`, not `getLocalLedger()`. The `householdId`
 * these entry points take was decorative while a device held one household: the
 * active ledger was the only ledger, so the id could not disagree with it and
 * the filter below was the whole of the scoping. With several households on one
 * device a scan asked about B but analysed against A's categories resolves every
 * line onto ids from a different budget, and the commit that follows writes them
 * as if they were real — a bleed with no parameter anywhere in the call to
 * reveal it (plan §2, hazard 2).
 *
 * It hydrates that household on demand and deliberately does NOT activate it: an
 * import running for household B must not yank the screen the member is looking
 * at over to B. The `household_id` filter is kept as the last line of defence,
 * even though a hydrated ledger holds only its own rows.
 */
async function householdCategories(
  householdId: string,
): Promise<Array<{ id: string; name: string }>> {
  const ledger = await getLocalLedgerFor(householdId);
  return ledger.categories
    .filter((c) => c.household_id === householdId && !c.hidden)
    .map((c) => ({ id: c.id, name: c.name }));
}

async function collectSourceText(
  files: ImportAttachment[],
  pastedText?: string,
): Promise<{ text: string | null; images: Array<{ base64: string; mime: string }> }> {
  const chunks: string[] = [];
  if (pastedText?.trim()) chunks.push(pastedText.trim());
  const images: Array<{ base64: string; mime: string }> = [];

  for (const file of files) {
    const text = await readAttachmentAsText(file);
    if (text) {
      chunks.push(text);
      continue;
    }
    const image = await readAttachmentAsBase64(file);
    if (image) images.push(image);
  }

  return { text: chunks.length ? chunks.join('\n\n') : null, images };
}

type RawBudgetItems = {
  items: Array<{
    title: string;
    description: string | null;
    estimated_cost_min: number | null;
    estimated_cost_max: number | null;
    priority: SuggestedSpending['priority'];
    category: string | null;
    scheduled: boolean;
    target_date: string | null;
    is_recurring: boolean;
    recurrence_frequency: SuggestedSpending['recurrence_frequency'];
  }>;
};

function mapBudgetItems(
  raw: RawBudgetItems,
  categories: Array<{ id: string; name: string }>,
): SuggestedSpending[] {
  return (raw.items ?? []).map((item) => {
    const match = item.category
      ? categories.find((c) => c.name.toLowerCase() === item.category!.toLowerCase())
      : undefined;
    return {
      title: item.title,
      description: item.description,
      estimated_cost_min: item.estimated_cost_min,
      estimated_cost_max: item.estimated_cost_max,
      priority: item.priority ?? 'medium',
      category_id: match?.id ?? null,
      category_name: match?.name ?? item.category,
      scheduled: !!item.scheduled,
      target_date: item.target_date,
      is_recurring: !!item.is_recurring,
      recurrence_frequency: item.recurrence_frequency,
    };
  });
}

/**
 * Stage A: local text parse → Stage B: optional BYOK refine → Stage C: draft only.
 */
export async function runReceiptImportLadder(
  input: ReceiptImportInput,
): Promise<GroceryReceiptScanResult> {
  const files = Array.isArray(input.files) ? input.files : [input.files];
  const categories = await householdCategories(input.householdId);
  const { text, images } = await collectSourceText(files, input.pastedText);

  let draft: GroceryReceiptScanResult | null = null;
  // Kept even when BYOK goes on to replace the draft: the text parse is the
  // only stage that sees the receipt as characters, so a spelled-out "USD" it
  // caught survives a model that returned null for the currency.
  const textCurrency = text ? parseReceiptText(text).currency : null;
  if (text) {
    draft = buildReceiptDraftFromParsed(parseReceiptText(text), categories);
  }

  const byok = await resolveLocalByokProvider();
  const needsByok = images.length > 0 || !draft || draft.items.length === 0;

  // Which stage answered is the first thing to know when a scan fails: a file
  // that yielded neither text nor an image looks identical, from the alert, to
  // a provider that rejected the call.
  byokLog('receipt', {
    fileCount: files.length,
    fileMimes: files.map((f) => f.type),
    textChars: text?.length ?? 0,
    imageCount: images.length,
    parsedItems: draft?.items.length ?? 0,
    byokProvider: byok?.provider ?? null,
    needsByok,
  });

  if (needsByok) {
    if (!byok) {
      throw new BudgetLocalUnsupportedError('scanReceipt');
    }
    // High-water rather than the raw count: the `max_tokens` retry inside the
    // client starts a second stream from zero, and walking the user's counter
    // backwards mid-scan reads as a fault.
    let reported = 0;
    const raw = await generateStructuredByok<RawReceiptDraft>(
      {
        systemPrompt: RECEIPT_IMPORT_SYSTEM,
        userPrompt: buildReceiptImportUserPrompt(
          categories.map((c) => c.name),
          text ?? undefined,
        ),
        schema: RECEIPT_IMPORT_SCHEMA,
        images: images.length ? images : undefined,
        maxTokens: 8192,
        onPartialJson: input.onItemsRead
          ? (accumulated) => {
              const items = countStreamedReceiptItems(accumulated);
              if (items <= reported) return;
              reported = items;
              input.onItemsRead?.(items);
            }
          : undefined,
      },
      byok.provider,
    );
    draft = buildReceiptDraftFromRaw(raw, categories);
    if (!draft.receipt_currency && textCurrency) {
      draft = { ...draft, receipt_currency: textCurrency };
    }
    // Log the count BEFORE and AFTER mapping. `buildReceiptDraftFromRaw` drops
    // any line failing `name && amount > 0`, so "the model read nothing" and
    // "we discarded everything it read" are the same log line otherwise — and
    // they need opposite fixes. Counts only, never the receipt contents.
    byokLog('receipt', {
      stage: 'byok-parsed',
      rawItems: raw.items?.length ?? 0,
      items: draft.items.length,
      // Whether the model filled the MEASURE fields, and for how many lines.
      // Without this a missing per-litre price is indistinguishable between
      // "the model ignored the schema" and "we dropped it in mapping" — and
      // those need opposite fixes. Counts and units only, never a price.
      measured: draft.items.filter((i) => i.quantity != null).length,
      units: Array.from(new Set(draft.items.map((i) => i.unit).filter(Boolean))),
    });
  }

  if (!draft) {
    throw new BudgetLocalUnsupportedError('scanReceipt');
  }

  const resolved = resolveReceiptCategoryIds(draft, categories);
  const aliases = await listAliasHints();
  return {
    ...resolved,
    items: applyAliasHints(resolved.items, aliases),
  };
}

export async function runSavingsImportLadder(input: SavingsImportInput): Promise<SavingsImportDraft> {
  const scope = input.scope ?? 'all';
  let combined = input.text?.trim() ?? '';
  if (input.file) {
    const fromFile = await readAttachmentAsText(input.file);
    if (fromFile) combined = combined ? `${combined}\n\n${fromFile}` : fromFile;
  }

  if (!combined) {
    throw new BudgetLocalUnsupportedError('importAnalyze');
  }

  let draft = normalizeSavingsImportDraft(parseSavingsText(combined, scope));

  const byok = await resolveLocalByokProvider();
  if (!savingsDraftHasRows(draft) && byok) {
    draft = normalizeSavingsImportDraft(
      await generateStructuredByok<SavingsImportDraft>(
        {
          systemPrompt: SAVINGS_IMPORT_SYSTEM,
          userPrompt: buildSavingsImportUserPrompt(scope, combined),
          schema: SAVINGS_IMPORT_SCHEMA,
        },
        byok.provider,
      ),
    );
  }

  if (!savingsDraftHasRows(draft)) {
    // Local parse produced nothing and BYOK unavailable — still return empty draft
    // so the UI can show "nothing found" instead of a hard error when text exists.
    return draft;
  }

  if (!savingsDraftHasRows(parseSavingsText(combined, scope)) && byok) {
    // BYOK refined a sparse local parse — already handled above.
    return draft;
  }

  if (byok && combined.length > 400) {
    try {
      draft = normalizeSavingsImportDraft(
        await generateStructuredByok<SavingsImportDraft>(
          {
            systemPrompt: SAVINGS_IMPORT_SYSTEM,
            userPrompt: buildSavingsImportUserPrompt(scope, combined),
            schema: SAVINGS_IMPORT_SCHEMA,
          },
          byok.provider,
        ),
      );
    } catch {
      // Keep deterministic local draft when BYOK refine fails.
    }
  }

  return draft;
}

export async function runAiDetectItemsLadder(
  input: AiDetectItemsInput,
): Promise<{ suggestions: SuggestedSpending[] }> {
  const categories = await householdCategories(input.householdId);
  const files = input.file ? [input.file] : [];
  const { text, images } = await collectSourceText(files, input.text);
  const visionImages = images.filter((img) => isVisionMime(img.mime));

  let suggestions = text
    ? parseBudgetItemsText(text, categories, { year: input.year, month: input.month })
    : [];

  const byok = await resolveLocalByokProvider();
  const needsByok = visionImages.length > 0 || suggestions.length === 0;

  if (needsByok) {
    if (!byok) {
      if (!text) throw new BudgetLocalUnsupportedError('aiDetectItems');
      return { suggestions };
    }
    if (!text && visionImages.length === 0) {
      throw new BudgetLocalUnsupportedError('aiDetectItems');
    }
    const today = new Date().toISOString().slice(0, 10);
    const raw = await generateStructuredByok<RawBudgetItems>(
      {
        systemPrompt: BUDGET_ITEMS_IMPORT_SYSTEM,
        userPrompt: buildBudgetItemsImportUserPrompt({
          text: text ?? '(see attached image)',
          today,
          viewedYear: input.year,
          viewedMonth: input.month,
          categoryNames: categories.map((c) => c.name),
        }),
        schema: BUDGET_ITEMS_IMPORT_SCHEMA,
        images: visionImages.length ? visionImages : undefined,
      },
      byok.provider,
    );
    suggestions = mapBudgetItems(raw, categories);
  }

  return { suggestions };
}

export async function runMortgageStatementExtractLadder(
  input: MortgageExtractInput,
): Promise<{ draft: MortgageStatementDraft }> {
  const files = input.file ? [input.file] : [];
  const { text, images } = await collectSourceText(files, input.text ?? undefined);
  const visionImages = images.filter((img) => isVisionMime(img.mime));
  const byok = await resolveLocalByokProvider();

  if (!text && visionImages.length === 0) {
    throw new BudgetLocalUnsupportedError('mortgageApi.extractStatement');
  }

  if (!byok) {
    // Without BYOK we cannot reliably parse statement PDFs/images; text-only
    // still needs the model for field mapping — surface the offline AI copy.
    throw new BudgetLocalUnsupportedError('mortgageApi.extractStatement');
  }

  const raw = await generateStructuredByok<Record<string, unknown>>(
    {
      systemPrompt: MORTGAGE_STATEMENT_IMPORT_SYSTEM,
      userPrompt: buildMortgageStatementImportUserPrompt(text ?? undefined),
      schema: MORTGAGE_STATEMENT_IMPORT_SCHEMA,
      images: visionImages.length ? visionImages : undefined,
      maxTokens: 4096,
    },
    byok.provider,
  );

  return { draft: normalizeMortgageDraftLocal(raw) };
}

export async function runRegisteredStatementExtractLadder(
  input: RegisteredExtractInput,
): Promise<{ draft: ExtractedRegisteredStatement }> {
  const files = input.file ? [input.file] : [];
  const { text, images } = await collectSourceText(files, input.text);
  const visionImages = images.filter((img) => isVisionMime(img.mime));

  let draft = text ? parseRegisteredStatementText(text) : null;
  const byok = await resolveLocalByokProvider();
  const needsByok = visionImages.length > 0 || !draft || draft.accounts.length === 0;

  if (needsByok) {
    if (!byok) {
      if (draft && draft.accounts.length > 0) return { draft };
      throw new BudgetLocalUnsupportedError('savingsApi.extractRegisteredStatement');
    }
    if (!text && visionImages.length === 0) {
      throw new BudgetLocalUnsupportedError('savingsApi.extractRegisteredStatement');
    }
    const raw = await generateStructuredByok<Record<string, unknown>>(
      {
        systemPrompt: REGISTERED_STATEMENT_IMPORT_SYSTEM,
        userPrompt: buildRegisteredStatementImportUserPrompt(text ?? undefined),
        schema: REGISTERED_STATEMENT_IMPORT_SCHEMA,
        images: visionImages.length ? visionImages : undefined,
      },
      byok.provider,
    );
    draft = normalizeRegisteredDraftLocal(raw, text ?? '');
  }

  return { draft: draft ?? { accounts: [], confidence: 0.1, rawText: text ?? '' } };
}
