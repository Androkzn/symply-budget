import type { StoredOperation, VersionVector } from '../store/types';
import type { Bytes, DeviceId, HouseholdId } from '../types';

export type SyncTransportKind = 'webrtc' | 'mailbox' | 'stub';

export interface SyncPeer {
  deviceId: DeviceId;
  signingPublicKey: Bytes;
  agreementPublicKey: Bytes;
  lastSeenAt?: number;
}

export interface SyncCheckpoint {
  householdId: HouseholdId;
  /**
   * Max HLC. DISPLAY AND DIAGNOSTICS ONLY — it is precisely the unsound scalar
   * cursor this stage removed (see VersionVector). Never use it to decide what
   * to send.
   */
  frontierHlc: string;
  opCount: number;
  /** The authoritative cursor. */
  versionVector: VersionVector;
}

export interface MailboxBlob {
  blobId: string;
  householdId: HouseholdId;
  recipientDeviceId?: DeviceId;
  ciphertext: Bytes;
  createdAt: number;
  expiresAt: number;
}

export interface SyncEngine {
  getCheckpoint(householdId: HouseholdId): Promise<SyncCheckpoint>;
  /** Exchange ops with an in-process peer (Phase 0 stub). */
  exchangeWithPeer(peer: SyncPeer, peerOps: StoredOperation[]): Promise<StoredOperation[]>;
}

export interface ControlPlaneClient {
  registerDevice(input: {
    householdId: HouseholdId;
    deviceId: DeviceId;
    signingPublicKey: Bytes;
    agreementPublicKey: Bytes;
  }): Promise<void>;
  depositMailbox(
    blob: Omit<MailboxBlob, 'blobId' | 'createdAt' | 'expiresAt'> & {
      /**
       * false on every chunk but the last. Without it a 31-chunk catch-up wakes
       * every peer 31 times — which IS the storm this stage removes.
       */
      wake?: boolean;
    },
  ): Promise<MailboxBlob>;
  /**
   * Paged: chunked push turns one blob into many, and the relay caps a response
   * by both count and bytes. Keep fetching while `hasMore`, passing back
   * `nextCursor` each time.
   *
   * The cursor is what makes the paging a window rather than a queue. Paging on
   * ack alone cannot advance past a blob that is never ackable — a broadcast is
   * addressed to every peer, so acking it would destroy it for the others — and
   * one page's worth of those makes every later page identical to the first,
   * with everything behind them undeliverable until their TTL expires.
   */
  fetchMailbox(
    householdId: HouseholdId,
    deviceId: DeviceId,
    cursor?: string,
  ): Promise<{ blobs: MailboxBlob[]; hasMore: boolean; nextCursor?: string }>;
  /** Ack is scoped to the acking device: only mail addressed to it can be acked. */
  ackMailbox(blobIds: string[], deviceId: DeviceId): Promise<void>;
}
