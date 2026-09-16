/**
 * React Native–only env helpers (CA-8).
 * Kept out of `env.shared.ts` so non-RN code never imports `react-native`.
 */

import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { NativeModules, Platform } from 'react-native';

/**
 * Local Xcode build override via WatchBridge (scheme SIMPLEHOUSE_API_ENV).
 * Absent on TestFlight / store builds.
 */
export function resolveApiEnvOverride(): 'staging' | 'production' | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const watchBridge = NativeModules?.WatchBridge as
      | { apiEnvironment?: string; getConstants?: () => { apiEnvironment?: string } }
      | undefined;
    if (!watchBridge) return null;
    const raw =
      typeof watchBridge.getConstants === 'function'
        ? watchBridge.getConstants()?.apiEnvironment
        : watchBridge.apiEnvironment;
    return raw === 'staging' || raw === 'production' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Version + build number of the BINARY that is running, read from the native
 * bundle (iOS `CFBundleShortVersionString` / `CFBundleVersion`, Android
 * `versionName` / `versionCode`).
 *
 * These were hardcoded `'1.0.0'` / `'1'` in `ENV`, so the settings footer, the
 * Sentry release tag and the PostHog `app_version` property all reported build 1
 * no matter which binary was installed — House was on build 45 at the time this
 * was fixed, and every brand ships its OWN version (`iosVersion` /
 * `iosBuildNumber` in `brands/<id>/brand.cjs`, pinned into the native project by
 * scripts/ios/ensure-brand-configurations.rb). The native bundle is the only
 * source that can't drift from what the member actually installed.
 *
 * Read through `requireOptionalNativeModule` rather than by importing
 * `expo-application`: that package resolves its native module with the
 * NON-optional `requireNativeModule`, which THROWS where the module is absent
 * (Jest, web) — and it does so at import time, which would take down every suite
 * that transitively imports `@config/env`. The optional variant returns null
 * instead, and the constants are the same ones `expo-application` re-exports.
 */
const ExpoApplication = requireOptionalNativeModule<{
  nativeApplicationVersion?: string | null;
  nativeBuildVersion?: string | null;
}>('ExpoApplication');

/** Marketing version of the installed binary, or null off-device. */
export function resolveNativeAppVersion(): string | null {
  const v = ExpoApplication?.nativeApplicationVersion;
  return typeof v === 'string' && v ? v : null;
}

/** Build number of the installed binary, or null off-device. */
export function resolveNativeBuildNumber(): string | null {
  const v = ExpoApplication?.nativeBuildVersion;
  return v == null || v === '' ? null : String(v);
}

/**
 * When the JS bundle this app is running was produced, as an ISO string.
 *
 * Stamped into `extra.buildTime` by app.config.ts, which Expo evaluates at the
 * moment the bundle is built: the `[Expo] Configure project` build phase writes
 * it into `EXConstants.bundle/app.config` on every native build, an EAS Update
 * carries the value it was published with, and a Metro dev session gets the time
 * the dev server resolved the config. So this always answers "how old is the
 * code I am looking at", which is the question a tester on TestFlight has when
 * a fix appears to be missing.
 */
export function resolveBuildTime(): string | null {
  const raw = (Constants.expoConfig?.extra as { buildTime?: unknown } | undefined)?.buildTime;
  return typeof raw === 'string' && raw ? raw : null;
}
