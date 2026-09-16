/**
 * Book Comprehension — minimal Gemini structured-output client.
 *
 * Ported/adapted from `backend-language/src/services/kaizen/kaizenGemini.ts`
 * (the language app's interview client). A thin wrapper around gemini-flash-latest
 * (thinking disabled) that returns schema-validated JSON, streams so long
 * generations don't hit the Worker ~90s first-byte timeout, and makes ONE
 * JSON-repair attempt before throwing. Never logs raw prompts/responses —
 * a reader's book text and answers are sensitive.
 */

import type { z } from 'zod';

import {
  BOOKS_GEMINI_MODEL,
  accumulateStreamText,
  booksStructuredGenerationConfig,
  createGeminiClient,
  generateText,
  getGeminiModel,
  type GenerativeModel,
  type Part,
} from '../../../ai/gemini-sdk-client';

export { BOOKS_GEMINI_MODEL };

export class BooksAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BooksAiError';
  }
}

export class BooksGemini {
  private readonly model: GenerativeModel;

  constructor(apiKey: string, options?: { thinkingBudget?: number; model?: string }) {
    const client = createGeminiClient(apiKey);
    this.model = getGeminiModel(client, {
      model: options?.model ?? BOOKS_GEMINI_MODEL,
      generationConfig: booksStructuredGenerationConfig(options?.thinkingBudget ?? 0),
    });
  }

  private extractJson(text: string): string {
    let t = text.trim();
    if (t.startsWith('```json')) t = t.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    else if (t.startsWith('```')) t = t.replace(/```\n?/g, '');
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
    return t.trim();
  }

  private tryValidate<S extends z.ZodTypeAny>(
    text: string,
    schema: S,
  ): { ok: true; value: z.infer<S> } | { ok: false } {
    try {
      const parsed = JSON.parse(this.extractJson(text));
      const result = schema.safeParse(parsed);
      if (result.success) return { ok: true, value: result.data };
    } catch {
      /* fall through */
    }
    return { ok: false };
  }

  /**
   * Generate JSON that conforms to `schema`. On a parse/validation failure,
   * makes a single text-only repair attempt, then throws BooksAiError.
   */
  async generateStructured<S extends z.ZodTypeAny>(
    prompt: string,
    schema: S,
  ): Promise<z.infer<S>> {
    let responseText: string;
    try {
      responseText = await accumulateStreamText(this.model, prompt);
    } catch (err) {
      throw new BooksAiError(`Gemini request failed: ${(err as Error)?.message ?? 'unknown'}`);
    }

    const first = this.tryValidate(responseText, schema);
    if (first.ok) return first.value;

    let repaired: string;
    try {
      const repairPrompt =
        'The following text was supposed to be a single valid JSON object but was malformed ' +
        'or incomplete. Return ONLY the corrected JSON object, no prose:\n\n' +
        responseText;
      repaired = await generateText(this.model, repairPrompt);
    } catch (err) {
      throw new BooksAiError(`Gemini repair failed: ${(err as Error)?.message ?? 'unknown'}`);
    }

    const second = this.tryValidate(repaired, schema);
    if (second.ok) return second.value;
    throw new BooksAiError('Gemini output did not match the required schema after repair.');
  }

  /**
   * Like generateStructured, but grounded on an uploaded file (Gemini Files API
   * URI) — used in Phase 3 to read a chapter's PDF pages natively.
   */
  async generateStructuredWithFile<S extends z.ZodTypeAny>(
    prompt: string,
    file: { uri: string; mimeType: string },
    schema: S,
  ): Promise<z.infer<S>> {
    const request: Part[] = [
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      { text: prompt },
    ];

    let responseText: string;
    try {
      responseText = await accumulateStreamText(this.model, request);
    } catch (err) {
      throw new BooksAiError(`Gemini file request failed: ${(err as Error)?.message ?? 'unknown'}`);
    }
    const first = this.tryValidate(responseText, schema);
    if (first.ok) return first.value;

    let repaired: string;
    try {
      const repairPrompt =
        'The following text was supposed to be a single valid JSON object but was malformed ' +
        'or truncated. Return ONLY the corrected, complete JSON object, no prose:\n\n' +
        responseText;
      repaired = await generateText(this.model, repairPrompt);
    } catch (err) {
      throw new BooksAiError(`Gemini file repair failed: ${(err as Error)?.message ?? 'unknown'}`);
    }
    const second = this.tryValidate(repaired, schema);
    if (second.ok) return second.value;
    throw new BooksAiError('Gemini file output did not match the required schema after repair.');
  }
}
