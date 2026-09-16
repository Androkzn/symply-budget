/**
 * Bulk purchases (stock-up spreading) — shared constants.
 *
 * The row and view types live next to `Expense` in `@api/budget`, because the
 * plan IS a field of the stored row and the facade returns the derived views.
 * This module only holds the numbers every caller must agree on.
 */
export type {
  BulkConfidence,
  BulkEstimateBasis,
  BulkMonthContext,
  BulkPlanInput,
  BulkPortionView,
  BulkSuggestion,
  BulkSuggestionEvidence,
  BulkSuggestionRequest,
  BulkSuggestionResponse,
  ExpenseBulkPlan,
} from '@api/budget';

/** A plan shorter than this is not a spread, it is an ordinary spending. */
export const BULK_MIN_MONTHS = 2;

/** Stepper and estimator ceiling. Longer than a year is a guess, not a plan. */
export const BULK_MAX_MONTHS = 12;

/** What the form pre-selects when the household has no usable history. */
export const BULK_DEFAULT_MONTHS = 3;

/** How many months the preview and `monthContext` cover, from the purchase month. */
export const BULK_PREVIEW_MONTHS = BULK_MAX_MONTHS;
