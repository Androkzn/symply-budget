# Symply House V2 local-first — scale baseline

**GENERATED — do not hand-edit.** Produced by `scripts/e2e/lib/budget-scale-report.mjs` from a run of `scripts/e2e/lib/house-scale-bench.sh`. Re-run and regenerate; do not patch numbers in.

Run `house-20260813T073250Z-43305` · git `1584430dcddc` **(working tree dirty — the measured tree is not the committed tree)**

| | |
|---|---|
| Node | v22.15.0 (V8 12.4.254.21-node.24) |
| Machine | Apple M3 Pro x12, darwin-arm64 |
| Heap limit | 8240 MB |
| loadavg[0] at capture | 4.21 |
| `--expose-gc` | yes |
| Corpus fingerprint | a7c9454e863ba24c |

> ## NOT A REGRESSION GATE
> 
> This capture is **provisional**. `compare` will refuse to grade timings against it. Re-take it (`house-scale-bench.sh baseline`) on a quiet machine before any stage is judged by it. Reasons:
> 
> - captured above the load gate (SCALE_ALLOW_LOAD=1, loadavg[0] 4.21) — the timings include whatever else the machine was doing

> **WARNING — load gate overridden.** At least one record was captured above loadavg 3.0 (SCALE_ALLOW_LOAD=1). These numbers are provisional: they include scheduling noise from whatever else the machine was doing. Re-take on a quiet machine before quoting them as a baseline.

> Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device.

Scales (rows / ops, from the pinned generator):

| Scale | Rows | Ops |
|---|---|---|
| 1y/2a | 3,109 | 4,664 |
| 3y/2a | 8,833 | 13,250 |
| 5y/2a | 14,557 | 21,836 |
| 10y/2a | 28,867 | 43,301 |

## 1. Single-field edit, end to end

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `edit.captureLedgerSnapshot` | ms | 1.89 ms <br><sub>p50 1.96 ms · p95 4.61 ms · n=40</sub> | 5.60 ms <br><sub>p50 6.43 ms · p95 7.15 ms · n=40</sub> | 9.53 ms <br><sub>p50 11 ms · p95 11 ms · n=25</sub> | 18 ms <br><sub>p50 19 ms · p95 20 ms · n=15</sub> |
| `edit.diffLedger` | ms | 2.03 ms <br><sub>p50 2.11 ms · p95 4.60 ms · n=40</sub> | 6.15 ms <br><sub>p50 6.51 ms · p95 7.54 ms · n=40</sub> | 11 ms <br><sub>p50 12 ms · p95 13 ms · n=25</sub> | 22 ms <br><sub>p50 23 ms · p95 24 ms · n=15</sub> |
| `edit.captureAndDiff` | ms | 3.95 ms <br><sub>p50 4.12 ms · p95 7.87 ms · n=40</sub> | 12 ms <br><sub>p50 13 ms · p95 14 ms · n=40</sub> | 22 ms <br><sub>p50 23 ms · p95 24 ms · n=25</sub> | 40 ms <br><sub>p50 41 ms · p95 43 ms · n=15</sub> |
| `edit.delta.bytes` | bytes | 83 B | 84 B | 84 B | 84 B |
| `edit.collectRowWrites` | ms | 0.036 ms <br><sub>p50 0.049 ms · p95 0.353 ms · n=5</sub> | 0.110 ms <br><sub>p50 0.185 ms · p95 0.571 ms · n=5</sub> | 0.080 ms <br><sub>p50 0.385 ms · p95 1.38 ms · n=3</sub> | 0.206 ms <br><sub>p50 0.494 ms · p95 0.494 ms · n=2</sub> |
| `edit.sealRowBody` | ms | 0.354 ms <br><sub>p50 0.411 ms · p95 0.501 ms · n=5</sub> | 0.387 ms <br><sub>p50 0.391 ms · p95 0.607 ms · n=5</sub> | 0.258 ms <br><sub>p50 0.382 ms · p95 0.688 ms · n=3</sub> | 0.396 ms <br><sub>p50 0.564 ms · p95 0.564 ms · n=2</sub> |
| `edit.total.today` | ms | 0.403 ms <br><sub>p50 0.477 ms · p95 0.854 ms · n=5</sub> | 0.503 ms <br><sub>p50 0.576 ms · p95 1.18 ms · n=5</sub> | 0.338 ms <br><sub>p50 0.767 ms · p95 2.07 ms · n=3</sub> | 0.602 ms <br><sub>p50 1.06 ms · p95 1.06 ms · n=2</sub> |
| `edit.total.todayWithProjection` | ms | 4.35 ms | 12 ms | 22 ms | 41 ms |
| `edit.sealed.bytes` | bytes | 728 B | 674 B | 731 B | 731 B |
| `edit.amplification.sealedPerDeltaByte` | ratio | 8.77 | 8.02 | 8.70 | 8.70 |
| `edit.wideRow.envelope.chars` | chars | 3.9 k | 3.9 k | 3.8 k | 3.9 k |
| `edit.wideRow.sealed.bytes` | bytes | 3.8 KiB | 3.9 KiB | 3.7 KiB | 3.8 KiB |
| `edit.wideRow.amplification.sealedPerDeltaByte` | ratio | 44.3 | 44.9 | 43.0 | 44.3 |
| `edit.rows.json.chars` | chars | 1.44 M | 4.09 M | 6.74 M | 13.36 M |
| `edit.lww.json.chars` | chars | 2.78 M | 7.83 M | 12.88 M | 25.50 M |
| `edit.lww.stamps` | count | 45.2 k | 127.2 k | 209.1 k | 414.0 k |
| `edit.lww.charsPerRowChar` | ratio | 1.93 | 1.92 | 1.91 | 1.91 |
| `edit.lww.bytesPerStamp` | ratio | 61.5 | 61.5 | 61.6 | 61.6 |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for most, p50 for `apply.*`, where every sample walks a different prefix of a linear scan and min reports the luckiest one._

