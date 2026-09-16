# Symply Budget

| Field | Value |
|-------|-------|
| **Brand id** | `simple-budget` |
| **Display** | Symply Budget |
| **Role** | child app #2; first House feature extraction |
| **Parent platform** | [Symply Ecosystem](../_ecosystem/README.md) |
| **Template parent** | [Symply House](../symply-house/README.md) |
| **Fleet** | [FLEET.md](../../ecosystem/FLEET.md) |
| **Brand pack** | `brands/symply-budget/` |
| **Status** | `ready-for-test` |

> **AI read order:** this file -> [BRD](./BRD.md) -> [TRD](./TRD.md) -> [features](./features/README.md) -> **V2 pack** [Buget v2](../../requirements/Buget%20v2/README.md). Read `_ecosystem` only for shared contracts. Do not turn this README into a feature catalog.

## One-Liner

Symply Budget is the dedicated full household budgeting app for planned spending, bills, savings, registered accounts, and long-term home cost planning, built from the same Symply Ecosystem account and platform as Symply House. **V2** moves the financial ledger to an encrypted on-device store with peer sync (see [BRD v2.0](../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md)).

## Product Boundary

| Area | App rule |
|------|----------|
| Core product | Own the standalone/full budget product: household budget command center, planned vs actual spending, bills, savings, registered accounts, document import, and long-term maintenance money. |
| House boundary | Symply House keeps only lightweight home-related budget context and optional future sync. House must not own the standalone Budget product. |
| Shared platform | Auth, Shared User, Smart Engine, brand system, Worker, Google/Apple auth, Google Drive, Widget, and Watch stay shared and brand-driven. |
| AI | Optional assistant/import layer. Manual entry and review-before-save paths must work with AI off. |
| Data sharing | Opt-in only through Soft Transfer packages and explicit consent. No silent reads from House or sibling apps. |

## Docs

| Doc | Use |
|-----|-----|
| [BRD.md](./BRD.md) | App-level business/product requirements and boundaries |
| [TRD.md](./TRD.md) | App-level technical contracts, build, data, and QA |
| [V2 BRD](../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md) | Canonical local-first product requirements |
| [V2 TRD](../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) | Canonical local-first architecture |
| [V2 Implementation](../../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md) | Phased build plan |
| [design.md](./design.md) | Brand, UX, native companion, and trust design notes |
| [migration.md](./migration.md) | House extraction status, parity matrix, and release readiness |
| [features/README.md](./features/README.md) | Feature index linking to detailed requirements/as-built docs |

## Code Map

| Surface | Anchor |
|---------|--------|
| Brand config | `brands/symply-budget/brand.cjs`, `brands/symply-budget/brand.ts`, `brands/symply-budget/tokens.json` |
| Dynamic app identity | `app.config.ts`, `app.json`, `eas.json` |
| Routes | `app/`, especially `app/(tabs)/budget.tsx`, `app/(tabs)/index.tsx` (Budget home), and brand-selected tab shell |
| Budget module | `src/features/budget/`, `src/screens/budget/`, `src/navigation/BudgetNavigator.tsx` |
| Bills and recurring money | `src/screens/utilities/`, `src/api/utilities.ts`, backend utilities routes/services |
| Savings and registered accounts | Budget feature docs and planned `savings` routes/screens |
| Shared user / Smart Engine | `src/shared-user/`, `src/smart-engine/` |
| Backend (legacy financial) | `backend/src/routes/budget.ts`, utilities routes — unused as SoT on V2 path |
| Backend (V2 control plane) | Household DO / mailbox / signaling — see V2 TRD §12 |
| Local-first core (target) | `packages/local-first/` or `src/local-first/` |
| Widget / Watch | Brand-driven iOS companion ids from `brands/symply-budget/brand.cjs` |

## Current Brand Contract

| Item | Value |
|------|-------|
| `APP_BRAND` | `simple-budget` |
| Display name | Symply Budget |
| URL scheme | `simplebudget` |
| iOS bundle | `fox-family.simple-budget` |
| Android package | `com.anonymous.simplebudget` currently in `brand.cjs`; prefer `com.foxfamily.simplebudget` before store lock if not already published |
| EAS production channel | `simple-budget-production` |
| EAS project id | Placeholder in `brand.cjs`; replace before production store release |
| Budget mode | `full` |
| Default visible tabs | Budget (initial), Home, AI Housekeeper/Mira, More |
| Widget / Watch | enabled by brand pack |
| Google Drive | enabled by brand pack |

## Run locally

```bash
npm run start:budget
# or: APP_BRAND=symply-budget EXPO_PUBLIC_APP_BRAND=symply-budget npm start
```

## Current decisions

| Decision | Value |
|----------|-------|
| Product ownership | Symply Budget owns the full household budget product. |
| House split | Symply House keeps lightweight home-related budget only. |
| Migration mode | Extract from House/platform budget surfaces; no separate donor repo. |
| Store direction | New Budget listing and new iOS bundle `fox-family.simple-budget`; Android package decision should be finalized before publish. |
| Shared account | Same Shared User identity as House and siblings. |
| Sync direction | House -> Budget only when the user opts into a versioned Soft Transfer package. |

## Do Not

- Do not fork Login, Google/Apple auth, Google Drive, Widget, Watch, or backend account identity for Budget.
- Do not implement Budget product work in `_archive/` or a donor repo.
- Do not put feature-level requirements in the app BRD/TRD; link them from [features/README.md](./features/README.md).
- Do not let House grow back into the standalone Budget product.
- Do not define silent cross-app data sharing.
