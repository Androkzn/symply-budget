# Budget V2 local-first — scale harness

The evidence Stages 1–5 of
[budget-local-first-scale-audit.md](../../../../documents/engineering/budget-local-first-scale-audit.md)
are graded against. Its caveats have to travel with it, so they live here and in
the generated baseline, not in one agent's context.

Baseline output:
[documents/engineering/testing/budget-local-first-scale-baseline.md](../../../../documents/engineering/testing/budget-local-first-scale-baseline.md)
(+ `.json`, the machine-readable diff target).

## Commands

```sh
scripts/e2e/lib/budget-scale-bench.sh guard        # cheap guards (also in `npm test`)
scripts/e2e/lib/budget-scale-bench.sh typecheck    # tsc; fails only on __tests__/scale/ errors
scripts/e2e/lib/budget-scale-bench.sh run          # measure, write JSONL
scripts/e2e/lib/budget-scale-bench.sh baseline     # run + regenerate the committed baseline
scripts/e2e/lib/budget-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl
```

`compare` exits non-zero on a regression beyond tolerance. That exit code is the
point of the whole harness, so it is worth being precise about what can fail it:

| Failure | Why it is a failure |
|---|---|
| a metric moved past tolerance **in its declared bad direction** | time >10%, bytes/chars >1%, ops/count/ratio >1%. Every metric carries `dir` (`lower`/`higher`/`flat`), because `chunksForFullLog` going up and `maxOpsUnderCap` going up are opposite events |
| a baseline metric is **missing from the run** | the OOM / crashed / silently-deleted case |
| the driver recorded a **crashed** phase | a crashed column is a gap, not a zero |
| a metric carries **no `dir`** | a metric nobody declared a polarity for cannot be graded, so it fails rather than passing quietly |
| the run's **corpus fingerprint** differs from the baseline's | different corpus, not a slower one |

None of that was true of the first version: it could not fail on a crashed
phase, on a vanished metric, on any `ops`/`count`/`ratio` metric (56 of the 192
baseline metrics, including every number that answers "does sync still work"),
on a collapse in a higher-is-better metric, or on a 10x `apply.*` regression —
it read `apply.*` at `min`, where min is the luckiest sample of a linear scan
and is scale-invariant noise. `report.test.ts` has one test per hole.

`--emit-baseline` **refuses to publish** a capture taken above the load gate,
one containing a crashed phase, or one with no corpus fingerprint.
`--allow-unclean-baseline` (or `SCALE_ALLOW_UNCLEAN_BASELINE=1`) publishes it
anyway, stamped `gate.usable: false`, and `compare` then refuses to grade
timings against it and says so in a banner.

## Layout

| Path | What |
|---|---|
| `phases/*.scale.ts` | the four measurements. `.scale.ts`, NOT `.test.ts` — see below |
| `*.test.ts` | cheap guards, deliberately picked up by the package's normal `npm test` |
| `lib/ledger-factory.ts` | the pinned corpus, including its LWW watermark map and its fingerprint |
| `lib/oplog-factory.ts` | real sealed op payloads, one device per member, one member offline |
| `lib/mirror.ts` | verbatim copies of product functions this package cannot import |
| `lib/batch-cap.ts` | cap search over the REAL `sealOpBatch` |
| `lib/measure.ts` | stats, env capture, load gate |
| `lib/record.ts` | fsync'd JSONL |
| `vitest.scale.config.ts` | the only config that picks up `*.scale.ts` |

**Why `.scale.ts`.** `packages/local-first` has no vitest config, so `npm test`
uses the default include `**/*.{test,spec}.?(c|m)[jt]s?(x)`. A phase named
`*.test.ts` would be swept into the ordinary suite, where a ten-year persist
takes tens of seconds and can OOM. The guards keep `.test.ts` on purpose.

