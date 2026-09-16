# Symply Ecosystem - Technical Requirements Document

> **Platform-contract document only.** Storefront apps depend on this TRD for shared identity, transfer, brand, backend, AI, and no-fork surface rules. Product-specific implementation details belong in child app TRDs and feature docs.

| Field | Value |
|-------|-------|
| **Doc type** | Ecosystem TRD |
| **App id** | `_ecosystem` |
| **Display name** | Symply Ecosystem |
| **Role** | Shared platform contracts |
| **Status** | `in-progress` |
| **Version** | `v0.4` |
| **Created** | 2026-07-12 |
| **Last updated** | 2026-07-14 |
| **BRD** | [BRD.md](./BRD.md) |
| **Design** | [design.md](./design.md) |
| **Capability index** | [features/README.md](./features/README.md) |

> Deep Shared User phases: [Shared_User_Smart_Engine_Implementation_Plan.md](../../design/Shared_User_Smart_Engine_Implementation_Plan.md) · [Ecosystem_Data_Bridge_Plan.md](../../design/Ecosystem_Data_Bridge_Plan.md) (**v1.16** greenfield — implement after A0). Brand architecture: [Brand_Token_Ecosystem_Plan.md](../../design/Brand_Token_Ecosystem_Plan.md).

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-07-12 | Initial platform TRD stub |
| v0.2 | 2026-07-12 | Added shared module and build contract notes |
| v0.3 | 2026-07-12 | Expanded real shared contracts for identity, Smart Engine, Soft Transfer, Worker/D1, AI entitlement, brand/tokens, and no-fork surfaces |
| v0.4 | 2026-07-14 | Align TransferEnvelope + brand runtime ids with Data Bridge v1.16 greenfield |

---

## 1. Architecture Placement

```text
Symply Ecosystem
├── brands/<id>/                 app identity, tokens, tabs, assets, OAuth/native ids
├── brands/_shared/              shared base tokens: spacing, radii, type, fonts
├── app/                         Expo Router routes and shared tab shell
├── src/brand/                   active brand resolution and assets
├── src/shared-user/             Shared User mobile client/types
├── src/smart-engine/            transfer catalog/client/types
├── src/features/<domain>/       product modules gated by brand features
├── src/screens/auth/            shared Login/Register/auth surfaces
├── src/components/ai/           shared AI entitlement gates
├── src/navigation/              shared tab registry and shell wiring
├── scripts/                     brand validation and token generation
├── backend/                     Worker, D1 migrations, auth, entitlements, consent, AI AuthZ
├── ios/                         shared host app, Widget, Watch targets
└── modules/widget-sync/         native sync bridge
```

| Concern | Contract owner |
|---------|----------------|
| Build-time brand | `APP_BRAND` and `EXPO_PUBLIC_APP_BRAND` resolve `brands/<id>/`. |
| Runtime account | Shared User payload from backend is source of truth for `user_id`, app access, and account AI status. |
| Product surfaces | Child apps expose feature modules through brand tabs and feature gates; shared shell stays platform-owned. |
| Cross-app data | Smart Engine package export/import with consent; no direct sibling table joins. |
| Backend contracts | Shared Worker routes/services plus D1 migrations own identity, entitlement, consent, transfer, and AI AuthZ. |
| Native companions | Widget and Watch use shared sources, generated brand tokens, and brand native ids. |

---

## 2. Implementation Status

| Layer | Current status | Target contract |
|-------|----------------|-----------------|
| Brand/token system | Active brand packs, validation, EAS profiles, generated token direction | Brand is data; generated RN/Swift tokens stay in sync; no screen forks for color or identity. |
| Shared User | Mobile spine/stubs exist; backend still mostly House-centric | `GET /shared-user/me` or equivalent returns canonical `user_id`, app entitlements, and `ai.status`. |
| AI entitlement | Existing AI gates and entitlement checks are partial | Account-level `ai.status` is enforced in UI, client job creation, and Worker AI AuthZ. |
| Smart Engine / Soft Transfer | House↔Budget live | `/smart-engine/*` consent/prepare/export/import + `src/features/ecosystem/` UI. |
| Worker/D1 | Shared Worker family exists | Shared contract tables/routes are versioned by migrations and deployed to staging + production when behavior changes. |
| Widget/Watch | Shared native code exists; brand token/ids are being hardened | One native implementation consumes generated brand tokens and brand native ids. |

