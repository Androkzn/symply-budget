# Features - Symply Ecosystem Shared Contracts

Shared capabilities live here for discoverability. These are platform contracts, not storefront product features. Child app feature indexes should link to this page for shared behavior and keep product feature detail in their own requirement docs.

App scope: [BRD](../BRD.md) | [TRD](../TRD.md) | [Design](../design.md).

## Product Boundary

| Feature area | Ecosystem mode |
|--------------|----------------|
| Shared User | Platform contract for identity, profile basics, app entitlements, and AI status. |
| Smart Engine | Platform contract for memory, package transfer, consent, AI gateway direction, and async job boundary. |
| Soft Transfer | Platform contract for versioned cross-app package export/import with consent. |
| Brand/token ecosystem | Platform contract for build-time brands, generated tokens, native companions, EAS, and shared shell. |
| Shared Worker/D1 | Platform contract for backend identity, entitlement, consent, transfer events, AI AuthZ, and migrations. |
| No-fork shared surfaces | Platform contract for auth, integrations, navigation, Widget, Watch, settings primitives, and AI gates. |
| Storefront product features | Child apps only; do not define them here. |

## Active Specs

| Capability | Spec / plan | Implementation / as-built | Status |
|------------|-------------|---------------------------|--------|
| Brand/token ecosystem | [Brand token ecosystem plan](../../../design/Brand_Token_Ecosystem_Plan.md) | `brands/`, `src/brand/`, `scripts/build-tokens.mjs`, EAS profiles | active |
| White-label brand packs | [WHITELABEL_TEMPLATE](../../../design/WHITELABEL_TEMPLATE.md) | `brands/<id>/brand.cjs`, `brand.ts`, `tokens.json`, assets | active |
| New brand runbook | [NEW_BRAND_CHECKLIST](../../../design/NEW_BRAND_CHECKLIST.md) | Brand validation and design build scripts | active |
| Shared User | [Research](../../../design/Shared_User_Smart_Engine_Research.md) | `src/shared-user/`; backend Shared User contract planned | partial |
| AI entitlement | [Implementation plan](../../../design/Shared_User_Smart_Engine_Implementation_Plan.md) | `useAIEntitlement`, `AIAccessGate`, Worker AuthZ follow-on | partial |
| Smart Engine / Soft Transfer | [Research](../../../design/Shared_User_Smart_Engine_Research.md) · [Data Bridge plan](../../../design/Ecosystem_Data_Bridge_Plan.md) | `src/smart-engine/`, `src/features/ecosystem/`, `backend/src/routes/smart-engine.ts`, `backend/src/services/soft-transfer/` | live (House↔Budget) |
| Cross-app relationship registry | [RELATIONSHIPS](../../../ecosystem/RELATIONSHIPS.md) | Package intent table and no-fork surface registry | active |
| Naming and ids | [NAMING](../../../ecosystem/NAMING.md) | Brand ids, schemes, bundle patterns, Worker naming | active |
| Fleet placement | [FLEET](../../../ecosystem/FLEET.md) | `_ecosystem` plus app registry | active |
| Migration readiness | [MIGRATION](../../../ecosystem/MIGRATION.md) | Per-app join modes and readiness gates | active |

## Capability Index

