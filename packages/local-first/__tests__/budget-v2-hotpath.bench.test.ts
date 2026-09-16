 
/**
 * Empirical benchmark for the Budget V2 local-first hot paths.
 *
 * Measures, against the real code (no mocks, no estimates):
 *   1. captureLedgerSnapshot + diffLedger for a SINGLE-FIELD edit
 *      (the per-save cost inside `mutateLocalLedger`).
 *   2. applyLedgerDelta throughput for incoming peer ops.
 *   3. persist(): JSON.stringify of the serializable ledger + op log,
 *      including bytesToHex of payload+signature — plus resulting byte size.
 *   4. AEAD (AES-256-GCM) encrypt cost, and the bytesToHex cliff.
 *
 * Results are appended to $BENCH_OUT *as they are produced* (fsync'd), so a
 * fatal OOM in a later phase never loses the earlier measurements — the 200k-op
 * persist really does OOM a 12 GB heap, which is itself a result.
 *
 * Phases run in SEPARATE processes (BENCH_PHASE) for the same reason.
 *
 *   BUDGET_V2_BENCH=1 BENCH_PHASE=edit BENCH_OUT=/tmp/r.txt npx vitest run --config <cfg>
 *
 * Phases: edit | apply | persist1000 | persist10000 | persist50000 | persist200000 | aead | hex
 */
import { appendFileSync } from 'node:fs';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import {
  LEDGER_TABLE_NAMES,
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
  encodeLedgerOpPayload,
  type LedgerDelta,
} from '../../../src/features/budget/local/projection';
import { aeadEncrypt } from '../src/crypto/aead';
import { bytesToHex, randomBytes, utf8Encode } from '../src/crypto/bytes';

const ENABLED = process.env.BUDGET_V2_BENCH === '1';
const PHASE = process.env.BENCH_PHASE ?? '';
const OUT = process.env.BENCH_OUT ?? '';

