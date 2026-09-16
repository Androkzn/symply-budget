/**
 * Checkpoint publish / install / compaction for Health — stage He8.
 *
 * Inherited from House (`house/local/sync/checkpoints.ts`) with the thresholds
 * unchanged: publish at ≥100 ops, catch up at 500 ops or 14 days, retain 3
 * generations / 90 days. What changes is only *who may publish*: House gates on
 * `my_role === 'OWNER'` per property, because a member of someone else's home
 * must not overwrite its history. A Health household has exactly one user
 * (plan §1.2), so the sole user **is** the owner and the role check would be a
 * tautology — the honest guard is "is the session open and are we actually
 * holding this household's HDK", not a role string.
 *
 * TWO IDEMPOTENCE PROPERTIES ARE LOAD-BEARING (DoD He8)
 * -----------------------------------------------------
 * 1. **Publish is idempotent on `(householdId, generation)`.** A generation is
 *    the identity of a checkpoint, not a counter of attempts: re-running publish
 *    with nothing new must upload zero chunks, and the same generation number
 *    must never be reused for different content. Both devices of one user run
 *    this loop, so "publish again on the next foreground" is the normal case,
 *    not an error path.
 * 2. **Bootstrap is idempotent.** Installing a checkpoint REPLACES the
 *    projection. A second install of a checkpoint this device already covers
 *    would re-stamp every row at `RESTORE_HLC` and re-emit the whole ledger as
 *    changed — a duplicate ledger in every sense the user can see. The version
 *    vector is what makes the second run a no-op.
 */
import {
  CATCH_UP_OPS_THRESHOLD,
  CHECKPOINT_PUBLISH_MIN_OPS,
  base64ToBytes,
  hexToBytes,
  lagOps,
  openCheckpoint,
  sealCheckpoint,
  vvCovers,
  type CheckpointManifest,
  type VersionVector,
} from '@symply/local-first';

import {
  fetchHealthCheckpointChunk,
  fetchHealthControlPlaneState,
  fetchLatestHealthCheckpoint,
  putHealthCheckpointChunk,
} from '../controlPlaneClient';
import {
  compactLocalHealthLogIfSafe,
  exportHealthCheckpointPlaintext,
  getLocalHealthHouseholdKeys,
  getLocalHealthIdentity,
  getLocalHealthStore,
  installHealthCheckpointPlaintext,
  isLocalHealthSessionOpen,
  rememberPublishedHealthCheckpoint,
} from '../engine';

type PublishedCheckpoint = { generation: number; versionVector: VersionVector };

/**
 * What this process has already put on the relay, per household.
 *
 * The remote `latest` is the primary source of truth; this is the guard for the
 * window where it is not yet visible — a publish that succeeded but whose read
 * back has not landed, or a relay that answers 404 for a generation it holds.
 * Without it, two runs in that window both compute `generation = 1` and upload
 * two different bodies under one identity.
 */
const lastPublished = new Map<string, PublishedCheckpoint>();

/** Single-flight per household: two concurrent runs must not both take a generation. */
const publishInFlight = new Map<string, Promise<boolean>>();

function requireHouseholdId(): string {
  const householdId = getLocalHealthHouseholdKeys().householdId;
  if (!householdId) throw new Error('checkpoints: no Health household is open');
  return householdId;
}

/**
 * Publish a checkpoint once the log has grown past the watermark.
 *
 * Returns whether chunks were actually uploaded — `false` means "nothing to do",
 * which is the expected answer on most runs and on every re-run.
 */
export async function maybePublishHealthCheckpoint(): Promise<boolean> {
  if (!isLocalHealthSessionOpen()) return false;
  const householdId = requireHouseholdId();

  const existing = publishInFlight.get(householdId);
  if (existing) return existing;

  const run = publishOnce(householdId).finally(() => {
    publishInFlight.delete(householdId);
  });
  publishInFlight.set(householdId, run);
  return run;
}

