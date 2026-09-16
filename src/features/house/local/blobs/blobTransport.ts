/**
 * `/v2` transport for the House attachment channel (plan §8, stage H6).
 *
 * Chunk bodies move as raw `application/octet-stream` in both directions — the
 * Worker streams them to and from R2 without parsing. That is not just a
 * performance choice: a JSON envelope would put base64 ciphertext through the
 * Worker's parser, inflate every chunk by a third, and blur the "the body is
 * opaque" property the whole channel rests on.
 *
 * **Uploads go through `putUploadViaXhr`, not `apiClient.put`.** This is the
 * lesson `households.ts:370` already records: *"axios in React Native does not
 * reliably send a Blob as a raw binary body"*. The H6 DoD calls for the upload
 * mechanism to be normalized on the Worker-proxied XHR PUT path rather than
 * letting the encrypted channel inherit House's third fork of it. Downloads use
 * `apiClient.get` with `responseType: 'arraybuffer'`, which axios does handle.
 */
import { apiClient } from '@api/client';
import { HttpUploadError, putUploadViaXhr } from '@api/e2ePutUpload';
import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

const LF_HEADERS = { 'X-House-Local-First': '1' };

export type RemoteBlobManifest = {
  blobId: string;
  keyEpoch: number;
  chunkCount: number;
  cipherBytes: number;
  status: 'pending' | 'complete' | 'tombstoned';
  createdAt?: string;
};

export type RemoteBlobUsage = {
  blobCount: number;
  cipherBytes: number;
  softLimitBytes: number;
  hardLimitBytes: number;
  overSoftLimit: boolean;
};

/**
 * The household is out of attachment storage (Q5 hard stop). Distinct from a
 * transport failure because the retry policy is opposite: this one must never be
 * retried, only surfaced.
 */
export class HouseBlobQuotaError extends Error {
  readonly code = 'blob_quota_exceeded';
  constructor(
    readonly limitBytes: number,
    readonly usedBytes: number,
  ) {
    super('Household attachment storage is full');
    this.name = 'HouseBlobQuotaError';
  }
}

/** The blob exists but not every chunk has landed yet — a peer should retry. */
export class HouseBlobIncompleteError extends Error {
  readonly code = 'blob_incomplete';
  constructor(readonly blobId: string) {
    super('Attachment is still uploading');
    this.name = 'HouseBlobIncompleteError';
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
 * freshly sealed copy. See `sealBlobChunk`'s nonce-reuse note.
 */
export async function putBlobChunk(input: {
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
      label: 'lf-blob',
      logKind: 'network',
      networkPath: path,
      onProgress: input.onProgress,
      headers: {
        ...LF_HEADERS,
        'X-LF-Chunk-Count': String(input.chunkCount),
        'X-LF-Key-Epoch': String(input.keyEpoch),
      },
    });
  } catch (error) {
    if (error instanceof HttpUploadError && error.code === 'quota_exceeded') {
      const detail = (error.body as { error?: { limit?: number; used?: number } } | null)?.error;
      throw new HouseBlobQuotaError(Number(detail?.limit ?? 0), Number(detail?.used ?? 0));
    }
    throw error;
  }
}

/** Mark the upload complete, making the blob readable by peers. */
export async function finalizeBlob(input: {
  householdId: string;
  blobId: string;
  chunkCount: number;
}): Promise<RemoteBlobManifest> {
  const res = await apiClient.post<RemoteBlobManifest>(
    `${blobBase(input.householdId, input.blobId)}/finalize`,
    { chunkCount: input.chunkCount },
    { headers: LF_HEADERS },
  );
  return res.data;
}

export async function fetchBlobManifest(
  householdId: string,
  blobId: string,
): Promise<RemoteBlobManifest | null> {
  try {
    const res = await apiClient.get<RemoteBlobManifest>(blobBase(householdId, blobId), {
      headers: LF_HEADERS,
    });
    return res.data;
  } catch (error) {
    if (httpStatusOf(error) === 404) return null;
    if (httpStatusOf(error) === 409) throw new HouseBlobIncompleteError(blobId);
    throw error;
  }
}

export async function fetchBlobChunk(
  householdId: string,
  blobId: string,
  chunkIndex: number,
): Promise<Uint8Array> {
  try {
    const res = await apiClient.get<ArrayBuffer>(
      `${blobBase(householdId, blobId)}/chunks/${chunkIndex}`,
      { headers: LF_HEADERS, responseType: 'arraybuffer' },
    );
    return new Uint8Array(res.data);
  } catch (error) {
    if (httpStatusOf(error) === 409) throw new HouseBlobIncompleteError(blobId);
    throw error;
  }
}

/**
 * Tombstone. The Worker keeps the bytes until the checkpoint watermark passes
 * (Q4), so this is safe to call the moment the ledger row is deleted — a peer
 * still bootstrapping from an older generation is not left with a dead link.
 */
export async function deleteRemoteBlob(householdId: string, blobId: string): Promise<void> {
  try {
    await apiClient.delete(blobBase(householdId, blobId), { headers: LF_HEADERS });
  } catch (error) {
    // Already gone is the desired end state, not a failure.
    if (httpStatusOf(error) === 404) return;
    throw error;
  }
}

export async function fetchBlobUsage(householdId: string): Promise<RemoteBlobUsage> {
  const res = await apiClient.get<RemoteBlobUsage>(
    `/v2/households/${householdId}/blobs-usage`,
    { headers: LF_HEADERS },
  );
  return res.data;
}
