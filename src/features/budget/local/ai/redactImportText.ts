/** Redact obvious sensitive tokens before any BYOK outbound call. */
const PATTERNS: RegExp[] = [
  /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g, // SIN-like
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // card-like
  /\b\d{9,12}\b/g, // long account numbers
];

export function redactImportText(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}
