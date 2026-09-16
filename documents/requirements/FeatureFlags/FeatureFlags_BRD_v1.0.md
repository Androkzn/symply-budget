# Global Feature Flags — Business Requirements Document

| Field | Value |
|-------|-------|
| **Product** | SimpleHouse (iOS / Android — React Native + Expo) |
| **Feature Name** | Global Feature Flags — Remote Release & Kill-Switch System |
| **Status** | Draft |
| **Owner** | Engineering |
| **Version** | v1.0 |
| **Created** | 2026-06-22 |
| **Last Updated** | 2026-06-22 |
| **Author** | andrei@step.co |
| **Stakeholders** | Mobile Engineering, Backend Engineering, Product, QA/Release |

> **Document pipeline:** **BRD** → TRD → Implementation Plan. This BRD defines WHAT and WHY. It documents an **as-built** system already present in the codebase ([backend/src/services/featureFlagService.ts](../../../backend/src/services/featureFlagService.ts), [src/stores/featureFlagStore.ts](../../../src/stores/featureFlagStore.ts), and peers) and the product intent around it. Technical contracts (KV schema, exact request/response shapes, caching internals) belong in a follow-on TRD.

> **Scope note for readers.** "Feature flag" here means a **global, developer-controlled release switch** — "is this feature released to everyone?" It is **not** a per-user entitlement and **not** a paywall. Paid gating is owned separately by [SubscriptionContext](../../../src/contexts/SubscriptionContext.tsx).

---

## 0. Version History

| Version | Date | Author | Description of Changes |
|---------|------|--------|------------------------|
| v1.0 | 2026-06-22 | andrei@step.co | Initial BRD. Documents the as-built Global Feature Flags system (CONFIG_KV-backed remote config, public read endpoint, admin write endpoint, mobile resolver store + `useFeature` hook, tab-navigator gating). Captures product intent, scope, edge cases, rollout, and the deliberately-deferred Admin UI surface. |

---

## 1. Feature Overview

### 1.1 Summary

- **Feature Name:** Global Feature Flags
- **Status:** Draft (system is implemented; this document formalizes intent and acceptance criteria)
- **Objective:** Give the team a way to turn a shipped app surface **on or off for all users remotely, without an App Store / Play Store release**. This serves two needs: (1) a **kill switch** to instantly hide a feature that is broken, abusive, or legally/operationally risky in production; and (2) a **release switch** to ship code dark (default `false`) and reveal a finished feature when product is ready.
- **Stakeholders:** Mobile Engineering, Backend Engineering, Product, QA/Release.
- **Success Metrics (KPIs):**
  - **Time-to-disable** a misbehaving feature in production: **< 5 minutes** end-to-end (flip → all foregrounded clients hidden), versus days for an app-store hotfix.
  - **Zero accidental exposure:** a feature added with default `false` is never visible in production until explicitly flipped — measured by release-audit (0 incidents).
  - **No cold-start regression:** first render after app launch is never blocked on the flag network call (offline-safe defaults + cached values).
  - **Adoption:** every new user-facing top-level surface ships behind a flag (target: 100% of new surfaces from this BRD forward).

### 1.2 Scope & Dependencies

- **Type:** Integration / Platform capability (cross-cutting; not a single screen).
- **In Scope:**
  - A global flag registry shared by backend and mobile (one canonical key list).
  - Remote resolution: build-time defaults overlaid with remote overrides.
  - A **public** read path the app can call before login (auth / onboarding screens need flags too).
  - An **admin-authenticated** write path to flip flags.
  - A mobile resolver (store + hook + non-reactive read) used by screens and navigation guards.
  - Tab-level gating in the main navigator driven by flags.
  - Developer-only local overrides for testing (never persisted, never sent to backend).
