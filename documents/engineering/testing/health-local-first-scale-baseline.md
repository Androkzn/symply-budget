# Symply Health V2 local-first — scale baseline (stage He10)

**GENERATED — do not hand-edit.** Produced by `scripts/e2e/lib/health-scale-report.mjs` from a run of `scripts/e2e/lib/health-scale-bench.sh`. Re-run and regenerate; do not patch numbers in.

Run `health-20260815T030349Z-98007` · git `d70e484c8719` **(working tree dirty — the measured tree is not the committed tree)**

| | |
|---|---|
| Node | v22.15.0 (V8 12.4.254.21-node.24) |
| Machine | Apple M3 Pro x12, darwin-arm64 |
| Heap limit | 8240 MB |
| loadavg[0] at capture | 2.11 |
| `--expose-gc` | yes |
| Corpus fingerprint | 5c5ed6aa37882346 |
| Checkpoints (He8) | **ON** — the log is compacted below the published watermark |

> ## ⚠️ Node-measured. One on-device Hermes anchor is still owed before He3 perf claims.
> 
> Every millisecond below was produced by V8 on a developer laptop. Nothing here has run on a phone. The plan's DoD for He10 lists that anchor explicitly and it is **NOT DONE**: until one exists, the Hermes columns are an arithmetic projection over the audit's 3-15x band, not a measurement, and no He3 performance claim may cite this document as device evidence.

> Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device.

## 1. He10 Exit criteria — the plan's normative fail table

Graded on the **10y/1a** corpus (66,067 rows, 99,101 ops), with checkpoints ON.

| Metric | Fail above | Measured (Node, V8) | Hermes-estimated (x3, the gate) | Worst case (x15) | Verdict |
|---|---|---|---|---|---|
| Cold open → first Home paint | 3.0 s p50 | 2.07 s | 6.20 s | 30.98 s | ❌ **FAIL** |
| Cold open → first Home paint | 5.0 s p95 | 2.15 s | 6.46 s | 32.30 s | ❌ **FAIL** |
| Single meal `mutate` | 250 ms p95 | 95 ms | 284 ms | 1.42 s | ❌ **FAIL** |
| `applyLedgerDelta`, one deposit | 500 ms p95 | 198 ms | 593 ms | 2.96 s | ❌ **FAIL** |
| 17-loader `health-homehydrate` | 1.5 s p95 | 4.28 ms | 13 ms | 64 ms | ✅ PASS |
| Ledger + LWW on disk | 250 MB | 62.64 MiB | n/a — bytes are bytes | n/a | ✅ PASS |

**Which number is gated.** The plan gates "on the Hermes-estimated 10-year corpus". The audit's Hermes penalty is a BAND (3-15x), not a constant, so the gate runs at the **optimistic** end: a breach at x3 fails even if Hermes turns out to be at its friendliest, and is therefore unambiguous. **A PASS at x3 is explicitly NOT a pass at x15** — read the worst-case column before treating any row here as headroom. `SCALE_HERMES_MULTIPLIER` overrides the gate multiplier once an on-device anchor replaces the band with a measurement.

> ❌ **AT LEAST ONE THRESHOLD IS BREACHED.** Per plan §4 this **descopes Wave C** (cycle / fridge / foods stay on D1 or disabled) unless N5-style mitigations — stamp interning → column pruning → field grouping — close the gap. Do not silently ship. The scale phase that measured it FAILS, so this cannot be missed by reading past a table.

Scales (rows / ops, from the pinned generator):

| Scale | Rows | Ops |
|---|---|---|
| 1y/1a | 6,628 | 9,942 |
| 5y/1a | 32,982 | 49,473 |
| 10y/1a | 66,067 | 99,101 |

`1a` is one ADULT, not one device: a Health household has exactly one user (plan §1.2) and the generator pins it. The multi-device property that makes the op log interleaved is two DEVICES, one of them 30 days behind.

## 2. Cold open → first Home paint (checkpoints ON)

