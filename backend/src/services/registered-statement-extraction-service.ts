import {
  EXTRACT_REGISTERED_STATEMENT_SYSTEM_PROMPT,
  EXTRACT_REGISTERED_STATEMENT_USER_PROMPT,
  type ExtractedRegisteredStatement,
  type ExtractedRegisteredAccount,
  type ExtractedRegisteredAccountType,
} from '../ai/prompts/extract-registered-statement';
import {
  createAnthropicAdapterForUser,
  type ModelTokenUsage,
} from '../ai/provider-factory';
import type { Env } from '../types';

const VALID_TYPES: ExtractedRegisteredAccountType[] = ['tfsa', 'rrsp', 'fhsa', 'dpsp', 'rpp'];

/**
 * Registered Statement Extraction Service.
 * Uses Claude's native PDF/image support to turn an RRSP/TFSA/FHSA/DPSP/pension
 * statement (or NOA) into a reviewable draft of accounts + contributions. Mirrors
 * {@link PropertyTaxExtractionService}; nothing is persisted here — the Pension tab
 * shows the draft for review and commits it via the savings service.
 */
export class RegisteredStatementExtractionService {
  private env: Env;
  private userId?: string | null;
  private model: string;

  /** `userId` bills the acting user's own Anthropic key when connected (BYOK). */
  constructor(env: Env, userId?: string | null) {
    this.env = env;
    this.userId = userId;
    this.model = 'claude-sonnet-4-5-20250929';
  }

  private async provider() {
    return createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'registered_import', userId: this.userId },
      this.model
    );
  }

  private toUsage(usage: { input_tokens?: number; output_tokens?: number }): ModelTokenUsage {
    return {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    };
  }

  async extractFromBase64(
    base64Data: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' = 'application/pdf'
  ): Promise<{ data: ExtractedRegisteredStatement; usage: ModelTokenUsage }> {
    const ai = await this.provider();
    const { text, usage } = await ai.generateFromMediaContent({
      systemPrompt: EXTRACT_REGISTERED_STATEMENT_SYSTEM_PROMPT,
      userText: EXTRACT_REGISTERED_STATEMENT_USER_PROMPT,
      media: { base64: base64Data, mediaType },
      cacheSystem: true,
      model: this.model,
    });
    return { data: this.parseResponse(text), usage: this.toUsage(usage) };
  }

  /** Extract from plain text the user pasted (no file). */
  async extractFromText(
    text: string
  ): Promise<{ data: ExtractedRegisteredStatement; usage: ModelTokenUsage }> {
    const ai = await this.provider();
    const parsed = await ai.generateJSON<ExtractedRegisteredStatement>({
      systemPrompt: EXTRACT_REGISTERED_STATEMENT_SYSTEM_PROMPT,
      userPrompt: `${EXTRACT_REGISTERED_STATEMENT_USER_PROMPT}\n\nDocument:\n"""\n${text}\n"""`,
      model: this.model,
    });
    return {
      data: this.normalize(parsed),
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  private parseResponse(response: string): ExtractedRegisteredStatement {
    const json = this.extractJson(response);
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      console.error('[REGISTERED-EXTRACTION] Failed to parse response:', error);
      throw new Error('Failed to parse registered statement extraction response');
    }
    return this.normalize(parsed);
  }

  private extractJson(response: string): string {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const obj = response.match(/\{[\s\S]*\}/);
    return obj ? obj[0] : response;
  }

  private normalize(data: any): ExtractedRegisteredStatement {
    const rawAccounts: any[] = Array.isArray(data?.accounts) ? data.accounts : [];
    const accounts: ExtractedRegisteredAccount[] = rawAccounts.map((a) => {
      const type = typeof a?.account_type === 'string' ? a.account_type.toLowerCase() : null;
      const contributions = Array.isArray(a?.contributions) ? a.contributions : [];
      return {
        account_type: VALID_TYPES.includes(type) ? type : null,
        institution: this.str(a?.institution),
        is_employer_plan: a?.is_employer_plan === true,
        employer_name: this.str(a?.employer_name),
        balance: this.num(a?.balance),
        reported_room: this.num(a?.reported_room),
        contributions: contributions
          .map((cx: any) => ({
            date: this.date(cx?.date),
            amount: this.num(cx?.amount),
            contributor: cx?.contributor === 'employer' ? 'employer' : 'self',
          }))
          .filter((cx: any) => cx.amount != null && cx.amount > 0),
      };
    });

    return {
      accounts,
      confidence: typeof data?.confidence === 'number' ? data.confidence : 0.5,
      rawText: typeof data?.rawText === 'string' ? data.rawText : '',
    };
  }

  private str(v: any): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  }

  private num(v: any): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const parsed = parseFloat(v.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private date(v: any): string | null {
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }
}
