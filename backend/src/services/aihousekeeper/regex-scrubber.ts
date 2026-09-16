/**
 * Aihousekeeper regex PII scrubber — plan §B14.
 *
 * Fallback redaction path when the Haiku redaction call fails or when
 * `aihousekeeper_memory_ai_redaction_enabled` is set to `'false'` in CONFIG_KV.
 *
 * Patterns covered (intentionally conservative — false-positives are cheap;
 * a leaked SSN is not):
 *   - North-American phone numbers (with or without +1, dashes, parens, dots, spaces)
 *   - US SSN (###-##-####)
 *   - Credit-card-like 13-19 digit sequences (with optional separators)
 *   - Email addresses
 *
 * The function is idempotent: a scrubbed string passed back through produces
 * itself (the token `[redacted]` matches no pattern).
 *
 * Tests (Stream I): idempotency, SSN 123-45-6789 → [redacted], emails →
 * [redacted], non-matching text unchanged.
 */

export const REDACTED = '[redacted]';

// ---------- patterns ----------

// SSN before phone so `123-45-6789` isn't consumed by the phone regex first.
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

// Credit-card-like: 13–19 digits, optional separators (space or dash).
// Bounded by word boundaries to avoid matching inside longer digit strings.
const CC_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

// Phone: +1? optional, then (###) or ### then ### then ####. Tolerant of
// space/dash/dot separators. `\b` at the end to avoid eating trailing digits
// from unrelated sequences.
const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

// Email: standard RFC-ish pattern.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Replace PII patterns in `body` with the REDACTED sentinel.
 * Applied in order: email → SSN → credit card → phone.
 */
export function regexScrub(body: string): string {
  if (!body) return body;
  let out = body;
  out = out.replace(EMAIL_RE, REDACTED);
  out = out.replace(SSN_RE, REDACTED);
  out = out.replace(CC_RE, REDACTED);
  out = out.replace(PHONE_RE, REDACTED);
  return out;
}
