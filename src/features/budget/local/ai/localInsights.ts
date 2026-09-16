/**
 * Monthly AI insights, generated on the device from the local ledger.
 *
 * Local-first Budget keeps the ledger on the phone, so the backend's
 * `BudgetInsightsService` has nothing to read: asking it for a summary of a
 * month it cannot see is why this method used to be a flat
 * `BudgetLocalUnsupportedError`. That error, though, reached the member as
 * "Insights need a connection" whether or not they had one — the local API
 * never checked. Everything needed to answer is already on the device; the one
 * thing that is not is a model, and the receipt/aiDetect ladders already have a
 * pattern for that: call the member's OWN provider key directly.
 *
 * So the guard is now about a KEY, not about the network — offline, a provider
 * call simply fails and the caller surfaces that failure. The month's totals
 * are computed locally either way (`overview` is handed in already computed);
 * the model only turns them into prose.
 */

import type { BudgetInsights, MonthlyOverview } from '@api/budget';

import { fnv1a } from '../../insights/budgetInsightsFingerprint';
import { getLocalLedgerFor } from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';

import { byokLog, generateStructuredByok, resolveLocalByokProvider } from './localByokClient';
import {
  BUDGET_INSIGHTS_SCHEMA,
  BUDGET_INSIGHTS_SYSTEM,
  buildLocalBudgetInsightsUserPrompt,
  type LocalBudgetInsightAlert,
  type LocalBudgetInsightResult,
} from './prompts/budgetInsights';

/** Keep the prompt bounded — a long tail of $2 categories adds tokens, not signal. */
const MAX_CATEGORY_ROWS = 12;
const MAX_PLANNED_ITEMS = 15;
const MAX_ALERTS = 5;
const MAX_RECOMMENDATIONS = 3;

const SEVERITIES = new Set<LocalBudgetInsightAlert['severity']>(['info', 'warning', 'critical']);

export interface LocalInsightsInput {
  householdId: string;
  year: number;
  month: number;
  /** Computed by the caller so this module never imports `localBudgetApi` back. */
  overview: MonthlyOverview;
  /** The member pressed Refresh: regenerate even if the month is unchanged. */
  forceRefresh?: boolean;
}

/**
 * Same contract as the remote transport, which stores an `input_hash` per
 * period and only re-asks the model when it changes (`BudgetInsightsService`,
 * 24h freshness). Local-first had none of it: every call reached the provider,
 * so a screen that asked twice paid twice — with the MEMBER's own key.
 *
 * The hash is taken over the finished prompt, which is exactly "what the model
 * would be asked": if that string is unchanged, its answer is too.
 */
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Recent periods only — this is a session cache, the store holds the durable one. */
const MAX_CACHED_PERIODS = 12;

interface LocalInsightsCacheEntry {
  promptHash: string;
  generatedAtMs: number;
  result: BudgetInsights;
}

const cache = new Map<string, LocalInsightsCacheEntry>();
/** One generation per household+period at a time, whoever asks. */
const inFlight = new Map<string, Promise<BudgetInsights>>();

function cacheKey(householdId: string, year: number, month: number): string {
  return `${householdId}|${monthPrefix(year, month)}`;
}

