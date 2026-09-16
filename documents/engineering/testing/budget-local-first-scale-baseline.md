# Budget V2 local-first — scale baseline

**GENERATED — do not hand-edit.** Produced by `scripts/e2e/lib/budget-scale-report.mjs` from a run of `scripts/e2e/lib/budget-scale-bench.sh`. Re-run and regenerate; do not patch numbers in.

Run `20260812T221332Z-24118` · git `8bb49d4897d3` **(working tree dirty — the measured tree is not the committed tree)**

| | |
|---|---|
| Node | v22.15.0 (V8 12.4.254.21-node.24) |
| Machine | Apple M3 Pro x12, darwin-arm64 |
| Heap limit | 8240 MB |
| loadavg[0] at capture | 6.27 |
| `--expose-gc` | yes |

> **WARNING — load gate overridden.** At least one record was captured above loadavg 3.0 (SCALE_ALLOW_LOAD=1). These numbers are provisional: they include scheduling noise from whatever else the machine was doing. Re-take on a quiet machine before quoting them as a baseline.

> Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device.

Scales (rows / ops, from the pinned generator):

| Scale | Rows | Ops |
|---|---|---|
| 1y/2a | 2,437 | 3,656 |
| 3y/2a | 7,135 | 10,703 |
| 5y/2a | 11,833 | 17,750 |
| 10y/2a | 23,578 | 35,367 |

## 1. Single-field edit, end to end

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `edit.captureLedgerSnapshot` | ms | 1.32 ms <br><sub>p50 1.48 ms · p95 1.78 ms · n=40</sub> | 4.08 ms <br><sub>p50 4.44 ms · p95 13 ms · n=40</sub> | 6.88 ms <br><sub>p50 7.58 ms · p95 8.34 ms · n=25</sub> | 14 ms <br><sub>p50 14 ms · p95 33 ms · n=15</sub> |
| `edit.diffLedger` | ms | 1.44 ms <br><sub>p50 1.63 ms · p95 2.40 ms · n=40</sub> | 4.65 ms <br><sub>p50 5.73 ms · p95 13 ms · n=40</sub> | 7.71 ms <br><sub>p50 9.09 ms · p95 11 ms · n=25</sub> | 18 ms <br><sub>p50 19 ms · p95 36 ms · n=15</sub> |
| `edit.captureAndDiff` | ms | 2.81 ms <br><sub>p50 3.13 ms · p95 4.32 ms · n=40</sub> | 8.97 ms <br><sub>p50 10 ms · p95 24 ms · n=40</sub> | 15 ms <br><sub>p50 16 ms · p95 18 ms · n=25</sub> | 32 ms <br><sub>p50 33 ms · p95 59 ms · n=15</sub> |
| `edit.delta.bytes` | bytes | 63 B | 63 B | 63 B | 63 B |
| `edit.serialize.stringifyWithHexOps` | ms | 25 ms <br><sub>p50 26 ms · p95 32 ms · n=5</sub> | 105 ms <br><sub>p50 116 ms · p95 182 ms · n=5</sub> | 181 ms <br><sub>p50 226 ms · p95 235 ms · n=3</sub> | 462 ms <br><sub>p50 492 ms · p95 492 ms · n=2</sub> |
| `edit.utf8Encode` | ms | 4.56 ms <br><sub>p50 4.64 ms · p95 4.82 ms · n=5</sub> | 14 ms <br><sub>p50 14 ms · p95 35 ms · n=5</sub> | 23 ms <br><sub>p50 24 ms · p95 27 ms · n=3</sub> | 47 ms <br><sub>p50 48 ms · p95 48 ms · n=2</sub> |
| `edit.aeadEncrypt` | ms | 60 ms <br><sub>p50 61 ms · p95 70 ms · n=5</sub> | 176 ms <br><sub>p50 181 ms · p95 205 ms · n=5</sub> | 280 ms <br><sub>p50 331 ms · p95 346 ms · n=3</sub> | 661 ms <br><sub>p50 775 ms · p95 775 ms · n=2</sub> |
| `edit.encode.hex` | ms | 232 ms <br><sub>p50 254 ms · p95 284 ms · n=5</sub> | 706 ms <br><sub>p50 754 ms · p95 802 ms · n=5</sub> | 1.34 s <br><sub>p50 1.40 s · p95 1.41 s · n=3</sub> | 2.66 s <br><sub>p50 2.75 s · p95 2.75 s · n=2</sub> |
| `edit.encode.base64` | ms | 118 ms <br><sub>p50 136 ms · p95 146 ms · n=5</sub> | 413 ms <br><sub>p50 427 ms · p95 457 ms · n=5</sub> | 678 ms <br><sub>p50 684 ms · p95 770 ms · n=3</sub> | 1.58 s <br><sub>p50 1.93 s · p95 1.93 s · n=2</sub> |
| `edit.total.today` | ms | 322 ms <br><sub>p50 345 ms · p95 391 ms · n=5</sub> | 1.00 s <br><sub>p50 1.09 s · p95 1.18 s · n=5</sub> | 1.88 s <br><sub>p50 1.93 s · p95 2.00 s · n=3</sub> | 3.83 s <br><sub>p50 4.06 s · p95 4.06 s · n=2</sub> |
| `edit.total.todayWithProjection` | ms | 325 ms | 1.01 s | 1.90 s | 3.86 s |
| `edit.serialize.json.chars` | chars | 4.03 M | 11.86 M | 19.69 M | 39.26 M |
| `edit.serialize.json.bytes` | bytes | 3.85 MiB | 11.32 MiB | 18.78 MiB | 37.45 MiB |
| `edit.sealed.bytes` | bytes | 3.85 MiB | 11.32 MiB | 18.78 MiB | 37.45 MiB |
| `edit.encode.hex.chars` | chars | 8.07 M | 23.73 M | 39.39 M | 78.53 M |
| `edit.encode.base64.chars` | chars | 5.38 M | 15.82 M | 26.26 M | 52.35 M |
| `edit.amplification.hexCharsPerDeltaByte` | ratio | 128.1 k | 376.7 k | 625.2 k | 1.25 M |
| `edit.amplification.base64VsHex` | ratio | 0.67 | 0.67 | 0.67 | 0.67 |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Times are min, with p50/p95 beneath._

