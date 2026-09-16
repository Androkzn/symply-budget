# Symply Budget — Business Requirements Document

**Local-first household budgeting for the Symply Ecosystem**

| Field | Value |
|-------|-------|
| **Document type** | Business Requirements Document (BRD) |
| **Version** | 2.0 — Canonical |
| **Date** | 2026-08-10 |
| **Status** | Approved for implementation planning |
| **Display name** | Symply Budget |
| **App id** | `simple-budget` |
| **Brand id** | `symply-budget` |
| **Companion TRD** | [Symply_Budget_TRD_v2.0.md](./Symply_Budget_TRD_v2.0.md) |
| **Implementation** | [Symply_Budget_V2_Implementation.md](./Symply_Budget_V2_Implementation.md) |
| **App summary** | [documents/apps/symply-budget/BRD.md](../../apps/symply-budget/BRD.md) |
| **Supersedes** | Household BRD v2.0 draft, Symply Budget BRD v1.4, Master BRD/TRD v9 (business content) |

> **Purpose.** What the product must do and why. Implementation detail lives in the TRD. This document aggregates the best of the V2 source drafts and locks ecosystem-fit decisions for Symply Budget.

---

## 1. Executive Summary

Symply Budget is the full household budgeting product in the Symply Ecosystem. It tracks day-to-day spending, envelopes, recurring obligations, savings context, mortgages/loans, and related planning for adult household members who each use their own device and Shared User account.

V2 changes the data plane, not the product story: **the device is the system of record**. Financial records live encrypted on enrolled devices. Devices synchronize through end-to-end encrypted peer channels and a transit-only zero-knowledge relay the company cannot decrypt. The Cloudflare control plane stores identity, membership, device public keys, signaling metadata, and opaque ciphertext only — never a readable household ledger.

The commercial position is honest architectural privacy: *we cannot read your money data*. Operational consequence: smaller breach surface and near-zero financial-data storage cost. Engineering consequence: sync, keys, backup, and recovery are first-class product work. UI consequence: **keep the existing Budget shell**; swap the data layer underneath.

### 1.1 Architecture answers

| Question | Answer |
|----------|--------|
| Fully offline after first sign-in? | Yes for all core money work. Network is required for first provisioning, invites, device enrolment, and exchanging changes. |
| Offline unlock? | Yes. After first online sign-in, biometrics/PIN unlock the local encrypted store with no server round-trip. |
| Sync with no financial data in our DB? | Yes. Peers exchange encrypted ops; BE holds metadata + opaque relay blobs only. |
| Managed backend without VMs? | Yes. Cloudflare Workers, D1 (metadata), Durable Objects, R2 (ciphertext mailbox), Realtime TURN. |
| Pure P2P enough? | No. Mobile overlap is unreliable; a bounded ZK mailbox is required. |
| New fleet account model? | No. Shared User / fleet identity stays. Do not adopt “no account database.” |

### 1.2 Pre-release constraint

There are **no production users** — only testers. V2 is **greenfield**: no D1→device migration, no dual-write. Tester data may be wiped.

---

## 2. Fleet Placement

| Item | Value |
|------|-------|
| Project | Symply Ecosystem |
| Role | Child storefront; full budget product |
| Template parent | Symply House (`symply-house` / `simple-house`) |
| Brand pack | `brands/symply-budget/` |
| Feature mode | `features.budget = full` (House remains `minimal`) |
| Shared identity | Shared User — same `user_id` across fleet |
| Soft Transfer | Opt-in summaries only; never silent sibling ledger sync |
| Shared shell | Login, Widget, Watch, tab shell — brand tokens/assets only, no forks |
| Reuse target | Local-first core designed for later House / Health adoption |

House keeps lightweight home-related money glances only. Soft Transfer packages (e.g. `budget.summary.v1`, `home_project_cost_summary.v1`) are built from **local projections** after V2, not from a server ledger.

---

## 3. Problem, Opportunity, Drivers

### 3.1 Problem

Households share money but track it in notes, spreadsheets, and one partner’s head. Aggregator apps demand bank credentials many users refuse. Server-held ledgers create breach liability and force online-first UX that fails at checkout, in parking garages, and on transit.

### 3.2 Opportunity

- Architectural privacy (cannot disclose data never held in plaintext).
- Genuine offline capture.
- Peer household model (each adult holds a full replica).
- Lower backend cost (scales with accounts/signaling, not transaction history depth).
- Same Symply account as House and siblings.

### 3.3 Drivers

