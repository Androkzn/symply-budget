// Environment configuration — RN entry (CA-8: RN import only here).
// Framework-free constants live in `env.shared.ts`.

import {
  resolveApiEnvOverride,
  resolveBuildTime,
  resolveNativeAppVersion,
  resolveNativeBuildNumber,
} from './env-native';
import {
  resolveBrandApiUrls,
  resolveBuildEnvOverride,
} from './env.shared';

// `brand` is required LAZILY (never imported at module scope). A top-level
// `import { brand }` pulls the brand dependency graph (aihousekeeper -> tasks ->
// api/client -> config/env) back into this module, forming a circular import that
// leaves `ENV` undefined while env.ts is mid-load and crashes the app on launch.
function getBrand(): typeof import('../brand').brand | undefined {
  try {
    return (require('../brand') as typeof import('../brand')).brand;
  } catch {
    return undefined;
  }
}

// Framework overrides don't depend on the brand, so they're safe at module init.
const buildEnvOverride = resolveBuildEnvOverride();
const apiEnvOverride = resolveApiEnvOverride();

// Precedence: EAS build profile (build-time) → local Xcode scheme (runtime) →
// __DEV__ default (dev ⇒ staging, release ⇒ prod).
const API_ENV: 'staging' | 'production' =
  buildEnvOverride ?? apiEnvOverride ?? (__DEV__ ? 'staging' : 'production');

// Brand-dependent values are read lazily through getters so this module NEVER
// touches `brand` at init. Under a circular import (env → brand → … → a module
// that reads `ENV`), `brand` can be mid-load; touching `brand.id` /
// `brand.integrations` at init would throw and leave `ENV` `undefined`, crashing
// the app on launch ("Cannot read property '…' of undefined"). Getters defer the
// access to first use (brand is fully loaded by then) and fall back safely.
const EMPTY_OAUTH = { IOS_CLIENT_ID: '', ANDROID_CLIENT_ID: '', WEB_CLIENT_ID: '' };
function brandApiUrls(): { staging: string; production: string } {
  const id = getBrand()?.id;
  if (!id) return { staging: '', production: '' };
  return resolveBrandApiUrls(id);
}
function oauth(kind: 'googleDrive' | 'googleAuth') {
  const g = getBrand()?.integrations?.[kind];
  return g
    ? {
        IOS_CLIENT_ID: g.iosClientId,
        ANDROID_CLIENT_ID: g.androidClientId,
        WEB_CLIENT_ID: g.webClientId,
      }
    : { ...EMPTY_OAUTH };
}

export const ENV = {
  get API_BASE_URL(): string {
    const { staging, production } = brandApiUrls();
    return API_ENV === 'production' ? production : staging;
  },
  /** True when the active API target is production (EAS/scheme/`__DEV__` resolution). */
  IS_PRODUCTION: API_ENV === 'production',

  /** Which backend this bundle talks to — `'staging' | 'production'`. */
  API_ENV,
  /** Title-cased `API_ENV`, for display (settings footer, diagnostics). */
  ENV_LABEL: API_ENV === 'production' ? 'Production' : 'Staging',

  get API_STAGING_URL(): string {
    return brandApiUrls().staging;
  },

  CLOUDFLARE_ACCOUNT_ID: 'ca18eb3d6918c4004749ece5578f494d',

  GOOGLE_PLACES_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '',

  get GOOGLE_DRIVE_OAUTH() {
    return oauth('googleDrive');
  },

  /**
   * Dropbox PKCE app key. Empty until a brand ships `integrations.dropbox`
   * (register at https://www.dropbox.com/developers/apps — "Scoped access",
   * "App folder"). The Dropbox service treats empty as "not configured" and the
   * backup UI hides the destination, so shipping without it is safe.
   */
  get DROPBOX_APP_KEY(): string {
    return getBrand()?.integrations?.dropbox?.appKey ?? '';
  },

  get GOOGLE_AUTH() {
    return oauth('googleAuth');
  },

  get APP_URL(): string {
    return __DEV__ ? 'http://localhost:3000' : brandApiUrls().production;
  },

  get APP_NAME(): string {
    return getBrand()?.displayName ?? 'Symply';
  },
  get APP_BRAND(): string {
    return getBrand()?.id ?? 'symply-budget';
  },
  /**
   * Version + build of the installed binary (see `env-native`). Read through
   * getters, not constants: these used to be hardcoded `'1.0.0'` / `'1'`, which
   * is what the settings footer, the Sentry release tag and the PostHog
   * `app_version` property all reported regardless of the binary — the fallbacks
   * below only apply off-device (Jest, web), where there is no native bundle.
   */
  get APP_VERSION(): string {
    return resolveNativeAppVersion() ?? '1.0.0';
  },
  get BUILD_NUMBER(): string {
    return resolveNativeBuildNumber() ?? '1';
  },
  /** ISO timestamp of when this JS bundle was built; null when unstamped. */
  get BUILD_TIME(): string | null {
    return resolveBuildTime();
  },

  FEATURES: {
    ENABLE_ANALYTICS: !__DEV__,
    ENABLE_CRASH_REPORTING: !__DEV__,
    ENABLE_PUSH_NOTIFICATIONS: true,
    ENABLE_BIOMETRIC_AUTH: true,
    ENABLE_DARK_MODE: true,
  },

  TIMEOUTS: {
    API_REQUEST: 30000,
    AI_ANALYSIS: 180000,
    SOCKET_CONNECT: 10000,
    BACKGROUND_SYNC: 300000,
  },

  CACHE: {
    DEFAULT_TTL: 3600000,
    MAX_AGE: 86400000,
  },

  REVENUECAT_IOS_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || '',
  REVENUECAT_ANDROID_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || '',

  POSTHOG_API_KEY: process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '',
  POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
  POSTHOG_DEV: process.env.EXPO_PUBLIC_POSTHOG_DEV === '1',

  SENTRY_DSN:
    process.env.EXPO_PUBLIC_SENTRY_DSN ||
    'https://a00b61fd22e56b09aba3c3c16e53e450@o4506338522431488.ingest.us.sentry.io/4511711684657152',
  SENTRY_DEV: process.env.EXPO_PUBLIC_SENTRY_DEV === '1',

  /**
   * Budget V2 local-first ledger. When `1`, Budget financial CRUD uses the
   * on-device store (no D1 writes). When unset, symply-budget __DEV__ defaults on.
   * Set `EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0` to force the remote API.
   */
  BUDGET_LOCAL_FIRST: process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST === '1',
} as const;

export type EnvConfig = typeof ENV;

export {
  resolveBrandApiUrls,
  resolveBuildEnvOverride,
  BUDGET_STAGING_API_URL,
  BUDGET_PRODUCTION_API_URL,
} from './env.shared';