/** Test seam — module state outlives a single test. */
export function __resetLocalInsightsCache(): void {
  cache.clear();
  inFlight.clear();
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * A provider is free to answer with a missing array, a stray severity, or a
 * string where an integer belongs. The dashboard maps over `alerts` and
 * `recommendations` unguarded, so anything but an array crashes the card —
 * normalize before it ever reaches React.
 */
function normalizeResult(
  raw: Partial<LocalBudgetInsightResult> | null | undefined,
  fallbackBalance: number,
): LocalBudgetInsightResult {
  const alerts = Array.isArray(raw?.alerts) ? raw!.alerts : [];
  const recommendations = Array.isArray(raw?.recommendations) ? raw!.recommendations : [];
  const balance: unknown = raw?.projected_month_end_balance;
  const projected = typeof balance === 'number' || (typeof balance === 'string' && balance.trim())
    ? Number(balance) : NaN;

  return {
    summary: typeof raw?.summary === 'string' ? raw.summary.trim() : '',
    alerts: alerts
      .filter(
        (a): a is LocalBudgetInsightAlert =>
          !!a && typeof a.message === 'string' && a.message.trim().length > 0,
      )
      .slice(0, MAX_ALERTS)
      .map((a) => ({
        severity: SEVERITIES.has(a.severity) ? a.severity : 'info',
        message: a.message.trim(),
      })),
    recommendations: recommendations
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      .slice(0, MAX_RECOMMENDATIONS)
      .map((r) => r.trim()),
    projected_month_end_balance: Number.isFinite(projected)
      ? Math.round(projected)
      : fallbackBalance,
  };
}

export async function runLocalInsights(input: LocalInsightsInput): Promise<BudgetInsights> {
  // A second caller for the same month joins the first instead of opening a
  // second provider call — two mounted views, or a focus racing a data reload,
  // must not cost two generations.
  const key = cacheKey(input.householdId, input.year, input.month);
  const running = inFlight.get(key);
  if (running) return running;

  const promise = generateLocalInsights(input, key);
  inFlight.set(key, promise);
  const clear = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  void promise.then(clear, clear);
  return promise;
}

async function generateLocalInsights(
  input: LocalInsightsInput,
  key: string,
): Promise<BudgetInsights> {
  const { householdId, year, month, overview } = input;

  // Checked before any work: without a key there is no model to ask, and the
  // caller's copy for this error is what tells the member to connect one.
  const byok = await resolveLocalByokProvider();
  if (!byok) throw new BudgetLocalUnsupportedError('getInsights');

  const ledger = await getLocalLedgerFor(householdId);
  const categoryNames = new Map(ledger.categories.map((c) => [c.id, c.name]));

  const spentByCategory = new Map<string, number>();
  for (const expense of overview.expenses) {
    const name = expense.category_id
      ? categoryNames.get(expense.category_id) ?? 'Uncategorized'
      : 'Uncategorized';
    spentByCategory.set(name, (spentByCategory.get(name) ?? 0) + expense.amount);
  }
  const categories = [...spentByCategory.entries()]
    .map(([name, spentCents]) => ({ name, spentCents }))
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, MAX_CATEGORY_ROWS);

  const prev = previousMonth(year, month);
  const prevPrefix = monthPrefix(prev.year, prev.month);
  const priorRows = ledger.expenses.filter(
    (e) => e.household_id === householdId && e.expense_date.slice(0, 7) === prevPrefix,
  );
  const priorMonthActualSpent = priorRows.length
    ? priorRows.reduce((sum, e) => sum + e.amount, 0)
    : null;

  const plannedItems = overview.items.slice(0, MAX_PLANNED_ITEMS).map((item) => ({
    title: item.title,
    priority: item.priority,
    estimatedCost: item.estimated_cost_max ?? item.estimated_cost_min ?? 0,
  }));

  const userPrompt = buildLocalBudgetInsightsUserPrompt({
    year,
    month,
    plannedBudget: overview.plannedBudget,
    actualSpent: overview.actualSpent,
    committedTotal: overview.committedTotal,
    remainingBudget: overview.remainingBudget,
    savedTotal: overview.savedTotal,
    priorMonthActualSpent,
    categories,
    subBudgets: (overview.subBudgets?.entries ?? []).map((s) => ({
      name: s.name,
      capCents: s.cap_cents,
      spentCents: s.spent_cents,
      over: s.over,
    })),
    plannedItems,
  });

  // The month, hashed as the model would see it. An unchanged prompt has an
  // unchanged answer — reuse it rather than paying for the same paragraph again.
  const promptHash = fnv1a(userPrompt);
  const cached = cache.get(key);
  if (
    !input.forceRefresh &&
    cached &&
    cached.promptHash === promptHash &&
    Date.now() - cached.generatedAtMs < FRESHNESS_WINDOW_MS
  ) {
    byokLog('insights', {
      stage: 'cache-hit',
      period: monthPrefix(year, month),
      generatedAt: cached.result.generatedAt,
    });
    return { ...cached.result, cached: true };
  }

  // Counts only — never a category name, an item title, or the model's prose.
  byokLog('insights', {
    stage: 'request',
    provider: byok.provider,
    period: monthPrefix(year, month),
    categoryRows: categories.length,
    plannedItems: plannedItems.length,
    promptChars: userPrompt.length,
  });

  const raw = await generateStructuredByok<Partial<LocalBudgetInsightResult>>({
    systemPrompt: BUDGET_INSIGHTS_SYSTEM,
    userPrompt,
    schema: BUDGET_INSIGHTS_SCHEMA,
    maxTokens: 1024,
  });

  const result = normalizeResult(raw, overview.remainingBudget);
  byokLog('insights', {
    stage: 'response',
    provider: byok.provider,
    summaryChars: result.summary.length,
    summaryType: typeof raw?.summary,
    alerts: result.alerts.length,
    recommendations: result.recommendations.length,
  });

  // A partial answer is useful: do not discard alerts/recommendations because
  // the provider omitted its overview paragraph. Reject only empty prose.
  if (!result.summary && !result.alerts.length && !result.recommendations.length) {
    throw new Error('The AI provider returned no usable summary, alerts, or recommendations. Please try again.');
  }

  const insights: BudgetInsights = {
    ...result,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  cache.set(key, { promptHash, generatedAtMs: Date.now(), result: insights });
  if (cache.size > MAX_CACHED_PERIODS) {
    const oldest = [...cache.entries()].sort(
      (a, b) => a[1].generatedAtMs - b[1].generatedAtMs,
    )[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return insights;
}
