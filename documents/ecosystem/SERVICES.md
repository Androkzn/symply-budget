# Services & agent access — Symply Ecosystem

> **No secret values in this file.** Operator tokens live in **macOS Keychain** (`symply.*`). Worker runtime secrets stay in **Wrangler secrets**.  
> Helpers: [`scripts/secrets/`](../../scripts/secrets/) · Cursor rule: [`.cursor/rules/agent-access.mdc`](../../.cursor/rules/agent-access.mdc)

**GitHub repo:** [Androkzn/symply-ecosystem](https://github.com/Androkzn/symply-ecosystem)

---

## Keychain convention

| Pattern | Example |
|---------|---------|
| Service name | `symply.<system>.<name>` |
| Account | macOS username (`$USER`) |
| Put | `./scripts/secrets/put.sh <service> <value>` or stdin |
| Get | `./scripts/secrets/get.sh <service>` (stdout only — never paste into chat) |
| List | `./scripts/secrets/list.sh` |
| Export for shell | `eval "$(./scripts/secrets/export-env.sh)"` |

---

## Inventory

| System | Role | Auth method | Keychain / store | CLI / tool | Status |
|--------|------|-------------|------------------|------------|--------|
| **GitHub** | ops | `gh` keyring | (managed by `gh`) | `gh` | ready |
| **Cloudflare** | BE deploy | API token | `symply.cloudflare.api_token` → `CLOUDFLARE_API_TOKEN` | `wrangler` | ready |
| **Cloudflare account** | BE | public id | `symply.cloudflare.account_id` → `CLOUDFLARE_ACCOUNT_ID` | wrangler | ready |
| **EAS / Expo** | FE build/submit | Expo login + token | `symply.expo.token` → `EXPO_TOKEN` | `eas`, `expo` | ready |
| **Apple / ASC** | FE iOS Archive + TF upload | ASC API key | Keychain `symply.asc.issuer_id` / `symply.asc.key_id` / `symply.asc.key_path` (+ gitignored `credentials/asc/`); local signing in `credentials/ios/` | `xcrun altool`, [`scripts/upload-tf-ipas.sh`](../../scripts/upload-tf-ipas.sh), `eas` | ready — TF IPA upload non-interactive via API key; Apple ID 2FA still needed for some portal/EAS credential flows |
| **Google Play** | FE Android | Play Console / service account | (configure when submitting) | `eas submit` | needs setup if store |
| **AWS** | Lambda processor | IAM user `simple-house` | `symply.aws.access_key_id` / `symply.aws.secret_access_key` | `aws`, deploy scripts | ready |
| **Lambda→Worker webhook** | Report callback auth (B6) | shared secret | Keychain `symply.lambda.callback_api_key` → Worker secret `LAMBDA_CALLBACK_API_KEY` (all brand Workers × staging/production) + Lambda env | `wrangler secret put` | ready — no `JWT_SECRET` fallback |
| **Sentry** | FE (5 apps) + BE observability | publishable DSN + `org:ci` upload token | per-brand DSN in `brand.cjs` (`integrations.sentry`); backend `SENTRY_DSN` (wrangler); upload token `symply.sentry.auth_token` → `SENTRY_AUTH_TOKEN` | `@sentry/cli`, `@sentry/cloudflare` | wired (brand-tagged, shared project); per-app project DSNs pending — see [engineering/sentry.md](../engineering/sentry.md) |
| **Resend** | email | API key | `symply.resend.api_key` → `RESEND_API_KEY` | API / Worker secret | ready (Keychain) |
| **RevenueCat** | IAP | public SDK (per brand) + Worker secret | `brands/*/brand.cjs` → `integrations.revenueCat` (`appl_`/`goog_`); Worker `REVENUECAT_*` via [`set-revenuecat.sh`](../../scripts/secrets/set-revenuecat.sh); optional env override `EXPO_PUBLIC_REVENUECAT_*` | — | mobile public keys wired; Worker secrets set |
| **PostHog** | FE product analytics | public project key | per-brand key in `brand.cjs` (`integrations.posthog`) → shared project 509073; env override `EXPO_PUBLIC_POSTHOG_API_KEY` | — | ready (all 5 apps, brand-tagged) |
| **Anthropic / OpenAI / Gemini** | BE AI | **BYOK** (user vault) + **managed** Worker keys | User keys via `/ai-credentials`; managed via wrangler / Keychain `symply.test.*` / `symply.gemini.*` | see `entitlement-service.ts` | Both paths live — BYOK preferred when connected; managed used for admin/paid/flags |
| **Google Sign-In** | FE auth | OAuth client IDs in brand packs; Worker verifies id_token | brand `integrations.googleAuth.*`; `GOOGLE_CLIENT_ID` | — | ready (no client secret for Sign-In) |
| **Google Calendar OAuth** | Aihousekeeper scheduling | Web OAuth client (shared) | `GOOGLE_OAUTH_CLIENT_ID` in wrangler `[vars]` (all Workers); `GOOGLE_OAUTH_CLIENT_SECRET` via `wrangler secret put` — Keychain `symply.google.oauth.client_secret`; sync child Workers via [`sync-child-worker-secrets.sh`](../../scripts/secrets/sync-child-worker-secrets.sh) | `/oauth/google/*`, `propose_calendar_slots` | ready on House; child Workers need secret sync |
| **FatSecret** | Symply Health external food database | OAuth 2.0 client-credentials | Keychain `symply.fatsecret.client_id` / `symply.fatsecret.client_secret` → Health Worker secrets `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET` (`wrangler secret put … -c wrangler.health.toml`, staging **and** production) | `backend/src/services/health-food-provider.ts` (the only call site) | **not set** — feature reports `not_configured` and searches the user's own library only; commands in [apps/symply-health/features/food-database.md](../apps/symply-health/features/food-database.md) |
| **Twilio** | AI SMS outbound | `TWILIO_*` | Worker secrets | outbound-dispatcher | **removed** — SMS channel disabled server-side |
| **Notion MCP** | docs | OAuth | Cursor MCP | Notion MCP | ready |
| **Figma MCP** | design | OAuth | Cursor MCP | Figma MCP | ready |
| **Atlassian MCP** | — | — | — | — | **N/A** (not used) |

---

## Deploy playbooks

**Only the `main` checkout may deploy.** `deploy:fleet` ships whatever branch you are on to House, Budget, Kaizen, and Health at once. Never run it from an `<app>-v2` clone. Git model: [BRANCHING.md](./BRANCHING.md).

### Prerequisites (every agent session that deploys)

```bash
cd "/Users/andreitekhtelev/Desktop/Symply Ecosystem/Simply Ecosystem"
eval "$(./scripts/secrets/export-env.sh)"
```

### Backend (Cloudflare Worker) — staging + production together

**Shared Worker changes** (same `src/index.ts` across House, Budget, Kaizen, Health):

```bash
cd backend
npm run typecheck   # when touching TS
npm run deploy:fleet   # all staging brands, then all production (halts on first failure)
# If schema changed — migrate each brand D1 on both envs (see per-brand sections below)
```

**House Worker only** (`wrangler.toml`, no `-c`):

```bash
cd backend
npm run deploy:house:all   # deprecated alias: deploy:all
npm run db:migrate:remote -- --env staging
npm run db:migrate:remote -- --env production
```

**Migration guards:** `npm run check:migrations:frozen` (CI — refuses edits to `0017_add_waste_regulations.sql`); `npm run db:generate:guard` (fail if drizzle schema glob incomplete — prefer hand-written SQL until fixed).

URLs (see also `.cursor/rules/backend-deployment.mdc`):

| Env | URL |
|-----|-----|
| House Staging | `https://simple-house-api-staging.a-tekhtelev.workers.dev` |
| House Production | `https://simple-house-api.a-tekhtelev.workers.dev` |
| Budget Staging | `https://simple-budget-api-staging.a-tekhtelev.workers.dev` |
| Budget Production | `https://simple-budget-api.a-tekhtelev.workers.dev` |
| Kaizen Staging | `https://symply-kaizen-api-staging.a-tekhtelev.workers.dev` |
| Kaizen Production | `https://symply-kaizen-api.a-tekhtelev.workers.dev` |
| Health Staging | `https://symply-health-api-staging.a-tekhtelev.workers.dev` |
| Health Production | `https://symply-health-api.a-tekhtelev.workers.dev` |
| Language Staging (donor) | `https://simple-language-api-staging.a-tekhtelev.workers.dev` |
| Language Production (donor) | `https://simple-language-api.a-tekhtelev.workers.dev` |

Dev mobile builds talk to **staging** (Budget → Budget staging; Kaizen → Kaizen staging; House → House staging; Language → donor Language staging; Health → Health staging).

**House money:** `BUDGET_API_ENABLED=false` — full `/budget|/savings|/wishes` → 404. Lightweight glance: `/households/:id/home-budget/*`.  
**Budget money:** `BUDGET_API_ENABLED=true` — full product.  
**Kaizen:** money off (`features.budget = off`).

Local Archive / TestFlight: [XCODE_LOCAL.md](./XCODE_LOCAL.md) · `npm run verify:apps` · archive via `./scripts/archive-all-brands.sh production` · upload IPAs via `./scripts/upload-tf-ipas.sh ios/build/archives/TF-upload-*` · enable groups `./scripts/run-enable-testflight-groups.sh`

**TestFlight groups (ASC API):** each app has **Symply Internal** (`hasAccessToAllBuilds`) and **Symply External POC** (public link + Beta App Review on latest VALID build). Team testers invited on both groups. External installs unlock after Apple Beta App Review (state `WAITING_FOR_REVIEW` → `APPROVED`). Public join links:

| App | External public link |
|-----|----------------------|
| House | https://testflight.apple.com/join/5Ac4SyEn |
| Budget | https://testflight.apple.com/join/MP9be3BQ |
| Kaizen | https://testflight.apple.com/join/vnDbs9gd |
| Language | https://testflight.apple.com/join/Z1ZuGGss |
| Health | https://testflight.apple.com/join/BWBxK1Bg |

**Budget Worker** (`wrangler.budget.toml`):

```bash
cd backend
npm run deploy:budget:all
npm run db:migrate:budget:staging && npm run db:migrate:budget:production
npm run migrate:house-to-budget -- --emails a.tekhtelev@gmail.com,atextel@gmail.com --pair production --apply
```

**Kaizen Worker** (`wrangler.kaizen.toml`):

```bash
cd backend
npm run deploy:kaizen:all
npm run db:migrate:kaizen:staging && npm run db:migrate:kaizen:production
npm run migrate:house-to-kaizen -- --emails a.tekhtelev@gmail.com,atextel@gmail.com --pair production --apply
```

**Health Worker** (`wrangler.health.toml`):

```bash
cd backend
npm run deploy:health:all
# Full migrate (blocked while 0092_* exists unless HEALTH_ALLOW_0092=1):
npm run db:migrate:health:staging && npm run db:migrate:health:production
# Apply all pending migrations except Data Bridge 0092 (+ 0093 0092-dependent):
npm run db:migrate:health:skip-0092:all
```

**Language backend (`backend-language/` — separate Worker, not part of `deploy:fleet`)**

Symply Language uses its own Worker (`simple-language-api*` URLs in `src/config/env.ts`).
Deploy from this repo — **not** included in `backend/` `deploy:fleet`.

| Env | URL |
|-----|-----|
| Staging | `https://simple-language-api-staging.a-tekhtelev.workers.dev` |
| Production | `https://simple-language-api.a-tekhtelev.workers.dev` |

```bash
# Health-check (read-only)
./scripts/verify-language-backend.sh
# or: cd backend && npm run verify:language:backend

# Deploy staging + production (from backend-language/ or via backend/ wrapper)
eval "$(./scripts/secrets/export-env.sh)"
cd backend-language && npm run deploy:language:all
# or: cd backend && npm run deploy:language:all
```

Per-env only: `deploy:staging` / `deploy:production` (or `deploy` for production).
Legacy alias: `deploy:all` → `deploy:language:all`.

**Do not** add `wrangler.language.toml` under shared `backend/` — Language stays in
`backend-language/`. `deploy:fleet` intentionally excludes Language.

**AASA / universal links gap:** donor Workers return 404 for
`/.well-known/apple-app-site-association`. Platform Workers (House/Budget/Kaizen/Health)
already advertise all 5 `com.symply.*` App IDs. For Language Associated Domains until
migration, temporarily use a platform host (e.g. `applinks:simple-house-api.a-tekhtelev.workers.dev`)
or defer universal links. See [PROVISIONING.md](./PROVISIONING.md) §3.4.

**Policy (rapid development):** agents **own E2E** — develop, verify, and deploy staging **and** production without asking (after loading Keychain secrets), **from the `main` checkout only**. Stop for 2FA, missing credentials, deploy-from-clone, or destructive git. Do not hand undeployed / unverified work back to the human.

### Lambda processor

```bash
cd backend/lambda-processor
./deploy-staging    # or ./deploy-prod (autonomy allowed in rapid-dev)
# code-only: ./deploy-code-only
```

Requires AWS credentials exported from Keychain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

### Frontend (EAS)

Profiles live in `eas.json` (`simple-house-production`, `simple-budget-*`, etc.).

```bash
# Example — confirm brand + profile with user if ambiguous
eas build --profile simple-house-production --platform ios
eas submit --profile simple-house-production --platform ios
# OTA:
eas update --channel simple-house-production --message "…"
```

iOS signing: local `credentials/` + `credentials.json` (gitignored). Apple 2FA may block unattended submit.

### Worker secrets (runtime — not Keychain)

```bash
cd backend
# value from stdin or prompt — do not log
echo -n "$VALUE" | wrangler secret put SECRET_NAME --env staging
echo -n "$VALUE" | wrangler secret put SECRET_NAME --env production
```

**Google Calendar:** `GOOGLE_OAUTH_CLIENT_SECRET` must exist on House + Budget + Kaizen + Health Workers (staging **and** production). Store once in Keychain (`symply.google.oauth.client_secret`) and run `./scripts/secrets/sync-child-worker-secrets.sh`.

---

## Data Bridge secrets

Provision with [`scripts/secrets/set-data-bridge.sh`](../../scripts/secrets/set-data-bridge.sh) `<staging|production>`. Never commit JWKs or edge tokens.

| Secret | Workers | Notes |
|--------|---------|--------|
| `PLATFORM_JWT_PRIVATE_JWK` | House only | ES256 private JWK JSON |
| `PLATFORM_JWT_PUBLIC_KEYS` | House + Budget + Kaizen | JWKS `{"keys":[…]}` |
| `PLATFORM_DELETION_TOMBSTONE_PEPPERS` | House only | Versioned peppers JSON |
| `PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE` | House (+ Lambda env) | AI-job auth only |
| `PLATFORM_SERVICE_TOKEN_*_TO_*` | Directed edges | HTTP fallback only; unique per caller→callee/env |
| `TRANSFER_ENVELOPE_*` / `TRANSFER_METADATA_PEPPERS` | Per exporting/importing Worker | Soft Transfer Phase C |

Service bindings (`HOUSE_SERVICE` / `BUDGET_SERVICE` / `KAIZEN_SERVICE` → `PlatformBridgeApi`) are commented in wrangler for **pass-2** after the named entrypoint is live on peers. Uncomment then redeploy joined Workers.

**Legacy Realtime disposition:** `POST …/aihousekeeper/voice-session` is hard-denied via House D1 `realtimeVoiceEnabled=false` until `AuthorizedRealtimeSessionDO` ships (Phase B2). Dual live voice surfaces are forbidden.

---

## Consoles (bookmarks)

| System | Console |
|--------|---------|
| GitHub | https://github.com/Androkzn/symply-ecosystem |
| Cloudflare | https://dash.cloudflare.com/ |
| Expo / EAS | https://expo.dev/ |
| AWS | https://console.aws.amazon.com/ |
| Sentry | https://sentry.io/ |
| RevenueCat | https://app.revenuecat.com/ |
| PostHog | https://us.posthog.com/ |
| Apple Developer | https://developer.apple.com/account |
| App Store Connect | https://appstoreconnect.apple.com/ |

---

## What still needs a human

- Apple / Google account challenges (2FA, device trust)
- First-time Play Console service account
- **RevenueCat** — 5 RC apps’ public keys live in `brands/*/brand.cjs` (`integrations.revenueCat`). Worker secret/webhook via [`set-revenuecat.sh`](../../scripts/secrets/set-revenuecat.sh) when rotating. No per-profile EAS `EXPO_PUBLIC_REVENUECAT_*` required (brand pack is source of truth; env is override only).
- MCP OAuth Approve in browser (Notion, Figma) — Atlassian not used
- Rotating any key that was ever committed to docs

---

## Related

- [PROVISIONING.md](./PROVISIONING.md) — App Store Connect / Apple / Google / Firebase / RevenueCat / PostHog setup for all 5 apps
- [PROJECT.md](./PROJECT.md) · [NAMING.md](./NAMING.md) · [AI_CONVENTIONS.md](./AI_CONVENTIONS.md)
- [backend-deployment.mdc](../../.cursor/rules/backend-deployment.mdc)
