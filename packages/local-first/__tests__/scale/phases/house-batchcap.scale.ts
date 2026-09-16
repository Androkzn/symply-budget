/**
 * House H10 — op-batch size vs the 512,000-char relay cap.
 *
 * The relay is shared, so the cap is the same number Budget faces; what changes
 * is how fast House fills it. House writes more ops per day than Budget at the
 * same age (maintenance completions, subtask toggles and checklist completions
 * are all high-frequency), so "how many deposits does one catch-up cost" is a
 * House-specific answer even though the machinery is identical.
 *
 * `sealOpBatch` is the REAL encoder and `MAX_MAILBOX_CIPHERTEXT_B64` the REAL
 * cap; the op count that fits is found by binary search, not estimated. Bytes
 * per op here are for the v2/base64 wire and are NOT comparable with any v1/hex
 * figure.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import { bytesToBase64 } from '../../../src/crypto/base64';
import { sealOpBatch } from '../../../src/sync/batch';
import {
  CHUNK_BUDGET_B64,
  MAX_MAILBOX_CIPHERTEXT_B64,
  base64Length,
  buildBatch,
  findMaxOpsUnderCap,
  type BatchIdentity,
} from '../lib/batch-cap';
import { generateHouseLedger } from '../lib/house-ledger-factory';
import { generateHouseOps, versionVectorFor } from '../lib/house-oplog-factory';
import { startHousePhase } from '../lib/house-phase';
import { stats } from '../lib/measure';
import { pseudoBytes } from '../lib/oplog-factory';

const SIGNING_PUBLIC_KEY_B64 = bytesToBase64(pseudoBytes(32, 0xc0ffee));

describe('house scale: op batch vs the relay cap', () => {
  it('measures', () => {
    const ctx = startHousePhase('batchcap');
    const { recorder, scale } = ctx;

    const hdk = pseudoBytes(32, 0xb0b);
    const ledger = generateHouseLedger(ctx.spec);
    const householdId = String(ledger.household.id);
    const ops = generateHouseOps({
      ledger,
      count: scale.ops,
      hdk,
      householdId,
      seed: ctx.spec.seed,
    });

    const identity: BatchIdentity = {
      householdId,
      senderDeviceId: ledger.deviceId,
      senderSigningPublicKeyB64: SIGNING_PUBLIC_KEY_B64,
      // Derived from the ops, so it really is one entry per device — the log is
      // multi-device and the header rides on EVERY batch, so its size is not free.
      senderVersionVector: versionVectorFor(ops),
    };

    // ---- how many ops fit in ONE deposit --------------------------------
    const search = findMaxOpsUnderCap({
      ...identity,
      ops,
      hdk,
      keyEpoch: 1,
      cap: MAX_MAILBOX_CIPHERTEXT_B64,
    });

    if (search.justOver && search.justOver.ops !== search.maxOps + 1) {
      throw new Error('cap search did not bracket the boundary');
    }
    if (search.justOver?.fits) {
      throw new Error('cap search returned a fitting op count as the over-cap probe');
    }

    recorder.count(
      'batchcap.maxOpsUnderCap',
      search.maxOps,
      'ops',
      'higher',
      `${search.probes} probes`,
    );
    recorder.size(
      'batchcap.b64AtMax',
      search.atMax.b64,
      'chars',
      `cap ${MAX_MAILBOX_CIPHERTEXT_B64}`,
    );
    recorder.ratio(
      'batchcap.ciphertextB64PerOp',
      search.atMax.b64 / Math.max(1, search.maxOps),
      'lower',
    );
    recorder.ratio(
      'batchcap.bytesPerOp',
      search.atMax.ciphertextBytes / Math.max(1, search.maxOps),
      'lower',
      'sealed ciphertext bytes per op — v2/base64 wire',
    );

    // The packer aims below the cap for seal-size jitter, so the number that
    // actually governs a chunk is the budget, not the cap.
    const budgeted = findMaxOpsUnderCap({
      ...identity,
      ops,
      hdk,
      keyEpoch: 1,
      cap: CHUNK_BUDGET_B64,
    });
    recorder.count(
      'batchcap.maxOpsUnderChunkBudget',
      budgeted.maxOps,
      'ops',
      'higher',
      `budget ${CHUNK_BUDGET_B64} = cap x CHUNK_FILL_RATIO`,
    );

    // ---- the whole log at this scale ------------------------------------
    const fullBatch = buildBatch({ ...identity, ops });
    const sealSamples: number[] = [];
    let sealedBytes = 0;
    for (let k = 0; k < 3; k += 1) {
      const t0 = performance.now();
      const sealed = sealOpBatch(fullBatch, hdk, 1);
      sealSamples.push(performance.now() - t0);
      sealedBytes = sealed.length;
      if (k === 0) {
        const trueB64 = bytesToBase64(sealed).length;
        if (trueB64 !== base64Length(sealed.length)) {
          throw new Error(`base64 estimator drift: ${base64Length(sealed.length)} vs ${trueB64}`);
        }
      }
    }

    const fullB64 = base64Length(sealedBytes);
    recorder.time('batchcap.sealOpBatch.fullLog', stats(sealSamples), `${scale.ops} ops`);
    recorder.size('batchcap.b64AtScale', fullB64, 'chars', `whole log of ${scale.ops} ops`);
    recorder.ratio(
      'batchcap.overCapRatioAtScale',
      fullB64 / MAX_MAILBOX_CIPHERTEXT_B64,
      'lower',
      '>1 means the whole log cannot be one deposit',
    );
    recorder.count(
      'batchcap.chunksForFullLog',
      Math.max(1, Math.ceil(scale.ops / Math.max(1, budgeted.maxOps))),
      'count',
      'lower',
      'deposits a full catch-up costs at this scale',
    );

    // ---- restated as something a user experiences ------------------------
    const opsPerDay = scale.ops / (365 * ctx.spec.years);
    // A corpus property, not a product one: if it moves, the generator moved
    // and no other number in this run is comparable with the baseline.
    recorder.ratio('batchcap.opsPerDay', opsPerDay, 'flat', 'at this corpus profile');
    recorder.ratio(
      'batchcap.daysOfHistoryPerDeposit',
      search.maxOps / opsPerDay,
      'higher',
      'days of history one deposit can carry',
    );

    recorder.end();
  });
});