async function publishOnce(householdId: string): Promise<boolean> {
  const store = getLocalHealthStore();
  const identity = getLocalHealthIdentity();
  const keys = getLocalHealthHouseholdKeys();

  const latest = await fetchLatestHealthCheckpoint(householdId);
  const have: VersionVector = latest?.manifest.versionVector ?? {};
  const missing = await store.countOperationsSince(householdId, have);
  // The first checkpoint always publishes: a device with no checkpoint at all is
  // the one case where the watermark is exactly the wrong test — its peer cannot
  // bootstrap from a log it may already have compacted below.
  if (latest && missing < CHECKPOINT_PUBLISH_MIN_OPS) return false;

  const plaintext = await exportHealthCheckpointPlaintext();
  const planned = plaintext.versionVector;
  const priorLocal = lastPublished.get(householdId);

  // Generation is monotone across BOTH sources: the relay's view and this
  // process's. Taking only the relay's would reuse a number this process has
  // already spent when the read-back lags; taking only the local one would
  // collide with a generation the user's other device published.
  const generation = Math.max(latest?.generation ?? 0, priorLocal?.generation ?? 0) + 1;

  // The idempotence check itself: same content as what we last published means
  // there is no new generation to mint, so upload nothing.
  if (priorLocal && vvCovers(priorLocal.versionVector, planned)) return false;

  const sealed = sealCheckpoint({
    plaintext,
    hdk: keys.hdk,
    generation,
    signerDeviceId: identity.deviceId,
    signingPrivateKey: identity.signingPrivateKey,
  });
  for (let i = 0; i < sealed.chunks.length; i += 1) {
    await putHealthCheckpointChunk({
      householdId,
      generation,
      chunkIndex: i,
      chunkCount: sealed.chunks.length,
      // Raw bytes: `putHealthCheckpointChunk` base64s them itself. Encoding
      // here too double-encoded every chunk, so the relay stored a checkpoint
      // that could never be opened.
      ciphertext: sealed.chunks[i]!,
      // The manifest lands with the LAST chunk: it is what makes the set
      // readable, so publishing it first would advertise a checkpoint whose
      // body is still uploading.
      manifest: i === sealed.chunks.length - 1 ? sealed.manifest : undefined,
    });
  }

  lastPublished.set(householdId, { generation, versionVector: planned });
  // Tells the engine how far the log may now be compacted — ops below a
  // published checkpoint are recoverable from it.
  // The GENERATION, not the version vector — the engine reads the VV from
  // `session.lastExportedCheckpointVv` itself. Passing `planned` here wrote a
  // stringified object into the generation meta key, so the next compaction
  // compared a number against `[object Object]` and never advanced.
  await rememberPublishedHealthCheckpoint(generation);
  return true;
}

/**
 * Install the relay's latest checkpoint.
 *
 * `bootstrap` is a device that holds nothing; `catch-up` is a device that has
 * fallen far enough behind that replaying the log costs more than replacing the
 * projection. The two differ in what would make installing WRONG, which is why
 * they are not one code path with a boolean.
 */
export async function tryInstallLatestHealthCheckpoint(
  reason: 'bootstrap' | 'catch-up',
): Promise<boolean> {
  if (!isLocalHealthSessionOpen()) return false;
  const householdId = requireHouseholdId();
  const store = getLocalHealthStore();
  const identity = getLocalHealthIdentity();
  const keys = getLocalHealthHouseholdKeys();

  const latest = await fetchLatestHealthCheckpoint(householdId);
  if (!latest) return false;

  const ours = await store.getVersionVector(householdId);
  const checkpointVv = latest.manifest.versionVector;

  if (reason === 'catch-up') {
    if (lagOps(ours, checkpointVv) < CATCH_UP_OPS_THRESHOLD) return false;
    // Never install a checkpoint that is behind this device's OWN writes — it
    // would roll back ops this device authored and has not yet published. This
    // is House's extra guard and it matters MORE here: with one user, the other
    // device is not a co-author whose copy will restore the loss, and a rolled
    // back weigh-in or habit log is simply gone.
    if ((checkpointVv[identity.deviceId] ?? 0) < (ours[identity.deviceId] ?? 0)) {
      return false;
    }
  } else if (Object.keys(ours).length > 0 && vvCovers(ours, checkpointVv)) {
    // Bootstrap idempotence: we already hold everything this checkpoint carries.
    return false;
  }

  // The signer must be a device the control plane currently lists as active.
  // A revoked device's signature is not evidence of anything: it may be the
  // device whose loss caused the revocation.
  const state = await fetchHealthControlPlaneState(householdId);
  const signer = state.devices.find(
    (d) => d.deviceId === latest.manifest.signerDeviceId && d.status === 'active',
  );
  if (!signer?.signingPublicKey) {
    throw new Error('checkpoint signer unknown');
  }

  const chunks = [];
  for (let i = 0; i < latest.chunkCount; i += 1) {
    const chunk = await fetchHealthCheckpointChunk(householdId, i);
    chunks.push(base64ToBytes(chunk.ciphertextBase64));
  }
  // Atomic by construction: every chunk plus a verifying manifest must open
  // before anything replaces the projection.
  const plain = openCheckpoint({
    chunks,
    manifest: latest.manifest as CheckpointManifest,
    hdk: keys.hdk,
    signerPublicKey: hexToBytes(signer.signingPublicKey),
  });
  await installHealthCheckpointPlaintext(plain);
  return true;
}

/** Trim the op log below the published watermark. Never fatal to a sync. */
export async function maybeCompactHealthLogAfterSync(): Promise<void> {
  try {
    await compactLocalHealthLogIfSafe();
  } catch (error) {
    console.warn('[health.local] compaction skipped', error);
  }
}

/**
 * Drop the in-process publish memo.
 *
 * Exported for tests and for account switch / teardown: the memo is keyed by
 * household id, and a household id can be re-minted for a different user on the
 * same device, at which point "we already published generation 3" is a claim
 * about someone else's ledger.
 */
export function resetHealthCheckpointPublishState(): void {
  lastPublished.clear();
  publishInFlight.clear();
}