- **Out of Scope (v1.0):**
  - **Per-user / per-cohort targeting** (percentage rollouts, A/B buckets, user allowlists). v1.0 is all-or-nothing, identical for every user.
  - **A self-serve Admin UI.** Writes are an authenticated API call only (e.g. via `curl`/script). A future Admin surface is described in §1.2 *Future Surfaces* and is explicitly deferred.
  - **Subscription / entitlement gating** — owned by [SubscriptionContext](../../../src/contexts/SubscriptionContext.tsx). A flag answers "is it released?"; a subscription answers "has this user paid?".
  - **Region gating logic** — the Utilities tab is additionally region-gated (Greater Vancouver) by separate logic in the navigator; the flag and the region check are independent gates.
  - **Audit log of who flipped what.** (Called out as a future surface; not built.)
- **Prerequisites (Upstream):**
  - Cloudflare Workers backend with a bound `CONFIG_KV` namespace (per-environment) — see [backend/wrangler.toml](../../../backend/wrangler.toml).
  - Mobile MMKV-backed async storage for caching flags across cold starts — see [src/services/storage](../../../src/services/storage).
  - `FEATURE_FLAGS_ADMIN_SECRET` configured as a Worker secret per environment before the write path can be used.
- **Impacts (Downstream):**
  - [MainTabNavigator](../../../src/navigation/MainTabNavigator.tsx) — tab visibility now respects flags (`gardening`, `reports`, `contractors`, `utilities`, …).
  - [app/_layout.tsx](../../../app/_layout.tsx) — startup and foreground refresh now trigger a flag fetch.
  - Any screen/surface placed behind `useFeature(...)` going forward.

**Future Surfaces (Conditional, Not Committed)** — modeled on the Step.co `Notification_Admin_BRD` pattern; listed so v1.0 does not foreclose them. None ships unless validated demand emerges, and each gets its own BRD when triggered:

| Surface | Triggering demand | Expected scope |
|---|---|---|
| Admin UI for flags | Non-engineers (Product/Support) need to flip flags without a script | A thin internal page over the existing `PUT /features`: list flags, toggle, show last-changed |
| Audit log | Compliance/incident review needs "who flipped what, when, why" | One row per write (actor, timestamp, key, before/after, reason); retention TBD |
| Percentage / cohort rollout | Product wants gradual exposure or A/B | Per-flag rollout %, deterministic per-user bucketing; a substantial extension, re-evaluated from scratch |

### 1.3 Assumptions & Constraints

- **Assumptions:**
  - The flag set is **small and developer-curated** (single-digit to low-double-digit keys), not user-authored.
  - The mobile **build-time default catalog** is the safe fallback and is kept in sync with the backend default catalog by code review.
  - Clients refresh flags on app launch and on return-to-foreground; near-real-time (seconds–minutes) propagation is acceptable. **No push/server-initiated invalidation** is required.
  - Dev builds point at the **staging** API (per [src/config/env.ts](../../../src/config/env.ts)); there is no separate client "dev" backend.
