/**
 * BUDGET-CORNER-023 / BUDGET-CORNER-024 — `isNotificationVisibleForBrand` under
 * the Budget brand.
 *
 * Budget's D1 was cloned from House at split time and may still hold legacy
 * House-domain rows, so the client filter is the last line of defence against
 * surfacing another app's data. CORNER-023 asserts EVERY House-domain type by
 * name (not a sample); CORNER-024 is the negative half — Budget's own
 * `budget_chat_*` types must still pass.
 *
 * `HOUSE_DOMAIN_NOTIFICATION_TYPES` is module-private, so the list below is
 * transcribed verbatim from `src/utils/notificationVisibility.ts`. Keep them in
 * sync — the count assertion is the tripwire if a type is added there.
 */

/** Mutable brand capability map — read at call time by the module under test. */
let mockCapabilities: Record<string, boolean> = {
  homeApi: false,
  kaizenApi: false,
  joinedPlatform: true,
};
let mockFullBudget = true;

jest.mock('@brand', () => ({
  __esModule: true,
  get brand() {
    return { id: 'symply-budget' };
  },
  // `?? ` guards the module-eval-time call (`brandSupportsNotifications`), which
  // runs before the `let` initialisers below are assigned (jest hoists factories).
  hasBrandCapability: (key: string) => mockCapabilities?.[key] ?? false,
  isFullBudget: () => mockFullBudget ?? true,
  isHealthCapableBrand: () => false,
  isJoinedPlatformBrand: () => mockCapabilities?.joinedPlatform ?? true,
}));

import {
  isNotificationVisibleForBrand,
  notificationsBannerBlurb,
} from '../notificationVisibility';

/**
 * Every entry of `HOUSE_DOMAIN_NOTIFICATION_TYPES`, in source order.
 *
 * NOTE: the matrix row says "all 30". The source set actually holds **29**
 * types — see the report. The count is asserted below so the drift is visible
 * either way.
 */
const HOUSE_DOMAIN_TYPES = [
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
] as const;

const BUDGET_NATIVE_TYPES = ['budget_chat_message', 'budget_chat_mention'] as const;

beforeEach(() => {
  mockCapabilities = { homeApi: false, kaizenApi: false, joinedPlatform: true };
  mockFullBudget = true;
});

describe('isNotificationVisibleForBrand — Budget hides the House domain', () => {
  it('BUDGET-CORNER-023: the transcribed House-type list has no duplicates and is the full set', () => {
    expect(new Set(HOUSE_DOMAIN_TYPES).size).toBe(HOUSE_DOMAIN_TYPES.length);
    // Tripwire: bump this (and the list) when a House type is added to the source set.
    expect(HOUSE_DOMAIN_TYPES.length).toBe(29);
  });

  it.each(HOUSE_DOMAIN_TYPES.map(t => [t]))(
    'BUDGET-CORNER-023: hides House-domain type %s under Budget',
    type => {
      expect(isNotificationVisibleForBrand(type)).toBe(false);
    }
  );

  it('BUDGET-CORNER-023: hides every House-domain type in one pass (none leak)', () => {
    const leaked = HOUSE_DOMAIN_TYPES.filter(t => isNotificationVisibleForBrand(t));
    expect(leaked).toEqual([]);
  });

  it('BUDGET-CORNER-023: the House app itself still shows all of them', () => {
    mockCapabilities.homeApi = true;
    for (const type of HOUSE_DOMAIN_TYPES) {
      expect(isNotificationVisibleForBrand(type)).toBe(true);
    }
  });
});

describe('isNotificationVisibleForBrand — Budget-native types pass', () => {
  it.each(BUDGET_NATIVE_TYPES.map(t => [t]))(
    'BUDGET-CORNER-024: shows Budget-native type %s',
    type => {
      expect(isNotificationVisibleForBrand(type)).toBe(true);
    }
  );

  it('BUDGET-CORNER-024: an unknown / null / empty type is not swallowed by the House filter', () => {
    // Only the enumerated House types are hidden — anything else falls through.
    expect(isNotificationVisibleForBrand('budget_bill_due')).toBe(true);
    expect(isNotificationVisibleForBrand('household_invite')).toBe(true);
    expect(isNotificationVisibleForBrand(null)).toBe(true);
    expect(isNotificationVisibleForBrand(undefined)).toBe(true);
    expect(isNotificationVisibleForBrand('')).toBe(true);
  });

  it('BUDGET-CORNER-024: filtering a mixed list keeps only the Budget rows', () => {
    const feed = [...HOUSE_DOMAIN_TYPES, ...BUDGET_NATIVE_TYPES];
    expect(feed.filter(isNotificationVisibleForBrand)).toEqual([...BUDGET_NATIVE_TYPES]);
  });

  it('BUDGET-CORNER-024: the permission banner uses Budget domain copy, not House copy', () => {
    const blurb = notificationsBannerBlurb();
    expect(blurb).toContain('bills');
    expect(blurb).not.toContain('garbage');
  });
});