Do not mark Shared User, AI entitlement, or Soft Transfer "done" until backend, mobile, tests, and docs satisfy the acceptance gates below.

---

## 3. Shared User Contract

### 3.1 Payload

Target backend payload:

```ts
type SharedUserMe = {
  user_id: string;
  profile: {
    name?: string;
    avatarUrl?: string;
    locale?: string;
    timezone?: string;
  };
  apps: Array<{
    brandId: 'simple-house' | 'simple-budget' | 'kaizen' | 'simple-language' | 'simple-health';
    status: 'entitled' | 'revoked';
  }>;
  ai: {
    status: 'off' | 'trial' | 'on';
    mode: 'platform' | 'byok';
    scopes?: Array<'chat' | 'import' | 'vision' | 'coach'>;
  };
};
```

### 3.2 Backend Requirements

| Requirement | Contract |
|-------------|----------|
| Canonical id | Existing and new users resolve to one stable `user_id` across brands. |
| App access | App entitlement rows determine whether a user can open a brand/product. |
| AI status | Account AI status is stored server-side and returned with Shared User claims. |
| Defaults | Existing users default to the current app entitlement and `ai.status = off` unless migration/billing state says otherwise. |
| Backward compatibility | Existing auth/session refresh remains valid while Shared User payload is added. |

### 3.3 Expected D1 Shape

Final schema may differ, but it must support these concepts:

| Table concept | Required fields |
|---------------|-----------------|
| `user_entitlements` | `user_id`, `ai_status`, `ai_mode`, timestamps |
| `user_app_entitlements` | `user_id`, `brand_id`, `status`, timestamps |
| consent registry | `user_id`, source brand, destination brand, package id, purpose, status, expiry, timestamps |
| transfer events | package id, version, source, destination, consent id, event status, checksum/hash or envelope id, timestamps |

---

## 4. AI Entitlement Contract

| Layer | Requirement |
|-------|-------------|
| UI | `AIAccessGate` and related hooks read account-level AI status; AI-off hides or disables AI chrome with manual alternatives. |
| Client services | AI job creation and model request clients must short-circuit when account AI is off. |
| Worker AuthZ | AI routes and async job creation must reject when `ai.status === 'off'`, then apply existing paid/BYOK/provider checks. |
| Billing integration | RevenueCat/Stripe/provider webhooks update entitlement state; apps do not hard-code plan names. |
| Settings | A master AI status surface can turn AI off; turning off cancels or blocks new AI jobs. |
| Audit | AI calls should be attributable to user, brand, feature scope, provider, and entitlement state. |

AI entitlement answers "may this account use ecosystem AI?" It does not replace feature flags, brand modes, app access, or subscription/payment rules.

---

## 5. Smart Engine And Soft Transfer Contract

### 5.1 Transfer Principles

- Product services publish export packages; they do not query sibling product tables.
- Importing apps validate package id, version, source brand, destination brand, consent id, and schema before writing local domain data.
- Consent is explicit, purpose-scoped, revocable, and recorded before export/import.
- Package schemas are versioned; breaking changes require a new package version.
- Health packages are denied until Health contracts approve stricter controls.

### 5.2 Package Envelope

```ts
type TransferEnvelope<TPayload> = {
  canon_version: 'jcs-rfc8785-v1';
  packageId: string;
  version: number;
  sourceBrandId: string; // runtime APP_BRAND: symply-house | symply-budget | …
  destinationBrandId: string;
  sourceContext: { householdId?: string; onboardingId?: string };
  destinationContext: { householdId?: string; onboardingId?: string };
  userId: string;
  consentId: string;
  consentVersion: number;
  purpose: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms; required
  envelopeId: string;
  schemaHash: string;
  signature: { alg: 'ES256'; kid: string; value: string };
  provenance: 'user_provided' | 'user_observed' | 'ai_derived';
  fieldManifest: string[];
  payload: TPayload;
};
```

