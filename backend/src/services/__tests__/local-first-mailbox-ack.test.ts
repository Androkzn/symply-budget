import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstMailboxService } from '../local-first-mailbox-service';

/**
 * Ack authorization.
 *
 * Household membership used to be the only check, so any member's device could
 * ack — and, because ack hard-deleted the R2 object, permanently destroy — mail
 * addressed to a different device. The wrapped-HDK envelope a joining member is
 * waiting on (hdkTransfer.ts) travels through this same mailbox, so the blast
 * radius included stranding a new member mid-enrolment.
 */

type BlobRow = {
  id: string;
  household_id: string;
  recipient_device_id: string | null;
  r2_key: string;
  acked_at: string | null;
  expires_at: string;
};

type DeviceRow = { id: string; household_id: string; user_id: string };

function fakeEnv(blobs: BlobRow[], devices: DeviceRow[]) {
  const r2Deletes: string[] = [];

  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM lf_mailbox_blobs')) {
            // Mirrors the real WHERE clause, including the recipient predicate.
            const [id, householdId, deviceId] = bound as [string, string, string];
            const row = blobs.find(
              (b) =>
                b.id === id &&
                b.household_id === householdId &&
                b.acked_at === null &&
                b.recipient_device_id === deviceId,
            );
            return (row ? ({ r2_key: row.r2_key } as unknown as T) : null);
          }
          if (sql.includes('FROM lf_devices')) {
            const [deviceId, householdId, userId] = bound as [string, string, string];
            const row = devices.find(
              (d) => d.id === deviceId && d.household_id === householdId && d.user_id === userId,
            );
            return (row ? ({ ok: 1 } as unknown as T) : null);
          }
          return null;
        },
        async run() {
          if (sql.includes('UPDATE lf_mailbox_blobs SET acked_at')) {
            const [ackedAt, id] = bound as [string, string];
            const row = blobs.find((b) => b.id === id);
            if (row) row.acked_at = ackedAt;
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

  const env = {
    DB,
    REPORTS_BUCKET: {
      async delete(key: string) {
        r2Deletes.push(key);
      },
    },
  } as unknown as Env;

  return { env, r2Deletes };
}

const HH = 'hh_local_test';

function blob(id: string, recipient: string | null): BlobRow {
  return {
    id,
    household_id: HH,
    recipient_device_id: recipient,
    r2_key: `r2/${id}`,
    acked_at: null,
    expires_at: '2099-01-01T00:00:00.000Z',
  };
}

describe('LocalFirstMailboxService.ack', () => {
  it('acks mail addressed to the acking device', async () => {
    const blobs = [blob('b1', 'dev_a')];
    const { env } = fakeEnv(blobs, []);
    const svc = new LocalFirstMailboxService(env);

    expect(await svc.ack(['b1'], HH, 'dev_a')).toBe(1);
    expect(blobs[0]!.acked_at).not.toBeNull();
  });

  it("refuses to ack another device's mail", async () => {
    const blobs = [blob('b1', 'dev_b')];
    const { env } = fakeEnv(blobs, []);
    const svc = new LocalFirstMailboxService(env);

    // Same household, so the old household-only check would have allowed this.
    expect(await svc.ack(['b1'], HH, 'dev_a')).toBe(0);
    expect(blobs[0]!.acked_at).toBeNull();
  });

  it('leaves the wrapped-HDK envelope for the joining device', async () => {
    const blobs = [blob('hdk_envelope', 'dev_joiner')];
    const { env } = fakeEnv(blobs, []);
    const svc = new LocalFirstMailboxService(env);

    expect(await svc.ack(['hdk_envelope'], HH, 'dev_owner')).toBe(0);
    expect(blobs[0]!.acked_at).toBeNull();
    // The joiner can still collect it.
    expect(await svc.ack(['hdk_envelope'], HH, 'dev_joiner')).toBe(1);
  });

  it('does not ack broadcast blobs, so one peer cannot destroy them for the rest', async () => {
    const blobs = [blob('broadcast', null)];
    const { env } = fakeEnv(blobs, []);
    const svc = new LocalFirstMailboxService(env);

    expect(await svc.ack(['broadcast'], HH, 'dev_a')).toBe(0);
    expect(blobs[0]!.acked_at).toBeNull();
  });

  it('does not delete from R2 — sweepExpired reclaims acked blobs', async () => {
    const blobs = [blob('b1', 'dev_a')];
    const { env, r2Deletes } = fakeEnv(blobs, []);
    const svc = new LocalFirstMailboxService(env);

    await svc.ack(['b1'], HH, 'dev_a');
    expect(r2Deletes).toEqual([]);
  });

  it('is a no-op for an empty list', async () => {
    const { env } = fakeEnv([], []);
    const svc = new LocalFirstMailboxService(env);
    expect(await svc.ack([], HH, 'dev_a')).toBe(0);
  });
});

describe('LocalFirstMailboxService.deviceBelongsToUser', () => {
  const devices: DeviceRow[] = [
    { id: 'dev_a', household_id: HH, user_id: 'user_1' },
    { id: 'dev_b', household_id: HH, user_id: 'user_2' },
  ];

  it('accepts a device registered to the user', async () => {
    const { env } = fakeEnv([], devices);
    const svc = new LocalFirstMailboxService(env);
    expect(await svc.deviceBelongsToUser(HH, 'dev_a', 'user_1')).toBe(true);
  });

  it("rejects another user's device", async () => {
    const { env } = fakeEnv([], devices);
    const svc = new LocalFirstMailboxService(env);
    expect(await svc.deviceBelongsToUser(HH, 'dev_b', 'user_1')).toBe(false);
  });

  it('rejects a device from another household', async () => {
    const { env } = fakeEnv([], devices);
    const svc = new LocalFirstMailboxService(env);
    expect(await svc.deviceBelongsToUser('hh_other', 'dev_a', 'user_1')).toBe(false);
  });
});
