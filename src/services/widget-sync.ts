/**
 * Widget Sync Service
 *
 * Owns the app→Home-Screen-widget handoff through the `WidgetSync` Expo native
 * module (see `modules/widget-sync`). Product at+jwt never enters App Group —
 * only household/user ids and optional companion+jwt.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface WidgetSyncNativeModule {
  setAuth(householdId: string, userId: string): void;
  setCompanionAuth(token: string): void;
  setApiBaseUrl(url: string): void;
  setHomeInsight(json: string): void;
  setTasks(json: string): void;
  setSnapshot(key: string, json: string): void;
  clear(): void;
  reload(): void;
}

const WidgetSync = requireOptionalNativeModule<WidgetSyncNativeModule>('WidgetSync');

function safe(run: (m: WidgetSyncNativeModule) => void): void {
  if (!WidgetSync) return;
  try {
    run(WidgetSync);
  } catch (error) {
    console.error('[WidgetSync] native call failed:', error);
  }
}

export const widgetSync = {
  /** Whether the native module is linked (iOS builds with the widget). */
  isAvailable(): boolean {
    return WidgetSync != null;
  },

  /** Household + user ids only — never product JWT. */
  setAuth(householdId: string, userId: string): void {
    if (!householdId || !userId) return;
    safe((m) => m.setAuth(householdId, userId));
  },

  /** House companion+jwt only (never at+jwt). */
  setCompanionAuth(token: string): void {
    if (!token) return;
    safe((m) => m.setCompanionAuth(token));
  },

  /** Environment base URL (staging on dev builds, prod on release). */
  setApiBaseUrl(url: string): void {
    if (!url) return;
    safe((m) => m.setApiBaseUrl(url));
  },

  /** Freshest Mira insight snapshot. */
  setHomeInsight(insight: unknown): void {
    if (!insight) return;
    safe((m) => m.setHomeInsight(JSON.stringify(insight)));
  },

  /** Latest task feed snapshot (snake_case fields). */
  setTasks(tasks: unknown): void {
    if (!tasks) return;
    safe((m) => m.setTasks(JSON.stringify(tasks)));
  },

  /**
   * Generic per-brand widget snapshot. Each app writes its own key + payload,
   * read by that brand's widget content view:
   *   'widget_budget_summary' · 'widget_kaizen_today' · 'widget_language_today' · 'widget_health_today'
   */
  setSnapshot(key: string, data: unknown): void {
    if (!key || data == null) return;
    safe((m) => m.setSnapshot(key, JSON.stringify(data)));
  },

  /** Wipe the widget's App Group data on logout. */
  clear(): void {
    safe((m) => m.clear());
  },

  /** Force a widget timeline refresh. */
  reload(): void {
    safe((m) => m.reload());
  },
};

export default widgetSync;
