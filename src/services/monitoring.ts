/**
 * Crash / error / performance monitoring for the Symply Ecosystem (Sentry-backed).
 *
 * Provider-agnostic on purpose — the sibling of `src/services/analytics.ts`.
 * Features import the small surface below (`captureException`, `captureMessage`,
 * `identifyMonitoringUser`, …) and never touch Sentry directly, so the backing
 * provider can be swapped without touching call sites. `wrapRoot` re-exports
 * `Sentry.wrap` so the root layout stays provider-agnostic too.
 *
 * Gating:
 *  - Needs a publishable DSN in `ENV.SENTRY_DSN` (or a per-brand DSN from
 *    `brand.integrations.sentry`). No DSN → the module is an inert no-op
 *    (safe to ship un-configured).
 *  - Respects `ENV.FEATURES.ENABLE_CRASH_REPORTING` (false in `__DEV__` by
 *    default), so dev sessions don't pollute your Sentry project. To test wiring
 *    locally, set `EXPO_PUBLIC_SENTRY_DEV=1` (ideally against a dev project).
 *
 * Multi-brand: every event is tagged with `brand` (the active brand slug) and a
 * per-brand `release` (`<brand>@<version>+<build>`), so a single Sentry project
 * yields per-app issue streams / release health. When a brand declares its own
 * `integrations.sentry.dsn`, its crashes go to that dedicated project instead.
 *
 * Identity mirrors analytics (src/services/analytics.ts) + RevenueCat: bind the
 * Symply user id on login, clear on logout.
 */

import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

import { ENV } from '@config/env';

import { brand, brandId } from '../brand';

let initialized = false;
let active = false;

/** True once Sentry has been initialized with a live DSN. */
export function isMonitoringReady(): boolean {
  return active;
}

/**
 * Initialize Sentry once. Idempotent and defensive: any failure (missing DSN,
 * non-RN/test env, native module hiccup) leaves the module a silent no-op rather
 * than throwing into app startup.
 *
 * Call at MODULE LOAD in the root layout — before `wrapRoot()` and before the
 * first render — so early crashes are captured.
 */
export function initMonitoring(): void {
  if (initialized) return;
  initialized = true;

  // Per-brand project resolution: a brand pack that declares `integrations.sentry`
  // reports to its OWN Sentry project (empty DSN ⇒ intentionally off, no fallback
  // so it never leaks into the shared project). Brands without it use the shared
  // EXPO_PUBLIC_SENTRY_DSN env DSN.
  const brandSentry = brand.integrations.sentry;
  const dsn = brandSentry ? brandSentry.dsn : ENV.SENTRY_DSN;
  if (!dsn) {
    if (__DEV__) {
      console.warn(`[monitoring] No Sentry DSN for brand "${brandId}" — crash reporting disabled`);
    }
    return;
  }

  // Send when crash reporting is enabled (prod) OR explicitly opted in for dev
  // verification (EXPO_PUBLIC_SENTRY_DEV=1). The `environment` tag keeps dev
  // traffic filterable from production in the Sentry UI.
  const enabled = ENV.FEATURES.ENABLE_CRASH_REPORTING || ENV.SENTRY_DEV;
  const environment = __DEV__ ? 'development' : 'production';

  try {
    Sentry.init({
      dsn,
      enabled,
      environment,
      // Per-brand release so Release Health / regressions are attributed to the
      // right app even when several brands share one project.
      release: `${brandId}@${ENV.APP_VERSION}+${ENV.BUILD_NUMBER}`,
      dist: ENV.BUILD_NUMBER,
      // Privacy: never attach IP / cookies / request bodies by default. We set an
      // explicit user id (setUser) instead — see identifyMonitoringUser.
      sendDefaultPii: false,
    });

    // Tags attached to every event → per-brand / platform / env slicing, exactly
    // like the analytics super-properties.
    Sentry.setTags({
      brand: brandId,
      platform: Platform.OS,
      environment,
      app_version: ENV.APP_VERSION,
      build_number: ENV.BUILD_NUMBER,
    });

    active = true;
  } catch (error) {
    active = false;
    if (__DEV__) {
      console.warn('[monitoring] Sentry init failed — crash reporting disabled', error);
    }
  }
}

/** Bind the crash-report identity to the Symply user id (call on login / rehydrate). */
export function identifyMonitoringUser(userId: string): void {
  if (!active || !userId) return;
  try {
    Sentry.setUser({ id: userId });
  } catch (error) {
    if (__DEV__) {
      console.warn('[monitoring] setUser failed', error);
    }
  }
}

/** Clear the crash-report identity on sign-out. */
export function resetMonitoringUser(): void {
  if (!active) return;
  try {
    Sentry.setUser(null);
  } catch {
    // Non-fatal.
  }
}

type MonitoringContext = Record<string, unknown>;

/** Report a caught error to Sentry with optional structured context. */
export function captureException(error: unknown, context?: MonitoringContext): void {
  if (!active) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never let error reporting throw into the caught path.
  }
}

/** Report a message-level event (non-exception) to Sentry. */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: MonitoringContext,
): void {
  if (!active || !message) return;
  try {
    Sentry.captureMessage(message, context ? { level, extra: context } : level);
  } catch {
    // Non-fatal.
  }
}

/** Leave a breadcrumb for the next event's timeline. */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (!active) return;
  try {
    Sentry.addBreadcrumb(breadcrumb);
  } catch {
    // Non-fatal.
  }
}

/** Set a Sentry tag (e.g. `feature=home_projects`) for the current session scope. */
export function setMonitoringTag(key: string, value: string): void {
  if (!active) return;
  try {
    Sentry.setTag(key, value);
  } catch {
    // Non-fatal.
  }
}

/**
 * Wrap the root component for automatic error boundary + touch/nav tracking.
 * Provider-agnostic re-export so `app/_layout.tsx` never imports Sentry directly.
 */
export const wrapRoot = Sentry.wrap;

/** Namespaced convenience object for ergonomic imports. */
export const monitoring = {
  init: initMonitoring,
  identify: identifyMonitoringUser,
  reset: resetMonitoringUser,
  captureException,
  captureMessage,
  addBreadcrumb,
  setTag: setMonitoringTag,
  isReady: isMonitoringReady,
  wrap: wrapRoot,
};
