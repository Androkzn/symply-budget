# Documents maintenance

> Keep the tree small. Prefer linking over copying. Update [FLEET.md](./FLEET.md) when anything identity-related changes.

## Allowed top-level

```text
documents/
├── INDEX.md          # AI + human entry
├── README.md         # one-screen map
├── ecosystem/        # project, fleet, naming, migration, SERVICES, BRANCHING
├── apps/             # one folder per brand + _ecosystem + _templates
├── design/           # design system + white-label
├── requirements/     # feature BRD/TRD + as-built notes
└── engineering/      # BE/deploy/native how-tos
```

Repo root `_archive/` holds legacy Expo + sample files — **not** under `documents/`; agents ignore it.

**Do not** add new top-level folders without updating `INDEX.md` and this file.

## What goes where

| Change | Put it in |
|--------|-----------|
| New storefront app | `apps/<id>/` (full kit) + `ecosystem/FLEET.md` + `brands/<id>/` |
| App WHY/WHAT | `apps/<id>/BRD.md` **only** (one file) |
| App contracts | `apps/<id>/TRD.md` **only** (one file) |
| Feature BRD/TRD/Impl | `requirements/<Feature>/` + row in `apps/<id>/features/README.md` |
| Cross-app / Soft Transfer | `ecosystem/RELATIONSHIPS.md` |
| Ids / stores / Workers | `ecosystem/NAMING.md` |
| Operator access / deploy CLIs | `ecosystem/SERVICES.md` |
| Git / long-running app branches | `ecosystem/BRANCHING.md` |
| Look & tokens | `design/` |
| Deploy / Watch / Lambda how-tos | `engineering/<area>/` |

## Per-app kit (required)

```text
apps/<id>/
  README.md
  BRD.md
  TRD.md
  design.md
  migration.md          # while joining; keep short
  features/README.md    # index links only
```

## Adding an app

1. [ADD_APP.md](./ADD_APP.md)  
2. [NAMING.md](./NAMING.md) (fill ids first)  
3. [NEW_BRAND_CHECKLIST](../design/NEW_BRAND_CHECKLIST.md)

## Deleting / archiving

- Do **not** recreate `archive/`, `PATH_MAP`, or legacy path aliases.
- Obsolete feature notes: delete or fold into the feature’s folder under `requirements/`.
- Obsolete engineering dumps: delete; don’t invent a new junk drawer.
- When a **donor folder moves** on disk: update `apps/<id>/migration.md`, [FLEET.md](./FLEET.md), and [PROJECT.md](./PROJECT.md) in the same change.

## Naming of doc files

| Doc | Name |
|-----|------|
| App business | `BRD.md` |
| App technical | `TRD.md` |
| App UX pointer | `design.md` |
| App map | `README.md` |
| Feature BRD | `<Feature>_BRD_vX.Y.md` or `BRD.md` inside feature folder |
| Templates | `requirements/Templates/` |

Brand id = folder name = `APP_BRAND` ([NAMING.md](./NAMING.md)).