**Why one process per phase × scale.** The audit recorded an OOM at a 4 GB heap.
When a child dies without writing its terminal `end` record, the driver appends
a `status:"crashed"` row itself, so "it OOMs at 10 years" is a reportable result
rather than a lost afternoon.

## What each phase measures

| Phase | Requirement | Notes |
|---|---|---|
| `edit` | single-field edit end to end | capture → diff → `persist()` serializer → utf8 → AEAD → hex, plus base64 of the same buffer as the Stage 1 target. Reports write amplification as one figure, which nothing else did. |
| `apply` | `applyLedgerDelta` throughput | patch / create / bulk-200 / delete-1 / delete-200 / losing-concurrent-write / orphan-park. `createScanCursor.remove` rebuilds the whole table array **per key**, which is why delete-1 is here; delete-200 is MEASURED rather than multiplied, because `planTableStrategy` routes any delta touching >= `LEDGER_INDEX_THRESHOLD` (16) rows to `createIndexedCursor` — one slice, one Map, one `filter` at flush. The earlier `apply.delete200.projected` (p50(delete1) x 200) assumed the scan path and overstated the real cost by more than an order of magnitude. |
| `coldopen` | cold open | every step of `openLocalBudgetSessionInner`'s snapshot path separately, including the double `JSON.parse` (engine.ts:563 and :581) and the trailing re-`persist()` (engine.ts:638). |
| `batchcap` | op batch vs the relay cap | real `sealOpBatch`, real `MAX_MAILBOX_CIPHERTEXT_B64`, binary search for the largest fitting op count. |

## Mirrored product functions

`engine.ts` imports `@api/*` and `persistence.ts` imports `@services/storage`;
neither alias resolves outside the mobile tsconfig, so neither module loads from
this package at all. `projection.ts` is reachable only because its one import of
engine.ts is `import type` (projection.ts:39), erased at runtime.

`lib/mirror.ts` therefore copies:

| Mirror | Source |
|---|---|
| `serializeLedgerForPersist` | `engine.ts` `persist()` :417-424 |
| `reviveOps` | `engine.ts` :428-436 |
| `normalizeLedger` | `engine.ts` :215-241 |
| `sealSnapshot` | `persistence.ts` `saveEncryptedSnapshot` :44-51 |
| `openSnapshot` | `persistence.ts` `loadEncryptedSnapshot` :33-42 |

`mirror-guard.test.ts` pins the sha256 of each original's normalized source.
**Stage 2 will make it fail by design.** When it does: re-mirror, re-pin, and
**re-take the baseline** — numbers from a different write path are not
comparable and must not be diffed.

The permanent fix is Stage 2 exporting a real serializer from a module free of
React Native imports; then `mirror.ts` imports it and the guard is deleted.

## The corpus is a household that has SYNCED

Two properties that are easy to get wrong and that change every number here:

- **The LWW watermark map is populated.** One `encodeStamp` per field per row —
  162,129 stamps at the 5y/2a reference, 9.5 M chars, about 70% of the row JSON
  and a third of the whole snapshot. `lww: {}` is the one value a household that
  has ever synced definitely does not have, and with it the baseline understated
  every persist / AEAD / hex / cold-open figure by ~1.5x (1y `serialize.json.chars`
  4.03 M -> 5.99 M). It is also audit finding **C18** — "the map outgrows the data
  it describes" — which is OPEN and which this harness exists to grade: with an
  empty map, a Stage 2/4 compaction of it would have measured as zero improvement.
- **The op log is multi-device.** One device per member, `seq` counted per device,
  and the last member is OFFLINE: its ops are stamped with a wall clock 30 days
  behind, so the log is interleaved rather than monotonic and an op below the head
  exists at all. That is the case the audit's central claim is about, and it is
  also what makes `senderVersionVector` in the batch header the real shape instead
  of a one-entry map.

Still NOT modelled inside the map: `del` tombstone stamps for deleted rows, and
`p` parked orphan patches. Both only ADD, so the corpus is a floor.

