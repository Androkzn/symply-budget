/**
 * The one permission state machine every OS permission in this app collapses
 * onto — camera, microphone, speech recognition and notifications all wrap
 * `expo-modules-core`'s `PermissionResponse` (`status` / `granted` /
 * `canAskAgain`), and HealthKit's native bridge (`healthKit.ts`) answers the
 * same four states by hand. One helper here means a permission added next
 * year gets this for free instead of re-deriving it.
 *
 * `denied` and `not-requested` are NOT the same fact: only `denied` means the
 * OS will refuse to show its own prompt again, so only `denied` gets an
 * "Open Settings" route. Conflating them would either nag someone who already
 * said no, or send someone who hasn't been asked yet on a needless detour
 * through Settings instead of the one-tap OS sheet.
 */
export type PermissionState = 'unavailable' | 'not-requested' | 'denied' | 'granted';

export interface PermissionResponseLike {
  status: string;
  /** Absent on some platforms' first read; treated as `true` (still askable) then. */
  canAskAgain?: boolean;
}

/**
 * Normalise any `expo-modules-core`-shaped permission response to our four
 * states. `null`/`undefined` (module not present, or not yet read) is
 * `unavailable` — never rendered as `denied`, which would send someone to
 * Settings to fix a toggle that was never theirs to flip.
 */
export function permissionStateFrom(
  response: PermissionResponseLike | null | undefined,
): PermissionState {
  if (!response) return 'unavailable';
  if (response.status === 'granted') return 'granted';
  if (response.status === 'denied' && response.canAskAgain === false) return 'denied';
  return 'not-requested';
}
