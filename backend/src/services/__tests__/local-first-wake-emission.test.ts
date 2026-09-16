import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstMailboxService } from '../local-first-mailbox-service';

/**
 * Wake coalescing has to key on the wake, not on the blob.
 *
 * `wasRecentlyWoken` asked "is there any OTHER row to this recipient in the last
 * 10 s" — and a chunked push deposits N-1 rows with `wake: false` before the one
 * that carries the wake. Those predecessors are exactly what the query found, so
 * the final chunk's wake was cancelled by its own chunks: the more chunks a
 * catch-up needed, the more certain it was that NOBODY was woken. It failed
 * hardest in the months-offline catch-up chunking exists to serve.
 *
 * These tests replay the route's composition (deposit each chunk, then decide on
 * the last one) against the real service over an in-memory D1.
 */

const HH = 'hh_wake_emission';
const WINDOW_MS = 10_000;

type BlobRow = {
  id: string;
  household_id: string;
  recipient_device_id: string | null;
  r2_key: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
  acked_at: string | null;
};

/** Minimal D1 + R2 + KV doubles: enough for deposit() and the wake decision. */
function fakeEnv() {
  const rows: BlobRow[] = [];
  const kv = new Map<string, string>();
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('INSERT INTO lf_mailbox_blobs')) return null;
          if (!sql.includes('FROM lf_mailbox_blobs')) return null;
          const [householdId, excludeId, since, recipientNull, recipient] = bound as [
            string,
            string,
            string,
            string | null,
            string | null,
          ];
          const hit = rows.find(
            (b) =>
              b.household_id === householdId &&
              b.id !== excludeId &&
              b.created_at > since &&
              ((recipientNull === null && b.recipient_device_id === null) ||
                b.recipient_device_id === recipient),
          );
          return hit ? ({ ok: 1 } as unknown as T) : null;
        },
        async run() {
          if (sql.includes('INSERT INTO lf_mailbox_blobs')) {
            const [id, household_id, recipient_device_id, r2_key, size_bytes, created_at, expires_at] =
              bound as [string, string, string | null, string, number, string, string];
            rows.push({
              id,
              household_id,
              recipient_device_id,
              r2_key,
              size_bytes,
              created_at,
              expires_at,
              acked_at: null,
            });
          }
          return { success: true };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return api;
    },
  };
  const REPORTS_BUCKET = {
    async put() {
      return undefined;
    },
  };
  const CONFIG_KV = {
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.set(key, value);
    },
  };
  return { env: { DB, REPORTS_BUCKET, CONFIG_KV } as unknown as Env, rows };
}

/** Exactly what POST /households/:id/mailbox does, chunk by chunk. */
async function push(
  svc: LocalFirstMailboxService,
  input: { chunks: number; recipient: string | null },
): Promise<number> {
  let wakes = 0;
  for (let i = 0; i < input.chunks; i += 1) {
    // The client marks every chunk but the last `wake: false`.
    const wake = i === input.chunks - 1;
    await svc.deposit({
      householdId: HH,
      recipientDeviceId: input.recipient,
      ciphertext: new Uint8Array([1, 2, 3]).buffer,
    });
    if (wake !== false && (await svc.claimWake(HH, input.recipient, WINDOW_MS))) {
      wakes += 1;
    }
  }
  return wakes;
}

describe('sync wake emission', () => {
  it('fires exactly one wake for a five-chunk push', async () => {
    const { env, rows } = fakeEnv();
    const svc = new LocalFirstMailboxService(env);
    // Was 0: the four wake-less chunks suppressed the fifth chunk's wake.
    expect(await push(svc, { chunks: 5, recipient: 'dev_a' })).toBe(1);
    expect(rows).toHaveLength(5);
  });

  it('fires one wake for a ten-chunk push too', async () => {
    const { env } = fakeEnv();
    const svc = new LocalFirstMailboxService(env);
    expect(await push(svc, { chunks: 10, recipient: 'dev_a' })).toBe(1);
  });

  it('still coalesces two separate pushes inside the window', async () => {
    const { env } = fakeEnv();
    const svc = new LocalFirstMailboxService(env);
    expect(await push(svc, { chunks: 3, recipient: 'dev_a' })).toBe(1);
    expect(await push(svc, { chunks: 3, recipient: 'dev_a' })).toBe(0);
  });

  it('does not let one recipient suppress another', async () => {
    const { env } = fakeEnv();
    const svc = new LocalFirstMailboxService(env);
    expect(await push(svc, { chunks: 4, recipient: 'dev_a' })).toBe(1);
    expect(await push(svc, { chunks: 4, recipient: 'dev_b' })).toBe(1);
    // Broadcast is its own mailbox again.
    expect(await push(svc, { chunks: 1, recipient: null })).toBe(1);
  });

  it('wakes again once the window has passed', async () => {
    const { env } = fakeEnv();
    const svc = new LocalFirstMailboxService(env);
    expect(await push(svc, { chunks: 2, recipient: 'dev_a' })).toBe(1);
    // A zero-length window is "no wake in the last 0 ms", i.e. always allowed.
    expect(await svc.claimWake(HH, 'dev_a', 0)).toBe(true);
  });

  it('wakes rather than staying silent when no wake store is configured', async () => {
    const { env } = fakeEnv();
    const svc = new LocalFirstMailboxService({ ...env, CONFIG_KV: undefined } as unknown as Env);
    // A missed wake costs a member their sync until next foreground; a duplicate
    // wake costs a push notification nobody sees.
    expect(await push(svc, { chunks: 3, recipient: 'dev_a' })).toBe(1);
    expect(await push(svc, { chunks: 3, recipient: 'dev_a' })).toBe(1);
  });
});
