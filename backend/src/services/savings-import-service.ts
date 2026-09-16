/**
 * savings-import-service.ts — AI-import pipeline for the Savings feature.
 *
 * Structurally mirrors budget-suggestion-service.ts, but per plan §C-2 routes
 * EVERY model call through the ai/provider.ts abstraction + ai/fallback.ts —
 * it does NOT clone budget's legacy direct-`@anthropic-ai/sdk` read path
 * (extractSpendingTextFromDocument). No `@anthropic-ai/sdk` import lives here.
 *
 * Flow: createJob (upload → R2 + savings_import_jobs row) → analyze (read by
 * source kind, then structure into a reviewable SavingsImportDraft, persisted)
 * → user reviews/edits → commit (write the confirmed subset, delete the R2
 * object). Never silent-saves.
 *
 * PII: raw_text and draft_json are NEVER logged. The persisted `error` column
 * and every `[savings-import]` log line carry only a bounded error CODE, never
 * source-document content.
 */

import { and, eq, like, sql } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { z } from 'zod';

import { generateStructuredWithFallback } from '../ai/fallback';
import {
  EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT,
  EXTRACT_SAVINGS_DOCUMENT_USER_PROMPT,
} from '../ai/prompts/extract-savings-document';
import {
  SAVINGS_IMPORT_SCHEMA,
  SAVINGS_IMPORT_SYSTEM_PROMPT,
  buildSavingsImportUserPrompt,
  type SavingsImportScope,
} from '../ai/prompts/suggest-savings-import';
import type { AIProvider, GenerateMessage, GenerateResult } from '../ai/provider';
import { createProviderAdapter } from '../ai/provider-factory';
import { INCOME_SOURCE_TYPES, type IncomeSourceType } from '../constants/income-sources';
import { householdMembers, users } from '../db/schema';
import { expenses, budgetCategories } from '../db/schema-budget';
import {
  savingsImportJobs,
  savingsIncomeEntries,
  savingsSpendingEntries,
  savingsRecurringPayments,
  savingsCategories,
  type SavingsImportJob,
} from '../db/schema-savings';
import type { Env } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';

// ============ Public draft type (matches FE SavingsImportDraft) ============

export interface SavingsImportDraft {
  income: Array<{
    member_name: string | null;
    source_type: IncomeSourceType;
    label: string;
    amount_cents: number;
    income_date: string;
    is_recurring: boolean;
    day_of_month: number | null;
  }>;
  spending: Array<{
    category_name: string | null;
    label: string;
    amount_cents: number;
    spending_date: string;
  }>;
  recurringPayments: Array<{
    label: string;
    amount_cents: number;
    category_name: string | null;
    day_of_month: number | null;
    group_label: string | null;
    is_essential: boolean;
  }>;
  /**
   * Whole-year "previous years" grid cells (one per month × spending column).
   * Optional/empty for every non-yearly-grid import (and absent on drafts saved
   * before this feature shipped). Committed via commitHistory() to the budget
   * `expenses` table (the single source of truth the net/trend math reads),
   * NOT to savings_spending_entries.
   */
  monthlyGridSpending?: SavingsGridSpendingRow[];
}

export interface SavingsGridSpendingRow {
  period: string; // 'YYYY-MM'
  category_name: string; // column header verbatim, e.g. 'Food', 'Monthly payments'
  amount_cents: number;
}

export interface SavingsImportCommitResult {
  income: number;
  spending: number;
  recurringPayments: number;
}

/** Result of committing a previous-years (yearly-grid) import. */
export interface SavingsHistoryCommitResult {
  income: number;
  spending: number;
  years: number[];
}

/** Only the buckets a yearly-grid import writes. */
export interface SavingsHistorySelections {
  income: SavingsImportDraft['income'];
  monthlyGridSpending: SavingsGridSpendingRow[];
}

export type SavingsImportSourceKind = 'file' | 'image' | 'text' | 'drive';

export interface SavingsImportCreateInput {
  sourceKind: SavingsImportSourceKind;
  file?: { data: ArrayBuffer; mimeType: string; name: string };
  text?: string;
}

// ============ Structural validation of the model output (plan §5.2) ============
// Same shape as the commit schema. Non-strict field bounds are OK — this only
// guards against a malformed draft crashing the review UI, it does not reject
// on-domain values. `.catch(...)` normalizes out-of-domain enums to 'other'
// rather than throwing, so a single odd row never fails the whole import.


// A model can return an amount as a float, a string, or with currency symbols
// ("$1,422.50"). Coerce robustly to a non-negative integer number of cents so a
// single odd value never fails the whole import (this is a draft the user reviews).
const centsField = z
  .preprocess((v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }
    return 0;
  }, z.number().int())
  .catch(0);

// Every field is `.catch()`-defaulted so one malformed row can't reject the array.
const draftIncomeSchema = z.object({
  member_name: z.string().nullable().catch(null),
  source_type: z.enum(INCOME_SOURCE_TYPES).catch('other'),
  label: z.string().catch(''),
  amount_cents: centsField,
  income_date: z.string().catch(''),
  is_recurring: z.boolean().catch(false),
  day_of_month: z.coerce.number().int().nullable().catch(null),
});

