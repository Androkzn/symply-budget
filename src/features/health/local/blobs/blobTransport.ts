/**
 * `/v2` transport for the Health attachment channel (plan §8, stage He6).
 *
 * The routes are the fleet-shared ones House shipped —
 * `backend/src/routes/local-first-blobs.ts`, mounted inside `local-first-v2.ts`
 * so they inherit `requireLocalFirstApi()` and `authMiddleware()`. Nothing here
 * is Health-specific except the header block below; the Worker does not know or
 * care which brand deposited the bytes.
 *
 * Chunk bodies move as raw `application/octet-stream` in both directions — the
 * Worker streams them to and from R2 without parsing. That is not a performance
 * choice: a JSON envelope would put base64 ciphertext through the Worker's
 * parser, inflate every chunk by a third, and blur the "the body is opaque"
 * property the whole channel rests on. It is why `chunkCount` and `keyEpoch`
 * ride in `X-LF-*` headers.
 *
 * ── THE HEADER, AND WHY THE INTERCEPTOR DOES NOT COVER IT ───────────────────
 *
 * `X-Health-Local-First` is armed globally by the request interceptor in
 * `src/api/client.ts:71-84` — but **only for `config.url` starting `/health`**.
 * Every route below is `/v2/...`, so the interceptor never fires for them, and
 * `putUploadViaXhr` is a bare `XMLHttpRequest` that does not pass through axios
 * at all. Both halves therefore spread `HEALTH_LOCAL_FIRST_HEADERS` by hand,
 * exactly as House's `blobTransport` does with its own header and as
 * `controlPlaneClient.ts` already does for every other Health `/v2` call. The
 * constant comes from `sync/headers` rather than a local literal so this module
 * cannot drift onto a second spelling — that file exists for that reason.
 *
 * **Uploads go through `putUploadViaXhr`, not `apiClient.put`.** This is the
 * lesson `households.ts:370` already records: *"axios in React Native does not
 * reliably send a Blob as a raw binary body"*. Downloads use `apiClient.get`
 * with `responseType: 'arraybuffer'`, which axios does handle.
 */
import { apiClient } from '@api/client';
import { HttpUploadError, putUploadViaXhr } from '@api/e2ePutUpload';
import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

import { HEALTH_LOCAL_FIRST_HEADERS } from '../sync/headers';

export type RemoteHealthBlobManifest = {
  blobId: string;
  keyEpoch: number;
  chunkCount: number;
  cipherBytes: number;
  status: 'pending' | 'complete' | 'tombstoned';
  createdAt?: string;
};

export type RemoteHealthBlobUsage = {
  blobCount: number;
  cipherBytes: number;
  softLimitBytes: number;
  hardLimitBytes: number;
  overSoftLimit: boolean;
};

/**
 * The account is out of attachment storage (507 from the shared service).
 * Distinct from a transport failure because the retry policy is opposite: this
 * one must never be retried, only surfaced.
 */
export class HealthBlobQuotaError extends Error {
  readonly code = 'blob_quota_exceeded';
  constructor(
    readonly limitBytes: number,
    readonly usedBytes: number,
  ) {
    super('Attachment storage is full');
    this.name = 'HealthBlobQuotaError';
  }
}

/**
 * The blob row exists but not every chunk has landed — the user's other device
 * is still uploading. A reader should show "still uploading", not "broken".
 */
export class HealthBlobIncompleteError extends Error {
  readonly code = 'blob_incomplete';
  constructor(readonly blobId: string) {
    super('Attachment is still uploading');
    this.name = 'HealthBlobIncompleteError';
  }
}

/**
 * The relay has no bytes for this blob: never uploaded, tombstoned, or purged
 * past the watermark.
 *
 * Named here rather than left as a bare 404 so the store never has to sniff an
 * axios error shape to decide between "show a placeholder" and "something is
 * actually wrong" — see `tryResolveHealthBlobUri`.
 */
export class HealthBlobMissingError extends Error {
  readonly code = 'blob_missing';
  constructor(readonly blobId: string) {
    super('Attachment is no longer stored');
    this.name = 'HealthBlobMissingError';
  }
}

function httpStatusOf(error: unknown): number | null {
  const response = (error as { response?: { status?: number } } | null)?.response;
  return typeof response?.status === 'number' ? response.status : null;
}

function blobBase(householdId: string, blobId: string): string {
  return `/v2/households/${householdId}/blobs/${blobId}`;
}

