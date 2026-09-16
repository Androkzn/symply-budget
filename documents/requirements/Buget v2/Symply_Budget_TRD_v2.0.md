# Symply Budget — Technical Requirements Document

**Encrypted local-first sync, Cloudflare metadata control plane, ecosystem-aware**

| Field | Value |
|-------|-------|
| **Document type** | Technical Requirements Document (TRD) |
| **Version** | 2.0 — Canonical |
| **Date** | 2026-08-10 |
| **Status** | Approved for implementation planning |
| **Companion BRD** | [Symply_Budget_BRD_v2.0.md](./Symply_Budget_BRD_v2.0.md) |
| **Implementation** | [Symply_Budget_V2_Implementation.md](./Symply_Budget_V2_Implementation.md) |
| **Platforms** | React Native (Expo) iOS & Android; shared TypeScript core; desktop peer later |
| **Supersedes** | Household TRD v2.0 draft, Symply Budget TRD v1.4, Master BRD/TRD v9 (technical content) |

> **Scope.** Technical architecture that satisfies BRD v2.0. `BR-*` identifiers refer to that BRD. Pre-release is greenfield — no D1 ledger migration.

---

## 1. Purpose and Technical Answers

| Question | Technical answer |
|----------|------------------|
| Fully offline? | Client is a complete app over encrypted SQLite. Reads, writes, budgets, amortisation run locally. Network for enrolment, invites, sync exchange only. |
| Offline unlock? | Local unlock wraps DB key with PIN/biometric-gated Keychain/Keystore material. No server on launch after provisioning. |
| No financial DB? | BE schema has no tables for transactions/balances/loans as SoT. Peers exchange encrypted ops via WebRTC + ZK mailbox. |
| Managed backend? | Workers + D1 (metadata) + per-household DO + R2 mailbox + Realtime TURN + Shared User / managed IdP. |
| Pure P2P? | Insufficient on mobile → **transit-only ZK relay** (BR-046). |

---

## 2. Architecture Principles

| # | Principle | Consequence |
|---|-----------|-------------|
| P1 | Device is source of truth | Screens render from local state only. |
| P2 | Server incapable, not merely unwilling | No server path can decrypt household content. |
| P3 | Changes are facts | Append-only signed operation log. |
| P4 | Convergence is testable | Same ops ⇒ byte-identical logical state. |
| P5 | Recovery is first-class | Company cannot restore content keys. |
| P6 | One domain core, many shells | Shared TS package; RN UI is a shell. |
| P7 | Standard primitives | Vetted crypto; review before GA. |
| P8 | Ecosystem fit | Shared User, Soft Transfer, brand packs, no Login/Widget forks. |
| P9 | UI continuity | Prefer repository swap under existing Budget screens. |

---

## 3. Architectural Decisions

| ID | Decision | Position |
|----|----------|----------|
| TDR-001 | Local replica | Each trusted device holds full logical household + op journal. |
| TDR-002 | Control-plane boundary | CF + IdP persist identity, membership, device public keys, invites, key-epoch, push, audit — not financial SoT. |
| TDR-003 | **ZK mailbox** | Opaque ciphertext may transit R2 mailbox ≤ 14 days; deleted on ack by all devices. **Supersedes v1.4 “no ciphertext retained.”** |
| TDR-004 | Offline authorization | Token expiry blocks server ops only. |
| TDR-005 | Sync payload | Immutable ops + occasional encrypted snapshots; never live SQLite file copy. |
| TDR-006 | Transport | WebRTC DataChannel + authenticated signaling + STUN + mandatory TURN. |
| TDR-007 | App-layer crypto | Ops encrypted/signed under HDK independent of WebRTC. |
| TDR-008 | Lifecycle | Foreground/on-open sync is the guarantee; push is a hint. |
| TDR-009 | Desktop-ready | Domain/sync/crypto/storage contracts have no RN UI imports. |
| TDR-010 | Managed backend | No Symply-owned VMs/containers/TURN hosts. |
| TDR-011 | Security authority | Per-household Durable Object serializes membership/device/key-epoch. |
| TDR-012 | Identity | Shared User today; managed OIDC IdP target; Workers validate tokens. |
| TDR-013 | Op log | Custom append-only log (not CR-SQLite). |
| TDR-014 | Attachments | Images device-local; not synced/relayed/backed up with household. |
| TDR-015 | AI plane | Separate consented path; R1 BYOK; human confirm before signed op. |
| TDR-016 | Soft Transfer | Summaries from local projections; consent via `_ecosystem`. |
| TDR-017 | Greenfield | No migrate-from-D1; financial D1 routes unused for V2 path. |
| TDR-018 | Shared core | `packages/local-first` (or `src/local-first`) reusable by House/Health. |