| Driver | Description |
|--------|-------------|
| Trust | Financial data is highly sensitive; architecture must enforce privacy, not only policy. |
| Cost | No financial SoT on BE. |
| Risk | Breach impact limited to identity graph + public keys + opaque ciphertext. |
| Reach | React Native iOS/Android; shared TS core for a future desktop peer. |
| Fleet | One platform repo; Shared User; Soft Transfer deny-by-default. |

---

## 4. Goals, Non-Goals, Metrics

### 4.1 Goals

- **G1** — Every adult member has a current shared view on their own device.
- **G2** — Typical expense capture under ten seconds, online or offline.
- **G3** — Mortgages/loans accurate enough to trust payoff projections (CA + US conventions).
- **G4** — Company cannot read household financial content.
- **G5** — Device loss does not imply irreversible history loss when backup or a peer exists.
- **G6** — Existing Budget UI remains familiar; V2 is primarily a data-plane change.
- **G7** — Core paths work with AI off.

### 4.2 Non-goals

- Bank linking, open banking, screen scraping, payment initiation.
- SIN/SSN, tax-authority credentials, tax filing, credit scoring, investment advice.
- Company key escrow or company-readable backups.
- Advertising / sale of user data.
- Users under 18; dependent/child roles.
- Big visual redesign in V2 baseline.
- Production data migration from today’s D1 ledger.
- “No accounts” / eliminate Shared User.
- Real-time sync guarantees while apps are suspended.

### 4.3 Success metrics (post soft-launch)

| Metric | Target |
|--------|--------|
| Airplane-mode core flows | 100% of defined core flows pass |
| Sync when both online | Changes visible ≤ 60s for ≥ 99% of change sets |
| Offline capture rate | Tracked (expect 15–30%) |
| Irrecoverable history (active households) | < 0.1% |
| Verified encrypted backup within 14 days of activation | ≥ 70% |
| Support tickets re sync/recovery per 1k MAU | < 8 |
| UI familiarity | No required redesign of primary Budget navigation for V2 |

---

## 5. Personas

| Persona | Need |
|---------|------|
| Primary budgeter (owner) | Categories, envelopes, mortgage terms, invites; notices wrong amortisation. |
| Participating partner | Fast spend entry; equal visibility; own login — not a shared password. |
| Single-member user | Fully valid household of one; not “incomplete.” |
| Spreadsheet migrator | CSV import + reviewed AI drafts. |
| Tester (pre-release) | Wipe/reinstall acceptable; clear reset path. |

---

## 6. Scope by Phase

Aligned with implementation phases (see Implementation plan). Product remains valuable after single-device offline (Phase 1).

| Phase | Theme | Contents |
|-------|--------|----------|
| **0** | Foundations | Encrypted local store, domain + op log, offline unlock, Shared User sign-in bridge, single-member usable locally |
| **1** | Core budgeting | Accounts, transactions, categories, envelopes, recurring, mortgages/loans, core reports, CSV I/O; **no financial D1 writes** |
| **2** | Household sync | Device enrolment, invites (QR/link/code), HDK distribution, P2P + ZK relay, conflict handling, sync status |
| **3** | Resilience | Encrypted backup + verified restore, peer bootstrap, revoke + re-key |
| **4** | Everyday value | Local reminders, opaque sync push, BYOK document/receipt import with confirm, Soft Transfer summaries from local |
| **5+** | Together / later | Household text rooms, desktop peer, widgets enhancements, multi-currency depth, paid AI relay |

### 6.1 Explicitly out of scope (all phases unless reopened)

| Excluded | Rationale |
|----------|-----------|
| Bank aggregation | Privacy position |
| Company plaintext financial storage | Architecture |
| Attachment sync between devices | Simplifies R1 (images stay on capturing device) |
| Outbound product email for auth/invites | Passwordless + QR/link/code (D-07/D-10) |
| CR-SQLite / hosted CRDT as SoT | Custom op log chosen (D-17) |
| Master v9 “no user DB” | Breaks fleet Shared User |

---

## 7. Primary Journeys

1. **First device** — Online Shared User sign-in → local keys + encrypted DB → create household → optional backup setup.
2. **Offline daily use** — Unlock with biometrics/PIN → capture spend, adjust budgets, view loans → no network.
3. **Invite partner** — Owner creates invite (QR / Universal Link / short code) → OOB verification → invitee enrols device → bootstrap history.
4. **Eventual sync** — Foreground/on-open sync over WebRTC; mailbox covers offline peers; UI shows last sync / pending.
5. **Remove member/device** — Revoke future access + re-key; existing local copies remain; UI states this plainly.
6. **Lost device** — Peer re-enrolment or encrypted backup + recovery phrase; account recovery alone never yields HDK.
7. **Optional AI import** — User picks document → minimize/preview → BYOK provider → editable draft → confirm → signed op.

