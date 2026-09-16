/**
 * `__DEV__` is a build-time global in the mobile app; under vitest it is simply
 * not defined, so `projection.ts:181` would throw ReferenceError instead of the
 * diagnostic it intends.
 *
 * Set it to TRUE, not false. With `false`, `rowKey()` returns null for a row
 * whose key field is missing, that row is skipped by `captureLedgerSnapshot`
 * (projection.ts:203) and by `diffLedger` (projection.ts:250), and every number
 * in the baseline is silently understated. A generator that forgets an `id`
 * must fail loudly.
 *
 * Assigned through a cast rather than `declare global`: `@types/react-native`
 * already declares `const __DEV__: boolean` ambiently (index.d.ts:9883) and is
 * in scope here, so a second declaration is a redeclaration error while
 * `globalThis.__DEV__` is not a known property.
 */
export function enableDevAssertions(): void {
  (globalThis as unknown as Record<string, unknown>).__DEV__ = true;
}