| Metric | Unit | 1y/1a | 5y/1a | 10y/1a |
|---|---|---|---|---|
| `coldopen.rows.count` | count | 6.6 k | 33.0 k | 66.1 k |
| `coldopen.rows.sealed.bytes` | bytes | 6.29 MiB | 31.21 MiB | 62.55 MiB |
| `coldopen.rows.envelope.chars` | chars | 6.41 M | 31.81 M | 63.74 M |
| `coldopen.rows.row.chars` | chars | 2.17 M | 10.80 M | 21.64 M |
| `coldopen.rows.lww.chars` | chars | 4.13 M | 20.51 M | 41.10 M |
| `coldopen.lww.charsPerRowChar` | ratio | 1.90 | 1.90 | 1.90 |
| `coldopen.sealAllRows` | ms | 190 ms <br><sub>p50 190 ms · p95 199 ms · n=4</sub> | 975 ms <br><sub>p50 1.00 s · p95 1.00 s · n=2</sub> | 1.92 s |
| `coldopen.oplog.tail.ops` | ops | 100 | 100 | 100 |
| `coldopen.oplog.tail.bytes` | bytes | 95.5 KiB | 95.6 KiB | 95.2 KiB |
| `coldopen.oplog.fullLog.ops` | ops | 9.9 k | 49.5 k | 99.1 k |
| `coldopen.oplog.fullLog.bytes` | bytes | 9.27 MiB | 46.18 MiB | 92.04 MiB |
| `disk.total.bytes` | bytes | 6.38 MiB | 31.31 MiB | 62.64 MiB |
| `disk.total.checkpointsOff.bytes` | bytes | 15.55 MiB | 77.39 MiB | 154.59 MiB |
| `coldopen.listRows` | ms | 2.10 ms <br><sub>p50 2.26 ms · p95 2.79 ms · n=20</sub> | 18 ms <br><sub>p50 24 ms · p95 26 ms · n=12</sub> | 37 ms <br><sub>p50 51 ms · p95 53 ms · n=8</sub> |
| `coldopen.openRowBody` | ms | 161 ms <br><sub>p50 164 ms · p95 171 ms · n=20</sub> | 792 ms <br><sub>p50 798 ms · p95 841 ms · n=12</sub> | 1.67 s <br><sub>p50 1.73 s · p95 1.77 s · n=8</sub> |
| `coldopen.jsonParse` | ms | 13 ms <br><sub>p50 14 ms · p95 15 ms · n=20</sub> | 70 ms <br><sub>p50 75 ms · p95 168 ms · n=12</sub> | 133 ms <br><sub>p50 230 ms · p95 268 ms · n=8</sub> |
| `coldopen.installRowEnvelopes` | ms | 6.84 ms <br><sub>p50 7.08 ms · p95 13 ms · n=20</sub> | 43 ms <br><sub>p50 47 ms · p95 51 ms · n=12</sub> | 83 ms <br><sub>p50 86 ms · p95 96 ms · n=8</sub> |
| `coldopen.tailReplay` | ms | 7.36 ms <br><sub>p50 8.00 ms · p95 8.96 ms · n=20</sub> | 21 ms <br><sub>p50 23 ms · p95 24 ms · n=12</sub> | 39 ms <br><sub>p50 41 ms · p95 49 ms · n=8</sub> |
| `coldopen.homeHydrate` | ms | 1.41 ms <br><sub>p50 1.72 ms · p95 9.03 ms · n=20</sub> | 5.29 ms <br><sub>p50 5.90 ms · p95 14 ms · n=12</sub> | 9.95 ms <br><sub>p50 13 ms · p95 23 ms · n=8</sub> |
| `coldopen.cpu` | ms | 181 ms <br><sub>p50 185 ms · p95 194 ms · n=20</sub> | 908 ms <br><sub>p50 920 ms · p95 1.04 s · n=12</sub> | 1.89 s <br><sub>p50 2.01 s · p95 2.10 s · n=8</sub> |
| `coldopen.toFirstPaint` | ms | 194 ms <br><sub>p50 · min 190 ms · p95 212 ms · n=20</sub> | 953 ms <br><sub>p50 · min 936 ms · p95 1.07 s · n=12</sub> | 2.07 s <br><sub>p50 · min 1.94 s · p95 2.15 s · n=8</sub> |
| `coldopen.aeadShare` | ratio | 0.89 | 0.87 | 0.89 |
| `coldopen.usPerRow` | ratio | 27.3 | 27.5 | 28.5 |
| `coldopen.fullLogReplay.projectedMs` | ratio | 795.3 | 11.4 k | 40.8 k |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for sizes and one-shot figures, p50 for timings, where every sample walks a different prefix of a linear scan and min reports the luckiest one. The Exit gate above reads **p95**._

