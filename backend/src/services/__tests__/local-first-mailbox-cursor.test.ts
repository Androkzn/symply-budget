import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstMailboxService } from '../local-first-mailbox-service';

/**
 * Paging needs a server cursor, not ack.
 *
 * `listForDevice` returns the oldest undelivered rows, and the client used to
 * rely on acking a page to make the next fetch return the next one. A broadcast
 * blob is deliberately NOT ackable — it is addressed to every peer, so honouring
 * one recipient's ack would destroy it for the others — and neither is a blob
 * whose ops were refused for a retryable reason. One page's worth of those makes
 * every subsequent page identical to the first and wedges the mailbox for the
 * full 14-day TTL. With a (created_at, id) cursor the window always advances.
 */

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

const HH = 'hh_cursor_test';

function row(id: string, createdAt: string, recipient: string | null = 'dev_a'): BlobRow {
  return {
    id,
    household_id: HH,
    recipient_device_id: recipient,
    r2_key: `r2/${id}`,
    size_bytes: 10,
    created_at: createdAt,
    expires_at: '2099-01-01T00:00:00.000Z',
    acked_at: null,
  };
}

/** Mirrors the real WHERE/ORDER BY, including the optional cursor binds. */
function fakeEnv(blobs: BlobRow[]) {
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async first<T>(): Promise<T | null> {
          return null as unknown as T | null;
        },
        async run() {
          return { success: true };
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (!sql.includes('FROM lf_mailbox_blobs')) return { results: [] as T[] };
          const hasCursor = sql.includes('created_at > ?');
          let i = 0;
          const householdId = bound[i++] as string;
          const now = bound[i++] as string;
          const deviceId = bound[i++] as string;
          let afterCreatedAt: string | null = null;
          let afterId: string | null = null;
          if (hasCursor) {
            afterCreatedAt = bound[i++] as string;
            i += 1; // the same value, bound twice
            afterId = bound[i++] as string;
          }
          const limit = bound[i++] as number;
          const results = blobs
            .filter(
              (b) =>
                b.household_id === householdId &&
                b.acked_at === null &&
                b.expires_at > now &&
                (b.recipient_device_id === null || b.recipient_device_id === deviceId) &&
                (!hasCursor ||
                  b.created_at > (afterCreatedAt as string) ||
                  (b.created_at === afterCreatedAt && b.id > (afterId as string))),
            )
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
            .slice(0, limit);
          return { results: results as unknown as T[] };
        },
      };
      return api;
    },
  };
  return { DB } as unknown as Env;
}

function at(second: number): string {
  return `2026-08-12T00:00:${String(second).padStart(2, '0')}.000Z`;
}

describe('LocalFirstMailboxService.listForDevice cursor', () => {
  it('walks the whole mailbox across pages without a single ack', async () => {
    const blobs = Array.from({ length: 7 }, (_, i) => row(`b${i + 1}`, at(i + 1)));
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));

    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let page = 0; page < 5; page += 1) {
      const res = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 3, after: cursor });
      seen.push(...res.rows.map((r) => r.id));
      if (!res.hasMore || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    // Was: b1,b2,b3 for ever, because nothing here is ackable.
    expect(seen).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
  });

  it('does not skip a row that shares a created_at with the page boundary', async () => {
    // Millisecond ties are routine: a chunked push deposits in a tight loop.
    const blobs = [
      row('b1', at(1)),
      row('b2', at(2)),
      row('b3', at(2)),
      row('b4', at(2)),
      row('b5', at(3)),
    ];
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));
    const first = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 2 });
    expect(first.rows.map((r) => r.id)).toEqual(['b1', 'b2']);
    const second = await svc.listForDevice(HH, 'dev_a', {
      maxBlobs: 2,
      after: first.nextCursor,
    });
    expect(second.rows.map((r) => r.id)).toEqual(['b3', 'b4']);
    const third = await svc.listForDevice(HH, 'dev_a', {
      maxBlobs: 2,
      after: second.nextCursor,
    });
    expect(third.rows.map((r) => r.id)).toEqual(['b5']);
    expect(third.hasMore).toBe(false);
  });

  it('reports no cursor for an empty page', async () => {
    const svc = new LocalFirstMailboxService(fakeEnv([]));
    const page = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 3 });
    expect(page.rows).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });
});
