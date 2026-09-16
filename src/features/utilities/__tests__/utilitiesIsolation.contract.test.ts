/**
 * HOUSE-UTIL-ISO-001 — Utilities is a House-only feature, fully isolated from
 * the Budget product.
 *
 * Replaces BUDGET-CORNER-021, which deliberately pinned an incoherent pair:
 * Utilities was reachable on the Budget *client* but 404'd by the Budget
 * *Worker*, while House — the only brand the Worker would serve — redirected
 * the tab away because `brand.features.budget` was `'minimal'`.
 *
 * That defect is now resolved in the direction the backend always implied:
 * `/households/:householdId/utilities` has always been registered in
 * `gateHomeApiPaths(...)` (House-domain, `homeApi`), so the client was brought
 * into agreement rather than the server being loosened.
 *
 * This file pins the COHERENT state. If someone re-couples Utilities to Budget
 * — by re-adding the routes to `FULL_BUDGET_STACK_ROUTES`, by mounting the
 * screens in `BudgetNavigator`, or by reintroducing a budget-mode condition in
 * the tab gate — these assertions fail loudly.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let mockBrandId = 'symply-house';
let mockBudgetMode: 'off' | 'minimal' | 'full' = 'minimal';

jest.mock('@brand', () => ({
  __esModule: true,
  get brandId() {
    return mockBrandId;
  },
  get brand() {
    return { id: mockBrandId, features: { budget: mockBudgetMode } };
  },
  getBrandById: (id: string) => ({ id, features: { budget: mockBudgetMode } }),
}));

import { isUtilitiesCapableBrand } from '@brand/capabilities';
import { FULL_BUDGET_STACK_ROUTES, isFullBudgetStackRoute } from '@features/budget/mode';

import { isUtilitiesEnabled } from '../gate';

const REPO_ROOT = join(__dirname, '../../../..');

/** Every route that belongs to the Utilities stack. */
const UTILITY_ROUTES = [
  'UtilityBills',
  'AddUtilityBill',
  'ConfirmBillPayments',
  'UtilityDetail',
  'PropertyTax',
  'AddPropertyTax',
  'UtilityCharts',
  'UtilitySettings',
  'UtilityProvider',
] as const;

afterEach(() => {
  mockBrandId = 'symply-house';
  mockBudgetMode = 'minimal';
});

describe('HOUSE-UTIL-ISO-001 — the gate is brand-derived, not budget-derived', () => {
  const tabSource = readFileSync(join(REPO_ROOT, 'app/(tabs)/utilities.tsx'), 'utf8');

  it('the Utilities tab gates on isUtilitiesEnabled(), not on budget mode', () => {
    expect(tabSource).toContain('isUtilitiesEnabled()');
    expect(tabSource).toContain('<UtilitiesNavigator />');
    expect(tabSource).toContain('<Redirect href="/" />');
    // The whole point of the isolation: no budget concept in the gate at all.
    expect(tabSource).not.toContain('isBudgetOff');
    expect(tabSource).not.toContain('isMinimalBudget');
    expect(tabSource).not.toContain('isFullBudget');
  });

  it('House reaches Utilities even though House ships budget: minimal', () => {
    mockBrandId = 'symply-house';
    mockBudgetMode = 'minimal';
    expect(isUtilitiesEnabled()).toBe(true);
  });

  it('House still reaches Utilities when budget is off entirely', () => {
    mockBrandId = 'symply-house';
    mockBudgetMode = 'off';
    expect(isUtilitiesEnabled()).toBe(true);
  });

  it('Budget does NOT reach Utilities, even on full budget', () => {
    mockBrandId = 'symply-budget';
    mockBudgetMode = 'full';
    expect(isUtilitiesEnabled()).toBe(false);
  });

  it.each([['symply-kaizen'], ['symply-health'], ['symply-language']])(
    '%s does not reach Utilities',
    id => {
      mockBrandId = id;
      expect(isUtilitiesCapableBrand(id)).toBe(false);
    }
  );
});

describe('HOUSE-UTIL-ISO-001 — Budget no longer routes to any Utilities screen', () => {
  const budgetNavSource = readFileSync(
    join(REPO_ROOT, 'src/navigation/BudgetNavigator.tsx'),
    'utf8'
  );

  it.each(UTILITY_ROUTES.map(r => [r]))('%s is NOT a full-budget stack route', route => {
    expect(FULL_BUDGET_STACK_ROUTES).not.toContain(route);
    expect(isFullBudgetStackRoute(route)).toBe(false);
  });

  it('BudgetNavigator does not import the utilities screen barrel', () => {
    expect(budgetNavSource).not.toContain("from '@features/utilities/screens'");
    expect(budgetNavSource).not.toContain("from '@screens/utilities'");
  });

  it.each(UTILITY_ROUTES.map(r => [r]))(
    'BudgetNavigator registers no <Stack.Screen name="%s">',
    route => {
      expect(budgetNavSource).not.toContain(`name="${route}"`);
    }
  );
});

describe('HOUSE-UTIL-ISO-001 — the feature module owns its own code', () => {
  it('the utilities API module lives in the feature and targets the gated path', () => {
    const apiSource = readFileSync(
      join(REPO_ROOT, 'src/features/utilities/api/utilities.ts'),
      'utf8'
    );
    expect(apiSource).toContain('/utilities');
    expect(apiSource).toMatch(/households\/\$\{[^}]*\}\/utilities/);
  });

  it('nothing outside the feature module imports the old utilities paths', () => {
    const navTypes = readFileSync(join(REPO_ROOT, 'src/navigation/types.ts'), 'utf8');
    // The route map moved into the feature; the hub only re-exports it.
    expect(navTypes).toContain("from '@features/utilities/navigation/types'");
    // Budget's own param list must no longer mirror the utilities routes.
    const budgetBlockStart = navTypes.indexOf('export type BudgetStackParamList');
    const budgetBlock = navTypes.slice(
      budgetBlockStart,
      navTypes.indexOf('};', budgetBlockStart)
    );
    UTILITY_ROUTES.forEach(route => {
      expect(budgetBlock).not.toContain(`${route}:`);
    });
  });
});

describe('HOUSE-UTIL-ISO-001 — client and server now agree', () => {
  const indexSource = readFileSync(join(REPO_ROOT, 'backend/src/index.ts'), 'utf8');
  const gateStart = indexSource.indexOf('gateHomeApiPaths(app, [');
  const serverHomeGated = indexSource
    .slice(gateStart, indexSource.indexOf(']);', gateStart))
    .includes("'/households/:householdId/utilities'");

  it('the server still gates /utilities as a House-domain path', () => {
    expect(gateStart).toBeGreaterThan(-1);
    expect(serverHomeGated).toBe(true);
  });

  it('House: client reachable AND server serves it', () => {
    mockBrandId = 'symply-house';
    mockBudgetMode = 'minimal';
    expect({
      clientReachable: isUtilitiesEnabled(),
      serverHomeGated,
    }).toEqual({ clientReachable: true, serverHomeGated: true });
  });

  it('Budget: client NOT reachable AND server 404s it — coherent, no longer a mismatch', () => {
    mockBrandId = 'symply-budget';
    mockBudgetMode = 'full';
    const clientReachable =
      isUtilitiesEnabled() && UTILITY_ROUTES.every(isFullBudgetStackRoute);
    expect({ clientReachable, serverHomeGated }).toEqual({
      clientReachable: false,
      serverHomeGated: true,
    });
  });
});
