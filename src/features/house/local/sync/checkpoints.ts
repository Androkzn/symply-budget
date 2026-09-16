/**
 * Checkpoint publish / install / compaction for House (plan §5, stage H8 —
 * landed early with H4 because the H10 baseline made it non-optional).
 *
 * H10 measured a full House catch-up at **452 ops per deposit**: a 10-year log
 * is 98 deposits and one deposit carries ~38 days of history. Replaying the log
 * is therefore not a viable bootstrap at House's op rate, and the checkpoint is
 * the only thing that makes a new device usable in one round trip.
 *
 * Thresholds are inherited unchanged: owner-only publish, ≥100 ops, catch-up at
 * 500 ops or 14 days, retain 3 generations / 90 days.
 */
import {
  CATCH_UP_OPS_THRESHOLD,
  CHECKPOINT_PUBLISH_MIN_OPS,
  base64ToBytes,
  bytesToBase64,
  hexToBytes,
  lagOps,
  openCheckpoint,
  sealCheckpoint,
  vvCovers,
  type CheckpointManifest,
  type VersionVector,
} from '@symply/local-first';

import {
  fetchCheckpointChunk,
  fetchControlPlaneState,
  fetchLatestCheckpoint,
  putCheckpointChunk,
} from '../controlPlaneClient';
import {
  clearHouseholdBootstrapPending,
  compactLocalHouseLogIfSafe,
  exportHouseCheckpointPlaintext,
  getActiveHouseholdId,
  getLocalHouseSession,
  installHouseCheckpointPlaintext,
  isAwaitingHouseEnrolment,
  isHouseholdBootstrapPending,
  rememberPublishedHouseCheckpoint,
} from '../engine';

function isOwnerRole(role: string | undefined): boolean {
  return (role ?? '').toUpperCase() === 'OWNER';
}

/**
 * Publishing is owner-only PER PROPERTY (plan §7 rule 6): a member can own one
 * home and merely be a member of another, so the role is read from that
 * property's ledger rather than from a single global session.
 */
function resolveHouseholdId(householdId?: string): string {
  const id = householdId ?? getActiveHouseholdId();
  if (!id) throw new Error('checkpoints: no property is active');
  return id;
}

/**
 * The epoch this device last published a checkpoint under, per property.
 *
 * A checkpoint is sealed once and never re-sealed, so after a rotation the
 * home's newest snapshot is unreadable to anyone who does not hold the retired
 * key — which, before the enrolment ring, was every joiner. Recording the epoch
 * is what lets the owner notice and republish on its own, rather than relying on
 * somebody remembering to pass `force`.
 *
 * Purged by `removeLocalHouseProperty` — keep the string in step with its
 * `FOREIGN_HOUSEHOLD_META_KEYS` list.
 */
const publishedEpochMetaKey = (householdId: string) => `lf.checkpoint.epoch:${householdId}`;

/**
 * Owner publishes a checkpoint when the log has grown past the watermark.
 *
 * `force` is for the two moments when the op count is the wrong question:
 *
 *  - a member was just approved, and the snapshot they are about to bootstrap
 *    from must exist and must be current;
 *  - the home key just rotated, so the newest snapshot is sealed under a key the
 *    home is no longer using.
 *
 * Without it the gate is `missing >= 100 ops`, which an owner with a modest
 * ledger never clears — and every joiner then bootstraps from a snapshot they
 * cannot decrypt, or from none at all.
 *
 * `force` also bypasses the LOCAL role flag, deliberately. Both forced callers
 * have just had this device authorised as an owner by the server — only an owner
 * may approve an invite or revoke a device — whereas `ledger.household.my_role`
 * is a local string that a backup restore or a migrated property can carry
 * wrongly. Trusting it here would mean the one publish a joining member depends
 * on is skipped because of a stale label, and the failure would be invisible:
 * the member simply gets nothing.
 */
