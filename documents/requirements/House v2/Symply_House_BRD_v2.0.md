# Symply House — Business Requirements Document

**Local-first household operations for the Symply Ecosystem**

| Field | Value |
|-------|-------|
| **Document type** | Business Requirements Document (BRD) |
| **Version** | 2.0 — Canonical |
| **Date** | 2026-08-13 |
| **Status** | Approved for implementation planning (Wave A as-built) |
| **Display name** | Symply House |
| **App id** | `simple-house` |
| **Brand id** | `symply-house` |
| **Companion TRD** | [Symply_House_TRD_v2.0.md](./Symply_House_TRD_v2.0.md) |
| **Implementation** | [Symply_House_V2_Implementation.md](./Symply_House_V2_Implementation.md) |
| **Live plan** | [house-local-first-implementation-plan.md](./house-local-first-implementation-plan.md) |
| **App summary** | [documents/apps/symply-house/BRD.md](../../apps/symply-house/BRD.md) |
| **Pattern source** | [Symply_Budget_BRD_v2.0.md](../Buget%20v2/Symply_Budget_BRD_v2.0.md) |

> **Purpose.** What House V2 must do and why. Implementation detail lives in the TRD and the live plan. This document locks the data-plane change; it does not replace the app-level House BRD.

---

## 1. Executive Summary

Symply House is the household operations OS in the Symply Ecosystem: spaces, tasks, appliances, checklists, contractors, visits, utilities context, reports, Widget/Watch, and optional AI Housekeeper. It is also the **template parent** — child brands copy its brand pack, not its domain ledger.

V2 changes the data plane, not the product story: **the device is the system of record** for Wave A home operations. Records live encrypted on enrolled devices. Devices synchronize through a transit-only zero-knowledge relay the company cannot decrypt. The Cloudflare control plane stores identity, membership, device public keys, signaling metadata, and opaque ciphertext only — never a readable home ledger.

The engine, wire format, `/v2` control plane, and `lf_*` tables are **the Budget V2 stack reused**. House pays only for what Budget genuinely does not share: **1–3 properties per user**, **attachment bytes that must reach peers**, **server jobs that cannot silently no-op**, a **widget/watch glance**, and **wide rows** (tasks are 58 columns).

UI consequence: **keep the existing House screens**; swap the data layer underneath via Proxy facades. Wave A cutover already did this with **zero screen file edits**.

### 1.1 Architecture answers

| Question | Answer |
|----------|--------|
| Fully offline after first sign-in? | Yes for Wave A home ops (tasks, spaces, appliances, checklists, notes, settings). Network for first provisioning, invites, device enrolment, exchanging changes, and Tier B surfaces (reports, chat, Lambda). |
| Offline unlock? | Yes. After first online sign-in, biometrics/PIN unlock the local encrypted store with no server round-trip. |
| Sync with no home ledger in our DB? | Yes for Tier A. Peers exchange encrypted ops; BE holds metadata + opaque relay blobs only. |
| Pure P2P enough? | No. Mobile overlap is unreliable; a bounded ZK mailbox is required. |
| New fleet account model? | No. Shared User / fleet identity stays. |
| Photos invisible on the partner’s phone? | **Not acceptable for House.** Budget could leave wish images device-local; House has 25 blob-bearing tables. Bytes must sync (H6). |
| AI Housekeeper without a server ledger? | Chat + grounding = member BYOK with ledger-assembled context. Email/push digests are **off**. Reminders fire from the device. Floor-plan/garden/schematic vision features are **off** until a BYOK path lands. Consented plaintext projection **to the server is not approved**. |

### 1.2 Pre-release constraint

There are **no production users** — only testers. Product owner 2026-08-12: the House database may be wiped. V2 is **greenfield**: no D1→device migration, no dual-write. Tester data may be truncated.

---

## 2. Fleet Placement

