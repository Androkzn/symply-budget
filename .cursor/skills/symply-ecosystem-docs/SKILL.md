---
name: symply-ecosystem-docs
description: Create and update Symply Ecosystem documentation. Use when working on app README/BRD/TRD/design/migration docs, feature BRDs/TRDs/implementation plans, fix plans, improvements plans, feature indexes, fleet/naming/migration docs, or when coordinating parallel agents to draft docs for Symply House, Budget, Life, Language, Health, or shared _ecosystem contracts.
---

# Symply Ecosystem Docs

Use this skill to create docs that fit the Symply Ecosystem model: one platform repo, Symply House as template parent, child apps as brand packs plus feature modules, shared auth, explicit cross-app consent, and no donor-repo implementation.

## Read Order

Before writing app or feature docs, read:

1. `AGENTS.md`
2. `documents/ecosystem/PROJECT.md`
3. `documents/ecosystem/NAMING.md`
4. `documents/ecosystem/FLEET.md`
5. `documents/ecosystem/MIGRATION.md`
6. `documents/ecosystem/RELATIONSHIPS.md`
7. App work: `documents/apps/<id>/README.md` -> `BRD.md` -> `TRD.md` -> `features/README.md`

For deployment/secrets statements, also read `documents/ecosystem/SERVICES.md`.  
For git / long-running app branches, also read `documents/ecosystem/BRANCHING.md`.

## Template Selection

Use these templates first:

- App docs: `documents/apps/_templates/`
- Feature requirements: `documents/requirements/Templates/Feature Requirenment Template.md`
- Feature TRDs: `documents/requirements/Templates/TRD_Template.md`
- Implementation plans: `documents/requirements/Templates/Implementation_Template.md`
- Fix plans: `documents/requirements/Templates/Fix Plan Template.md`
- Improvements: `documents/requirements/Templates/Improvements Plan Template.md`

Keep the existing misspelled filename `Feature Requirenment Template.md` unless doing a deliberate link migration.

## App Doc Rules

- One app README, one app BRD, one app TRD, one design doc, one migration doc, one feature index.
- App BRD/TRD stay app-level. Do not expand them into feature catalogs.
- Feature detail belongs under `documents/requirements/<Feature>/` and is linked from `documents/apps/<id>/features/README.md`.
- Shared contracts belong in `documents/apps/_ecosystem/`, not in child app docs.
- Use display names `Symply House`, `Symply Budget`, `Symply Life`, `Symply Language`, `Symply Health`.
- Use technical ids exactly as registered: `simple-house`, `simple-budget`, `symply-kaizen`, `simple-language`, `simple-health`.

## Ecosystem Boundaries

- Symply Ecosystem is the project/repo, not a storefront app.
- Symply House is the parent/template app.
- New apps copy `brands/symply-house/` and specialize by brand pack plus feature module.
- Donor repos under `~/Desktop/Symply Ecosystem/` are read-only reference.
- Login, Google/Apple auth, Google Drive, Widget, Watch, tab shell, Shared User, and Smart Engine must not be forked per brand.

## Product Boundaries

- House keeps lightweight home-related budget only.
- Symply Budget owns the standalone/full budget product and gets separate BRD/TRD docs.
- Life is a donor port from `Simply Kaizen/symply-kaizen/` into `src/features/kaizen/`; display `Symply Life` unless the product decision changes.
- Language is a Swift rewrite into the platform.
- Health is a Swift rewrite last and must be privacy-first; cross-app sharing is deny-by-default.

## Cross-App Data

- Shared User owns account identity and stable `user_id`.
- Soft Transfer is opt-in only, versioned by package, and deny-by-default.
- Do not imply silent reads between sibling apps.
- AI entitlement is shared directionally through `_ecosystem`; core product paths should work with AI off unless explicitly approved.

## Verification

For doc-only changes:

- Check local markdown links in touched docs.
- Run `npm run validate:brand` when brand ids, feature modes, or app docs reference brand contracts.
- Update `FLEET.md`, `NAMING.md`, `MIGRATION.md`, `RELATIONSHIPS.md`, or `BRANCHING.md` when identity, fleet status, migration status, cross-app packages, or the git/clone model change.

For behavior changes mentioned in docs, include the relevant verification/deploy gates from `SERVICES.md` instead of telling the human to run routine commands.
