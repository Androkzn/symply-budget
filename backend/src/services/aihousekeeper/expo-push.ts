/**
 * Workers-safe Expo push client — plan §B16.
 *
 * The `expo-server-sdk-node` package pulls in Node-only deps (zlib, streams)
 * and fails on workerd (expo/expo #41473). This is a minimal raw-fetch
 * wrapper over Expo's push HTTP API with:
 *   - 100-message chunking (Expo's per-request cap).
 *   - Optional bearer-auth (Expo access token).
 *   - Jittered exponential backoff on 429/5xx, max 3 attempts.
 */

export interface ExpoPushMessage {
  to: string; // ExponentPushToken[...]
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  _contentAvailable?: boolean;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string; // present when ok
  message?: string; // present when error
  details?: Record<string, unknown>;
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: Array<{ code?: string; message: string }>;
}

export interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: Record<string, unknown>;
}

interface ExpoReceiptsResponse {
  data?: Record<string, ExpoPushReceipt>;
  errors?: Array<{ code?: string; message: string }>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const CHUNK_SIZE = 100;
const MAX_ATTEMPTS = 3;

export class ExpoPushClient {
  private accessToken?: string;

  constructor(accessToken?: string) {
    this.accessToken = accessToken;
  }

  async sendBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) return [];
    const results: ExpoPushTicket[] = [];
    for (const chunk of chunksOf(messages, CHUNK_SIZE)) {
      const tickets = await this.sendChunkWithRetry(chunk);
      results.push(...tickets);
    }
    return results;
  }

  private async sendChunkWithRetry(
    chunk: ExpoPushMessage[]
  ): Promise<ExpoPushTicket[]> {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        };
        if (this.accessToken) {
          headers.Authorization = `Bearer ${this.accessToken}`;
        }
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(chunk),
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt < MAX_ATTEMPTS) {
            await delay(jitteredBackoffMs(attempt));
            continue;
          }
          throw new Error(
            `Expo push retryable error: ${res.status} ${await safeText(res)}`
          );
        }
        if (!res.ok) {
          throw new Error(
            `Expo push failed: ${res.status} ${await safeText(res)}`
          );
        }
        const json = (await res.json()) as ExpoPushResponse;
        if (json.errors && json.errors.length > 0) {
          throw new Error(
            `Expo push responded with errors: ${json.errors
              .map((e) => e.message)
              .join('; ')}`
          );
        }
        return json.data ?? [];
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_ATTEMPTS) {
          await delay(jitteredBackoffMs(attempt));
          continue;
        }
      }
    }
    throw lastError ?? new Error('Expo push failed with unknown error');
  }

  /**
   * Look up delivery receipts for previously sent ticket IDs. A 'ok' send
   * ticket only means Expo accepted the request — this is the only way to
   * learn about actual APNs/FCM delivery failures (DeviceNotRegistered,
   * InvalidCredentials, MessageTooBig, etc). Expo recommends checking a few
   * minutes after sending; receipts are retained for roughly a day.
   */
  async getReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
    if (ids.length === 0) return {};
    const result: Record<string, ExpoPushReceipt> = {};
    for (const chunk of chunksOf(ids, CHUNK_SIZE)) {
      const receipts = await this.getReceiptsChunkWithRetry(chunk);
      Object.assign(result, receipts);
    }
    return result;
  }

  private async getReceiptsChunkWithRetry(
    ids: string[]
  ): Promise<Record<string, ExpoPushReceipt>> {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        };
        if (this.accessToken) {
          headers.Authorization = `Bearer ${this.accessToken}`;
        }
        const res = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ids }),
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt < MAX_ATTEMPTS) {
            await delay(jitteredBackoffMs(attempt));
            continue;
          }
          throw new Error(
            `Expo receipts retryable error: ${res.status} ${await safeText(res)}`
          );
        }
        if (!res.ok) {
          throw new Error(
            `Expo receipts failed: ${res.status} ${await safeText(res)}`
          );
        }
        const json = (await res.json()) as ExpoReceiptsResponse;
        if (json.errors && json.errors.length > 0) {
          throw new Error(
            `Expo receipts responded with errors: ${json.errors
              .map((e) => e.message)
              .join('; ')}`
          );
        }
        return json.data ?? {};
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_ATTEMPTS) {
          await delay(jitteredBackoffMs(attempt));
          continue;
        }
      }
    }
    throw lastError ?? new Error('Expo receipts failed with unknown error');
  }
}

function chunksOf<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function jitteredBackoffMs(attempt: number): number {
  // Base 250ms, exp growth, +/- 50% jitter.
  const base = 250 * 2 ** (attempt - 1);
  const jitter = base * 0.5 * (Math.random() * 2 - 1);
  return Math.max(100, Math.floor(base + jitter));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