## 2. `applyLedgerDelta` throughput

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `apply.patch1` | ms | 0.002 ms <br><sub>p50 0.011 ms · p95 0.017 ms · n=800</sub> | 0.002 ms <br><sub>p50 0.027 ms · p95 0.066 ms · n=800</sub> | 0.003 ms <br><sub>p50 0.045 ms · p95 0.142 ms · n=400</sub> | 0.002 ms <br><sub>p50 0.080 ms · p95 0.157 ms · n=200</sub> |
| `apply.patch1.opsPerSec` | ratio | 93.4 k | 36.8 k | 22.4 k | 12.6 k |
| `apply.create1` | ms | 0.018 ms <br><sub>p50 0.023 ms · p95 0.031 ms · n=800</sub> | 0.044 ms <br><sub>p50 0.053 ms · p95 0.081 ms · n=800</sub> | 0.073 ms <br><sub>p50 0.086 ms · p95 0.136 ms · n=400</sub> | 0.167 ms <br><sub>p50 0.206 ms · p95 0.648 ms · n=200</sub> |
| `apply.create1.opsPerSec` | ratio | 43.4 k | 18.9 k | 11.6 k | 4.9 k |
| `apply.bulk200` | ms | 0.123 ms <br><sub>p50 0.131 ms · p95 0.515 ms · n=40</sub> | 0.288 ms <br><sub>p50 0.327 ms · p95 1.63 ms · n=40</sub> | 0.423 ms <br><sub>p50 0.485 ms · p95 0.966 ms · n=25</sub> | 0.973 ms <br><sub>p50 1.49 ms · p95 3.79 ms · n=15</sub> |
| `apply.bulk200.rowsPerSec` | ratio | 1.52 M | 611.3 k | 412.1 k | 134.1 k |
| `apply.delete1` | ms | 0.023 ms <br><sub>p50 0.026 ms · p95 0.065 ms · n=40</sub> | 0.065 ms <br><sub>p50 0.075 ms · p95 0.223 ms · n=40</sub> | 0.101 ms <br><sub>p50 0.130 ms · p95 0.257 ms · n=25</sub> | 0.330 ms <br><sub>p50 0.667 ms · p95 17 ms · n=15</sub> |
| `apply.delete200.projected` | ms | 5.12 ms | 15 ms | 26 ms | 133 ms |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Times are min, with p50/p95 beneath._

