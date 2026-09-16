/**
 * Bulk purchases — how many months should this stock-up last?
 *
 * The household's own ledger is the only input: no network, no model, no
 * catalogue of shelf lives. The idea is to find the household's CONSUMPTION
 * RATE for what was bought, in regular-price money per month, and divide the
 * purchase into it. Two corrections keep the money rate honest:
 *
 *  - Regular-price equivalent. `equiv = amount + saved_amount`. A stock-up is
 *    usually cheaper per unit; comparing its discounted price against
 *    full-price history would shorten the estimate.
 *  - History is read through the month lens. Earlier bulk purchases contribute
 *    their portions, not their spike, so a household that always stocks up
 *    still has a smooth series to learn from — and each purchase event counts
 *    once for cadence.
 *
 * Rungs are tried in order (BRD §3, TRD §6.3). The first with enough evidence
 * gives the number; the cadence rung may only move confidence. Every answer
 * carries its evidence so the form can say WHY in one sentence, and the member's
 * choice — the saved plan — becomes the strongest signal next time (R0).
 *
 * Pure: no I/O. Lookback windows anchor on the purchase month, not on today,
 * so editing an old purchase re-derives the same suggestion.
 */
import type {
  BulkConfidence,
  BulkEstimateBasis,
  BulkSuggestion,
  BulkSuggestionEvidence,
  Expense,
} from '@api/budget';

import { hasBulkPlan, monthIndexOf, monthKeyFromIndex, monthKeyOf, planMonths, splitEvenly } from './bulkSplit';
import { BULK_DEFAULT_MONTHS, BULK_MAX_MONTHS, BULK_MIN_MONTHS } from './bulkTypes';

/** R1 window: completed months before the purchase month. */
const RATE_LOOKBACK_MONTHS = 12;
/** R0 / R2 window. */
const PRECEDENT_LOOKBACK_MONTHS = 24;
/** R4 window. */
const CATEGORY_WINDOW_MONTHS = 6;
/** R4 fires only for a narrow category: few products, or this product dominates it. */
const NARROW_CATEGORY_MAX_PRODUCTS = 5;
const NARROW_CATEGORY_MIN_SHARE = 0.5;
const NARROW_CATEGORY_MIN_MONTHS = 3;
const DAYS_PER_MONTH = 30.44;
/** Below this the purchase is a normal-size one for this household. */
const REGULAR_SIZE_THRESHOLD = 1.5;
/** R1 confidence is high only with this much evidence. */
const HIGH_CONFIDENCE_EVENTS = 4;
const HIGH_CONFIDENCE_SPAN = 4;
/** R2 vs R1 agreement bands. */
const CADENCE_AGREE = 0.25;
const CADENCE_DISAGREE = 0.5;

const CONFIDENCE_ORDER: BulkConfidence[] = ['none', 'low', 'medium', 'high'];

export interface BulkEstimateAlias {
  /** Normalized printed / typed name. */
  key: string;
  /** What the household calls it. */
  name: string;
}

export interface BulkEstimateInput {
  title: string;
  categoryId: string | null;
  /** TAX-INCLUSIVE, as it will be saved. */
  amountCents: number;
  /** Discount on this purchase, so it compares at regular price. */
  savedCents?: number;
  /** 'YYYY-MM-DD'. */
  purchaseDate: string;
  quantity?: number | null;
  unit?: string | null;
  /** The row being edited — never its own history. */
  excludeExpenseId?: string | null;
  expenses: readonly Expense[];
  categories: readonly { id: string; name: string }[];
  /** Household renames remembered from receipts (`listAliasHints`). */
  aliases?: readonly BulkEstimateAlias[];
  /** Synonym seeds for a normalized name (`lexiconRelatives`). */
  lexiconRelatives?: (normalizedName: string) => string[];
}

