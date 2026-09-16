# Fleet registry — Symply Ecosystem

> Project: **Symply Ecosystem** · Display: **Symply [App]** · [PROJECT.md](./PROJECT.md) · [NAMING.md](./NAMING.md) · [MIGRATION.md](./MIGRATION.md)

| Order | App id (docs) | Runtime `APP_BRAND` | Display | Role | Brand pack | Join mode |
|------:|---------------|---------------------|---------|------|------------|-----------|
| — | `_ecosystem` | — | Symply Ecosystem (shared) | shared contracts (docs) | — | Shared User / Soft Transfer / Worker |
| 1 | `simple-house` | `symply-house` | **Symply House** | **parent / template app** | `brands/symply-house/` | host — **budget decoupled**; platform auth SoT |
| 2 | `simple-budget` | `symply-budget` | Symply Budget | child | `brands/symply-budget/` | extract — joined platform auth |
| 3 | `symply-kaizen` | `symply-kaizen` | Symply Kaizen | child | `brands/symply-kaizen/` | donor-port — joined platform auth |
| 4 | `simple-language` | `symply-language` | Symply Language | child | `brands/symply-language/` | swift-rewrite — legacy auth until join |
| 5 | `simple-health` | `symply-health` | Symply Health | child | `brands/symply-health/` | swift-rewrite — blocked from 0092 until unmount DoD |

Data Bridge: [Ecosystem_Data_Bridge_Plan.md](../design/Ecosystem_Data_Bridge_Plan.md) v1.16.

## Hierarchy

```text
Symply Ecosystem (project)
├── _ecosystem docs + shared src/backend
└── Symply House (template parent)
    ├── Symply Budget
    ├── Symply Kaizen
    ├── Symply Language
    └── Symply Health
```

New brands **copy** `brands/symply-house/` (template), then specialize.  
They do **not** become new Cursor projects.

## Legacy donors (umbrella)

Paths relative to `~/Desktop/Symply Ecosystem/`. Details: [PROJECT.md](./PROJECT.md).

| Brand id | Donor folder | Notes |
|----------|--------------|-------|
| `simple-house` | `Simply Ecosystem/` | Platform host (this repo) |
| `simple-budget` | — | Extracted from House; no separate donor |
| `symply-kaizen` | `Simply Kaizen/symply-kaizen/` | RN donor |
| `simple-language` | `Simply Language/` | Swift donor |
| `simple-health` | `Simply Health/` | Swift donor |

## Doc paths

| Id | Folder |
|----|--------|
| Shared contracts | [`apps/_ecosystem/`](../apps/_ecosystem/README.md) |
| Symply House | [`apps/symply-house/`](../apps/symply-house/README.md) |
| Symply Budget | [`apps/symply-budget/`](../apps/symply-budget/README.md) |
| Symply Kaizen | [`apps/symply-kaizen/`](../apps/symply-kaizen/README.md) |
| Symply Language | [`apps/symply-language/`](../apps/symply-language/README.md) |
| Symply Health | [`apps/symply-health/`](../apps/symply-health/README.md) |

Required per app: `README.md`, `BRD.md`, `TRD.md`, `design.md`, `migration.md`, `features/README.md`.