- **Constraints:**
  - **Platform:** React Native 0.81 + Expo 54; backend on Cloudflare Workers (Hono) + KV.
  - **Per-environment isolation:** staging and production have **separate** KV namespaces and secrets. A flip in staging does **not** affect production — every change must be applied to each environment intentionally (consistent with the project's "deploy backend to all environments" rule).
  - **Safe-by-default:** when KV is empty/unreachable or the network is down, resolution must fall back to build-time defaults; a feature must **never** be accidentally exposed by an error.
  - **Backward compatibility:** introducing the system must be behaviour-preserving — currently-shipped surfaces default to `true`.

### 1.4 Risks & Mitigation

| Risk Type | Description | Impact | Mitigation Strategy |
|-----------|-------------|--------|---------------------|
| Operational | A flag flipped in staging but forgotten in production (or vice-versa) | Feature appears/hidden in the wrong environment | Per-environment runbook; flip is two explicit calls; future Admin UI shows per-env state |
| Operational | Admin secret leaks or is committed | Anyone can flip production flags | Secret stored via `wrangler secret put`, never in code; write path **denies all** if secret is unset (safe default); JWT also required |
| Technical | Backend/KV unreachable at startup | App can't fetch flags | Cached last-known values (MMKV) + build-time defaults; UI never blocks on the fetch |
| Technical | Default catalog drifts between mobile and backend | A key honored on one side, ignored on the other | Both sides sanitize to a known key list and ignore unknowns; code-review checklist to keep the two catalogs in sync; (future) shared-source generation |
| Product | A flag is treated as a paywall | Paid features wrongly gated/exposed | BRD + code comments draw a hard line: flags = release state, SubscriptionContext = entitlement |
| Product | Stale edge cache delays a kill-switch | A broken feature stays visible up to ~60s longer | Read endpoint cache TTL kept short (60s); incident runbook notes the bound; cache TTL is a tunable, not a hard floor |
| Operational | No audit trail in v1.0 | Hard to reconstruct who disabled a feature during an incident | Accepted for v1.0; audit log listed as the first future surface |

### 1.5 Glossary

- **Feature flag (global):** A named boolean controlling whether an app surface is released to **all** users. Developer-controlled; not per-user.
- **Kill switch:** Using a flag to instantly hide a live, misbehaving feature without an app-store release.
- **Ship dark:** Merging/releasing a feature's code with its flag defaulting to `false`, so it is invisible until flipped on.
- **Build-time default:** The fallback value compiled into the app/backend, used when no remote override exists or the network/KV is unavailable. Safe fallback.
- **Remote override:** A value stored in `CONFIG_KV` that takes precedence over the build-time default.
- **Dev override:** A local-only flag value a developer sets on-device for testing; highest precedence, dev builds only, never persisted, never sent to the server.
- **Resolution order:** dev override → remote value → build-time default.
- **Entitlement / subscription:** Whether a *specific user* has paid for access — a separate concept owned by SubscriptionContext, not by flags.

---

## 2. Requirements & UX

> Flags are infrastructure: most "UX" is the **absence** of a surface when its flag is off, plus a developer-facing override tool. There is no end-user-facing flag UI in v1.0.

### 2.1 Functional Requirements (User Stories)

- **FR-1 — Ship a feature dark.** *As an engineer, I can release code for an unfinished feature with its flag defaulting to `false`, so that it stays hidden from all users until product is ready to reveal it.*
  - AC-1.1: **Given** a new flag key added with default `false` and no remote override, **when** any user opens the app in production, **then** the feature surface is not shown.
  - AC-1.2: **Given** the same flag, **when** an admin flips it to `true` remotely, **then** users see the feature on their next flag refresh (app launch or return-to-foreground) **without** installing an app update.

- **FR-2 — Kill a live feature.** *As an on-call engineer, I can disable a shipped feature for everyone remotely, so that a broken or risky surface is removed from production within minutes instead of waiting for an app-store hotfix.*
  - AC-2.1: **Given** a feature currently visible (flag `true`), **when** an admin sets it to `false`, **then** within one refresh cycle (≤ the read cache TTL + next foreground) the surface disappears for all users.
  - AC-2.2: **Given** the flip happened, **when** a brand-new user installs and launches the app, **then** they never see the disabled feature (the remote override wins over the build-time default).

- **FR-3 — Gate top-level navigation.** *As a user, I only see tabs/surfaces for features that are currently released, so that I never encounter a tab that opens a broken or unreleased experience.*
  - AC-3.1: **Given** the `gardening` flag is `false`, **when** the main tab bar renders, **then** the Gardening tab is absent.
  - AC-3.2: **Given** a flag flips while the app is open, **when** the next foreground refresh resolves new values, **then** the tab bar re-renders to add/remove the affected tab without an app restart.
  - AC-3.3: The flag gate is a **global override that wins over the user's own tab customization** — a flag-off feature is hidden even if the user had pinned/enabled that tab. (Independent secondary gates, e.g. the Utilities region check, still also apply.)

- **FR-4 — Resolve flags safely at cold start.** *As a user on a poor or no connection, I can open the app and see a correct, stable set of features, so that flag infrastructure never degrades my launch experience.*
  - AC-4.1: **Given** the device is offline at launch, **when** the app starts, **then** it resolves flags from the last cached values, or from build-time defaults if nothing is cached — and the first render is **not blocked** on the network call.
  - AC-4.2: **Given** the flag fetch fails, **when** resolution runs, **then** previously cached values and defaults are retained (the failure does not clear or corrupt state).

- **FR-5 — Read flags from product code uniformly.** *As an engineer, I have one reactive way (`useFeature`) and one non-reactive way (`isFeatureEnabled`) to read a flag, so that screens re-render on change and services/navigation guards can read flags without hooks — and no call site touches transport/KV directly.*
  - AC-5.1: **Given** a component calls the reactive read, **when** the resolved value changes, **then** the component re-renders with the new value.
  - AC-5.2: **Given** non-React code (a guard, a service), **when** it needs a flag, **then** it can read the current resolved value synchronously without a hook.

- **FR-6 — Override flags locally for development.** *As an engineer in a dev build, I can force a flag on/off on my device, so that I can test an unreleased or disabled feature without changing the remote config that affects others.*
  - AC-6.1: **Given** a dev build, **when** I set a dev override, **then** it takes precedence over the remote value and the default for that key on my device only.
  - AC-6.2: **Given** a production build, **when** any dev-override path is invoked, **then** it has no effect (overrides are dev-only and are never persisted or transmitted).

- **FR-7 — Protect the write path.** *As the platform owner, only authorized callers can change flags, so that flag state cannot be altered by end users or unauthenticated requests.*
  - AC-7.1: **Given** the admin secret is **not** configured for an environment, **when** any write is attempted, **then** it is rejected (fail-closed).
  - AC-7.2: **Given** a write request without a valid auth token **or** without the correct admin secret, **then** it is rejected; **only** requests with both succeed.
  - AC-7.3: **Given** a write with an unknown or non-boolean key, **when** it is processed, **then** only known boolean keys are applied and everything else is ignored (no crash, no junk persisted).

### 2.2 User Experience (UX) & Design

- **Design Assets:** None required for v1.0 (no end-user UI). A future Admin UI would need design — out of scope here.
- **End-user flow:** Invisible by design. The only user-observable effect is whether a tab/surface is present. There is no flag toggle, banner, or setting exposed to end users.
- **Developer flow (dev overrides):** Reached through the existing developer/debug affordance in a dev build; setting an override updates the on-device resolution immediately. Overrides clear on demand and never leave the device.
- **Existing reference / pattern to match:** The store follows the project's established Zustand + persist + immer pattern (see other stores in [src/stores/](../../../src/stores/)) and is consumed exactly like other state — screens use a hook, never the store internals.
- **Copy/Content:** N/A for end users. Admin/runbook copy (e.g., the request body shape and required headers) lives in the operations runbook (§4) and the follow-on TRD.

### 2.3 Non-Functional Requirements

- **Performance:**
  - First render after launch must **not** await the flag network call (resolve from cache/defaults synchronously; fetch in the background).
  - Read endpoint is edge-cacheable with a short TTL (target **60s**) so the kill-switch fast path is cheap and globally fast.
  - A flag read in product code is an in-memory lookup (O(1)); no per-read I/O.
- **Security:**
  - Read path is **intentionally public/unauthenticated** (needed before login on auth/onboarding); it exposes only non-sensitive release booleans.
  - Write path requires **both** a valid auth token **and** a shared admin secret; **fail-closed** when the secret is unset.
  - No PII in flag config; flags are global booleans only.
  - Per-environment secrets and KV — no cross-environment bleed.
- **Internationalization:** N/A (no user-facing copy in v1.0).
- **Accessibility:** N/A directly (no new user-facing UI). Note: a feature hidden by a flag must hide **completely** — no empty/disabled affordance, no dead tab — so assistive tech never announces an unavailable surface.
- **Reliability:** KV/network failure degrades to last-known-good + defaults; never to "feature accidentally on/off due to error."

### 2.4 Edge Cases

Every case below states the explicit user-facing outcome.

- **KV empty (fresh environment):** Read returns build-time defaults. **Outcome:** app behaves exactly as a build with no remote config — currently-shipped surfaces visible, dark features hidden.
- **KV / backend unreachable at startup:** **Outcome:** app uses cached values from the last successful fetch; if none, build-time defaults. App launches normally; a background retry occurs on next trigger.
- **Network failure during refresh (app already open):** **Outcome:** last resolved values stay in effect; no flicker, no surface flips due to the failure.
- **Malformed / partial remote payload (unknown keys, non-boolean values):** **Outcome:** only known boolean keys are honored; unknown/invalid entries are dropped silently; missing keys fall through to defaults. No crash.
- **Default-catalog drift (key exists on one side only):** **Outcome:** a key the client doesn't know is ignored client-side; a key the backend doesn't know falls through to the client default. No error surfaced to the user. (Mitigation: keep catalogs in sync — see §1.4.)
- **Stale edge cache after a kill-switch flip:** **Outcome:** the disabled feature may remain visible for up to the cache TTL (~60s) plus the client's next refresh; this is the documented worst-case propagation bound.
- **Production build hits a dev-override path:** **Outcome:** no effect; production never honors dev overrides.
- **Admin secret unset in an environment:** **Outcome:** all writes rejected; flags can only be read, not changed, until the secret is configured. (Prevents an unprotected write path.)
- **Secondary gate conflict (flag on but region/customization off):** **Outcome:** the feature is hidden if **any** applicable gate says hide — flag gate and region/customization gates are AND-ed, not OR-ed. (E.g., Utilities requires both `utilities=true` **and** the household being in the supported region.)
- **Flag flips between the cache-read render and the network-fetch render at startup:** **Outcome:** the app shows cached/default values first, then re-renders to the freshly fetched values when the background fetch completes — a deliberate two-phase resolution, not a bug.

### 2.5 Acceptance Criteria (Overall)

The feature is DONE only when:
- [ ] All FR-1…FR-7 user stories pass their individual AC.
- [ ] Resolution order (dev → remote → default) holds in unit tests, including the offline and malformed-payload paths.
- [ ] A feature added with default `false` is provably hidden in production until flipped (release-audit walkthrough).
- [ ] A kill-switch flip hides a live surface for all foregrounded clients within the documented propagation bound.
- [ ] The write path is fail-closed (no secret → denied) and requires both auth + secret.
- [ ] Mobile and backend default catalogs contain the **same key set** (verified by review/test).
- [ ] First render at launch is never blocked on the flag fetch (verified on a throttled/offline device).
- [ ] No regression: with KV empty, app behaves identically to pre-flag builds.

---

## 3. Technical Documentation (High-Level)

> Deep contracts (exact KV record shape, request/response schemas, cache headers, versioning semantics) belong in the TRD. This is the product-sign-off picture.

### 3.1 Architecture & Integration

- **Backend (Cloudflare Workers + Hono):** A `featureFlagService` resolves *effective flags = build-time defaults ⊕ remote overrides stored in `CONFIG_KV`*. A `features` router exposes a **public read** and an **admin write**, mounted at `/features`. Writes shallow-merge a partial map of known boolean keys into KV and bump a monotonically increasing version.
- **Mobile (React Native):** A Zustand store holds `remoteFlags` (persisted to MMKV for offline cold start), dev-only `devOverrides` (not persisted), a `version`, and fetch status. A pure resolver applies dev → remote → default. Product code reads via a reactive hook (`useFeature`) or a non-reactive function (`isFeatureEnabled`) — never the store internals or transport.
- **App shell integration:** On startup the app rehydrates cached flags **then** fetches fresh ones in the background; it also refetches on return-to-foreground. The main tab navigator subscribes to the store and gates each tab by its mapped flag, with the flag gate overriding user tab customization.
- **Integration touchpoints:** App bootstrap ([app/_layout.tsx](../../../app/_layout.tsx)), navigation ([MainTabNavigator](../../../src/navigation/MainTabNavigator.tsx)), storage (MMKV async storage), shared HTTP client ([src/api/](../../../src/api/)). No analytics or notifications integration in v1.0.

### 3.2 Data Requirements

- **Stored data (backend):** One KV record holding the override map (known boolean keys only), a version integer, and a last-updated timestamp. Global scope — **not** user-scoped.
- **Stored data (mobile):** Cached `remoteFlags` + `version` + `lastFetchedAt` in MMKV (dev overrides deliberately excluded from persistence).
- **Retention:** Indefinite (config, not user data); a single overwriteable record. No PII.
- **Catalog source of truth:** A small, curated key list duplicated on backend and mobile; both sides ignore unknown keys. Keeping the two in sync is a review responsibility (candidate for shared-source generation in the TRD).

### 3.3 API Requirements

- **Read:** A **public** `GET /features` returning the effective flag map + version + updatedAt, short-TTL edge-cached. No auth (must work pre-login).
- **Write:** An **admin** `PUT /features` accepting a partial `{ key: boolean }` map; requires a valid auth token **and** the admin-secret header; fail-closed if the secret env var is unset; validates and sanitizes the body to known boolean keys; returns the updated effective map + bumped version.
- **Real-time:** None. Propagation is pull-based (client refresh on launch/foreground) plus the short read-cache TTL. No subscriptions/websockets.

### 3.4 Testing Strategy

- **Unit (mobile):** Resolver precedence (dev/remote/default); offline fallback to cache then defaults; malformed-payload sanitization; dev overrides no-op in production; persistence excludes dev overrides.
- **Unit (backend):** `getFlags` merge semantics; `setFlags` shallow-merge + version bump + sanitize; empty/unreachable KV → defaults; unknown/non-boolean keys ignored. (A backend test file already exists at [backend/src/services/__tests__/featureFlagService.test.ts](../../../backend/src/services/__tests__/featureFlagService.test.ts).)
- **Integration:** Write (auth + secret) → read reflects change + version bump; write rejected when secret unset; read served from edge cache.
- **E2E / manual:** Flip a flag in staging → confirm tab appears/disappears on next foreground; airplane-mode launch resolves from cache/defaults without blocking first render.
- **Device testing:** iOS (primary). Android parity where the surface exists. Throttled-network and offline launch profiles.

---

## 4. Operations & Lifecycle

### 4.1 Task List (status of the as-built system)

- [x] Backend flag service (defaults ⊕ KV overrides, sanitize, versioned writes)
- [x] Public read endpoint + admin write endpoint, mounted at `/features`
- [x] Mobile catalog + resolver store (persisted remote flags, dev overrides)
- [x] `useFeature` hook + `isFeatureEnabled` non-reactive read
- [x] App-shell fetch on startup + foreground
- [x] Tab-navigator gating with flag-over-customization precedence
- [x] Backend unit test scaffold
- [x] Mobile unit tests for the resolver/offline/malformed paths ([__tests__/stores/featureFlagStore.test.ts](../../../__tests__/stores/featureFlagStore.test.ts) — 12 tests)
- [x] Catalog-sync guard between mobile and backend ([__tests__/config/featureCatalogSync.test.ts](../../../__tests__/config/featureCatalogSync.test.ts) — fails CI on drift)
- [ ] Configure `FEATURE_FLAGS_ADMIN_SECRET` in staging **and** production (ops — `wrangler secret put`)
- [ ] Operations runbook entry (flip procedure per environment)
- [ ] TRD for exact KV schema / API contract / cache semantics

### 4.2 Rollout Strategy

- **The flags ARE the rollout mechanism.** New surfaces ship behind their own flag (default `false`) and are revealed by flipping the flag per environment.
- **Convention:** currently-shipped surface → default `true`; brand-new/unfinished surface → default `false`.
- **Sequence to reveal a feature:** land code (flag `false`) → verify in dev/staging via dev override or staging flip → flip staging flag `true` → validate → flip production flag `true`.
- **Rollback trigger (for a revealed feature):** elevated crash/error rate on the new surface, a correctness/safety defect, or a product decision to pull back.
- **Rollback plan:** flip the offending flag back to `false` (per environment). No data migration; effect propagates within the documented bound. This is the system's primary incident control.
- **Rollback of the flag system itself:** with KV empty/defaults, behavior equals a pre-flag build; the read path is additive and the write path fail-closed, so the system is safe to leave in place.

### 4.3 Post-Release Monitoring

> v1.0 ships **without** dedicated flag analytics. The items below are the recommended watch-list and the gap to close (see §1.4 / future surfaces).

- **Metrics to watch:**
  - Read endpoint error rate / latency (it is on the app's startup path).
  - Read endpoint cache hit rate (cost + propagation behavior).
  - Per-environment current flag state (manual/audit until an Admin UI exists).
  - App crash-free rate on any **newly revealed** surface after a flip.
- **Alerts (recommended):**
  - Read endpoint error rate sustained high (startup dependency).
  - Write attempts rejected due to unset secret in a configured environment (misconfiguration signal).
- **Known gap:** no audit log of flips and no per-flag exposure analytics in v1.0. ⚠️ NEEDS PRODUCT DECISION on whether an audit log is required before broad operational use (see §1.2 future surfaces).

---

## 5. Execution Strategy (AI Instructions)

> The system is already implemented. This section governs **formalization and the deferred surfaces**, not a from-scratch build.

### 5.1 Workflow Order

1. **Layer 1 — TRD.** Author the TRD from this BRD: exact `CONFIG_KV` record schema, `GET`/`PUT /features` request/response/error contracts, cache headers/TTL, version semantics, and the catalog-sync mechanism. No further code until contracts are confirmed.
2. **Layer 2 — Close the gaps.** Mobile resolver unit tests (offline/malformed/precedence), catalog-sync guard, and the per-environment secret + runbook.
3. **Layer 3 — Future surfaces (only if triggered).** Admin UI and/or audit log — each behind its **own** BRD before implementation.

### 5.2 Context & Standards

| Standard | Canonical Source |
|----------|-----------------|
| Mobile stack | React Native 0.81 / Expo 54 / expo-router / Zustand (+persist, +immer) / MMKV |
| Backend stack | Cloudflare Workers (Hono) / D1 / KV / R2 — see [CLAUDE.md](../../../CLAUDE.md) |
| Flag read (UI) | `useFeature(key)` — reactive, the **only** read screens use |
| Flag read (non-UI) | `isFeatureEnabled(key)` — services, navigation guards |
| Resolution order | dev override (dev only) → remote → build-time default |
| Default convention | shipped surface → `true`; new/unfinished → `false` |
| Backend deploy | staging **and** production together (per project deployment rule) |
| Secrets | `wrangler secret put FEATURE_FLAGS_ADMIN_SECRET` per env; never in code |
| Entitlements (NOT flags) | [SubscriptionContext](../../../src/contexts/SubscriptionContext.tsx) |

---

## 6. AI Co-Pilot Guidance

**Prompt 1 — Create the TRD**
```
/create-trd documents/Requirenments/FeatureFlags/FeatureFlags_BRD_v1.0.md
Focus the TRD on: the exact CONFIG_KV record shape and key list; GET /features and
PUT /features request/response/error contracts; cache-control/TTL and propagation
semantics; version-bump rules; and how the mobile (src/config/features.ts) and
backend (featureFlagService DEFAULT_FLAGS) catalogs stay in sync.
```

**Prompt 2 — Close the test/sync gaps**
```
Act as a SimpleHouse engineer. From this BRD's §4.1 open items, add mobile unit tests
for the feature-flag resolver (precedence, offline fallback, malformed payload,
dev-override no-op in production) and a guard that fails CI if the mobile and backend
default flag catalogs diverge. Do not change resolution behavior.
```

**Prompt 3 — (Deferred) Admin UI BRD**
```
Only if triggered by validated demand: /create-brd for a thin internal Feature Flag
Admin UI over the existing PUT /features (list flags, toggle, last-changed, per-env
state). Model it on Step.co's Notification_Admin_BRD. Keep audit log as its own decision.
```
