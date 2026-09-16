# Symply Ecosystem Docs Workflow

## App Docs

Use `documents/apps/_templates/` and fill these files per app:

- `README.md`
- `BRD.md`
- `TRD.md`
- `design.md`
- `migration.md`
- `features/README.md`

Recommended drafting order:

1. README: identity, product boundary, docs map, code map.
2. BRD: purpose, fleet placement, personas, scope, surfaces, data/sharing, risks.
3. TRD: brand contract, build/release, feature gates, data/API boundaries, integrations, security, QA.
4. design: brand feel, navigation, accessibility, anti-patterns.
5. migration: donor/current state, inventory, parity, identity, exit criteria.
6. features index: active specs and capability links.

## Feature Docs

Use `documents/requirements/Templates/` and keep each feature narrow.

Feature BRD -> Feature TRD -> Implementation Plan -> code.

## Parallel Agent Split

Safe disjoint write scopes:

- `documents/apps/symply-budget/`
- `documents/apps/symply-kaizen/`
- `documents/apps/symply-language/`
- `documents/apps/symply-health/`
- `documents/apps/_ecosystem/`

Do not assign two workers to the same app folder. The coordinator should review for naming, Shared User, Soft Transfer, AI-off, and sibling-app boundary conflicts.
