/**
 * "Fill with AI" for loan tracking (Monthly Payments → car loans, BNPL plans,
 * personal loans). Reads ONE uploaded image or PDF of a loan/BNPL statement
 * or screenshot and returns a review draft for `LoanInfoSection`'s form —
 * nothing is persisted here; the user still hits Save.
 *
 * Mirrors `ReceiptScanService`'s structured tool_use pattern (forced "output"
 * tool + `generateWithFallback`'s automatic model fallback) rather than the
 * mortgage-statement service's regex-parsed-prose pattern — same reasons:
 * more robust structured extraction with fallback built in. Uses the shared
 * `resolveMediaType` sniffer (ai/media-type.ts) instead of rolling a third
 * local MIME sniffer.
 */
import type { ClaudeProvider } from '../ai/claude-provider';
import { generateWithFallback } from '../ai/fallback';
import { resolveMediaType, type SupportedMediaType } from '../ai/media-type';
import {
  SCAN_LOAN_STATEMENT_SCHEMA,
  SCAN_LOAN_STATEMENT_SYSTEM_PROMPT,
  buildScanLoanUserPrompt,
  type RawLoanExtraction,
} from '../ai/prompts/scan-loan-statement';
import type { AIProvider, GenerateMessage } from '../ai/provider';
import { createProviderAdapter } from '../ai/provider-factory';
import type { Env } from '../types';
import { ValidationError } from '../utils/errors';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';

/** Defends against a hallucinated/out-of-range day (the schema only guarantees `integer`). */
function clampDayOfMonth(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value)) return null;
  if (value < 1 || value > 31) return null;
  return value;
}

/**
 * The response contract the frontend builds its "Fill with AI" review step
 * against. `monthlyPaymentCents` / `dueDayOfMonth` pre-fill the RECURRING
 * PAYMENT's own "Monthly amount" / "Day of month" fields (one level up from
 * the loan-specific fields below them) — the host screen owns writing them
 * into that form; this service only reads them off the statement.
 * `remaining_balance_cents` / `progress_percent` stay internal-only (read by
 * the model as extra cross-check context but never surfaced); `amount_paid_cents`
 * passes straight through as a purely informational figure — the recurring
 * payment's own `amount_cents` stays the sole authoritative payment amount
 * once saved, and none of this feeds `start_date` or the amortization summary.
 */
export interface LoanExtractionDraft {
  principal_cents: number | null;
  monthlyPaymentCents: number | null;
  dueDayOfMonth: number | null;
  term_months: number | null;
  rate_type: 'zero' | 'fixed' | null;
  rate_bps: number | null;
  lender: string | null;
  notes: string | null;
  amountPaidCents: number | null;
  lowConfidenceFields: string[];
}

export class BudgetLoanExtractionService {
  private env: Env;
  private injectedAi?: AIProvider;

  /** `aiProvider` is injectable for tests; production call sites omit it. */
  constructor(env: Env, _d1: D1Database, aiProvider?: AIProvider) {
    this.env = env;
    this.injectedAi = aiProvider;
  }

  /**
   * Anthropic provider bound to the acting user: their own connected BYOK key
   * when present, otherwise the SimpleHouse-managed key. A test-injected
   * provider always wins. Same resolution as `ReceiptScanService.aiFor`.
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
          feature: 'loan_statement',
          householdId,
          userId: userId ?? null,
        }),
      },
    });
  }

  /**
   * Extract a loan draft from one uploaded file. `declaredMimeType` is the
   * client-declared MIME; the real bytes are sniffed via `resolveMediaType`
   * so a mislabeled file never reaches Anthropic mismatched.
   */
  async extractFromUpload(
    base64: string,
    declaredMimeType: SupportedMediaType,
    householdId: string,
    userId: string
  ): Promise<{ draft: LoanExtractionDraft }> {
    const mime = resolveMediaType(base64, declaredMimeType);
    const userPrompt = buildScanLoanUserPrompt();

    const raw: RawLoanExtraction =
      mime === 'application/pdf'
        ? await this.extractViaDocument(base64, householdId, userId, userPrompt)
        : await this.extractViaProvider(base64, mime, householdId, userId, userPrompt);

    return { draft: this.toDraft(raw) };
  }

  private toDraft(raw: RawLoanExtraction): LoanExtractionDraft {
    return {
      principal_cents: raw.principal_cents ?? null,
      monthlyPaymentCents: raw.monthly_payment_cents ?? null,
      dueDayOfMonth: clampDayOfMonth(raw.due_day_of_month),
      term_months: raw.term_months ?? null,
      rate_type: raw.rate_type ?? null,
      rate_bps: raw.rate_bps ?? null,
      lender: raw.lender ?? null,
      notes: raw.notes ?? null,
      amountPaidCents: raw.amount_paid_cents ?? null,
      lowConfidenceFields: Array.isArray(raw.low_confidence_fields) ? raw.low_confidence_fields : [],
    };
  }

  private async extractViaProvider(
    base64: string,
    mime: 'image/jpeg' | 'image/png' | 'image/webp',
    householdId: string,
    userId: string | null | undefined,
    userPrompt: string
  ): Promise<RawLoanExtraction> {
    const primaryModel = this.env.AIHOUSEKEEPER_BRIEFING_MODEL || this.env.AIHOUSEKEEPER_NUDGE_MODEL;
    const fallbackModel = this.env.AIHOUSEKEEPER_FALLBACK_MODEL;

    const messages: GenerateMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: userPrompt },
        ],
      },
    ];

    const ai = await this.aiFor(householdId, userId);
    const result = await generateWithFallback(ai, primaryModel, fallbackModel, {
      systemPrompt: SCAN_LOAN_STATEMENT_SYSTEM_PROMPT,
      messages,
      tools: [
        {
          name: 'output',
          description: 'Return the structured loan facts matching the JSON schema.',
          input_schema: SCAN_LOAN_STATEMENT_SCHEMA,
        },
      ],
      toolChoice: { type: 'tool', name: 'output' },
      maxTokens: 2048,
    });

    const toolBlock = result.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new ValidationError('Could not read the loan statement. Try a clearer photo.');
    }
    return toolBlock.input as RawLoanExtraction;
  }

  private async extractViaDocument(
    base64Data: string,
    householdId: string,
    userId: string | null | undefined,
    userPrompt: string
  ): Promise<RawLoanExtraction> {
    const provider = (await this.aiFor(householdId, userId)) as ClaudeProvider;
    const model =
      this.env.AIHOUSEKEEPER_BRIEFING_MODEL ||
      this.env.AIHOUSEKEEPER_NUDGE_MODEL ||
      'claude-sonnet-4-5-20250929';

    return provider.generateToolFromDocument<RawLoanExtraction>({
      systemPrompt: SCAN_LOAN_STATEMENT_SYSTEM_PROMPT,
      userText: userPrompt,
      documentBase64: base64Data,
      tool: {
        name: 'output',
        description: 'Return the structured loan facts matching the JSON schema.',
        input_schema: SCAN_LOAN_STATEMENT_SCHEMA,
      },
      model,
    });
  }
}
