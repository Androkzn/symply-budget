/**
 * Brand pack contract for the multi-app ecosystem.
 * Layout tokens (spacing, type, radius) live in brands/_shared —
 * brands own identity: colors, icons, backgrounds, tabs, store IDs, OAuth.
 */

export type BrandTabRoute =
  | 'index'
  | 'mira'
  | 'tasks'
  | 'budget'
  | 'chat'
  | 'settings'
  | 'gardening'
  | 'contractors'
  | 'reports'
  | 'utilities'
  | 'my-home'
  // House home-ops surfaces promoted out of Settings' ACCOUNT list into the
  // tab pool: `projects` is the renamed Home Projects hub (default-pinned,
  // second slot), `spaces` is the rooms/areas manager (starts in "More").
  // Living in both places at once is what made Garden read as duplicated.
  | 'projects'
  | 'spaces'
  | 'notifications'
  | 'profile'
  // Budget sections promoted to first-class tabs (customizable-tabs model).
  | 'planning'
  | 'spending'
  | 'savings'
  | 'pension'
  | 'bills'
  | 'wishes'
  | 'mortgage'
  // Kaizen sections promoted to first-class tabs.
  | 'kaizen-assess'
  | 'kaizen-career'
  | 'kaizen-learn'
  | 'kaizen-systems'
  // Language sections promoted to first-class tabs.
  | 'language-assessment'
  | 'language-dialogue'
  | 'language-plan'
  | 'language-review'
  // Health sections promoted to first-class tabs (donor parity: the Swift app
  // shipped a 5-tab customizable bar, not a two-tab shell).
  | 'health-nutrition'
  | 'health-activity'
  | 'health-trends'
  // The donor's dedicated Weight tab (`WeightTabView` + `WeightDashboardView`).
  | 'health-weight'
  | 'health-body'
  | 'health-habits'
  | 'health-water'
  | 'health-cycle'
  | 'health-vitality'
  // Health parity phase P2 — food library, recipes + smart fridge.
  | 'health-food'
  | 'health-recipes'
  | 'health-fridge'
  // Health workout library — the ported donor exercise catalogue.
  | 'health-exercises'
  // Health injury tracker — the WRITE half of the workout library's safety
  // gate, so it sits beside `health-exercises` here as it does in the pool.
  | 'health-injuries'
  // The donor's `GoalsSettingsView` — calories (incl. per-weekday), P/C/F,
  // steps, movement minutes, water and the weight goal, in one editor.
  | 'health-goals'
  // Health parity phase P3 — the AI surfaces. `health-coach` is the donor's
  // `VoiceChat` / Health Coach V2 ported text-first; `health-scan` folds its
  // nutrition-label reader, food-photo analysis and scale portioning into one.
  | 'health-coach'
  | 'health-scan'
  // The donor's "My Files" — photos, documents and body photos stored against
  // the account, on the deployed `/health/files` routes.
  | 'health-files'
  // Settings sub-screens pushed from the "More" hub (donor
  // `ActivityNotificationPreferencesView` / `WidgetSettingsView`). They are
  // routes, NOT pool entries: a preferences page must never be offered as
  // something to pin to the bottom bar, so neither appears in `brand.tabs` and
  // both resolve to `href: null` — reachable by push and deep link only.
  | 'health-notifications'
  | 'health-widget'
  // The donor's `BarcodeScannerView` (parity P5) — pushed from the Scan tab's
  // quick-add, never pinned to the bar, same `href: null` treatment as the
  // two settings routes above.
  | 'health-barcode-scan';

export interface BrandTabConfig {
  /** expo-router route name under app/(tabs)/ */
  route: BrandTabRoute;
  /** Ionicons glyph name (outline/filled resolved by the tab bar) */
  icon: string;
  /**
   * Brand PNG icon-kit name (new icon system). When set and present in the
   * active brand's kit, the tab bar renders the branded PNG instead of the
   * Ionicons glyph. Falls back to a semantic default per route otherwise.
   */
  brandIcon?: string;
  /** SF Symbol for native tabs / widget (optional) */
  sfSymbol?: string;
  /** Static label; omit for dynamic labels (e.g. housekeeper name) */
  label?: string;
  /** When set, label is resolved at render (e.g. 'housekeeper') */
  labelKey?: 'housekeeper';
  /**
   * Customizable-tabs model only (brand.customizableTabs === true). When the
   * brand opts in, `brand.tabs` is the full ordered POOL of available tabs
   * rather than the literal bar. These flags describe each pool entry:
   *
   *  - `defaultHidden`: tab starts in the "More" overflow, not pinned to the
   *    bottom bar, until the user adds it.
   *  - `locked`: tab cannot be removed/hidden by the user (e.g. Home, More).
   */
  defaultHidden?: boolean;
  locked?: boolean;
}

export interface BrandFeatureTabConfig extends BrandTabConfig {
  /** Feature flag key from useFeature(); when true, tab is inserted */
  feature: 'smartTaskAssistant';
  /** Insert after this route in the visible bar */
  insertAfter: BrandTabRoute;
}

export interface BrandColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  /** Dark-mode primary (often same as primaryDark) */
  primaryOnDark: string;
  primaryDarkOnDark: string;
}