| Item | Value |
|------|-------|
| Project | Symply Ecosystem |
| Role | Parent / template storefront |
| Brand pack | `brands/symply-house/` |
| Shared identity | Shared User — same `user_id` across fleet |
| Soft Transfer | Opt-in summaries only; House is the platform authority — local-ledger interaction is Q16 (H9) |
| Shared shell | Login, Widget, Watch, tab shell — brand tokens/assets only, no forks |
| Engine reuse | `@symply/local-first` shared with Budget; Kaizen/Health stay off (`localFirstApi: false`) |
| Budget relationship | House keeps lightweight home-related money glances only. `/home-budget` stays Tier B remote (Q11). |

---

## 3. Problem, Opportunity, Drivers

### 3.1 Problem

Home data is scattered across PDFs, notes, contractor threads, and one person’s head. A server-held ledger forces online-first UX, creates a readable breach surface, and cannot work on a job site with no signal. Budget V2 already proved the alternative; House is larger and has attachments and automation that Budget could degrade.

### 3.2 Opportunity

- Architectural privacy for the home ledger (cannot disclose data never held in plaintext).
- Genuine offline capture for tasks, spaces, checklists, and notes.
- Multi-property landlords keep independent E2EE ledgers on one device.
- Same Symply account as Budget and siblings.
- Reuse a certified engine (Budget two-device suite green `20260812-195127`) instead of inventing a second sync stack.

### 3.3 Drivers

| Driver | Description |
|--------|-------------|
| Trust | Home photos, contractor docs, and task history are sensitive; architecture must enforce privacy. |
| Offline | Maintenance work happens where signal is poor. |
| Cost | No home-ops SoT on BE for Tier A. |
| Fleet | One platform repo; Shared User; Soft Transfer deny-by-default; `deploy:fleet` ships four Workers. |
| Template | House remains the brand/template parent; local-first is a data plane, not a fork of Login/Widget/Watch. |

---

## 4. Goals, Non-Goals, Metrics

### 4.1 Goals

- **G1** — Every adult member has a current shared view of Wave A home data on their own device.
- **G2** — Typical task create/complete under a few seconds, online or offline.
- **G3** — 1–3 properties per user, independently keyed and synced, without 3× cold-open cost.
- **G4** — Company cannot read Tier A household content.
- **G5** — Device loss does not imply irreversible history loss when backup or a peer exists (H9).
- **G6** — Existing House UI remains familiar; V2 is primarily a data-plane change.
- **G7** — Core paths work with AI off.
- **G8** — Attachment bytes reach peers (H6); “invisible photo” is a defect, not a nicety.
- **G9** — Reminders and the home-screen widget keep working from the device (H7-lite).

### 4.2 Non-goals

- Production migration from today’s D1 home ledger.
- Dual-write local + D1.
- Visual redesign of House.
- Consented plaintext projection of the ledger **to the server** (P3).
- Making reports / Lambda / household chat E2EE in Wave A (Tier B, stay server-side).
- Extending local-first to Kaizen, Health, or Language in this programme.
- Bank linking or standalone Budget product scope.
- Users under 18; dependent/child roles.
- “No accounts” / eliminate Shared User.
- Real-time sync guarantees while apps are suspended.

### 4.3 Success metrics (post soft-launch)

| Metric | Target |
|--------|--------|
| Airplane-mode Wave A flows | 100% of defined core flows pass |
| Sync when both online | Changes visible ≤ 60s for ≥ 99% of change sets |
| Multi-property cold open | ≤ 1.3× a single-property open (measured 1.02× at H5) |
| Irrecoverable history (active households) | < 0.1% |
| Widget after cold signed-in launch | Next-N tasks visible without opening a screen |
| Pending local notifications | Never above 64; rolling horizon keeps a budget under the cap |
| UI familiarity | No required redesign of primary House navigation for V2 |

---

## 5. Personas

