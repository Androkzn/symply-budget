# Symply House — Technical Requirements Document

**Encrypted local-first sync, Cloudflare metadata control plane, House-domain ledger**

| Field | Value |
|-------|-------|
| **Document type** | Technical Requirements Document (TRD) |
| **Version** | 2.0 — Canonical |
| **Date** | 2026-08-13 |
| **Status** | Approved for implementation planning (Wave A as-built) |
| **Companion BRD** | [Symply_House_BRD_v2.0.md](./Symply_House_BRD_v2.0.md) |
| **Implementation** | [Symply_House_V2_Implementation.md](./Symply_House_V2_Implementation.md) |
| **Live plan** | [house-local-first-implementation-plan.md](./house-local-first-implementation-plan.md) |
| **Inherited TRD** | [Symply_Budget_TRD_v2.0.md](../Buget%20v2/Symply_Budget_TRD_v2.0.md) |
| **Platforms** | React Native (Expo) iOS & Android; shared TypeScript core |

> **Scope.** Technical architecture that satisfies House BRD v2.0. `HR-*` identifiers refer to that BRD. Engine contracts that Budget already locked are **inherited by reference** — this document states House deltas, not a second copy of the op-log spec.

---

## 1. Purpose and Technical Answers

| Question | Technical answer |
|----------|------------------|
| Fully offline? | Client is a complete Wave A app over encrypted SQLite. Reads, writes, recurrence, checklist materialization, garbage expansion run locally. Network for enrolment, invites, sync, Tier B, and (later) blob fetch. |
| Offline unlock? | Local unlock wraps DEK with PIN/biometric-gated Keychain/Keystore. No server on launch after provisioning. |
| No home-ops DB? | BE schema is not SoT for Tier A. Peers exchange encrypted ops via ZK mailbox. Checkpoints and blobs are opaque R2. |
| Pure P2P? | Insufficient on mobile → **transit-only ZK relay**. WebRTC gated off (`EXPO_PUBLIC_HOUSE_P2P`). |
| Multi-property? | One SQLite file, one DEK, `Map<householdId, EngineState>`. HDK / OpLog / ledger per property. `lf_devices` PK `(household_id, id)`. |

---

## 2. Architecture Principles

| # | Principle | Consequence |
|---|-----------|-------------|
| P1 | Device is source of truth for Tier A | Screens render from local state via Proxy. |
| P2 | Server incapable, not merely unwilling | No server path can decrypt household content. |
| P3 | Changes are facts | Append-only signed operation log. |
| P4 | Convergence is testable | Same ops ⇒ byte-identical logical state. |
| P5 | Recovery is first-class | Company cannot restore content keys. |
| P6 | One domain core, many shells | `@symply/local-first`; House and Budget pass a `LedgerSchema`. |
| P7 | Standard primitives | Vetted crypto (`@noble/*`); review before GA. |
| P8 | Ecosystem fit | Shared User, Soft Transfer, brand packs, no Login/Widget forks. |
| P9 | UI continuity | Proxy swap under existing House screens. |
| P10 | Displace, do not hole-punch | Server compute becomes P1 / P2 / P4. P3-to-server is banned. |

---

## 3. Architectural Decisions

| ID | Decision | Position |
|----|----------|----------|
| TDR-001–013, 015–018 | Inherited | See Budget TRD §3. Device replica, ZK mailbox, custom op log, Shared User, greenfield, shared core. |
| TDR-H-014 | **Attachments** | **Override Budget TDR-014 / D-21.** House blobs sync as HDK-sealed chunks on `REPORTS_BUCKET` prefix `lf-blob/`. Worker never parses the body. |
| TDR-H-019 | Capability gate | `localFirstApi` + `LOCAL_FIRST_API_ENABLED`. Do not widen `requireBudgetApi`. 404 body `{ error: 'Not found' }`. |
| TDR-H-020 | Multi-property | One DB / one DEK / N ledgers. Lazy hydration. Sync single-flight **per household**. |
| TDR-H-021 | Device identity | One `deviceId` across properties; control-plane PK is composite. |
| TDR-H-022 | Transport default | Mailbox-only in Wave A. WebRTC later, flag off. |
| TDR-H-023 | Client header | `X-House-Local-First: 1` on `/v2`; 410 on rejected House domain writes. |
| TDR-H-024 | Invite model | Collapse `household_invitations` / `household_invite_links` / `household_join_requests` into `lf_invites`. |
| TDR-H-025 | Widget/Watch | Minimal plaintext task slice in App Group + WatchConnectivity; wipe on logout. Not a server projection. |
| TDR-H-026 | Restore | `RESTORE_HLC = '000000000000001-0000-restore'`; live stamps and tombstones win. |
| TDR-H-027 | Projection | Package `createLedgerProjection(schema)`. House adapter is registry-only. |

---

