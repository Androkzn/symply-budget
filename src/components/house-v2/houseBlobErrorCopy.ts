/**
 * Member-facing copy for the H6 encrypted attachment channel.
 *
 * `toMemberFacingError` is the universal extractor and stays the last word here
 * — but it only knows about `HouseLocalUnsupportedError`, `HouseLocalNotReadyError`
 * and the axios envelope. The blob channel throws four errors it has never heard
 * of, and their raw `message` is engineering prose:
 *
 *   HouseBlobTooLargeError   → "Attachment is larger than the 67108864 byte limit"
 *   HouseBlobCorruptError    → "Attachment failed its integrity check"
 *   HouseBlobKeyUnavailableError → "…a household key this device no longer has"
 *
 * A byte count and the phrase "integrity check" are not an explanation, so this
 * module owns the sentence a member actually reads and delegates everything else
 * to `toMemberFacingError`. Nothing here ever renders `err.message` verbatim.
 *
 * Matching is on the error's `code` field (each class declares a readonly one)
 * rather than `instanceof`. The classes are constructed inside the blob module;
 * a caller in another bundle chunk — or a test that mocks that module — would
 * fail an `instanceof` check while the code stays correct.
 */
import { toMemberFacingError, type MemberFacingError } from '@features/house/local/memberFacingError';

/** The named states the H6 channel can be in, from the member's point of view. */
export type HouseBlobErrorCode =
  | 'blob_quota_exceeded'
  | 'blob_too_large'
  | 'blob_corrupt'
  | 'blob_key_unavailable'
  | 'blob_incomplete';

export type HouseBlobErrorCopy = MemberFacingError & {
  /** Null when this was not a blob-channel error and the fallback path ran. */
  code: HouseBlobErrorCode | null;
  /**
   * Whether trying the same action again could plausibly succeed. Quota, size
   * and a missing key are all permanent for this device — offering "Try again"
   * there is a lie the UI has to avoid.
   */
  retryable: boolean;
};

const NAME_TO_CODE: Record<string, HouseBlobErrorCode> = {
  HouseBlobQuotaError: 'blob_quota_exceeded',
  HouseBlobTooLargeError: 'blob_too_large',
  HouseBlobCorruptError: 'blob_corrupt',
  HouseBlobKeyUnavailableError: 'blob_key_unavailable',
  HouseBlobIncompleteError: 'blob_incomplete',
};

const CODES = new Set<string>(Object.values(NAME_TO_CODE));

/** `code` first (survives a module boundary), `name` as the fallback. */
export function houseBlobErrorCode(err: unknown): HouseBlobErrorCode | null {
  const candidate = err as { code?: unknown; name?: unknown } | null;
  const code = candidate?.code;
  if (typeof code === 'string' && CODES.has(code)) return code as HouseBlobErrorCode;
  const name = candidate?.name;
  if (typeof name === 'string' && NAME_TO_CODE[name]) return NAME_TO_CODE[name];
  return null;
}

/**
 * Bytes → the shortest honest string. Rounded up for limits so we never tell a
 * member "under 64 MB" about a cap that is actually 63.9.
 */
export function formatBlobBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function numberField(err: unknown, field: string): number | null {
  const value = (err as Record<string, unknown> | null)?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Turn any attachment failure into something a member can act on.
 *
 * `fallback` is the caller's own sentence for a genuine, unclassified failure —
 * the same contract `toMemberFacingError` has, so a screen that already had
 * reasonable copy does not lose it.
 *
 * `maxBytes` is the plaintext cap the size copy quotes. It is a parameter rather
 * than an import so this module stays free of the blob store (and its
 * `expo-file-system` + engine dependencies) — the caller passes
 * `BLOB_MAX_PLAINTEXT_BYTES`.
 */
export function houseBlobErrorCopy(
  err: unknown,
  fallback: string,
  maxBytes?: number,
): HouseBlobErrorCopy {
  const code = houseBlobErrorCode(err);

  switch (code) {
    case 'blob_quota_exceeded': {
      const limit = numberField(err, 'limitBytes');
      const limitText = limit ? ` (${formatBlobBytes(limit)})` : '';
      return {
        needsAiProvider: false,
        code,
        title: 'Attachment storage is full',
        message: `Your home has used all of its attachment storage${limitText}. Nothing already saved is lost — remove a few attachments, photos first, and add this one again.`,
        expected: true,
        retryable: false,
      };
    }

    case 'blob_too_large': {
      const size = numberField(err, 'bytes');
      const sizeText = size ? ` This one is ${formatBlobBytes(size)}.` : '';
      const capText = maxBytes ? formatBlobBytes(maxBytes) : 'the size limit';
      return {
        needsAiProvider: false,
        code,
        title: 'That file is too big',
        message: `Attachments have to be under ${capText}.${sizeText} Try a smaller photo, or a shorter clip.`,
        expected: true,
        retryable: false,
      };
    }

    case 'blob_corrupt':
      return {
        needsAiProvider: false,
        code,
        title: 'That attachment did not arrive intact',
        message:
          'The file downloaded, but it does not match what was originally attached, so we are not showing it. Try again — if it keeps failing, ask whoever attached it to add it again.',
        expected: false,
        // A truncated download is the common cause and a second fetch usually
        // fixes it. A genuinely substituted file will just fail again, loudly.
        retryable: true,
      };

    case 'blob_key_unavailable':
      return {
        needsAiProvider: false,
        code,
        title: 'This was attached before you joined',
        message:
          'It is locked with a household key from before this device joined the home, so it cannot be opened here. Anyone who was already in the home can still open it and attach it again.',
        expected: true,
        retryable: false,
      };

    case 'blob_incomplete':
      return {
        needsAiProvider: false,
        code,
        title: 'Still uploading',
        message:
          'Whoever attached this is still sending it. It will appear here once their upload finishes.',
        expected: true,
        retryable: true,
      };

    default: {
      // Not a blob error — the shared extractor is the authority (P4 copy, the
      // not-ready state, or a real server message), never `err.message`.
      const member = toMemberFacingError(err, fallback);
      return { ...member, code: null, retryable: !member.expected };
    }
  }
}