## What this does NOT measure

- **Hermes.** Everything here is V8. The audit puts Hermes at 3–15× slower and
  the multiplier varies per operation. No millisecond in the baseline is a
  device millisecond.
- **The SQLite journal branch of cold open** (`resolveLedgerOps`,
  engine.ts:444-458). The only off-device driver is
  `__tests__/helpers/fake-sqlite-driver.ts`, whose `hasOperation` is
  `Array.some` and whose `insertOperation` adds a second linear scan;
  rehydrating tens of thousands of ops measures the fake's O(n²). `coldopen.total`
  is the snapshot path **only**, and is therefore an understatement.
- **Real Ed25519.** Op signatures are 64 pseudo-random bytes — correct for size
  and for the persist/batch paths, silent about verify cost, which Stage 5's
  bootstrap decision needs.
- **Op-size growth with corpus age.** Payloads come from a 64-entry pool of real
  sealed single-field-edit payloads, so bytes-per-op is flat across scales by
  construction. Real logs contain bulk ops with far larger deltas;
  `batchcap.bytesPerOp` is a floor, not a distribution.
- **Sync itself.** No relay, no chunk round trip, no second device applying what
  a first one produced. `batchcap` measures what a batch COSTS, not whether it
  arrives; `apply` measures the merge under a populated watermark map, including
  the losing-concurrent-write and orphan-park branches, but nothing here
  exercises delivery, acking or the mailbox cursor.
- **`randomBytes` above 64 KiB.** `crypto/bytes.ts:6` throws
  QuotaExceededError there (`crypto.getRandomValues` caps at 64 KiB and there is
  no chunking). Latent in product code today. The harness uses a seeded PRNG, as
  the existing hot-path bench already had to.

## Environment rules

- The load gate refuses to record above `loadavg[0]` 3.0. This checkout runs
  concurrent agent sessions and read 5–7 while the harness was being built; a
  baseline taken then is noise wearing a table.
- `SCALE_ALLOW_LOAD=1` overrides it, stamps every record, and puts a warning
  banner in the generated markdown. Use it to iterate, not to publish.
- `min` is the headline for most metrics; `p50`/`p95` are printed beneath. Stage 0
  had to retract a 2.8× encoder claim that was a GC-inflated p50.
- Every `apply.*` time is graded at **p50**, not min — each sample walks a
  different prefix of a linear scan, so min reports the luckiest one. The
  committed baseline shows why: `apply.patch1` min sat at ~0.002 ms from 1 to 10
  years while p50 went 0.011 → 0.080 ms. The statistic each metric is graded on
  travels ON the record (`stat`), so the comparator cannot pick the wrong one.
- Publishing a baseline is gated, not just banner-warned: see the table above.

## Environment variables

| Var | Meaning |
|---|---|
| `SCALE_YEARS` | corpus years (default 5) |
| `SCALE_ADULTS` | corpus adults (default 2) |
| `SCALE_SEED` | generator seed (default `0x5c41e`) |
| `SCALE_OUT` | JSONL output path (stdout when unset) |
| `SCALE_RUN_ID` | run identifier stamped on every record |
| `SCALE_ALLOW_LOAD` | `1` to override the load gate (iterating, not publishing) |
| `SCALE_ALLOW_UNCLEAN_BASELINE` | `1` to publish a baseline the gate refuses |

---

# Symply House V2 local-first — scale harness (plan stage H10)

Same driver shape, same recorder, same comparator. Run it with
`scripts/e2e/lib/house-scale-bench.sh`; it publishes
[documents/engineering/testing/house-local-first-scale-baseline.md](../../../../documents/engineering/testing/house-local-first-scale-baseline.md)
(+ `.json`).

```sh
scripts/e2e/lib/house-scale-bench.sh guard       # cheap guards (also in `npm test`)
scripts/e2e/lib/house-scale-bench.sh run         # measure, write JSONL
scripts/e2e/lib/house-scale-bench.sh baseline    # run + regenerate the committed baseline
scripts/e2e/lib/house-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl
```

