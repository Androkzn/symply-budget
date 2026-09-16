# Features - Symply Budget

App scope: [BRD](../BRD.md) | [TRD](../TRD.md).  
This is the feature index. Keep app-level docs general; link detailed feature specs and as-built notes here.

## Budget V2 (local-first) — canonical

| Doc | Role |
|-----|------|
| [Symply_Budget_BRD_v2.0.md](../../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md) | Product requirements |
| [Symply_Budget_TRD_v2.0.md](../../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) | Architecture / sync / control plane |
| [Symply_Budget_V2_Implementation.md](../../../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md) | Phased build plan |
| [Buget v2 README](../../../requirements/Buget%20v2/README.md) | Pack index + superseded drafts |

V2 stance: device is financial SoT; Cloudflare holds metadata + ZK mailbox only; keep existing UI; greenfield (testers only).

## Product Boundary

Symply Budget owns the full standalone budget product. Symply House keeps lightweight home-related budget only and may later seed Budget through consented Soft Transfer packages.

| Feature area | Budget mode |
|--------------|-------------|
| Full household budget | Core Budget product |
| Bills and recurring obligations | Budget product surface; implementation may reuse utilities/bills internals |
| Savings and registered accounts | Budget product surface |
| Long-term home maintenance money | Budget product surface with House context only by consent |
| Shared account, Smart Engine, AI entitlement, Widget/Watch shell | `_ecosystem` / shared platform |
| House lightweight budget | Linked sibling scope; do not redefine here |

## Active Specs

| Feature | Spec | Implementation / as-built | Status |
|---------|------|---------------------------|--------|
| **Budget V2 local-first** | [BRD v2.0](../../../requirements/Buget%20v2/Symply_Budget_BRD_v2.0.md) · [TRD v2.0](../../../requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md) | [Implementation](../../../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md) · [live plan](../../../requirements/Buget%20v2/budget-local-first-implementation-plan-v2.md) · `src/features/budget/local/` · `@symply/local-first` | Phases 0–5 as-built; scale Stages 0–6 as-built (quiet Hermes re-take owed). Programme branch `budget-v2` |
| Budget home brand shell | App docs plus this index | `src/features/budget/screens/BudgetHomeScreen.tsx` | ready-for-test |
| Budget module and brand split | App docs plus this index | [BUDGET_FEATURE_SUMMARY](../../../requirements/as-built/BUDGET_FEATURE_SUMMARY.md) | as-built / hardening |
| Bills and recurring obligations | [Bills_TRD](../../../requirements/as-built/bills/Bills_TRD.md) | [Bills_Implementation_Plan](../../../requirements/as-built/bills/Bills_Implementation_Plan.md) | planned / partial |
| Savings and registered accounts | [Savings_TRD](../../../requirements/as-built/savings/Savings_TRD.md) | [Savings_Implementation_Plan](../../../requirements/as-built/savings/Savings_Implementation_Plan.md) | planned / partial |
| Long-term maintenance money | [long-term-budget-maintenance-plan](../../../requirements/as-built/long-term-budget-maintenance-plan.md) | [long-term-budget-maintenance-plan](../../../requirements/as-built/long-term-budget-maintenance-plan.md) | plan |
| Mortgage tracking (Canadian) | [Mortgage_Implementation_Plan](../../../requirements/as-built/mortgage/Mortgage_Implementation_Plan.md) | `src/features/mortgage/`, `src/screens/budget/mortgage/`, `backend/src/services/mortgage/`, migrations 0112–0115 | shipped (Phases 0–5) |
| Receipt recognition v2 (chips, attached fees, store, tax pill) | [decisions](../../../requirements/budget-receipt-recognition-v2.md) · [MASTER_PLAN](../../../requirements/budget-receipt-recognition-v2/MASTER_PLAN.md) | `ReceiptScanService`, `BudgetReceiptScanScreen`, `scan-grocery-receipt` prompt — Worker on `main` (0159 + fleet deployed), review UI on `budget-v2` | in progress |
| Bulk purchases (stock-up spreading over months) | [BRD](../../../requirements/Bulk%20Purchases/Bulk_Purchases_BRD.md) · [TRD](../../../requirements/Bulk%20Purchases/Bulk_Purchases_TRD.md) | [Implementation plan](../../../requirements/Bulk%20Purchases/Bulk_Purchases_Implementation.md) · `src/features/budget/bulk/`, `BudgetBulkPurchaseSection`, `localBudgetApi.getBulkSuggestion` | v1 built on `budget-v2` (2026-09-11); simulator + two-device verification pending |

