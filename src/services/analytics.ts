/**
 * Product-analytics wrapper for the Symply Ecosystem (PostHog-backed).
 *
 * Provider-agnostic on purpose: every call site imports the small surface below
 * (`trackEvent`, `trackScreen`, `identifyUser`, …) and never touches PostHog
 * directly, so the backing provider can be swapped without touching features.
 *
 * Gating:
 *  - Needs a publishable key in `ENV.POSTHOG_API_KEY` (EXPO_PUBLIC_POSTHOG_API_KEY).
 *    No key → the whole module is an inert no-op (safe to ship un-configured).
 *  - Respects `ENV.FEATURES.ENABLE_ANALYTICS` (false in `__DEV__` by default), so
 *    dev sessions don't pollute your PostHog project. To test wiring locally, set
 *    the key and flip that flag (ideally against a separate dev PostHog project).
 *
 * Multi-brand: every event is auto-tagged with `brand` (the active brand slug),
 * so one PostHog project yields per-app dashboards. See brands/resolve.cjs.
 *
 * Identity mirrors RevenueCat (src/services/purchases.ts): identify with the
 * Symply user id on login, reset on logout.
 */

import PostHog from 'posthog-react-native';
import { Platform } from 'react-native';

import { ENV } from '@config/env';

import { brand, brandId } from '../brand';

/**
 * Suggested event names. Not exhaustive and not enforced — `trackEvent` accepts
 * any string so features can add their own — but centralising the common ones
 * keeps naming consistent across brands. Use `snake_case`, verb-first.
 */
export const AnalyticsEvent = {
  APP_OPENED: 'app_opened',
  SIGNED_UP: 'signed_up',
  SIGNED_IN: 'signed_in',
  SIGNED_OUT: 'signed_out',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  HOUSEHOLD_CREATED: 'household_created',
  HOUSEHOLD_JOINED: 'household_joined',
  PAYWALL_VIEWED: 'paywall_viewed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_RESTORED: 'subscription_restored',
} as const;

type JsonSafe = string | number | boolean | null;
export type AnalyticsProps = Record<string, JsonSafe | undefined>;

let client: PostHog | null = null;
let initialized = false;

/** True once a live PostHog client exists (key present + construction succeeded). */
export function isAnalyticsReady(): boolean {
  return client !== null;
}

/**
 * Construct the PostHog client once. Idempotent and defensive: any failure
 * (missing key, non-RN/test env, native module hiccup) leaves the module a
 * silent no-op rather than throwing into app startup.
 */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;

  // Per-brand project resolution: a brand pack that declares `integrations.posthog`
  // reports to its OWN PostHog project (empty key ⇒ intentionally off, no fallback
  // so it never leaks into the shared project). Brands without it (e.g. House) use
  // the shared EXPO_PUBLIC_POSTHOG_API_KEY env key.
  const brandPostHog = brand.integrations.posthog;
  const apiKey = brandPostHog ? brandPostHog.apiKey : ENV.POSTHOG_API_KEY;
  const host = brandPostHog?.host || ENV.POSTHOG_HOST;
  if (!apiKey) {
    if (__DEV__) {
      console.warn(`[analytics] No PostHog key for brand "${brandId}" — analytics disabled`);
    }
    return;
  }

  // Send when analytics is enabled (prod) OR explicitly opted in for dev
  // verification (EXPO_PUBLIC_POSTHOG_DEV=1). Events carry `environment` so dev
  // traffic stays filterable from production in the PostHog UI.
  const enabled = ENV.FEATURES.ENABLE_ANALYTICS || ENV.POSTHOG_DEV;

  try {
    client = new PostHog(apiKey, {
      host,
      disabled: !enabled,
      // Flush eagerly in dev so you can watch events land in the PostHog UI.
      flushAt: __DEV__ ? 1 : 20,
      flushInterval: 30_000,
    });

    // Super properties attached to every event → per-brand / platform / env slices.
    client.register({
      brand: brandId,
      platform: Platform.OS,
      app_version: ENV.APP_VERSION,
      build_number: ENV.BUILD_NUMBER,
      environment: __DEV__ ? 'development' : 'production',
    });

    // First real event — also confirms the pipe end-to-end on cold start.
    client.capture(AnalyticsEvent.APP_OPENED);
  } catch (error) {
    client = null;
    if (__DEV__) {
      console.warn('[analytics] PostHog init failed — analytics disabled', error);
    }
  }
}

/** Bind analytics identity to the Symply user id (call on login / rehydrate). */
export function identifyUser(userId: string, traits?: AnalyticsProps): void {
  if (!client || !userId) return;
  try {
    client.identify(userId, cleanProps(traits));
  } catch (error) {
    if (__DEV__) console.warn('[analytics] identify failed', error);
  }
}

/** Merge properties onto the current person profile without re-identifying. */
export function setUserProperties(traits: AnalyticsProps): void {
  if (!client) return;
  try {
    // `$set` updates the person; PostHog uses the current distinctId.
    client.capture('$set', { $set: cleanProps(traits) ?? {} });
  } catch (error) {
    if (__DEV__) console.warn('[analytics] setUserProperties failed', error);
  }
}

/** Clear the analytics identity on sign-out (starts a fresh anonymous id). */
export function resetAnalytics(): void {
  if (!client) return;
  try {
    client.reset();
  } catch (error) {
    if (__DEV__) console.warn('[analytics] reset failed', error);
  }
}

/** Track a product event. `name` accepts any string; prefer `AnalyticsEvent.*`. */
export function trackEvent(name: string, props?: AnalyticsProps): void {
  if (!client || !name) return;
  try {
    client.capture(name, cleanProps(props));
  } catch (error) {
    if (__DEV__) console.warn(`[analytics] capture "${name}" failed`, error);
  }
}

/** Track a screen view (route name + optional params). */
export function trackScreen(name: string, props?: AnalyticsProps): void {
  if (!client || !name) return;
  try {
    client.screen(name, cleanProps(props));
  } catch (error) {
    if (__DEV__) console.warn(`[analytics] screen "${name}" failed`, error);
  }
}

/** Best-effort flush of the outgoing queue (e.g. before a hard sign-out). */
export function flushAnalytics(): void {
  if (!client) return;
  try {
    void client.flush();
  } catch {
    // Non-fatal — events retry on next send.
  }
}

/** Drop undefined keys so PostHog receives a clean, JSON-safe payload. */
function cleanProps(props?: AnalyticsProps): Record<string, JsonSafe> | undefined {
  if (!props) return undefined;
  const out: Record<string, JsonSafe> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Namespaced convenience object for ergonomic imports. */
export const analytics = {
  init: initAnalytics,
  identify: identifyUser,
  setUserProperties,
  reset: resetAnalytics,
  track: trackEvent,
  screen: trackScreen,
  flush: flushAnalytics,
  isReady: isAnalyticsReady,
};