## 2. `applyLedgerDelta` throughput

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `apply.patch1` | ms | 0.008 ms <br><sub>p50 · min 0.002 ms · p95 0.013 ms · n=800</sub> | 0.018 ms <br><sub>p50 · min 0.002 ms · p95 0.039 ms · n=800</sub> | 0.027 ms <br><sub>p50 · min 0.003 ms · p95 0.048 ms · n=400</sub> | 0.055 ms <br><sub>p50 · min 0.006 ms · p95 0.099 ms · n=200</sub> |
| `apply.patch1.opsPerSec` | ratio | 132.6 k | 56.9 k | 36.6 k | 18.2 k |
| `apply.patch1.wideRow` | ms | 0.008 ms <br><sub>p50 · min 0.002 ms · p95 0.015 ms · n=800</sub> | 0.021 ms <br><sub>p50 · min 0.002 ms · p95 0.042 ms · n=800</sub> | 0.031 ms <br><sub>p50 · min 0.003 ms · p95 0.059 ms · n=400</sub> | 0.078 ms <br><sub>p50 · min 0.005 ms · p95 0.186 ms · n=200</sub> |
| `apply.patch1.wideRow.opsPerSec` | ratio | 125.0 k | 47.1 k | 32.6 k | 12.8 k |
| `apply.create1` | ms | 0.035 ms <br><sub>p50 · min 0.024 ms · p95 0.048 ms · n=800</sub> | 0.075 ms <br><sub>p50 · min 0.061 ms · p95 0.085 ms · n=800</sub> | 0.113 ms <br><sub>p50 · min 0.106 ms · p95 0.125 ms · n=400</sub> | 0.230 ms <br><sub>p50 · min 0.218 ms · p95 0.270 ms · n=200</sub> |
| `apply.create1.opsPerSec` | ratio | 28.3 k | 13.4 k | 8.8 k | 4.3 k |
| `apply.bulk200` | ms | 0.148 ms <br><sub>p50 · min 0.132 ms · p95 0.368 ms · n=40</sub> | 0.308 ms <br><sub>p50 · min 0.268 ms · p95 1.30 ms · n=40</sub> | 0.867 ms <br><sub>p50 · min 0.637 ms · p95 5.62 ms · n=25</sub> | 0.964 ms <br><sub>p50 · min 0.922 ms · p95 3.62 ms · n=15</sub> |
| `apply.bulk200.rowsPerSec` | ratio | 1.35 M | 650.4 k | 230.8 k | 207.5 k |
| `apply.delete1` | ms | 0.031 ms <br><sub>p50 · min 0.028 ms · p95 0.071 ms · n=45</sub> | 0.084 ms <br><sub>p50 · min 0.077 ms · p95 0.156 ms · n=45</sub> | 0.161 ms <br><sub>p50 · min 0.138 ms · p95 0.840 ms · n=30</sub> | 0.264 ms <br><sub>p50 · min 0.240 ms · p95 2.56 ms · n=20</sub> |
| `apply.delete200` | ms | 0.422 ms <br><sub>p50 · min 0.001 ms · p95 3.18 ms · n=8</sub> | 0.887 ms <br><sub>p50 · min 0.686 ms · p95 4.23 ms · n=8</sub> | 0.949 ms <br><sub>p50 · min 0.763 ms · p95 2.60 ms · n=6</sub> | 1.39 ms <br><sub>p50 · min 1.21 ms · p95 3.88 ms · n=5</sub> |
| `apply.delete200.strategyIsIndex` | count | 1 | 1 | 1 | 1 |
| `apply.concurrentLoser` | ms | 0.015 ms <br><sub>p50 · min 0.003 ms · p95 0.026 ms · n=800</sub> | 0.036 ms <br><sub>p50 · min 0.004 ms · p95 0.070 ms · n=800</sub> | 0.061 ms <br><sub>p50 · min 0.004 ms · p95 0.115 ms · n=400</sub> | 0.117 ms <br><sub>p50 · min 0.010 ms · p95 0.207 ms · n=200</sub> |
| `apply.concurrentLoser.conflicts` | count | 50 | 50 | 50 | 50 |
| `apply.orphanPark` | ms | 0.020 ms <br><sub>p50 · min 0.020 ms · p95 0.115 ms · n=40</sub> | 0.057 ms <br><sub>p50 · min 0.052 ms · p95 0.076 ms · n=40</sub> | 0.107 ms <br><sub>p50 · min 0.098 ms · p95 0.183 ms · n=25</sub> | 0.208 ms <br><sub>p50 · min 0.199 ms · p95 6.94 ms · n=15</sub> |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for most, p50 for `apply.*`, where every sample walks a different prefix of a linear scan and min reports the luckiest one._

