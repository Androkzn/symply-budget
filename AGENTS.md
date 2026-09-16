# Symply Budget — agent guide

This repository is the standalone Symply Budget application. It contains one brand only: `symply-budget`.

## Scope

- Preserve the existing frontend, backend, business logic, native targets, and store identifiers.
- Do not add dependencies on the former Symply Ecosystem repository or sibling apps.
- Never commit `.env`, credentials, provisioning profiles, certificates, or `.p12` files.
- Use the `main` checkout for deployment.

## Checks

```bash
npm run validate:brand -- symply-budget
npm run verify:standalone
npm run typecheck
git diff --check
cd ios && pod install --no-repo-update
```

## Backend

```bash
eval "$(./scripts/secrets/export-env.sh)"
cd backend && npm run deploy:staging && npm run deploy:production
```

Use the existing Budget Worker and D1/R2/KV resources; do not deploy a fleet.