## 3. Cold open (snapshot path)

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `coldopen.snapshot.chars` | chars | 8.07 M | 23.73 M | 39.39 M | 78.53 M |
| `coldopen.hexToBytes` | ms | 13 ms <br><sub>p50 13 ms · p95 18 ms · n=5</sub> | 37 ms <br><sub>p50 38 ms · p95 51 ms · n=5</sub> | 65 ms <br><sub>p50 65 ms · p95 83 ms · n=3</sub> | 124 ms <br><sub>p50 157 ms · p95 157 ms · n=2</sub> |
| `coldopen.aeadDecrypt` | ms | 59 ms <br><sub>p50 60 ms · p95 62 ms · n=5</sub> | 165 ms <br><sub>p50 171 ms · p95 180 ms · n=5</sub> | 272 ms <br><sub>p50 278 ms · p95 288 ms · n=3</sub> | 563 ms <br><sub>p50 571 ms · p95 571 ms · n=2</sub> |
| `coldopen.utf8Decode` | ms | 2.17 ms <br><sub>p50 2.28 ms · p95 2.48 ms · n=5</sub> | 6.55 ms <br><sub>p50 6.66 ms · p95 6.84 ms · n=5</sub> | 11 ms <br><sub>p50 11 ms · p95 11 ms · n=3</sub> | 22 ms <br><sub>p50 23 ms · p95 23 ms · n=2</sub> |
| `coldopen.jsonParse.probe` | ms | 5.15 ms <br><sub>p50 5.24 ms · p95 5.36 ms · n=5</sub> | 15 ms <br><sub>p50 15 ms · p95 16 ms · n=5</sub> | 28 ms <br><sub>p50 29 ms · p95 30 ms · n=3</sub> | 81 ms <br><sub>p50 97 ms · p95 97 ms · n=2</sub> |
| `coldopen.jsonParse.full` | ms | 5.06 ms <br><sub>p50 5.08 ms · p95 5.28 ms · n=5</sub> | 18 ms <br><sub>p50 19 ms · p95 19 ms · n=5</sub> | 28 ms <br><sub>p50 29 ms · p95 30 ms · n=3</sub> | 55 ms <br><sub>p50 58 ms · p95 58 ms · n=2</sub> |
| `coldopen.reviveOps` | ms | 5.41 ms <br><sub>p50 5.53 ms · p95 6.09 ms · n=5</sub> | 14 ms <br><sub>p50 16 ms · p95 17 ms · n=5</sub> | 21 ms <br><sub>p50 23 ms · p95 23 ms · n=3</sub> | 46 ms <br><sub>p50 48 ms · p95 48 ms · n=2</sub> |
| `coldopen.normalizeLedger` | ms | 0.010 ms <br><sub>p50 0.011 ms · p95 0.082 ms · n=5</sub> | 0.013 ms <br><sub>p50 0.013 ms · p95 0.111 ms · n=5</sub> | 0.015 ms <br><sub>p50 0.016 ms · p95 0.092 ms · n=3</sub> | 0.019 ms <br><sub>p50 0.074 ms · p95 0.074 ms · n=2</sub> |
| `coldopen.repersist` | ms | 321 ms <br><sub>p50 337 ms · p95 370 ms · n=5</sub> | 966 ms <br><sub>p50 1.06 s · p95 1.09 s · n=5</sub> | 1.79 s <br><sub>p50 1.85 s · p95 1.85 s · n=3</sub> | 3.50 s <br><sub>p50 3.57 s · p95 3.57 s · n=2</sub> |
| `coldopen.total` | ms | 419 ms <br><sub>p50 429 ms · p95 462 ms · n=5</sub> | 1.22 s <br><sub>p50 1.35 s · p95 1.36 s · n=5</sub> | 2.23 s <br><sub>p50 2.29 s · p95 2.30 s · n=3</sub> | 4.43 s <br><sub>p50 4.49 s · p95 4.49 s · n=2</sub> |
| `coldopen.wastedShare` | ratio | 0.78 | 0.80 | 0.81 | 0.81 |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Times are min, with p50/p95 beneath._

