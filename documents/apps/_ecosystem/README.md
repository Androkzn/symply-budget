# Symply Ecosystem - shared contracts

| Field | Value |
|-------|-------|
| **Id** | `_ecosystem` |
| **Display** | Symply Ecosystem (shared) |
| **Role** | Platform contract docs - **not** a storefront app |
| **Template app** | [Symply House](../symply-house/README.md) |
| **Fleet registry** | [FLEET.md](../../ecosystem/FLEET.md) |
| **Relationship registry** | [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md) |

> **AI read order:** this file -> [BRD](./BRD.md) -> [TRD](./TRD.md) -> [features](./features/README.md). Storefront app docs must reference these contracts instead of redefining Shared User, Smart Engine, Soft Transfer, AI entitlement, or brand/token rules.

## One-Liner

Symply Ecosystem is the shared platform contract layer for all Symply apps: one repo, one account spine, one Worker/D1 family, one brand/token system, and no forked shared surfaces.

## Contract Boundary

| Area | Ecosystem rule |
|------|----------------|
| Shared User | One stable `user_id` across the fleet; child apps do not create their own account authority. |
| Smart Engine | Cross-app memory, transfer packages, consent, AI gateway direction, and async job boundary. |
| Soft Transfer | Opt-in, purpose-scoped, versioned package export/import only; no silent sibling reads. |
| Brand/token system | A brand is data in `brands/<id>/`; shared spacing/type/shell stay platform-owned. |
| Shared Worker/D1 | One Worker family and D1 migration history own shared auth, entitlement, consent, and gateway contracts unless a future product explicitly requires isolation. |
| AI entitlement | Account-level `ai.status` direction; core app workflows must work when AI is off. |
| No-fork surfaces | Login, register, Google/Apple auth, Google Drive, tab shell, Widget, Watch, settings primitives, and shared AI gates remain one implementation. |

## Docs

| Doc | Use |
|-----|-----|
| [BRD.md](./BRD.md) | Business and product requirements for platform contracts |
| [TRD.md](./TRD.md) | Technical contracts for shared identity, transfer, brand, Worker/D1, and AI |
| [design.md](./design.md) | Design rules for shared surfaces and brand-token behavior |
| [features/README.md](./features/README.md) | Capability index for shared contract specs and delivery status |

## Code Map

| Surface | Anchor |
|---------|--------|
| Brand resolution and tokens | `brands/`, `src/brand/`, `src/theme/`, `scripts/build-tokens.mjs` |
| Shared User client | `src/shared-user/` |
| Smart Engine client | `src/smart-engine/` |
| AI entitlement UI | `src/hooks/useAIEntitlement.ts`, `src/components/ai/AIAccessGate.tsx` |
| Shared navigation | `src/navigation/tabRegistry.ts`, `app/(tabs)/` |
| Shared auth and integrations | `src/screens/auth/`, `src/api/`, `src/services/` |
| Shared backend | `backend/` |
| Native companions | `ios/`, `modules/widget-sync/` |

## Current Platform Stance

| Contract | Status | Decision |
|----------|--------|----------|
| Brand packs | Active | New apps copy `brands/symply-house/` and specialize through brand data plus feature modules. |
| Shared User | Partial mobile spine | Backend contract target is `/shared-user/me` with canonical `user_id`, app entitlements, and `ai.status`. |
| AI entitlement | Partial | Existing House gates evolve into account-level ecosystem entitlement; AI off must be a polished path. |
| Soft Transfer | Live (House↔Budget) | Consent → prepare → signed envelope → import via `/smart-engine/*`; UI in House Settings + Budget Settings; D1 `softTransferEnabled` is authority. |
| Worker/D1 | Shared | Keep one Worker family for shared contracts; schema changes require D1 migrations and staging/production deploys when code changes. |
| Health data | Future strict mode | Deny-by-default until Health BRD/TRD and ecosystem consent controls explicitly allow packages. |

## Do Not

- Do not treat `_ecosystem` as a storefront brand or app to build.
- Do not fork Login, Google/Apple auth, Drive, Widget, Watch, tab shell, or AI gates per brand.
- Do not let child app BRDs redefine Shared User, Soft Transfer, AI entitlement, or platform brand rules.
- Do not implement cross-app behavior by querying another product's tables.
- Do not make AI required for core app CRUD, sync, manual workflows, notifications, Widget, or Watch basics.
- Do not put child product feature catalogs in these shared docs.

## Related

- [PROJECT.md](../../ecosystem/PROJECT.md)
- [NAMING.md](../../ecosystem/NAMING.md)
- [MIGRATION.md](../../ecosystem/MIGRATION.md)
- [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md)
- [Shared User + Smart Engine research](../../design/Shared_User_Smart_Engine_Research.md)
- [Shared User + Smart Engine implementation plan](../../design/Shared_User_Smart_Engine_Implementation_Plan.md)
- [Brand token ecosystem plan](../../design/Brand_Token_Ecosystem_Plan.md)
- [New brand checklist](../../design/NEW_BRAND_CHECKLIST.md)
