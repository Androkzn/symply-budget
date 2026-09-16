# Crash / Error Monitoring — Sentry

Crash, error and (optionally) performance monitoring for the Symply Ecosystem —
**mobile apps** (all 5 brands) **and the backend Worker**. Backed by **Sentry**.

The design mirrors [analytics.md](./analytics.md) (PostHog): one provider-agnostic
wrapper each feature imports, brand-aware project resolution, and a gate that
makes it an inert no-op when unconfigured.

> **Scope.** This is *crash / error* monitoring (stack traces, native crashes,
> unhandled rejections). It complements, and does not replace:
> - **PostHog** — product analytics ([analytics.md](./analytics.md))
> - **RevenueCat** — subscriptions / revenue ([src/services/purchases.ts](../../src/services/purchases.ts))

---

## Files

| File | Role |
|------|------|
| [src/services/monitoring.ts](../../src/services/monitoring.ts) | Provider-agnostic Sentry wrapper — the **only** module features import (`captureException`, `identifyMonitoringUser`, `wrapRoot`, …) |
| [src/config/env.ts](../../src/config/env.ts) | `SENTRY_DSN` / `SENTRY_DEV` config + shared fallback DSN |
| [src/brand/types.ts](../../src/brand/types.ts) | `BrandSentryConfig` — per-brand DSN / project slug |
| [app/_layout.tsx](../../app/_layout.tsx) | `initMonitoring()` at module load + identify/reset + `wrapRoot()` |
| [app.config.ts](../../app.config.ts) | Brand-aware `@sentry/react-native/expo` plugin (source-map upload target) |
| [jest.setup.js](../../jest.setup.js) | `@sentry/react-native` test mock |
| [backend/src/index.ts](../../backend/src/index.ts) | `Sentry.withSentry()` wraps the Worker handler; `captureException` in `onError` |
| [backend/wrangler.toml](../../backend/wrangler.toml) | `SENTRY_DSN` var per env |

Features call `captureException(...)` / `captureMessage(...)`, never Sentry
directly, so the backing provider can be swapped without touching call sites.

---

## How it resolves per-app

Every brand reports to its **own** Sentry project. Resolution order at init
(`src/services/monitoring.ts`):

1. `brand.integrations.sentry.dsn` — the brand's own project (empty string ⇒
   crash reporting intentionally **OFF** for that brand, no fallback).
2. else `ENV.SENTRY_DSN` (`EXPO_PUBLIC_SENTRY_DSN`, default = the shared project).

All 5 brands now declare their own `integrations.sentry.dsn` (real per-app
projects — see the table below). Every event is also tagged with `brand`,
`environment`, `platform`, `app_version`, `build_number`, plus a per-brand
`release` (`<brand>@<version>+<build>`). The user id is bound via `setUser` on
login (cleared on logout). If a brand's DSN is ever removed, it falls back to the
shared `ENV.SENTRY_DSN` rather than going dark.

### Gating

- **No DSN** → inert no-op (safe to ship un-configured).
- Sends only when `ENV.FEATURES.ENABLE_CRASH_REPORTING` (`!__DEV__`) **or**
  `EXPO_PUBLIC_SENTRY_DEV=1` (dev-verification opt-in). Dev traffic is tagged
  `environment: development` so it stays filterable.

---

## Sentry projects (one per app + backend)

| Brand / service | Sentry project slug | Project ID | Runtime DSN location |
|---|---|---|---|
| symply-house | `symply-house` | 4511730659295232 | `brands/symply-house/brand.cjs` → `integrations.sentry.dsn` |
| symply-budget | `symply-budget` | 4511730659360768 | `brands/symply-budget/brand.cjs` |
| symply-kaizen | `symply-kaizen` | 4511730659426304 | `brands/symply-kaizen/brand.cjs` |
| symply-language | `symply-language` | 4511730659491840 | `brands/symply-language/brand.cjs` |
| symply-health | `symply-health` | 4511730659557376 | `brands/symply-health/brand.cjs` |
| backend Workers (all) | `symply-backend` | 4511730659622912 | `backend/wrangler.{toml,budget,kaizen,health}.toml` → `SENTRY_DSN` |

