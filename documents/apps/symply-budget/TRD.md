# Symply Budget - Technical Requirements Document

> **App-level contracts only.** Deep V2 architecture is in [Symply_Budget_TRD_v2.0.md](../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md). Feature details: [features/README.md](./features/README.md).

| Field | Value |
|-------|-------|
| **Doc type** | App TRD |
| **App id** | `simple-budget` |
| **Display name** | Symply Budget |
| **Role** | child app / first House feature extraction |
| **Parent platform** | `_ecosystem` |
| **Status** | `in-progress` (V2 local-first) |
| **Version** | `v0.4` |
| **Created** | 2026-07-12 |
| **Last updated** | 2026-08-10 |
| **BRD** | [BRD.md](./BRD.md) |
| **Brand pack** | `brands/symply-budget/` |
| **Feature index** | [features/README.md](./features/README.md) |
| **Canonical V2 TRD** | [Symply_Budget_TRD_v2.0.md](../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) |
| **Implementation** | [Symply_Budget_V2_Implementation.md](../../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md) |

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1–v0.3 | 2026-07 | Brand, modules, budget-analysis domain (server-era) |
| v0.4 | 2026-08-10 | V2 local-first: device SoT, control-plane BE, link canonical TRD |

---

## 1. Architecture Placement

```text
Symply Ecosystem
|-- brands/symply-budget/         identity, tokens, tabs, feature modes
|-- app/                          Expo Router + tab shell
|-- src/features/budget/          mode gates + local domain (V2)
|-- src/screens/budget/           existing UI (keep; rewire data)
|-- packages/local-first/         shared crypto/store/oplog/sync (target)
|-- src/shared-user/              Shared User client
|-- src/smart-engine/             Soft Transfer consent
|-- backend/                      Budget Worker: control plane (V2)
`-- ios/                          Widget / Watch (brand-driven)
```

| Concern | Contract |
|---------|----------|
| Build-time brand | `APP_BRAND` / `EXPO_PUBLIC_APP_BRAND` → `brands/symply-budget/` |
| Budget mode | `features.budget = full`; House `minimal` |
| Financial SoT (V2) | Encrypted SQLite + op log on device |
| Backend (V2) | Identity, membership, devices, signaling, ZK mailbox, TURN — **not** ledger SoT |
| UI | Keep `src/screens/budget/`; swap repositories under `src/api/budget.ts` facade |
| Soft Transfer | Consent via `src/smart-engine/`; summaries from local projections |
| Shared shell | No Login / Widget / Watch forks |

---

## 2. Brand Contract

| Item | Value |
|------|-------|
| Brand id | `symply-budget` |
| Display | Symply Budget |
| Scheme | `simplebudget` |
| Feature modes | `budget: "full"`, widget/watch/googleDrive per brand pack |
| V2 flag (planned) | Local-first client flag per Implementation plan |

Source: `brands/symply-budget/brand.cjs`, `brand.ts`, `tokens.json`.

---

## 3. Data And API Boundaries

| Domain | V2 boundary |
|--------|-------------|
| Auth | Shared User / JWT (bridge) → managed IdP target; SecureStore tokens |
| Budget ledger | Local repositories; no financial D1 writes on V2 path |
| Control plane | New `/v2/households…` metadata, mailbox, signaling (see V2 TRD §12) |
| Legacy financial routes | `backend/src/routes/budget.ts` unused for V2-flagged clients; cleanup later |
| Budget analysis / AI | Device-local draft + BYOK; confirm before signed op; paid relay later |
| Soft Transfer | Packages from local aggregates; RELATIONSHIPS.md before new fields |
| Documents | Device-local images; not synced (V2 TRD D-21) |

Server-era `budget-analysis` services remain documented historically; V2 AI path is client-first BYOK per canonical TRD §13.

---

## 4. Build And Release

| Item | Contract |
|------|----------|
| Brand validation | `npm run validate:brand` when brand contracts change |
| Backend deploy | Control-plane changes: `deploy:budget:all` or `deploy:fleet`; staging **and** production |
| D1 | Metadata migrations only for V2; apply both envs |
| Secrets | `eval "$(./scripts/secrets/export-env.sh)"` — never print |
| Store readiness | EAS/OAuth/package questions remain open for public release |

---

## 5. Security And Privacy

- Device holds HDK; BE never receives plaintext financial content.
- ZK mailbox: opaque ciphertext only, ≤ 14 day TTL.
- Soft Transfer deny-by-default; no silent House reads.
- Telemetry excludes financial fields.
- Account recovery ≠ data recovery.

---

## 6. QA Gates

| Change type | Gate |
|-------------|------|
| Doc-only | Markdown links in [Buget v2](../../requirements/Buget%20v2/) |
| Local-first core | Unit tests crypto/oplog |
| Budget UI rewire | Airplane-mode core flows |
| Control plane | Staging+prod deploy; mailbox TTL; no financial payload asserts |
| Brand | `npm run validate:brand` |

---

## 7. Docs Maintenance

| Change | Update |
|--------|--------|
| Product/architecture | Canonical [BRD](../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md) / [TRD](../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) first |
| App boundary | This file + [BRD.md](./BRD.md) |
| Features | [features/README.md](./features/README.md) |
| Soft Transfer fields | [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md) before coding |
| Phases / files | [Implementation](../../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md) |

---

## 8. Open Technical Questions

| # | Question | Status |
|---|----------|--------|
| T1 | SQLCipher binding choice (P0 spike) | open |
| T2 | WebRTC + EAS config | open |
| T3 | IdP vendor vs JWT bridge timeline | open |
| T4 | Production EAS / Android package for store | open (pre-existing) |
| T5 | Soft Transfer v1 fields from local summary | open |

---

## 9. Acceptance

- [x] App TRD points at canonical V2 TRD.
- [x] Device SoT + control-plane BE stated.
- [x] UI continuity + Shared User preserved.
- [ ] Spikes closed before Phase 1/3 gates.
