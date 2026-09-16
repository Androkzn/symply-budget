import 'react-native-get-random-values';

import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes often lacks `globalThis.crypto.getRandomValues`. @noble/* captures
 * `crypto` at module-load time, so this file must be imported (side-effect)
 * before any `@symply/local-first` / engine import.
 */
export function ensureBudgetLocalCrypto(): void {
  const g = globalThis as typeof globalThis & {
    crypto?: { getRandomValues?: (array: ArrayBufferView) => ArrayBufferView };
  };

  if (typeof g.crypto?.getRandomValues === 'function') {
    return;
  }

  const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    // Through `unknown`: `T extends ArrayBufferView` is wider than expo-crypto's
    // typed-array union (it admits DataView, which expo-crypto cannot fill), so
    // TS refuses the direct assertion. The runtime contract is narrower than the
    // type — every caller here passes a Uint8Array.
    ExpoCrypto.getRandomValues(
      array as unknown as Parameters<typeof ExpoCrypto.getRandomValues>[0],
    );
    return array;
  };

  try {
    if (!g.crypto) {
      // Not a full `Crypto` — a polyfill only needs the one method the ledger
      // uses, and constructing a whole Crypto to satisfy the DOM lib would be
      // pretence.
      g.crypto = { getRandomValues } as unknown as typeof g.crypto;
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
    throw new Error('[BudgetLocalCrypto] failed to install getRandomValues polyfill');
  }
}

ensureBudgetLocalCrypto();
