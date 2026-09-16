/**
 * Health He10 — a SINGLE MEAL `mutate`, end to end, plus the N5 decision input.
 *
 * The plan's normative row is "Single meal `mutate` — 250 ms p95". A `mutate`
 * is not `diffLedger`; it is everything a facade write does before the user's
 * tap is durable and shareable:
 *
 *   captureLedgerSnapshot → push the nutrition row → diffLedger
 *     → encodeLedgerOpPayload → AEAD-seal the op
 *     → collectRowWrites → per-row AEAD seal
 *
 * Reporting only the diff would answer a question nobody asked. Every step is
 * recorded separately so a breach names a step, and `mutate.total` is the gated
 * number.
 *
 * A MEAL, NOT A CUP OF WATER
 * --------------------------
 * `water_entries` is the higher-cardinality table, but the plan names the meal,
 * and a `nutrition_entries` row is ~5x the width of a water row (18 columns vs
 * 8), so the meal is both the specified and the more expensive write. The cup
 * is measured beside it for contrast — it is the tap a user makes six times a
 * day, and if the two differ materially that is a fact He3's facade design
 * needs.
 *
 * THE WIDE ROW IS `healthGoals`, NOT `bodyMeasurements`
 * ----------------------------------------------------
 * `body_measurements` has 40+ optional columns but a real taping session fills
 * 8-14 of them. `health_goals` fills ~60 on every row, because the per-weekday
 * calorie and macro overrides are written as a block. It is Health's answer to
 * House's `tasks`: the row whose per-field LWW map is the N5 hazard (plan §1.6).
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  captureLedgerSnapshot,
  collectRowWrites,
  diffLedger,
  encodeLedgerOpPayload,
  type LedgerDelta,
} from '../../../../../src/features/health/local/projection';
import { aeadEncrypt } from '../../../src/crypto/aead';
import { utf8Encode } from '../../../src/crypto/bytes';
import { rowAad, sealRowBody } from '../../../src/store/row-aead';
import { lwwStampCountOf } from '../lib/corpus-core';
import {
  HEALTH_REGISTRY,
  generateHealthLedger,
  type ScaleRow,
} from '../lib/health-ledger-factory';
import { cryptoBundleFor, generateHealthOps, pseudoBytes } from '../lib/health-oplog-factory';
import { startHealthPhase } from '../lib/health-phase';
import {
  HEALTH_EXIT_THRESHOLDS,
  assertExitChecks,
  recordExitChecks,
  timeCheck,
} from '../lib/health-thresholds';
import { exact, forceGc, stats } from '../lib/measure';

/** `compare`'s regression statistic. The He10 gate reads `p95` off the record. */
const GRADE_P50 = { stat: 'p50' } as const;

const OP_AAD = utf8Encode('op-payload-v1');

