/**
 * Health He10 — COLD OPEN → FIRST HOME PAINT, and the bytes at rest.
 *
 * Two of the plan's five Exit rows live here, because both are properties of
 * the same sealed corpus and sealing it twice would double a five-second step
 * for nothing:
 *
 *   Cold open → first Home paint    3.0 s p50 / 5.0 s p95
 *   Ledger + LWW on disk            250 MB
 *
 * WHAT "COLD OPEN → FIRST HOME PAINT" IS MADE OF
 * ----------------------------------------------
 * Health inherits House's per-row storage model, so the hydrate is:
 *
 *   store.listRows({ householdId })          engine.ts:547
 *   openRowBody(dbKey, nonce, ct, aad)       engine.ts:558 — per row, AEAD open
 *   JSON.parse(envelope)                     engine.ts:568 — per row
 *   installRowEnvelopes(ledger, writes)      engine.ts:574 — tables + LWW map
 *   replay the unprojected tail              engine.ts:578-601
 *   …then the screen's 17-loader Promise.all HealthHomeScreen.tsx:198-219
 *
 * The last line is the reason this phase is not just House's cold open with a
 * different corpus. Nothing is on screen until the fan-out resolves, so "first
 * Home paint" is hydrate + tail replay + hydrate-the-screen. Reporting only the
 * hydrate would report a number the user never experiences.
 *
 * MEASURED WITH CHECKPOINTS ON (He8) — AS THE PLAN REQUIRES
 * --------------------------------------------------------
 * "measured with checkpoints on (He8), since a cold open in production never
 * replays the full log." `maybePublishHealthCheckpoint` publishes once the log
 * is `CHECKPOINT_PUBLISH_MIN_OPS` past the last watermark and
 * `compactLocalHealthLogIfSafe` truncates below it, so the resident log is
 * bounded by that watermark rather than by the age of the account. The tail is
 * what gets replayed; the full-log cost is recorded beside it as the
 * counterfactual — that difference IS the value of He8, and without it the
 * checkpoint work has no number attached.
 *
 * MEASURED WITH THE RESIDENT WINDOW ON (He10 §4 mitigation)
 * ---------------------------------------------------------
 * `residentWindowDays` (`local/projection.ts`) means a cold open decrypts ~420
 * days of the five dated log tables instead of ten years. That is the lever
 * this phase exists to grade, so the phase must measure it the way the product
 * pays for it — **including the part that costs, not only the part that saves**:
 *
 *   - the window is anchored on `CORPUS_END_DATE`, not on wall-clock now. The
 *     corpus ends months before the machine's clock, and a window measured
 *     against `Date.now()` would land mostly PAST the data and report a
 *     flatteringly tiny resident set of a diary nobody has;
 *   - the seventeen loaders then run against a PARTIAL ledger, and two of them
 *     (`loadWeightLog`'s 500 rows, `loadBodyEntries`' 1000, plus the three
 *     400-row `entry_type` reads) are bounded by ROW COUNT with no date bound
 *     at all, so they reach past the window on any long-lived diary. The
 *     product answers those by widening — `ensureHealthRowsResident` — and that
 *     widening is decryption on the first-paint path. `widenForHome` below runs
 *     it INSIDE the timed region, which is the difference between measuring the
 *     mitigation and measuring a shorter answer.
 *
 * `coldopen.resident.fraction` reports what the window actually kept, so the
 * saving is a number in the table rather than a claim in a comment.
 *
 * THE STORE READ ITSELF IS EXCLUDED, AND DELIBERATELY
 * ---------------------------------------------------
 * `SqliteLocalFirstStore` needs a driver, and the only off-device driver is the
 * test fake whose lookups are `Array.some`; hydrating tens of thousands of rows
 * through it measures the fake's O(n²), not the product. `MemoryLocalFirstStore`
 * holds the sealed rows so the read loop sees a realistic record shape, and
 * `coldopen.listRows` is timed and labelled separately. Same discipline as the
 * Budget and House phases.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  collectRowWrites,
  decodeLedgerOpPayload,
  applyLedgerDelta,
  installRowEnvelopes,
  mergeRowEnvelopes,
  residentBuckets,
  type RowEnvelope,
} from '../../../../../src/features/health/local/projection';
import { aeadDecrypt } from '../../../src/crypto/aead';
import { utf8Decode, utf8Encode } from '../../../src/crypto/bytes';
import { MemoryLocalFirstStore } from '../../../src/store/memory-store';
import { openRowBody, rowAad, sealRowBody } from '../../../src/store/row-aead';
import type { StoredOperation } from '../../../src/store/types';
import {
  HOME_RESIDENCY_NEEDS,
  buildHomeLoaders,
  runHomeHydrate,
} from '../lib/health-home-loaders';
import {
  CORPUS_END_DATE,
  HEALTH_REGISTRY,
  generateHealthLedger,
  type HealthScaleLedger,
} from '../lib/health-ledger-factory';
import {
  CHECKPOINT_PUBLISH_MIN_OPS,
  checkpointTail,
  cryptoBundleFor,
  generateHealthOps,
  pseudoBytes,
} from '../lib/health-oplog-factory';
import { startHealthPhase } from '../lib/health-phase';
import {
  HEALTH_EXIT_THRESHOLDS,
  assertExitChecks,
  recordExitChecks,
  sizeCheck,
  timeCheck,
} from '../lib/health-thresholds';
import { forceGc, stats } from '../lib/measure';

const GRADE_P50 = { stat: 'p50' } as const;

const OP_AAD = utf8Encode('op-payload-v1');

type StoredRow = {
  householdId: string;
  table: string;
  rowKey: string;
  bucket: string;
  deleted: boolean;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  keyEpoch: number;
  updatedHlc: string;
};

/**
 * Bytes one op occupies in `lf_operations`: the sealed payload, the signature,
 * and the text columns beside them. Not an estimate of a row header — the
 * columns are enumerated so adding one to `StoredOperation` shows up here.
 */
