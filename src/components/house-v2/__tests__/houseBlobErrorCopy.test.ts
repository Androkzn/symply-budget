/**
 * H6 attachment error copy — and `retryable`, which decides what happens to a
 * member's half-uploaded file.
 *
 * This is not a copy test with a behavioural footnote; it is a behaviour test
 * that happens to also check words. `HouseAttachmentField` branches on
 * `retryable`: a retryable failure KEEPS the pending upload with the same
 * `blobId` so `uploadHouseBlob` resumes from the staged envelopes, and a
 * non-retryable one CLEARS the pending state and calls `deleteHouseBlob`.
 *
 * Get that boolean wrong in either direction and the damage is real:
 *
 *  - marking a quota/too-large failure retryable leaves a spinner and a
 *    "Try again" that can never succeed, plus staged bytes on disk forever;
 *  - marking a corrupt/incomplete failure non-retryable throws away a resumable
 *    upload — and resume matters here specifically because re-uploading
 *    re-seals, and re-sealing a chunk reuses a nonce.
 *
 * The three non-retryable codes are non-retryable for three different reasons,
 * which is why they are asserted individually rather than as a set: the server
 * refused (quota), the file cannot fit (size), and the key is gone for this
 * device forever (`blob_key_unavailable` — attached before this member joined).
 */
import {
  HouseBlobCorruptError,
  HouseBlobKeyUnavailableError,
  HouseBlobTooLargeError,
} from '@features/house/local/blobs';

import { formatBlobBytes, houseBlobErrorCode, houseBlobErrorCopy } from '../houseBlobErrorCopy';

const FALLBACK = 'That attachment did not go through.';

/** The transport errors live in a different module from the store errors. */
function quotaError(): Error {
  const e = new Error('quota');
  (e as unknown as { code: string }).code = 'blob_quota_exceeded';
  return e;
}
function incompleteError(): Error {
  const e = new Error('incomplete');
  (e as unknown as { code: string }).code = 'blob_incomplete';
  return e;
}

describe('houseBlobErrorCode — recognising a blob failure at all', () => {
  it('reads the code off the five named blob errors', () => {
    expect(houseBlobErrorCode(quotaError())).toBe('blob_quota_exceeded');
    expect(houseBlobErrorCode(incompleteError())).toBe('blob_incomplete');
    expect(houseBlobErrorCode(new HouseBlobTooLargeError(1))).toBe('blob_too_large');
    expect(houseBlobErrorCode(new HouseBlobCorruptError('blob', 'expected-hash', 'actual-hash'))).toBe('blob_corrupt');
    expect(houseBlobErrorCode(new HouseBlobKeyUnavailableError('blob', 0, 1))).toBe(
      'blob_key_unavailable',
    );
  });

  it('returns null for anything that is not a blob failure', () => {
    // A network blip during an upload is not a blob-channel error, and must
    // fall through to the caller's own sentence rather than be mislabelled.
    expect(houseBlobErrorCode(new Error('Network request failed'))).toBeNull();
    expect(houseBlobErrorCode(null)).toBeNull();
    expect(houseBlobErrorCode(undefined)).toBeNull();
    expect(houseBlobErrorCode('blob_quota_exceeded')).toBeNull();
  });
});

describe('retryable — what happens to the pending upload', () => {
  it('is FALSE for the three that can never succeed on a retry', () => {
    expect(houseBlobErrorCopy(quotaError(), FALLBACK).retryable).toBe(false);
    expect(houseBlobErrorCopy(new HouseBlobTooLargeError(1), FALLBACK).retryable).toBe(false);
    expect(
      houseBlobErrorCopy(new HouseBlobKeyUnavailableError('blob', 0, 1), FALLBACK).retryable,
    ).toBe(false);
  });

  it('is TRUE for the two that a resume can fix', () => {
    // Resume re-reads the staged envelope rather than re-sealing, which is the
    // whole reason keeping the pending upload is safe.
    expect(houseBlobErrorCopy(new HouseBlobCorruptError('blob', 'expected-hash', 'actual-hash'), FALLBACK).retryable).toBe(true);
    expect(houseBlobErrorCopy(incompleteError(), FALLBACK).retryable).toBe(true);
  });

  it('is retryable for an unrecognised error, because we do not know it is not', () => {
    // `code` is null on the fallback path. Refusing a retry on an unknown
    // failure would strand a member on a transient network error.
    const copy = houseBlobErrorCopy(new Error('boom'), FALLBACK);
    expect(copy.code).toBeNull();
    expect(copy.retryable).toBe(true);
  });
});

describe('the words a member reads', () => {
  it('uses the caller’s fallback sentence when the failure is not ours', () => {
    expect(houseBlobErrorCopy(new Error('boom'), FALLBACK).message).toBe(FALLBACK);
  });

  it('explains a key-unavailable failure as history, not as breakage', () => {
    // The file was attached before this member's device joined. Nothing is
    // broken and nothing can be done here — a longer-lived peer can still open
    // it — so the copy must not invite an action that cannot work.
    const copy = houseBlobErrorCopy(new HouseBlobKeyUnavailableError('blob', 0, 1), FALLBACK);
    expect(`${copy.title} ${copy.message}`).toMatch(/joined|before/i);
  });

  it('never leaks an error code or a class name to the member', () => {
    for (const err of [
      quotaError(),
      incompleteError(),
      new HouseBlobTooLargeError(1),
      new HouseBlobCorruptError('blob', 'expected-hash', 'actual-hash'),
      new HouseBlobKeyUnavailableError('blob', 0, 1),
    ]) {
      const copy = houseBlobErrorCopy(err, FALLBACK);
      const rendered = `${copy.title} ${copy.message}`;
      expect(rendered).not.toMatch(/blob_[a-z_]+/);
      expect(rendered).not.toMatch(/HouseBlob\w*Error/);
    }
  });
});

describe('formatBlobBytes — a cap must never be understated', () => {
  it('rounds a limit UP so we never promise more room than exists', () => {
    // The header states the rule: never tell a member "under 64 MB" about a cap
    // that is actually 63.9. Understating the limit is the only direction that
    // produces a second failed upload.
    const almost = 64 * 1024 * 1024 - 1;
    expect(formatBlobBytes(almost)).toMatch(/64/);
  });

  it('renders a human unit rather than a byte count', () => {
    expect(formatBlobBytes(5 * 1024 * 1024)).toMatch(/MB/i);
    expect(formatBlobBytes(5 * 1024 * 1024)).not.toMatch(/5242880/);
  });
});