## 4. System Context

```text
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ Device A (House brand)      │     │ Device B                    │
│ UI shell (existing screens) │     │ …                           │
│ Proxy → local*Api           │     │                             │
│ HouseLocalSessionManager    │◄───►│ Domain + Sync               │
│   Map<householdId, session> │mbox │                             │
│ Op log + projections        │     │                             │
│ DEK-sealed lf_rows          │     │                             │
└──────────────┬──────────────┘     └──────────────┬──────────────┘
               │ signaling / mailbox / blobs / TURN │
               ▼                                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Cloudflare control plane                                     │
│ Workers │ HouseholdCoordinatorDO │ D1 metadata               │
│ R2: lf-mailbox / lf-checkpoint / lf-blob (opaque)            │
│ Shared User / IdP token validation                           │
│ localFirstApi: House+Budget on; Kaizen+Health 404            │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Responsibility split

| Component | Owns |
|-----------|------|
| Presentation | Existing RN screens — **no V2 rewrite**. Sync chrome, invite UI (owed), conflict UI. |
| API facades | `src/api/*.ts` Proxy → `src/features/house/local/local*Api.ts` |
| Domain | Recurrence, task workflow, checklist instances, seasonal generation, garbage expansion |
| Encrypted local store | `symply-house-local-first.db`, `house.localFirst.dek.v1` |
| Session manager | `engine.ts` — N properties, lazy hydrate, fan-out sync |
| Sync engine | Inherited `@symply/local-first` mailbox + checkpoints |
| Control-plane adapter | `X-House-Local-First`, `house_sync_wake`, `simplehouse://lf-invite` |
| Reminders / widget | `houseLocalReminders.ts`, `widgetProjection.ts` |
| Blob channel (H6) | Client chunk seal + Worker stream + `lf_blobs` |
| Soft Transfer adapter | From local projections (Q16) |

### 4.2 Code map (as-built Wave A)

| Area | Path |
|------|------|
| Shared engine | `packages/local-first/` |
| House ledger | `src/features/house/local/` |
| Flag | `src/features/house/local/flag.ts` (`EXPO_PUBLIC_HOUSE_LOCAL_FIRST`) |
| Gate | `backend/src/config/local-first-api.ts`, `middleware/brand-gate.ts` |
| Routes | `backend/src/routes/local-first-v2.ts` |
| DO | `HOUSEHOLD_COORDINATOR` on House wrangler `v4` |

---

## 5. Offline Capability Model

| Capability | Offline | Online required |
|------------|---------|-----------------|
| Unlock, browse, CRUD Wave A | Yes | First provision only |
| Recurrence / checklist / seasonal / garbage expansion | Yes | — |
| Onboarding seed (spaces + seasonal + preset features) | Yes | — |
| Widget projection / local reminders | Yes | — |
| Create/join household, invite, enrol device | — | Yes |
| Sync exchange / checkpoint bootstrap | — | Yes |
| Blob upload/download (H6) | Authoring device keeps original | Peer fetch |
| Reports / chat / Lambda | — | Yes (Tier B) |
| Cloud AI (BYOK) | Stage A local parse | Stage B egress |
| Soft Transfer | — | Yes |

**Clocks (inherited):** version vector for sync cursor; HLC string for LWW. Never use HLC for `WHERE hlc > ?`. Drift reject: wall > now + 60s.

---

## 6. Local Storage and Encryption

### 6.1 Store

| Concern | Decision |
|---------|----------|
| Database | `symply-house-local-first.db` via expo-sqlite; `lf_rows` WITHOUT ROWID, per-row AEAD |
| DEK | SecureStore `house.localFirst.dek.v1`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — **must differ from Budget’s key** |
| Op ciphertext | SQLite BLOB, HDK-sealed, Ed25519-signed |
| Attachments (H6) | HDK-derived content key; chunked AES-GCM; R2 `lf-blob/`; local cache `cacheDirectory/lf-blobs/{blobId}` |
| UI prefs | Existing MMKV for non-ledger UI state only |

**Threat-model acceptance (Wave A):** one device DEK decrypts every property’s `lf_rows` on that device. HDK isolation does not protect at-rest rows after device compromise. Per-property DEKs are out of Wave A.

### 6.2 Key hierarchy (inherited, House-shaped)

```text
Recovery Secret (12-word phrase)     — H9
  └─ Argon2id → Recovery Key → wraps HDK for backups

Household Data Key (HDK, per property, rotated on membership change)
  ├─ encrypts op-log payloads
  ├─ encrypts checkpoint chunks
  └─ HKDF → blob content keys (H6)

Device Data Key (DEK, one per device)
  └─ seals lf_rows at rest
```

---

## 7. Domain Model — tiers and Wave A registry

### 7.1 Tiers

| Tier | Fate | Examples |
|------|------|----------|
| **A** | Encrypted ledger, device-authoritative | Wave A 21 tables; later B/C expansions |
| **B** | Stay server-side (plaintext required or out of V2) | Reports/Lambda, chat, AI-housekeeper attachments, `/home-budget` |
| **C** | Reference / catalog, not household SoT | Municipalities, maintenance templates, service providers |
| **D** | Derived; recompute on device (P1) or disable (P4) | `maintenance_suggestions`, `floor_plan_regions` |

Attempting fleet-wide parity (~161 House-relevant D1 tables) is the failure mode. Only Tier A enters the ledger.

### 7.2 Wave A tables (21) — as shipped

`households`, `household_members`, `household_spaces`, `tasks`, `maintenance_completions`, `maintenance_subtasks`, `maintenance_task_notes`, `home_features`, `appliances`, `appliance_service_history`, `garbage_schedules`, `seasonal_checklists`, `seasonal_checklist_items`, `recurringChecklists` / `recurringChecklistItems` (S1 rename of `checklists` / `checklist_items`), `checklist_instances`, `checklist_item_completions`, `household_notes`, `settings`, `recurring_reminders`, `task_drafts`.

**Rules:** every row key is `'id'` (no natural keys). S3b uniqueness uses `deterministicRowId`. Tombstones always resident. Bucket by first parseable `YYYY-MM` date; else `*`.

### 7.3 Ported server logic (as shipped in H3)

| Logic | Client module | Note |
|-------|---------------|------|
| Recurrence | `logic/recurrence.ts` | UTC date math — server `setMonth` is timezone-fragile on device |
| Task workflow | `logic/taskWorkflow.ts` | |
| Checklist instances | `logic/checklistInstances.ts` | Deterministic ids on read-materialize |
| Seasonal generation | `logic/seasonalGeneration.ts` | |
| Garbage expansion | `logic/garbageSchedule.ts` | Tier C config → local occurrences |

**Known leftover:** remote seasonal `progress` number vs screen `progress.completed` — local path composes the object the screen expects; remote path still broken.

### 7.4 Waves B/C (not yet ledgered)

See live plan §11. B1–B4 need H6. C1 needs H6 + H7 extraction. C4 home projects: 14 tables including PK-less joins.

---

## 8. Sync (inherited)

Wire and store contracts are Budget’s frozen Appendix A: `MAILBOX_BATCH_VERSION = 2`, 512k b64 cap, chunked push, VV cursor, storm debounce, parked-row orphan apply, `RESTORE_HLC`, checkpoint N=3 / 90d, catch-up 500 ops or 14d.

House-specific:

| Item | Contract |
|------|----------|
| Header | `X-House-Local-First: 1` |
| Wake | `{ type: 'house_sync_wake', householdId }` only |
| Deep link | `simplehouse://lf-invite` |
| Fan-out | `runHouseLocalSync` iterates sessions; single-flight **per** `householdId` |
| Reject gate | `rejectHomeWritesForLocalFirst` on Tier A prefixes; **exclude** `/chat`, `/aihousekeeper`, `/reports`, `/home-budget`, `/municipalities`, `/maintenance-templates`, `/service-providers` |
| Invite UI | Handshake exists in `localHouseholdsApi`; `HouseholdManagementScreen` still legacy — H4 remainder |

---

## 9. Identity and Unlock

Inherited: Shared User, JWT → Workers, offline unlock after first sign-in, enrolment-pending writes blocked (`HouseLocalEnrolmentPendingError`).

House: `ensureHouseLocalSession()` opens properties **lazily**; logout `teardownHouseLocalSession({ wipe })` also wipes the widget slice. Under Jest, `isHouseLocalFirst()` is **opt-in** (House is the Jest brand baseline).

---

## 10. Control Plane

| Surface | Contract |
|---------|----------|
| Capability | `localFirstApi: true` on House + Budget; false on Kaizen + Health |
| Kill | `LOCAL_FIRST_API_ENABLED` Worker secret + EAS Update `EXPO_PUBLIC_HOUSE_LOCAL_FIRST=0` |
| DO | `HOUSEHOLD_COORDINATOR` bound on House at migration tag `v4` (all three env blocks) |
| Cron | Sweeps gated on `isLocalFirstApiEnabled(env)` |
| Devices | PK `(household_id, id)` so one device can belong to N properties |
| Authz | Mailbox GET and deposit require `deviceBelongsToUser` (H0) |
| 404 body | `{ error: 'Not found' }` — pinned equal to `requireBudgetApi` |

Hibernation/signaling smoke after House bind is still owed (H0 leftover → H12).

---

## 11. Backup and Restore

Reuse `@symply/local-first` backup v2 (Argon2id, live-wins restore). House wrappers (`houseBackup.ts`) are H9.

| Item | Contract |
|------|----------|
| Granularity | One archive per property (Q15) |
| Blobs | Manifests by default; bytes in opt-in full archive |
| Restore stamp | Inherited D-20 / `RESTORE_HLC` |

---

## 12. Blob Channel (H6 — design)

Worker-proxied ciphertext PUT (R2 bindings cannot S3-presign). Prefix `lf-blob/` on `REPORTS_BUCKET`. Migration `0156_lf_blobs.sql` on **every** fleet brand D1 (empty tables elsewhere). Chunk retry **reuses** stored `(nonce, ciphertext)`. Lambda must never list `lf-blob/`.

---

## 13. Server-Compute Displacement (H7)

Locked assignment — do not reopen Q6–Q10:

| Consumer | Pattern |
|----------|---------|
| Task / checklist / garbage / bill reminders | P1 `houseLocalReminders.ts` (lite shipped: 30 scheduled on 10y corpus, 56-slot budget) |
| AI Housekeeper chat + grounding | P2 BYOK, ledger context (**not shipped**) |
| Enrichment / extract / quote compare | P2 BYOK (**not shipped**) |
| Briefings & weekly digests | P1 in-app; P4 email/push |
| Vision (floor/garden/schematic) | P4 off |
| Reports / chat | Tier B unchanged |
| Widget / Watch | P1 + App Group / WatchConnectivity plaintext slice (**lite shipped**, 8-field allowlist) |

**P3 is not approved — do not build.** Checklist due dates are the one H7-lite dark sub-case (`notificationRouting.ts` has no `checklist_due`).

---

## 14. Feature Gates

| Gate | Source | Default | Contract |
|------|--------|---------|----------|
| `EXPO_PUBLIC_HOUSE_LOCAL_FIRST` | EAS / env | unset → on for `symply-house`; **opt-in under Jest** | Client path |
| `EXPO_PUBLIC_HOUSE_P2P` | EAS / env | off | WebRTC |
| `LOCAL_FIRST_API_ENABLED` | Worker secret | `"true"` House staging **and** production (2026-08-12) | Route existence |
| `localFirstApi` | `brand-capabilities.ts` | House+Budget true | 404 Kaizen/Health |

Incident disable: Worker secret `"false"` **then** EAS Update with flag `0`. Worker-only is insufficient.

---

## 15. QA and Telemetry

| Layer | Check |
|-------|-------|
| Package | `npx vitest run` in `packages/local-first` |
| House local | `npx jest src/features/house/local` |
| Budget oracle | `npx jest src/features/budget/local` — must stay green after package edits |
| BE gate | `local-first-api-gate.test.ts` (404 body + brand isolation) |
| Scale | House corpus in `packages/local-first/__tests__/scale/` — quiet re-take owed |
| E2E | Port Budget 18-flow suite (H12); same-commit Worker rule |
| Analytics | `src/services/analytics.ts` brand-tagged; **never** ledger content in event properties |

---

## 16. Soft Transfer

Opt-in, versioned, deny-by-default (`_ecosystem`). After V2, packages come from **local projections**. House is the platform authority — Q16 is a dedicated design pass at H9, not a hand-wave.

---

## 17. Deployment

| Change | Action |
|--------|--------|
| Shared Worker / `/v2` / capabilities / cron | From **`main` checkout only**: `eval "$(./scripts/secrets/export-env.sh)"` then `cd backend && npm run deploy:fleet` (staging then production) |
| House-only Worker | `deploy:house:all` |
| D1 schema | Migrate **staging and production for every fleet brand** (shared `migrations_dir`) |
| Client JS | EAS Update with House profile |
| Native / widget entitlements | EAS build |
| Never | `deploy:fleet` from an `<app>-v2` clone |

**Standing rule:** two-device E2E must run against a Worker built from the **same commit** as the client.

---

## 18. Open Engineering Gaps

| # | Gap | Severity | Stage |
|---|-----|----------|-------|
| G1 | Encrypted blob channel | high | H6 |
| G2 | BYOK Housekeeper + cron guards | high | H7 |
| G3 | Backup / restore / export wrappers | medium | H9 |
| G4 | Invite screen collapse (handshake exists) | medium | H4 remainder |
| G5 | Two-device E2E + airplane-mode device install | high | H12 |
| G6 | Quiet H10 re-take + Hermes anchor | medium | H10 |
| G7 | DO hibernation smoke | low | H12 |
| G8 | Q16 Soft Transfer design | medium | H9 |

---

## 19. Acceptance

- [x] Inherits Budget engine contracts by reference; House deltas explicit.
- [x] Tiers, Wave A registry, and Proxy cutover match the tree.
- [x] P3 banned; widget local-slice exception stated.
- [x] Multi-property and blob override of D-21 stated.
- [x] Deploy-from-main and same-commit E2E rules stated.
- [ ] H6/H7/H9/H11/H12 still design — tracked in Implementation.
