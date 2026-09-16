# Implementation Plan — Symply Health V2 local-first

**Version:** v1.8 · **Owner:** engineering · **Branch:** `health-v2`
**Updated:** 2026-08-14 · **Area:** FE + BE (`@symply/local-first`, Health brand, shared Worker control plane)
**Priority:** P0 for the architecture decision; P1 for Wave A delivery
**Status of this document:** 🟢 **as-built engine + cutover** — not `ready`. Wave A ledger, sync **and the He3 storage cutover** are on `health-v2`: the Proxy is installed on `src/api/health.ts`, all eight `local*Api` facades exist, `windows.ts` is registered, and `apiParity` is green **both directions**. He7-lite is **wired**, not authored-and-unwired. On a flag-1 build the ledger is SoT; every shipped binary is flag-0 (`eas.json` now pins `=0`), so D1 remains SoT in production. Status stays **not ready** until: the He12(partial) two-device suite is **executed** (25 flows authored, **not yet run**), the He10 baseline is re-taken on a quiet machine and its **four breached thresholds** are closed or Wave C descoped, and **Q1 product countersign**.

**Location:** `documents/requirements/Health v2/` (canonical).

**Pack:** [README](./README.md) · [Stages He0–He12](./Symply_Health_V2_Implementation.md)

**Pattern source (proven):**
[budget-local-first-implementation-plan-v2.md](../Buget%20v2/budget-local-first-implementation-plan-v2.md) v3.2
· [house-local-first-implementation-plan.md](../House%20v2/house-local-first-implementation-plan.md) v2.2
· [BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md)

**Goal:** a local-first Symply Health that stays correct and fast for **one person × 1–3 devices**
across **5–10 years** of logs, on Hermes — reusing the Budget/House engine verbatim and paying
only for what Health genuinely does not share: **personal (not household) membership**,
**HealthKit as an ingest adapter**, **on-device summaries** (today they are server-computed),
**cycle / vitality / injury sensitivity**, and **encrypted media** when photos ship.

**How to read this.** Every Budget/House stage Health inherits is marked ♻️ **inherited**.
Every Health-only stage is marked 🆕. Status: ✅ shipped · 🟢 as-built · 📐 design.

**Regulatory framing (not HIPAA ≠ no duties).** Default model: consumer wellness app, not a
HIPAA covered entity. Still subject to the **FTC Act** and the **Health Breach Notification
Rule** for consumer health information and vendor metadata (mailbox timestamps, device ids).
Privacy copy: “we cannot decrypt your ledger,” not “no cloud / no duties.” Control-plane
metadata is **not** zero-knowledge.

---

## Revision History

| Ver | Date | Changes |
|-----|------|---------|
| v1.8 | 2026-08-14 | As-built recount vs `health-v2` code. **Not 100%.** He0–He2/He4/He5/He8 🟢 (code); He7-lite summaries **authored, unwired**; He3/He10/He12 📐. House H6 ✅ (`0157`). Worker second-`user_id` reject still missing. Brand default in `flag.ts` is **on** when unset — pin `=0` until He12 (full). Live `/v2` proof + Q1 still open. Docs no longer say “no Health ledger code”. |
| v1.0 | 2026-08-13 | Initial plan from Budget/House as-built + Health D1/outbox/HealthKit tree |
| v1.1 | 2026-08-13 | Review-plan Cycle 1: status=`design`; Q1 blocks truncate; He7-lite hard He3 exit; He6 blocked on House H6 DoD or Health-owned MVP; blobs ≥**0157** (`0156` = device PK); kill-switch + rollback + 410 windows; widget/truncate freeze; Wave A = **8 D1 tables**; water HK `source` gap; MMKV refresh; monitoring; Keychain reinstall / WAL / HK anchors; FatSecret meal-string threat; personal-HH no second member; DO hibernation smoke |
| v1.2 | 2026-08-13 | Cycle 2: **14 dashboard rows** (He7-lite named); `He12(partial)` vs full; notes stay MMKV in He3; flags in handoff; widget never-list includes vitality; staging-only `/v2` proof before `deploy:fleet`; TS strict on He1/He3; HK Swift-owned completion after **native staging write + anchored fetch** (JS drain must not own the handler); SQLite `-wal`/`-shm` teardown; widget write-time protection; HBNR appendix |
| v1.3 | 2026-08-13 | Cycle 3: split dashboard **He12(partial)** vs **He12 (full)** (15 rows; brand default-on is **not** a Wave A Exit); Constants/handoff blob ≥0157 + Wave A 8; HBNR legal gate on handoff; FTC <500 annual notice; He11 register-at-launch + He6 multipart on handoff |
| v1.4 | 2026-08-13 | Cycle 4: §14 truncate **after** He12(partial) E2E (D1 still SoT during partial); Q1/widget freeze/truncate/HBNR/default-on are **He12 (full)** only; bare “He12” disambiguated |
| v1.5 | 2026-08-13 | Cycle 5: post-truncate two-device E2E **before** brand-default-on; same-commit Worker Version ID is **He12(partial)** (not re-owned by full); handoff §6 truncate after partial |
| v1.7 | 2026-08-13 | Cycle 7 (delta-safety + recount + doc-research on v1.6). Five merge-blockers found in v1.6's own edits: **§1.7a fail-closed is now a three-commit ordered change** — `wrangler.budget.toml` sets `LOCAL_FIRST_API_ENABLED` nowhere, so flipping the shared gate first 404s Budget's certified `/v2` in both envs **and** stops the cron mailbox/checkpoint TTL sweeps (`scheduled.ts:226`) that Appendix C.1 pins by test. **§2 item 10** adds the `health_flag0_mutation` counter — step 10b(iii) had no data source at all (the request logger is `ENVIRONMENT === 'development'`-only, so a zero read as proof and would authorize an irreversible truncate). **§2 item 4c** — dropping `excludeUserId` is call-site-asymmetric: `/sync-wake` (`local-first-v2.ts:670`) has no `excludeDeviceId` and would self-wake in a loop. **§7** refresh contract gains `'ingest'` and **session-lifecycle notify** (House notifies at nine sites; only `:352` is the delta path — v1.6's "once per applied delta" dropped cold-start and HealthKit refresh). **§1.5a** classifies ~10 previously-unclassified user-authored tables (food challenges ×4 + `exercise_favorites`, `activity_notification_preferences`, `body_comprehensive_insights`, `health_coach_consent_receipts`, …). Also: Wave A **GET** now 410'd (a fall-through GET silently overwrites the MMKV mirror); app wiring moved to **§5.1** (He2/He4 owns it, not He3); kill-switch order inverted (EAS Update first — reverting the 410 does nothing for a correctly-built flag-1 client); Q3a ships Option A's default rather than stranding He3a–c; `registryGuard` parameterised by wave (He11b adds four `unique()` Wave C tables); He3 DoD tagged per merge; §0 arrow reconciled with the table; `health_weekly_weight_averages` added to the truncate set; three line-ref drifts corrected. **Official-doc corrections:** `.privacySensitive()` does **not** get `.privacy` automatically — WidgetKit's lock-screen default is **unredacted**, user opt-in, so the write-boundary allowlist is the only control; the 64-notification overflow **is** documented (keeps the **soonest-firing** 64, discards the furthest-out); D1 Time Travel is a **whole-database destructive overwrite**, not a per-table undo, and SQLite has no `TRUNCATE`; the HBNR safe harbor is now stated as *designed to meet*, not *exceeds*, with counsel confirmation required; Flo/Meta has **no damages awarded** and $5,000 is per-violation; MHMDA has **no standalone PRA** (CPA route, *Hangman Ridge* elements) and consent is one of two bases; Nevada is **$15,000** and not AG-only; MODPA's Apr 2026 is applicability, not enforcement; Play's health declaration is **already in force** (30 Oct 2025), not 28 Jan 2026; "Menstrual Cycle Phases" is a **Play policy category**, not a Health Connect type; Jazz's E2EE product is now "Classic" and mainline 2.0-alpha advertises no E2EE, so §18 rejects it on **vendor churn**, not reuse; HealthKit access is relinquished **~10 min after** lock (probe, don't assume) and HK **writes** still succeed while locked; `WHEN_UNLOCKED_THIS_DEVICE_ONLY`'s effect is **backup-restore exclusion**, not iCloud-sync blocking |
| v1.6 | 2026-08-13 | Cycle 6 (3-agent: codebase / safety / official-docs). **§1.3a data continuity** — flag-1 starts empty and post-truncate `readThrough` destroys the flag-0 MMKV mirror. **§14 step 10b** flag-0-cohort proof; truncate set narrowed to the **8 Wave A tables** (Wave C has no ledger until He11b); **10a** re-record Version ID if the widget freeze is a Worker change. **§1.7a fail-closed `/v2`** + `LOCAL_FIRST_API_ENABLED` out of `[vars]`. **§2** 410 gate is a **reject-list**, method-gated, registered before `index.ts:265`; push wake is **4 sites** incl. `excludeUserId` (which excludes every device in a personal household); hibernation dropped as a He0 gate. **§1.5** deterministic ids = `habit_logs` + `health_goals` only (**not** weight). **§7** refresh contract specified (no listeners existed); read windows; He3a–d merge split; **§7.1** app wiring. **§9** widget file-protection contradiction → Q3a; `getAllScheduledNotificationsAsync()`. **§4** numeric thresholds. DoDs added for He2/He4/He8/He12. **§14.1** rollback rows + Return-to-D1 + D1 Time Travel. **Appendix C.1/C.2** residual-E2EE table + enforcement tests + state law. **Appendix D** glossary; `O12` deleted |

---

## 0. Status dashboard

**15 dashboard rows** — He0–He12 plus **He7-lite** as a named Exit of He3, plus **He12 split** into (partial) vs (full). He10 listed before He3 on purpose. Numeric ids remain He0–He12.

| Stage | Scope | Kind | Status | Blocking dependency |
|---|---|---|---|---|
| **He0** | Enablement: `/v2` proof, DO comment, kill switch, wake type, 410 **unarmed** | 🆕 config | 🟢 as-built | 410 reject-list, fail-closed, `/v2` rate limit, `health_sync_wake`, `health_flag0_mutation`, flag tests. **Closed since v1.8:** live 401-vs-404 recorded (Budget staging + prod both **401**, `scripts/health/verify-v2-fail-closed.sh`); `LOCAL_FIRST_API_ENABLED` out of all nine `[vars]` and into secrets; **all four** comment sites + the House plan row corrected, guarded by `local-first-comment-sites.test.ts`; item 6 grep gate added (`noRealtimeTransport.test.ts`). ⚠️ **New:** the header was only ever spread on `/v2`, so the 410 gate was **inert for `/health/*`** — now armed by `ensureHealthLocalSession` + the `client.ts` interceptor. **Still open:** Version ID at deploy time, **Q1 before any truncate** |
| **He1** | Ledger core: Health registry + engine + session (**8** Wave A tables) | ♻️ + 🆕 | 🟢 as-built | He0 — `src/features/health/local/` registry + `createLedgerProjection` + `registryGuard` + `ids.ts` |
| **He2** | Row storage + DEK + Keychain reinstall sweep + SQLite file protection | ♻️ + 🆕 | 🟢 as-built | He1 — `symply-health-local-first.db` + `health.localFirst.dek.v1`; WAL/SHM teardown tested |
| **He10** | Scale harness + Health corpus + fail thresholds | ♻️ harness, 🆕 corpus | ❌ **RED — descope Wave C** | Final clean run `health-20260815T030349Z-98007`, loadavg 2.11, gate NOT overridden, all 12 phase×scale combos `ok`. **4 of 6 still FAIL** after mitigations: cold open **6.20 s** p50 (fail >3.0) · **6.46 s** p95 (fail >5.0) · meal `mutate` **284 ms** p95 (fail >250) · `applyLedgerDelta` **593 ms** p95 (fail >500). Homehydrate (13 ms) and disk (62.64 MiB) PASS. **Root cause is not the bytes — it is 66,067 per-row AES-256-GCM opens in pure JS** (`@noble/ciphers`), **86.2%** of first paint; ~25% of per-row AEAD cost is per-call setup, and sealing *empty* envelopes still burns 71% of the p50 budget. **Shipped:** an opt-in `compactLww` codec (stamp + author interning, field grouping) — first paint 2.32→**2.07 s**, disk 74.50→**62.64 MiB**; Budget/House unaffected (House baseline **68/68 metrics bit-identical**, 84 suites / 1257 tests green). **Column pruning proven incapable, not merely unhelpful:** deleting the ENTIRE watermark map — strictly more than any interning/pruning/grouping can achieve — still misses p50 by 5–25%. Per §4 this **descopes Wave C**. ⚠️ **Harness fidelity bug:** `corpus-core.ts:buildLwwMap` mints a distinct HLC per *field*, but `projection.ts` writes one encoded stamp per *op* across every field it touched. Byte counts stand; **distinctness — the only thing interning exploits — is overstated**. Corrected in memory the same codec cuts plaintext 63.5% and first paint 43.8% — **still FAIL** (3,914 ms ×3). Generator deliberately unchanged: it would re-fingerprint a gated artefact, and neither reading passes |
| **He4** | Sync client (mailbox, HDK, checkpoints) — **no SSE** | ♻️ | 🟢 as-built (**was wholly non-functional**) | Orchestrator / HDK / mailbox in tree; no EventSource, proven by grep gate. ⚠️ **Two independent defects meant this stage had NO working path despite being marked as-built.** (1) Nine imports named House-shaped exports Health never had (`ackMailboxBlobs`, `depositMailboxBlob`, `fetchMailboxBlobs`, `syncLocalHouseholdToControlPlane`, `installHouseholdKeys`, the four checkpoint fns) — Babel strips types, so they were `undefined` at runtime. (2) **`depositHealthMailboxBlob` took a `ciphertext` argument and never serialized it** — the body went out with a recipient and no payload, so the Worker's `ciphertextBase64: z.string().min(1)` (`routes/local-first-v2.ts:272`) would have **400'd every deposit**: every op batch and every HDK wrap alike. Nothing was red because no test read the posted body. Both fixed; guarded by `syncImports.test.ts` and by rotation tests that assert on the request body |
| **He8** | Checkpoint / bootstrap / catch-up | ♻️ | 🟢 as-built (**was broken**) | `sync/checkpoints.ts`. Same dead-import class as He4, plus two real signature bugs: chunks were **double-base64'd** (`ciphertextBase64` where the client already encodes), so a published checkpoint could never be opened; and `rememberPublishedHealthCheckpoint` was passed a version vector where it takes a **generation**, writing `[object Object]` into the meta key so compaction never advanced |
| **He5** | **Personal household** (one user, N devices; **no second userId**) | 🆕 | 🟢 as-built | `simplehealth://lf-invite` + “your other device” copy. Worker now refuses a second `user_id` with **403 `personal_household_single_user`**, brand-scoped via `APP_BRAND` so House/Budget multi-member enrolment is untouched, enforced **before any DO round trip**. The real hole was `POST /v2/…/invites/:id/claim` — the one `/v2` route that authorises no membership by design — not device registration. 16 tests, mutation-checked. **Client screen now exists too:** `HealthOtherDeviceScreen` + `app/lf-invite.tsx` deep-link route + a `YOUR DEVICES` row in More. It had been missing entirely — `HEALTH_ENROLMENT_COPY` was referenced only by a unit test and House's `screens/house-v2/enrolment/` had no Health counterpart, so **no user could enrol a second device and the He12 suite would have died at `td-02`**. Caught by `twoDeviceFlowSelectors.test.ts`, which now gates every flow selector against a real testID. **Device removal now exists too:** `sync/hdkRotation.ts` revokes on the control plane, rotates the HDK (retiring the old key into the bounded ring) and re-delivers to the devices that remain — **rotate-then-deliver**, because conditioning rotation on delivery lets a relay outage leave the household on the epoch the *revoked* device still holds, i.e. a cosmetic revoke; security must not fail open on a transport error. A durable queue plus `redeliverHealthHouseholdKey()` on the next sync recovers partial delivery. `HealthOtherDeviceScreen` renders the roster, requires a confirmation, and surfaces partial delivery as its own state rather than a flat "Done" |
| **He3** | Cutover storage → local repos | 🆕 volume | 🟢 as-built | Proxy on `src/api/health.ts` over `remoteHealthApi`; **eight** `local*Api` facades; `windows.ts` registry (28 entries, all 17 Home loaders); `apiParity.test.ts` green **both directions** with a written reason per remote-by-design method; export-before-upgrade CSV + first-launch copy; airplane-mode suites per table. `git diff --stat src/features/health/screens` is **empty**. `npx jest src/features/health` green with **and without** the flag |
| **He7-lite** | On-device summaries, reminders, widget glance | 🆕 | 🟢 wired | `localSummariesApi` serves all six summaries from the ledger; `summaryParity.test.ts` is a differential test against the **server's** implementation (90 tests + 5 mutation canaries proving the harness bites); six refresh-contract cases in `ledgerRefresh.test.ts`. Home/Trends needed **no** screen edits — no screen bypasses `healthApi`. The port found **zero** arithmetic defects in `summaries.ts` but **four real server-side bugs** (see §9 notes) |
| **He7** | Remainder (cycle predictions, BYOK coach) | 🆕 | 📐 | He3+He7-lite |
| **He6** | Encrypted blob channel | 🆕 Health client | 🟢 transport built | `blobs/{blobCrypto,blobTransport,healthBlobStore}.ts` — same wire protocol as House. Health-specific: **content-addressed id keyed under the HDK**, never a bare `sha256(plaintext)`, since `lf_blobs.blob_id` is stored clear in D1 and a bare hash restores the confirmation-of-file oracle `0157` deliberately removed. **Retired-key ring** in `engine.ts`: `installHealthHouseholdKeys` retires the outgoing HDK, persisted as `crypto.retiredHdksByEpoch` and **bounded** at `HEALTH_RETAINED_KEY_EPOCHS` (8) — House keeps every epoch; Health caps it because each retained key is another copy of something that decrypts the member's records. A read selects the HDK by the **descriptor's** epoch, so a blob sealed at epoch N opens after any later rotation; `HealthBlobKeyUnavailableError` now means only "this device never held that epoch, or it aged out". A reconcile pass is scheduled after a sync applies remote ops (`blobs/reconcileScheduler.ts`, debounced to 15 min, `releaseRemote` off). Wave D photo surface deliberately **not** built, and Wave D **must store a descriptor as a real field** — `collectHealthBlobRefs` does not parse strings and warns in `__DEV__` if one is encoded into a string column |
| **He9** | Backup / restore / export | ♻️ + Health redaction | 🟢 archive · ⛔ restore | Most of He9 already existed in the engine (`exportHealthCheckpointPlaintext`, `applyLocalHealthRestore` with D-20 live-wins, `installHealthCheckpointPlaintext`). Added `backupArchive.ts` (sealed via the **same** `sealCheckpoint` path He8 publishes with, under the existing HDK — **no new key material, so it decides nothing**) and `durability.ts` (device count + checkpoint state; `level` collapses to `'unknown'` when the control plane is unreachable rather than claiming safety from a cached hope). `restoreHealthLedgerFromArchive()` exists and **always throws** `HealthArchiveKeyingUndecidedError` — present-and-throwing so the blocker is read, not absent so it can be bypassed. 41 tests. ⚠️ **Q8 is narrower than it looks:** `@symply/local-first` already ships `createBackupArchive`/`openBackupArchive` (Argon2id + 12-word BIP39 phrase) and **House and Budget both use it** — that is option (a), already decided on two brands. Deliberately NOT adopted here; adopting it would answer Q8 by import |
| **He11** | Wave B HealthKit ingest + Wave C tables | 🆕 | 🟢 He11a · 📐 He11b | **He11a done:** the drain resolves its sink through `resolveHealthKitImportSink()` — ledger on flag-1 (steps/energy/sleep/HR + workouts → `localEntriesApi`, body mass → `localWeightApi`, macros → `localNutritionApi`), byte-identical API sink on flag-0. Baseline reads go through the **facades**, so the drain inherits the registered windows verbatim including the two deliberate quirks (weight 200 not 500; nutrition uncapped `callerRange`). Dedupe untouched — `healthKitIngest.ts` is an executor only. Bulk hooks added because `engine.ts:908-912` makes one-op-per-row quadratic: a 7-day × 5-type import is **3 ops, not 35**. 27 tests, incl. a background-sync case asserting **zero** `@api/client`/`fetch` calls while rows land in the ledger. ⚠️ **Water stays out of Wave B** — `water_entries` has no `source` column (§1.5 row 2), so an imported glass is indistinguishable from a typed one and "manual always wins" is unimplementable; needs a migration claimed on `main`. **He11b (Wave C) is descoped while He10 is red** |
| **He12(partial)** | Two-device E2E; **internal/lab flag-on**; brand default **off** | ♻️ harness | 🟢 authored · 📐 **not run** | 25 Maestro flows under `e2e/maestro/health-two-device/` covering all 8 Wave A tables, tombstone propagation, airplane→catch-up, push wake A→B and the no-invite-copy assertion; runner `run-health-two-device-sync-live-report.sh` resolves `Health-A`/`Health-B` from the registry and gates on the Worker Version ID postdating the client commit. **Executing it is the remaining Exit** — an authored suite is not a green suite |
| **He12 (full)** | Q1 + widget freeze + D1 snapshot/truncate + **post-truncate** two-device E2E + **brand-default-on** | ♻️ harness | 📐 | He12(partial) **and** Q1 **and** HBNR legal copy (Appendix C). Worker Version ID already recorded before partial |

