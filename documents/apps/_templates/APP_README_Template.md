# [Symply Product]

| Field | Value |
|-------|-------|
| **Brand id** | `[brand-id]` |
| **Display** | `Symply [Product]` |
| **Role** | `parent / template` or `child` |
| **Parent platform** | [`_ecosystem`](../_ecosystem/README.md) |
| **Template parent** | [Symply House](../symply-house/README.md) |
| **Brand pack** | `brands/<id>/` |
| **Status** | `draft / inventory / build / beta / shipped` |

> **AI read order:** this file -> [BRD](./BRD.md) -> [TRD](./TRD.md) -> [features](./features/README.md). Read `_ecosystem` only for shared contracts. Do not turn this README into a feature catalog.

## One-Liner

[One sentence describing the app as a Symply Ecosystem member.]

## Product Boundary

| Area | App rule |
|------|----------|
| Core product | [What this app owns.] |
| Shared platform | Auth, Shared User, Smart Engine, brand system, Worker, Widget/Watch where enabled. |
| AI | Optional unless explicitly approved; core flows must work with AI off. |
| Data sharing | Opt-in only through Soft Transfer packages and consent. |

## Docs

| Doc | Use |
|-----|-----|
| [BRD.md](./BRD.md) | App-level business/product requirements |
| [TRD.md](./TRD.md) | App-level technical contracts |
| [design.md](./design.md) | Brand, UX, and design notes |
| [migration.md](./migration.md) | Donor/host/extract migration plan |
| [features/README.md](./features/README.md) | Feature index linking to requirement docs |

## Code Map

| Surface | Anchor |
|---------|--------|
| Brand config | `brands/<id>/brand.cjs`, `brands/<id>/brand.ts`, `brands/<id>/tokens.json` |
| Routes | `app/` and brand-selected routes |
| Screens | `src/screens/` and/or `src/features/<domain>/` |
| Feature module | `src/features/<domain>/` |
| API/client state | `src/api/`, `src/stores/`, `src/services/` |
| Shared contracts | `src/shared-user/`, `src/smart-engine/`, `backend/` |

## Current Brand Contract

| Item | Value |
|------|-------|
| `APP_BRAND` | `<id>` |
| Display name | `Symply [Product]` |
| URL scheme | `[scheme]` |
| iOS bundle | `fox-family.<id>` or existing locked bundle |
| Android package | `[package]` |
| EAS channel | `<id>-production` |
| Feature modes | `[brand.features summary]` |

## Do Not

- Do not fork Login, Google/Apple auth, Google Drive, Widget, or Watch for this app.
- Do not implement product work in donor repos or `_archive/`.
- Do not put feature-level requirements in the app BRD/TRD.
- Do not define another account system or silent cross-app data sharing.
