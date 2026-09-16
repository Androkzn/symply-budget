import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

import { bytesToHex, hexToBytes, randomBytes } from '../crypto/bytes';

/**
 * 12-word BIP39 recovery phrase (128-bit entropy).
 *
 * Entropy comes from OUR `randomBytes`, not bip39's `generateMnemonic`. The
 * latter reaches for `@noble/hashes/utils.randomBytes`, which captures
 * `globalThis.crypto` at MODULE LOAD and throws "crypto.getRandomValues must be
 * defined" forever if it loaded before the app installed its Hermes polyfill —
 * no amount of import reordering in the app can undo that capture. `./bytes`
 * reads the global at CALL time, which is why every other call site in this
 * package already uses it. This was the last one that didn't, and it made
 * enabling backups impossible on device while every unit test passed.
 */
export function generateRecoveryPhrase(): string {
  return entropyToMnemonic(randomBytes(16), wordlist);
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalizeRecoveryPhrase(phrase), wordlist);
}

/** Stable UTF-8 secret for Argon2 (`deriveRecoveryKey`) from a validated mnemonic. */
export function recoveryPhraseToSecret(phrase: string): string {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid recovery phrase');
  }
  return bytesToHex(mnemonicToEntropy(normalized, wordlist));
}

/** Deterministic phrase from 16-byte entropy (tests). */
export function recoveryPhraseFromEntropyHex(entropyHex: string): string {
  const entropy = hexToBytes(entropyHex);
  if (entropy.length !== 16) {
    throw new Error('recoveryPhraseFromEntropyHex expects 16 bytes');
  }
  return entropyToMnemonic(entropy, wordlist);
}

export function randomRecoverySalt(): Uint8Array {
  return randomBytes(16);
}