export interface BrandAssetPaths {
  /** Paths relative to project root (for app.config / EAS) */
  appIcon: string;
  /**
   * Optional dark-appearance iOS app icon (opaque 1024². When set, app.config
   * wires `ios.icon` to { light: appIcon, dark: appIconDark } so iOS 18+ shows
   * the dark variant on a dark home screen. Android/notifications keep appIcon.
   */
  appIconDark?: string;
  splashLight: string;
  splashDark: string;
  logoHorizontal: string;
  logoSplash: string;
}

export interface BrandOAuthClientIds {
  iosClientId: string;
  androidClientId: string;
  webClientId: string;
}

/**
 * Per-brand PostHog project (publishable client key — safe to embed).
 * When present, this brand reports to its OWN PostHog project. When absent, the
 * brand falls back to the shared `EXPO_PUBLIC_POSTHOG_API_KEY` env key.
 */
export interface BrandPostHogConfig {
  apiKey: string;
  /** Defaults to EXPO_PUBLIC_POSTHOG_HOST / US cloud when omitted. */
  host?: string;
}

/**
 * Per-brand Sentry project (crash / error / performance monitoring).
 * When present, this brand reports crashes to its OWN Sentry project. When
 * absent, the brand falls back to the shared `EXPO_PUBLIC_SENTRY_DSN` env DSN.
 * DSNs are publishable (safe to embed), exactly like the PostHog client key.
 */
export interface BrandSentryConfig {
  /**
   * Runtime DSN — decides which Sentry project crashes are reported to.
   * Empty string ⇒ crash reporting intentionally OFF for this brand (no fallback).
   */
  dsn: string;
  /**
   * Sentry project slug used at *build time* by the `@sentry/react-native/expo`
   * plugin to upload source maps / debug symbols. Defaults to the shared
   * `simple-house` project when omitted (see app.config.ts).
   */
  project?: string;
  /** Sentry org slug — defaults to the shared ecosystem org when omitted. */
  org?: string;
}

/**
 * RevenueCat public SDK keys (publishable — safe to embed, like PostHog).
 * Per-brand RC apps; empty / omitted ⇒ purchases disabled for that brand.
 */
export interface BrandRevenueCatConfig {
  iosApiKey: string;
  androidApiKey: string;
}

/**
 * Dropbox uses a single app key for every platform (PKCE, no per-OS client),
 * so it does not fit BrandOAuthClientIds. Omit the block entirely to leave
 * Dropbox unconfigured — the service reports `isConfigured() === false` and the
 * UI hides it rather than offering a destination that always fails.
 */
export interface BrandDropboxConfig {
  appKey: string;
}

export interface BrandIntegrations {
  googleAuth: BrandOAuthClientIds;
  googleDrive: BrandOAuthClientIds;
  dropbox?: BrandDropboxConfig;
  appleAuth: { enabled: boolean };
  posthog?: BrandPostHogConfig;
  sentry?: BrandSentryConfig;
  revenueCat?: BrandRevenueCatConfig;
}

export interface BrandIosExtensions {
  widgetBundleId: string;
  watchBundleId: string;
  watchExtensionBundleId?: string;
  appGroup: string;
  appleTeamId?: string;
}

export type BrandBudgetMode = 'off' | 'minimal' | 'full';

export interface BrandFeatures {
  /** House keeps minimal; Simple Budget brand uses full */
  budget: BrandBudgetMode;
  widget: boolean;
  watch: boolean;
  googleDrive: boolean;
}

export interface BrandConfig {
  id: string;
  displayName: string;
  slug: string;
  scheme: string;
  iosBundleId: string;
  /** Native store version identity for this brand. */
  iosVersion?: string;
  /** Native iOS build number for this brand's next archive. */
  iosBuildNumber?: number;
  androidPackage: string;
  /** Optional EAS project id override; falls back to shared project */
  easProjectId?: string;
  colors: BrandColors;
  /**
   * Tabs in order. When `customizableTabs` is falsy this is the literal,
   * static bottom/sidebar bar (legacy behavior). When `customizableTabs` is
   * true this is the full ordered POOL of available tabs — the user's saved
   * order/visibility (navigationCustomizationStore) is layered on top, the
   * pinned set is capped at `maxVisibleTabs`, and the rest overflow into the
   * "More" hub.
   */
  tabs: BrandTabConfig[];
  /** Conditionally inserted tabs (feature-gated) */
  featureTabs?: BrandFeatureTabConfig[];
  /**
   * Opt this brand into the user-customizable tab bar (drag to reorder, add/
   * remove, "More" overflow). When omitted/false the brand keeps the static
   * `tabs` bar exactly as before. See src/stores/navigationCustomizationStore.
   */
  customizableTabs?: boolean;
  /**
   * Max tabs pinned to the bottom bar before the rest overflow into "More"
   * (the last slot is always "More" itself). Defaults to 5. Only meaningful
   * when `customizableTabs` is true.
   */
  maxVisibleTabs?: number;
  /**
   * Same cap, for the iPad sidebar. A phone bar is limited by horizontal room —
   * six icons across is already tight — but the sidebar is a tall column with
   * space to spare, and applying the phone's cap there pushed most of the pool
   * into "More" for no reason. Falls back to `maxVisibleTabs` when unset, so a
   * brand that has not thought about tablets keeps its existing bar.
   */
  maxVisibleTabsTablet?: number;
  assets: BrandAssetPaths;
  /** Short product name for permission strings */
  permissionProductName: string;
  /** OAuth / Apple credentials — code is shared; IDs are per brand */
  integrations: BrandIntegrations;
  /** Widget / Watch / App Group IDs */
  ios: BrandIosExtensions;
  features: BrandFeatures;
}