## 3. Cold open (snapshot path)

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `coldopen.rows.count` | count | 3.1 k | 8.8 k | 14.6 k | 28.9 k |
| `coldopen.rows.sealed.bytes` | bytes | 4.12 MiB | 11.62 MiB | 19.13 MiB | 37.89 MiB |
| `coldopen.rows.envelope.chars` | chars | 4.23 M | 11.94 M | 19.65 M | 38.92 M |
| `coldopen.sealAllRows` | ms | 114 ms <br><sub>p50 118 ms · p95 127 ms · n=4</sub> | 311 ms <br><sub>p50 323 ms · p95 337 ms · n=4</sub> | 521 ms <br><sub>p50 544 ms · p95 544 ms · n=2</sub> | 1.07 s |
| `coldopen.listRows` | ms | 1.81 ms <br><sub>p50 2.97 ms · p95 3.37 ms · n=5</sub> | 2.50 ms <br><sub>p50 3.61 ms · p95 8.43 ms · n=5</sub> | 5.60 ms <br><sub>p50 7.11 ms · p95 8.39 ms · n=3</sub> | 13 ms <br><sub>p50 14 ms · p95 14 ms · n=2</sub> |
| `coldopen.openRowBody` | ms | 99 ms <br><sub>p50 105 ms · p95 106 ms · n=5</sub> | 273 ms <br><sub>p50 277 ms · p95 306 ms · n=5</sub> | 442 ms <br><sub>p50 453 ms · p95 460 ms · n=3</sub> | 884 ms <br><sub>p50 940 ms · p95 940 ms · n=2</sub> |
| `coldopen.jsonParse` | ms | 7.36 ms <br><sub>p50 7.73 ms · p95 8.36 ms · n=5</sub> | 22 ms <br><sub>p50 22 ms · p95 24 ms · n=5</sub> | 39 ms <br><sub>p50 39 ms · p95 44 ms · n=3</sub> | 85 ms <br><sub>p50 87 ms · p95 87 ms · n=2</sub> |
| `coldopen.installRowEnvelopes` | ms | 0.414 ms <br><sub>p50 0.456 ms · p95 0.851 ms · n=5</sub> | 0.759 ms <br><sub>p50 0.972 ms · p95 1.67 ms · n=5</sub> | 2.16 ms <br><sub>p50 2.20 ms · p95 2.57 ms · n=3</sub> | 4.71 ms <br><sub>p50 5.49 ms · p95 5.49 ms · n=2</sub> |
| `coldopen.cpu` | ms | 108 ms <br><sub>p50 113 ms · p95 115 ms · n=5</sub> | 295 ms <br><sub>p50 299 ms · p95 331 ms · n=5</sub> | 483 ms <br><sub>p50 499 ms · p95 501 ms · n=3</sub> | 974 ms <br><sub>p50 1.03 s · p95 1.03 s · n=2</sub> |
| `coldopen.aeadShare` | ratio | 0.92 | 0.92 | 0.91 | 0.91 |
| `coldopen.usPerRow` | ratio | 34.7 | 33.4 | 33.2 | 33.7 |
| `coldopen.threePropertyRatio` | ratio | 1.03 | 1.02 | 1.02 | 1.03 |
| `coldopen.perPropertySessionBuild` | ms | 1.81 ms <br><sub>p50 2.97 ms · p95 3.37 ms · n=5</sub> | 2.50 ms <br><sub>p50 3.61 ms · p95 8.43 ms · n=5</sub> | 5.60 ms <br><sub>p50 7.11 ms · p95 8.39 ms · n=3</sub> | 13 ms <br><sub>p50 14 ms · p95 14 ms · n=2</sub> |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for most, p50 for `apply.*`, where every sample walks a different prefix of a linear scan and min reports the luckiest one._

