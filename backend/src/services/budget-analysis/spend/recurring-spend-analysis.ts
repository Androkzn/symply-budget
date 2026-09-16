/**
 * Monthly regular spending analysis — registered recurring bills plus
 * expense-history pattern detection. Shared by chat and future Spendings UI.
 */
import type { Env } from '../../../types';
import { BudgetService } from '../../budget-service';
import { SavingsService } from '../../savings-service';
import { fmtCents, monthKeys, resolveYearMonth } from '../money';

export interface RegisteredRecurringItem {
  id: string;
  label: string;
  amountCents: number;
  groupLabel: string | null;
  active: boolean;
}

export interface DetectedRecurringItem {
  /** Normalized title/vendor key shown to the user. */
  label: string;
  /** Distinct months with at least one matching expense. */
  monthsSeen: number;
  /** Mean monthly amount across months that had spend (cents). */
  avgMonthlyCents: number;
  /** Sum across the analysis window (cents). */
  totalCents: number;
  /** Source of the match key. */
  matchOn: 'title' | 'vendor';
}

export interface RecurringSpendAnalysisResult {
  months: string[];
  registered: RegisteredRecurringItem[];
  registeredMonthlyCents: number;
  detected: DetectedRecurringItem[];
  detectedMonthlyCents: number;
  /** registered + detected estimate (cents/month). */
  estimatedTotalMonthlyCents: number;
  summary: string;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function displayLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export class RecurringSpendAnalysis {
  private budget: BudgetService;
  private savings: SavingsService;

  constructor(env: Env, d1: D1Database) {
    this.budget = new BudgetService(env, d1);
    this.savings = new SavingsService(env, d1);
  }

  async analyze(
    householdId: string,
    userId: string,
    input: {
      month?: string;
      /** How many months of expense history to scan (default 6, max 24). */
      months?: number;
      /** Min distinct months a title/vendor must appear to count as regular. */
      minMonths?: number;
      nowIso: string;
    }
  ): Promise<RecurringSpendAnalysisResult> {
    const monthsBack = Math.min(Math.max(Number(input.months) || 6, 2), 24);
    const minMonths = Math.min(Math.max(Number(input.minMonths) || 3, 2), monthsBack);
    const { year, month, label } = resolveYearMonth(input.month, input.nowIso);
    const months = monthKeys(year, month, monthsBack);
    const startDate = `${months[0]}-01`;
    const endExclusiveDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

    let registered: RegisteredRecurringItem[] = [];
    let registeredMonthlyCents = 0;
    try {
      const view = await this.savings.listRecurringPayments(householdId, userId);
      registered = (view.items ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        amountCents: r.amount_cents,
        groupLabel: r.group_label ?? null,
        active: !!r.active,
      }));
      registeredMonthlyCents = view.totalMonthlyCents ?? 0;
    } catch {
      // Savings may be disabled — still return expense-detected patterns.
      registered = [];
      registeredMonthlyCents = 0;
    }

    const expenses = await this.budget.getExpenses(householdId, userId, {
      startDate,
      endDate: endExclusiveDate,
      limit: 500,
    });

    type Acc = {
      label: string;
      matchOn: 'title' | 'vendor';
      byMonth: Map<string, number>;
    };
    const buckets = new Map<string, Acc>();

    for (const e of expenses) {
      const ym = e.expense_date.slice(0, 7);
      if (!months.includes(ym)) continue;

      const vendor = e.vendor?.trim();
      const rawKey = vendor && vendor.length >= 2 ? vendor : e.title;
      const matchOn: 'title' | 'vendor' = vendor && vendor.length >= 2 ? 'vendor' : 'title';
      const key = `${matchOn}:${normalizeKey(rawKey)}`;
      if (normalizeKey(rawKey).length < 2) continue;

      let acc = buckets.get(key);
      if (!acc) {
        acc = { label: displayLabel(rawKey), matchOn, byMonth: new Map() };
        buckets.set(key, acc);
      }
      acc.byMonth.set(ym, (acc.byMonth.get(ym) ?? 0) + e.amount);
    }

    const detected: DetectedRecurringItem[] = [...buckets.values()]
      .map((acc) => {
        const monthsSeen = acc.byMonth.size;
        const totalCents = [...acc.byMonth.values()].reduce((s, v) => s + v, 0);
        const avgMonthlyCents =
          monthsSeen > 0 ? Math.round(totalCents / monthsSeen) : 0;
        return {
          label: acc.label,
          monthsSeen,
          avgMonthlyCents,
          totalCents,
          matchOn: acc.matchOn,
        };
      })
      .filter((d) => d.monthsSeen >= minMonths)
      .sort((a, b) => b.avgMonthlyCents - a.avgMonthlyCents)
      .slice(0, 20);

    // Avoid double-counting registered labels that also appear as detected.
    const registeredKeys = new Set(
      registered.filter((r) => r.active).map((r) => normalizeKey(r.label))
    );
    const detectedUnique = detected.filter((d) => !registeredKeys.has(normalizeKey(d.label)));
    const detectedMonthlyCents = detectedUnique.reduce((s, d) => s + d.avgMonthlyCents, 0);
    const estimatedTotalMonthlyCents = registeredMonthlyCents + detectedMonthlyCents;

    const regLines =
      registered.filter((r) => r.active).length === 0
        ? '  (none recorded)'
        : registered
            .filter((r) => r.active)
            .slice(0, 15)
            .map(
              (r) =>
                `  • ${r.label} ${fmtCents(r.amountCents)}/mo` +
                (r.groupLabel ? ` · ${r.groupLabel}` : '')
            )
            .join('\n');

    const detLines =
      detectedUnique.length === 0
        ? `  (none with ≥${minMonths} months in window)`
        : detectedUnique
            .slice(0, 12)
            .map(
              (d) =>
                `  • ${d.label} ~${fmtCents(d.avgMonthlyCents)}/mo` +
                ` (${d.monthsSeen}/${monthsBack} mo, via ${d.matchOn})`
            )
            .join('\n');

    const summary =
      `Regular monthly spending ending ${label} (${monthsBack} months):\n` +
      `Registered recurring: ${fmtCents(registeredMonthlyCents)}/mo\n${regLines}\n` +
      `Detected from expenses: ~${fmtCents(detectedMonthlyCents)}/mo\n${detLines}\n` +
      `Estimated combined: ~${fmtCents(estimatedTotalMonthlyCents)}/mo.`;

    return {
      months,
      registered,
      registeredMonthlyCents,
      detected: detectedUnique,
      detectedMonthlyCents,
      estimatedTotalMonthlyCents,
      summary,
    };
  }
}