| Persona | Need |
|---------|------|
| Home owner / primary operator | Spaces, tasks, appliances, checklists; invites a partner; notices missed reminders. |
| Participating partner | Fast task complete; equal visibility; own login — not a shared password. |
| Multi-property landlord | Switch properties without losing the other ledger; independent membership per property. |
| Single-member user | Fully valid household of one; not “incomplete.” |
| Tester (pre-release) | Wipe/reinstall acceptable; clear reset path. |

---

## 6. Scope by Wave

Aligned with implementation stages (see Implementation plan). Product remains valuable after Wave A offline.

| Wave | Theme | Contents |
|------|--------|----------|
| **A** | Core home | H0–H5, H7-lite, H8, H10. 21 tables. Tasks, spaces, appliances, checklists, notes, settings, garbage, seasonal. Proxy cutover, multi-property, checkpoints, reminders, widget. |
| **B** | Labor hub | H6 + H7 remainder + H11a. Contractors, visits, quotes, projects, visit checklists. Needs blob channel. |
| **C** | Long tail | H11b + H9 + H12 full. Utilities, floor/garden plans, home projects. Backup/restore. Two-device E2E + brand default on. |

### 6.1 Explicitly out of scope (all waves unless reopened)

| Excluded | Rationale |
|----------|-----------|
| D1→device migration | Greenfield; wipe authorized |
| P3 server plaintext projection | Privacy decision 2026-08-12 |
| Report PDFs / Lambda as E2EE | Lambda must read plaintext (Tier B) |
| Household chat E2EE | Tier B, same as Budget |
| CR-SQLite / hosted CRDT as SoT | Custom op log chosen |
| Master v9 “no user DB” | Breaks fleet Shared User |

---

## 7. Primary Journeys

1. **First device** — Online Shared User sign-in → local keys + encrypted DB → create property → optional backup setup (H9).
2. **Offline daily use** — Unlock with biometrics/PIN → create/complete tasks, edit spaces, run checklists → no network.
3. **Invite partner** — Owner creates invite (QR / Universal Link / short code) → OOB verification → invitee enrols device → bootstrap history. Collapse legacy House invite tables into `lf_invites` (Q14).
4. **Second property** — Create or join another household; switcher hydrates lazily; sync fans out per property.
5. **Eventual sync** — Foreground/on-open mailbox sync; UI shows last sync / pending. WebRTC opt-in later (`EXPO_PUBLIC_HOUSE_P2P`).
6. **Attachment** — Pick a photo/PDF → encrypted chunks via Worker to R2 → peer fetches and renders byte-identical (H6).
7. **Lost device** — Peer re-enrolment or encrypted backup + recovery phrase; account recovery alone never yields HDK.
8. **Optional AI** — BYOK provider, ledger-assembled context, editable draft, confirm → signed op. Core House works with AI off.

---

## 8. Business Requirements

Priority: **M** Must, **S** Should, **C** Could. Traceability → TRD sections.

### 8.1 Identity, access, offline unlock

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-001 | Individual accounts via Shared User / federated providers; no home-content identifiers at sign-in. | M | §9 |
| HR-002 | After first successful online sign-in on a device, unlock and Wave A offline features work with no network. | M | §5 |
| HR-003 | Unlock uses platform biometrics where available, with PIN/passphrase fallback. | M | §9 |
| HR-004 | Online token expiry must not block approved local reads/writes. | M | §9 |
| HR-005 | Multi-device enrolment per member; list and revoke devices from another enrolled device. | M | §10 |
| HR-006 | Revoking a device stops future data delivery and triggers household re-keying for subsequent data. | M | §8 |
| HR-007 | Identity recovery must not yield household content keys without trusted-device approval or backup secret. | M | §11 |

