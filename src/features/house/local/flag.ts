/**
 * House V2 local-first client gate (plan §1.7).
 *
 * - `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=1` → on
 * - `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0` → off
 * - unset → on for `symply-house` only
 *
 * `EXPO_PUBLIC_*` is inlined at bundle time, so flipping this does nothing to
 * an already-installed binary. Incident disable is the Worker secret
 * `LOCAL_FIRST_API_ENABLED`, then an EAS Update carrying the flag — never the
 * other way round.
 */
export function isHouseLocalFirst(): boolean {
  const env = process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST;
  if (env === '1') return true;
  if (env === '0') return false;

  // Under Jest, local-first is OPT-IN rather than brand-default.
  //
  // House is the brand the Jest baseline runs (plan §6.2), so the brand check
  // below would return true in every suite — and the H3 Proxy would then route
  // every existing remote-api test into the ledger, where no session is open.
  // Budget never hit this because Jest is not the Budget brand.
  //
  // Defaulting to `false` here keeps a suite testing what its name says: the
  // remote HTTP contract stays the remote HTTP contract. A suite that wants the
  // local path either calls the local api directly (all of
  // `src/features/house/local/__tests__` does) or sets the env var above.
  if (process.env.JEST_WORKER_ID !== undefined) return false;

  try {
    // Lazy require avoids env/brand circular init.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { brand } = require('../../../brand') as typeof import('../../../brand');
    return brand?.id === 'symply-house';
  } catch {
    return false;
  }
}

/** WebRTC peer transport — opt-in only, mailbox relay is the default path. */
export function isHouseP2PEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HOUSE_P2P === '1';
}
