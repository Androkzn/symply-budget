# Implementation Plan — Symply House V2 local-first

**Version:** v2.5 · **Owner:** engineering · **Branch:** `feat/house-v2-local-first`
**Updated:** 2026-08-14 · **Area:** FE + BE (`@symply/local-first`, House brand, shared Worker control plane)
**Priority:** P0 for the architecture decision; P1 for the delivery waves
**Status of this document:** 🟢 **H0–H11 as-built.** Every engine stage is shipped: H6 deployed (§8.3), H7 + H9 + the H3.5 surface pass shipped 2026-08-14, and **H11 complete the same day — the registry is 62 live / 0 staged** across 8 sub-waves and 10 facades.
⛔ **H12 — never executed, not once**, blocked on a second Symply account (§0.2).

> **Read that pairing carefully before treating this programme as finished.** There is no engine work
> left, and there is also no evidence any of it works on two devices. 666 green suites are 666
> assertions about a tree, not one observation of a sync. The next unit of work is not code.

**Location:** `documents/requirements/House v2/` (canonical, mirrors `documents/requirements/Buget v2/`).

**Pack (this folder):**
[README](./README.md)
· [BRD v2.0](./Symply_House_BRD_v2.0.md)
· [TRD v2.0](./Symply_House_TRD_v2.0.md)
· [Stages H0–H12 record](./Symply_House_V2_Implementation.md)
— this file is the **live engineering plan**. Code on the branch is source of truth where they disagree.

**Pattern source (proven):**
[budget-local-first-implementation-plan-v2.md](../Buget%20v2/budget-local-first-implementation-plan-v2.md) v3.2
· [budget-local-first-stage0-implemented.md](../../engineering/budget-local-first-stage0-implemented.md)
· [budget-local-first-scale-audit.md](../../engineering/budget-local-first-scale-audit.md)
· [BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md)

**Goal:** a local-first Symply House that stays correct and fast for **2–6 household members**
across **5–10 years** of data and **1–3 properties per user**, on Hermes — reusing the Budget V2
engine verbatim and paying only for what House genuinely does not share with Budget.

**How to read this.** Every Budget stage that House inherits is marked ♻️ **inherited** with the
exact artifact being reused. Every House-only stage is marked 🆕 **new** and carries
Problem / Fix / Benefit / Verification / DoD. Status markers: ✅ shipped · 🟢 as-built · 📐 design.

---

## Revision History