## 3. `health-homehydrate` — the 17-loader `Promise.all`

| Metric | Unit | 1y/1a | 5y/1a | 10y/1a |
|---|---|---|---|---|
| `homehydrate.loaders` | count | 17 | 17 | 17 |
| `homehydrate.loaders.ledgerBacked` | count | 13 | 13 | 13 |
| `homehydrate.ledgerBacked.sumMs` | ratio | 0.93 | 2.87 | 6.38 |
| `homehydrate.mmkvBacked.sumMs` | ratio | 0.00 | 0.00 | 0.00 |
| `homehydrate.promiseAll` | ms | 0.584 ms <br><sub>p50 · min 0.535 ms · p95 0.722 ms · n=160</sub> | 1.68 ms <br><sub>p50 · min 1.55 ms · p95 2.24 ms · n=80</sub> | 3.62 ms <br><sub>p50 · min 3.17 ms · p95 4.28 ms · n=48</sub> |
| `homehydrate.usPerRow` | ratio | 0.11 | 0.07 | 0.06 |
| `homehydrate.onFocus` | ms | 0.579 ms <br><sub>p50 · min 0.533 ms · p95 0.634 ms · n=160</sub> | 1.68 ms <br><sub>p50 · min 1.56 ms · p95 2.05 ms · n=80</sub> | 3.77 ms <br><sub>p50 · min 3.30 ms · p95 4.91 ms · n=48</sub> |

### Per-loader breakdown (10y/1a)

The seventeen are modelled against the ledger, not imported: every `load*()` in `src/features/health/health*Storage.ts` pulls `@api/health` and `@services/storage`, which do not resolve outside the mobile tsconfig, and today they read an MMKV cache the network filled — measuring that would answer the wrong question. Four of the seventeen (`loadHealthPrefs`, `loadNoteForDate`, `loadHomeLayout`, `loadChallengesWidgetExpanded`) stay in MMKV by design and are modelled as the small key read they are.

| Loader | p50 | p95 | share of the 17 |
|---|---|---|---|
| `loadHabits` | 1.14 ms | 1.62 ms | 17.9% |
| `loadBodyEntries` | 0.813 ms | 1.49 ms | 12.7% |
| `loadWorkouts` | 0.779 ms | 1.86 ms | 12.2% |
| `loadWaterHistory` | 0.651 ms | 0.939 ms | 10.2% |
| `loadMeals` | 0.545 ms | 0.607 ms | 8.5% |
| `loadWeightLog` | 0.496 ms | 1.10 ms | 7.8% |
| `loadWeeklyTrend` | 0.483 ms | 0.613 ms | 7.6% |
| `loadSleepLog` | 0.437 ms | 0.520 ms | 6.9% |
| `loadStepDays` | 0.426 ms | 0.506 ms | 6.7% |
| `loadWaterToday` | 0.420 ms | 0.566 ms | 6.6% |
| `loadChallengesWeeklyOverview` | 0.176 ms | 0.382 ms | 2.8% |
| `loadNutritionGoals` | 0.003 ms | 0.005 ms | 0.1% |
| `loadActivityGoals` | 0.002 ms | 0.003 ms | 0.0% |
| `loadHomeLayout` | 0.001 ms | 0.001 ms | 0.0% |
| `loadHealthPrefs` | 0.001 ms | 0.002 ms | 0.0% |
| `loadNoteForDate` | 0.000 ms | 0.001 ms | 0.0% |
| `loadChallengesWidgetExpanded` | 0.000 ms | 0.000 ms | 0.0% |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for sizes and one-shot figures, p50 for timings, where every sample walks a different prefix of a linear scan and min reports the luckiest one. The Exit gate above reads **p95**._

