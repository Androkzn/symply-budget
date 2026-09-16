# Product Analytics — PostHog

Behavioral / product analytics for the Symply Ecosystem mobile apps. Backed by
**PostHog** (open-source, generous free tier ~1M events/mo, EU-hosting / self-host
options). One integration serves **all brands** — events are auto-tagged with the
active brand so a single PostHog project yields per-app dashboards.

> **Scope.** This is *product* analytics (who does what, funnels, retention).
> It complements, and does not replace:
> - **Sentry** — crashes / errors / performance ([sentry.md](./sentry.md))
> - **RevenueCat** — subscriptions / revenue ([src/services/purchases.ts](../../src/services/purchases.ts))
> - **Cloudflare Analytics Engine** — backend/server-side metrics (scaffolded, disabled — see [backend/wrangler.toml](../../backend/wrangler.toml))

---

## Files

| File | Role |
|------|------|
| [src/services/analytics.ts](../../src/services/analytics.ts) | Provider-agnostic wrapper — the **only** module features import |
| [src/config/env.ts](../../src/config/env.ts) | `POSTHOG_API_KEY` / `POSTHOG_HOST` config |
| [app/_layout.tsx](../../app/_layout.tsx) | Init + identify/reset + screen tracking |
| [jest.setup.js](../../jest.setup.js) | `posthog-react-native` test mock |
| [app.json](../../app.json) | `expo-localization` plugin (locale auto-context) |

The wrapper is deliberately provider-agnostic: features call `trackEvent(...)`,
never PostHog directly, so the backing provider can be swapped without touching
call sites.

---

## Configuration

The PostHog **project API key** is a *publishable* client key (safe to embed,
exactly like the RevenueCat public keys) — **never** a personal/server key.

Set in `.env.local` (gitignored) and in EAS env for builds:

```sh
# .env.local
EXPO_PUBLIC_POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Optional — defaults to US cloud. Use eu.i.posthog.com for EU, or your self-host URL.
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Get the key: PostHog → **Project settings → Project API key**.

### Gating (important)

Analytics sends only when a key is set **and** it's enabled:

1. `EXPO_PUBLIC_POSTHOG_API_KEY` is set — no key ⇒ the module is an inert no-op.
2. Enabled = `ENV.FEATURES.ENABLE_ANALYTICS` (`!__DEV__`, so **prod on, dev off by
   default**) **OR** `EXPO_PUBLIC_POSTHOG_DEV=1` (explicit dev opt-in).

Every event carries an `environment` super property (`development` / `production`),
so dev traffic stays filterable from real usage in the PostHog UI.

**To verify locally:** set `EXPO_PUBLIC_POSTHOG_DEV=1` in `.env.local`, rebuild, and
open the app — a cold start fires `app_opened`, visible in PostHog → **Activity**
within seconds (dev flushes every event immediately, `flushAt: 1`). Unset the flag
when done for clean prod-only data.

---

## Usage

```ts
import { trackEvent, trackScreen, AnalyticsEvent } from '@services/analytics';

// Product event (prefer the AnalyticsEvent catalog; any string is accepted)
trackEvent(AnalyticsEvent.HOUSEHOLD_CREATED, { source: 'onboarding' });
trackEvent('utility_bill_added', { provider: 'hydro', amount: 84.2 });

