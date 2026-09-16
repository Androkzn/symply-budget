/**
 * Each ecosystem app is a fully independent Worker + D1, but child app DBs were
 * cloned from House during the split, so House-domain notifications (tasks,
 * garbage, AI Housekeeper) can linger in e.g. the Budget D1. These tests lock in
 * the client-side guard that hides them on non-House brands and shows everything
 * on House. Mirrors the backend filter in NotificationService.
 */
type VisibilityModule = typeof import('../notificationVisibility');

function loadWithBrand(id: string): VisibilityModule {
  let mod: VisibilityModule | undefined;
  jest.isolateModules(() => {
    const capabilityTable: Record<
      string,
      {
        homeApi: boolean;
        kaizenApi: boolean;
        joinedPlatform: boolean;
        smartEngine: boolean;
        budgetMode: 'off' | 'minimal' | 'full';
      }
    > = {
      'symply-house': {
        homeApi: true,
        kaizenApi: false,
        joinedPlatform: true,
        smartEngine: true,
        budgetMode: 'minimal',
      },
      'symply-budget': {
        homeApi: false,
        kaizenApi: false,
        joinedPlatform: true,
        smartEngine: true,
        budgetMode: 'full',
      },
      'symply-kaizen': {
        homeApi: false,
        kaizenApi: true,
        joinedPlatform: true,
        smartEngine: true,
        budgetMode: 'off',
      },
      'symply-health': {
        homeApi: false,
        kaizenApi: false,
        joinedPlatform: true,
        smartEngine: true,
        budgetMode: 'minimal',
      },
      'symply-language': {
        homeApi: false,
        kaizenApi: false,
        joinedPlatform: false,
        smartEngine: true,
        budgetMode: 'off',
      },
    };
    const caps = capabilityTable[id] ?? {
      homeApi: false,
      kaizenApi: false,
      joinedPlatform: false,
      smartEngine: false,
      budgetMode: 'off' as const,
    };
    jest.doMock('@brand', () => ({
      brand: { id },
      brandId: id,
      hasBrandCapability: (key: 'homeApi' | 'kaizenApi' | 'joinedPlatform') =>
        key === 'homeApi'
          ? caps.homeApi
          : key === 'kaizenApi'
            ? caps.kaizenApi
            : caps.joinedPlatform,
      isFullBudget: () => caps.budgetMode === 'full',
      isJoinedPlatformBrand: (checkId = id) =>
        (capabilityTable[checkId] ?? caps).joinedPlatform,
      isHealthCapableBrand: (checkId = id) => {
        const checkCaps = capabilityTable[checkId] ?? caps;
        return (
          checkCaps.joinedPlatform &&
          !checkCaps.homeApi &&
          !checkCaps.kaizenApi &&
          checkCaps.budgetMode === 'minimal'
        );
      },
    }));
    mod = require('../notificationVisibility');
  });
  return mod as VisibilityModule;
}

afterEach(() => {
  jest.resetModules();
  jest.dontMock('@brand');
});

describe('isNotificationVisibleForBrand', () => {
  it('House (parent) shows every notification type', () => {
    const { isNotificationVisibleForBrand } = loadWithBrand('symply-house');
    expect(isNotificationVisibleForBrand('task_overdue')).toBe(true);
    expect(isNotificationVisibleForBrand('garbage_collection')).toBe(true);
    expect(isNotificationVisibleForBrand('budget_reminder')).toBe(true);
    expect(isNotificationVisibleForBrand('household_update')).toBe(true);
  });

  it('Budget hides House-domain types but keeps budget + core types', () => {
    const { isNotificationVisibleForBrand } = loadWithBrand('symply-budget');
    // House-domain — hidden
    expect(isNotificationVisibleForBrand('task_reminder')).toBe(false);
    expect(isNotificationVisibleForBrand('task_overdue')).toBe(false);
    expect(isNotificationVisibleForBrand('garbage_collection')).toBe(false);
    expect(isNotificationVisibleForBrand('report_ready')).toBe(false);
    expect(isNotificationVisibleForBrand('aihousekeeper_briefing')).toBe(false);
    // Budget-native + shared/core — shown
    expect(isNotificationVisibleForBrand('budget_reminder')).toBe(true);
    expect(isNotificationVisibleForBrand('household_update')).toBe(true);
    expect(isNotificationVisibleForBrand('chat_message')).toBe(true);
  });

  it('treats null / unknown types as visible on child apps', () => {
    const { isNotificationVisibleForBrand } = loadWithBrand('symply-budget');
    expect(isNotificationVisibleForBrand(null)).toBe(true);
    expect(isNotificationVisibleForBrand(undefined)).toBe(true);
    expect(isNotificationVisibleForBrand('some_future_budget_type')).toBe(true);
  });
});

describe('brandSupportsNotifications', () => {
  it('is true for platform-backend apps', () => {
    for (const id of [
      'symply-house',
      'symply-budget',
      'symply-kaizen',
      'symply-health',
    ]) {
      expect(loadWithBrand(id).brandSupportsNotifications).toBe(true);
    }
  });

  it('is false for Language (donor backend has no notification API)', () => {
    expect(loadWithBrand('symply-language').brandSupportsNotifications).toBe(
      false,
    );
  });
});

describe('notificationsBannerBlurb', () => {
  it('is brand-specific, never House copy on child apps', () => {
    expect(loadWithBrand('symply-budget').notificationsBannerBlurb()).toMatch(
      /bills|budget|savings/i,
    );
    expect(loadWithBrand('symply-health').notificationsBannerBlurb()).toMatch(
      /health/i,
    );
    expect(loadWithBrand('symply-kaizen').notificationsBannerBlurb()).toMatch(
      /habits|goals/i,
    );
    // Child app copy must NOT mention House's tasks/garbage wording.
    expect(loadWithBrand('symply-budget').notificationsBannerBlurb()).not.toMatch(
      /garbage/i,
    );
  });

  it('keeps the House wording for the House app', () => {
    expect(loadWithBrand('symply-house').notificationsBannerBlurb()).toMatch(
      /tasks, garbage collection/i,
    );
  });
});