## What is shared, and what is not

| Piece | House |
|---|---|
| `lib/record.ts`, `lib/measure.ts`, `lib/batch-cap.ts` | **shared verbatim** — no brand in them |
| `lib/corpus-core.ts` | **new, shared-by-design** — PRNG, watermark-map builder, clone, bulk-delete, all generic over a registry |
| `lib/house-ledger-factory.ts` | House's 21 Wave-A tables, composition and row factories |
| `lib/house-oplog-factory.ts` | House op vocabulary; imports the byte utilities from `oplog-factory.ts` |
| `lib/house-phase.ts` | House corpus sizing + fingerprint |
| `phases/house-*.scale.ts` | four phases |
| `budget-scale-report.mjs` | shared; `--label` / `--driver` swap the prose, and the defaults still render Budget's document byte-for-byte |

`ledger-factory.ts` keeps its own copies of the generic helpers on purpose — see
the header of `corpus-core.ts`. Budget has a **published** baseline whose
identity is a hash of its generated corpus, and editing that file to share code
would invalidate every committed Budget number. Budget adopts `corpus-core` the
next time it re-baselines.

## House numbers are NOT comparable with Budget's

Two independent reasons, either of which is sufficient:

- **Different corpus.** Different tables, different composition, different seed,
  different fingerprint. `compare` refuses to grade across fingerprints, which
  is the mechanism that enforces this rather than a note asking politely.
- **Different cold-open algorithm.** Budget's `coldopen` phase replays its
  legacy MMKV snapshot path — one giant blob, hex at rest, a double `JSON.parse`,
  `reviveOps`, a trailing re-persist. House has none of that: it was written on
  per-row AEAD storage from day one, so `house-coldopen` measures
  `listRows → openRowBody → JSON.parse → installRowEnvelopes`. Copying Budget's
  phase would have measured a code path House does not contain.

## What the House phases add

| Phase | House-specific content |
|---|---|
| `house-edit` | the common edit (`maintenanceCompletions`) **and** the wide-row edit (`tasks`, ~41 populated fields), plus `edit.lww.*` — the **N5 decision input** (plan §1.6): the watermark map measured against the row data it describes |
| `house-apply` | adds `apply.patch1.wideRow`, because a 41-field row makes each merged patch walk a longer field loop |
| `house-coldopen` | the per-row AEAD hydration path, with `coldopen.cpu` (decrypt + parse + install) as the number to quote and `coldopen.usPerRow` for projecting other corpus sizes |
| `house-batchcap` | identical machinery; the answer differs because House writes more ops per day at the same age |

## What this does NOT measure (House-specific additions to the shared caveats)

- **The SQLite read itself.** `coldopen.listRows` runs against
  `MemoryLocalFirstStore`, not `SqliteLocalFirstStore`, and is reported
  separately for exactly that reason. Quote `coldopen.cpu`.
- **Multiple properties.** The engine holds one ledger per property, so a second
  property is a second ledger, not more rows in this one. Generating 3× rows into
  a single ledger would misrepresent the row-key space and flatter every lookup.
  The baseline states the multiplier as declared arithmetic; H5 turns it into a
  measurement.
- **Hermes.** Everything here is V8. The 3–15× multiplier and the on-device
  anchor requirement carry over unchanged.

---

# Symply Health V2 local-first — scale harness (plan stage He10)

Same driver shape, same recorder, same corpus primitives. Run it with
`scripts/e2e/lib/health-scale-bench.sh`; it publishes
[documents/engineering/testing/health-local-first-scale-baseline.md](../../../../documents/engineering/testing/health-local-first-scale-baseline.md)
(+ `.json`).

