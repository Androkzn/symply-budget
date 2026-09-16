# Documents — Symply Ecosystem

## Folders

| Need | Open |
|------|------|
| What is this project? + disk layout | [`ecosystem/PROJECT.md`](./ecosystem/PROJECT.md) |
| Services / Keychain / deploy | [`ecosystem/SERVICES.md`](./ecosystem/SERVICES.md) |
| Git / branching (trunk + `<app>-v2` clones) | [`ecosystem/BRANCHING.md`](./ecosystem/BRANCHING.md) |
| Fleet / naming / migration | [`ecosystem/`](./ecosystem/README.md) |
| App BRD/TRD | [`apps/<id>/`](./apps/README.md) |
| Design | [`design/`](./design/INDEX.md) |
| Feature specs | [`requirements/`](./requirements/README.md) |
| Engineering | [`engineering/`](./engineering/README.md) |
| Fleet test matrix / E2E strategy | [`engineering/testing/FLEET_TEST_STRATEGY.md`](./engineering/testing/FLEET_TEST_STRATEGY.md) · [implementation plan](./engineering/testing/FLEET_TEST_IMPLEMENTATION_PLAN.md) · [matrices](./engineering/testing/matrices/README.md) |

## Structure (canonical)

```text
documents/
├── INDEX.md / README.md     ← entry
├── ecosystem/               ← project, fleet, naming, migration, SERVICES, BRANCHING
├── apps/
│   ├── _ecosystem/          ← shared contracts (not a storefront)
│   ├── _templates/          ← copy kit for new apps
│   ├── symply-house/        ← parent / template app docs
│   ├── symply-budget/
│   ├── symply-kaizen/             ← Symply Kaizen (brand id)
│   ├── symply-language/
│   └── symply-health/
├── design/
├── requirements/            ← feature-sized specs (+ as-built/)
└── engineering/             ← BE / deploy / native how-tos

Repo root also has `_archive/` (legacy Expo + samples) — agents ignore it.
```

```text
Symply Ecosystem (repo = platform)
├── shared: src/, backend/, brands/, documents/apps/_ecosystem/
└── storefront brands
    ├── Symply House     ← template (copy brands/symply-house/)
    ├── Symply Budget
    ├── Symply Kaizen      ← donor: Simply Kaizen/symply-kaizen/
    ├── Symply Language
    └── Symply Health
```

**Doc rule:** one app BRD + one app TRD; features linked from `apps/<id>/features/`.  
**Maintenance:** [`ecosystem/MAINTENANCE.md`](./ecosystem/MAINTENANCE.md)

## Start here

1. [PROJECT.md](./ecosystem/PROJECT.md)  
2. [SERVICES.md](./ecosystem/SERVICES.md)  
3. [BRANCHING.md](./ecosystem/BRANCHING.md) — trunk + long-running `<app>-v2` clones; never deploy from a clone  
4. [AI_CONVENTIONS.md](./ecosystem/AI_CONVENTIONS.md) · root [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md)  
5. [NAMING.md](./ecosystem/NAMING.md)  
6. [FLEET.md](./ecosystem/FLEET.md)  
7. [MIGRATION.md](./ecosystem/MIGRATION.md)  
8. Template app: [apps/symply-house/](./apps/symply-house/README.md)