```text
Wave A (core logs)     He0 → He1 → He2 → He4 → He5 ─┐
                                          └→ He8 ───┼→ He3+He7-lite → He12(partial)
                            └→ He10 ────────────────┘
                       (He10 gates He3; He8 gates He10's Exit NUMBERS — §4 measures
                        with checkpoints on, so a replay-from-zero run is provisional)
Wave B (HealthKit)     He11a — ingest as signed ops; background must not POST /health
Wave C (sensitive + food)  He7 remainder → He11b  (He6 unblocked — House H6 shipped; Health client not started)
Wave D (later)         body photos (needs He6), coach BYOK, social stays disabled
```

**He3 must not merge without He7-lite.** Throwing `HealthLocalUnsupportedError` on Home
summary methods is **not** an Exit. Widget may ship “dark” with in-product copy; Home/Trends
may not.

**Nothing in He3 should start before He10 has a Health baseline.**

**He10 is RED and Wave C is descoped — but the gate is reachable, via two levers §4 named and this
round was scoped out of.** ⚠️ **One of the two has since been IMPLEMENTED — see below; its measurement is
still owed, so the RED verdict above stands until a clean run replaces it.** Both measured on the same corpus, changing only the cipher / the read set:

| Lever | rows opened | quiet-equiv p50 | ×3 | Verdict |
|---|---|---|---|---|
| **Native crypto** (`react-native-quick-crypto`; Node AES-GCM as stand-in, no dependency added) | 66,067 | 356 ms | 1,069 ms | ✅ **PASS, 2.8× margin** |
| **Incremental materialization** (13-month window; `listRows({buckets})` already exists, no brand uses it) | 7,366 (11%) | 215 ms | 646 ms | ✅ **PASS, 4.6× margin** |

`openRowBody` alone goes 1,907 → **255 ms (7.5×)** on native crypto, and the ×3 there is *pessimistic* —
a JSI module does not pay the Hermes penalty at all. **Recommendation: treat `react-native-quick-crypto`
as the primary He10 unblock**, and take the on-device Hermes anchor the DoD already owes. ⚠️ Windowing
carries a caveat: `loadWeightLog` and `loadHabits` read unbounded history today and would need windows too.

**Incremental materialization — IMPLEMENTED 2026-08-15, MEASUREMENT PENDING.** The shared core gained
three **additive** primitives (`LedgerSchemaInput.residentWindowDays`, `projection.mergeRowEnvelopes`,
`RowLoadQuery.keys` + `LocalFirstStore.listRowBuckets`): **326 insertions, 0 deletions**, and zero
Budget/House source files touched — both stay `residentWindowDays: null` and byte-identical. Health sets
`HEALTH_RESIDENT_WINDOW_DAYS = 420`, **derived** from the registry's widest dated read (400 days) and
asserted by test rather than chosen.

Resident: the newest ~15 month buckets, `'*'` (so `userHabits`/`healthGoals` stay whole by construction),
and **every tombstone** — so delete-vs-edit still absorbs across four-year-old deletes. Lazy: live rows of
the five dated log tables older than the window.

The correctness risk here is not speed, it is a window quietly becoming data loss, and it is closed in two
places: a read miss widens first (`ensureHealthRowsResident`), and a **merge** miss hydrates the touched
keys before `applyLedgerDelta` — otherwise an orphan-parked patch persists `row: null` over the real sealed
body, which is silent permanent loss. `residentWindow.test.ts` (16 cases) covers all four directions,
including a peer CREATE for a key that exists outside the window and a habit ticked outside it not minting
a duplicate on its deterministic id.

`loadWeightLog` is deliberately **not** date-windowed — that would truncate a sparse logger's chart — it
widens to the registry's 500-row ceiling. `loadHabits` needs nothing: its 400-day cap is inside the window
by construction. `windows.ts` was not modified.

⚠️ **The Exit table has NOT been re-measured against this.** The run is queued behind another clone's test
suite; the harness refuses above loadavg 3.0 and is not being overridden. **Do not quote a pass until a
clean run lands.**

**`He12(partial)` vs He12 (full):**

| Gate | Means | Does **not** include |
|---|---|---|
| **He12(partial)** | Two-device E2E on Wave A tables with **internal/lab** `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1`. Brand default stays **off**. Flag-0 binaries may still use D1. | Q1 truncate, store default-on, Wave B/C |
| **He12 (full)** | Q1 closed, widget freeze, D1 snapshot+truncate, **post-truncate** two-device E2E green, **HBNR legal copy (Appendix C + C.1)**, **then** brand-default-on. (Worker Version ID was recorded **before He12(partial)** — do not wait to deploy a new Worker here.) | Wave D photos (needs He6) |

**DoD He12(partial).** Ported Budget MM suite green — **same user**, two devices — against a Worker
whose Version ID is built from the **same `backend/src` commit as the client binary under test, and
postdates it** (the §14 step 13 formulation); all **8** Wave A tables
create/modify/delete/converge; tombstone propagation; airplane-mode → reconnect catch-up; **push wake
delivered A→B in the one-user household** (§2 item 4c); no invite-partner copy on any screen;
`privacy-cross-user-leak.yaml` green; brand default asserted **off** in the binary under test.

**DoD He12 (full).** He12(partial) green **and** Q1 closed **and** Appendix C.1 legal copy signed
**and** §14 step 10b flag-0-cohort proof recorded **and** post-truncate two-device E2E green — then,
and only then, brand default on.

### As-built snapshot (2026-08-14, second pass) — still not 100%

Wave A **engine and cutover** are both on `health-v2`. On a flag-1 build the ledger is SoT. **Every shipped binary is flag-0**, so D1 is still SoT in production — by design, until He12 (full).

Suites at this snapshot: mobile **167 suites / 4273 tests**, mobile flag-on **149 / 4069**, backend **274 files / 4209 tests** — all green.

| In tree | Not in tree |
|---|---|
| `src/features/health/local/` — schema (8 keys), engine, DEK/SQLite, session, mailbox/HDK/checkpoints, push wake, refresh bridge | **Executed** two-device E2E run; a quiet-machine He10 re-take; on-device Hermes anchor |
| **Proxy on `src/api/health.ts`**, eight `local*Api`, `localHealthApi` composition root, `windows.ts`, `apiParity`, export-before-upgrade CSV, first-launch copy | Q1 countersign; D1 snapshot/truncate; HBNR legal copy; brand-default-on |
| He7-lite wired: `localSummariesApi` + `summaryParity` vs server fixtures + six refresh cases | He7 remainder (cycle predictions, BYOK coach); He9 backup (**Q8** open); He11 HealthKit-as-ops (**Q2** open) |
| 410 reject-list + `health_flag0_mutation`; fail-closed; `/v2` rate limit; `health_sync_wake`; **header arming on `/health/*`** | Wave D photo surface on top of the He6 transport (the retired-key ring in `engine.ts` has landed) |
| Worker 403 on a second `user_id`; He10 corpus + baseline; 25 two-device Maestro flows; He6 blob transport | — |

**Landmine — CLOSED.** `flag.ts` still brand-defaults **on** for `symply-health` when the env var is unset (deliberate — the plan wants that default to exist). What was missing is the pin: `eas.json` now sets `EXPO_PUBLIC_HEALTH_LOCAL_FIRST: "0"` on all five symply-health profiles, and `easFlagPin.test.ts` fails if any profile — including `testflight`, which inherits via `extends` — resolves to anything else.

**What actually blocks "done" now**, in order:

1. **Run** the He12(partial) suite on `Health-A`/`Health-B`. It is authored, not green.
2. **Re-take He10 quiet.** Four of six thresholds are breached at the ×3 gate; the run that produced them was captured at loadavg 23.8. If they survive a clean run, §4 descopes Wave C pending N5 mitigations.
3. **Q1 countersign** — everything in He12 (full) is behind it.

---

## 1. Decisions that shape everything

### 1.0 Precondition — ✅ Budget V2 certified; House Wave A as-built

| Signal | State |
|---|---|
| Budget two-device Maestro | ✅ `20260812-195127` |
| `@symply/local-first` projection | ✅ `createLedgerProjection` in package |
| Health importer of the package | 🟢 `src/features/health/local/` (engine, schema, sync). Screens / `healthRepository` still talk D1 — **no Proxy** |
| `0156` | **Taken** — `0156_lf_devices_composite_pk.sql` (`PRIMARY KEY (household_id, id)`). **Not** blobs |
| House H6 blobs | ✅ **SHIPPED 2026-08-13** — `0157_lf_blobs.sql` + `src/features/house/local/blobs/`. Health He6 client **not started** |
| Health `/v2` capability | `localFirstApi: true` (`brand-capabilities.ts:87`); DO **bound** on Health wrangler (`wrangler.health.toml:50-52`); v4 **comment is still stale** (`:173` still says `localFirstApi: false`) |
| Health **production** `/v2` | ⚠️ **Still ON in `[vars]`.** Fail-closed (`=== 'true'`) and `app.use('/v2/*', rateLimitDO('local-first:v2'))` are in tree. Secret has **not** left `[vars]` — next `deploy:fleet` still re-arms from toml. Live staging 401-vs-404 proof **not recorded** |

### 1.1 Product mandate — Q1 **blocks truncate** (not pre-authorized)

Same facts as House 2026-08-12: `platformRegistrationEnabled` default false; capabilities
comment still says **zero active users**. Lab D1 rows from P1–P3 are disposable **if**
product countersigns.

| Rule | |
|---|---|
| **Q1 open** | Do **not** snapshot-truncate Health D1, do not wipe production lab as if authorized |
| **Q1 closed (checkbox)** | Then, **as He12 (full)** after He12(partial) E2E is green **and the flag-0 cohort is proven empty (§14 step 10b)**: snapshot D1 → R2, truncate **the 8 Wave A tables only** (§1.5 — **not** “Tier A”, which includes Wave C), wipe lab devices |
| Real cohort found later | **Stop.** Write a migration programme. No dual-write |

**Explicitly out of scope until Q1:** treating wipe as already locked in README copy.

### 1.2 Personal, not household 🆕

Reuse `HouseholdCoordinatorDO`: mint **one implicit personal household per user**.
**No member invites.** Control-plane must **reject adding a second `user_id`** to a Health
household (He5 test). UI copy: “your other device,” never “invite a member.”
`simplehealth://lf-invite` is device enrolment only.

Watch is **not** a ledger replica (He7 glance only).

Do not invent a parallel user-scoped mailbox.

### 1.3 Current SoT must die (do not keep the outbox)

```text
TODAY:  screen → health*Storage → healthRepository
          ├─ MMKV cache (HEALTH_CACHE_KEYS)  — wiped on logout (authStore)
          ├─ POST /health/*  (D1 SoT)
          └─ health.outbox.v1 → POST /health/sync/push
             (12 HEALTH_PUSH_COLLECTIONS, src/api/health.ts:876;
              server twin PUSH_COLLECTIONS, health-sync-service.ts:140)

V2:     screen → health*Storage (same signatures)
          └─ local*Api → mutateLocalHealthLedger → notifyHealthLedgerChanged
                └─ mailbox / checkpoints only
```

`writeThrough` + outbox is **replaced**. Dual-write rejected.

**410 arming (normative):** `rejectHealthWritesForLocalFirst` returns 410 **only when
the request carries `X-Health-Local-First: 1`** (or equivalent client flag the Worker
already trusts). A flag-`0` binary must keep talking to D1. Never arm 410 globally
while any lab/TestFlight build still has the flag off.

**After local mutate:** `notifyHealthLedgerChanged` must refresh MMKV mirrors / in-memory
listeners the screens already use. Health is **not** House React Query — omitting this
leaves Home stale (House blanket-invalidate class of bug).

**Sign-out / teardown:** wipe `HEALTH_CACHE_KEYS` + SQLite **and** sidecar files
`symply-health-local-first.db-wal` / `.db-shm` (do not rely on `deleteDatabaseSync` alone —
stale WAL can replay after reinstall). Then delete the Health DEK only
(`health.localFirst.dek.v1`). **Do not** sweep unrelated App Group / widget Keychain items
that other brands share.
**First launch after iOS reinstall:** Keychain can **survive uninstall** — sweep **Health**
access-group keys + delete `.db`/`-wal`/`-shm` if the non-Keychain “install generation”
flag is missing (Android Keystore already wipes on uninstall).

