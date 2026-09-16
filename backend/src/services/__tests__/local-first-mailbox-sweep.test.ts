import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstMailboxService } from '../local-first-mailbox-service';

type BlobRow = {
  id: string;
  r2_key: string;
  expires_at: string;
  acked_at: string | null;
};

function fakeEnv(blobs: BlobRow[]) {
  const r2Deletes: string[] = [];
  const deletedIds: string[] = [];
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async all<T>() {
          if (sql.includes('expires_at <= ?') && !sql.includes('acked_at')) {
            const [now] = bound as [string];
            return {
              results: blobs.filter((b) => b.expires_at <= now) as unknown as T[],
            };
          }
          if (sql.includes('acked_at IS NOT NULL')) {
            return {
              results: blobs.filter((b) => b.acked_at !== null) as unknown as T[],
            };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('DELETE FROM lf_mailbox_blobs')) {
            const [id] = bound as [string];
            deletedIds.push(id);
          }
          return { success: true };
        },
        async first() {
          return null;
        },
      };
      return api;
    },
  };
  return {
    env: {
      DB,
      REPORTS_BUCKET: {
        async delete(key: string) {
          r2Deletes.push(key);
        },
      },
    } as unknown as Env,
    r2Deletes,
    deletedIds,
  };
}

describe('mailbox sweepExpired', () => {
  it('uses separate expired and acked queries instead of OR', async () => {
    // Dates are RELATIVE to the real clock, because `sweepExpired()` reads it —
    // it stamps `new Date().toISOString()` and compares `expires_at <= now`.
    //
    // The fixture used to pin absolute dates with the "future" rows at
    // 2026-09-01T00:00:00Z. That was future when it was written and became the
    // past on 2026-09-01, at which point `live` and `acked` both matched the
    // expired query, the sweep removed all three, and the suite failed with
    // `expected 3 to be 2` — a time bomb with a fixed fuse, in a test whose
    // subject has nothing to do with dates.
    //
    // Anchoring to `Date.now()` keeps the three rows in the relationship the
    // assertion is about — one past its TTL, one acked, one still live — on
    // every day this ever runs.
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 30 * DAY).toISOString();
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    const blobs: BlobRow[] = [
      { id: 'expired', r2_key: 'r2/expired', expires_at: past, acked_at: null },
      { id: 'acked', r2_key: 'r2/acked', expires_at: future, acked_at: now },
      { id: 'live', r2_key: 'r2/live', expires_at: future, acked_at: null },
    ];
    const { env, r2Deletes, deletedIds } = fakeEnv(blobs);
    const removed = await new LocalFirstMailboxService(env).sweepExpired();
    expect(removed).toBe(2);
    expect(r2Deletes.sort()).toEqual(['r2/acked', 'r2/expired']);
    expect(deletedIds.sort()).toEqual(['acked', 'expired']);
  });
});