### 8.2 Household, membership, properties

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-010 | User can create a household/property and become owner. | M | §10 |
| HR-011 | Owner can invite adults via QR, shareable link, and short code with OOB confirmation. | M | §10 |
| HR-012 | Roles: Owner and Adult Member. Equal data visibility; admin rights differ. Adults only. | M | §10 |
| HR-013 | Support ≥ 6 members and ≥ 12 devices (design target); **1–3 properties per user**. | M | §10 |
| HR-014 | One device may be an active member of several properties at once (composite `lf_devices` key). | M | §10 |
| HR-015 | Owner can remove a member; revoke devices + re-key; disclose that existing local copies remain. | M | §10 |
| HR-016 | Single-member households are first-class. | M | §10 |
| HR-017 | Property switcher hydrates the active ledger lazily; background properties must not block the active one. | M | §10 |

### 8.3 Wave A home operations

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-020 | CRUD for Wave A tables: households, members, spaces, tasks, completions, subtasks, notes, home features, appliances, service history, garbage schedules, seasonal checklists, recurring checklists, instances, item completions, household notes, settings, recurring reminders, task drafts. | M | §7 |
| HR-021 | Recurring next-occurrence, task workflow stages, checklist instance materialization, seasonal generation, and garbage expansion run **on device**, timezone-safe (UTC date math). | M | §7 |
| HR-022 | Preserve existing House navigation/shell; V2 must not require a redesign. | M | Impl |
| HR-023 | Reports, chat, municipalities, maintenance templates, and `/home-budget` remain server-authoritative (Tier B/C) in Wave A. | M | §7 |

### 8.4 Synchronisation and offline

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-040 | All Wave A household data stored locally encrypted on each enrolled device. | M | §6 |
| HR-041 | Reads/writes for Wave A complete without network. | M | §5 |
| HR-042 | Changes propagate E2EE; company cannot decrypt. | M | §8 |
| HR-043 | Concurrent edits converge without user intervention in the common case (LWW + tombstones). | M | §8 |
| HR-044 | Surface conflicts when auto-merge would discard meaningful intent. | S | §8 |
| HR-045 | Show last sync, pending outbound, stale peers. | M | §8 |
| HR-046 | Sync must not require simultaneous peer online (ZK mailbox). | M | §8 |
| HR-047 | New device receives full history (checkpoint + op tail). | M | §8 |
| HR-048 | Mailbox-only is the Wave A default; WebRTC is opt-in. | M | §8 |

### 8.5 Attachments (House delta vs Budget)

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-050 | Blob-bearing Wave A/B/C fields sync ciphertext to peers; ledger stores `{blobId, mime, bytes, sha256, chunkCount}`, never a device path. | M | §6 |
| HR-051 | Worker streams opaque bytes; never parses plaintext. | M | §12 |
| HR-052 | Retain blobs until the row tombstone passes the compaction watermark (not a 14-day mailbox TTL). | M | §6 |
| HR-053 | Per-household quota: soft warn 2 GB, hard stop 5 GB, surfaced in Settings. | S | §6 |
| HR-054 | Report PDFs and AI-housekeeper attachments stay on existing server upload paths (Tier B). | M | §6 |

### 8.6 Backup, recovery, portability

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-060 | Encrypted per-property backup the user can store anywhere. | M | §11 |
| HR-061 | Backup encryption from user-held secret; company cannot decrypt. | M | §11 |
| HR-062 | Restore merges; **live data wins** (inherited D-20). | M | §11 |
| HR-063 | Default archive carries blob **manifests**; opt-in full archive includes bytes. | S | §11 |
| HR-064 | CSV/JSON export of Wave A tables with formula-injection neutralization. | S | §7 |

### 8.7 Privacy, security, compliance

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-070 | Backend stores only identity, membership, device public keys, operational metadata, and opaque relay/blob ciphertext. | M | §12 |
| HR-071 | Telemetry/crash exclude ledger values, notes, attachments; opt-in. | M | §15 |
| HR-072 | Public privacy claim: “we cannot read your home data,” not “we store nothing.” | M | Legal |
| HR-073 | Widget/Watch may hold a **minimal disclosed plaintext task slice** in the App Group / WatchConnectivity — wipe on logout. This is **not** P3-to-server. | M | §13 |
| HR-074 | Independent crypto review before GA. | M | §15 |

