/**
 * Shared XHR PUT uploader with E2E observability for presigned R2 and Worker upload endpoints.
 */
import { summarizeHttpResponseBody } from './e2eResponseSummary';
import {
  recordE2ENetworkEntry,
  recordE2ER2UploadEntry,
} from './e2eTestObservability';

export type PutUploadViaXhrOptions = {
  uploadUrl: string;
  body: Blob | ArrayBuffer;
  contentType: string;
  authorization?: string | null;
  /** Short label for dumps, e.g. report | floor-plan | task-photo */
  label?: string;
  onProgress?: (progressPercent: number) => void;
  /**
   * `r2` — presigned object storage PUT (default).
   * `network` — Worker-relative API PUT (e.g. household photo).
   */
  logKind?: 'r2' | 'network';
  /** Required when logKind is `network` — path logged in [E2E-NET] (no host/query). */
  networkPath?: string;
  /**
   * Extra request headers. Added for the House V2 encrypted blob channel, whose
   * chunk framing (`X-LF-Chunk-Count`, `X-LF-Key-Epoch`) has to ride in headers
   * so the Worker never has to parse the ciphertext body.
   */
  headers?: Record<string, string>;
};

/**
 * A non-2xx upload response, carrying the status and the parsed error envelope.
 *
 * `putUploadViaXhr` used to reject with a bare `Error`, which loses everything a
 * caller needs to decide whether to retry: a 507 "household is out of storage"
 * and a 502 relay blip are the same string. Still an `Error` subclass, so
 * existing `catch (e) { e.message }` callers are unaffected.
 */
export class HttpUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'HttpUploadError';
  }
}

function parseUploadErrorBody(xhr: XMLHttpRequest): {
  message: string;
  code: string | null;
  body: unknown;
} {
  const fallback = `Upload failed with status ${xhr.status}`;
  try {
    const responseText = xhr.responseText || xhr.response;
    if (!responseText) return { message: fallback, code: null, body: null };
    const parsed = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
    if (!parsed || typeof parsed !== 'object') {
      return { message: fallback, code: null, body: parsed };
    }
    const body = parsed as Record<string, unknown>;
    // Two envelopes are in the field: the flat `{ error: 'text' }` the legacy
    // upload routes return, and the `{ error: { code, message } }` shape every
    // `/v2` route uses. Stringifying the second yields "[object Object]", which
    // is how a real quota rejection used to reach the user.
    const nested =
      body.error && typeof body.error === 'object'
        ? (body.error as Record<string, unknown>)
        : null;
    if (nested) {
      return {
        message: String(nested.message ?? fallback),
        code: typeof nested.code === 'string' ? nested.code : null,
        body: parsed,
      };
    }
    return {
      message: String(body.error ?? body.message ?? fallback),
      code: typeof body.code === 'string' ? body.code : null,
      body: parsed,
    };
  } catch {
    return {
      message: `${fallback}: ${xhr.responseText || xhr.response}`,
      code: null,
      body: null,
    };
  }
}

function logUploadResult(
  options: PutUploadViaXhrOptions,
  status: number,
  ok: boolean,
  responseText?: string,
): void {
  if (!__DEV__) return;

  let detail: string | undefined;
  if (responseText) {
    try {
      const parsed = JSON.parse(responseText);
      detail = summarizeHttpResponseBody(parsed, { isError: !ok });
    } catch {
      detail = ok ? undefined : 'parseError';
    }
  }
  if (options.label) {
    detail = detail ? `${options.label} ${detail}` : options.label;
  }

  if (options.logKind === 'network') {
    recordE2ENetworkEntry({
      method: 'PUT',
      url: options.networkPath ?? options.uploadUrl,
      status,
      ok,
      detail,
    });
    return;
  }

  recordE2ER2UploadEntry({
    uploadUrl: options.uploadUrl,
    status,
    ok,
    label: options.label,
    detail,
  });
}

/** PUT bytes via XHR — used for presigned R2 uploads and Worker photo PUT. */
export function putUploadViaXhr<T = void>(
  options: PutUploadViaXhrOptions,
): Promise<T> {
  const { uploadUrl, body, contentType, authorization, onProgress } = options;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);
    if (authorization) {
      xhr.setRequestHeader('Authorization', `Bearer ${authorization}`);
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      logUploadResult(options, xhr.status, ok, xhr.responseText || undefined);

      if (ok) {
        if (!xhr.responseText) {
          resolve(undefined as T);
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          resolve(undefined as T);
        }
        return;
      }

      const parsed = parseUploadErrorBody(xhr);
      reject(new HttpUploadError(parsed.message, xhr.status, parsed.code, parsed.body));
    };

    xhr.onerror = () => {
      logUploadResult(options, xhr.status || 0, false);
      reject(new Error('Upload failed: Network error. Please check your connection.'));
    };

    xhr.ontimeout = () => {
      logUploadResult(options, 0, false, 'timeout');
      reject(new Error('Upload failed: timeout'));
    };

    xhr.send(body);
  });
}
