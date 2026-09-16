# Symply Budget - migration

| Field | Value |
|-------|-------|
| Brand id | `simple-budget` |
| Display | Symply Budget |
| Legacy/current path | Extracted from House/platform Budget surfaces; no separate donor repo |
| Legacy stack | Expo RN feature module in Symply Ecosystem |
| Mode | extract |
| Store continuity | New Budget listing; iOS bundle `fox-family.simple-budget`; Android package decision open before store lock |
| Status | `ready-for-test` - full Budget brand runnable; release identity and real Soft Transfer remain open |

## Locked Decisions

| Decision | Value |
|----------|-------|
| Project | Symply Ecosystem |
| Platform repo | `~/Desktop/Symply Ecosystem/Simply Ecosystem/` |
| Implementation rule | Build in this repo only; no donor repo and no `_archive` implementation. |
| Shared auth | Shared User; no second account stack. |
| Product owner | Symply Budget owns the standalone/full budget product. |
| House boundary | Symply House keeps lightweight home-related budget context only. |
| Budget mode | `simple-budget` uses `features.budget = full`; `simple-house` uses `minimal`. |
| Sync direction | Future House -> Budget import only through opt-in Soft Transfer packages. |

## Run Locally

```bash
npm run start:budget
# or: APP_BRAND=symply-budget EXPO_PUBLIC_APP_BRAND=symply-budget npm start
```

## Current Done

- [x] Separate Budget Worker/D1 deployed (staging + production).
- [x] House→Budget scoped migrate for seed emails (households + budget/savings kept).
- [x] Budget brand API points at Budget Worker.
- [x] EAS project `@androkzn/symply-budget` linked.

- [x] Brand pack `features.budget = full` with Budget-first tabs and cold start on Budget.
- [x] Budget Home tab (`BudgetHomeScreen`) with month teaser and Open Budget CTA.
- [x] Full Budget stack registered when `isFullBudget()` for dashboard, spendings, savings, pension, bills, and wishes.
- [x] `SoftTransferImport` stub is reachable from Budget Settings in full Budget mode.
- [x] House kept `features.budget = minimal`, including write/deep-link/assistant leak fixes.
- [x] `BudgetNavigator` / `BudgetScreen` gate stack and sub-tabs through the Budget feature module.
- [x] Deep-link and notification guards collapse full-only targets on minimal mode.
- [x] Brand-aware initial route lands Budget on the Budget tab.
- [x] Brand assets live under `brands/symply-budget/src/assets/`.
- [x] Local Budget launcher exists through `npm run start:budget`.
- [x] App docs identify Budget as the full product and House as lightweight only.

## Inventory

| Area | Legacy/current location | Platform target | Notes |
|------|-------------------------|-----------------|-------|
| Auth | Shared platform auth screens/stores | shared auth | Do not fork Login/Register. |
| Brand identity | `brands/symply-budget/` | same | EAS id placeholder and Android package need release decision. |
| Core budget screens | `src/screens/budget/`, `src/navigation/BudgetNavigator.tsx` | `src/features/budget/` plus existing screens during migration | Incremental move; avoid forked screen trees. |
| Budget home shell | `src/features/budget/screens/BudgetHomeScreen.tsx` | Budget brand shell | Ready for test. |
| Budget data/API | Budget routes/services/schema in backend | Worker/D1 budget domain | Full product owns app-domain data. |
| Bills/utilities | `src/screens/utilities/`, utilities backend routes/services | Budget feature surface where generalized bills are enabled | BC-specific property tax remains conditional. |
| Savings/registered accounts | Linked requirements/as-built docs | Budget domain routes/screens | Feature details live outside app BRD/TRD. |
| Soft Transfer | `SoftTransferImport`, `_ecosystem`, `src/smart-engine/` | consented package catalog | Stub UI exists; House -> Budget package fields still open. |
| Push / Widget / Watch | shared companions, Budget brand ids | shared companions | Do not fork native companion code. |
| Payments / IAP | shared entitlement direction | shared entitlements | No separate billing identity in app docs. |
| Sensitive APIs | financial document/import flows | explicit privacy plan | Financial PII; no raw logs or public URLs. |

