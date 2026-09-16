/**
 * Classify a sync failure into something the UI can say honestly.
 *
 * Promoted out of `src/features/budget/local/sync/syncErrors.ts` unchanged: it
 * contains no brand, no React Native import and no network client — only duck
 * typing over an axios-shaped error — so House consumes the same classifier
 * rather than forking a second copy that would drift on the next status code.
 *
 * Every failure used to collapse into one `lastError` string built from
 * `error.message`, which the banner rendered as a generic problem. Two bad
 * consequences: a raw system string could reach the UI, and — worse — a
 * PERMANENT failure was indistinguishable from being briefly offline. The op
 * batch outgrows the relay's per-blob cap at a few hundred ops, after which every
 * deposit is rejected and every retry is larger than the last, so "we'll sync
 * when you're back online" was a promise the app could no longer keep.
 */
export type SyncErrorCode =
  | 'offline'
  | 'payload_too_large'
  | 'auth'
  | 'key_epoch'
  | 'decrypt'
  | 'server'
  | 'unknown';

type MaybeAxiosError = {
  message?: unknown;
  code?: unknown;
  response?: { status?: unknown; data?: unknown };
};

function statusOf(error: unknown): number | null {
  const status = (error as MaybeAxiosError | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}

function textOf(error: unknown): string {
  const err = error as MaybeAxiosError | null;
  const parts = [
    typeof err?.message === 'string' ? err.message : '',
    typeof err?.code === 'string' ? err.code : '',
  ];
  const data = err?.response?.data;
  if (typeof data === 'string') parts.push(data);
  else if (data && typeof data === 'object') {
    const code = (data as { error?: { code?: unknown } }).error?.code;
    if (typeof code === 'string') parts.push(code);
  }
  return parts.join(' ').toLowerCase();
}

export function classifySyncError(error: unknown): SyncErrorCode {
  const status = statusOf(error);
  const text = textOf(error);

  // The relay caps a deposit's ciphertext. Until the sync protocol sends a
  // cursor-bounded slice, an oversized batch is terminal, not transient.
  if (status === 413 || status === 507) return 'payload_too_large';
  if (text.includes('payload_too_large') || text.includes('too large')) {
    return 'payload_too_large';
  }
  if (status === 400 && (text.includes('ciphertextbase64') || text.includes('max'))) {
    return 'payload_too_large';
  }

  if (status === 401 || status === 403) return 'auth';
  if (text.includes('key_epoch') || text.includes('keyepoch')) return 'key_epoch';
  if (text.includes('decrypt') || text.includes('aead') || text.includes('unseal')) {
    return 'decrypt';
  }

  if (status !== null && status >= 500) return 'server';

  // Axios reports a transport failure with no response at all.
  if (
    status === null &&
    (text.includes('network') ||
      text.includes('timeout') ||
      text.includes('econnaborted') ||
      text.includes('econnrefused') ||
      text.includes('err_network') ||
      text.includes('failed to fetch'))
  ) {
    return 'offline';
  }

  if (status !== null && status >= 400) return 'server';
  return 'unknown';
}

/**
 * Whether retrying unchanged could ever succeed. `payload_too_large` cannot:
 * the batch only grows, so the UI must stop implying it will resolve itself.
 */
export function isTerminalSyncError(code: SyncErrorCode): boolean {
  return code === 'payload_too_large';
}
