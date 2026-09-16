/**
 * Length-safe secret comparison (Cloudflare timingSafeEqual pattern).
 * Do not early-return on length mismatch — that leaks secret length via timing.
 */

export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const lengthsMatch = aBytes.byteLength === bBytes.byteLength;
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(aBytes, bBytes)
    : !(await crypto.subtle.timingSafeEqual(aBytes, aBytes));
}

export type SecretVerifyResult = 'ok' | 'unconfigured' | 'unauthorized';

/** Verify a caller-provided secret against an expected value; fail closed when unset. */
export async function verifySharedSecret(
  provided: string | undefined,
  expected: string | undefined
): Promise<SecretVerifyResult> {
  if (!expected) return 'unconfigured';
  if (!provided) return 'unauthorized';
  return (await timingSafeEqualStrings(provided, expected)) ? 'ok' : 'unauthorized';
}
