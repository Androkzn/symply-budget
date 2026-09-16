import type { MortgageRatePeriod, MortgageStatement, MortgageTerm, StoredRatePeriod } from '@api/mortgage';
import type { AppLinePoint } from '@components/ui/AppLineChart';

/**
 * Automatic rate-change detection from uploaded statements. A variable / HELOC
 * statement lists its interest in sub-periods ("Oct 01 – Oct 29 … 3.840", then
 * "Oct 30 – Oct 31 … 3.590"). Since migration 0118 each sub-period is a
 * `mortgage_rate_periods` row (the canonical, queryable rate axis); statements
 * captured before that still carry the same breakdown inside
 * `raw_extraction_json` as `{ ratePeriods }`, which is read as a fallback.
 *
 * This walks the union of every sub-period in date order and emits a change
 * whenever the rate differs from the previously-known rate — so the exact
 * effective date (Oct 30) surfaces even from a SINGLE upload, no manual entry.
 *
 * Pure + deterministic (no I/O, no clock) → fully unit-testable, matching the
 * other mortgage chart-data mappers.
 */

/** One detected rate change — the row the UI lists. bps (359 = 3.59%). */
export interface RateChangeRow {
  key: string;
  /** Effective date of the change, `YYYY-MM-DD`. */
  date: string;
  fromBps: number;
  toBps: number;
  /** toBps − fromBps: negative = a cut, positive = a hike. */
  deltaBps: number;
}

export interface RateChangeHistory {
  /** Step-line points (rate %), oldest → newest, for `AppLineChart`. */
  series: AppLinePoint[];
  /** Every detected change, NEWEST first (the list rows). */
  changes: RateChangeRow[];
}

interface Period {
  date: string;
  rateBps: number;
}

/** Safely read `{ ratePeriods }` out of a statement's raw_extraction_json. */
function parseStored(raw: string | null | undefined): StoredRatePeriod[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { ratePeriods?: StoredRatePeriod[] };
    return Array.isArray(parsed?.ratePeriods) ? parsed.ratePeriods : [];
  } catch {
    return [];
  }
}

/**
 * Flatten every statement into dated rate points. Prefers the stored sub-period
 * breakdown (exact mid-month dates); falls back to the statement's single
 * `interest_rate_bps` dated at the statement date when no breakdown was captured
 * (older rows / manual entry). Deduped by date (last write wins), oldest first.
 */
function collectPeriods(statements: MortgageStatement[]): Period[] {
  const byDate = new Map<string, number>();
  const ordered: Period[] = [];
  for (const s of statements) {
    const stored = parseStored(s.raw_extraction_json);
    if (stored.length) {
      for (const p of stored) {
        if (p.effectiveDate && typeof p.rateBps === 'number' && p.rateBps > 0) {
          ordered.push({ date: p.effectiveDate, rateBps: p.rateBps });
        }
      }
    } else if (s.interest_rate_bps != null && s.interest_rate_bps > 0) {
      ordered.push({ date: s.statement_date, rateBps: s.interest_rate_bps });
    }
  }
  ordered.sort((a, b) => a.date.localeCompare(b.date));
  for (const p of ordered) byDate.set(p.date, p.rateBps); // last (newest) wins per date
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rateBps]) => ({ date, rateBps }));
}

/**
 * Normalize stored `mortgage_rate_periods` rows into the internal dated series.
 * Deduped by effective date (last write wins), oldest first — same contract as
 * the statement-blob fallback so both feed one detector.
 */
function collectStoredPeriods(rows: MortgageRatePeriod[]): Period[] {
  const byDate = new Map<string, number>();
  for (const r of [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))) {
    if (r.effective_date && r.rate_bps > 0) byDate.set(r.effective_date, r.rate_bps);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rateBps]) => ({ date, rateBps }));
}

/**
 * Detect the rate changes across all statements. The origination term's rate is
 * the baseline (so the first statement rate that differs from the signed rate is
 * itself a change); the step line is seeded with that origination point.
 *
 * `ratePeriods` (the `mortgage_rate_periods` table) is the canonical source when
 * supplied; the statements are the fallback for rows captured before 0118.
 */
export function buildRateChangeHistory(
  statements: MortgageStatement[],
  terms: MortgageTerm[],
  ratePeriods?: MortgageRatePeriod[]
): RateChangeHistory {
  const periods =
    ratePeriods && ratePeriods.length > 0
      ? collectStoredPeriods(ratePeriods)
      : collectPeriods(statements);
  const firstTerm = [...terms].sort((a, b) => a.sequence - b.sequence)[0];
  const baselineBps =
    firstTerm && firstTerm.nominal_rate_bps > 0 ? firstTerm.nominal_rate_bps : null;

  const series: AppLinePoint[] = [];
  const changes: RateChangeRow[] = [];
  let prev: number | null = baselineBps;

  if (baselineBps != null && firstTerm) {
    series.push({ value: baselineBps / 100, label: firstTerm.term_start_date.slice(0, 7) });
  }

  for (const p of periods) {
    if (prev == null) {
      // No known baseline — the first observed rate sets the starting point and
      // is not itself a "change".
      prev = p.rateBps;
      series.push({ value: p.rateBps / 100, label: p.date.slice(0, 7) });
      continue;
    }
    if (p.rateBps !== prev) {
      changes.push({
        key: `${p.date}-${p.rateBps}`,
        date: p.date,
        fromBps: prev,
        toBps: p.rateBps,
        deltaBps: p.rateBps - prev,
      });
      series.push({ value: p.rateBps / 100, label: p.date.slice(0, 7) });
      prev = p.rateBps;
    }
  }

  changes.reverse(); // newest first for the list
  return { series, changes };
}
