# [App Display Name] - Technical Requirements Document

> **App-level contracts only.** Deep feature contracts belong in feature TRDs or implementation docs linked from [features/README.md](./features/README.md).

| Field | Value |
|-------|-------|
| **Doc type** | App TRD |
| **App id** | `[brand-id]` |
| **Display name** | `Symply [Product]` |
| **Role** | `parent / template` or `child` |
| **Parent platform** | `_ecosystem` |
| **Status** | `draft / in-progress / approved` |
| **Version** | `v0.1` |
| **Created** | `YYYY-MM-DD` |
| **Last updated** | `YYYY-MM-DD` |
| **BRD** | [BRD.md](./BRD.md) |
| **Brand pack** | `brands/<id>/` |
| **Feature index** | [features/README.md](./features/README.md) |

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.1 | YYYY-MM-DD | Initial app TRD |

---

## 1. Architecture Placement

```text
Symply Ecosystem
├── brands/<id>/          app identity, tokens, tabs, integrations
├── app/                  Expo Router routes
├── src/features/<domain> app domain module
├── src/shared-user/      shared account and entitlement client
├── src/smart-engine/     Soft Transfer packages and consent
├── backend/              Cloudflare Worker, D1, Durable Objects, AI gateway
└── ios/                  shared iOS host, Widget, Watch where enabled
```

| Concern | Contract |
|---------|----------|
| Build-time brand | `APP_BRAND` / `EXPO_PUBLIC_APP_BRAND` resolves `brands/<id>/`. |
| Runtime identity | `app.config.ts` injects name, slug, scheme, bundle ids, icons, and feature modes. |
| Navigation | `brand.tabs` / `brand.featureTabs` feed the shared tab registry. |
| Domain module | App-specific code belongs in `src/features/<domain>/` or shared `src/screens/` where already established. |
| Backend | Shared Worker routes/services own server behavior; D1 migrations capture schema history. |

---

## 2. Brand Contract

| Item | Value |
|------|-------|
| Brand id | `[brand-id]` |
| Display | `Symply [Product]` |
| Slug | `[brand-id]` |
| Scheme | `[scheme-no-hyphen]` |
| iOS bundle id | `[bundle]` |
| Android package | `[package]` |
| EAS channel | `<brand-id>-production` |
| Widget / Watch | `[enabled / disabled / TBD]` |
| Feature modes | `[brand.features summary]` |

Source files:

- `brands/<id>/brand.cjs`
- `brands/<id>/brand.ts`
- `brands/<id>/tokens.json`

---

## 3. Build And Release

| Item | Contract |
|------|----------|
| Brand validation | `npm run validate:brand` |
| Token/native sync | `npm run design:build` when brand tokens or native companions change |
| EAS profiles | `<brand-id>-development`, `<brand-id>-preview`, `<brand-id>-production` as applicable |
| Backend deploy | Shared Worker (`backend/`): `cd backend && npm run deploy:fleet`; House-only: `deploy:house:all` (deprecated alias: `deploy:all`); per-brand: `deploy:<brand>:all`; Language (`backend-language/`): `deploy:language:all` — not part of `deploy:fleet` |
| D1 migrations | Apply to staging and production when schema changes |

Do not run `expo prebuild --clean` casually while committed native Widget/Watch targets exist.

---

## 4. Feature Gates And Modules

| Gate / mode | Source | App value |
|-------------|--------|-----------|
| `features.budget` | brand pack | `off / minimal / full` |
| `features.widget` | brand pack | `true / false` |
| `features.watch` | brand pack | `true / false` |
| `[domain flag]` | `src/config/features.ts` or backend flags | `[value]` |

Feature flags answer "is this released?" Entitlements answer "may this account use it?" Brand modes answer "what surface should this brand expose?"

---

## 5. Data And API Boundaries

| Domain | Mobile anchor | Worker route/service anchor | Boundary |
|--------|---------------|-----------------------------|----------|
| Auth / users | `src/stores/authStore.ts`, `src/api/auth.ts` | `backend/src/routes/auth.ts` | Shared User; no app fork. |
| App domain | `[src/features/<domain>]` | `[backend route/service]` | App-owned data. |
| Soft Transfer | `src/smart-engine/` | `[TBD]` | Consent and package allowlist required. |

---

## 6. Integrations

| Integration | Requirement |
|-------------|-------------|
| Google Auth / Drive | Use brand client ids from `brands/<id>/`. |
| Apple Auth | Enabled only when brand and store setup support it. |
| Notifications | Shared notification service; app-specific behavior behind flags/settings. |
| AI providers | Must pass feature, entitlement, and provider gates. |
| Widget / Watch | IDs and app group must come from the brand pack. |

---

## 7. Security And Privacy

- Never define a second account store.
- Never silently read sibling app data.
- Use explicit consent for Soft Transfer.
- Keep AI-off paths working for core workflows.
- Avoid logging tokens, secrets, document contents, health data, or sensitive household data.

---

## 8. QA And Verification Gates

For frontend changes:

- `npm run validate:brand`
- Targeted tests for touched stores/services/screens.
- Relevant E2E flow when a routed workflow changes.
- AI-off smoke when AI-adjacent UX changes.

For backend changes:

- `cd backend && npm run typecheck`
- `cd backend && npm test` where practical.
- Apply remote D1 migrations to staging and production if schema changed.
- Deploy staging and production when Worker behavior changed.

---

## 9. Docs Maintenance

| Change | Docs to update |
|--------|----------------|
| App boundary | This BRD/TRD and [features/README.md](./features/README.md) |
| Brand identity | `brands/<id>/`, [NAMING.md](../../ecosystem/NAMING.md), [FLEET.md](../../ecosystem/FLEET.md) |
| Migration status | [migration.md](./migration.md), [MIGRATION.md](../../ecosystem/MIGRATION.md) if fleet order/status changes |
| Cross-app data | [RELATIONSHIPS.md](../../ecosystem/RELATIONSHIPS.md) |

---

## 10. Open Technical Questions

| # | Question | Status |
|---|----------|--------|
| T1 | [Question] | open |

---

## 11. Acceptance

- [ ] App TRD matches the app BRD.
- [ ] Parent `_ecosystem` contracts are respected.
- [ ] Brand pack and feature modules are named.
- [ ] No implementation detail that belongs only in feature implementation docs is required here.
