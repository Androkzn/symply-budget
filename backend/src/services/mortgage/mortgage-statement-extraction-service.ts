import {
  EXTRACT_MORTGAGE_STATEMENT_SYSTEM_PROMPT,
  EXTRACT_MORTGAGE_STATEMENT_USER_PROMPT,
  buildMortgageStatementUserPrompt,
} from '../../ai/prompts/extract-mortgage-statement';
import { createAnthropicAdapterForUser, type ModelTokenUsage } from '../../ai/provider-factory';
import type { Env } from '../../types';

import { normalizeMortgageDraft, type RawMortgageStatement } from './statement-normalize';

export type MortgageStatementMediaType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

/**
 * Mortgage statement extraction — turns a PDF/image (or pasted text) into a SAFE,
 * reviewable draft via Claude's native document support. Mirrors
 * {@link RegisteredStatementExtractionService}. Nothing is persisted: the FE shows
 * the draft for review and commits it via the mortgage statement route. All PII
 * minimization runs through `normalizeMortgageDraft` (deterministic), so the draft
 * never carries a full account number or borrower name.
 */
export class MortgageStatementExtractionService {
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
      { feature: 'mortgage_import', userId: this.userId },
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
    mediaType: MortgageStatementMediaType = 'application/pdf'
  ): Promise<{ data: RawMortgageStatement; usage: ModelTokenUsage }> {
    const ai = await this.provider();
    const { text, usage } = await ai.generateFromMediaContent({
      systemPrompt: EXTRACT_MORTGAGE_STATEMENT_SYSTEM_PROMPT,
      userText: EXTRACT_MORTGAGE_STATEMENT_USER_PROMPT,
      media: { base64: base64Data, mediaType },
      cacheSystem: true,
      model: this.model,
    });
    return { data: this.parseResponse(text), usage: this.toUsage(usage) };
  }

  async extractFromText(text: string): Promise<{ data: RawMortgageStatement; usage: ModelTokenUsage }> {
    const ai = await this.provider();
    const parsed = await ai.generateJSON<Record<string, unknown>>({
      systemPrompt: EXTRACT_MORTGAGE_STATEMENT_SYSTEM_PROMPT,
      userPrompt: buildMortgageStatementUserPrompt(text),
      model: this.model,
    });
    // Deterministic PII scrub + allowlist regardless of what the model returned.
    return { data: normalizeMortgageDraft(parsed), usage: { input_tokens: 0, output_tokens: 0 } };
  }

  private parseResponse(response: string): RawMortgageStatement {
    const json = this.extractJson(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Failed to parse mortgage statement extraction response');
    }
    return normalizeMortgageDraft(parsed);
  }

  private extractJson(response: string): string {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const obj = response.match(/\{[\s\S]*\}/);
    return obj ? obj[0] : response;
  }
}
