import type { MortgageScheduleRow, MortgageStatement, MortgageTerm } from '@api/mortgage';
import type { AppLinePoint } from '@components/ui/AppLineChart';

/**
 * Pure chart-data mappers for the Mortgage views. Kept out of the components so
 * the (money) transforms are unit-testable without rendering. All inputs are in
 * cents; outputs are in dollars for `AppBarChart` / `AppLineChart`.
 *
 * NOTE the labels here: anything sampled by PAYMENT INDEX ("#145") is for a
 * developer-facing/trend series only. Member-facing period charts bucket by
 * calendar month/year instead — see `paymentsInsights.ts`.
 */

/** Interest-paid-per-sample (single value) — the interest trend line/bars. */
export function buildInterestSeries(rows: MortgageScheduleRow[], maxPoints = 12): AppLinePoint[] {
  if (rows.length === 0) return [];
  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const points: AppLinePoint[] = [];
  for (let idx = 0; idx < rows.length; idx += step) {
    points.push({ value: Math.max(0, rows[idx].interest / 100), label: `#${rows[idx].index}` });
  }
  return points;
}

/** One point per term — the interest-rate history (step line). Rate in %. */
export function buildRateHistory(terms: MortgageTerm[]): AppLinePoint[] {
  return [...terms]
    .sort((a, b) => a.sequence - b.sequence)
    .map((t) => ({
      value: t.nominal_rate_bps / 100,
      label: t.term_start_date.slice(0, 4), // year
    }));
}

/**
 * Actual rate MOVEMENT across uploaded statements (step line, %). This is what
 * a variable-rate borrower most wants to see: how the rate they're actually
 * paying has drifted statement-to-statement — the reason the lifetime cost was
 * unknown at signing. Only statements that reported a rate are plotted (oldest
 * first). `YYYY-MM` labels so multiple statements in a year stay distinct.
 */
export function buildStatementRateHistory(statements: MortgageStatement[]): AppLinePoint[] {
  return [...statements]
    .filter((s) => s.interest_rate_bps != null && s.interest_rate_bps > 0)
    .sort((a, b) => a.statement_date.localeCompare(b.statement_date))
    .map((s) => ({
      value: (s.interest_rate_bps as number) / 100,
      label: s.statement_date.slice(0, 7), // YYYY-MM
    }));
}

/** Equity breakdown segments (down / paydown / appreciation) in dollars. */
export function buildEquitySegments(
  equity: {
    downPaymentCents: number;
    paydownEquityCents: number;
    appreciationEquityCents: number;
    hasAppreciation: boolean;
  },
  colors: { down: string; paydown: string; appreciation: string }
): Array<{ label: string; value: number; color: string }> {
  const out = [
    { label: 'Down payment', value: Math.max(0, equity.downPaymentCents / 100), color: colors.down },
    { label: 'Paydown', value: Math.max(0, equity.paydownEquityCents / 100), color: colors.paydown },
  ];
  if (equity.hasAppreciation) {
    out.push({
      label: 'Appreciation',
      value: Math.max(0, equity.appreciationEquityCents / 100),
      color: colors.appreciation,
    });
  }
  return out;
}
