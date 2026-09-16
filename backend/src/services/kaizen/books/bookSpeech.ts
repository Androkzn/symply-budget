/**
 * Book Comprehension — SPOKEN-answer grader (Phase 5).
 *
 * Sends a reader's raw audio answer inline to gemini-flash-latest (multimodal) and
 * runs the two-layer grader over it in one pass: transcription + meaning
 * (Layer 1) + form mistakes (Layer 2) + acoustic pronunciation + delivery.
 *
 * Ported technique-wise from `backend-language`'s `analyzePronunciationFromAudio`
 * (audio as `inlineData`), but reuses the Books schema + prompt so the FE gets
 * one consistent grading shape. Streams so long generations don't hit the
 * Worker ~90s first-byte timeout, makes ONE JSON-repair attempt before throwing,
 * and NEVER logs audio bytes or the transcript — a reader's voice is sensitive.
 */

import type { z } from 'zod';

import {
  BOOKS_GEMINI_MODEL,
  accumulateStreamText,
  booksStructuredGenerationConfig,
  createGeminiClient,
  generateText,
  getGeminiModel,
  type Part,
} from '../../../ai/gemini-sdk-client';

import { BooksAiError } from './gemini';
import { buildSpokenGradingPrompt, spokenGradingSchema } from './prompts';

export interface SpokenGradingArgs {
  prompt: string;
  idealAnswer?: string | null;
  rubric?: string[] | null;
  language: string;
  /** Vendor model id to run on (BYOK-selected gemini model, else the default). */
  model?: string;
}

/** Base64-encode an ArrayBuffer without Node's Buffer (Workers runtime). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function extractJson(text: string): string {
  let t = text.trim();
  if (t.startsWith('```json')) t = t.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  else if (t.startsWith('```')) t = t.replace(/```\n?/g, '');
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t.trim();
}

function tryValidate(text: string): z.infer<typeof spokenGradingSchema> | null {
  try {
    const parsed = JSON.parse(extractJson(text));
    const result = spokenGradingSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Grade a spoken answer from its raw audio bytes. Resolves to a schema-validated
 * grading object; throws BooksAiError on request/validation failure.
 */
export async function gradeSpokenAnswer(
  apiKey: string,
  audioBytes: ArrayBuffer,
  mimeType: string,
  args: SpokenGradingArgs,
): Promise<z.infer<typeof spokenGradingSchema>> {
  const client = createGeminiClient(apiKey);
  const model = getGeminiModel(client, {
    model: args.model ?? BOOKS_GEMINI_MODEL,
    generationConfig: booksStructuredGenerationConfig(0),
  });

  const request: Part[] = [
    { inlineData: { mimeType: mimeType || 'audio/m4a', data: arrayBufferToBase64(audioBytes) } },
    { text: buildSpokenGradingPrompt(args) },
  ];

  let responseText: string;
  try {
    responseText = await accumulateStreamText(model, request);
  } catch (err) {
    throw new BooksAiError(`Gemini spoken request failed: ${(err as Error)?.message ?? 'unknown'}`);
  }

  const first = tryValidate(responseText);
  if (first) return first;

  let repaired: string;
  try {
    const repairPrompt =
      'The following text was supposed to be a single valid JSON object but was malformed ' +
      'or incomplete. Return ONLY the corrected JSON object, no prose:\n\n' +
      responseText;
    repaired = await generateText(model, repairPrompt);
  } catch (err) {
    throw new BooksAiError(`Gemini spoken repair failed: ${(err as Error)?.message ?? 'unknown'}`);
  }

  const second = tryValidate(repaired);
  if (second) return second;
  throw new BooksAiError('Gemini spoken output did not match the required schema after repair.');
}