---

## 4. System Context

```text
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ Device A (Budget brand)     │     │ Device B                    │
│ UI shell (existing screens) │     │ …                           │
│ Application services        │     │                             │
│ Domain core (TS)            │◄───►│ Domain + Sync               │
│ Op log + projections        │P2P  │                             │
│ Sync engine + crypto        │     │                             │
│ SQLCipher DB                │     │                             │
└──────────────┬──────────────┘     └──────────────┬──────────────┘
               │ signaling / mailbox / TURN          │
               ▼                                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Cloudflare control plane                                     │
│ Workers │ Household DO │ D1 metadata │ R2 ZK mailbox │ TURN │
│ Shared User / IdP token validation                           │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Responsibility split

| Component | Owns |
|-----------|------|
| Presentation | Existing RN screens, navigation, sync status chrome, conflict UI |
| Application services | Use cases: budgets, txs, loans, membership orchestration |
| Domain | Entities, money maths, invariants, merge policies |
| Encrypted local store | SQLCipher, migrations, projections, op journal |
| Key manager | Device keys, DB key, HDK epochs, biometric wrap |
| Sync engine | Eligibility, batching, verify, merge, snapshots, compaction |
| P2P adapter | react-native-webrtc DataChannel, ICE, TURN |
| Control-plane adapter | Auth tokens, Workers APIs, signaling WS, push reg, TURN creds |
| AI import coordinator | Preview, BYOK call, draft validate, confirm → op |
| Soft Transfer adapter | Build/consume summary packages from local data |

---

## 5. Offline Capability Model

| Capability | Offline | Online required |
|------------|---------|-----------------|
| Unlock, browse, CRUD money | Yes | First provision only |
| Recurring materialisation | Yes | — |
| Debt amortisation | Yes | — |
| Reports / insights (local) | Yes | — |
| CSV export | Yes | — |
| Create/join household, invite, enrol device | — | Yes |
| Sync exchange | — | Yes (opportunistic) |
| Cloud AI import | — | Yes |
| Soft Transfer cross-app | — | Yes |

**Offline write path:** validate → append signed op → update projections → enqueue for sync. Never block UI on network.

**Clocks:** Hybrid logical clock (HLC) per op; wall clock for display only; conflict rules must not depend on unsynchronized wall time alone.

---

## 6. Local Storage and Encryption

### 6.1 Store

| Concern | Decision |
|---------|----------|
| Database | SQLite + SQLCipher (AES-256) via high-throughput JSI binding (op-sqlite or equivalent) |
| Attachments | Device-local files, XChaCha20-Poly1305 under per-file keys wrapped by local DB key; **not synced** |
| UI prefs | MMKV encrypted for non-financial UI state only |
| Keys | iOS Keychain / Android Keystore; biometric-gated unlock key |

### 6.2 Key hierarchy

```text
Recovery Secret (12-word phrase or passphrase)
  └─ Argon2id → Recovery Key → wraps HDK for backups

Household Data Key (HDK, 256-bit, rotated on membership change)
  ├─ encrypts op-log payloads
  └─ wrapped per device (X25519 ECDH + HKDF + AEAD)

Device Identity Keypair (Ed25519 sign / X25519 agree)
  └─ private in Secure Enclave / StrongBox where possible

Local Database Key (SQLCipher)
  └─ wrapped by Unlock Key = Argon2id(PIN) ⊕ biometric-gated keystore key