Joined runtime brand ids for envelopes/consent: `symply-house`, `symply-budget`, `symply-kaizen` (docs/app ids `simple-house` / `simple-budget` remain for Bundle lineage — see NAMING.md).
### 5.3 v1 Package Registry

| Package id | Direction | Status | Notes |
|------------|-----------|--------|-------|
| `profile.core.v1` | Shared User -> all entitled apps | target | Profile basics only. |
| `prefs.notifications.v1` | Shared User -> all entitled apps | target | Quiet hours/channels; exact preference model belongs to the Shared User contract. |
| `house.property.v1` | House -> Budget | target | Non-sensitive household/property summary; consent required. |
| `budget.summary.v1` | Budget -> House | target | Summary/glance only; consent required. |
| `ai.memory.v1` | Smart Engine -> apps | future | Only user-approved memory and only when AI is on. |
| Health packages | Health <-> any | denied | No package until Health privacy contract lands. |

### 5.4 Route Direction

| Route direction | Requirement |
|-----------------|-------------|
| `GET /smart-engine/packages` | Return allowlisted packages available for the active brand/user. |
| `POST /smart-engine/consents` | Create purpose-scoped consent for package/source/destination. |
| `DELETE /smart-engine/consents/:id` | Revoke future package transfer. |
| `POST /smart-engine/packages/:packageId/export` | Produce an envelope only when consent and source ownership are valid. |
| `POST /smart-engine/packages/:packageId/import` | Import an envelope only when consent, destination, version, and schema are valid. |

Route names may change during implementation, but the semantics above must be preserved.

---

## 6. Brand And Token Contract

| Item | Contract |
|------|----------|
| Brand id | Stable kebab-case id registered in `brands/`, [FLEET.md](../../ecosystem/FLEET.md), and app docs. |
| Display | Marketing name `Symply {Product}` from brand config and naming docs. |
| Brand pack | `brand.cjs`, `brand.ts`, `tokens.json`, assets, tabs, feature modes, integrations, native ids. |
| Shared base tokens | Spacing, radii, type, and fonts live in `brands/_shared/` and are not overridden per brand. |
| Brand tokens | Colors, gradients, backgrounds, accents, and assets live in `brands/<id>/`. |
| Generated outputs | RN tokens and Swift `BrandTokens` are generated; generated files are not hand-edited. |
| Tabs | `brand.tabs` / `featureTabs` feed one tab registry for phone and iPad. |
| EAS | Every brand profile/channel sets `APP_BRAND` and `EXPO_PUBLIC_APP_BRAND`. |

Required checks when brand contracts change:

```sh
APP_BRAND=<id> npm run validate:brand
APP_BRAND=<id> npm run design:build
```

---

## 7. Shared Worker And D1 Contract

| Area | Requirement |
|------|-------------|
| Worker ownership | Shared auth, Shared User, entitlement, consent, transfer, and AI AuthZ behavior belongs in `backend/`. |
| D1 migrations | Schema changes are immutable migrations and apply to both staging and production when backend behavior ships. |
| Namespacing | Product domain data remains product-owned/namespaced; shared tables reference `user_id` and brand/package ids. |
| Secrets | Worker runtime secrets stay in Wrangler secrets; docs never include secret values. |
| Deploy policy | Code changes deploy staging and production per [SERVICES.md](../../ecosystem/SERVICES.md); this docs-only task does not deploy. |
| Compatibility | Existing House API behavior must not break while shared contracts are introduced. |

---

## 8. No-Fork Shared Surfaces

