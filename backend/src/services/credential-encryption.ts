/**
 * AES-256-GCM credential encryption for BYOK vault (§18.2).
 * Direct symmetric encryption with AAD — not DEK-wrapping envelope encryption.
 */

export class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialEncryptionError';
  }
}

export interface EncryptedCredential {
  ciphertext: string; // base64
  iv: string; // base64
  keyVersion: string;
}

function parseKek(secret: string): Uint8Array {
  // Accept base64-encoded 32-byte key or utf-8 string hashed via SHA-256.
  try {
    const bin = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    if (bin.length === 32) return bin;
  } catch {
    // fall through
  }
  // Derive 32 bytes from arbitrary secret string (dev convenience).
  // Production must use a 32-byte base64 KEK via wrangler secret.
  throw new CredentialEncryptionError(
    'AI_CREDENTIAL_KEK_V1 must be a base64-encoded 32-byte key'
  );
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt plaintext API key. AAD binds ciphertext to userId+provider.
 */
export async function encryptCredential(
  plaintext: string,
  aad: { userId: string; provider: string },
  kekBase64: string,
  keyVersion = 'v1'
): Promise<EncryptedCredential> {
  const key = await importAesKey(parseKek(kekBase64));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const aadBytes = new TextEncoder().encode(`${aad.userId}:${aad.provider}`);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes },
    key,
    encoded
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(cipherBuf))),
    iv: btoa(String.fromCharCode(...iv)),
    keyVersion,
  };
}

export async function decryptCredential(
  encrypted: EncryptedCredential,
  aad: { userId: string; provider: string },
  kekBase64: string
): Promise<string> {
  const key = await importAesKey(parseKek(kekBase64));
  const iv = Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0));
  const aadBytes = new TextEncoder().encode(`${aad.userId}:${aad.provider}`);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadBytes },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new CredentialEncryptionError('Failed to decrypt credential');
  }
}

export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) return '****';
  return trimmed.slice(-4);
}