const draftSpendingSchema = z.object({
  category_name: z.string().nullable().catch(null),
  label: z.string().catch(''),
  amount_cents: centsField,
  spending_date: z.string().catch(''),
});

const draftRecurringSchema = z.object({
  label: z.string().catch(''),
  amount_cents: centsField,
  category_name: z.string().nullable().catch(null),
  day_of_month: z.coerce.number().int().nullable().catch(null),
  group_label: z.string().nullable().catch(null),
  is_essential: z.boolean().catch(false),
});

// 'YYYY-MM' — normalised at analyze time; a bad value is dropped (period stays '').
const draftGridSchema = z.object({
  period: z.string().catch(''),
  category_name: z.string().catch(''),
  amount_cents: centsField,
});

const draftSchema = z.object({
  income: z.array(draftIncomeSchema).catch([]),
  spending: z.array(draftSpendingSchema).catch([]),
  recurringPayments: z.array(draftRecurringSchema).catch([]),
  // Optional bucket — only populated for a yearly-grid (history) import.
  monthlyGridSpending: z.array(draftGridSchema).catch([]),
});

// Error codes surfaced to the route + persisted in the `error` column.
const ERR_TOO_LARGE = 'IMPORT_TOO_LARGE';
const ERR_PARSE_FAILED = 'IMPORT_PARSE_FAILED';

// Anthropic caps PDFs at 100 pages for 200K-context models — reject up front.
const MAX_PDF_PAGES = 100;
// Image downsample targets (Anthropic Standard tier): ≤1568px longest side,
// ≤1.15 megapixels total.
const IMAGE_MAX_DIMENSION = 1568;
const IMAGE_MAX_PIXELS = 1_150_000;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * A typed error the route can surface without a 500. `code` is a bounded
 * machine code (never source-doc content); `message` is a safe user string.
 */
export class SavingsImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SavingsImportError';
    this.code = code;
  }
}

export class SavingsImportService {
  private db: DrizzleD1Database;
  private env: Env;
  private ai: AIProvider;
  private injectedAi?: AIProvider;

