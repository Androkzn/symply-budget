import { base64ToBytes, bytesToBase64 } from '../crypto/base64';
import type { OpLog } from '../oplog/oplog';
import type {
  LocalFirstStore,
  StoredOperation,
  SyncPeerState,
  VersionVector,
} from '../store/types';
import type { Bytes, DeviceId, HouseholdId, HouseholdKeys } from '../types';

import {
  MAILBOX_BATCH_VERSION,
  UnsupportedBatchVersionError,
  deserializeOperation,
  openOpBatch,
  sealOpBatch,
  serializeOperation,
  type OpBatch,
} from './batch';
import type { ControlPlaneClient, MailboxBlob, SyncCheckpoint, SyncEngine, SyncPeer } from './types';

export type MailboxSyncResult = {
  /** Blobs written (op chunks + receipts). */
  deposited: number;
  /** Ops actually shipped. */
  pushedOps: number;
  chunks: number;
  /** Peers the storm gate skipped this round. */
  skippedPeers: number;
  receipts: number;
  applied: number;
  duplicates: number;
  rejected: number;
  /**
   * WHY ops were rejected, counted by reason.
   *
   * `rejected` alone is what shipped, and it is not diagnosable: a sync that
   * reports `applied=0` says nothing about whether the batch failed to open,
   * failed to verify, or was refused op by op for a key epoch this device does
   * not hold. Nine days of a member seeing an empty budget came down to a
   * number nobody could interpret. The reasons are `AppliedOperationResult`'s
   * own, plus two this layer owns:
   *
   *  - `batch_unopenable` — no key on the ring opened the deposit at all
   *  - `author_key_unknown` — the op's author is not in the control-plane
   *    roster this sync resolved, so its signature cannot be checked yet
   */
  rejectedReasons: Record<string, number>;
  /** Deposits left on the relay because at least one op may succeed later. */
  deferredBlobs: number;
  acked: number;
  /** Inbound fetch pages consumed. */
  pages: number;
};

/**
 * Largest base64 ciphertext the relay accepts for one mailbox deposit.
 * Mirrors MAILBOX_MAX_CIPHERTEXT_B64 in backend/src/routes/local-first-v2.ts.
 * Two literals in two packages with no shared import: if they ever drift the
 * client packs chunks the relay 413s, so both sides assert this number.
 */
export const MAX_MAILBOX_CIPHERTEXT_B64 = 512_000;

/** Headroom under the cap for seal-size jitter (nonce/tag/JSON escaping). */
export const CHUNK_FILL_RATIO = 0.98;

/** First probe size; the packer adapts from the measured seal thereafter. */
export const CHUNK_START_OPS = 256;

/** Growth clamp so one small chunk cannot make the next probe wildly oversized. */
const CHUNK_GROWTH_LIMIT = 4;

/** Do not re-push to the same peer more often than this when nothing is new. */
export const MIN_PUSH_INTERVAL_MS = 5_000;

/**
 * How long an unconfirmed deposit is trusted. Deliberately UNDER the relay's
 * 14-day blob TTL: a peer offline between 12 and 14 days gets a redundant
 * resend rather than a permanent hole, which is the safe direction.
 */
export const SENT_VV_TTL_MS = 12 * 24 * 3600_000;

/** Bound on inbound fetch pages per pull. */
export const MAX_PULL_PAGES = 8;

/**
 * Rejections that no amount of retrying will change, so the blob may be acked.
 *
 * Everything else — a key epoch briefly out of step during rotation, a store
 * closed mid-pull, an author key not yet resolvable — is treated as retryable
 * and the blob is left on the relay. The default has to be "retry": under a
 * cursor-bounded push each op gets exactly ONE delivery attempt, so a wrong
 * guess in this direction costs a redownload, and a wrong guess in the other
 * costs the op.
 */
const PERMANENT_REJECTIONS = new Set([
  'household_mismatch',
  'parents_invalid',
  'decrypt_failed',
  'bad_signature',
]);

