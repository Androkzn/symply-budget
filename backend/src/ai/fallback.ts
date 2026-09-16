/**
 * Aihousekeeper model-fallback wrapper — plan §B10.
 *
 * Wraps any AIProvider method, trying `primaryModel` first. If the call
 * fails with an Anthropic `model_not_found | invalid_request_error |
 * not_entitled` shape, retries exactly once with `fallbackModel`. Any other
 * error propagates immediately.
 *
 * Emits a counter to Analytics Engine (Stream I owns the real binding).
 * For now we log with a grep-prefix so Stream I can swap in the AE write.
 */

import type {
  AIProvider,
  GenerateArgs,
  GenerateResult,
  GenerateJSONArgs,
} from './provider';

export class MalformedGenerateJSONError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedGenerateJSONError';
  }
}

/**
 * Error-shape discriminator: the Anthropic SDK surfaces
 * `model_not_found | invalid_request_error | not_entitled` via either:
 *   - an `err.type` string (nested error payload), or
 *   - an APIError subclass (check `err.status === 404` for model-not-found)
 *
 * We match loosely because the SDK's typed discriminators are not stable
 * across minor version bumps.
 */
function isModelFallbackEligible(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as {
    type?: string;
    status?: number;
    error?: { type?: string };
    message?: string;
  };
  const typeTag = anyErr.type ?? anyErr.error?.type ?? '';
  if (
    typeTag === 'model_not_found' ||
    typeTag === 'invalid_request_error' ||
    typeTag === 'not_entitled'
  ) {
    return true;
  }
  // Fallback heuristic: HTTP 404 on a messages.create implies model not found.
  if (anyErr.status === 404) return true;
  // Text-match guard for providers that bury the code in `message`.
  const msg = typeof anyErr.message === 'string' ? anyErr.message : '';
  if (
    msg.includes('model_not_found') ||
    msg.includes('not_entitled') ||
    msg.includes('invalid model')
  ) {
    return true;
  }
  return false;
}

/**
 * Stub for the Analytics Engine counter. Stream I replaces the log line
 * with a real `env.ANALYTICS_ENGINE.writeDataPoint(...)` call; for now we
 * emit a grep-prefixed log so observability hooks can see the signal in
 * worker logs.
 *
 * GREP-PREFIX for Stream I: `[AIHOUSEKEEPER_METRIC aihousekeeper_model_fallback_triggered]`
 */
function emitFallbackMetric(primaryModel: string, fallbackModel: string, method: string): void {
  console.log(
    `[AIHOUSEKEEPER_METRIC aihousekeeper_model_fallback_triggered] method=${method} primary=${primaryModel} fallback=${fallbackModel}`
  );
}

// ---------- dispatchers ----------

/**
 * Type-narrow wrapper for Aihousekeeper's two entry points into the provider. We
 * avoid the generic `keyof AIProvider` shape because TS can't infer the
 * right return type for union-valued method keys at the call site.
 */
export async function generateWithFallback(
  provider: AIProvider,
  primaryModel: string,
  fallbackModel: string,
  args: Omit<GenerateArgs, 'model'>
): Promise<GenerateResult> {
  try {
    return await provider.generate({ ...args, model: primaryModel });
  } catch (err) {
    if (!isModelFallbackEligible(err)) throw err;
    emitFallbackMetric(primaryModel, fallbackModel, 'generate');
    return await provider.generate({ ...args, model: fallbackModel });
  }
}

export async function generateStructuredWithFallback<T>(
  provider: AIProvider,
  primaryModel: string,
  fallbackModel: string,
  args: Omit<GenerateJSONArgs, 'model'>
): Promise<T> {
  try {
    return await provider.generateStructured<T>({ ...args, model: primaryModel });
  } catch (err) {
    if (!isModelFallbackEligible(err)) throw err;
    emitFallbackMetric(primaryModel, fallbackModel, 'generateStructured');
    return await provider.generateStructured<T>({ ...args, model: fallbackModel });
  }
}
