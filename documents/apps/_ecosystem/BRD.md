# Symply Ecosystem - Business Requirements Document

> **Platform-contract document only.** `_ecosystem` is not a storefront app. Storefront/product requirements belong in the child app docs and linked feature specs.

| Field | Value |
|-------|-------|
| **Doc type** | Ecosystem BRD |
| **App id** | `_ecosystem` |
| **Display name** | Symply Ecosystem |
| **Role** | Shared platform contracts |
| **Template parent** | Symply House (`simple-house`) |
| **Status** | `draft` |
| **Version** | `v0.3` |
| **Created** | 2026-07-12 |
| **Last updated** | 2026-07-12 |
| **TRD** | [TRD.md](./TRD.md) |
| **Design** | [design.md](./design.md) |
| **Capability index** | [features/README.md](./features/README.md) |

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | 2026-07-12 | Initial shared-contract stub |
| v0.2 | 2026-07-12 | Renamed project to Symply Ecosystem; clarified House as template parent |
| v0.3 | 2026-07-12 | Expanded real platform contract requirements for Shared User, Smart Engine, Soft Transfer, brand/token system, Worker/D1, AI entitlement, and no-fork surfaces |

---

## 1. Purpose

### 1.1 One-Liner

Symply Ecosystem is the shared platform layer that lets Symply House, Symply Budget, Symply Kaizen, Symply Language, and Symply Health ship from one codebase with one account identity, explicit cross-app consent, shared AI entitlement, and brand-specific presentation.

### 1.2 Problem

The fleet cannot scale if every app recreates login, tokens, navigation, AI access, Worker routes, native companions, and account/data-sharing rules. Forking these surfaces would create inconsistent privacy behavior, duplicated release work, drift across brands, and a high-risk path for Health.

### 1.3 Product Promise

- A user can use multiple Symply apps as one account without re-creating identity or profile state.
- Apps can look and ship as separate products while sharing auth, shell, Worker, Widget, Watch, design primitives, and core integrations.
- Cross-app data movement is understandable, opt-in, revocable, versioned, and never implemented as silent table access.
- AI is an ecosystem entitlement and enhancement; the useful manual product still works when AI is off.

### 1.4 Success Metrics

| Outcome | Signal |
|---------|--------|
| Shared identity | House and Budget builds can resolve the same stable `user_id` for the same account. |
| Brand scalability | A new brand is created by copying `brands/symply-house/`, registering the brand, adding feature modules when needed, and passing validation. |
| No-fork shared UX | Login/Register, Google/Apple auth, Drive, tab shell, Widget, Watch, and AI access gates are shared codepaths with brand data inputs. |
| Consent trust | Every cross-app transfer has package id, source, destination, purpose, consent state, and revocation behavior. |
| AI optionality | AI-off smoke passes for core app flows; no model calls or background AI jobs occur while account AI is off. |
| Backend coherence | Shared contracts are represented in Worker/D1 routes, services, and migrations instead of app-local one-offs. |

---

## 2. Fleet Placement

| Item | Value |
|------|-------|
| Project | Symply Ecosystem |
| Shared docs id | `_ecosystem` |
| Template / parent app | Symply House (`simple-house`) |
| Child apps | Symply Budget, Symply Kaizen, Symply Language, Symply Health |
| Brand model | Brand packs under `brands/<id>/` plus feature modules under `src/features/<domain>/` |
| Shared login | Required: one Shared User account and stable `user_id` across the fleet |
| Shared backend | Shared Worker family and D1 migrations unless a product-specific isolation decision is documented |
| Cross-app data | Soft Transfer packages only; deny-by-default, Health stricter |
| Source of truth for relationships | [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md) |

---

## 3. Personas And Jobs

| Persona | Job-to-be-done |
|---------|----------------|
| Returning Symply user | Use another Symply app without creating a second account or wondering which data is shared. |
| Product owner for a child app | Define product-specific scope without reinventing auth, design system, AI entitlement, transfer, or backend identity rules. |
| Engineer / agent | Add brands and shared features with one platform mental model, stable docs, and clear verification gates. |
| Operator / release owner | Ship and support separate store apps while preserving shared Worker, entitlement, token, and migration contracts. |
| Privacy reviewer | Confirm that cross-app data movement is consented, package-scoped, revocable, and Health is deny-by-default. |

---

## 4. Scope

### 4.1 In Scope

