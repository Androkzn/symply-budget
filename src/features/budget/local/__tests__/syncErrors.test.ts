import { classifySyncError, isTerminalSyncError } from '../sync/syncErrors';

/**
 * Every sync failure used to collapse into one message string, so a PERMANENT
 * failure was indistinguishable from being briefly offline. The op batch
 * outgrows the relay's per-blob cap after a few hundred ops, and from then on
 * every deposit is rejected and every retry is larger — while the banner kept
 * saying it would sync when the connection came back.
 */
function axiosLike(status: number | null, data?: unknown, message = 'Request failed') {
  return status === null ? { message } : { message, response: { status, data } };
}

describe('classifySyncError', () => {
  it('reports an oversized op batch as terminal, not as a network problem', () => {
    expect(classifySyncError(axiosLike(413, { error: { code: 'payload_too_large' } }))).toBe(
      'payload_too_large',
    );
    expect(isTerminalSyncError('payload_too_large')).toBe(true);
  });

  it('still recognises the pre-413 validation rejection', () => {
    // Older relays reject the same condition as a zod 400 naming the field.
    expect(
      classifySyncError(axiosLike(400, 'Invalid ciphertextBase64: String must contain at most…')),
    ).toBe('payload_too_large');
  });

  it('treats a transport failure with no response as offline', () => {
    expect(classifySyncError(axiosLike(null, undefined, 'Network Error'))).toBe('offline');
    expect(classifySyncError({ message: 'timeout of 0ms exceeded' })).toBe('offline');
    expect(classifySyncError({ message: 'x', code: 'ECONNABORTED' })).toBe('offline');
    expect(isTerminalSyncError('offline')).toBe(false);
  });

  it('separates auth, key epoch, decrypt and server failures', () => {
    expect(classifySyncError(axiosLike(401))).toBe('auth');
    expect(classifySyncError(axiosLike(403))).toBe('auth');
    expect(classifySyncError({ message: 'key_epoch mismatch' })).toBe('key_epoch');
    expect(classifySyncError({ message: 'aead decrypt failed' })).toBe('decrypt');
    expect(classifySyncError(axiosLike(500))).toBe('server');
    expect(classifySyncError(axiosLike(503))).toBe('server');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifySyncError(new Error('something else entirely'))).toBe('unknown');
    expect(classifySyncError(null)).toBe('unknown');
    expect(classifySyncError(undefined)).toBe('unknown');
  });

  it('never classifies a terminal failure as offline', () => {
    // The specific regression: "offline" implies a retry will fix it.
    const oversized = axiosLike(413, { error: { code: 'payload_too_large' } });
    expect(classifySyncError(oversized)).not.toBe('offline');
  });
});