---

## 8. Business Requirements

Priority: **M** Must, **S** Should, **C** Could. Traceability → TRD sections.

### 8.1 Identity, access, offline unlock

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-001 | Individual accounts via Shared User / federated providers (Apple, Google) and path to passkeys; no financial identifiers at sign-in. | M | §9 |
| BR-002 | After first successful online sign-in on a device, unlock and all offline-capable features work with no network. | M | §5, §9 |
| BR-003 | Unlock uses platform biometrics where available, with PIN/passphrase fallback. | M | §9 |
| BR-004 | Online token expiry must not block approved local reads/writes; server ops wait for refresh. | M | §9 |
| BR-005 | Multi-device enrolment per member; list and revoke devices from another enrolled device. | M | §10 |
| BR-006 | Revoking a device stops future data delivery and triggers household re-keying for subsequent data. | M | §8 |
| BR-007 | Failed unlock attempts escalate delays; after threshold, wipe local data key (restore required). | S | §9 |
| BR-008 | Identity recovery must not yield household content keys without trusted-device approval or backup secret. | M | §9, §11 |

### 8.2 Household and membership

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-010 | User can create a household and become owner. | M | §10 |
| BR-011 | Owner can invite adults via QR, shareable HTTPS link, and short code with OOB confirmation. | M | §10 |
| BR-012 | Roles: Owner and Adult Member. Equal data visibility; admin rights differ. Adults only. | M | §10 |
| BR-013 | Support ≥ 6 members and ≥ 12 devices (design target). | S | §14 |
| BR-014 | Owner can remove a member; revoke devices + re-key; disclose that existing local copies remain. | M | §10 |
| BR-015 | Ownership transferable; dual-owner support to avoid single admin failure. | S | §10 |
| BR-016 | Multi-household membership with clear household switcher. | M | §10 |
| BR-017 | Single-member households are first-class. | M | §10 |

### 8.3 Budgeting and daily spending

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-020 | Record expense/income with amount, date, category, account, payee, optional note/tags. | M | §7 |
| BR-021 | Typical expense entry completes in under ten seconds, including offline. | M | §5, §14 |
| BR-022 | Categories/groups with budgeted amounts per period. | M | §7 |
| BR-023 | Monthly periods by default, configurable start day, category carry-forward rules. | M | §7 |
| BR-024 | Recurring rules generate entries offline deterministically. | M | §7 |
| BR-025 | Split transactions across categories. | S | §7 |
| BR-026 | Transfers between accounts without double-counting as spend. | M | §7 |
| BR-027 | Attribution: who recorded and last modified (when multi-member). | S | §7 |
| BR-028 | Preserve existing Budget navigation/shell; V2 must not require a redesign. | M | Impl |

### 8.4 Mortgages, loans, debt

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-030 | Record debt with principal, rate, compounding, frequency, term, start. | M | §7 |
| BR-031 | Full amortisation schedule with principal/interest split. | M | §7 |
| BR-032 | Canadian conventions (e.g. semi-annual compounding / monthly payments) and simple monthly. | M | §7 |
| BR-033 | Extra payments / lump sums / frequency changes update payoff and interest. | M | §7 |
| BR-034 | Variable rate history recalculates forward. | S | §7 |
| BR-035 | Renewal terms distinct from amortisation period. | S | §7 |
| BR-036 | All debt maths execute locally offline. | M | §7 |

### 8.5 Synchronisation and offline

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-040 | All household financial data stored locally encrypted on each enrolled device. | M | §6 |
| BR-041 | Reads/writes for core money features complete without network. | M | §5 |
| BR-042 | Changes propagate E2EE; company cannot decrypt. | M | §8 |
| BR-043 | Concurrent edits converge without user intervention in the common case. | M | §8 |
| BR-044 | Surface conflicts when auto-merge would discard meaningful intent. | S | §8 |
| BR-045 | Show last sync, pending outbound, stale peers. | M | §8 |
| BR-046 | Sync must not require simultaneous peer online (ZK mailbox). | M | §8 |
| BR-047 | New device receives full history (via peers + mailbox/snapshots). | M | §8 |
| BR-048 | Wi-Fi-only / pause sync options. | C | §8 |