| Ver | Date | Changes |
|---|---|---|
| v2.5 | 2026-08-14 | **H11 COMPLETE — 62 live / 0 staged.** All 8 sub-waves activated in one day: B1 contractors, B2 quoting, B3 projects, B4 the on-site surface, C1 utilities, C2 floor plans, C3 garden plans, C4 home projects. **10 facades, ~190 methods mirrored, ~1,100 lines of server arithmetic ported** (`billAnalytics` 440, `gardenPlanObjects` 180, `floorPlanAnalysis` 110, `homeProjects` templates+rollups). All six DTO gaps authored. Mobile **651/10,206 → 666/10,952**, backend 273/4,175, `tsc` unchanged at 263 unique signatures with zero errors in any of the ~20 files created. **Every sub-wave found a silent defect the previous one could not have seen**, which is the real record here: B2 — the contractor delete stranded four tables of orphans that synced forever, because a ledger has no FK to complain to; B3 — the same bug one hop deeper (`contractors → projects → milestones/payments/photos`), fixed with a second pass in the same op; C1 — `deleteBill` needed a third drop (the linked task) no FK would ever reach; **C2 — corrected §11.1.1 itself**: a *soft* server delete does not discharge the local obligation, it hides it, because the client DTO omits `deleted_at` so a local delete is a tombstone while the Worker only sets a column; C3 — a **third form of the vacuity trap**, a registry window naming a field the row type did not declare, so `rowBucket` read `undefined` and the table was configured-but-not-windowed, invisible to schema-parity (the D1 column was fine) and to any `Object.keys` sweep; C4 — the same instance **twice more** in DTOs that already existed, plus the first refusals on **tier** and **S2** grounds. Also found: two live server bugs neither backend nor client had noticed (`gardenPlansApi.createMarker` 400s for every household — the route lacks the `z.preprocess` floor plans have; `floorPlansApi.getMarkersForEntity` reads the query param raw so the only value the client type permits matches nothing). **Two decisions deliberately NOT taken** and flagged for product: §11.1.5 `localTasksApi.delete` strands five live tables with no local restore path, and `homeProjectsApi.suggestAiScope` runs no model but sits behind a real entitlement. |
| v2.4 | 2026-08-14 | **H3.5 surface pass + H7 + H9 SHIPPED; H11 B1 activated; §0.1 closed and replaced by §0.2.** The programme's binding constraint moved from "the engine is not built" to "nothing has ever run on two devices". **H3.5:** six `<Stack.Screen>` registrations, three Settings rows, `app/device-sync.tsx`. Almost no new UI — the screens, their tests and the `[E2E-INVITE]` marker already existed and already satisfied the E2E contract; **nothing in `src/` or `app/` referenced `src/screens/house-v2/`**, so a member could not invite a partner, back up a property, or learn why an edit of theirs had been replaced. A screen nobody imports still passes its own unit tests, which is why 951 green tests hid this. **H12 selector drift:** the runner defaulted to `house-settings-*` while the screens shipped `lf-*` — **10 of 15 selectors pointed at nothing**, undiscoverable without booting two simulators. Repointed in the runner (as its own instructions require) and now guarded by `houseMultiMemberSelectorContract.test.ts`, proven non-vacuous. Two real flow bugs fixed: `mm-02` tapped an `OK` that never renders (the screen uses an inline panel, correctly — iOS draws `UIAlertController` in its own window where XCUITest cannot see it), and `mm-04` asserted a bare `Device approved` against whole-element text. **BR-044 requirement #3 WITHDRAWN**: it demanded the literal `merge conflict`, which House deliberately rejects as engine vocabulary; the runner now asserts `house-sync-conflicts`, rendered only when `conflicts > 0`, so the element *is* the proof and survives rewording. `HouseConflictList` now names each discarded edit instead of counting them. **H6 attachments wired:** `TaskFormPhotos` stages + uploads through the blob channel, descriptor on `TaskPhoto.blob`, UI held byte-identical and now unit-asserted. **Appliance attachments remain unhosted** — `src/screens/appliances/` has only a list screen whose add/detail handlers are empty stubs. **H7:** ladder wired via `useHomeInsight` + a new `useGarbageDayInference`, both consumed by real screens; all **six** P4 call sites render member-facing copy (`p4ScreensRenderCopy.test.ts`); cron guard went from **1 caller to 5**. **H11 B1:** live ledger 21 → 25, `localContractorsApi`, proxy, parity. Suites: mobile 651/10,206 → **659/10,375**, backend **273/4,175**, both fully green; `tsc` unchanged at its 263 pre-existing errors. |
| v2.3 | 2026-08-13 | **H6 SHIPPED (encrypted blob channel) — merged (PR #4), migrated on all 8 D1s, fleet deployed; Version IDs in §8.3.** The first of the two subsystems §17 names as where this program's cost is concentrated. Worker side: `0157_lf_blobs.sql` (**not** `0156` — that number went to the H5 `lf_devices` composite PK), `local-first-blob-service.ts`, `local-first-blobs.ts` mounted inside the `/v2` router so it inherits the gate and auth, and a `sweepPurgeable` arm in the same cron as the mailbox and checkpoint sweeps. Client side: `blobs/{blobCrypto,blobTransport,houseBlobStore}.ts` — HKDF-per-blob content keys, chunk AAD binding all seven framing fields, staged envelopes that make resume **re-send rather than re-seal**, plaintext LRU cache, per-property scoping. **Q4 and Q5 closed as recommended** (tombstone + 90-day checkpoint watermark; soft 2 GB / hard 5 GB enforced server-side before the R2 write). **Six decisions the design did not state** — see §8.1, of which two matter most: the server stores *no plaintext hash, mime or filename* (a content hash is a confirmation-of-file oracle), and the sweep needed a **second arm** for `pending` uploads abandoned before finalize, which no ledger row will ever tombstone. **111 new tests** (67 mobile + 44 backend), House local 422 → **489**, backend local-first 65 → **109**; full backend **4,021** green, full mobile **9,489** with the same 5 pre-existing failures. Also fixed a real pre-existing bug in the shared uploader: a `{error:{code,message}}` body used to reach the user as `"[object Object]"`. **Not claimed:** the three-way upload normalization (H6's own path only) and any Wave-A table cutover (gated to H11 by the plan's own sequencing). **One gap found and recorded, not fixed:** a device revoke rotates to a brand-new HDK and the old one is retained nowhere, so pre-rotation attachments become permanently unreadable — blobs are the first *durable* HDK-sealed data in the system, which is why nothing caught this before (§8.2). H6 makes the failure a named error; the keyring fix touches the persisted session shape and is owed before H11 B1. |
| v2.2 | 2026-08-13 | **H3 SHIPPED (API facades + Wave-A cutover) + H7-lite SHIPPED.** 10 modules / ~117 methods have local counterparts behind the Proxy; `git diff --stat src/screens` is **empty**, so the cutover really did cost zero screen edits. Parity gate diffs both directions across all 10 modules and requires a written reason per remote-by-design method. Ported server logic: recurrence (3 disagreeing server engines, ported separately rather than collapsed), task workflow stages, checklist instance materialization, seasonal generation, garbage expansion. H7-lite is **live, not dark**: rolling-horizon reminders measured at 30 scheduled under the 64-notification cap on the 10-year corpus, plus an 8-field widget projection with wipe-on-logout. House suite 101 → **413 tests**; full mobile 9,101 → **9,422**, with the same 5 pre-existing failures and no new ones. **Four bugs found by porting** — see §6.3. |
| v2.1 | 2026-08-13 | **H5 SHIPPED (multi-property session manager).** `engine.ts` is now a `Map<householdId, EngineState>` + `activeHouseholdId`; `packages/local-first` needed no change, as predicted. All six design rules as-built (§7.1): device-scoped DEK/store/identity vs property-scoped HDK/OpLog/ledger, **lazy hydration measured at 1.02×** for three properties against the 1.3× bound, sync fanned out with single-flight **per household**, push wake routed by `householdId` and the token registered per property, checkpoint watermarks keyed per property. One thing the design missed: the OpLog projection handler had to become per-property too, or a background property's ops merge into the active ledger. Added `createLocalHouseProperty` / `removeLocalHouseProperty`. **15 new tests** (House 86 → 101). Cold open is **90.6% AEAD** — the lever for H3 is fewer/larger sealed units, not faster JSON. |
| v2.0 | 2026-08-13 | **H2 + H4 + H8 SHIPPED (storage, sync client, checkpoints).** House sync client landed under `src/features/house/local/`: control-plane client (`X-House-Local-First`), `httpControlPlane`, `hdkTransfer`, `checkpoints`, `syncStatusStore`, `orchestrator`, `pushWake` (`house_sync_wake`), `ensureSession`. Deep link is **`simplehouse://lf-invite`** — the scheme the brand actually declares. `syncErrors.ts` **promoted into `@symply/local-first`** (no brand in it); Budget re-exports. Mailbox-only — WebRTC deliberately not ported while `EXPO_PUBLIC_HOUSE_P2P` is off. **§5.2 done properly:** the engine now reports WHICH tables a delta touched and `ledgerRefresh` maps them to a bounded key set, with a typed exhaustive map, a no-empty-prefix rule and a proof that no mapped prefix can reach a Tier-B/C key. H8 landed early because H10 measured 452 ops/deposit. House suite 68 → **86 tests**; Budget 196 and package 204 unchanged. Still owed for H4: the §5.1 invite **screen** (H3). |
| v1.9 | 2026-08-13 | **H10 SHIPPED (scale harness + baseline).** House corpus generator lands inside every §4 envelope (**14,557 rows @5y/2a, 28,867 @10y**), pinned by 38 new guards in `npm test` (package 166 → **204**). Four House phases; `house-coldopen` measures House's per-row AEAD path, not Budget's legacy snapshot path. Baseline published, 16/16 runs, zero crashes. **Q12/N5 CLOSED with data: the LWW map is 1.9× the row data at every scale (25.5 MB vs 13.3 MB at 10y, 414 k stamps) — all three mitigations are in (§1.6).** Two more findings that shape H3: cold open is linear at **34–37 µs/row** (1.03 s @10y on V8, 1.5–15 s on Hermes → H5 must hydrate lazily), and one deposit carries **452 ops / ~38 days**, so a 10-year catch-up is 98 deposits and H8 checkpoints are not optional. Report script parameterized by brand with Budget's output unchanged byte-for-byte. **Owed: a clean re-take** — capture ran at loadavg 4.05 (the machine's idle floor), so it is stamped `gate.usable: false` and timings are not gradeable; sizes/counts/ratios are load-independent and stand. |
| v1.8 | 2026-08-12 | **H1 SHIPPED (ledger core).** Q13 resolved as **promote, not fork**: the 1,060 mechanical lines of `projection.ts` now live in `@symply/local-first/projection`, parameterized on a `LedgerSchema` descriptor (`defineLedgerSchema` + `createLedgerProjection`). Budget's `projection.ts` is a 147-line registry-only adapter with **every export name and signature unchanged**, and its suites are the oracle: **196/196 Budget local + 166 package + 3,967 backend green**. House ledger core landed under `src/features/house/local/` — registry (21 Wave-A tables), deterministic-id builders for all 4 Wave-A S3b tables, engine/session/store/persistence/errors/flag, and **68 new tests**. Two H0 leftovers closed: the `{ error: 'Not found' }` 404 body is now pinned by contract test, and the Kaizen/Health `v4` DO migration is **recorded as retained** (removing an applied tag breaks the deploy; an unbound namespace costs nothing). Also fixed a pre-existing flaky ratio assertion in `corpus-realism.test.ts` that failed 3/3 on the unmodified baseline. |
| v1.7 | 2026-08-12 | **H0 implementation started.** Explicit `isLocalFirstApiEnabled()` task in `backend/src/config/local-first-api.ts` (mirrors `budget-api.ts:5-7`). |
| v1.6 | 2026-08-12 | **Review-plan Cycle 2.** H6 default is **Worker-proxied ciphertext PUT** (R2 bindings cannot S3-presign — same as household photo / health assets); Language-style `aws4fetch` is a later opt-in that needs new secrets. Chunk retry **reuses** stored `(nonce, ciphertext)`. Wipe slot unified: truncate while client flag is still `0`. H1 DoD includes backend 46. Cron digest cite `:505`. House wrangler `v3` is `deleted_classes JobManagerDO`, not ChatRoomDO. Widget vs watch channels split. Incident kill via `wrangler secret put` (no code deploy). |
| v1.6 | 2026-08-12 | **H0 SHIPPED.** Merged to `main` (`03fedf43`), `deploy:fleet` run, production Version IDs recorded. `localFirstApi` live (House+Budget on; Kaizen+Health 404 by test); `HOUSEHOLD_COORDINATOR` bound on House at DO migration `v4`; sync-wake type generalized; **both** mailbox authz holes closed (GET ownership + deposit `sourceDeviceId`). 85 BE tests green; a typecheck break in the wake builders fixed (`a0f34419`). **Reverses v1.5 on one point:** production is `"true"`, not `"false"` — product owner, zero users, and staging must equal production to be testable. §2.1 truncation deferred to Wave-A cutover (no client exists to cut over). New open item: the unneeded Kaizen/Health `v4` DO migration. |
| v1.5 | 2026-08-12 | **Review-plan Cycle 1.** Unified Worker kill to `LOCAL_FIRST_API_ENABLED` (dropped `HOME_LOCAL_FIRST_ENABLED`). Locked `requireLocalFirstApi` 404 body to Budget's `{ error: 'Not found' }`. Corrected Wave A bucket columns (`next_due_date`, `scheduled_work_date`, `period_start`). Refreshed unit-test counts (166/196/46). Per-file DO/fleet H0 checklist. Shared-DEK threat acceptance. Widget as explicit P3 exception. H6: `REPORTS_BUCKET` + `lf-blob/`, per-chunk nonce/AAD, presigned PUT. Deep link `simplehouse://`. Wave A sequence H5 before H3; H7-lite ship gate. Rollback runbook. Count lock: Wave A 21 / B 19 / C 26; S3b 11; platform 21; cron 9; screens 163. |
| v1.0 | 2026-08-12 | First cut. Deep audit of `packages/local-first`, `src/features/budget/local/**`, `backend/src/routes/local-first-v2.ts` + services, and the full House domain surface (≈100 D1 tables, 43 api modules, 36 stores, ~135 screens). Tiering, 5 House-only subsystems, wave plan, Q1–Q16. |
| v1.1 | 2026-08-12 | **Review pass 1 — claim verification against the tree.** Every file:line re-checked. Corrections: (a) `requireBrandCapability` already exists, so the new gate is a one-liner — plus a 404 **body-shape** difference between it and `requireBudgetApi` that clients may string-match; (b) **S3 split into S3a/S3b** — the real Tier-A hazard is not natural *primary keys* (those are all Tier B) but surrogate PKs carrying a business `uniqueIndex`, which loses uniqueness in the ledger and yields **duplicate rows** on concurrent offline creation; fix is deterministic ids, as Budget already does for `goal_${year}_${month}`; (c) line counts re-measured. Confirmed: all 3 duplicate table names, the PK-less join, the `households` domain columns, the widget/watch task dependency. |
| v1.4 | 2026-08-12 | **§1.0 gate MET, not open.** The Budget two-device suite is **green — 22 PASS / 0 FAIL** (run `20260812-195127`): enrolment/HDK handshake, parallel create + modify, concurrent same-row conflict with convergence and BR-044 surfacing, parallel delete with tombstone propagation. v1.2's "stalled at mm-01" reading came from tailing a log mid-write. **H1 is unblocked; H0 now has no abort trigger.** |
| v1.3 | 2026-08-12 | **Product forks closed.** Q1 → **no real users, database may be wiped** → §1.1 rewritten as a locked mandate, the H1.5 migration program **deleted**, and §2.1 converted from "orphan the old household" to an explicit **lab-truncation procedure**. Q0 (§19) → **offline + E2EE confirmed as a House product requirement** — the do-nothing alternative is formally rejected. Q6–Q10 → **locked to the recommended assignment** (P2 BYOK for AI, P1 on-device for reminders, P1 in-app + P4 for digests, P4 for the three vision features, widget projection approved); **P3 consented plaintext projection explicitly not approved**. Remaining open: Q2–Q5, Q11–Q16 (engineering decisions, resolved at their stages). |
| v1.2 | 2026-08-12 | **Review pass 2 — adversarial.** Added **§1.0**: Budget V2 is unit-green but its **two-device suite is not** (v3.0 DoD unchecked; newest run stops after `mm-01-signin`) — made "Budget E2E green" a hard H0 gate. Added §2.1 first-launch household discontinuity, §2.2 other-brand scope, §6.1 the four app wiring points (incl. `DataContext`'s per-household bulk load), §6.2 test-environment landmines, §16 monitoring, §17 abort/descope criteria, effort assumptions. Q11 upgraded — the `home-budget` glance breaks from *both* sides once House and Budget are both local-first. Fixed a broken §4.1 → §3.1 reference. |

---

## 0.1 ✅ **CLOSED 2026-08-14** — the local-first surface ships (was: "House V2 has no local-first UI")

Found 2026-08-13 while writing the E2E suites, and verified directly:
`src/features/house/local/` contained **zero `.tsx` files**, and **no screen anywhere referenced
`isHouseLocalFirst()`**.

**Resolved by the H3.5 surface pass this section recommended.** The table below is kept as written,
with an as-built column, because the shape of the gap is the useful record — every row was an engine
that had been deployed and green for a day, sitting behind no doorway.

| Surface | Engine | Member-facing UI (2026-08-13) | As-built 2026-08-14 |
|---|---|---|---|
| Invite / join / approve enrolment | ✅ | ❌ none | ✅ `HouseDeviceSyncScreen` — Settings row `settings-row-device-sync` + `simplehouse://device-sync` |
| Sync status / conflict surfacing (BR-044) | ✅ | ❌ none | ✅ status line + `HouseConflictList`, which names each discarded edit rather than counting |
| H6 attachments | ✅ | ❌ no caller in `src/` | ✅ `TaskFormPhotos` stages + uploads through the blob channel; descriptor rides `TaskPhoto.blob` |
| H9 CSV export | ✅ | ❌ no Settings row | ✅ inside `HouseBackupScreen`, reached from "Backup & Restore" |
| H9 backup / restore | ✅ | ❌ no screen | ✅ both routed; Restore gets its own row rather than hiding inside Backup |
| P4 disabled-feature copy | ✅ | ⚠️ one screen rendered it | ✅ all **six** reachable call sites, locked by `p4ScreensRenderCopy.test.ts` |

**What the fix actually was.** Almost none of it was new UI. The screens, their unit tests, and the
`[E2E-INVITE]` marker already existed and already satisfied the E2E contract; nothing in `src/` or
`app/` referenced `src/screens/house-v2/`. The work was six `<Stack.Screen>` registrations, three
Settings rows, one expo-router route, and repointing the runner's selector table — which had drifted
to `house-settings-*` names while the screens shipped under `lf-*`, leaving **ten of fifteen
selectors pointing at nothing**. That drift is now guarded by
`e2e/__tests__/houseMultiMemberSelectorContract.test.ts`, which fails in 200 ms instead of on a
device.

> **Still not evidence of working software.** Every claim above is unit-level. The two-device suite
> has *never run, in any colour* — see §0.2.

H3's headline result — 117 methods cut over with `git diff --stat src/screens` **empty** — is real and
remains the right achievement: existing screens read the ledger through the Proxy without knowing.
But that same property is why nothing local-first **adds** had a way in, and why this gap could sit
undetected behind a green suite for a day.

---

## 0.2 ⛔ The gap that now outranks everything: **nothing has ever run on two devices**

The H12 suite — 28 flows, authored 2026-08-13 in `0016083c` — **has never executed a single time**.
Not green, not red. Three independent proofs:

1. `documents/engineering/testing/reports/house-multi-member/` does not exist on disk.
2. `git log --all -- <that path>` returns nothing: never committed on any branch.
3. `~/.maestro/tests` is empty and `/tmp/metro-house-mm.log` has never been written. Even an aborted
   attempt leaves artifacts.

**The hard blocker is one credential.** `run-house-multi-member-sync.sh:166-179` exits before flow 1
unless `E2E_EMAIL_SECONDARY` / `E2E_PASSWORD_SECONDARY` are set **and differ from `E2E_EMAIL`**.
`e2e/credentials.local` holds only the single shared fleet account. A second Symply account has to be
created by hand — it is not something the codebase can provide.

Everything else this suite needs is now in place: the enrolment surface is routed, the selector table
is repointed and guarded, the attachment path reaches the blob channel, and two genuine flow bugs are
fixed (`mm-02` tapped a non-existent `OK`; `mm-04` asserted a bare phrase against whole-element text).

**Why this outranks H11.** Wave B/C activation adds tables to a ledger whose *sync* has never been
demonstrated on real hardware for House. Budget's suite is the only two-device evidence in the
repo (§1.0) and it is evidence about Budget's engine. Until the House suite runs once, every H11
sub-wave is being built on an assumption.

Secondary, also owed and also device-bound: the quiet-machine H10 re-take (§4, the capture is stamped
`gate.usable: false`) and the one on-device Hermes anchor.

---

## 0. Status dashboard

| Stage | Scope | Kind | Status | Blocking dependency |
|---|---|---|---|---|
| **H0** | Enablement: capability gate, DO binding, control-plane un-branding | 🆕 mostly config | ✅ **SHIPPED 2026-08-12** | merged to `main` (`03fedf43`); fleet deployed; 85 BE tests green |
| **H1** | Ledger core: table registry, projection, engine, session — Wave A tables | ♻️ + 🆕 | ✅ **SHIPPED 2026-08-12** | projection promoted to the package (Q13); Budget 196 + package 166 + House 68 green |
| **H2** | Row storage + DEK + SQLite | ♻️ **free** | ✅ **SHIPPED 2026-08-13** | landed with H1 — House DB name + DEK key, asserted distinct from Budget's |
| **H3** | API facades + screen cutover — Wave A | 🆕 volume work | ✅ **SHIPPED 2026-08-13** | 10 modules, 117 methods, **zero screen files changed**; H7-lite live |
| **H4** | Sync client (orchestrator, control-plane client, HDK transfer, status) + **🆕 invite collapse (§5.1)** | ♻️ + 🆕 | ✅ **SHIPPED 2026-08-13** (client) · 📐 (invite UI) | client + §5.2 targeted invalidation done; §5.1 screen is H3 |
| **H5** | **Multi-property session manager** | 🆕 **House-only** | ✅ **SHIPPED 2026-08-13** | registry + lazy hydration + per-property HDK/checkpoints/sync; 3-property cold open **1.02×** |
| **H6** | **Encrypted blob channel (attachments)** | 🆕 **House-only** | ✅ **SHIPPED 2026-08-13** | PR #4 → `main`; `0157` on all 8 D1s; `deploy:fleet` done, Version IDs in §8.3. 111 tests. Channel only — per-table cutover is H11. §8.2 keyring closed. |
| **H7** | **Server-compute displacement** (AI Housekeeper, cron, notifications, widget/watch) | 🆕 **House-only, highest risk** | 🟢 **SHIPPED 2026-08-14** (lite 08-13) | ladder wired via `useHomeInsight` + `useGarbageDayInference`; **all 6** P4 call sites render real copy; cron guard 1 → 5 call sites |
| **H8** | Checkpoint / bootstrap / catch-up / compaction | ♻️ near-verbatim | ✅ **SHIPPED 2026-08-13** | landed with H4 — H10 measured 452 ops/deposit, so it was never optional |
| **H9** | Backup / restore / export | ♻️ + 🆕 blob policy | 🟢 **SHIPPED 2026-08-14** | engine+screens existed since 08-13; 08-14 routed them — Settings rows `settings-row-house-backup` / `-restore`, CSV export inside Backup |
| **H10** | Scale harness + House baseline | ♻️ harness, 🆕 corpus | ✅ **SHIPPED 2026-08-13** | corpus + 4 phases + baseline published; N5/Q12 decided; one clean re-take owed (§4) |
| **H11** | Wave B + Wave C table expansion | 🆕 volume work | ✅ **SHIPPED 2026-08-14** | live ledger 21 → **63**; Wave B **0**, Wave C **0**; **all 8 sub-waves, 10 facades**. Registry 63 live / 0 staged — the 63rd is `applianceDocuments`, a completeness correction (§11.1.4c), not a sub-wave |
| **H12** | Two-device E2E + fleet deployment | ♻️ harness | ⛔ **BLOCKED — never run once** | needs a second Symply account (§0.2). Suite is otherwise ready: surface routed, selectors repointed + guarded, 2 flow bugs fixed |

```text
Wave A (core home)   H0 → H1 → H10 → H2/H4 → H5 → H3 → H7-lite → H3.5 → H12(partial)
                     [engine + surface done; H12 never run]
Wave B (labor hub)   H6 → H7 → H11a(B1 ✅ · B2·B3·B4 📐)          [H6, H7 done]
Wave C (long tail)   H11b(C1–C4 📐) → H8/H9 → H12(full)            [H8, H9 done]
```

**H3.5 was not in the original sequence** and is the lesson of §0.1: the plan sequenced engine
stages and assumed the surface arrived with them. It did not, and nothing in the test suite could
notice, because a screen nobody imports still passes its own unit tests. The 41 remaining H11 tables
carry the same hazard — activating a table is not the same as a member reaching it.

**H5 before H3:** `DataContext` enumerates every household and bulk-loads tasks per property. Landing facades without the session manager hydrates N ledgers on every `refreshAll`.
**H7-lite with Wave A:** widget/watch + rolling-horizon reminders for Wave A tables, **or** an explicit in-product "widget / reminders dark on this build" copy. Shipping Wave A brand-default-on with a silent empty widget is not a ship gate.

**Nothing in H3/H11 should start before H10 has produced a House baseline.** That is the single
lesson the Budget plan states most emphatically (§5, "later stages claim performance wins; without
a machine-local baseline those claims are unfalsifiable") and House is 2–4× the row count.

---

## 1. Decisions that shape everything

### 1.0 Precondition — ✅ **MET: Budget V2 is certified end-to-end** (run `20260812-195127`)

This plan's economy rests on "reuse the proven Budget engine". As of 2026-08-12 that claim is fully
evidenced:

| Signal | State |
|---|---|
| Unit / integration suites | **Green** — **166 passed + 3 skipped** (`packages/local-first`, 28 files), **196 passed / 31 suites** (`jest src/features/budget/local`), **46** backend local-first tests (11 files). *(v1.4 cited 105/175 — those were an earlier snapshot.)* |
| Worker deployed from the same commit as the client | **Yes** — budget staging `d74fca18` / production `460db437` |
| **Two-device Maestro suite** | ✅ **GREEN** — Budget plan v3.2 **18/18 flows**; run log has **22 PASS / 0 FAIL** lines (both-device counts). Run `documents/engineering/testing/reports/budget-multi-member/20260812-195127/summary.log` |

The green run covers exactly the behaviours House depends on inheriting:

| Phase | Proven |
|---|---|
| 1 — enrolment | sign-in, owner creates invite, member joins, owner approves via the OOB word, member enrols and syncs (the HDK handshake) |
| 2 — parallel create | both members create; each sees the other's row |
| 3 — parallel modify | both members edit; each sees the other's edit |
| 4 — **concurrent same-row conflict** | both edit the same row; **both devices converge on `$94`** (the member's edit won by LWW) and the conflict is **surfaced to a member** (BR-044) |
| 5 — parallel delete | both delete; the tombstone propagates and is verified on the peer |
| cleanup | teardown on both devices |

**What that means for House.** LWW convergence, absorbing tombstones, version-vector catch-up, the
invite/approve/HDK-enrolment handshake and conflict surfacing are all demonstrated on real devices
over the live relay — not just in unit tests. **H1 is unblocked.** The residual Budget DoD gaps
(quiet-machine scale re-take, revert-proofing a few Stage-3 tests) are rigour and performance items,
not correctness unknowns, and none of them gate House.

> **Standing rule this still implies:** re-run the suite against a Worker built from the **same
> commit** as the client before trusting it again. Client and relay deploy on different clocks, and
> unit tests import the tree, not the deployment.

*Process note: an earlier draft of this section read the run's `summary.log` while it was still being
written and concluded the suite had stalled at `mm-01-signin`. Budget's own plan warns about exactly
this (§9: "any suite count taken while build agents are committing is a snapshot, not a gate").
Read a run's terminal state, not its tail.*

### 1.1 Product mandate — ✅ **LOCKED 2026-08-12: no real users, database may be wiped** (Q1 closed)

**Product owner decision, 2026-08-12: House has no real users. The database may be cleaned if
needed.** House therefore carries the *same* mandate Budget locked in its v2.7 — the 26 production
users and 42 refresh tokens in the [zero-user audit](../../engineering/launch-zero-user-audits/README.md)
(snapshot 2026-07-15) are **synthetic/test rows**, and `platformRegistrationEnabled` has never been
true, so there is no public sign-up population behind them.

| Fact | Implication |
|---|---|
| Zero real users (product owner, 2026-08-12) | No customer data, no upgrade population, no obligation to any old format |
| **Wipe authorized** on House D1 / R2 / KV | Domain tables, R2 objects and lab state are disposable infrastructure, not an install base |
| `platformRegistrationEnabled = false` | No path by which a real cohort could have formed |
| Simulators / TestFlight / E2E DBs | Disposable. Reinstall / clear data / revoke invites whenever a contract changes |

**Explicitly out of scope — do not build any of it:**

- Cross-version **migration** machinery (the former Stage H1.5 is **deleted**, not deferred)
- **Dual-format** readers / writers; backward compat with any prior wire, SQLite or MMKV shape
- "Don't break devices that already synced" constraints
- Soft rollout flags whose only purpose is format coexistence

**What this authorizes us to do, and should:**

- Delete or replace House domain tables outright rather than shim around them
- Change the ledger schema, AEAD layout or projection shape whenever it improves the result
- Force every lab device to wipe + reinstall after a contract change
- **Truncate the House domain tables** at Wave-A cutover instead of orphaning them (§2.1)

**The one real boundary** is the same as Budget's, and it is about *shared code*, not users: the
`/v2` routes, middleware, `brand-capabilities.ts` and `cron/scheduled.ts` ride **one Worker codebase
that `deploy:fleet` ships to House + Budget + Kaizen + Health together**. Per-brand D1 and R2 are
fully isolated, so House `lf_*` rows can never touch Budget's — but a regression in shared plumbing
reaches four production Workers in one run. See §14.

**Kill switch (§1.7) stays** — it is for incident response, never for format coexistence.

**The binding constraints** (unchanged from Budget, non-negotiable):
scalable (2–6 members × 5–10 years × 1–3 properties) · reliable (no silent loss, no household
forks, crash-safe) · secure (E2EE threat model, mailbox authz, no plaintext secrets) ·
performance-efficient (Hermes-aware, bounded write amplification) · industry practice
(version-vector cursors, LWW+tombstones, checkpoint+op-tail bootstrap, availability watermarks,
kill switch).

### 1.2 Scope tiering — the most important decision in this document

Budget ledgered **25 tables**. House-domain D1 is large — fleet Drizzle has **237** unique tables; excluding Health + full Budget-money leaves **~161** House-relevant tables; this plan ledgers **21 + 19 + 26 = 66** across Waves A–C. Attempting fleet-wide parity is the failure mode:
it multiplies the projection surface, the LWW map, the cold-open cost and the test matrix all at
once. House data splits cleanly into four tiers, and only Tier A ever enters the ledger.

#### Tier A — ledger (encrypted, device-authoritative, syncs peer-to-peer)

**Wave A — core home (21 tables).** The minimum set that makes House usable offline.

| Table | File | Cols | Row-key | Bucket field | Note |
|---|---|---|---|---|---|
| `households` | `schema.ts:124` | 12 | `id` | `*` | domain fields move here; `lf_households` stays metadata-only |
| `household_members` | `schema.ts:160` | 8 | `id` | `*` | **re-key** off `(household_id,user_id)` — see §1.5 |
| `household_spaces` | `schema.ts:490` | 17 | `id` | `*` | |
| `tasks` | `schema.ts:552` | **58** | `id` | `next_due_date` | widest row — D1 column is `next_due_date` (no `due_date`); see §1.6 |
| `maintenance_completions` | `schema.ts:706` | 7 | `id` | `completed_at` | **House's `expenses`** — highest cardinality |
| `maintenance_subtasks` | `schema.ts:731` | 14 | `id` | `*` | |
| `maintenance_task_notes` | `schema.ts:776` | 7 | `id` | `created_at` | |
| `home_features` | `schema.ts:959` | 17 | `id` | `*` | |
| `appliances` | `schema-maintenance.ts:75` | 16 | `id` | `*` | |
| `appliance_service_history` | `schema-maintenance.ts:123` | 7 | `id` | `service_date` | |
| `garbage_schedules` | `schema-maintenance.ts:28` | 11 | `id` | `*` | |
| `seasonal_checklists` | `schema-maintenance.ts:224` | 7 | `id` | `*` | |
| `seasonal_checklist_items` | `schema-maintenance.ts:244` | 11 | `id` | `*` | `photo_keys` → H6 |
| `checklists` | `schema-checklists.ts:8` | 14 | `id` | `*` | |
| `checklist_items` *(recurring)* | `schema-checklists.ts:41` | 8 | `id` | `*` | **name collision — see §1.5** |
| `checklist_instances` | `schema-checklists.ts:64` | 13 | `id` | `period_start` | no `due_date` column — window on `period_start` |
| `checklist_item_completions` | `schema-checklists.ts:102` | 6 | `id` | `completed_at` | **natural unique → re-key** |
| `household_notes` | `schema-household-notes.ts:13` | 9 | `id` | `created_at` | |
| `settings` | `schema-settings.ts:9` | 7 | `id` | `*` | **natural key `(user_id,household_id,key)` → re-key** |
| `recurring_reminders` | `schema-recurring-reminders.ts:21` | 20 | `id` | `*` | natural unique → re-key; client-scheduled after H7 |
| `task_drafts` | `schema.ts:898` | 27 | `id` | `created_at` | AI-seeded but user-editable |

**Wave B — labor hub (19 tables):** `contractors` (34 cols), `contractor_visits`,
`contractor_representatives`, `contractor_documents`, `contractor_quotes` (42 cols),
`quote_requests`, `appointments`, `quotes`, `projects`, `project_milestones`, `project_payments`,
`project_progress_photos`, `visit_checklists`, `checklist_items` *(labor-hub — second collision)*,
`visit_notes`, `contractor_messages`, `contractor_job_ratings`, `contractor_issue_resolutions`,
`checklist_item_photos`.

**Wave C — long tail (26 tables):** `utility_accounts`, `utility_bills`, `property_taxes`,
`bc_assessment_data`, `utility_reminders`, `floor_plans` (37 cols, user-editable fields only),
`floor_plan_markers`, `floor_plan_annotations`, `garden_plans`, `garden_plan_objects`,
`garden_plan_markers`, `garden_plan_boundary_drafts`, and the 14 `home_project_*` tables.

#### Tier B — stays server-authoritative, **never** ledgered

| Group | Tables / services | Why it cannot move |
|---|---|---|
| Reports pipeline | `reports`*, `report_chunks`, `findings`, `finding_spaces`, `report_images`, `report_summaries`, `processing_jobs` | AWS Lambda must read the PDF; E2EE would blind it (`enhanced-pdf-processor.ts:110`) |
| Chat | `chat_rooms`, `chat_messages`, `chat_room_participants`, `chat_room_reads` | Durable-Object WebSocket; Budget did not convert its chat either |
| AI Housekeeper server state | `assistant_briefings`, `assistant_outbound_log`, `assistant_trust_ledger`, `google_calendar_tokens`, `aihousekeeper_attachments` | server-composed / OAuth secrets — see H7 |
| Notification delivery | `scheduled_notifications`, `notification_history`, push tokens | server must send while the app is closed |
| Subscription | `subscriptions`, RevenueCat webhooks | external authority |
| Platform / Soft Transfer | **21 tables** in `schema.ts:1139-1600` (identity, entitlements, Soft Transfer, deletion — not all named `platform_*`) | House **is** the platform authority |
| Audit | `audit_log` | server-side compliance record |

\* `reports` **metadata + user-editable fields** may later be mirrored into Tier A as a read-model
pointer row. Decide in Q11; default is "stay in Tier B, read remotely".

#### Tier C — global reference / read-only (cached, not ledgered)

`maintenance_templates` (587 LOC seed), `maintenance_task_templates`, `municipality_configs`,
`service_providers`, `utility_providers`, `technical_terms`, system rows of `checklist_templates`
and `message_templates`, `preset-spaces.ts`.
**Policy:** fetch over HTTP, cache in AsyncStorage with an ETag, never write, never sync.

#### Tier D — server-derived, regenerate rather than sync

`maintenance_suggestions`, `contractor_recommendations`, `utility_trends`, `floor_plan_regions`,
`home_project_geometry`, `ai_*` legacy v2 tables.
**Policy under local-first:** these must be **re-derived on device** (H7) or the feature is
disabled for local-first households. Silently returning stale/empty server data is not acceptable.

### 1.3 What is inherited for free — the honest reuse table

Verified by reading the tree, not inferred.

| Artifact | Lines | Domain-specific? | House cost |
|---|---|---|---|
| `packages/local-first/src/**` (27 → **31** files) | 4,357 → **5,479** | **Zero** — every `budget` hit was a prose comment | ✅ **H1: reused verbatim, and the package now also OWNS the merge core.** The 5 branded comments are un-branded (`store/types.ts`, `store/memory-store.ts`, `backup/archive.ts`, `sync/peer-session.ts`, `crypto/bytes.ts`); 4 new files under `src/projection/` hold the promoted 1,122 lines |
| Crypto/key hierarchy (`crypto/*`, `oplog/hlc.ts`, `oplog/oplog.ts`) | ~700 | no | 0 |
| Store + DDL (`store/types.ts` `SQLITE_MIGRATION_V1/V2`, `sqlite-store.ts`, `row-aead.ts`) | ~990 | no | 0 |
| Mailbox sync engine + wire v2 (`sync/mailbox-engine.ts`, `sync/batch.ts`) | 788 | no | 0 |
| Checkpoints (`sync/checkpoint.ts`) | 187 | no | 0 |
| Backup archive (`backup/archive.ts`, `backup/phrase.ts`) | 275 | no | 0 |
| **Backend `/v2` control plane** (`routes/local-first-v2.ts` 818, `local-first-mailbox-service.ts` 271, `local-first-checkpoint-service.ts` 258, `local-first-control-service.ts` 503, `durable-objects/household-coordinator.ts` 596, `local-first-signaling-ws.ts` 51) | 2,497 | **branded only by the gate** | **~1 day** to un-brand (§3) |
| **D1 `lf_*` tables** (migrations `0152`–`0155`) | 7 tables | no | **0 — already applied to `simple-house-db`** (`0152` header: *"Applied on all brand D1s"*) |
| `projection.ts` merge core | 1,107 → **147 in Budget, 855 in the package** | was `LEDGER_TABLE_KEYS`, `WINDOWED_DATE_FIELDS`, one `table === 'goals'` branch | ✅ **H1: promoted (§3.1).** Budget keeps the registry + a `bucketOverride`; House passes its own descriptor. One core, no fork |
| `engine.ts` session/persistence/checkpoint machinery | 1,181 → ~700 mechanical | ledger shape + 25 arrays | ~480 lines re-authored |
| `sync/orchestrator.ts`, `controlPlaneClient.ts`, `httpControlPlane.ts`, `checkpoints.ts`, `hdkTransfer.ts`, `syncErrors.ts`, `syncStatusStore.ts`, `ledgerRefresh.ts`, `pushWake.ts` | ~1,400 | header string, wake type, store list | ~80 lines changed |

**Total inherited: ≈9,000 lines of proven code and 7 live D1 tables.** That is the whole reason
this plan is tractable.

### 1.4 What is genuinely new — and why it is not optional

| # | House-only subsystem | Budget's answer | Why it fails for House |
|---|---|---|---|
| **N1** | **Multi-property session manager** (H5) | Single household; `engine.ts` holds exactly one `state.ledger.household.id` | House supports N households per user (`householdStore.propertyMode`, `src/contexts/DataContext.tsx:188` lists all). `lf_rows` PK is `(household_id, tbl, row_key)` so the **store** already handles it — the **engine** does not |
| **N2** | **Encrypted blob channel** (H6) | `wishes/localWishMedia.ts` — device-local file + a ledger pointer; **bytes never cross devices** | House has **25 blob-bearing tables**. "Your photo is invisible on your partner's phone" is a bug in House, not a deferred nicety |
| **N3** | **Server-compute displacement** (H7) | Server AI degraded to no-ops; reminders moved on-device (`budgetLocalReminders.ts`, 248 lines) | House depends on **36 production files** under `services/aihousekeeper/` (24 modules + 12 triggers; 60 incl. tests), **9 House cron jobs**, **4 Cloudflare queues**, and Lambda. Degrading them to no-ops deletes the flagship feature |
| **N4** | **Widget / Watch plaintext projection** (H7) | Budget has no widget | `widget-sync.ts` / `watch-sync.ts:83` feed the iOS extension **tasks**. The extension holds no DEK |
| **N5** | **Wide-row LWW containment** (§1.6) | Rows mostly ≤20 cols | `tasks` 58, `contractor_quotes` 42, `floor_plans` 37, `contractors` 34. Budget already measured a 6.1 MB LWW map vs 3.0 MB of rows (audit C18); per-field watermarks scale with column count |

### 1.5 Schema hazards found in the House tree — fix **before** H1

These are the House equivalents of Budget's B6 (natural-key delete/recreate diverged forever,
`engine.ts:36-51`). Each is a data-loss bug waiting to happen, not a style issue.

| # | Hazard | Where | Required fix |
|---|---|---|---|
| S1 | **Duplicate physical table names across Drizzle files** — `checklist_items` (`schema-checklists.ts:41` **and** `schema-labor-hub.ts:344`), `municipality_configs` (`schema-maintenance.ts:52` **and** `schema-utilities.ts:249`), `scheduled_notifications` (`schema.ts:1097` **and** `schema-notifications.ts:76`) | 3 pairs | `LEDGER_TABLE_KEYS` is a flat map — two entries cannot share a name. Give ledger names `recurringChecklistItems` / `visitChecklistItems`; keep the other two out of the ledger entirely |
| S2 | **PK-less join tables** — `home_project_spaces` (:45), `home_project_tasks` (:301), `home_project_contractors` (:318), `chat_room_reads` | 4 tables | A row-oriented op log needs a stable row key. Add a surrogate `id`, or model as an array field on the parent row. Decide per table in Wave C |
| S3a | **Natural primary key** — `assistant_identity` PK `household_id`, `google_calendar_tokens` PK `member_id`, `chat_room_participants` composite PK | 3 | All three are **Tier B**, so no action — but the rule stands: a Tier-A table may never be keyed on a natural key. This is Budget 0.3 (`savingsMonthlyTargets` was keyed on `period`, `wishAttachments` on the image key; `engine.ts:36-65`) — the absorbing tombstone makes delete-then-recreate-under-the-same-key **permanently divergent** |
| S3b | **Surrogate PK + a business `uniqueIndex`** — `household_members` `(household_id,user_id)`, `settings` `(user_id,household_id,key)` (`schema-settings.ts:18`), `checklist_item_completions`, `recurring_reminders`, `contractor_job_ratings`, `contractor_shares`, `labor_notification_preferences`, `contractor_quotes`, `quote_requests`, `property_taxes`, `bc_assessment_data` | **11 in Tier A/B** | **A different bug from S3a, and the more likely one.** The ledger has no unique constraint. Two devices editing offline both mint a random `id` for the *same* logical row → **two rows survive the merge** and the app shows a duplicate setting / duplicate rating / duplicate tax record. Fix: **derive the row id deterministically from the natural key** so both devices mint the same key and LWW merges them. Budget already proves the pattern — `goal_${year}_${month}` (`projection.ts:830-837`). Random `newLocalId()` is only safe for rows with no business uniqueness |
| S4 | **`household_members.role` is free text** (`'owner' \| 'member'` by convention) | `schema.ts:160` | `lf_memberships.role` is `CHECK (role IN ('OWNER','ADULT'))`. Pick the enum before writing the registry; a role string that fails the check silently blocks enrollment |
| S5 | **`households` carries domain fields** — address, `unit_system`, `photo_key`, `purchase_price`, `purchase_date` | `schema.ts:124` | `lf_households` is metadata-only by design (id, owner, display name, key epoch). The domain fields must live in the **ledger** `households` row, not the control plane. The control-plane mirror writes legacy `households.name` (`local-first-control-service.ts:59-65`); `lf_households.display_name` is a separate column. Domain fields (address, `unit_system`, `photo_key`, purchase price/date) must live in the **ledger** `households` row, not the control plane |

**Verification:** a `registry-guard.test.ts` that asserts (a) every `LEDGER_TABLE_KEYS` name is
unique, (b) every value names a field that exists on the row type, (c) no Tier-A table appears in
the Tier-B/C/D lists, (d) **every S3b table has a registered deterministic-id builder** and no
Tier-A table is keyed on a natural key. Runs in `npm test`.

**Convergence test for S3b (required, one per table):** two offline devices create the "same"
logical row independently → after sync exactly **one** row exists. Without deterministic ids this
test fails, which is the point of writing it first.

### 1.6 Wide-row containment (N5) — ✅ **MEASURED 2026-08-13, Q12 decided: do all three**

**The H10 numbers are in, and they are not close.** From
[house-local-first-scale-baseline.md](../../engineering/testing/house-local-first-scale-baseline.md)
(deterministic metrics — sizes, counts and ratios are load-independent, so these stand even though
the run's *timings* are provisional):

| Measure | 1y | 3y | 5y | 10y |
|---|---|---|---|---|
| `edit.lww.stamps` | 45.2 k | 127.2 k | 209.1 k | **414.0 k** |
| `edit.lww.json.chars` | 2.78 M | 7.83 M | 12.88 M | **25.50 M** |
| **`edit.lww.charsPerRowChar`** | **1.93** | **1.92** | **1.91** | **1.91** |
| `edit.lww.bytesPerStamp` | 61.5 | 61.5 | 61.6 | 61.6 |

**The watermark map is ~1.9× the row data it describes, at every scale.** The ratio is flat, so
this is structural, not an artefact of one corpus size: at ten years House carries **25.5 MB of
stamps against 13.3 MB of rows**. Budget's audit finding C18 measured 6.1 MB vs 3.0 MB and was left
open as debt; House is 4× that in absolute terms and lands on the same ratio.

The wide-row cost shows up directly in what a single edit writes:

| Measure | Value | Meaning |
|---|---|---|
| `edit.amplification.sealedPerDeltaByte` | **8.7×** | editing a `maintenanceCompletions` field |
| `edit.wideRow.amplification.sealedPerDeltaByte` | **44×** | editing ONE `tasks` field — 3.8 KiB written for an 88-byte title change |
| `edit.wideRow.envelope.chars` | ~3.9 k | one task row **plus its 41 stamps**, which is most of it |

**Q12 is therefore closed: implement all three mitigations.** The condition the plan set — "do all
three if H10 says the LWW map exceeds the row bytes" — is met by a factor of nearly two, and the
44× wide-row amplification says stamp interning alone (a ~35% win) does not get there. Sequencing:
**interning first** (pure win, no semantic change), then **column pruning** on `tasks` (measured at
41 populated DTO fields against 58 D1 columns — the server-derived enrichment output is exactly the
set to move to a Tier-D row), then **field grouping**, which is the only one that costs conflict
granularity and so should be sized against the other two's results rather than assumed.

*Correction to the estimate below:* the pre-measurement arithmetic assumed 58 stamps of ~40 bytes
≈ 2.3 KB per task row. Measured, a task row carries **41** stamps (the ledger row is the DTO, which
is narrower than the D1 table) at **~61.6 bytes each including map overhead** ≈ 2.5 KB. The estimate
was right within 10% for the wrong reasons — fewer stamps, each dearer than assumed.

#### Original estimate and the three candidates

Per-field LWW means a 58-column `tasks` row carries up to 58 stamps of ~40 bytes each
(`${hlc}|${authorMemberId}`) ≈ **2.3 KB of metadata per task row**, against
maybe 1.5 KB of payload. At 2,500 tasks that is ~5.8 MB of LWW before any other table.

Three candidate mitigations, all three now selected (Q12, above):

1. **Field grouping** — declare co-edited column groups per table (e.g. all `workflow_*` fields
   share one stamp). Cuts stamp count ~4× on `tasks`; loses field-level conflict granularity
   *within* a group.
2. **Stamp interning** — the author id repeats endlessly; intern `authorMemberId` into a small
   table and store `${hlc}|${authorIdx}`. Pure win, ~35% smaller, no semantic change.
3. **Column pruning** — several of the 58 `tasks` columns are server-derived (enrichment output).
   Move them to a Tier-D derived row keyed by task id, so they never get a stamp.

**H10 said it does, by ~1.9×.** Budget shipped without them and recorded C18 as debt; House starts
wider and is not repeating that — the three land before Wave A goes brand-default-on.

### 1.7 Kill switch & ops runbook (P0) ♻️

Mirrors Budget §1.6 **names**, not the stale `HOME_*` draft. **One Worker var, one client flag.**

| Flag | Meaning | Default |
|---|---|---|
| `EXPO_PUBLIC_HOUSE_LOCAL_FIRST` | Client path gate. `1` on / `0` off / unset → on for `symply-house` only | **off until Wave A DoD**, then on for the House brand |
| `EXPO_PUBLIC_HOUSE_P2P` | WebRTC transport | off unless `=1` |
| `LOCAL_FIRST_API_ENABLED` | Worker var (mirrors `BUDGET_API_ENABLED`). Combined with `localFirstApi` capability | House **staging `"true"` after H0** (lab needs `/v2`); House **production `"false"` until Wave A DoD**; Budget stays able to serve `/v2` |
| `localFirstApi` | `BrandCapabilities` key — House + Budget `true`; Kaizen + Health `false` | additive; also add to `BrandCapabilityKey` union (`brand-capabilities.ts:19-28`) |

**Do not introduce `HOME_LOCAL_FIRST_ENABLED`.** That name is retired as of v1.5.

**`EXPO_PUBLIC_*` is inlined at bundle time.** Setting `=0` in eas.json / Metro env does **nothing** to already-installed binaries. Incident disable:

1. `wrangler secret put LOCAL_FIRST_API_ENABLED --env production` to `"false"` on the House Worker (**no code deploy**; `[vars]` changes require a full deploy — use secrets for incidents). Then publish an EAS Update that embeds `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0`. Verify the Updates channel the cohort is on actually received it.
2. Verify: House uses remote `src/api/*` paths; no new mailbox deposits; Settings sync card shows the kill. Mailbox drains via the 14-day `MAILBOX_TTL_MS` sweep.
3. Revert: Worker secret `"true"` first, then a client Update with the flag on.

KV is **not** the source of truth (eventual consistency, up to ~60s). The incident source of truth is the **Worker secret** (overrides `[vars]` without a code deploy). Optional: a D1 `platform_config` row fetched on app foreground as a *second* client-side kill that does not require a new binary — if added, cache ≤5 min; do not replace the Worker secret.

**Lab vs production:** capability `localFirstApi: true` on House so routes exist; production Worker var stays `"false"` until Wave A DoD so accidental TestFlight cannot write mailboxes; staging Worker var `"true"` so H1–H12 can hit the live relay.

### 1.8 Inherited invariants (do not re-litigate)

Dual clocks (VV cursor vs HLC stamp) · contiguous-prefix VV · hex HLC counter · 96-bit random
per-row nonce · DEK in SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY` · HDK for ops+checkpoints, DEK
for rows · delta-state diffing, **not** intent replay · LWW + absorbing tombstones · orphan-patch
parking · one physical `lf_rows` table · per-recipient ack + 14d TTL · owner-only checkpoint
publishing · compaction below `min(checkpoint VV, ours, all peer knownVVs)`.
Rationale for each is in the Budget plan §1.2–§1.5, §3–§8. **Reuse the decision, not the debate.**

---

## 2. Stage H0 — enablement 🆕 (mostly configuration)

**Problem.** The `/v2` control plane exists, is deployed to every brand Worker, and its D1 tables
are already on `simple-house-db` — but three things gate it to Budget:

| Gate | Location | Effect on House |
|---|---|---|
| `requireBudgetApi()` on the `/v2` router | `local-first-v2.ts:16`; `index.ts:366-368`; `local-first-signaling-ws.ts:15` | House Worker 404s every `/v2` route |
| `HOUSEHOLD_COORDINATOR` DO binding absent | `backend/wrangler.toml` — bindings stop at `ChatRoomDO`; migration tags stop at `v3` (`:187-196`) | `coordinatorStub()` throws *"HOUSEHOLD_COORDINATOR binding missing — Budget Worker only"* (`local-first-control-service.ts:6-7`) |
| Cron sweeps gated on `isBudgetApiEnabled(env)` | `cron/scheduled.ts:225` | House mailbox/checkpoint blobs would never be reclaimed |

**Fix.**

1. **New capability, not a rename.** Add `localFirstApi: boolean` to `BrandCapabilityKey` **and** `BrandCapabilities` (`backend/src/config/brand-capabilities.ts:19-40`): `symply-house: true`, `symply-budget: true`, Kaizen/Health `false`. Language is **not** in this table (`backend-language/` is a separate deploy). The gate is then a one-liner on the **existing** helper (`middleware/brand-gate.ts:13-20`), **with Budget's 404 body kept for one release**:
   ```ts
   export const requireLocalFirstApi = () => async (c, next) => {
     if (!hasBrandCapability(c.env, 'localFirstApi') || c.env.LOCAL_FIRST_API_ENABLED === 'false') {
       return c.json({ error: 'Not found' }, 404); // same envelope as requireBudgetApi (:34)
     }
     return next();
   };
   ```
   **Do not** return `{ error: { code: 'not_found' } }` on `/v2` until Budget clients ignore the string envelope. `classifySyncError` keys on HTTP status (404 → `'server'`), but other callers may string-match.
   **Swap only the three `/v2` mount points** (`index.ts:366-368`, `local-first-v2.ts:16`, `local-first-signaling-ws.ts:15`) to the new gate. Leave `requireBudgetApi()` on `/households/:id/budget|savings|mortgage|wishes` untouched.
   Add env override `LOCAL_FIRST_API_ENABLED` mirroring `BUDGET_API_ENABLED` (`config/budget-api.ts:5-7`). Add **`isLocalFirstApiEnabled(env)`** in `backend/src/config/local-first-api.ts` (gate on `localFirstApi` capability + `LOCAL_FIRST_API_ENABLED !== 'false'`). Typed `Env` field required. **No `HOME_LOCAL_FIRST_ENABLED`.**
2. **DO binding — per wrangler file, do not copy Budget's tag blindly.** Tags are per Worker script.
   | File | Action |
   |---|---|
   | `backend/wrangler.toml` (House) | Add `HOUSEHOLD_COORDINATOR` → `HouseholdCoordinatorDO` to **top-level + `[env.staging]` + `[env.production]`**. Next free tag is **`v4`**. Current tags: `v1` JobManagerDO+RateLimiterDO, `v2` ChatRoomDO (`:191-193`), `v3` `deleted_classes = ["JobManagerDO"]` (`:195-198`). Staging today binds only `RATE_LIMITER` + `ChatRoomDO` — forgetting staging is the foot-gun. |
   | `backend/wrangler.budget.toml` | **No-op.** Binding + `tag = "v4"` already present (`:57-58`, `:167-169`). |
   | `backend/wrangler.kaizen.toml` | **Do not bind.** `localFirstApi: false`. Confirm `deploy:fleet` still succeeds with `HouseholdCoordinatorDO` exported from `index.ts:664`. If Cloudflare requires a migration tag for the exported class, add `v4` **without** the binding. |
   | `backend/wrangler.health.toml` | ⚠️ **Superseded by Health V2 He0 — this row said "do not bind" and is no longer the tree.** Health now carries `localFirstApi: true` and **binds** `HOUSEHOLD_COORDINATOR` in all three envs (`:59-61`, `:250-252`, `:423-425`) with `tag = "v4"`. See `Health v2/health-local-first-implementation-plan.md` §2 item 2 — the four stale "House+Budget only" comment sites plus this row were the He0 documentation exit. |
   | Language | **Out of scope.** `deploy:fleet` is House+Budget+Kaizen+Health only (`deploy:language:all` is separate). |
   After bind: add a hibernation/signaling smoke (`acceptWebSocket` wake restores coordinator state). The class already uses the hibernatable WebSocket API.
3. **Cron.** Change `cron/scheduled.ts:225` to `if (isLocalFirstApiEnabled(env))`. Keep Budget `localFirstApi: true` so Budget sweeps still run. Both sweeps already use `await import(...)`.
4. **Wake type.** Generalize `local-first-sync-wake-service.ts`: keep `validateOpaqueWakePayload()` and `PROHIBITED_WAKE_PAYLOAD_KEYS` verbatim, parameterize the allowed `type` to `'budget_sync_wake' | 'house_sync_wake'`. Do **not** widen the payload schema.
5. **Client header.** `X-House-Local-First: '1'` on every House `/v2` call; add `rejectHomeWritesForLocalFirst()` mirroring `rejectFinancialWritesForLocalFirst` (`middleware/budget-local-first-gate.ts:25-39`, **not** `:21-23` which is `isFinancialBudgetPath`) over a **subset** of the 31 `gateHomeApiPaths` prefixes (`index.ts:295-327`) — specifically **excluding** `/chat`, `/chat-rooms`, `/aihousekeeper`, `/api/ai-housekeeper`, `/reports`, `/home-budget`, `/municipalities`, `/maintenance-templates`, `/service-providers`, which stay server-authoritative (Tier B/C).
6. **Close the ported bug + uniformity.** `GET /v2/households/:id/mailbox` (`local-first-v2.ts:309`) checks household membership but **not** `deviceBelongsToUser` — unlike the ack route (`:377`). Any member can pull another device's addressed ciphertext. **Also** require the deposit path (`:224-288`) to verify `sourceDeviceId` belongs to the caller — today a member can deposit as an arbitrary source. Both land in H0 with tests.

**Benefit.** House gets a proven, already-deployed, zero-knowledge relay for the cost of a config
change and one security fix.

**Verification.**
- `brand-gate` test: `/v2/households` is 200 on House env, **404 on Kaizen and Health**.
- `local-first-v2-contracts.test.ts` extended to pin the new gate.
- New test: mailbox GET with another device's `deviceId` → 403.
- `wrangler deployments list` shows a Version ID postdating the newest `backend/src` commit.

### 2.1 Cutover — wipe the lab, do not orphan it (Q1 locked: wipe authorized)

A device that installs the local-first House build **mints a brand-new household**
(`hh_local_${hex(8)}`, Budget's `mintNewHousehold`, `engine.ts:758-799`). The existing server-side
household — spaces, tasks, appliances, photos — is not migrated. With the wipe authorized, the right
move is to **remove it, not leave it orphaned**: an orphaned property is a row a House user can still
reach through the property switcher, and it will render as a silently empty home.

**Lab-hygiene procedure at Wave-A cutover** (this is Budget's §1.1 hygiene rule, sized for House):

| Step | Action |
|---|---|
| 1 | Snapshot House staging + production D1 to R2 before touching anything — cheap, and the only undo |
| 2 | Truncate the **Tier-A House domain tables** (§1.2) in staging, then production. Leave `users`, auth, `platform_*`, subscriptions and every Tier-B table alone — identity and billing are not part of this |
| 3 | Delete the corresponding R2 objects (space images, task photos, property photos, floor/garden plan assets) for the truncated households |
| 4 | Revoke outstanding legacy invites (`household_invitations`, `household_invite_links`, `household_join_requests`) — see §5.1, they are being replaced by device enrollment |
| 5 | Wipe and reinstall every lab simulator and TestFlight build so no pre-cutover client can rejoin a household that no longer exists |
| 6 | Re-seed the shared test account's households from scratch on the new path |

**Still required even with the wipe:** a short first-run note for internal testers ("Symply House now
stores your home data encrypted on this device; test data from before the switch was cleared").
Silent disappearance gets reported as corruption, and chasing that costs more than the screen.

**Ordering constraint:** truncate (§2.1 step 2) **after** the H0 Worker deploy and **while** `EXPO_PUBLIC_HOUSE_LOCAL_FIRST` is still `0` (remote API only). A Wave-A **binary** may already be installed with the flag off — that is fine. A client with the flag **on** that syncs against half-wiped state produces exactly the mixed-era household the hygiene rule exists to prevent. Then wipe/reinstall lab devices and flip internal devices to `=1`.

### 2.2 Scope note — the other three brands

H0 edits the shared capability table, so Kaizen and Health are touched by the diff even
though nothing changes for them (`localFirstApi: false`). **Language is not in `deploy:fleet`**
(`backend-language/` / `deploy:language:all`) and is out of scope for this capability table.
This plan deliberately does **not** extend local-first to Kaizen, Health, or Language. The §3.1 decision to *promote* the projection core into
`@symply/local-first` rather than fork it is what would make a future Kaizen or Health conversion
cheap — that is its second justification.

**DoD H0.**
- [x] **Budget two-device suite green** (§1.0 gate) — run `20260812-195127`, 22 PASS / 0 FAIL, 2026-08-12
- [x] **Q1 closed 2026-08-12** — no real users; database may be wiped (§1.1)
- [ ] §2.1 lab-truncation executed on staging **then** production, D1 snapshotted to R2 first
- [ ] First-run note for internal testers written and copy-reviewed (§2.1)
- [x] `localFirstApi` capability + `requireLocalFirstApi()` landed; Kaizen/Health 404 proven by test (`local-first-api-gate.test.ts`)
- [x] `HOUSEHOLD_COORDINATOR` binding + DO migration tag `v4` on **House** `wrangler.toml` — verified in all three env blocks (`:74`, `:281`, `:472`); Budget no-op; Kaizen/Health unbound and deploying green
- [x] Cron sweeps run on the House Worker — `cron/scheduled.ts:226` gates on `isLocalFirstApiEnabled(env)`
- [x] Mailbox GET **and** deposit device-ownership fixes landed with tests (`local-first-mailbox-ack.test.ts`)
- [ ] ⏳ **Hibernation/signaling smoke after House bind** — still owed. The DO is bound and deployed, but no test exercises `acceptWebSocket` wake restoring coordinator state
- [x] `deploy:fleet` run; House+Budget+Kaizen+Health healthy (Language excluded); Version IDs recorded below
- [x] `LOCAL_FIRST_API_ENABLED` present: **`"true"` in House staging AND production.** Product owner 2026-08-12 overrode the staged rollout — zero users means no cohort to protect, and divergent envs are not testable. Brand isolation rests on the `localFirstApi` capability, which is test-proven to 404 Kaizen/Health. **No `HOME_LOCAL_FIRST_ENABLED`.**
- [x] Merged to `main` as `03fedf43`; `deploy:fleet` 2026-08-12. Production Version IDs: `simple-house-api` **141ef7e1** · `simple-budget-api` **a9e16b7e** · `symply-kaizen-api` **a4fc5b12** · `symply-health-api` **14b708a9**
- [x] **Re-deployed at H1 close** — `deploy:fleet` (staging **then** production, all four Workers, Language excluded). Production Version IDs: `simple-house-api` **80e76dda** · `simple-budget-api` **53bb8d45** · `symply-kaizen-api` **c181c6f7** · `symply-health-api` **9f8b153a**. `/health` 200 on all four. **Live brand-isolation proof:** `GET /v2/households` returns **401** (auth challenge — the route exists) on House and Budget, and **`{"error":"Not found"}` 404** on Kaizen and Health — the flat envelope, in production, byte-identical to what the new contract test asserts
- [x] Mailbox **GET** device-ownership fix landed, plus a `sourceDeviceId` ownership check on deposit
- [x] ⚠️→✅ **Kaizen/Health `tag = "v4"` — RESOLVED 2026-08-12: it stays, and why is recorded in both wrangler files.** Removing the tag is the risky move, not keeping it: `v4` has already been applied to both live scripts, and wrangler refuses a deploy whose config stops short of the tag the deployed Worker is on. Neither brand binds `HOUSEHOLD_COORDINATOR` and both have `localFirstApi: false`, so the namespace is unaddressable — no requests, no storage, no cost. Retained history exactly like the `JobManagerDO` `v1`/`v3` tags above.
- [x] `requireLocalFirstApi` 404 body is `{ error: 'Not found' }` — pinned by `backend/src/middleware/__tests__/local-first-api-gate.test.ts` (10 tests), which asserts it byte-for-byte against `requireBudgetApi`'s response and proves House/Budget 200 vs Kaizen/Health 404

---

## 3. Stage H1 — ledger core ✅ **SHIPPED 2026-08-12** (registry, projection, engine, session)

### 3.0 As-built — what actually landed 🟢

| Artifact | Path | Lines | Note |
|---|---|---|---|
| Shared merge core | `packages/local-first/src/projection/projection.ts` | 855 | `createLedgerProjection(schema)`; the promoted 1,060 mechanical lines |
| Wire/merge types | `packages/local-first/src/projection/types.ts` | 133 | generic over the brand's table-name union |
| Schema descriptor | `packages/local-first/src/projection/schema.ts` | 74 | `defineLedgerSchema` — validates every table has a key field |
| Deterministic ids | `packages/local-first/src/projection/deterministic-id.ts` | 60 | `deterministicRowId(prefix, parts)`, sha256-derived, delimiter-safe |
| **Budget adapter** | `src/features/budget/local/projection.ts` | **1,107 → 147** | registry only; **every export name and signature unchanged** |
| House registry | `src/features/house/local/schema.ts` | 176 | 21 Wave-A tables + physical-name map + tier lists |
| House id builders | `src/features/house/local/ids.ts` | 60 | one per S3b table, wired to the guard |
| House row types | `src/features/house/local/types.ts` | 128 | derived collections stripped, owning FK added |
| House projection | `src/features/house/local/projection.ts` | 91 | binds the core to the House descriptor |
| House engine | `src/features/house/local/engine.ts` | 795 | session, `mutateLocalHouseLedger`, checkpoints, restore, adopt |
| House infra | `defaults · errors · flag · ids · persistence · store · driver · cryptoPolyfill · index` | 405 | ported 1:1 from Budget with the brand constants changed |
| House tests | `src/features/house/local/__tests__/` (7 files) | 1,097 | **68 tests** |

**The promotion is a pure refactor, and the evidence is Budget's own suites**: 196/196 Budget local
tests, 166 package tests (+3 skipped) and 3,967 backend tests all green with no test edited except
one — `mirror-guard.test.ts`, whose `collectRowWrites` digest now pins the function at its new home
in the package. Budget's `LEDGER_TABLE_KEYS`, `rowBucket`, `applyLedgerDelta`, `diffLedger` and the
rest are still importable from `./projection` with identical types, so the ~70 Budget call sites
were not touched at all.

**Two divergences from the design, both deliberate:**

1. **`emptyHouseTables()` instead of Budget's three hand-written `empty*Tables()` helpers.** Budget
   lists its tables in five places (`LocalBudgetLedger`, two empty-table builders, `normalizeLedger`,
   and each session constructor) and they have already drifted once. House derives all of them from
   one function, so Wave B and Wave C add a table in two places (the interface and that function)
   rather than six.
2. **`normalizeLedger` is registry-driven**, not a hand-listed spread — a Wave-A snapshot opened on
   a Wave-B build backfills every new table automatically.

**Not in H1, on purpose:** no API facades, no screen cutover, no sync client wiring. Those are H3/H4
and they must wait for the H10 baseline (§0). What exists today is a ledger a device can open,
mutate, persist, reopen and merge peer deltas into — nothing reads it yet.

### 3.1 Promote `projection.ts` into the package instead of forking it (Q13) — ✅ **DONE: promoted**

Only ~40 of 1,104 lines are Budget-specific: `LEDGER_TABLE_KEYS` (`:42`), `WINDOWED_DATE_FIELDS`
(`:77`) and one `table === 'goals'` branch (`:108`). Two options:

| Option | Cost now | Cost later |
|---|---|---|
| **Fork** — copy to `src/features/house/local/projection.ts` | 1 day | Two 1,100-line CRDT cores drift. Every future fix (parking, NaN guard, index threshold) must be applied twice, forever |
| **Promote** — move the mechanical 1,060 lines to `@symply/local-first/projection`, parameterized on a `LedgerSchema { tableKeys, windowedDateFields, bucketOverride? }` descriptor | 3–4 days, and re-verifies Budget's **196** local tests + **166** package tests | One core. House and Budget both pass a descriptor |

**Decision: promote** — and it is done. The `goals` special case became exactly the predicted
`bucketOverride` hook (`budgetBucketOverride`, 15 lines in Budget's adapter). Two things the design
did not anticipate, both handled inside the package:

- **`__DEV__` is a React Native bundler global**, not something a library may reference. The
  descriptor takes `isDev?: () => boolean`; both brands pass `() => __DEV__`, and the package
  defaults to "not dev" so a Node consumer never crashes on the keyless-row throw.
- **TypeScript refuses to write through an index whose key type is an unresolved generic** (TS2862).
  Every map keyed by the brand's table union is built through a `Record<string, …>` view and
  re-narrowed on the way out — a typing accommodation only; the runtime objects are the same ones
  Budget always used.

### 3.2 The House ledger registry

```ts
// src/features/house/local/schema.ts
export const HOUSE_LEDGER_TABLE_KEYS = {
  households: 'id', householdMembers: 'id', householdSpaces: 'id',
  tasks: 'id', maintenanceCompletions: 'id', maintenanceSubtasks: 'id', maintenanceTaskNotes: 'id',
  homeFeatures: 'id', appliances: 'id', applianceServiceHistory: 'id',
  garbageSchedules: 'id', seasonalChecklists: 'id', seasonalChecklistItems: 'id',
  recurringChecklists: 'id', recurringChecklistItems: 'id',   // S1 disambiguation
  checklistInstances: 'id', checklistItemCompletions: 'id',
  householdNotes: 'id', settings: 'id', recurringReminders: 'id', taskDrafts: 'id',
} as const;   // Wave A — 21 tables

export const HOUSE_WINDOWED_DATE_FIELDS = {
  tasks: ['next_due_date', 'scheduled_work_date', 'created_at'],
  maintenanceCompletions: ['completed_at'],
  maintenanceTaskNotes: ['created_at'],
  applianceServiceHistory: ['service_date'],
  checklistInstances: ['period_start'],
  checklistItemCompletions: ['completed_at'],
  householdNotes: ['created_at'],
  taskDrafts: ['created_at'],
} as const;
```

**Every value is `'id'` — no natural keys, ever** (S3a); rows with a business uniqueness constraint
get a **deterministic** id built from that natural key (S3b), not `newLocalId()`.

Row element types come from `@symply/contracts` where they already exist — `task.ts` (77),
`household.ts` (36), `household-member.ts` (24), `appliance.ts` (38), `home-feature.ts` (33),
`report.ts` (42) — and from the `src/api/*` DTOs otherwise. This is exactly Budget's rule that a
ledger row **is** the DTO the remote API returned, which is why screens see no shape change; using
the contracts package where it already covers a table additionally keeps FE and BE from drifting.

**Bucket policy** (inherited): first field yielding `YYYY-MM` wins; anything unparseable and
**every tombstone** degrades to `ALWAYS_RESIDENT_BUCKET = '*'`. 13 of the 21 Wave-A tables are
always resident — that is intended: they are small and screens read them on every render.

### 3.3 `HouseLedger` + engine

Mirror `engine.ts` structurally. Deltas from Budget:

| Budget | House |
|---|---|
| `LocalBudgetLedger` with 25 arrays, one household | `HouseLedger` with 21 arrays (Wave A), **one per property** — see H5 |
| `mintNewHousehold` seeds 10 default categories (`defaults.ts`) | Seeds preset spaces (`backend/src/data/preset-spaces.ts`, 94 LOC — port to client) + default seasonal checklists |
| DEK key `budget.localFirst.dek.v1` | **`house.localFirst.dek.v1`** — must differ or the two apps fight over one Keychain entry |
| DB `symply-budget-local-first.db` | **`symply-house-local-first.db`** |
| Errors `BudgetLocal*` | `HouseLocalUnsupportedError`, `HouseLocalNotReadyError`, `HouseLocalEnrolmentPendingError` |

`mutateLocalLedger(mutator, op)` is reproduced **verbatim in behaviour**: capture → mutate → diff →
op append (HDK-sealed, Ed25519-signed) → per-row DEK seal → `putRows` + `markProjected`, all inside
one `store.runInTransaction`, with the enrolment-pending guard and **no implicit sync kick**.

**Non-negotiable rule for every call site:** bulk writes use `chunkRowsForOp` and emit **one op per
chunk**, never one op per row. Budget measured looping single writes as quadratic (capture+diff+seal
over a growing ledger). House's bulk paths — `householdSpacesApi.bulk`, `tasksApi` plan/report
generation, `checklistsApi.createDefaults`, `seasonalChecklistsApi` generation, report→task-draft
conversion — are all worse than Budget's because they run at onboarding when the user is watching.

### 3.4 DoD H1

- [x] §3.1 decided (Q13) → **promote**. Budget's **196** local tests + **166** package tests + **3,967** backend tests (incl. the 46 local-first ones) all green on the promoted package, with the House registry consuming it in the same tree
- [x] `registryGuard.test.ts` green — 13 assertions: Wave-A count, ledger-name uniqueness, physical-name uniqueness, key-field existence on the ledger, windowed fields naming real tables, S1 renames, S3b builder coverage in both directions, tier disjointness (A↔B/C/D and B↔C↔D)
- [x] Re-key list (S3) in the registry: `HOUSE_DETERMINISTIC_ID_TABLES` names the natural-key columns for all four Wave-A S3b tables (`household_members`, `settings`, `checklist_item_completions`, `recurring_reminders`); **no Tier-A table is keyed on a natural key** (every value is `'id'`, asserted)
- [x] S1 name collisions resolved: `checklists`/`checklist_items` register as `recurringChecklists`/`recurringChecklistItems`; `municipality_configs` and `scheduled_notifications` are proven absent from Tier A
- [x] `mutateLocalHouseLedger` round-trip: create → edit → delete → reopen session → state identical (`houseSession.test.ts`), including that the **tombstone survives the reopen** — without it a peer's stale edit would resurrect the row on the next sync
- [x] Out-of-order delivery (6 tests incl. the parked-row bound), NaN guard, bulk-op chunking, cursor-strategy equivalence and apply-scale at 20,000 rows — all green against the House registry
- [x] **S3b convergence test per table** (§1.5's "required, one per table"): two offline devices create the same logical row → exactly one row on both replicas, with the newer stamp winning. Plus the counter-example — the same scenario with random ids **does** leave two rows, which is the bug the rule exists to prevent
- [x] `house.localFirst.dek.v1` + `symply-house-local-first.db` asserted distinct from Budget's constants in the same Jest process (`houseSession.test.ts`); on-device confirmation with both apps installed still owed at H12

**Known gap carried into H3:** the S3b builders exist and are guarded, but no write site calls them
yet — there are no write sites. `registryGuard` fails the moment a Wave-B/C S3b table is registered
without a builder, which is the point; a lint-style check that every *call site* uses one belongs
with the facades in H3.

---

## 4. Stage H10 — scale harness first ✅ **SHIPPED 2026-08-13** (ran before H3, as required)

**Problem.** House has **no scale corpus**. Budget's generator
(`packages/local-first/__tests__/scale/generator.test.ts:42-60`) pins 5 y / 2 adults = 11,833 rows /
17,750 ops and 10 y = 23,578 / 35,367. There is no House analogue, so every performance claim in
Waves A–C would be unfalsifiable — the exact condition the Budget plan calls out.

**Fix.** Extend the existing harness (`__tests__/scale/`, phases `coldopen`/`edit`/`apply`/`batchcap`)
with a **House corpus generator**, deterministic (`mulberry32`, pinned seed) like Budget's, sized
from the schema's cardinality drivers:

| Table | 5 y | 10 y | Driver |
|---|---|---|---|
| `maintenanceCompletions` | 3,000–8,000 | 6,000–16,000 | one row per occurrence of each recurring task — **House's `expenses`** |
| `maintenanceSubtasks` | 2,000–5,000 | 4,000–10,000 | 3–5 per AI-enriched task |
| `tasks` | 1,200–2,500 | 2,500–5,000 | ~40 active recurring + ad-hoc; **58 cols is the cost, not the count** |
| `checklistInstances` + `checklistItemCompletions` | 1,000–3,000 | 2,000–6,000 | weekly/seasonal |
| `taskDrafts` | 200–1,000 | 400–2,000 | report-seeded |
| Wave A total | **~8,000–20,000 rows** | **~16,000–40,000** | |
| + Wave B/C | **~20,000–45,000** | **~40,000–90,000** | |
| Ops (Budget ratio 1.5×) | ~30k–68k | ~60k–135k | |
| **× properties (1–3)** | up to **3×** | up to **3×** | House-only multiplier |

These are **estimates, not measurements** — that is the point of the stage.

### 4.1 As-built — what the generator produced 🟢

The composition table lands inside **every** envelope above, and near the middle of the Wave-A
total. `house-generator.test.ts` pins the counts, the field set and the per-row JSON size of all 21
tables, plus the corpus fingerprint `a7c9454e863ba24c`.

| Scale | Rows | Ops | Envelope |
|---|---|---|---|
| 1y/2a | 3,109 | 4,664 | — |
| 3y/2a | 8,833 | 13,250 | — |
| **5y/2a** | **14,557** | **21,836** | ✓ plan 8,000–20,000 |
| **10y/2a** | **28,867** | **43,301** | ✓ plan 16,000–40,000 |

| Artifact | Path |
|---|---|
| Corpus generator | `packages/local-first/__tests__/scale/lib/house-ledger-factory.ts` |
| Shared corpus primitives | `.../lib/corpus-core.ts` (registry-generic; Budget adopts it at its next re-baseline — see the file header for why it was not retrofitted) |
| Op factory | `.../lib/house-oplog-factory.ts` — multi-device, one member offline |
| Phases | `.../phases/house-{edit,apply,coldopen,batchcap}.scale.ts` |
| Guards (in `npm test`) | `house-generator.test.ts` (22), `house-corpus-realism.test.ts` (16) |
| Driver | `scripts/e2e/lib/house-scale-bench.sh` |

**`house-coldopen` deliberately measures a different algorithm from Budget's.** Budget's phase
replays its legacy MMKV snapshot path; House was written on per-row AEAD storage from day one, so
this measures `listRows → openRowBody → JSON.parse → installRowEnvelopes`. House and Budget
cold-open numbers are not comparable, and `compare` enforces that structurally by refusing to grade
across corpus fingerprints.

### 4.2 The three findings that change H3

1. **N5 is confirmed and Q12 is closed** — see §1.6. The watermark map is **1.9× the row data at
   every scale**; all three mitigations are in.
2. **Cold open is linear and expensive.** `coldopen.usPerRow` is flat at **34–37 µs/row**, so the
   cost is `rows × 35 µs`: **496 ms at 5 years, 1.03 s at 10 years — on V8**. At the plan's own
   3–15× Hermes multiplier that is **1.5–15 s on device**, and multi-property (H5) multiplies it
   again. Hydrating every property's ledger on `refreshAll` is not viable; H5's session manager has
   to hydrate lazily. This is the strongest evidence yet for the plan's "H5 before H3" ordering.
3. **A full catch-up is many deposits.** `batchcap.maxOpsUnderCap` ≈ **452 ops**, flat across
   scales, so a 10-year log is **98 deposits** and one deposit carries ~38 days of history. The
   checkpoint/bootstrap path (H8) is not optional at House's op rate.
4. **Cold open is 91% AEAD, not parsing.** `coldopen.aeadShare` is **0.91–0.92** at every scale:
   `openRowBody` dominates, `JSON.parse` is ~8% and `installRowEnvelopes` under 1%. The lever for
   making cold open faster is therefore **fewer, larger sealed units** — not a faster parser and not
   a leaner projection. Worth weighing against the per-row granularity that makes the delta write
   path cheap; H3 should not "optimize" the parse.
5. **Lazy hydration works (H5).** `coldopen.threePropertyRatio` is **1.02–1.03×** at every scale
   against the DoD's 1.3× bound, because a non-active property costs only its session build
   (`coldopen.perPropertySessionBuild`, 1.8–13 ms) and never its decrypt.

**Verification / DoD H10.**
- [x] House corpus generator committed with snapshot-pinned per-table row counts and JSON sizes — `house-generator.test.ts`, 22 assertions incl. a committed field/size snapshot and the envelope checks above
- [x] Published to `documents/engineering/testing/house-local-first-scale-baseline.md` (+ `.json`) — 232 records, 16/16 phase×scale runs completed, **zero crashed columns**
- [ ] ⚠️ **Captured with `SCALE_ALLOW_LOAD=1` (loadavg 4.05) — the run is stamped `gate.usable: false`** and `compare` refuses to grade timings against it. The machine's idle floor is ~4.0 from the developer's own desktop apps, so a clean capture needs a quiesced machine, not a code change. **The deterministic metrics are unaffected** — sizes, counts and ratios do not move with load, so every number §1.6 and §4.2 quote (stamps, bytes, ratios, `maxOpsUnderCap`) stands. **Owed: one clean re-take before any H3 timing claim.**
- [x] Metrics: cold open, single-field edit (ms + logical/physical bytes), `applyLedgerDelta` throughput, **LWW-map bytes vs row bytes** (the N5 decision input), max ops under the 512,000-b64 cap — all present, plus a House-only wide-row edit and `coldopen.usPerRow`
- [x] Environment labelled (machine, Node/V8, heap, loadavg); Hermes multiplier stated as the **3–15×** lower bound in the generated document
- [ ] **One on-device Hermes anchor** (cold open + one edit on a real device build) before any H3 performance claim — still owed; it needs a device build, which is H3/H12 work
- [x] Budget's fidelity caveats carried over, plus two House-specific ones: the SQLite read is excluded (`coldopen.listRows` runs against `MemoryLocalFirstStore` and is reported separately — quote `coldopen.cpu`), and multi-property is declared arithmetic, not measurement
- [x] Harness phases stay `*.scale.ts` and are excluded from the default vitest include; the two new guards are `.test.ts` on purpose and run in `npm test` (package suite 166 → **204 passed**)

---

## 5. Stage H2 / H4 / H8 — inherited machinery ♻️

Almost no design work; listed so nothing is forgotten.

| Stage | Reused artifact | House change |
|---|---|---|
| **H2** storage ✅ | `SQLITE_MIGRATION_V1/V2`, `SqliteLocalFirstStore`, `row-aead.ts`, `projected_at` replay, `expo-sqlite-driver.ts` | ✅ Done in H1: `symply-house-local-first.db` + `house.localFirst.dek.v1`, both asserted distinct from Budget's in one Jest process |
| **H4** sync client ✅ | `sync/orchestrator.ts`, `controlPlaneClient.ts`, `httpControlPlane.ts`, `hdkTransfer.ts`, `syncErrors.ts`, `syncStatusStore.ts`, `pushWake.ts` | ✅ All landed under `src/features/house/local/`. Header `X-House-Local-First`, wake type `house_sync_wake`, deep link **`simplehouse://lf-invite`** — all three pinned by `__tests__/syncClient.test.ts`. `syncErrors.ts` was **promoted into `@symply/local-first`** rather than copied (it held no brand); Budget now re-exports it. Mailbox-only: WebRTC is not ported, because `EXPO_PUBLIC_HOUSE_P2P` is off by default and a transport nobody enables is a transport nobody tests. Invite **UI** is still 🆕 (§5.1) and lands with H3 |
| **H4** UI refresh bridge ✅ | `sync/ledgerRefresh.ts` | ✅ **Rewritten, not copied** (§5.2). The engine now reports WHICH tables a delta touched, and the bridge maps them to a bounded key set. No Budget store poking: House's stores are pure state containers fed by the query hooks, so invalidating the query is the whole job |
| **H8** checkpoints ✅ | `sync/checkpoints.ts` + engine export/install/compact | ✅ Thresholds unchanged. Landed with H4 rather than later: H10 measured **452 ops per deposit**, so replaying a log is not a viable bootstrap at House's op rate. One guard added beyond Budget's: catch-up refuses a checkpoint whose VV is behind this device's OWN writes. **Per property** still owed at H5 |

### 5.1 Invite / enrollment UI — House needs a real screen

Budget put the entire invite, approve, OOB-verify and device-revoke flow inside
`BudgetSettingsScreen.tsx` (~350 lines, `:407-702`). House already has a far richer membership
surface — `HouseholdManagementScreen.tsx` (1,206 lines, 7 mutations), `memberStore.ts` (454 lines,
15 API calls), `JoinHouseholdScreen`, `app/join/[token].tsx`, `inviteStore.ts` — built on **three**
server tables (`household_invitations`, `household_invite_links`, `household_join_requests`).

**Decision (Q14):** collapse all three into the `lf_invites` device-enrollment handshake
(create → claim → OOB phrase → approve → HDK deposit), and rebuild `HouseholdManagementScreen`
against it. Keep the existing deep-link entry points; change what they resolve to.
**Do not** run both models at once — a member who joined via the legacy email invite has no device
keypair and therefore no way to decrypt anything.

### 5.2 UI invalidation — the one place Budget's pattern must not be copied

`ledgerRefresh.ts:26-39` fires a **blanket `queryClient.invalidateQueries()`** on every ledger bump.
That is acceptable for Budget: its screens are Zustand + `dataRevision` effects and it holds few
React Query keys. House holds ~15 active query keys (`homeProjectKeys`, `useHomeDashboard`'s five,
`['garbage',…]`, `['weather',…]`, members, reminders, notification history, chat, aihousekeeper) —
**several of which are Tier B server data that a local write has no business refetching.** A blanket
invalidate on every remote op turns each sync into a burst of network requests against exactly the
endpoints local-first was meant to stop calling.

**Required:** a per-table → query-key map, so a `tasks` delta invalidates the task keys and nothing
else. Must land with H3. Starter map (extend in the H3 PR, do not ship a blanket invalidate "temporarily"):

| Ledger table | Invalidate |
|---|---|
| `tasks`, `maintenanceCompletions`, `maintenanceSubtasks`, `maintenanceTaskNotes` | task list / upcoming / dashboard task keys |
| `householdSpaces`, `homeFeatures`, `appliances` | home dashboard + space keys |
| `garbageSchedules` | `['garbage', householdId, …]` |
| `checklists*`, `seasonal*` | checklist keys |
| `settings`, `householdNotes`, `recurringReminders` | matching domain keys |
| `households`, `householdMembers` | member/property-switcher keys |
| *(never)* | chat, aihousekeeper, reports, notification history, weather — Tier B/C |

#### ✅ As-built (2026-08-13)

`sync/ledgerRefresh.ts` ships the full map — `HOUSE_TABLE_QUERY_KEYS`, typed
`Record<HouseLedgerTableName, …>` so a new Wave-B/C table **cannot compile**
without a mapping (this already caught `applianceServiceHistory` during the
port). Three mechanisms keep it honest, all asserted in
`__tests__/ledgerRefresh.test.ts` (10 tests):

1. **Exhaustive** — every registered table maps to at least one key prefix, and
   nothing maps that is not a registered table.
2. **Never empty** — a zero-length prefix matches every query, i.e. it is a
   blanket invalidate wearing a map. Asserted per entry.
3. **Tier B/C unreachable** — `HOUSE_NEVER_INVALIDATED_KEYS` lists chat, AI
   Housekeeper, reports, notifications, weather, `home-budget`, AI usage and the
   Tier-C reference endpoints, and a prefix-matching check proves no mapped
   prefix can reach any of them. The test also proves it is *capable* of failing:
   a bare `['home']` prefix WOULD reach `['home','home-budget']`, which is why
   the map only uses the two-segment forms.

The precondition for all of it was an engine change: `notifyLedgerChanged` now
carries the touched tables, derived from the delta's `u`/`d` keys.
A **local echo emits nothing at all** — the author's UI already rendered the
write, and invalidating there would refetch on every save. Only three events
legitimately invalidate everything, and each says so at the call site: a backup
restore, a checkpoint install, and adopting a joined property.

---

## 6. Stage H3 — API facades + screen cutover 🆕 (the volume work)

**Problem.** House writes go through **10 Wave-A api modules (~117 methods)**; the fleet has **67** `src/api/*.ts` files (excl. `index`). Screens: **163** `*Screen.tsx`. Stores: **36** (excl. `index.ts`).

**Fix — the Proxy facade, unchanged.** Budget's mechanism is the best part of the whole refactor and
it makes screen churn **zero**:

```ts
export const tasksApi: typeof remoteTasksApi = new Proxy(remoteTasksApi, {
  get(target, prop, receiver) {
    try {
      const { isHouseLocalFirst } = require('@features/house/local/flag');   // narrow require —
      if (isHouseLocalFirst()) {                                            // never the barrel
        const { localTasksApi } = require('@features/house/local/localTasksApi');
        const fn = (localTasksApi as Record<string | symbol, unknown>)[prop];
        if (typeof fn === 'function') return fn.bind(localTasksApi);
      }
    } catch { /* feature not ready — fall through to remote */ }
    const v = Reflect.get(target, prop, receiver);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
```

Two Budget lessons to carry: the `require` must target `flag.ts` directly (the barrel pulls the
banner, WebRTC and the orchestrator into every API call), and at least the highest-traffic modules
should adopt `savings.ts:1454`'s stricter variant that **throws** `HouseLocalUnsupportedError` for a
missing local method rather than silently falling through to a server that has no data.

**Coverage rule (inherited, non-negotiable):** every remote method gets a local counterpart. Gaps
are expressed as a *thrown* `HouseLocalUnsupportedError` with member-facing copy
(`ai/localAiUnsupported.ts` pattern), **never** as a missing key — a missing key silently routes to
an empty server.

**Wave A modules and their real cost:**

| Module | Remote LOC | Methods | Notes |
|---|---|---|---|
| `tasks.ts` | 728 | **31** | The big one. `/quick`, `/upcoming`, `/plan`, `/report`, `/history`, subtasks, notes, block/unblock, workflow-stage, schedule-work, budget-item, quotes |
| `household-spaces.ts` | 130 | 8 | incl. bulk + reorder |
| `appliances.ts` | 205 | 9 | documents → H6 |
| `checklists.ts` | 162 | 8 | `createDefaults` is a bulk path |
| `seasonal-checklists.ts` | 126 | 6 | |
| `home-features.ts` | 184 | 6 | |
| `garbage-collection.ts` | 224 | 9 | `/municipalities` stays Tier C; `/ai-detect` → H7 |
| `settings.ts` | 163 | 6 | |
| `task-drafts.ts` | 276 | 8 | `/generate` → H7 |
| `households.ts` | 390 | 26 | **split**: membership/invite → §5.1; property fields → ledger; photo → H6 |
| **Wave A total** | **≈2,590** | **≈117** | Expect the local implementations to be **1.5–2×** the remote LOC, as Budget's were (`localBudgetApi.ts` 1,124 vs `budget.ts` remote block) |

**The hidden cost — server business logic that must be re-implemented on device.** Budget paid
~1,150 lines for this (`savingsLimits.ts` *"Ported from backend/src/services/savings-limits.ts — keep
in sync"*, `recurringScope.ts`, `localMortgageProjector.ts`, `localMortgageReconciliation.ts`).
House's equivalents, each of which must be ported and then kept in sync:

| Server logic | Where | Why the client needs it |
|---|---|---|
| Recurring-task next-occurrence engine | `services/recurring-reminders/engine`, `ReminderService` | tasks cannot generate their own occurrences offline otherwise |
| Task workflow-stage transitions | `routes/tasks.ts` | 58-col `tasks` has server-enforced state rules |
| Seasonal-checklist generation | `services/*seasonal*` | onboarding + yearly rollover |
| Garbage-schedule expansion from municipality config | `services/garbage-schedule-*` | Tier-C reference data → local occurrences |
| Checklist instance materialization | `routes/checklists.ts` | `checklist_instances` are server-created today |
| Task ↔ home-budget linkage | `routes/home-budget.ts` | cross-domain; may stay remote (Q11) |

**Budget ~1,200–1,800 lines for this category alone.** It is the most commonly underestimated part
of the refactor and it is why H3 is a wave, not a sprint.

### 6.1 App wiring — the four integration points Budget uses

Reproduce these exactly; they are easy to miss and each failure mode is silent.

| Point | Budget site | House form |
|---|---|---|
| Post-sign-in session open | `authStore.ts:198-202` | `ensureHouseLocalSession()` — must open **all** the user's properties lazily (H5) |
| Post-hydrate cold start | `authStore.ts:398-402` | same; gate on `hasHydrated && isAuthenticated` |
| Logout teardown | `authStore.ts:261-263` | `teardownHouseLocalSession({ wipe })` |
| Bulk loader | `src/contexts/DataContext.tsx:83-85` fetches `reportsApi.list` + `tasksApi.list` + `tasksApi.getUpcoming(30)` **per household**, after `:188` enumerates households | Under local-first the task fetches are ledger reads, not HTTP. `reportsApi` stays remote (Tier B). **Do not leave the loop calling `tasksApi` per household** — with H5 that is N ledger hydrations on every `refreshAll` |

Also inherited: `startHouseLedgerRefreshBridge()` on open, the auto-backup scheduler started from
`DataContext` and **not** from `ensureSession` (Budget hit an import cycle there,
`ensureSession.ts:79-82`), and `cryptoPolyfill` imported as a bare side-effect **before** any
`@symply/local-first` import (`@noble/*` captures `globalThis.crypto` at module load).

### 6.2 Test-environment landmines (all previously paid for)

- **`await import()` throws under Jest** without `--experimental-vm-modules`. Budget's backup module
  documents this (`budgetBackup.ts:20-24`) and uses a static import. Go static unless a real cycle exists.
- The store falls back to `MemoryLocalFirstStore` under `JEST_WORKER_ID`
  (`budget-local-first-store.ts:16-31`); its semantics must match the SQL store exactly or tests
  certify a store nobody ships.
- **MMKV is dead under the New Architecture** — persist stores must use `asyncStorage`; Jest hides it.
- Jest asserts the **House** brand baseline, so a checkout left on another brand's generated icons
  or tokens fails unrelated suites. Restore with the House icon/token build before judging a red run.

### 6.3 Four bugs the port found 🟢

Porting server logic to a device is a differential test of that logic. Four
defects fell out, each verified independently before being recorded:

1. **Timezone-fragile recurrence.** The server's `date.setMonth(...)` is correct
   only because Workers run fixed at UTC. On a device `2026-01-15 +3mo` yields
   `2026-04-14` in America/Vancouver against `2026-04-15` in UTC, and
   `2026-02-01 +1mo` yields `03-04` against `03-01`. Two members in different
   zones would compute **different `next_due_date` for the same completion**, and
   per-field LWW would flap that column forever. The port uses `setUTC*`; the
   server's own fixtures (`backend/src/services/__tests__/reminder-date-math.test.ts`)
   are copied in and pass unchanged — two of them failed first, which is how it
   was found.
2. **Per-viewer fields were being ledgered.** `my_role`, `member_count` and
   `photo_url` sat on the `households` row, and the binding was **the same
   object** as the row at three sites — so a peer's delta carrying
   `my_role: 'owner'` wrote through into this device's answer and would hand a
   member the owner's controls. Fixed structurally: `LedgeredHousehold`
   (`types.ts`) omits them, so they cannot enter a delta because they are not on
   the row. The type change immediately caught two call sites doing exactly this.
3. **S3b arriving through a READ.** Three tables auto-materialize on read —
   `getSchedule`, `getProgress`, `getCurrent` — so two members merely OPENING a
   tab offline each mint a row and both survive the merge. §1.5's hazard table
   only anticipated the write path. `garbageSchedules`, `checklistInstances` and
   `seasonalChecklists` now have deterministic builders and `registryGuard`
   coverage.
4. **A live House bug, unrelated to this work.** `checklist-service.ts:15` sends
   `progress` as a number; `SeasonalChecklistScreen.tsx:88` reads
   `progress.completed`. The seasonal screen is broken against the real server
   today. The facade composes the object the screen expects, so local-first
   households are unaffected — **the remote path still needs its own fix.**

Two further decisions were forced by the cutover and are worth knowing:

- **Local-first is OPT-IN under Jest** (`flag.ts`). House is the brand the Jest
  baseline runs, so the brand check would return true in every suite and the
  Proxy would route every existing remote-api test into an unopened ledger.
  Budget never hit this because Jest is not the Budget brand. `proxyRouting.test.ts`
  turns the flag on explicitly so the local branch is still covered.
- **An unsupported method returns a REJECTED PROMISE**, not a synchronous throw.
  Every remote method returns a promise, so a caller written as
  `api.x().catch(...)` rather than `try { await api.x() }` would otherwise get an
  uncaught throw where a network failure would have been caught.

**DoD H3 (Wave A).**
- [x] Every Wave-A remote module has a Proxy and a 1:1 local implementation; a programmatic test diffs method names both ways and fails on any gap — `apiParity.test.ts`, 10 modules, both directions, with a written reason required per remote-by-design method
- [x] Per-table → query-key invalidation map landed (§5.2); **no blanket `invalidateQueries`** — proven by `ledgerRefresh.test.ts`, including that no mapped prefix can reach a Tier-B/C key
- [x] Ported server logic each has a unit test asserting parity with the server implementation's fixtures — recurrence against the server's own fixture file; garbage expansion against fixtures generated by running the server function under `TZ=UTC`; checklist/seasonal against the service's rules
- [x] Onboarding (spaces + seasonal checklists + preset features) completes offline — the seed is minted in-memory at session open with no network in the path; covered by `houseSession.test.ts`. **Airplane-mode cold install on a device is still owed** (needs a device build — H12)
- [ ] H10 re-run on the real write path; cold open and single-edit within the baseline's stated envelope — **owed.** The harness measures the projection directly, not through the facades; and the baseline itself still needs its clean re-take (§4)
- [x] **H7-lite:** BOTH live, neither dark. Rolling-horizon reminders measured at **30 scheduled** on the 10-year corpus against a 56-slot budget under the iOS cap of 64; widget projection is an 8-field allowlist with wipe-on-logout wired into `teardownHouseLocalSession`. One sub-case IS dark and says so: checklist due dates, because `notificationRouting.ts` has no `checklist_due` case
- [x] Zero screen files changed for the **Proxy** cutover — `git diff --stat src/screens` is **empty**. The §5.1 invite rebuild (the plan's explicit exception) has NOT been done: the enrolment handshake is reachable through `localHouseholdsApi`, but `HouseholdManagementScreen` still renders the legacy model

---

## 7. Stage H5 — multi-property session manager ✅ **SHIPPED 2026-08-13** 🆕 **House-only**

**Problem.** `engine.ts` is single-household by construction: `state.ledger.household.id` is read
directly in 12 places (`:467, 556, 723, 763, 1021, …`), `openLocalBudgetSessionInner` closes and
reopens when the **member** changes, and `adoptJoinedHousehold` *replaces* the ledger wholesale.
House users routinely hold several properties: `householdStore.propertyMode`,
`showPropertySwitcher`, and `src/contexts/DataContext.tsx:188` enumerates every household on login.

Good news: **the store layer already supports it.** `lf_rows` is `WITHOUT ROWID` with PK
`(household_id, tbl, row_key)`; `nextSeq`, `getVersionVector`, `listOperationsSince`,
`clearRows` and the projection cursors are all household-scoped. Nothing in
`packages/local-first` needs to change.

### 🚧 H5 BLOCKER found 2026-08-12 — `lf_devices.id` is the PRIMARY KEY

The **client** store is household-scoped, but the **control plane** is not:

```sql
-- backend/migrations/0152_local_first_control_plane.sql
CREATE TABLE lf_devices (
  id TEXT PRIMARY KEY NOT NULL,          -- ← one row per device, globally
  household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, ...
  UNIQUE (household_id, id));            -- ← redundant while id is already unique
```

**A device can therefore be an active member of exactly ONE household at a time.**

This surfaced for real: two-device run `20260812-215155` failed `mm-05-member-enrol-sync` with
403s on `GET /mailbox`, because approving a device into a second household conflicted on `id` and
the upsert left the stale `household_id`. Budget's correct fix is to **re-home** the row
(`LF_DEVICE_UPSERT_SQL`, commit `a0902efb`) — a device leaves its own local household and joins
the shared one, so one row is right.

**Re-homing is exactly the wrong semantic for House.** A landlord with three properties needs one
device active in all three simultaneously. Under the current schema, activating property B would
silently re-home the device away from property A — and A's mailbox, ack and checkpoint authz would
start 403ing. The failure mode is the one we just debugged, but permanent and per-property.

**Required before the session manager is written:**

| # | Change | Notes |
|---|---|---|
| 1 | `lf_devices` PK → `(household_id, id)` | New migration. Under §1.1 the table may simply be dropped and recreated — no install base |
| 2 | Every `ON CONFLICT(id)` → `ON CONFLICT(household_id, id)` | `LF_DEVICE_UPSERT_SQL` is now the single site — that consolidation was worth doing for this reason alone |
| 3 | Drop the re-homing `household_id = excluded.household_id` | Correct for Budget's one-household model, wrong once a device may hold several |
| 4 | `revokeDevice`, `lf_devices` push-token lookups, `deviceBelongsToUser` | Already pass `household_id`; re-verify each is scoped, not global |
| 5 | Client `deviceId` | Keep **one** device identity across properties; the composite key is what lets one id appear in N households |

**Sequencing:** land 1–3 as a Budget-safe migration *before* H5 code, and re-run the two-device
suite. Budget behaviour must be identical afterwards (it only ever has one household per device),
which makes it a clean, independently verifiable step.

**Fix — a session registry above the engine.**

```
HouseLocalSessionManager
  ├─ Map<householdId, HouseLedgerSession>   // one engine state per property
  ├─ activeHouseholdId                       // drives the UI
  ├─ open(userId)   → enumerate control-plane households, open each lazily
  ├─ activate(hid)  → hydrate rows for hid if cold, set active, notifyLedgerChanged
  └─ closeAll()
```

Design rules:
1. **One SQLite file, one DEK, N ledgers.** The household is a column, not a database. Do not mint
   a DEK per property **in Wave A.** **Threat-model acceptance:** the device DEK decrypts **every**
   property's `lf_rows` on that device. HDK isolation (per-property ops/checkpoints) does **not**
   protect at-rest rows after a device compromise or a member who retains an offline copy after
   revoke. Mitigations that **are** in scope: logout teardown wipe, remote revoke stops new HDK
   material, SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY` for the interactive path. **Not** in Wave A:
   per-property DEKs. Revisit if security review or H10 demands it. Document in the privacy note.
   **GCM budget:** random 12-byte nonces under one DEK are safe to ~2³² seals (NIST SP 800-38D). Household
   scale is far below that; H10 must still report estimated seal count × properties. Rotation is a
   follow-up only if the corpus approaches the cap.
2. **One `HouseholdKeys` (HDK) per property**, per key epoch — each property is its own membership
   and its own key epoch. `installHouseholdKeys` becomes per-session.
3. **Lazy hydration.** Only the active property's rows are decrypted into memory at activate time.
   A 3-property user must not pay 3× cold open. Measure in H10 with a 3-property corpus.
4. **Sync fans out.** `runHouseLocalSync()` iterates sessions; the control-plane state fetch,
   mailbox pull, checkpoint decision and compaction are all per household. Reuse the single-flight
   guard **per household id**, not globally, or one slow property blocks the others.
5. **Push wake carries `householdId`** already (`{type, householdId}`) — route it to the right session.
6. **Checkpoint publishing is per property** and owner-only per property; a user can be owner of one
   and member of another.

**Benefit.** The property switcher keeps working; a landlord with 3 properties gets 3 independent
E2EE ledgers with independent membership.

### 7.1 As-built (2026-08-13) 🟢

`engine.ts` went from one module-level `engine` to
`Map<householdId, EngineState>` + `activeHouseholdId`, exactly the shape the
design proposed. Nothing in `packages/local-first` changed — the store was
household-scoped all along.

| Rule | As-built |
|---|---|
| 1. One SQLite file, one DEK, N ledgers | ✅ `dbKey`, `store` and `identity` are device-scoped fields shared by every session; only `householdKeys`, `opLog` and `ledger` are per property. Threat-model acceptance unchanged and still recorded |
| 2. One HDK per property | ✅ asserted: two properties hold different HDK bytes, and each `householdKeys.householdId` matches its own session |
| 3. Lazy hydration | ✅ `hydrated` per session; a cold open builds every session (a meta read + op list) but decrypts only the active one. **Measured: `coldopen.threePropertyRatio` = 1.02×** against the DoD's 1.3× bound |
| 4. Sync fans out, single-flight per household | ✅ `runHouseLocalSync()` → `Promise.allSettled` over `runHouseLocalSyncFor(id)`, with `syncInFlight` keyed by household. Each run is bound to a `HouseSessionHandle`, never to the active accessors |
| 5. Push wake carries `householdId` | ✅ routed to that property via `runHouseLocalSyncFor`; the token is registered once **per property**, because a peer can only wake this device for a property it shares |
| 6. Checkpoint publishing per property | ✅ owner-role read from that property's ledger, and the checkpoint watermark meta key is `lf.checkpoint.vv:<householdId>` — one shared key would let a compaction on A truncate below what B still needs |

**One design decision the plan did not anticipate.** The OpLog projection
handler is now created **per property** (`projectionFor(householdId)`) rather
than shared. A single handler reading a module-level `engine` would merge a
background property's incoming ops into whichever ledger happened to be active
— the exact cross-household bleed this stage exists to prevent, and invisible
until two properties diverged.

**Also new:** `createLocalHouseProperty` (a second home on the same device,
reusing the device identity) and `removeLocalHouseProperty` (scoped
`clearRows` + `clearSyncPeerStates`, refuses to remove the last one).

**Verification.**
- [x] Two-property unit test: write to A, activate B, write to B, reactivate A → both ledgers intact, ops attributed to the right household, no cross-household row bleed — plus the same across a full close/reopen
- [x] `clearRows(previousHouseholdId)` on leaving a property does not touch the others
- [x] 3-property cold-open benchmark stays within 1.3× the 1-property number — **measured 1.02×**
- [ ] Sync fan-out against a live 403: the unit level proves per-household single-flight and `allSettled` isolation, but the "property A's control plane 403s → property B still syncs" case needs the relay, so it lands with H12
- [x] `__tests__/multiProperty.test.ts` — **15 tests**

**DoD H5.** Three of four verification bullets green at unit level; the live-403
fan-out case and the property switcher driven end-to-end both belong to the
two-device E2E (H12).

---

## 8. Stage H6 — encrypted blob channel ✅ **SHIPPED 2026-08-13** 🆕 **House-only**

**Problem.** Budget's attachment story is a known, documented gap: `localWishMedia.ts` copies the
picked image to `${documentDirectory}wish-images/` and records **only** `{id, key, localUri, mime}`
in the ledger. The row syncs; **the bytes do not.** A peer gets a row whose `localUri` points at a
file that does not exist, and `resolveWishImageUri` returns that dead path without checking.

Budget could live with that — wish photos are decorative and there is one such table. House has
**25 blob-bearing tables**: task photos, space images, property photo, appliance manuals, contractor
documents, quote PDFs, visit voice recordings, checklist item photos + thumbnails, project progress
photos, payment receipts, floor-plan images (5 keys), garden-plan images (3 keys), home-project
attachments, utility bills, property tax and BC assessment PDFs. Several are *the* content of their
feature. "Invisible on your partner's phone" is a defect.

**Fix — a first-class encrypted blob channel.**

```
Client                                  Worker (authz + stream)        R2 (REPORTS_BUCKET)
  pick file
  → contentKey = HKDF(HDK, info="lf-blob:v1:{hh}:{keyEpoch}:{blobId}")
  → per-chunk: random 12-byte nonce; AES-GCM
    AAD = {v, hh, keyEpoch, blobId, chunkIndex, chunkCount, alg}
  → PUT ciphertext to authenticated Worker `/v2/households/:hh/blobs/:blobId/:i`
    Worker never parses the body; streams to R2 `lf-blob/{hh}/{blobId}/{i}`.
    **Default is Worker-proxied** — R2 *bindings* cannot S3-presign
    (`health-assets-service.ts`, household photo `upload_url: null`).
    Language-style `aws4fetch` + scoped R2 API token is a later opt-in if CPU
    becomes a problem; it needs new secrets and is **not** H6 MVP.
    Do **not** use R2 multipart (min part 5 MiB; chunks are ≤512_000 b64).
  → D1 `lf_blobs` / `lf_blob_chunks` after successful PUT (idempotent ON CONFLICT)
    Resume **reuses** the stored `(nonce, ciphertext)` for that chunkIndex —
    never mint a new nonce for the same (contentKey, chunkIndex).
  ledger row stores {blobId, mime, bytes, sha256, chunkCount} — never a device path
Peer
  GET chunks via the same authenticated Worker route (not a public URL)
  → verify per-chunk ciphertext hash + blob plaintext sha256 → decrypt
  → cache under ${cacheDirectory}lf-blobs/{blobId}
```

**R2 binding (normative):** reuse `REPORTS_BUCKET` with prefix `lf-blob/`, matching checkpoints'
`lf-checkpoint/` (`local-first-checkpoint-service.ts:7,51`). Do not add a new bucket in H6.
Lambda report processing must never list or parse `lf-blob/` keys. `0156_lf_blobs.sql` rides the
**shared** `migrations_dir` and therefore applies to Budget/Kaizen/Health D1s too — empty tables
on those brands, irreversible; migrate **staging and production for every fleet brand**.

Design decisions to lock:

| Item | Proposal | Question |
|---|---|---|
| Storage | New `lf_blobs` + `lf_blob_chunks` D1 tables + R2 prefix `lf-blob/` on **`REPORTS_BUCKET`**, modelled on `lf_checkpoint_*` (`0155`) | — |
| Key | Derived per blob from the **HDK**, like checkpoints (rows use the DEK; the DEK is device-local so it cannot work here) | — |
| Lifetime | **Not** the 14-day mailbox TTL — blobs are durable content. Retain until the ledger row is tombstoned **and** the tombstone passes the compaction watermark | ✅ **Q4 CLOSED — as proposed** |
| Quota | Per household byte cap + a client-side warn/hard-stop; R2 cost is real | ✅ **Q5 CLOSED — soft 2 GB / hard 5 GB, server-enforced** |
| Fetch policy | Lazy on first view, with an explicit "download" affordance on cellular | — |
| Local cache | `cacheDirectory` (evictable by iOS), LRU with a size budget; original stays in `documentDirectory` only on the authoring device until uploaded | — |
| Existing R2 data | Deleted with the §2.1 lab truncation, not migrated (Q1 closed — wipe authorized) | — |
| Upload resumption | Chunked with per-chunk idempotent upsert (`ON CONFLICT DO UPDATE`, as `putChunk` does). **Reuse stored nonce+ciphertext** on retry — a new nonce for the same chunkIndex under the same contentKey is a GCM nonce-reuse bug | — |

**Explicitly out of scope for H6:** report PDFs (Tier B — Lambda must read them in plaintext) and
AI-housekeeper attachments (Tier B). Those keep the existing server upload paths.

**Secondary cleanup this forces.** House has **three** upload mechanisms today — XHR-PUT-with-progress
(`e2ePutUpload.ts`), `apiClient.put` with raw bytes, and multipart `FormData` — chosen inconsistently
per feature. Normalize on one before building the blob layer, or the encrypted path will inherit the
same fork three times. (Memory note: chat image upload already had to be fixed once because a
relative Worker URL failed via `putUploadViaXhr` and needed `apiClient.put`.)

**Verification.**
- Two-device: attach a photo on A → appears and renders on B, byte-identical (sha256 asserted).
- Tombstone a row → blob becomes unreachable; after the compaction watermark passes, the sweep deletes the R2 objects.
- Worker never sees plaintext: assert the stored object bytes ≠ the source file bytes and that no route parses the body.
- Interrupted upload resumes without duplicate chunks **and without minting a new nonce**.
- Cache eviction: clear `cacheDirectory`, re-open the screen, blob re-fetches transparently.
- Nonce uniqueness: two chunks of the same blob never share a nonce; AAD binds `chunkIndex`; retries reuse the stored envelope.
- Worker never sees plaintext; body is opaque bytes streamed to R2 (no JSON parse of ciphertext).

**DoD H6.** Q4/Q5 answered; verifications green (incl. per-chunk nonce reuse on retry); the sweep runs in the same cron as the mailbox/checkpoint sweeps; upload mechanism normalized to the existing Worker-proxied PUT path (`e2ePutUpload` / `apiClient.put`); `0156` migrated on every fleet brand D1 staging+production.

### 8.1 As-built (2026-08-13) 🟢

**The migration is `0157_lf_blobs.sql`, not `0156`.** `0156` was taken by
`lf_devices_composite_pk` — the H5 blocker (§7) — between this section being written and H6 starting.
Every reference to "0156" above and in §14 means this file. It still rides the **shared**
`migrations_dir`, so it lands on Budget/Kaizen/Health D1s as empty tables and must be applied to
**staging and production for every fleet brand**.

| Layer | File | What it owns |
|---|---|---|
| D1 | `backend/migrations/0157_lf_blobs.sql` | `lf_blobs` + `lf_blob_chunks` + 3 indexes |
| Worker service | `backend/src/services/local-first-blob-service.ts` | idempotent chunk upsert, quota, finalize, tombstone, two-armed sweep |
| Worker routes | `backend/src/routes/local-first-blobs.ts` | PUT/GET chunk, finalize, manifest, DELETE, usage — mounted **inside** `local-first-v2.ts` |
| Cron | `backend/src/cron/scheduled.ts` | `sweepPurgeable` beside the mailbox and checkpoint sweeps |
| Client crypto | `src/features/house/local/blobs/blobCrypto.ts` | HKDF content key, chunk AAD, seal/open, streaming hash |
| Client transport | `src/features/house/local/blobs/blobTransport.ts` | raw `octet-stream` PUT/GET, typed quota / incomplete errors |
| Client store | `src/features/house/local/blobs/houseBlobStore.ts` | staging, resume, download+verify, LRU cache, delete |

**Six decisions the build made that the design did not state.**

1. **`keyEpoch` joins the ledger descriptor.** The plan's row was `{blobId, mime, bytes, sha256,
   chunkCount}`. That is not enough to open the blob after a key rotation: the content key derives
   from the epoch, so a peer reading a pre-rotation attachment with the *current* epoch derives a key
   that cannot decrypt it. The epoch is stored server-side too, and returned on both the manifest and
   the chunk response headers.

2. **The server stores strictly less than the plan implied.** No mime, no filename, no plaintext size
   and — deliberately — **no plaintext sha256**. Storing the content hash would hand the relay a
   confirmation-of-file oracle (does household X hold *this exact* document?) for no operational gain,
   since the client verifies the hash against the ledger row it already has. What `lf_blobs` holds is
   counts, ciphertext byte sizes and the key epoch.

3. **Chunk framing rides in headers, not a JSON body.** `X-LF-Chunk-Count` / `X-LF-Key-Epoch`. This is
   what lets the route keep its promise: it never calls `.json()` on a chunk in either direction. A
   base64 envelope would have inflated every chunk by a third and put ciphertext through the parser.

4. **Quota rejection is 507, not 413.** They are opposite instructions to a client: 413 means "this
   chunk is too big, shrink and retry", 507 means "the household is full, stop". A client that read
   the quota wall as 413 would retry the same chunk forever.

5. **Tombstoning is terminal.** A chunk arriving for a tombstoned blob is stored (the PUT is
   idempotent either way) but does **not** revive the row, and `finalize` will not either. The only
   thing that legitimately produces such a write is a peer that has not yet synced the delete; a
   genuine re-attach mints a fresh `blobId`. Reviving would strand bytes that nothing ever tombstones
   again, because the client issues DELETE exactly once — when the ledger row dies.

6. **The sweep grew a second arm.** Tombstone-plus-watermark alone leaks: an upload interrupted before
   `finalize` leaves `pending` chunks that no ledger row references, so nothing will ever tombstone
   them. `pending` blobs untouched for `BLOB_PENDING_TTL_MS` (7 days) are collected too. A resume
   bumps `updated_at`, so a genuinely slow upload is never mistaken for an orphan.

**Q4 as implemented.** The server cannot see the ledger, so the watermark it can enforce is the
checkpoint lifetime: `purge_after = tombstoned_at + CHECKPOINT_TTL_MS` (90 days). A checkpoint
generation published *before* the delete stays servable for that long and hands a bootstrapping
device a live row pointing at the blob, so purging earlier would break a legitimate bootstrap.

**Q5 as implemented.** Soft 2 GB / hard 5 GB per household, checked **before** the R2 write so an
over-quota upload never costs storage, and checked against the *delta* so a same-size retry at the
cap is not refused. Tombstoned bytes are excluded from the live total — they are retention cost the
platform chose to carry for correctness, and counting them would leave a member unable to upload for
90 days after clearing space. **Accepted consequence:** delete-then-reupload can transiently hold up
to 2× the cap in R2.

**Nonce reuse — how it is actually prevented.** Every chunk is sealed **once** and staged to
`documentDirectory/lf-blob-staging/{blobId}/{index}` *before* its first PUT. A resume re-reads that
file and re-sends the byte-identical envelope. Re-sealing would mint a second nonce for the same
`(contentKey, chunkIndex)`, and two GCM ciphertexts under one (key, nonce) leak the XOR of their
plaintexts and the authentication subkey. The server cannot check this — every chunk is opaque to it
— so `houseBlobStore.test.ts` captures the exact envelope of every PUT across a simulated crash and
asserts the nonces are identical.

**Verification — 111 new tests (67 mobile + 44 backend), all green.**

| Suite | Count | Proves |
|---|---|---|
| `services/__tests__/local-first-blob-service.test.ts` | 21 | idempotent upsert, running `cipher_bytes`, quota before-R2 + delta, tombstone terminality, both sweep arms, `limit` bound. Real miniflare D1 + R2, not a fake |
| `routes/__tests__/local-first-blobs.test.ts` | 23 | 403 for a non-member and a **revoked** member on all six verbs, byte-identical round trip, R2 object == what the client sent, 409 partial-read, resume without duplicate chunks, 413 before R2, delete keeps bytes |
| `__tests__/blobCrypto.test.ts` | 21 | per-(blob, household, epoch) key separation, and refusal on reorder / truncate / cross-blob splice / wrong epoch / tamper / missing AAD; full-size chunk stays under the Worker cap |
| `__tests__/houseBlobStore.test.ts` | 31 | **the nonce-reuse invariant across a crash**, descriptor identical after resume, no device path in the descriptor, cache seeding + LRU eviction, corrupt-blob surfacing, the named key-rotation failure (§8.2) and that a cached pre-rotation blob still resolves, per-property key scoping |
| `__tests__/blobTransport.test.ts` | 15 | header framing, XHR (not axios) upload path, exact chunk bytes not the backing buffer, 507 → typed non-retryable error |

House local suite **422 → 489**; backend local-first **65 → 109** in those paths; full backend
**4,021 passed / 267 files**; full mobile **9,489** with the same 5 pre-existing failures (4 Health
suites + `budgetSuiteCompleteness`) and no new ones.

### 8.2 ✅ CLOSED 2026-08-13 — key rotation no longer orphans blobs

**Found while building H6; neither this plan nor Budget's had noticed it.**

`revokeLocalFirstDevice` rotates the household key by calling
`installHouseholdKeys(generateHouseholdKeys(householdId, nextEpoch))` — a **whole new random HDK**.
The previous HDK is not retained anywhere: not in the session, not in `persistSession`, not in the
package's `HouseholdKeys` type, which holds exactly one `hdk` and one `keyEpoch`.

For everything that existed before H6 this is harmless, and that is why it went unnoticed:

| Data | Sealed under | Survives rotation? |
|---|---|---|
| Rows | the **DEK** (device-local, never rotated) | ✅ yes |
| Ops in flight | the HDK, per-op `keyEpoch` | effectively — the mailbox TTL is 14 days |
| Checkpoints | the HDK | the owner republishes under the new epoch |
| **Blobs (H6)** | **the HDK, via the per-blob content key** | ❌ **no — permanently unreadable** |

Blobs are the first HDK-sealed data in this system that is *durable* rather than transient, so they
are the first thing a rotation can permanently orphan. Every device revoke — a member leaving, a lost
phone — currently makes every attachment uploaded before it unopenable on every device except the
ones that already have it cached. The ledger rows survive and point at bytes nobody can decrypt.

**Fix as shipped.** `EngineState` gained `retiredHouseholdKeys: Map<epoch, hdk>`, **property-scoped**
like `householdKeys` itself (each property rotates on its own schedule). `installHouseholdKeys`
retires the outgoing key before replacing it, and the map persists in the session's crypto bundle as
`retiredHdksByEpoch`. `resolveHouseBlobUri` selects the HDK by the **descriptor's** epoch, so a blob
sealed under epoch N opens after any number of later rotations.

Three cases the implementation distinguishes, and each has a test:

| Case | Behaviour |
|---|---|
| Blob epoch == current | current HDK — unchanged |
| Blob epoch retired, key held | derive from the retired HDK — **the blob opens** |
| Blob epoch never held (device enrolled after the rotation) | `HouseBlobKeyUnavailableError` — genuinely unreadable *here*; a longer-lived peer can still open it |

**Retire only a strictly older epoch.** Enrolment installs the first key through the same function
and HDK re-delivery replays the current one; retiring in either case would persist a meaningless
entry or shadow the live key.

**This does not weaken a revoke.** Retention is device-local and never transmitted — the revoked
device receives no ring and keeps only the stale copy it already had, which is exactly the state
before this change. `retiredHdksByEpoch` is omitted entirely when nothing has rotated, and a session
persisted before this landed reads as an empty ring rather than throwing.

**12 tests** in `__tests__/householdKeyring.test.ts` plus two in `houseBlobStore.test.ts` (the
pre-rotation read, and the never-held-epoch error).

Note this also has a security dimension worth stating rather than assuming: retaining old HDKs means
a device that is *still* enrolled keeps the ability to read pre-rotation attachments. That is the
correct behaviour — rotation exists to lock out the **revoked** device, which never receives the
keyring — but it should be a stated decision, not a side effect.

### 8.2b Q11 resolved — the Tier-B 403s are a startup RACE, not a broken authz model

**Found by the first House E2E run, 2026-08-13**, and it changes Q11's answer.

With local-first on, the client rebinds `currentHousehold` to the ledger id
(`hh_local_…`) the moment the session opens. The endpoints that stay
server-authoritative — `home-projects`, `quotes/pending`,
`home-budget/monthly-overview`, `projects/active`, `aihousekeeper/*` — authorise
against the **legacy** `household_members` rows that only exist once
`syncLocalHouseholdToControlPlane()` has run `mirrorLegacyMembership`.

`openHouseLocalSession` starts that registration **fire-and-forget** on purpose:
session open is the offline-first cold-start path and must not block on the
network. Measured on device: **10 Tier-B 403s** in the ~2 s window before
registration landed, and **24/24 of the same calls returning 200 afterwards.**

So Q11's "the glance breaks from both sides" is real but narrower than feared —
the mirror does work; it just is not there yet when the first screens paint.

**Fix as shipped.** A single scoped retry in `src/api/client.ts`: on a 403 whose
URL contains `/households/hh_local_`, await
`awaitHouseControlPlaneRegistration()` and retry **once**. Scoped deliberately —
a server household id's 403 is a real denial and must stay one.

**A second bug the fix's own test caught:** `registerHouseholdOnce` swallows every
error so a fire-and-forget caller cannot reject, so "did not throw" is not
"registered". The first draft latched on that and would have marked an **offline**
launch as registered, leaving Tier-B 403ing for the rest of the process. It now
returns a real success signal (201 or 409 → true; anything else → false), and
only a true latches. 20 tests in `__tests__/tierBAuthzRace.test.ts`.

### 8.3 ✅ H6 deployed 2026-08-13 — the record

An earlier draft of this document marked H6 "SHIPPED" before any of this had happened, which in
this plan's own vocabulary (H0's v1.6 entry: *"Merged to `main`, `deploy:fleet` run, production
Version IDs recorded"*) was untrue. It is true now, and the record is kept here so the next stage
does not have to re-derive it.

| Step | State |
|---|---|
| Merged to `main` | ✅ PR **#4**, merged `--merge`, `78925e63` |
| `0157_lf_blobs.sql` applied | ✅ **all 8 D1s** — House / Budget / Kaizen / Health × staging + production |
| `deploy:fleet` | ✅ all four Workers, both envs |
| Live smoke | ✅ `/v2/households/:id/blobs-usage` → **401** on House staging (route present + auth-gated, not 404); `lf_blobs` + `lf_blob_chunks` confirmed present in House staging **and** production D1 |
| Fleet isolation guard | ✅ Kaizen `/v2/households` still **404** (plan §14 mandatory guard #1) |

**Production Version IDs (2026-08-13T20:2x UTC):**

| Brand | Staging | Production |
|---|---|---|
| House | `37c34a0c-1685-44f9-87ee-78390e7691bb` | `b1c51f9d-c975-4625-9c28-3ab5a53bddc8` |
| Budget | `94852e61-3969-4013-81fd-a9498d89af0b` | `cb6d5aa8-fd5f-42a1-9a96-ccc2c56e5b41` |
| Kaizen | `a54efb81-0657-4dcc-b890-5437c981ebd0` | `9da7d937-f917-4e7e-a60d-0c791bb99459` |
| Health | `61b450ae-f10d-44d7-905d-9f972f53a763` | `b457de22-6ad2-4561-80ac-9de7fc9f6b16` |

**Two migration notes worth keeping.** *Kaizen was two migrations behind* — applying `0157` also
brought `0155_lf_checkpoints` and `0156_lf_devices_composite_pk` with it. *Health is under the
Data Bridge `0092` hold*, so its migrate refuses outright; `0157` went in via the guard's own
documented escape hatch, `db:migrate:health:skip-0092:<env>`. `HEALTH_ALLOW_0092` was **not** set.

**Still not verified on real infrastructure:** the R2 streaming path, the cron sweep, the quota
rollup and the resume path have only ever run against miniflare. The routes are live and reachable;
the first real exercise of them is the two-device attachment test (H12).

**Two DoD items deliberately not claimed.**

- **The three-way upload normalization is only partly done.** H6's own path is on
  `putUploadViaXhr`, which gained `headers` and a typed `HttpUploadError` carrying status + code
  (that also fixes a real pre-existing bug: a `{error:{code,message}}` envelope used to reach the
  user as the string `"[object Object]"`). Migrating House's *existing* `apiClient.put` and
  multipart `FormData` upload sites is a separate refactor across Tier-B features that H6 does not
  touch, and folding it in here would have put report and floor-plan uploads in this diff.
- **No Wave-A table has been cut over to the channel yet.** That is the plan's own sequencing —
  every blob-bearing table is gated on H6 in H11 (B1–B4, C1–C3), and `localTasksApi.ts` still
  carries its H3 note that task-photo *bytes* stay remote in Wave A. H6 delivers the channel; the
  per-table cutover is H11.

---

## 9. Stage H7 — server-compute displacement 🆕 **House-only, highest risk**

**Problem — state it plainly.** Under E2EE the House Worker's D1 is empty for local-first
households. Budget accepted this: its budget-alert worker, insights, encouragement, suggestion
services and chat assistant tools "silently degrade to no-ops". House cannot make that trade
casually, because the things that go dark are the product:

| Consumer | Scale | Goes dark |
|---|---|---|
| AI Housekeeper v3 | **36 production files** under `services/aihousekeeper/` (24 modules + 12 triggers; 60 incl. tests) | briefings, digests, follow-ups, home insight, chat grounding |
| House cron jobs | `scheduled.ts` — task reminders (`:202`), overdue tasks daily 08:00 (`:214`), AI analysis every 6 h (`:354`), daily digests (`:368`), weekly summaries (`:379`), briefing composition hourly (`:409`), weekly-digest hourly dispatch (`:505`), approval-expiry sweep (`:430`), outbound queue (`:398`) | all notification-bearing automation |
| Cloudflare queues | `task-enrichment`, `garden-plan-generation`, `home-project-schematic`, `aihousekeeper-outbound` | AI enrichment of tasks and plans |
| Derived tables (Tier D) | `maintenance_suggestions`, `contractor_recommendations`, `utility_trends`, `floor_plan_regions`, `home_project_geometry` | recommendations and analysis |
| Widget / Watch | `widget-sync.ts`, `watch-sync.ts:83` — read **tasks** | home-screen widget and watch complications |

**Fix — four displacement patterns. Pick one per consumer; do not invent a fifth.**

**P1 — On-device compute (preferred).** Budget's proof: `reminders/budgetLocalReminders.ts` (248
lines) reads the ledger, computes reminder dates and schedules `expo-notifications` **directly**;
push is used **only** as an opaque sync wake. House equivalents:

| Consumer | P1 form |
|---|---|
| Task reminders, overdue notifications, garbage-day reminders, checklist due dates, utility-bill due dates | `houseLocalReminders.ts` — one scheduler over the ledger, re-run on every ledger bump and on foreground |
| `maintenance_suggestions` | on-device rules over ledger tasks/appliances/spaces |
| Home insight, weekly digest | on-device composition, rendered in-app instead of emailed |

Cost: reminders alone ≈ 400–600 lines (House has more reminder classes than Budget). Constraint:
iOS caps pending local notifications at **64** — House can easily exceed that across tasks,
checklists, garbage and bills. Needs a **rolling horizon scheduler** (schedule the next N, top up on
foreground). This is a real design item, not a detail.

**P2 — BYOK on-device AI.** Budget's `local/ai/` (21 files, ~2,100 lines) is a three-stage ladder:
Stage A deterministic local parse → Stage B the **user's own** provider key via
`@services/aiKeyVault` with a hard URL allowlist and pre-egress redaction → Stage C throw
`UnsupportedError` with member-facing copy. House's AI Housekeeper chat, task enrichment, garbage
detection, bill extraction and quote comparison can all follow it. The **household context** the
assistant needs is assembled **on device from the ledger** — which is strictly better grounding than
the server has today.

**P3 — Consented plaintext projection (needs explicit product + privacy sign-off).** For features
that genuinely require server compute while the app is closed, publish a **narrow, explicitly
consented** plaintext projection of just the fields that feature needs (e.g. `{taskId, title,
due_date}` for overdue push). This is a **deliberate hole in the E2EE model** and must be:
opt-in per household, disclosed in-product, minimal-field, separately keyed, and independently
deletable. **Do not** let this become "sync everything to the server for convenience" — at that
point the refactor has bought nothing.

**P4 — Disable for local-first households.** Honest and acceptable for genuinely server-bound
features. Must surface member-facing copy, never a silent empty state.

### ✅ Locked assignment (Q6–Q10 approved 2026-08-12) — normative

| Consumer | Pattern | Consequence to accept |
|---|---|---|
| Task / checklist / garbage / bill reminders + overdue | **P1** on-device | Reminders fire only from the device. A household member who never opens the app stops receiving them |
| AI Housekeeper chat + grounding | **P2** BYOK, ledger-assembled context | Requires a user-supplied provider key. Grounding gets **better** (full ledger, not a server subset) |
| Task enrichment, garbage AI-detect, bill/tax extraction, quote comparison | **P2** BYOK | Same key requirement; Stage-A deterministic parse works with no key |
| Briefings & weekly digests | **P1 in-app**; **P4** for email/push delivery | Digests become an in-app surface. **Email/push digests are switched off** for local-first households |
| `maintenance_suggestions`, home insight | **P1** on-device rules | Suggestions get simpler than the server's AI pass, at least initially |
| Floor-plan region detection, garden-plan image generation, home-project schematics | **P4 disabled**, upgrade to **P2** where a BYOK vision call suffices | These three features are **off** for local-first households until a BYOK path lands |
| Reports / Lambda | **Tier B**, unchanged | Reports stay server-side and plaintext — the one non-E2EE surface, by necessity |
| Chat | **Tier B**, unchanged | As Budget |
| Widget / Watch | **P1 + app-group plaintext projection** | A minimal, disclosed plaintext task slice lives outside the encrypted ledger — see N4 below |

**P3 (consented plaintext projection **to the server**) is NOT approved and must not be built.**
Closed-app push and email digests resolve to P1 and P4. If a measured gap later justifies revisiting
P3, that is a new privacy decision.

**N4 is an explicit exception to the P3 ban, not P3.** Two **different** local channels:

- **iOS widget:** a small plaintext JSON slice (next N tasks: id, title, due date, space) in the
  **App Group container** (not Keychain). Write from `_layout` on sign-in. Wipe on logout. Disclose
  in-product. Use `NSFileProtectionComplete` and exclude from iCloud backup. Confirm House brand
  entitlements include App Group + `keychain-access-groups` (Release `-34018` otherwise) in
  `app.config.ts` / native patchers.
- **watchOS:** App Group does **not** reach the watch. Keep `watch-sync.ts` / WatchConnectivity
  (`WatchBridge`) as the delivery path, feeding the **same** minimal field slice. Do not assume
  one file serves both extensions.

**H7-lite (Wave A ship gate):** rolling-horizon `houseLocalReminders.ts` for Wave A reminder classes
**or** explicit "reminders dark" copy; widget projection **or** explicit "widget dark" copy. Full
BYOK ladder can follow in Wave B.

### 9.1 Cron audit — the P4 digest gate (2026-08-13) 🟢

**The DoD line "every House cron job is either unaffected (Tier B), guarded to skip local-first
households, or removed" turned out to rest on an assumption that is no longer true.**

The plan expected server compute to degrade to a harmless no-op under E2EE, because D1 holds no
domain rows for a local-first household — a reminder sweep over `tasks` finds nothing and stops.
That still holds for the sweeps. What it does **not** hold for is anything that enumerates
households, because `mirrorLegacyMembership` (added so chat and the other `/households/:id/...`
features keep working) writes the legacy `households` / `household_members` rows for V2 households
too. Local-first households are therefore *visible* to cron.

For the **AI Housekeeper weekly digest** that is not a no-op: `DigestComposer.runDueThisHour`
would compose and **send** an email/push built from an empty week — which is precisely what Q8's
locked assignment forbids ("Briefings & weekly digests → P1 in-app; **P4** for email/push delivery;
email/push digests are **switched off** for local-first households").

**Shipped:** `services/local-first-household-gate.ts` — `localFirstHouseholdIds(env)` (one query per
cron tick, not per household) and `isLocalFirstHousehold`. `runDueThisHour` skips them and reports
`skippedLocalFirst`. The gate **fails open** on a brand whose D1 predates `0152`: a missing
`lf_households` table means that brand has no local-first households to skip, and throwing there
would take down the whole tick. 7 tests against live D1.

### 9.3 P2 BYOK — the egress allowlist is the design (2026-08-13) 🟢

The DoD's Stage-B line contains an instruction that turns out to be the whole design:
*"**egress allowlist** (ledger fields that may leave the device — **do not ship Budget's regex
denylist as an 'allowlist'**)"*. Worth recording why, because the two look interchangeable and are not.

Budget's `redactImportText` is three regexes — SIN-like, card-like, long-numeric — applied to
assembled text. It **fails open**: anything the patterns do not recognise reaches the provider. For
Budget that is defensible, because the text is a receipt the member just photographed and chose to
import.

House is a different shape. Context is assembled **from the encrypted ledger**, the member never
sees the payload, and the ledger holds their address, their household members, free-text notes and
maintenance history. A denylist over that surface is a standing promise that every future column
will happen to match a regex — one new column carrying a gate code, a contractor's mobile or a
neighbour's name and it ships silently.

`ai/egressAllowlist.ts` is therefore a **positive, field-level allowlist that fails closed**: an
unlisted table contributes nothing, an unlisted field is dropped even from a listed table, and a
column added tomorrow is excluded until someone adds it here deliberately. Six tables carry an
explicit forbidden marker on top of the omission rule (`households` — the address;
`householdMembers` — real people; `householdNotes` / `maintenanceTaskNotes` — unbounded free text;
`settings`; `taskDrafts`), so adding them is a reviewed act rather than an oversight. Notable
exclusions inside *allowed* tables: appliance `serial_number` (theft / warranty-fraud vector), task
`description` and `assigned_to`, and every `household_id` (correlates a member across prompts).

Redaction still runs — emails and NANP phone numbers added to Budget's three patterns — but as a
**second layer over an already-narrow payload**, never as the control.

`ai/houseAiLadder.ts` carries the A/B/C ladder. Stage A runs first even when a key exists: it is
free, offline, private and deterministic. `runHouseAiLadder` takes a pre-projected `HouseAiContext`
rather than a ledger, so a caller cannot hand raw rows to a provider without going through the
allowlist. Stage C returns typed, member-facing copy per reason (`no_key` / `provider_failed` /
`not_supported`) — a provider error must never reach a member as a raw string.

### 9.2 P4 member-facing copy (2026-08-13) 🟢

The DoD line — *"Every P4 feature shows explicit member-facing copy in the House brand voice (no raw
error strings)"* — was **not** met, and in a way that looked met: all 8 disabled methods threw one
shared sentence with their own identifier embedded (`House local-first:
"garbage-collection.aiDetect" is not available offline yet…`). Several suites even asserted on it
under test names like *"throws member-facing copy"*. Any screen rendering `error.message` put that
identifier in front of a member.

`unsupportedCopy.ts` now gives each of the 8 its own copy, answering the two questions a member
actually has — what can't I do, and what do I do instead — with no encryption mechanics, no method
names, no "unsupported". `HouseLocalUnsupportedError.message` carries that copy; the identifier
moves to `.method` for logs.

**Both needs coexist deliberately.** `proxyRouting.test.ts` asserts the engineer's need (the
identifier is on `.method`, so an unported method is findable) and the member's need (it is *not* in
`.message`) in the same test — they pull opposite ways and the split is what satisfies both.

41 tests, of which two are mechanical guards rather than examples: one walks the real throw sites in
`src/features/house/local/**` and fails if any lacks an entry (so "explicit copy per feature" cannot
decay into one shrug for everything), and one rejects identifiers, snake_case codes and jargon in
any copy string.

**Still owed for H7:** the P2 BYOK ladder (Budget's is 21 files / ~2,100 lines) and the watch channel
via WatchConnectivity.

**Verification / DoD H7.**
- [ ] The locked assignment table in this document is the sign-off (10 rows) — do not re-open Q6–Q10
- [ ] `houseLocalReminders.ts` schedules within the 64-notification cap under the H10 10-year corpus; rolling-horizon test via `getAllScheduledNotificationsAsync()`
- [ ] BYOK ladder: Stage A parse tested offline; Stage B **egress allowlist** (ledger fields that may leave the device — do not ship Budget's regex denylist as an "allowlist") + redaction tested; Stage C copy shown, never a raw error
- [ ] Every P4 feature shows explicit member-facing copy in the House brand voice (no raw error strings)
- [ ] **P3 is not approved — do not build.** No consent-UI / server-projection work.
- [ ] Widget App Group projection verified on device from a cold, signed-in, never-opened-a-screen launch; wipe-on-logout tested; watch complications verified via WatchConnectivity (not App Group)
- [ ] Cron audit: every House cron job is either unaffected (Tier B), guarded to skip local-first households, or removed

---

## 10. Stage H9 — backup / restore / export ♻️ + 🆕

Reuse `backup/archive.ts` (format `symply-local-first-backup` v2, Argon2id `RECOVERY_KDF_MOBILE`
recovery key), `backup/phrase.ts`, and the Budget wrappers' shape:
`budgetBackup.ts` (396) → `houseBackup.ts`, `backupDestinations.ts` (517, device/files/Google
Drive/Dropbox) → reusable nearly verbatim, `autoBackup.ts` (398, `AppState`-driven because
Argon2id needs ~2.5 min and a `BGAppRefreshTask` gets ~30 s) → verbatim.

**Restore must honour D-20 "live wins":** restored values are stamped
`RESTORE_HLC = '000000000000001-0000-restore'` so any real live HLC and any tombstone beats them;
`restoreDeltaFromBackup` strips deletes so a restore can never delete. Peers converge because the
`BACKUP_RESTORE` ops carry a real delta.

**House deltas:**
- **Multi-property:** ✅ **Q15 CLOSED — one archive per property**, named by property.
  `backup/houseBackup.ts` takes an explicit `householdId` (defaulting to the active one) at every
  entry point. Budget's wrapper can read `getLocalLedger()` because it has exactly one ledger;
  House holds 1–3, each with its own HDK, key epoch and membership, so a combined archive would
  merge rows from households that only coincidentally share a device and a restore would have to
  guess which property each row belonged to.
- **Blobs (H6):** ✅ **Q15 CLOSED — descriptors travel, bytes do not.** The ledger rows already carry
  `{blobId, mime, bytes, sha256, chunkCount, keyEpoch}` and those are in the snapshot;
  `collectBlobManifest` additionally reports them so a restore screen can say what it will re-fetch
  rather than silently producing rows whose attachments resolve to nothing. The manifest walks rows
  **by shape** (`blobId` + `sha256`) rather than by a column list — blob-bearing columns span 25
  tables across the wave plan and a hand-kept list would miss the next one. **Consequence accepted:**
  restoring into a household whose R2 objects are already purged yields rows whose attachments are
  unavailable, which is why the manifest is surfaced instead of hidden. The opt-in "full archive"
  with bytes is not built.
- **CSV export:** ✅ **SHIPPED 2026-08-13** — `export/houseLedgerExport.ts`, 24 tests.
  `escapeCsvCell`'s `= + - @` neutralization ported verbatim (it is a security control, not
  formatting: House rows carry member-typed titles and notes, and a leading `=` executes on open in
  Excel / Numbers / Sheets). **Diverges from Budget's section-builder on purpose:** Budget
  hand-writes one `buildXCsv` per table for 13 tables; House has 21 and a 58-column widest row, so
  the sections are driven from `HOUSE_LEDGER_TABLE_NAMES` and columns are a stable union of the
  rows' own keys (union, not row-zero — local-first rows are sparse across app versions). A test
  asserts the section list equals the registry exactly, so **a Wave-B table added to the ledger and
  not to the export fails the build** instead of silently exporting nothing — the property the
  hand-written form cannot give. Sections are named after the PHYSICAL table, so the S1
  `checklists` / `checklist_items` rename resolves to what D1 and the docs call them. File name
  carries the property (H5: a member holds 1–3, and three identically-named files in Files are
  indistinguishable); the plaintext file is deleted from `cacheDirectory` after the share sheet
  closes, whatever the outcome.
- **Soft Transfer:** `export/localBudgetSummary.ts` has a `budget.summary.v1` envelope the Worker accepts with the local-first header. House **is** the platform authority, so the House side of Soft Transfer is a bigger question — resolve in Q16.

---

## 11. Stage H11 — Wave B and Wave C expansion 🆕

Mechanical once Wave A is green, but large. Sequence by dependency, not by table count:

| Sub-wave | Tables | Gate |
|---|---|---|
| ~~**B1**~~ contractors + visits + representatives + documents | 4 | ✅ **ACTIVATED 2026-08-14** |
| ~~**B2**~~ appointments + quotes + contractor_quotes + quote_requests | 4 | ✅ **ACTIVATED 2026-08-14** |
| ~~**B3**~~ projects + milestones + payments + progress photos | 4 | ✅ **ACTIVATED 2026-08-14** |
| ~~**B4**~~ visit_checklists + items + notes + item photos + messages + ratings + resolutions | 7 | ✅ **ACTIVATED 2026-08-14 — Wave B COMPLETE** |
| ~~**C1**~~ utilities: accounts, bills, property_taxes, bc_assessment, reminders | 5 | ✅ **ACTIVATED 2026-08-14** |
| ~~**C2**~~ floor plans (user fields + markers + annotations) | 3 | ✅ **ACTIVATED 2026-08-14** |
| ~~**C3**~~ garden plans (plans + objects + markers + boundary drafts) | 4 | ✅ **ACTIVATED 2026-08-14** |
| ~~**C4**~~ home projects — 10 ledgerable of 14 | 10 | ✅ **ACTIVATED 2026-08-14 — H11 COMPLETE** |

**Per sub-wave DoD:** registry entries + local api module + Proxy + method-parity test + bulk paths
using `chunkRowsForOp` + H10 re-run + the sub-wave's screens exercised in the two-device E2E.

### 11.1 As-built — B1 ✅ **ACTIVATED 2026-08-14**

Live ledger **21 → 25**; `HOUSE_WAVE_B_TABLE_COUNT` 19 → 15; registered total unchanged at 62.
Landed: `localContractorsApi.ts` (~48 KB), proxy registration on `src/api/contractors.ts` +
`src/api/representatives.ts`, parity cases for both, `localContractorsApi.test.ts`.

**What the activation actually costs, measured on B1** — useful for estimating the remaining seven:

- **No SQLite migration.** `lf_rows` keys on `(household_id, tbl, row_key)` with the table name as a
  *value*, so a new table is zero DDL. This is the single biggest reason H11 is volume, not risk.
- **Five shared registry files** move together — `schema.ts`, `engine.ts`, `sync/ledgerRefresh.ts`,
  `ids.ts`, `types.ts` — which is exactly why sub-waves **cannot be parallelised**. They collide.
- **Cut, never copy.** `registryGuard.test.ts` asserts live ∩ staged = ∅ precisely because the spread
  at `HOUSE_REGISTERED_TABLE_KEYS` would silently absorb a duplicate.
- An activated sub-wave **leaves `HOUSE_SUB_WAVE_TABLES` entirely** rather than becoming `[]`.

### 11.1.1 ⚠️ The cascade trap — found the hard way in B2, and it fires again in B4

**Activating a table can silently break a delete that already shipped.** B1 wrote
`localContractorsApi.delete` to cascade the three child tables that were live at the time. B2 then
activated four more that D1 *also* cascades from `contractors` — `appointments`, `quotes`,
`contractorQuotes`, `quoteRequests` — and the delete was never updated. Every contractor deletion
stranded four kinds of orphan, which then synced to every peer and were never read again. **Nothing
failed**: a ledger has no foreign key to complain to, and an orphan is only visible to a reader that
goes looking for its parent.

Fixed by naming the set — `CONTRACTOR_CASCADE_TABLES` in `localContractorsApi.ts` — so the next
sub-wave adds a name instead of remembering a filter, with two guards in
`localContractorsApi.test.ts`: one comparing that list against FKs parsed out of the Drizzle schema,
one proving the delete actually empties all seven. Both were verified to fail when the defect is
reintroduced. *(A first attempt compared the schema to a hand-written list and stayed green through
the defect — the schema was always right; only the code had fallen behind. Assert the implementation.)*

**The audit that followed, which is the part worth reusing.** The trap only fires where the server
does a **hard** delete, because Drizzle's `onDelete: 'cascade'` never runs on a soft delete:

| Live parent | Server delete | Cascade fires? |
|---|---|---|
| `contractors` | **hard** — `.delete(contractors)` (`contractor-service.ts:273`) | **yes** — this was the bug |
| `tasks` | soft — `update … set deleted_at` (`task-service.ts:818`) | no |
| `appliances` | soft — `update … set deleted_at` (`appliance-service.ts:263`) | no |
| checklists / instances / seasonal / spaces / features / garbage / reminders / notes | soft or no delete | no |

⚠️ **The table above answers "does the FK cascade fire on the server". C2 showed that is only half
the question, and the half that matters less.**

A local delete is a **tombstone**, not a flag. Where the client DTO omits `deleted_at` — which is
most of them — `localXApi.delete` REMOVES the row from the ledger even though the Worker only sets a
column. So the server's soft delete leaves children reachable through a still-present parent, while
the device is left with children whose parent is gone: unreachable orphans, replicated to every peer
forever. **A soft server delete does not discharge the local obligation; it hides it.**

The settled precedent is Wave A's own: `localAppliancesApi.delete` cascades
`applianceServiceHistory` even though `appliance-service.ts:263` soft-deletes. C2 followed it for
floor plans, where the FK audit came back genuinely empty but `LocalFloorPlan` has no `deleted_at`,
so markers and annotations still had to go in the same op.

**The rule to apply from C3 onward:** run the FK audit *and* ask separately — "if I delete this
parent locally, is any child left unreachable?" If yes, cascade it in the same op regardless of what
the server does. Name the set in a constant and assert it against the schema.

### 11.1.4b The vacuity trap has a THIRD form — an inert registry entry (found in C3)

§11.1.3 named empty arrays; C1 named empty maps. C3 found the one neither catches, and it is the
nastiest of the three because **the registry looks correct and every suite is green**.

`HOUSE_STAGED_WINDOWED_DATE_FIELDS.gardenPlanBoundaryDrafts` was `['created_at']` — naming a field
the `GardenPlanBoundaryDraft` **DTO does not declare**. At runtime `rowBucket` reads
`row['created_at']`, gets `undefined`, and falls through to always-resident. The table was configured
as windowed and was not windowed. Nothing caught it:

- `waveBCSchemaParity` was happy, because it checks the **D1 column**, which is a perfectly good `text`.
- An `Object.keys(HOUSE_STAGED_*)` sweep was happy, because the entry **exists**.
- Every behavioural test was happy, because always-resident is a valid bucket.

The gap is that the window is a claim about **three** things at once — the registry entry, the D1
column, and the *row type* — and only the first two were ever asserted together. Fixed by carrying
the field on the row type and guarding at both levels: `tsc` now rejects the typed test seeder if the
field leaves the type, and a runtime `rowBucket` assertion fails if the registry entry leaves.

**C4 must check this before trusting a green run.** Every staged window it activates has to name a
field its row type actually declares — and `homeProjectMilestones` is the one to watch, because it is
the last DTO gap in the registry, so its row type does not exist yet and will be written from scratch.

### 11.1.4c The registry had no notion of COMPLETENESS — found 2026-08-15

Every guard in `src/features/house/local/__tests__/` asked *"is each registered table well-formed?"*
Not one asked *"is every table registered?"* — and that asymmetry is a different shape of hole from
anything in §11.1.3/§11.1.4b, because the missing table appears in **no list at all**, so there is
nothing for a sweep to iterate over.

`appliance_documents` sat in `schema-maintenance.ts` belonging to no wave, no tier and no deferral
list. It cost something concrete: `localAppliancesApi.getDocuments`/`addDocument` threw, no appliance
screen could host `HouseAttachmentField`, and the identical `contractor_documents` had shipped in B1.

**The sharpest evidence it was systemic:** this document's own S3b hazard table (§1.4) names
`contractor_shares` and `labor_notification_preferences` as constrained tables "in Tier A/B". Neither
is in the registry. **Prose in a plan is not a registry.**

`registryCompleteness.test.ts` now parses House's nine Drizzle files and requires every table to land
in exactly one bucket: live ledger · Tier B/C/D · `HOUSE_S2_DEFERRED_TABLES` ·
`HOUSE_NON_DOMAIN_TABLES` (a written reason per entry) · `HOUSE_UNCLASSIFIED_PENDING`. That last list
is asserted as an **equality**, so the known gap is bounded — a new unclassified table fails, and
classifying one means deleting its line.

**Registry is now 63, not 62.** Activating `applianceDocuments` was a **correction of an omission,
not a ninth sub-wave**: no staged addend paid for it, so the *total* moved. That is the one signature
a legitimate crossing can never have — `A + B + C = REGISTERED` holds across an activation precisely
because the boundary moves and the total does not.

Four remain unclassified and are a product question, not an engineering one:
`service_provider_reviews`, `contractor_shares`, `labor_notification_preferences`,
`ai_info_conversations`.

### 11.1.5 ⚠️ OPEN DECISION — `localTasksApi.delete` leaves five live tables orphaned

Flagged, measured, and deliberately **not changed**. Someone with product authority should settle it.

`localTasksApi.delete` (`:992-1010`) removes the task row and leaves its children, arguing:

> *Children (subtasks, notes, completions) are deliberately left in place: the server soft-deletes
> only the task row too, so removing them locally would make the two implementations disagree about
> what a restore or an out-of-order peer op resurrects.*

Two facts measured on 2026-08-14 undercut that:

1. **There is no local restore path.** The only occurrence of "restore" anywhere in
   `localTasksApi.ts` is the word inside that comment. `Task` carries no `deleted_at` — the DTO does
   not have the column — so the local delete is a hard tombstone and nothing can resurrect it.
2. **D1 cascades `tasks` into eight tables, five of which are now live in the ledger:**
   `maintenanceCompletions`, `maintenanceSubtasks`, `maintenanceTaskNotes` (Wave A) and
   `contractorQuotes`, `quoteRequests` (arrived with B2). The other three are `task_photos` (embedded
   on the task row, not a table), plus `contractor_recommendations` and `scheduled_notifications`
   (Tier D / Tier B, never ledgered).

So every local task deletion strands rows in five tables, unreachable — `localTasksApi` resolves
subtasks and notes *through* their task — and replicated to every peer forever. It is the same defect
class fixed for contractors (§11.1.1) and pre-empted for floor plans (C2), and it is the last known
instance.

**Why it was left alone:** the fix is four filters in an existing op, but Wave A delete semantics are
load-bearing, the comment shows the trade-off was considered rather than missed, and "the server
soft-deletes" is a real argument if a restore is ever built. Changing it mid-programme on a judgement
call, without the product decision, would be the wrong kind of initiative.

**If the decision is to cascade:** follow `CONTRACTOR_CASCADE_TABLES` — name the set, derive the
guard from the Drizzle schema, cascade in the SAME op, and confirm the guard fails when reverted.
**If the decision is to keep them:** say so in the code comment with the five table names, so the
next audit stops rediscovering it.

**B4 must repeat this audit.** `visit-checklist-service.ts:247` hard-deletes `checklistItems` and
`visitChecklists`, so the same class of orphan is waiting there. Before finishing any sub-wave, grep
`backend/src/db/schema*.ts` for every `onDelete: 'cascade'` pointing at a table you are activating
**and** every cascade from an already-live parent into one of yours.

**It recurred immediately, one hop deeper.** B3 activated `projects`, correctly added it to
`CONTRACTOR_CASCADE_TABLES` — and surfaced a second form: D1 does not stop at one hop. `contractors`
cascades `projects`, and `projects` cascades milestones, payments and progress photos. The flat list
cannot express that, because it filters on `contractor_id` and the grandchildren are project-scoped.
B3 pinned it as a known gap rather than papering over it, which was the right call under its brief.

Closed the same day with a **second pass in the same op**: pass 1 captures the ids of the rows it
drops, pass 2 filters the grandchildren on `project_id`. Same-op matters — a peer that received pass
1 without pass 2 would hold milestones belonging to a project it no longer has, which is the orphan
the whole mechanism exists to prevent. `CONTRACTOR_TRANSITIVE_CASCADES` is kept deliberately separate
from the direct list, because the guard test derives that list from *direct* foreign keys and folding
the grandchildren in would make it lie about the schema.

**The general rule for every remaining sub-wave:** a cascade audit has to be transitive. Ask not only
"what cascades from the table I am activating" but "does anything I am activating sit *between* two
other cascading tables".

### 11.1.2 Wave C cascade pre-audit (done 2026-08-14, before C1 starts)

An earlier draft of this section warned that **C4 was the sub-wave to watch, because `homeProjects`
cascades thirteen children. That was wrong**, and the correction is the useful part: a cascade is
only dangerous if something actually deletes the parent. There is **no delete for a home project** —
not a route, not a service method, not a client api method. `routes/home-projects.ts` exposes deletes
only for `selections` and `budget_lines`, both leaves. So C4's thirteen-way cascade cannot fire, and
C4's real risk is the one §11 already names: it is React-Query-native (`homeProjectKeys`), so §5.2's
query-key mapping matters more there than anywhere else.

| Sub-wave | Parent | Server delete | Cascade fires? |
|---|---|---|---|
| **C1** | `utilityBills` | **hard** — `.delete(utilityBills)` (`utility-service.ts:739`) | **YES → `utility_reminders`.** Both are C1 tables, so this is an internal cascade the C1 facade must implement in one op. **This is the C-wave hazard.** |
| C1 | `utilityAccounts`, `propertyTaxes`, `bcAssessmentData` | soft / none | no |
| C2 | `floorPlans` | soft — `update … set deleted_at` (`floor-plan-service.ts:334`) | no — markers and annotations correctly survive |
| C3 | `gardenPlans` | soft / none | no. `gardenPlanBoundaryDrafts` IS hard-deleted (`garden-plan-boundary-service.ts:145`) but is a leaf |
| C4 | `homeProjects` | **no delete exists at all** | no |

So the whole C wave carries **one** cascade obligation, in C1. Confirm it rather than trust this
table — the point of §11.1.1 is that these audits are cheap and the bug they catch is silent.

### 11.1.3 Wave B is complete — what emptying a wave actually costs

B4 took the live ledger to **40** and `HOUSE_WAVE_B_TABLE_COUNT` to **0**. Three things only became
visible on the last crossing, and C4 will hit all three again:

1. **The S1 collision goes live on both sides at once.** `checklist_items` is claimed by
   `recurringChecklistItems` (Wave A) and `visitChecklistItems` (B4). Until B4 they were in different
   waves, so "every physical name is distinct" held by accident. It is now asserted as *exactly one
   known collision, shared by exactly two names* — relaxing it to "collisions allowed" would have
   thrown away the check that catches a second, accidental duplicate.
2. **The CSV export renames itself.** `sectionFileName()` already disambiguated to
   `checklist_items__<ledgerName>.csv`; the test hardcoded `${physical}.csv` and only passed because
   one claimant was staged. Build export expectations *through* `sectionFileName`, never from the
   physical name.
3. **An empty wave makes filters pass vacuously.** Any assertion of the form
   `HOUSE_WAVE_B_TABLE_NAMES.filter(...)` is trivially true once the wave is empty — which is the
   moment you most need it. The fix is to assert the *terminal state* positively (the tables are
   live, and absent from every staged map) rather than filtering the empty side.

**And the rot that was predicted and duly went off.** B3 flagged that
`waveBCSchemaParity.test.ts` hardcoded `['contractorQuotes','quoteRequests']` as the live half of its
S3b coverage check. When `contractorJobRatings` crossed in B4 it simply *fell out of the list* —
shrinking the assertion instead of failing it. The test's own comment claimed it read "straight out
of the Drizzle sources"; the code restated a list. It now genuinely parses `uniqueIndex` declarations
from the schema, maps them to claimants, and requires a natural key in either map, with a
non-vacuity floor. **Where a key lives is an activation detail; that it exists is the invariant** —
write the assertion against the invariant, or it rots at the next crossing.

### 11.1.4 C1 as-built — and the two things it corrected about this section

C1 activated 5 tables (live ledger 40 → **45**, Wave C 22 → **17**) and implemented the single
cascade §11.1.2 predicted. `deleteBill` turned out to need **three** drops, not two: the bill, its
`utility_reminders` (the FK cascade), **and** the linked `tasks` row — because
`utility-service.ts:735` deletes that explicitly and no FK would reach it. `tasks` is deliberately
NOT in `BILL_CASCADE_TABLES`: `task_id` has no `references()` in D1, so folding it in would make the
schema-derived guard lie about the schema. The obligation is real but it is not a cascade.

Two corrections worth carrying:

1. **The vacuity trap arrives at C1, not C4.** §11.1.3 warned that an emptying wave makes
   `filter(...)` assertions pass trivially. C1 takes the *last two natural keys in the whole
   registry*, so `HOUSE_STAGED_DETERMINISTIC_ID_TABLES` and its builders map are **empty from C1
   onward** — three sub-waves earlier than expected. Two `registryGuard` loops went vacuous and are
   now backed by positive terminal-state assertions. C2–C4 must check every remaining
   `Object.keys(HOUSE_STAGED_*)` loop for the same thing before trusting a green run.

2. **A facade can be much larger than its method count suggests.** `utilitiesApi` is 24 methods, and
   three of them — `getDashboard`, `getAnalytics`, `getPropertyInsights` — are pure functions of
   ledgered rows that required porting ~440 lines of backend arithmetic (`logic/billAnalytics.ts`).
   Leaving them remote would have rendered "$0.00 this month" with a 200 OK over a year of imported
   bills, which is the §6 "empty AND correct" failure the Proxy exists to prevent. **Estimate Wave C
   by what the method computes, not by how many methods there are.**

### 11.2 The honest remaining size

**1 sub-wave, 10 tables remain.** Wave B (19 tables), C1 (5), C2 (3) and C3 (4) are done — 9 facades.
`HOUSE_STAGED_TABLES_WITHOUT_DTO` is down from 6 to **one** — `homeProjectMilestones`, in C4.

Remaining: `homeProjectsApi` ~21 (C4, 10 tables) — and C4 carries the registry's **last DTO gap**,
`homeProjectMilestones`, whose row type has to be written from scratch (see §11.1.4b).

**Treat every published method count as a floor.** `utilitiesApi` was briefed as "~15+" and is 24;
`floorPlansApi` was briefed as "~22" and is 25, with **8** throw sites rather than the three the
brief implied. Count the methods yourself before estimating.

C4 is the one to schedule last and read §5.2 before starting: home projects are already
React-Query-native (`homeProjectKeys`), so the query-key mapping matters more there than anywhere
else, and three of its fourteen tables are PK-less joins parked in `HOUSE_S2_DEFERRED_TABLES` behind
a backend change.

---

## 12. Verification strategy

**Per item.** A test for every behaviour changed. For every bug fix, confirm the test **fails
without the fix** by temporary revert. Budget's Stage-3 DoD still carries this as an open box —
do not inherit that debt.

**Per stage.** Two adversarial reviewers: one on concurrency/convergence correctness, one on
Hermes/perf displacement.

**Suites to port from Budget** (all currently green there — they are specifications, not just tests):

**H1 changed the economics of this table.** With the merge core promoted into
`@symply/local-first`, Budget's suites over that core now cover the *same code* House runs, so
"port" no longer means "copy 11 files and re-point the imports". House's H1 suites deliberately test
only what the House *descriptor* changes — the registry, the bucket policy, the deterministic ids
and the session — plus scale sanity at House cardinality. The `re-point` rows below stand for
Wave-A facade coverage in H3, not for re-proving the CRDT.

**Shipped in H1** (`src/features/house/local/__tests__/`, 68 tests, all green):
`registryGuard` (13) · `houseProjection` (17) · `deterministicIds` (9) · `outOfOrderDelivery` (6) ·
`bulkOps` (8) · `applyDeltaScale` (5) · `houseSession` (6) + the `houseLedgerTestKit` fixtures.
Backend: `local-first-api-gate.test.ts` (10) pins the `/v2` gate and its 404 body.

| Suite | Budget location | House form |
|---|---|---|
| version vector (8 cases) | `packages/local-first/__tests__/version-vector.test.ts` | reused as-is |
| sync storm / join anti-starvation | `__tests__/sync-storm.test.ts` | reused as-is |
| out-of-order delivery (11 cases: park, tombstone absorbs park, idempotent redelivery, eviction bound, persist round trip, in-order equivalence) | `src/features/budget/local/__tests__/outOfOrderDelivery.test.ts` | re-point at the House registry |
| apply-delta scale (13 cases incl. NaN/±Infinity/-0 churn, index-vs-scan equivalence) | `__tests__/applyDeltaScale.test.ts` | re-point |
| bulk ops (12 cases incl. 500+500 chunked import converging on a peer) | `__tests__/bulkOps.test.ts` | re-point + House bulk paths |
| restore merge (live edit + tombstone beat restore) | `__tests__/restoreMerge.test.ts` | re-point |
| checkpoint seal/install | `__tests__/checkpoint.test.ts` | reused |
| row persist / row store | `__tests__/rowPersist.test.ts`, `row-store.test.ts` | reused |
| natural-key re-key regression | `__tests__/naturalKeyRekey.test.ts` | ✅ **H1: `deterministicIds.test.ts` covers all 4 Wave-A S3b tables** with the offline-double-create convergence proof + the random-id counter-example. The remaining 7 of the 11 are Wave B/C tables and land with them; `registryGuard` fails the moment one is registered without a builder |
| multi-member sync | `__tests__/multiMemberSync.test.ts` | re-point + multi-property cases |
| backend relay (46 tests, 11 files) | `backend/src/services/__tests__/local-first-*` | reused; **add** the House gate test and the mailbox device-ownership test |

**Coverage gaps to close that Budget left open** (do not inherit): no test exercises the `/v2` HTTP
routes end-to-end, the Durable Object itself (incl. WebSocket hibernation wake), `putChunk`/`getChunk`
round-trip, or `pruneOldGenerations`. H0 should add at least the route-level, mailbox GET **and**
deposit ownership, and DO-level ones.

**End-to-end.** Port the 18-flow two-device Maestro suite
([BUDGET_MULTI_MEMBER_SYNC_E2E.md](../../engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md)) to
House, adding: property switch mid-sync, attachment round trip (H6), reminder firing from the local
scheduler (H7), and widget projection after a peer's write.

**Standing rule inherited from Budget §3.5.0** — the two-device E2E must run against a Worker built
from **the same commit** as the client. Client and relay live in one repo but deploy on different
clocks; unit tests import the tree, not the deployment, so this class of skew is invisible to every
suite. Confirm the deployed Version ID postdates the newest `backend/src` commit before every run.

**The sim-disk guard must never run per-flow (found 2026-08-13).** House's suite defaults to
SEQUENTIAL mode, which re-invokes `run-house-suite.sh` **once per flow** — so `sim_guard`, designed
to run once *before* a suite, ran ~140 times. Partway through it crossed the cap
(`[sim-guard] House-A is 3018 MB (cap 3000 MB) — erasing`), erased the device, and destroyed
`com.symply.house`; every remaining flow then failed with *"is not installed"*. **131 of that run's
134 failures were that single event** — only 3 were real. Two fixes landed: the sequential exec now
carries `E2E_SIM_GUARD=0` (the guard has already run once), and `sim_guard` itself refuses to erase
while `maestro test` / a driver is in flight, matching the standing rule that a GC step must never
run under a live suite. Any historical House suite result that ran long enough to cross the cap
should be treated as invalid past that point.

**A suite must not be able to fill the disk (found 2026-08-13, the hard way).** Two consecutive
House runs were lost to harness problems, and the second was caused by the fix for the first. Run 1:
`sim_guard` erased the device mid-suite (above). Run 2: with per-flow guarding off, **nothing**
bounded growth during the run — ~140 flows of screenshots and screen-hierarchy dumps plus an
unbounded `tee`'d Metro log ate 33 GB, the volume hit zero, Metro died, and 47 flows failed. The
log records it plainly: `java.io.IOException: No space left on device`. Sampled failures die at
`Open ${E2E_METRO_DEVCLIENT_URL}`, not on any product assertion — the run is **not gradeable**.

The standing "check `df` before a run" rule cannot catch this: the run *started* with 33 GB.
`scripts/e2e/disk-floor-guard.sh` now guards both ends — a preflight that refuses to start under
15 GB, and a between-flows check that stops the suite the moment free space drops under 5 GB, so a
disk-exhausted run ends with **one honest line** instead of dozens of phantom failures. It also
trims the two logs that grow for the whole run, since `tee` has no rotation.

**Test-environment constraints already known:** run one simulator, serially, on iOS 26 (driver-drop
flakes are load-aggravated); check `df` before a run (`~/.maestro/tests` has hit 28 GB and a full
disk wedges the simulator into looking like an app bug); always generate and open the live HTML
report.

---

## 13. File ownership & sequencing

Worktree isolation is unsafe in this repo (tooling has deleted in-progress work on worktree
removal) — coordinate in one checkout via this table.

| Area | Primary owner files | May touch with ack |
|---|---|---|
| Package generalization (§3.1) | `packages/local-first/src/projection/**`, `store/types.ts` | Budget's `projection.ts` during the promote refactor — **requires Budget owner ack**, Budget's suites are the oracle |
| House ledger core | `src/features/house/local/{schema,engine,projection-descriptor,ids,defaults,errors,flag}.ts` | — |
| House api layer | `src/features/house/local/local*Api.ts` | `src/api/*.ts` (Proxy block only, bottom of file) |
| House sync | `src/features/house/local/sync/**`, `controlPlaneClient.ts` | — |
| Blob channel (H6) ✅ | `src/features/house/local/blobs/**`, `backend/src/routes/local-first-blobs.ts`, `services/local-first-blob-service.ts` | `migrations/0157_lf_blobs.sql` |
| Server displacement (H7) | `src/features/house/local/{reminders,ai}/**`, widget/watch projection | `backend/src/cron/scheduled.ts` (guards only) |
| **Shared Worker plumbing** | `backend/src/index.ts`, `middleware/**`, `config/brand-capabilities.ts`, `cron/scheduled.ts` | **change deliberately — see §14** |

**Rule:** if the House ledger needs a sync-engine change, file it against the package owner — do not
edit `mailbox-engine.ts` from a projection agent. Budget's §10 states this after it was violated.

---

## 14. Deployment order & fleet blast radius

```text
1. H0 config lands  → npm run typecheck && npm run lint && npm test (backend)
2. eval "$(./scripts/secrets/export-env.sh)" && cd backend && npm run deploy:fleet
   (House + Budget + Kaizen + Health, staging THEN production)
3. Confirm House Worker Version ID postdates the newest backend/src commit; record it here
4. Wave A client behind EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0 → internal devices only at =1
5. Two-device E2E green against the same-commit Worker
6. Flip the House brand default on only after Wave A DoD
```

**Blast radius — read before touching the gate.** `deploy:fleet` ships **one codebase to four
production Workers**. H0 modifies `brand-capabilities.ts`, `index.ts` mounts and
`cron/scheduled.ts` — all shared plumbing. A mistake there reaches Budget, Kaizen and Health in the
same run. Two mandatory guards:

1. A test asserting `/v2` is **404 on Kaizen and Health** after the gate change (they must not gain
   a control plane by accident).
2. A CI grep asserting **no non-House, non-Budget brand imports `@symply/local-first`** or calls
   `/v2/households/*/mailbox`.

Also note: per-brand D1 and R2 are fully isolated (`simple-house-db` vs `simple-budget-db`;
`simple-house-reports` vs `simple-budget-reports`), so House `lf_*` rows cannot touch Budget's.
Migrations `0152`–`0156` are already applied to House's D1 via the shared `migrations_dir`; only
`0157_lf_blobs.sql` (H6) is new — `0156` went to the H5 `lf_devices` composite PK, so H6 claimed the
next free number. Because `migrations_dir` is **shared**, 0157 lands on Budget/Kaizen/Health D1s too
(empty tables). Apply to **staging and production for every fleet brand**.

### 14.1 Rollback (irreversible steps)

| Step | Undo | Cannot undo |
|---|---|---|
| H0 capability + `requireLocalFirstApi` | Revert the three `/v2` mounts to `requireBudgetApi`; `deploy:fleet`. Kaizen/Health 404 tests must stay green either way. | — |
| H0 `LOCAL_FIRST_API_ENABLED=false` on House production | Set `"true"` and redeploy House Worker only (`deploy:house:all`) | — |
| Client kill | EAS Update embedding `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0` | Installed binaries without Updates until they fetch |
| DO tag `v4` / `new_sqlite_classes` | **Cannot remove the class from Cloudflare history.** Can unbind `HOUSEHOLD_COORDINATOR` and leave the tag. Do not invent a `deleted_classes` tag unless retiring the class fleet-wide. | The migration tag |
| §2.1 D1/R2 truncate | Restore from the R2 snapshot taken in step 1. **No snapshot → no undo.** | Live rows after truncate if snapshot skipped |
| `0157_lf_blobs.sql` | Leave tables in place (empty). Do not DROP from a shipped migration — add a later migration if retiring. | The DDL |

**Failed H0 mid-fleet:** if staging House is up but Kaizen/Health 404 tests fail, **do not continue to production**. Revert the capability mount, re-run `deploy:fleet` staging, then production.

**Where the wipe goes:** after step 4 (Wave-A **binary** may be installed but `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0`, so it still talks to the remote API) and **before** any device is flipped to `=1`. Truncating while the flag is on is the mixed-era failure. Snapshot D1 to R2 first (§2.1 step 1). Matches §2.1 ordering.

---

## 15. Effort estimate

Calibrated against Budget's measured output: `packages/local-first` 4,357 lines +
`src/features/budget/local/**` 15,392 lines for 25 tables, plus 2,497 backend lines, over
Stages 0–5.

| Stage | Scope | Est. |
|---|---|---|
| H0 | enablement + gate + DO binding + security fix | **3–5 days** |
| H1 | package promote + registry + engine + session (Wave A) | **3–4 weeks** |
| H10 | House corpus + baseline + on-device anchor | **1 week** (must land inside H1's window) |
| H3 | Wave A api facades + ported server logic (~117 methods, ~4,000–5,000 new lines) | **5–7 weeks** |
| H5 | multi-property session manager | **1.5–2 weeks** |
| H6 | encrypted blob channel (client + Worker + D1 + sweep + upload normalization) | **3–4 weeks** |
| H7 | server displacement (reminders, BYOK ladder, widget projection, cron guards) | **5–7 weeks** ← widest variance; Q6–Q10 **locked**, remaining risk is implementation |
| H8/H9 | checkpoints (inherited) + backup/restore/export | **2 weeks** |
| H11 | Wave B (19 tables) + Wave C (26 tables) | **8–12 weeks** |
| H12 | two-device E2E port + hardening | **2–3 weeks** |
| **Total** | | **≈7–9 months of focused work** |

**Assumptions behind these numbers:** no migration program (Q1 closed — confirmed); one to two engineers on the
critical path with agent assistance at roughly Budget's observed throughput; the §1.0 gate met, so
no time is lost debugging inherited engine defects; and H10 landing early enough that no wave is
re-done for performance. Each broken assumption adds weeks, not days — H7 in particular is bounded
by *implementation* of the locked P1/P2/P4 assignment, not by typing.

This is a program, not a feature. The wave structure exists so Wave A can ship and be judged on its
own before Waves B/C are committed.

---

## 16. Monitoring & rollout signals

Mirrors Budget §13, plus what House needs on top.

| Signal | Where | Threshold / meaning |
|---|---|---|
| Sync terminal errors | client `classifySyncError` codes + the Settings sync card | `payload_too_large` is terminal — the batch only grows |
| Relay 413 / 403 | Worker logs; client `payload_too_large` / `auth` | a 403 spike means the auto re-enroll path is looping |
| Mailbox growth | unacked addressed blobs per household | rising unacked ⇒ a device cannot decrypt (key-epoch skew) |
| Checkpoint publish failures | owner-device telemetry | any failure blocks new-device bootstrap |
| Sweep lag | cron logs for mailbox / checkpoint / **blob** sweeps | rows swept at the 500 cap every tick ⇒ the sweep is behind |
| **Blob bytes per household** (H6) | `lf_blobs` rollup | Q5 warn / hard stop |
| **Pending local notifications** (H7) | client count | approaching **64** ⇒ the rolling-horizon scheduler is mis-sized |
| **Ledger size on device** | rows, LWW bytes, cold-open ms (sampled) | regression against the H10 baseline |
| Kill switch | `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0` via **EAS Update** + House `LOCAL_FIRST_API_ENABLED=false` (§1.7) | Verify both; Worker-only is insufficient |
| Disk / Maestro | prune `~/.maestro/tests`; abort below 2 GB free | a full disk wedges the simulator and mimics app bugs |

Analytics rides the provider-agnostic, brand-tagged `src/services/analytics.ts` — never a per-brand
fork, and **never** with ledger content in an event property.

---

## 17. Abort / descope criteria — decide at these points, not in hindsight

A program this size needs stated exit ramps. Each is a decision point, not a failure.

| Checkpoint | Trigger to descope | Fallback |
|---|---|---|
| End of **H0** | ~~Branch B / migration~~ **closed** (no install base) and ~~§1.0 Budget-E2E gate~~ **met** (22 PASS / 0 FAIL). No abort trigger remains at H0 | — |
| End of **H10** | Cold open on the 10-year × 3-property corpus stays unacceptable on the Hermes anchor **after** the N5 mitigations | Descope to Wave A permanently; leave Waves B/C server-authoritative (§19 "partial" alternative) |
| End of **H1** | The projection promote (§3.1) cannot land green against Budget's suites | Fork instead and accept the documented drift cost — do **not** ship a half-migrated core |
| Mid **H7** | P1 reminders or P2 BYOK cannot land to a member-acceptable bar | Local-first would delete more House value than it adds. Stop and reconsider §19 partial / Wave A only |
| End of **Wave A** | Two-device E2E cannot be made green in three focused attempts | Ship Wave A behind the flag for internal use only; do not flip the brand default |

**Honest framing.** The offline + E2EE benefit is real and the engine is already paid for. The cost
is concentrated in **H6 and H7** — the two things Budget never had to build. If those land, the rest
is volume work. If they cannot, this plan should stop at the end of Wave A rather than grind through
Waves B and C.

---

## 18. Open questions

**Closed 2026-08-12 by the product owner:** Q1 (no real users, wipe authorized), Q6, Q7, Q8, Q9, Q10
(server-compute displacement locked — see §9). **Q0** (is local-first the right call at all, §19) is
answered **yes**. What remains below are engineering decisions, each resolved at its marked stage.

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| ~~**Q1**~~ | ✅ **CLOSED 2026-08-12** — no real users; **database may be wiped**. §1.1 locked, H1.5 migration deleted, §2.1 is now a truncation rather than an orphan | — | — |
| **Q2** | New `localFirstApi` capability vs widening `requireBudgetApi` | H0 | **New capability.** Widening a budget-named gate to House is how gates rot |
| **Q3** | Multi-property: N ledgers in one DB (proposed) vs one DB per property | H5 | **One DB.** The store is already household-keyed; N files means N DEKs and N cold opens |
| ~~**Q4**~~ | ✅ **CLOSED 2026-08-13 → tombstone + watermark**, as recommended. Server-enforceable form: `purge_after = tombstoned_at + CHECKPOINT_TTL_MS` (90 d), because a checkpoint published before the delete stays servable that long (§8.1) | — | — |
| ~~**Q5**~~ | ✅ **CLOSED 2026-08-13 → soft 2 GB / hard 5 GB**, as recommended. Hard stop enforced on the Worker *before* the R2 write and against the size delta; tombstoned bytes excluded from the live total (§8.1) | — | — |
| ~~**Q6**~~ | ✅ **LOCKED 2026-08-12 → P2** BYOK with ledger-assembled context | — | — |
| ~~**Q7**~~ | ✅ **LOCKED 2026-08-12 → P1** on-device scheduling. **P3 is not approved and must not be built** | — | — |
| ~~**Q8**~~ | ✅ **LOCKED 2026-08-12 → P1 in-app; email/push digests OFF** for local-first households | — | — |
| ~~**Q9**~~ | ✅ **LOCKED 2026-08-12 → P4 disabled** for local-first households; upgrade to P2 where a BYOK vision call suffices | — | — |
| ~~**Q10**~~ | ✅ **LOCKED 2026-08-12 → approved**, minimal fields, disclosed | — | — |
| **Q11** | Reports and the `home-budget` glance: stay Tier B remote, or mirror metadata into the ledger? | H3 | **Stay Tier B**; revisit after Wave A. ⚠️ Note the compounding failure: `routes/home-budget.ts` reads Budget's D1, which is **already empty** for local-first Budget households. House local-first would make the same endpoint's House half empty too. The glance is the one surface that breaks from *both* sides — give it an explicit owner |
| **Q12** | Wide-row LWW mitigation: field grouping, stamp interning, column pruning — which, how many? | H1, decided with H10 data | Do **stamp interning** unconditionally; add the others if the LWW map exceeds row bytes |
| **Q13** | Promote `projection.ts` into the package vs fork it | H1 | **Promote.** Two 1,100-line CRDT cores will diverge |
| **Q14** | Collapse the 3 legacy House invite tables into `lf_invites` device enrollment? | H4/§5.1 | **Yes, collapse.** Running both means members without device keypairs |
| **Q15** | Backup: one archive per property or all; blob bytes included? | H9 | Per property; manifests by default, bytes in an opt-in full archive |
| **Q16** | House is the platform authority for Soft Transfer — how does that interact with an encrypted House ledger? | H9 | Needs a dedicated design pass; do **not** hand-wave |

---

## 19. Alternatives considered

| Alternative | Why not |
|---|---|
| **Do nothing — House stays server-authoritative** | ❌ **Rejected 2026-08-12.** Offline use and E2EE are confirmed House product requirements, so the do-nothing default does not meet the bar. Recorded here because it was the alternative to beat, and because the §17 abort ramps fall back toward it |
| Partial: ledger only Wave A, leave B/C on the server permanently | Viable and cheaper (~4 months). Cost: two data models in one app forever, and any cross-domain screen (labor hub → tasks) straddles them |
| Automerge / Yjs | Document CRDT; memory and tombstone growth; wrong boundary for a maintenance-history audit log. Same conclusion as Budget |
| ElectricSQL / PowerSync | Postgres-shaped backend; conflicts with Cloudflare-only + E2EE relay |
| DO-authoritative op log | Breaks the zero-knowledge relay threat model |
| Ship House on Budget's ledger engine unchanged, ignore multi-property/blobs | Produces a demo, not a product: photos invisible across devices, one property per user |

Architecture, if executed, stays: **LWW + tombstones + op log + encrypted R2 mailbox + version-vector
cursors + checkpoint bootstrap** — identical to Budget.

---

## Appendix A — Identifier registry (proposed; House-side)

| Identifier | Value / location |
|---|---|
| `EXPO_PUBLIC_HOUSE_LOCAL_FIRST` | client kill / path gate — `src/features/house/local/flag.ts` |
| `EXPO_PUBLIC_HOUSE_P2P` | WebRTC gate (default off) |
| `LOCAL_FIRST_API_ENABLED` | Worker var, typed `Env`. **`"true"` in House staging AND production** (2026-08-12 decision — see H0 DoD). **Not** `HOME_LOCAL_FIRST_ENABLED`. |
| `localFirstApi` | new `BrandCapabilityKey` + `BrandCapabilities` field — `backend/src/config/brand-capabilities.ts` |
| `X-House-Local-First` | client header on `/v2` calls + reject-gate trigger |
| `house_sync_wake` | opaque push wake type; payload exactly `{type, householdId}` |
| `house.localFirst.dek.v1` | SecureStore DEK key (**must differ from Budget's**) |
| `symply-house-local-first.db` | expo-sqlite database name |
| `simplehouse://lf-invite` | invite deep link (`brands/symply-house/brand.cjs` `scheme`) |
| `HOUSE_LEDGER_TABLE_KEYS` | `src/features/house/local/schema.ts` — Wave A = 21 tables |
| `REPORTS_BUCKET` + `lf-blob/` | H6 R2 (same bucket as `lf-checkpoint/`); D1 `lf_blobs`, `lf_blob_chunks`, migration **`0157`** |
| `X-LF-Chunk-Count` / `X-LF-Key-Epoch` | H6 chunk framing headers — the reason the Worker never parses a chunk body |
| `lf-blob:v1:{hh}:{keyEpoch}:{blobId}` | H6 HKDF info string for the per-blob content key; the AAD appends `:{chunkIndex}:{chunkCount}:A256GCM` |
| `BLOB_PLAINTEXT_CHUNK=350_000` · `BLOB_MAX_CHUNK_CIPHERTEXT_BYTES=384_000` · `BLOB_MAX_PLAINTEXT_BYTES=64 MiB` · `BLOB_QUOTA_SOFT_BYTES=2 GiB` · `BLOB_QUOTA_HARD_BYTES=5 GiB` · `BLOB_PENDING_TTL_MS=7 d` · `BLOB_CACHE_BUDGET_BYTES=256 MiB` | H6 constants |
| `lf-blob-staging/` · `lf-blob-origin/` (documentDirectory) · `lf-blobs/` (cacheDirectory) | H6 device directories — staged envelopes, pre-upload originals, decrypted cache |
| **Inherited unchanged** | `MAILBOX_BATCH_VERSION=2`, both `MAILBOX_MAX_CIPHERTEXT_B64` and `MAX_MAILBOX_CIPHERTEXT_B64` = `512_000` (**do not rename** — Budget uses both), `CHUNK_FILL_RATIO=0.98`, `CHUNK_START_OPS=256`, `MIN_PUSH_INTERVAL_MS=5_000`, `MAX_PULL_PAGES=8`, `SENT_VV_TTL_MS=12d`, `SYNC_WAKE_COALESCE_MS=10_000`, `MAILBOX_TTL_MS=14d`, `MAX_OP_DELTA_BYTES=64_000`, `MAX_OP_DELTA_ROWS=250`, `MAX_PARKED_ROWS=2000`, `LEDGER_INDEX_THRESHOLD=16`, `HLC_MAX_DRIFT_MS=60_000`, `CATCH_UP_OPS_THRESHOLD=500`, `CATCH_UP_STALE_MS=14d`, `CHECKPOINT_PUBLISH_MIN_OPS=100`, `CHECKPOINT_TTL_MS=90d`, `CHECKPOINT_RETAIN_GENERATIONS=3`, `RESTORE_HLC='000000000000001-0000-restore'` |
| Branch | `feat/house-v2-local-first` |

---

## Appendix B — Where House differs from Budget (one-page summary)

| Dimension | Budget V2 | House V2 |
|---|---|---|
| Ledger tables | 25 | **21 (Wave A) → ~66 (all waves)** |
| Widest row | ~20 cols | **58 (`tasks`)**, 42, 37, 34 |
| Rows @ 5 y | 11,833 (measured) | **~20,000–45,000 (estimated — H10 must measure)** |
| Households per user | 1 | **1–3 (multi-property)** |
| Blob-bearing tables | 1 (wish media, bytes never sync) | **25 (bytes must sync)** |
| Server compute displaced | budget alerts/insights → no-ops (accepted) | **36 AI Housekeeper production files + 9 cron jobs + 4 queues + Lambda** |
| Widget / Watch | none | **tasks feed an extension with no DEK** (local App Group file; P3-server banned) |
| Invite model | `lf_invites` from day one | **3 legacy tables to collapse** |
| Control plane | built for it | **already deployed, gate-locked** |
| Natural-key hazards | 2 found and re-keyed | **11 S3b to re-key** (+ 3 S3a Tier B, no action); **3 duplicate table names; 4 PK-less joins** |
| Install base | zero, confirmed | **Q1 closed 2026-08-12 — wipe authorized; 26 prod rows are synthetic** |

---

## Appendix C — HouseLocal error codes (H1+)

| Code | HTTP / client | Test must assert |
|---|---|---|
| `not_found` (legacy string `{ error: 'Not found' }`) | 404 `/v2` when capability or `LOCAL_FIRST_API_ENABLED=false` | Kaizen/Health 404 **body** matches Budget envelope |
| `local_first_enabled` | 410 on rejected House domain writes | `rejectHomeWritesForLocalFirst` — same code as Budget financial gate |
| `HouseLocalUnsupportedError` | thrown from Proxy on missing local method | never silent fall-through |
| `HouseLocalNotReadyError` | session not open | |
| `HouseLocalEnrolmentPendingError` | mutate blocked until HDK | |
| mailbox device mismatch | 403 GET/deposit | `deviceBelongsToUser` |

---

*Canonical companion stub: [documents/engineering/house-local-first-implementation-plan.md](../../engineering/house-local-first-implementation-plan.md) (pointer only).*