| Surface | Shared anchor | Brand-specific inputs |
|---------|---------------|-----------------------|
| Login/Register | `src/screens/auth/` | Logo, splash, display name, OAuth client ids, colors |
| Google/Apple auth | shared auth hooks/services | Client ids, bundle/package ids, Apple capabilities |
| Google Drive | shared cloud/Drive services | OAuth clients, redirect scheme, product copy where needed |
| Tab shell | `src/navigation/tabRegistry.ts`, shared tab chrome | Tab list, labels, icons/SF symbols, feature modes |
| Settings primitives | shared settings surfaces | Brand display text and feature visibility |
| AI access gates | `src/components/ai/`, hooks | Account entitlement and product AI scopes |
| Widget | shared WidgetKit code | Extension id, app group, generated tokens, display name |
| Watch | shared Watch code and sync bridge | Watch ids, app group, generated tokens, display name |
| Notification routing | shared notification services | Brand feature modes and copy |

Forking any row requires a documented platform exception and child app TRD reference.

---

## 9. Security And Privacy

- Refresh/session failure behavior remains centralized; no brand-specific auth store forks.
- Consent checks are server-enforced before package export/import.
- Health transfer remains deny-by-default.
- AI calls require entitlement checks in both client and Worker paths.
- Logs must avoid secrets, tokens, raw health data, sensitive household details, and raw transfer payloads where not needed.
- Cross-app import must be idempotent or safely repeatable.
- Revocation blocks future transfer; retention/deletion semantics must be documented per package.

---

## 10. QA And Verification Gates

For docs-only changes in this folder:

- Verify touched Markdown links where practical.
- No deploy.

For future contract implementation:

| Change | Required verification |
|--------|-----------------------|
| Brand/tokens | `APP_BRAND=<id> npm run validate:brand`; `APP_BRAND=<id> npm run design:build` when tokens/native outputs change. |
| Shared User backend | Backend typecheck/tests; D1 migration tests; same account resolves same `user_id` across House/Budget. |
| AI entitlement | AI-off smoke; Worker rejects AI/job calls while off; AI-on unlocks entitled gates. |
| Soft Transfer | Consent required, package export/import tested, revoke blocks future transfer, no sibling table queries. |
| Worker schema | D1 migrations applied to staging and production when shipping behavior. |
| Widget/Watch brand changes | Native build/smoke for generated tokens, app group, deep links, and sync. |

---

## 11. Docs Maintenance

| Change | Docs to update |
|--------|----------------|
| Shared identity, entitlement, transfer, or AI contract | This BRD/TRD, [features/README.md](./features/README.md), and linked design/implementation plan |
| New Soft Transfer package | [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md), this TRD, and capability index |
| Brand identity or fleet status | [FLEET.md](../../ecosystem/FLEET.md), [NAMING.md](../../ecosystem/NAMING.md), child app docs |
| Migration/readiness status | [MIGRATION.md](../../ecosystem/MIGRATION.md), child app `migration.md` |
| Product feature scope | Child app BRD/TRD and `documents/requirements/<Feature>/`, not `_ecosystem` |

---

## 12. Open Technical Questions

| # | Question | Status |
|---|----------|--------|
| T1 | Final D1 table names and indexes for Shared User, app entitlements, consent, and transfer events | open |
| T2 | Whether Shared User payload is added to JWT claims, `/shared-user/me`, or both | open |
| T3 | AI entitlement write path for v1: settings toggle, billing webhook, or combined | open |
| T4 | Exact package schema validation strategy and version migration mechanism | open |
| T5 | Native Tabs flip timing versus current custom Floating/Sidebar tab chrome | deferred |
| T6 | Whether Shared User/Smart Engine eventually split into a separate Worker service | deferred |

---

## 13. Acceptance

- [ ] Backend Shared User contract exposes stable `user_id`, app entitlements, and AI status.
- [ ] Worker AI AuthZ rejects AI/model/job traffic when account `ai.status` is `off`.
- [x] First Soft Transfer package records consent and transfer event state and cannot run without consent.
- [ ] Child product services do not query sibling product tables.
- [ ] Brand packs remain data/config; shared auth, shell, integrations, Widget, Watch, and AI gates are not forked.
- [ ] Brand validation and token generation pass for touched registered brands.
- [ ] Child TRDs link here for shared identity, transfer, Worker/D1, AI entitlement, and brand/token behavior.
