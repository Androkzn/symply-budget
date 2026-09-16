# AI Access Migration — Apple Subscription + BYOK (v2.7)

**Date:** 2026-07-10  
**Status:** Reviewed draft — App Store BYOK compliance decision required before implementation  
**Area:** Mobile + Backend + iOS/App Store Connect  
**Baseline:** `f598c2ce`

## 1. Outcome

SimpleHouse launches with its non-AI core free. AI execution is disabled for every user at launch. A later remote-flag rollout presents two AI access options:

1. subscribe through Apple IAP and use SimpleHouse-managed AI;
2. connect a user-owned developer API key for OpenAI, Anthropic Claude, or Google Gemini and pay that provider directly for API usage.

Consumer plans cannot be connected: ChatGPT Plus/Pro, Claude Pro/Max, and Gemini Advanced/Google AI Pro do not include third-party API access. The UI and documentation must consistently say **API key** and **API billing**, not “connect your AI subscription.”

This migration adds access checks, a secure per-user credential vault, provider-neutral routing, per-provider model selection (up to 5 catalog models each), and three guided BYOK onboarding flows. Existing prompts, domain behavior, queues, and output formats remain stable where provider capabilities permit.

### Launch state

- `subscriptionsEnabled=false`
- `aiFeaturesEnabled=false`
- `aiRequiresAccess=false`
- `bringYourOwnAIEnabled=false`
- `aiHousekeeper=false`
- All server AI entry points fail closed.
- Manual tasks, households, budgets, savings, utilities, contractors, family chat, uploads, and stored-file viewing remain available.

### AI-access rollout state

- `subscriptionsEnabled=true`
- `bringYourOwnAIEnabled=true`
- `aiFeaturesEnabled=true`
- `aiRequiresAccess=true`
- Existing per-surface rollout flags still apply.
- Access is granted by either an active RevenueCat `pro` entitlement or one active, server-validated BYOK credential.

## 2. Review Corrections

The original proposal was directionally correct, with these required changes:

1. **The first subscription cannot be introduced only by a later flag flip.** Apple requires the first IAP/subscription to be submitted with an app version. The V1 binary must contain RevenueCat and the purchase UI, and the first subscription must be submitted with that version. It can remain unavailable for sale and hidden by flags until rollout.
2. **The RevenueCat webhook must not be added to the authenticated subscriptions router.** `backend/src/routes/subscriptions.ts` applies JWT authentication to every route. RevenueCat cannot provide a SimpleHouse JWT. Use a dedicated `/webhooks/revenuecat` endpoint authenticated with an environment-specific webhook secret.
3. **Webhook delivery is at-least-once and can be delayed or reordered.** Add an event ledger keyed by RevenueCat `event.id`, then refresh canonical customer state from RevenueCat rather than trusting event order.
4. **The RevenueCat App User ID must be the SimpleHouse user ID.** Configure the SDK once, call `Purchases.logIn(userId)` after authentication, avoid routine `logOut()`, and define restore-transfer behavior in RevenueCat.
5. **The client cannot make the backend paid by posting CustomerInfo.** After purchase or restore, the authenticated client asks the backend to synchronize; the backend reads RevenueCat with its secret API key.
6. **Entitlement checks must be read-only.** The current `getUserSubscription()` creates a free row when none exists. AI checks must treat a missing row as free without writing, avoiding races and writes on denied requests.
7. **Async work must resolve the initiating user, not trust an entitlement boolean.** Garden and task-enrichment messages already carry `userId`; keep that contract unless there is a reason to rename it. Add an actor to report jobs and Aihousekeeper outbound work, or resolve the household owner explicitly when no actor exists. Consumers re-check immediately before invoking an AI provider or Lambda.
8. **Stored output and new execution are separate concerns.** Losing access blocks new AI work but does not delete or hide reports, task drafts, messages, plans, or other output already generated. Shared household members may view stored artifacts; only an actor with paid or BYOK access can initiate new AI generation.
9. **Expected entitlement denials must not retry.** Queue consumers acknowledge a denied job, reset or mark its domain state appropriately, and do not send it to a DLQ.
10. **The rollout must be backward compatible with older clients.** The server gate is authoritative. Older clients may briefly show an AI control, but receive a stable denial before any provider, queue, or Lambda invocation.
11. **Existing Mira billing tools conflict with StoreKit ownership.** Remove or replace `cancel_subscription` and `reactivate_subscription`; Mira may read subscription state or navigate to Apple's management UI but must not mutate D1 billing state.
12. **A live unauthenticated AI route must be closed.** `POST /ai/chat/stream` must be removed or receive JWT authentication, household authorization where applicable, and entitlement enforcement.
13. **Consumer AI subscriptions are not credentials.** OpenAI, Anthropic, and Google all separate consumer subscriptions from developer API access and billing.
14. **Literal three-provider parity is not possible for every modality.** All provider-portable text, structured-output, tool, vision, and PDF workers must support all three. Image generation, embeddings, and realtime voice use an explicit capability matrix because Claude does not provide every equivalent API.
15. **BYOK is an App Review risk, not merely an engineering task.** Apple Guideline 3.1.1 can treat an API key as an external mechanism that unlocks app functionality. Product/legal must approve the storefront strategy before BYOK ships.

## 3. Current-State Findings

- Mobile and backend flag catalogs are intentionally duplicated and must stay synchronized:
  - `src/config/features.ts:19`
  - `backend/src/services/featureFlagService.ts:25`
- The mobile flag store persists the last remote snapshot and falls back to build defaults:
  - `src/stores/featureFlagStore.ts` (resolver at `:43-50`, persist middleware at `:54-110`)
- The public flags endpoint is edge-cached for 60 seconds:
  - `backend/src/routes/features.ts:27`
- The subscription context currently uses local tier matrices that disagree with the backend:
  - `src/contexts/SubscriptionContext.tsx:35`
  - `backend/src/services/subscription-service.ts:147`
- `advanced_ai` exists only in the backend matrix; the mobile premium matrix does not include it.
- Paid status currently ignores `status` and period expiry on mobile:
  - `src/contexts/SubscriptionContext.tsx:89`
- The existing subscription API is a Stripe placeholder and includes invalid Worker runtime access through `process.env`:
  - `backend/src/routes/subscriptions.ts:33`
  - `backend/src/routes/subscriptions.ts:47`
- The mobile API calls `/subscriptions/resume`, while the backend exposes `/subscriptions/reactivate`:
  - `src/api/subscription.ts:61`
  - `backend/src/routes/subscriptions.ts:270`
- The current D1 table has Stripe identifiers but no RevenueCat/store identifiers:
  - `backend/src/db/schema.ts:800`
  - `backend/migrations/0019_subscriptions_table.sql:1`
- `react-native-purchases` is absent from `package.json`.
- The active app entry is Expo Router. `src/App.tsx` **does not exist in the repo at all** (it is not merely inactive dead code); the runtime entry is `expo-router/entry` → `app/_layout.tsx`:
  - `package.json:4`
  - `index.js:4-7` documents the Expo Router entry.
  - RevenueCat initialization belongs under the active provider tree in `app/_layout.tsx`. No task may edit `src/App.tsx`.
- The existing error hierarchy has no payment/entitlement error:
  - `backend/src/middleware/error-handler.ts:9`
- The legacy `/ai` router is mounted in production and its streaming chat route has no auth middleware attached at the router level:
  - `backend/src/index.ts:428`
  - `backend/src/routes/ai.ts:31` (`POST /ai/chat/stream`)
  - Note: the handler reads `c.get('user')` and returns `401` when unset (`ai.ts:37-42`). Because no middleware ever sets `user`, the route is currently **auth-dead (always 401), not anonymously provider-callable**. It must still be removed or given real JWT auth + household authorization + entitlement enforcement so a future middleware change cannot expose it.
- Existing task-enrichment and garden queue messages already carry `userId`, while `AihousekeeperOutboundMessage` carries only `householdId`:
  - `backend/src/types/index.ts:157` (`AihousekeeperOutboundMessage`, `householdId` only)
  - `backend/src/types/index.ts:174` (`GardenPlanGenerationMessage.userId`)
  - `backend/src/types/index.ts:209` (`TaskEnrichmentMessage.userId`)
- Mira currently exposes D1-mutating cancellation/reactivation tools:
  - `backend/src/services/ai/tools/aihousekeeper/subscription-tools.ts:40`
- The Worker already has partial Claude/Gemini abstractions, but many services construct `ClaudeProvider` or call provider APIs directly:
  - `backend/src/ai/provider.ts:181`
  - `backend/src/ai/claude-provider.ts:60`
  - `backend/src/ai/gemini-provider.ts:50`
- The Lambda processor is Claude-only and creates a process-wide Anthropic client from an environment key:
  - `backend/lambda-processor/handler.py:20`
  - `backend/lambda-processor/handler.py:29`
- No per-user credential encryption service exists in the Worker today.

## 4. Product and Entitlement Rules

### 4.1 Paid definition

The canonical paid signal is the backend's synchronized RevenueCat entitlement (the full formula, including the `billing_state` refinement introduced below):

```ts
isPaid =
  subscription.entitlement_id === 'pro' &&
  subscription.status in ['active', 'trialing'] &&
  subscription.current_period_end > now &&
  paidBillingStates.has(subscription.billing_state) // product-chosen set; see below
```

`tier !== 'free'` is retained as a compatibility field but is not sufficient by itself. The `pro` entitlement is mapped to backend tier `premium`. Existing `basic`, `premium`, and `enterprise` values remain readable for future pricing, but V1 exposes one paid product and one binary AI entitlement.

Cancellation does not revoke access immediately. A cancellation event keeps `status='active'`, sets `cancel_at_period_end=true`, and access continues until the synchronized period end. Expiration or a non-entitled RevenueCat response revokes access.

**Billing-state must be an explicit field, not inferred from `status`.** RevenueCat's canonical `entitlements.active` boolean **includes users in a billing grace period** — during grace the store is still retrying and the customer retains entitlement until the `EXPIRATION` event fires. Deriving a `status` string and then denying on grace will silently fail, because a grace user reads as `active`. Persist a distinct `billing_state ∈ {normal, grace, paused}` derived from RevenueCat's `grace_period_expires_at` / store product status; the `isPaid` formula above evaluates `paidBillingStates.has(billing_state)`.

