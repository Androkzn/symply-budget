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
  compactLocalLogIfSafe,
  exportCheckpointPlaintext,
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  installCheckpointPlaintext,
  isAwaitingHouseholdEnrolment,
  isHouseholdBootstrapPending,
  rememberPublishedCheckpoint,
} from '../engine';

function isOwnerRole(role: string | undefined): boolean {
  return (role ?? '').toUpperCase() === 'OWNER';
}

/**
 * Which household this checkpoint pass is for (BR-016 §B3).
 *
 * Every value below is then read off that household's session handle rather
 * than off `getLocalLedger()` / `getLocalHouseholdKeys()` / `getLocalStore()`.
 * A background sync for household B routinely runs while A is the one on
 * screen, and the active accessors would seal B's snapshot under A's HDK, sign
 * it with A's generation counter and publish it to A's peers — a checkpoint
 * that is correctly encrypted, correctly signed, and for the wrong budget.
 *
 * Publishing is also owner-only PER HOUSEHOLD: a member can own one budget and
 * merely be a member of another, so even the role gate has to read that
 * household's ledger and not whichever one happens to be active.
 */
function resolveHouseholdId(householdId?: string): string {
  const id = householdId ?? getActiveBudgetHouseholdId();
  if (!id) throw new Error('checkpoints: no household is active');
  return id;
}

/**
 * The epoch this device last published a checkpoint under, per household.
 *
 * A checkpoint is sealed once and never re-sealed, so after a rotation the
 * household's newest snapshot is unreadable to anyone who does not hold the
 * retired key — which, before the enrolment ring, was every joiner. Recording
 * the epoch is what lets the owner notice and republish on its own, rather than
 * relying on somebody remembering to pass `force`.
 */
/** Purged by `removeLocalBudgetHousehold` — keep the string in step with its list. */
const publishedEpochMetaKey = (householdId: string) => `lf.checkpoint.epoch:${householdId}`;

/**
 * Owner publishes a checkpoint when the log has grown past the watermark.
 *
 * `force` is for the two moments when the op count is the wrong question:
 *
 *  - a member was just approved, and the snapshot they are about to bootstrap
 *    from must exist and must be current;
 *  - the household key just rotated, so the newest snapshot is sealed under a
 *    key the household is no longer using.
 *
 * Without it the gate is `missing >= 100 ops`, which an owner with a modest
 * ledger never clears — `Sweet Home` sat on generation 1 for nine days, sealed
 * under epoch 1 while the household ran at epoch 5, and every joiner
 * bootstrapped from a snapshot they could not decrypt.
 *
 * `force` also bypasses the LOCAL role flag, deliberately. Both forced callers
 * have just had this device authorised as an owner by the server — only an
 * owner may approve an invite or revoke a device — whereas
 * `ledger.household.my_role` is a local string that a backup restore or a
 * migrated household can carry wrongly. Trusting it here would mean the one
 * publish a joining member depends on is skipped because of a stale label, and
 * the failure would be invisible: the member simply gets nothing.
 */
export async function maybePublishCheckpoint(
  householdIdInput?: string,
  options?: { force?: boolean },
): Promise<boolean> {
  const householdId = resolveHouseholdId(householdIdInput);
  // Every early return says why. This function returning false silently is how
  // `Sweet Home` went nine days without a single `PUT /checkpoints` — the
  // owner's device was declining to publish on every sync and nothing said so.
  const skip = (why: string): false => {
    console.log(`[BudgetLocal] checkpoint/publish hh=${householdId} skipped — ${why}`);
    return false;
  };
  if (isAwaitingHouseholdEnrolment(householdId)) return skip('this device is awaiting enrolment');
  if (await isHouseholdBootstrapPending(householdId)) return skip('household history is still downloading');
  const session = await getLocalBudgetSession(householdId);
  const ledger = session.ledger;
  if (!options?.force && !isOwnerRole(ledger.household.my_role)) {
    return skip(`not owner (my_role=${String(ledger.household.my_role)})`);
  }

  const { store, identity, householdKeys: keys } = session;
  const latest = await fetchLatestCheckpoint(ledger.household.id);
  const have: VersionVector = latest?.manifest.versionVector ?? {};
  const missing = await store.countOperationsSince(keys.householdId, have);
  const publishedEpoch = Number(
    (await store.getMeta(publishedEpochMetaKey(householdId))) ?? '0',
  );
  const staleEpoch = publishedEpoch !== keys.keyEpoch;
  if (latest && !options?.force && !staleEpoch && missing < CHECKPOINT_PUBLISH_MIN_OPS) {
    return skip(
      `gen=${latest.generation} is current enough — ${missing} op(s) since it, threshold is ${CHECKPOINT_PUBLISH_MIN_OPS}`,
    );
  }


  const plaintext = await exportCheckpointPlaintext(householdId);
  if (latest && !vvCovers(plaintext.versionVector, latest.manifest.versionVector)) {
    return skip('local history is behind the published checkpoint');
  }
  // Separate simultaneous publishers while remaining within a safe integer.
  const generation = Math.max((latest?.generation ?? 0) + 1, Date.now() * 1024 + Math.floor(Math.random() * 1024));
  console.log(
    `[BudgetLocal] checkpoint/publish hh=${householdId} publishing gen=${generation} epoch=${keys.keyEpoch} force=${options?.force === true} staleEpoch=${staleEpoch} missing=${missing}`,
  );
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
      manifest: sealed.manifest,
    });
  }
  // Named, because the watermark is a key family now (`lf.checkpoint.vv:<id>`).
  // Unnamed it would record B's published vector against A's key and A's next
  // compaction would truncate against a vector describing neither household.
  await rememberPublishedCheckpoint(plaintext.versionVector, householdId);
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
  onOutcome?: (outcome: CheckpointInstallOutcome) => void;
  onApplying?: () => void;
  onApplied?: () => Promise<void>;
};