```sh
scripts/e2e/lib/health-scale-bench.sh guard       # cheap guards (also in `npm test`)
scripts/e2e/lib/health-scale-bench.sh run         # measure, write JSONL
scripts/e2e/lib/health-scale-bench.sh baseline    # run + regenerate the committed baseline
scripts/e2e/lib/health-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl
```

## What is different about Health, and why

| Piece | Health |
|---|---|
| `lib/record.ts`, `lib/measure.ts`, `lib/batch-cap.ts`, `lib/corpus-core.ts` | **shared verbatim** — no brand in them |
| `lib/health-ledger-factory.ts` | the 8 Wave-A tables, generated **per day** rather than from a per-year composition table |
| `lib/health-oplog-factory.ts` | Health op vocabulary; ONE user, TWO devices; `checkpointTail()` |
| `lib/health-home-loaders.ts` | the seventeen `load*()` of `HealthHomeScreen.tsx:198-219`, modelled against the ledger |
| `lib/health-thresholds.ts` | the plan's normative fail table, as code that FAILS |
| `phases/health-*.scale.ts` | four phases — `coldopen`, `homehydrate`, `edit`, `apply` |
| `health-scale-report.mjs` | Health's own renderer; the shared one still emits the `.json` |

**The corpus is day-driven, not composition-driven.** House and Budget size with
`rows = fixed + adults*perAdult + years*perYear + …`, which is right for a
household's independent per-year rates. Health is a DIARY: the structure that
decides every number is INSIDE the day — two weigh-ins on some days (the S3a
case that keeps `weight_entries` on random ids), 4–6 sips, 3 meals plus snacks,
steps + sleep + workout all in `health_entries` behind one `entry_type` column.
`planDays()` is the single source both `rowCounts()` and generation read, so the
counts can never disagree with the rows.

**One user, two devices — not two members.** A Health household is personal
(plan §1.2) and He5's control plane refuses a second `user_id`. `adults` is
pinned at 1 by the factory; the interleaved op log comes from the SECOND DEVICE,
whose clock is 30 days behind. `--adults` is deliberately absent from the driver.

**A fifth phase in spirit: `homehydrate`.** Plan §4 — "measure the read path,
not just the write path". House shipped H10 owing exactly this ("the harness
measures the projection directly, not through the facades"), so Health measures
the 17-way `Promise.all` before He3 starts. Four of the seventeen are MMKV, not
ledger, and are modelled as such: the fan-out resolves at its slowest member, so
dropping them would report a 13-loader screen that awaits seventeen.

## Health's phases ASSERT, they do not only print

`lib/health-thresholds.ts` encodes the plan's Exit table and the phases call
`assertExitChecks()` — **after** `recorder.end()`, so a breach is a red baseline
with a complete record set rather than a crashed phase with a hole in it. The
gate runs on the **10-year** corpus only, at the **optimistic** end of the
audit's 3–15× Hermes band: a breach at ×3 fails even if Hermes turns out to be
at its friendliest, and is therefore unambiguous. A pass at ×3 is **not** a pass
at ×15; the baseline prints both columns and says so.

## What this does NOT measure (Health-specific additions to the shared caveats)

- **React.** `coldopen.toFirstPaint` ends when the 17-loader `Promise.all`
  resolves. The state commits and the render pass after it are real cost this
  harness cannot reach from Node, so first paint is a floor before Hermes.
- **The real `load*()` functions.** Every one imports `@api/health` and
  `@services/storage`, and today they read an MMKV cache the network filled.
  Measuring those would measure the cache. They are re-expressed as the ledger
  reads He3 turns them into, each citing the function it models.
- **The full-log replay.** With checkpoints ON a cold open replays only the
  unpublished tail; `coldopen.fullLogReplay.projectedMs` is declared arithmetic,
  not a measurement.
- **Hermes.** Everything here is V8. ⚠️ The on-device anchor the plan's He10 DoD
  requires is **still owed** and no He3 perf claim may cite this harness as
  device evidence until it exists.