/**
 * PUT one sealed chunk.
 *
 * `envelope` is the exact bytes staged on disk for this chunk index — never a
 * freshly sealed copy. See `sealHealthBlobChunk`'s nonce-reuse note.
 */
export async function putHealthBlobChunk(input: {
  householdId: string;
  blobId: string;
  keyEpoch: number;
  chunkIndex: number;
  chunkCount: number;
  envelope: Uint8Array;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const path = `${blobBase(input.householdId, input.blobId)}/chunks/${input.chunkIndex}`;
  try {
    await putUploadViaXhr({
      uploadUrl: `${ENV.API_BASE_URL}${path}`,
      // `slice()` detaches the view from any larger backing buffer so XHR sends
      // exactly this chunk — a subarray of a staged read would send the whole
      // buffer behind it.
      body: input.envelope.slice().buffer as ArrayBuffer,
      contentType: 'application/octet-stream',
      authorization: useAuthStore.getState().token,
      label: 'lf-health-blob',
      logKind: 'network',
      networkPath: path,
      onProgress: input.onProgress,
      headers: {
        ...HEALTH_LOCAL_FIRST_HEADERS,
        'X-LF-Chunk-Count': String(input.chunkCount),
        'X-LF-Key-Epoch': String(input.keyEpoch),
      },
    });
  } catch (error) {
    if (error instanceof HttpUploadError && error.code === 'quota_exceeded') {
      const detail = (error.body as { error?: { limit?: number; used?: number } } | null)?.error;
      throw new HealthBlobQuotaError(Number(detail?.limit ?? 0), Number(detail?.used ?? 0));
    }
    throw error;
  }
}

/** Mark the upload complete, making the blob readable by the other device. */
export async function finalizeHealthBlob(input: {
  householdId: string;
  blobId: string;
  chunkCount: number;
}): Promise<RemoteHealthBlobManifest> {
  const res = await apiClient.post<RemoteHealthBlobManifest>(
    `${blobBase(input.householdId, input.blobId)}/finalize`,
    { chunkCount: input.chunkCount },
    { headers: HEALTH_LOCAL_FIRST_HEADERS },
  );
  return res.data;
}

/** `null` for "no such blob" — the one 404 that is an answer, not a failure. */
export async function fetchHealthBlobManifest(
  householdId: string,
  blobId: string,
): Promise<RemoteHealthBlobManifest | null> {
  try {
    const res = await apiClient.get<RemoteHealthBlobManifest>(blobBase(householdId, blobId), {
      headers: HEALTH_LOCAL_FIRST_HEADERS,
    });
    return res.data;
  } catch (error) {
    if (httpStatusOf(error) === 404) return null;
    if (httpStatusOf(error) === 409) throw new HealthBlobIncompleteError(blobId);
    throw error;
  }
}

export async function fetchHealthBlobChunk(
  householdId: string,
  blobId: string,
  chunkIndex: number,
): Promise<Uint8Array> {
  try {
    const res = await apiClient.get<ArrayBuffer>(
      `${blobBase(householdId, blobId)}/chunks/${chunkIndex}`,
      { headers: HEALTH_LOCAL_FIRST_HEADERS, responseType: 'arraybuffer' },
    );
    return new Uint8Array(res.data);
  } catch (error) {
    // 409 is "upload in progress", 404 is "gone or never was" — the route
    // separates them (`local-first-blobs.ts:237-247`) precisely so the client
    // can too.
    if (httpStatusOf(error) === 409) throw new HealthBlobIncompleteError(blobId);
    if (httpStatusOf(error) === 404) throw new HealthBlobMissingError(blobId);
    throw error;
  }
}

/**
 * Tombstone. The Worker keeps the bytes until the checkpoint watermark passes,
 * so this is safe to call the moment the ledger row is deleted — the user's
 * other device, still bootstrapping from an older generation, is not left with
 * a dead reference.
 */
export async function deleteRemoteHealthBlob(householdId: string, blobId: string): Promise<void> {
  try {
    await apiClient.delete(blobBase(householdId, blobId), {
      headers: HEALTH_LOCAL_FIRST_HEADERS,
    });
  } catch (error) {
    // Already gone is the desired end state, not a failure.
    if (httpStatusOf(error) === 404) return;
    throw error;
  }
}

export async function fetchHealthBlobUsage(householdId: string): Promise<RemoteHealthBlobUsage> {
  const res = await apiClient.get<RemoteHealthBlobUsage>(
    `/v2/households/${householdId}/blobs-usage`,
    { headers: HEALTH_LOCAL_FIRST_HEADERS },
  );
  return res.data;
}
