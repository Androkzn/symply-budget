/**
 * Budget mode-gating logic — the single source of truth for what budget surface
 * a brand exposes (`off` | `minimal` | `full`). Exercised across all three
 * modes by driving `brand.features.budget` through a mutable mock.
 */

// Mutable brand budget mode — the getter is read at call time by getBudgetMode(),
// so flipping this between tests re-gates every helper below. (Jest requires the
// factory to only close over `mock`-prefixed outer names.)
let mockBudgetMode: 'off' | 'minimal' | 'full' = 'full';
const mockBrandId = 'symply-budget';
jest.mock('@brand', () => ({
  __esModule: true,
  brandId: mockBrandId,
  get brand() {
    return { id: mockBrandId, features: { budget: mockBudgetMode } };
  },
  getBrandById: (id: string) => ({ id, features: { budget: mockBudgetMode } }),
}));

import {
  FULL_BUDGET_STACK_ROUTES,
  FULL_BUDGET_VIEWS,
  MINIMAL_BUDGET_VIEWS,
  getBudgetMode,
  getBudgetSubViews,
  isBudgetEnabled,
  isBudgetOff,
  isFullBudget,
  isFullBudgetStackRoute,
  isMinimalBudget,
  sanitizeBudgetNavigation,
} from '../mode';

afterEach(() => {
  mockBudgetMode = 'full';
});

describe('getBudgetMode + boolean gates', () => {
  it('reflects the active brand mode', () => {
    mockBudgetMode = 'off';
    expect(getBudgetMode()).toBe('off');
    mockBudgetMode = 'minimal';
    expect(getBudgetMode()).toBe('minimal');
    mockBudgetMode = 'full';
    expect(getBudgetMode()).toBe('full');
  });

  it('classifies "off" as disabled', () => {
    mockBudgetMode = 'off';
    expect(isBudgetOff()).toBe(true);
    expect(isBudgetEnabled()).toBe(false);
    expect(isFullBudget()).toBe(false);
    expect(isMinimalBudget()).toBe(false);
  });

  it('classifies "minimal" as enabled-but-not-full', () => {
    mockBudgetMode = 'minimal';
    expect(isBudgetOff()).toBe(false);
    expect(isBudgetEnabled()).toBe(true);
    expect(isFullBudget()).toBe(false);
    expect(isMinimalBudget()).toBe(true);
  });

  it('classifies "full" as enabled + full', () => {
    mockBudgetMode = 'full';
    expect(isBudgetOff()).toBe(false);
    expect(isBudgetEnabled()).toBe(true);
    expect(isFullBudget()).toBe(true);
    expect(isMinimalBudget()).toBe(false);
  });
});

describe('getBudgetSubViews', () => {
  it('returns no sub-views when budget is off', () => {
    mockBudgetMode = 'off';
    expect(getBudgetSubViews()).toEqual([]);
    // savingsEnabled is irrelevant when off.
    expect(getBudgetSubViews({ savingsEnabled: true })).toEqual([]);
  });

  it('returns only the dashboard glance for minimal', () => {
    mockBudgetMode = 'minimal';
    expect(getBudgetSubViews()).toEqual(['dashboard']);
    expect(getBudgetSubViews()).toEqual([...MINIMAL_BUDGET_VIEWS]);
  });

  it('returns the full suite for full budget', () => {
    mockBudgetMode = 'full';
    expect(getBudgetSubViews()).toEqual([...FULL_BUDGET_VIEWS]);
    expect(getBudgetSubViews()).toEqual([
      'dashboard',
      'spendings',
      'savings',
      'pension',
      'wishes',
    ]);
  });

  it('drops savings + pension when savingsEnabled is false (full)', () => {
    mockBudgetMode = 'full';
    const views = getBudgetSubViews({ savingsEnabled: false });
    expect(views).not.toContain('savings');
    expect(views).not.toContain('pension');
    // Everything else survives, order preserved.
    expect(views).toEqual(['dashboard', 'spendings', 'wishes']);
  });

  it('BUDGET-NAV-011: savingsEnabled=false strips BOTH savings and pension', () => {
    // Pension lives behind the savings routes (backend `savings_enabled` KV
    // flag), so hiding one without the other leaves a dead tab.
    mockBudgetMode = 'full';
    const views = getBudgetSubViews({ savingsEnabled: false });
    expect(views).not.toContain('savings');
    expect(views).not.toContain('pension');
    expect(views).toEqual(['dashboard', 'spendings', 'wishes']);

    // Same agreement in minimal mode — neither tab exists to begin with.
    mockBudgetMode = 'minimal';
    const minimal = getBudgetSubViews({ savingsEnabled: false });
    expect(minimal).not.toContain('savings');
    expect(minimal).not.toContain('pension');
  });

  it('keeps savings + pension when savingsEnabled is true or omitted', () => {
    mockBudgetMode = 'full';
    expect(getBudgetSubViews({ savingsEnabled: true })).toContain('savings');
    expect(getBudgetSubViews({})).toContain('pension');
  });

  it('returns a fresh array (never leaks the shared constants)', () => {
    mockBudgetMode = 'full';
    const a = getBudgetSubViews();
    a.push('dashboard');
    expect(FULL_BUDGET_VIEWS).toHaveLength(5); // constant not mutated
  });
});

describe('isFullBudgetStackRoute', () => {
  it('accepts every declared full-budget route', () => {
    for (const route of FULL_BUDGET_STACK_ROUTES) {
      expect(isFullBudgetStackRoute(route)).toBe(true);
    }
  });

  it('rejects unknown / non-budget routes', () => {
    expect(isFullBudgetStackRoute('Home')).toBe(false);
    expect(isFullBudgetStackRoute('')).toBe(false);
    expect(isFullBudgetStackRoute('budgetitemform')).toBe(false); // case-sensitive
  });
});

describe('sanitizeBudgetNavigation', () => {
  it('strips all targets when budget is off', () => {
    mockBudgetMode = 'off';
    expect(sanitizeBudgetNavigation({ screen: 'BudgetItemForm' })).toEqual({});
    expect(sanitizeBudgetNavigation()).toEqual({});
  });

  it('strips full-only targets when minimal', () => {
    mockBudgetMode = 'minimal';
    expect(sanitizeBudgetNavigation({ screen: 'BudgetItemForm', activeView: 'savings' })).toEqual({});
    expect(sanitizeBudgetNavigation()).toEqual({});
  });

  it('BUDGET-NAV-003: returns {} in minimal mode for a full-only route', () => {
    mockBudgetMode = 'minimal';
    // The navigation intent is dropped wholesale, not partially applied — a
    // half-kept `activeView` would strand House's minimal mode on a screen its
    // stack never registers.
    for (const route of FULL_BUDGET_STACK_ROUTES) {
      expect(sanitizeBudgetNavigation({ screen: route })).toEqual({});
      expect(
        sanitizeBudgetNavigation({ screen: route, activeView: 'savings' })
      ).toEqual({});
    }
    expect(sanitizeBudgetNavigation({ activeView: 'pension' })).toEqual({});
    expect(sanitizeBudgetNavigation({})).toEqual({});
    expect(sanitizeBudgetNavigation()).toEqual({});
  });

  it('passes options through untouched when full', () => {
    mockBudgetMode = 'full';
    const opts = { screen: 'BudgetItemForm', activeView: 'spendings' };
    expect(sanitizeBudgetNavigation(opts)).toBe(opts);
    expect(sanitizeBudgetNavigation()).toEqual({});
  });
});
