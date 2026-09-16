/**
 * Feature flag catalog (mobile).
 *
 * Single source of truth for the set of global feature flags and their
 * build-time DEFAULT values. Defaults are the safe fallback used before the
 * remote config has loaded (cold start) or when the network is unavailable.
 *
 * These flags are a developer-controlled rollout switch — "is this feature
 * released?" — and are independent of subscription entitlements
 * (see @contexts/SubscriptionContext for paid gating).
 *
 * Keep this list in sync with the backend registry in
 * backend/src/services/featureFlagService.ts (DEFAULT_FLAGS).
 *
 * Convention: a currently-shipped surface defaults to `true`. A brand-new or
 * unfinished feature should be added with a default of `false`, so it stays
 * hidden app-wide until it is explicitly flipped on remotely.
 */
export const FEATURE_DEFAULTS = {
  // Core surfaces — always on.
  myHome: true,
  dashboard: true,
  settings: true,

  // Extended surfaces — shipped today, default on. Flip to false remotely (via
  // PUT /features) to hide app-wide without an App Store release.
  gardening: true,
  reports: true,
  tasks: true,
  contractors: true,
  utilities: true,
  // Mira / AI housekeeper — enabled (no active users; soft launch).
  aiHousekeeper: true,

  // Smart Task Assistant — fast voice/text capture + async AI enrichment, with
  // Tasks promoted to the main tab. New/unfinished surface → default off until
  // flipped on remotely.
  smartTaskAssistant: false,

  // Smart Project — describe a project and let AI draft it (migration 0166).
  // ON. Still gated per-household by `isSmartProjectAvailable`, which hides it
  // on local-first households: generation is Worker-side and would write a
  // project the device ledger can never read. See
  // documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md §12 Q4.
  smartProject: true,

  // AI access. Keep in sync with backend/src/services/featureFlagService.ts
  // (and backend-language/src/services/platformAi/flags.ts).
  //
  // `aiRequiresAccess` is the pricing switch: the app is free and complete
  // without AI; AI runs on an Apple subscription or the member's own provider
  // key. `false` is the soft-launch state only — managed AI stays open until the
  // App Store subscription products are live. The SERVER is authoritative here
  // (GET /ai-access decides `can_use_ai`); this value only shapes presentation
  // before the remote config lands.
  subscriptionsEnabled: true,
  bringYourOwnAIEnabled: true,
  aiFeaturesEnabled: true,
  aiRequiresAccess: false,
  openAIProviderEnabled: true,
  anthropicProviderEnabled: true,
  geminiProviderEnabled: true,

  // Data Bridge UI chrome (never authorize — House D1 is authority).
  softTransferEnabled: true,
  lifeSnapshotEnabled: false,
  realtimeVoiceEnabled: false,
  platformRegistrationEnabled: true,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_DEFAULTS;

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_DEFAULTS) as FeatureFlagKey[];