Org: `andrei-tekhtelev` (`o4506338522431488`). DSNs are **publishable** client
keys (safe to commit, exactly like the PostHog client key) — never the
`SENTRY_AUTH_TOKEN`. Source-map upload (`app.config.ts`) targets the brand's own
`integrations.sentry.project`.

**Backend model:** the backend is one shared codebase (`backend/src`) deployed as
per-brand Workers (`simple-house-api`, `simple-budget-api`, `symply-kaizen-api`,
`symply-health-api`; Language uses its donor backend). All of them report to the
**single `symply-backend` project** — a shared-code bug then surfaces once, not
scattered across projects. Which Worker/env raised it is visible from the request
host + the `environment` tag. Local `wrangler dev` leaves `SENTRY_DSN` empty
(disabled).

---

## Setup runbook — creating projects & filling DSNs

> **Status (2026-07-13): DONE.** All 6 projects exist (created via the Sentry API
> under team `andrei`) and their DSNs are wired — 5 into `brands/*/brand.cjs`, the
> backend into all four `wrangler*.toml`. Mobile takes effect on the next EAS
> build; backend on the next `deploy:all` (+ per-brand deploys). The `sntryu_`
> admin token used to create them (Keychain `symply.sentry.admin_token`) can be
> revoked now — DSNs are permanent and don't depend on it.
>
> The steps below are retained for **adding a new app** or recreating a project.
> Project creation needs a token with **`project:admin` + `team:admin` + `org:read`**;
> the source-map `SENTRY_AUTH_TOKEN` (`symply.sentry.auth_token`) is `org:ci` only
> and **cannot** create projects.

**Option A — dashboard (fastest):** at <https://sentry.io/organizations/andrei-tekhtelev/projects/new/>
create 6 projects (`react-native` platform for the 5 apps, `cloudflare-workers`
for the backend) with the slugs above. Open each project → *Settings → Client
Keys (DSN)* → copy the DSN.

**Option B — API (automatable):** create an org auth token with `project:admin`
+ `team:admin` at *Settings → Auth Tokens*, then:

```sh
TOKEN=...   # project:admin scoped
ORG=andrei-tekhtelev
TEAM=<your-team-slug>          # GET /api/0/organizations/$ORG/teams/
for slug in symply-house symply-budget symply-kaizen symply-language symply-health symply-backend; do
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    "https://sentry.io/api/0/teams/$ORG/$TEAM/projects/" \
    -d "{\"name\":\"$slug\",\"slug\":\"$slug\",\"platform\":\"react-native\"}"
  # then read the DSN:
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://sentry.io/api/0/projects/$ORG/$slug/keys/" | jq -r '.[0].dsn.public'
done
```

**Then wire the DSNs:**

1. Each brand — add to `brands/<id>/brand.cjs` `integrations` (after `posthog`):
   ```js
   sentry: { dsn: 'https://<key>@o4506338522431488.ingest.us.sentry.io/<projectId>', project: 'symply-<brand>' },
   ```
2. Backend — set `SENTRY_DSN` in all `[vars]` blocks of `backend/wrangler.{toml,budget,kaizen,health}.toml`,
   then `cd backend && npm run deploy:fleet` (all shared brands, staging + production).
3. Rebuild the apps so the new DSN ships: `eas build` / `eas update` per brand.

---

## Backend (Cloudflare Worker)

`backend/src/index.ts` wraps the exported handler with `Sentry.withSentry()`
(from `@sentry/cloudflare`), so unhandled errors in `fetch`, `scheduled` and
`queue` are captured and flushed before the Worker terminates. Handled 500s are
reported explicitly from `app.onError`. It is a **no-op when `SENTRY_DSN` is
empty**, so local dev and un-provisioned envs behave exactly as before.

Durable Objects (`JobManagerDO`, `RateLimiterDO`, `ChatRoomDO`) are not yet
instrumented — wrap them with `instrumentDurableObjectWithSentry` if DO-internal
errors need capturing.

---

## Testing

`@sentry/react-native` is mocked in [jest.setup.js](../../jest.setup.js) (native
modules throw on import in the test env). To verify wiring against a real project
locally, set `EXPO_PUBLIC_SENTRY_DEV=1` (+ a DSN) and trigger an error.