describe('health scale: single meal mutate, end to end', () => {
  it('measures', () => {
    const ctx = startHealthPhase('edit');
    const { recorder, scale, iters } = ctx;

    const dbKey = pseudoBytes(32, 0xa11ce);
    const hdk = pseudoBytes(32, 0xb0b);

    const ledger = generateHealthLedger(ctx.spec);
    ledger.ops = generateHealthOps({
      ledger,
      count: scale.ops,
      hdk,
      householdId: String(ledger.household.id),
      seed: ctx.spec.seed,
    });
    ledger.crypto = cryptoBundleFor(ctx.spec.seed);

    const householdId = String(ledger.household.id);
    const meals = ledger.nutritionEntries as ScaleRow[];
    const template = { ...meals[Math.floor(meals.length / 3)]! };

    // ---- the whole mutate, step by step ---------------------------------
    const captureSamples: number[] = [];
    const diffSamples: number[] = [];
    const opSealSamples: number[] = [];
    const collectSamples: number[] = [];
    const rowSealSamples: number[] = [];
    const totalSamples: number[] = [];

    let lastDelta: LedgerDelta | null = null;
    let writeCount = 0;
    let sealedBytes = 0;
    let opBytes = 0;
    let deltaBytes = 0;

    // The gate reads p95, so the sample count has to make a p95 mean something.
    // A mutate is cheap next to the corpus that has already been generated, so
    // twenty-odd rounds cost seconds at every scale.
    const rounds = Math.max(20, iters.medium * 2);
    for (let k = 0; k < rounds + 3; k += 1) {
      forceGc();
      const t0 = performance.now();
      const snapshot = captureLedgerSnapshot(ledger as never);
      const t1 = performance.now();

      const row: ScaleRow = { ...template, id: `nut_new_${k}`, food_name: `Chicken and rice bowl ${k}` };
      meals.push(row);

      const t2 = performance.now();
      const delta = diffLedger(snapshot, ledger as never);
      const t3 = performance.now();

      const payload = encodeLedgerOpPayload(
        { id: row.id, meal_type: row.meal_type, household_id: householdId },
        delta ?? { v: 1 },
      );
      const plaintext = utf8Encode(JSON.stringify(payload));
      const sealedOp = aeadEncrypt(hdk, plaintext, OP_AAD);
      const t4 = performance.now();

      const writes = collectRowWrites(ledger as never, delta ?? { v: 1 });
      const t5 = performance.now();

      let bytes = 0;
      for (const write of writes) {
        const sealed = sealRowBody(
          dbKey,
          utf8Encode(JSON.stringify(write.envelope)),
          rowAad(householdId, write.table, write.rowKey, 1),
        );
        bytes += sealed.nonce.length + sealed.ciphertext.length;
      }
      const t6 = performance.now();

      // Undo, so the corpus does not grow across samples and every round
      // measures the SAME scale rather than a slowly inflating one.
      meals.pop();

      if (k >= 3) {
        captureSamples.push(t1 - t0);
        diffSamples.push(t3 - t2);
        opSealSamples.push(t4 - t3);
        collectSamples.push(t5 - t4);
        rowSealSamples.push(t6 - t5);
        totalSamples.push(t6 - t0 - (t2 - t1));
      }
      lastDelta = delta;
      writeCount = writes.length;
      sealedBytes = bytes;
      opBytes = sealedOp.length;
      deltaBytes = utf8Encode(JSON.stringify(delta)).length;
    }

    const total = stats(totalSamples);

    recorder.time('mutate.captureLedgerSnapshot', stats(captureSamples), `${scale.rows} rows`, GRADE_P50);
    recorder.time('mutate.diffLedger', stats(diffSamples), '1 new nutrition row', GRADE_P50);
    recorder.time('mutate.encodeAndSealOp', stats(opSealSamples), 'op payload + AEAD', GRADE_P50);
    recorder.time('mutate.collectRowWrites', stats(collectSamples), `${writeCount} row write(s)`, GRADE_P50);
    recorder.time('mutate.sealRowBody', stats(rowSealSamples), 'per-row AEAD', GRADE_P50);
    recorder.time('mutate.total', total, 'THE GATED NUMBER — capture→diff→op→rows', GRADE_P50);
    recorder.size('mutate.delta.bytes', deltaBytes, 'bytes', 'the semantic change');
    recorder.size('mutate.op.sealed.bytes', opBytes, 'bytes', 'one sealed op');
    recorder.size('mutate.rows.sealed.bytes', sealedBytes, 'bytes', 'nonce+ciphertext for changed rows');
    recorder.ratio(
      'mutate.amplification.sealedPerDeltaByte',
      (sealedBytes + opBytes) / Math.max(deltaBytes, 1),
      'lower',
      `${sealedBytes + opBytes} bytes written for a ${deltaBytes}-byte change`,
    );
    recorder.ratio(
      'mutate.captureShare',
      stats(captureSamples).p50 / Math.max(total.p50, 1e-9),
      'lower',
      'snapshot as a share of the whole mutate — the incremental-materialization target',
    );

    // ---- the cup of water, for contrast ---------------------------------
    {
      const water = ledger.waterEntries as ScaleRow[];
      const cupTemplate = { ...water[Math.floor(water.length / 3)]! };
      const samples: number[] = [];
      for (let k = 0; k < rounds + 2; k += 1) {
        const t0 = performance.now();
        const snapshot = captureLedgerSnapshot(ledger as never);
        water.push({ ...cupTemplate, id: `wtr_new_${k}` });
        const delta = diffLedger(snapshot, ledger as never);
        const writes = collectRowWrites(ledger as never, delta ?? { v: 1 });
        for (const write of writes) {
          sealRowBody(
            dbKey,
            utf8Encode(JSON.stringify(write.envelope)),
            rowAad(householdId, write.table, write.rowKey, 1),
          );
        }
        samples.push(performance.now() - t0);
        water.pop();
      }
      recorder.time('mutate.waterCup.total', stats(samples), 'the six-a-day tap', GRADE_P50);
    }

    // ---- the WIDE row: a goal change (~60 populated columns) --------------
    {
      const goals = ledger.healthGoals as ScaleRow[];
      const goalSnapshot = captureLedgerSnapshot(ledger as never);
      goals[goals.length - 1]!.daily_calories = 2410;
      const goalDelta = diffLedger(goalSnapshot, ledger as never);
      const goalWrites = collectRowWrites(ledger as never, goalDelta ?? { v: 1 });
      let goalSealed = 0;
      let goalEnvelopeChars = 0;
      for (const write of goalWrites) {
        const json = JSON.stringify(write.envelope);
        goalEnvelopeChars += json.length;
        const sealed = sealRowBody(
          dbKey,
          utf8Encode(json),
          rowAad(householdId, write.table, write.rowKey, 1),
        );
        goalSealed += sealed.nonce.length + sealed.ciphertext.length;
      }
      const goalDeltaBytes = utf8Encode(JSON.stringify(goalDelta)).length;
      recorder.size('mutate.wideRow.envelope.chars', goalEnvelopeChars, 'chars', 'healthGoals row + its stamps');
      recorder.size('mutate.wideRow.sealed.bytes', goalSealed, 'bytes', 'one healthGoals row sealed');
      recorder.ratio(
        'mutate.wideRow.amplification.sealedPerDeltaByte',
        goalSealed / Math.max(goalDeltaBytes, 1),
        'lower',
        `${goalSealed} bytes written for a ${goalDeltaBytes}-byte calorie change`,
      );
    }

    // ---- N5: does the watermark map outgrow the data it describes? -------
    const rowsJson = JSON.stringify(
      Object.fromEntries(HEALTH_REGISTRY.tableNames.map((t) => [t, ledger[t]])),
    );
    const lwwJson = JSON.stringify(ledger.lww ?? {});
    const stampCount = lwwStampCountOf(ledger.lww);

    recorder.size('mutate.rows.json.chars', rowsJson.length, 'chars', 'all Wave A rows');
    recorder.size('mutate.lww.json.chars', lwwJson.length, 'chars', 'the per-field watermark map');
    recorder.count('mutate.lww.stamps', stampCount, 'count', 'lower', 'one per field per row');
    recorder.ratio(
      'mutate.lww.charsPerRowChar',
      lwwJson.length / Math.max(rowsJson.length, 1),
      'lower',
      'N5 decision input (plan §1.6): >1 means the map outgrows the data',
    );
    recorder.ratio(
      'mutate.lww.bytesPerStamp',
      lwwJson.length / Math.max(stampCount, 1),
      'lower',
      'cost of one field stamp, map overhead included',
    );
    recorder.time(
      'mutate.total.min',
      exact(total.min),
      'luckiest sample, for reference only — the gate is p95',
    );

    // ---- He10 Exit ------------------------------------------------------
    const checks = [
      timeCheck({
        id: 'mealMutate',
        label: 'Single meal `mutate` (p95)',
        measuredMs: total.p95,
        thresholdMs: HEALTH_EXIT_THRESHOLDS.mealMutateP95Ms,
        notes: 'capture → diff → op seal → row seal',
      }),
    ];
    recordExitChecks(recorder, checks);
    recorder.end();
    assertExitChecks(ctx.spec.years, checks);

    if (lastDelta === null) throw new Error('mutate produced no delta');
  });
});
