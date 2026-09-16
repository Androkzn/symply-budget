# <Symply Name> - migration

| Field | Value |
|-------|-------|
| Brand id | `<id>` |
| Display | `Symply [Product]` |
| Legacy/current path | `~/Desktop/Symply Ecosystem/...` or `none` |
| Legacy stack | `Expo RN / Swift / mixed / none` |
| Mode | `host-rename / extract / donor-port / swift-rewrite / new-brand` |
| Store continuity | `keep bundle / new listing / TBD` |
| Status | `not-started / inventory / parity / build / beta / shipped` |

## Locked Decisions

| Decision | Value |
|----------|-------|
| Project | Symply Ecosystem |
| Platform repo | `~/Desktop/Symply Ecosystem/Simply Ecosystem/` |
| Implementation rule | Build in this repo only; donors are read-only reference. |
| Shared auth | Shared User; no second account stack. |

## Inventory

| Area | Legacy/current location | Platform target | Notes |
|------|-------------------------|-----------------|-------|
| Auth | | shared auth | Do not fork Login/Register. |
| Core screens | | `src/features/<domain>/` | |
| Local DB / sync | | Worker/D1 or local-only v1 | |
| Push / Widget / Watch | | shared companions | |
| Payments / IAP | | shared entitlements | |
| Sensitive APIs | | explicit privacy plan | |

## Parity Matrix

| Capability | Must | Should | Later | Drop | Platform target |
|------------|------|--------|-------|------|-----------------|
| [Capability] | [ ] | [ ] | [ ] | [ ] | `src/features/...` |

## Identity

| Item | Value |
|------|-------|
| iosBundleId | |
| androidPackage | |
| scheme | |
| Firebase | |
| Sentry | |
| OAuth clients | |
| EAS profiles | |

## Shared User / Data

- Existing users:
- Data migration:
- Soft Transfer packages:
- AI-off path:

## Exit Criteria

- [ ] App docs are real, not placeholders.
- [ ] Must-parity rows are implemented or explicitly deferred.
- [ ] `npm run validate:brand` passes.
- [ ] Symply build reaches TestFlight / internal track when in scope.
- [ ] Legacy sunset plan is dated when replacing an existing app.

See [MIGRATION.md](../../ecosystem/MIGRATION.md).