### 8.6 Backup, recovery, portability

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-050 | Encrypted full-household backup user can store anywhere. | M | §11 |
| BR-051 | Prompt backup in onboarding; verify restore before marking protected. | M | §11 |
| BR-052 | Backup encryption from user-held secret; company cannot decrypt. | M | §11 |
| BR-053 | Recovery kit / 12-word phrase default; blunt loss warning. | M | §11 |
| BR-054 | With another enrolled device, restore replacement without backup file. | M | §11 |
| BR-055 | CSV/JSON export and local data delete on demand. | M | §7 |

### 8.7 Privacy, security, compliance

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-060 | Never collect bank account/card numbers, banking credentials, SIN/SSN, tax-authority credentials. | M | §3 |
| BR-061 | Backend stores only identity, membership, device public keys, operational metadata, and opaque relay ciphertext. | M | §12 |
| BR-062 | Telemetry/crash exclude financial values, payees, notes, attachments; opt-in. | M | §15 |
| BR-063 | Account deletion removes server-side user records within 30 days; instruct local wipe. | M | §12 |
| BR-064 | Design for PIPEDA / Quebec Law 25; GDPR-ready for later EU. | M | §15 |
| BR-065 | App-store data-safety declarations match actual collection. | M | §15 |
| BR-066 | Independent crypto review before GA. | M | §15 |
| BR-067 | Public privacy claim: “we cannot read your data,” not “we store nothing.” | M | Legal |

### 8.8 AI, reminders, integrations

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-070 | Cloud AI optional, off by default, separate from offline core. | M | §13 |
| BR-071 | Before each cloud AI send: identify content, provider, retention/training stance; exact outbound preview. | M | §13 |
| BR-072 | Local minimize/redact; block SIN, full PAN, identity/tax docs for cloud AI in launch scope. | M | §13 |
| BR-073 | AI output is editable draft only; never auto-posts to ledger. | M | §13 |
| BR-074 | R1 AI = member-supplied BYOK to allowlisted providers; keys device-local, never synced. | M | §13 |
| BR-075 | Later paid managed AI uses no-store Worker relay; no payload persistence in D1/logs. | S | §13 |
| BR-076 | Core reminders work offline via local notifications. | M | §14 |
| BR-077 | Remote push is opaque control metadata only (e.g. sync available); no financial content. | M | §14 |
| BR-078 | Calendar/Docs exports are explicit, previewed, one-way; leave encryption boundary with disclosure. | S | §14 |

### 8.9 Soft Transfer and fleet

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| BR-080 | Soft Transfer remains opt-in, versioned, deny-by-default. | M | §16 |
| BR-081 | Cross-app packages carry summaries/context only — not full ledger sync. | M | §16 |
| BR-082 | After V2, export packages are computed from local projections. | M | §16 |
| BR-083 | Do not fork Login / Widget / Watch / Shared User per brand. | M | Fleet |

---

## 9. Assumptions and Constraints

### 9.1 Assumptions

- Users accept manual entry in exchange for no bank linking (validate in beta).
- Household datasets stay within on-device capacity (tens of thousands of txs over years).
- Each adult has their own device and account.
- Intermittent connectivity; not indefinite air-gap.
- Membership changes are infrequent (re-key cost acceptable).
- Testers accept wipe/reinstall during V2 build-out.

### 9.2 Constraints

| Constraint | Implication |
|------------|-------------|
| React Native + Expo | Native modules for crypto, SQLCipher, WebRTC |
| Mobile background limits | Foreground/on-open sync is the guarantee; push is a hint |
| No company key escrow | Recovery depends on user secret + surviving devices |
| No self-managed servers | Cloudflare managed composition only |
| Shared User fleet | Identity adapter must not break House/siblings |
| UI freeze | Prefer repository swap over screen rewrite |
| Small team | Ship single-device value before multi-device sync |

---

## 10. Risks (summary)

| ID | Risk | Mitigation |
|----|------|------------|
| R-01 | Only device + recovery secret lost → history gone | Mandatory verified backup; encourage second device |
| R-02 | Sync divergence | Op log + CI convergence tests + visible sync status |
| R-03 | Peers rarely overlap | ZK relay (not pure P2P) |
| R-04 | Invite/key exchange flaw | OOB verify; crypto review before GA |
| R-05 | Manual entry abandonment | Fast capture, recurring, CSV, BYOK import |
| R-06 | Sync engine eats schedule | Isolated module; ship Phase 1 without sync |
| R-07 | Privacy claim vs AI/relay | Precise legal wording; BYOK + preview |
| R-08 | IdP/CF outage | Offline core continues; clear deferred sync |
| R-09 | Soft Transfer from local aggregates wrong | Versioned packages; explicit consent UI |
| R-10 | Testers confuse V1 D1 app with V2 | Feature flag / separate builds; wipe docs |