## Reliability verification

[Sync reliability audit — 2026-09-10](sync-reliability-audit-2026-09-10.md) records fixes, regression tests and the status of physical-device validation.

## Capability Index

| Capability | Code anchors | Requirement / delivery notes |
|------------|--------------|------------------------------|
| Budget app shell | `brands/symply-budget/`, `app/(tabs)/budget.tsx`, `src/navigation/BudgetNavigator.tsx` | Budget-first brand, `features.budget = full`, House remains `minimal` |
| Budget home shell | `src/features/budget/screens/BudgetHomeScreen.tsx`, `app/(tabs)/index.tsx` | Month teaser and Open Budget CTA for the Budget brand |
| Budget dashboard / planned / spendings | `src/screens/budget/`, `src/features/budget/`, `src/api/budget.ts`, backend budget routes/services | [BUDGET_FEATURE_SUMMARY](../../../requirements/as-built/BUDGET_FEATURE_SUMMARY.md) |
| Bills / recurring obligations | `src/screens/utilities/`, `src/api/utilities.ts`, backend utilities routes/services | [Bills_TRD](../../../requirements/as-built/bills/Bills_TRD.md) |
| Document import for bills/budget data | Platform file/photo/Drive pickers, R2-backed Worker routes | See Bills and Savings implementation plans; review-before-save required |
| Savings and registered accounts | Budget savings screens/API planned by linked specs | [Savings_TRD](../../../requirements/as-built/savings/Savings_TRD.md), [Savings_Implementation_Plan](../../../requirements/as-built/savings/Savings_Implementation_Plan.md) |
| Long-term maintenance/capital forecast | Budget planning surfaces, report/task cost context | [long-term-budget-maintenance-plan](../../../requirements/as-built/long-term-budget-maintenance-plan.md) |
| House -> Budget Soft Transfer | `src/smart-engine/`, shared consent contracts | See [RELATIONSHIPS](../../../ecosystem/RELATIONSHIPS.md); package fields must be added there before coding |
| Widget / Watch budget glances | shared companion services and Budget brand ids | Keep glance-only; do not fork native companion code |

## Soft Transfer

House -> Budget packages are opt-in and versioned. Feature TRDs must not redefine Shared User or invent silent sibling reads. After V2, summary packages are computed from **local** projections (not D1 ledger) — see V2 BRD BR-080–082.

**Brand shell (2026-07):** `SoftTransferImport` screen is registered in `BudgetNavigator` when `isFullBudget()`. The current entry point is Budget Settings -> Import from Symply House. This is placeholder UI; packages are not wired yet.

Current intended direction:

| From | To | Package | Status |
|------|----|---------|--------|
| `simple-house` | `simple-budget` | Household money context / home-related budget seeds | TBD in [RELATIONSHIPS](../../../ecosystem/RELATIONSHIPS.md) |
| `simple-budget` | `simple-house` | None planned | none |

Parallel tracks: [PARALLEL_WORK.md](../../../ecosystem/PARALLEL_WORK.md) | [migration.md](../migration.md).

## Spec Hygiene

When adding or changing a Budget feature:

1. Create or update a focused doc under `documents/requirements/<Feature>/` if product/technical scope changes.
2. Use the aligned templates:
   - [Feature requirement template](../../../requirements/Templates/Feature%20Requirenment%20Template.md)
   - [TRD template](../../../requirements/Templates/TRD_Template.md)
   - [Implementation template](../../../requirements/Templates/Implementation_Template.md)
3. Add or update a row in this index.
4. Keep [BRD](../BRD.md) and [TRD](../TRD.md) app-level.
5. Update [RELATIONSHIPS](../../../ecosystem/RELATIONSHIPS.md) before coding cross-app data packages.

## Current Follow-Ups

- Savings Projection: [cashflow scenario requirements](../../../requirements/Savings%20Projection/Savings_Projection_BRD.md), [technical contract](../../../requirements/Savings%20Projection/Savings_Projection_TRD.md), [2026-09-10 audit](./savings-projection-audit-2026-09-10.md). Three-scenario local implementation; device-data reconciliation and native release pending.

- [ ] Define House -> Budget Soft Transfer package v1 fields.
- [ ] Replace placeholder Budget EAS project id before production store release.
- [ ] Decide Android package before store lock.
- [ ] Verify Budget-specific OAuth/Firebase/Sentry console assets.
- [ ] Normalize older as-built Budget/Bills/Savings docs into formal feature folders when those areas reopen.
