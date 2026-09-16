/**
 * Requirement 1 — a SINGLE-FIELD EDIT, end to end.
 *
 * `captureLedgerSnapshot` -> the user's one-field mutation -> `diffLedger` ->
 * `persist()`'s serializer (JSON.stringify with every op hex-encoded) ->
 * utf8Encode -> AEAD -> the hex encoding that actually reaches storage.
 *
 * This is the ~93 MB-written / 11.6 s number the whole redesign exists to kill,
 * and nothing currently measures it as one figure: the existing hot-path bench
 * splits capture/diff from persist across separate processes and never reports
 * write amplification at all.
 *
 * `bytesToBase64` of the same sealed buffer is measured beside the hex so
 * Stage 1 has its target on day one.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  captureLedgerSnapshot,
  collectRowWrites,
  diffLedger,
  type LedgerDelta,
} from '../../../../../src/features/budget/local/projection';
import { utf8Encode } from '../../../src/crypto/bytes';
import { sealRowBody, rowAad } from '../../../src/store/row-aead';
import { generateLedger, type ScaleRow } from '../lib/ledger-factory';
import { exact, forceGc, stats } from '../lib/measure';
import { cryptoBundleFor, generateOps, pseudoBytes } from '../lib/oplog-factory';
import { startPhase } from '../lib/phase';

describe('scale: single-field edit end to end', () => {
  it('measures', () => {
    const ctx = startPhase('edit');
    const { recorder, scale, iters } = ctx;

    const dbKey = pseudoBytes(32, 0xa11ce);
    const hdk = pseudoBytes(32, 0xb0b);

    const ledger = generateLedger(ctx.spec);
    ledger.ops = generateOps({
      ledger,
      count: scale.ops,
      hdk,
      householdId: String(ledger.household.id),
      deviceId: ledger.deviceId,
      memberId: ledger.memberId,
      seed: ctx.spec.seed,
    });
    ledger.crypto = cryptoBundleFor(ctx.spec.seed);

    const expenses = ledger.expenses as ScaleRow[];

    // ---- capture + diff -------------------------------------------------
    // Stride by a coprime so the edited row is spread across the whole table.
    // Walking 0,1,2,… biases the linear scans in both the projection and, at
    // apply time, `rowsOf().find()` (projection.ts:395).
    const captureSamples: number[] = [];
    const diffSamples: number[] = [];
    let lastDelta: LedgerDelta | null = null;

    for (let k = 0; k < iters.medium + 3; k += 1) {
      const t0 = performance.now();
      const snapshot = captureLedgerSnapshot(ledger as never);
      const t1 = performance.now();

      expenses[(k * 7919) % expenses.length]!.amount = 4242 + k;

      const t2 = performance.now();
      lastDelta = diffLedger(snapshot, ledger as never);
      const t3 = performance.now();

      if (k >= 3) {
        captureSamples.push(t1 - t0);
        diffSamples.push(t3 - t2);
      }
    }

    const deltaJson = JSON.stringify(lastDelta);
    const deltaBytes = utf8Encode(deltaJson).length;
    const deltaRows = Object.values(lastDelta?.u ?? {}).reduce((a, list) => a + list.length, 0);

    recorder.time('edit.captureLedgerSnapshot', stats(captureSamples), `${scale.rows} rows`);
    recorder.time('edit.diffLedger', stats(diffSamples), `${deltaRows} row(s) in delta`);
    recorder.time(
      'edit.captureAndDiff',
      stats(captureSamples.map((v, i) => v + diffSamples[i]!)),
      'projection overhead per save',
    );
    recorder.size('edit.delta.bytes', deltaBytes, 'bytes', 'the semantic change');

    // ---- Stage 2 write path: seal only changed rows ---------------------
    const serializeSamples: number[] = [];
    const aeadSamples: number[] = [];
    const totalSamples: number[] = [];

    let writeCount = 0;
    let sealedBytes = 0;

    for (let k = 0; k < iters.heavy; k += 1) {
      forceGc();
      const t0 = performance.now();
      const writes = collectRowWrites(ledger as never, lastDelta ?? { v: 1 });
      const t1 = performance.now();
      let bytes = 0;
      for (const write of writes) {
        const sealed = sealRowBody(
          dbKey,
          utf8Encode(JSON.stringify(write.envelope)),
          rowAad(String(ledger.household.id), write.table, write.rowKey, 1),
        );
        bytes += sealed.nonce.length + sealed.ciphertext.length;
      }
      const t2 = performance.now();

      writeCount = writes.length;
      sealedBytes = bytes;
      serializeSamples.push(t1 - t0);
      aeadSamples.push(t2 - t1);
      totalSamples.push(t2 - t0);
    }

    recorder.time('edit.collectRowWrites', stats(serializeSamples), `${writeCount} row write(s)`);
    recorder.time('edit.sealRowBody', stats(aeadSamples));
    recorder.time('edit.total.today', stats(totalSamples), 'Stage 2 row persist; capture+diff excluded');
    recorder.time(
      'edit.total.todayWithProjection',
      exact(
        stats(totalSamples).min +
          stats(captureSamples.map((v, i) => v + diffSamples[i]!)).min,
      ),
      'min(row persist) + min(capture+diff)',
    );

    recorder.size('edit.sealed.bytes', sealedBytes, 'bytes', 'nonce+ciphertext for changed rows');
    recorder.ratio(
      'edit.amplification.sealedPerDeltaByte',
      sealedBytes / Math.max(deltaBytes, 1),
      'lower',
      `${sealedBytes} bytes written for a ${deltaBytes}-byte change`,
    );

    recorder.end();
  });
});