/** Same rule as `budgetNameSuggestions.normalizeName`, kept local so this module stays screen-free. */
export function normalizeProductKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUnit(unit: string | null | undefined): string | null {
  const trimmed = unit?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function equivOf(row: Pick<Expense, 'amount' | 'saved_amount'>): number {
  return Math.max(0, row.amount) + Math.max(0, row.saved_amount || 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

function clampMonths(raw: number): number {
  return Math.min(BULK_MAX_MONTHS, Math.max(BULK_MIN_MONTHS, Math.round(raw)));
}

function shiftConfidence(level: BulkConfidence, by: number): BulkConfidence {
  const index = CONFIDENCE_ORDER.indexOf(level);
  const next = Math.min(CONFIDENCE_ORDER.length - 1, Math.max(0, index + by));
  return CONFIDENCE_ORDER[next]!;
}

/**
 * The month lens applied to history: regular-price equivalents distributed the
 * way the ledger counts them — a bulk row by its plan, an ordinary row whole.
 */
function consumptionSeries(rows: readonly Expense[]): Map<string, number> {
  const series = new Map<string, number>();
  const add = (month: string, cents: number) => series.set(month, (series.get(month) ?? 0) + cents);
  for (const row of rows) {
    const equiv = equivOf(row);
    if (hasBulkPlan(row)) {
      const parts = splitEvenly(equiv, row.bulk.months);
      planMonths(row.bulk).forEach((month, i) => add(month, parts[i]!));
    } else {
      add(monthKeyOf(row.expense_date), equiv);
    }
  }
  return series;
}

/** Most recent spelling the household used, so the sentence says "Salmon", not "salmon". */
function displayLabel(rows: readonly Expense[], fallback: string): string {
  let best: Expense | null = null;
  for (const row of rows) {
    if (!best || row.expense_date > best.expense_date) best = row;
  }
  return best?.title.trim() || fallback.trim();
}

function sumConsumption(series: Map<string, number>, fromIndex: number, toIndex: number): number {
  let total = 0;
  for (let index = fromIndex; index <= toIndex; index += 1) {
    total += series.get(monthKeyFromIndex(index)) ?? 0;
  }
  return total;
}

function firstActiveMonth(series: Map<string, number>, fromIndex: number, toIndex: number): number | null {
  for (let index = fromIndex; index <= toIndex; index += 1) {
    if ((series.get(monthKeyFromIndex(index)) ?? 0) > 0) return index;
  }
  return null;
}

interface RateEstimate {
  raw: number;
  events: number;
  spanMonths: number;
  monthlyRateCents: number;
  firstEventDate: string;
}

/**
 * R1 — spend per month over the product's own history: the sum of what the
 * month lens counted between the first active month and the last completed
 * month, divided by that span. Months WITHOUT a purchase are part of the span
 * on purpose: they are the months the previous purchase lasted.
 */
function rateEstimate(rows: readonly Expense[], purchaseMonthIndex: number, equivNew: number): RateEstimate | null {
  const windowStart = purchaseMonthIndex - RATE_LOOKBACK_MONTHS;
  const windowEnd = purchaseMonthIndex - 1;
  const events = rows.filter((row) => {
    const index = monthIndexOf(monthKeyOf(row.expense_date));
    return index >= windowStart && index <= windowEnd;
  });
  const distinctMonths = new Set(events.map((row) => monthKeyOf(row.expense_date)));
  if (events.length < 2 || distinctMonths.size < 2) return null;

  const series = consumptionSeries(rows);
  const first = firstActiveMonth(series, windowStart, windowEnd);
  if (first === null) return null;
  const spanMonths = windowEnd - first + 1;
  const rate = sumConsumption(series, first, windowEnd) / spanMonths;
  if (rate <= 0) return null;

  const firstEventDate = events.reduce(
    (min, row) => (row.expense_date < min ? row.expense_date : min),
    events[0]!.expense_date,
  );
  return {
    raw: equivNew / rate,
    events: events.length,
    spanMonths,
    monthlyRateCents: Math.round(rate),
    firstEventDate,
  };
}

interface CadenceEstimate {
  raw: number;
  gapDays: number;
  events: number;
}

/**
 * R2 — how often the household buys it and how much per time. A regular-size
 * purchase lasts one median gap; this purchase is `equivNew / a` of those.
 * Same-day rows merge into one event (a receipt with two salmon lines).
 */
function cadenceEstimate(rows: readonly Expense[], purchaseMonthIndex: number, equivNew: number): CadenceEstimate | null {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const index = monthIndexOf(monthKeyOf(row.expense_date));
    if (index < purchaseMonthIndex - PRECEDENT_LOOKBACK_MONTHS) continue;
    const date = row.expense_date.slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + equivOf(row));
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push(dayNumber(dates[i]!) - dayNumber(dates[i - 1]!));
  }
  const gapDays = median(gaps);
  const typicalEquiv = median(dates.map((date) => byDate.get(date)!));
  if (gapDays <= 0 || typicalEquiv <= 0) return null;
  return {
    raw: (equivNew / typicalEquiv) * (gapDays / DAYS_PER_MONTH),
    gapDays: Math.round(gapDays),
    events: dates.length,
  };
}

interface CategoryEstimate {
  raw: number;
  monthlyRateCents: number;
}

/**
 * R4 — the category's spend per month, only when the category is narrow enough
 * for that to mean something. "Groceries" at $900 a month would turn a $400
 * salmon into "one month"; the narrowness test is what keeps this rung honest.
 */
function categoryEstimate(
  rows: readonly Expense[],
  purchaseMonthIndex: number,
  equivNew: number,
  productKeys: ReadonlySet<string>,
): CategoryEstimate | null {
  const windowStart = purchaseMonthIndex - CATEGORY_WINDOW_MONTHS;
  const windowEnd = purchaseMonthIndex - 1;
  const inWindow = rows.filter((row) => {
    const index = monthIndexOf(monthKeyOf(row.expense_date));
    return index >= windowStart && index <= windowEnd;
  });
  const monthsWithSpend = new Set(inWindow.map((row) => monthKeyOf(row.expense_date)));
  if (monthsWithSpend.size < NARROW_CATEGORY_MIN_MONTHS) return null;

  const distinctProducts = new Set(inWindow.map((row) => normalizeProductKey(row.title)));
  const windowTotal = inWindow.reduce((sum, row) => sum + equivOf(row), 0);
  const productTotal = inWindow
    .filter((row) => productKeys.has(normalizeProductKey(row.title)))
    .reduce((sum, row) => sum + equivOf(row), 0);
  const share = windowTotal > 0 ? productTotal / windowTotal : 0;
  const narrow = distinctProducts.size <= NARROW_CATEGORY_MAX_PRODUCTS || share >= NARROW_CATEGORY_MIN_SHARE;
  if (!narrow) return null;

  const series = consumptionSeries(rows);
  const first = firstActiveMonth(series, windowStart, windowEnd);
  if (first === null) return null;
  const spanMonths = windowEnd - first + 1;
  const rate = sumConsumption(series, first, windowEnd) / spanMonths;
  if (rate <= 0) return null;
  return { raw: equivNew / rate, monthlyRateCents: Math.round(rate) };
}

function relatedKeysFor(key: string, input: BulkEstimateInput): Set<string> {
  const related = new Set<string>();
  if (!key) return related;
  for (const seed of input.lexiconRelatives?.(key) ?? []) {
    const normalized = normalizeProductKey(seed);
    if (normalized && normalized !== key) related.add(normalized);
  }
  for (const alias of input.aliases ?? []) {
    const aliasKey = normalizeProductKey(alias.key);
    const aliasName = normalizeProductKey(alias.name);
    // Typed the printed name → the household's own name for it is history too.
    if (aliasKey === key && aliasName && aliasName !== key) related.add(aliasName);
    // Typed the household's name → rows still logged under the printed name count.
    if (aliasName === key && aliasKey && aliasKey !== key) related.add(aliasKey);
  }
  return related;
}

export function estimateBulkMonths(input: BulkEstimateInput): BulkSuggestion {
  const key = normalizeProductKey(input.title);
  const purchaseMonth = monthKeyOf(input.purchaseDate);
  const purchaseMonthIndex = monthIndexOf(purchaseMonth);
  const equivNew = Math.max(0, input.amountCents) + Math.max(0, input.savedCents ?? 0);
  const unit = normalizeUnit(input.unit);

  const history = input.expenses.filter(
    (row) =>
      row.id !== input.excludeExpenseId && row.expense_date.slice(0, 10) <= input.purchaseDate.slice(0, 10),
  );
  const productRows = key ? history.filter((row) => normalizeProductKey(row.title) === key) : [];
  const relatedKeys = relatedKeysFor(key, input);
  const categoryName = input.categoryId
    ? input.categories.find((category) => category.id === input.categoryId)?.name ?? null
    : null;

  const evidence: BulkSuggestionEvidence = {
    productLabel: displayLabel(productRows, input.title),
    eventCount: productRows.length,
    firstEventDate: null,
    monthlyRateCents: null,
    medianGapDays: null,
    relatedLabels: [],
    categoryName,
    precedentMonths: null,
    unit: unit,
  };

  let raw: number | null = null;
  let basis: BulkEstimateBasis = 'default';
  let confidence: BulkConfidence = 'none';

  // R0 — the household's own previous decision for this product.
  const precedent = productRows
    .filter(
      (row) =>
        hasBulkPlan(row) &&
        monthIndexOf(monthKeyOf(row.expense_date)) >= purchaseMonthIndex - PRECEDENT_LOOKBACK_MONTHS,
    )
    .sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1))[0];
  if (precedent && hasBulkPlan(precedent) && equivOf(precedent) > 0 && equivNew > 0) {
    let scale = equivNew / equivOf(precedent);
    const precedentUnit = normalizeUnit(precedent.bulk.unit);
    if (
      input.quantity &&
      input.quantity > 0 &&
      unit &&
      precedent.bulk.quantity &&
      precedent.bulk.quantity > 0 &&
      precedentUnit === unit
    ) {
      scale = input.quantity / precedent.bulk.quantity;
    }
    raw = precedent.bulk.months * scale;
    basis = 'own_precedent';
    confidence = 'high';
    evidence.precedentMonths = precedent.bulk.months;
  }

  // R1 (+ R2 as a cross-check) — the product's own rate and cadence.
  if (raw === null && equivNew > 0) {
    const rate = rateEstimate(productRows, purchaseMonthIndex, equivNew);
    const cadence = cadenceEstimate(productRows, purchaseMonthIndex, equivNew);
    if (rate) {
      raw = rate.raw;
      basis = 'product_rate';
      confidence =
        rate.events >= HIGH_CONFIDENCE_EVENTS && rate.spanMonths >= HIGH_CONFIDENCE_SPAN ? 'high' : 'medium';
      evidence.eventCount = rate.events;
      evidence.firstEventDate = rate.firstEventDate;
      evidence.monthlyRateCents = rate.monthlyRateCents;
      if (cadence) {
        const spread = Math.abs(rate.raw - cadence.raw) / Math.max(rate.raw, cadence.raw);
        if (spread <= CADENCE_AGREE) confidence = shiftConfidence(confidence, 1);
        else if (spread > CADENCE_DISAGREE) confidence = shiftConfidence(confidence, -1);
        raw = (rate.raw + cadence.raw) / 2;
        evidence.medianGapDays = cadence.gapDays;
      }
    } else if (cadence) {
      raw = cadence.raw;
      basis = 'product_cadence';
      confidence = 'medium';
      evidence.eventCount = cadence.events;
      evidence.medianGapDays = cadence.gapDays;
    }
  }

  // R3 — what the household calls the same thing by other names.
  if (raw === null && equivNew > 0 && relatedKeys.size > 0) {
    const relatedRows = history.filter((row) => relatedKeys.has(normalizeProductKey(row.title)));
    if (relatedRows.length > 0) {
      const rate = rateEstimate([...productRows, ...relatedRows], purchaseMonthIndex, equivNew);
      if (rate) {
        raw = rate.raw;
        basis = 'related_products';
        confidence = 'medium';
        evidence.eventCount = rate.events;
        evidence.firstEventDate = rate.firstEventDate;
        evidence.monthlyRateCents = rate.monthlyRateCents;
        const labels = new Map<string, Expense>();
        for (const row of relatedRows) {
          const rowKey = normalizeProductKey(row.title);
          const current = labels.get(rowKey);
          if (!current || row.expense_date > current.expense_date) labels.set(rowKey, row);
        }
        evidence.relatedLabels = [...labels.values()]
          .sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1))
          .map((row) => row.title.trim())
          .slice(0, 3);
      }
    }
  }

  // R4 — a narrow category's rate.
  if (raw === null && equivNew > 0 && input.categoryId) {
    const categoryRows = history.filter((row) => row.category_id === input.categoryId);
    const estimate = categoryEstimate(categoryRows, purchaseMonthIndex, equivNew, new Set([key, ...relatedKeys]));
    if (estimate) {
      raw = estimate.raw;
      basis = 'category_rate';
      confidence = 'low';
      evidence.monthlyRateCents = estimate.monthlyRateCents;
    }
  }

  // R5 — say so.
  if (raw === null) {
    raw = BULK_DEFAULT_MONTHS;
    basis = 'default';
    confidence = 'none';
  }

  return {
    months: clampMonths(raw),
    rawMonths: Math.round(raw * 100) / 100,
    basis,
    confidence,
    looksRegularSize: basis !== 'default' && raw < REGULAR_SIZE_THRESHOLD,
    evidence,
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function sinceLabel(date: string, purchaseDate: string): string {
  const month = MONTH_NAMES[Number(date.slice(5, 7)) - 1] ?? date.slice(0, 7);
  return date.slice(0, 4) === purchaseDate.slice(0, 4) ? month : `${month} ${date.slice(0, 4)}`;
}

/**
 * The one sentence under the stepper. Money is formatted by the caller so the
 * copy follows the member's display currency like every other figure.
 */
export function describeBulkSuggestion(
  suggestion: BulkSuggestion,
  purchaseDate: string,
  formatMoney: (cents: number) => string,
): string {
  const { evidence } = suggestion;
  const label = evidence.productLabel || 'this';
  let sentence: string;
  switch (suggestion.basis) {
    case 'own_precedent':
      sentence = `Last time you spread ${label} over ${evidence.precedentMonths} months.`;
      break;
    case 'product_rate': {
      const since = evidence.firstEventDate ? ` since ${sinceLabel(evidence.firstEventDate, purchaseDate)}` : '';
      const rate = evidence.monthlyRateCents != null ? `, about ${formatMoney(evidence.monthlyRateCents)} a month` : '';
      sentence = `Based on ${evidence.eventCount} purchases of ${label}${since}${rate}.`;
      break;
    }
    case 'product_cadence':
      sentence = `Based on how often you buy ${label}: about every ${evidence.medianGapDays} days.`;
      break;
    case 'related_products':
      sentence = `Based on what you usually spend on ${evidence.relatedLabels.join(', ') || label}.`;
      break;
    case 'category_rate':
      sentence = `Based on what you usually spend on ${evidence.categoryName ?? 'this category'}.`;
      break;
    default:
      sentence = `No history for ${label} yet. Pick how many months it should last.`;
  }
  if (suggestion.looksRegularSize) {
    sentence += ' Looks like a normal-size purchase for you, so two months is the minimum.';
  }
  return sentence;
}