```

**Invariant:** HDK and Recovery Secret never leave the device in plaintext and are never sent to the backend.

### 6.3 Requirements

- TR-060 — Financial data at rest encrypted under unlock-gated keys.
- TR-061 — DB key never plaintext in prefs, JS beyond session, or logs.
- TR-062 — Close DB / zero key after configurable background idle.
- TR-063 — System backup must not be the household backup mechanism.
- TR-064 — Warn on jailbreak/root; product may restrict enrolment.

---

## 7. Domain Model and Operation Log

### 7.1 Approach

State is derived from an append-only operation log. Projections are materialised tables maintained incrementally and rebuildable. Schema evolution regenerates projections after client upgrade.

### 7.2 Core entities (logical)

| Entity | Notes |
|--------|-------|
| Household | id, name, base currency, period config, key epoch |
| Member | user id, display name, role OWNER \| ADULT |
| Device | member, label, public keys, enrolled/revoked |
| Account | type CHEQUING, SAVINGS, CASH, CREDIT_CARD, LOAN, MORTGAGE, LOC, ASSET |
| Category / Group | income vs expense |
| Transaction | minor-unit integers; never float money |
| TransactionSplit | multi-category |
| Transfer | linked pair; excluded from spend totals |
| BudgetPeriod / BudgetAllocation | rollover policy |
| RecurringRule | RRULE + deterministic instance IDs |
| DebtInstrument | rate schedule, compounding, amortisation, renewals |
| Attachment (local) | not replicated |

Map to today’s UI concepts in `src/screens/budget/` (items, expenses, goals, sub-budgets, mortgage screens) via repositories — not by keeping D1 as SoT.

### 7.3 Operation log schema

```sql
operations (
  op_id            TEXT PRIMARY KEY,   -- UUIDv7
  household_id     TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  author_member_id TEXT NOT NULL,
  hlc              TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  parents          TEXT,               -- JSON causal predecessors
  op_type          TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  payload          BLOB NOT NULL,      -- AEAD under HDK
  key_epoch        INTEGER NOT NULL,
  signature        BLOB NOT NULL,      -- Ed25519
  applied_at       INTEGER NOT NULL
);
CREATE INDEX ops_household_hlc ON operations(household_id, hlc);
CREATE UNIQUE INDEX ops_device_seq ON operations(device_id, seq);
```

Envelope fields (logical): `protocolVersion`, `schemaVersion`, `householdId`, `keyEpoch`, `senderDeviceId`, `ciphertext`, `signature`.

Receiver validates size, versions, household, sender cert, epoch, seq policy, signature, AEAD tag, payload schema, domain invariants before apply.

### 7.4 Recurring

RFC 5545 RRULE + household timezone. Instance ID = f(ruleId, occurrenceDate). Materialise on open / local schedule — works offline (BR-024).

### 7.5 Debt engine

Pure TS functions on integer minor units; golden tests vs published lender schedules; CA semi-annual compounding + US monthly; runs offline (BR-036).

### 7.6 Import / export / erase

- CSV/JSON export of projections.
- Encrypted backup archive (see §11).
- Local erase on demand; BE account delete is separate (§12).

---

## 8. Synchronisation

### 8.1 Overview

Two transports:

1. **Direct WebRTC DataChannel** when peers overlap online.
2. **ZK mailbox (R2)** — sealed change sets addressed to household/devices; server cannot decrypt; TTL ≤ 14 days; delete on full ack.

### 8.2 Session (foreground / on-open)

1. Authenticate to control plane; DO confirms eligibility at current security revision.
2. Obtain short-lived TURN credentials if needed.
3. Exchange presence / capability versions.
4. Open DataChannel; app-layer handshake (device signatures).
5. Exchange checkpoint hashes; diff missing ops; transfer batches; ack.
6. Optionally deposit sealed batches in mailbox for offline peers.
7. Push opaque `SYNC_AVAILABLE` hints to eligible devices (best effort).

### 8.3 Bootstrap and snapshots

New device receives missing ops and/or encrypted snapshot + trailing ops. Snapshot compaction in scope (D-19). Never copy live DB file.

### 8.4 Conflicts

| Case | Rule |
|------|------|
| Concurrent creates | Both keep (distinct ids) |
| Concurrent field edits | Deterministic LWW by HLC + device tie-break; or merge policy per field |
| Semantic conflict (e.g. delete vs edit) | Surface for user when auto-merge would discard intent (BR-044) |
| Restore vs live | Live wins (D-20) |

### 8.5 Membership / re-key

On revoke: DO marks devices revoked; HDK epoch++; new ops under new epoch; revoked devices cannot decrypt future payloads. Past local copies remain (BR-014/016).

### 8.6 Observability (user)

Last successful sync per peer, pending outbound count, mailbox lag class, manual Sync now, quiet failure after prolonged outage (BR-045).

---

## 9. Authentication and Offline Unlock

### 9.1 Model

| Layer | Role |
|-------|------|
| Shared User / IdP | Online identity, fleet `user_id` |
| Local unlock | Access to encrypted DB |
| Household enrolment | HDK access — separate from account recovery |

### 9.2 Pre-release bridge

Keep current Symply JWT + Apple/Google sign-in working for testers. Introduce managed IdP / passkeys before multi-member invite is widely tested. Do not store passwords in Workers/D1.

### 9.3 Target sign-in (D-07)

Passkeys, Sign in with Apple, Sign in with Google. No product outbound email OTP. Invites use QR/link/code.

### 9.4 Offline unlock (BR-002/003)

Biometric or PIN unwraps Local Database Key. Cold unlock may take ≤ 2s for KDF (D-13); biometric path stays immediate.

### 9.5 Re-validation

Configurable online re-validation (default 30 days of connectivity). Failure degrades server ops / may move to read-only for sync eligibility — must not instantly lock local data without warning (BR-004).

### 9.6 Session

Access/refresh tokens in SecureStore only — never AsyncStorage. Workers validate iss/aud/exp/signature/claims before authorization.

---

## 10. Household, Membership, Enrolment

### 10.1 Create household

Owner creates household on DO; device generates HDK; registers device public keys; initializes local DB.

### 10.2 Invitation (BR-011)

1. Create invite on DO: id, ephemeral pubkey, role, single-use, 24h expiry.
2. Present QR, Universal/App Link on owned HTTPS host, short code.
3. Invitee claims atomically on DO; no privilege on GET alone.
4. OOB verification: inviter picks correct phrase from three (D-14).
5. Authenticated channel wraps HDK for invitee device.
6. Bootstrap history (§8.3).

Invitation email send is **not** implemented (D-10).

### 10.3 Additional device for same member

Owner/admin approval + OOB verify + HDK wrap; same as invite hardening.

### 10.4 Roles

OWNER and ADULT only (D-05). Dual-owner optional (D-11). Multi-household switcher required (D-06).

### 10.5 Removal

Revoke membership/devices, re-key, stop mailbox delivery. UI states local copies persist.

---

## 11. Backup and Recovery

| Path | Mechanism |
|------|-----------|
| Encrypted backup | **Bundle** of every household on the device, encrypted under one Recovery Key from one 12-word phrase |
| Verified backup | Restore dry-run before “protected” badge (BR-051) |
| Peer restore | Re-enrol + bootstrap when another device exists (BR-054) |
| Account recovery | Restores identity only — never HDK (BR-008) |

Merge-on-restore: live data wins (D-20). Rooms/messages deferred with Phase 5 policy.

### 11.1 File format — v3 bundle

One file per device, not per household. The phrase is stretched **once** against a
bundle-wide Argon2id salt; the resulting Recovery Key then seals each household
as its own AES-GCM section, with the household id bound as AAD.

| Property | Consequence |
|---|---|
| One KDF pass for N households | A device-wide seal finishes at all — N passes at `RECOVERY_KDF_MOBILE` is minutes of memory-hard work per household |
| One section per household | Selective restore; a corrupt section loses one household, not the file |
| Household id in AAD | A section cannot be moved between households or between bundles |
| Ids cleartext, names sealed | A restore screen can count budgets before the phrase; “Nan’s care costs” is not a fact the file leaks |

**Supersedes BR-016’s one-archive-per-household.** That split was correct and
unusable: being covered required N phrases, N schedules and N destinations all to
be right, and when one was not, nothing said so — the other archives still
restored. The schedule, phrase, destination, retention cap and overdue reminder
are device-level again; the per-household backup *history* is not, because “is
this budget recoverable” is still the right question and a bundle answers it yes
for every household inside it.

v2 single-household archives are still **read** (`verifyBudgetBackupFile` sniffs
the version); nothing writes them.

### 11.2 Attachments — now carried in backups

This section previously read “backups exclude receipt image blobs (D-21)”. That
application of D-21 is withdrawn. **D-21 itself is unchanged**: receipt and
document images are still *not synchronised* between devices, and the receipt
scan flow still discards the image from RAM (§14). Backup is the one place the
bytes now travel.

The reason: the rows referenced a `localUri` on the phone that made the backup,
so a restore onto a new device — the case backups exist for — returned every
wish with a broken thumbnail and said nothing, because the rows really were
complete. What was missing had never been in the archive.

Blobs now ride inside the sealed section, up to a shared cap
(`BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES`, 25 MB base64 across the bundle),
smallest first. Anything past the cap is **counted and reported**, never silently
dropped. Ledger rows always travel in full — a wish never disappears because its
photo was too big — and restored rows have their `localUri` re-derived from the
image key, since iOS reissues the container UUID on every install.

---

## 12. Cloudflare Control Plane

### 12.1 Service map

| Service | Role |
|---------|------|
| Workers | HTTPS API, token validation, rate limits, TURN creds, AI relay later |
| D1 | Metadata directory/projection/audit only |
| Household DO | Membership, devices, key-epoch, invites, signaling/presence |
| R2 | ZK mailbox ciphertext (TTL ≤ 14d) |
| Realtime TURN | ICE relay for WebRTC |
| APNs/FCM | Opaque sync hints |
| Shared User / IdP | Identity |

### 12.2 Data placement rules

| Allowed on BE | Forbidden on BE |
|---------------|-----------------|
| User id ↔ IdP subject | Transactions, balances, categories |
| Household/membership edges | Loans, notes, payees |
| Device public keys, labels | HDK, recovery secrets |
| Invite HMAC/metadata | Complete invite secrets in logs |
| Push endpoints | AI prompts/responses (except transient paid relay) |
| Opaque mailbox blobs | Readable financial content |
| Security audit metadata | Soft Transfer full ledgers |

### 12.3 Representative endpoints (control only)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/platform/me` | Shared User profile (existing) |
| POST | `/v2/households` | Create household metadata |
| POST | `/v2/households/:id/invites` | Create invite |
| POST | `/v2/households/:id/invites/:inviteId/claim` | Atomic claim |
| POST | `/v2/households/:id/devices` | Register/approve device |
| DELETE | `/v2/households/:id/devices/:deviceId` | Revoke |
| GET | `/v2/households/:id/signaling` | WS upgrade via DO |
| POST | `/v2/households/:id/mailbox` | Deposit sealed blob |
| GET | `/v2/households/:id/mailbox` | Fetch sealed blobs for device |
| POST | `/v2/turn` | Short-lived TURN credentials |
| POST | `/v2/push/register` | Push token |