function opBytesAtRest(op: StoredOperation): number {
  return (
    op.payload.length +
    op.signature.length +
    op.opId.length +
    op.householdId.length +
    op.deviceId.length +
    op.authorMemberId.length +
    op.hlc.length +
    op.parentsJson.length +
    op.opType.length +
    op.entityType.length +
    op.entityId.length +
    // seq, keyEpoch, appliedAt — three integers
    24
  );
}

/**
 * The residency widening a cold open pays before Home can paint — the product's
 * `ensureHealthRowsResident`, driven by `HOME_RESIDENCY_NEEDS`.
 *
 * Modelled rather than imported, on the same terms as `health-home-loaders.ts`:
 * `engine.ts` pulls `@api/*` and `expo-*` and does not resolve outside the
 * mobile tsconfig. The steps are the engine's, in the engine's order — census
 * once, then per need walk the table's buckets newest-first, skipping resident
 * ones, re-counting after each — and the same skip-before-decrypt rule, which
 * is what stops a bucket read from re-opening every always-resident row.
 *
 * Store time and CPU time are returned separately for the same reason
 * `coldopen.listRows` is reported separately: the only off-device driver is
 * `MemoryLocalFirstStore`, whose lookups are linear scans, and charging its
 * O(n) to first paint would report the fake's cost as the product's.
 */
