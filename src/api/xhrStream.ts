/**
 * Incremental HTTP reads for React Native.
 *
 * RN's `fetch` never exposes `response.body`, so a streamed response only
 * arrives once it is complete — useless for progress. RN's XHR, by contrast,
 * grows `responseText` as bytes land and fires `onprogress`, and it is the only
 * transport that also reports UPLOAD progress. This module is that one
 * capability, with the framing (NDJSON, SSE) layered on top by the caller.
 *
 * Progress here is always best-effort: if the platform or a proxy coalesces
 * chunks, `onText` simply never fires before completion and the caller still
 * gets the whole body. Nothing may depend on a partial read arriving.
 */

/** Requests carrying a model call, not just bytes — minutes, not seconds. */
const DEFAULT_TIMEOUT_MS = 180_000;

export interface XhrStreamOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: FormData | string | null;
  timeoutMs?: number;
  /** Fraction in [0, 1] of the request body sent. Only fires when measurable. */
  onUploadProgress?: (fraction: number) => void;
  /**
   * The response text received SO FAR (a growing prefix, not a delta), each
   * time more arrives. Callers track their own cursor into it.
   */
  onText?: (text: string) => void;
  /** Message for a transport-level failure (no HTTP status was reached). */
  networkErrorMessage?: string;
  timeoutMessage?: string;
}

export interface XhrStreamResult {
  status: number;
  text: string;
}

/**
 * Issue a request and observe the response as it streams. Resolves for ANY HTTP
 * status (including 4xx/5xx) so the caller can read the error body; it rejects
 * only when no response was reached at all.
 */
export function xhrStream(options: XhrStreamOptions): Promise<XhrStreamResult> {
  const {
    url,
    method = 'POST',
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onUploadProgress,
    onText,
    networkErrorMessage = 'Request failed: network error.',
    timeoutMessage = 'Request timed out. Please try again.',
  } = options;

  return new Promise<XhrStreamResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.timeout = timeoutMs;

    if (onUploadProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onUploadProgress(Math.min(1, event.loaded / event.total));
        }
      };
    }
    if (onText) {
      const read = (): void => onText(xhr.responseText ?? '');
      xhr.onprogress = read;
      // Belt and braces: RN's networking has historically surfaced partial
      // bodies through readyState 3 (what the SSE libraries hook) rather than
      // progress events. Both are cursor-based on the caller's side, so being
      // called twice for the same bytes costs nothing.
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3) read();
      };
    }

    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText ?? '' });
    xhr.onerror = () => reject(new Error(networkErrorMessage));
    xhr.ontimeout = () => reject(new Error(timeoutMessage));

    xhr.send(body);
  });
}

/**
 * Consume complete newline-delimited JSON objects from a growing response,
 * returning the index to resume from. A partial trailing line is left for the
 * next read — every chunk boundary eventually lands mid-line.
 */
export function drainNdjson<T>(
  text: string,
  from: number,
  onValue: (value: T) => void
): number {
  let cursor = from;
  for (;;) {
    const newline = text.indexOf('\n', cursor);
    if (newline === -1) return cursor;
    const line = text.slice(cursor, newline).trim();
    cursor = newline + 1;
    if (!line) continue;
    try {
      onValue(JSON.parse(line) as T);
    } catch {
      // A malformed frame is never worth failing the request over — the
      // terminal frame decides the outcome.
    }
  }
}

/**
 * Consume complete Server-Sent Events from a growing response, returning the
 * index to resume from. Only `data:` payloads are surfaced (the `event:` line is
 * redundant for both providers we read — the JSON carries its own `type`), and
 * the SSE terminator `[DONE]` is skipped.
 */
export function drainSse(
  text: string,
  from: number,
  onData: (data: string) => void
): number {
  let cursor = from;
  for (;;) {
    const newline = text.indexOf('\n', cursor);
    if (newline === -1) return cursor;
    const line = text.slice(cursor, newline).trim();
    cursor = newline + 1;
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    onData(payload);
  }
}