## 4. Single meal `mutate`, end to end

| Metric | Unit | 1y/1a | 5y/1a | 10y/1a |
|---|---|---|---|---|
| `mutate.captureLedgerSnapshot` | ms | 3.50 ms <br><sub>p50 · min 3.37 ms · p95 3.62 ms · n=80</sub> | 19 ms <br><sub>p50 · min 19 ms · p95 21 ms · n=40</sub> | 43 ms <br><sub>p50 · min 42 ms · p95 45 ms · n=24</sub> |
| `mutate.diffLedger` | ms | 3.70 ms <br><sub>p50 · min 3.62 ms · p95 3.97 ms · n=80</sub> | 23 ms <br><sub>p50 · min 22 ms · p95 23 ms · n=40</sub> | 46 ms <br><sub>p50 · min 44 ms · p95 48 ms · n=24</sub> |
| `mutate.encodeAndSealOp` | ms | 0.238 ms <br><sub>p50 · min 0.110 ms · p95 0.292 ms · n=80</sub> | 0.275 ms <br><sub>p50 · min 0.136 ms · p95 0.332 ms · n=40</sub> | 0.287 ms <br><sub>p50 · min 0.150 ms · p95 0.362 ms · n=24</sub> |
| `mutate.collectRowWrites` | ms | 0.044 ms <br><sub>p50 · min 0.028 ms · p95 0.091 ms · n=80</sub> | 0.428 ms <br><sub>p50 · min 0.347 ms · p95 0.551 ms · n=40</sub> | 1.01 ms <br><sub>p50 · min 0.867 ms · p95 1.09 ms · n=24</sub> |
| `mutate.sealRowBody` | ms | 0.137 ms <br><sub>p50 · min 0.048 ms · p95 0.194 ms · n=80</sub> | 0.160 ms <br><sub>p50 · min 0.063 ms · p95 0.215 ms · n=40</sub> | 0.169 ms <br><sub>p50 · min 0.081 ms · p95 0.241 ms · n=24</sub> |
| `mutate.total` | ms | 7.57 ms <br><sub>p50 · min 7.36 ms · p95 7.92 ms · n=80</sub> | 43 ms <br><sub>p50 · min 42 ms · p95 45 ms · n=40</sub> | 90 ms <br><sub>p50 · min 88 ms · p95 95 ms · n=24</sub> |
| `mutate.delta.bytes` | bytes | 587 B | 588 B | 584 B |
| `mutate.op.sealed.bytes` | bytes | 719 B | 720 B | 715 B |
| `mutate.rows.sealed.bytes` | bytes | 587 B | 588 B | 584 B |
| `mutate.amplification.sealedPerDeltaByte` | ratio | 2.22 | 2.22 | 2.22 |
| `mutate.captureShare` | ratio | 0.46 | 0.45 | 0.48 |
| `mutate.waterCup.total` | ms | 7.23 ms <br><sub>p50 · min 6.72 ms · p95 7.66 ms · n=82</sub> | 42 ms <br><sub>p50 · min 39 ms · p95 45 ms · n=42</sub> | 88 ms <br><sub>p50 · min 85 ms · p95 93 ms · n=26</sub> |
| `mutate.wideRow.envelope.chars` | chars | 4.5 k | 4.5 k | 4.5 k |
| `mutate.wideRow.sealed.bytes` | bytes | 4.4 KiB | 4.4 KiB | 4.4 KiB |
| `mutate.wideRow.amplification.sealedPerDeltaByte` | ratio | 45.4 | 45.0 | 45.4 |
| `mutate.rows.json.chars` | chars | 2.18 M | 10.83 M | 21.71 M |
| `mutate.lww.json.chars` | chars | 5.52 M | 27.40 M | 54.92 M |
| `mutate.lww.stamps` | count | 85.0 k | 422.0 k | 845.5 k |
| `mutate.lww.charsPerRowChar` | ratio | 2.53 | 2.53 | 2.53 |
| `mutate.lww.bytesPerStamp` | ratio | 65.0 | 64.9 | 64.9 |
| `mutate.total.min` | ms | 7.36 ms | 42 ms | 88 ms |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for sizes and one-shot figures, p50 for timings, where every sample walks a different prefix of a linear scan and min reports the luckiest one. The Exit gate above reads **p95**._