## 4. Op batch vs the relay cap

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `batchcap.maxOpsUnderCap` | ops | 455 | 452 | 452 | 452 |
| `batchcap.b64AtMax` | chars | 512.0 k | 510.9 k | 510.9 k | 510.9 k |
| `batchcap.ciphertextB64PerOp` | ratio | 1.1 k | 1.1 k | 1.1 k | 1.1 k |
| `batchcap.bytesPerOp` | ratio | 843.9 | 847.8 | 847.8 | 847.8 |
| `batchcap.maxOpsUnderChunkBudget` | ops | 445 | 443 | 443 | 443 |
| `batchcap.sealOpBatch.fullLog` | ms | 61 ms <br><sub>p50 68 ms · p95 76 ms · n=3</sub> | 181 ms <br><sub>p50 195 ms · p95 199 ms · n=3</sub> | 296 ms <br><sub>p50 308 ms · p95 330 ms · n=3</sub> | 655 ms <br><sub>p50 692 ms · p95 733 ms · n=3</sub> |
| `batchcap.b64AtScale` | chars | 5.26 M | 15.01 M | 24.75 M | 49.11 M |
| `batchcap.overCapRatioAtScale` | ratio | 10.3 | 29.3 | 48.3 | 95.9 |
| `batchcap.chunksForFullLog` | count | 11 | 30 | 50 | 98 |
| `batchcap.opsPerDay` | ratio | 12.8 | 12.1 | 12.0 | 11.9 |
| `batchcap.daysOfHistoryPerDeposit` | ratio | 35.6 | 37.4 | 37.8 | 38.1 |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Each metric is shown at the statistic it is graded on — min for most, p50 for `apply.*`, where every sample walks a different prefix of a linear scan and min reports the luckiest one._

## What this does NOT measure

- **Hermes.** Every number is V8. The audit puts Hermes at 3-15x slower and the multiplier varies per operation (string building and pure-JS crypto are worst). Nobody should quote a millisecond from this document as a device millisecond. An on-device harness would need product source this stage does not own.
- **The SQLite journal branch of cold open** (`resolveLedgerOps`, engine.ts:444-458). The only off-device driver is `__tests__/helpers/fake-sqlite-driver.ts`, whose `hasOperation` is `Array.some` and whose `insertOperation` adds a second linear scan; rehydrating tens of thousands of ops would measure the fake's O(n^2), not the product. `coldopen.total` is the snapshot path ONLY.
- **Real Ed25519 signing and verification.** Op signatures in the corpus are 64 pseudo-random bytes: correct for size and for the persist/batch paths, but this harness says nothing about verify cost — which Stage 5's bootstrap decision needs (the audit estimates 83 s of blocked Ed25519 for ~40,000 ops).
- **The 4-member household.** The audit quotes 11,833 rows at 5y/2 adults and 24,703 at 5y/4 members. No linear composition satisfies both with a non-negative fixed term (it implies F = -1,037). The generator reproduces the 2-adult reference exactly and yields 22,655 at 4 adults. Any 4-member column is generator-derived and needs a product call before it is cited as the audit's figure.
- **Sync itself.** No relay, no chunking round trip, no second device applying what a first one produced. `batchcap` measures what a batch COSTS, not whether it arrives. The corpus does carry a multi-device op log and a populated LWW watermark map, so the merge machinery is under load here, but delivery is not.

## How to re-run

```sh
scripts/e2e/lib/house-scale-bench.sh guard      # cheap correctness guards
scripts/e2e/lib/house-scale-bench.sh baseline   # full run + regenerate this file
scripts/e2e/lib/house-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl
```

`compare` exits non-zero on a regression beyond tolerance in EITHER direction (each metric declares which way is worse), on a metric that is in the baseline but missing from the run, on a crashed phase, and on a run whose corpus fingerprint differs from the baseline's. That exit code is how Stages 1-5 are judged.