Product decision (open — see §23): whether grace-period users keep AI (RevenueCat's natural behavior; `paidBillingStates = {normal, grace}`) or lose it (strict; `paidBillingStates = {normal}`). The default in this plan is **strict** (`{normal}` only). Grace/past-due/paused users see “Apple is retrying your payment,” Manage Subscription, Restore, and the BYOK option when enabled. Add a fixture test that a grace-period `CustomerInfo` is classified per the chosen policy and never accidentally as plain `active`. Extend the `subscriptions` schema in §7 with a `billing_state` column.

### 4.2 AI access sources

`isPaid` and BYOK are independent access sources:

```ts
hasBYOKAccess =
  bringYourOwnAIEnabled &&
  credential.status === 'active' &&
  credential.provider in enabledProviders

hasAIAccess = isPaid || hasBYOKAccess
```

If both are available, the user explicitly selects:

- **SimpleHouse AI** — app-managed credentials, included with Apple subscription;
- **My API key** — selected user credential; provider bills the user.

Default to SimpleHouse AI for paid users so a saved personal key is never charged unexpectedly. Never silently fall back from BYOK to a SimpleHouse-managed credential. A paid user may opt into fallback explicitly.

### 4.2.1 Per-provider model selection (up to 5)

After the user has an access source and an active provider, they may choose **one chat/reasoning model** from that provider’s server catalog:

- Each provider (`openai`, `anthropic`, `gemini`) exposes **1–5** selectable options (hard ceiling: 5). Shipping fewer than 5 is allowed; never more.
- Options are server-defined catalog entries (registry key + display name + profile label). The client never free-types a vendor model string.
- Selection is independent of access source shape: the same picker appears for SimpleHouse AI and BYOK, though the managed catalog may hide frontier/expensive slots (§19.5, §23 #7).
- Changing provider loads that provider’s catalog; selection resets to the provider default unless sticky per-provider prefs are enabled (§23 #10).
- Full catalog, defaults, capability tags, and fallback rules live in §19.5. UX surfaces: Connected screens (§20), `app/ai-access/models.tsx`, and `GET /ai-models` / `PATCH /ai-preferences` (§21).

### 4.3 Shared resolver

Mobile and backend use the same pure truth table:

```ts
canUseAI =
  aiFeaturesEnabled &&
  (
    !aiRequiresAccess ||
    isPaid ||
    hasBYOKAccess
  )
```

`subscriptionsEnabled=false` hides new purchase/management UI but does not erase a synchronized paid entitlement. `bringYourOwnAIEnabled=false` is both a setup and BYOK execution kill switch: encrypted rows remain stored, but BYOK no longer grants runtime access. `aiFeaturesEnabled=false` is the authoritative global kill switch for every source.

Per-surface flags are an additional rollout condition:

```ts
canUseSurface = canUseAI && surfaceFlagEnabled
```

Per-surface flags never establish payment entitlement.

### 4.4 Denial reasons

Use a result object internally so UI and API behavior do not infer the reason from three booleans:

```ts
type AIEntitlementResult =
  | { allowed: true; source: 'simplehouse' | 'byok'; provider: AIProviderId }
  | { allowed: false; reason: 'AI_DISABLED' }
  | { allowed: false; reason: 'AI_ACCESS_REQUIRED' }
  | { allowed: false; reason: 'PROVIDER_NOT_CONNECTED' }
  | { allowed: false; reason: 'PROVIDER_KEY_INVALID' }
  | { allowed: false; reason: 'PROVIDER_CAPABILITY_UNSUPPORTED' }
  | { allowed: false; reason: 'MODEL_NOT_AVAILABLE_FOR_KEY' }
  | { allowed: false; reason: 'NO_PROVIDER_AVAILABLE' };
```

`NO_PROVIDER_AVAILABLE` covers the managed-path edge case where a user has paid access (`isPaid`) but every SimpleHouse-managed provider flag (`openAIProviderEnabled`, `anthropicProviderEnabled`, `geminiProviderEnabled`) is off, so no provider can be resolved. It must fail closed as an operational unavailability, not advertise purchase or BYOK setup.

`MODEL_NOT_AVAILABLE_FOR_KEY` covers the BYOK case where the credential is valid and active but the *selected catalog model* is not callable by that specific key (OpenAI org verification/usage tier, Anthropic tier gating, Gemini key-type/region). It is distinct from `PROVIDER_KEY_INVALID` (whole key bad) and `PROVIDER_CAPABILITY_UNSUPPORTED` (model lacks the capability): the key still works for other models.

**This reason is non-blocking in the normal path and terminal only as a fallback.** It is a *model-resolution* outcome, not a first-class entitlement denial. When the selected model is not callable by the key, the resolver **substitutes the same-provider catalog default and proceeds** (`allowed: true` with the substituted model and a one-time §19.5 notice); it does not block AI or mark the credential `invalid`. `resolveAIEntitlement()` therefore still returns `allowed: true` in this case. The `{ allowed: false; reason: 'MODEL_NOT_AVAILABLE_FOR_KEY' }` result (mapped to `409`) is returned only in the terminal sub-case where **no same-provider catalog model is callable by that key at all**, so there is nothing to fall back to. UI treats the 409 as connection-repair guidance (verify org/tier, use an auth key), not a broken connection. See §18.4 and §19.5.

API mapping:

- `AI_DISABLED` → `403`, code `ai_features_disabled`
- `AI_ACCESS_REQUIRED` → `403`, code `ai_access_required`
- `PROVIDER_NOT_CONNECTED` → `409`, code `ai_provider_not_connected`
- `PROVIDER_KEY_INVALID` → `409`, code `ai_provider_key_invalid`
- `PROVIDER_CAPABILITY_UNSUPPORTED` → `422`, code `ai_provider_capability_unsupported`
- `MODEL_NOT_AVAILABLE_FOR_KEY` → `409`, code `ai_model_not_available_for_key`
- `NO_PROVIDER_AVAILABLE` → `503`, code `ai_provider_unavailable`

`ai_access_required` opens the two-option unlock screen. Provider errors open connection repair/provider selection, not the Apple paywall. A global kill switch never advertises purchase or BYOK setup.

### 4.5 Historical artifacts

Entitlement gates creation, processing, regeneration, and AI replies. It does not gate ordinary reads of already stored:

- processed reports and findings;
- task drafts and converted tasks;
- AI chat history and shared assistant messages;
- generated garden/floor plan artifacts;
- extracted budget, savings, utility, tax, and contractor data.

Manual edit, conversion, deletion, download, and sharing behavior remains unchanged unless the action itself invokes AI.

## 5. Feature Flags

Add these keys with `false` defaults to both catalogs:

| Key | V1 default | Responsibility |
|---|---:|---|
| `subscriptionsEnabled` | `false` | Purchase, restore, upgrade, and billing-management UI |
| `bringYourOwnAIEnabled` | `false` | BYOK setup, credential management, and BYOK access |
| `aiFeaturesEnabled` | `false` | Global AI execution kill switch |
| `aiRequiresAccess` | `false` | Require either paid entitlement or active BYOK credential |
| `openAIProviderEnabled` | `false` | OpenAI provider rollout/kill switch |
| `anthropicProviderEnabled` | `false` | Anthropic provider rollout/kill switch |
| `geminiProviderEnabled` | `false` | Gemini provider rollout/kill switch |

Also change `aiHousekeeper` to `false` for V1 defense in depth. Keep non-AI surface flags such as `reports`, `gardening`, and `utilities` enabled because those areas contain free manual/read paths.

Files:

- `src/config/features.ts`
- `backend/src/services/featureFlagService.ts`
- `__tests__/stores/featureFlagStore.test.ts`
- new backend feature-flag/entitlement tests

Backend entitlement resolution must fail closed if KV is unavailable. `resolveAIEntitlement()` must catch `getFlags()`/KV errors and resolve a disabled result; it must not rely on the current uncaught behavior of `getFlags()`. It must never fall through to a provider call. Mobile may use its cached flag snapshot for presentation; server authorization remains authoritative.

Existing subsystem KV switches remain additional rollout controls:

- `savings_import_enabled`
- `aihousekeeper_outbound_loop_enabled`

They AND with `canUseAI` and do not replace it. Do not retire them in this migration.

## 6. RevenueCat and Apple IAP

### 6.1 External configuration prerequisite

Before submitting V1:

1. Accept Apple's Paid Apps agreement and complete banking/tax setup.
2. Create one auto-renewable monthly product in App Store Connect.
3. Create RevenueCat entitlement `pro`, offering `default`, and attach the product.
4. Submit the first subscription with the V1 app version as required by Apple.
5. Keep the reviewed product unavailable for App Store sale until rollout; sandbox/TestFlight purchase validation remains available through Apple's test environment.
6. Configure RevenueCat's restore behavior explicitly. RevenueCat's recommended default is **Transfer to new App User ID**; prefer it unless product requires strict single-account binding and every customer creates a SimpleHouse account before purchasing. If **Keep with original App User ID** is chosen, document a support runbook for reinstall/device-change/account-recovery lockouts and Family Sharing edge cases, and reconcile that choice with the `TRANSFER` webhook handling in §6.4 (which must still be implemented for either setting). This is an open product/support decision (see §23).
7. Configure separate webhook secrets and environment routing for staging/sandbox and production.

This setup is required for a later no-binary flag rollout.

### 6.2 Mobile SDK lifecycle

Add `react-native-purchases` with Expo-compatible installation and rebuild the native development client. A pod install/native rebuild is required; Expo Go cannot perform real purchases.

Initialization rules:

- Configure the SDK once in the active `app/_layout.tsx` provider tree.
- The public RevenueCat iOS SDK key comes from `src/config/env.ts`; it is not a server secret.
- After SimpleHouse auth hydration, call `Purchases.logIn(simpleHouseUserId)`.
- Do not purchase until RevenueCat identity matches the authenticated user.
- Register one CustomerInfo listener and remove it on cleanup.
- Do not call restore automatically; restoration must follow an explicit user action.
- Avoid routine `Purchases.logOut()` because it creates anonymous identities. On SimpleHouse logout, remove local entitlement state and ensure the next authenticated session calls `logIn()` before any billing action.

After purchase, restore, or CustomerInfo change:

1. Update optimistic mobile display from `CustomerInfo`.
2. Call authenticated `POST /subscriptions/sync`.
3. Backend fetches canonical RevenueCat subscriber state.
4. Refresh `GET /subscriptions/me`.
5. Use the backend result for `isPaid` and `canUseAI`.

If synchronization fails, show “Purchase received; access is still syncing” and retry. Do not unlock server-backed AI from client CustomerInfo alone.

### 6.3 Backend RevenueCat client

Create a small service around RevenueCat's REST API:

- `backend/src/services/revenuecat-service.ts`
- `getSubscriber(appUserId)`
- `syncSubscriber(appUserId)`
- strict timeout and bounded retry;
- no secret or full payload logging.

Bindings/secrets:

- `REVENUECAT_SECRET_API_KEY`
- `REVENUECAT_WEBHOOK_AUTH`
- required `REVENUECAT_PROJECT_ID`/app ID validation for each environment

Add them to the typed `Env` interface and document independent `wrangler secret put ... --env staging` and `--env production` operations, including secret rotation. Never put the secret API key in mobile config or committed files.

### 6.4 Webhook

Add `POST /webhooks/revenuecat` to the existing webhook router, outside JWT auth.

Requirements:

- verify RevenueCat's configured bearer value in the `Authorization` header using a length-safe timing-safe comparison before parsing/processing (see the `timingSafeEqual` note in §18.5);
- reject missing/invalid authorization with `401`;
- validate API version, event ID, event type, app ID, environment, and user identifiers;
- deduplicate and synchronize atomically so a retry after a partial run cannot drop the sync (see ordering below);
- for ordinary events, synchronize `event.app_user_id`;
- for `TRANSFER`, synchronize valid SimpleHouse IDs in both `transferred_from` and `transferred_to`;
- ignore RevenueCat anonymous IDs as SimpleHouse users;
- return success for valid but unknown/deleted users after recording the event;
- do not derive entitlement from price, product name, or tier text;
- log event ID/type/environment and outcome, not receipts or subscriber attributes.

**Idempotency ordering (must not lose a sync on retry).** Do not mark an event fully processed before the sync completes. Because delivery is at-least-once and the worker can crash mid-request, use one of:

1. Insert the `event.id` ledger row with `outcome='received'`, run the canonical sync, then update `outcome='synced'`/`processed_at` in the same logical unit; on a duplicate delivery, only short-circuit when the existing row is already `synced`. A row stuck in `received` is re-synced (the sync is itself idempotent because it re-fetches canonical RevenueCat state), never skipped.

Because synchronization always re-fetches canonical subscriber state from RevenueCat rather than applying event deltas, re-running a sync is safe and convergent. The ledger prevents duplicate *side effects* (e.g., notifications), not the idempotent state refresh.

Webhook processing and `/subscriptions/sync` share the same canonical synchronization method.

## 7. Data Model

Add a new immutable migration after the current highest migration. Do not edit `0019_subscriptions_table.sql`.

Extend `subscriptions` with nullable provider fields:

- `provider` (`revenuecat` for the new flow)
- `store` (`APP_STORE`)
- `product_id`
- `entitlement_id`
- `original_transaction_id`
- `latest_transaction_id`
- `revenuecat_app_user_id`
- `store_environment`
- `latest_event_at`
- `billing_state` (`normal|grace|paused`, derived from RevenueCat, drives the §4.1 product rule)

Retain Stripe columns for backward compatibility but stop reading or writing them in Apple-first flows.

Add `subscription_webhook_events`:

- `event_id` primary key
- `event_type`
- `app_user_id`
- `environment`
- `event_timestamp`
- `processed_at`
- `outcome`

Do not store entire webhook payloads or subscriber attributes.

Extend `processing_jobs` for report actor/audit continuity. **All new columns must be added nullable** — `processing_jobs` already contains rows, and D1/SQLite cannot add a `NOT NULL` column without a default to a populated table. Enforce presence in application code for new AI jobs, not via a DDL `NOT NULL` constraint:

- `initiated_by_user_id` (nullable column; required in code for all new AI jobs created after this migration; legacy rows stay null);
- `credential_source` (`simplehouse|byok`, nullable);
- `provider` (nullable);
- `required_capability` (nullable);
- `selected_model_id` (nullable registry key snapshot for audit/replay; resolver still re-validates against the live catalog at execution);

`EnhancedPdfProcessorService` receives the authenticated user ID and persists it before enqueue/invoke. The Lambda actor recheck (§8.3) treats a null `initiated_by_user_id` on a *new* job as a hard failure, while legacy pre-migration jobs follow the existing non-BYOK path. `process`, `process-sync`, and `process-enhanced` all resolve from this same job actor. Reconcile the currently unused `ReportProcessingMessage`/`PDF_PROCESSING_QUEUE` contracts: wire one actor-aware path or remove dead declarations; do not maintain two contradictory report job types.

Extend `ai_usage_events` with `access_source` (`simplehouse|byok`) and a non-secret `credential_id`, so household spend dashboards separate included subscription usage from BYOK usage. OpenAI and Lambda usage must also be recorded; they are currently invisible to D1 telemetry.

### 7.1 Pre-existing security debt to fix before BYOK

These issues exist today and must be corrected before user keys are stored, because they establish unsafe precedents or credential-leak paths. **Each item is assigned to an owning phase so none ships unassigned** (Agent B Cycle 1 finding):

| Item | Owning phase | Notes |
|---|---|---|
| Committed provider key material in Lambda deploy scripts/docs (`backend/lambda-processor/scripts/deploy.sh:153`, literal `sk-ant-api03-…`) must be **rotated at the provider and removed from the repository** | **Phase 0 (immediate)** | This is a live committed secret. Rotate first, then scrub git history per repo policy; do not wait for BYOK. |
| Global log/body scrubber that strips `api_key`, `apiKey`, `key`, and provider auth headers before logging; never persist provider error response bodies | **Phase 1** | Precondition for any provider work touching keys. |
| Lambda callback routes accept `JWT_SECRET` as a fallback API key (`backend/src/routes/webhooks.ts:28-29`, `:96-97`). Replace with a dedicated timing-safely verified callback secret; the credential-lease path must never share `JWT_SECRET` | **Phase 3** (before the Lambda actor/lease wiring) | |
| `backend/src/services/chat-service.ts:283` sends the Gemini key in the URL query string. Move provider keys to headers so they are not captured in edge/request logs | **Phase 7** (provider portability) | |
| Google Calendar tokens stored in plaintext D1 (`schema-aihousekeeper.ts:277-283`). Do not copy this as the BYOK template; BYOK requires the AES-GCM vault | **Phase 6** (document as anti-pattern) / follow-up migration to the same encryption infra | |

Subscription service changes:

- add a read-only `findUserSubscription(userId)`;
- add `getEntitlementSnapshot(userId)` that treats missing as free;
- make synchronization an upsert so a user without a materialized free row can purchase;
- remove fabricated 30-day periods from paid updates;
- derive period dates and entitlement state only from RevenueCat;
- include period expiry in `isPaid`;
- deprecate `hasFeatureAccess()` and `getUsageLimits()` for AI gating;
- make any compatibility `hasAdvancedAI` field derive from the canonical entitlement result;
- deprecate direct tier update, cancel, and reactivate methods for StoreKit subscriptions;
- remove/replace Mira's `cancel_subscription` and `reactivate_subscription` tools; update `get_subscription` to return canonical entitlement state rather than the legacy AI limit.

`GET /subscriptions/me` and `POST /subscriptions/sync` return a shared typed contract containing at least:

- subscription tier, status, period dates, and `cancel_at_period_end`;
- `provider`, `entitlement_id`, and `store_environment`;
- server-computed `is_paid` and `can_use_ai`;
- an optional denial reason.

Users manage cancellation in Apple's subscription management UI. The backend does not mutate App Store subscriptions.

## 8. Server-Side AI Enforcement

### 8.1 Central service

Create `backend/src/services/entitlement-service.ts`:

- `resolveAIEntitlement(userId, env): Promise<AIEntitlementResult>`
- `assertCanUseAI(userId, env): Promise<void>`
- `isPaidSubscription(subscription, now): boolean`

Add a named `AIAccessRequiredError` to the global API error handler with code `ai_access_required` and status `403`. Keep disabled-feature and provider-credential errors distinguishable and fail closed.

The check occurs after authentication/household authorization but before:

- provider construction or invocation;
- file download/OCR;
- queue enqueue;
- Durable Object job creation;
- Lambda invocation;
- rate-limit counters tied to AI usage.

Any new per-user AI/BYOK rate limiting (credential validation throttles, per-provider call caps) must use the existing DO-backed `RATE_LIMITER` helper, never an in-memory counter, because Workers run across isolates. Credential-mutation and validation endpoints in §21 are rate-limited through the same helper.

### 8.2 Interactive and synchronous boundaries

Gate every AI-only route or branch. The baseline inventory is:

| Area | AI boundary |
|---|---|
| Legacy Gemini stream | `POST /ai/chat/stream`; remove it or add auth and entitlement before provider use |
| Report Q&A | Gate `POST /households/:householdId/chat`; keep deterministic `GET .../chat/suggestions` ungated |
| Legacy AI Housekeeper | analyze and on-demand seasonal generation under `/api/ai-housekeeper` |
| Mira | chat, voice, attachments, approvals, follow-up execution, and any synchronous tool path that invokes AI/Lambda |
| Reports | `process`, `process-sync`, and `process-enhanced` |
| Task drafts/tasks | draft generation, `POST .../tasks/quick`, and quote compare under tasks |
| Maintenance | explicit suggestion generation and the automatic generation side effect after home-feature creation |
| Budget | text/file AI detect, receipt scan, and insights on cache miss |
| Savings | generic import and registered/pension statement extraction |
| Utilities | bill/property-tax/BC Assessment extraction; note only the **bill** re-extract route (`POST .../bills/extract`) exists today — do not assume symmetric re-extract routes for property-tax/BC Assessment |
| Floor plans | analysis and `:id/vectorize` |
| Garden plans | generation and approved generation execution |
| Contractors | search, AI lookup, and generated email; do not classify ordinary document upload/read as AI |
| Quotes | both quote AI comparison routes |
| Visit checklists | suggestions plus AI conversation create/message |
| Family chat | the message-handler branch that calls `ChatRoomService.generateAssistantReply()` |
| Garbage | AI schedule detection |
| Development routes | all `/dev/test-*` provider paths; ensure they are unavailable in production and still entitlement-gated elsewhere |
| Grounded web search | garbage schedule detection and contractor search; resolve the provider-specific web-search/grounding adapter |

Also include `MaintenanceSuggestionService.extractHomeFeaturesFromReport()` if it gains a caller before implementation.

Manual/read endpoints in the same router remain ungated.

All `/dev/test-*` AI endpoints must also enforce authentication and AI access on staging, because development mobile builds use the staging API. Development-only diagnostics may use explicit admin authorization but never an unauthenticated provider call.

### 8.3 Queue and Lambda boundaries

Every AI queue message/job must resolve an actor. Existing garden/task messages use `userId`; keep and re-check it. Add `userId` to Aihousekeeper outbound messages when actor-specific, persist an actor on report jobs, or explicitly resolve the owner for household-owned scheduled work. A consumer:

1. validates message shape;
2. calls `assertCanUseAI(userId, env)`;
3. invokes existing AI logic only when allowed.

On entitlement denial:

- acknowledge the queue message through a distinct entitlement-denial path;
- do not retry or DLQ an entitlement denial, while preserving existing retry/DLQ behavior for malformed messages and operational failures;
- clear `enriching`/`generating` state or mark the job `blocked_entitlement`;
- store a stable non-sensitive error code;
- do not emit “AI failed” alerts intended for operational failures.

For report Lambda processing, never pass a trusted `entitled: true` boolean. Persist and pass the actor `userId`; the Worker checks immediately before invoking Lambda. Once a paid invocation has begun, it may finish and its callback may store the result even if entitlement expires mid-run.

Webhook callbacks remain authenticated by their existing integration secret. They do not independently grant entitlement.

### 8.4 Scheduled and proactive work

Use actor-based rules:

- per-user digest/briefing/notification: gate the recipient user;
- user-created pending approval/follow-up: gate the creating user;
- household-level scheduled insight with no actor: gate the household owner;
- event-triggered shared work: persist and gate the event actor.

An actor with paid or BYOK access may generate an artifact shared with the household. Free members can read that artifact but cannot trigger new generation.

Apply these rules explicitly to:

- `AIHousekeeperWorker.execute()`;
- `AIHousekeeperWorker.sendDailyDigests()` and `sendWeeklySummaries()`;
- `BudgetAlertWorker.sendWeeklyDigests()` when insights can miss cache and invoke AI;
- `composeBriefingsDueThisHour()` and `BriefingComposer`;
- `DigestComposer.runDueThisHour()`;
- outbound enqueue/consumer paths and `FollowupRunner`;
- task-enrichment and garden-plan queue consumers;
- every other branch in `backend/src/index.ts` `scheduled()` that can reach a provider.

Batch-load subscription states for scheduled runs to avoid one D1 query per candidate. The Aihousekeeper outbound queue is production-only today, so staging QA must either use an explicitly provisioned preview binding or direct handler tests; do not claim staging queue E2E coverage without a binding.

Add a scheduled model-catalog deprecation check (§19.5): periodically diff every in-use catalog vendor model ID against provider deprecation tables and alert when any shows a retirement date inside ~90 days, so the catalog is repointed before a hard-fail. This is a non-AI-invoking diagnostic job and is not entitlement-gated.

## 9. Mobile UX

Create one reactive hook:

```ts
useAIEntitlement(): {
  isPaid: boolean;
  hasBYOKAccess: boolean;
  canUseAI: boolean;
  source: 'simplehouse' | 'byok' | null;
  provider: AIProviderId | null;
  selectedModelId: string | null;
  availableModels: Array<{
    id: string;
    displayName: string;
    profileLabel: string | null;
    capabilities: AICapability[];
    isDefault: boolean;
  }>; // ≤5 for the active provider
  capabilities: AICapability[];
  denialReason: AIDenialReason | null;
  isLoading: boolean;
}
```

It combines the AI/access/provider flags with the backend's paid entitlement, BYOK credential metadata, selected credential source, and provider capability result.

Rules:

- `aiFeaturesEnabled=false`: hide AI-only surfaces; do not show a paywall.
- AI enabled and access required, but neither paid nor connected: show the two-option unlock screen.
- `subscriptionsEnabled=false`: hide Subscribe/Restore/Upgrade controls.
- AI-access state loading: do not briefly render AI controls.
- Backend `ai_access_required`: refresh AI-access state once, then show the unlock screen.
- Backend `ai_features_disabled`: dismiss AI loading state and show unavailable copy, never paywall.
- Backend `ai_provider_unavailable` (`NO_PROVIDER_AVAILABLE`): show a transient “AI is temporarily unavailable” state for an otherwise-entitled user; never paywall or prompt BYOK setup.
- Backend `ai_model_not_available_for_key` (`MODEL_NOT_AVAILABLE_FOR_KEY`, terminal `409` only when no same-provider model is callable): show provider-specific repair guidance (verify org/tier or use an auth key); do not treat the connection as broken. In the normal case the backend silently substitutes the provider default and returns success with a substitution notice, so this code appears only in the no-fallback sub-case.
- `AIDenialReason` (used by `useAIEntitlement`) mirrors the non-`allowed` `reason` values of `AIEntitlementResult` in §4.4 (`AI_DISABLED | AI_ACCESS_REQUIRED | PROVIDER_NOT_CONNECTED | PROVIDER_KEY_INVALID | PROVIDER_CAPABILITY_UNSUPPORTED | MODEL_NOT_AVAILABLE_FOR_KEY | NO_PROVIDER_AVAILABLE`).
- A successful `PATCH /ai-preferences` (provider or model change) must invalidate/refetch the `ai-access` query (the mobile source of truth in §21) so `selected_model_id`, `available_models`, `provider`, and `capabilities` refresh; do not optimistically trust the local pick without server confirmation.
- Update `src/api/client.ts` to surface AI access/provider errors without treating them as auth failures.
- Remove the fabricated mobile free subscription on fetch failure; represent unknown/error state explicitly and deny AI presentation until refreshed.
- `smartTaskAssistant` controls quick-capture rollout independently; manual capture may remain visible, but enrichment affordances still require `canUseAI`.

### Surface behavior

| Surface | AI disabled | AI enabled, no access | Paid or capable BYOK |
|---|---|---|---|
| Mira text/chat | Hidden | Tab opens Unlock AI | Existing Mira with selected reasoning provider |
| Mira voice | Hidden | Unlock AI | Available only with SimpleHouse paid transport or connected OpenAI transport key |
| Deterministic home insight | Product-visible or hidden by Mira UX flag; no AI entitlement gate | Same | Existing deterministic logic |
| Report upload/list/detail | Available | Available | Available |
| Report process/drafts | Hidden | Unlock AI from process intent | Existing flow if provider supports PDF/structured output |
| Report Q&A chat | Hidden | Unlock AI | Existing chat |
| Quick task | Manual create | Manual create; optional Unlock AI from AI affordance | Existing enrichment |
| Budget/savings AI actions | Hidden | Unlock AI | Existing flow |
| Garbage AI detect | Hidden | Unlock AI | Existing detection |
| Maintenance suggestions | Manual home features remain | Unlock AI | Existing generation |
| Utility/tax extraction | Manual entry remains | Unlock AI | Existing extraction |
| Floor/garden upload/view | Available | Available | Available |
| Floor/garden generation | Hidden | Unlock AI | Existing generation only when provider has required capability |
| Contractor/quote/visit AI | Hidden | Unlock AI | Existing flow |
| Visit AI conversation | Hidden | Unlock AI | Existing conversation |
| Family chat | Messages work; no assistant | Unlock AI on assistant intent | Existing assistant |
| Settings AI preferences | Hidden | Hidden | Existing settings |
| Settings AI Insights dashboard | Hidden | Unlock AI on intentional entry | Existing analysis |
| Watch AI/Mira | No AI payload | No AI payload | Existing payload |
| Profile AI Access | Hidden | Subscribe or Connect API Key | Manage subscription/provider/**model (≤5 per provider)** |

Add navigation guards as well as hidden controls so deep links, notifications, and stale navigation state cannot open an AI screen without resolving entitlement.

### Unlock screen and Apple paywall

The Unlock AI screen presents the enabled access channels. The Apple subscription branch opens a shared paywall with:

- clear description that the SimpleHouse subscription unlocks supported AI without a personal API key;
- localized product name, period, and price from StoreKit/RevenueCat, never hard-coded;
- Subscribe;
- Restore Purchases;
- Terms of Use and Privacy Policy links;
- auto-renewal/cancellation copy required by Apple;
- loading, cancellation, pending, and error states;
- accessibility labels and iPad layout.

Restore must be reachable from both the paywall and Profile when subscriptions are enabled.

The BYOK branch opens provider selection and the flows in §20 only when `bringYourOwnAIEnabled=true` and the storefront policy allows it.

## 10. Implementation Phases

### Phase 0 — Product and contract setup

This phase is external configuration and decisions only. It does **not** submit a binary — the App Store submission of the first subscription happens with the Phase 5/Phase 9 V1 binary that actually contains the RevenueCat SDK and purchase UI (see ordering note below).

- Finalize product ID, entitlement ID `pro`, restore behavior (§6.1 open decision), terms/privacy URLs, and subscription copy.
- Create the App Store Connect and RevenueCat configuration (product, entitlement `pro`, offering `default`).
- Define staging/TestFlight/production webhook routing.
- Rotate and remove the committed Lambda provider key (§7.1) — do not defer.
- Obtain product/legal/App Review guidance for BYOK under Guideline 3.1.1, including whether provider setup links and external API billing instructions may appear in each storefront.
- Resolve the open product/legal decisions in §23 (grace-period policy, restore behavior, cross-member BYOK consent).
- Lock the fallback if BYOK is rejected: ship Apple subscription only and keep `bringYourOwnAIEnabled=false`.

**Ordering note (Cycle 1 fix):** the first auto-renewable subscription must be *attached to and submitted with* the V1 app version, and that version must contain the RevenueCat SDK + purchase UI built in Phase 5. Therefore App Store Connect/RevenueCat setup (Phase 0) precedes Phase 5, but the actual "submit the first subscription with the binary" step occurs at the Phase 5→Phase 9 build/submission, not in Phase 0.

**Gate:** Do not claim “flags-only paid launch” until Apple has approved the first subscription submitted with the V1 binary.

### Phase 1 — Flags and entitlement foundation

- Add synchronized flag keys and false defaults.
- Add pure resolver tests for all flag/paid/BYOK combinations.
- Add read-only backend subscription lookup.
- Add `AIAccessRequiredError` and entitlement service.
- Wire a temporary global entitlement deny into every provider/queue/Lambda boundary from §8 before the first backend deployment; no live path may depend only on a new flag that it does not read.
- Add the global log/body scrubber for `api_key`/`apiKey`/`key`/provider auth headers (§7.1).
- Add mobile `isPaid`/`canUseAI` based on status, expiry, `billing_state`, and backend state.

**Deploy:** Only after all §8 boundaries enforce the AI master; deploy staging and production together with AI master off.  
**Rollback:** Set `aiFeaturesEnabled=false`; revert code only if non-AI regressions occur.

### Phase 2 — Server AI boundary verification and surface UX

- Complete route-local enforcement and remove/secure `/ai/chat/stream`.
- Remove or authenticate/gate every staging `/dev/test-*` AI endpoint.
- Preserve manual/read paths.
- Add denial-before-provider tests to each affected route family.
- Ensure old clients receive stable error codes.
- Remove/replace Mira subscription mutation tools.

**Gate:** Provider/Lambda spies show zero calls for free users and when the master switch is off.  
**Rollback:** Enforcement is code-only and additive over Phase 1's global deny; `aiFeaturesEnabled=false` keeps all AI off. Revert route-local changes only if a manual/read path regresses; the temporary global deny from Phase 1 remains in place until Phase 2 verification passes.

### Phase 3 — Async, cron, and Lambda completion

- Reuse existing queue `userId`; add or resolve actors only where missing.
- Add the report-job actor/source/provider/capability columns from §7 in a dedicated immutable migration before enforcing Lambda actor checks.
- Replace the Lambda-callback `JWT_SECRET` fallback with a dedicated timing-safely verified callback secret (§7.1, §18.5); this precedes any BYOK lease wiring in Phase 6.
- Re-check at consumer invocation.
- Gate scheduled work using the actor rules.
- Ack expected denials without retry.
- Batch entitlement reads for scheduled candidates.

**Gate:** No denied queue item reaches a provider, Lambda, retry, or DLQ.  
**Migration order:** Apply the additive report-actor migration to staging, deploy staging, verify; then production. Columns are nullable (§7) so the migration is safe with AI off.  
**Rollback:** Keep the additive nullable columns; `aiFeaturesEnabled=false` halts consumers. Revert consumer code without reversing the migration; legacy jobs with null actors follow the pre-existing non-BYOK path.

### Phase 4 — RevenueCat persistence and synchronization

- Add schema fields and webhook event ledger in a new migration.
- Add typed RevenueCat service and secrets.
- Add authenticated `/subscriptions/sync`.
- Add separately authenticated `/webhooks/revenuecat`.
- Remove paid mutation behavior from Stripe stub routes; retain compatibility reads.
- Retire or align `/subscriptions/limits` so it cannot expose a legacy `hasAdvancedAI` value that conflicts with canonical entitlement.

**Migration order:** Apply migration to staging, deploy staging, verify; then apply production migration and deploy production.  
**Rollback:** Keep additive columns/tables; disable billing and AI flags; revert Worker code without reversing the migration.

### Phase 5 — Mobile IAP and paywall

- Install RevenueCat native SDK and rebuild.
- Initialize under `app/_layout.tsx`.
- Bind RevenueCat identity to the authenticated SimpleHouse user.
- Implement purchase, restore, sync, CustomerInfo listener, and manage-subscription link.
- Add shared paywall and route guards.
- Replace Profile's Stripe `createCheckoutSession` upgrade flow with the shared RevenueCat paywall and Apple's manage-subscription link.
- Retire unused mobile Stripe-stub methods: checkout, portal, cancel, and resume/reactivate.
- Remove client-side tier/feature matrices as AI authority; render backend AI-access state instead.
- Update Terms of Service and Privacy Policy copy from Stripe-only assumptions to Apple IAP, RevenueCat, encrypted BYOK credentials, and provider data processing.
- Gate all mobile AI affordances.
- Update Watch/widget synchronization to omit paid AI data when denied.

**Gate:** Sandbox purchase, restore after reinstall, account switch, cancellation, expiration, and network-delay scenarios pass on a real development/TestFlight build.  
**Rollback:** This is a client binary; there is no server rollback. `subscriptionsEnabled=false` hides all purchase/restore/upgrade UI in shipped binaries, and `aiFeaturesEnabled=false` disables AI regardless of client. A defective build is remediated by a new binary; dormant RevenueCat code stays inert while flags are off. (Xcode/EAS build is verified manually by the user.)

### Phase 6 — BYOK credential vault and access APIs

- Add encrypted per-user credential, preference, audit, and one-time lease tables in a dedicated immutable migration.
- Add authenticated AES-256-GCM encryption with AAD under a versioned Worker secret (see §18.2; this is direct symmetric encryption, not DEK-wrapping "envelope encryption").
- Add metadata-only credential CRUD, validation, selection, and revocation endpoints.
- Extend `resolveAIEntitlement()` with active BYOK access and credential-source selection.
- Add audit events, validation throttles, key-status transitions, account-deletion cleanup, and key rotation.
- Add one-time Lambda credential leases; never place plaintext keys in queue/Lambda payloads.
- Document the plaintext Google Calendar token store (`schema-aihousekeeper.ts`) as an anti-pattern not to replicate; capture the follow-up to migrate it onto the same encryption infrastructure (§7.1).

**Gate:** No endpoint, log, analytics event, queue message, crash report, or database query returns plaintext credentials. Ciphertext cannot be decrypted after the test key-encryption secret is removed.  
**Migration order:** Apply the additive credential/preference/audit/lease migration to staging, deploy, verify; then production. All new tables; no existing-table constraints change.  
**Rollback:** `bringYourOwnAIEnabled=false` stops BYOK setup and execution while encrypted rows remain stored. Tables are additive and left in place; revert Worker code without dropping tables. Because `AI_CREDENTIAL_KEK_V1` gates all decryption, credentials are inert if the secret is withheld.

### Phase 7 — Three-provider portability

- Refactor direct provider construction behind one provider resolver/factory.
- Add an OpenAI provider implementing the portable interface.
- Upgrade Gemini and Claude adapters to the same canonical tool, structured-output, image, and PDF message types.
- Route all synchronous, queue, cron, Mira, and Lambda calls through a `ResolvedAIExecutionContext`.
- Unify `process`, `process-sync`, and `process-enhanced` under one provider/credential policy; no endpoint-specific Gemini/Claude selection.
- Replace both Gemini stacks (`GeminiProvider` and raw Gemini service/HTTP callers) and all tracked/direct Anthropic construction sites; move the Gemini key out of the URL query string into request headers (§7.1, `chat-service.ts:283`).
- Add provider-neutral grounded web search for garbage detection and contractor search.
- Gate Mira voice separately: paid SimpleHouse uses the managed OpenAI transport; BYOK requires a connected OpenAI key for realtime transport unless product explicitly funds and discloses a managed transport.
- Add a capability registry and reject unsupported feature/provider pairs before enqueue.
- **Model catalog implementation (§19.5 + §19.5.1), all providers:**
  - Add `backend/src/ai/model-catalog.ts` with validated ≤5 entries per provider, specialty map, and boot-time `assertModelCatalogValid`.
  - Lock V1 chat catalogs to verified IDs: OpenAI Sol/Terra/Luna (3); Anthropic Fable/Opus/Sonnet/Haiku (+ optional Sonnet 4.6); Gemini 3.1 Pro preview / 3.5 Flash / 3 Flash preview / 3.1 Flash-Lite (4). Do not invent unconfirmed IDs.
  - Clear code debt: replace Claude default `claude-sonnet-4-5-20250929` and shut-down Gemini default `gemini-2.0-flash` with catalog-resolved vendor IDs.
  - Add `model-resolver.ts` implementing the §19.5.1 resolution algorithm (managed filter, default fallback, capability check, BYOK probe substitution).
  - Add `GET /ai-models` and wire `selected_model_id` through preferences + `ResolvedAIExecutionContext.model`.
  - Implement per-provider BYOK probes (OpenAI models GET / tiny Responses; Anthropic tiny Messages; Gemini tiny generateContent with **header** key).
  - Keep image/realtime/embeddings on the specialty map (outside the user-facing 5); disclose when specialty ≠ picker model.
  - Mirror catalog in `backend/lambda-processor/model_catalog.py`; re-resolve on lease consume/resume (§18.5).
- Preserve prompts and domain schemas; add provider-specific serialization/parsing adapters only.
- Record provider, model, credential source, capability, usage, and latency without recording keys.

**Gate:** Every provider-portable worker passes the same contract suite with OpenAI, Anthropic, and Gemini adapters. Provider-specific modalities pass their explicit capability tests and never silently use a different credential. Catalog validator rejects >5 / missing default. Gemini requests never put the API key in the query string.  
**Rollback:** Per-provider flags (`openAIProviderEnabled`, `anthropicProviderEnabled`, `geminiProviderEnabled`) disable a misbehaving provider without a deploy; a paid user with all managed providers off resolves `NO_PROVIDER_AVAILABLE` (§4.4). The resolver/factory refactor is behavior-preserving for the existing Claude/Gemini paths, so reverting to the prior direct-construction code is possible if the factory regresses, but the recommended fast path is the provider kill switch.

### Phase 8 — BYOK onboarding and management UX

- Add the two-option Unlock AI screen.
- Add provider selection and three provider-specific multi-screen setup flows.
- Add secure key entry, server validation, connection success, repair, switch, and disconnect flows.
- Add AI Access settings showing access source, provider, **selected model (from the up-to-5 catalog)**, masked key hint, validation date, and provider billing warning.
- Add a model-picker screen/sheet per provider that lists only the server catalog entries (≤5), with display name, profile label, and capability badges; reject unknown ids client-side and server-side.
- Apply storefront-specific controls from Phase 0; do not expose unapproved external billing links.

**Gate:** Each provider flow passes on iPhone and iPad, with VoiceOver, failed-key, quota, revoked-key, offline, cancellation, account-switch, and deletion scenarios.  
**Rollback:** UX is gated by `bringYourOwnAIEnabled` and the storefront controls from Phase 0; setting the flag false hides all BYOK onboarding/management in shipped binaries. The Apple subscription path is unaffected. A defective onboarding build is remediated by a new binary. (Build verified manually by the user.)

### Phase 9 — Launch and AI-access rollout

V1:

- deploy backend to staging and production together;
- verify defaults and stored KV values are off;
- release the free binary containing dormant RevenueCat code;
- confirm core non-AI regression suite.

AI-access rollout:

1. Make the approved App Store product available.
2. Set `aiRequiresAccess=true` while AI remains off.
3. Enable validated provider flags.
4. Set `subscriptionsEnabled=true`; verify purchase/restore and webhook sync.
5. Enable `bringYourOwnAIEnabled` only for the App Review-approved storefront strategy.
6. Set `aiFeaturesEnabled=true`.
7. Enable desired per-surface flags such as `aiHousekeeper`.
8. Monitor denials, webhook lag, credential failures, provider calls, and spend.

Emergency rollback:

- AI incident/cost spike: `aiFeaturesEnabled=false`.
- Billing incident: `subscriptionsEnabled=false` hides new purchases while existing paid/BYOK access remains; use `aiFeaturesEnabled=false` to stop all AI.
- BYOK incident: `bringYourOwnAIEnabled=false` stops BYOK execution and setup without affecting paid SimpleHouse AI.
- Single-surface incident: disable that surface flag.

New requests stop after flag propagation. Already-running provider/Lambda work may finish.

## 11. Verification Matrix

### Entitlement truth table

Cover every combination of:

- subscriptions on/off;
- AI master on/off;
- subscription required/not required;
- missing/free/active/trialing/canceled/past-due/expired subscription;
- RevenueCat billing issue/grace period/paused states evaluated via the explicit `billing_state` field against the chosen `paidBillingStates` set (§4.1), not inferred from `status`; the strict default excludes grace and paused. Include a fixture where `entitlements.active=true` but `billing_state=grace` and assert the policy result;
- period current/expired;
- KV available/unavailable.

### Backend contract tests

- User without paid or BYOK access receives `ai_access_required` before provider/queue/Lambda invocation.
- AI master off receives `ai_features_disabled` for paid and free users.
- Missing subscription row is denied without a database insert.
- Canceled-at-period-end remains paid until expiry.
- Expired or past-due state is denied.
- KV read failure resolves disabled and invokes no provider.
- Legacy `/ai/chat/stream` cannot be called anonymously.
- Mira cannot cancel or reactivate an App Store subscription by mutating D1.
- Report Q&A `POST` is denied before Gemini while deterministic suggestion `GET` remains available.
- Staging `/dev/test-*` cannot invoke any provider without explicit authorized access.
- All report process endpoints persist the same actor and resolve the same credential policy.
- Every listed manual/read path still succeeds.
- Existing stored AI artifacts remain readable after entitlement loss.

### RevenueCat tests

- Missing/invalid webhook authorization is rejected.
- Duplicate event ID returns success without duplicate writes.
- Delayed/out-of-order events converge to current RevenueCat state.
- Unknown, deleted, and anonymous user IDs are safe.
- Transfer synchronizes both sides according to configured restore policy.
- Sandbox events cannot mutate the wrong environment.
- Purchase/restore sync never trusts client-supplied entitlement fields.
- Wrong RevenueCat `app_id` or environment is rejected without subscription mutation.

### Mobile tests

- No AI/paywall flash while flags or subscription are loading.
- AI-off surfaces hide without purchase copy.
- AI intent without access opens Unlock AI with the enabled Subscribe and Connect API Key options.
- Purchase cancellation is not shown as an error.
- Purchase success waits for backend synchronization.
- Restore is explicit and updates server state.
- Deep links and AI notifications pass through entitlement guards.
- Logout/account switch cannot retain the previous user's paid UI.
- BYOK provider selection, failed validation, repair, disconnect, unsupported-capability, and **per-provider model picker (≤5 catalog options, reject unknown ids)** flows are covered.
- Maestro/E2E coverage exercises both unlock branches and all three provider onboarding flows.

### Core regression

With all V1 flags off, verify:

- auth and onboarding;
- household/member CRUD;
- manual task CRUD;
- budget and savings manual CRUD;
- utility manual entry;
- contractor manual CRUD;
- family messages without assistant;
- report upload/store/list/view without processing;
- floor-plan upload/view without analysis;
- garden view/manual data without generation;
- Profile without billing controls.

## 12. Monitoring

Track:

- entitlement allows/denials by reason and route family;
- RevenueCat webhook auth failures, duplicate rate, processing lag, and sync failures;
- `/subscriptions/sync` success/latency/rate-limit;
- paid/BYOK users receiving access denials;
- free users reaching provider, queue, or Lambda — target zero;
- queue jobs acknowledged as entitlement-denied;
- AI provider/Lambda volume and cost before/after rollout;
- purchase/restore failures by StoreKit error category.
- BYOK validation, invalidation, quota, rate-limit, and capability-denial counts by provider;
- credential encryption key-version distribution and lease consume/replay failures;
- usage split by `credential_source`, provider, model, and feature;
- `MODEL_NOT_AVAILABLE_FOR_KEY` rate by provider (signals a stale catalog or a common tier/verification gap);
- catalog models approaching their provider retirement date (deprecation-diff job, §8.4/§19.5).

Never log receipts, webhook secrets, subscriber attributes, auth tokens, or full CustomerInfo payloads.

Operational alerts:

- any provider invocation without a paid or active BYOK access source while access is required;
- sustained webhook or synchronization failure;
- sudden paid-entitlement drop;
- AI spend after `aiFeaturesEnabled=false`.

## 13. Primary Files

Mobile:

- `package.json`
- `app/_layout.tsx`
- `src/config/env.ts`
- `src/config/features.ts`
- `src/stores/featureFlagStore.ts`
- `src/contexts/SubscriptionContext.tsx`
- `src/api/subscription.ts`
- `src/api/client.ts`
- `src/screens/main/ProfileScreen.tsx`
- `src/screens/settings/TermsOfServiceScreen.tsx`
- `src/screens/settings/PrivacyPolicyScreen.tsx`
- new Expo Router AI-access/provider onboarding routes
- new `src/api/ai-credentials.ts`
- new AI access/provider preference context or store
- new RevenueCat service/provider and AI entitlement hook
- new shared paywall component/screen
- `src/screens/chat/ChatScreen.tsx`
- `src/screens/ai/AIInsightsDashboardScreen.tsx`
- `src/screens/garbage/GarbageDetectScreen.tsx`
- AI surface components, maintenance/visit APIs, route hosts, notification guards, Watch/widget sync

Backend:

- `backend/src/types/`
- `backend/src/db/schema.ts`
- new immutable migrations for Phase 3 report-job actors, Phase 4 RevenueCat state, and Phase 6 BYOK credentials/leases
- `backend/src/services/featureFlagService.ts`
- `backend/src/services/subscription-service.ts`
- new `backend/src/services/revenuecat-service.ts`
- new `backend/src/services/entitlement-service.ts`
- new `backend/src/services/ai-credential-service.ts`
- new `backend/src/services/ai-provider-resolver.ts`
- new `backend/src/routes/internal-ai-credentials.ts`
- new `backend/src/ai/openai-provider.ts`
- `backend/src/ai/provider.ts`
- `backend/src/ai/claude-provider.ts`
- `backend/src/ai/gemini-provider.ts`
- `backend/src/middleware/error-handler.ts`
- `backend/src/routes/subscriptions.ts`
- `backend/src/routes/webhooks.ts`
- `backend/src/routes/ai.ts`
- `backend/src/routes/dev.ts`
- `backend/src/routes/chat.ts`
- `backend/src/routes/ai-housekeeper.ts`
- `backend/src/routes/aihousekeeper*.ts`
- `backend/src/routes/aihousekeeper-voice.ts`
- `backend/src/services/ai/tools/aihousekeeper/subscription-tools.ts`
- `backend/src/types/index.ts`
- `backend/src/index.ts`
- `backend/src/services/enhanced-pdf-processor.ts`
- `backend/src/services/pdf-processing-service.ts`
- `backend/src/services/chat-service.ts`
- `backend/src/services/garbage-schedule-ai-service.ts`
- `backend/src/services/contractor-search-service.ts`
- `backend/src/services/ai/garden-site-plan-image-service.ts`
- `backend/lambda-processor/handler.py`
- `backend/lambda-processor/batch_processor.py`
- new Lambda provider adapters and credential-lease client
- all AI route/service boundaries, queue consumers, and scheduled workers

The current highest migration is `0084_chat_enhancements.sql`, so the first expected next number is `0085`; implementation must re-check availability and allocate a separate forward-only migration per phase. It must also re-run the AI call-site inventory from the then-current `backend/src/index.ts` mounts and all provider callers.

## 14. Out of Scope

- Rewriting business prompts, Mira tool semantics, or generated-output domain schemas.
- Rewriting Lambda PDF download, OCR, chunking, checkpoint, domain extraction, or callback behavior. Replacing the provider client, actor propagation, credential lease, and provider serialization layers is in scope.
- Stripe web checkout.
- Android/Google Play billing.
- Multiple paid AI tiers or per-feature upsells.
- Changing free report quota arithmetic.
- Deleting or hiding historical AI-generated artifacts after entitlement loss.
- Subscription sharing across different SimpleHouse user accounts.
- Connecting consumer ChatGPT, Claude, or Gemini login/subscription sessions.
- Provider OAuth unless a vendor publishes an approved delegated third-party inference flow.

## 15. Definition of Done

- [ ] V1 defaults deny every AI invocation server-side.
- [ ] All core non-AI workflows remain available.
- [ ] Mobile and backend flag catalogs and truth tables match.
- [ ] No client payload can grant paid entitlement.
- [ ] No client or API response can read back a stored provider key.
- [ ] User provider credentials are AES-GCM encrypted with versioned keys and authenticated context.
- [ ] Paid and BYOK access sources resolve independently and never cause unexpected cross-source billing.
- [ ] OpenAI, Claude, and Gemini pass the common provider contract suite for every portable worker.
- [ ] Each provider exposes at most 5 selectable models from a server catalog (ceiling enforced in config validation); client cannot submit arbitrary vendor model IDs.
- [ ] A selected model not callable by a BYOK key resolves to `MODEL_NOT_AVAILABLE_FOR_KEY` and falls back to the provider default without invalidating the credential.
- [ ] Placeholder model IDs are replaced with provider-verified current IDs, and a scheduled job alerts before any in-use model's retirement date.
- [ ] Unsupported provider modalities are blocked before enqueue with clear UX.
- [ ] Lambda receives user credentials only through a one-time, job-bound lease—not an event payload.
- [ ] All three provider onboarding flows distinguish consumer plans from API billing.
- [ ] BYOK storefront behavior has documented App Review/product approval.
- [ ] Every AI queue/job has a resolvable initiating user.
- [ ] Every AI route family has a denial-before-invocation test.
- [ ] The legacy `/ai/chat/stream` path is removed or authenticated and gated.
- [ ] Mira cannot mutate App Store billing state.
- [ ] RevenueCat webhook authentication and idempotency are tested.
- [ ] Purchase and restore synchronize to backend entitlement.
- [ ] Account switching cannot leak paid state.
- [ ] The first Apple subscription is approved with the binary before a flags-only rollout is promised.
- [ ] Kill switches are verified in staging and production.
- [ ] Staging and production migrations and secrets are configured independently.
- [ ] Monitoring can prove that denied users generate zero AI provider/Lambda calls.

## 16. Official References

- [Apple — Submit an In-App Purchase](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase)
- [Apple — App Review Guidelines 3.1.1 and 3.1.2](https://developer.apple.com/app-store/review/guidelines/)
- [Expo — Using in-app purchases](https://docs.expo.dev/guides/in-app-purchases/)
- [RevenueCat — Expo installation](https://www.revenuecat.com/docs/getting-started/installation/expo)
- [RevenueCat — Identifying customers](https://www.revenuecat.com/docs/customers/identifying-customers)
- [RevenueCat — Restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior)
- [RevenueCat — Restoring purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)
- [RevenueCat — Webhook event types and fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
- [OpenAI — ChatGPT and API billing are separate](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform)
- [OpenAI — Production best practices (API key safety, project keys, spend limits)](https://developers.openai.com/api/docs/guides/production-best-practices)
- [OpenAI — Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI — Models](https://developers.openai.com/api/docs/models)
- [Anthropic — Getting started (docs now at platform.claude.com)](https://platform.claude.com/docs/en/build-with-claude/overview)
- [Anthropic — Tool reference (web_search server tool)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference)
- [Anthropic — Paid Claude plan does not include API access](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console)
- [Google — Gemini API getting started](https://ai.google.dev/gemini-api/docs/get-started)
- [Google — Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
- [Google — Using Gemini API keys (auth keys; June/September 2026 standard-key restrictions)](https://ai.google.dev/gemini-api/docs/generate-content/api-key)
- [Google — Grounding with Google Search](https://ai.google.dev/gemini-api/docs/interactions/google-search)
- [Google — Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [RevenueCat — Webhook event flows (grace period / out-of-order events)](https://www.revenuecat.com/docs/integrations/webhooks/event-flows)
- [Cloudflare — Web Crypto (AES-GCM)](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare — Protect against timing attacks (timingSafeEqual)](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/)

## 17. BYOK Product Contract

### 17.1 Unlock AI entry

When `aiFeaturesEnabled && aiRequiresAccess` and the user has no access source, show one **Unlock AI** screen:

#### Option A — SimpleHouse AI

- “Subscribe with Apple”
- AI usage is included under the SimpleHouse plan.
- SimpleHouse selects and pays supported providers.
- Restore Purchases remains visible.

#### Option B — Use my API key

- “Connect OpenAI, Claude, or Gemini”
- Requires a developer API account and API key.
- The provider bills the user directly for usage.
- Existing ChatGPT/Claude/Gemini consumer subscriptions do not apply.
- SimpleHouse securely stores the key server-side and sends home data to the selected provider when AI features are used.

If only one channel is enabled, show only that channel. If neither channel is enabled, show “AI is currently unavailable,” not an empty paywall.

### 17.2 Access-source preference

Store a per-user preference:

```ts
type AICredentialSource = 'simplehouse' | 'byok';
type AIProviderId = 'openai' | 'anthropic' | 'gemini';
```

Rules:

- paid only → `simplehouse`;
- BYOK only → `byok`;
- both → preserve explicit user choice, default `simplehouse`;
- disconnected/invalid BYOK with an active paid plan → ask before switching to SimpleHouse billing;
- disconnected/invalid BYOK without paid plan → block and offer Repair connection or Apple subscription;
- never select a provider based on the key prefix alone;
- model selection is independent of access source: the user picks one catalog model (≤5 options) for the active provider; invalid/retired selections fall back to that provider's catalog default (§19.5).

### 17.3 Scope

Credentials are user-scoped, not household-scoped. Interactive work uses the authenticated actor's source/provider. Async jobs persist `userId`, source, provider, and capability snapshot—but never the key. Household-owner scheduled work uses the owner's current access source at execution time.

Generated shared artifacts remain visible to household members under §4.5.

### 17.4 Cost and privacy disclosure

Before saving a key, require explicit acknowledgement:

- provider API charges are separate from SimpleHouse and Apple;
- costs vary by model, tokens, files, images, and retries;
- SimpleHouse cannot read provider balances or guarantee a spending cap;
- prompts may include household data needed for the selected feature;
- provider retention/training terms depend on the user's API account and provider configuration;
- deleting the key from SimpleHouse does not revoke it at the provider; the user should revoke it in the provider console.

### 17.5 Cross-member data exposure and consent

A BYOK credential is user-scoped, but the household data sent when that member runs an AI feature can include **other members' contributions** (shared reports, tasks, budgets, messages). This routes other members' data to a third-party provider account chosen and billed by one member. This is a distinct privacy concern from the key owner's own cost/privacy acknowledgement in §17.4 and must be resolved before `bringYourOwnAIEnabled=true`:

- **Household-level disclosure:** members must be informed (at household level, not only in the key owner's flow) that a member may connect a personal provider key that processes shared household data through that provider. Product/legal decides whether household-admin consent, per-member opt-out, or a household setting is required (open decision, §23).
- **Per-tool context allowlist:** the provider-neutral execution context (§19.1) must build prompts from an explicit per-feature allowlist of fields, never a broad household dump. No LLM context — managed or BYOK — is assembled without a per-tool field allowlist; this is a hard requirement carried from the platform's context-redaction rule.
- **Audit:** record (without payload) which actor/source/provider processed a shared artifact so a member can see that BYOK routing occurred.

## 18. Credential Vault and Security

### 18.1 D1 schema

Create `user_ai_credentials`:

- `id` primary key;
- `user_id` foreign key;
- `provider` (`openai|anthropic|gemini`);
- `ciphertext` base64;
- `iv` base64, random 96-bit AES-GCM nonce;
- `key_version`;
- `key_hint` (non-secret last four characters only);
- `status` (`pending_validation|active|invalid|revoked`);
- `last_validated_at`;
- `last_used_at`;
- `last_error_code` (normalized, non-sensitive);
- timestamps;
- unique index on `(user_id, provider)`.

Create `user_ai_preferences`:

- `user_id` primary key;
- `credential_source`;
- `active_provider`;
- `selected_model_id` — a registry key from the server catalog for `active_provider` (never a free-typed vendor string from the client);
- `allow_paid_fallback` default false;
- timestamps.

Do **not** store a free-form `model_profile` enum as the primary selector. Profiles may still appear as display labels on catalog entries (`balanced|fast|quality|…`), but the persisted preference is always a concrete `selected_model_id` from the per-provider catalog in §19.5.

Create `ai_credential_audit` without secrets:

- user, provider, action, result, request ID, timestamp;
- actions: created, validated, selected, used, invalidated, disconnected, re-encrypted.

Create `ai_credential_leases` for Lambda handoff:

- `token_hash` primary key (SHA-256 of a random 256-bit token; never store plaintext);
- `job_id`;
- `user_id`;
- `provider`;
- `required_capability`;
- `selected_model_id` (registry-key **hint** captured at mint; it is not authoritative — the consume step re-resolves it against the live catalog per §18.5, so a model retired after mint is not used from the lease);
- `expires_at`;
- `consumed_at` nullable;
- `created_at`;
- indexes on `job_id` and `expires_at`.

Consume with one conditional D1 update (`consumed_at IS NULL AND expires_at > now`) and require exactly one returned row. A scheduled cleanup deletes expired/consumed leases after the audit window.

### 18.2 Encryption

Use **authenticated AES-256-GCM encryption under a versioned master key with AAD** in the Worker (this is direct symmetric encryption, not DEK-wrapping "envelope encryption"; use the latter term only if a per-record wrapped-DEK scheme via `crypto.subtle.wrapKey` is actually adopted):

- master key is a 32-byte random secret configured as `AI_CREDENTIAL_KEK_V1`;
- import the key once per request execution context as non-extractable;
- generate a fresh 12-byte IV for every encryption;
- authenticated additional data contains `credentialId:userId:provider:keyVersion`;
- store ciphertext/IV/version separately;
- decrypt only immediately before constructing a provider client;
- drop plaintext references after provider construction/use;
- never use deterministic encryption or reuse an IV;
- never use JWT, user password, device identifiers, or a database value as the encryption key.

Add typed Worker secrets:

- `AI_CREDENTIAL_KEK_V1`;
- `AI_CREDENTIAL_LEASE_SECRET`;
- future `AI_CREDENTIAL_KEK_V2` only during rotation.

Configure them independently with `wrangler secret put` for staging and production. Mount the consume route from `backend/src/index.ts` through a dedicated internal router; it is not CORS-accessible and is protected by integration auth plus the one-time lease.

Rotation:

- add `AI_CREDENTIAL_KEK_V2` before changing the active version;
- new writes use V2;
- successful reads of V1 re-encrypt to V2;
- retain V1 until migration metrics show zero V1 rows;
- remove V1 only after rollback window and verified backup recovery.

### 18.3 Mobile secret handling

- API key is entered in a masked `TextInput` with autocorrect, spellcheck, suggestions, and persistence disabled.
- Do not auto-read the clipboard.
- Do not store the key in MMKV, AsyncStorage, SecureStore, Zustand persistence, React Query cache, logs, analytics, or crash breadcrumbs.
- Send once over authenticated TLS directly to the backend.
- Clear component state on success, back navigation, timeout, logout, and app background.
- Redact request bodies in network logging.
- Hide the key-entry view in the app-switcher snapshot.
- Server responses return metadata only: provider, status, hint, dates, and capabilities.

### 18.4 Validation and lifecycle

Validation performs a bounded, low-token provider request against a server-approved model/capability. It must distinguish:

- malformed/missing key;
- authentication failure;
- permission/model access failure;
- quota/billing exhaustion;
- provider rate limit;
- provider outage/timeout.

Only whole-key authentication failures (and provider-wide permission failures) mark a stored key `invalid`. Quota/rate-limit/outage states remain active but degraded so transient failures do not force reconnection. A **per-model** permission/availability failure (the key works but cannot call the *selected* catalog model — org verification, tier, or region) must NOT mark the whole credential `invalid`: it resolves to `MODEL_NOT_AVAILABLE_FOR_KEY` (§4.4) and falls back to the same-provider catalog default, keeping the key `active`. Distinguish "key is bad" from "this model is not available to this key."

Gemini validation must issue a real bounded Generative Language API request. Do not infer key class from its text. A Google rejection for an unrestricted/blocked key maps to a permission error with guidance to create an **auth key** (the current recommended, service-account-bound key). Note two Google deadlines: unrestricted standard keys are rejected as of **June 19 2026** (already in effect), and **all standard keys — even explicitly restricted ones — are rejected at the September 2026 hard cutoff**, after which only auth keys work. Onboarding must recommend auth keys as the primary path and treat a restricted standard key as a temporary fallback only.

Credential endpoints are authenticated, user-scoped, rate-limited, no-store, and excluded from body logging. Disconnect deletes ciphertext and preferences in one transaction. Account deletion deletes all credential rows and audit identifiers according to the project's retention policy.

### 18.5 Lambda credential lease

All integration-secret comparisons in this section (lease bearer, webhook auth, callback secret) use a **length-safe** timing-safe comparison. Cloudflare's `crypto.subtle.timingSafeEqual` throws when the two buffers differ in length, so compare only equal-length buffers and treat a length mismatch as a non-match without early-returning in variable time (per Cloudflare's documented pattern).

Plaintext BYOK keys must not appear in Lambda invocation events, queue messages, R2, checkpoints, or CloudWatch logs.

For BYOK report processing:

1. The authenticated report route persists `processing_jobs.initiated_by_user_id`.
2. Worker authorizes that actor and creates a cryptographically random one-time lease token.
3. Store only its hash, bound to job ID, user ID, provider, required capability, the `selected_model_id` hint, and a short expiry.
4. Pass the opaque lease token—not its hash or key—to Lambda.
5. Lambda calls `POST /internal/ai-credential-leases/consume` with the token in a no-store JSON body and a dedicated `AI_CREDENTIAL_LEASE_SECRET` bearer credential.
6. Worker timing-safely verifies the integration secret, atomically consumes the token, rechecks job/actor access, **re-resolves `selected_model_id` against the live catalog and the actor's current credential** (the leased model is a hint, not authority — if it was retired/removed since mint, resolve to the same-provider default per §19.5 and record the substitution), and returns provider/key/resolved-model over TLS.
7. The consume route has strict body limits, redacted request logging, replay protection, and integration-level rate limiting. It never falls back to `JWT_SECRET`.
8. Lambda holds the key only in memory for that invocation and never logs/checkpoints it.
9. Lambda never mints or refreshes a lease. At a batch checkpoint it calls the existing authenticated progress/callback path with `resume_required`.
10. Worker re-loads the job actor, rechecks access, re-resolves the model against the live catalog (same §19.5 fallback), mints a new lease internally, and invokes the next Lambda batch. No public lease-issue endpoint exists.
11. A consumed/expired lease cannot be refreshed by Lambda alone.

Extend `POST /webhooks/lambda/report-progress` with a validated resume payload:

```ts
interface LambdaReportProgressPayload {
  jobId: string;
  reportId: string;
  householdId: string;
  progress: number;
  stage: string;
  resumeRequired: boolean;
  nextBatchNumber?: number;
  checkpointKey?: string;
}
```

Move callback authentication from body `apiKey`/`JWT_SECRET` fallback to a dedicated timing-safely verified bearer secret. When `resumeRequired=true`, `backend/src/routes/webhooks.ts` delegates to `EnhancedPdfProcessorService`, which verifies the job identifiers and checkpoint, resolves `initiated_by_user_id`, creates a fresh lease, and invokes Lambda with `mode='resume_batch'`.

Replace the current self-invocation branch in `backend/lambda-processor/batch_processor.py`: Lambda may write a checkpoint and request continuation, but only the Worker may schedule the next BYOK or managed batch. Preserve checkpoint content compatibility while changing orchestration ownership.

**Lease-secret provisioning on both sides.** `AI_CREDENTIAL_LEASE_SECRET` must exist in two places with a coordinated value: the Worker (typed `Env`, via `wrangler secret put --env staging|production`) and the Lambda runtime (as a Lambda environment variable sourced from AWS Secrets Manager / SSM, injected by the Lambda deploy scripts — never committed). Document the rotation runbook: add the new secret to Secrets Manager and the Worker as `V2`-style dual-accept, deploy Lambda to read the new value, cut over, then remove the old value. The Lambda callback secret from §7.1 (replacing the `JWT_SECRET` fallback) follows the same two-sided provisioning. The lease bearer and the callback bearer are distinct secrets.

If a safe lease cannot be implemented, BYOK report processing remains unsupported; never fall back to a SimpleHouse key silently.

## 19. Provider-Neutral AI Architecture

### 19.1 Resolver

No route, service, worker, cron handler, or Lambda function constructs `ClaudeProvider`, `GeminiProvider`, or `OpenAIProvider` directly.

The Phase 7 migration inventory must scan and remove production call sites for:

- `new ClaudeProvider`;
- `new GeminiProvider`;
- raw `api.anthropic.com`, `generativelanguage.googleapis.com`, and `api.openai.com` calls;
- `createTrackedAnthropic`;
- raw/legacy Gemini service clients;
- module-level provider clients in Lambda.

After migration, provider construction is allowed only in provider adapters/factory, tests, and explicit development scripts that cannot be mounted in staging/production.

Create:

```ts
interface ResolvedAIExecutionContext {
  accessSource: 'simplehouse' | 'byok';
  provider: 'openai' | 'anthropic' | 'gemini';
  model: string;
  capabilities: Set<AICapability>;
  credentialRef: string;
  usageContext: {
    userId: string;
    householdId?: string;
    feature: string;
    jobId?: string;
  };
}
```

`AIProviderResolver.resolve(userId, feature, requiredCapabilities, env)`:

1. resolves flags and access;
2. selects credential source/provider;
3. checks provider and feature kill switches;
4. resolves `selected_model_id` against the server catalog for that provider (or the catalog default if unset/invalid);
5. verifies required capabilities for the resolved model;
6. decrypts the selected key just in time;
7. returns a provider adapter with usage/audit hooks.

Queue messages persist identifiers and required capability, not a provider credential. Consumers resolve again at execution so revocation and kill switches take effect.

**Per-tool context allowlist (required, satisfies §17.5).** Every feature that builds an LLM prompt must declare an explicit per-feature allowlist of the household fields it may include; the execution context assembles prompts only from that allowlist and never from a broad household dump. This applies identically to SimpleHouse-managed and BYOK sources, and is the mechanism referenced by §17.5 for limiting cross-member data exposure. A feature with no declared allowlist must not reach a provider.

### 19.2 Canonical provider interface

Split the current monolithic interface into capabilities:

```ts
type AICapability =
  | 'text'
  | 'structured_output'
  | 'tool_calling'
  | 'image_understanding'
  | 'pdf_understanding'
  | 'web_grounded_search'
  | 'embeddings'
  | 'image_generation'
  | 'realtime_audio'
  | 'realtime_audio_transport';

interface TextAIProvider {
  generate(args: CanonicalGenerateArgs): Promise<CanonicalGenerateResult>;
  generateStructured<T>(args: CanonicalStructuredArgs): Promise<T>;
}

interface EmbeddingProvider {
  embed(args: CanonicalEmbeddingArgs): Promise<number[][]>;
}

interface ImageGenerationProvider {
  generateImage(args: CanonicalImageArgs): Promise<CanonicalImageResult>;
}

interface GroundedSearchResult {
  answer: string;
  sources: Array<{
    url: string;
    title: string | null;
    publisher: string | null;
    quotedText: string | null;
  }>;
}
```

Canonical messages/tools must not expose Anthropic-specific `tool_use`, cache-control blocks, or Gemini-specific parts. Each adapter translates canonical content into provider request/response shapes.

Grounded-search adapters must normalize provider citations into `GroundedSearchResult`, reject non-HTTP(S) URLs, deduplicate sources, preserve source attribution, and never treat uncited model text as a verified municipality/contractor fact.

### 19.3 Provider implementations

OpenAI:

- add `backend/src/ai/openai-provider.ts`;
- use server-side API key authentication;
- support text, structured output, tool calling, images/PDFs where the configured model supports them, embeddings, image generation, and realtime audio through explicit adapters;
- recommend a dedicated project key with restricted permissions and a provider-side spend limit.

Anthropic:

- keep `ClaudeProvider`, but remove API-specific types from the canonical interface;
- support text, structured output, tool calling, images, and PDFs;
- prompt caching is an adapter optimization only and must not be required by callers;
- do not claim native embeddings, image generation, or realtime audio.

Gemini:

- keep `GeminiProvider`, but implement canonical tools, structured output, images/PDFs, embeddings, and supported image/audio APIs through capability-specific adapters;
- accept only auth/restricted keys valid for the Gemini API, preferring auth keys;
- account for Google's June 19 2026 rejection of unrestricted standard keys and the September 2026 rejection of all standard keys.

### 19.4 Capability matrix

Each cell means **some current models** in that provider support the capability — **not** that every model does. The resolver MUST re-check the capability against the *configured* model ID (capabilities vary by model and, for some providers, by account tier); providers do not expose reliable machine-readable capability metadata, so SimpleHouse maintains its own per-model capability map. The matrix is validated against configured model IDs at implementation time:

| Capability | OpenAI | Anthropic | Gemini |
|---|---:|---:|---:|
| Text/chat | Yes | Yes | Yes |
| Structured JSON | Yes | Yes | Yes |
| Tool calling | Yes | Yes | Yes |
| Image understanding | Yes | Yes | Yes |
| PDF/document understanding | Yes | Yes | Yes |
| Provider-grounded web search | Yes, model-dependent | Yes, server-tool/model-dependent | Yes, grounding/model-dependent |
| Embeddings | Yes | No native API | Yes |
| Image generation/edit | Yes | No | Model-dependent |
| Realtime audio | Yes | No equivalent | Model-dependent |
| Current SimpleHouse realtime transport | OpenAI | No | No |

Therefore “all workers support all three” means:

- every text/structured/tool/image-understanding/PDF worker is portable across all three;
- grounded garbage/contractor search uses a provider-neutral search result/citation contract rather than raw Claude/Gemini tool payloads;
- embeddings, garden image generation, and realtime voice declare required capabilities. **Map each capability to its concrete worker before implementation:** identify whether any current SimpleHouse worker uses embeddings (e.g., report/chat RAG retrieval) — if none does, mark `embeddings` as a reserved capability with no active portable worker and exclude it from the "every portable worker × three providers" contract suite; if a worker does use embeddings, it is a capability-gated worker (Anthropic has no native embeddings API) and must declare `embeddings` like garden image generation does;
- Mira BYOK voice requires an OpenAI credential for the current realtime transport even when another provider handles reasoning; otherwise voice is hidden and text Mira remains available;
- unsupported pairs are hidden/disabled with `ai_provider_capability_unsupported`;
- no cross-provider charge occurs without explicit consent.

### 19.5 Model policy and per-provider selection (up to 5)

Do not let the mobile client submit arbitrary model IDs. Maintain a **server-controlled catalog** of selectable models per provider. Model changes require server configuration/tests, not an app release.

**Catalog rules:**

- Each provider (`openai`, `anthropic`, `gemini`) exposes **at most 5** selectable models in the catalog at any time.
- Catalog entries are the only values the client may choose. The client never types a vendor model string.
- Each entry has a stable registry key (`selected_model_id`), display name, optional profile label (`balanced|fast|quality|…`), vendor model ID (server-only mapping), supported capabilities, context/output limits, and environment availability (staging/production).
- Exactly one entry per provider is marked `default`. New users and invalid/retired selections fall back to that default.
- Paid SimpleHouse AI and BYOK share the same catalog shape; managed credentials may expose a different subset than BYOK if product wants cost control, but the **5-model ceiling still applies per provider**. Cost policy: the managed (SimpleHouse-paid) catalog should **default to a cost/latency tier** and gate frontier/expensive models behind BYOK or an explicit opt-in, because on a managed plan the user's model choice is a direct margin cost (frontier vs economy input/output token prices differ by several ×). BYOK users bear their own cost and may default to any catalog model (open decision, §23).
- Specialty modalities (embeddings, image generation, realtime audio) may use fixed server models outside the user-facing 5 when the selected chat/reasoning model cannot satisfy the capability. Prefer same-provider specialty models and never silently switch the *reasoning* provider. **Known cross-provider exception:** the realtime voice *transport* is OpenAI-only today (§19.4), so a BYOK Anthropic/Gemini user's reasoning provider differs from the voice transport provider by construction; this is the one allowed cross-provider case and is governed by §19.4/§23 #5 (voice hidden without an OpenAI transport credential). Disclose whenever a specialty model or transport differs from the user's selected model.

> ⚠️ **Verified against provider docs on 2026-07-10 — re-check before locking config.** Catalogs may ship with **fewer than 5** entries; empty/optional slots are product fills, not required. Prefer pinned IDs over floating aliases (§23 #9). Reject any ID whose published retirement falls inside the support horizon.

**Live provider check (2026-07-10):**

| Provider | Chat/reasoning IDs confirmed | Do not use | Specialty (outside user-facing ≤5) |
|---|---|---|---|
| OpenAI | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` (alias `gpt-5.6` → Sol — do not expose alias) | Legacy GPT-4.1 as a catalog default | Image: GPT Image 2 / current `gpt-image-*`; Realtime: `gpt-realtime-2.1` (+ mini); embeddings / TTS / transcription as fixed server maps |
| Anthropic | `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5` (+ optional prior `claude-sonnet-4-6`) | Invitation-only `claude-mythos-5`; dated legacy defaults still in repo (`claude-sonnet-4-5-20250929`) | No native embeddings / image-gen / realtime transport — capability-gate those features |
| Gemini | Stable: `gemini-3.5-flash`, `gemini-3.1-flash-lite`; Preview: `gemini-3.1-pro-preview`, `gemini-3-flash-preview` | **Shut down:** `gemini-2.0-flash` / `gemini-2.0-flash-lite` (still the Worker default today — must change); retiring ≥2026-10-16: `gemini-2.5-*` | Image: Nano Banana family; Live/TTS: `gemini-3.1-flash-live` / TTS variants; embeddings: `gemini-embedding-2` |

**Current-code debt to clear in Phase 7 (model defaults):**

- `backend/src/ai/claude-provider.ts` defaults to `claude-sonnet-4-5-20250929` → replace with catalog-resolved vendor ID (V1 default Sonnet 5).
- `backend/src/ai/gemini-provider.ts` defaults to `gemini-2.0-flash` (**already shut down**) → replace with catalog-resolved ID (V1 default `gemini-3.5-flash`).
- OpenAI chat provider does not exist yet; image (`gpt-image-1` / garden) and realtime (`AIHOUSEKEEPER_REALTIME_MODEL`) stay as specialty maps outside the user-facing 5.

#### Illustrative OpenAI catalog (≤5) — V1 ships 3 chat options

| # | Registry key | Vendor model ID | Display name | Profile | Default | Managed | Notes |
|---:|---|---|---|---|---|---|---|
| 1 | `openai.gpt-5.6-sol` | `gpt-5.6-sol` | GPT-5.6 Sol | `quality` | no | BYOK / opt-in only (§23 #7) | Frontier; $5/$30 per MTok |
| 2 | `openai.gpt-5.6-terra` | `gpt-5.6-terra` | GPT-5.6 Terra | `balanced` | **yes** | yes | Managed + BYOK default; $2.50/$15 |
| 3 | `openai.gpt-5.6-luna` | `gpt-5.6-luna` | GPT-5.6 Luna | `fast` | no | yes | High-volume; $1/$6 |
| 4 | — | — | — | — | — | — | **Leave empty in V1** — OpenAI currently exposes three GPT-5.6 chat tiers only |
| 5 | — | — | — | — | — | — | Reserved; do not invent IDs |

Do **not** expose alias `gpt-5.6` (routes to Sol). Specialty models (image, realtime, embeddings) are **not** picker rows — see §19.5.1 specialty map.

#### Illustrative Anthropic catalog (≤5) — V1 ships 4, optional 5th

| # | Registry key | Vendor model ID | Display name | Profile | Default | Managed | Notes |
|---:|---|---|---|---|---|---|---|
| 1 | `anthropic.claude-fable-5` | `claude-fable-5` | Claude Fable 5 | `quality` | no | BYOK / opt-in only | Highest widely released; $10/$50 |
| 2 | `anthropic.claude-opus-4-8` | `claude-opus-4-8` | Claude Opus 4.8 | `quality` | no | BYOK / opt-in (or managed if margin allows) | Complex agentic; $5/$25 |
| 3 | `anthropic.claude-sonnet-5` | `claude-sonnet-5` | Claude Sonnet 5 | `balanced` | **yes** | yes | Default; $3/$15 (intro pricing may apply) |
| 4 | `anthropic.claude-haiku-4-5` | `claude-haiku-4-5` | Claude Haiku 4.5 | `fast` | no | yes | Fastest / cheapest; alias → dated snapshot OK if product pins |
| 5 | `anthropic.claude-sonnet-4-6` | `claude-sonnet-4-6` | Claude Sonnet 4.6 | `economy` | no | product choice | **Optional** prior-stable; omit if near retirement |

Do **not** list `claude-mythos-5`.

#### Illustrative Gemini catalog (≤5) — V1 ships 4 verified IDs

| # | Registry key | Vendor model ID | Display name | Profile | Default | Managed | Notes |
|---:|---|---|---|---|---|---|---|
| 1 | `gemini.3.1-pro` | `gemini-3.1-pro-preview` | Gemini 3.1 Pro | `quality` | no | BYOK / opt-in only | Preview; complex reasoning |
| 2 | `gemini.3.5-flash` | `gemini-3.5-flash` | Gemini 3.5 Flash | `balanced` | **yes** | yes | Stable GA default |
| 3 | `gemini.3-flash` | `gemini-3-flash-preview` | Gemini 3 Flash | `balanced` | no | yes | Preview alternate flash |
| 4 | `gemini.3.1-flash-lite` | `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | `fast` | no | yes | Stable; cost-sensitive |
| 5 | — | — | — | — | — | — | **Leave empty in V1** — do not invent `gemini-3.1-flash` (not a confirmed chat ID on 2026-07-10) |

Omit `gemini-2.5-*` (retire ≥2026-10-16) and shut-down `gemini-2.0-*`.

#### Picker UX (all providers)

- Connected screen and `app/ai-access/models.tsx` render a single-select list of the active provider’s catalog (1–5 rows): display name, short profile chip (`quality` / `balanced` / `fast` / …), default badge, and capability icons from the catalog metadata.
- Tapping a row calls `PATCH /ai-preferences` with that `selected_model_id`; on success refetch `GET /ai-access` (§9).
- Disabled / unavailable rows (BYOK probe failed for that model): show inline repair hint; do not mark the whole credential invalid (§4.4, §18.4).
- Managed users who cannot see a frontier slot still see the same picker shape with fewer rows — never a free-text model field.
- Empty catalog slots are omitted from the UI (do not render placeholder rows).

**Selection rules:**

- Preference is stored per user as `selected_model_id` for the active provider (§18.1).
- Changing provider resets selection to that provider's catalog default unless the user already has a saved selection for the new provider (optional: store last selection per provider in preferences JSON if product wants sticky per-provider choices; if so, cap at one selected id per provider and still enforce the 5-entry catalog).
- If a selected model is retired from the catalog, resolve to the provider default, surface a one-time “model updated” notice, and persist the new default.
- Feature execution uses the selected model when it supports the required capability; otherwise return `PROVIDER_CAPABILITY_UNSUPPORTED` and offer a capable model from the same provider's catalog (or SimpleHouse subscription), never auto-switch without consent.
- Config validation must reject a catalog with `>5` entries per provider, zero defaults, or more than one `default` per provider.

### 19.5.1 Model catalog — detailed implementation (all providers)

This subsection is the engineering contract for shipping §19.5. Implement in Phase 7 (backend catalog + resolver) and Phase 8 (picker UX).

#### A. Config module and schema

Add `backend/src/ai/model-catalog.ts` (pure data + validators; no network I/O):

```ts
type AIProviderId = 'openai' | 'anthropic' | 'gemini';
type ModelProfileLabel = 'quality' | 'balanced' | 'fast' | 'economy' | string;

interface ModelCatalogEntry {
  id: string;                    // registry key, e.g. 'openai.gpt-5.6-terra'
  provider: AIProviderId;
  vendorModelId: string;         // exact API string sent to the vendor
  displayName: string;
  profileLabel: ModelProfileLabel;
  isDefault: boolean;
  managedVisible: boolean;       // false => BYOK / opt-in only (§23 #7)
  capabilities: AICapability[];
  contextTokens: number;
  maxOutputTokens: number;
  environments: Array<'staging' | 'production'>;
  retirementNotBefore?: string;  // ISO date from provider docs, if known
}

interface SpecialtyModelMap {
  // Fixed server models OUTSIDE the user-facing ≤5 picker
  openai: {
    imageGeneration: string;       // e.g. current GPT Image / gpt-image-*
    realtimeAudio: string;         // e.g. gpt-realtime-2.1
    realtimeAudioMini?: string;
    embeddings?: string;
    transcription?: string;
  };
  anthropic: Record<string, never>; // no native image/realtime/embeddings
  gemini: {
    imageGeneration?: string;      // Nano Banana family ID when garden supports Gemini
    embeddings?: string;           // e.g. gemini-embedding-2
    liveAudio?: string;            // only if product adds Gemini Live later
  };
}
```

Rules enforced by `assertModelCatalogValid(catalog)` at Worker boot / test:

1. `entries.filter(e => e.provider === p).length <= 5` for each `p`.
2. Exactly one `isDefault: true` per provider among entries with `environments` containing the current env.
3. Every `id` unique globally; `id` must start with `${provider}.`.
4. No two entries share the same `vendorModelId` within a provider.
5. Every `managedVisible: true` entry must include at least `text` + `structured_output` (or document why not).
6. Specialty map IDs must not appear as picker `id`s.

Catalog source of truth for V1: **code module** (reviewed in PRs). Optional later: override subset via `CONFIG_KV` key `ai_model_catalog_v1` for emergency repoint without deploy — if used, KV overlay must pass the same validator and never expand past 5.

#### B. Resolution algorithm

`resolveModelForExecution({ provider, selectedModelId, accessSource, requiredCapabilities, credentialProbe })`:

```text
1. Load catalog entries for provider ∩ current environment.
2. If accessSource === 'simplehouse', filter to managedVisible === true.
3. Let candidate =
     entries.find(e => e.id === selectedModelId)
     ?? entries.find(e => e.isDefault)
     ?? null
4. If candidate is null → NO_PROVIDER_AVAILABLE / catalog misconfig (fail closed).
5. If requiredCapabilities ⊈ candidate.capabilities →
     try same-provider alternate that satisfies capabilities (prefer default);
     if none → PROVIDER_CAPABILITY_UNSUPPORTED (do not cross providers).
6. If accessSource === 'byok' and credentialProbe says candidate.vendorModelId not callable →
     substitute provider default (if probe says default callable) + record substitution notice;
     if no callable catalog model → terminal MODEL_NOT_AVAILABLE_FOR_KEY (409).
7. Return { registryKey: candidate.id, vendorModelId: candidate.vendorModelId, substituted: boolean }.
```

Wire this into `AIProviderResolver.resolve` step 4–5 (§19.1). Persist `registryKey` on jobs/leases/usage; send only `vendorModelId` to SDKs.

#### C. Per-provider adapter wiring

| Concern | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| New/updated adapter | `backend/src/ai/openai-provider.ts` (new) | Upgrade `claude-provider.ts` | Upgrade `gemini-provider.ts` |
| Constructor | `(apiKey, { model: vendorModelId })` — **no hardcoded default** in production path; factory always passes resolved ID | Same; remove `claude-sonnet-4-5-20250929` default from production factory | Same; remove `gemini-2.0-flash` default |
| Chat API | Responses API (GPT-5.6 family) | Messages API | `generateContent` / Interactions as adopted |
| Auth header | `Authorization: Bearer …` | `x-api-key` + `anthropic-version` | Header API key (**not** query string — fix `chat-service.ts:283`) |
| Structured output | JSON schema / tool strategy per adapter | Tool-forced JSON (existing) | `response_mime_type` + schema |
| Vision / PDF | Image parts + Files API as needed | Base64 image blocks; PDF via Files or text extract | Inline/file parts (PDF supported on 3.x) |
| Usage events | Map response usage → `ai_usage_events` with `provider:'openai'`, registry + vendor model | Existing Claude usage hook | Existing Gemini usage hook; stop putting key in URL |
| Errors → entitlement | 401/invalid key → `PROVIDER_KEY_INVALID`; model 404/tier → `MODEL_NOT_AVAILABLE_FOR_KEY`; rate limit → degraded, stay `active` | Same mapping via Anthropic error types | Same; auth-key vs API-key guidance in copy |

Factory (`backend/src/ai/provider-factory.ts`):

```ts
createProviderAdapter(ctx: ResolvedAIExecutionContext, apiKey: string): AIProvider
// switches on ctx.provider, passes ctx.model (vendorModelId) only
```

Lambda (`backend/lambda-processor/`): mirror the same registry→vendor map in Python (`model_catalog.py`) generated from or kept in lockstep with the TS catalog; lease consume returns `vendor_model_id` after re-resolve (§18.5).

#### D. BYOK model probes (per provider)

Run on connect (`POST /ai-credentials/:provider`) and optionally when opening the model picker:

| Provider | Probe | Success criteria | Failure mapping |
|---|---|---|---|
| OpenAI | `GET /v1/models/{vendorModelId}` or 1-token Responses call with that model | 200 | 404/403 model → model unavailable; 401 → key invalid |
| Anthropic | Low-max_tokens Messages call with `model: vendorModelId` | 200 | `not_found_error` → model unavailable; auth errors → key invalid |
| Gemini | `models/{vendorModelId}:generateContent` with tiny prompt **using header key** | 200 | 404 model / permission → model unavailable; 400 API_KEY_INVALID → key invalid |

Cache probe results on the credential row as non-secret JSON `model_availability: { [registryKey]: 'available'|'unavailable'|'unknown', checked_at }` (optional column or preferences side table). Refresh on validate and at most once per 24h unless user changes model.

#### E. Specialty model map (not in the ≤5 picker)

| Feature | Provider path | Model source |
|---|---|---|
| Garden image generation | OpenAI only today | `SpecialtyModelMap.openai.imageGeneration` |
| Mira realtime voice transport | OpenAI only (§19.4) | `SpecialtyModelMap.openai.realtimeAudio` |
| Embeddings / RAG (if any worker) | OpenAI or Gemini; never Anthropic | Specialty map; capability `embeddings` |
| Report PDF chat/reasoning | User-selected catalog model | `selected_model_id` → vendor ID |
| Mira text / tools | User-selected catalog model | same |

Disclose in UI when a specialty call uses a different model than the picker selection.

#### F. API contract details

`GET /ai-models?provider=openai|anthropic|gemini`

```ts
// 200
{
  provider: AIProviderId;
  models: AIModelOption[]; // length 0–5, filtered by env + managedVisible for simplehouse source
}
```

Reject unknown `provider` with `400`. Never return `vendorModelId` to older clients if product wants to hide raw IDs — V1 **may** omit vendor IDs from mobile responses and keep them server-only; registry `id` + `display_name` are enough for the picker.

`PATCH /ai-preferences`

```ts
// body
{
  credential_source?: 'simplehouse' | 'byok';
  active_provider?: AIProviderId;
  selected_model_id?: string;      // must belong to active_provider catalog
  allow_paid_fallback?: boolean;
}
// 200 → updated preferences + echo resolved model
// 400 → unknown id / wrong-provider id / empty catalog
```

On provider change: if sticky prefs disabled (§23 #10), set `selected_model_id` to that provider’s default in the same transaction.

`GET /ai-access` includes `selected_model_id`, `available_models` (≤5), and optional `model_substitution_notice` when the last resolve substituted.

#### G. Mobile implementation

| File / area | Work |
|---|---|
| `src/api/aiAccess.ts` (new) | `getAccess`, `getModels(provider)`, `patchPreferences` |
| `src/hooks/useAIEntitlement.ts` | Expose `selectedModelId`, `availableModels`, `setSelectedModel` |
| `app/ai-access/models.tsx` | Single-select FlatList; one section; no free text |
| Connected screens (§20.1–20.3) | Inline picker or navigate to `models` |
| `app/ai-access/manage.tsx` | Show provider + selected model display name |
| Query keys | `['ai-access']`, `['ai-models', provider]`; invalidate both after PATCH |

#### H. Tests (minimum)

- Catalog validator: >5 entries fails; 0 defaults fails; two defaults fails.
- Resolver: unset preference → default; retired id → default + notice; managed user cannot resolve `managedVisible:false` frontier id.
- Each provider adapter: generate + structured with each V1 catalog `vendorModelId` (contract suite; mock HTTP).
- BYOK probe: model unavailable does not invalidate credential; no callable model → 409.
- Gemini: assert no API key in query string on any request.
- Regression: Worker boot fails closed if catalog invalid in production.

#### I. Implementation file checklist

| Path | Action |
|---|---|
| `backend/src/ai/model-catalog.ts` | **Add** — entries + specialty map + validator |
| `backend/src/ai/model-resolver.ts` | **Add** — algorithm in §B |
| `backend/src/ai/openai-provider.ts` | **Add** — portable OpenAI chat adapter |
| `backend/src/ai/claude-provider.ts` | **Update** — remove stale default; accept resolved model |
| `backend/src/ai/gemini-provider.ts` | **Update** — replace shut-down default; header auth |
| `backend/src/ai/provider-factory.ts` | **Add** — sole construction site |
| `backend/src/services/ai-provider-resolver.ts` | **Add/extend** — entitlement + model resolve |
| `backend/src/routes/ai-models.ts` / preferences routes | **Add** |
| `backend/lambda-processor/model_catalog.py` | **Add** — lockstep vendor map |
| `backend/lambda-processor/providers/*.py` | **Add** — OpenAI/Anthropic/Gemini adapters |
| `src/api/aiAccess.ts`, `app/ai-access/models.tsx` | **Add** |

**Per-credential model availability (BYOK).** A valid key does not guarantee access to every catalog model: OpenAI gates some models behind organization verification and usage tier, Anthropic gates context/throughput by tier, and Gemini gates by key type/region. Therefore:

- validate the selected model against the *specific credential* (a cheap list/probe or guarded low-token call), not just against the global catalog;
- when the model is not callable by that key, return `MODEL_NOT_AVAILABLE_FOR_KEY` (§4.4) and fall back to the same-provider catalog default; do **not** mark the whole credential `invalid` (see §18.4);
- surface provider-specific repair copy (OpenAI: verify org / raise tier; Anthropic: raise usage tier for the needed context/throughput; Gemini: use an auth key).

**Deprecation handling.** Retired vendor model IDs hard-fail with **no silent reroute** (e.g., Anthropic `404 not_found_error`). Maintain the catalog proactively:

- honor provider notice periods (OpenAI ≥6 months GA / ~2 weeks preview; Anthropic ≥60 days; Gemini ≥2 weeks preview — published dates are earliest-possible);
- prefer pinned dated snapshots over floating aliases so output behavior is stable and migration is owned (open decision, §23);
- a scheduled job diffs in-use catalog IDs against provider deprecation tables and alerts when any in-use ID shows a retirement date inside ~90 days (add to the §8.4 scheduled-work list and §12 monitoring);
- repoint the catalog before a retirement date, not on it.

Validation includes:

- model exists in the catalog and is available to the credential (per-credential probe for BYOK, above);
- required input modality and tool/JSON behavior for the feature;
- context/output limits sufficient for the feature;
- pricing and token metadata mapping;
- fallback model remains within the same provider, credential source, and catalog.

### 19.6 Lambda portability

Refactor `backend/lambda-processor/handler.py`:

- remove the module-level Anthropic client;
- resolve provider/model per job;
- add Python adapters for OpenAI, Anthropic, and Gemini using the same report schemas;
- replace Claude-specific page/token constants with provider capability/config values;
- preserve PDF chunking, findings, summaries, plans, home-feature extraction, callbacks, and checkpoint formats;
- record provider/model/source in job state without recording credentials;
- contract-test each adapter against fixed report fixtures.

## 20. Three Provider Onboarding Flows

Use active Expo Router routes, for example:

```text
app/ai-access/index.tsx
app/ai-access/providers.tsx
app/ai-access/openai/*.tsx
app/ai-access/anthropic/*.tsx
app/ai-access/gemini/*.tsx
app/ai-access/models.tsx
app/ai-access/manage.tsx
```

All screens include progress, Back/Cancel, Help, privacy disclosure, dynamic type, VoiceOver order, iPad-safe width, and resumable non-secret progress. Never persist a partially entered key. The `models` screen lists the active provider's catalog (≤5 entries) and writes `selected_model_id` via `PATCH /ai-preferences`.

### 20.1 OpenAI flow

**Screen 1 — OpenAI API, not ChatGPT**

- Explain that ChatGPT Free/Plus/Pro does not include API usage.
- User needs an OpenAI Platform developer account.
- Show separate billing/cost warning.

**Screen 2 — Create a dedicated project**

- Guide user to OpenAI Platform.
- Create a project dedicated to SimpleHouse.
- Configure API billing/prepaid credits and a project budget/spend notification.
- App Review-approved external link only; otherwise show neutral instructions without a purchase CTA.

**Screen 3 — Create a restricted secret key**

- Create a new project API key.
- Use restricted permissions required by the configured SimpleHouse capabilities.
- Never reuse a key embedded in another app.
- Copy it once; SimpleHouse never needs the user's OpenAI password.

**Screen 4 — Paste and connect**

- Secure key field and acknowledgement.
- Send to backend; show “Checking API access.”
- Do not infer validity from a prefix.

**Screen 5 — Connected**

- Show `OpenAI`, masked hint, validation date, supported SimpleHouse capabilities, and direct-billing warning.
- Show the model picker: up to 5 catalog options for OpenAI; default pre-selected; changing selection calls `PATCH /ai-preferences`.
- Actions: Use this provider, Choose model, Replace key, Disconnect, Open provider usage dashboard.

### 20.2 Anthropic Claude flow

**Screen 1 — Claude API, not Claude Pro/Max**

- Explain that Claude consumer plans do not supply an API key for SimpleHouse.
- User needs an Anthropic Console account/workspace with API access.

**Screen 2 — Configure Console billing**

- Create/select a dedicated workspace.
- Add API billing/credits and configure provider-side spend controls where available.
- Explain that Claude Code subscription OAuth/session tokens are not accepted.

**Screen 3 — Create an API key**

- Create a key in the dedicated workspace's API Keys settings.
- Copy the key; never enter Claude account credentials in SimpleHouse.

**Screen 4 — Paste and connect**

- Secure key field, disclosure, backend validation.
- Validate configured model and Messages API access.

**Screen 5 — Connected**

- Show `Claude`, masked hint, validation date, supported capabilities, and direct-billing warning.
- Show the model picker: up to 5 catalog options for Anthropic; default pre-selected; changing selection calls `PATCH /ai-preferences`.
- Actions: Use, Choose model, Replace, Disconnect, Open Console usage.

### 20.3 Google Gemini flow

**Screen 1 — Gemini API, not Google AI Pro**

- Explain that Gemini Advanced/Google AI Pro does not pay for Gemini API usage.
- User needs a Google AI Studio/Google Cloud project and Gemini API key.

**Screen 2 — Project and billing**

- Create/select a project in Google AI Studio.
- Free API tier may work with strict limits; paid tier requires separate Cloud Billing/prepay/postpay setup.
- Recommend budget alerts/spend controls.

**Screen 3 — Create a secured key**

- Recommend creating an **auth key** (service-account-bound; AI Studio's "Create API key" now defaults toward auth keys) as the primary, future-proof path.
- Explain that unrestricted standard keys are already rejected (June 19 2026), and that **all standard keys — even Gemini-API-restricted ones — stop working at the September 2026 hard cutoff**; a restricted standard key is a temporary fallback only.
- Because an auth key binds to a Google Cloud service-account identity, the privacy disclosure must describe what the user is connecting (open item, §23).
- Do not use a key shared with unrelated Google services.

**Screen 4 — Paste and connect**

- Secure key field, disclosure, backend validation.
- Validate configured model and required Generative Language API access.

**Screen 5 — Connected**

- Show `Gemini`, masked hint, validation date, supported capabilities, and direct-billing warning.
- Show the model picker: up to 5 catalog options for Gemini; default pre-selected; changing selection calls `PATCH /ai-preferences`.
- Actions: Use, Choose model, Replace, Disconnect, Open AI Studio usage.

### 20.4 Repair and disconnect

Provider call failures map to actionable UI:

- invalid/revoked → Replace key;
- permission/model unavailable → Update key permissions or choose another provider;
- quota/billing exhausted → Open provider usage/billing guidance or choose Apple subscription;
- rate limited → retry later, no credential deletion;
- provider outage → status message and bounded retry;
- unsupported capability → choose a capable provider or SimpleHouse subscription.

Disconnect confirmation states that SimpleHouse deletes its encrypted copy but cannot revoke the provider key. Offer a provider-console link to revoke it.

## 21. BYOK API Contract

Authenticated endpoints:

- `GET /ai-access` — server-computed access source, selected provider, selected model, available models (≤5), capabilities, and denial reason;
- `GET /ai-credentials` — metadata only;
- `POST /ai-credentials/:provider` — validate and encrypted-upsert a key;
- `POST /ai-credentials/:provider/validate` — revalidate stored key;
- `DELETE /ai-credentials/:provider` — delete ciphertext and update preferences;
- `GET /ai-models?provider=:provider` — catalog for one provider (returns ≤5 entries; the ≤5 ceiling is enforced on the server catalog config and asserted here; registry keys, display names, profile labels, capabilities, default flag); never returns vendor secrets;
- `PATCH /ai-preferences` — select source/provider/`selected_model_id`/fallback consent. The payload carries a single `selected_model_id`; reject an unknown id or an id belonging to a different provider. (The ≤5-per-provider ceiling is a property of the catalog config and `GET /ai-models`, not of this payload.)

Internal Lambda endpoint:

- `POST /internal/ai-credential-leases/consume` — dedicated integration authentication plus one-time lease; never mounted under public user auth and never returns a credential twice.

Responses must never include ciphertext, IV, raw provider payloads, or keys. Key submission uses `Cache-Control: no-store`, strict body-size limits, schema validation, user rate limits, and redacted errors.

`GET /ai-access` becomes the mobile source of truth:

```ts
interface AIModelOption {
  id: string; // registry key, e.g. 'openai.<current-model>' (verified current ID, not a placeholder)
  display_name: string;
  profile_label: 'balanced' | 'fast' | 'quality' | string | null;
  capabilities: AICapability[];
  is_default: boolean;
}

interface AIAccessResponse {
  can_use_ai: boolean;
  source: 'simplehouse' | 'byok' | null;
  provider: 'openai' | 'anthropic' | 'gemini' | null;
  selected_model_id: string | null;
  available_models: AIModelOption[]; // length 0–5 for the active provider
  denial_reason: string | null;
  subscription: { is_paid: boolean };
  byok: {
    enabled: boolean;
    connections: Array<{
      provider: AIProviderId;
      status: 'active' | 'invalid' | 'degraded';
      key_hint: string;
      last_validated_at: string | null;
      capabilities: AICapability[];
    }>;
  };
}
```

## 22. BYOK Verification and Risks

### Security tests

- encryption round trip and AAD mismatch failure;
- unique IV per write;
- wrong key version/secret fails closed;
- V1→V2 lazy re-encryption;
- cross-user/provider ciphertext substitution fails;
- API never returns key/ciphertext/IV;
- logs and analytics contain no submitted key or provider response headers;
- key state clears on mobile background/logout/navigation;
- duplicate save, replacement, disconnect, account deletion, and concurrent rotation are safe;
- one-time Lambda lease is job/user/provider-bound, expiring, atomic, and replay-proof.
- Gemini unrestricted/blocked-key rejection maps to repair guidance; an accepted bounded request activates the key.

### Provider contract tests

For each portable worker and provider:

- text;
- schema-conforming structured output;
- single and multi-turn tool use;
- image input;
- PDF/document input;
- timeout, malformed output, auth, permission, quota, rate-limit, and provider-outage normalization;
- token/usage recording with `credential_source='byok'`;
- same-provider fallback only.

Provider-specific:

- OpenAI/Gemini embeddings preserve expected dimension/version contracts;
- OpenAI and supported Gemini image generation preserve garden output contracts;
- garbage and contractor search normalize provider citations through the common grounded-search contract;
- realtime voice appears only when a supported audio transport credential is available;
- BYOK Anthropic/Gemini text access cannot silently consume the SimpleHouse OpenAI realtime key;
- Claude unsupported capabilities reject before any billable request.
- Selecting each of the ≤5 catalog models per provider routes to the mapped vendor model ID; unknown/`selected_model_id` for the wrong provider is rejected; retired models fall back to the provider default with a notice.

Model-catalog and selection:

- catalog config validation rejects a provider configured with more than 5 entries (ceiling invariant), and requires exactly one `default` per provider;
- a BYOK key that cannot call the selected model but can call the same-provider default: the resolver substitutes the default, execution proceeds (`allowed: true`) with a one-time notice, and the credential stays `active` (not `invalid`);
- a BYOK key that cannot call any same-provider catalog model: returns the terminal `MODEL_NOT_AVAILABLE_FOR_KEY` (`409`) with repair guidance, still without marking the credential `invalid`;
- a model retired between lease mint and Lambda consume/resume is re-resolved to the provider default at consume (not used from the stale lease);
- disclosure fires when the specialty model or realtime transport used differs from the user's selected model;
- `PATCH /ai-preferences` success invalidates the `ai-access` query so the selected model/available models refresh.

### Product/App Store risks

| Risk | Required mitigation |
|---|---|
| Apple treats BYOK as an external unlock/license key | Phase 0 App Review/legal decision; remote kill switch; subscription-only fallback |
| In-app provider billing links violate storefront rules | Region/storefront configuration; no unapproved CTA |
| User pastes a consumer token/session cookie | Accept only documented API-key flow; reject OAuth/session credentials |
| Key compromise creates user charges | encryption, no client persistence, restricted/dedicated keys, provider spend limits, immediate disconnect guidance |
| BYOK key lacks a feature capability | capability preflight and clear provider selection |
| Provider changes models/APIs | server-controlled model catalog (≤5 per provider), capability probes, provider kill switches |
| Async job runs after key revocation | resolve/decrypt at execution, not enqueue |
| Lambda leaks key in event/log/checkpoint | one-time credential lease and log-redaction tests |
| Silent fallback charges SimpleHouse or user unexpectedly | explicit source/fallback consent; no cross-source fallback by default |
| A member's BYOK key processes other members' shared household data at a third-party provider | household-level disclosure, per-tool context allowlist (§19.1), consent model resolved in §23 decision #4 (§17.5) |

### BYOK rollout gate

Do not enable `bringYourOwnAIEnabled` until:

- App Store strategy is approved;
- all credential-security tests pass;
- all portable-worker three-provider contract tests pass;
- capability-specific UX is complete;
- privacy policy and account deletion cover stored API credentials;
- cross-member data disclosure/consent model (§17.5, §23 decision #4) is resolved and implemented, and every AI feature declares a per-tool context allowlist (§19.1);
- incident runbook covers key exposure and mass credential rotation;
- provider setup instructions are reviewed against current official documentation.

## 23. Open Product/Legal Decisions

These are decisions the plan cannot resolve technically; each must be answered in Phase 0 before the dependent work ships.

| # | Decision | Owner | Blocks | Default in this plan |
|---|---|---|---|---|
| 1 | BYOK under Apple Guideline 3.1.1 — is a user-pasted provider API key an “external unlock mechanism”? Whether provider setup/billing links may appear per storefront (US External Purchase Link entitlement differs by region). | Product + Legal + App Review | `bringYourOwnAIEnabled=true` | Deferred; subscription-only fallback if rejected |
| 2 | Grace-period AI policy — do paying users mid billing-grace keep AI (RevenueCat-natural) or lose it (strict)? Drives `paidBillingStates` in §4.1. | Product | Phase 4 sync semantics, §11 truth table | Strict (`{normal}` only) |
| 3 | RevenueCat restore behavior — “Transfer to new App User ID” (recommended default) vs “Keep with original.” Owns the reinstall/account-recovery support path. | Product + Support | §6.1, §6.4 transfer handling | Recommend Transfer; confirm |
| 4 | Cross-member BYOK consent — is household-admin consent / per-member opt-out required when one member’s key processes shared household data? (§17.5) | Product + Legal | `bringYourOwnAIEnabled=true` | Household-level disclosure required; consent model TBD |
| 5 | Managed Mira voice funding — will SimpleHouse fund/disclose a paid OpenAI realtime transport, and confirm Anthropic/Gemini BYOK text users never consume the SimpleHouse OpenAI realtime key? (§19.4) | Product | Phase 7 voice gating | Voice hidden unless OpenAI transport credential present |
| 6 | Gemini auth-key = service-account identity — onboarding/privacy copy must describe what the user connects. (§20.3) | Legal | Phase 8 Gemini flow | Disclosure copy TBD |
| 7 | Managed-plan model ceiling — does the SimpleHouse-paid catalog expose frontier/expensive models, or cap managed users at economy/balanced tiers for margin control? (§19.5) | Product + Finance | Phase 7 catalog config | Managed defaults to economy tier; frontier BYOK/opt-in |
| 8 | BYOK model-access-gap UX — when a key can't reach the selected model, hide at selection via probe, fail at execution with guidance, or fall back to default? (§19.5, §4.4) | Product | Phase 7–8 | Fall back to default + `MODEL_NOT_AVAILABLE_FOR_KEY` guidance |
| 9 | Catalog snapshot-vs-alias policy — map registry keys to pinned dated snapshots (stable, owned migration) or floating aliases (fewer migrations, silent drift)? (§19.5) | Eng | Phase 7 catalog config | Pinned snapshots |
| 10 | Sticky per-provider model selection — persist one selection per provider or reset to default on provider switch? Changes preferences JSON shape. (§19.5) | Product | Phase 7–8 | Reset to default on switch |

## Revision History

| Version | Date | Summary |
|---|---|---|
| v2.11 | 2026-07-13 | **BYOK coverage gap-closure across the full AI surface.** Wired the remaining ~15 managed-only AI services to the acting user's key via `resolveProviderApiKey` / `createTrackedAnthropicForUser` (bill/property-tax/BC-assessment/registered-statement/grocery-receipt extraction, floor-plan analysis+vectorization [now fully threaded: route → FloorPlanService → FloorPlanRegionPipeline → services], task-draft, maintenance-suggestion, quote, savings-import, visit-checklist, family chat + chat-room, pdf-processing). Background/async now resolve the initiating user (task-enrichment) or household owner (proactive Mira + briefing cron). Net: real AI inference call sites went 9→25 BYOK-wired; the 3 remaining matches are non-inference (usage-reporting route + two managed-key existence guards). **Model selection:** added `resolveSelectedModelForProvider` helper; honored on explicit model-resolution paths (reports/lease). Speed/quality-tuned features (Mira nudge=Haiku, briefings=Sonnet) intentionally keep their models — not overridden. **Mobile:** new "Manage AI providers" screen (list / re-validate / disconnect / connect-another) + `listConnections`/`validateConnection`/`deleteConnection` API methods + `useAIEntitlement.byokConnections` + entry point on the Unlock screen + test. **Per-key model enforcement (`callableRegistryKeys`)** intentionally deferred — needs per-key capability probing/storage; the curated catalog is verified available to real keys, so "assume available" is safe. Central typecheck clean; 258 backend + 20 mobile tests pass; Worker redeployed both envs; post-deploy BYOK E2E re-verified. |
| v2.10 | 2026-07-13 | **Real-key BYOK verification (all 3 providers) + retired-model/auth fixes.** Verified end-to-end on staging with the user's own OpenAI, Anthropic, and Gemini keys: live probe + distinct-key encrypt→store→decrypt + interactive inference (Mira chat 200 / voice-session 200 / contractor-search 200). Catalog-model availability confirmed against the live provider APIs: OpenAI 3/3, Anthropic 4/4, Gemini 4/4 (transient 404s were free-tier rate-limits). Fixed retired hardcoded models: `gemini-2.0-flash*`→`gemini-3.5-flash` (contractor-search, chat-service, gemini-service), `claude-sonnet-4-20250514`→`claude-sonnet-4-5-20250929` (visit-checklists). Converted Gemini calls from `?key=` query-param to `x-goog-api-key` header (contractor-search, chat-service) — fixes the newer `AQ.A…` key format AND the §7.1 key-in-URL security debt. Deployed Worker to both envs. **Resolved:** the managed `GEMINI_API_KEY` was INVALID on staging AND production; rotated a valid key onto both Workers (`wrangler secret put`) + both report-processor Lambdas (merge-update, other env vars preserved) and verified managed Gemini works (contractor-search HTTP 200 for a no-BYOK user). `claude-sonnet-4-5-20250929` (used by ~11 services) is still live/valid — left as-is (optional modernization to `claude-sonnet-5`). |
| v2.9 | 2026-07-13 | **Deployed + verified E2E; fixed a blocking KEK misconfig.** Provisioned `AI_CREDENTIAL_LEASE_SECRET` (Keychain `symply.ai.lease-secret`) on both Workers + both report-processor Lambdas; deployed Worker (`deploy:all`) and Lambda (`deploy-staging`/`deploy-prod`). Headless end-to-end test against staging surfaced that `AI_CREDENTIAL_KEK_V1` was set to an invalid value ("must be a base64-encoded 32-byte key"), which had made **all** BYOK credential storage fail with a 500 — the feature was non-functional. Both credential tables were empty (no data loss), so provisioned a valid 32-byte base64 KEK (Keychain `symply.ai.kek`) on both Workers. Re-verified end-to-end on staging: attach → live Anthropic probe (`status=active`), `/ai-access` shows the connection, interactive Mira chat resolves the stored key (`last_used_at` goes null→timestamp; `ai_usage_events` logs a real `claude` call), and lease consume decrypts the stored credential. All test data cleaned up. |
| v2.8 | 2026-07-13 | **BYOK inference wiring (as-built).** Closed the gap where a connected BYOK key was stored/validated but never used for execution. Added `backend/src/services/ai-credential-resolver.ts` — the single choke point that turns an authenticated `userId` into `{provider, apiKey, vendorModelId, source}` (managed env key vs decrypted BYOK key), plus `resolveProviderApiKey` (per-provider key for SDK-bound sites), `createTrackedAnthropicForUser`, and `issueCredentialLease` (§18.5 lease issuer — previously missing, so the consume endpoint was dead). Wired interactive surfaces to the acting user's key: Mira chat, AI-housekeeper analysis/seasonal checklist, visit-checklist chat, contractor AI lookup, contractor-search (Gemini), garbage-schedule detect, budget suggestions/insights/doc-extract. Report Lambda path now mints a job-bound lease and passes `leaseToken`; the Python processor exchanges it at `/internal/ai-credential-leases/consume` (fail-safe to managed; requires `SIMPLEHOUSE_API_BASE` + `AI_CREDENTIAL_LEASE_SECRET` in the Lambda env). Also fixed `last_used_at` stamping. Ecosystem exposure: `app/ai-access/*` screens made brand-neutral (`brand.displayName` + theme, dark-mode-correct) with a §17.4 cost/privacy acknowledgement gate before a key is saved; Profile entry gated on `aiFeaturesEnabled`; Symply Language (donor `/api/v1` backend, no AI endpoints) hard-disables AI/BYOK/subscription flags so it no longer advertises a dead flow; Symply Health's Settings row now opens the connect flow. Still managed-only (documented): the Mira memory/embedding stack, cron/scheduled background AI, OpenAI realtime voice transport, and batch-resume (multi-invocation) reports. |
| v2.7 | 2026-07-10 | Provider live-check + detailed model-catalog implementation: verified OpenAI/Anthropic/Gemini IDs (removed invented `gemini-3.1-flash`); documented shut-down `gemini-2.0-flash` and stale Claude default as Phase 7 debt; added §19.5.1 (config schema, resolution algorithm, per-provider adapter table, BYOK probes, specialty map, API/mobile/file/test checklists); expanded Phase 7 tasks. |
| v2.6 | 2026-07-10 | Expanded per-provider model selection: added §4.2.1 product rule; replaced the sparse §19.5 placeholder table with illustrative ≤5-option catalogs for OpenAI, Anthropic, and Gemini (registry keys, vendor IDs, profile labels, defaults, managed vs BYOK visibility); documented picker UX and catalog config validation (≤5, exactly one default). |
| v2.5 | 2026-07-10 | Cycle 2 delta fixes: reconciled `MODEL_NOT_AVAILABLE_FOR_KEY` semantics — non-blocking model substitution (`allowed: true` + notice) in the normal path, terminal `409` only when no same-provider model is callable (§4.4, §9, §22); defined `AIDenialReason` as mirroring §4.4 (§9); reframed the `ai_credential_leases.selected_model_id` column as a non-authoritative hint re-resolved at consume, and added it to the §18.5 step-3 lease bindings; replaced the stale `openai.gpt-4.1` example in the §21 `AIModelOption` comment. |
| v2.4 | 2026-07-10 | Model-selection review-cycle fixes: flagged all example model IDs as placeholders and named current 2026 families (`gpt-5.6-*`, `claude-opus-4-8`/`sonnet-5`/`haiku-4-5`, `gemini-3.5-flash`/`3.1-pro`) with verify-before-use (§19.5); added `MODEL_NOT_AVAILABLE_FOR_KEY` denial reason for BYOK per-key model-access gaps with same-provider-default fallback (§4.4, §18.4, §19.5); required Lambda lease consume/resume to re-resolve `selected_model_id` against the live catalog (§18.5); carved out the OpenAI realtime transport as the known cross-provider exception (§19.5); required `PATCH /ai-preferences` to invalidate the `ai-access` query (§9); reworded §21 PATCH (submits a single id, ≤5 is a catalog property); added deprecation-monitoring scheduled job + notice periods + hard-fail-no-reroute (§8.4, §12, §19.5); reworded the §19.4 matrix header to model-level; added managed cost-tier default and open decisions #7–#10 (managed ceiling, access-gap UX, snapshot-vs-alias, sticky selection) in §23; added catalog/model tests + DoD lines (§22, §15); fixed §3 garden `userId` line ref to `:174`. |
| v2.3 | 2026-07-10 | Per-provider model selection: replace `model_profile` as the primary selector with a server-controlled catalog of up to 5 models per provider; persist `selected_model_id`; add `GET /ai-models`, model picker UX (`app/ai-access/models.tsx`), Connected-screen pickers, `useAIEntitlement`/`AIAccessResponse` fields, Phase 7–8 tasks, and verification/DoD coverage. Specialty modalities may use fixed same-provider models outside the user-facing 5 when required. |
| v2.2 | 2026-07-10 | Cycle 2 delta-review fixes: resolved Phase 6 vs §18.2 "envelope encryption" terminology contradiction; wired the §17.5 per-tool context allowlist into the §19.1 resolver (was a dangling ref); updated the §11 truth table to evaluate the explicit `billing_state`/`paidBillingStates` field instead of the old `active|trialing` inference; harmonized the two §4.1 `isPaid` blocks into one formula; echoed §7.1 phase assignments into the Phase 1/3/6/7 bodies; added the cross-member BYOK risk row and rollout-gate items to §22; added `billing_state` to the mobile `isPaid` inputs. |
| v2.1 | 2026-07-10 | Cycle 1 multi-agent review fixes: corrected `src/App.tsx` is absent (not inactive) and `/ai/chat/stream` is auth-dead-not-anonymous; fixed inverted Phase 0/Phase 5 binary-submission ordering; assigned §7.1 security-debt items (committed-key rotation, log scrubber, JWT_SECRET fallback, Gemini-key-in-URL) to owning phases; fixed webhook idempotency ledger-vs-sync ordering (§6.4); added cross-member BYOK PII/consent + context-allowlist requirement (§17.5); documented Lambda-side lease/callback secret provisioning + rotation (§18.5); made `processing_jobs` actor columns nullable to avoid NOT NULL migration failure (§7); added explicit `billing_state` field for grace/paused (§4.1, §7); added `NO_PROVIDER_AVAILABLE` denial reason for paid-but-no-provider-enabled (§4.4); required `RATE_LIMITER` DO for AI/BYOK rate limits (§8.1); mapped/reserved the `embeddings` capability (§19.4); added per-phase rollbacks for Phases 2/3/5/6/7/8; added Gemini September 2026 all-standard-keys cutoff and auth-key-primary guidance (§18.4, §19.3, §20.3); reconsidered RevenueCat restore-behavior default (§6.1); clarified AES-GCM+AAD is not "envelope encryption" (§18.2); added length-safe `timingSafeEqual` caveat (§18.5, §6.4); refreshed stale doc URLs (§16); added §23 open product/legal decisions; utilities re-extract is bill-only (§8.2); featureFlagStore line-anchor correction (§3). |
| v2.0 | 2026-07-10 | BYOK + Apple subscription plan, prior review cycles. |
