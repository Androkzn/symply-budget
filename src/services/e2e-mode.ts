/**
 * Dev-only marker: "this install is being driven by Maestro."
 *
 * Some chrome exists purely so an E2E flow has something to grab, and `__DEV__`
 * alone cannot tell that apart from a developer running the same dev bundle by
 * hand. This is the missing half of that gate.
 *
 * NO CURRENT CONSUMER (2026-08-16). Budget's SyncStatusBanner was the one, and
 * it is gone: it sat on every armed dev build's dashboard reading "Synced 3m ago
 * via mailbox", and the two things it existed for now have better homes — flows
 * force a sync with `{scheme}://e2e-budget-sync`, and BR-044's conflict notice
 * moved onto Settings → Device sync, where a member on a Release build can
 * actually see it. The marker is kept because arming still happens on every
 * suite and the next piece of Maestro-only chrome should gate on this rather
 * than on `__DEV__` — that lesson cost a release's worth of dev builds.
 *
 * ARMING: the first `{scheme}://e2e-*` deep link this install ever receives.
 * Every suite opens one early — mm-01-signin fires `e2e-logout`, the shared
 * launch subflows fire `e2e-verify-no-network`, and `e2e-login` carries the
 * credentials — so a Maestro device arms itself inside its first flow, before
 * anything reaches for the banner. A developer's own simulator never opens one,
 * so it never arms.
 *
 * WHY PERSISTED: Maestro relaunches the app between flows (`launchApp` stops it
 * first), so a process-lifetime flag would be lost on every flow boundary and
 * only the flow that happened to fire the deep link would see the chrome. Test
 * devices are dedicated per app (`Budget-A` / `Budget-B`), so an install staying
 * armed is the intent rather than leakage; `simplebudget://e2e-disarm` clears it
 * if a device is ever reclaimed for manual use.
 *
 * Release builds are untouched: nothing here reads or writes outside `__DEV__`.
 */
import { asyncStorage, storage } from './storage';

const KEY = '__symply_e2e_driven_install__';

/**
 * `null` until first read. Cached because this is consulted during render —
 * the sync path below is MMKV, but a device that fell back to AsyncStorage has
 * no synchronous read at all (see storage/index.ts), which is what the async
 * hydrate covers.
 */
let armed: boolean | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function hydrateFromAsyncFallback(): void {
  // `StateStorage.getItem` is declared sync-or-async, so normalise before await.
  void Promise.resolve(asyncStorage.getItem(KEY))
    .then((value: string | null) => {
      if (value !== 'true' || armed === true) return;
      armed = true;
      notify();
    })
    .catch(() => {
      // Best-effort: a device that cannot read the marker just shows no chrome.
    });
}

/** Dev-only: this install has taken an `e2e-*` deep link, so it is a test device. */
export function markE2EDrivenInstall(): void {
  if (!__DEV__ || armed === true) return;
  armed = true;
  void asyncStorage.setItem(KEY, 'true');
  notify();
}

export function isE2EDrivenInstall(): boolean {
  if (!__DEV__) return false;
  if (armed === null) {
    armed = storage.getItem(KEY) === 'true';
    if (!armed) hydrateFromAsyncFallback();
  }
  return armed;
}

export function subscribeE2EDrivenInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Dev-only: hand a reclaimed test device back to manual use. */
export function clearE2EDrivenInstall(): void {
  if (!__DEV__) return;
  armed = false;
  void asyncStorage.removeItem(KEY);
  notify();
}

/** @internal test helper */
export function __resetE2EDrivenInstallForTests(): void {
  armed = null;
  void asyncStorage.removeItem(KEY);
}
