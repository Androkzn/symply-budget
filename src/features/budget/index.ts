/**
 * Budget feature module — mode gating + public surface.
 *
 * Screens still live under `src/screens/budget/` (large tree). Import screens
 * via `@screens/budget`; use this module for `brand.features.budget` gating.
 *
 * | Brand | Mode | Behavior |
 * |-------|------|----------|
 * | simple-house | minimal | Dashboard glance / home ops money only |
 * | simple-budget | full | Full suite + Budget-first tab |
 * | kaizen / others | off | No budget product |
 *
 * Physical move into this folder can proceed incrementally.
 */

import { isFullBudget } from '@brand';

export const BUDGET_FEATURE_ID = 'budget' as const;

export function isBudgetBrand(id?: string): boolean {
  return isFullBudget(id);
}

export {
  FULL_BUDGET_STACK_ROUTES,
  FULL_BUDGET_VIEWS,
  getBudgetMode,
  getBudgetSubViews,
  isBudgetEnabled,
  isBudgetOff,
  isFullBudget,
  isFullBudgetStackRoute,
  isMinimalBudget,
  MINIMAL_BUDGET_VIEWS,
  sanitizeBudgetNavigation,
  type BudgetSubView,
} from './mode';

// NOTE: Budget screens are intentionally NOT re-exported from this barrel.
// Import them from '@features/budget/screens' instead. Re-exporting screen
// components here created a require cycle (barrel → screens → BudgetHomeScreen →
// large UI tree → services/components that import mode helpers from this barrel),
// which crashed any test doing `{ ...jest.requireActual('@features/budget') }`
// (the spread eagerly evaluates the screen live-binding getters mid-cycle).
// Keeping the barrel pure logic keeps it safe to spread and cheap to import.