Existing `/households/:id/budget/*` financial CRUD becomes **unused for V2 builds** (feature-flagged off / retired after cutover). Schema may remain until cleanup PR.

### 12.4 Authority

DO is authoritative for security state. D1 is projection/audit and must never alone authorize peer eligibility, TURN, or invite acceptance.

---

## 13. AI Document / Receipt Plane

Separate from sync/control plane (BR-070+).

### 13.1 Ladder

1. Local type validation, inert parse, on-device OCR when practical.
2. Sensitive-data detect/redact; page selection; exact outbound preview.
3. User consent for provider/mode.
4. BYOK HTTPS to allowlisted official endpoint (R1) **or** later paid no-store Worker stream.
5. Schema-validate result → local draft with evidence/uncertainty.
6. User confirms → normal signed household op.
7. Discard image from RAM; images remain device-local only (D-21).

### 13.2 Hard rules

- No tools/network/retrieval inside model task; schema-only output.
- Never auto-mutate ledger.
- Kill switch disables cloud AI without affecting offline budgeting.
- BYOK keys in Keychain/Keystore; never synced or logged.

---

## 14. Notifications and Integrations

| Channel | Rule |
|---------|------|
| Local notifications | Reminders offline (BR-076) |
| Remote push | Opaque `{ event: "SYNC_AVAILABLE", peer_id? }` only (BR-077) |
| Calendar / Docs | Explicit export; amounts off by default; disclose leaving E2EE (BR-078) |
| Widget / Watch | Brand-driven glances from **local** projections; no companion fork |