## 5. `applyLedgerDelta` — one deposit, and the shape breakdown

| Metric | Unit | 1y/1a | 5y/1a | 10y/1a |
|---|---|---|---|---|
| `apply.deposit.maxOps` | ops | 266 | 266 | 266 |
| `apply.deposit.b64AtMax` | chars | 511.0 k | 511.0 k | 511.0 k |
| `apply.deposit.chunkBudgetB64` | count | 501.8 k | 501.8 k | 501.8 k |
| `apply.deposit` | ms | 14 ms <br><sub>p50 · min 8.43 ms · p95 25 ms · n=80</sub> | 49 ms <br><sub>p50 · min 41 ms · p95 61 ms · n=40</sub> | 153 ms <br><sub>p50 · min 124 ms · p95 198 ms · n=24</sub> |
| `apply.deposit.msPerOp` | ratio | 0.05 | 0.18 | 0.57 |
| `apply.deposit.rowGrowth` | ratio | 3.09 | 1.21 | 1.06 |
| `apply.patch1` | ms | 0.016 ms <br><sub>p50 · min 0.002 ms · p95 0.030 ms · n=800</sub> | 0.098 ms <br><sub>p50 · min 0.005 ms · p95 0.173 ms · n=300</sub> | 0.186 ms <br><sub>p50 · min 0.003 ms · p95 0.383 ms · n=150</sub> |
| `apply.patch1.opsPerSec` | ratio | 64.2 k | 10.2 k | 5.4 k |
| `apply.patch1.wideRow` | ms | 0.001 ms <br><sub>p50 · min 0.001 ms · p95 0.001 ms · n=800</sub> | 0.001 ms <br><sub>p50 · min 0.001 ms · p95 0.001 ms · n=300</sub> | 0.001 ms <br><sub>p50 · min 0.001 ms · p95 0.002 ms · n=150</sub> |
| `apply.create1` | ms | 0.043 ms <br><sub>p50 · min 0.032 ms · p95 0.053 ms · n=800</sub> | 0.154 ms <br><sub>p50 · min 0.147 ms · p95 0.177 ms · n=300</sub> | 0.337 ms <br><sub>p50 · min 0.309 ms · p95 0.401 ms · n=150</sub> |
| `apply.create1.opsPerSec` | ratio | 23.0 k | 6.5 k | 3.0 k |
| `apply.bulk200` | ms | 0.199 ms <br><sub>p50 · min 0.190 ms · p95 0.507 ms · n=40</sub> | 0.908 ms <br><sub>p50 · min 0.878 ms · p95 3.73 ms · n=20</sub> | 2.07 ms <br><sub>p50 · min 1.87 ms · p95 6.76 ms · n=12</sub> |
| `apply.bulk200.rowsPerSec` | ratio | 1.01 M | 220.4 k | 96.8 k |
| `apply.delete1` | ms | 0.042 ms <br><sub>p50 · min 0.041 ms · p95 0.069 ms · n=45</sub> | 0.219 ms <br><sub>p50 · min 0.211 ms · p95 1.11 ms · n=25</sub> | 0.501 ms <br><sub>p50 · min 0.484 ms · p95 4.76 ms · n=17</sub> |
| `apply.delete200` | ms | 0.512 ms <br><sub>p50 · min 0.428 ms · p95 2.62 ms · n=8</sub> | 1.45 ms <br><sub>p50 · min 1.13 ms · p95 4.17 ms · n=6</sub> | 3.47 ms <br><sub>p50 · min 2.52 ms · p95 7.83 ms · n=5</sub> |
| `apply.delete200.strategyIsIndex` | count | 1 | 1 | 1 |
| `apply.concurrentLoser` | ms | 0.007 ms <br><sub>p50 · min 0.002 ms · p95 0.011 ms · n=800</sub> | 0.031 ms <br><sub>p50 · min 0.004 ms · p95 0.066 ms · n=300</sub> | 0.058 ms <br><sub>p50 · min 0.004 ms · p95 0.102 ms · n=150</sub> |
| `apply.concurrentLoser.conflicts` | count | 50 | 50 | 50 |
| `apply.orphanPark` | ms | 0.035 ms <br><sub>p50 · min 0.030 ms · p95 0.042 ms · n=40</sub> | 0.170 ms <br><sub>p50 · min 0.142 ms · p95 11 ms · n=20</sub> | 0.376 ms <br><sub>p50 · min 0.334 ms · p95 15 ms · n=12</sub> |
| `apply.deposit.opsPerDeposit` | ops | 266 | 266 | 266 |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for sizes and one-shot figures, p50 for timings, where every sample walks a different prefix of a linear scan and min reports the luckiest one. The Exit gate above reads **p95**._

