/**
 * Turn any thrown error into something the user can read.
 *
 * **The gap this closes.** `unsupportedCopy.ts` gives each off-on-device surface
 * real copy. That is necessary and not sufficient: House audited its screens
 * after doing exactly that and found **no screen rendered it**. Every reachable
 * call site substituted a hardcoded string, and the one screen that looked like
 * it rendered the copy did not —
 *
 * ```ts
 * const data = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
 * return data?.error?.message;   // axios shape only
 * ```
 *
 * A local-first error never has `.response` — it never went near the network —
 * so that reads `undefined` every time and the screen falls back to its own
 * sentence. Health's screens are the same shape: `healthRepository.readThrough`
 * hands failures straight to a `catch` in a component, and Home's 17-way
 * `Promise.all` (`HealthHomeScreen.tsx:198-219`) rejects as a unit. Putting copy
 * on the error and never reading it does not satisfy "no raw error strings".
 *
 * So this is the one extractor every Health screen should use. Order matters:
 * the local, deliberate copy wins over anything a transport produced.
 *
 * ## Naming — why not "member"
 *
 * Health is a personal ledger: one user, N devices, no roster (plan §1.2), and
 * the He12(partial) E2E asserts no member/invite/partner copy on any screen. So
 * the Health-voiced names below are primary. The House names are re-exported as
 * aliases — same function objects, no second implementation — so a facade ported
 * line-by-line from `src/features/house/local/` compiles unchanged.
 *
 * ## ⚠️ One seam, deliberately left for the He3 facade merge
 *
 * House puts the copy **on the error** (`HouseLocalUnsupportedError.title` /
 * `.memberMessage`, with the identifier kept on `.method` for logs). Health's
 * `errors.ts` predates `unsupportedCopy.ts` and does neither: it bakes the
 * method identifier into `.message` and exposes no `.method`. So this file
 * recovers the identifier from the message with a regex anchored on that error's
 * own format string, and — the load-bearing part — **never surfaces
 * `err.message` for that error class**, because that string contains the
 * identifier this whole mechanism exists to keep off a screen.
 *
 * The right end state is House's: move the copy onto the error and drop the
 * regex. That is an `errors.ts` change, and `errors.ts` is being read
 * concurrently by the sync and control-plane stages, so it belongs in the merge
 * that adds the throw sites (He3a) rather than in the kernel underneath it.
 * Whoever makes it: delete `unsupportedMethodOf` and read `err.method`.
 */
import {
  HealthLedgerDekMissingError,
  HealthLocalEnrolmentPendingError,
  HealthLocalNotReadyError,
  HealthLocalUnsupportedError,
} from './errors';
import { getHealthUnsupportedCopy, type HealthUnsupportedCopy } from './unsupportedCopy';

export type UserFacingError = {
  /** Short enough for an Alert title or a sheet header. */
  title: string;
  message: string;
  /** True when this is a deliberate "off on this device", not a failure. */
  expected: boolean;
};

/**
 * Recover the `module.method` identifier from a `HealthLocalUnsupportedError`.
 *
 * Anchored on the exact format string in `errors.ts` — *`Health local-first:
 * "<method>" is not available offline.`* — and on nothing else. A `null` return
 * means the format moved, and the caller falls back to the generic copy rather
 * than leaking a half-parsed developer sentence.
 *
 * Exported for the test that pins the two files together; not for screens.
 */
export function unsupportedMethodOf(err: HealthLocalUnsupportedError): string | null {
  const match = /^Health local-first: "([^"]+)"/.exec(err.message);
  return match?.[1] ?? null;
}

/** The copy for an unsupported-surface error, never its raw message. */
function unsupportedCopyFor(err: HealthLocalUnsupportedError): HealthUnsupportedCopy {
  const method = unsupportedMethodOf(err);
  // `getHealthUnsupportedCopy` already falls back for an unmapped method; the
  // `null` branch is the stronger case — the identifier could not be recovered
  // at all, so there is nothing to look up and nothing safe to print.
  return getHealthUnsupportedCopy(method ?? '');
}

/** The axios envelope, for errors that really did come back from the Worker. */
function fromAxios(err: unknown): string | undefined {
  const data = (
    err as { response?: { data?: { error?: { message?: string } | string; message?: string } } }
  )?.response?.data;
  if (!data) return undefined;
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error === 'object') return data.error.message;
  return data.message;
}

/**
 * Extract user-facing copy from any error.
 *
 * `fallback` is the screen's own sentence — kept as the last resort so a screen
 * that already had reasonable copy for genuine failures does not lose it.
 */
export function toUserFacingError(err: unknown, fallback: string): UserFacingError {
  // 1. A surface that is deliberately off on this device. Its copy was written
  //    for exactly this moment and must beat any generic sentence.
  if (err instanceof HealthLocalUnsupportedError) {
    const copy = unsupportedCopyFor(err);
    return { title: copy.title, message: copy.message, expected: true };
  }

  // 2. The session is not open yet — also expected, also not a failure. This is
  //    the `useFocusEffect` race in plan §5.1: Home can mount and run its 17
  //    loaders before `ensureHealthLocalSession()` has hydrated the ledger. The
  //    session-open notification is what repaints it; the user needs a sentence
  //    that says "wait", not "error".
  if (err instanceof HealthLocalNotReadyError) {
    return {
      title: 'Still opening your health data',
      message:
        'Your logs are still unlocking on this device. Give it a moment and try again — nothing is lost.',
      expected: true,
    };
  }

  // 3. Waiting on the user's OTHER DEVICE to approve this one. Note the words:
  //    a device approves a device. There is no one else to invite (plan §1.2).
  if (err instanceof HealthLocalEnrolmentPendingError) {
    return {
      title: 'Waiting for your other device',
      message:
        'Approve this device from the phone or tablet you already use, and your health data will unlock here. Changes are paused until then so nothing is written where it cannot be read back.',
      expected: true,
    };
  }

  // 4. Ciphertext orphan — the key is gone but the database is not (plan §1.3).
  //    Reachable on iOS, where the Keychain can outlive an uninstall while the
  //    app container does not. NOT `expected`: the caller should route to
  //    recovery, and honest copy is what makes a user reach for their backup
  //    instead of reinstalling on top of it.
  if (err instanceof HealthLedgerDekMissingError) {
    return {
      title: "This device can't unlock your health data",
      message:
        'The key that unlocks your logs on this device is missing, so they cannot be read here. Restore from a backup, or sync from your other device, before adding anything new.',
      expected: false,
    };
  }

  // 5. A real server error that carried a usable message.
  const remote = fromAxios(err);
  if (remote && remote.trim()) {
    return { title: 'Something went wrong', message: remote, expected: false };
  }

  return { title: 'Something went wrong', message: fallback, expected: false };
}

/** Convenience for call sites that only render a string. */
export function userFacingMessage(err: unknown, fallback: string): string {
  return toUserFacingError(err, fallback).message;
}

/**
 * House-compatible aliases — the same functions, so a facade ported line-by-line
 * from `src/features/house/local/` needs no rename. Prefer the names above in
 * new Health code: this app has one user and no members.
 */
export { toUserFacingError as toMemberFacingError, userFacingMessage as memberFacingMessage };
export type { UserFacingError as MemberFacingError };
