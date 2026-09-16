# Naming — Symply Ecosystem

> **Project name:** Symply Ecosystem  
> **App display:** **`Symply [App]`** — Symply House, Symply Budget, …  
> **Template app:** Symply House (`simple-house`)  
> **Ids:** `brands/<id>/brand.cjs` · [FLEET.md](./FLEET.md) · [PROJECT.md](./PROJECT.md)

---

## 1. Canonical identity

| Field | Rule | House (template) | Budget | Kaizen |
|-------|------|------------------|--------|--------|
| **Docs/app id** | Stable docs / Bundle lineage | `simple-house` | `simple-budget` | `symply-kaizen` |
| **Runtime `APP_BRAND`** | `brand.cjs` + wrangler + envelopes | `symply-house` | `symply-budget` | `symply-kaizen` |
| **JWT audience (target)** | Platform ES256 | `symply-house-app` | `symply-budget-app` | `symply-kaizen-app` |
| **Display name** | **`Symply {Product}`** | `Symply House` | `Symply Budget` | `Symply Kaizen` |
| **URL scheme** | no hyphens | `simplehouse` | `simplebudget` | `symplykaizen` |
| **permissionProductName** | = display | `Symply House` | `Symply Budget` | `Symply Kaizen` |

**Project vs app:** The Cursor/git project is **Symply Ecosystem**. Symply House is one member (the template), not the name of the whole project.

**Do not confuse namespaces:** docs/app ids (`simple-house`) may remain for Bundle IDs and historical docs; **runtime security** (`APP_BRAND`, Soft Transfer, JWT `aud`) uses `symply-*` from `brands/*/brand.cjs` and wrangler. See [Ecosystem_Data_Bridge_Plan.md](../design/Ecosystem_Data_Bridge_Plan.md) registry. Marketing always says **Symply**.

**Shared contracts docs:** `documents/apps/_ecosystem/` (not a storefront brand).

---

## 2. Mobile / store identifiers (FE)

### App Store

| Item | Pattern | House |
|------|---------|-------|
| Bundle ID | `fox-family.<brand-id>` | `fox-family.simple-house` |
| Widget / Watch / App Group | `fox-family.<brand-id>.*` / `group.fox-family.<brand-id>` | (see brand pack) |
| App Store name | **`Symply {Product}`** | Symply House |

### Google Play

| Item | Pattern |
|------|---------|
| Application id | Prefer `com.foxfamily.<scheme>` for **new** apps; don’t copy House’s legacy `com.anonymous.*` |
| Listing title | `Symply {Product}` |

### EAS

Profiles/channels: `<brand-id>-<env>` · Expo slug = brand id.

---

## 3. Backend (BE)

Shared Worker is fine for the ecosystem. Names may still say `simple-house-api` historically — treat as **Symply Ecosystem API** in docs; rename Worker only via [§8 rename checklist](#8-how-to-rename-checklist).

| Resource | Pattern |
|----------|---------|
| Worker | shared `simple-house-api` *or* future `symply-api` |
| D1 / R2 | shared unless product needs isolation (Health) |
| JWT audience | `<brand-id>-app` when brand-aware |

---

## 4–6. Firebase / Sentry / Google OAuth

| Surface | Rule |
|---------|------|
| Firebase | One iOS + Android app per brand; nickname **Symply …**; ids match bundle/package |
| Sentry | Project slug = brand id; release `brand-id@version+build` |
| OAuth | **New client IDs per brand**; paste into `brand.cjs` |

---

## 7. FE folders

| Kind | Path |
|------|------|
| Template brand | `brands/symply-house/` — **copy this** for new apps |
| Child brand | `brands/<id>/` |
| Feature module | `src/features/<domain>/` |
| Docs | `documents/apps/<id>/` |

---

## 8. How to rename (checklist)

### Marketing → Symply (safe)

Update `displayName`, store listing titles, Firebase nicknames, OAuth consent screen. **Keep** Bundle IDs.

### After publish

Bundle ID / application id are locked. “Rename” = new listing or keep ids.

### Disk / git root

Umbrella folder: `~/Desktop/Symply Ecosystem/` · platform folder: `Simply Ecosystem/`.  
**GitHub:** [`Androkzn/symply-ecosystem`](https://github.com/Androkzn/symply-ecosystem) (renamed from `simple-house`; old URLs redirect).  
Further renaming the local disk folder is optional/cosmetic.

---

## 9. New brand fill-in

```text
project:         Symply Ecosystem
template:        brands/symply-house/
brand-id:        …
displayName:     Symply _______
scheme:          … (no hyphens)
iosBundleId:     fox-family.…
androidPackage:  com.foxfamily.…
docs:            documents/apps/…/
```

[ADD_APP.md](./ADD_APP.md) · [MIGRATION.md](./MIGRATION.md) · [NEW_BRAND_CHECKLIST](../design/NEW_BRAND_CHECKLIST.md)