---

## 15. Security, Abuse, Observability

- Rate limit invite, enrol, signaling, mailbox, TURN.
- WAF/Turnstile on public web invite landing; native APIs use quotas + integrity signals.
- Telemetry opt-in; never financial fields (BR-062).
- Content-free Workers logs / Analytics Engine metrics.
- Threat model covers: stolen device, malicious peer, compromised IdP (no HDK), relay traffic analysis, prompt injection in docs, cost denial via mailbox.
- Independent crypto review before GA (BR-066).

---

## 16. Soft Transfer and Shared User

| Concern | Contract |
|---------|----------|
| Shared User | `_ecosystem` / House platform spine; Budget validates tokens; no second account store |
| Soft Transfer | Packages in `packages/contracts` / RELATIONSHIPS.md; consent UI in `src/smart-engine/` |
| V2 export | Compute `budget.summary.v1` (and peers) from local projections |
| Import | Onboarding context stash only — not silent ledger merge |
| Health | Deny-by-default remains |

---

## 17. Shared Local-First Package

Target layout (adjust if monorepo packages tooling prefers `src/local-first`):

```text
packages/local-first/
  src/
    crypto/          # key hierarchy, AEAD, sign
    store/           # SQLCipher adapter, migrations
    oplog/           # append, verify, project
    sync/            # protocol, mailbox client, checkpoints
    control/         # typed control-plane client
    money/           # minor units, amortisation helpers
```

