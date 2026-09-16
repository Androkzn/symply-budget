import type {
  ControlPlaneClient,
  DeviceId,
  HouseholdId,
  MailboxBlob,
} from '@symply/local-first';

import { ackMailboxBlobs, depositMailboxBlob, fetchMailboxBlobs } from '../controlPlaneClient';

/**
 * Bridges `@symply/local-first` ControlPlaneClient to the House Worker `/v2`
 * mailbox APIs, BOUND TO ONE PROPERTY.
 *
 * The binding is the whole point of the constructor argument. Without it every
 * call fell through to "whatever property is active", so a background sync for B
 * fetched A's mail under B's cursor and deposited B's ops — sealed with B's HDK
 * — into A's mailbox, addressed to A's peers, who cannot open them and never ack
 * them. Nothing errors; the two homes simply stop converging.
 *
 * `householdId` is optional only so a caller with genuinely one property in play
 * (a test, a one-shot enrolment poll) need not thread it; the orchestrator always
 * passes it, because it is the caller that runs for properties that are not on
 * screen.
 */
export class HttpControlPlaneClient implements ControlPlaneClient {
  constructor(private readonly boundHouseholdId?: string) {}

  async registerDevice(): Promise<void> {
    // Device registration is handled by syncLocalHouseholdToControlPlane().
  }

  async depositMailbox(
    blob: Omit<MailboxBlob, 'blobId' | 'createdAt' | 'expiresAt'> & { wake?: boolean },
  ): Promise<MailboxBlob> {
    // `wake` and `hasMore` must survive this mapping. Dropping `wake`
    // reinstates the wake storm; dropping `hasMore` truncates a bootstrap at one
    // page, where the missing ops look like a merge bug rather than a transport
    // bug.
    const res = (await depositMailboxBlob(blob.ciphertext, blob.recipientDeviceId, {
      wake: blob.wake,
      // The blob already knows which property it belongs to; prefer that over
      // the binding, so a mis-bound client cannot post B's ops to A.
      householdId: blob.householdId ?? this.boundHouseholdId,
    })) as {
      blob: { blobId: string; createdAt: string; expiresAt: string };
    };
    return {
      blobId: res.blob.blobId,
      householdId: blob.householdId,
      recipientDeviceId: blob.recipientDeviceId,
      ciphertext: blob.ciphertext,
      createdAt: Date.parse(res.blob.createdAt) || Date.now(),
      expiresAt: Date.parse(res.blob.expiresAt) || Date.now() + 14 * 86400_000,
    };
  }

  async fetchMailbox(
    householdId: HouseholdId,
    _deviceId: DeviceId,
    cursor?: string,
  ): Promise<{ blobs: MailboxBlob[]; hasMore: boolean; nextCursor?: string }> {
    // The engine hands the property it is syncing; the binding is the fallback.
    const { blobs, hasMore, nextCursor } = await fetchMailboxBlobs(
      cursor,
      householdId ?? this.boundHouseholdId,
    );
    return {
      blobs: blobs.map((b) => ({
        blobId: b.blobId,
        householdId,
        // Ack is scoped to the addressed device: dropping this makes every blob
        // look like a broadcast, nothing is ever acked, the mailbox grows
        // without bound and every sync re-fetches and re-applies the same ops.
        recipientDeviceId: b.recipientDeviceId ?? undefined,
        ciphertext: b.ciphertext,
        createdAt: Date.now(),
        expiresAt: Date.now() + 14 * 86400_000,
      })),
      hasMore,
      // Same class of bug as dropping `hasMore`: the pull silently restarts at
      // the oldest page and never reaches the rest.
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async ackMailbox(blobIds: string[], deviceId: string): Promise<void> {
    // An ack posted to the wrong property is refused, and the blobs stay in the
    // real mailbox for ever — every sync re-fetches and re-applies the same ops.
    await ackMailboxBlobs(blobIds, deviceId, this.boundHouseholdId);
  }
}