| Capability | Code anchors | Requirement / delivery notes |
|------------|--------------|------------------------------|
| Shared User profile | `src/shared-user/`, `backend/` | Expose canonical `user_id`, profile basics, app entitlements, and AI status from shared backend. |
| App entitlements | `backend/`, `src/shared-user/` | Determine which brands/products an account can open; separate from feature flags and subscriptions. |
| AI entitlement | `src/hooks/useAIEntitlement.ts`, `src/components/ai/AIAccessGate.tsx`, `backend/` | Account `ai.status` gates AI UI, client job creation, and Worker AI routes. |
| Smart Engine transfer | `src/smart-engine/`, `src/features/ecosystem/`, `backend/src/services/soft-transfer/` | House↔Budget packages with consent, prepare, export, import; no direct sibling database access. |
| Consent registry | `backend/` transfer_consents + Settings → Data sharing | Record package, source, destination, purpose, expiry, revocation, and transfer events. |
| Brand validation | `brands/`, `scripts/validate-brand.cjs` | Required when brand ids, native ids, assets, integrations, or feature modes change. |
| Token generation | `brands/_shared/`, `brands/<id>/tokens.json`, `scripts/build-tokens.mjs` | Generate RN and Swift tokens; do not hand-edit generated outputs. |
| Shared shell | `src/navigation/tabRegistry.ts`, `app/(tabs)/` | Phone and iPad navigation derive from one brand-driven registry. |
| Shared auth | `src/screens/auth/`, `src/api/`, `src/stores/` | Brand assets and OAuth ids only; no per-brand auth forks. |
| Shared integrations | `src/services/`, brand integrations | Google/Apple/Drive use shared flows with per-brand credentials/schemes. |
| Widget/Watch | `ios/`, `modules/widget-sync/`, `src/services/` | One native companion implementation consumes generated tokens and brand native ids. |
| Shared Worker/D1 | `backend/` | Shared contract tables/routes/migrations for identity, entitlement, consent, transfer, and AI AuthZ. |

## Soft Transfer Package Index

| Package id | Source | Destination | Contents stance | Consent | Status |
|------------|--------|-------------|-----------------|---------|--------|
| `profile.core.v1` | Shared User | Entitled House↔Budget | Name, locale, timezone | Soft Transfer consent | live |
| `prefs.notifications.v1` | Shared User | Entitled apps | Quiet hours and notification channel preferences | account preference approval; no app-to-app silent import | target |
| `house.property.v1` | Symply House | Symply Budget | Non-sensitive property/household summary | explicit package consent | live |
| `budget.summary.v1` | Symply Budget | Symply House | Budget glance/summary only | explicit package consent | live |
| `ai.memory.v1` | Smart Engine | Entitled apps | User-approved memory facts only | explicit memory/AI consent; AI on | future |
| Health packages | Symply Health | Any app | None approved | denied | blocked |

Add or change package rows in [RELATIONSHIPS](../../../ecosystem/RELATIONSHIPS.md) before coding cross-app product behavior.

## Shared Surface Index

| Surface | Fork policy | Notes |
|---------|-------------|-------|
| Login/Register | Do not fork | Brand via assets, tokens, display name, OAuth ids. |
| Google/Apple auth | Do not fork | Brand-specific credentials and capabilities only. |
| Google Drive / cloud picker | Do not fork | Brand-specific clients/schemes; shared UX and services. |
| Tab shell | Do not fork | Brand tabs feed one registry. |
| AI gates | Do not fork | Account entitlement plus product scope; manual fallback required. |
| Settings/privacy | Do not fork core primitives | Product sections allowed; shared account/AI/transfer patterns. |
| Widget | Do not fork SwiftUI layout | Brand native ids and generated tokens only. |
| Watch | Do not fork SwiftUI layout/sync | Brand native ids and generated tokens only. |
| Notification routing | Do not fork routing service | Product behavior behind feature modes. |

## Spec Hygiene

When adding or changing a shared platform capability:

1. Update [BRD](../BRD.md) if the business/platform promise changes.
2. Update [TRD](../TRD.md) if the technical contract, API, schema, or verification gate changes.
3. Update this index with links, status, and code anchors.
4. Update [RELATIONSHIPS](../../../ecosystem/RELATIONSHIPS.md) for cross-app packages or relationship changes.
5. Update [FLEET](../../../ecosystem/FLEET.md), [NAMING](../../../ecosystem/NAMING.md), or [MIGRATION](../../../ecosystem/MIGRATION.md) only when identity, fleet status, naming, or migration readiness changes.

When adding a child product feature, do not put the feature spec here. Link the child app feature index to the relevant shared contract row and create/update the focused feature docs under `documents/requirements/<Feature>/`.

## Templates

- [Feature requirement template](../../../requirements/Templates/Feature%20Requirenment%20Template.md)
- [TRD template](../../../requirements/Templates/TRD_Template.md)
- [Implementation template](../../../requirements/Templates/Implementation_Template.md)
