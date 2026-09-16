/**
 * Turn any thrown error into something a member can read (DoD H7).
 *
 * **The gap this closes.** `unsupportedCopy.ts` gave each P4-disabled feature
 * real copy and put it on `HouseLocalUnsupportedError.message`. That was
 * necessary and not sufficient: an audit of the screens found that **no House
 * screen renders it**. Every reachable call site substitutes a hardcoded string
 * — `'Failed to load quotes'`, `'Could not add to budget'` — and
 * `GarbageDetectScreen` looks like it renders the copy but does not:
 *
 * ```ts
 * const data = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
 * return data?.error?.message;   // axios shape only
 * ```
 *
 * A local-first error never has `.response` — it never went near the network —
 * so that reads `undefined` every time and the screen falls back to its own
 * sentence. The DoD says a P4 feature must *show* member-facing copy; putting it
 * on the error and never reading it does not.
 *
 * So this is the one extractor every House screen should use. Order matters:
 * the local, deliberate copy wins over anything a transport produced.
 */
import { HouseLocalNotReadyError, HouseLocalUnsupportedError } from './errors';

export type MemberFacingError = {
  /** Short enough for an Alert title or a sheet header. */
  title: string;
  message: string;
  /** True when this is a deliberate P4 "off in private mode", not a failure. */
  expected: boolean;
  /**
   * True when the member can turn this on themselves by connecting an AI
   * provider. `useMemberFacingAlert` reads it and offers the route; nothing
   * else in the app should branch on the method name to work it out.
   */
  needsAiProvider: boolean;
};

/** The axios envelope, for errors that really did come back from the Worker. */
function fromAxios(err: unknown): string | undefined {
  const data = (
    err as {
      response?: {
        data?: { error?: { message?: string } | string; message?: string };
      };
    }
  )?.response?.data;
  if (!data) return undefined;
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error === 'object') return data.error.message;
  return data.message;
}

/**
 * Extract member-facing copy from any error.
 *
 * `fallback` is the screen's own sentence — kept as the last resort so a screen
 * that already had reasonable copy for genuine failures does not lose it.
 */
export function toMemberFacingError(
  err: unknown,
  fallback: string,
): MemberFacingError {
  // 1. A P4 feature that is deliberately off. Its copy was written for exactly
  //    this moment and must beat any generic sentence.
  if (err instanceof HouseLocalUnsupportedError) {
    return {
      title: err.title,
      message: err.memberMessage,
      expected: true,
      needsAiProvider: err.needsAiProvider,
    };
  }

  // 2. The session is not open yet — also expected, also not a failure.
  if (err instanceof HouseLocalNotReadyError) {
    return {
      title: 'Still getting your home ready',
      message:
        'Your home is still opening on this device. Give it a moment and try again — nothing is lost.',
      expected: true,
      needsAiProvider: false,
    };
  }

  // 3. A real server error that carried a usable message.
  const remote = fromAxios(err);
  if (remote && remote.trim()) {
    return {
      title: 'Something went wrong',
      message: remote,
      expected: false,
      needsAiProvider: false,
    };
  }

  return {
    title: 'Something went wrong',
    message: fallback,
    expected: false,
    needsAiProvider: false,
  };
}

/** Convenience for call sites that only render a string. */
export function memberFacingMessage(err: unknown, fallback: string): string {
  return toMemberFacingError(err, fallback).message;
}
