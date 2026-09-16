import {
  hasBrandCapability,
  isFullBudget,
  isHealthCapableBrand,
  isJoinedPlatformBrand,
} from '@brand';

/**
 * House-domain notification types — maintenance tasks, garbage collection, home
 * reports, the AI Housekeeper (suggestions/briefings/digests) and garden plans.
 * These belong to the House app only.
 *
 * The backend now gates GENERATION of these to the House Worker (see
 * `isHomeApiEnabled` in backend/src/config/brand.ts), so child apps stop
 * producing them. But each child app's D1 was cloned from House during the
 * split and may still hold legacy rows, so we also hide them client-side — e.g.
 * Symply Budget must never surface an "Overdue Task" reminder. Each app talks to
 * its own backend/D1, so the only cross-brand leakage is these House types;
 * Budget/Kaizen/Health-native types are unaffected.
 */
const HOUSE_DOMAIN_NOTIFICATION_TYPES = new Set<string>([
  'task_reminder',
  'task_overdue',
  'task_assigned',
  'task_completed',
  'task_drafts_ready',
  'maintenance_task',
  'maintenance_suggestions',
  'critical_findings',
  'garbage',
  'garbage_collection',
  'garbage_missed',
  'garbage_reminder',
  'report_ready',
  'weekly_summary',
  'ai_daily_digest',
  'ai_weekly_summary',
  'ai_prediction',
  'ai_suggestion',
  'aihousekeeper_briefing',
  'aihousekeeper_nudge',
  'garden_plan_ready',
  'garden_plan_failed',
  'home_project_blocker_added',
  'home_project_budget_over',
  'home_project_phase_due',
  'home_project_selection_approved',
  'home_project_schematic_ready',
  'home_project_schematic_failed',
  'home_project_mentioned',
]);

/**
 * Symply Health reminder types — meal / water / weigh-in / habit nudges.
 *
 * The mirror image of the House list above, and here for the same reason that
 * one is: the backend gates GENERATION to the Health Worker
 * (`isHealthApiEnabled` in `backend/src/cron/scheduled.ts`), so no other app
 * should ever produce one. But every child app's D1 was CLONED FROM HOUSE during
 * the split, so a stale row can outlive the code that made it, and the House
 * Worker's own D1 is the one the clones came from. Hiding them client-side means
 * a Budget user can never be shown "Time to log your lunch" even if a row for it
 * somehow exists in their database.
 *
 * Keep in step with `HEALTH_REMINDER_TYPES` + `HEALTH_HABIT_REMINDER_TYPE` in
 * `backend/src/services/health-reminders-service.ts`.
 */
const HEALTH_DOMAIN_NOTIFICATION_TYPES = new Set<string>([
  'health_meal_reminder',
  'health_water_reminder',
  'health_weigh_in_reminder',
  'health_habit_reminder',
]);

/** The House app owns the home domain; child apps run fully independently. */
function isHouseDomainBrand(): boolean {
  return hasBrandCapability('homeApi');
}

/**
 * Whether this brand's backend implements the platform notification API
 * (`/notifications/*`). The platform-backend apps (House/Budget/Kaizen/Health)
 * do; Symply Language runs on the separate donor backend, which has no
 * notification endpoints — so hitting them 404s. When false, the app hides the
 * notification bell and skips push-token registration rather than advertising a
 * dead feature.
 */
export const brandSupportsNotifications = isJoinedPlatformBrand();

/**
 * Whether a notification of the given `type` should be shown in the current
 * brand's app.
 *
 * Two domain lists, each hidden everywhere except its owner:
 *  - House types are hidden in every child app (Budget/Kaizen/Health);
 *  - Health reminder types are hidden everywhere except Health — INCLUDING in
 *    House, which is where every child D1 was cloned from and so is exactly
 *    where a stray health row would surface.
 *
 * Anything not on either list is shared (invites, chat, AI-key notices) and is
 * shown everywhere, which is why this stays an explicit deny-list rather than an
 * allow-list: a new shared type must not need a code change in five apps to be
 * visible.
 */
export function isNotificationVisibleForBrand(
  type: string | null | undefined,
): boolean {
  const value = type ?? '';
  if (HEALTH_DOMAIN_NOTIFICATION_TYPES.has(value)) {
    return isHealthCapableBrand();
  }
  if (isHouseDomainBrand()) return true;
  return !HOUSE_DOMAIN_NOTIFICATION_TYPES.has(value);
}

/**
 * Brand-aware copy for the "Push Notifications Disabled" banner. Each app
 * describes reminders in its own domain instead of House's "tasks, garbage
 * collection" wording.
 */
export function notificationsBannerBlurb(): string {
  if (hasBrandCapability('homeApi')) {
    return 'Enable notifications to get reminders for tasks, garbage collection, and more.';
  }
  if (isFullBudget()) {
    return 'Enable notifications to get reminders for bills, budgets, and savings goals.';
  }
  if (hasBrandCapability('kaizenApi')) {
    return 'Enable notifications to get reminders for your habits, goals, and check-ins.';
  }
  if (isHealthCapableBrand()) {
    return 'Enable notifications to get reminders for your health check-ins and goals.';
  }
  if (!isJoinedPlatformBrand()) {
    return 'Enable notifications to get reminders for your lessons and daily practice.';
  }
  return 'Enable notifications to get reminders for tasks, garbage collection, and more.';
}