export function isRetryableRejection(reason?: string): boolean {
  return !reason || !PERMANENT_REJECTIONS.has(reason);
}

/** Base64 length for a byte count, without building the string. */
export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

/**
 * The op batch no longer fits in one deposit.
 *
 * Kept and still exported, but UNREACHABLE from `pushOutbound` since Stage 1:
 * pushes are now cursor-bounded and chunked. It remains the classification
 * target for the relay's 413, which can still fire if the client and route
 * constants drift apart.
 */
export class MailboxPayloadTooLargeError extends Error {
  readonly code = 'payload_too_large';

  constructor(readonly opCount: number) {
    super(`payload_too_large: op batch of ${opCount} ops exceeds the mailbox limit`);
    this.name = 'MailboxPayloadTooLargeError';
  }
}

/**
 * A single op that cannot fit one deposit even on its own.
 *
 * Raised rather than skipped: dropping it would be silent divergence, which is
 * the failure mode Stage 0 refused to introduce.
 */
export class MailboxOpTooLargeError extends Error {
  readonly code = 'op_too_large';

  constructor(readonly opId: string, readonly b64Length: number) {
    super(`op_too_large: op ${opId} seals to ${b64Length} base64 chars`);
    this.name = 'MailboxOpTooLargeError';
  }
}

/** Per-key maximum of two version vectors. */
export function vvMax(a: VersionVector, b: VersionVector): VersionVector {
  const out: Record<string, number> = { ...a };
  for (const [device, seq] of Object.entries(b)) {
    if ((out[device] ?? 0) < seq) out[device] = seq;
  }
  return out;
}

/** Does `have` contain everything `other` claims? */
export function vvCovers(have: VersionVector, other: VersionVector): boolean {
  for (const [device, seq] of Object.entries(other)) {
    if ((have[device] ?? 0) < seq) return false;
  }
  return true;
}

export function vvEquals(a: VersionVector, b: VersionVector): boolean {
  return vvCovers(a, b) && vvCovers(b, a);
}

/** How many ops `have` is missing relative to `want` (sum of per-author gaps). */
export function lagOps(have: VersionVector, want: VersionVector): number {
  let n = 0;
  for (const [device, seq] of Object.entries(want)) {
    n += Math.max(0, seq - (have[device] ?? 0));
  }
  return n;
}

/**
 * Per-author minimum across every vector. A missing entry counts as 0, so an
 * author unknown to any peer cannot be compacted.
 */
export function minVersionVector(vectors: readonly VersionVector[]): VersionVector {
  if (vectors.length === 0) return {};
  const keys = new Set<string>();
  for (const vector of vectors) {
    for (const key of Object.keys(vector)) keys.add(key);
  }
  const out: Record<string, number> = {};
  for (const key of keys) {
    let min = Infinity;
    for (const vector of vectors) {
      min = Math.min(min, vector[key] ?? 0);
    }
    if (min > 0 && Number.isFinite(min)) out[key] = min;
  }
  return out;
}

/**
 * Advance `base` by the ops actually delivered, one author at a time, stopping
 * at the first gap.
 *
 * An author's own HLCs are monotonic (`tick`/`observe` only ever increase
 * wallMs), so within one author the delivery order IS seq order — but we may
 * hold and relay ops above a gap in a third author's history, and claiming
 * those would tell the peer it has ops nobody ever sent it.
 */
export function advanceVvWithOps(base: VersionVector, ops: StoredOperation[]): VersionVector {
  const seqsByDevice = new Map<string, Set<number>>();
  for (const op of ops) {
    let set = seqsByDevice.get(op.deviceId);
    if (!set) {
      set = new Set<number>();
      seqsByDevice.set(op.deviceId, set);
    }
    set.add(op.seq);
  }
  const out: Record<string, number> = { ...base };
  for (const [device, seqs] of seqsByDevice.entries()) {
    let next = out[device] ?? 0;
    while (seqs.has(next + 1)) next += 1;
    if (next > 0) out[device] = next;
  }
  return out;
}