## 4. Op batch vs the relay cap

| Metric | Unit | 1y/2a | 3y/2a | 5y/2a | 10y/2a |
|---|---|---|---|---|---|
| `batchcap.maxOpsUnderCap` | ops | 546 | 546 | 546 | 546 |
| `batchcap.b64AtMax` | chars | 511.3 k | 511.8 k | 511.8 k | 511.8 k |
| `batchcap.ciphertextB64PerOp` | ratio | 936.5 | 937.4 | 937.4 | 937.4 |
| `batchcap.bytesPerOp` | ratio | 702.4 | 703.0 | 703.0 | 703.0 |
| `batchcap.maxOpsUnderChunkBudget` | ops | 535 | 535 | 535 | 535 |
| `batchcap.sealOpBatch.fullLog` | ms | 43 ms <br><sub>p50 50 ms · p95 54 ms · n=3</sub> | 124 ms <br><sub>p50 125 ms · p95 139 ms · n=3</sub> | 204 ms <br><sub>p50 208 ms · p95 233 ms · n=3</sub> | 439 ms <br><sub>p50 447 ms · p95 519 ms · n=3</sub> |
| `batchcap.b64AtScale` | chars | 3.43 M | 10.06 M | 16.69 M | 33.28 M |
| `batchcap.overCapRatioAtScale` | ratio | 6.70 | 19.6 | 32.6 | 65.0 |
| `batchcap.chunksForFullLog` | count | 7 | 21 | 34 | 67 |
| `batchcap.opsPerDay` | ratio | 10.0 | 9.77 | 9.73 | 9.69 |
| `batchcap.daysOfHistoryPerDeposit` | ratio | 54.5 | 55.9 | 56.1 | 56.3 |

_Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device. Times are min, with p50/p95 beneath._

## What this does NOT measure

- **Hermes.** Every number is V8. The audit puts Hermes at 3-15x slower and the multiplier varies per operation (string building and pure-JS crypto are worst). Nobody should quote a millisecond from this document as a device millisecond. An on-device harness would need product source this stage does not own.
- **The SQLite journal branch of cold open** (`resolveLedgerOps`, engine.ts:444-458). The only off-device driver is `__tests__/helpers/fake-sqlite-driver.ts`, whose `hasOperation` is `Array.some` and whose `insertOperation` adds a second linear scan; rehydrating tens of thousands of ops would measure the fake's O(n^2), not the product. `coldopen.total` is the snapshot path ONLY.
- **Real Ed25519 signing and verification.** Op signatures in the corpus are 64 pseudo-random bytes: correct for size and for the persist/batch paths, but this harness says nothing about verify cost — which Stage 5's bootstrap decision needs (the audit estimates 83 s of blocked Ed25519 for ~40,000 ops).
- **The 4-member household.** The audit quotes 11,833 rows at 5y/2 adults and 24,703 at 5y/4 members. No linear composition satisfies both with a non-negative fixed term (it implies F = -1,037). The generator reproduces the 2-adult reference exactly and yields 22,655 at 4 adults. Any 4-member column is generator-derived and needs a product call before it is cited as the audit's figure.

## How to re-run

```sh
scripts/e2e/lib/budget-scale-bench.sh guard      # cheap correctness guards
scripts/e2e/lib/budget-scale-bench.sh baseline   # full run + regenerate this file
scripts/e2e/lib/budget-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl
```

`compare` exits non-zero on a >10% time or >1% byte regression against `budget-local-first-scale-baseline.json`. That exit code is how Stages 1-5 are judged.

