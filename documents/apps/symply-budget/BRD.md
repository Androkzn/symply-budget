# Symply Budget - Business Requirements Document

> **App-level document only.** Deep V2 product requirements live in the canonical pack under `documents/requirements/Buget v2/`. Feature index: [features/README.md](./features/README.md).

| Field | Value |
|-------|-------|
| **Doc type** | App BRD |
| **App id** | `simple-budget` |
| **Display name** | Symply Budget |
| **Role** | child app / first House feature extraction |
| **Parent platform** | `_ecosystem` |
| **Template parent** | `simple-house` |
| **Status** | `in-progress` (V2 local-first) |
| **Version** | `v0.3` |
| **Created** | 2026-07-12 |
| **Last updated** | 2026-08-10 |
| **TRD** | [TRD.md](./TRD.md) |
| **Feature index** | [features/README.md](./features/README.md) |
| **Canonical V2 BRD** | [Symply_Budget_BRD_v2.0.md](../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md) |

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-07-12 | Initial placeholder BRD |
| v0.2 | 2026-07-12 | Expanded app-level Budget product scope, House boundary, data sharing stance |
| v0.3 | 2026-08-10 | Point to Budget V2 local-first canonical BRD; greenfield / UI freeze / Shared User |

---

## 1. Purpose

### 1.1 One-Liner

Symply Budget is the full household budgeting product for planned spend, actual spend, bills, debt, and savings context — on the same Symply Ecosystem Shared User account as House, with a **local-first** data plane (V2).

### 1.2 Problem

House needs a light money glance; a full budget product needs deeper offline-capable flows without bank linking and without the company holding the household ledger.

### 1.3 Product Promise

- Monthly household money picture on each member’s device.
- Almost fully offline after first sign-in; company cannot read financial content.
- Shared User across the fleet; Soft Transfer only by consent (summaries).
- Familiar Budget UI — V2 changes the data layer, not the shell.
- Core paths work with AI off.

### 1.4 Success Metrics

| Outcome | Signal |
|---------|--------|
| Budget ships as its own product | `features.budget = full`, Budget-first tabs |
| House stays focused | House remains `features.budget = minimal` |
| Local-first V2 | Core flows pass airplane-mode; no financial SoT on D1 |
| Sharing is consented | Soft Transfer packages only |
| AI-off works | Manual entry and review-before-save |

Detailed metrics: [BRD v2.0 §4](../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md).

---

## 2. Fleet Placement

| Item | Value |
|------|-------|
| Project | Symply Ecosystem |
| App role | Child storefront; full budget product |
| Brand id | `symply-budget` (app id `simple-budget`) |
| Template parent | Symply House |
| Shared login | Required Shared User `user_id` |
| Shared contracts | Shared User, Soft Transfer, Smart Engine, AI entitlement direction |
| Data sharing | Opt-in Soft Transfer summaries only |
| V2 data plane | Device SoT + Cloudflare metadata/ZK mailbox — see [TRD v2.0](../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) |

---

## 3. Scope (app-level)

### 3.1 In scope

- Full Budget brand mode and existing Budget navigation/shell.
- V2 local-first ledger (encrypted SQLite + op log + sync) per canonical BRD.
- Bills/savings/mortgage product surfaces as linked in [features/README.md](./features/README.md), rewired to local SoT over time.
- Opt-in Soft Transfer; Widget/Watch glances from local projections.
- Greenfield cutover (testers only; no production migration).

### 3.2 Out of scope

- Forked auth, Widget, Watch, or design system.
- Silent sibling-app reads.
- Bank aggregation, tax filing, financial advice.
- Big UI redesign as part of V2.
- Feature catalogs inside this app BRD — use V2 BRD + feature index.

### 3.3 Dependencies

| Dependency | Why |
|------------|-----|
| Canonical V2 BRD/TRD | Product + technical SoT for local-first |
| `_ecosystem` Shared User | Fleet identity |
| `brands/symply-budget/` | Build identity and feature modes |
| Soft Transfer contracts | Cross-app summaries |
| Cloudflare Budget Worker | Control plane only after V2 (not financial SoT) |

---

## 4. Data And Sharing

| Data class | Stance |
|------------|--------|
| Auth / profile | Shared User |
| Budget ledger | **On-device encrypted replica** (V2); not D1 SoT |
| Control metadata | Cloudflare (membership, devices, opaque mailbox) |
| Soft Transfer | Opt-in summaries from local projections |
| AI | Optional BYOK drafts; confirm before ledger write |

---

## 5. Constraints

- One platform repo; one app BRD + one app TRD; deep specs in requirements pack.
- `simple-budget` / `symply-budget` = `full`; House = `minimal`.
- No secrets in docs/commits.
- Pre-release: wipe/reinstall acceptable for testers.

---

## 6. Risks (app-level)

| Risk | Mitigation |
|------|------------|
| Scope leaks into House | Keep House minimal; full product here |
| Privacy claim vs relay/AI | Canonical wording in V2 BRD; legal review |
| FE/BE confusion during cutover | Feature flag; financial D1 unused for V2 path |
| Soft Transfer overreach | Versioned packages + consent |

---

## 7. Open Questions

See [BRD v2.0 §12](../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md). Store/EAS identity questions from v0.2 remain open for public release.

---

## 8. Acceptance

- [x] Points to canonical V2 BRD.
- [x] Shared User + Soft Transfer + House boundary preserved.
- [x] Local-first / greenfield / UI freeze stated.
- [ ] Product/security sign-off on V2 pack before GA.
