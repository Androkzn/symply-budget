/**
 * Streaming receipt scan against the Worker — the same work as
 * `POST /budget/receipts/scan`, read as NDJSON so the UI can report honest
 * progress instead of parking on a spinner for the ~10-30s the model spends
 * reading a receipt.
 *
 * Leaving axios for {@link xhrStream} (the only RN transport that streams, see
 * that module) costs us `apiClient`'s interceptors, so the two that matter are
 * re-implemented here — bearer auth with a single 401 refresh-and-retry, and
 * the E2E network block — and nothing else.
 *
 * Progress is a courtesy, never a requirement. If chunks arrive coalesced, no
 * `items` callback fires and the final `result` line still resolves the
 * promise. If the endpoint is missing entirely (app newer than the deployed
 * Worker) this throws {@link ReceiptScanStreamUnsupportedError} so the caller
 * can fall back to the buffered upload.
 */
import { ENV } from '@config/env';
import { isE2ENetworkBlocked } from '@services/e2e-network-block';
import { useAuthStore } from '@stores/authStore';

import type { GroceryReceiptScanResult } from './budget';
import { refreshAccessToken } from './client';
import { drainNdjson, xhrStream } from './xhrStream';

export interface ReceiptScanFile {
  uri: string;
  type: string;
  name: string;
}

export interface ReceiptScanStreamCallbacks {
  /** Fraction in [0, 1] of the request body that has reached the server. */
  onUploadProgress?: (fraction: number) => void;
  /** Receipt lines the model has written so far. Monotonic, total unknown. */
  onItems?: (count: number) => void;
}

/**
 * The streaming endpoint is unavailable (404/405) — the caller should retry
 * against the buffered scan route rather than surface an error.
 */
export class ReceiptScanStreamUnsupportedError extends Error {
  constructor(message = 'Streaming receipt scan is not available') {
    super(message);
    this.name = 'ReceiptScanStreamUnsupportedError';
  }
}

/** One NDJSON frame from the Worker. Unknown `type`s are ignored by design. */
type ScanStreamEvent =
  | { type: 'start'; segments: number }
  | { type: 'items'; count: number }
  | { type: 'result'; result: GroceryReceiptScanResult }
  | { type: 'error'; message: string };

function buildScanFormData(
  files: ReceiptScanFile | ReceiptScanFile[],
  region?: { country?: string | null; stateProvince?: string | null },
  aliases?: Array<{ key: string; name: string; categoryId?: string | null }>
): FormData {
  const list = Array.isArray(files) ? files : [files];
  const formData = new FormData();
  for (const file of list) {
    formData.append('file', {
      uri: file.uri,
      type: file.type,
      name: file.name,
    } as unknown as Blob);
  }
  if (region?.country) formData.append('country', region.country);
  if (region?.stateProvince) formData.append('state_province', region.stateProvince);
  if (aliases && aliases.length > 0) formData.append('aliases', JSON.stringify(aliases));
  return formData;
}

/** Extract the API's error text from a non-2xx JSON body, if it has one. */
function errorMessageFrom(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error : fallback;
  } catch {
    return fallback;
  }
}

interface ScanStreamResponse {
  status: number;
  result?: GroceryReceiptScanResult;
  error?: string;
}

async function postScanStream(
  householdId: string,
  formData: FormData,
  token: string | null,
  callbacks: ReceiptScanStreamCallbacks
): Promise<ScanStreamResponse> {
  let result: GroceryReceiptScanResult | undefined;
  let streamedError: string | undefined;
  let cursor = 0;

  const consume = (text: string): void => {
    cursor = drainNdjson<ScanStreamEvent>(text, cursor, (event) => {
      if (event.type === 'items') callbacks.onItems?.(event.count);
      else if (event.type === 'result') result = event.result;
      else if (event.type === 'error') streamedError = event.message;
    });
  };

  const response = await xhrStream({
    url: `${ENV.API_BASE_URL}/households/${householdId}/budget/receipts/scan/stream`,
    // Content-Type is deliberately unset: RN derives the multipart boundary.
    headers: {
      Accept: 'application/x-ndjson',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
    onUploadProgress: callbacks.onUploadProgress,
    // Only a 200 body is NDJSON; an error status carries a single JSON object
    // that must not be line-parsed.
    onText: (text) => {
      if (result === undefined && streamedError === undefined) consume(text);
    },
    networkErrorMessage: 'Receipt scan failed: network error.',
    timeoutMessage: 'Receipt scan timed out. Please try again.',
  });

  if (response.status === 200) consume(response.text);

  return {
    status: response.status,
    result,
    error:
      streamedError ??
      (response.status === 200
        ? undefined
        : errorMessageFrom(response.text, `Receipt scan failed (${response.status})`)),
  };
}

/**
 * Scan a receipt against the Worker, reporting progress as it goes. Resolves
 * with the same {@link GroceryReceiptScanResult} the buffered endpoint returns.
 */
export async function scanReceiptStreaming(
  householdId: string,
  files: ReceiptScanFile | ReceiptScanFile[],
  region: { country?: string | null; stateProvince?: string | null } | undefined,
  aliases: Array<{ key: string; name: string; categoryId?: string | null }> | undefined,
  callbacks: ReceiptScanStreamCallbacks = {}
): Promise<GroceryReceiptScanResult> {
  if (isE2ENetworkBlocked()) {
    throw new Error('Network unavailable');
  }

  const send = (token: string | null): Promise<ScanStreamResponse> =>
    postScanStream(householdId, buildScanFormData(files, region, aliases), token, callbacks);

  let response = await send(useAuthStore.getState().token);

  // The one interceptor worth re-implementing: a token that expired between the
  // screen opening and the user tapping Scan would otherwise dead-end here.
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await send(refreshed);
  }

  if (response.status === 404 || response.status === 405) {
    throw new ReceiptScanStreamUnsupportedError();
  }
  if (response.result) return response.result;
  throw new Error(response.error ?? 'Could not read the receipt. Please try again.');
}