async function widenForHome(args: {
  store: MemoryLocalFirstStore;
  ledger: HealthScaleLedger;
  dbKey: Uint8Array;
  householdId: string;
  resident: Set<string>;
}): Promise<{ storeMs: number; cpuMs: number; rows: number }> {
  const { store, ledger, dbKey, householdId, resident } = args;
  let storeMs = 0;
  let cpuMs = 0;
  let rows = 0;

  const s0 = performance.now();
  const counts = await store.listRowBuckets(householdId);
  storeMs += performance.now() - s0;

  const bucketsByTable = new Map<string, string[]>();
  for (const entry of counts) {
    if (entry.bucket === '*') continue;
    const list = bucketsByTable.get(entry.table);
    if (list) list.push(entry.bucket);
    else bucketsByTable.set(entry.table, [entry.bucket]);
  }
  for (const list of bucketsByTable.values()) list.sort((a, b) => b.localeCompare(a));

  for (const need of HOME_RESIDENCY_NEEDS) {
    if (need.count(ledger) >= need.minRows) continue;
    for (const bucket of bucketsByTable.get(need.table) ?? []) {
      if (resident.has(bucket)) continue;
      resident.add(bucket);

      const t0 = performance.now();
      const stored = (await store.listRows({
        householdId,
        buckets: [bucket],
      })) as unknown as StoredRow[];
      storeMs += performance.now() - t0;

      const t1 = performance.now();
      // Skip BEFORE the AEAD open: a bucket read always returns `'*'` and every
      // tombstone alongside the month, and re-decrypting those on each widening
      // would pay the cold-open cost again, once per month walked.
      const lww = (ledger.lww ?? {}) as Record<string, Record<string, unknown>>;
      const writes: Array<{
        table: string;
        rowKey: string;
        deleted: boolean;
        envelope: RowEnvelope;
      }> = [];
      for (const record of stored) {
        if (lww[record.table]?.[record.rowKey] !== undefined) continue;
        writes.push({
          table: record.table,
          rowKey: record.rowKey,
          deleted: record.deleted,
          envelope: JSON.parse(
            utf8Decode(
              openRowBody(
                dbKey,
                record.nonce,
                record.ciphertext,
                rowAad(record.householdId, record.table, record.rowKey, record.keyEpoch),
              ),
            ),
          ) as RowEnvelope,
        });
      }
      rows += mergeRowEnvelopes(ledger as never, writes as never);
      cpuMs += performance.now() - t1;

      if (need.count(ledger) >= need.minRows) break;
    }
  }

  return { storeMs, cpuMs, rows };
}

