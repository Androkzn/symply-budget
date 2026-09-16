import { generateStructuredWithFallback } from '../ai/fallback';
import {
  EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT,
  EXTRACT_BUDGET_DOCUMENT_USER_PROMPT,
} from '../ai/prompts/extract-budget-document';
import {
  SUGGEST_BUDGET_ITEMS_SCHEMA,
  SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT,
  buildSuggestBudgetItemsUserPrompt,
  type RawBudgetSuggestion,
} from '../ai/prompts/suggest-budget-items';
import type { AIProvider } from '../ai/provider';
import { createAnthropicAdapterForUser, createProviderAdapter } from '../ai/provider-factory';
import type { Env } from '../types';
import { analyzeAssetQuality, budgetDebug, newTraceId } from '../utils/budget-debug';
import { ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { hasUsableProviderKey, resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';
import { BudgetService } from './budget-service';

export type BudgetDocumentMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

type Priority = 'critical' | 'high' | 'medium' | 'low';
type Recurrence = 'monthly' | 'quarterly' | 'yearly';

/** A reviewed-before-saving draft spending returned to the client. */
export interface SuggestedSpending {
  title: string;
  description: string | null;
  estimated_cost_min: number | null;
  estimated_cost_max: number | null;
  priority: Priority;
  /** Resolved server-side from the AI's category name against the household's categories. */
  category_id: string | null;
  category_name: string | null;
  scheduled: boolean;
  target_date: string | null;
  is_recurring: boolean;
  recurrence_frequency: Recurrence | null;
}

const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];
const RECURRENCES: Recurrence[] = ['monthly', 'quarterly', 'yearly'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BudgetSuggestionService {
  private env: Env;
  private budgetService: BudgetService;
  private injectedAi?: AIProvider;

  /** `aiProvider` is injectable for tests; production call sites omit it. */
  constructor(env: Env, d1: D1Database, aiProvider?: AIProvider) {
    this.env = env;
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
          feature: 'budget_import',
          householdId,
          userId: userId ?? null,
        }),
      },
    });
  }

  async suggestFromTextAndFile(
    householdId: string,
    userId: string,
    input: {
      text?: string;
      file?: { data: ArrayBuffer; mimeType: BudgetDocumentMimeType; name: string };
      year?: number;
      month?: number;
    }
  ): Promise<SuggestedSpending[]> {
    const trace = newTraceId();
    budgetDebug(this.env, 'ai-detect', {
      trace,
      stage: 'start',
      householdId,
      userId,
      hasText: !!input.text?.trim(),
      textLength: input.text?.trim().length ?? 0,
      hasFile: !!input.file,
      fileName: input.file?.name ?? null,
      fileMime: input.file?.mimeType ?? null,
      fileBytes: input.file?.data.byteLength ?? null,
      year: input.year ?? null,
      month: input.month ?? null,
    });

    let combinedText = input.text?.trim() ?? '';

    if (input.file) {
      const extracted = await this.extractSpendingTextFromDocument(
        input.file.data,
        input.file.mimeType,
        trace,
        userId
      );
      if (extracted.trim()) {
        combinedText = combinedText
          ? `${combinedText}\n\n${extracted.trim()}`
          : extracted.trim();
      }
    }

    if (!combinedText) {
      budgetDebug(this.env, 'ai-detect', { trace, stage: 'no-text', message: 'No usable text extracted' });
      throw new ValidationError(
        'Could not read any spending details from the text or attachment. Try a clearer description or file.'
      );
    }

    budgetDebug(this.env, 'ai-detect', {
      trace,
      stage: 'combined-text',
      combinedTextLength: combinedText.length,
      combinedTextPreview: combinedText.slice(0, 500),
    });

    return this.suggestFromText(householdId, userId, {
      text: combinedText,
      year: input.year,
      month: input.month,
      trace,
    });
  }

  async suggestFromText(
    householdId: string,
    userId: string,
    input: { text: string; year?: number; month?: number; trace?: string }
  ): Promise<SuggestedSpending[]> {
    const trace = input.trace ?? newTraceId();
    // getCategories performs the household-access check internally.
    const categories = await this.budgetService.getCategories(householdId, userId);
    const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

    const today = nowIso().slice(0, 10);

    const aiStart = Date.now();
    budgetDebug(this.env, 'ai-detect.ai', {
      trace,
      stage: 'request',
      primaryModel: this.env.AIHOUSEKEEPER_NUDGE_MODEL,
      fallbackModel: this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
      textLength: input.text.length,
      categoryCount: categories.length,
      today,
      viewedYear: input.year ?? null,
      viewedMonth: input.month ?? null,
    });

    const ai = await this.aiFor(householdId, userId);
    const result = await generateStructuredWithFallback<{ items: RawBudgetSuggestion[] }>(
      ai,
      this.env.AIHOUSEKEEPER_NUDGE_MODEL,
      this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt: SUGGEST_BUDGET_ITEMS_SYSTEM_PROMPT,
        userPrompt: buildSuggestBudgetItemsUserPrompt({
          text: input.text,
          today,
          viewedYear: input.year,
          viewedMonth: input.month,
          categoryNames: categories.map((c) => c.name),
        }),
        schema: SUGGEST_BUDGET_ITEMS_SCHEMA,
        // Headroom for a document that yields many line items (e.g. a whole-year
        // budget grid → dozens of spends). At 2048 the structured tool-call JSON
        // truncated mid-array and parsed to zero items → a false "Nothing found".
        maxTokens: 8192,
      }
    );

    const rawItems = result.items ?? [];
    const kept = rawItems.filter(
      (raw) => raw && typeof raw.title === 'string' && raw.title.trim().length > 0
    );
    const suggestions = kept.map((raw) => this.normalize(raw, categoryByName));

    budgetDebug(this.env, 'ai-detect.ai', {
      trace,
      stage: 'response',
      elapsedMs: Date.now() - aiStart,
      rawItemCount: rawItems.length,
      keptItemCount: kept.length,
      droppedItemCount: rawItems.length - kept.length,
      rawItems,
      suggestions: suggestions.map((s) => ({
        title: s.title,
        category: s.category_name,
        priority: s.priority,
        costMin: s.estimated_cost_min,
        costMax: s.estimated_cost_max,
        scheduled: s.scheduled,
        recurring: s.is_recurring,
      })),
    });

    return suggestions;
  }

  private async extractSpendingTextFromDocument(
    data: ArrayBuffer,
    mediaType: BudgetDocumentMimeType,
    trace: string,
    userId: string
  ): Promise<string> {
    // Their own connected key counts as "configured" — the managed key alone is
    // the wrong question for a BYOK member.
    if (!(await hasUsableProviderKey(this.env, userId, 'anthropic'))) {
      throw new ValidationError('AI is not configured for document reading.');
    }

    const fileSizeMB = data.byteLength / (1024 * 1024);
    if (fileSizeMB > 32) {
      throw new ValidationError('File exceeds 32MB limit for document reading.');
    }

    // Asset-quality diagnostics for the "add with AI" attachment path.
    const quality = analyzeAssetQuality(data, mediaType);
    budgetDebug(this.env, 'ai-detect.asset', { trace, ...quality });

    const base64Data = this.arrayBufferToBase64(data);
    const model = this.env.AIHOUSEKEEPER_NUDGE_MODEL || 'claude-sonnet-4-5-20250929';

    const aiStart = Date.now();
    budgetDebug(this.env, 'ai-detect.ai', {
      trace,
      stage: 'extract-request',
      model,
      mediaType,
      path: mediaType === 'application/pdf' ? 'document' : 'image',
    });

    const provider = await createAnthropicAdapterForUser(
      this.env,
      userId,
      { feature: 'budget_ai_detect', userId },
      model
    );
    const { text: extracted, usage } = await provider.generateFromMediaContent({
      systemPrompt: EXTRACT_BUDGET_DOCUMENT_SYSTEM_PROMPT,
      userText: EXTRACT_BUDGET_DOCUMENT_USER_PROMPT,
      media: { base64: base64Data, mediaType },
      // Headroom for a dense budget grid (many category × month cells).
      maxTokens: 4096,
      model,
    });

    budgetDebug(this.env, 'ai-detect.ai', {
      trace,
      stage: 'extract-response',
      elapsedMs: Date.now() - aiStart,
      model,
      stopReason: null,
      usage: usage ?? null,
      firstBlockType: 'text',
      extractedTextLength: extracted.trim().length,
      extractedTextPreview: extracted.trim().slice(0, 800),
    });
    return extracted.trim();
  }

  private normalize(
    raw: RawBudgetSuggestion,
    categoryByName: Map<string, { id: string; name: string }>
  ): SuggestedSpending {
    let min = this.toCents(raw.estimated_cost_min);
    let max = this.toCents(raw.estimated_cost_max);
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    if (min !== null && max === null) max = min;
    if (max !== null && min === null) min = max;

    const priority: Priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'medium';

    const matched = raw.category ? categoryByName.get(raw.category.trim().toLowerCase()) : undefined;

    // Trust the resolved date over the model's `scheduled` flag — keep them
    // consistent so an item is "scheduled" iff it actually has a valid date.
    const targetDate =
      typeof raw.target_date === 'string' && ISO_DATE.test(raw.target_date) ? raw.target_date : null;

    const isRecurring = raw.is_recurring === true;
    const recurrence: Recurrence | null =
      isRecurring && raw.recurrence_frequency && RECURRENCES.includes(raw.recurrence_frequency)
        ? raw.recurrence_frequency
        : isRecurring
          ? 'monthly'
          : null;

    return {
      title: raw.title.trim(),
      description: raw.description?.trim() || null,
      estimated_cost_min: min,
      estimated_cost_max: max,
      priority,
      category_id: matched?.id ?? null,
      category_name: matched?.name ?? null,
      scheduled: targetDate !== null,
      target_date: targetDate,
      is_recurring: isRecurring,
      recurrence_frequency: recurrence,
    };
  }

  private toCents(value: number | null): number | null {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return null;
    return Math.round(value);
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
