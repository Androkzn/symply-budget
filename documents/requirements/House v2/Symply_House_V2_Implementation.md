# Symply House V2 — Implementation Plan

> Execution handoff from BRD/TRD v2.0. Does not redefine product scope. Live design narrative: [house-local-first-implementation-plan.md](./house-local-first-implementation-plan.md).

| Field | Value |
|-------|-------|
| **Doc type** | Implementation plan (as-built record) |
| **Feature id** | `house-v2-local-first` |
| **Owning app** | `simple-house` / `symply-house` |
| **Status** | in-progress — Wave A as-built; Waves B/C open |
| **Version** | v1.0 |
| **Created** | 2026-08-13 |
| **BRD** | [Symply_House_BRD_v2.0.md](./Symply_House_BRD_v2.0.md) |
| **TRD** | [Symply_House_TRD_v2.0.md](./Symply_House_TRD_v2.0.md) |
| **Pack index** | [README.md](./README.md) |
| **Pattern** | [Symply_Budget_V2_Implementation.md](../Buget%20v2/Symply_Budget_V2_Implementation.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/BRANCHING.md
3. documents/apps/symply-house/README.md
4. documents/requirements/House v2/README.md
5. documents/requirements/House v2/Symply_House_BRD_v2.0.md
6. documents/requirements/House v2/Symply_House_TRD_v2.0.md
7. documents/requirements/House v2/house-local-first-implementation-plan.md
8. This implementation plan

Rules:
- Greenfield: no D1→device migration; wipe authorized.
- Keep existing House UI; Proxy data layer (zero screen edits for Wave A).
- Shared User stays; do not remove accounts.
- ZK mailbox is required (WebRTC off unless EXPO_PUBLIC_HOUSE_P2P=1).
- Reuse @symply/local-first; do not fork projection.ts.
- P3 plaintext projection to the server is banned.
- Do not fork Login/Widget/Watch.
- Shared Worker / migrations land on main. App client on house-v2.
- Never deploy:fleet from an <app>-v2 clone.
- Verify with unit tests + (H12) airplane-mode / two-device E2E; deploy control-plane changes staging+production from the main checkout.
```

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| BRD v2.0 written | [x] | This pack, 2026-08-13 |
| TRD v2.0 written | [x] | This pack, 2026-08-13 |
| Budget two-device suite green | [x] | `20260812-195127` — H0 precondition |
| Greenfield / wipe authorized | [x] | Q1 closed 2026-08-12 |
| UI freeze confirmed | [x] | H3: `git diff --stat src/screens` empty |
| Open HIGH blockers | [ ] | H6 blobs, H7 remainder, H12 E2E |
| Privacy claim wording | [ ] | Legal (Q-01) — not blocking Wave A internal |

---

## 2. Non-Goals

- Production migration from current D1 home ledger
- Dual-write local + D1
- Visual redesign of House
- P3 consented plaintext projection to the server
- E2EE for reports/Lambda/chat in Wave A
- Local-first for Kaizen / Health / Language
- CR-SQLite as sync engine
- Opening a parallel `feat/house-v2-*` stack (use `house-v2`; shared code on `main`)

---

## 3. Branching

| Branch | Purpose |
|--------|---------|
| `main` | Shared Worker, `packages/local-first`, migrations. H0 merged here (`03fedf43`). **Only deploy source.** |
| `house-v2` | Long-running House client programme. One clone. Never dies. |
| `feat/house-v2-local-first` | Historical / stale naming — do not reopen a parallel feat stack ([BRANCHING.md](../../ecosystem/BRANCHING.md)) |

Daily on the House clone: `git merge main` → work → `git push origin house-v2`. Land with `gh pr merge --merge`.

Tester reset: uninstall / clear app data / documented first-run note after lab truncate.

---

## 4. File Plan (as-built Wave A)

| Area | Path | Change |
|------|------|--------|
| Shared core | `packages/local-first/` | Projection promoted (`createLedgerProjection`); sync/mailbox/checkpoints reused |
| House local domain | `src/features/house/local/` | Registry, engine (N properties), repos, Proxy, sync client, reminders, widget |
| API boundary | `src/api/{tasks,household-spaces,appliances,checklists,seasonal-checklists,home-features,garbage-collection,settings,task-drafts,households}.ts` | Proxy → local*Api |
| UI | `src/screens/**` | **No Wave A edits** |
| Auth bridge | `src/stores/authStore.ts`, DataContext | `ensureHouseLocalSession` / teardown |
| Control plane | `backend/src/config/local-first-api.ts`, `routes/local-first-v2.ts`, wrangler House `v4` | `localFirstApi` gate; mailbox authz |
| Financial / Budget BE | unchanged | Budget gate stays `requireBudgetApi` |
| Docs | this pack + House features index | |

**Library choices (inherited from Budget Phase 0):** `@noble/ciphers` + `@noble/curves` + `@noble/hashes`; expo-sqlite + per-row AEAD; mailbox default, WebRTC not wired.

---

## 5. Stages

### H0 — Enablement ✅ SHIPPED 2026-08-12

**Exit:** House Worker serves `/v2`; Kaizen/Health 404 with Budget’s envelope; DO bound; mailbox GET+deposit ownership closed.

- [x] `localFirstApi` + `requireLocalFirstApi()` + `isLocalFirstApiEnabled()`
- [x] `HOUSEHOLD_COORDINATOR` on House wrangler `v4` (top-level + staging + production)
- [x] Cron sweeps on `isLocalFirstApiEnabled`
- [x] `house_sync_wake` allowed type
- [x] Mailbox GET and deposit `deviceBelongsToUser`
- [x] Merged to `main` (`03fedf43`); `deploy:fleet`; H1 re-deploy production IDs recorded in the live plan
- [x] Kaizen/Health `v4` tag **retained** (cannot remove an applied tag; unbound, `localFirstApi: false`)
- [ ] Lab truncation §2.1 (snapshot D1 → truncate Tier A → wipe sims) — **before brand-default-on**
- [ ] First-run tester note
- [ ] DO hibernation/signaling smoke

### H1 — Ledger core ✅ SHIPPED 2026-08-12

**Exit:** Device can open, mutate, persist, reopen, merge peer deltas for 21 Wave A tables. No UI cutover.

- [x] Promote projection into `@symply/local-first` (Budget 196 + package tests green)
- [x] House registry, deterministic ids, engine, session, store, flag
- [x] 68 House tests at ship (later grew with H3/H5)

### H10 — Scale harness ✅ SHIPPED 2026-08-13 (ran before H3)

**Exit:** House corpus + baseline published so later perf claims are falsifiable.

- [x] Corpus inside every envelope (14,557 rows @5y/2a; 28,867 @10y)
- [x] Four House phases; baseline markdown
- [x] Q12/N5: LWW map 1.9× row data — stamp interning in
- [ ] Quiet-machine re-take (`gate.usable: false` — loadavg 4.05)
- [ ] On-device Hermes anchor

### H2 — Row storage ✅ SHIPPED 2026-08-13 (with H1)

- [x] `symply-house-local-first.db` + `house.localFirst.dek.v1` distinct from Budget

### H4 — Sync client ✅ SHIPPED 2026-08-13 (invite UI owed)

- [x] Control-plane client, orchestrator, HDK transfer, checkpoints, push wake, ensureSession
- [x] `syncErrors` promoted into the package; Budget re-exports
- [x] Mailbox-only (no WebRTC port)
- [x] Targeted query invalidation (`ledgerRefresh`)
- [ ] §5.1 invite **screen** — handshake reachable via `localHouseholdsApi`; management screen still legacy

### H8 — Checkpoints ✅ SHIPPED 2026-08-13 (with H4)

Landed early: H10 measured 452 ops/deposit → 10-year catch-up is 98 deposits without checkpoints.

### H5 — Multi-property session ✅ SHIPPED 2026-08-13

- [x] `Map<householdId, EngineState>` + `activeHouseholdId`
- [x] Device-scoped DEK/store vs property-scoped HDK/OpLog/ledger
- [x] Lazy hydration **1.02×** for three properties (bound was 1.3×)
- [x] Per-household single-flight sync; wake routed by `householdId`
- [x] Composite `lf_devices` PK (Budget re-home is wrong for House)
- [x] OpLog projection handler per-property (design miss: otherwise background ops merge into the active ledger)
- [ ] Live 403 isolation (property A 403 → B still syncs) — H12

### H3 — API facades + Wave A cutover ✅ SHIPPED 2026-08-13

- [x] 10 modules / ~117 methods behind Proxy; **zero screen files changed**
- [x] `apiParity.test.ts` both directions; remote-by-design methods need a written reason
- [x] Ported recurrence (UTC), task workflow, checklist instances, seasonal generation, garbage expansion
- [x] Four bugs found by porting (timezone recurrence, per-viewer fields, S3b-on-read, remote seasonal progress shape)
- [x] Jest: local-first opt-in; unsupported method returns a rejected promise
- [ ] H10 re-run on the real write path
- [ ] Airplane-mode cold install on a device (H12)

### H7-lite — Reminders + widget ✅ SHIPPED 2026-08-13 (live, not dark)

- [x] Rolling-horizon reminders: 30 scheduled on 10-year corpus vs 56-slot budget (iOS cap 64)
- [x] 8-field widget projection; wipe-on-logout in teardown
- [ ] Checklist due dates dark (`notificationRouting.ts` has no `checklist_due`) — copy or route
- [ ] Watch complications via WatchConnectivity (not App Group)

### H6 — Encrypted blob channel 📐 OPEN

House-only. 25 blob-bearing tables. Worker-proxied PUT, `lf-blob/`, `0156` on every fleet D1, nonce reuse on retry. DoD in live plan §8.

### H7 remainder 📐 OPEN

BYOK Housekeeper ladder, cron guards for local-first households, P4 copy for vision features, Stage A parse + allowlist egress.

### H9 — Backup / restore / export 📐 OPEN

Port Budget backup wrappers; per-property archives; blob manifests default; Soft Transfer Q16.

### H11 — Wave B + Wave C 📐 OPEN

Mechanical after Wave A + H6. Sequence B1→B4 then C1–C4. Per sub-wave: registry + local api + Proxy + parity test + H10 re-run.

### H12 — Two-device E2E + fleet 📐 OPEN

Port Budget 18-flow Maestro suite; add property switch, attachment round trip, reminder firing, widget after peer write. Same-commit Worker. Then flip House brand default on.

House suite grew 68 → 101 → **413** tests through H3/H5/H7-lite. Full mobile 9,101 → **9,422** with the same 5 pre-existing failures.

---

## 6. Verification Matrix

| Stage | Verify |
|-------|--------|
| H0 | Kaizen/Health `/v2` 404 body; House/Budget route exists; mailbox 403 on foreign deviceId; fleet deploy |
| H1 | Budget local 196 still green after package edits; House registry + session tests |
| H10 | Corpus guards; baseline published; quiet re-take + Hermes anchor before perf ship claims |
| H3 | `apiParity.test.ts`; recurrence fixtures vs server; `git diff --stat src/screens` empty |
| H5 | 3-property lazy hydrate ≤ 1.3×; HDK isolation; per-household single-flight |
| H7-lite | Scheduled count under 64; widget wipe-on-logout |
| H6 | Two-device sha256; tombstone → sweep; nonce reuse on retry |
| H12 | Two-device Maestro vs same-commit Worker; airplane-mode cold install |

Deploy rule: control-plane Worker/D1/R2 changes → staging **and** production from the **`main` checkout**. Load secrets via `eval "$(./scripts/secrets/export-env.sh)"`.

---

## 7. Data And Migration Plan

| Item | Plan |
|------|------|
| Schema change (control plane) | `0152`–`0155` already on House D1 via shared dir. `0156_lf_blobs.sql` at H6 — migrate **every** fleet brand, both envs |
| Backfill | None — greenfield |
| Lab truncate | Snapshot House D1 to R2, then truncate Tier A **while client flag is still `0`** |
| Rollback | Kill: Worker `LOCAL_FIRST_API_ENABLED=false` then EAS Update flag `0`. DO tag `v4` cannot be removed. Truncate undo = R2 snapshot only |

---

## 8. QA Plan

| Layer | Command / check |
|-------|-----------------|
| Brand validation | `npm run validate:brand` |
| House local | `npx jest src/features/house/local` |
| Budget oracle | `npx jest src/features/budget/local` |
| Package | `cd packages/local-first && npx vitest run` |
| BE typecheck | `cd backend && npm run typecheck` |
| BE local-first | gate + mailbox tests |
| E2E | H12 House port of `BUDGET_MULTI_MEMBER_SYNC_E2E.md` |
| AI-off | Core Wave A CRUD with no BYOK key |

---

## 9. Deployment Plan

| Change type | Required action |
|-------------|-----------------|
| Frontend JS only | EAS update House profile |
| Native / widget entitlements | EAS build House |
| Worker behavior (shared) | `cd backend && npm run deploy:fleet` from **main** |
| Worker behavior (House-only) | `npm run deploy:house:all` |
| D1 schema | Staging and production, **all fleet brands** |
| Lab wipe | After Worker deploy, while `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0` |

---

## 10. Open Gaps

| # | Gap | Severity | Owner | Status |
|---|-----|----------|-------|--------|
| G1 | H6 encrypted blob channel | high | FE+BE | open |
| G2 | H7 BYOK Housekeeper + cron guards | high | FE+BE | open |
| G3 | H9 backup/restore/export | medium | FE | open |
| G4 | Invite screen collapse | medium | FE | open |
| G5 | H12 two-device E2E | high | FE | open |
| G6 | H10 quiet re-take + Hermes | medium | Eng | open |
| G7 | Lab truncation + first-run note | medium | Ops | open |
| G8 | Q16 Soft Transfer | medium | Product | open |
| G9 | Remote seasonal progress shape | low | FE | pre-existing, not local-first |

---

## 11. What Budget already paid for (do not rebuild)

Reuse these as-is; House only adds descriptors, facades, and the five House-only subsystems.

| Artifact | Budget stage | House uses |
|----------|--------------|------------|
| `@symply/local-first` crypto, oplog, VV, mailbox, checkpoints | 0–5 / Stages 1–5 | verbatim |
| `createLedgerProjection` | House H1 promote | both brands |
| Proxy facade pattern | Budget Phase 1 | H3 |
| Kill switch + same-commit E2E rule | Budget §1.6 / §3.5.0 | H0 / H12 |
| D-20 restore + backup archive v2 | Budget Stage 4 | H9 |
| Two-device Maestro harness | Budget MM suite | H12 port |

House-only (cannot inherit): multi-property session, blob channel, server-compute displacement, widget/watch slice, 21→66 table volume, 58-col task LWW.

---

## 12. Completion Checklist

- [x] Wave A code in Symply Ecosystem repo only (`src/features/house/local/`, package, Worker gate).
- [x] House local + Budget oracle + package tests green at last recorded ship.
- [x] H0/H1 Worker deployed staging and production from main.
- [ ] D1 `0156` applied to both envs × all brands (H6).
- [x] This pack indexed from House features README and requirements README.
- [ ] Two-device E2E green; brand default on.
- [ ] No secrets printed or committed.
