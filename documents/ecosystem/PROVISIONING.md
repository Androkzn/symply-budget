# App Provisioning Guide — Symply Ecosystem (all 5 apps)

100% follow-along guide to (re)create **App Store Connect**, **Apple Developer**,
**Google Cloud**, **Firebase (Android push)**, **RevenueCat**, and **PostHog**
for the 5 apps — with one consistent naming convention. Covers Apple Push,
Android Push, Apple Login, Google Login, Google Drive, Widget, and Watch.

> **Convention chosen:** bundle base `com.symply.<app>`. Internal code brand `id`
> (e.g. `symply-kaizen`) stays — only the *external* identifiers become `com.symply.*`.

---

## 0. Master naming table (the single source of truth)

| App | Code `id` | **Bundle ID / Android pkg** | App Group | Widget | Watch | Scheme | App Store name | Cloud/PostHog project |
|-----|-----------|------------------------------|-----------|--------|-------|--------|----------------|-----------------------|
| House | `simple-house` | `com.symply.house` | `group.com.symply.house` | `com.symply.house.widget` | `com.symply.house.watchkitapp` | `simplehouse` | **Symply House** | `symply-house` |
| Budget | `simple-budget` | `com.symply.budget` | `group.com.symply.budget` | `com.symply.budget.widget` | `com.symply.budget.watchkitapp` | `simplebudget` | **Symply Budget** | `symply-budget` |
| Kaizen | `symply-kaizen` | `com.symply.kaizen` | `group.com.symply.kaizen` | `com.symply.kaizen.widget` | `com.symply.kaizen.watchkitapp` | `kaizen` | **Symply Kaizen** | `symply-kaizen` |
| Language | `simple-language` | `com.symply.language` | `group.com.symply.language` | `com.symply.language.widget` | `com.symply.language.watchkitapp` | `simplelanguage` | **Symply Language** | `symply-language` |
| Health | `simple-health` | `com.symply.health` | `group.com.symply.health` | `com.symply.health.widget` | `com.symply.health.watchkitapp` | `simplehealth` | **Symply Health** | `symply-health` |

Watch extension = `<watch>.watchkitextension`. Schemes are kept as-is (internal,
low-visibility) to avoid deep-link churn.

**Account constants (already known):**

| | Value |
|---|---|
| Apple Team ID | `B2ZY5M2YW2` |
| Apple ID (submit) | `a.tekhtelev@gmail.com` |
| Old House ASC app id | `6758272527` → **will change** when you recreate the app record |
| Google Cloud project number | `144228018802` (`symply-ecosystem` — shared OAuth + Firebase; old `630617035110` deleted) |

---

## 1. Order of operations (do in this sequence)

1. **Clean up** old/duplicate records (below).
2. **Apple Developer** → Identifiers (App IDs + App Groups + capabilities) + **1 APNs key**.
3. **App Store Connect** → create the 5 app records.
4. **Google Cloud** → 1 project + consent screen + Drive API + OAuth clients.
5. **Firebase** → 1 project + 5 Android apps → download FCM service account.
6. **EAS** → upload APNs key + FCM key; register the 5 EAS projects.
7. **RevenueCat** → 5 apps + entitlement + public keys.
8. **PostHog** → 4 remaining projects (House done).
9. **Code** → paste all IDs into the brand packs (§10).

> **Two big simplifications:** (a) the **APNs key is ONE per Apple team** — create
> it once, reuse for all 5 apps. (b) Use **ONE** Google Cloud project for all
> 5 apps (one consent screen, Drive enabled once, per-app OAuth clients inside).

---

## 2. Cleanup first

**App Store Connect** — you have clutter:
- **Keep:** Simple House, Simple Kaizen, Simple Health, Simple Language (you'll
  recreate/rename these to `Symply *` with new bundle IDs — see note below).
