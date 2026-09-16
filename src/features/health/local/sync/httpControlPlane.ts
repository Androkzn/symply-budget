import type {
  ControlPlaneClient,
  DeviceId,
  HouseholdId,
  MailboxBlob,
} from '@symply/local-first';

import { ackHealthMailboxBlobs, depositHealthMailboxBlob, fetchHealthMailboxBlobs } from '../controlPlaneClient';

/**
 * How long the relay keeps an undelivered blob (`local-first-mailbox-service.ts`
 * `MAILBOX_TTL_MS`). Inherited unchanged, and deliberately ABOVE the engine's
 * `SENT_VV_TTL_MS` (12 days): a device offline between 12 and 14 days gets a
 * redundant resend rather than a permanent hole.
 *
 * Only used to synthesize the timestamps the relay does not return on a fetch;
 * the authoritative expiry is the row the Worker wrote.
 */
export const MAILBOX_BLOB_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Bridges `@symply/local-first`'s `ControlPlaneClient` to the shared Worker's
 * `/v2` mailbox routes for Health.
 *
 * Identical in shape to House's (`house/local/sync/httpControlPlane.ts`) — same
 * relay, same routes, same `MAILBOX_BATCH_VERSION = 2` envelope and same
 * `512_000` ciphertext cap. What differs is one brand header, carried by
 * `../controlPlaneClient`, and the fact that every recipient here is another
 * device of the SAME user (plan §1.2) rather than another member.
 */
export class HttpControlPlaneClient implements ControlPlaneClient {
  async registerDevice(): Promise<void> {
    // Device registration is handled by syncLocalHealthHouseholdToControlPlane().
  }

  async depositMailbox(
    blob: Omit<MailboxBlob, 'blobId' | 'createdAt' | 'expiresAt'> & { wake?: boolean },
  ): Promise<MailboxBlob> {
    // `wake` and `hasMore` must survive this mapping. Dropping `wake` reinstates
    // the wake storm; dropping `hasMore` truncates a bootstrap at one page,
    // where the missing ops look like a merge bug rather than a transport bug.
    const res = (await depositHealthMailboxBlob(blob.ciphertext, blob.recipientDeviceId, {
      wake: blob.wake,
    })) as {
      blob: { blobId: string; createdAt: string; expiresAt: string };
    };
    return {
      blobId: res.blob.blobId,
      householdId: blob.householdId,
      recipientDeviceId: blob.recipientDeviceId,
      ciphertext: blob.ciphertext,
      createdAt: Date.parse(res.blob.createdAt) || Date.now(),
      expiresAt: Date.parse(res.blob.expiresAt) || Date.now() + MAILBOX_BLOB_TTL_MS,
    };
  }

  async fetchMailbox(
    householdId: HouseholdId,
    _deviceId: DeviceId,
    cursor?: string,
  ): Promise<{ blobs: MailboxBlob[]; hasMore: boolean; nextCursor?: string }> {
    const { blobs, hasMore, nextCursor } = await fetchHealthMailboxBlobs(cursor);
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
        expiresAt: Date.now() + MAILBOX_BLOB_TTL_MS,
      })),
      hasMore,
      // Same class of bug as dropping `hasMore`: the pull silently restarts at
      // the oldest page and never reaches the rest.
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async ackMailbox(blobIds: string[], deviceId: string): Promise<void> {
    await ackHealthMailboxBlobs(blobIds, deviceId);
  }
}