- Shared User account identity, profile spine, app entitlements, and account-level AI entitlement direction.
- Smart Engine contract for memory, Soft Transfer packages, consent, import/export envelopes, AI gateway direction, and async job boundaries.
- Brand/token system rules for `brands/<id>/`, generated tokens, shared base tokens, app identity, EAS profiles, Widget, and Watch.
- Shared Worker/D1 responsibility for auth, entitlements, consent, transfer events, AI authorization, and future gateway policy.
- No-fork shared surfaces: Login/Register, Google/Apple auth, Google Drive, tab shell, settings primitives, Widget, Watch, notification routing, and AI gates.
- Documentation contract that child apps reference for shared behavior.

### 4.2 Out Of Scope

- Budget, Kaizen, Language, Health, or House product feature requirements.
- Per-feature BRDs/TRDs; those belong under `documents/requirements/` and app feature indexes.
- A separate storefront, binary, or brand named `_ecosystem`.
- Implementing product work inside donor repos or `_archive/`.
- A silent shared data lake where products directly query sibling product tables.
- AI-only core workflows unless a child BRD explicitly approves an exception.

### 4.3 Dependencies

| Dependency | Why it matters |
|------------|----------------|
| [PROJECT.md](../../ecosystem/PROJECT.md) | Defines Symply Ecosystem as the project and `_ecosystem` as shared contract docs. |
| [NAMING.md](../../ecosystem/NAMING.md) | Keeps technical ids, display names, schemes, and backend naming consistent. |
| [FLEET.md](../../ecosystem/FLEET.md) | Registers app ids, display names, roles, and join order. |
| [MIGRATION.md](../../ecosystem/MIGRATION.md) | Defines join modes, readiness, and donor boundaries. |
| [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md) | Owns cross-app relationship rows and Soft Transfer intent. |
| [Shared User + Smart Engine research](../../design/Shared_User_Smart_Engine_Research.md) | Locks the layered identity, transfer, and AI direction. |
| [Shared User + Smart Engine implementation plan](../../design/Shared_User_Smart_Engine_Implementation_Plan.md) | Tracks phases A-C and House/Budget first implementation sequence. |
| [Brand token ecosystem plan](../../design/Brand_Token_Ecosystem_Plan.md) | Locks one codebase, brand packs, token generation, Widget/Watch theming, and fleet order. |

---

## 5. Platform Contract Surfaces

| Surface | Priority | Requirement |
|---------|----------|-------------|
| Shared User | P0 | One canonical `user_id`; account claims expose app entitlements and AI status. |
| AI entitlement | P0 | `ai.status` is account-level direction; AI off hides AI chrome and prevents model/job traffic while preserving manual flows. |
| Soft Transfer | P0 | Data crosses apps only through versioned packages with explicit consent, purpose, source, destination, and revocation. |
| Brand/token system | P0 | Brand packs define identity, colors, assets, tabs, OAuth clients, and native IDs; shared base tokens define spacing/type/shell. |
| Shared Worker/D1 | P0 | Auth, entitlements, consent, transfer events, and AI AuthZ live in shared backend contracts with migrations. |
| Shared native companions | P1 | Widget and Watch use one implementation, themed by generated brand tokens and brand native IDs. |
| Shared integrations | P1 | Google/Apple auth and Google Drive use shared code with per-brand client ids and schemes. |
| Child domain features | Reference only | Owned by child app BRDs/TRDs and feature specs; `_ecosystem` defines the platform boundary they must respect. |

---

## 6. Functional Contract Themes

Detailed implementation specs live in the linked capability index and design plans.

| Theme id | Theme | Priority | Requirement |
|----------|-------|----------|-------------|
| EC-1 | Shared User | P0 | The platform owns account identity, profile basics, app access, AI status, and consent registry direction. |
| EC-2 | Smart Engine | P0 | The platform owns memory, package transfer, consent API direction, AI gateway policy, and async job boundary. |
| EC-3 | Soft Transfer | P0 | Packages are allowlisted and versioned; no product may read or mutate sibling product tables. |
| EC-4 | AI entitlement | P0 | AI is globally understandable at account level and enforced in UI plus backend AuthZ. |
| EC-5 | Brand/token system | P0 | New apps are brand packs plus feature modules; shared flows consume tokens and brand metadata. |
| EC-6 | Shared Worker/D1 | P0 | Backend schema and route contracts are shared platform assets with migration discipline. |
| EC-7 | No-fork surfaces | P0 | Shared auth, shell, integrations, Widget, Watch, settings, and AI gates remain one implementation. |
| EC-8 | Documentation dependency | P1 | Child docs reference this contract for shared rules and do not redefine them. |