export async function tryInstallLatestCheckpoint(
  reason: 'bootstrap' | 'catch-up',
  householdIdInput?: string,
  hooks?: CheckpointInstallHooks,
): Promise<boolean> {
  const householdId = resolveHouseholdId(householdIdInput);
  const skip = (why: string, outcome: CheckpointInstallOutcome): false => {
    console.log(`[BudgetLocal] checkpoint/install hh=${householdId} ${reason} skipped — ${why}`);
    hooks?.onOutcome?.(outcome);
    return false;
  };
  if (isAwaitingHouseholdEnrolment(householdId)) {
    return skip('this device is awaiting enrolment', 'not-enrolled');
  }
  const session = await getLocalBudgetSession(householdId);
  const { ledger, householdKeys: keys, identity, store } = session;
  // Read ONCE, and tolerate its absence. This is the only ring read on the
  // install path, and one of its two uses is a log line — a diagnostic must
  // never be the reason a member fails to receive the household's history.
  const ring = session.retiredHouseholdKeys ?? new Map<number, Uint8Array>();
  const latest = await fetchLatestCheckpoint(ledger.household.id);
  // The difference between "the owner has never published one" and "we could
  // not read the one that exists" is the whole diagnosis, and both used to
  // return the same bare false.
  if (!latest) return skip('the household has no published checkpoint at all', 'no-checkpoint');

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
    `[BudgetLocal] checkpoint/install hh=${householdId} ${reason} opening gen=${latest.generation} chunks=${latest.chunkCount} signer=${latest.manifest.signerDeviceId} readEpoch=${keys.keyEpoch} ring=[${[...ring.keys()].sort((a, b) => a - b).join(',')}]`,
  );

  const state = await fetchControlPlaneState(ledger.household.id);
  const signer = state.devices.find(
    (d) => d.deviceId === latest.manifest.signerDeviceId && d.status === 'active',
  );
  if (!signer?.signingPublicKey) {
    // A checkpoint whose signer has since been revoked is unverifiable and
    // therefore uninstallable — permanently, for every device. Worth naming:
    // it looks identical to a decrypt failure from the outside.
    throw new Error(
      `checkpoint signer unknown or revoked: ${latest.manifest.signerDeviceId} (gen=${latest.generation})`,
    );
  }

  const chunks = [];
  hooks?.onProgress?.(0, latest.chunkCount);
  for (let i = 0; i < latest.chunkCount; i += 1) {
    const chunk = await fetchCheckpointChunk(ledger.household.id, i, latest.generation);
    if (chunk.generation !== latest.generation || chunk.chunkIndex !== i) {
      throw new Error('Checkpoint generation changed during download; retry required');
    }
    chunks.push(base64ToBytes(chunk.ciphertextBase64));
    // Reported per chunk rather than as one indeterminate spinner: a household
    // with years of history is a multi-megabyte download, and a member watching
    // a motionless "Syncing…" has no way to tell it apart from a stall.
    hooks?.onProgress?.(i + 1, latest.chunkCount);
  }
  hooks?.onApplying?.();
  let plain;
  try {
    plain = openCheckpoint({
      chunks,
      manifest: latest.manifest as CheckpointManifest,
      hdk: keys.hdk,
      // A checkpoint is sealed once and never re-sealed, so the generation a
      // joiner bootstraps from is routinely older than the household's current
      // epoch. Without the ring this threw `aeadDecrypt` failed, the orchestrator
      // logged "checkpoint install skipped", and the member sat on an empty
      // ledger — the exact production failure on `Sweet Home`.
      retiredHdks: ring.values(),
      signerPublicKey: hexToBytes(signer.signingPublicKey),
    });
  } catch (error) {
    // Re-thrown with the epochs attached. "aeadDecrypt failed" tells you
    // nothing; "no key on the ring [5] opened gen=1" tells you the household
    // rotated away from the snapshot and the owner has to republish.
    throw new Error(
      `checkpoint gen=${latest.generation} would not open — no key on ring [${[keys.keyEpoch, ...ring.keys()].sort((a, b) => a - b).join(',')}] fits it: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  console.log(
    `[BudgetLocal] checkpoint/install hh=${householdId} ${reason} opened gen=${latest.generation} rows=${plain.rows.length} sealedAtEpoch=${plain.keyEpoch}`,
  );
  // `installCheckpointPlaintext` clears that household's rows before it writes,
  // so naming the wrong one is a wipe. It re-checks `plain.householdId` against
  // the session it was given and throws on a mismatch; passing the id here is
  // what makes that check meaningful rather than a comparison of the active
  // household against itself.
  await installCheckpointPlaintext(plain, householdId);
  await hooks?.onApplied?.();
  hooks?.onOutcome?.('installed');
  return true;
}

/**
 * The joiner's guarantee: keep asking for the household's snapshot until it is
 * actually on this device.
 *
 * `tryInstallLatestCheckpoint('bootstrap')` is a single attempt, and the sync
 * run used to make exactly one of them — gated on the version vector being
 * empty, which stops being true the instant the first live op from a peer is
 * applied. The owner deposits the household key and publishes the checkpoint as
 * two independent steps, so losing that race is the NORMAL case, not a rare one:
 * the joiner is enrolled, finds no checkpoint yet, applies a live op, and the
 * window is gone for good. What it is left with is the op backlog that survived
 * the owner's compaction — the recent weeks — which is why the symptom is
 * always the same shape: this month is there, and the goals, the income and
 * every earlier month are not.
 *
 * So the decision moves off the version vector and onto a durable marker
 * (`isHouseholdBootstrapPending`), and the attempt repeats on every sync pass
 * until it succeeds. Re-running it late is safe by construction:
 * `installCheckpointPlaintext` replaces the projection and then REPLAYS every
 * local op newer than the snapshot's version vector, so ops that arrived (or
 * were authored here) in the meantime survive the install.
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
    onApplying: hooks?.onApplying,
    onApplied: hooks?.onApplied,
    onOutcome: (result) => reported.push(result),
  });
  // Defaults to `no-checkpoint` — the outcome that KEEPS the marker set — so an
  // install path that returns without reporting leaves the backfill owed rather
  // than silently declaring it complete.
  const outcome: CheckpointInstallOutcome = reported[reported.length - 1] ?? 'no-checkpoint';
  hooks?.onOutcome?.(outcome);

  // Cleared on the two outcomes that mean the history is HERE. Every other
  // outcome — no checkpoint published yet, still awaiting the household key —
  // leaves the marker set so the next pass tries again. `not-needed` cannot
  // occur under reason 'bootstrap'; it is listed so a future outcome cannot be
  // silently treated as success by falling through this check.
  if (outcome === 'installed' || outcome === 'already-current') {
    await clearHouseholdBootstrapPending(householdId);
    console.log(
      `[BudgetLocal] backfill hh=${householdId} complete (${outcome}) — this device now holds the household's full history`,
    );
  } else {
    console.log(
      `[BudgetLocal] backfill hh=${householdId} INCOMPLETE (${outcome}) — will retry on the next sync`,
    );
  }
  return outcome;
}

/**
 * Compaction reads the per-household watermark (`lf.checkpoint.vv:<id>`), so it
 * has to be told which household the sync pass just finished.
 *
 * Left unnamed during a background pass it compacts whichever household is on
 * screen instead. That was survivable while the watermark was one global key
 * only because there was one household; with two, A's checkpoint vector
 * intersected against B's log truncates ops B has never published, and a
 * compacted op is not re-derivable — the rows it carried are simply gone.
 */
export async function maybeCompactAfterSync(householdId?: string): Promise<void> {
  try {
    await compactLocalLogIfSafe(householdId);
  } catch (error) {
    console.warn('[budget.local] compaction skipped', householdId, error);
  }
}
