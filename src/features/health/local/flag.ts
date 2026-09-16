/**
 * Health V2 local-first client gate (plan §1.7).
 *
 * - `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1` → on
 * - `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0` → off
 * - unset → on for `symply-health` only, and only after He12 (full)
 *
 * `EXPO_PUBLIC_*` is inlined at bundle time, so flipping this does nothing to an
 * already-installed binary. There is no sub-60s kill switch: the incident order
 * is an EAS Update carrying the flag FIRST (it is the only step that changes
 * what a client does), then reverting the 410 gate — never the other way round
 * (plan §1.7).
 */
export function isHealthLocalFirst(): boolean {
  const env = process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;

  // Explicit wins, and wins BEFORE the Jest guard below. An unconditional
  // `false` under Jest would make the required `=1` pin unpassable and would
  // leave the entire local path uncoverable (plan §1.7).
  if (env === '1') return true;
  if (env === '0') return false;

  // Under Jest the BRAND DEFAULT is suppressed, so existing remote-api suites
  // keep testing the remote HTTP contract rather than being routed into a
  // ledger with no open session. A suite that wants the local path either calls
  // the local api directly (all of `src/features/health/local/__tests__` does)
  // or sets the env var above. Copied from `house/local/flag.ts:13-31`.
  if (process.env.JEST_WORKER_ID !== undefined) return false;

  try {
    // Lazy require avoids env/brand circular init.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { brand } = require('../../../brand') as typeof import('../../../brand');
    return brand?.id === 'symply-health';
  } catch {
    return false;
  }
}

/** WebRTC peer transport — opt-in only; the mailbox relay is the default path. */
export function isHealthP2PEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HEALTH_P2P === '1';
}