---

## 7. Data And Sharing

| Data class | Ecosystem stance |
|------------|------------------|
| Auth/profile | Shared User contract; one stable `user_id`, profile basics, and account preferences. |
| App entitlement | Account and brand access are shared-user claims, not hard-coded child app assumptions. |
| AI entitlement | `ai.status` and mode are account-level; existing paid/BYOK checks remain additional gates. |
| Product domain data | Owned by product services/tables; namespaced and isolated from sibling direct reads. |
| Transfer data | Export/import package envelopes with source, sink, package id, version, consent id, purpose, expiry, and audit/event state. |
| Smart memory | User-approved facts only; not a dump of raw product databases. |
| Health data | Deny-by-default until Health contracts explicitly define package, consent, minimization, and retention controls. |

### 7.1 v1 Package Direction

| Package id | Direction | Stance |
|------------|-----------|--------|
| `profile.core.v1` | Shared User -> all entitled apps | Allowed after Shared User backend contract exists. |
| `prefs.notifications.v1` | Shared User -> all entitled apps | Allowed after preference and consent semantics are defined. |
| `house.property.v1` | House -> Budget | First app-to-app candidate; consent required. |
| `budget.summary.v1` | Budget -> House | First return-package candidate; consent required. |
| `ai.memory.v1` | Smart Engine -> apps | Only available when AI is on and user-approved memory exists. |
| Health packages | Health <-> any | Explicitly denied until Health BRD/TRD and ecosystem controls approve them. |

---

## 8. Constraints

- One platform repo; no donor repo or `_archive/` implementation.
- One Shared User spine; no second auth system per child app.
- Feature flags, app entitlements, and paid/AI entitlements are different concepts and must stay distinguishable.
- Core product workflows must be usable with AI off.
- Brand ids remain stable technical ids unless a release/store strategy explicitly changes them.
- New cross-app packages require updates to this folder and [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md).
- No secrets, client secrets, API keys, or private token values in docs.

---

## 9. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Shared User remains House-scoped too long | Second app creates account drift or inconsistent AI access | Prioritize Shared User phases A/B before or with Budget E2E. |
| Soft Transfer ships without consent API | Privacy regression and loss of user trust | Block product use until consent, package, and event contracts exist. |
| AI gates stay UI-only | Backend jobs/model calls can run when AI is off | Enforce `ai.status` in Worker AuthZ and async job creation. |
| Brand packs become screen forks | 10x maintenance cost and inconsistent UX | Keep brand packs data-only; use feature modules for product differences. |
| Widget/Watch drift per brand | Native companions break or look inconsistent | Generate native tokens/ids from brand config and preserve one SwiftUI implementation. |
| Health package shortcuts | High-sensitivity data leaks into general transfer path | Keep Health deny-by-default until stricter contracts land. |

---

## 10. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | Final D1 schema for `user_entitlements`, app entitlements, consents, and transfer events | Engineering | open |
| Q2 | Whether v1 AI entitlement can be user-toggled before billing webhook integration is complete | Product / engineering | open |
| Q3 | Exact revocation UX and retention period for previously imported transfer packages | Product / privacy | open |
| Q4 | Whether Shared User becomes a separate Worker later or remains a module inside the existing Worker family | Engineering / ops | open |
| Q5 | First Health-safe package, if any | Product / privacy | deferred |

---

## 11. Acceptance

- [ ] Child app BRDs/TRDs reference `_ecosystem` for Shared User, Smart Engine, Soft Transfer, AI entitlement, brand/token, Worker/D1, and no-fork surface rules.
- [ ] Shared User Phase A exposes a stable `user_id`, app entitlements, and AI status from the backend.
- [ ] AI-off acceptance passes for core flows and backend AI AuthZ rejects new model/job traffic.
- [ ] First Soft Transfer package works only after explicit consent and records package/event state.
- [ ] Brand validation and token generation remain the path for adding or changing brands.
- [ ] Login/Register, Google/Apple auth, Drive, tab shell, Widget, Watch, and AI gate codepaths remain shared.
- [ ] New cross-app packages are added to [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md) and this contract index before product use.