export async function maybePublishCheckpoint(
  householdIdInput?: string,
  options?: { force?: boolean },
): Promise<boolean> {
  const householdId = resolveHouseholdId(householdIdInput);
  // Every early return says why. This function returning false silently is how
  // a home goes days without a single `PUT /checkpoints` — the owner's device
  // declining to publish on every sync, and nothing saying so.
  const skip = (why: string): false => {
    console.log(`[HouseLocal] checkpoint/publish hh=${householdId} skipped — ${why}`);
    return false;
  };
  if (isAwaitingHouseEnrolment(householdId)) return skip('this device is awaiting enrolment');
  const session = await getLocalHouseSession(householdId);
  const ledger = session.ledger;
  if (!options?.force && !isOwnerRole(ledger.household.my_role)) {
    return skip(`not owner (my_role=${String(ledger.household.my_role)})`);
  }

  const { store, identity, householdKeys: keys } = session;
  const latest = await fetchLatestCheckpoint(ledger.household.id);
  const have: VersionVector = latest?.manifest.versionVector ?? {};
  const missing = await store.countOperationsSince(keys.householdId, have);
  const publishedEpoch = Number((await store.getMeta(publishedEpochMetaKey(householdId))) ?? '0');
  const staleEpoch = publishedEpoch !== keys.keyEpoch;
  if (latest && !options?.force && !staleEpoch && missing < CHECKPOINT_PUBLISH_MIN_OPS) {
    return skip(
      `gen=${latest.generation} is current enough — ${missing} op(s) since it, threshold is ${CHECKPOINT_PUBLISH_MIN_OPS}`,
    );
  }
  console.log(
    `[HouseLocal] checkpoint/publish hh=${householdId} publishing gen=${(latest?.generation ?? 0) + 1} epoch=${keys.keyEpoch} force=${options?.force === true} staleEpoch=${staleEpoch} missing=${missing}`,
  );

  const plaintext = await exportHouseCheckpointPlaintext(householdId);
  const generation = (latest?.generation ?? 0) + 1;
  const sealed = sealCheckpoint({
    plaintext,
    hdk: keys.hdk,
    generation,
    signerDeviceId: identity.deviceId,
    signingPrivateKey: identity.signingPrivateKey,
  });
  for (let i = 0; i < sealed.chunks.length; i += 1) {
    await putCheckpointChunk({
      householdId: ledger.household.id,
      generation,
      chunkIndex: i,
      chunkCount: sealed.chunks.length,
      ciphertextBase64: bytesToBase64(sealed.chunks[i]!),
      manifest: i === sealed.chunks.length - 1 ? sealed.manifest : undefined,
    });
  }
  await rememberPublishedHouseCheckpoint(plaintext.versionVector, householdId);
  // Written only after every chunk landed: a half-published generation must
  // still look stale, or the next rotation's republish is skipped.
  await store.setMeta(publishedEpochMetaKey(householdId), String(keys.keyEpoch));
  return true;
}

/**
 * What an install attempt actually did — the answer the old bare `false` threw
 * away.
 *
 * "There is no checkpoint yet" and "this device already holds everything in it"
 * are opposite facts that both returned false: the first means KEEP ASKING (the
 * owner has not uploaded the snapshot yet), the second means STOP (the backfill
 * is complete). Collapsing them is what let a joiner give up one poll before the
 * history appeared.
 */
export type CheckpointInstallOutcome =
  | 'installed'
  | 'already-current'
  | 'no-checkpoint'
  | 'not-enrolled'
  | 'not-needed';

export type CheckpointInstallHooks = {
  /** Called per chunk fetched, so a long download can be shown as progress. */
  onProgress?: (done: number, total: number) => void;
  /**
   * How many ROWS the opened snapshot holds, once it is decrypted and before it
   * is installed.
   *
   * Chunks measure the download and rows measure the home: "4/7" says nothing
   * about whether this is a studio flat or a decade of a house, and a member
   * watching a long install wants to know something arrived. This is the first
   * moment the count is knowable — the manifest does not carry it, so it cannot
   * be reported while the chunks are still coming down.
   */
  onRecords?: (rows: number) => void;
  onOutcome?: (outcome: CheckpointInstallOutcome) => void;
};

export async function tryInstallLatestCheckpoint(
  reason: 'bootstrap' | 'catch-up',
  householdIdInput?: string,
  hooks?: CheckpointInstallHooks,
): Promise<boolean> {
  const householdId = resolveHouseholdId(householdIdInput);
  // Every early return says why. This function returning a bare false is how a
  // home goes days without a bootstrap and nothing in the log says which of the
  // five reasons it was.
  const skip = (why: string, outcome: CheckpointInstallOutcome): false => {
    console.log(`[HouseLocal] checkpoint/install hh=${householdId} ${reason} skipped — ${why}`);
    hooks?.onOutcome?.(outcome);
    return false;
  };
  if (isAwaitingHouseEnrolment(householdId)) {
    return skip('this device is awaiting enrolment', 'not-enrolled');
  }
  const session = await getLocalHouseSession(householdId);
  const { ledger, householdKeys: keys, identity, store } = session;
  const latest = await fetchLatestCheckpoint(ledger.household.id);
  // The difference between "the owner has never published one" and "we could not
  // read the one that exists" is the whole diagnosis, and both used to return the
  // same bare false.
  if (!latest) return skip('the home has no published checkpoint at all', 'no-checkpoint');

  const ours = await store.getVersionVector(keys.householdId);
  const checkpointVv = latest.manifest.versionVector;
  if (reason === 'catch-up') {
    const lag = lagOps(ours, checkpointVv);
    if (lag < CATCH_UP_OPS_THRESHOLD) {
      return skip(`only ${lag} op(s) behind gen=${latest.generation}`, 'not-needed');
    }
    // Never install a checkpoint that is behind this device's OWN writes — it
    // would roll back ops this device authored and has not yet published.
    if ((checkpointVv[identity.deviceId] ?? 0) < (ours[identity.deviceId] ?? 0)) {
      return skip(
        `gen=${latest.generation} is behind this device's own unpublished writes`,
        'not-needed',
      );
    }
  } else if (Object.keys(ours).length > 0 && vvCovers(ours, checkpointVv)) {
    return skip(`already holding everything in gen=${latest.generation}`, 'already-current');
  }
  console.log(
    `[HouseLocal] checkpoint/install hh=${householdId} ${reason} opening gen=${latest.generation} chunks=${latest.chunkCount} signer=${latest.manifest.signerDeviceId} readEpoch=${keys.keyEpoch}`,
  );

  const state = await fetchControlPlaneState(ledger.household.id);
  const signer = state.devices.find(
    (d) => d.deviceId === latest.manifest.signerDeviceId && d.status === 'active',
  );
  if (!signer?.signingPublicKey) {
    throw new Error('checkpoint signer unknown');
  }

  const chunks = [];
  hooks?.onProgress?.(0, latest.chunkCount);
  for (let i = 0; i < latest.chunkCount; i += 1) {
    const chunk = await fetchCheckpointChunk(ledger.household.id, i);
    chunks.push(base64ToBytes(chunk.ciphertextBase64));
    // Reported per chunk rather than as one indeterminate spinner: a home with
    // years of history is a multi-megabyte download, and a member watching a
    // motionless "Syncing…" has no way to tell it apart from a stall.
    hooks?.onProgress?.(i + 1, latest.chunkCount);
  }
  const plain = openCheckpoint({
    chunks,
    manifest: latest.manifest as CheckpointManifest,
    hdk: keys.hdk,
    signerPublicKey: hexToBytes(signer.signingPublicKey),
  });
  hooks?.onRecords?.(plain.rows.length);
  console.log(
    `[HouseLocal] checkpoint/install hh=${householdId} ${reason} opened gen=${latest.generation} rows=${plain.rows.length}`,
  );
  await installHouseCheckpointPlaintext(plain, householdId);
  hooks?.onOutcome?.('installed');
  return true;
}

