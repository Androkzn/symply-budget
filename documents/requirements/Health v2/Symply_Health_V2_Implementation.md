# Symply Health V2 — Implementation Plan

> Execution handoff from the Health V2 local-first plan. Does not redefine app BRD/TRD.
> Live narrative: [health-local-first-implementation-plan.md](./health-local-first-implementation-plan.md) **v1.8**.

| Field | Value |
|-------|-------|
| **Doc type** | Feature implementation plan |
| **Feature id** | `health-v2-local-first` |
| **Owning app** | `simple-health` / `symply-health` |
| **Status** | 🟢 **as-built engine** — not `ready`. He0 live `/v2` proof + Q1 countersign still required. He3 cutover not started |
| **Version** | v1.8 |
| **Created** | 2026-08-13 |
| **Last updated** | 2026-08-14 |
| **App BRD** | [documents/apps/symply-health/BRD.md](../../apps/symply-health/BRD.md) |
| **App TRD** | [documents/apps/symply-health/TRD.md](../../apps/symply-health/TRD.md) |
| **Live plan** | [health-local-first-implementation-plan.md](./health-local-first-implementation-plan.md) |
| **Pack index** | [README.md](./README.md) |
| **Pattern** | [Symply_House_V2_Implementation.md](../House%20v2/Symply_House_V2_Implementation.md) · [Symply_Budget_V2_Implementation.md](../Buget%20v2/Symply_Budget_V2_Implementation.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/BRANCHING.md
3. documents/apps/symply-health/README.md
4. documents/apps/symply-health/BRD.md
5. documents/apps/symply-health/TRD.md
6. documents/apps/symply-health/PARITY_PLAN.md
7. documents/requirements/Health v2/README.md
8. documents/requirements/Health v2/health-local-first-implementation-plan.md (v1.8)
9. This implementation plan

Rules:
- Status is as-built engine, not ready. Do not truncate D1 until Q1 **and** He12(partial) E2E are done.
- Wave A engine is on the branch (`src/features/health/local/`). D1 + outbox are still SoT. Do not claim cutover.
- Pin `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0` on Health binaries until He12 (full). `flag.ts` brand-defaults on when unset; `eas.json` does not pin it.
- Do not invent 0156_lf_blobs — 0156 is lf_devices_composite_pk. House H6 shipped as `0157_lf_blobs.sql`. Health blob client is He6, not started.
- He6 is unblocked (House H6 DoD met). Do not start photos until a Health blob client exists.
- He7-lite is a hard Exit of He3. Do not merge He3 with HealthLocalUnsupportedError on Home.
- Keep existing Health screens; swap healthRepository / healthApi underneath.
- Personal ledger: one user, N devices. Reject a second userId on the Health household.
- Shared User stays. No family invites. Social stays disabled.
- ZK mailbox required. No SSE. WebRTC off unless EXPO_PUBLIC_HEALTH_P2P=1.
- Client flag EXPO_PUBLIC_HEALTH_LOCAL_FIRST: the BRAND DEFAULT is suppressed under Jest, but an explicit =1 is still honoured (copy house/local/flag.ts:13-31). Not "Jest → false" — that makes the required =1 pin unpassable. Off until He12 full.
- Reuse @symply/local-first; do not fork projection.ts.
- Kill the MMKV outbox — do not dual-write with D1.
- 410 only when X-Health-Local-First is present. Never arm 410 globally while flag-0 clients exist.
- The 410 gate is a REJECT-LIST of the 8 Wave A path prefixes + /health/sync/*, gated on POST|PUT|PATCH|DELETE, registered BEFORE app.route('/health', …) at index.ts:265. Everything else (/health/cycle, /health/ai, /health/reminders, /health/widget, /health/foods, /health/exercises, /health/fridge, /health/files) falls through — Tier B / Wave C stay server-authoritative.
- Flag-1 devices start with an EMPTY ledger. No backfill, no migration. Ship the first-launch copy and the export-before-upgrade CSV. See live plan §1.3a.
- Truncate EXACTLY the 8 Wave A tables. Wave C (cycle_*, period_entries, mens_health_*, injuries, custom_foods, recipes, fridge_items, health_reminder_preferences) is NOT truncated — it has no ledger until He11b.
- Prove the flag-0 cohort is EMPTY before truncate (§14 step 10b). "Truncate while flag-0 clients exist" is a REJECTED order.
- Deterministic ids: habit_logs and health_goals ONLY. weight_entries keeps random ids — two weigh-ins in one day are supported and a date id would LWW one away.
- Push wake code is in tree (`health_sync_wake`, no `excludeUserId` for Health, handler routed). Live A→B is He12(partial).
- /v2 fail-closed (`=== 'true'`) is in tree. `LOCAL_FIRST_API_ENABLED` must still leave `[vars]` or the next deploy:fleet re-arms it.
- Pending notifications: Notifications.getAllScheduledNotificationsAsync(). Never getPendingNotificationRequests().
- Q3a (lock-screen glance vs complete file protection) blocks ENABLING the glance, not He3d — if still open, ship Option A's default file class with the glance dark. Never add NSFileProtectionComplete on a guess. Q8 (archive keying) blocks He9. Both are open.
- /v2 fail-closed three-commit order: Budget now sets `LOCAL_FIRST_API_ENABLED` in toml. Remaining: move all three brands to secrets and prove Budget 401 not 404 after a fleet deploy.
- `health_flag0_mutation` emits in tests. Never truncate on a zero without a staging positive control — prod request logger is still dev-only.
- Do not remove excludeUserId from POST /v2/households/:id/sync-wake until that route has a sourceDeviceId — it has no other exclusion and will self-wake in a loop.
- notifyHealthLedgerChanged also fires at session open and after account switch, and 'ingest' (HealthKit drain) fans out. Only 'local' is a no-op.
- App wiring (ensureHealthLocalSession etc.) is owned by He2/He4, not He3 — the session must be open before the Proxy exists.
- Wave A GET is 410'd too, not just mutations — a GET that falls through to D1 silently overwrites the MMKV mirror via readThrough.
- Every user-authored Health table needs a tier/wave disposition (live plan §1.5a). Wave A + tiers B/C/D/Off are in `schema.ts`; He3a still owes remaining dispositions.
- P3 plaintext Health projection to the server is banned.
- HealthKit is ingest (signed ops), not a sync peer. Default read-only vs Apple. No HK water until water_entries.source exists. HKObserverQuery completion is Swift-owned (after native staging write + anchored fetch, every error branch). Register observers at launch. JS drain must not own the handler.
- After mutateLocalHealthLedger: notifyHealthLedgerChanged (Health is not House RQ).
- Do not fork Login/Widget/Watch.
- Shared Worker / migrations on main. Client on health-v2.
- Never deploy:fleet from an <app>-v2 clone. He0 /v2 proof = staging-only scripts first (fleet has no pause).
- Wave A registry = exactly 8 D1 tables. Notes stay MMKV (health.notes.v1) unless product explicitly adds a 9th key.
- He12(partial) is NOT brand-default-on and does **not** truncate D1. He12 (full) needs Q1, widget freeze, truncate, **post-truncate two-device E2E**, and HBNR legal copy (live Appendix C). Worker Version ID is recorded **before He12(partial)**.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.8 | 2026-08-14 | As-built recount. Engine He0–He2/He4/He5/He8 🟢; He7-lite authored/unwired; He3/He10/He12 📐. House H6 ✅ / He6 unblocked. G14/G15/G19/G20/G21 reduced. **G22** brand-default-on landmine. Not `ready`. |
| v1.0 | 2026-08-13 | Initial plan from Budget/House as-built + Health D1/outbox/HealthKit tree |
| v1.1 | 2026-08-13 | Status=design; Q1 blocks truncate; He7-lite hard He3 exit; He6 blocked; blobs ≥0157; kill-switch/rollback/410 windows; widget freeze before wipe; Wave A = 8 tables |
| v1.2 | 2026-08-13 | He7-lite named; He12(partial) vs full (body); notes MMKV; flags in Constants; vitality never on widget; staging-only /v2 before fleet; TS strict He1/He3; HK Swift completion after native staging write + anchored fetch; WAL sidecar teardown |
| v1.3 | 2026-08-13 | **15 dashboard rows** (He12 split — brand default-on is He12 full only); Constants include blob ≥0157 + Wave A 8; HBNR/O6 legal gate (live Appendix C); He6 multipart; He11 register-at-launch |
| v1.4 | 2026-08-13 | Truncate is **He12 (full)** only — after He12(partial) E2E while D1 still exists; disambiguate bare “He12” |
| v1.5 | 2026-08-13 | Post-truncate two-device E2E before brand-default-on; Worker Version ID owned by He12(partial); §6 truncate after partial |
| v1.7 | 2026-08-13 | Cycle 7 (delta safety + recount + doc research on v1.6). **Fail-closed `/v2` is a three-commit ordered change** — Budget sets the key nowhere, so flipping first is a fleet outage of a certified brand and stops the cron TTL sweeps. **Flag-0 counter** added — step 10b(iii) had no data source (prod request logger is dev-only). **`excludeUserId` removal is call-site-asymmetric** — `/sync-wake` has no `excludeDeviceId` and would self-wake. **Refresh contract gains `'ingest'` + session-lifecycle notify** (House notifies at 9 sites, only 1 is the delta path). **§1.5a** classifies ~10 previously-unclassified user tables incl. food challenges. Wave A **GET** is 410'd too. App wiring moved to **§5.1** (He2/He4 owns it). Kill-switch order inverted — EAS Update first. Q3a no longer strands He3a–c. `registryGuard` parameterised by wave. He3 DoD tagged per merge. §0 arrow matches the table |
| v1.6 | 2026-08-13 | Cycle 6: data continuity (flag-1 starts **empty**; post-truncate `readThrough` destroys the flag-0 cache); truncate set = **8 Wave A tables only**, Wave C excluded; flag-0-cohort proof before truncate; `/v2` **fail-closed** + secret out of `[vars]`; 410 gate is a **reject-list**, method-gated, registered before the `/health` mounts; push wake is **4 sites** incl. `excludeUserId`; deterministic ids = `habit_logs` + `health_goals` (**not** weight); refresh contract + read windows + app wiring; He3 splits into He3a–d; widget file-protection decision (Q3a); `getAllScheduledNotificationsAsync()`; DoDs for He2/He4/He8/He12; numeric He10 thresholds |

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| App BRD/TRD exist | [x] | Privacy-first, deny-by-default sharing |
| Budget two-device suite green | [x] | `20260812-195127` |
| House Wave A engine reuse proven | [x] | Projection in package; House H1–H5 as-built |
| Health product already on D1 | [x] | Cutover, not a blank port — see PARITY_PLAN |
| Greenfield / wipe (Q1) | [ ] | **Open — blocks truncate.** Not pre-authorized |
| He0 live `/v2` proof | [ ] | 401 Health vs 404 Kaizen; Version ID — **code is in tree; proof not recorded** |
| UI freeze | [x] | Storage signatures stay; screens stay |
| He7-lite attached to He3 | [x] | Plan lock — summaries are a hard Exit. `summaries.ts` authored, **unwired** |
| House H6 / blob path | [x] | ✅ shipped 2026-08-13 (`0157`). Health He6 client not started |
| Open HIGH blockers | [ ] | Q1, He0 proof, **He3+He7-lite**, He10, **He12(partial)** E2E, **Q3a**, **Q8**, **G22** brand-default |
| HealthKit type list | [ ] | Q2 before He11 |
| **Q3a** widget file-protection decision | [ ] | **Blocks enabling the glance**, not He3a–c |
| **Q8** archive keying (`ThisDeviceOnly` DEK) | [ ] | **Blocks He9** — lost phone = lost ledger |
| **Q9** store health declarations | [ ] | Unowned; Apple blocks **updates** from early 2027 |
| **O2** id scheme | [x] | Locked in He1 — `ids.ts` + `deterministicIds.test.ts` (`habit_logs` + `health_goals` only) |

This document is **not `ready`** until Q1 + He0 live `/v2` proof. Wave A engine as-built does **not** make it ready.

**Dashboard (must match live plan §0):** **15 rows** — He0–He12 plus named **He7-lite**, plus **He12(partial)** vs **He12 (full)**. Wave A ends at He12(partial) (brand default **off**). Do **not** flip store default-on after Wave A E2E.

**HBNR:** operational playbook is live plan **Appendix C**. Legal copy review is a gate of **He12 (full)**, not of He12(partial).

---

## 2. Non-Goals

- Migrating existing Health D1 rows onto devices
- Dual-write ledger + `/health/sync/push` outbox
- Arming `/health` 410 without `X-Health-Local-First`
- Family / community / group-challenge E2EE
- Visual redesign of Health
- P3 consented plaintext projection to the server
- FatSecret personal-diary OAuth 1.0a
- Medical / clinical claims
- Forking Login, Widget, Watch, or `projection.ts`
- Opening `feat/health-v2-*` beside `health-v2`
- Claiming `0156` for blobs
- Shipping He3 without He7-lite
- HealthKit water import until `water_entries.source` exists
- SSE / EventSource as the Health sync transport
- Treating FatSecret lookup as “no PHI” (search-box meal strings can egress; diary OAuth stays off)
- Adding notes as a 9th ledger key in He3
- Truncating Wave C tables at He12 (full) — they have no ledger until He11b
- Deterministic ids on `weight_entries` (or any table without a D1 `unique()` constraint)
- Truncating while flag-0 clients may still be opened
- Claiming “we cannot read your health data” while Wave C is on D1

---

## 3. Branching

| Branch | Purpose |
|--------|---------|
| `main` | Shared Worker, `packages/local-first`, migrations. **Only deploy source.** |
| `health-v2` | Long-running Health client programme. This clone. Never dies. |

Daily: `git merge main` → work → `git push origin health-v2`. Land with `gh pr merge --merge`.

---

## 4. File Plan

| Area | Path | Change |
|------|------|--------|
| Shared core | `packages/local-first/` | Reuse; Health corpus in scale harness (He10) |
| Health local | `src/features/health/local/` **new** | schema (**8 keys**), engine, flag, `notifyHealthLedgerChanged`, sync, repos |
| Flag tests | `src/features/health/local/__tests__/flag.test.ts` | Brand default suppressed under Jest; explicit `=0` / `=1` still honoured — pin both |
| API boundary | `src/api/health.ts` | Proxy → local when flag on; summaries in He7-lite **same merge** |
| Storage | `src/features/health/health*Storage.ts`, `healthRepository.ts` | Drop outbox; call local repos |
| Cache keys | `healthCacheKeys.ts` | Wipe SQLite + remaining prefs on logout |
| HealthKit | `healthKit.ts`, `healthKitBackgroundSync.ts`, native module | Sink = ops; persist `HKQueryAnchor`; pre-JS queue |
| Auth | `authStore.ts` | `ensureHealthLocalSession` / teardown + iOS Keychain reinstall sweep |
| Control plane | `brand-capabilities.ts` (already `localFirstApi: true`) | Fix **four** stale comments: `wrangler.health.toml:171`, `brand-gate.ts:42`, `local-first-api.ts:4`, `brand-capabilities.ts:35` |
| Gate config | `backend/src/config/local-first-api.ts` | **Fail-closed** (`=== 'true'`) — ⚠️ **three-commit order, live plan §1.7a**. **`wrangler.budget.toml` sets the key nowhere**, so flipping the gate first 404s Budget's certified `/v2` in both envs and stops the cron TTL sweeps (`scheduled.ts:226`). Commit 1 adds it to Budget; Commit 2 flips + inverts the two `unset → true` tests; Commit 3 moves all three brands to secrets |
| 410 middleware | new, Health — **reject-list** of Wave A prefixes | Armed **only** with `X-Health-Local-First`; method-gated; registered **before** `index.ts:265`; everything non-Wave-A falls through |
| Wake validator | `local-first-sync-wake-service.ts` | Add `health_sync_wake`. ⚠️ `excludeUserId` is **already optional** in the service — the fix is at the **two call sites** in `local-first-v2.ts` (`:288` deposit, `:670` sync-wake), and `:670` needs a `sourceDeviceId` added **first** or it has zero exclusions and self-wakes |
| Shared `/v2` routes | `backend/src/routes/local-first-v2.ts` | Brand-keyed wake selector (`:53`); pass `wakeType` at `:665`; omit `excludeUserId` for Health (`:288`); brand the QR payload (`:506`) |
| Rate limit | `backend/src/index.ts` | `app.use('/v2/*', rateLimitDO('local-first:v2'))` — `/v2` has none today |
| Notification routing | `src/hooks/useNotificationHandler.ts` | Route `handleHealthSyncWakeNotification` (House's is exported but unwired) |
| Refresh bridge | `src/features/health/local/` + `healthLedgerStore` | `notifyHealthLedgerChanged` + `useHealthLedgerHydration` — Health screens have **no** listeners today |
| Read windows | `src/features/health/local/windows.ts` **new** | One constant per loader; nutrition is **120d** server-side |
| Widget | glance slice + `/health/widget/snapshot` freeze-before-truncate | Sensitive metrics off |
| Scale baseline | `packages/local-first/__tests__/scale/` + engineering testing docs | He10 markdown path |
| Docs | this pack + Health features index | |

**Constants:** `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` (**brand default** suppressed under Jest, explicit `=1` still true — copy `house/local/flag.ts:13-31`; **off** until He12 full); `EXPO_PUBLIC_HEALTH_P2P` (off); DEK `health.localFirst.dek.v1` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); DB `symply-health-local-first.db`; header `X-Health-Local-First`; scheme `simplehealth://lf-invite`; wake `health_sync_wake`; blob migration **≥0157** on `main` (`0156` = device PK); Wave A table count **8**.

---

## 5. Phases

### He0 — Enablement 🟢 code · 📐 live proof

**Exit:** Health **staging** `/v2` proven vs Kaizen staging 404 **before** `deploy:fleet`; wrangler + JSDoc match bindings (**four** comment sites); kill switch + flag tests; 410 **unarmed**, reject-list shaped, method-gated; all **four** wake sites fixed with an A→B delivery test and **no self-wake**; **grep test proves no Health path opens a `/v2` WebSocket or EventSource** (hibernation smoke is **not** a He0 gate — live plan §2 item 6); `/v2` fail-closed via the **three-commit order** in live plan §1.7a with **Budget proven 401 not 404**; flag-0 counter emitting; **Q1 still open**.

- [ ] Live `GET /v2/households` on **Health staging** (401) vs **Kaizen staging** (404 `{ error: 'Not found' }`) **before** `deploy:fleet`
- [ ] Fix **all four** stale comments — `wrangler.health.toml:173` still says `localFirstApi: false`; `local-first-api.ts:4` still says “House + Budget”
- [x] `rejectHealthWritesForLocalFirstEarly` ready, not armed — **reject-list**, method-gated, registered **before** the `/health` mounts (`backend/src/index.ts`)
- [x] `/v2` **fail-closed** (`=== 'true'`)
- [ ] `LOCAL_FIRST_API_ENABLED` moved out of `[vars]` into secrets in all three envs, and survives a `deploy:fleet`
- [x] `app.use('/v2/*', rateLimitDO('local-first:v2'))`
- [x] `health_sync_wake` on the validator **plus** the other wake sites **plus** `useNotificationHandler` routing
- [x] `flag.test.ts` Jest pin (`EXPO_PUBLIC_HEALTH_LOCAL_FIRST`) — brand default suppressed, explicit `=1` honoured
- [ ] Grep test: no Health path opens a `/v2` WebSocket / EventSource (code comments assert this; no dedicated grep test)
- [ ] Deploy from **main**: staging-only first; fleet only after proof; record Version ID
- [x] Do **not** truncate in He0

### He1 — Ledger core 🟢 as-built

**Exit:** Open / mutate / persist / reopen / merge deltas for **exactly 8** Wave A tables. No UI cutover.

- [x] `src/features/health/local/` registry + `createLedgerProjection`
- [x] `registryGuard` fails if key count ≠ 8, if a `unique()`-constrained Wave A table has no builder, or if an unconstrained one has a builder
- [x] Deterministic ids for **`habit_logs` + `health_goals` only**; counter-test proves two same-day `weight_entries` both survive
- [x] **O2 locked** in `ids.ts` — He1 decision, not He11
- [x] DEK/DB names distinct from House and Budget (`health.localFirst.dek.v1`, `symply-health-local-first.db`)
- [ ] Budget + House local suites still green; backend typecheck — **re-verify after each Health local change**
- [ ] TypeScript strict on new Health local files (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`) — **owed**

### He10 — Scale harness 📐 (before He3)

- [ ] Health corpus 5y / 10y in `packages/local-first/__tests__/scale/`
- [ ] Baseline markdown published with **fail/descope thresholds**
- [ ] Hermes 3–15× stated; quiet re-take owed

### He2 / He4 / He8 — Storage + sync + checkpoints 🟢 as-built

**These gate He5 and He3.** He2 → He4 → He8 is a chain, not a parallel batch.

- [x] `lf_rows` + Health DEK + Keychain reinstall sweep (Health DEK only, **negative test** proves it does not touch House/Budget keys)
- [x] Logout: delete `.db`, `-wal`, `-shm` explicitly — `teardown.test.ts` asserts non-existence
- [ ] **Nothing is written to the ledger while the device is locked** (DEK is `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; HK reads fail locked anyway). Locked HK wakes write only to the native staging table — **owed**
- [x] Mailbox client, HDK, orchestrator, checkpoints — **no SSE**
- [x] Push-wake **code** (A→B unit + route tests). Live two-device delivery is a **He12(partial)** Exit
- [x] Checkpoint publish + bootstrap in `sync/checkpoints.ts`
- [x] Settings copy: “your other device”, not invite-a-member (`HEALTH_ENROLMENT_COPY`)
- [x] App wiring (live plan **§5.1**): `ensureHealthLocalSession` at sign-in **and** post-hydrate, teardown at logout, refresh bridge started, `cryptoPolyfill` static import
- [ ] Test: with the session **not** opened, a `local*Api` read **throws** — **blocked on He3** (no `local*Api` yet)

### He5 — Personal household 🟢 client · 📐 Worker reject (needs He1 + He2 + He4)

- [x] Mint/reuse one household per user (`controlPlaneClient.ts`)
- [ ] Control-plane **rejects second `user_id`** — client throws `HealthSecondUserRefusedError`; **Worker route does not refuse**
- [x] Second-device enrolment (`simplehealth://lf-invite`) — branded **client-side** (Worker `qrPayload` is still `symply-budget://`; do not consume it)
- [ ] Account-switch wipe; privacy Maestro still green
- [ ] Exit is a **synthetic single-table fixture** through `mutateLocalHealthLedger` — Wave-A convergence through the storage modules is a **He12(partial)** Exit (He3 has not landed yet)

### He3 + He7-lite — Storage cutover **and** summaries 📐 (same merge)

**He3 Exit includes He7-lite. Do not land He3 alone.** Ship as one gate, land as **four merges**
behind the flag — **He3a** parity harness + Proxy + weight only · **He3b** the other seven tables ·
**He3c** summaries (parity-tested against the server's fixtures) · **He3d** reminders + widget slice.
No flag-1 device and no brand default until all four are green.

- [ ] Proxy or repository swap; outbox deleted
- [ ] **Data continuity shipped:** first-launch “entries before this update are not carried over” copy **and** the D1-sourced export-before-upgrade CSV (live plan §1.3a)
- [ ] Weight, water, meals, workouts/sleep, body, habits, goals airplane-mode (**8** D1 tables)
- [x] Notes stay MMKV (`health.notes.v1`) — already local; **not** a 9th ledger key (registry is 8)
- [x] `notifyHealthLedgerChanged` + `useHealthLedgerHydration` exist (`ledgerRefresh.ts`). **Not attached to screens.** He3 must wire them
- [ ] `useHealthLedgerHydration` **per screen**, guarded by `useIsFocused` + `InteractionManager`; table→screen map is typed so a 9th table cannot compile without a mapping
- [ ] **Read windows preserved** (`local/windows.ts`) — a local method returning the full table where the remote returned a window (nutrition = 120d) is a **blocker**, not a perf nit
- [x] `summaries.ts` authored (pure functions). **Not wired.** No callers, no parity tests. Home still uses server summaries
- [ ] On-device daily summary, streaks, trends **wired** (Home/Trends **not** dark), each parity-tested against the server fixtures
- [ ] Rolling-horizon reminders (≤56 / 64 pending; one-shots each consume a slot); reschedule only on content-hash change or ≥6 h
- [ ] Widget: allowlist; weight default off; **cycle / injury / vitality never written into the slice at all**; `.privacySensitive()`; App Group wipe. **File-protection class per Q3a** — complete protection and a lock-screen glance are mutually exclusive
- [ ] TypeScript strict on changed Health local + storage files
- [ ] Screens unchanged

### He6 — Blobs 📐 **unblocked** (House H6 shipped)

- [x] House H6 DoD met — `0157_lf_blobs.sql` on `main`; `src/features/house/local/blobs/`
- [ ] Health blob client — **not started**
- [ ] Body photos still Wave D; Worker 100 MiB cap (Free/Pro) — mailbox-sized PUT first
- [ ] R2 multipart **per-part** is the same Worker body cap; Wave D large photos = **presigned client PUT**
- [x] Never `0156_lf_blobs.sql`

### He7 remainder / He9 / He11 / He12 📐

- [ ] BYOK coach (Wave D)
- [ ] Backup/restore with Health redaction
- [ ] HealthKit ingest as ops (Q2 types locked; persist anchors; pre-JS queue; **register observers at launch**; **Swift-owned** observer completion after native staging write + anchored fetch, every error branch; JS drain must not own the handler)
- [ ] Wave C: cycle, vitality, injuries, fridge, foods
- [ ] **He12(partial):** two-device E2E, internal flag-on, brand default **off**. **Not** store default-on.
- [ ] **He12 (full):** Q1 + widget freeze + truncate + **post-truncate two-device E2E** + HBNR legal copy (live Appendix C) + brand-default-on. Worker Version ID already recorded before He12(partial).

---

## 6. Data And Migration Plan

| Item | Plan |
|------|------|
| Schema (control plane) | Reuse `0152`–`0155`. **`0156` = device composite PK (exists).** Blobs: **`0157_lf_blobs.sql` shipped with House H6.** Health client is He6 |
| Health D1 `0119`+ | Truncate **exactly the 8 Wave A tables** (`weight_entries`, `water_entries`, `nutrition_entries`, `health_entries`, `body_measurements`, `user_habits`, `habit_logs`, `health_goals`) **only in He12 (full)**: after **He12(partial)** E2E is green, **after Q1**, **after the flag-0 cohort is proven empty**, snapshot first, **widget freeze first**. ⚠️ **Wave C is NOT truncated** — it has no ledger until He11b, so truncating “Tier A” literally destroys live cycle / men’s-health / injury data |
| Snapshot mechanism | `wrangler d1 export <db> --remote --output=…` → `wrangler r2 object put`. A running export **blocks other DB requests**. Also record the **D1 Time Travel** bookmark (`wrangler d1 time-travel info`) — restore is possible within **30 days** even without the dump |
| Backfill | None — **and flag-1 devices therefore start with an empty ledger.** See live plan §1.3a: this is the product fact, not just a technical note |
| Outbox | Delete with He3 — not migrated into the op log |
| `water_entries.source` | **Absent.** HK water out of Wave B until a new column is claimed on `main` |
| Remote migration | staging + production, all fleet brands if new `lf_*` DDL |
| Rollback | See live plan §14.1. Truncate without snapshot is irreversible. Flag-0 after truncate does **not** restore D1 |

---

## 7. QA Plan

| Layer | Command / check |
|-------|-----------------|
| Brand | `npm run validate:brand` |
| Health unit | `npx jest src/features/health` |
| New local | `npx jest src/features/health/local` |
| Oracles | `npx jest src/features/budget/local` · `src/features/house/local` |
| Package | `cd packages/local-first && npx vitest run` |
| BE | `cd backend && npm run typecheck` + health + local-first-api-gate + **410 matrix** |
| Privacy E2E | `e2e/maestro/health/privacy-cross-user-leak.yaml` |
| Widget | freeze/dark after truncate; **no cycle / injury / vitality** in App Group |
| AI-off / HealthKit-off | manual + existing area tests |
| Two-device | He12(partial) then He12 full — port of Budget MM suite (same user) |
| Analytics | brand-tagged; **no** weight/meals/cycle/notes — **enforced by a denylist test** (live plan Appendix C.1), not by intent. Pending-notification count via `Notifications.getAllScheduledNotificationsAsync()` |
| Named tests | One file per new surface — live plan **§12.1**. Security-critical: Keychain reinstall sweep, WAL/SHM teardown, widget allowlist |

---

## 8. Deployment Plan

| Change type | Required action |
|-------------|-----------------|
| Frontend JS | EAS update Health profile |
| Native / HealthKit / widget | EAS build Health |
| Shared Worker | Staging-only Health (and Kaizen if gate changed) **first**; live `/v2` proof; **then** `cd backend && npm run deploy:fleet` from **main**. Fleet has no staging→production pause. |
| Health-only Worker | `npm run deploy:health:all` (comment/secret only) |
| D1 schema | Both envs; all brands if shared `lf_*` |
| Lab wipe | **He12 (full) only:** after He12(partial) E2E is green, **after Q1**, **after the flag-0 cohort is proven empty (§14 step 10b)**, **after widget freeze**. “While remaining flag-0 clients exist” was a mis-port from House and is a **rejected** order |
| Kill switch | **1.** EAS Update `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0` **first** — it is the only step that changes what a client does; a correctly-built flag-1 client writes to the ledger and never calls `/health`, so un-arming the 410 does nothing for it. **2.** Then revert the 410 + `deploy:fleet` (~10 min) — that serves the newly-downgraded clients and un-blocks any Proxy fall-through. **3.** Optional `LOCAL_FIRST_API_ENABLED=false`. There is **no sub-60s kill** (p50 hours, p95 days) |

Failed staging `/v2` proof: **do not** run `deploy:fleet`. Revert, staging-only, re-prove.

---

## 9. Open Gaps

| # | Gap | Severity | Owner | Status |
|---|-----|----------|-------|--------|
| G1 | Q1 wipe countersign | high | Product | **open — blocks truncate** |
| G2 | He0 live `/v2` proof + stale comments | high | BE | **open** — code in tree; 401-vs-404 + Version ID not recorded; `wrangler.health.toml:173` still stale |
| G3 | On-device summaries (He7-lite hard gate) | high | FE | **authored, unwired** — `summaries.ts` exists; no Proxy / no parity tests |
| G4 | Outbox replacement | high | FE | **open** — `HEALTH_PUSH_COLLECTIONS` + `writeThrough` still live |
| G5 | HealthKit type list (Q2) + water `source` | medium | Product | open |
| G6 | Two-device E2E (**He12(partial)**) | high | FE | open — D1 still exists; no Health MM suite |
| G7 | Health blob client | high | FE+BE | **unblocked** — House H6 ✅ (`0157`). Health client not started |
| G8 | Soft Transfer listed ≠ enabled | low | Product | not Wave A |
| G9 | DO hibernation smoke (House H0 debt) | medium | BE | **descoped from He0** — it gates enabling `EXPO_PUBLIC_HEALTH_P2P=1`, not Wave A. He0 owns the grep test instead (live plan §2 item 6) |
| G10 | Widget freeze-before-truncate | high | FE+BE | **He12 (full)** — after He12(partial) |
| G11 | He12(partial) vs full brand-default | high | FE | **15-row dashboard.** Partial ≠ default-on |
| G12 | HBNR legal copy (live Appendix C / O6) | medium | Product/legal | **blocks He12 (full)** — not He12(partial) |
| G13 | **Data continuity** — flag-1 starts empty; post-truncate `readThrough` destroys the flag-0 MMKV mirror | **high** | Product + FE | open — needs first-launch copy + export-before-upgrade CSV (live plan §1.3a) |
| G14 | Push wake for a personal household | **high** | BE + FE | **as-built in code** (wake type + no `excludeUserId` + handler routed). Live A→B is He12(partial) |
| G15 | `/v2` fail-closed vs `[vars]` | **high** | BE | **partial** — `=== 'true'` landed; key **still in `[vars]`** so `deploy:fleet` re-arms from toml |
| G16 | **Q3a** — lock-screen glance vs complete file protection are mutually exclusive | **high** | Product | open — **blocks enabling the glance**, not He3a–c |
| G17 | **Q8** — archive keying with a `ThisDeviceOnly` DEK; lost phone = lost ledger | **high** | Product | open — **blocks He9** |
| G18 | **Q9** — Apple regulated-medical-device declaration (blocks **updates** from early 2027) + Play health declaration | medium | unowned | open — assign before He12 (full) |
| G19 | Fail-closed `/v2` blast radius | **high** | BE | **partial** — Budget now sets `LOCAL_FIRST_API_ENABLED` in toml; secrets-out-of-`[vars]` still open |
| G20 | §14 step 10b(iii) data source | **high** | BE | **partial** — `health_flag0_mutation` emits in tests. Staging positive control + 7-day window **not recorded** |
| G21 | Unclassified user-authored Health tables | **high** | FE+BE | **partial** — Wave A + tiers B/C/D/Off in `schema.ts`. He3a still owes remaining dispositions (live plan §1.5a) |
| G22 | **Brand default on when unset** | **high** | FE | **open** — `flag.ts` returns true for `symply-health` if `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` is unset. `eas.json` does not pin `=0`. Pin `=0` until He12 (full) |

---

## 10. Completion Checklist

- [x] Code only in Symply Ecosystem repo (`src/features/health/local/`, package, Worker gate).
- [x] Donor Swift repo untouched.
- [ ] Relevant tests/typecheck pass; Budget/House oracles green.
- [ ] Backend deployed staging and production from **main** if changed.
- [ ] D1 migrations both envs if schema changed.
- [ ] Privacy cross-user suite green.
- [ ] Docs/features index updated.
- [ ] No secrets printed or committed.
- [ ] Q1 closed before any D1 truncate; truncate only in **He12 (full)**, after **He12(partial)** E2E.
- [ ] He3 not merged without He7-lite.
- [x] No `0156_lf_blobs.sql` (House used `0157`).
- [x] Notes not added as a 9th ledger key unless product explicitly asks.
- [ ] Staging `/v2` proof before `deploy:fleet`.
- [ ] Brand default-on only at He12 (full), after **post-truncate** two-device E2E, never after He12(partial) alone.
- [ ] HBNR legal copy (live Appendix C **and C.1**) before He12 (full).
- [ ] Truncate touched **only the 8 Wave A tables** — Wave C untouched.
- [ ] Flag-0 cohort proven empty (all three numbers recorded) before truncate.
- [ ] Data-continuity copy + export-before-upgrade CSV shipped with He3.
- [x] Deterministic ids on `habit_logs` + `health_goals` only; two same-day weights both survive.
- [ ] Push wake proven A→B on one account, two devices.
- [ ] `/v2` fail-closed and the kill-switch flag survives a `deploy:fleet`.
- [ ] Q3a and Q8 answered before He7-lite / He9 respectively.
- [ ] Privacy copy says “the health logs in your encrypted ledger”, never “your health data”.
- [ ] Budget `/v2` proven **401, not 404**, after the fail-closed deploy; mailbox-sweep cron line still present in Budget **and** House logs.
- [ ] `health_flag0_mutation` counter emitting, with a staging positive control recorded, **before** the 7-day truncate window starts.
- [ ] `POST /v2/households/:id/sync-wake` carries a `sourceDeviceId` before `excludeUserId` is dropped; no-self-wake test green.
- [ ] Every user-authored Health table has a tier/wave disposition (live plan §1.5a).