## Parity Matrix

| Capability | Must | Should | Later | Drop | Platform target |
|------------|------|--------|-------|------|-----------------|
| Budget brand pack registered | [x] |  |  |  | `brands/symply-budget/` |
| Full Budget navigation | [x] |  |  |  | `src/screens/budget/`, `src/features/budget/` |
| Budget-branded Home shell | [x] |  |  |  | `src/features/budget/screens/BudgetHomeScreen.tsx` |
| Full Budget stack gated by `isFullBudget()` | [x] |  |  |  | `BudgetNavigator`, `BudgetScreen` |
| House minimal mode preserved | [x] |  |  |  | `brands/symply-house/brand.cjs` |
| Soft Transfer stub UI | [x] |  |  |  | `SoftTransferImport`, Budget Settings entry |
| Bills / recurring obligations | [ ] | [x] |  |  | utilities/bills feature docs and Budget stack |
| Savings / registered accounts | [ ] | [x] |  |  | savings feature docs and Budget stack |
| Long-term maintenance money | [ ] | [x] |  |  | budget planning feature docs |
| Soft Transfer packages wired from House | [ ] | [x] |  |  | `src/smart-engine/`, `_ecosystem` package catalog |
| Move Budget screens into `src/features/budget/` | [ ] | [x] |  |  | incremental |
| Store display as Symply Budget | [ ] |  | [x] |  | App Store / Play Console |
| Replace placeholder EAS project id | [ ] | [x] |  |  | `brands/symply-budget/brand.cjs`, EAS |
| Confirm Android package strategy | [ ] | [x] |  |  | `brand.cjs`, store setup |
| Confirm Budget-specific OAuth/Firebase/Sentry assets | [ ] | [x] |  |  | brand integrations and consoles |

## Identity

| Item | Value |
|------|-------|
| iosBundleId | `fox-family.simple-budget` |
| androidPackage | `com.anonymous.simplebudget` currently; prefer `com.foxfamily.simplebudget` before publish if not locked |
| scheme | `simplebudget` |
| Firebase | Budget-specific app/client setup required before production release |
| Sentry | Budget project/release strategy required before production release |
| OAuth clients | Brand pack currently has configured clients; verify/replace with Budget-owned clients before release |
| EAS profiles | `<brand-id>-development`, `<brand-id>-preview`, `<brand-id>-production` |
| EAS project id | Placeholder currently present; must be replaced before store release |

## Shared User / Data

- Existing users: use Shared User identity; no second account or re-auth fork.
- Data migration: Budget is an extraction from existing platform Budget surfaces, not a donor migration. Existing budget data remains in platform domain tables/routes and is exposed by brand mode.
- House data import: future only, from House -> Budget, versioned package, explicit consent, visible review.
- Soft Transfer packages: see [RELATIONSHIPS](../../ecosystem/RELATIONSHIPS.md); package v1 fields remain open.
- AI-off path: manual budget, bills, and savings flows must remain usable.

## Exit Criteria

- [x] App docs are real, not placeholders.
- [x] `features.budget = full` brand ships in dev build.
- [x] House stays `features.budget = minimal`.
- [x] Budget home shell and local `npm run start:budget` launcher exist.
- [ ] `npm run validate:brand` passes after release-identity updates.
- [ ] Display Symply Budget in store metadata.
- [ ] Placeholder `easProjectId` replaced.
- [ ] Android package strategy finalized before store lock.
- [ ] Budget-specific OAuth/Firebase/Sentry assets confirmed.
- [ ] Soft Transfer House -> Budget package listed in [RELATIONSHIPS](../../ecosystem/RELATIONSHIPS.md) before implementation.
- [ ] Must-parity rows are implemented or explicitly deferred.

See [MIGRATION.md](../../ecosystem/MIGRATION.md).