/**
 * The joiner's guarantee: keep asking for the home's snapshot until it is
 * actually on this device.
 *
 * `tryInstallLatestCheckpoint('bootstrap')` is a single attempt, and the sync
 * run used to make exactly one of them — gated on the version vector being
 * empty, which stops being true the instant the first live op from a peer is
 * applied. The owner deposits the household key and publishes the checkpoint as
 * two independent steps, so losing that race is the NORMAL case, not a rare one:
 * the joiner is enrolled, finds no checkpoint yet, applies a live op, and the
 * window is gone for good. What it is left with is the op backlog that survived
 * the owner's compaction — the recent weeks — which is why the symptom is always
 * the same shape: whatever has happened since the join is there, and the rooms,
 * the appliances, the documents and every earlier task are not.
 *
 * So the decision moves off the version vector and onto a durable marker
 * (`isHouseholdBootstrapPending`), and the attempt repeats on every sync pass
 * until it succeeds. Re-running it late is safe by construction:
 * `installHouseCheckpointPlaintext` replaces the projection and then REPLAYS
 * every local op newer than the snapshot's version vector, so ops that arrived
 * (or were authored here) in the meantime survive the install.
 */
export async function runHouseholdBackfill(
  householdId: string,
  hooks?: CheckpointInstallHooks,
): Promise<CheckpointInstallOutcome> {
  if (!(await isHouseholdBootstrapPending(householdId))) return 'not-needed';

  // Collected rather than assigned to a `let`: TypeScript narrows a `let` to its
  // initializer's literal type and cannot see the assignment that happens inside
  // the callback, so every comparison below would be flagged as impossible.
  const reported: CheckpointInstallOutcome[] = [];
  await tryInstallLatestCheckpoint('bootstrap', householdId, {
    onProgress: hooks?.onProgress,
    onRecords: hooks?.onRecords,
    onOutcome: (result) => reported.push(result),
  });
  // Defaults to `no-checkpoint` — the outcome that KEEPS the marker set — so an
  // install path that returns without reporting leaves the backfill owed rather
  // than silently declaring it complete.
  const outcome: CheckpointInstallOutcome = reported[reported.length - 1] ?? 'no-checkpoint';
  hooks?.onOutcome?.(outcome);

  // Cleared on the two outcomes that mean the history is HERE. Every other
  // outcome — no checkpoint published yet, still awaiting the household key —
  // leaves the marker set so the next pass tries again. `not-needed` cannot occur
  // under reason 'bootstrap'; it is listed so a future outcome cannot be silently
  // treated as success by falling through this check.
  if (outcome === 'installed' || outcome === 'already-current') {
    await clearHouseholdBootstrapPending(householdId);
    console.log(
      `[HouseLocal] backfill hh=${householdId} complete (${outcome}) — this device now holds the home's full history`,
    );
  } else {
    console.log(
      `[HouseLocal] backfill hh=${householdId} INCOMPLETE (${outcome}) — will retry on the next sync`,
    );
  }
  return outcome;
}

export async function maybeCompactAfterSync(householdId?: string): Promise<void> {
  try {
    await compactLocalHouseLogIfSafe(householdId);
  } catch (error) {
    console.warn('[house.local] compaction skipped', householdId, error);
  }
}