function freshPeerState(householdId: HouseholdId, peerDeviceId: DeviceId): SyncPeerState {
  return {
    householdId,
    peerDeviceId,
    knownVv: {},
    sentVv: {},
    sentAtMs: 0,
    lastPushAtMs: 0,
    lastReceiptVv: {},
  };
}

/**
 * ZK mailbox sync: deposit sealed op batches for offline peers; fetch/apply/ack.
 *
 * Op batches are addressed, never broadcast. A cursor is per-recipient, so
 * there is nothing meaningful to send to a recipient you cannot name — and the
 * old broadcast path is exactly what made a lone device re-upload its entire
 * log on every sync to a mailbox nobody read.
 */
export class MailboxSyncEngine implements SyncEngine {
  private readonly nowMs: () => number;

  constructor(
    private readonly options: {
      store: LocalFirstStore;
      opLog: OpLog;
      householdKeys: HouseholdKeys;
      deviceId: DeviceId;
      signingPublicKey: Bytes;
      control: ControlPlaneClient;
      /**
       * Epochs this device held before the current one, for READING only.
       *
       * A batch is sealed under the sender's epoch at deposit time and the AAD
       * binds it, so a peer that has rotated since — or a joiner handed the
       * retired chain at enrolment — needs the ring to open the backlog. Every
       * deposit this engine makes still seals under the CURRENT epoch.
       */
      retiredHdks?: ReadonlyMap<number, Bytes>;
      /** Known peer device ids to address. Empty = nothing is deposited. */
      peerDeviceIds?: DeviceId[];
      resolveSenderPublicKey: (deviceId: DeviceId, hintedB64?: string) => Bytes | null;
      /** Injectable so debounce and TTL are testable without the wall clock. */
      nowMs?: () => number;
    },
  ) {
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async getCheckpoint(householdId: HouseholdId): Promise<SyncCheckpoint> {
    const ops = await this.options.store.listOperationsByHlc(householdId);
    const frontierHlc = ops.length === 0 ? '' : ops[ops.length - 1]!.hlc;
    return {
      householdId,
      frontierHlc,
      opCount: ops.length,
      versionVector: await this.options.store.getVersionVector(householdId),
    };
  }

  async exchangeWithPeer(
    _peer: SyncPeer,
    peerOps: StoredOperation[],
  ): Promise<StoredOperation[]> {
    return peerOps.map((op) => ({
      ...op,
      payload: new Uint8Array(op.payload),
      signature: new Uint8Array(op.signature),
    }));
  }

  /** Ops this device still owes the least-advanced known peer. */
  async pendingOutboundCount(): Promise<number> {
    const { store, householdKeys, peerDeviceIds } = this.options;
    const peers = peerDeviceIds ?? [];
    if (peers.length === 0) return 0;
    const hh = householdKeys.householdId;
    let worst = 0;
    for (const peer of peers) {
      const state = (await store.getSyncPeerState(hh, peer)) ?? freshPeerState(hh, peer);
      const owed = await store.countOperationsSince(hh, this.effectiveVv(state));
      if (owed > worst) worst = owed;
    }
    return worst;
  }

  /**
   * Cursor-bounded, chunked, per-peer push.
   *
   * Returns blobs deposited. Was: the entire op log, to every peer, every sync —
   * which outgrew the relay's per-deposit cap at 466 ops and failed permanently
   * thereafter because each retry was larger than the last.
   */
  async pushOutbound(): Promise<number> {
    const result = await this.pushOutboundDetailed();
    return result.deposited;
  }

  async pushOutboundDetailed(): Promise<
    Pick<MailboxSyncResult, 'deposited' | 'pushedOps' | 'chunks' | 'skippedPeers' | 'receipts'>
  > {
    const { store, householdKeys, peerDeviceIds } = this.options;
    const summary = { deposited: 0, pushedOps: 0, chunks: 0, skippedPeers: 0, receipts: 0 };
    const peers = peerDeviceIds ?? [];
    if (peers.length === 0) return summary;

    const hh = householdKeys.householdId;
    // Before myVv is read: a device whose own seqs start above 1 is otherwise
    // absent from its own vector, and would re-ship its whole log every sync.
    const myBaseline = await this.ensureOwnBaseline(hh);
    const myVv = await store.getVersionVector(hh);
    for (const peer of peers) {
      if (peer === this.options.deviceId) continue;
      const state = (await store.getSyncPeerState(hh, peer)) ?? freshPeerState(hh, peer);
      const effective = this.effectiveVv(state);

      if (!(await store.hasOperationsSince(hh, effective))) {
        // Nothing owed. Still teach this peer our frontier if it has changed,
        // so a peer that only ever reads eventually stops being resent to.
        const sent = await this.maybeSendReceipt(peer, state, myVv, myBaseline);
        summary.deposited += sent;
        summary.receipts += sent;
        continue;
      }

      // Storm gate. Deliberately comparative and per-peer: "did I author
      // something" would be false for an idle owner and would starve a peer
      // that just joined. A peer with an unknown VV can never be covered by a
      // non-empty local frontier, so it is never skipped.
      const now = this.nowMs();
      if (now - state.lastPushAtMs < MIN_PUSH_INTERVAL_MS && vvCovers(effective, myVv)) {
        summary.skippedPeers += 1;
        continue;
      }

      const owed = await store.listOperationsSince(hh, effective);
      // Anchored on the OLDEST unconfirmed deposit, never re-stamped by a later
      // one — see sentAnchorMs.
      const anchor = this.sentAnchorMs(state);
      // The peer will adopt our baseline from the batch header, so our own entry
      // in what we claim it holds starts there rather than at 0 — otherwise
      // `advanceVvWithOps` can never cross our own first seq either.
      let progress =
        myBaseline > 0 ? vvMax(effective, { [this.options.deviceId]: myBaseline }) : effective;
      let index = 0;
      let take = CHUNK_START_OPS;
      // Sealed lazily, one chunk at a time: sealing a 31-chunk catch-up up
      // front would hold ~12 MB of ciphertext in memory before the first
      // deposit, on Hermes.
      while (index < owed.length) {
        const chunk = this.sealChunk(owed, index, take, myVv, myBaseline);
        take = chunk.nextTake;
        index += chunk.ops.length;
        await this.options.control.depositMailbox({
          householdId: hh,
          recipientDeviceId: peer,
          ciphertext: chunk.ciphertext,
          // Only the last chunk wakes the peer: a 31-chunk catch-up must not
          // fan out 31 push notifications to every device in the household.
          wake: index >= owed.length,
        });
        summary.deposited += 1;
        summary.chunks += 1;
        summary.pushedOps += chunk.ops.length;
        // Persist per chunk so a failure mid-catch-up does not resend the
        // chunks that already landed.
        progress = advanceVvWithOps(progress, chunk.ops);
        await store.putSyncPeerState({
          ...state,
          sentVv: progress,
          sentAtMs: anchor,
          lastPushAtMs: this.nowMs(),
          lastReceiptVv: myVv,
        });
      }
    }
    return summary;
  }

  /**
   * What the peer can be assumed to hold: its own word, plus what we have
   * deposited for it and not yet seen confirmed.
   */
  private effectiveVv(state: SyncPeerState): VersionVector {
    return vvMax(state.knownVv, this.sentIsFresh(state) ? state.sentVv : {});
  }

  /**
   * Is the whole optimistic vector still inside its trust window?
   *
   * Measured from the OLDEST unconfirmed deposit. The window only means
   * anything because it sits under the relay's blob TTL: past it, the blob that
   * carried those ops may already have been swept, and nothing else in the
   * protocol will ever say so — a receiver holding a hole cannot report one
   * (`maybeSendReceipt` fires on ITS frontier moving, and applying ops above a
   * hole moves it by zero), so there is no negative acknowledgement to wait for.
   */
  private sentIsFresh(state: SyncPeerState): boolean {
    if (state.sentAtMs <= 0) return false;
    return this.nowMs() - state.sentAtMs <= SENT_VV_TTL_MS;
  }

  /**
   * Timestamp to persist with a deposit: the age of the oldest deposit this
   * peer has still not confirmed.
   *
   * Re-stamping on every deposit is what made the window meaningless — a long
   * chunked push, or simply a household that keeps working while one member is
   * away, renewed the trust of vector entries that were never re-verified, so
   * ops whose only relay copy had expired were treated as delivered for ever.
   * Confirmation (`learnPeerVersionVector`) is what clears the anchor; until
   * then it stands, and once it lapses the whole unconfirmed set is re-shipped.
   */
  private sentAnchorMs(state: SyncPeerState): number {
    return this.sentIsFresh(state) ? state.sentAtMs : this.nowMs();
  }

  private batchHeader(myVv: VersionVector, baselineSeq: number): Omit<OpBatch, 'ops'> {
    return {
      v: MAILBOX_BATCH_VERSION,
      householdId: this.options.householdKeys.householdId,
      senderDeviceId: this.options.deviceId,
      senderSigningPublicKeyB64: bytesToBase64(this.options.signingPublicKey),
      senderVersionVector: myVv,
      ...(baselineSeq > 0 ? { senderBaselineSeq: baselineSeq } : {}),
    };
  }

  /**
   * Publish our own author baseline into the store and return it.
   *
   * Cheap and idempotent: one MIN(seq) read per push. The store cannot do this
   * for itself — it has no notion of which device id is local, and only the
   * author may vouch for a gap below its own first seq.
   */
  private async ensureOwnBaseline(hh: HouseholdId): Promise<number> {
    const { store, deviceId } = this.options;
    const lowest = await store.getLowestStoredSeq(hh, deviceId);
    if (lowest <= 1) return 0;
    await store.setAuthorBaseline(hh, deviceId, lowest - 1);
    return lowest - 1;
  }

  /**
   * Seal ONE chunk starting at `index`, as large as the cap allows.
   *
   * base64 length is only exact after sealing, so estimate, seal, and shrink
   * proportionally on overshoot. `nextTake` carries the converged size to the
   * following chunk, so a full catch-up costs roughly one extra seal per chunk
   * rather than O(log n) per chunk.
   */
  private sealChunk(
    ops: StoredOperation[],
    index: number,
    take: number,
    myVv: VersionVector,
    baselineSeq: number,
  ): { ciphertext: Bytes; ops: StoredOperation[]; nextTake: number } {
    const { householdKeys } = this.options;
    const header = this.batchHeader(myVv, baselineSeq);
    const budget = Math.floor(MAX_MAILBOX_CIPHERTEXT_B64 * CHUNK_FILL_RATIO);

    let attempt = Math.min(Math.max(1, take), ops.length - index);
    for (;;) {
      const slice = ops.slice(index, index + attempt);
      const ciphertext = sealOpBatch(
        { ...header, ops: slice.map(serializeOperation) },
        householdKeys.hdk,
        householdKeys.keyEpoch,
      );
      const size = base64Length(ciphertext.length);
      if (size <= budget) {
        return {
          ciphertext,
          ops: slice,
          // Aim the next probe at the budget, but never balloon off one
          // unusually small chunk.
          nextTake: Math.max(
            1,
            Math.min(Math.floor((attempt * budget) / size), attempt * CHUNK_GROWTH_LIMIT),
          ),
        };
      }
      if (attempt === 1) {
        throw new MailboxOpTooLargeError(slice[0]!.opId, size);
      }
      attempt = Math.max(1, Math.min(attempt - 1, Math.floor((attempt * budget) / size)));
    }
  }

  /**
   * Header-only batch so a peer that only reads still learns our frontier.
   *
   * Sent only when our VV moved since the last one, and always with
   * `wake: false` — otherwise two idle devices trade receipts and wakes forever.
   */
  private async maybeSendReceipt(
    peer: DeviceId,
    state: SyncPeerState,
    myVv: VersionVector,
    baselineSeq: number,
  ): Promise<number> {
    if (vvEquals(myVv, state.lastReceiptVv)) return 0;
    const ciphertext = sealOpBatch(
      { ...this.batchHeader(myVv, baselineSeq), ops: [] },
      this.options.householdKeys.hdk,
      this.options.householdKeys.keyEpoch,
    );
    await this.options.control.depositMailbox({
      householdId: this.options.householdKeys.householdId,
      recipientDeviceId: peer,
      ciphertext,
      wake: false,
    });
    await this.options.store.putSyncPeerState({ ...state, lastReceiptVv: myVv });
    return 1;
  }

  /**
   * Open a deposit against the current epoch first, then every retired one.
   *
   * Newest-first, because the overwhelmingly common case is a peer at the same
   * epoch and each miss costs one AEAD failure. An `UnsupportedBatchVersionError`
   * is rethrown immediately rather than treated as a wrong-key miss: it means
   * the batch DID open and is simply too old a format, and retrying it against
   * four more keys cannot change that.
   */
  private openBatchWithRing(ciphertext: Bytes, hh: HouseholdId): OpBatch {
    const { householdKeys, retiredHdks } = this.options;
    const ring: Array<[number, Bytes]> = [[householdKeys.keyEpoch, householdKeys.hdk]];
    for (const [epoch, hdk] of retiredHdks ?? []) {
      if (epoch !== householdKeys.keyEpoch) ring.push([epoch, hdk]);
    }
    ring.sort((a, b) => b[0] - a[0]);

    let lastError: unknown;
    for (const [epoch, hdk] of ring) {
      try {
        return openOpBatch(ciphertext, hdk, hh, epoch);
      } catch (error) {
        if (error instanceof UnsupportedBatchVersionError) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('openOpBatch: no key opened this batch');
  }

  async pullInbound(): Promise<MailboxSyncResult> {
    const { control, householdKeys, deviceId, opLog, resolveSenderPublicKey } = this.options;
    const hh = householdKeys.householdId;
    const result: MailboxSyncResult = {
      deposited: 0,
      pushedOps: 0,
      chunks: 0,
      skippedPeers: 0,
      receipts: 0,
      applied: 0,
      duplicates: 0,
      rejected: 0,
      rejectedReasons: {},
      deferredBlobs: 0,
      acked: 0,
      pages: 0,
    };
    const note = (reason: string) => {
      result.rejected += 1;
      result.rejectedReasons[reason] = (result.rejectedReasons[reason] ?? 0) + 1;
    };

    // Paging is driven by the relay's cursor, not by ack: an unackable blob
    // (every broadcast) would otherwise reappear at the head of every page and
    // wedge the mailbox. `seen` stays only as a guard against a relay that
    // ignores the cursor — without it that would be an infinite loop.
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      const { blobs, hasMore, nextCursor } = await control.fetchMailbox(hh, deviceId, cursor);
      result.pages += 1;
      const fresh = blobs.filter((blob) => !seen.has(blob.blobId));
      for (const blob of fresh) seen.add(blob.blobId);
      if (fresh.length === 0) break;

      const ackIds: string[] = [];
      // Only mail ADDRESSED to this device may be acked. A broadcast blob is
      // addressed to every peer, so acking it here would destroy it for the
      // others; those expire by TTL instead, and re-delivery is harmless
      // because applyRemote dedupes by opId.
      const ackAddressed = (blob: Pick<MailboxBlob, 'blobId' | 'recipientDeviceId'>) => {
        if (blob.recipientDeviceId === deviceId) ackIds.push(blob.blobId);
      };

      for (const blob of fresh) {
        let batch: OpBatch;
        try {
          batch = this.openBatchWithRing(blob.ciphertext, hh);
        } catch (error) {
          note(
            error instanceof UnsupportedBatchVersionError
              ? 'batch_version_unsupported'
              : 'batch_unopenable',
          );
          // A v1 blob will never become readable. Leaving it unacked would
          // re-download it on every sync for the full 14-day TTL.
          if (error instanceof UnsupportedBatchVersionError) ackAddressed(blob);
          else result.deferredBlobs += 1;
          continue;
        }
        if (batch.senderDeviceId === deviceId) {
          ackAddressed(blob);
          continue;
        }

        // Read our durable coverage before learning anything from this batch.
        // A verified checkpoint may cover authors whose device keys have since
        // left the roster. Their old operations are duplicates, not lost mail.
        const covered = await this.options.store.getVersionVector(hh);
        await this.learnPeerVersionVector(hh, batch);

        // Ack means "delivered", and it is single-shot: the sender's cursor has
        // already moved past these ops, so acking a blob whose ops were refused
        // for a reason that may not hold next time is the last chance anyone
        // gets at them.
        let deferred = 0;
        for (const raw of batch.ops) {
          const op = deserializeOperation(raw);
          if (op.householdId === hh && Number.isSafeInteger(op.seq) && op.seq > 0 &&
              (covered[op.deviceId] ?? 0) >= op.seq) {
            result.duplicates += 1;
            continue;
          }
          const pub =
            resolveSenderPublicKey(op.deviceId, batch.senderSigningPublicKeyB64) ??
            // Only the sender may be verified by the key the sender put in its
            // own header. Using it for a RELAYED third author cannot verify by
            // construction, and the resulting bad_signature used to ack the blob
            // away — losing that author's op the moment a device relayed it
            // before this one had seen the author's registration.
            (op.deviceId === batch.senderDeviceId
              ? base64ToBytes(batch.senderSigningPublicKeyB64)
              : null);
          if (!pub) {
            note('author_key_unknown');
            deferred += 1;
            continue;
          }
          const applied = await opLog.applyRemote(op, pub);
          if (applied.status === 'applied') result.applied += 1;
          else if (applied.status === 'duplicate') result.duplicates += 1;
          else {
            note(applied.reason ?? 'unknown');
            if (isRetryableRejection(applied.reason)) deferred += 1;
          }
        }
        if (deferred === 0) ackAddressed(blob);
        else result.deferredBlobs += 1;
      }

      if (ackIds.length > 0) {
        // Best-effort, and per page so the next page is not the same rows.
        // The ops are already applied and persisted, so a failed ack costs only
        // redelivery — and replay is idempotent (applyRemote dedupes by opId).
        // Letting it throw would abort the whole sync AFTER the useful work,
        // which is what happened once ack became device-scoped: a device whose
        // control-plane registration had lapsed got a 403 here and its entire
        // sync was reported as an auth failure.
        try {
          await control.ackMailbox(ackIds, deviceId);
          result.acked += ackIds.length;
        } catch (error) {
          console.warn('[local-first] mailbox ack failed (non-fatal)', error);
        }
      }

      if (!hasMore || !nextCursor) break;
      cursor = nextCursor;
    }

    return result;
  }

  /**
   * Record what a peer says it holds, and drop our optimistic guess about it:
   * the peer's own word supersedes what we merely deposited.
   */
  private async learnPeerVersionVector(hh: HouseholdId, batch: OpBatch): Promise<void> {
    const { store } = this.options;
    const peerVv = batch.senderVersionVector ?? {};
    // Self-vouched only: the sender is the sole source of ops carrying its own
    // device id, so it alone can say that a range below its first seq does not
    // exist. Taken for `senderDeviceId` and nobody else.
    if (typeof batch.senderBaselineSeq === 'number' && batch.senderBaselineSeq > 0) {
      await store.setAuthorBaseline(hh, batch.senderDeviceId, batch.senderBaselineSeq);
    }
    const existing =
      (await store.getSyncPeerState(hh, batch.senderDeviceId)) ??
      freshPeerState(hh, batch.senderDeviceId);
    await store.putSyncPeerState({
      ...existing,
      knownVv: vvMax(existing.knownVv, peerVv),
      sentVv: {},
      sentAtMs: 0,
    });
  }

  async syncOnce(): Promise<MailboxSyncResult> {
    const inbound = await this.pullInbound();
    const outbound = await this.pushOutboundDetailed();
    return { ...inbound, ...outbound };
  }
}