  /** `aiProvider` is injectable for tests; production call sites omit it. */
  constructor(env: Env, d1: D1Database, aiProvider?: AIProvider) {
    this.db = drizzle(d1);
    this.env = env;
    this.injectedAi = aiProvider;
    // Default managed provider; analyze() rebinds this to the acting user's own
    // BYOK key when they've connected one. A test-injected provider always wins.
    this.ai =
      aiProvider ??
      createProviderAdapter({
        provider: 'anthropic',
        apiKey: env.ANTHROPIC_API_KEY ?? '',
        options: {
          onUsage: usageRecorderFor(env, { feature: 'savings_import' }),
        },
      });
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
          feature: 'savings_import',
          householdId,
          userId: userId ?? null,
        }),
      },
    });
  }

  // ============ ACCESS CHECK (copied verbatim from budget-service) ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId))
      )
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  /** Load a job and assert it belongs to the household (IDOR → NotFoundError). */
  private async loadJob(householdId: string, jobId: string): Promise<SavingsImportJob> {
    const job = await this.db
      .select()
      .from(savingsImportJobs)
      .where(eq(savingsImportJobs.id, jobId))
      .get();
    if (!job || job.household_id !== householdId) {
      throw new NotFoundError('Import job');
    }
    return job;
  }

  // ============ createJob ============

  async createJob(
    householdId: string,
    userId: string,
    input: SavingsImportCreateInput
  ): Promise<{ jobId: string }> {
    await this.checkHouseholdAccess(householdId, userId);

    const jobId = crypto.randomUUID();
    const now = nowIso();

    if (input.file) {
      const { data, mimeType, name } = input.file;
      const safeName = this.safeFileName(name);
      const fileKey = `savings-imports/${householdId}/${jobId}/${safeName}`;
      const contentHash = await this.sha256Hex(data);

      await this.env.REPORTS_BUCKET.put(fileKey, data, {
        httpMetadata: { contentType: mimeType },
      });

      await this.db
        .insert(savingsImportJobs)
        .values({
          id: jobId,
          household_id: householdId,
          status: 'uploaded',
          source_kind: input.sourceKind,
          file_key: fileKey,
          file_name: name,
          mime_type: mimeType,
          size_bytes: data.byteLength,
          content_hash: contentHash,
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .run();
    } else {
      const text = (input.text ?? '').trim();
      if (!text) {
        throw new ValidationError({ import: ['No text or file was provided for import.'] });
      }
      await this.db
        .insert(savingsImportJobs)
        .values({
          id: jobId,
          household_id: householdId,
          status: 'uploaded',
          source_kind: input.sourceKind,
          raw_text: text,
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .run();
    }

    return { jobId };
  }

  // ============ analyze ============

  async analyze(
    householdId: string,
    userId: string,
    jobId: string,
    scope: SavingsImportScope = 'all'
  ): Promise<SavingsImportDraft> {
    await this.checkHouseholdAccess(householdId, userId);
    const job = await this.loadJob(householdId, jobId);

    await this.setStatus(jobId, 'analyzing');

    // Bind inference to the acting user's own key (BYOK) for this request; the
    // read + structure steps below run through this.ai.
    this.ai = await this.aiFor(householdId, userId);

    // --- READ step: produce plain text to structure, by source kind. ---
    let textToStructure: string;
    try {
      textToStructure = await this.readDocumentText(job);
    } catch (err) {
      // A too-large document is a user-fixable error, not a parse failure.
      if (err instanceof SavingsImportError) {
        await this.fail(jobId, err.code);
        throw err;
      }
      // Bounded diagnostic — error type/message only (no source-doc content).
      console.error(
        '[savings-import] read failed:',
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      );
      await this.fail(jobId, ERR_PARSE_FAILED);
      throw new SavingsImportError(
        ERR_PARSE_FAILED,
        'We could not read that document. Try a clearer file or paste the numbers as text.'
      );
    }

    // --- STRUCTURE step: classify into the reviewable draft. ---
    const categoryNames = await this.getCategoryNames(householdId);
    const memberNames = await this.getMemberNames(householdId);
    const today = nowIso().slice(0, 10);

    let raw: SavingsImportDraft;
    try {
      // C-1 truncation contract: generateStructured / generateStructuredWithFallback
      // DISCARD stopReason and THROW (MalformedGenerateJSONError) on a real
      // max_tokens cutoff. We do NOT branch on stopReason — we catch the throw.
      raw = await generateStructuredWithFallback<SavingsImportDraft>(
        this.ai,
        this.env.AIHOUSEKEEPER_NUDGE_MODEL,
        this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
        {
          systemPrompt: SAVINGS_IMPORT_SYSTEM_PROMPT,
          userPrompt: buildSavingsImportUserPrompt({
            text: textToStructure,
            today,
            categoryNames,
            memberNames,
            scope,
          }),
          schema: SAVINGS_IMPORT_SCHEMA,
          maxTokens: 16384,
        }
      );
    } catch (err) {
      // Truncation / malformed tool_use / provider error → never persist
      // partial JSON. Bounded code only; no source-doc content logged.
      console.error(
        '[savings-import] structure failed:',
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      );
      await this.fail(jobId, ERR_PARSE_FAILED);
      throw new SavingsImportError(
        ERR_PARSE_FAILED,
        'The document was too large to extract in one pass — split the file or import fewer months, then try again.'
      );
    }

    // --- Post-structure structural Zod parse before persisting. ---
    const parsed = draftSchema.safeParse(raw);
    if (!parsed.success) {
      // Field paths only (no values) — safe to log.
      console.error(
        '[savings-import] draft parse failed at:',
        parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')).join(', ')
      );
      await this.fail(jobId, ERR_PARSE_FAILED);
      throw new SavingsImportError(
        ERR_PARSE_FAILED,
        'We could not make sense of that document. Try a clearer file or paste the numbers as text.'
      );
    }

    // Normalize dates to a valid YYYY-MM-DD (the commit route validates the
    // format) and drop obvious junk rows (no amount) before the user reviews.
    const validYMD = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today);
    // Defence-in-depth: even with the prompt guidance, the model can occasionally
    // echo a spreadsheet's total/subtotal line as its own row (e.g. a "TOTAL"
    // footer). Drop rows whose label is a bare aggregate so an inflated summary
    // amount never lands in the reviewable draft. Kept deliberately narrow (label
    // is ONLY the aggregate word) so real payments like "Total Wireless" survive.
    const isSummaryRow = (label: string) =>
      /^\s*(sub[-\s]?total|grand[-\s]?total|totals?|sum)\s*[:.-]?\s*$/i.test(label);
    const validPeriod = (p: string) => /^\d{4}-\d{2}$/.test(p);
    const draft: SavingsImportDraft = {
      income: parsed.data.income
        .filter((r) => r.amount_cents > 0 && !isSummaryRow(r.label))
        .map((r) => ({ ...r, income_date: validYMD(r.income_date) })),
      spending: parsed.data.spending
        .filter((r) => r.amount_cents > 0 && !isSummaryRow(r.label))
        .map((r) => ({ ...r, spending_date: validYMD(r.spending_date) })),
      recurringPayments: parsed.data.recurringPayments.filter(
        (r) => r.amount_cents > 0 && !isSummaryRow(r.label)
      ),
      // Yearly-grid cells: keep only well-formed months with a real column
      // header and amount; the Savings/net column is never emitted by the model.
      monthlyGridSpending: parsed.data.monthlyGridSpending.filter(
        (r) =>
          r.amount_cents > 0 &&
          validPeriod(r.period) &&
          r.category_name.trim().length > 0 &&
          !isSummaryRow(r.category_name)
      ),
    };

    await this.db
      .update(savingsImportJobs)
      .set({
        status: 'ready',
        draft_json: JSON.stringify(draft),
        error: null,
        updated_at: nowIso(),
      })
      .where(eq(savingsImportJobs.id, jobId))
      .run();

    console.log(
      `[savings-import] job=${jobId} status=ready readModel=${this.env.AIHOUSEKEEPER_FALLBACK_MODEL} structureModel=${this.env.AIHOUSEKEEPER_NUDGE_MODEL}`
    );

    return draft;
  }

  /**
   * READ step: turn the job's source into plain text to structure.
   * - CSV: parsed deterministically in the Worker (no model call).
   * - plain text / paste: passed straight through.
   * - images: server-side downsample, then provider.generate() image block (Sonnet read).
   * - PDF: reject >100 pages up front; else read via provider (Sonnet).
   */
  private async readDocumentText(job: SavingsImportJob): Promise<string> {
    // Text / paste jobs carry raw_text and no file.
    if (!job.file_key) {
      const text = (job.raw_text ?? '').trim();
      if (!text) {
        throw new SavingsImportError(
          ERR_PARSE_FAILED,
          'There was no text to import.'
        );
      }
      return text;
    }

    const obj = await this.env.REPORTS_BUCKET.get(job.file_key);
    if (!obj) {
      throw new SavingsImportError(ERR_PARSE_FAILED, 'The uploaded file was not found.');
    }
    const data = await obj.arrayBuffer();
    const mime = (job.mime_type ?? '').toLowerCase();

    // CSV → deterministic parse in the Worker; never sent to the model.
    if (mime === 'text/csv') {
      return this.parseCsvToText(new TextDecoder().decode(data));
    }

    // plain text uploaded as a file.
    if (mime === 'text/plain') {
      return new TextDecoder().decode(data).trim();
    }

    // PDF → page guard, then provider read (Sonnet).
    if (mime === 'application/pdf') {
      const pages = this.countPdfPages(data);
      if (pages > MAX_PDF_PAGES) {
        throw new SavingsImportError(
          ERR_TOO_LARGE,
          `That PDF has ${pages} pages. Split it into ≤${MAX_PDF_PAGES}-page sections and import each.`
        );
      }
      return this.readPdfViaProvider(data);
    }

    // Images → downsample, then provider read (Sonnet).
    if (IMAGE_MIMES.has(mime)) {
      const { base64, mediaType } = await this.downsampleImage(data, mime);
      return this.readImageViaProvider(base64, mediaType);
    }

    throw new SavingsImportError(
      ERR_PARSE_FAILED,
      'That file type is not supported for import.'
    );
  }

  /** Read a PDF through the provider abstraction (Sonnet). No direct SDK. */
  private async readPdfViaProvider(data: ArrayBuffer): Promise<string> {
    const base64 = this.arrayBufferToBase64(data);
    // A `document` content block is valid to the underlying Messages API; the
    // provider's generate() casts message content at the SDK boundary. We stay
    // on the provider abstraction (no `@anthropic-ai/sdk` import here).
    // The `document` block is valid to the underlying Messages API but is not
    // part of the GenerateMessage content union; cast the content array at this
    // single boundary rather than editing provider.ts. The provider's generate()
    // already casts message content once more at the SDK boundary.
    const pdfMessage: GenerateMessage = {
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: EXTRACT_SAVINGS_DOCUMENT_USER_PROMPT },
      ] as unknown as GenerateMessage['content'],
    };
    const result = await this.ai.generate({
      model: this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
      systemPrompt: EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT,
      maxTokens: 8192,
      messages: [pdfMessage],
    });
    return this.textFromGenerate(result);
  }

  /** Read a (downsampled) image through the provider abstraction (Sonnet). */
  private async readImageViaProvider(
    base64: string,
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  ): Promise<string> {
    const result = await this.ai.generate({
      model: this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
      systemPrompt: EXTRACT_SAVINGS_DOCUMENT_SYSTEM_PROMPT,
      maxTokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: EXTRACT_SAVINGS_DOCUMENT_USER_PROMPT },
          ],
        },
      ],
    });
    return this.textFromGenerate(result);
  }

  private textFromGenerate(result: GenerateResult): string {
    const parts: string[] = [];
    for (const block of result.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    return parts.join('\n').trim();
  }

  // ============ commit ============

  async commit(
    householdId: string,
    userId: string,
    jobId: string,
    selections: SavingsImportDraft
  ): Promise<SavingsImportCommitResult> {
    await this.checkHouseholdAccess(householdId, userId);
    const job = await this.loadJob(householdId, jobId);

    // Idempotent: a re-commit is a no-op that returns the prior counts.
    if (job.status === 'committed') {
      return this.countCommitted(householdId, jobId);
    }

    const now = nowIso();

    // Resolve member names → household_members.id (mirror resolveAssignee).
    const memberResolver = await this.buildMemberResolver(householdId);
    // Resolve / create category names → savings_categories.id.
    const categoryResolver = await this.buildCategoryResolver(householdId);

    let incomeCount = 0;
    let spendingCount = 0;
    let recurringCount = 0;

    // ALL income → savings_income_entries (recurring is FLAGGED here but NOT
    // written as a template — template setup is Phase 4). Deterministic id
    // (jobId, entity, index) + onConflictDoNothing so a double-tap can't
    // double-insert.
    for (let i = 0; i < selections.income.length; i++) {
      const row = selections.income[i];
      const res = await this.db
        .insert(savingsIncomeEntries)
        .values({
          id: this.deterministicId(jobId, 'income', i),
          household_id: householdId,
          member_id: memberResolver(row.member_name),
          source_type: row.source_type,
          label: row.label,
          amount_cents: row.amount_cents,
          income_date: row.income_date,
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run();
      if (this.rowWritten(res)) incomeCount++;
    }

    for (let i = 0; i < selections.spending.length; i++) {
      const row = selections.spending[i];
      const res = await this.db
        .insert(savingsSpendingEntries)
        .values({
          id: this.deterministicId(jobId, 'spending', i),
          household_id: householdId,
          category_id: await categoryResolver(row.category_name),
          label: row.label,
          amount_cents: row.amount_cents,
          spending_date: row.spending_date,
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run();
      if (this.rowWritten(res)) spendingCount++;
    }

    for (let i = 0; i < selections.recurringPayments.length; i++) {
      const row = selections.recurringPayments[i];
      const res = await this.db
        .insert(savingsRecurringPayments)
        .values({
          id: this.deterministicId(jobId, 'recurring', i),
          household_id: householdId,
          category_id: await categoryResolver(row.category_name),
          label: row.label,
          amount_cents: row.amount_cents,
          day_of_month: row.day_of_month,
          group_label: row.group_label,
          is_essential: row.is_essential,
          source: 'ai_import',
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run();
      if (this.rowWritten(res)) recurringCount++;
    }

    await this.db
      .update(savingsImportJobs)
      .set({ status: 'committed', updated_at: nowIso() })
      .where(eq(savingsImportJobs.id, jobId))
      .run();

    // A14 default — financial PII must not accumulate. Delete the R2 object on
    // a successful commit.
    if (job.file_key) {
      await this.env.REPORTS_BUCKET.delete(job.file_key);
    }

    console.log(
      `[savings-import] job=${jobId} status=committed income=${incomeCount} spending=${spendingCount} recurring=${recurringCount}`
    );

    return {
      income: incomeCount,
      spending: spendingCount,
      recurringPayments: recurringCount,
    };
  }

  // ============ commitHistory (previous-years / yearly grid) ============

  /**
   * Commit a previous-years import. Unlike commit(), a yearly grid materialises
   * into the tables the net/history/compare math actually reads:
   *   • income  → savings_income_entries (source='history_import')
   *   • each month × spending column → budget `expenses` (source='history_import')
   * `net` is DERIVED (income − spendings), never written.
   *
   * Idempotent + replace: rows are stamped import_batch_id = jobId and, before
   * insert, any prior 'history_import' rows for the touched years are deleted so
   * a re-import corrects rather than stacks. Manual rows are never touched.
   */
  async commitHistory(
    householdId: string,
    userId: string,
    jobId: string,
    selections: SavingsHistorySelections
  ): Promise<SavingsHistoryCommitResult> {
    await this.checkHouseholdAccess(householdId, userId);
    const job = await this.loadJob(householdId, jobId);

    // Idempotent: a re-commit of the same job is a no-op that returns prior counts.
    if (job.status === 'committed') {
      return this.countHistoryCommitted(householdId, jobId);
    }

    const now = nowIso();

    // Years touched by this import (from income dates + grid periods).
    const years = new Set<number>();
    for (const r of selections.income) {
      const y = Number(r.income_date.slice(0, 4));
      if (Number.isInteger(y)) years.add(y);
    }
    for (const r of selections.monthlyGridSpending) {
      const y = Number(r.period.slice(0, 4));
      if (Number.isInteger(y)) years.add(y);
    }

    // Replace: clear prior history_import rows for these years so a re-import
    // (a new job for the same year) corrects rather than stacks. Manual rows
    // (source='manual') are never matched.
    for (const y of years) {
      const yStr = String(y);
      await this.db
        .delete(expenses)
        .where(
          and(
            eq(expenses.household_id, householdId),
            eq(expenses.source, 'history_import'),
            sql`substr(${expenses.expense_date}, 1, 4) = ${yStr}`
          )
        )
        .run();
      await this.db
        .delete(savingsIncomeEntries)
        .where(
          and(
            eq(savingsIncomeEntries.household_id, householdId),
            eq(savingsIncomeEntries.source, 'history_import'),
            sql`substr(${savingsIncomeEntries.income_date}, 1, 4) = ${yStr}`
          )
        )
        .run();
    }

    const categoryResolver = await this.buildBudgetCategoryResolver(householdId);

    let incomeCount = 0;
    for (let i = 0; i < selections.income.length; i++) {
      const row = selections.income[i];
      const res = await this.db
        .insert(savingsIncomeEntries)
        .values({
          id: this.deterministicId(jobId, 'hincome', i),
          household_id: householdId,
          member_id: null,
          source_type: row.source_type,
          label: row.label || 'Income',
          amount_cents: row.amount_cents,
          income_date: row.income_date,
          period: row.income_date.slice(0, 7),
          source: 'history_import',
          import_batch_id: jobId,
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run();
      if (this.rowWritten(res)) incomeCount++;
    }

    let spendingCount = 0;
    for (let i = 0; i < selections.monthlyGridSpending.length; i++) {
      const row = selections.monthlyGridSpending[i];
      const res = await this.db
        .insert(expenses)
        .values({
          id: this.deterministicId(jobId, 'grid', i),
          household_id: householdId,
          category_id: await categoryResolver(row.category_name),
          title: row.category_name,
          amount: row.amount_cents,
          expense_date: `${row.period}-01`,
          source: 'history_import',
          import_batch_id: jobId,
          created_by: userId,
          created_at: now,
        })
        .onConflictDoNothing()
        .run();
      if (this.rowWritten(res)) spendingCount++;
    }

    await this.db
      .update(savingsImportJobs)
      .set({ status: 'committed', updated_at: nowIso() })
      .where(eq(savingsImportJobs.id, jobId))
      .run();

    if (job.file_key) {
      await this.env.REPORTS_BUCKET.delete(job.file_key);
    }

    const sortedYears = Array.from(years).sort((a, b) => a - b);
    console.log(
      `[savings-import] job=${jobId} status=committed(history) income=${incomeCount} spending=${spendingCount} years=${sortedYears.join(',')}`
    );

    return { income: incomeCount, spending: spendingCount, years: sortedYears };
  }

  /**
   * Undo a previous-years import by its batch id (= the import job id). Deletes
   * only rows stamped source='history_import' + import_batch_id, so manual rows
   * are never removed.
   */
  async undoHistoryImport(
    householdId: string,
    userId: string,
    batchId: string
  ): Promise<{ income: number; spending: number }> {
    await this.checkHouseholdAccess(householdId, userId);

    const expDel = await this.db
      .delete(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          eq(expenses.source, 'history_import'),
          eq(expenses.import_batch_id, batchId)
        )
      )
      .run();
    const incDel = await this.db
      .delete(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          eq(savingsIncomeEntries.source, 'history_import'),
          eq(savingsIncomeEntries.import_batch_id, batchId)
        )
      )
      .run();

    const changes = (r: unknown): number =>
      (r as { meta?: { changes?: number } })?.meta?.changes ?? 0;
    return { spending: changes(expDel), income: changes(incDel) };
  }

  /** Count previously-committed history rows for a job (idempotent re-commit). */
  private async countHistoryCommitted(
    householdId: string,
    jobId: string
  ): Promise<SavingsHistoryCommitResult> {
    const incomeRows = await this.db
      .select({ d: savingsIncomeEntries.income_date })
      .from(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          eq(savingsIncomeEntries.import_batch_id, jobId)
        )
      )
      .all();
    const expenseRows = await this.db
      .select({ d: expenses.expense_date })
      .from(expenses)
      .where(and(eq(expenses.household_id, householdId), eq(expenses.import_batch_id, jobId)))
      .all();

    const years = new Set<number>();
    for (const r of incomeRows) years.add(Number(r.d.slice(0, 4)));
    for (const r of expenseRows) years.add(Number(r.d.slice(0, 4)));
    return {
      income: incomeRows.length,
      spending: expenseRows.length,
      years: Array.from(years)
        .filter((y) => Number.isInteger(y))
        .sort((a, b) => a - b),
    };
  }

  /**
   * Build a budget-category resolver for history imports: match the sheet's
   * column header against existing budget_categories (case-insensitive), fall
   * back to a small alias map onto the household's defaults ("Food"→Groceries,
   * "Monthly payments"→Rent & Mortgage), and lazily create a category named
   * exactly as the header when nothing matches. Mirrors buildCategoryResolver
   * but targets budget_categories (the table the net/history math reads).
   */
  private async buildBudgetCategoryResolver(
    householdId: string
  ): Promise<(name: string) => Promise<string | null>> {
    const rows = await this.db
      .select({ id: budgetCategories.id, name: budgetCategories.name })
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .all();
    const byName = new Map<string, string>();
    for (const r of rows) byName.set(r.name.trim().toLowerCase(), r.id);

    const ALIASES: Record<string, string[]> = {
      food: ['groceries'],
      groceries: ['food'],
      'monthly payments': ['rent & mortgage', 'rent', 'mortgage'],
    };

    return async (name: string): Promise<string | null> => {
      const raw = name.trim();
      if (!raw) return null;
      const key = raw.toLowerCase();
      const direct = byName.get(key);
      if (direct) return direct;
      for (const alias of ALIASES[key] ?? []) {
        const hit = byName.get(alias);
        if (hit) return hit;
      }
      const id = crypto.randomUUID();
      await this.db
        .insert(budgetCategories)
        .values({ id, household_id: householdId, name: raw })
        .run();
      byName.set(key, id);
      return id;
    };
  }

  // ============ getJob / deleteJob ============

  async getJob(
    householdId: string,
    userId: string,
    jobId: string
  ): Promise<{ job: SavingsImportJob; draft: SavingsImportDraft | null }> {
    await this.checkHouseholdAccess(householdId, userId);
    const job = await this.loadJob(householdId, jobId);
    let draft: SavingsImportDraft | null = null;
    if (job.draft_json) {
      try {
        draft = JSON.parse(job.draft_json) as SavingsImportDraft;
      } catch {
        draft = null;
      }
    }
    return { job, draft };
  }

  async deleteJob(householdId: string, userId: string, jobId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    const job = await this.loadJob(householdId, jobId);
    if (job.file_key) {
      await this.env.REPORTS_BUCKET.delete(job.file_key);
    }
    await this.db.delete(savingsImportJobs).where(eq(savingsImportJobs.id, jobId)).run();
  }

  // ============ helpers ============

  private async setStatus(jobId: string, status: string): Promise<void> {
    await this.db
      .update(savingsImportJobs)
      .set({ status, updated_at: nowIso() })
      .where(eq(savingsImportJobs.id, jobId))
      .run();
  }

  /** Set status='failed' with a bounded error code (never source content). */
  private async fail(jobId: string, code: string): Promise<void> {
    await this.db
      .update(savingsImportJobs)
      .set({ status: 'failed', error: code, updated_at: nowIso() })
      .where(eq(savingsImportJobs.id, jobId))
      .run();
    console.log(`[savings-import] job=${jobId} status=failed error=${code}`);
  }

  private async getCategoryNames(householdId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: savingsCategories.name })
      .from(savingsCategories)
      .where(eq(savingsCategories.household_id, householdId))
      .all();
    return rows.map((r) => r.name);
  }

  private async getMemberNames(householdId: string): Promise<string[]> {
    const rows = await this.db
      .select({ displayName: users.display_name, email: users.email })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.user_id))
      .where(eq(householdMembers.household_id, householdId))
      .all();
    return rows
      .map((r) => r.displayName || this.emailLocalPart(r.email))
      .filter((n): n is string => Boolean(n));
  }

  /**
   * Build a member-name → household_members.id resolver. Mirrors resolveAssignee:
   * exact (case-insensitive) display_name match first, then email local-part,
   * then null.
   */
  private async buildMemberResolver(
    householdId: string
  ): Promise<(name: string | null) => string | null> {
    const rows = await this.db
      .select({
        memberId: householdMembers.id,
        displayName: users.display_name,
        email: users.email,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.user_id))
      .where(eq(householdMembers.household_id, householdId))
      .all();

    const byDisplay = new Map<string, string>();
    const byEmailLocal = new Map<string, string>();
    for (const r of rows) {
      if (r.displayName) byDisplay.set(r.displayName.trim().toLowerCase(), r.memberId);
      const local = this.emailLocalPart(r.email);
      if (local) byEmailLocal.set(local.toLowerCase(), r.memberId);
    }

    return (name: string | null): string | null => {
      if (!name) return null;
      const wanted = name.trim().toLowerCase();
      if (!wanted) return null;
      return byDisplay.get(wanted) ?? byEmailLocal.get(wanted) ?? null;
    };
  }

  /**
   * Build a category-name → savings_categories.id resolver that lazily creates
   * a category row when the name is new. Case-insensitive match against
   * existing categories.
   */
  private async buildCategoryResolver(
    householdId: string
  ): Promise<(name: string | null) => Promise<string | null>> {
    const rows = await this.db
      .select({ id: savingsCategories.id, name: savingsCategories.name })
      .from(savingsCategories)
      .where(eq(savingsCategories.household_id, householdId))
      .all();
    const byName = new Map<string, string>();
    for (const r of rows) byName.set(r.name.trim().toLowerCase(), r.id);

    return async (name: string | null): Promise<string | null> => {
      if (!name || !name.trim()) return null;
      const key = name.trim().toLowerCase();
      const existing = byName.get(key);
      if (existing) return existing;
      const id = crypto.randomUUID();
      await this.db
        .insert(savingsCategories)
        .values({ id, household_id: householdId, name: name.trim() })
        .run();
      byName.set(key, id);
      return id;
    };
  }

  /**
   * Count committed rows for a job by its deterministic id namespace. Used for
   * the idempotent re-commit no-op so a double-tap gets the same counts back.
   * Deterministic ids are `imp_{jobId}_{entity}_{index}`.
   */
  private async countCommitted(
    householdId: string,
    jobId: string
  ): Promise<SavingsImportCommitResult> {
    const incomeRows = await this.db
      .select({ id: savingsIncomeEntries.id })
      .from(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          like(savingsIncomeEntries.id, `imp_${jobId}_income_%`)
        )
      )
      .all();
    const spendingRows = await this.db
      .select({ id: savingsSpendingEntries.id })
      .from(savingsSpendingEntries)
      .where(
        and(
          eq(savingsSpendingEntries.household_id, householdId),
          like(savingsSpendingEntries.id, `imp_${jobId}_spending_%`)
        )
      )
      .all();
    const recurringRows = await this.db
      .select({ id: savingsRecurringPayments.id })
      .from(savingsRecurringPayments)
      .where(
        and(
          eq(savingsRecurringPayments.household_id, householdId),
          like(savingsRecurringPayments.id, `imp_${jobId}_recurring_%`)
        )
      )
      .all();
    return {
      income: incomeRows.length,
      spending: spendingRows.length,
      recurringPayments: recurringRows.length,
    };
  }

  /** Deterministic, collision-free row id for idempotent commits. */
  private deterministicId(jobId: string, entity: string, index: number): string {
    return `imp_${jobId}_${entity}_${index}`;
  }

  /** True when an INSERT ... onConflictDoNothing actually wrote a row. */
  private rowWritten(res: { meta?: { changes?: number } } | unknown): boolean {
    const changes = (res as { meta?: { changes?: number } })?.meta?.changes;
    // D1 reports `changes`; when undefined (older bindings) assume written.
    return changes === undefined ? true : changes > 0;
  }

  private emailLocalPart(email: string | null | undefined): string | null {
    if (!email) return null;
    const at = email.indexOf('@');
    const local = at === -1 ? email : email.slice(0, at);
    return local.trim() || null;
  }

  private safeFileName(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
    return cleaned.slice(0, 128) || 'upload';
  }

  private async sha256Hex(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /**
   * Best-effort PDF page count via the `/Type /Page` object markers in the raw
   * bytes. Used only to reject clearly-oversized PDFs (>100 pages) before a
   * doomed model call; an undercount just defers the reject to Anthropic.
   */
  private countPdfPages(data: ArrayBuffer): number {
    const text = new TextDecoder('latin1').decode(new Uint8Array(data));
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    const count = matches ? matches.length : 0;
    return count > 0 ? count : 1;
  }

  /**
   * Server-side image downsample to ≤1568px longest side / ≤1.15MP. Uses the
   * Workers `createImageBitmap` + `OffscreenCanvas` when available; falls back
   * to passing the original bytes through (Anthropic re-scales server-side)
   * when the runtime lacks canvas support.
   */
  private async downsampleImage(
    data: ArrayBuffer,
    mime: string
  ): Promise<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }> {
    const mediaType = (
      IMAGE_MIMES.has(mime) ? mime : 'image/jpeg'
    ) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const g = globalThis as unknown as {
      createImageBitmap?: (b: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
      OffscreenCanvas?: new (w: number, h: number) => {
        getContext: (t: '2d') => { drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void } | null;
        convertToBlob: (opts?: { type?: string }) => Promise<Blob>;
      };
    };

    if (!g.createImageBitmap || !g.OffscreenCanvas) {
      return { base64: this.arrayBufferToBase64(data), mediaType };
    }

    try {
      const blob = new Blob([data], { type: mediaType });
      const bitmap = await g.createImageBitmap(blob);
      const { width, height } = bitmap;

      let scale = 1;
      const longest = Math.max(width, height);
      if (longest > IMAGE_MAX_DIMENSION) scale = IMAGE_MAX_DIMENSION / longest;
      const pixels = width * height * scale * scale;
      if (pixels > IMAGE_MAX_PIXELS) {
        scale *= Math.sqrt(IMAGE_MAX_PIXELS / pixels);
      }

      if (scale >= 1) {
        bitmap.close?.();
        return { base64: this.arrayBufferToBase64(data), mediaType };
      }

      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = new g.OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close?.();
        return { base64: this.arrayBufferToBase64(data), mediaType };
      }
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close?.();
      const outBlob = await canvas.convertToBlob({ type: mediaType });
      const outBuf = await outBlob.arrayBuffer();
      return { base64: this.arrayBufferToBase64(outBuf), mediaType };
    } catch {
      // Any canvas failure → pass the original through; Anthropic re-scales.
      return { base64: this.arrayBufferToBase64(data), mediaType };
    }
  }

  /**
   * Deterministic CSV → plain-text mapper. Header-detects, then emits one
   * "col: value" line per row so the structuring pass classifies semantics
   * only. CSV is never sent to the model as raw CSV.
   */
  private parseCsvToText(csv: string): string {
    const rows = this.parseCsvRows(csv);
    if (rows.length === 0) return '';

    // Header detection: first row is a header if it has no purely-numeric cells
    // AND at least one non-empty cell.
    const first = rows[0];
    const looksLikeHeader =
      first.some((c) => c.trim().length > 0) &&
      !first.some((c) => /^-?\$?\d[\d,]*\.?\d*$/.test(c.trim()) && c.trim().length > 0);

    const header = looksLikeHeader ? first.map((h) => h.trim()) : first.map((_, i) => `col${i + 1}`);
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;

    const lines: string[] = [];
    for (const row of dataRows) {
      if (row.every((c) => c.trim() === '')) continue;
      const parts: string[] = [];
      for (let i = 0; i < row.length; i++) {
        const key = header[i] ?? `col${i + 1}`;
        const val = row[i]?.trim() ?? '';
        if (val) parts.push(`${key}: ${val}`);
      }
      if (parts.length) lines.push(parts.join(' | '));
    }
    return lines.join('\n');
  }

  /** Minimal RFC-4180-ish CSV parser (handles quoted fields + embedded commas). */
  private parseCsvRows(csv: string): string[][] {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    const text = csv.replace(/\r\n?/g, '\n');

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
}
