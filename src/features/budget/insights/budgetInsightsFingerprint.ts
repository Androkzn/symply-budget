/**
 * A stable digest of everything the Insights prompt actually reads.
 *
 * Insights are the single most expensive thing the dashboard produces: one
 * model call per generation, billed to the member's own provider key on
 * local-first. Anything that re-asks the model for a month whose numbers did
 * not move is pure waste — and, worse, it is VISIBLE waste: each answer is
 * different prose, so the card rewrites itself in front of the member for no
 * reason (the "ten insights in ten seconds" report).
 *
 * The backend already solved this for the remote transport — `budget_insights`
 * stores an `input_hash` and only regenerates when it changes
 * (`BudgetInsightsService`). This is the client-side twin of that hash, so the
 * same rule holds no matter which transport answers: **the same inputs always
 * reuse the previous answer.**
 *
 * What goes in is exactly what reaches the prompt: the month's totals, the
 * per-expense rows the category split is built from, the planned items, and the
 * sub-budget caps. What stays out is everything cosmetic — colors, icons,
 * titles, `created_at` — so renaming a category or re-theming a chart never
 * costs a generation.
 */

import type { MonthlyOverview } from '@api/budget';

/**
 * FNV-1a, 32-bit. Not cryptography — a cache key. Chosen over `hashToken`
 * (SHA-256, async, WebCrypto) because this runs inside a render pass on every
 * overview change and must be synchronous and free.
 */
export function fnv1a(input: string): string {
  /* eslint-disable no-bitwise -- a hash IS bit arithmetic; this is the algorithm. */
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  /* eslint-enable no-bitwise */
  return hash.toString(16).padStart(8, '0');
}

/**
 * Canonical, order-insensitive projection of the month.
 *
 * Rows are sorted because neither the local ledger nor D1 promises an order,
 * and a reordered-but-identical month must hash the same or the sort order
 * alone would burn a generation.
 */
function canonicalize(overview: MonthlyOverview): string {
  // Arrays are typed as required but arrive from two transports and several API
  // vintages; a fingerprint that can throw would take the whole card down.
  const expenses = (overview.expenses ?? [])
    .map((e) => `${e.id}:${e.amount}:${e.category_id ?? ''}:${e.saved_amount ?? 0}`)
    .sort();
  const items = (overview.items ?? [])
    .map(
      (i) =>
        `${i.id}:${i.priority}:${i.status}:${i.estimated_cost_max ?? i.estimated_cost_min ?? 0}`,
    )
    .sort();
  const subBudgets = (overview.subBudgets?.entries ?? [])
    .map((s) => `${s.category_id}:${s.cap_cents}:${s.spent_cents}`)
    .sort();
  // A re-spread plan moves what the month counts without touching any row's
  // `amount`, so the portions are part of the inputs too.
  const bulkPortions = (overview.bulkPortions ?? [])
    .map((p) => `${p.expenseId}:${p.index}/${p.months}:${p.portion_cents}`)
    .sort();

  return [
    overview.plannedBudget,
    overview.actualSpent,
    overview.committedTotal,
    overview.remainingBudget,
    overview.savedTotal,
    expenses.length,
    items.length,
    subBudgets.length,
    expenses.join(','),
    items.join(','),
    subBudgets.join(','),
    bulkPortions.join(','),
  ].join('|');
}

/**
 * Fingerprint used as the insights cache key. The trailing length guard makes
 * a 32-bit collision harmless in practice: two months would have to hash the
 * same AND canonicalize to the same byte length.
 */
export function budgetInsightsFingerprint(overview: MonthlyOverview): string {
  const canonical = canonicalize(overview);
  return `${fnv1a(canonical)}-${canonical.length.toString(36)}`;
}
