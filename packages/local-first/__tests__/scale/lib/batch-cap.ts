/**
 * Op-batch cap search, extracted from the phase so the cheap guard
 * (`batchcap.test.ts`) can prove the search on a small corpus.
 *
 * Everything load-bearing is IMPORTED, never reimplemented: `sealOpBatch` and
 * `MAILBOX_BATCH_VERSION` from sync/batch.ts, `base64Length`,
 * `MAX_MAILBOX_CIPHERTEXT_B64` and `CHUNK_FILL_RATIO` from sync/mailbox-engine.ts.
 * A local copy of any of them would let this phase keep passing after the wire
 * format changes while measuring something that no longer ships — which is
 * exactly what happened once already: this tree's `OpBatch` is v2/base64, not
 * the v1/hex the scale audit measured.
 *
 * The typed `OpBatch` header below is deliberate drift detection: renaming a
 * header field breaks the build here rather than silently changing every byte
 * count in the baseline.
 */
import type { StoredOperation, VersionVector } from '../../../src/store/types';
import {
  MAILBOX_BATCH_VERSION,
  sealOpBatch,
  serializeOperation,
  type OpBatch,
} from '../../../src/sync/batch';
import {
  CHUNK_FILL_RATIO,
  MAX_MAILBOX_CIPHERTEXT_B64,
  base64Length,
} from '../../../src/sync/mailbox-engine';

export { CHUNK_FILL_RATIO, MAX_MAILBOX_CIPHERTEXT_B64, base64Length };

/** What `sealChunks` actually targets: the cap minus its jitter headroom. */
export const CHUNK_BUDGET_B64 = Math.floor(MAX_MAILBOX_CIPHERTEXT_B64 * CHUNK_FILL_RATIO);

export type BatchIdentity = {
  householdId: string;
  senderDeviceId: string;
  senderSigningPublicKeyB64: string;
  senderVersionVector: VersionVector;
};

export function batchHeader(identity: BatchIdentity): Omit<OpBatch, 'ops'> {
  return {
    v: MAILBOX_BATCH_VERSION,
    householdId: identity.householdId,
    senderDeviceId: identity.senderDeviceId,
    senderSigningPublicKeyB64: identity.senderSigningPublicKeyB64,
    senderVersionVector: identity.senderVersionVector,
  };
}

export function buildBatch(input: BatchIdentity & { ops: StoredOperation[] }): OpBatch {
  return { ...batchHeader(input), ops: input.ops.map(serializeOperation) };
}

export type CapProbe = { ops: number; ciphertextBytes: number; b64: number; fits: boolean };

export type CapInput = BatchIdentity & {
  ops: StoredOperation[];
  hdk: Uint8Array;
  keyEpoch: number;
  cap: number;
};

export function probeBatch(input: CapInput & { count: number }): CapProbe {
  const batch = buildBatch({ ...input, ops: input.ops.slice(0, input.count) });
  const sealed = sealOpBatch(batch, input.hdk, input.keyEpoch);
  const b64 = base64Length(sealed.length);
  return { ops: input.count, ciphertextBytes: sealed.length, b64, fits: b64 <= input.cap };
}

export type CapSearch = {
  maxOps: number;
  atMax: CapProbe;
  justOver: CapProbe | null;
  probes: number;
};

/**
 * Largest op count whose sealed batch still fits under `cap`.
 *
 * Exponential bracket first, then bisect. The answer is in the hundreds while
 * the corpus is in the tens of thousands, so a plain bisect over the whole
 * range would seal multi-megabyte batches on its first probes for no reason.
 */
export function findMaxOpsUnderCap(input: CapInput): CapSearch {
  const total = input.ops.length;
  if (total === 0) throw new Error('findMaxOpsUnderCap: no ops');

  let probes = 0;
  const measure = (count: number): CapProbe => {
    probes += 1;
    return probeBatch({ ...input, count });
  };

  let lowProbe = measure(1);
  if (!lowProbe.fits) return { maxOps: 0, atMax: lowProbe, justOver: null, probes };

  // Exponential bracket up to the first count that does NOT fit.
  let low = 1;
  let high = 0;
  let highProbe: CapProbe | null = null;
  for (let candidate = 2; ; candidate *= 2) {
    const n = Math.min(candidate, total);
    const probe = measure(n);
    if (!probe.fits) {
      high = n;
      highProbe = probe;
      break;
    }
    low = n;
    lowProbe = probe;
    if (n === total) {
      // The whole log still fits: no cap breach at this scale.
      return { maxOps: total, atMax: probe, justOver: null, probes };
    }
  }

  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    const probe = measure(mid);
    if (probe.fits) {
      low = mid;
      lowProbe = probe;
    } else {
      high = mid;
      highProbe = probe;
    }
  }

  // The bisect terminates with high === low + 1, so `highProbe` is the probe
  // for exactly one op more than fits.
  return { maxOps: low, atMax: lowProbe, justOver: highProbe, probes };
}