### 8.8 AI, reminders, integrations

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-080 | Cloud AI optional, off by default, separate from offline core. | M | §13 |
| HR-081 | R1 AI = member-supplied BYOK to allowlisted providers; keys device-local, never synced. | M | §13 |
| HR-082 | AI output is editable draft only; never auto-posts to ledger. | M | §13 |
| HR-083 | Core reminders work offline via local notifications, rolling horizon under the iOS 64 cap. | M | §14 |
| HR-084 | Remote push is opaque control metadata only (`house_sync_wake`); no home content. | M | §14 |
| HR-085 | Email/push digests are **off** for local-first households; in-app digest is P1. | M | §13 |
| HR-086 | Floor-plan region detection, garden-plan generation, home-project schematics are **off** until BYOK vision lands. | M | §13 |
| HR-087 | Do not fork Login / Widget / Watch / Shared User per brand. | M | Fleet |

### 8.9 Soft Transfer and fleet

| ID | Requirement | P | TRD |
|----|-------------|---|-----|
| HR-090 | Soft Transfer remains opt-in, versioned, deny-by-default. | M | §16 |
| HR-091 | Cross-app packages carry summaries/context only — not full ledger sync. | M | §16 |
| HR-092 | After V2, export packages are computed from local projections (Q16 design pass at H9). | M | §16 |

---

## 9. Assumptions and Constraints

### 9.1 Assumptions

- Testers accept wipe/reinstall during V2 build-out.
- Household datasets stay within on-device capacity (H10: ~14.5k rows @5y/2 adults, ~28.9k @10y).
- Each adult has their own device and account.
- Intermittent connectivity; not indefinite air-gap.
- Membership changes are infrequent (re-key cost acceptable).
- Budget V2 engine remains the certified base (two-device suite green).

### 9.2 Constraints

| Constraint | Implication |
|------------|-------------|
| React Native + Expo | Native modules for crypto, SQLite, (later) WebRTC |
| Mobile background limits | Foreground/on-open sync is the guarantee; push is a hint |
| iOS 64 pending notifications | Rolling-horizon scheduler is mandatory |
| No company key escrow | Recovery depends on user secret + surviving devices |
| `deploy:fleet` | Shared Worker plumbing reaches four production brands |
| UI freeze | Prefer repository swap over screen rewrite |
| Shared `migrations_dir` | House DDL (e.g. `0156`) lands empty on Budget/Kaizen/Health D1 too |

---

## 10. Risks (summary)

| ID | Risk | Mitigation |
|----|------|------------|
| R-01 | Only device + recovery secret lost → history gone | Mandatory verified backup (H9); encourage second device |
| R-02 | Sync divergence | Inherited op log + CI convergence tests + visible sync status |
| R-03 | Photos never reach peers | H6 is a Wave B gate, not optional |
| R-04 | AI Housekeeper / cron go dark | Locked P1/P2/P4 assignment; abort if H7 cannot land |
| R-05 | Multi-property device PK collision | Composite `lf_devices` PK (H5) |
| R-06 | LWW map dwarfs row data | Stamp interning (Q12); H10 measured 1.9× |
| R-07 | Fleet blast from shared Worker | `localFirstApi` 404 on Kaizen/Health; change plumbing deliberately |
| R-08 | Testers confuse V1 D1 app with V2 | Flag + first-run note + lab truncate while flag is still `0` |
| R-09 | Two-device E2E never greens | Wave A stays flag-off for internal use (abort criterion) |

---

## 11. Decision Log (canonical)

### 11.1 Inherited from Budget V2 (do not reopen)

| Ref | Decision |
|-----|----------|
| E-01 | Stay in Symply Ecosystem monorepo. |
| E-02 / Q1 | Greenfield; no production migration; tester wipe OK. **House-confirmed 2026-08-12.** |
| E-03 | Minimal UI change; keep existing screens. |
| E-04 | Shared `@symply/local-first` core. |
| E-06 | Shared User remains. |
| D-16 | Transit-only ZK relay, ≤ 14 days, deleted on ack. |
| D-17 | Custom operation log, not CR-SQLite. |
| D-20 | Restore merges; live data wins. |
| D-32 | R1 AI = member-supplied BYOK. |