- **Keep, unrelated:** `Huppy` (that's a real separate app — leave it alone).
- **Archive/ignore:** `My Tracking App`, `Weight Insights` (not in the ecosystem).
- **Missing:** there is **no Symply Budget** app yet — create it.

> ⚠️ **Bundle IDs are permanent once an app record exists.** The current apps use
> `fox-family.*`. To move to `com.symply.*` you must **create new app records**
> with the new bundle IDs (you can't rename a bundle ID). The old `Simple *`
> records aren't submitted yet, so delete them after the new ones work, or just
> leave them hidden. New app names: **Symply House/Budget/Kaizen/Language/Health**.

**Google Cloud — ✅ DONE (2026-07-13).** All Symply legacy projects deleted (9:
3 `gen-lang` Gemini playgrounds + `simple-house-app`, `kaizen-502021`,
`simple-house-38dc9`, `kaizen-a3c4c`, `Default Gemini Project`, `Awesome App`).
Single clean project **`symply-ecosystem`** (`144228018802`) created with Gemini +
Maps keys migrated, Drive/People APIs, billing. Also deleted per request:
`Burnaby Sailing Association`. **Kept (not Symply):** `Step` (your active
company — do not delete), `Huppy` ×2.

**Firebase** — create one `symply-ecosystem` project for Android push.

---

## 3. Apple Developer Portal → Certificates, Identifiers & Profiles

### 3.1 APNs Auth Key (ONE, shared by all 5 apps) — do this once

Keys → **+** → **Apple Push Notifications service (APNs)** → name `Symply APNs` →
Continue → **Download the `.p8`** (you can only download once — store it safely).
Note the **Key ID** and your **Team ID**. You'll upload this to EAS in §6.

### 3.2 Per app — create App IDs (Identifiers → **+** → App IDs → App)

> **Status: ✅ done — automated.** All 20 identifiers (5 apps × main/widget/watch/watch-ext)
> and their capabilities were created via the App Store Connect API using
> [`scripts/provision/`](../../scripts/provision/) (ASC key in Keychain `symply.asc.*`):
> ```sh
> ./scripts/provision/run-apple-identifiers.sh --dry-run   # plan
> ./scripts/provision/run-apple-identifiers.sh             # apply (idempotent)
> node scripts/provision/verify-identifiers.mjs            # verify vs expected matrix
> ```
> Note: `APPLE_ID_AUTH` (Sign in with Apple) requires the
> `APPLE_ID_AUTH_APP_CONSENT: PRIMARY_APP_CONSENT` setting or Apple 409s. `IN_APP_PURCHASE`
> is auto-added by Apple as a default (harmless). **App Group entities + their assignment**
> and **app records** are NOT API-exposed — still manual (§3.3, §4).

For **each** of the 5 apps, create the main App ID + its extensions:

| Identifier | Type | Capabilities to enable |
|-----------|------|------------------------|
| `com.symply.<app>` | App | **Push Notifications**, **Sign in with Apple**, **App Groups**, **Associated Domains**; Health app also **HealthKit** |
| `com.symply.<app>.widget` | App | **App Groups** |
| `com.symply.<app>.watchkitapp` | App | **App Groups**, Push (if watch notifications) |
| `com.symply.<app>.watchkitapp.watchkitextension` | App | **App Groups** |

### 3.3 App Group per app (Identifiers → **+** → App Groups)

> **Status: ✅ done — automated.** All 5 groups (`group.com.symply.*`) created and
> assigned to each app's 4 identifiers via
> [`scripts/provision/apple-app-groups.rb`](../../scripts/provision/apple-app-groups.rb)
> (Spaceship::Portal + the `fastlane spaceauth` session — the App Store Connect
> **API key can't** touch App Groups). Verify with
> `ruby scripts/provision/verify-app-groups.rb`. Group internal IDs: house `QYQ4Q6U633`,
> budget `3KAW96HT67`, kaizen `38UTVG4Y8U`, language `UQM78APQ67`, health `TX75S6D54W`.

Create `group.com.symply.<app>` for each app, then **assign it** to that app's main
App ID + widget + watch + watch-extension (App Groups is how the widget/watch read
the token — see [watch-sync](../../src/services/watch-sync.ts) / widget sync).

### 3.4 Associated Domains (universal / invite links)

Your invite links use the **backend Worker domain**, not a marketing domain:
- House/Kaizen → `applinks:simple-house-api.a-tekhtelev.workers.dev`
- Budget → `applinks:simple-budget-api.a-tekhtelev.workers.dev`
- Health → `applinks:symply-health-api.a-tekhtelev.workers.dev`
- Language → **gap** — RN shell calls the **donor** Worker (`simple-language-api*.workers.dev`),
  which does **not** serve AASA (404). Until Language migrates onto a platform Worker, either
  point Language Associated Domains at a platform host that already advertises all 5 App IDs
  (e.g. `simple-house-api.a-tekhtelev.workers.dev`) or defer universal links for Language.

Enable **Associated Domains** on each App ID, and make sure the Worker serves
`/.well-known/apple-app-site-association` for that app's Team ID + bundle ID.

> **Status: ✅ done + deployed** (2026-07-13). [backend/src/index.ts](../../backend/src/index.ts)
> now serves brand-aware AASA/assetlinks: **iOS** advertises all 5 `B2ZY5M2YW2.com.symply.*`
> App IDs (+ legacy `fox-family.simple-house` for rollout safety) on every **platform** Worker;
> **Android** lists `com.symply.house` (+ legacy `com.anonymous.simplehouse`) with the
> shared debug + House release SHA-256. Deployed staging **and** production to House, Budget,
> Kaizen, and Health Workers and curl-verified.
>
> ⚠️ **Language AASA gap:** donor `simple-language-api` owns the API host but returns 404 for
> `/.well-known/apple-app-site-association`. Do **not** deploy a colliding `wrangler.language.toml`
> over the live donor without explicit confirmation. See [SERVICES.md](./SERVICES.md).
>
> ⏳ **Remaining:** add per-app Android release SHA-256 for
> `com.symply.budget/kaizen/language/health` once each app's first EAS build mints its
> keystore (see the `TODO` in the `ANDROID_APP_LINKS` table).

---

## 4. App Store Connect → create the 5 app records

> **Status: ✅ done — automated** (2026-07-13) via
> [`scripts/provision/create-app-records.sh`](../../scripts/provision/create-app-records.sh)
> (`fastlane produce` + the spaceauth session — the ASC **API key can't** create app
> records: `The resource 'apps' does not allow 'CREATE'`). Created under the
> **individual** ASC team "Andrei Tekhtelev" (`itc_team_id 121679759`, dev team
> `B2ZY5M2YW2`) — the team the bundle IDs live in. **New ASC App IDs:**
>
> | App | ASC App ID |
> |-----|-----------|
> | Symply House | `6790505308` |
> | Symply Budget | `6790505414` |
> | Symply Kaizen | `6790505368` |
> | Symply Language | `6790505445` |
> | Symply Health | `6790505448` |
>
> `eas.json` submit profiles: all 5 apps use `appleId` + `appleTeamId` + `ascAppId` (House
> `6758272527` → `6790505308`; Budget/Kaizen/Language/Health added).
> Old `fox-family.*` / `Simple *` records left untouched (delete once new builds are green).

Apps → **+** → New App, for each:

| Field | Value |
|-------|-------|
| Platform | iOS |
| Name | **Symply House** / Budget / Kaizen / Language / Health |
| Primary language | English (U.S.) |
| Bundle ID | pick `com.symply.<app>` (must exist from §3.2) |
| SKU | `symply-<app>` (any unique string) |
| User access | Full |

Then per app: set category, add the RevenueCat subscription group (§7), and the
"Sign in with Apple" + push are inherited from the App ID capabilities.

---

## 5. Sign in with Apple

> **Status: ✅ done for all 5 apps** (2026-07-13). Native flow only — the app sends the
> identity token and the Worker verifies it against Apple's **public** keys. **No private
> SIWA key is used** (`APPLE_PRIVATE_KEY`/`APPLE_KEY_ID` are set as Worker secrets but
> referenced nowhere in code), so the old per-app SIWA keys were safely **deleted**.

- **iOS (native):** `APPLE_ID_AUTH` capability enabled on all 5 App IDs (§3.2);
  `appleAuth.enabled: true` set for all brands.
- **Backend audience:** [`verifyAppleToken`](../../backend/src/utils/jwt.ts) now accepts
  **all 5** `com.symply.*` bundle IDs (was single-valued `APPLE_SERVICES_ID`). Deployed to
  all 3 Workers. So every app's Sign in with Apple works against one backend.

### 5a. WeatherKit (House only)

> **Status: ✅ LIVE (2026-07-13).** WeatherKit key `D934SB3PB4` created, capability enabled on
> `com.symply.house`, `WEATHERKIT_KEY_ID`/`WEATHERKIT_PRIVATE_KEY`/`WEATHERKIT_SERVICE_ID` set on
> the House Worker (staging+prod). Verified end-to-end against Apple's REST API (200 + live temps).
> Note: the capability took ~20 min to propagate before REST stopped returning `NOT_ENABLED`.
>
> House's Aihousekeeper morning briefing pulls real
> weather via [`weather-service.ts`](../../backend/src/services/weather-service.ts) →
> [briefing-composer](../../backend/src/services/aihousekeeper/briefing-composer.ts).
> **Feature-gated:** returns null (briefing just omits weather) until the WeatherKit key
> is set. WeatherKit is **not** enableable via the ASC API or spaceship — portal-only.

To turn it on:
1. **Identifiers → `com.symply.house` → enable WeatherKit** (portal checkbox).
2. **Keys → + → name `Symply WeatherKit`, check WeatherKit → download the `.p8`.**
3. Set the Worker secrets (House worker, staging **and** production):
   ```sh
   cd backend
   npx wrangler secret put WEATHERKIT_KEY_ID --env staging     # + --env production
   npx wrangler secret put WEATHERKIT_PRIVATE_KEY --env staging # paste the .p8 PEM
   echo -n "com.symply.house" | npx wrangler secret put WEATHERKIT_SERVICE_ID --env staging
   ```
   (`APPLE_TEAM_ID` is already set.) Location comes from the household's `postal_code` +
   `country`, geocoded via the free keyless zippopotam.us. Native WeatherKit needs **no
   key** — only the REST API used here does.

---

## 6. Google Cloud → ONE project for all app OAuth + Drive

> **Status (done via CLI):** project **`symply-ecosystem`** (number `144228018802`)
> created; Drive/People/Gemini/Maps APIs enabled; billing linked. **Gemini key** →
> Worker secret `GEMINI_API_KEY` (staging+prod, backend migrated). **Maps/Places key**
> → Keychain `symply.google.places_key` + `.env.local` `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`.
> **Remaining = OAuth clients (Console-only, below).**

Project **`symply-ecosystem`** is created. Then:

### 6.1 Enable APIs
APIs & Services → Library → enable **Google Drive API** (and **People API** if you
read profile). Enable once — it covers all apps in the project.

### 6.2 OAuth consent screen
- User type **External** → app name **Symply**, support email, logo.
- **Scopes:** `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and for Drive
  **`.../auth/drive`** (full Drive access).
- Add yourself as a **Test user** while unverified.

> **`drive` is a Google _restricted_ scope** → the project needs OAuth
> verification **and** an annual CASA security assessment before it can leave
> test-user mode. Budget it: the assessment is paid and takes weeks.
>
> This is not new exposure — the app already shipped `drive.readonly`, which is
> restricted on the same terms — but the consent screen is now broader, and
> **every existing grant is narrower than what the app asks for**, so all
> current Drive users must re-consent once.

<details>
<summary>Why not the narrower <code>drive.file</code>?</summary>

`drive.file` grants access only to files the app itself created. That is enough
to write backups into the app's own folder, and it is what the app used until
the Budget backup **folder picker** landed: choosing an arbitrary folder out of
your own Drive means `files.create` with a `parents` id the app never created,
which `drive.file` answers with `404 File not found: <id>`. Browsing was never
the blocker (`drive.readonly` already listed the whole tree) — writing into the
chosen folder was.

The alternative that avoids the scope is Google's own **Picker API**, which
grants `drive.file` access to whatever the user selects. It needs a Picker API
key, a hosted origin page and a WebView bridge; rejected as more moving parts
than the feature is worth. See
[`src/services/cloud-storage/google-drive.ts`](../../src/services/cloud-storage/google-drive.ts).
</details>

### 6.3 OAuth clients (Credentials → **+ Create credentials → OAuth client ID**)

Create, **per app**:

| Client type | How many | Key field | Goes into brand pack |
|-------------|----------|-----------|----------------------|
| **iOS** | 5 (one per bundle) | Bundle ID = `com.symply.<app>` | `integrations.googleAuth.iosClientId` + `googleDrive.iosClientId` |
| **Android** | 5 (one per package) | Package = `com.symply.<app>` + **SHA-1** (get via `eas credentials`) | `...androidClientId` |
| **Web** | 1 (shared) | — | `...webClientId` (backend id_token audience) |

> The iOS **reversed client ID** URL scheme is injected automatically from the
> brand's `iosClientId` in [app.config.ts](../../app.config.ts) — no manual scheme
> needed once each brand has its own iOS client.

### 6.4 Google Drive — nothing extra beyond §6.1–6.3
Drive uses the same OAuth clients + the `drive` scope (§6.2). `googleDrive: true`
is already set for all 5 brands.

---

## 7. Android Push (FCM) → Firebase

> **Status: ✅ done — automated** (2026-07-13) via
> [`scripts/provision/firebase-android.sh`](../../scripts/provision/firebase-android.sh)
> (Firebase Management API + gcloud). Firebase added to GCP project `symply-ecosystem`;
> **5 Android apps** created (`com.symply.house/budget/kaizen/language/health`); each
> `google-services.json` saved to `brands/<id>/google-services.json` and wired per-brand
> via `googleServicesFile` in [app.config.ts](../../app.config.ts). **FCM v1 service
> account key** created (`firebase-adminsdk-fbsvc@symply-ecosystem`) → `credentials/firebase/fcm-sa.json`
> (gitignored), path in Keychain `symply.firebase.sa_key_path`.
> **⏳ Remaining:** upload the FCM key to EAS (§8, `eas credentials` — interactive).

Expo push delivers to Android via **FCM V1**. Steps (now automated by the script above):

1. Firebase console → project **`symply-ecosystem`** (can reuse the Google Cloud
   project) → add an **Android app** for each `com.symply.<app>` (5 total).
2. Download each `google-services.json` (EAS uses it at build).
3. Project settings → Service accounts → **Generate new private key** → download
   the **FCM V1 service account JSON**.
4. Upload it to EAS (§8). One service account covers all Android apps in the project.

---

## 8. EAS credentials → wire push for both platforms

Per app (or via `eas.json` profiles that already exist):

```bash
eas credentials            # interactive, pick platform + the app's EAS project
```
- **iOS:** upload the **APNs `.p8`** from §3.1 (Key ID + Team ID) — same key for all 5.
- **Android:** upload the **FCM V1 service account JSON** from §7.
- **Language app** — `easProjectId` set in `brands/symply-language/brand.cjs`; submit profile
  `symply-language-testflight` / `symply-language-production` wired in `eas.json`.

Expo push then routes `expo-notifications` tokens to APNs/FCM — you don't call them
directly. Notification routing by `data.type` is already in the app.

---

## 9. RevenueCat

> **Status: ✅ public SDK keys wired (2026-07-13).** All 5 brands have `integrations.revenueCat`
> (`appl_` / `goog_`) in `brands/*/brand.cjs`. Runtime resolves via
> [`purchases.ts`](../../src/services/purchases.ts) (brand first, `EXPO_PUBLIC_*` override).
> Worker `REVENUECAT_*` secrets are set on platform Workers. Remaining: App Store / Play
> products + offerings + webhooks if not already configured in the RC dashboard.

### 9.0 IAP subscription products (the store gate)

**Naming convention (single source of truth — matches the shared `pro` entitlement):**

| App | Monthly product ID | Yearly product ID | Subscription group |
|-----|--------------------|--------------------|--------------------|
| House | `com.symply.house.pro.monthly` | `com.symply.house.pro.yearly` | Symply House Pro |
| Budget | `com.symply.budget.pro.monthly` | `com.symply.budget.pro.yearly` | Symply Budget Pro |
| Kaizen | `com.symply.kaizen.pro.monthly` | `com.symply.kaizen.pro.yearly` | Symply Kaizen Pro |
| Language | `com.symply.language.pro.monthly` | `com.symply.language.pro.yearly` | Symply Language Pro |
| Health | `com.symply.health.pro.monthly` | `com.symply.health.pro.yearly` | Symply Health Pro |

- **App Store Connect: ✅ created + priced (2026-07-14).** All 5 groups + 10 subscriptions +
  en-US localizations + availability (all 175 territories) + USA base price
  (**monthly $1.99 / yearly $19.99**, Apple auto-equalizes globally). Prices are placeholders —
  change any time. A **labeled placeholder review screenshot** is uploaded to all 10
  (`scripts/provision/assets/review-placeholder.png` — replace with the real paywall before
  submitting). Idempotent scripts (read `symply.asc.*` from Keychain):
  `run-appstore-subscriptions.sh` (groups+products), `run-appstore-subscription-prices.sh`
  (availability+price), `run-appstore-review-screenshots.sh [image]` (review screenshot).
  **⚠️ Still `MISSING_METADATA` — account-level blocker:** every product field is complete,
  so the only remaining gate is the **Paid Applications Agreement**
  (App Store Connect → **Business → Agreements, Tax, and Banking**): sign the Paid Apps
  agreement + complete **banking + tax**. Account-Holder-only, **no API**. Once active, all
  10 auto-advance to `READY_TO_SUBMIT`.
- **Google Play: ⏳ access done, blocked on payments profile.** Play Android Developer API
  enabled, 5 app records created, and the service account
  `firebase-adminsdk-fbsvc@symply-ecosystem.iam.gserviceaccount.com` is granted access — all
  5 packages resolve via API (200) and the create payload is verified. **Remaining
  account-level gate (no API, owner-only):** register a **payments profile / merchant account**
  (Play Console → any app → **Monetize → Monetization setup** → *Set up a payments profile*, then
  bank + tax). Until then create returns `400 FAILED_PRECONDITION: Cannot create a subscription
  without first registering a payments profile`. Once set up, run
  `./scripts/provision/run-play-subscriptions.sh` for the identical IDs (monthly/yearly base
  plans, DRAFT/no price).

### 9.1 Dashboard checklist (human — do once per app)

Repeat for **House, Budget, Kaizen, Language, Health** (bundle IDs in §0):

- [x] RevenueCat → **Apps** → add app (Apple App Store + Google Play) matching `com.symply.<app>`
- [x] App Store Connect: subscription products created (§9.0) — set price, then link in RC
- [ ] Google Play: create app record + link SA, then run `run-play-subscriptions.sh` (§9.0)
- [ ] Create shared **entitlement** `pro` (referenced in [`purchases.ts`](../../src/services/purchases.ts))
- [ ] Create **offering** `default` and attach the subscription product
- [x] Copy **public SDK keys** (Apple + Google) for that app → `brands/*/brand.cjs`
- [ ] Configure **webhook** URL for the brand's Worker (staging + production — see script output)
- [ ] Set webhook **Authorization** to the same value you put in `REVENUECAT_WEBHOOK_AUTH`

| App | Bundle ID | Worker webhook base (append `/webhooks/revenuecat`) |
|-----|-----------|-----------------------------------------------------|
| House | `com.symply.house` | `simple-house-api[-staging].a-tekhtelev.workers.dev` |
| Budget | `com.symply.budget` | `simple-budget-api[-staging].a-tekhtelev.workers.dev` |
| Kaizen | `com.symply.kaizen` | `symply-kaizen-api[-staging].a-tekhtelev.workers.dev` |
| Health | `com.symply.health` | `symply-health-api[-staging].a-tekhtelev.workers.dev` |
| Language | `com.symply.language` | *(no dedicated Worker yet — use House Worker or add later)* |

### 9.2 Apply keys

**Public SDK keys** live in brand packs (no EAS env required for normal builds):

```text
brands/<id>/brand.cjs → integrations.revenueCat.{iosApiKey,androidApiKey}
```

**Worker secrets** (secret API key / webhook auth) — when rotating:

```bash
cp backend/.env.revenuecat.example backend/.env.revenuecat
# Fill REVENUECAT_SECRET_API_KEY, REVENUECAT_WEBHOOK_AUTH, optional REVENUECAT_PROJECT_ID
bash scripts/secrets/set-revenuecat.sh
```

Optional override: `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `_ANDROID_` in EAS env (wins only if
brand key is absent).

### 9.3 Store credentials → RevenueCat (the receipt-validation gate)

> **Status (2026-07-14, project `projc09063c5`):** all 5 iOS apps now have
> `app_store_connect_api_key_configured=true` (existing `symply.asc.*` Team key pushed via API —
> enables product import only) but still `subscription_key_configured=false`; all 5 Android apps
> have **no** service-account credentials. The `subscription_key_configured=false` state is what
> keeps subscriptions from verifying even once webhooks + products exist.

**What the v2 API can and cannot do (checked against the published OpenAPI):**

- **App Store — settable via API.** `POST /v2/projects/{id}/apps/{app_id}` accepts, under
  `app_store`: `subscription_private_key` + `subscription_key_id` + `subscription_key_issuer`
  (the **In-App Purchase key** → flips `subscription_key_configured`), optional 32-char
  `shared_secret`, and `app_store_connect_api_key` (+`_id`/`_issuer`/`vendor_number`) for the
  existing ASC API key (→ flips `app_store_connect_api_key_configured`; product-import/advanced
  features only, **not** receipt validation).
- **Google Play — NOT settable via API.** The `play_store` object is `additionalProperties:false`
  and accepts only `package_name`. The service-account JSON must be uploaded in the **RC
  dashboard**: app → App settings → **Service credentials (Google Play)** → **Upload key**.

**Blockers to actually flipping receipt validation (each is UI/2FA or account-level, no API):**

- **Apple In-App Purchase key / app-specific shared secret** — created only in ASC UI
  (Users and Access → Integrations → **In-App Purchase**; the `.p8` downloads once). Requires
  interactive App Store Connect + 2FA. The general `symply.asc.*` Team key is *not* this key —
  it only fills the `app_store_connect_api_key` slot.
- **Google Play** — SA `firebase-adminsdk-fbsvc@symply-ecosystem.iam.gserviceaccount.com`
  already has Play API access; a fresh JSON key can be minted with
  `gcloud iam service-accounts keys create`. Upload it via the RC dashboard; if RC shows
  "credentials need attention," grant the SA **View financial data** + **Manage orders and
  subscriptions** in Play Console.
- **Account-level (unchanged, owner-only, no API):** Apple **Paid Applications Agreement**
  (banking + tax) and Play **payments profile / merchant account** must be active before either
  store verifies a real purchase — see §9.0.

---

## 10. Code mapping — where each value goes

Everything lands in **`brands/<id>/brand.cjs`** (single source of truth):

| Field | Value |
|-------|-------|
| `iosBundleId` | `com.symply.<app>` |
| `androidPackage` | `com.symply.<app>` |
| `ios.appGroup` | `group.com.symply.<app>` |
| `ios.widgetBundleId` | `com.symply.<app>.widget` |
| `ios.watchBundleId` | `com.symply.<app>.watchkitapp` |
| `ios.appleTeamId` | your Apple Team ID |
| `integrations.googleAuth.{ios,android,web}ClientId` | from §6.3 |
| `integrations.googleDrive.{ios,android,web}ClientId` | from §6.3 |
| `integrations.posthog.apiKey` | from PostHog (§11) |

Then: `npx expo prebuild --clean` per brand to propagate bundle IDs into native
iOS/Android projects, and cut fresh EAS builds. See
[analytics.md](../engineering/analytics.md) for PostHog specifics.

### 10.1 Every code touchpoint for the bundle-ID move

| File | What | Status |
|------|------|--------|
| `brands/*/brand.cjs` | bundle/android/appGroup/widget/watch/**appleTeamId** | ✅ done (`com.symply.*`) |
| [app.json](../../app.json) | House base bundle/package/watch | ✅ done |
| [eas.json](../../eas.json) | submit profiles (`ascAppId` per app) | ✅ done — all 5 apps (`6790505308` … `6790505448`) |
| [app.json](../../app.json) `CFBundleURLSchemes` | House Google reversed-client-ID scheme (`…144228018802-m12nhses…`) | ✅ done — app.config.ts injects the per-brand scheme automatically |
| [backend/src/index.ts](../../backend/src/index.ts) | AASA + assetlinks (deep links) | ✅ done — brand-aware (all 5 `com.symply.*`), deployed to all 3 Workers |
| `android/app/google-services.json` | FCM config | ⏳ regenerated by Firebase (§7) |
| native `ios/` Xcode project | targets/entitlements | ⏳ `expo prebuild --clean` |

---

## 11. PostHog (status)

> **Status: ✅ done — shared project** (2026-07-13). The free plan caps the org at **1
> project**, so all 5 apps share project **509073** (US Cloud). This matches the code:
> `src/services/analytics.ts` auto-tags every event with the `brand` property, giving
> per-app dashboards from one project. All 5 `brands/<id>/brand.cjs` now carry the same
> `phc_uzGR…` token, so analytics is ON for every brand. Revisit per-app projects only
> if the PostHog plan is upgraded (re-run `scripts/provision/run-posthog.sh`).

Full detail: [analytics.md](../engineering/analytics.md).

| App | PostHog project | Status |
|-----|-----------------|--------|
| House / Budget / Kaizen / Language / Health | 509073 (shared, brand-tagged) | ✅ set |

---

## 12. Per-app checklist

Repeat for **House, Budget, Kaizen, Language, Health**:

- [ ] Apple: App ID `com.symply.<app>` + Push + Sign in with Apple + App Groups (+ HealthKit for Health)
- [ ] Apple: widget + watch + watch-ext App IDs, all joined to `group.com.symply.<app>`
- [ ] Apple: Associated Domains → Worker AASA
- [ ] APNs key uploaded to EAS (shared — once)
- [ ] App Store Connect: `Symply <App>` record
- [ ] Google: iOS + Android + (shared) Web OAuth clients
- [ ] Google: Drive API on, consent scopes incl. `drive` (restricted — needs verification + CASA)
- [ ] Firebase: Android app + `google-services.json`; FCM service account in EAS
- [x] RevenueCat: 5 RC apps’ public keys in `brands/*/brand.cjs`; Worker secrets set — still verify products/offerings/webhooks in RC dashboard
- [ ] PostHog: project + key in brand pack
- [ ] Code: brand pack updated; `expo prebuild --clean`; EAS build green

---

## Related
- [SERVICES.md](./SERVICES.md) · [ADD_APP.md](./ADD_APP.md) · [analytics.md](../engineering/analytics.md)
- Brand packs: [`brands/`](../../brands)
