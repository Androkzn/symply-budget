# Symply Ecosystem — apps hub

| Role | Folder | Display | Notes |
|------|--------|---------|-------|
| Shared contracts | [`_ecosystem/`](./_ecosystem/README.md) | Symply Ecosystem (docs) | Not a storefront |
| Templates | [`_templates/`](./_templates/) | — | Copy when adding an app |
| **Parent / template** | [`symply-house/`](./symply-house/README.md) | **Symply House** | Copy `brands/symply-house/` |
| Child | [`symply-budget/`](./symply-budget/README.md) | Symply Budget | Extract from House |
| Child | [`symply-kaizen/`](./symply-kaizen/README.md) | **Symply Kaizen** | Brand id `symply-kaizen` |
| Child | [`symply-language/`](./symply-language/README.md) | Symply Language | Swift rewrite |
| Child | [`symply-health/`](./symply-health/README.md) | Symply Health | Swift rewrite (last) |

```text
apps/<id>/
  README.md  BRD.md  TRD.md  design.md  migration.md  features/README.md
```

New app: copy **Symply House** brand pack + [ADD_APP](../ecosystem/ADD_APP.md).  
Project model: [PROJECT.md](../ecosystem/PROJECT.md) · Fleet: [FLEET.md](../ecosystem/FLEET.md)
