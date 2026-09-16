import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstMailboxService } from '../local-first-mailbox-service';

/**
 * Mailbox paging.
 *
 * Chunked push turns one deposit into many, so a count-only LIMIT lets a
 * bootstrap build an unbounded base64 response in Worker memory (100 blobs x
 * 384 KB is ~51 MB). `size_bytes` is already stored on every row, so a byte
 * budget costs nothing to enforce.
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

const HH = 'hh_local_test';

function row(input: {
  id: string;
  size: number;
  recipient?: string | null;
  acked?: boolean;
  expired?: boolean;
  createdAt?: string;
}): BlobRow {
  return {
    id: input.id,
    household_id: HH,
    recipient_device_id: input.recipient === undefined ? 'dev_a' : input.recipient,
    r2_key: `r2/${input.id}`,
    size_bytes: input.size,
    created_at: input.createdAt ?? `2026-08-12T00:00:${input.id.padStart(2, '0')}.000Z`,
    expires_at: input.expired ? '2000-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
    acked_at: input.acked ? '2026-08-12T00:00:00.000Z' : null,
  };
}

/** Mirrors the real WHERE clause, including the `LIMIT ?` bind. */
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
          const [householdId, now, deviceId, limit] = bound as [string, string, string, number];
          const results = blobs
            .filter(
              (b) =>
                b.household_id === householdId &&
                b.acked_at === null &&
                b.expires_at > now &&
                (b.recipient_device_id === null || b.recipient_device_id === deviceId),
            )
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .slice(0, limit);
          return { results: results as unknown as T[] };
        },
      };
      return api;
    },
  };
  return { DB } as unknown as Env;
}

const MB = 1024 * 1024;

describe('LocalFirstMailboxService.listForDevice paging', () => {
  it('cuts on maxBlobs when the blobs are small', async () => {
    const blobs = Array.from({ length: 40 }, (_, i) =>
      row({ id: String(i + 1).padStart(2, '0'), size: 1024 }),
    );
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));
    const page = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 25, maxTotalBytes: 4 * MB });
    expect(page.rows).toHaveLength(25);
    expect(page.hasMore).toBe(true);
  });

  it('cuts on maxTotalBytes before maxBlobs when the blobs are large', async () => {
    const blobs = Array.from({ length: 10 }, (_, i) =>
      row({ id: String(i + 1).padStart(2, '0'), size: 1.5 * MB }),
    );
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));
    const page = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 25, maxTotalBytes: 4 * MB });
    // Two fit (3 MB); a third would take the response to 4.5 MB, over budget.
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('reports hasMore false when nothing was withheld', async () => {
    const blobs = [row({ id: '01', size: 10 }), row({ id: '02', size: 10 })];
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));
    const page = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 25, maxTotalBytes: 4 * MB });
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(false);
  });

  it('still returns a single blob larger than the whole byte budget', async () => {
    // Otherwise that device's mailbox is wedged permanently.
    const blobs = [row({ id: '01', size: 9 * MB }), row({ id: '02', size: 10 })];
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));
    const page = await svc.listForDevice(HH, 'dev_a', { maxBlobs: 25, maxTotalBytes: 4 * MB });
    expect(page.rows.map((r) => r.id)).toEqual(['01']);
    expect(page.hasMore).toBe(true);
  });

  it('still excludes acked, expired and other devices mail', async () => {
    const blobs = [
      row({ id: '01', size: 10, acked: true }),
      row({ id: '02', size: 10, expired: true }),
      row({ id: '03', size: 10, recipient: 'dev_b' }),
      row({ id: '04', size: 10, recipient: null }),
      row({ id: '05', size: 10 }),
    ];
    const svc = new LocalFirstMailboxService(fakeEnv(blobs));
    const page = await svc.listForDevice(HH, 'dev_a');
    expect(page.rows.map((r) => r.id)).toEqual(['04', '05']);
  });
});