### 1.3a Data continuity — normative, product-accepted 🆕

The three statements “outbox deleted, not migrated” (§7), “Backfill: None” (handoff §6) and
“Migrating existing Health D1 rows onto devices” (handoff §2 Non-Goal) combine into one
product fact that was previously never written down. It is written down here.

**V2 does not migrate Health D1 history onto devices. A device that takes the flag-1 build
begins with an empty ledger** — weight, water, meals, workouts/sleep, body, habits and goals
all start at zero. This is acceptable **only** because Q1 asserts zero real users. **If Q1 is
denied, this is the reason** — see §1.1 “Real cohort found later → Stop.”

Two consequences must be surfaced before He12(partial):

1. **First-launch copy on the flag-1 build:** “Symply Health now stores your data on this
   device. Entries made before this update are not carried over.” Ship a D1-sourced
   **export-before-upgrade** CSV (He9 archive path) as a **He3 Exit**.
   ⚠️ **Normative ordering:** it must read D1 **directly, bypassing the `src/api/health.ts` Proxy**,
   and must be offered and completed **before** the binary sends its first `X-Health-Local-First`
   header — i.e. on the flag-0 build, or on first launch of the flag-1 build *before*
   `ensureHealthLocalSession()` arms the header. The CSV ships in the **same merge** as the Proxy, so
   an engineer who wires it through the new `healthApi` gets an export of the **empty local ledger**:
   the one artefact that makes data loss survivable produces zero rows, and nobody notices because it
   “works”. Test `exportBeforeUpgrade.test.ts`: the export path calls remote methods with the header
   **absent**.
2. **After the He12 (full) truncate, a flag-0 install is destroyed, not degraded.**
   `readThrough` overwrites the MMKV mirror with the server answer on the *first successful
   read* — `src/features/health/healthRepository.ts:364-366`
   (`const fresh = await fetcher(); await storageHelpers.setObject(cacheKey, fresh);`). The module
   header states the intent explicitly at `healthRepository.ts:21`: “The cache is never
   authoritative: any successful server read replaces it wholesale.” So a flag-0 user reading an emptied D1 loses their local mirror too. The flag-0
   cohort must be **proven empty** before truncate — §14 step **10b**.

### 1.4 Scope tiering

| Tier | Fate | Examples |
|---|---|---|
| **A** | Encrypted personal ledger | Wave A **8 D1 tables** + Wave C (Wave C only from He11b) |
| **B** | Stay server / platform | Auth, FatSecret **lookup**, flags, entitlements; `/health/ai/*` until BYOK |
| **C** | Reference catalogs | Exercise library seed if not user-authored |
| **D** | Derived on device | Trends, streaks, cycle predictions, weekly averages, widget snapshot |
| **Off** | Disabled | `/health/social/*` (real prefix — `healthSocialRoutes` mounts at `/health`, `index.ts:289`), body-photo analysis, FatSecret **diary** OAuth 1.0a |

⚠️ **Tier A describes eventual ledger membership, not the He12 (full) truncate set.** Wave C is
gated on **He11b**, which lands *after* He12 (full); at truncate time Wave C has no ledger and D1
is its only home. Truncating “Tier A” literally destroys live cycle / men’s-health / injury data.
The truncate set is the **8 Wave A tables only** — see §14 step 11.

**FatSecret lookup is not “no PHI.”** Search queries can carry **food/meal strings**.
Accepted Wave A threat: lookup stays Worker chokepoint; do not send diary rows or
body metrics. Document in privacy copy. Minimize query to the search box text.

**Soft Transfer:** RELATIONSHIPS **lists** `health.summary.v1` / `profile.core.health.v1`.
**Listed ≠ enabled.** V2 does not activate them. Later: local projections only.

### 1.5 Wave A tables — **locked count = 8 D1 tables**

Row-key always `id`. Bucket on `date` / `loggedAt` → `YYYY-MM`, else `*`.

| # | Table | Today | Bucket | HK `source` col today |
|---|---|---|---|---|
| 1 | `weight_entries` | D1 + `health.weightLog.v1` | `date` | ✅ `source` |
| 2 | `water_entries` | D1 + water keys | `date` | ❌ **no `source`** — HealthKit water **out of Wave B** unless a new column is claimed on `main` |
| 3 | `nutrition_entries` | D1 + `health.meals.v1` | `date` | ✅ `source` |
| 4 | `health_entries` | D1 + activity/sleep | `date` | ✅ `source` |
| 5 | `body_measurements` | D1 + `health.body.v1` | `date` | n/a Wave B |
| 6 | `user_habits` | D1 + `health.habits.v1` | `*` | n/a |
| 7 | `habit_logs` | same | `date` | n/a |
| 8 | `health_goals` | D1 + calorie/macro week keys | `*` | n/a |

**Not D1, already local:** notes (`health.notes.v1`). Stay device-local or fold into ledger in He3 as a ninth table — default **stay MMKV** (He1 registry stays 8).

**Not ledgered:** layouts, unit cache, `health_weekly_weight_averages` (Tier D recompute).

⚠️ **Food challenges — Tier D (derived), server tables frozen, and previously unclassified.**
`food_challenges`, `food_challenge_progress`, `food_challenge_achievements`, `food_category_mappings`
(`backend/src/db/schema-health-challenges.ts:23/58/86/110`), the `/health/challenges*` routes
(`backend/src/routes/health.ts:1045+`) and two of Home’s seventeen loaders
(`loadChallengesWeeklyOverview`, `loadChallengesWidgetExpanded` —
`HealthHomeScreen.tsx:52-53`) are **not** Wave A, **not** Wave C and **not** ledgered. Until v1.7
they appeared in no tier, wave or truncate list at all.

Two consequences: (1) `/health/challenges*` stays **off** the 410 reject-list, so a flag-1 client
keeps reading and writing challenge state against D1 — legitimate only because it is explicitly
Tier D. (2) `food_challenge_progress` is **computed from `nutrition_entries`**, which §14 step 11
truncates — so at He12 (full) challenge progress becomes permanently stale against an emptied source.

**Decide in He3a and record:** either (a) port challenge progress on-device as a Tier D recompute
over the local `nutritionEntries` (He7-lite scope, since Home renders it), or (b) dark the two Home
challenge loaders behind the flag with in-product copy, alongside the widget freeze. Until this is
answered, `apiParity.test.ts` must list the four challenge methods with reason
`"unclassified — blocks He3a"` — **He3a cannot go green with them unlabelled.**

### 1.5a Unclassified tables — the rest of the Health schema 🆕

There are **44** tables across the seven `backend/src/db/schema-health*.ts` files. Wave A names 8,
Wave C names 10, and “not ledgered” names three. The remainder were never classified. Each of the
following holds **user-authored** data and four of them already have a `HEALTH_CACHE_KEYS` mirror,
so each keeps a live D1 dependency after Wave C lands:

| Table | Location | Disposition — **decide in He3a** |
|---|---|---|
| `exercise_favorites` | `schema-health-exercises.ts:94` | `unique(user_id, exercise_id)` + soft-delete + `updated_at` — already sync-shaped. Strongest candidate for a 9th/Wave-C ledger key |
| `activity_notification_preferences` | `schema-health-p2.ts:172` | 10 user switches; mirrored `health.notifyPrefs.v1` |
| `body_comprehensive_insights` | `schema-health-p2.ts:283` | Mirrored `health.bodyInsights.v1`; **sensitive** — belongs in Appendix C.1 |
| `health_coach_consent_receipts` | `schema-health-ai.ts:25` | Mirrored `health.coachConsent.v1`; consent evidence — likely must stay server-side |
| `body_photo_insights` | `schema-health-p2.ts:249` | AI prose over the user’s own photos; Wave D / He6 territory |
| `food_usage_history` | `schema-health-p2.ts:132` | Derived from logging; Tier D candidate |
| `widget_preferences` | `schema-health-p2.ts:200` | Probably covered by “layouts”, but say so explicitly |
| `user_files` | `schema-health-p2.ts:12` | Named in §1.6 Wave D but absent from every wave list |
| `health_coach_operations` | `schema-health-ai.ts:58` | Server-owned idempotency ledger — Tier B, state it |
| 11 `health_*` social tables | `schema-health-social.ts:21-295` | Multi-user by design; §1.4 puts `/health/social/*` in the **Off** tier but never says the tables stay server-authoritative |

Catalogs (`exercise_library` `schema-health-exercises.ts:38`, `food_category_mappings`
`schema-health-challenges.ts:110`) are migration-authored with no `user_id` — **Tier C**, correctly
out of scope.

**He3a Exit adds:** every table in this register carries a one-line disposition (Tier A/B/C/D/Off +
wave). An unclassified user-authored table is the same defect class as the food challenges above.

**Deterministic ids — exactly two Wave A tables.** Source of truth: the `unique()` constraints in
`backend/src/db/schema-health.ts` and the natural-key merge contract in
`backend/src/services/health-sync-service.ts:66-72`.

| Table | D1 constraint | Builder |
|---|---|---|
| `habit_logs` | `unique(habit_id, date)` — `schema-health.ts:325` | `habitLog_${habitId}_${date}` |
| `health_goals` | `unique(user_id, effective_date)` — `schema-health.ts:609` | `healthGoal_${effectiveDate}` |

⚠️ **`weight_entries` is NOT per-day unique** and must keep **random** ids. It carries no `unique()`
constraint and is deliberately absent from the server’s natural-key merge list. Two weigh-ins in one
day are supported product behaviour; a `weight_${date}` builder would LWW one of them away — silent
loss of a real reading in the app’s flagship metric. Same for `water_entries`,
`nutrition_entries`, `body_measurements`, `user_habits` (no `unique()` on any of them).

`health_goals` buckets to `*` (not `effective_date`) on purpose: goals are always-resident and the
active goal must load without a month probe. Do not relitigate in He1.

He1 `registryGuard` **fails** if: the registry is not exactly these 8 keys (plus notes only if
explicitly added); **a Wave A table with a D1 `unique()` constraint has no builder**; or **a table
without one has a builder**.

⚠️ **The guard is parameterised by wave, not frozen at 8.** He1 asserts `WAVE_A_TABLES.length === 8`;
**He11b extends the same guard to the Wave C set and re-runs the builder rule against it.** Four
Wave C tables carry `unique()` and therefore *require* builders — `period_entries`
(`unique(user_id, date)`, `schema-health.ts:360`), `cycle_symptom_entries` (`:397`),
`mens_health_entries` (`:467`) — plus the two per-user singletons `cycle_settings` (`:333`) and
`mens_health_settings` (`:475`), which bucket to `*` like `health_goals`. This matches the server’s
own natural-key merge list (`health-sync-service.ts:66-72`). **Write the He11b builders into the
guard before relaxing the count assertion.** A count-only edit — the one-character fix an engineer
makes when He11b’s first commit red-fails on `length === 8` — is how `period_entries` silently loses
its merge key and two offline devices produce permanent duplicate period rows in the most sensitive
table in the app.

### 1.6 Waves B / C / D

| Wave | Tables | Gate |
|---|---|---|
| **B** | HK samples → Wave A rows with `source: 'healthkit'` where the column exists | He11a; water excluded until DDL |
| **C** | `cycle_settings`, **`period_entries`**, `cycle_symptom_entries`, `mens_health_entries`, `mens_health_settings`, `injuries`, `custom_foods`, `recipes`, `fridge_items`, `health_reminder_preferences` | He11b |
| **D** | `user_files` / body photos | **He6** (blocked — see §8) |
| **Never** | families, buddies, community, group challenges, FatSecret connections | Stay disabled |

### 1.7 Kill switch (House §1.7 shape)

| Flag | Meaning | Default |
|---|---|---|
| `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` | `1` on / `0` off / unset → on for `symply-health` only **after He12 (full)** | **off** until He12 (full) |
| `EXPO_PUBLIC_HEALTH_P2P` | WebRTC | off |
| `LOCAL_FIRST_API_ENABLED` | Worker `/v2` mailbox | fleet-wide; Health already `localFirstApi: true` |

**Jest:** under Jest the **brand default** is suppressed (returns false) so the existing remote-api
suites keep testing the remote contract — but an **explicit** `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1`
still returns true, so the local path is coverable. (An unconditional `false` under Jest would make
the required `=1` pin unpassable.) Copy `src/features/house/local/flag.ts:13-31` exactly — that is
where the `JEST_WORKER_ID` guard lives. The **test** pattern to copy is
`src/features/budget/local/__tests__/flag.test.ts:17,24`, which is the repo’s only `flag.test.ts`;
House has no such file.

**Kill-switch latency — there is no sub-60s kill. State it, do not imply one.**
An EAS Update reaches a client only on its next cold launch; a backgrounded app does not fetch, and
a store binary on an older channel may never fetch. The Worker secret stops the mailbox but does
**not** un-410 `/health`. So a flag-1 client that has not fetched the update can neither sync nor
write to D1 — it is **local-only** until it updates. Expect p50 hours, p95 days.

**Incident disable (order is normative):**

1. **Publish the EAS Update with `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0` first — it is the only step that
   changes what a client does.** A correctly-built flag-1 client writes to the **ledger** and does
   not call `/health` at all (§1.3, §7), so un-arming the 410 changes nothing for it. Start the
   clock immediately; latency is p50 hours / p95 days.
2. **Then revert the 410 middleware and `deploy:fleet` from `main`** (four Workers × two envs —
   budget ~10 min, not 2). This is **not** a fix for flag-1 clients. It is what makes the *newly
   downgraded* flag-0 clients from step 1 usable the moment they fetch, and it un-blocks any client
   stuck in the §5.1 Proxy fall-through. It re-opens the dual-world window §1.3 forbids; acceptable
   for the duration of an incident.
3. Optionally set `LOCAL_FIRST_API_ENABLED` → `"false"` on the **Health** Worker to stop the mailbox
   (as-built: the `[vars]` entry is **gone** on all three brands, so the secret now holds across a
   `deploy:fleet` — §1.7a Commit 3. Set it with `wrangler secret put`, or
   `LOCAL_FIRST_API="false" ./scripts/secrets/sync-child-worker-secrets.sh health`; secret puts apply
   live, no redeploy).

   **What no step fixes:** data written only to the ledger since flag-1 is not in D1 and the outbox
   is gone. See §14.1 “Return to D1” — export **before** the flag drops.
4. Verify: mutating `/health` is 2xx/4xx-auth for flag-0; `/v2` 404 when the flag is false; no
   mailbox deposits from that cohort.
5. Revert: `"true"`, redeploy the gate, then EAS Update flag `1`.

**Before He12(partial):** confirm the Health EAS channel the lab cohort is actually on receives
updates (House §1.7 rule). An untested update channel is not a kill switch.

**Mid-stream:** in-flight `syncOnce` may finish or fail once; new sessions honour the flag at process start.

**Unsafe windows (forbidden):**

| Window | Why |
|---|---|
| 410 armed globally while flag-0 clients exist | Writers stuck |
| Flag on while outbox/D1 still SoT | Dual world — rejected |
| Truncate D1 then roll flag to `0` expecting D1 to work | Empty glance / lost remote SoT |

**If Q1 truncate already ran:** flag-`0` cannot resurrect D1. Rollback is “stay local-only / reinstall from backup,” not “return to D1.”

### 1.7a Failure semantics — normative 🆕

Neither v1.5 nor its siblings stated what happens when configuration cannot be read. The repo
contains **both** conventions side by side and local-first currently uses the unsafe one.

| Gate | Today | Required |
|---|---|---|
| `/v2` control plane | **Fails OPEN** — `hasBrandCapability(...) && env.LOCAL_FIRST_API_ENABLED !== 'false'` (`backend/src/config/local-first-api.ts:6`). `"False"`, `"0"`, `"off"`, `""` all leave `/v2` fully enabled | **Fail CLOSED:** `=== 'true'`. Mirror `isHealthSocialEnabled` (`backend/src/routes/health-social.ts:66-72`), whose own comment says a missing key, a typo, or a half-finished rollout “must all mean OFF” — for a *less* sensitive surface than the ledger |
| 410 write gate | Fails **open** by construction (header-driven, reads no config) | **Correct as-is.** A client that cannot be identified as flag-1 keeps its D1 path. Stated here so nobody “hardens” it into fail-closed |
| Brand resolution | Fails closed — `getAppBrand` throws `UnknownAppBrandError` (`backend/src/config/brand.ts:32-38`) | No change; recorded |