/** Append-and-flush so a later hard crash cannot swallow earlier results. */
function emit(line: string) {
  process.stdout.write(`${line}\n`);
  if (OUT) appendFileSync(OUT, `${line}\n`);
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

type Stats = { n: number; min: number; p50: number; p95: number; mean: number };

function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    n: s.length,
    min: s[0]!,
    p50: at(0.5),
    p95: at(0.95),
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

const ms = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
const mib = (b: number) => `${(b / 1024 / 1024).toFixed(2)}MiB`;
const load = () => os.loadavg().map((n) => n.toFixed(0)).join('/');
const heapMb = () => (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);

function row(label: string, st: Stats, notes = '') {
  emit(
    `ROW | ${label.padEnd(44)} | min ${ms(st.min).padStart(9)} | p50 ${ms(st.p50).padStart(
      9,
    )} | p95 ${ms(st.p95).padStart(9)} | n=${String(st.n).padStart(4)} | ${notes}`,
  );
}

// ---------------------------------------------------------------------------
// realistic rows (field-for-field the shapes in src/api/budget.ts)
// ---------------------------------------------------------------------------

const HH = 'hh_local_9f3c1a7b2d4e6081';
const MEMBER = 'mem_7c2f9a41';
const ISO = '2026-03-14T08:21:44.512Z';

type Row = Record<string, unknown>;

const makeCategory = (i: number): Row => ({
  id: `cat_${i}`,
  household_id: HH,
  name: `Category ${i} groceries and household`,
  icon: 'shopping-cart',
  color: '#4C8BF5',
  sort_order: i,
  created_at: ISO,
  usage_count: (i * 7) % 240,
  is_default: i < 12,
  hidden: false,
});

const makeExpense = (i: number): Row => ({
  id: `exp_${i}`,
  household_id: HH,
  budget_item_id: i % 3 === 0 ? `itm_${i % 500}` : null,
  category_id: `cat_${i % 24}`,
  title: `Weekly grocery run #${i}`,
  description:
    i % 4 === 0 ? 'Weekly shop at the supermarket incl. household supplies and produce' : null,
  amount: 1000 + ((i * 137) % 50000),
  saved_amount: (i * 13) % 900,
  tax_amount: Math.round(((i * 137) % 50000) * 0.05),
  expense_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  vendor: 'Costco Wholesale Warehouse',
  receipt_key: i % 5 === 0 ? `receipts/${HH}/${i}-0af31b.jpg` : null,
  created_by: MEMBER,
  created_at: ISO,
});

const makeItem = (i: number): Row => ({
  id: `itm_${i}`,
  household_id: HH,
  category_id: `cat_${i % 24}`,
  timeframe: 'quarter',
  year: 2022 + (i % 5),
  quarter: (i % 4) + 1,
  title: `Planned purchase ${i}`,
  description: 'Replace the unit and schedule the follow-up inspection visit',
  estimated_cost_min: 15000 + ((i * 31) % 200000),
  estimated_cost_max: 25000 + ((i * 31) % 200000),
  actual_cost: i % 3 === 0 ? 20000 + ((i * 31) % 200000) : null,
  priority: (['critical', 'high', 'medium', 'low'] as const)[i % 4],
  status: (['planned', 'in_progress', 'completed', 'deferred', 'cancelled'] as const)[i % 5],
  is_recurring: i % 6 === 0,
  recurrence_frequency: i % 6 === 0 ? 'monthly' : null,
  source_type: null,
  source_id: null,
  target_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`,
  completed_at: i % 5 === 2 ? ISO : null,
  created_by: MEMBER,
  created_at: ISO,
  updated_at: ISO,
});

const makeGoal = (i: number): Row => ({
  id: `goal_${i}`,
  household_id: HH,
  year: 2022 + Math.floor(i / 12),
  month: (i % 12) + 1,
  planned_budget: 300000 + i * 1000,
  actual_spent: 280000 + i * 900,
  category_budgets: JSON.stringify({ cat_1: 50000, cat_2: 30000, cat_3: 22000 }),
  notes: i % 3 === 0 ? 'Trimmed dining out, moved the surplus into the emergency fund' : null,
  created_at: ISO,
  updated_at: ISO,
});

type Ledger = Record<string, unknown> & { ops: unknown[] };

/** n rows spread across categories / expenses / items / goals; other tables empty. */
function makeLedger(n: number): Ledger {
  const l: Ledger = { version: 1, memberId: MEMBER, deviceId: 'dev_a1b2c3', ops: [] } as Ledger;
  l.household = { id: HH, name: 'Home', created_at: ISO, updated_at: ISO, member_count: 2, my_role: 'owner' };
  for (const t of LEDGER_TABLE_NAMES) (l as Record<string, unknown>)[t] = [];

  const cats = Math.min(24, Math.max(4, Math.round(n * 0.05)));
  const goals = Math.min(60, Math.max(2, Math.round(n * 0.05)));
  const items = Math.round(n * 0.25);
  const expenses = Math.max(0, n - cats - goals - items);

  l.categories = Array.from({ length: cats }, (_, i) => makeCategory(i));
  l.goals = Array.from({ length: goals }, (_, i) => makeGoal(i));
  l.items = Array.from({ length: items }, (_, i) => makeItem(i));
  l.expenses = Array.from({ length: expenses }, (_, i) => makeExpense(i));
  return l;
}

const counts = (l: Ledger) =>
  `cat=${(l.categories as unknown[]).length} exp=${(l.expenses as unknown[]).length} ` +
  `item=${(l.items as unknown[]).length} goal=${(l.goals as unknown[]).length}`;

const hlcAt = (wall: number, c: number, dev = 'devA1b2c') =>
  `${String(wall).padStart(15, '0')}-${c.toString(16).padStart(4, '0')}-${dev}`;

/**
 * Large pseudo-random buffer. NOT `randomBytes` — the repo's own
 * `crypto/bytes.ts#randomBytes` throws QuotaExceededError above 65,536 bytes
 * because `crypto.getRandomValues` caps at 64 KiB per call and bytes.ts does
 * not chunk. Irrelevant to AEAD/hex throughput, which is data-independent.
 */
function pseudoBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = 0x9e3779b9;
  for (let i = 0; i < len; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

const SCALES = [100, 1_000, 5_000, 20_000];

// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)(`budget-v2 hot path [${PHASE}]`, () => {
  it(
    'measures',
    () => {
      emit(
        `\n=== PHASE ${PHASE} | node ${process.version} ${process.arch} | ` +
          `${os.cpus()[0]?.model} x${os.cpus().length} | loadavg ${load()} ===`,
      );

      // ===================================================================
      // 1. captureLedgerSnapshot + diffLedger — ONE-FIELD EDIT
      // ===================================================================
      if (PHASE === 'edit') {
        for (const scale of SCALES) {
          const ledger = makeLedger(scale);
          const expenses = ledger.expenses as Row[];
          const iters = scale >= 20_000 ? 60 : scale >= 5_000 ? 150 : 400;

          for (let w = 0; w < 5; w += 1) {
            const s = captureLedgerSnapshot(ledger as never);
            expenses[w % expenses.length]!.amount = 1234 + w;
            diffLedger(s, ledger as never);
          }

          const capS: number[] = [];
          const diffS: number[] = [];
          let lastDelta: LedgerDelta | null = null;

          for (let k = 0; k < iters; k += 1) {
            const t0 = performance.now();
            const snap = captureLedgerSnapshot(ledger as never);
            const t1 = performance.now();

            expenses[k % expenses.length]!.amount = 4242 + k; // the user's edit

            const t2 = performance.now();
            lastDelta = diffLedger(snap, ledger as never);
            const t3 = performance.now();

            capS.push(t1 - t0);
            diffS.push(t3 - t2);
          }

          const u = (lastDelta?.u ?? {}) as Record<string, unknown[]>;
          const nRows = Object.keys(u).reduce((a, t) => a + u[t]!.length, 0);
          const deltaBytes = utf8Encode(JSON.stringify(lastDelta)).length;

          row(`captureLedgerSnapshot @ ${scale} rows`, stats(capS), counts(ledger));
          row(`diffLedger            @ ${scale} rows`, stats(diffS), `delta=${deltaBytes}B rows=${nRows}`);
          row(
            `>> TOTAL diff overhead @ ${scale} rows`,
            stats(capS.map((v, i) => v + diffS[i]!)),
            'per single-field edit',
          );
        }
      }

      // ===================================================================
      // 2. applyLedgerDelta — incoming peer ops
      // ===================================================================
      if (PHASE === 'apply') {
        for (const scale of SCALES) {
          // (a) patch ONE existing row, one field
          {
            const ledger = makeLedger(scale);
            const expenses = ledger.expenses as Row[];
            const iters = scale >= 20_000 ? 300 : 1500;
            const s: number[] = [];
            for (let k = 0; k < iters + 20; k += 1) {
              // Stride by a coprime so the target is spread across the WHOLE
              // table. Walking 0,1,2,... would let applyLedgerDelta's linear
              // `rowsOf().find()` exit after a few elements and understate cost.
              const key = expenses[(k * 7919) % expenses.length]!.id as string;
              const delta: LedgerDelta = { v: 1, u: { expenses: [{ k: key, f: { amount: 900 + k } }] } };
              const stamp = { hlc: hlcAt(1_800_000_000_000 + k, 0), authorMemberId: 'mem_peer01', opId: `op_${k}` };
              const t0 = performance.now();
              applyLedgerDelta(ledger as never, delta, stamp);
              const t1 = performance.now();
              if (k >= 20) s.push(t1 - t0);
            }
            const st = stats(s);
            row(`apply 1-row/1-field PATCH @ ${scale} rows`, st, `${(1000 / st.min).toFixed(0)} ops/s at min`);
          }

          // (b) CREATE a new row — hits setRows([...rows, target]) full array copy
          {
            const ledger = makeLedger(scale);
            const iters = scale >= 20_000 ? 300 : 1000;
            const s: number[] = [];
            for (let k = 0; k < iters + 20; k += 1) {
              const fresh = makeExpense(1_000_000 + k);
              const delta: LedgerDelta = { v: 1, u: { expenses: [{ k: fresh.id as string, f: fresh, n: 1 }] } };
              const stamp = { hlc: hlcAt(1_800_000_000_000 + k, 0), authorMemberId: 'mem_peer01', opId: `opc_${k}` };
              const t0 = performance.now();
              applyLedgerDelta(ledger as never, delta, stamp);
              const t1 = performance.now();
              if (k >= 20) s.push(t1 - t0);
            }
            const st = stats(s);
            row(`apply 1-row CREATE        @ ${scale} rows`, st, `${(1000 / st.min).toFixed(0)} ops/s at min`);
          }

          // (c) BULK delta — one op touching 200 existing rows (propagate-style)
          {
            const ledger = makeLedger(scale);
            const expenses = ledger.expenses as Row[];
            const bulk = Math.min(200, expenses.length);
            const iters = scale >= 20_000 ? 30 : 100;
            const s: number[] = [];
            for (let k = 0; k < iters + 5; k += 1) {
              const delta: LedgerDelta = {
                v: 1,
                u: {
                  // Spread the touched rows across the whole table, not the
                  // first `bulk` of them (see stride note above).
                  expenses: Array.from({ length: bulk }, (_, j) => ({
                    k: expenses[Math.floor((j * expenses.length) / bulk)]!.id as string,
                    f: { amount: 700 + k * 10 + j },
                  })),
                },
              };
              const stamp = { hlc: hlcAt(1_800_000_000_000 + k, 0), authorMemberId: 'mem_peer01', opId: `opb_${k}` };
              const t0 = performance.now();
              applyLedgerDelta(ledger as never, delta, stamp);
              const t1 = performance.now();
              if (k >= 5) s.push(t1 - t0);
            }
            const st = stats(s);
            row(`apply BULK ${bulk}-row PATCH  @ ${scale} rows`, st, `${((bulk * 1000) / st.min).toFixed(0)} rows/s at min`);
          }
        }
      }

      // ===================================================================
      // 3. persist() — one op-scale per process
      // ===================================================================
      if (PHASE.startsWith('persist')) {
        const opCount = Number(PHASE.replace('persist', ''));
        const dbKey = randomBytes(32);
        const hdk = randomBytes(32);

        // Build a REAL single-field-edit op payload so sizes are honest.
        const probe = makeLedger(20_000);
        const psnap = captureLedgerSnapshot(probe as never);
        (probe.expenses as Row[])[7]!.amount = 91_234;
        const pdelta = diffLedger(psnap, probe as never);
        const payloadObj = encodeLedgerOpPayload({ id: 'exp_7', amount: 91234, household_id: HH }, pdelta);
        const plain = utf8Encode(JSON.stringify(payloadObj));
        const ct = aeadEncrypt(hdk, plain, utf8Encode('aad'));
        emit(`INFO | op payload: plaintext ${plain.length}B -> ciphertext ${ct.length}B -> hex ${ct.length * 2} chars`);

        const payloadPool = Array.from({ length: 64 }, (_, i) =>
          aeadEncrypt(hdk, utf8Encode(JSON.stringify({ ...payloadObj, _i: i })), utf8Encode('aad')),
        );
        const sigPool = Array.from({ length: 64 }, () => randomBytes(64)); // ed25519 sig = 64B

        const ledger = makeLedger(20_000);
        ledger.ops = Array.from({ length: opCount }, (_, i) => ({
          opId: `op_${String(i).padStart(12, '0')}_a1b2c3d4`,
          householdId: HH,
          deviceId: 'dev_a1b2c3',
          authorMemberId: MEMBER,
          hlc: hlcAt(1_780_000_000_000 + i * 1000, i % 16),
          seq: i + 1,
          parentsJson: '[]',
          opType: 'EXPENSE_UPDATE',
          entityType: 'expense',
          entityId: `exp_${i % 12000}`,
          payload: payloadPool[i % 64]!,
          keyEpoch: 1,
          signature: sigPool[i % 64]!,
          appliedAt: 1_780_000_000_000 + i * 1000,
        }));
        ledger.crypto = {
          signingPrivateKeyHex: bytesToHex(randomBytes(32)),
          signingPublicKeyHex: bytesToHex(randomBytes(32)),
          agreementPrivateKeyHex: bytesToHex(randomBytes(32)),
          agreementPublicKeyHex: bytesToHex(randomBytes(32)),
          hdkHex: bytesToHex(randomBytes(32)),
          keyEpoch: 1,
        };
        emit(`INFO | built ledger 20000 rows + ${opCount} ops, heapUsed=${heapMb()}MB`);

        const iters = opCount >= 200_000 ? 1 : opCount >= 50_000 ? 3 : 8;
        const A: number[] = [];
        const B: number[] = [];
        const C: number[] = [];
        const D: number[] = [];
        const T: number[] = [];

        for (let k = 0; k < iters; k += 1) {
          // ---- byte-for-byte what persist() does ----
          const t0 = performance.now();
          const serializable = {
            ...ledger,
            ops: (ledger.ops as Array<Record<string, unknown>>).map((op) => ({
              ...op,
              payload: bytesToHex(op.payload as Uint8Array),
              signature: bytesToHex(op.signature as Uint8Array),
            })),
          };
          const json = JSON.stringify(serializable);
          const t1 = performance.now();
          emit(`STEP | iter${k} stringify+hex(ops) = ${ms(t1 - t0)}ms, json ${mib(json.length)}, heap ${heapMb()}MB`);

          const plainBuf = utf8Encode(json);
          const t2 = performance.now();
          emit(`STEP | iter${k} utf8Encode        = ${ms(t2 - t1)}ms, ${mib(plainBuf.length)}, heap ${heapMb()}MB`);

          const sealed = aeadEncrypt(dbKey, plainBuf, utf8Encode('budget-ledger-v1'));
          const t3 = performance.now();
          emit(
            `STEP | iter${k} aeadEncrypt        = ${ms(t3 - t2)}ms, ${mib(sealed.length)}, ` +
              `${(sealed.length / 1024 / 1024 / ((t3 - t2) / 1000)).toFixed(0)} MiB/s, heap ${heapMb()}MB`,
          );

          // The step that OOMs at 200k: 2 chars appended per byte via `out +=`.
          const hex = bytesToHex(sealed);
          const t4 = performance.now();
          emit(
            `STEP | iter${k} bytesToHex(sealed) = ${ms(t4 - t3)}ms, ${(hex.length / 1e6).toFixed(1)}M chars ` +
              `(${mib(hex.length)} stored), heap ${heapMb()}MB`,
          );

          A.push(t1 - t0);
          B.push(t2 - t1);
          C.push(t3 - t2);
          D.push(t4 - t3);
          T.push(t4 - t0);
          emit(`STEP | iter${k} >> persist() CPU TOTAL = ${ms(t4 - t0)}ms`);
          if (globalThis.gc) globalThis.gc();
        }

        row(`stringify+bytesToHex(ops) ops=${opCount}`, stats(A));
        row(`utf8Encode                ops=${opCount}`, stats(B));
        row(`aeadEncrypt               ops=${opCount}`, stats(C));
        row(`bytesToHex(sealed)        ops=${opCount}`, stats(D));
        row(`>> persist() CPU TOTAL    ops=${opCount}`, stats(T));
      }

      // ===================================================================
      // 4. AEAD isolated sweep
      // ===================================================================
      if (PHASE === 'aead') {
        const dbKey = randomBytes(32);
        for (const sizeMb of [0.0625, 0.5, 2, 8, 32, 128]) {
          const buf = pseudoBytes(Math.round(sizeMb * 1024 * 1024));
          const iters = sizeMb >= 32 ? 5 : sizeMb >= 8 ? 12 : 30;
          const s: number[] = [];
          for (let k = 0; k < iters + 2; k += 1) {
            const t0 = performance.now();
            aeadEncrypt(dbKey, buf, utf8Encode('budget-ledger-v1'));
            const t1 = performance.now();
            if (k >= 2) s.push(t1 - t0);
          }
          const st = stats(s);
          row(`aeadEncrypt ${mib(buf.length).padStart(10)}`, st, `${(buf.length / 1024 / 1024 / (st.min / 1000)).toFixed(0)} MiB/s at min`);
        }
      }

      // ===================================================================
      // 4b. bytesToHex cliff — the thing that OOMs persist()
      // ===================================================================
      if (PHASE === 'hex') {
        for (const sizeMb of [0.5, 2, 8, 32, 64, 128]) {
          const buf = pseudoBytes(Math.round(sizeMb * 1024 * 1024));
          const iters = sizeMb >= 64 ? 2 : sizeMb >= 8 ? 4 : 15;
          const s: number[] = [];
          let peak = 0;
          for (let k = 0; k < iters; k += 1) {
            if (globalThis.gc) globalThis.gc();
            const before = process.memoryUsage().heapUsed;
            const t0 = performance.now();
            const hex = bytesToHex(buf);
            const t1 = performance.now();
            peak = Math.max(peak, process.memoryUsage().heapUsed - before);
            s.push(t1 - t0);
            if (hex.length !== buf.length * 2) throw new Error('bad hex');
          }
          const st = stats(s);
          row(
            `bytesToHex ${mib(buf.length).padStart(10)}`,
            st,
            `heap delta ${mib(peak)} = ${(peak / buf.length).toFixed(1)}x input`,
          );
        }
      }

      emit(`=== PHASE ${PHASE} done | loadavg ${load()} ===`);
    },
    30 * 60 * 1000,
  );
});