**Rules:** no React Native UI imports; platform adapters injected. Budget domain ops live in `src/features/budget/` (or `src/features/budget/local/`) using this package. House/Health later supply their own op types.

---

## 18. UI Integration Contract

| Today | V2 |
|-------|-----|
| `src/api/budget.ts` → Worker/D1 | Local repositories over op log |
| `src/stores/budgetStore.ts` UI cache | Keep for UI-only; not financial SoT |
| `src/screens/budget/*` | Keep; swap data hooks |
| `src/features/budget/*` | Mode gates + new local services |
| Widget snapshot | From local monthly overview projection |

Minimal chrome additions: sync status, pending count, Sync now, backup onboarding.

---

## 19. Quality Targets and Verification

| Attribute | Target |
|-----------|--------|
| Offline | Airplane-mode suite for core flows |
| Confidentiality | BE cannot decrypt ops; tests assert no financial columns used |
| Integrity | Signed, schema-validated, idempotent apply |
| Convergence | Multi-device sim in CI |
| Relay | TTL enforcement; ack deletion |
| AI | Preview equals bytes sent; confirm required |
| Brand | `npm run validate:brand` when brand contracts change |

---

## 20. Non-Goals / Deferred

- CR-SQLite mesh, Electric/PowerSync as SoT
- Attachment sync, chat R1, same-LAN sync
- Paid AI until BYOK proven
- Desktop client (architecture ready only)
- Production D1→device migration tooling

---

## 21. Traceability (summary)

| BR theme | TRD |
|----------|-----|
| BR-001–008 identity/unlock | §9 |
| BR-010–017 household | §10 |
| BR-020–028 budgeting / UI | §7, §18 |
| BR-030–036 debt | §7.5 |
| BR-040–048 sync | §8 |
| BR-050–055 backup | §11 |
| BR-060–067 privacy | §3, §12, §15 |
| BR-070–078 AI/notify | §13, §14 |
| BR-080–083 Soft Transfer/fleet | §16, §17 |

---

## 22. Acceptance

- [x] Resolves TDR-003 vs D-16 (ZK mailbox canonical).
- [x] Rejects CR-SQLite and no-account models.
- [x] Defines control-plane vs content-plane boundary.
- [x] Defines shared package + UI rewiring contract.
- [x] Greenfield / no migration.
- [ ] Security review of crypto/sync before GA.
- [ ] IdP vendor evidence pack before multi-member beta.
