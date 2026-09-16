/**
 * House H10 — a SINGLE-FIELD EDIT, end to end, plus the N5 decision input.
 *
 * `captureLedgerSnapshot` → the user's one-field mutation → `diffLedger` →
 * `collectRowWrites` → per-row AEAD seal. That is the whole write path House
 * runs; unlike Budget there is no legacy MMKV snapshot stage to measure,
 * because House was born on Stage 2's per-row storage.
 *
 * TWO EDITS, NOT ONE
 * ------------------
 * `maintenanceCompletions` is the common edit — House's highest-cardinality
 * table, the one a member touches most. `tasks` is the expensive one: ~41
 * populated fields per row, so its envelope (row + its whole LWW stamp map)
 * is the largest single object the write path seals. Reporting only the cheap
 * one would hide exactly the cost §1.6 is about.
 *
 * WHAT THIS PHASE IS FOR
 * ----------------------
 * `edit.lww.*` is the N5 decision input (plan §1.6): if the watermark map
 * exceeds the row bytes it describes, field grouping / stamp interning / column
 * pruning stop being optional. Budget shipped without them and recorded C18 as
 * debt; House starts wider and this is the number that says by how much.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  captureLedgerSnapshot,
  collectRowWrites,
  diffLedger,
  type LedgerDelta,
} from '../../../../../src/features/house/local/projection';
import { utf8Encode } from '../../../src/crypto/bytes';
import { rowAad, sealRowBody } from '../../../src/store/row-aead';
import { lwwStampCountOf } from '../lib/corpus-core';
import {
  HOUSE_REGISTRY,
  generateHouseLedger,
  type ScaleRow,
} from '../lib/house-ledger-factory';
import { generateHouseOps } from '../lib/house-oplog-factory';
import { startHousePhase } from '../lib/house-phase';
import { exact, forceGc, stats } from '../lib/measure';
import { cryptoBundleFor, pseudoBytes } from '../lib/oplog-factory';

describe('house scale: single-field edit end to end', () => {
  it('measures', () => {
    const ctx = startHousePhase('edit');
    const { recorder, scale, iters } = ctx;

    const dbKey = pseudoBytes(32, 0xa11ce);
    const hdk = pseudoBytes(32, 0xb0b);

    const ledger = generateHouseLedger(ctx.spec);
    ledger.ops = generateHouseOps({
      ledger,
      count: scale.ops,
      hdk,
      householdId: String(ledger.household.id),
      seed: ctx.spec.seed,
    });
    ledger.crypto = cryptoBundleFor(ctx.spec.seed);

    const completions = ledger.maintenanceCompletions as ScaleRow[];
    const tasks = ledger.tasks as ScaleRow[];

    // ---- capture + diff --------------------------------------------------
    // Stride by a coprime so the edited row is spread across the whole table.
    // Walking 0,1,2,… biases the linear scans in both the projection and, at
    // apply time, the scan cursor's `find`.
    const captureSamples: number[] = [];
    const diffSamples: number[] = [];
    let lastDelta: LedgerDelta | null = null;

    for (let k = 0; k < iters.medium + 3; k += 1) {
      const t0 = performance.now();
      const snapshot = captureLedgerSnapshot(ledger as never);
      const t1 = performance.now();

      completions[(k * 7919) % completions.length]!.notes = `checked ${k}`;

      const t2 = performance.now();
      lastDelta = diffLedger(snapshot, ledger as never);
      const t3 = performance.now();

      if (k >= 3) {
        captureSamples.push(t1 - t0);
        diffSamples.push(t3 - t2);
      }
    }

    const deltaBytes = utf8Encode(JSON.stringify(lastDelta)).length;
    const deltaRows = Object.values(lastDelta?.u ?? {}).reduce((a, list) => a + list.length, 0);

    recorder.time('edit.captureLedgerSnapshot', stats(captureSamples), `${scale.rows} rows`);
    recorder.time('edit.diffLedger', stats(diffSamples), `${deltaRows} row(s) in delta`);
    recorder.time(
      'edit.captureAndDiff',
      stats(captureSamples.map((v, i) => v + diffSamples[i]!)),
      'projection overhead per save',
    );
    recorder.size('edit.delta.bytes', deltaBytes, 'bytes', 'the semantic change');

    // ---- the write path: seal only the changed rows ----------------------
    const collectSamples: number[] = [];
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
      collectSamples.push(t1 - t0);
      aeadSamples.push(t2 - t1);
      totalSamples.push(t2 - t0);
    }

    recorder.time('edit.collectRowWrites', stats(collectSamples), `${writeCount} row write(s)`);
    recorder.time('edit.sealRowBody', stats(aeadSamples));
    recorder.time('edit.total.today', stats(totalSamples), 'row persist; capture+diff excluded');
    recorder.time(
      'edit.total.todayWithProjection',
      exact(
        stats(totalSamples).min + stats(captureSamples.map((v, i) => v + diffSamples[i]!)).min,
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

    // ---- the same edit on the WIDEST row (tasks, ~41 populated fields) ----
    const taskSnapshot = captureLedgerSnapshot(ledger as never);
    tasks[Math.floor(tasks.length / 3)]!.title = 'Replace furnace filter (edited)';
    const taskDelta = diffLedger(taskSnapshot, ledger as never);
    const taskWrites = collectRowWrites(ledger as never, taskDelta ?? { v: 1 });
    let taskSealed = 0;
    let taskEnvelopeChars = 0;
    for (const write of taskWrites) {
      const json = JSON.stringify(write.envelope);
      taskEnvelopeChars += json.length;
      const sealed = sealRowBody(
        dbKey,
        utf8Encode(json),
        rowAad(String(ledger.household.id), write.table, write.rowKey, 1),
      );
      taskSealed += sealed.nonce.length + sealed.ciphertext.length;
    }
    const taskDeltaBytes = utf8Encode(JSON.stringify(taskDelta)).length;
    recorder.size('edit.wideRow.envelope.chars', taskEnvelopeChars, 'chars', 'tasks row + its stamps');
    recorder.size('edit.wideRow.sealed.bytes', taskSealed, 'bytes', 'one tasks row sealed');
    recorder.ratio(
      'edit.wideRow.amplification.sealedPerDeltaByte',
      taskSealed / Math.max(taskDeltaBytes, 1),
      'lower',
      `${taskSealed} bytes written for a ${taskDeltaBytes}-byte title change`,
    );

    // ---- N5: does the watermark map outgrow the data it describes? -------
    const rowsJson = JSON.stringify(
      Object.fromEntries(HOUSE_REGISTRY.tableNames.map((t) => [t, ledger[t]])),
    );
    const lwwJson = JSON.stringify(ledger.lww ?? {});
    const stampCount = lwwStampCountOf(ledger.lww);

    recorder.size('edit.rows.json.chars', rowsJson.length, 'chars', 'all Wave A rows');
    recorder.size('edit.lww.json.chars', lwwJson.length, 'chars', 'the per-field watermark map');
    recorder.count('edit.lww.stamps', stampCount, 'count', 'lower', 'one per field per row');
    recorder.ratio(
      'edit.lww.charsPerRowChar',
      lwwJson.length / Math.max(rowsJson.length, 1),
      'lower',
      'N5 decision input (plan §1.6): >1 means the map outgrows the data',
    );
    recorder.ratio(
      'edit.lww.bytesPerStamp',
      lwwJson.length / Math.max(stampCount, 1),
      'lower',
      'cost of one field stamp, map overhead included',
    );

    recorder.end();
  });
});
