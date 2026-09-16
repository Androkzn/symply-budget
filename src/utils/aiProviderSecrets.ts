/**
 * Scrubbing for text that is about to be logged or attached to an error on the
 * BYOK path.
 *
 * Both on-device clients (Budget `localByokClient`, House `houseByokClient`)
 * hold a member's own provider key and both surface provider text — an error
 * body, a rejected URL — into logs and error messages. One implementation so
 * the two can't drift into different levels of safety.
 */

/**
 * Patterns that look like a provider secret.
 *
 * The targeted scrub (the actual key string) runs first and does the real work;
 * these catch a key that arrived from somewhere else — a provider echoing it
 * back in an error body, say — which the targeted scrub would miss.
 */
const KEY_SHAPED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI + Anthropic (`sk-`, `sk-ant-`, `sk-proj-`)
  /\bAIza[0-9A-Za-z_-]{10,}/g, // Google
  /([?&](?:key|api_key|access_token)=)[^&\s"']+/gi, // a secret smuggled in a URL
];

export function scrubProviderSecrets(text: string, apiKey?: string): string {
  let out = text;
  // Split/join rather than a regex: an API key can contain regex metacharacters.
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('[redacted-key]');
  for (const pattern of KEY_SHAPED_PATTERNS) {
    // The third pattern captures the `?key=` prefix so it survives the scrub —
    // a log line reading `?key=[redacted-key]` still shows a key WAS sent, which
    // is the thing an engineer needs to know.
    out = out.replace(pattern, (_match, prefix?: string) =>
      prefix ? `${prefix}[redacted-key]` : '[redacted-key]',
    );
  }
  return out;
}