### 11.2 House-only (locked 2026-08-12 unless noted)

| Ref | Decision |
|-----|----------|
| Q0 | Offline + E2EE **are** House product requirements. Do-nothing rejected. |
| Q2 | New `localFirstApi` capability — do not widen `requireBudgetApi`. |
| Q3 | One SQLite file, one DEK, N ledgers (not one DB per property). |
| Q4 | Blob lifetime = row tombstone + compaction watermark. |
| Q5 | Blob quota: warn 2 GB / stop 5 GB. |
| Q6 | AI Housekeeper chat = P2 BYOK, ledger-assembled context. |
| Q7 | Reminders = P1 on-device. **P3 to server is not approved.** |
| Q8 | Digests = P1 in-app; email/push **off**. |
| Q9 | Vision features (floor/garden/schematic) = P4 off until BYOK. |
| Q10 | Widget/Watch minimal plaintext slice **approved** (local channel, not server). |
| Q13 | Promote `projection.ts` into the package (done). |
| Q14 | Collapse legacy House invite tables into `lf_invites` (invite **screen** still owed). |
| Q12 | Stamp interning in; LWW was 1.9× row data at 10y (H10). |
| H7-lite | Reminders + widget **live**, not dark, as Wave A ship gate. |

### 11.3 House overrides of Budget decisions

| Budget | House |
|--------|-------|
| D-21 receipt images **not** synchronised | **Overridden.** Attachment bytes must sync (HR-050). |
| Budget alerts silently no-op | **Overridden.** House automation is the product; displace via P1/P2/P4. |
| One household per device | **Overridden.** 1–3 properties; composite device key. |

---

## 12. Open Questions

| ID | Question | Owner | Blocks |
|----|----------|-------|--------|
| Q-01 | Exact public privacy wording with AI + relay + widget plaintext slice | Legal + Marketing | GA |
| Q11 | `/home-budget` glance: stay Tier B (current) or local summary after both apps are local-first | Product | After Wave A |
| Q15 | Backup: per-property default locked; confirm full-archive UX | Product | H9 |
| Q16 | Soft Transfer vs encrypted House ledger | Product + Engineering | H9 |
| H12 | Two-device E2E port + brand-default-on | Engineering | Wave A GA |

Engineering Q4/Q5 are recommended and treated as locked for H6 design; implement with tests.

---

## 13. Glossary

| Term | Definition |
|------|------------|
| Local-first | Authoritative data on device; network is optimisation. |
| Wave A / B / C | Core home (21 tables) / labor hub (19) / long tail (26). |
| Tier A / B / C / D | Ledger / server-plaintext required / reference data / derived. |
| P1–P4 | On-device compute / BYOK AI / consented server projection (**banned**) / disable with copy. |
| HDK | Household Data Key — per property; encrypts op payloads. |
| DEK | Device Data Key — one per device; seals `lf_rows` at rest. |
| Soft Transfer | Opt-in cross-app package with consent. |
| Shared User | Fleet identity (`user_id`) owned by `_ecosystem` contracts. |

---

## 14. Acceptance

- [x] Single BRD answers offline / offline unlock / no Tier A SoT on BE / ZK relay without contradiction.
- [x] Fleet Shared User + Soft Transfer preserved.
- [x] Do-nothing, P3-to-server, CR-SQLite, and no-account rejected explicitly.
- [x] Greenfield / wipe authorized stated.
- [x] UI freeze stated.
- [x] House deltas vs Budget (blobs, multi-property, server displacement, widget) stated.
- [x] Wave A as-built status recorded in the Implementation doc.
- [ ] Stakeholder sign-off (product/security/legal as needed before GA).