## What this does NOT measure

- **Hermes.** Every number is V8. ⚠️ **One on-device Hermes anchor is still owed before any He3 performance claim cites this document.** The 3-15x band is the audit's, it varies per operation (string building and pure-JS crypto are worst), and no millisecond here is a device millisecond.
- **The SQLite read itself.** `coldopen.listRows` runs against `MemoryLocalFirstStore`, not `SqliteLocalFirstStore`, and is reported separately for exactly that reason — the only off-device driver is a fake whose lookups are `Array.some`. Quote `coldopen.cpu` and `coldopen.toFirstPaint`, both of which exclude it.
- **React.** `coldopen.toFirstPaint` ends when the 17-loader `Promise.all` resolves. The state commits and the render pass that follow are real cost this harness cannot reach from Node, so the first-paint figure is a FLOOR even before the Hermes multiplier.
- **Real Ed25519.** Op signatures in the corpus are 64 pseudo-random bytes: correct for size and for the persist/batch paths, silent about verify cost.
- **The full-log replay.** With checkpoints ON a cold open replays only the unpublished tail (≤100 ops), which is what the plan asks for. `coldopen.fullLogReplay.projectedMs` is DECLARED ARITHMETIC over the measured per-op tail cost, not a measurement — it exists to put a number on what He8 buys.
- **Sync itself.** No relay, no chunk round trip, no second device applying what a first one produced. The corpus does carry a two-device op log and a populated LWW watermark map, so the merge machinery is under load, but delivery is not.
- **HealthKit.** Wave B (He11a) adds a `healthkit` source and re-fires the same hydrate after every sync (`useHealthKitSyncHydration`). The corpus is manual-source only, so `homehydrate.onFocus` is the closest thing here to that second hydrate.

## How to re-run

```sh
scripts/e2e/lib/health-scale-bench.sh guard      # cheap corpus + realism guards
scripts/e2e/lib/health-scale-bench.sh run        # measure, write JSONL
scripts/e2e/lib/health-scale-bench.sh baseline   # run + regenerate this file
scripts/e2e/lib/health-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl
```

The phases **assert** the Exit table: a breach fails the vitest run, not just this document. `compare` additionally exits non-zero on a regression beyond tolerance in either direction, on a metric present in the baseline but missing from the run, on a crashed phase, and on a run whose corpus fingerprint differs from the baseline's.