⚠️ **Fail-closed is a two-commit, ordered change. The flag flip alone is a fleet outage.**
`isLocalFirstApiEnabled` is **shared**, and **Budget sets `LOCAL_FIRST_API_ENABLED` nowhere** —
`backend/wrangler.budget.toml` has no such key in `[vars]`, `[env.staging.vars]` or
`[env.production.vars]`. Budget’s `/v2` is live today *purely* on the permissive `!== ‘false’`
default this section deletes, and Budget is the one brand already certified two-device
(`20260812-195127`). House (`wrangler.toml:22/233/421`) and Health
(`wrangler.health.toml:18/200/363`) already set it; Kaizen is `localFirstApi: false` and unaffected.

| Step | Action |
|---|---|
| **Commit 1** (config only, `deploy:fleet`) | Add `LOCAL_FIRST_API_ENABLED = “true”` to `backend/wrangler.budget.toml` `[vars]`, `[env.staging.vars]`, `[env.production.vars]`. **Verify Budget staging + production `/v2` still answer 401, not 404, before Commit 2.** |
| **Commit 2** | Flip `local-first-api.ts:6` to `=== ‘true’`, and **invert** the two existing assertions in `backend/src/config/__tests__/local-first-api.test.ts` that pin `unset → true` for House and Budget. They are the documented old contract; they must become `unset → false` with a comment naming this section |
| **Commit 3** ✅ as-built | Only then move the value to secrets — for **all three** brands that carry it, not Health alone. Done: nine `[vars]` lines removed (`wrangler.toml`, `wrangler.budget.toml`, `wrangler.health.toml` × dev/staging/production); provisioned by `scripts/secrets/sync-child-worker-secrets.sh`; `deploy:fleet` now refuses to run unless `backend/scripts/verify-local-first-api-secret.sh` passes (secret present on all six Workers **and** absent from every `[vars]` block); pinned by `backend/src/config/__tests__/local-first-api-secret.test.ts`. Local `wrangler dev` reads it from `backend/.dev.vars`. Live 401-vs-404 proof: `./scripts/health/verify-v2-fail-closed.sh` — procedure in [Health v2/README.md](./README.md#he0-live-proof--how-to-record-it) |

**Second blast radius — the cron.** `isLocalFirstApiEnabled` also gates the mailbox and checkpoint
TTL sweeps at `backend/src/cron/scheduled.ts:226`. A brand that loses the flag stops sweeping, so
**the 14-day mailbox TTL that Appendix C.1 pins by test is silently no longer enforced** and R2
accumulates unswept ciphertext. DoD He0 adds: “after the fleet deploy, confirm the mailbox-sweep log
line still appears in **Budget and House** cron logs.”

**Kill-switch durability.** Secrets and vars share one namespace on `env`; while a `[vars]` entry
exists, the next `wrangler deploy` — i.e. the next `deploy:fleet` for *any* brand’s change —
silently re-applies `”true”` and re-arms `/v2`. That is why Commit 3 exists. He0 Exit adds: “after
`deploy:fleet`, re-verify `/v2` still 404s with the secret false.”

### 1.8 Soft Transfer

Listed packages stay **inactive**. `smartEngine: true` on Health is a latent surface — do not
wire export from the ledger in Wave A.

---

## 2. Stage He0 — enablement 🆕

**Problem.** Capability `true` + DO bound; four separate comments still say House+Budget only.

**Fix.**

1. Contract tests: Health `/v2` 401 unauthenticated; Kaizen 404 `{ error: 'Not found' }`
   (literal verified at `backend/src/middleware/brand-gate.ts:46`).
2. **Four stale comment sites, not two.** All say House+Budget while the tree says otherwise:
   `backend/wrangler.health.toml:171-180` (asserts Health has `localFirstApi: false` and no
   `HOUSEHOLD_COORDINATOR` binding — the binding is 120 lines above it at `:50-52`),
   `backend/src/middleware/brand-gate.ts:42`, `backend/src/config/local-first-api.ts:4`,
   `backend/src/config/brand-capabilities.ts:35`. Also fix the sibling doc that now contradicts
   the tree: `House v2/house-local-first-implementation-plan.md:422` still says
   “`wrangler.health.toml` | **Do not bind.** `localFirstApi: false`”.
3. **410 gate — a reject-list, not a broad gate with two exclusions.** Implement
   `rejectHealthWritesForLocalFirstEarly` mirroring `HOME_LOCAL_FIRST_REJECT_SUFFIXES`
   (`backend/src/middleware/house-local-first-gate.ts:21-50`). Reject **only** the Wave A
   surfaces plus the sync contract: `/health/weight`, `/health/water`, `/health/nutrition`,
   `/health/entries`, `/health/measurements`, `/health/habits`, `/health/goals`, `/health/sync`
   — matched as **exact prefix OR prefix + `/`**. **Everything else falls through untouched** —
   `/health/cycle/*`, `/health/mens-health/*`, `/health/reminders/*`, `/health/exercises/*`,
   `/health/foods/*`, `/health/widget/*`, `/health/fridge/*`, `/health/files/*`,
   `/health/challenges*`, `/health/summary*`, `/health/social/*`. Those are Tier B or Wave C and
   stay server-authoritative for all of Wave A.

   ⚠️ **Two corrections found by auditing the real routers — as-built, both now tested:**
   - **`/health/sync/*` was wrong.** `GET /health/sync` (`routes/health.ts:1139`) is the delta
     **pull** and lives at the *bare* path; only `POST /health/sync/push` sits below it. A
     `/*`-shaped match lets the single largest D1 read in the app through to a flag-1 client.
     Hence exact-prefix-or-slash matching. (Every entry starts `/health/`, so the platform
     healthcheck `app.get('/health', …)` at `index.ts:207` can never match — do **not** add a bare
     `/health` entry.)
   - ⚠️ **`POST /health/ai/coach/commit` is a Wave A WRITE and must be rejected**, even though the
     rest of `/health/ai/*` is genuinely Tier B and falls through. The coach commit step
     materializes the confirmed proposal and writes **five** Wave A tables —
     `backend/src/services/health-ai/coach-service.ts` `createWater` (:718), `createWeight` (:726),
     `createHealthEntry` (:738), `toggleHabit` (:780), `createNutrition` (:788). Left on the
     fall-through side, a flag-1 client that confirms a coach proposal writes straight to D1 while
     its ledger is the system of record — the dual-world state §1.3 rejects, arriving through the
     one door the reject-list left open. Implemented as a scoped exact-path exception
     (`HEALTH_WAVE_A_EXACT_PATHS`), not by rejecting the whole `/health/ai` prefix.
   **Gate on method — but reject Wave A `GET` too.** Reject `POST|PUT|PATCH|DELETE` **and `GET`** on
   the Wave A reject-list prefixes. §7 forbids a flag-1 client from reading D1 at all, so a Wave A
   GET from a flag-1 client is not a partial-rollout convenience — it is the §5.1 Proxy fall-through
   succeeding *silently*: if `ensureHealthLocalSession` is missed, the local read throws, the Proxy
   catches, the GET returns 200 from D1, and `readThrough` (`healthRepository.ts:364-366`) writes
   that answer over the MMKV mirror. Nothing fails, no test goes red, and QA sees correct-looking
   data. Post-truncate it is worse: the GET returns an **empty** 200 and the mirror is overwritten
   with emptiness. 410-ing it is the only thing that turns that omission into a visible failure.
   Method-gating remains the rule for the **fall-through** set (`/health/ai/*`, `/health/foods/*`,
   `/health/widget/*`, `/health/cycle/*`, …) — which is where §12’s “410 matrix (FatSecret GET vs
   mutating `/health`)” actually applies. (The inherited House gate is method-blind, so this is an
   addition to the pattern, not a copy of it.) If product later wants Wave A GET readable during a
   partial rollout, that is a **separate, dated decision** with the `readThrough`-overwrite
   consequence written beside it — not a default.
   **Registration slot (normative):** register **before** `app.route('/health', healthRoutes)` at
   `backend/src/index.ts:265`. Hono runs handlers in registration order, and the existing
   `app.use('*', rejectHomeWritesForLocalFirstEarly())` sits at `:294` — *after* all eight `/health`
   mounts (`:265, 268, 269, 270, 273, 279, 284, 289`) — so a gate registered there would never fire
   for `/health/*`. Match on `/health/*`, never bare `/health`: the healthcheck
   `app.get('/health', …)` at `:207` must stay unaffected.
   Still **unarmed** until `X-Health-Local-First` is present.
4. **Push wake — four code sites, not one.** Adding the type to the allowlist accomplishes nothing
   on its own:
   (a) `backend/src/services/local-first-sync-wake-service.ts:6-12` — add
   `HEALTH_SYNC_WAKE_TYPE = 'health_sync_wake'` to `LOCAL_FIRST_SYNC_WAKE_TYPES`.
   (b) `backend/src/routes/local-first-v2.ts:53-55` — the selector is
   `isFullBudget(env) ? BUDGET_SYNC_WAKE_TYPE : HOUSE_SYNC_WAKE_TYPE`. Health’s `budgetMode` is
   `'minimal'`, so **Health emits `house_sync_wake` today**, and the client filter is hard equality
   (`src/features/house/local/pushWake.ts:64`). Replace with a brand-keyed map over `getAppBrand`
   covering all four brands, and pass `wakeType` at the `/v2/households/:id/sync-wake` call site
   (`:665-670`), which currently passes none and therefore defaults to `BUDGET_SYNC_WAKE_TYPE`
   (`local-first-sync-wake-service.ts:163`).
   (c) ⚠️ **`excludeUserId` must be optional and omitted for Health.** The peer query is
   `… AND id != ? AND user_id != ?` (`local-first-sync-wake-service.ts:148-154`) and
   `local-first-v2.ts:288` always passes `excludeUserId: userId(c)`. That filter exists because
   Budget/House households have **multiple users**. A Health household has **one** user with N
   devices (§1.2), so `user_id != <the only user>` matches **zero rows** and the push wake is
   structurally impossible. This is the Health-specific consequence of “personal, not household”
   that §1.2 did not draw; without it, multi-device sync silently degrades to foreground-pull-only.

   Peer exclusion for Health is `excludeDeviceId` **only** — but the two call sites are **not
   symmetric**, and dropping `excludeUserId` from the wrong one turns a dead wake into a **push
   loop**. Both exclusions default to `''` (`local-first-sync-wake-service.ts:143-144`), and `''`
   matches every row:
   - `local-first-v2.ts:286-290` (**deposit**) already passes
     `excludeDeviceId: body.sourceDeviceId ?? null`. Make `sourceDeviceId` **required** in the
     deposit schema for Health, or the empty-string default matches every device and A wakes itself.
   - `local-first-v2.ts:655-673` (**`POST /v2/households/:id/sync-wake`**) passes **no**
     `excludeDeviceId` and parses no body — it has no device id to exclude. Removing `excludeUserId`
     here leaves the query with **zero exclusions**. Add an optional `{ sourceDeviceId }` body (or an
     `X-LF-Device-Id` header) validated against `deviceBelongsToUser`, and pass it as
     `excludeDeviceId`. **Do not remove `excludeUserId` at `:670` until that device id exists** — an
     unexcluded self-wake is a push loop (`syncOnce` → deposit → wake → `syncOnce`), not a degraded
     sync.
   - `excludeUserId` is **already optional** in the service signature — the change is at the two
     call sites, not in the service.
   - Dropping `excludeUserId` removes the only user-scoping predicate from the peer query, so the
     He5 “second `user_id` → 403” control-plane test becomes the compensating control. **Promote it
     from DoD He5 into DoD He0**, in the same merge as this change.
   (d) `src/hooks/useNotificationHandler.ts:8,133,176` routes only
   `handleBudgetSyncWakeNotification`. House’s handler is exported (`house/local/index.ts:118`) and
   **never wired** — an as-built gap Health would inherit verbatim. Route
   `handleHealthSyncWakeNotification` and add a test that an unrouted wake type fails.
5. `simplehealth://lf-invite` — device enrolment; negative test: no family/buddy copy.
   ⚠️ The shared Worker hardcodes the **Budget** scheme in its invite response:
   `qrPayload: \`symply-budget://lf-invite?...\`` (`backend/src/routes/local-first-v2.ts:506`).
   Health must either brand that payload or build the link client-side as House does
   (`src/features/house/local/controlPlaneClient.ts:206`). Track in He5.
6. **Hibernation/signaling smoke is *not* a He0 gate for Health.** `ctx.acceptWebSocket`
   (`backend/src/durable-objects/household-coordinator.ts:503`) serves only the **WebRTC signaling**
   socket. Health Wave A sets `EXPO_PUBLIC_HEALTH_P2P=0` and ships **no** SSE/EventSource client
   (§5 He4), so Wave A never opens it. The smoke test becomes a gate of **enabling
   `EXPO_PUBLIC_HEALTH_P2P=1`**, tracked as House H0 debt (handoff G9). He0 instead asserts by test
   that **no Health code path opens a `/v2` WebSocket** — grep test over `src/features/health/**`
   for `WebSocket`, `EventSource`, `signaling`.
   (v1.5 made this Exit satisfiable by “recording that it is blocked”, which is not an Exit.)
7. Kill-switch unit pin (`flag.test.ts`, §1.7 wording).
8. **Fail-closed `/v2`** per §1.7a, and move `LOCAL_FIRST_API_ENABLED` out of `[vars]` into secrets.
9. **Rate-limit `/v2`.** `backend/src/index.ts:263` registers `rateLimitDO` only for `/health/ai/*`;
   `/v2` (mailbox deposit, checkpoint PUT, sync-wake) has auth + membership but **no limiter**,
   while `RATE_LIMITER` is already bound (`wrangler.health.toml:55`). Add
   `app.use('/v2/*', rateLimitDO('local-first:v2'))` before the `/v2` mount, with a tighter bucket
   for `PUT /v2/households/:id/checkpoints`. Shared plumbing → `deploy:fleet`; re-assert
   Budget/House `/v2` suites. Pre-existing, but Health is the brand adding a new mailbox cohort to
   an E2EE health surface where deposit volume is itself metadata.
10. ⚠️ **Instrument the flag-0 cohort counter — §14 step 10b(iii) has no data source today.**
    The request logger is wrapped in `if (c.env.ENVIRONMENT === 'development')`
    (`backend/src/index.ts:126-132`), so **staging and production emit no per-request log line at
    all**, and nothing anywhere logs request headers. A query for “header-less `/health` mutations”
    therefore returns zero because there are zero rows *of any kind* — see §14 step 10b(iii) for why
    that false zero is dangerous. Inside `rejectHealthWritesForLocalFirstEarly`, on the
    **fall-through** branch (Wave A path + mutating method + header **absent**), emit exactly
    `console.log(JSON.stringify({ evt: 'health_flag0_mutation', path, method }))` — **path and
    method only**, never body, query, user id or device id (Appendix C.1 denylist). Add the matching
    `{ evt: 'health_410' }` on the reject branch so §15’s 410 row also has a source. Both land in
    Workers Logs via the existing `[observability]` block (`wrangler.health.toml:183-185`).

**DoD He0.** Live `/v2` proof recorded (Version ID) against **staging** Health vs Kaizen
**before** production (`deploy:fleet` has no pause — see §14); all **four** comment sites match the
tree; 410 gate present, reject-list shaped, method-gated (Wave A `GET` included), registered before
`:265`, and **unarmed**; wake type allowed **and** all four wake sites fixed, with a
personal-household A→B delivery test and the **second-`user_id` → 403 control-plane test promoted
here from He5** (it is the compensating control once `excludeUserId` is dropped);
**grep test proves no Health path opens a `/v2` WebSocket or EventSource** (replaces the hibernation
smoke — item 6); `/v2` fail-closed **via the three-commit order in §1.7a**, with Budget staging +
production proven **401, not 404**, and the mailbox-sweep cron line still present in **Budget and
House** logs after the fleet deploy; `/v2` rate-limited; the `health_flag0_mutation` counter emitting
(item 10) with a staging positive control recorded; `LOCAL_FIRST_API_ENABLED` a secret in all three
envs and surviving a `deploy:fleet`.

---

## 3. Stage He1 — ledger core ♻️ + 🆕

| Artifact | Path |
|---|---|
| Registry | `src/features/health/local/schema.ts` — **exactly 8** Wave A keys |
| Ids | `src/features/health/local/ids.ts` |
| Engine | one `EngineState` (not House `Map`) |
| Flag / DEK / DB | `health.localFirst.dek.v1`, `symply-health-local-first.db` |
| Projection | registry-only adapter |

⚠️ **O2 must be locked before `ids.ts` is written** — see §16. He1 freezes the id scheme; resolving
O2 later in the “one row per day, id from `date+source`” direction would re-key every existing local
row, which the op log cannot express without tombstoning and recreating all of them (permanently
divergent, House S3a). O2 is a **He1** decision, not a He11 one.

**DoD He1.** `registryGuard` asserts 8 keys **and** enforces the builder rules in §1.5 (constrained
table without a builder = fail; unconstrained table with one = fail); session round-trip + tombstone
survive reopen; S3b double-create; **one offline-double-create convergence test per builder**
(`habit_logs`, `health_goals`) plus a **counter-test proving two same-day `weight_entries` both
survive**; Budget+House local suites green; `cd backend && npm run typecheck`;
Health key ≠ House/Budget in one Jest process; new Health local files pass TypeScript
**strict** (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`) — no `any` /
`as unknown as T` without a one-line justification.

---

## 4. Stage He10 — scale harness ♻️

Corpus: daily weight + 3–6 meals + water + workouts + sleep, 5y and 10y, one adult.

**Measure the read path, not just the write path.** §4’s thresholds previously covered `mutate` and
`applyLedgerDelta` only. The path that decides whether Home is usable is the **facade read path**:
`src/features/health/screens/HealthHomeScreen.tsx:198-219` fires a **17-way `Promise.all`** of `load*()` on every focus, and
`useHealthKitSyncHydration` fires the same hydrate again after every HealthKit sync. Add a fourth
harness phase **`health-homehydrate`** that drives the real `load*()` set through the local repos and
reports p50/p95 for the full 17-loader `Promise.all` at 1y / 5y / 10y. That is the number the
descope trigger reads. (House shipped H3 owing exactly this — “the harness measures the projection
directly, not through the facades.”)

**Fail / descope thresholds (He10 Exit — normative numbers, not “usable”).** On the
Hermes-estimated 10-year corpus, measured **with checkpoints on** (He8), since a cold open in
production never replays the full log:

| Metric | Fail above |
|---|---|
| Cold open → first Home paint | **3.0 s p50** / **5.0 s p95** |
| Single meal `mutate` | **250 ms p95** |
| `applyLedgerDelta`, one deposit | **500 ms p95** |
| 17-loader `health-homehydrate` | **1.5 s p95** |
| Ledger + LWW on disk | **250 MB** |

Any one breached after N5-style mitigations (stamp interning → column pruning → field grouping)
**descopes Wave C** (cycle/fridge/foods stay D1 or disabled) — do not silently ship. The baseline md
re-publishes these numbers; it does **not** replace them here.

**Mitigations are Exit criteria, not options:** crypto in a JSI native module
(`react-native-quick-crypto`), checkpoint/snapshot so a 10-year replay never happens on cold open,
and incremental materialization. Hermes still has no JIT and no Static Hermes AOT, so the gap is
current, not historical.

**DoD He10.** Baseline markdown path published with the table above filled in; environment labelled;
Hermes 3–15× stated; `health-homehydrate` phase reported; quiet re-take owed; one on-device Hermes
anchor before He3 perf claims.

---

## 5. Stages He2 / He4 / He8 — inherited + Health hygiene

**He2 extra (not free):**

- DEK `WHEN_UNLOCKED_THIS_DEVICE_ONLY` via `expo-secure-store` — matching Budget and House
  verbatim (`src/features/house/local/persistence.ts:21-22`,
  `src/features/budget/local/persistence.ts:32-33`). ⚠️ The reason is **not** “blocks iCloud Keychain
  sync”: expo-secure-store never sets `kSecAttrSynchronizable`, so nothing it writes reaches iCloud
  Keychain at any accessibility level. The real effect of `_THIS_DEVICE_ONLY` is **exclusion from
  encrypted-backup restore onto a different device** — which is exactly what makes Q8 (§16) a real
  product problem. The decision stands; its justification is backup-restore, not sync.
  Gotcha: `SecItemUpdate` omits `kSecAttrAccessible`, so changing the class on an **existing** item
  **silently no-ops** — it must be delete-then-rewrite.
- First-launch Keychain sweep (iOS reinstall).
- SQLite + WAL/SHM file protection: `CompleteUntilFirstUserAuthentication` minimum;
  per-row AEAD does not protect WAL metadata. Re-apply protection to `.db`, `-wal`, and `-shm`
  after first open / WAL enable.
- Logout/reinstall: delete `.db`, `-wal`, and `-shm` explicitly. `deleteDatabaseSync` removes only
  the main `.db` (expo/expo#43441 — **still open**, fix PR unmerged, absent from SDK 57 native source
  on both platforms). The hazard is *“if a new database is later created with the same name”* — i.e.
  **account switch / re-login within one install**, not reinstall (iOS drops the whole container on
  uninstall).
- Test: Health DEK key string ≠ `house.localFirst.dek.v1` / `budget.localFirst.dek.v1`.

⚠️ **DEK class vs background ingest — resolved: nothing is written to the ledger while locked.**
v1.5 asked for a `WHEN_UNLOCKED_THIS_DEVICE_ONLY` DEK *and* a `CompleteUntilFirstUserAuthentication`
DB file “for background HK ingest”. Those conflict: a background wake on a locked device can open
the file but cannot read the key, so per-row AEAD writes fail. The resolution is **not** to weaken
the DEK to `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` but to accept that **the ledger is never written
while the device is locked** — which is already forced by HealthKit itself: HK reads fail while
locked with `errorDatabaseInaccessible` (health data is Protected Unless Open, released ~10 min
after lock), so a locked wake has nothing to write anyway. The locked branch writes only to the
**native staging table** (a plain file at `CompleteUntilFirstUserAuthentication`, no DEK involved) —
see §11. Lock this in He2 kickoff; if product later wants true locked-device ledger writes, the DEK
class must change first and this note is the reason why.

⚠️ **Two precision corrections to the “HK is unavailable when locked” premise** — both affect §11’s
branch design, so do not restate the premise loosely:
1. **Access is relinquished ~10 minutes *after* lock**, not at lock. A background wake that fires
   inside that window **can** read HealthKit successfully. So the locked branch must be chosen by
   **probing** — attempt the anchored fetch and fall back on `errorDatabaseInaccessible` — never by
   assuming “screen off ⇒ no data”.
2. **HealthKit *writes* still succeed while locked** — Apple saves them to a temporary file and
   merges on unlock. Health is read-only vs Apple in Wave A (§11), so this does not affect ingest,
   but it means “HealthKit is unavailable when locked” is false as a general statement and must not
   be used to justify any future write path.

**Scope of that rule.** It bans a *background* ledger write, and the mechanism is the **DEK class**,
not HealthKit. So it also covers any interactive path that can fire while locked: notification
actions (`setNotificationCategoryAsync` — the pattern already shipped at
`src/features/kaizen/services/reminders.ts:82-88`), interactive-widget AppIntents, and share
extensions. **He3d must therefore declare every reminder action `authenticationRequired: true`** so
iOS unlocks before handing the action to the app, or must not offer log-from-notification at all.
Health ships no notification actions today, so this is a forward-looking constraint — but He3d is
where “Log water” / “Mark habit done” would land, and under the current DEK class it would fail as a
**silent no-op**. Record the choice in He3d; if product wants log-from-locked, the DEK class must
change first (§16 Q8’s option set).

⚠️ **Single-device restore is a total-loss path.** A `ThisDeviceOnly` DEK is *"useless if it's
restored to a different device"* (Apple Platform Security) — it is not carried by an encrypted
iCloud/iTunes backup, and Apple treats Quick Start carrying it as a bug. So a user who loses or
replaces their phone loses the ledger permanently. **He9 cannot exit until this is answered** —
see §16 Q8.

**DoD He2.** Health DEK key string asserted `!==` both sibling keys in one Jest process; DEK class
asserted by test; `.db`, `-wal`, `-shm` all carry `CompleteUntilFirstUserAuthentication` **after**
WAL enable (re-applied post-open, asserted on device); logout deletes all three files (test asserts
non-existence, not just the `deleteDatabaseSync` return); first-launch-after-reinstall sweep fires
when the install-generation flag is missing **and** a negative test proves it does not touch a
House/Budget key.

**He4:** Copy House sync client → Health names. **No SSE / EventSource client.**
Sync = mailbox pull + `health_sync_wake`. Invite UI = second device only.
Re-assert mailbox ack/idempotency tests against the personal household id.

**DoD He4.** Mailbox deposit/pull/ack round-trip against the **personal** household id; ack
idempotency (double-ack is a no-op); `deviceBelongsToUser` 403 for a foreign device id;
`X-Health-Local-First` present on every `/v2` call; **wake delivered device-A → device-B in a
one-user household** (this is the §2 item 4c fix — it fails today by construction); grep test
asserting no `EventSource` / `WebSocket` import anywhere under `src/features/health/local`.

**He8:** checkpoints inherited. Publisher = the sole user (they are “owner”).

**DoD He8.** Checkpoint seal/install round-trip; catch-up refuses a checkpoint whose version vector
is behind this device’s own writes (House’s extra guard); second-device bootstrap from checkpoint +
op tail with the log truncated below the watermark; **checkpoint publish idempotent on
`(householdId, generation)`** and **bootstrap idempotent** — a re-run must be a no-op, not a
duplicate ledger.

### 5.1 App wiring — four integration points 🆕 (owned by He2/He4)

House §6.1 exists because each of these fails **silently**. Health has the same four; v1.5 named none
of them in a phase and `authStore.ts` was the one File Plan row with no task. **He2/He4 owns this,
not He3** — the session must be open before He3’s Proxy exists, or the Proxy’s
`catch { /* fall through to remote */ }` silently routes back to D1.

| Point | Sibling site | Health form |
|---|---|---|
| Post-sign-in session open | `src/stores/authStore.ts:199,206` | `ensureHealthLocalSession()` — one household, no lazy fan-out |
| Post-hydrate cold start | `authStore.ts:409,417` | same; gate on `hasHydrated && isAuthenticated` |
| Logout teardown | `authStore.ts:269,272` (cache wipe already at `:142`) | `teardownHealthLocalSession({ wipe })` — deletes `.db`, `-wal`, `-shm` **and** the DEK |
| Ledger refresh bridge | `startHouseLedgerRefreshBridge()` | `startHealthLedgerRefreshBridge()` at session open, idempotent (§7 refresh contract) |

**Failure mode if missed:** the ledger is closed on cold start, every `local*Api` call throws, the
Proxy falls through to D1 — the dual-world state §1.3 rejects, arrived at by omission rather than by
decision.

Also inherited from House §6.1/§6.2: **`cryptoPolyfill` must be imported as a bare static
side-effect before any `@symply/local-first` import** (`@noble/*` captures `globalThis.crypto` at
module load), and `await import()` throws under Jest without `--experimental-vm-modules` — go static.

**Added to DoD He4:** all four points wired; `startHealthLedgerRefreshBridge()` idempotent;
`cryptoPolyfill` import order asserted by a lint rule or import-order test, **not by review**; and a
test proving that with the session **not** opened, a `local*Api` read **throws and is not silently
served from D1**.

---

## 6. Stage He5 — personal household 🆕

- Mint/reuse one Health household; **refuse second member `user_id`**.
- Second-device enrolment via QR / `simplehealth://lf-invite`.
- Account-switch wipe; first-launch Keychain sweep before sign-in (§1.3 “First launch after iOS
  reinstall”).
- Brand the second-device QR payload — the shared Worker returns a **Budget** scheme today
  (`local-first-v2.ts:506`); see §2 item 5.
- Watch not a replica.

**DoD He5.** Two sims, same account, converge on a **synthetic single-table fixture** written
directly through `mutateLocalHealthLedger` (no screens); `privacy-cross-user-leak.yaml` green
**after** personal-HH mint; control-plane test: adding another userId → 403; no invite-member
strings in Health Settings.

⚠️ Wave-A convergence *through the storage modules* is a **He12(partial)** Exit, **not** a He5 Exit.
v1.5’s “Wave A converge” made He5 depend on He3 (which puts Wave A data in the ledger) while §0
made He3 depend on He5 — a cycle neither stage could exit.

---

## 7. Stage He3 — storage cutover 🆕

**Do not rewrite screens.** Prefer Proxy on `src/api/health.ts`.

**Hard Exit:** He7-lite in the **same merge**. Summary/streak/trend methods have local
implementations — not `HealthLocalUnsupportedError`.

Coverage: mutating methods local; gaps throw; never fall through to D1 when flag on.

**Merge granularity — four sequenced merges, one ship.** The gate (“no flag-1 device and no brand
default until He7-lite is green”) is correct and stays. What changes is review size: `src/api/health.ts`
is 1,463 lines / 64 `healthApi` methods, the storage layer is 23 modules / ~15.7k lines, and
He7-lite adds summaries, streaks, trends, weekly averages, a reminder scheduler and a widget
projection. House shipped a *smaller* equivalent as one stage and it took its suite from 101 to 413
tests and surfaced four bugs. Land behind the flag as:

| Merge | Content |
|---|---|
| **He3a** | `apiParity.test.ts` (both directions, written reason per remote-by-design method) + the Proxy on `src/api/health.ts` + **weight only**, end-to-end incl. airplane mode. Establishes the pattern |
| **He3b** | The remaining seven Wave A tables against the now-fixed pattern |
| **He3c** | He7-lite summaries — daily summary, streaks, trends, weekly averages, each with a unit test asserting parity against the **server’s** fixtures (the port is a differential test of `backend/src/routes/health.ts:1123-1140`; House found four bugs this way) |
| **He3d** | He7-lite reminders + widget/watch slice — measured pending count on the He10 corpus, allowlist, `.privacySensitive()`, file protection, wipe-on-logout |

**Exit is unchanged: no flag-1 device and no brand default until He3a–He3d are all green.**

**Read windows are part of the contract.** “Storage signatures stay” must not silently convert a
bounded server read into an unbounded ledger scan. `healthNutritionStorage.ts:226-245` requests a
**120-day** window server-side; a naive local `listNutrition()` returns the whole table, and
`src/features/health/screens/HealthHomeScreen.tsx:198-219` calls it plus 16 other loaders on every focus (~11–22k rows at the
10-year corpus). Record every window in `src/features/health/local/windows.ts` — one constant per
loader — with a unit test asserting the local method returns no more rows than the window.
**A local method that returns the full table where the remote returned a window is a He3 blocker,
not a perf nit.**

**Refresh contract (normative).** v1.5 said `notifyHealthLedgerChanged` refreshes “in-memory
listeners the screens already use.” Those listeners **do not exist**: Health screens are a 17-way
`Promise.all` into component-local `useState` driven by `useFocusEffect`
(`src/features/health/screens/HealthHomeScreen.tsx:198-219`); there is no React Query, no Zustand store for Health domain data,
and no emitter in any `health*Storage.ts`. Specify it as:

- **Producer.** `notifyHealthLedgerChanged(tables: readonly HealthLedgerTable[], origin: 'local' | 'ingest' | 'inbound' | 'restore')`,
  called once per applied delta from the engine — not from each repo method. Payload is **table
  names only, never row data** (analytics/log leak surface, §15).
- **Local echo emits nothing.** `origin: 'local'` is a no-op for subscribers — the mutating screen
  already rendered its own write, and fanning out there refetches on every save. (House as-built
  rule, `src/features/house/local/engine.ts:352`, which notifies only when `!isLocalEcho`.)
- ⚠️ **`'ingest'` notifies.** A HealthKit drain (§11) writes through `mutateLocalHealthLedger` on
  this device, so it is technically a local echo — but **no screen rendered it**, which is the entire
  premise of the `'local'` no-op. Tag the drain `'ingest'` and fan out. The existing
  `useHealthSyncStore.markSynced()` calls (`healthKitBackgroundSync.ts:108`,
  `useHealthKitConnection.ts:118`) must be **kept** until `useHealthLedgerHydration` fully replaces
  `useHealthKitSyncHydration`, or the HealthKit refresh that ships today — and is pinned by
  `src/features/health/__tests__/useHealthKitSyncHydration.test.tsx` — regresses at He11.
- ⚠️ **Session lifecycle also notifies.** “Once per applied delta” covers steady state only.
  `notifyHealthLedgerChanged(ALL_HEALTH_LEDGER_TABLES, 'restore')` must additionally fire (i) at the
  end of `ensureHealthLocalSession()` once the ledger is hydrated, and (ii) after an account switch.
  House does exactly this — of its nine `notifyLedgerChanged` call sites only `:352` is the delta
  path; `:439`, `:1022`, `:1034`, `:1219`, `:1323` and `:1450` are session-activate / property-switch
  / restore events with no delta at all. This is what makes a cold start whose screens mounted
  **before** the session opened converge without a navigation event. Omitting it is why the
  `useFocusEffect` race in §5.1 would otherwise leave Home permanently empty.
- **Consumer.** A `healthLedgerStore` (Zustand, mirroring `src/stores/healthSyncStore.ts`) holding
  `{ revision, touched }`, plus `useHealthLedgerHydration(hydrate, tables)` copying the two guards
  from the one Health mechanism that already solves this — `useHealthKitSyncHydration`:
  **`useIsFocused`** (only the visible tab refetches; waking hidden tabs stampedes MMKV + `setState`
  and starves the JS thread) and **`InteractionManager.runAfterInteractions`**. Each screen adds one
  hook call beside its existing `useFocusEffect`; **no screen state management is rewritten**.
- **Table filter.** A screen re-hydrates only if `touched` intersects the tables it renders. Type it
  `Record<HealthLedgerTable, readonly HealthScreenKey[]>` so a 9th table cannot compile without a
  mapping.
- **Re-entrancy.** Fire-and-forget; **must not** be awaited inside the projection apply loop, and
  subscribers may not call `mutateLocalHealthLedger` synchronously from the handler.

Outbox deleted, not migrated — see **§1.3a** for the data-continuity consequence, which is the
part of this that reaches users.

**DoD He3 — tagged by merge**, so each of He3a–d has its own bar rather than one flat list checked
before the last merge:

| Merge | Exit |
|---|---|
| **He3a** | `apiParity.test.ts` green **both directions** with a written reason per remote-by-design method (incl. the food-challenge and §1.5a register dispositions); Proxy in place; **weight** end-to-end incl. airplane mode; **export-before-upgrade CSV shipped and header-absent-tested** (§1.3a); **first-launch data-continuity copy present** |
| **He3b** | The other seven Wave A tables airplane-mode (`waveATables.test.ts`); **read-window test per loader** (`windows.test.ts`); **Notes stay MMKV** (`health.notes.v1`) — no 9th ledger key; outbox gone; screens near-empty diff |
| **He3c** | On-device daily summary / streaks / trends / weekly averages, each parity-tested against the **server’s** fixtures; the **six** refresh-contract cases in §12.1 |
| **He3d** | Rolling-horizon reminders (≤56/64, bounded reschedule, `authenticationRequired` decision recorded); widget slice with the never-list asserted; Q3a default per §9 |
| **All four** | `npx jest src/features/health` green on the local path; new/changed Health local + storage files TypeScript **strict**; **He7-lite DoD also checked** |

**App wiring is owned by He2/He4, not He3** — the session must be open before the Proxy exists.
See **§5.1**.

---

## 8. Stage He6 — blobs 📐 **BLOCKED**

House H6 is design-only; **no blob code**. Health **must not** schedule cutover on it.

| Path | When |
|---|---|
| **Wait** | House H6 DoD (client + Worker + D1 + sweep) then port |
| **Health-owned MVP on `main`** | If Wave D photos are needed sooner: Worker-proxied ciphertext PUT, prefix `lf-blob/`, tables `lf_blobs` / `lf_blob_chunks`, migration **next free ≥ 0157** claimed on `main` first |

`0156` is **`lf_devices_composite_pk`**. Never `0156_lf_blobs.sql`.

Mailbox-sized payloads: Worker streams opaque body (R2 binding; no presign). Body photos
(Wave D) over the Worker request-body cap — **100 MB Free/Pro, 200 MB Business, 500 MB Enterprise**
(Cloudflare states these in **MB**, not MiB; Enterprise is 500 MB *by default*. It is an
**account-plan** limit surfaced as the zone’s *Maximum Upload Size* → 413, not a Workers-plan limit.
Cloudflare does not document whether streaming changes this, so **assume it does not**) — need
presigned PUT via `aws4fetch` + R2 API tokens (new secrets) — **not** He6 MVP. R2 multipart
**per-part** is still that same Worker body cap (R2 docs: *“If you have a Worker, its inbound request
size is constrained by Workers request limits”*); large photos stay **presigned client PUT**.
`aws4fetch` is **Worker-compatible and documented by Cloudflare** (*“may continue to use”*) rather
than formally recommended — its presigned-URL page uses the AWS SDKs — but there is **no** native
presign method on the `R2Bucket` binding, so it remains the practical choice. It is **not currently a
dependency** (`backend/package.json`); whichever Wave D task needs it must add it.

Wave A must **not** expand plaintext `user_files` upload.

---

## 9. Stage He7 — server-compute displacement 🆕

Summaries, statistics, streaks and cycle predictions are computed **on the Worker** — the client is a
thin consumer, as its own header states (`src/api/health.ts:10-12`: *“summaries, statistics, streaks
and cycle predictions are computed server-side so the phone, widget and watch can never disagree”*).
The computation itself lives in `backend/src/services/health-service.ts` and
`backend/src/routes/health.ts:1123-1140`. Under E2EE that is the bug.

| Consumer | Pattern | Wave |
|---|---|---|
| Daily summary, streaks, trends, weekly averages | **P1** on-device | **He7-lite = He3 Exit** |
| Cycle predictions | **P1** | Wave C |
| Reminders | **P1** rolling horizon | He7-lite |
| Widget / Watch | **P1 + App Group slice** | He7-lite |
| Coach | **P2** BYOK + allowlist/redaction (House H7) | Wave D |
| FatSecret search | **Tier B** (meal-string threat accepted) | keep |
| `/health/sync/*` | **P4** | He3 |

**He7-lite widget DoD:**

- Allowlist fields only (water/steps OK; **weight default off**; **cycle, injury, vitality never** on lock screen / Always On).
- ⚠️ **`.privacySensitive()` does essentially nothing by default — do not treat it as a control.**
  SwiftUI redacts only when the `.privacy` redaction reason is applied, and **WidgetKit does not
  apply it automatically**: on the iOS Lock Screen *“the default behavior is to show your content
  even while the device is locked… this is configurable in Settings, and users can choose to redact
  their widget when locked”*, and on watchOS *“by default, your content is **not** redacted in low
  luminance”* (WWDC22-10050). So a weight or calorie field marked `.privacySensitive()` **renders in
  the clear on the lock screen for every user who has not opted into redaction.** Keep the modifier —
  it is correct for the users who do opt in — but the **write-boundary allowlist below is the only
  enforcement mechanism**, which is exactly why cycle / injury / vitality must never be written into
  the slice at all.
- ⚠️ **File protection — v1.5 asked for two things that cannot both hold.** A glance file written
  `.completeFileProtection` is unreadable while the device is locked, and declaring
  `NSFileProtectionComplete` on the widget extension is precisely the opt-in that makes WidgetKit
  blank the whole timeline whenever the device is locked (Home Screen included, not just Lock
  Screen). A lock-screen glance and complete protection are mutually exclusive.
  **Decision (Q3a) — pick one and record it:**

  | Option | Glance file class | Widget entitlement | Lock-screen behaviour |
  |---|---|---|---|
  | **A — glance works** (recommended; matches He7-lite intent) | `CompleteUntilFirstUserAuthentication` (the default — do **not** set `.completeFileProtection`) | none | Renders — **in the clear by default**; `.privacySensitive()` applies only for users who opt into lock-screen redaction |
  | **B — maximum protection** | `.completeFileProtection` | `NSFileProtectionComplete` | Widget is a **placeholder whenever locked** — He7-lite ships permanently dark |

  Under Option A the App Group default is already `CompleteUntilFirstUserAuthentication`, i.e.
  encrypted at rest and locked until first unlock; App Groups add no extra encryption layer either
  way. Escalating to complete protection buys only the ~10-minute-after-lock window and costs the
  entire feature.

  **Q3a gates *enabling* the glance, not He3d — it must not strand He3a–c.** If Q3a is still open
  when He3d is ready, ship **Option A’s file class by default** — do **not** set
  `.completeFileProtection` and do **not** add `NSFileProtectionComplete` to the widget entitlement
  (both are opt-ins; the App Group default is already `CompleteUntilFirstUserAuthentication`) — with
  the glance **dark** and in-product copy, per §0. The security-critical control is unchanged and
  unblocked either way: cycle / injury / vitality are never written into the slice, which
  `widgetSlice.test.ts` asserts regardless of file class. Answering Q3a later flips the glance on
  with **no** file-class migration. What §17 forbids is guessing Option **B** — adding the
  entitlement is irreversible for shipped widgets and permanently dark.
- **The never-list is enforced at the write boundary, not by file protection.** `cycle`, `injury`
  and `vitality` are never written into the App Group slice at all (§12 already says so). That is
  the real control.
- Wipe slice on logout / teardown.
- **Widget freeze is unconditional, not conditional.** §14 step 10b proves no flag-0 install remains,
  so “truncate while flag-0 clients exist” cannot legitimately occur (§14, rejected order 3) — but
  freeze or dark the D1 `/health/widget/snapshot` path **before** truncate anyway, as the belt
  against a mis-executed 10b. Empty-safe snapshot or explicit widget-dark; Watch/Widget must not 500
  or render another user’s leftover App Group file. **Prefer the client-side dark** — the Health
  widget reads only its App Group slice and makes no network call of its own, so no Worker change and
  no new Version ID is needed (§14 step 10).

**Notification budget:** iOS **64** pending cap. Rolling one-shot dailies **each consume a
slot** (repeating triggers count as one). Budget ≤56 used / 64 (House H7-lite measured 30 scheduled
against a 56-slot budget on the 10-year corpus).

**Bound the rescheduling.** “Reschedule on every foreground” is unbounded — up to 56 cancels +
re-schedules per foreground, with §15’s debug count as the only signal. Reschedule **only when the
reminder set’s content hash changes, or ≥6 h since the last reschedule, whichever is sooner.**
Measure the reschedule cost on the He10 corpus and publish it. Assert
`(await Notifications.getAllScheduledNotificationsAsync()).length <= 56` after every reschedule and
log a monitored error above it.

**Overflow behaviour is documented, and it is neither “oldest” nor “newest”.** Apple’s (deprecated)
`UILocalNotification` reference: *“the system keeps the **soonest-firing 64** notifications (with
automatically rescheduled notifications counting as a single notification) and discards the rest.”*
So the horizon is truncated **from the far end** — a rolling-horizon scheduler that overruns loses
its furthest-out reminders, not its nearest, which is the benign direction but must not be assumed.
The modern `UserNotifications` reference does not re-state this, so treat it as **documented for the
legacy API and not re-affirmed for `UNNotificationRequest`**. Do not rely on a callback. The ≤56
budget is the mitigation either way.

Optional `BGAppRefreshTask` to refill; not required for He7-lite Exit if foreground refill is
documented. Q7: users who never open the app lose the horizon — accepted with in-product copy.

⚠️ **Wave C contends for the same 64 slots.** Cycle predictions + habit reminders + hydration on a
rolling one-shot horizon all draw from one pool. Name the per-feature allocation in He7-lite before
Wave C schedules anything.

**P3 to server is not approved.**

---

## 10. Stage He9 — backup / restore / export ♻️

Archive v2 + D-20 live-wins. One archive per user. CSV omits cycle/injury/coach by default.
Blob manifests only after He6. No company restore.

⚠️ **He9 cannot exit until Q8 is answered: how is the archive keyed?** With a `ThisDeviceOnly` DEK
(§5) a lost or replaced phone loses the ledger permanently — Apple states such an item is “useless
if it’s restored to a different device,” and Quick Start carrying it is treated as a bug. Options:
(a) user-held recovery phrase / passphrase-wrapped archive as the **only** restore path, with hard
onboarding copy; (b) escrow the DEK to iCloud Keychain (drop `ThisDeviceOnly`, accept sync);
(c) require ≥2 enrolled devices before the ledger counts as durable. Pick one — see §16 Q8.

---

## 11. Stage He11 — HealthKit + Wave C 🆕

Ingest adapter, not a sync peer. Default **read-only** vs Apple.

**Q2 lock before code:** weight, steps, active energy, workouts, sleep. No heart-rate write,
no CDA, **no HealthKit water** until `water_entries.source` exists.

- Persist `HKQueryAnchor` **per `HKSampleType`** in the encrypted store (not plain UserDefaults).
  Anchor survival across reinstall / major OS upgrade is **not** promised by Apple — specify the
  recovery path when a persisted anchor is rejected: **full re-scan with UUID-based dedupe**.
  Without it the failure is a silent gap or a duplicate storm.
- Idempotency: `HKSample.uuid` → op / `deterministicRowId`. Manual same-day weight vs HK:
  **both kept** if ids differ. **O2 is a He1 decision, not a He11 one** — see §16; a `date+source`
  builder changes the registry He1 freezes.
- ⚠️ **Two-tier native pre-JS queue — the locked branch cannot stage UUIDs.** Staging
  `{type, sampleUUID, deleted}` requires *reading* HealthKit, and HK reads fail on a locked device
  with `errorDatabaseInaccessible` (health data is Protected Unless Open, access relinquished
  **~10 min after** lock — so a wake inside that window may still read). **Branch by probing, not by
  assuming:**
  - **Attempt the anchored fetch first.** If it succeeds — including on a locked device inside the
    10-minute window — stage UUIDs and advance the anchor as normal.
  - **On `errorDatabaseInaccessible`:** record only *“type X is dirty”* in the file-protected staging
    table (`CompleteUntilFirstUserAuthentication`, no DEK — see §5), call the completion handler, and
    **do not advance the `HKQueryAnchor`**.

  Drain to signed ops on foreground. Do not rely only on a local notification.
- **`HKObserverQuery` completion is Swift-owned.** Register observers **at launch** (before the
  first background wake). Call `completionHandler` **only after** the native staging write **and**
  the anchored fetch attempt, on **every** branch including `error != nil`. Omitting it on any
  branch triggers Apple’s documented **three-strike** cutoff (“If your app fails to respond three
  times, HealthKit assumes your app can’t receive data and stops sending background updates”).
  Calling it *early* does not stop delivery — it lets iOS suspend the process before the write
  lands, which is a **data-loss** risk, not a delivery-halt. (Apple does not state this on the
  HealthKit pages; it follows from the general background-task contract. The three-strike rule, by
  contrast, **is** documented verbatim on both `HKObserverQueryCompletionHandler` and
  `enableBackgroundDelivery(for:frequency:withCompletion:)`.) JS drain of the queue is a **separate**
  step and must not own the handler when Hermes is down.
- Entitlement `com.apple.developer.healthkit.background-delivery` — **already present** at
  `ios/SymplyEcosystem/SymplyEcosystem-Health.entitlements:41` and `-Release.entitlements:36`.
  Verify in He11 DoD; it is not new work. Background delivery additionally requires an
  `HKObserverQuery` **and** `enableBackgroundDelivery(for:frequency:)`.
- Watch is glance-only; **no** watchOS HealthKit background-delivery parity in Wave B.
- Accepted delay if JS never runs: samples import on next foreground — **product-accepted gap**,
  not silent.
- Android Health Connect: reduced parity (Q5); manual paths required.

Wave C: same Proxy pattern; injury → workout library gate ports to client.

---

## 12. Verification

| Layer | Check |
|---|---|
| Package | `npx vitest run` in `packages/local-first` |
| Health local | `npx jest src/features/health/local` |
| Health existing | `npx jest src/features/health` on local path |
| Oracles | `npx jest src/features/budget/local` · `src/features/house/local` |
| BE | `cd backend && npm run typecheck`; `local-first-api-gate`; **410 matrix** (FatSecret GET vs mutating `/health`) |
| Flag | `flag.test.ts`; 410+flag stuck-window forbidden by construction |
| Privacy | `e2e/maestro/health/privacy-cross-user-leak.yaml` |
| Widget | snapshot-after-truncate / dark; **no cycle / injury / vitality** in App Group |
| AI-off / HK-off | core log + review |
| E2E | Budget MM suite port: **same user**, two devices; no invite-partner copy |
| Same-commit Worker | Version ID recorded **before He12(partial)** |
| TS | He1 + He3 DoD: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` |

Note: `packages/local-first` has no root `vitest.config.ts`, so a bare `npx vitest run` also sweeps
`__tests__/scale/**` (which has its own `vitest.scale.config.ts`). Use the scale entry points when
you do not want the corpus runs.

### 12.1 Named tests — one file per new surface 🆕

v1.5 named commands, not tests. Rows marked **security-critical** are promoted into the DoDs above.

| Surface | Named test | Status |
|---|---|---|
| `registryGuard` 8 keys + builder rules | `local/__tests__/registryGuard.test.ts` | DoD He1 |
| Deterministic ids — per-builder convergence + weight counter-test | `local/__tests__/deterministicIds.test.ts` | DoD He1 |
| Engine round-trip + tombstone | `local/__tests__/session.test.ts` | DoD He1 |
| DEK distinctness + class | `local/__tests__/healthSession.test.ts` | DoD He2 |
| **Keychain reinstall sweep** (+ negative: does not touch House/Budget keys) | `local/__tests__/keychainSweep.test.ts` | **security-critical**, DoD He2 |
| **WAL/SHM teardown** — asserts non-existence of all three files | `local/__tests__/teardown.test.ts` | **security-critical**, DoD He2 |
| 410 matrix — one row per non-Wave-A prefix asserting **2xx/4xx, not 410**, with the header present; plus method-gating (GET on a Wave A path stays 2xx) | `backend/src/middleware/__tests__/health-local-first-gate.test.ts` | DoD He0 |
| `/v2` fail-closed on `"False"` / `"0"` / `""` | extend `backend/src/config/__tests__/local-first-api.test.ts` (**invert** its two `unset → true` assertions per §1.7a) **and** `backend/src/middleware/__tests__/local-first-api-gate.test.ts` — two different existing files, both real | DoD He0 |
| Personal-household push wake A→B; **no self-wake** on either call site | `backend/src/services/__tests__/local-first-sync-wake-service.test.ts` | DoD **He0** (the fix) and re-asserted in DoD He4 (against the personal household id) |
| Wake routing — unrouted type fails | `src/hooks/__tests__/useNotificationHandler.test.ts` | DoD He0 |
| Second-user rejection → 403 | control-plane test | **DoD He0** (promoted — compensating control for dropping `excludeUserId`), re-asserted He5 |
| `notifyHealthLedgerChanged` contract — **6 cases** (local no-op; `ingest` fans out; inbound hits Home not Habits; hidden tab skipped; re-entrant subscriber does not loop; **session opened after a screen already hydrated re-hydrates it without a navigation event**) | `local/__tests__/ledgerRefresh.test.ts` | DoD He3c |
| Read windows — per loader | `local/__tests__/windows.test.ts` | DoD **He3b** |
| Per-table airplane-mode round-trip, 7 tables | `local/__tests__/waveATables.test.ts` | DoD **He3b** |
| Export-before-upgrade reads D1 with the header **absent** | `local/__tests__/exportBeforeUpgrade.test.ts` | DoD He3a |
| Method parity, both directions | `local/__tests__/apiParity.test.ts` | DoD He3a |
| Summary/streak/trend parity vs **server fixtures** | `local/__tests__/summaryParity.test.ts` | DoD He3c |
| **Widget allowlist — no cycle/injury/vitality in the App Group slice** | `local/__tests__/widgetSlice.test.ts` | **security-critical**, DoD He3d |
| Notification budget ≤56 after reschedule | `local/__tests__/reminders.test.ts` | DoD He3d |
| Analytics denylist (see Appendix C.1) | `src/services/__tests__/analyticsDenylist.test.ts` | DoD He3 |
| HealthKit idempotency (`HKSample.uuid` → op) | `local/__tests__/healthKitIngest.test.ts` | DoD He11 |
| Pre-JS queue drain, locked + unlocked branches | `local/__tests__/preJsQueue.test.ts` | DoD He11 |
| Checkpoint + bootstrap idempotency | `local/__tests__/checkpoint.test.ts` | DoD He8 |

---

## 13. File ownership

| Area | Primary | Ack |
|---|---|---|
| Package | `packages/local-first/**` | Budget + House |
| Health ledger | `src/features/health/local/**` | — |
| Storage cutover | `health*Storage.ts`, `healthRepository.ts`, `src/api/health.ts` | — |
| 410 middleware | `backend/src/middleware/` (new Health gate) | Health only |
| Wake allowlist | `local-first-sync-wake-service.ts` | shared — fleet blast |
| **Shared `/v2` routes** | `backend/src/routes/local-first-v2.ts` (wake-type selector `:53`, `excludeUserId` `:288`/`:670`, QR scheme `:506`) | **shared — fleet blast.** Land on `main` |
| **Gate config** | `backend/src/config/local-first-api.ts` (fail-closed), `brand-capabilities.ts`, `backend/src/index.ts` (gate + rate-limit registration) | shared — fleet blast |
| **Notification routing** | `src/hooks/useNotificationHandler.ts` | shared client |
| **Auth wiring** | `src/stores/authStore.ts` (§5.1 — He2/He4 owns it) | shared client |
| HealthKit | `healthKit.ts`, `healthKitBackgroundSync.ts`, `modules/symply-healthkit/` | He11 |
| Scale baseline | `packages/local-first/__tests__/scale/**` + `documents/engineering/testing/` | — |
| **Store health declarations** (Apple medical-device status, Play health) | **unowned — assign before He12 (full)** | Q9 |

Shared code on **`main`**. Client on **`health-v2`**. Never `deploy:fleet` from this clone.
Never `--env dev`.

**Secrets:** `eval "$(./scripts/secrets/export-env.sh)"`. Worker:
`wrangler secret put LOCAL_FIRST_API_ENABLED --env staging|production` (and FatSecret
already). Never print values. Never commit `.env.local`.

---

## 14. Deployment order & rollback

```text
He12(partial) — D1 still exists (flag-0 may still use it)
1. He0 on main → backend tests (Q1 not required)
2. From MAIN, staging-only first (deploy:fleet has NO pause):
     cd backend && npm run deploy:health:staging
     (+ Kaizen/House staging if shared gate code changed)
3. Live GET /v2/households: Health staging 401 vs Kaizen staging 404
4. Only then: eval "$(./scripts/secrets/export-env.sh)" && npm run deploy:fleet
   (script then re-deploys all staging and all production — do not start it if step 3 failed)
5. Record Health Worker Version ID (must postdate backend/src commit) — before He12(partial)
6. Wave A binary may install with flag=0 (D1 still SoT)
7. Internal/lab devices: EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1 (header → 410)
8. He12(partial) two-device E2E (brand default still off). Do **not** truncate yet.

He12 (full) — only after He12(partial) is green
9.  Q1 checkbox closed + HBNR legal copy (Appendix C + C.1)
10. Widget/Watch freeze BEFORE truncate. PREFER the client-side dark (widget writes an
    explicit empty-state slice; no Worker change, Version ID preserved).
10a. IF step 10 required an empty-safe SERVER snapshot instead, that is a Worker deploy:
    re-run deploy:fleet from main, RE-RECORD the Health Worker Version ID, confirm it
    postdates the widget-freeze commit. That id — not step 5's — is what step 13 matches.
10b. PROVE THE FLAG-0 COHORT IS EMPTY. Record all three numbers:
       (i)   store build pulled or superseded by a flag-1 binary
       (ii)  EAS Updates dashboard: 100% of the active channel on the flag-1 update
       (iii) the health_flag0_mutation counter (§2 item 10) reads ZERO over a continuous
             7-day window, AND a positive control was recorded first: deliberately issue
             one header-less POST to a Wave A path on STAGING and confirm the event appears.
             A zero with no positive control is NOT a proof — it is an unconfigured query.
             (Production emits no request logs at all today — index.ts:126-132 — so this
             leg is unanswerable until §2 item 10 ships.) Workers Logs retention is days,
             not months: if the 7-day window cannot be shown in one query, extend retention
             or Logpush to R2 BEFORE starting the window.
     If any flag-0 install may still be opened — STOP. Do not truncate.
11. Snapshot Health D1 → R2 (`wrangler d1 export`), record the Time Travel bookmark,
    then truncate EXACTLY THE 8 WAVE A TABLES named in §1.5:
      weight_entries, water_entries, nutrition_entries, health_entries,
      body_measurements, user_habits, habit_logs, health_goals
    WAVE C IS NOT TRUNCATED (cycle_settings, period_entries, cycle_symptom_entries,
    mens_health_entries, mens_health_settings, injuries, custom_foods, recipes,
    fridge_items, health_reminder_preferences) — it has no ledger until He11b.
    ALSO truncate the derived cache health_weekly_weight_averages: it is Tier D
    recompute (§1.5) whose source rows are being deleted, and leaving it behind is
    plaintext residue of ledgered data (Appendix C.1). He7-lite recomputes on device.
    Challenge tables are NOT truncated but ARE invalidated by the nutrition
    truncate — see §1.5.
12. Wipe/reinstall lab devices
13. Post-truncate two-device E2E against the Version ID from step 5, or from 10a if it ran.
    The rule is SAME COMMIT AS THE CLIENT UNDER TEST. Do not flip brand default if red.
14. Brand default on
```

**Normative — three rejected orders, do not follow any of them:**

1. Truncating before step 8 (v1.3 §14 bug). He12(partial) **excludes** Q1 truncate.
2. Flipping brand default-on after step 12 without step 13 (v1.4 §14 bug).
3. **Truncating “Tier A” literally, or truncating “while remaining flag-0 clients exist” (v1.3–v1.5
   §14 bug).** That sentence was mis-ported from House §14.1, where it was safe because no device had
   gone local-first yet and the D1 rows were lab junk. Here the truncate is step 11 — *after* step 7
   flips devices to flag-1 — so “remaining flag-0 clients” are exactly the clients for which D1 **is**
   the system of record, and per §1.3a a successful read of the emptied D1 destroys their MMKV mirror
   too. §1.7 lists this as a forbidden window. Step 10b replaces it.

**Failed mid-fleet:** `deploy:fleet` cannot stop between staging and production. He0 `/v2`
proof therefore uses **staging-only** scripts. If that proof fails: **do not** run
`deploy:fleet`. Revert gate, re-run staging-only, re-prove, then fleet.

`deploy:health:all` only when the change is Health-wrangler-only (comment, secret). Shared
`index.ts` / wake allowlist / middleware → **`deploy:fleet`**.

### 14.1 Rollback

| Step | Undo | Cannot undo |
|---|---|---|
| He0 comment/JSDoc | revert + deploy | — |
| `health_sync_wake` allow | revert allowlist | — |
| 410 middleware | revert; flag-0 clients already on D1 | — |
| Client flag | EAS Update `=0` | binaries without Updates until fetch |
| DO tag `v4` | **cannot remove** | already applied |
| Q1 D1 truncate | restore from R2 snapshot **or** `wrangler d1 time-travel restore --timestamp=…` | see note below |
| Blob DDL ≥0157 | leave empty tables; do not DROP shipped migration | the DDL |
| Crypto bug | wipe tester DBs; rotate builds | |
| He1 / He2 | revert client merge; ledger files unused by a flag-0 build | — |
| **He3 cutover** | **see “Return to D1” below** | any mutation made only in the ledger since flag-1 |
| He4 / He8 | revert client; mailbox blobs expire on the 14d TTL | deposits already made (opaque, no reader) |
| He5 personal household | `lf_households` row may be left; metadata-only | the household id, once minted |
| He7-lite | dark the widget + cancel all pending notifications on downgrade | notifications already delivered |
| He9 / He10 / He11 | revert; no persisted state | — |

**Snapshot mechanism (v1.5 named none).** `npx wrangler d1 export <db> --remote --output=./health.sql`
then `wrangler r2 object put`. A running export **blocks other database requests** — schedule the
window. For a Worker-driven variant, `POST /accounts/{id}/d1/database/{id}/export` with
`{"output_format":"polling"}`, poll to a `signed_url`, stream into R2.

⚠️ **“No snapshot → no undo” was wrong — but Time Travel is not a per-table undo.** D1 Time Travel
restores any point within the last **30 days** (Workers Paid; 7 free) and explicitly covers
*“a `DELETE` or `UPDATE` statement without a specific `WHERE` clause”*. Record the pre-truncate
bookmark from `wrangler d1 time-travel info` as a second belt. Four constraints that decide how it
can actually be used:

- **Restore is a destructive, whole-database, in-place overwrite.** §14 step 11 deletes 8 tables and
  deliberately leaves ~20 Wave C tables live **in the same database**, so a Time Travel restore to
  undo the Wave A wipe would also roll back **every Wave C write since the wipe**. The R2 `.sql`
  dump is the only **selective** recovery path — it is not optional belt-and-braces.
- **SQLite/D1 has no `TRUNCATE`.** The step-11 operation is `DELETE FROM <table>`; “truncate” in
  this document is shorthand, not the SQL verb.
- Restores are rate-limited to **10 per 10 minutes per database**, and Time Travel requires the
  database to report `version: production` — check `wrangler d1 info` for the Health DB **at the Q1
  gate**, not at incident time.
- It does **not** restore the client-side MMKV mirrors destroyed per §1.3a.

**Return to D1 (flag-1 → flag-0, D1 NOT truncated) — normative order.**
Valid **only** before He12 (full) step 11. After the truncate this path does not exist (§1.7).

1. **Export first.** Run the He9 archive on the device and store it off-device. Anything created
   since flag-1 exists only in the ledger — it is not in D1 and the outbox is gone.
2. **Tear the ledger down *before* the flag drops** — delete `symply-health-local-first.db`, `-wal`,
   `-shm` and the Health DEK. If the flag drops first, `readThrough` overwrites the MMKV mirrors with
   the D1 answer (`healthRepository.ts:358-366`) while an orphaned encrypted DB is left on disk.
3. EAS Update `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0`. The client stops sending `X-Health-Local-First`,
   the 410 lifts, `/health` reads repopulate MMKV from D1.
4. Re-enter post-flag-1 data by hand from the step-1 archive. **There is no automated re-import** —
   say so in the incident copy.

---

## 15. Monitoring

| Signal | Where |
|---|---|
| Sync terminal errors | `classifySyncError` + Settings card — **never** ledger values in analytics |
| Relay 413 / 403 | Worker logs; `payload_too_large` / `auth` |
| Mailbox unacked | control-plane counts |
| Checkpoint publish fail | owner-device (the sole user) |
| Kill switch | flag `0` + Health `LOCAL_FIRST_API_ENABLED` |
| Ledger size | rows / cold-open vs He10 baseline |
| Pending local notifications | Settings/debug: `(await Notifications.getAllScheduledNotificationsAsync()).length` vs 64 — discard behaviour is undocumented, do not rely on a callback |
| Widget | empty/dark after truncate (expected) vs 500 (incident) |
| **DEK unwrap / AEAD decrypt failure** | count — **alarm on any**. The device silently has no data |
| **SQLite open / corruption failure** | count — **alarm on any** |
| **Ledger write failure** | count — **alarm on any**. A mutate that never persists is the outbox bug this repo already paid for once |
| **Header-less Wave A mutations (the flag-0 cohort)** | Worker logs, `health_flag0_mutation` (§2 item 10). **This is the §14 step 10b(iii) data source** — it does not exist until item 10 ships. Alarm on any after the truncate |
| 410 responses per hour | Worker logs, `health_410` (§2 item 10) — alarm on non-zero **after** the flag-0 cohort is proven empty (§14 step 10b) |
| HealthKit ingest failure + pre-JS queue depth | Settings/debug; alarm depth > 500 |
| Second-device bootstrap / checkpoint-install failure | client telemetry |
| `misconfigured_app_brand` 503 | Worker logs (after any config change) |

Analytics: `src/services/analytics.ts` brand-tagged; **no** weight, meals, cycle, notes.
Enforced by the denylist test in Appendix C.1 — not by intent.

---

## 16. Open questions

| # | Question | Blocks | Lock / recommendation |
|---|---|---|---|
| **Q1** | Wipe authorized? | Truncate | **Open.** Countersign required |
| **Q2** | HK read types | He11 | Weight, steps, energy, workouts, sleep. **Not water** |
| **Q3** | Widget weight? | He7-lite | Default **off**. Cycle / injury / **vitality never** |
| **Q3a** 🆕 | Lock-screen glance **or** complete file protection? | **He7-lite is unbuildable until this is answered** | **Open — product call.** Option A (glance renders) vs Option B (permanently dark when locked). §9 recommends **A**. They are mutually exclusive |
| **Q4** | Activate summary packages? | not Wave A | Listed ≠ enabled |
| **Q5** | Health Connect | He11 | Reduced parity. ⚠️ **“Menstrual Cycle Phases” is a Google **Play policy** high-sensitivity category (announced 15 Apr 2026), not a Health Connect API type** — the record classes are `MenstruationFlowRecord`, `MenstruationPeriodRecord`, `IntermenstrualBleedingRecord`. Affects Wave C declarations either way |
| **Q6** | Coach Wave A? | He3 | **No** |
| **Q7** | Reminder horizon if app unopened | He7-lite | Foreground refill; copy if stale. Does **not** cover Wave C slot contention — see §9 |
| **Q8** 🆕 | How is the He9 archive keyed, given a `ThisDeviceOnly` DEK? | **He9** | **Open.** Lose/replace the phone → ledger gone. (a) user-held recovery phrase, (b) iCloud Keychain escrow, (c) require ≥2 enrolled devices. Do **not** rely on Quick Start |
| **Q9** 🆕 | Who owns the **Apple regulated-medical-device status declaration** (required for new apps from **26 Mar 2026**; existing apps until **early 2027**, after which *“you’ll no longer be able to submit app updates”*) and the **Google Play health declaration**? | store submission **and updates** | **Open — unowned.** Neither appears in §13. Apple’s scope is EEA/UK/US and catches **two** triggers: the Health & Fitness / Medical category **or** frequent Medical/Treatment references in the Age Rating questionnaire. ⚠️ The Play requirement is **already in force** — it stems from the **30 Oct 2025** policy announcement (30 days to comply), *not* a 28 Jan 2026 deadline; the mechanism is the Health apps declaration form in Play Console → App content. Also App Store 5.1.3(ii): health data **may not be stored in iCloud** — interacts with He9 / Q8 |
| **O2** | HK uuid vs one-row-per-day | ~~He11~~ **He1 — the id scheme is frozen there** | **Lock before `ids.ts` is written.** Recommend `HKSample.uuid → deterministicRowId` and **keep both rows** when a manual and an imported reading share a day, distinguished by `source`. One-row-per-day needs a `date+source` builder, which cannot be introduced at He11 without re-keying every existing local row |
| **O6** | ~~FTC HBNR playbook~~ **US consumer-health-data compliance** | **He12 (full)** | Appendix C + **C.1**; legal copy review; mailbox TTL 14d; no health payload in logs. **Widened:** HBNR governs *breach notification*; WA My Health My Data / Nevada SB 370 / Maryland MODPA impose **collection-time** duties that encryption does not satisfy, and MHMDA carries a private right of action. A standalone WA consumer-health privacy page (own homepage link) is a named He12 (full) deliverable |

---

## 17. Abort / descope

| Checkpoint | Trigger | Fallback |
|---|---|---|
| Q1 denied | Real users exist | **Stop.** Migration programme |
| He10 | Any §4 threshold breached after N5 mitigations | Wave A logs only; descope Wave C |
| He3+He7-lite | Cannot port summaries | **Do not merge He3** |
| He7-lite | **Q3a unanswered** | Cannot build the glance — escalate, do not guess |
| He9 | **Q8 unanswered** | Ship no restore claim; ≥2-device durability copy only |
| He6 | House H6 never lands and photos not needed | Wave D stays off |
| He12(partial) | Two-device E2E fails 3 focused attempts | Stay internal flag-on; **no** brand default |
| He12 (full) | Q1 open, HBNR copy unsigned, or **post-truncate two-device E2E** red | Do **not** flip brand default |

---

## 18. Alternatives considered

| Alternative | Why not |
|---|---|
| Keep D1 SoT + outbox | Company-readable PHI; contradicts Budget/House privacy |
| Dual-write during cutover | Split-brain |
| Per-user mailbox fork | Duplicates the DO |
| Inherit House H6 now | **Code does not exist** |
| Automerge / Yjs | **E2EE is the disqualifier, not transport.** (Automerge's canonical transport is WebSocket, not SSE — the v1.5 wording was wrong and a reviewer finds that in one search.) Grounds that hold: Automerge's RN wasm path is community-maintained (JSI binding only landed Feb 2026), and neither ships a zero-knowledge server model |
| ElectricSQL / Zero / Turso sync / Triplit | All architected around a **server-readable** store. Vendor churn is live: Electric pivoted then joined Databricks (Aug 2025); Triplit was acquired by Supabase (Oct 2025) and `triplit.dev` is parked |
| **Evolu** | E2EE-by-default CRDT, MIT self-hostable relay, first-party `@evolu/react-native` (stable 14.3.0, last stable publish Nov 2025). Genuinely meets the zero-knowledge bar. **Rejected on reuse, not capability:** the engine is already built, certified two-device on Budget and reused by House, so adopting it means re-certifying a third engine for one brand |
| **Jazz** | ⚠️ **Same vendor-churn ground as Electric/Triplit, not “reuse”.** The E2EE CoJSON product is now branded **Classic Jazz** on a separate domain; mainline **Jazz 2.0 (alpha)** is *“a local-first relational database… across your frontend, backend and **our global storage cloud**”* with row-level security and **no E2EE claim**. `jazz-rn` is alpha-only; `jazz-expo` last published Jun 2025. Adopting Jazz means pinning to a line the vendor has moved off, or betting on an alpha that no longer advertises zero-knowledge |
| SSE / EventSource as the sync transport | Mobile cannot keep SSE alive; same rejection as Budget |
| Wait for House H12 before He0 | He0–He5 can proceed |

---

## Appendix A — Identifier registry

| Identifier | Value / location |
|---|---|
| `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` | `src/features/health/local/flag.ts` (new). Explicit `=1` → true and `=0` → false are honoured **before** the Jest guard; only the **brand default** is suppressed under Jest (§1.7). ⚠️ Not “Jest → false” — an unconditional false makes the required `=1` pin unpassable |
| `EXPO_PUBLIC_HEALTH_P2P` | off |
| `X-Health-Local-First` | header that **arms** 410 |
| `health_sync_wake` | `{type, householdId}` only |
| `health.localFirst.dek.v1` | SecureStore DEK |
| `symply-health-local-first.db` | expo-sqlite |
| `simplehealth://lf-invite` | second-device enrolment |
| `notifyHealthLedgerChanged` | `(tables, origin: 'local' \| 'ingest' \| 'inbound' \| 'restore')` — §7 refresh contract. `'local'` is a no-op; `'ingest'` (HealthKit drain) **does** fan out. Table names only, never row data |
| `mutateLocalHealthLedger` | matches `mutateLocalLedger` (Budget) / `mutateLocalHouseLedger` (House) |
| `rejectHealthWritesForLocalFirstEarly` | 410 gate — matches `rejectFinancialWritesForLocalFirstEarly` / `rejectHomeWritesForLocalFirstEarly` |
| `HEALTH_SYNC_WAKE_TYPE` | `'health_sync_wake'` — matches `<brand>_sync_wake` |
| `HealthLocalUnsupportedError` | matches `BudgetLocalUnsupportedError` |
| `ensureHealthLocalSession` / `teardownHealthLocalSession` | §5.1 wiring (He2/He4); matches `ensureBudgetLocalSession` / `ensureHouseLocalSession` |
| `startHealthLedgerRefreshBridge` | §7 refresh contract; matches `startHouseLedgerRefreshBridge` |
| `healthLedgerStore` / `useHealthLedgerHydration` | §7 consumer side |
| `src/features/health/local/windows.ts` | per-loader read windows (§7) |
| Deterministic builders | `habitLog_${habitId}_${date}`, `healthGoal_${effectiveDate}` — **only these two** |
| Pending-notification API | `Notifications.getAllScheduledNotificationsAsync()` — **never** `getPendingNotificationRequests()` (that is native `UNUserNotificationCenter`, absent from this repo) |
| Blob migration | **≥0157** on `main` — **not 0156** |
| `0156` | `lf_devices_composite_pk` (exists) |
| Inherited (verified in code) | `MAILBOX_BATCH_VERSION=2` (`packages/local-first/src/sync/batch.ts:16`); `512_000` caps (`mailbox-engine.ts:45`, `local-first-v2.ts:170`); 14d mailbox TTL (`local-first-mailbox-service.ts:3`); `RESTORE_HLC` (`projection.ts:105`); checkpoint N=3 / 90d (`checkpoint.ts:22-23`) |
| Branch | `health-v2` |
| Wave A table count | **8** |

---

## Appendix B — Where Health differs from Budget and House

| Dimension | Budget | House | Health |
|---|---|---|---|
| SoT today | Local-first | Wave A local-first | **D1 + 12-collection outbox** |
| Membership | Household 2–6 | + 1–3 properties | **One user, N devices** |
| Wave A tables | 25 | 21 | **8 D1** + MMKV notes |
| Second writer | — | — | **HealthKit** (not water until DDL) |
| Server compute | alerts no-op | AI Housekeeper | **Summaries — He7-lite hard gate** |
| Blobs | wish device-local | H6 still 📐 | **Blocked on H6 or own MVP ≥0157** |
| Soft Transfer | summary from local | Q16 | **Listed ≠ enabled** |
| Widget | none | task slice | glance; sensitive **off** |
| Cross-user | account-switch | same | Maestro **exists** |

---

## Appendix C — FTC Health Breach Notification Rule (operational)

Not HIPAA. Still applies to this consumer health app (2024 amendments effective 29 Jul 2024).

| Item | Plan lock |
|---|---|
| What is a “breach” here | Unauthorized **acquisition** or **disclosure** of PHR identifiers **or** control-plane metadata that can identify a person (device ids, mailbox timestamps, user id). **The safe-harbor argument, stated at its actual strength:** HBNR reaches only **unsecured** PHR identifiable health information, and §318.2 defines “unsecured” by cross-reference to HHS guidance under 42 U.S.C. 17932(h)(2) (NIST SP 800-111 for data at rest; decryption tools *should* be held separately from the data). A zero-knowledge design where we never hold keys is **designed to meet** that bar — but the determination is **legal, not engineering**: HHS says “should”, not “requires”; SP 800-111 is a storage-encryption guide written for end-user devices, so applying it to per-row AEAD in an app-managed SQLite file and opaque R2 mailbox blobs is an argument rather than a given; and **the FTC has never applied the safe harbor to a client-side E2EE consumer app**. Counsel must confirm before the claim is relied on. The flip side is unambiguous: **plaintext control-plane metadata is not “secured,” so the metadata is the entire HBNR surface** |
| Window | **Consumers:** 60 calendar days after discovery. **FTC:** if ≥500 affected, notice is filed **contemporaneously with the consumer notice** (§318.4(b)), *not* on an independent 60-day clock; if **<500**, FTC notice is **annual** (60 days after calendar year end) — consumers still get 60 days |
| Owner | Product/legal files FTC notice; engineering redacts Worker/analytics logs (no meal strings, weights, cycle) |
| Vendor | Mailbox/R2/D1 processors are PHR-related entities for **metadata** they store |
| Engineering default | 14d mailbox TTL; no health payload in logs or PostHog — **both enforced by test, see C.1** |

This appendix is the O6 playbook. Legal copy review still owed before store default-on.

### Appendix C.1 — What is and is not E2EE at He12 (full) 🆕

The privacy claim must match this table, not the ledger alone. At brand-default-on the ledger holds
**8 tables**; the majority of Health’s sensitive data is still outside it.

| Data | After He12 (full) | Company-readable? |
|---|---|---|
| Weight, water, nutrition, activity/sleep, body measurements, habits, habit logs, goals | Encrypted ledger | **No** |
| Cycle, period, symptoms, men’s health | D1 until He11b | **Yes** |
| Injuries, custom foods, recipes, fridge | D1 (Wave C) | **Yes** |
| Coach transcript (`health.coach.v1`) — *“this cache IS the conversation”* per `healthCacheKeys.ts` | Device MMKV | No (never server-stored) — but see below |
| Notes (`health.notes.v1`) — §1.5 keeps it in MMKV | Device MMKV | No — same weakness |
| Widget / Watch App Group slice | Plaintext file; iOS file protection only | No |
| Mailbox timestamps, device ids, user id | Control plane | **Yes — the HBNR metadata surface** |

⚠️ **MMKV at-rest encryption is decorative.** The key literal ships in every build of all five apps,
so it is public and identical for every install (`src/services/storage/index.ts`). “Device-local” is
therefore *weaker* than the ledger’s per-row AEAD — which is an argument for promoting notes into
the ledger. §1.5 keeps them out; the residual risk is recorded here.

**Store / legal copy lock.** The claim is **“we cannot read the health logs stored in your encrypted
ledger.”** Never **“we cannot read your health data”** — that is false while Wave C is on D1 and the
coach transcript sits under a public MMKV key, and a false E2EE claim is an FTC §5 deceptive-practices
exposure, i.e. exactly the risk this appendix exists to manage.

**Enforcement — not aspiration:**

- **14d mailbox TTL** — pin `MAILBOX_TTL_MS` with a constant test in the backend suite (today it is
  prose in Appendix A plus one literal at `local-first-mailbox-service.ts:3`).
- **No health payload in logs / PostHog** — add a CI grep + unit test over `src/services/analytics.ts`
  call sites asserting no event property matches a Health denylist (`weight`, `calories`, `meal`,
  `food`, `cycle`, `period`, `symptom`, `injury`, `note`, `coach`, `bmi`, `body_fat`). Mirror
  `PROHIBITED_WAKE_PAYLOAD_KEYS` (`backend/src/services/local-first-sync-wake-service.ts:17-40`),
  which already proves the pattern. **Until that test exists the commitment is aspirational and must
  be labelled so.**

### Appendix C.2 — Beyond HBNR (watch list) 🆕

HBNR governs breach *notification*. These impose duties encryption does not satisfy:

| Item | Why it matters here |
|---|---|
| **Flo/Meta CIPA verdict (1 Aug 2025)** | N.D. Cal. jury found Meta liable under CIPA and CMIA for capturing reproductive-health data via the Facebook SDK. ⚠️ **No damages have been awarded** — this was the liability phase; the court has *signalled* exposure around **$8B** on a **$5,000-per-violation** basis (not per class member) for a ~1.5M California class, post-trial motions were denied, and **Meta intends to appeal**. **Independent of HBNR and of encryption.** §15’s analytics rule must become a hard audit of every SDK’s observable surface — including the FatSecret proxy path (§1.4’s accepted meal-string threat) |
| **WA My Health My Data** | ⚠️ **No standalone private right of action** — RCW 19.373.090 makes a violation a *per se* Consumer Protection Act violation, so private suits run through RCW 19.86.090 and must plead all five *Hangman Ridge* elements incl. injury to business or property. Requires a **standalone consumer-health privacy policy with its own homepage link**; consent to collect **or** necessity for a requested product/service (RCW 19.373.030(1)(a) — consent is one of two bases, not the only one); separate authorization to **sell** (RCW 19.373.**070**). Covers “proxy, derivative, inferred, or emergent” data → treat control-plane metadata as in scope. Regulates **collection**, so encryption is no defence. *Maxwell v. Amazon* (W.D. Wash., filed 10 Feb 2025) was the first class action; **no court has ruled on the merits of an MHMDA claim** — do not assume settled interpretation |
| **Nevada SB 370** | Enforcement by the AG **and** the Commissioner, the Director, or any county district attorney. **$15,000** per willful violation (NRS 598.0999(2), raised by AB 373 (2023)) — the $5,000 figure in circulation is pre-2021. **No small-business exemption** — early scale does not reduce exposure |
| **Maryland MODPA** · **California AB 45** (1 Jan 2026) | MODPA took effect **1 Oct 2025**; **1 Apr 2026** is an *applicability* limit on processing activities, not an enforcement date. “Strictly necessary” minimization for sensitive data (expressly incl. consumer health data) plus an outright **ban on selling** it. Enforcement by the MD Consumer Protection Division, **no PRA**, discretionary 60-day cure through 1 Apr 2027. AB 45 = Ch. 134, signed 26 Sep 2025, limited PRA |
| **Apple / Google health declarations** | See §16 Q9 — store-blocking, and Apple’s blocks **updates**, not just submission |

*(New York NYHIPA was vetoed 19 Dec 2025; a narrower bill is pending — watch item, not an obligation.)*

---

## Appendix D — Glossary 🆕

v1.5 used these as load-bearing terms without defining them; two gated an Exit and one
(`O12`) referenced nothing that exists anywhere in the repository.

| Term | Meaning | Defined in |
|---|---|---|
| **S3a** | Re-keying an existing row is not expressible in the op log — tombstone + recreate leaves permanent divergence | House §1.5 |
| **S3b** | Two devices offline both mint a random `id` for the same logical row → both survive the merge. The hazard deterministic ids exist to prevent | House §1.5 |
| **N5** | The scale-mitigation ladder: stamp interning → column pruning → field grouping | House §1.4 / §1.6 |
| **D-20** | Restore semantics requirement: a live row wins over an archived one | `Buget v2/Symply_Budget_BRD_v2.0.md:385` |
| **HDK** | Household Data Key — the per-household key the mailbox payload is sealed to | package `sync/` |
| **DEK** | Data Encryption Key — the per-brand device key wrapping row AEAD | §5 |
| **LWW / VV / HLC** | Last-writer-wins · version vector · hybrid logical clock | package `projection/` |
| **~~O12~~** | **Deleted.** v1.5 §6 cited it for the first-launch Keychain sweep; no such id exists in this repo, House, Budget or `documents/`. The sweep is defined in **§1.3** |

⚠️ **`P1`–`P4` are ambiguous and must be disambiguated on sight.** They carry **three** unrelated
meanings in this pack:

| Usage | Meaning | Where |
|---|---|---|
| “P0 for the architecture decision; P1 for Wave A delivery” | **Priority** | header |
| “Lab D1 rows from P1–P3” | **Health parity phases** (matches `PARITY_PLAN.md`) | §1.1 |
| §9 table; “**P3 to server is not approved**” | **Server-compute displacement tiers** | §9 |

The third is the security-critical one. When writing new text, prefer **`P#-compute`** for the §9
tiers and **“parity phase N”** for the §1.1 sense.

---

*Engineering stub: [documents/engineering/health-local-first-implementation-plan.md](../../engineering/health-local-first-implementation-plan.md).*