Full risk tables from source drafts remain historically valid; this list is the planning set.

---

## 11. Decision Log (canonical)

### 11.1 Ecosystem and delivery

| Ref | Decision |
|-----|----------|
| E-01 | Stay in Symply Ecosystem monorepo; no separate Budget repo. |
| E-02 | Greenfield V2; no production migration; tester wipe OK. |
| E-03 | Minimal UI change; keep existing Budget screens/shell. |
| E-04 | Extract shared `local-first` core for later House/Health. |
| E-05 | Soft Transfer stays summary packages from local data. |
| E-06 | Shared User remains; reject Master v9 “no account DB.” |
| E-07 | Stacked branches: `feat/local-first-core` → `feat/budget-v2-local-first`. |

### 11.2 Commercial and scope (from Household D-*)

| Ref | Decision |
|-----|----------|
| D-01 | Free at launch; subscription deferred. |
| D-03 | Launch markets Canada + US; CA/US currency + mortgage conventions. |
| D-04 | Single-member use fully supported. |
| D-05 | Adults only; no dependent role. |
| D-06 | Multi-household membership supported. |

### 11.3 Identity and security

| Ref | Decision |
|-----|----------|
| D-07 | Target passwordless: passkeys, Apple, Google. No emailed OTP product path. Pre-release may bridge current JWT until IdP hardening. |
| D-08 | Managed IdP direction (Clerk default candidate); Workers validate tokens. |
| D-10 | Invites via QR, HTTPS Universal/App Link, short code — not email send. |
| D-12 | Recovery: 12-word phrase default (+ optional passphrase); type-back confirm. |
| D-14 | Inviter selects correct verification phrase from three candidates. |

### 11.4 Synchronisation and data

| Ref | Decision |
|-----|----------|
| D-16 | **Transit-only ZK relay**, deleted on ack by all devices, hard ceiling **14 days**. Supersedes Symply TDR-003 “no ciphertext retained.” |
| D-17 | **Custom operation log**, not CR-SQLite / general CRDT library. |
| D-18 | No hosted sync that must read plaintext. |
| D-19 | Snapshot compaction in scope. |
| D-20 | Restore merges; live data wins on conflict. |
| D-21 | Receipt/document **images not synchronised**. |
| D-22 | Same-LAN sync deferred. |

### 11.5 Features

| Ref | Decision |
|-----|----------|
| D-32 | R1 AI = member-supplied BYOK only; company operates no AI arrangement at launch. |
| D-35 | Reminders per-class controllable; quiet hours / digest. |
| D-38 | Voice / shortcut entry valued for friction reduction (device-local). |
| F-01 | Household chat/rooms deferred to Phase 5+ (not blocking money offline). |

---

## 12. Open Questions

| ID | Question | Owner |
|----|----------|-------|
| Q-01 | Exact public privacy wording with AI + relay | Legal + Marketing |
| Q-02 | Counsel: no bank credentials ⇒ outside FI regulation in CA/US? | Legal |
| Q-03 | Free-period grandfathering when subscription arrives | Product + Finance |
| Q-04 | Quebec Law 25 / residency for metadata + ciphertext | Legal |
| Q-05 | French language timing for Quebec | Product |
| Q-06 | Default reminder classes at first run | Product |
| Q-07 | IdP vendor final selection evidence pack | Engineering + Security |
| Q-08 | Soft Transfer v1 field freeze for local-summary export | Product + Engineering |

---

## 13. Glossary

| Term | Definition |
|------|------------|
| Local-first | Authoritative data on device; network is optimisation. |
| E2EE | Only endpoints hold content keys; intermediaries see ciphertext. |
| Zero-knowledge relay | Holds/forwards ciphertext without keys to decrypt. |
| Household | Group of accounts sharing one budget dataset. |
| Operation log | Append-only signed changes; state is a projection. |
| HDK | Household Data Key — encrypts op payloads; never on BE in plaintext. |
| Soft Transfer | Opt-in cross-app package with consent. |
| Shared User | Fleet identity (`user_id`) owned by `_ecosystem` contracts. |

---

## 14. Acceptance

- [x] Single BRD answers offline / offline unlock / no financial SoT / ZK relay without contradiction.
- [x] Fleet Shared User + Soft Transfer preserved.
- [x] Master v9 no-account and CR-SQLite rejected explicitly.
- [x] Greenfield / no migration stated.
- [x] UI freeze stated.
- [x] Decision log resolves TDR-003 vs D-16 (relay wins).
- [ ] Stakeholder sign-off (product/security/legal as needed before GA).