describe('health scale: cold open to first Home paint', () => {
  it('measures', async () => {
    const ctx = startHealthPhase('coldopen');
    const { recorder, scale, iters } = ctx;

    const dbKey = pseudoBytes(32, 0xa11ce);
    const hdk = pseudoBytes(32, 0xb0b);

    const source = generateHealthLedger(ctx.spec);
    source.ops = generateHealthOps({
      ledger: source,
      count: scale.ops,
      hdk,
      householdId: String(source.household.id),
      seed: ctx.spec.seed,
    });
    source.crypto = cryptoBundleFor(ctx.spec.seed);

    const householdId = String(source.household.id);

    // ---- what sits in SQLite before the app launches --------------------
    const writes = collectRowWrites(source as never, 'all');
    const sealSamples: number[] = [];
    let stored: StoredRow[] = [];
    let sealedBytes = 0;
    let envelopeChars = 0;
    let rowChars = 0;
    let lwwChars = 0;

    for (let k = 0; k < Math.max(1, iters.heavy - 1); k += 1) {
      forceGc();
      const batch: StoredRow[] = new Array(writes.length);
      let bytes = 0;
      let chars = 0;
      const t0 = performance.now();
      for (let i = 0; i < writes.length; i += 1) {
        const write = writes[i]!;
        const json = JSON.stringify(write.envelope);
        const sealed = sealRowBody(
          dbKey,
          utf8Encode(json),
          rowAad(householdId, write.table, write.rowKey, 1),
        );
        bytes += sealed.nonce.length + sealed.ciphertext.length;
        chars += json.length;
        batch[i] = {
          householdId,
          table: write.table,
          rowKey: write.rowKey,
          bucket: write.bucket,
          deleted: write.deleted,
          nonce: sealed.nonce,
          ciphertext: sealed.ciphertext,
          keyEpoch: 1,
          updatedHlc: source.ops[source.ops.length - 1]?.hlc ?? '0',
        };
      }
      sealSamples.push(performance.now() - t0);
      stored = batch;
      sealedBytes = bytes;
      envelopeChars = chars;
    }

    // The split inside the envelope: `{ row, lww }` (projection/types.ts:79).
    // N5 (plan §1.6) turns on which half is bigger, and on disk that question
    // is settled here rather than at the JSON level.
    for (const write of writes) {
      rowChars += JSON.stringify(write.envelope.row ?? null).length;
      lwwChars += JSON.stringify(write.envelope.lww ?? {}).length;
    }

    recorder.count('coldopen.rows.count', stored.length, 'count', 'flat', 'rows at rest');
    recorder.size('coldopen.rows.sealed.bytes', sealedBytes, 'bytes', 'nonce+ciphertext at rest');
    recorder.size('coldopen.rows.envelope.chars', envelopeChars, 'chars', 'plaintext row+lww JSON');
    recorder.size('coldopen.rows.row.chars', rowChars, 'chars', 'the data half of every envelope');
    recorder.size('coldopen.rows.lww.chars', lwwChars, 'chars', 'the watermark half of every envelope');
    recorder.ratio(
      'coldopen.lww.charsPerRowChar',
      lwwChars / Math.max(rowChars, 1),
      'lower',
      'N5 decision input: >1 means the map outgrows the data it describes',
    );
    recorder.time('coldopen.sealAllRows', stats(sealSamples), 'full initial write, for reference');

    // ---- the op log at rest, with and without checkpoints ---------------
    const tail = checkpointTail(source.ops);
    let fullLogBytes = 0;
    for (const op of source.ops) fullLogBytes += opBytesAtRest(op);
    let tailBytes = 0;
    for (const op of tail) tailBytes += opBytesAtRest(op);

    recorder.count('coldopen.oplog.tail.ops', tail.length, 'ops', 'lower', `bounded by CHECKPOINT_PUBLISH_MIN_OPS=${CHECKPOINT_PUBLISH_MIN_OPS}`);
    recorder.size('coldopen.oplog.tail.bytes', tailBytes, 'bytes', 'the log a checkpointed device holds');
    recorder.count('coldopen.oplog.fullLog.ops', source.ops.length, 'ops', 'lower', 'checkpoints OFF — the counterfactual');
    recorder.size('coldopen.oplog.fullLog.bytes', fullLogBytes, 'bytes', 'checkpoints OFF — the counterfactual');

    const diskBytes = sealedBytes + tailBytes;
    recorder.size('disk.total.bytes', diskBytes, 'bytes', 'sealed rows + retained op log — THE GATED NUMBER');
    recorder.size(
      'disk.total.checkpointsOff.bytes',
      sealedBytes + fullLogBytes,
      'bytes',
      'what the same account would occupy with He8 off',
    );

    // Held in the in-memory store so the read loop sees a realistic record
    // shape. This is NOT the shipping store — see the header.
    const store = new MemoryLocalFirstStore();
    await store.open(dbKey);
    await store.putRows(stored as never);

    const listSamples: number[] = [];
    const openSamples: number[] = [];
    const parseSamples: number[] = [];
    const installSamples: number[] = [];
    const replaySamples: number[] = [];
    const hydrateSamples: number[] = [];
    const cpuSamples: number[] = [];
    const paintSamples: number[] = [];

    // The empty ledger a fresh session starts from. Built ONCE and reset per
    // sample rather than regenerated: `first paint` is a gated p95 and a p95
    // over two samples is the max of two, which is not a percentile. The
    // generate-per-sample shape House uses costs ~5 s at this corpus and is
    // pure setup — nothing inside the timed region reads it.
    const target = generateHealthLedger(ctx.spec) as HealthScaleLedger;
    const coldOpens = Math.max(6, iters.heavy * 4);

    // Anchored on the corpus, not on the machine's clock — see the header.
    const windowBuckets = residentBuckets(CORPUS_END_DATE);
    if (!windowBuckets) {
      throw new Error('health cold open: the Health schema must declare residentWindowDays');
    }

    const widenStoreSamples: number[] = [];
    const widenSamples: number[] = [];
    let residentRows = 0;
    let widenedRows = 0;

    for (let k = 0; k < coldOpens; k += 1) {
      forceGc();
      for (const table of HEALTH_REGISTRY.tableNames) target[table] = [];
      target.lww = {};
      target.conflicts = [];

      const t0 = performance.now();
      const records = (await store.listRows({
        householdId,
        buckets: windowBuckets,
      })) as unknown as StoredRow[];
      const t1 = performance.now();

      const plaintexts: Uint8Array[] = new Array(records.length);
      for (let i = 0; i < records.length; i += 1) {
        const record = records[i]!;
        plaintexts[i] = openRowBody(
          dbKey,
          record.nonce,
          record.ciphertext,
          rowAad(record.householdId, record.table, record.rowKey, record.keyEpoch),
        );
      }
      const t2 = performance.now();

      const envelopes: Array<{
        table: string;
        rowKey: string;
        deleted: boolean;
        envelope: RowEnvelope;
      }> = new Array(records.length);
      for (let i = 0; i < records.length; i += 1) {
        const record = records[i]!;
        envelopes[i] = {
          table: record.table,
          rowKey: record.rowKey,
          deleted: record.deleted,
          envelope: JSON.parse(utf8Decode(plaintexts[i]!)) as RowEnvelope,
        };
      }
      const t3 = performance.now();

      installRowEnvelopes(target as never, envelopes as never);
      const t4 = performance.now();

      // The unprojected tail — decrypt, decode, merge. With checkpoints on this
      // is the ONLY replay a cold open does.
      for (const op of tail) {
        const payload = JSON.parse(utf8Decode(aeadDecrypt(hdk, op.payload, OP_AAD))) as unknown;
        const delta = decodeLedgerOpPayload(payload);
        if (!delta) continue;
        applyLedgerDelta(target as never, delta, {
          hlc: op.hlc,
          authorMemberId: op.authorMemberId,
          opId: op.opId,
        });
      }
      const t5 = performance.now();

      // The row-bounded loaders reach past the window; the product widens
      // before it answers, and so does this.
      const widened = await widenForHome({
        store,
        ledger: target,
        dbKey,
        householdId,
        resident: new Set(windowBuckets),
      });
      const t5b = performance.now();

      // Nothing is on screen until this resolves.
      const loaders = buildHomeLoaders(target, CORPUS_END_DATE);
      await runHomeHydrate(loaders);
      const t6 = performance.now();

      if (target.waterEntries.length === 0) throw new Error('cold open installed no water entries');

      listSamples.push(t1 - t0);
      openSamples.push(t2 - t1);
      parseSamples.push(t3 - t2);
      installSamples.push(t4 - t3);
      replaySamples.push(t5 - t4);
      widenStoreSamples.push(widened.storeMs);
      widenSamples.push(widened.cpuMs);
      hydrateSamples.push(t6 - t5b);
      cpuSamples.push(t4 - t1);
      // First paint carries the widening's CPU but not the fake store's scans,
      // the same exclusion `coldopen.listRows` already documents.
      paintSamples.push(t6 - t1 - widened.storeMs);
      residentRows = records.length;
      widenedRows = widened.rows;
    }

    const cpu = stats(cpuSamples);
    const paint = stats(paintSamples);
    const replay = stats(replaySamples);

    recorder.time('coldopen.listRows', stats(listSamples), 'MemoryLocalFirstStore — NOT the shipping store');
    recorder.time('coldopen.openRowBody', stats(openSamples), `${stored.length} AEAD opens`);
    recorder.time('coldopen.jsonParse', stats(parseSamples), `${stored.length} envelope parses`);
    recorder.time('coldopen.installRowEnvelopes', stats(installSamples), 'rebuilds tables + LWW map');
    recorder.time('coldopen.tailReplay', replay, `${tail.length} unprojected ops — checkpoints ON`);
    recorder.count(
      'coldopen.resident.rows',
      residentRows,
      'count',
      'lower',
      `rows a windowed cold open decrypts (${windowBuckets.length} buckets + '*' + tombstones)`,
    );
    recorder.ratio(
      'coldopen.resident.fraction',
      residentRows / Math.max(stored.length, 1),
      'lower',
      'share of the table a cold open opens — THE He10 §4 LEVER',
    );
    recorder.count(
      'coldopen.widen.rows',
      widenedRows,
      'count',
      'lower',
      'extra rows the row-bounded Home loaders force in (ensureHealthRowsResident)',
    );
    recorder.time(
      'coldopen.widen',
      stats(widenSamples),
      'decrypt+merge of those extra rows — ON the first-paint path',
    );
    recorder.time(
      'coldopen.widen.listRows',
      stats(widenStoreSamples),
      'MemoryLocalFirstStore — NOT the shipping store, and excluded from first paint',
    );
    recorder.time('coldopen.homeHydrate', stats(hydrateSamples), 'the 17-loader Promise.all');
    recorder.time('coldopen.cpu', cpu, 'decrypt + parse + install — hydrate only');
    recorder.time(
      'coldopen.toFirstPaint',
      paint,
      `hydrate + tail replay + 17 loaders over ${coldOpens} cold opens — THE GATED NUMBER`,
      GRADE_P50,
    );
    recorder.ratio(
      'coldopen.aeadShare',
      stats(openSamples).min / Math.max(cpu.min, 1e-9),
      'lower',
      'AEAD open as a share of hydrate CPU',
    );
    recorder.ratio(
      'coldopen.usPerRow',
      (cpu.min * 1000) / Math.max(stored.length, 1),
      'lower',
      'microseconds of hydrate CPU per row',
    );
    // The value of He8, as a number rather than a claim: what the same replay
    // would cost if the log had never been compacted. Declared arithmetic over
    // the measured per-op tail cost — the full replay is not RUN, because at
    // this scale it would dominate the phase without changing the conclusion.
    recorder.ratio(
      'coldopen.fullLogReplay.projectedMs',
      (replay.p50 / Math.max(tail.length, 1)) * source.ops.length,
      'lower',
      'checkpoints OFF: p50 per tail op x the whole log. DECLARED ARITHMETIC, not measured.',
    );

    // ---- He10 Exit ------------------------------------------------------
    const checks = [
      timeCheck({
        id: 'coldOpenToFirstPaintP50',
        label: 'Cold open → first Home paint (p50)',
        measuredMs: paint.p50,
        thresholdMs: HEALTH_EXIT_THRESHOLDS.coldOpenToFirstPaintP50Ms,
        notes: 'checkpoints ON',
      }),
      timeCheck({
        id: 'coldOpenToFirstPaintP95',
        label: 'Cold open → first Home paint (p95)',
        measuredMs: paint.p95,
        thresholdMs: HEALTH_EXIT_THRESHOLDS.coldOpenToFirstPaintP95Ms,
        notes: 'checkpoints ON',
      }),
      sizeCheck({
        id: 'ledgerAndLwwOnDisk',
        label: 'Ledger + LWW on disk',
        measuredBytes: diskBytes,
        thresholdBytes: HEALTH_EXIT_THRESHOLDS.ledgerAndLwwOnDiskBytes,
        notes: 'sealed row bodies + the retained op log',
      }),
    ];
    recordExitChecks(recorder, checks);

    await store.close();
    recorder.end();
    assertExitChecks(ctx.spec.years, checks);
  });
});
