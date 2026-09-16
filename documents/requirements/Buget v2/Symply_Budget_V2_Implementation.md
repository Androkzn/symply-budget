# Symply Budget V2 — Implementation Plan

> Execution handoff from BRD/TRD v2.0. Does not redefine product scope.

| Field | Value |
|-------|-------|
| **Doc type** | Implementation plan |
| **Feature id** | `budget-v2-local-first` |
| **Owning app** | `simple-budget` / `symply-budget` |
| **Status** | ready |
| **Version** | v1.0 |
| **Created** | 2026-08-10 |
| **BRD** | [Symply_Budget_BRD_v2.0.md](./Symply_Budget_BRD_v2.0.md) |
| **TRD** | [Symply_Budget_TRD_v2.0.md](./Symply_Budget_TRD_v2.0.md) |
| **Pack index** | [README.md](./README.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/apps/symply-budget/README.md
3. documents/apps/symply-budget/BRD.md
4. documents/apps/symply-budget/TRD.md
5. documents/requirements/Buget v2/Symply_Budget_BRD_v2.0.md
6. documents/requirements/Buget v2/Symply_Budget_TRD_v2.0.md
7. This implementation plan

Rules:
- Greenfield: no D1→device migration.
- Keep existing Budget UI; swap data layer.
- Shared User stays; do not remove accounts.
- ZK mailbox is required (not pure P2P).
- Custom op log (not CR-SQLite).
- Do not fork Login/Widget/Watch.
- Verify with airplane-mode + unit tests; deploy control-plane changes staging+production when coding BE.
```

---

## 1. Readiness Gate

| Gate | Status | Notes |
|------|--------|-------|
| BRD v2.0 written | [x] | Canonical |
| TRD v2.0 written | [x] | Canonical |
| Greenfield confirmed | [x] | Testers only |
| UI freeze confirmed | [x] | Minimal chrome for sync/backup |
| Open HIGH blockers | [ ] | IdP vendor evidence before multi-member beta |
| Privacy claim wording | [ ] | Legal (Q-01) — not blocking Phase 0–1 |

---

## 2. Non-Goals

- Production migration from current D1 ledger
- Dual-write local + D1
- Visual redesign of Budget
- Master v9 no-account architecture
- Chat/rooms in Phase 0–4
- CR-SQLite as sync engine

---

## 3. Branching

| Branch | Purpose |
|--------|---------|
| `feat/local-first-core` | Shared package: crypto, store, oplog, sync stubs, tests |
| `feat/budget-v2-local-first` | Budget UI → local repos; control-plane V2 routes; flag off financial D1 |

Merge to `main` in vertical slices. Later: `feat/house-local-first-*`, `feat/health-local-first-*` reuse core only.

Tester reset: uninstall / clear app data / documented “Reset local household” action.

---

## 4. File Plan

| Area | Path | Change |
|------|------|--------|
| Shared core | `packages/local-first/` **or** `src/local-first/` | New: crypto, SQLCipher adapter, oplog, sync, control client |
| Budget local domain | `src/features/budget/local/` | Repositories, projectors, amortisation wiring |
| API boundary | `src/api/budget.ts` | Facade → local repos for V2 builds (keep types stable where possible) |
| UI | `src/screens/budget/**` | Swap hooks/data sources; add sync/backup status chrome |
| Auth bridge | `src/stores/authStore.ts`, Shared User | Offline unlock after first sign-in |
| Control plane | `backend/src/routes/` (new `v2` household/device/mailbox) | Metadata + mailbox + signaling |
| DO | `backend/src/` household Durable Object | Membership/device/key-epoch/signaling |
| Financial BE | `backend/src/routes/budget.ts`, `budget-service.ts` | Unused for V2 flag; cleanup later |
| Soft Transfer | `backend/src/services/soft-transfer/`, `src/smart-engine/` | Local `budget.summary.v1` via `client_payload` + device JSON share |
| Docs | `documents/apps/symply-budget/*`, RELATIONSHIPS if packages change | Keep current |
| Brand | `brands/symply-budget/` | Feature flag for local-first if needed |

**Library bake-off — Phase 0 outcomes (2026-08-10):**

| Concern | Choice | Notes |
|---------|--------|-------|
| Crypto | `@noble/ciphers` + `@noble/curves` + `@noble/hashes` | Pure TS; Argon2id / Ed25519 / X25519 / AES-GCM in `@symply/local-first` |
| Local DB (Phase 0) | `MemoryLocalFirstStore` | API-compatible; SQLCipher JSI binding deferred to Phase 1 |
| SQLCipher (next) | Expo-compatible JSI (op-sqlite or equivalent) | Migration SQL stubbed as `SQLITE_MIGRATION_V1` |
| WebRTC (later) | `react-native-webrtc` | Config plugin already in root app deps; not wired yet |

Package: `packages/local-first` (`@symply/local-first`). Tests: `npm run test:local-first`.

---

## 5. Phases

### Phase 0 — Foundations (docs done → core skeleton)

**Exit:** package exists with encrypt-open-close DB, append/verify op, projection stub, unit tests; no Budget UI cutover.

**Status (2026-08-10):** Complete on branch `feat/local-first-core`.

Tasks:

1. [x] Create `feat/local-first-core`.
2. [x] Scaffold `@symply/local-first` + `npm run test:local-first`.
3. [x] Key wrap (PIN / HDK) + memory store open/close (SQLCipher adapter next).
4. [x] Op append / verify / idempotent apply + projection cursor stub.
5. [x] Adapter interfaces: `SecureKeyStore`, `FileStore`, `Clock`.

### Phase 1 — Single-device offline Budget

**Exit:** Tester airplane-mode: create household locally, CRUD expenses/categories/budgets, view loan amortisation, CSV export; **zero financial rows written to D1**.

**Status (2026-08-10):** Complete on `feat/budget-v2-local-first` — all Budget financial domains offline; zero financial D1 writes.

- [x] Branch from `feat/local-first-core`
- [x] Flag: `EXPO_PUBLIC_BUDGET_LOCAL_FIRST` (+ Budget `__DEV__` default on)
- [x] `engine.ts` ledger fields (savings, registered, loans, renewals, wishes, mortgage)
- [x] `src/features/budget/local/` repos + projectors + `budgetApi` Proxy facade
- [x] Categories / expenses / items / goals / sub-budgets / overview / transfers (basic)
- [x] Session open after login + hydrate; householdStore short-circuit
- [x] Mortgage (`localMortgageApi` + projector + `localMortgageReconciliation` statement anchors; AI extract via BYOK ladder; renewal offers unsupported offline)
- [x] Savings / monthly payments (`localSavingsApi` + `localSavingsProjector` + `recurringScope` + `savingsLimits`)
- [x] Pension / registered accounts (`localRegisteredApi` + `localRegisteredProjector`; exposed via `localSavingsApi`)
- [x] Budget loans (`localBudgetLoansApi` + `@features/budget/loan-amortization`)
- [x] Budget renewals (`localBudgetRenewalsApi`)
- [x] Wishes (`localWishesApi` + `localWishMedia`)
- [x] API Proxies: `savingsApi`, `budgetLoansApi`, `wishesApi`, `budgetRenewalsApi` (+ `budgetApi`, `mortgageApi`)
- [x] CSV export (`budgetLedgerExport` — savings/recurring/goals/loans/registered/wishes sections)
- [x] Airplane-mode Maestro checklist run (LF-001…010; network block via `e2e-block-network`; backup / Soft Transfer / AI / mortgage / pension import)

**Remaining for GA (not Phase 1 exit blockers):**

- [x] Durable local ops journal — `SqliteLocalFirstStore` + `expo-sqlite` on device; `MemoryLocalFirstStore` in Jest; AEAD snapshot for projections/crypto (true SQLCipher page encryption follow-up)
- [x] Soft Transfer to House — Worker consent path with `client_payload` + `X-Budget-Local-First: 1` (`buildLocalBudgetSummaryV1` → `/smart-engine/export`); device JSON share remains via `shareLocalBudgetSummary`

### Phase 2 — Control-plane cutover

**Exit:** V2 household/device/signaling/mailbox endpoints live on Budget Worker staging+production; V2 clients do not call financial CRUD.

**Status (2026-08-10):** Implemented on `feat/budget-v2-local-first`.

- [x] `HouseholdCoordinatorDO` + Budget wrangler `v4` / `HOUSEHOLD_COORDINATOR` binding
- [x] D1 migration `0152_local_first_control_plane.sql` (lf_households/memberships/devices/mailbox)
- [x] `/v2/*` routes: households, devices, mailbox deposit/fetch/ack, TURN stub
- [x] Mailbox via `REPORTS_BUCKET` prefix `lf-mailbox/` + cron TTL sweep
- [x] `X-Budget-Local-First: 1` → 410 on financial `/budget` routes
- [x] Mobile `syncLocalHouseholdToControlPlane()` after local session open
- [x] Deploy + migrate Budget staging/production (`0152` + `deploy:budget:all`, 2026-08-10)

### Phase 3 — Multi-device sync

**Exit:** Two tester devices converge ops via P2P and via mailbox when one offline; sync status visible.

**Status (2026-08-10):** Implemented on `feat/budget-v2-local-first`.

- [x] Signaling WS on `HouseholdCoordinatorDO` (`/v2/households/:id/signaling`)
- [x] WebRTC DataChannel transport + app-layer `PeerSyncSession` (loopback tests; RN adapter)
- [x] Mailbox sync engine (`MailboxSyncEngine`) + HTTP control-plane client
- [x] Invites: create / claim / approve + short code + OOB phrases + QR payload
- [x] Persist device identity + HDK in encrypted snapshot (required for multi-device)
- [x] Sync status banner + Settings “Sync now” / “Create invite”
- [x] Convergence tests in `@symply/local-first`
- [x] Opaque push wake (`budget_sync_wake` via `/v2/push/register` + mailbox deposit fan-out; requires EAS APNs/FCM credentials for delivery)
- [x] Deploy + migrate `0153` Budget staging/production (`deploy:budget:all`, 2026-08-10)
- [x] Deploy + migrate `0154_lf_device_push_tokens` Budget staging/production (`deploy:budget:all`, 2026-08-10). APNs `.p8` + FCM must be on EAS for Expo delivery (see `documents/ecosystem/PROVISIONING.md` §3.1 / §7).

### Phase 3b — Multi-MEMBER sync (projection + merge)

**Exit:** A change one household member makes appears on the other member's
screen, in both directions, and two concurrent edits to the same row resolve to
the same value on both devices.

**Status (2026-08-10):** Implemented on `feat/budget-v2-local-first`.

Phase 3 converged the **op log** but stopped there. `OpLog` accepted a
`ProjectionHandler` and the engine passed none, and `noteRemoteOpsApplied` only
appended ops to `ledger.ops` — so a peer's op was verified, decrypted, stored,
and then never applied to the tables the screens read. Op-level convergence
tests passed while nothing a member did was ever visible to anyone else. There
was also no conflict-resolution code of any kind, despite TRD §8.4.

- [x] `src/features/budget/local/projection.ts` — delta-state projection:
      `mutateLocalLedger` snapshots the tables, runs the mutator, diffs, and
      seals the **changed rows, field by field** into the op payload. Op
      *intent* replay was not viable: ~70 call sites pass request-shaped
      payloads (`GOAL_SET` sends `{planned_budget, notes}`,
      `TRANSFER_CREATE` sends a differently-named request record) and bulk ops
      touch many rows under one `entityId`.
- [x] Merge rules (TRD §8.4): concurrent creates both kept; per-field LWW by
      HLC with full-author-id tie-break; tombstone absorbing on delete-vs-edit.
- [x] Conflict log surfaced (BR-044) — `budget-sync-conflicts` on **Settings →
      Device sync**, persisted in the ledger, bounded to 50 entries.
      **Closed (2026-08-16):** the 2026-08-11 caveat was that the only surface
      was the `__DEV__`-only sync banner, so a member on a Release build whose
      edit an auto-merge discarded was never told. The banner is now deleted and
      the discard has the plain-language home this note called for — "An edit
      from your household was replaced by a newer change made on this device",
      with a **Got it** (`budget-sync-conflicts-ack`) that clears the log via
      `clearLocalConflicts()`. Acknowledging matters for the test too:
      BUDGET-MM-010 would otherwise pass forever on a count left behind by an
      earlier run, since the ledger survives across runs on both simulators.
- [x] `ledgerRefresh.ts` — a merged peer op bumps each feature store's
      `dataRevision` and invalidates React Query, so the screen repaints
      instead of waiting for a remount.
- [x] Enrolment completed end-to-end: `joinLocalFirstHousehold()` +
      Settings **Join household** (invitee) and **Join requests** → OOB word
      (owner). `claimLocalFirstInvite`/`approveLocalFirstInvite` existed but
      were not reachable from any screen, so an invite could be created and
      never accepted.
- [x] `adoptJoinedHousehold()` — a joining device rebinds its ledger to the
      shared household id. Without it the device kept polling its own empty
      household's mailbox and `localBudgetApi`'s `household_id` filters hid
      every merged row.
- [x] Writes pause between claim and key delivery
      (`BudgetLocalEnrolmentPendingError`) — ops sealed under the pre-join key
      would be unreadable by peers and by the device itself after the real HDK
      installs.
- [x] Account-switch fix: the ledger snapshot is device-scoped, so signing in
      as a different user reopened the previous person's ledger. A member id
      mismatch now resets local persistence.
- [x] Tests: `src/features/budget/local/__tests__/multiMemberSync.test.ts`
      (both directions, per-field concurrency, same-field determinism,
      delete-vs-edit, concurrent creates, idempotency) + the two-simulator
      Maestro run below.

**Known limitations (deliberate, not defects):**

1. **Conflicts are flagged on one replica.** A discarded write is detectable
   without ambiguity only where an incoming op loses to a newer local stamp.
   The replica whose value was superseded adopts the winner silently. Flagging
   both sides needs real causality (populated op `parents`), which V2 does not
   write yet — `parents` is always `[]`.
2. **Joining replaces the local ledger.** The engine holds one household
   snapshot, so merging a joiner's private ledger into the shared one has no
   defined behaviour in the BRD/TRD. The UI confirms the replacement first.
   BR-016 (multi-household membership) needs per-household local storage.
3. **`captureLedgerSnapshot` serializes the ledger on every write.** Same order
   of cost as the `persist()` that already runs on every write, so it roughly
   doubles per-write work rather than adding a new class of it.

### Phase 4 — Resilience

**Exit:** Verified encrypted backup restore; revoke device re-keys; peer bootstrap of replacement device.

**Status (2026-08-10):** Complete on `feat/budget-v2-local-first`.

Tasks:

1. [x] Backup archive format + recovery phrase (`@symply/local-first` BIP39 + Argon2id AEAD; Settings “Encrypted backup”)
2. [x] Verified restore dry-run (`verifyBackupArchive` / `verifyBudgetBackup` + projection restore)
3. [x] Revoke + epoch rotation (control-plane `revokeLocalFirstDevice` + local HDK re-key; peer re-bootstrap still via invite/HDK deposit)
4. [x] Merge-on-restore (live wins) — restore applies projection; live device identity/crypto kept

### Phase 5 — Everyday value

**Exit:** Local reminders; BYOK receipt/doc draft→confirm; Soft Transfer summary export from local projections.

**Status (2026-08-10):** Complete for V2 exit — reminders, Soft Transfer from local, widget, AI import ladder (text/BYOK → confirm). No native OCR library; receipt photos need BYOK or pasted/text-file input.

Tasks:

1. [x] Reminder classes + local notifications (`budgetLocalReminders` / `syncBudgetLocalReminders` — recurring due day, mortgage maturity, budget renewal; refreshed on session open + sync).
2. [x] AI import ladder (local text parse → BYOK refine → confirm). `localImportLadder` + `localByokClient` (allowlisted HTTPS, Keychain keys); covers `scanReceipt`, `aiDetectItems*`, savings `importAnalyze*`, mortgage `extractStatement`, registered extract + `commitRegisteredImport`. Confirm via existing review screens. Limitations: no native OCR — photos/PDFs need BYOK; heuristic text parse quality varies.
3. [x] Rebuild `budget.summary.v1` export from local (`buildLocalBudgetSummaryV1` → Soft Transfer `client_payload` + `X-Budget-Local-First: 1`; `shareLocalBudgetSummary` for device JSON share). Settings → Share a summary opens Soft Transfer export wizard.
4. [x] Widget snapshot from local overview (`budgetApi.getMonthlyOverview` → `localBudgetApi`; `useBudgetSnapshotPublisher` unchanged).

(Domain CRUD — savings, registered, loans, renewals, wishes — completed in Phase 1.)

### Later

- Household text rooms
- Paid AI no-store relay
- Desktop peer
- House/Health adopt `local-first` core
- Delete unused financial D1 tables after soak

---

## 6. Verification Matrix

| Phase | Verify |
|-------|--------|
| 0 | Unit tests crypto/oplog; no secrets in logs |
| 1 | Airplane-mode checklist; `npm test` touched; brand validate if flags change |
| 2 | Staging+prod deploy; metadata-only D1 assert; mailbox TTL |
| 3 | Two-sim sync; mailbox path; invite claim atomicity |
| 4 | Backup restore round-trip; revoke cannot read new ops |
| 5 | AI confirm gate; Soft Transfer consent; AI-off still works |

Deploy rule: control-plane Worker/D1/R2 changes → staging **and** production. Load secrets via `eval "$(./scripts/secrets/export-env.sh)"`.

---

## 7. Rollback

| Situation | Action |
|-----------|--------|
| Phase 1 flag broken | Disable local-first flag; testers return to D1 app (pre-release OK) |
| Phase 2 BE issue | Keep clients on Phase 1 local-only; fix DO/mailbox |
| Crypto bug | Wipe tester DBs; rotate builds; no prod users |

---

## 8. Open Engineering Spikes

| Spike | When | Outcome needed |
|-------|------|----------------|
| SQLCipher + Expo binding | P0 | Chosen library + config plugin notes |
| WebRTC in Expo/EAS | P0–P2 | Build profile works on iOS+Android |
| IdP vs current JWT | Before P3 multi-member | Bridge plan + timeline |
| Universal Links Budget host | P3 | Association files in CI |

---

## 9. Acceptance

- [x] Phases match BRD release themes.
- [x] Branches and file plan named.
- [x] Greenfield / UI freeze / ZK relay / op log restated.
- [x] Phase 0 code on `feat/local-first-core` (`@symply/local-first`, 6 vitest tests).
- [x] Spike outcomes recorded here.
- [x] Phase 1 offline Budget domains complete.
