# Add a new ecosystem app

> End-to-end playbook. Do steps in order. Update [FLEET.md](./FLEET.md) in the same change.

## 0. Prerequisites

- [ ] Fill ids using [NAMING.md](./NAMING.md) (bundle, package, scheme, Sentry, Firebase) **before** coding
- [ ] Product one-liner + why it is a separate brand (not a House feature)
- [ ] Fleet order slot agreed
- [ ] Parent [`_ecosystem`](../apps/_ecosystem/README.md) still applies

## 1. Docs kit (`documents/apps/<id>/`)

```sh
# From repo root — replace <id> (kebab-case, matches brand id)
ID=<id>
mkdir -p "documents/apps/$ID/features"
cp documents/apps/_templates/APP_BRD_Template.md "documents/apps/$ID/BRD.md"
cp documents/apps/_templates/APP_TRD_Template.md "documents/apps/$ID/TRD.md"
cp documents/apps/_templates/APP_README_Template.md "documents/apps/$ID/README.md"
cp documents/apps/_templates/APP_design_Template.md "documents/apps/$ID/design.md"
cp documents/apps/_templates/APP_features_README_Template.md "documents/apps/$ID/features/README.md"
cp documents/apps/_templates/APP_migration_Template.md "documents/apps/$ID/migration.md"
```

Then:

1. Replace placeholders (`Symply …`, brand-id).  
2. Fill **one** app BRD + **one** app TRD (general only).  
3. Leave `features/README.md` empty until first feature.  
4. Add row to [FLEET.md](./FLEET.md) / [RELATIONSHIPS.md](./RELATIONSHIPS.md) as needed.  
5. Register ids per [NAMING.md](./NAMING.md).  
6. Link from [apps/README.md](../apps/README.md).

## 2. Brand pack (code)

Follow [NEW_BRAND_CHECKLIST.md](../design/NEW_BRAND_CHECKLIST.md):

- [ ] `brands/<id>/` (+ `brand.cjs` sync)
- [ ] Register in `brands/index.ts` + `brands/resolve.cjs`
- [ ] Tokens / assets / tabs / integrations
- [ ] EAS profiles + Update channel
- [ ] `validate-brand` passes

## 3. Feature module (if new domain)

- [ ] `src/features/<domain>/` (prefer shared module + brand gate over forks)
- [ ] Feature BRD/TRD under `documents/requirements/<Feature>/` when scope is large
- [ ] Point to those from `apps/<id>/README.md`

## 4. Design

- [ ] App `design.md` links to [`../design/`](../design/INDEX.md) + brand notes
- [ ] No second design system

## 5. Done when

- [ ] FLEET row present  
- [ ] App BRD + TRD + README + design.md exist  
- [ ] Brand pack builds  
- [ ] Soft Transfer rows updated (or explicitly “none”)  
- [ ] AI can answer “what is this app?” from `apps/<id>/README.md` alone  