// Manual screen view (the router shell auto-tracks — see below)
trackScreen('PaywallScreen', { plan: 'annual' });
```

| Function | When |
|----------|------|
| `initAnalytics()` | Once at root — already wired in `RootLayout` |
| `identifyUser(userId, traits?)` | On login — already wired to the auth store |
| `resetAnalytics()` | On sign-out — already wired |
| `trackEvent(name, props?)` | Any product action |
| `trackScreen(name, props?)` | Screen view (router shell auto-fires) |
| `setUserProperties(traits)` | Update person profile (`$set`) |
| `flushAnalytics()` | Best-effort flush before a hard sign-out |

**Event naming:** `snake_case`, verb-first, past tense (`household_created`,
`subscription_started`). Add shared names to the `AnalyticsEvent` catalog in the
wrapper so they stay consistent across brands.

### What's auto-tracked

- **Super properties on every event:** `brand` (active brand slug), `platform`,
  `app_version`, `build_number` — so every metric slices by app + platform.
- **Screen views** for the authenticated expo-router shell (`usePathname`).
  The signed-out RootNavigator (React Navigation) flow is **not** auto-tracked
  yet — add `trackScreen()` calls there if you need pre-auth funnels.
- **Identity** bound to the Symply user id on login, reset on logout (mirrors
  RevenueCat).

### Events instrumented out of the box

The core acquisition → activation → revenue funnel is already wired:

| Event | Fires from |
|-------|-----------|
| `app_opened` | `initAnalytics()` on cold start ([analytics.ts](../../src/services/analytics.ts)) |
| `signed_up` | Email registration success ([RegisterScreen](../../src/screens/auth/RegisterScreen.tsx)) |
| `signed_in` | Every authentication ([authStore.login](../../src/stores/authStore.ts)) |
| `signed_out` | Sign-out ([authStore.logout](../../src/stores/authStore.ts)) |
| `onboarding_completed` | [authStore.completeOnboarding](../../src/stores/authStore.ts) |
| `household_created` | Onboarding [CreateHouseholdScreen](../../src/screens/onboarding/CreateHouseholdScreen.tsx) |
| `household_join_requested` | Onboarding [JoinHouseholdScreen](../../src/screens/onboarding/JoinHouseholdScreen.tsx) |
| `paywall_viewed` | Paywall mount ([ai-access/paywall.tsx](../../app/ai-access/paywall.tsx)) |
| `subscription_started` | Purchase success ([purchases.ts](../../src/services/purchases.ts)) |
| `subscription_restored` | Restore success ([purchases.ts](../../src/services/purchases.ts)) |

`signed_in` fires on **every** authentication (email/Apple/Google, login or
register); `signed_up` marks a new email account specifically. Add feature-level
events with `trackEvent('your_event', {...})`.

---

## Multi-brand

The analytics **code is shared** — one `src/services/analytics.ts` serves every
brand, and each event is auto-tagged with `brand: <slug>` (House, Budget,
Kaizen/`symply-kaizen`, Language, Health). Do **not** fork the analytics code per brand.

The key is resolved at init:

1. If the active brand pack declares `integrations.posthog` (in
   [`brands/<id>/brand.cjs`](../../brands)), that brand uses that key. An
   **empty** `apiKey` means analytics is intentionally OFF for that brand — it
   never falls back to the env key (no cross-contamination).
2. Otherwise the brand falls back to the shared `EXPO_PUBLIC_POSTHOG_API_KEY` env
   key.

**Current model — one shared project, brand-tagged.** All 5 brand packs declare
`integrations.posthog` with the **same** publishable key → the single shared
ecosystem project **509073** (US). Each app is distinguished by the `brand`
super-property, so one project yields per-app dashboards (the same model Sentry
uses today — see [sentry.md](./sentry.md)). Because every pack sets a key, the
`EXPO_PUBLIC_POSTHOG_API_KEY` env fallback is an override, not the live path.

| Brand | PostHog project | Key in `brands/<id>/brand.cjs` |
|-------|-----------------|--------------------------------|
| House (`symply-house`) | 509073 (US), shared | ✅ set |
| Budget (`symply-budget`) | 509073 (US), shared | ✅ set |
| Kaizen (`symply-kaizen`) | 509073 (US), shared | ✅ set |
| Language (`symply-language`) | 509073 (US), shared | ✅ set |
| Health (`symply-health`) | 509073 (US), shared | ✅ set |

**Splitting a brand into its own project (optional):** create a PostHog project →
copy its Project API key (`phc_…`) → replace that brand's
`integrations.posthog.apiKey` in `brand.cjs`. The key is a publishable client key
(safe to commit, like the Google client IDs already in those files). That brand
then reports to its own project with the same 10 events, still tagged by brand.

---

## Testing

`posthog-react-native` is mocked in [jest.setup.js](../../jest.setup.js) with a
stub client. The wrapper is a no-op without a key, so suites that transitively
import it stay green with no extra setup.

---

## Privacy

The [Privacy Policy](../../src/screens/settings/PrivacyPolicyScreen.tsx) already
promises "analytics SDKs (with opt-out option)". PostHog supports opt-out and EU
data residency / self-hosting. When you add a consent toggle, gate it by not
calling `initAnalytics()` (or calling `resetAnalytics()` + opt-out).

---

## Roadmap (not enabled yet — keep it cheap to start)

- **Session replay** — add `posthog-react-native-session-replay` + the config
  plugin (native rebuild). Free tier included.
- **Feature flags / A/B tests** — PostHog can replace the hardcoded
  `ENV.FEATURES` flags with remote flags and let you A/B test pricing per brand.
- **Cloudflare Analytics Engine** — flip on the scaffolded binding in
  [backend/wrangler.toml](../../backend/wrangler.toml) for near-free server-side
  event metrics via `writeDataPoint`
  ([aihousekeeper-metrics.ts](../../backend/src/services/observability/aihousekeeper-metrics.ts)).

---

## Related

- Service inventory + console: [../ecosystem/SERVICES.md](../ecosystem/SERVICES.md)
- Architecture: [../../CLAUDE.md](../../CLAUDE.md) §5
