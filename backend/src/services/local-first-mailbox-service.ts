import type { Env } from '../types';

const MAILBOX_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const R2_PREFIX = 'lf-mailbox';

export type MailboxBlobRow = {
  id: string;
  household_id: string;
  recipient_device_id: string | null;
  r2_key: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
  acked_at: string | null;
};

function r2Key(householdId: string, blobId: string): string {
  return `${R2_PREFIX}/${householdId}/${blobId}`;
}

export class LocalFirstMailboxService {
  constructor(private readonly env: Env) {}

  async deposit(input: {
    householdId: string;
    recipientDeviceId?: string | null;
    ciphertext: ArrayBuffer;
  }): Promise<MailboxBlobRow> {
    const id = crypto.randomUUID();
    const now = new Date();
    const expires = new Date(now.getTime() + MAILBOX_TTL_MS);
    const key = r2Key(input.householdId, id);
    const bytes = new Uint8Array(input.ciphertext);

    await this.env.REPORTS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: {
        householdId: input.householdId,
        recipientDeviceId: input.recipientDeviceId ?? '',
      },
    });

    const row: MailboxBlobRow = {
      id,
      household_id: input.householdId,
      recipient_device_id: input.recipientDeviceId ?? null,
      r2_key: key,
      size_bytes: bytes.byteLength,
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      acked_at: null,
    };

    await this.env.DB.prepare(
      `INSERT INTO lf_mailbox_blobs
        (id, household_id, recipient_device_id, r2_key, size_bytes, created_at, expires_at, acked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
      .bind(
        row.id,
        row.household_id,
        row.recipient_device_id,
        row.r2_key,
        row.size_bytes,
        row.created_at,
        row.expires_at,
      )
      .run();

    return row;
  }

  /**
   * One page of undelivered mail for a device.
   *
   * Budgeted by BYTES as well as count. `size_bytes` is already on every row, so
   * the budget is free to enforce — and without it the old count-only LIMIT let
   * a chunked catch-up build a ~51 MB base64 response in Worker memory, which
   * chunked push makes routine rather than rare.
   */
  async listForDevice(
    householdId: string,
    deviceId: string,
    options?: {
      maxBlobs?: number;
      maxTotalBytes?: number;
      /**
       * Last row of the previous page. Paging on ack alone cannot advance past a
       * blob that is never ackable — every broadcast, and any blob the client
       * defers rather than acks — so without this, page 2 is page 1 and
       * everything behind them is undeliverable until its TTL.
       */
      after?: { createdAt: string; id: string };
    },
  ): Promise<{
    rows: MailboxBlobRow[];
    hasMore: boolean;
    nextCursor?: { createdAt: string; id: string };
  }> {
    const maxBlobs = options?.maxBlobs ?? 100;
    const maxTotalBytes = options?.maxTotalBytes ?? Number.POSITIVE_INFINITY;
    const after = options?.after;
    const now = new Date().toISOString();
    // `id` breaks created_at ties: a chunked push deposits in a tight loop, so
    // rows sharing a millisecond are routine and a created_at-only cursor would
    // either skip them or loop on them.
    const cursorClause = after ? ' AND (created_at > ? OR (created_at = ? AND id > ?))' : '';
    const cursorParams = after ? [after.createdAt, after.createdAt, after.id] : [];
    const { results } = await this.env.DB.prepare(
      `SELECT * FROM lf_mailbox_blobs
       WHERE household_id = ?
         AND acked_at IS NULL
         AND expires_at > ?
         AND (recipient_device_id IS NULL OR recipient_device_id = ?)${cursorClause}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
      // One extra row, purely to learn whether anything was withheld.
      .bind(householdId, now, deviceId, ...cursorParams, maxBlobs + 1)
      .all<MailboxBlobRow>();

    const all = results ?? [];
    const rows: MailboxBlobRow[] = [];
    let bytes = 0;
    for (const row of all) {
      if (rows.length >= maxBlobs) break;
      // Always return at least one row: a single blob larger than the byte
      // budget would otherwise wedge this device's mailbox permanently.
      if (rows.length > 0 && bytes + (row.size_bytes ?? 0) > maxTotalBytes) break;
      rows.push(row);
      bytes += row.size_bytes ?? 0;
    }
    const last = rows[rows.length - 1];
    return {
      rows,
      hasMore: rows.length < all.length,
      ...(last ? { nextCursor: { createdAt: last.created_at, id: last.id } } : {}),
    };
  }

  /**
   * Claim the right to wake this mailbox, or report that a recent wake covers it.
   *
   * Keyed on wakes actually EMITTED. The previous rule — "is there any other blob
   * to this recipient in the last 10 s", read off `lf_mailbox_blobs.created_at` —
   * suppressed precisely the wake it was meant to allow: a chunked push deposits
   * N-1 rows marked `wake: false` and then one that wakes, so the query found the
   * push's own predecessors and cancelled it. Five chunks in 45 ms, ten in 90 ms:
   * every multi-chunk catch-up woke nobody at all, and the more chunks it needed
   * the more certain that was.
   *
   * The mark lives in KV rather than a blobs column so no migration is needed and
   * so it survives the row being acked and swept. Two racing claims can both
   * win — that costs one redundant silent push, where losing a wake costs a
   * member their sync until they next open the app.
   */
  async claimWake(
    householdId: string,
    recipientDeviceId: string | null,
    windowMs: number,
  ): Promise<boolean> {
    const kv = this.env.CONFIG_KV;
    // No wake store configured: wake. Silence is the expensive failure here.
    if (!kv) return true;
    const key = `lf-wake:${householdId}:${recipientDeviceId ?? '*'}`;
    const now = Date.now();
    try {
      const last = await kv.get(key);
      if (last && now - Number(last) < windowMs) return false;
      // KV's floor is 60 s; the value carries the real timestamp, so a stale
      // key past the window is compared, not trusted.
      await kv.put(key, String(now), { expirationTtl: 60 });
    } catch (error) {
      console.warn('[local-first-mailbox] wake claim failed, waking anyway', error);
      return true;
    }
    return true;
  }

  async fetchCiphertext(r2Key: string): Promise<ArrayBuffer | null> {
    const obj = await this.env.REPORTS_BUCKET.get(r2Key);
    if (!obj) return null;
    return obj.arrayBuffer();
  }

  /**
   * Mark blobs as delivered.
   *
   * Scoped to the ADDRESSED DEVICE. Household membership alone used to be
   * enough, which let any member's device ack — and hard-delete — mail addressed
   * to a different device, including the wrapped-HDK envelope a joining member is
   * waiting on (hdkTransfer.ts).
   *
   * Broadcast blobs (recipient_device_id IS NULL) are deliberately NOT ackable.
   * Ack is single-shot but a broadcast is addressed to every peer, so honouring
   * the first ack would destroy it for everyone else — the same data loss, just
   * relocated. They expire by TTL instead. Re-delivering one is harmless: the op
   * store dedupes by opId, so replay is idempotent. Callers should only submit
   * blobs whose recipientDeviceId matches their own device.
   *
   * The R2 object is NOT deleted here. Ack means "this recipient has it", not
   * "nobody needs it". sweepExpired() reclaims storage once a blob is acked or
   * past its TTL.
   */
  async ack(blobIds: string[], householdId: string, deviceId: string): Promise<number> {
    if (blobIds.length === 0) return 0;
    const now = new Date().toISOString();
    let count = 0;
    for (const id of blobIds) {
      const row = await this.env.DB.prepare(
        `SELECT r2_key FROM lf_mailbox_blobs
         WHERE id = ? AND household_id = ? AND acked_at IS NULL
           AND recipient_device_id = ?`,
      )
        .bind(id, householdId, deviceId)
        .first<{ r2_key: string }>();
      if (!row) continue;
      await this.env.DB.prepare(
        `UPDATE lf_mailbox_blobs SET acked_at = ? WHERE id = ?`,
      )
        .bind(now, id)
        .run();
      count += 1;
    }
    return count;
  }

  /** Is this device registered to this user in this household? */
  async deviceBelongsToUser(
    householdId: string,
    deviceId: string,
    userIdValue: string,
  ): Promise<boolean> {
    const row = await this.env.DB.prepare(
      `SELECT 1 AS ok FROM lf_devices WHERE id = ? AND household_id = ? AND user_id = ?`,
    )
      .bind(deviceId, householdId, userIdValue)
      .first<{ ok: number }>();
    return !!row;
  }

  /** Delete expired / acked blobs. Returns number of R2 objects removed. */
  async sweepExpired(limit = 500): Promise<number> {
    const now = new Date().toISOString();
    const { results: expired } = await this.env.DB.prepare(
      `SELECT id, r2_key FROM lf_mailbox_blobs
       WHERE expires_at <= ?
       LIMIT ?`,
    )
      .bind(now, limit)
      .all<{ id: string; r2_key: string }>();
    const { results: acked } = await this.env.DB.prepare(
      `SELECT id, r2_key FROM lf_mailbox_blobs
       WHERE acked_at IS NOT NULL
       LIMIT ?`,
    )
      .bind(limit)
      .all<{ id: string; r2_key: string }>();

    const seen = new Set<string>();
    let removed = 0;
    for (const row of [...(expired ?? []), ...(acked ?? [])]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      await this.env.REPORTS_BUCKET.delete(row.r2_key);
      await this.env.DB.prepare(`DELETE FROM lf_mailbox_blobs WHERE id = ?`).bind(row.id).run();
      removed += 1;
    }
    return removed;
  }
}
