import 'react-native-get-random-values';

import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes often lacks `globalThis.crypto.getRandomValues`. `@noble/*` captures
 * `crypto` at module-load time, so this file must be imported as a BARE
 * SIDE-EFFECT before any `@symply/local-first` / engine import — not called
 * lazily, and not via `await import()` (which throws under Jest without
 * `--experimental-vm-modules`). Plan §5.1.
 */
export function ensureHealthLocalCrypto(): void {
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (array: ArrayBufferView) => ArrayBufferView };
  };

  if (typeof g.crypto?.getRandomValues === 'function') {
    return;
  }

  const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    ExpoCrypto.getRandomValues(array as unknown as Parameters<typeof ExpoCrypto.getRandomValues>[0]);
    return array;
  };

  try {
    if (!g.crypto) {
      g.crypto = { getRandomValues };
    } else {
      g.crypto.getRandomValues = getRandomValues;
    }
  } catch {
    Object.defineProperty(g, 'crypto', {
      value: { getRandomValues },
      configurable: true,
      writable: true,
    });
  }

  if (typeof g.crypto?.getRandomValues !== 'function') {
    throw new Error('[HealthLocalCrypto] failed to install getRandomValues polyfill');
  }
}

ensureHealthLocalCrypto();
