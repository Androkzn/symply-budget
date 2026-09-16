import { bytesToHex } from '../crypto/bytes';
import type { LocalFirstStore, StoredOperation } from '../store/types';
import type { DeviceId, HouseholdId } from '../types';

import type {
  ControlPlaneClient,
  MailboxBlob,
  SyncCheckpoint,
  SyncEngine,
  SyncPeer,
} from './types';

const MAILBOX_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * In-process sync stub for Phase 0 tests.
 * Real WebRTC + ZK mailbox land in Phase 3.
 */
export class StubSyncEngine implements SyncEngine {
  constructor(private readonly store: LocalFirstStore) {}

  async getCheckpoint(householdId: HouseholdId): Promise<SyncCheckpoint> {
    const ops = await this.store.listOperationsByHlc(householdId);
    const frontierHlc = ops.length === 0 ? '' : ops[ops.length - 1]!.hlc;
    return {
      householdId,
      frontierHlc,
      opCount: ops.length,
      versionVector: await this.store.getVersionVector(householdId),
    };
  }

  async exchangeWithPeer(
    _peer: SyncPeer,
    peerOps: StoredOperation[],
  ): Promise<StoredOperation[]> {
    // Caller is responsible for verify/apply via OpLog.applyRemote.
    return peerOps.map((op) => ({
      ...op,
      payload: new Uint8Array(op.payload),
      signature: new Uint8Array(op.signature),
    }));
  }
}

/**
 * Ephemeral mailbox for unit tests (not durable, not Cloudflare).
 *
 * Mirrors the relay's paging and wake semantics, and counts both, because storm
 * control cannot be proven without counting deposits and wakes and a paging
 * test against an unbounded stub passes vacuously.
 */
export class MemoryControlPlaneClient implements ControlPlaneClient {
  private readonly devices = new Map<string, { signing: string; agreement: string }>();
  private readonly mailbox = new Map<string, MailboxBlob>();
  private seq = 0;
  private deposits = 0;
  private wakes = 0;
  private readonly maxBlobsPerPage: number;
  private readonly maxBytesPerPage: number;
  private readonly nowMs: () => number;

  constructor(options?: {
    maxBlobsPerPage?: number;
    maxBytesPerPage?: number;
    /**
     * Injectable so a test can actually reach the 14-day blob TTL. With the wall
     * clock hard-wired here while the engine's clock is injected, no test could
     * make a blob expire — and expiry is exactly what makes an over-trusted
     * `sentVv` lose data.
     */
    nowMs?: () => number;
  }) {
    this.maxBlobsPerPage = options?.maxBlobsPerPage ?? 25;
    this.maxBytesPerPage = options?.maxBytesPerPage ?? 4 * 1024 * 1024;
    this.nowMs = options?.nowMs ?? (() => Date.now());
  }

  async registerDevice(input: {
    householdId: HouseholdId;
    deviceId: DeviceId;
    signingPublicKey: Uint8Array;
    agreementPublicKey: Uint8Array;
  }): Promise<void> {
    this.devices.set(`${input.householdId}:${input.deviceId}`, {
      signing: bytesToHex(input.signingPublicKey),
      agreement: bytesToHex(input.agreementPublicKey),
    });
  }

  async depositMailbox(
    blob: Omit<MailboxBlob, 'blobId' | 'createdAt' | 'expiresAt'> & { wake?: boolean },
  ): Promise<MailboxBlob> {
    this.seq += 1;
    const now = this.nowMs();
    const { wake, ...rest } = blob;
    const stored: MailboxBlob = {
      ...rest,
      blobId: `mb-${this.seq}`,
      ciphertext: new Uint8Array(blob.ciphertext),
      createdAt: now,
      expiresAt: now + MAILBOX_TTL_MS,
    };
    this.mailbox.set(stored.blobId, stored);
    this.deposits += 1;
    if (wake !== false) this.wakes += 1;
    return stored;
  }

  async fetchMailbox(
    householdId: HouseholdId,
    deviceId: DeviceId,
    cursor?: string,
  ): Promise<{ blobs: MailboxBlob[]; hasMore: boolean; nextCursor?: string }> {
    const now = this.nowMs();
    // Insertion order IS created_at order here, which is the relay's ordering.
    const ordered = [...this.mailbox.values()].filter(
      (b) =>
        b.householdId === householdId &&
        b.expiresAt > now &&
        (!b.recipientDeviceId || b.recipientDeviceId === deviceId),
    );
    // Mirror the relay: the cursor names the last row of the previous page, and
    // rows before it are gone from this window whether or not they were acked.
    const from = cursor ? ordered.findIndex((b) => b.blobId === cursor) + 1 : 0;
    const all = ordered.slice(from);
    const page: MailboxBlob[] = [];
    let bytes = 0;
    for (const blob of all) {
      // Always return at least one, or a blob larger than the budget would wedge
      // this device's mailbox permanently.
      if (page.length > 0 && (page.length >= this.maxBlobsPerPage || bytes >= this.maxBytesPerPage)) {
        break;
      }
      page.push(blob);
      bytes += blob.ciphertext.length;
    }
    const last = page[page.length - 1];
    return {
      blobs: page,
      hasMore: page.length < all.length,
      ...(last ? { nextCursor: last.blobId } : {}),
    };
  }

  async ackMailbox(blobIds: string[], deviceId: string): Promise<void> {
    for (const id of blobIds) {
      // Mirror the server: only the addressed device may ack. Broadcast blobs
      // are left to expire so acking one recipient cannot destroy the others'.
      const blob = this.mailbox.get(id);
      if (!blob || blob.recipientDeviceId !== deviceId) continue;
      this.mailbox.delete(id);
    }
  }

  deviceCount(): number {
    return this.devices.size;
  }

  depositCount(): number {
    return this.deposits;
  }

  wakeCount(): number {
    return this.wakes;
  }

  depositsFor(deviceId: DeviceId): MailboxBlob[] {
    return [...this.mailbox.values()].filter((b) => b.recipientDeviceId === deviceId);
  }

  resetCounters(): void {
    this.deposits = 0;
    this.wakes = 0;
  }
}
