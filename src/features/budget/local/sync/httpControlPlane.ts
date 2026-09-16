import type {
  ControlPlaneClient,
  DeviceId,
  HouseholdId,
  MailboxBlob,
} from '@symply/local-first';

import { ackMailboxBlobs, depositMailboxBlob, fetchMailboxBlobs } from '../controlPlaneClient';

/** Bridges `@symply/local-first` ControlPlaneClient to Budget Worker `/v2` mailbox APIs. */
export class HttpControlPlaneClient implements ControlPlaneClient {
  constructor(private readonly householdId: string, private readonly assertCurrentSession: () => void = () => {}) {}

  private assertHousehold(householdId: string): void {
    this.assertCurrentSession();
    if (householdId !== this.householdId) throw new Error('Mailbox household mismatch');
  }

  async registerDevice(): Promise<void> {
    // Device registration is handled by syncLocalHouseholdToControlPlane().
  }

  async depositMailbox(
    blob: Omit<MailboxBlob, 'blobId' | 'createdAt' | 'expiresAt'> & { wake?: boolean },
  ): Promise<MailboxBlob> {
    // `wake` and `hasMore` are exactly the kind of field `recipientDeviceId`
    // was: silently dropping `wake` reinstates the wake storm, and dropping
    // `hasMore` truncates a bootstrap at one page, where the missing ops look
    // like a merge bug rather than a transport bug.
    this.assertHousehold(blob.householdId);
    const res = (await depositMailboxBlob(blob.ciphertext, blob.recipientDeviceId, {
      wake: blob.wake,
      householdId: this.householdId,
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
    this.assertHousehold(householdId);
    const { blobs, hasMore, nextCursor } = await fetchMailboxBlobs(cursor, this.householdId);
    this.assertCurrentSession();
    return {
      blobs: blobs.map((b) => ({
        blobId: b.blobId,
        householdId,
        // Must survive the mapping: ack is scoped to the addressed device, so
        // dropping this made every blob look like a broadcast and nothing was
        // ever acked — the mailbox grew without bound and every sync re-fetched
        // and re-applied the same ops.
        recipientDeviceId: b.recipientDeviceId ?? undefined,
        ciphertext: b.ciphertext,
        createdAt: Date.now(),
        expiresAt: Date.now() + 14 * 86400_000,
      })),
      hasMore,
      // Dropping this is the same class of bug as dropping `hasMore`: the pull
      // silently restarts at the oldest page and never reaches the rest.
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async ackMailbox(blobIds: string[], deviceId: string): Promise<void> {
    this.assertCurrentSession();
    await ackMailboxBlobs(blobIds, deviceId, this.householdId);
  }
}
