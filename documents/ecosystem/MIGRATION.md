# Legacy → Symply Ecosystem migration

> **Goal:** Transform every Swift / old RN app into a **Symply** member of **Symply Ecosystem**, with **Symply House** as the parent/template app.  
> **Project model:** [PROJECT.md](./PROJECT.md) · **Display:** `Symply [App]` · [NAMING.md](./NAMING.md)

---

## 0. Locked decisions

| Decision | Choice |
|----------|--------|
| Project name | **Symply Ecosystem** (this Cursor repo) |
| Template / parent app | **Symply House** (`brands/symply-house/`) |
| Platform code | One Expo codebase + `brands/<id>/` |
| Display name | **`Symply {Product}`** |
| Brand id (technical) | Keep `kebab-case` (`simple-house`, …) for now |
| Auth | Shared User — one `user_id` |
| UI | Shared screens + feature modules; brand = tokens/assets/tabs/ids |
| Native | Shared Widget/Watch themed by brand; never fork Login |
| Cursor | Open **this repo only** for ecosystem work |
| Legacy repos | Donors beside platform under `~/Desktop/Symply Ecosystem/` — not platform roots |

Umbrella layout: [PROJECT.md § Disk layout](./PROJECT.md#disk-layout-umbrella-folder)

---

## 1. Fleet join order (do not skip)

| # | Brand id | Display | Legacy source (umbrella) | Stack today | Join mode |
|--:|----------|---------|--------------------------|-------------|-----------|
| 1 | `simple-house` | Symply House | `Simply Ecosystem/` (this repo) | Expo RN (platform) | **Host** — already on platform; display rename + harden |
| 2 | `simple-budget` | Symply Budget | (extracted from House) | Feature module | **Extract** full budget brand |
| 3 | `symply-kaizen` | Symply Kaizen | `Simply Kaizen/symply-kaizen/` | Expo RN (donor) | **Port features** into `src/features/kaizen/`; keep donor for design/tokens only |
| 4 | `simple-language` | Symply Language | `Simply Language/` | **Swift** | **Rewrite** RN feature module |
| 5 | `simple-health` | Symply Health | `Simply Health/` | **Swift** (+ some RN bits) | **Rewrite** RN last (sensitive) |

Registry: [FLEET.md](./FLEET.md) · Ids: [NAMING.md](./NAMING.md) · Brand steps: [NEW_BRAND_CHECKLIST](../design/NEW_BRAND_CHECKLIST.md)

---

## 2. Definition of “ready” (per app)

An app is **migration-ready** when all boxes are checked:

### Docs
- [ ] `documents/apps/<id>/{README,BRD,TRD,design}.md` filled (not stub-only for rewrite apps)
- [ ] `documents/apps/<id>/migration.md` — legacy inventory + parity matrix (template below)
- [ ] Soft Transfer rows updated in [RELATIONSHIPS.md](./RELATIONSHIPS.md)
- [ ] FLEET row status → `review` or better

### Identity
- [ ] `displayName` / App Store title = `Symply …` per [NAMING.md](./NAMING.md)
- [ ] Bundle / package / scheme / OAuth / Firebase / Sentry planned (keep vs new listing)
- [ ] Store continuity decision documented (same Bundle ID = update; new ID = new listing)

### Code
- [ ] `brands/<id>/` complete + `validate-brand` passes
- [ ] Domain module under `src/features/<domain>/` (or explicit “shell only” for phase 0)
- [ ] No forked Login / Drive / Widget / Watch
- [ ] AI-off path works
- [ ] EAS profile + channel for brand

### Data / accounts
- [ ] Shared User plan for existing users (link / migrate / re-auth)
- [ ] Data model map: legacy tables/APIs → Worker / D1 (or local-only v1)
- [ ] Soft Transfer packages listed or explicitly “none”

---

## 3. Migration modes

### A. Host rename (House)
1. Set `displayName` / `permissionProductName` → `Symply House`
2. App Store / Play listing title → Symply House (Bundle ID **unchanged** unless intentional new app)
3. Sentry/Firebase nicknames → Symply House
4. Keep `simple-house` brand id

### B. Feature extract (Budget)
1. Brand pack `simple-budget`, `features.budget = full`
2. House stays `minimal`
3. Soft Transfer House → Budget when ready
4. Display → Symply Budget

### C. RN donor port (Symply Kaizen)
1. Inventory `Simply Kaizen/symply-kaizen/` screens/modules worth keeping
2. Port **into** `src/features/kaizen/` on platform (not reverse)
3. Reuse Symply Kaizen token/pipeline lessons already in platform
4. Keep `Simply Kaizen/` as donor only; stop dual-platform edits
5. Display → **Symply Kaizen** (locked; brand id `symply-kaizen`)

### D. Swift rewrite (Language, Health)
1. Complete `migration.md` inventory (screens, data, IAP, HealthKit, etc.)
2. Parity matrix: Must / Should / Later / Drop
3. Implement feature module on platform; brand pack for store identity
4. Decide Bundle ID: **new** Symply listing vs migrate existing (usually **new RN app** + sunset Swift)
5. User migration: Shared User link + optional Soft Transfer
6. TestFlight Symply build → phased store switch → sunset Swift

---

## 4. Per-app `migration.md` template

Copy to `documents/apps/<id>/migration.md`:

```markdown
# <Symply Name> — legacy migration

| Field | Value |
|-------|-------|
| Brand id | |
| Display | Symply … |
| Legacy path | ~/Desktop/Symply Ecosystem/… |
| Legacy stack | Swift / RN / mixed |
| Mode | host-rename / extract / donor-port / swift-rewrite |
| Store continuity | keep bundle / new listing |
| Owner | |
| Status | not-started / inventory / parity / build / beta / shipped |

## Legacy inventory
| Area | Legacy location | Notes |
|------|-----------------|-------|
| Auth | | |
| Core screens | | |
| Local DB / sync | | |
| Push / Widget / Watch | | |
| Payments / IAP | | |
| Sensitive APIs (HealthKit, etc.) | | |

## Parity matrix
| Capability | Must | Should | Later | Drop | Platform target |
|------------|------|--------|-------|------|-----------------|
| | ☐ | ☐ | ☐ | ☐ | src/features/… |

## Identity (from NAMING.md)
| Item | Value |
|------|-------|
| iosBundleId | |
| androidPackage | |
| scheme | |
| Firebase | |
| Sentry | |
| OAuth clients | |

## Shared User / data
- Existing users:
- Data migration:
- Soft Transfer packages:

## Exit criteria
- [ ] Parity Must rows done
- [ ] Symply build on TestFlight / internal track
- [ ] Legacy app sunset plan dated
```

---

## 5. Cross-cutting platform readiness

Before Language/Health deep rewrites:

| Track | Doc / code | Ready when |
|-------|------------|------------|
| Brand ecosystem | `brands/`, validate, tokens | House + Budget brands ship |
| Shared User | design Shared User plan Phases A–C | Entitlements + consent stubs real |
| Soft Transfer | `src/smart-engine/` + RELATIONSHIPS | House↔Budget package v1 |
| Naming | [NAMING.md](./NAMING.md) | All store/Firebase/Sentry patterns filled |
| Symply Kaizen E2E | brand #3 shell | Proves third brand before Swift rewrites |

---

## 6. Store & console rename to Symply

Marketing rename **does not** require renaming brand ids.

| Surface | Action |
|---------|--------|
| App Store Connect | Change **name** to `Symply …`; keep Bundle ID if updating same app |
| Play Console | Change **title**; keep application id if same app |
| Firebase | App nickname → Symply …; ids still match bundle/package |
| Sentry | Project name/slug can stay `simple-house`; display title Symply House |
| Google OAuth consent | App name Symply … |
| `brand.cjs` | `displayName`, `permissionProductName` |
| Xcode display name | From Expo config / Info.plist via brand |

See rename rules in [NAMING.md](./NAMING.md) §8.

---

## 7. Working rules (non-negotiable)

1. **One platform repo** — open `Simply Ecosystem/` in Cursor; donors stay siblings under the umbrella.  
2. **No Login fork** — brand assets only.  
3. **Feature modules** for domain — not copy-paste app trees.  
4. **Inventory before code** for Swift rewrites (`migration.md`).  
5. **Health last** — privacy + Soft Transfer deny-by-default.  
6. **AI optional** — core flows work with AI off.  
7. Update [FLEET.md](./FLEET.md) in the same PR as identity changes.  
8. When a donor moves on disk, update `migration.md` Legacy path + this table in the same change.

---

## 8. Immediate checklist (100% prepare)

- [x] Docs tree: ecosystem / apps / design / requirements / engineering  
- [x] NAMING + FLEET + ADD_APP + MIGRATION  
- [x] Every child has `migration.md`  
- [x] Brand packs `displayName` → Symply …  
- [x] Legacy donors co-located under `~/Desktop/Symply Ecosystem/`  
- [ ] Fill Language + Health inventories from `Simply Language/` + `Simply Health/`  
- [x] Display locked: Symply Kaizen (brand id symply-kaizen)  
- [ ] Shared User Phase A scheduled  
- [ ] Bundle ID continuity decided per Swift app (new vs keep)  
- [ ] App Store / Play listing titles updated when ready to ship rename  
