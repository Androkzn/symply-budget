/**
 * Scrub secrets from log payloads before console/analytics emission.
 * Phase 1 precondition for any provider work touching keys (§7.1).
 */

const SENSITIVE_KEY =
  /^(api[_-]?key|apikey|authorization|x-api-key|key|token|secret|password|ciphertext|iv)$/i;

const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const ANTHROPIC_KEY_RE = /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g;
const OPENAI_KEY_RE = /\bsk-(?!ant-)[A-Za-z0-9_-]{10,}\b/g;
// Google issues two key formats: legacy `AIza…` and the newer AI Studio `AQ.…` keys.
const GOOGLE_KEY_RE = /\b(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_.-]{20,})/g;

function scrubString(value: string): string {
  return value
    .replace(BEARER_RE, '$1 [REDACTED]')
    .replace(ANTHROPIC_KEY_RE, '[REDACTED_ANTHROPIC_KEY]')
    .replace(OPENAI_KEY_RE, '[REDACTED_OPENAI_KEY]')
    .replace(GOOGLE_KEY_RE, '[REDACTED_GOOGLE_KEY]');
}

/**
 * Deep-clone and redact sensitive fields / substrings.
 * Never throws — returns a safe placeholder on failure.
 */
export function scrubForLogs(input: unknown, depth = 0): unknown {
  try {
    if (depth > 8) return '[MAX_DEPTH]';
    if (input == null) return input;
    if (typeof input === 'string') return scrubString(input);
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (Array.isArray(input)) {
      return input.map((item) => scrubForLogs(item, depth + 1));
    }
    // Error.message / stack are non-enumerable — extract explicitly (B7).
    if (input instanceof Error) {
      return {
        name: input.name,
        message: scrubString(input.message),
        stack: input.stack ? scrubString(input.stack) : undefined,
      };
    }
    if (typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (SENSITIVE_KEY.test(key)) {
          out[key] = '[REDACTED]';
        } else {
          out[key] = scrubForLogs(value, depth + 1);
        }
      }
      return out;
    }
    return String(input);
  } catch {
    return '[SCRUB_FAILED]';
  }
}

/** console.error wrapper that scrubs arguments. */
export function safeErrorLog(prefix: string, ...args: unknown[]): void {
  console.error(prefix, ...args.map((a) => scrubForLogs(a)));
}
