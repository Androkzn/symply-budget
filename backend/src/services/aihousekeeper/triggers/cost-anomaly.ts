/**
 * Trigger: `cost_anomaly` — plan §D11.
 *
 * Fires when the current-month total spend for a household exceeds 1.5× the
 * trailing 3-month average. Severity 3.
 *
 * Uses `totalSpendBetween` from `backend/src/services/budget-service.ts`
 * (system-path aggregate that skips the user-auth check — safe because the
 * trigger runs in the scheduled Worker context without a user identity and
 * the household filter is part of the WHERE clause).
 */

import type { Env } from '../../../types';
import { totalSpendBetween } from '../../budget-service';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'cost_anomaly';
const ANOMALY_MULTIPLIER = 1.5;

// Returns YYYY-MM-01 for the given Date in UTC.
function monthStartIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Shifts a Date back by N months while preserving day=1.
function monthsAgo(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
}

export const costAnomalyTrigger: Trigger = {
  id: TRIGGER_ID,
  // Daily scan is plenty; month-over-month doesn't change minute-to-minute.
  cadenceMinutes: 720,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const currentStart = monthStartIso(now);
    const nextMonthStart = monthStartIso(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    );
    const threeMonthsAgoStart = monthStartIso(monthsAgo(now, 3));

    // Current month-to-date spend.
    const currentSpend = await totalSpendBetween(
      env.DB,
      householdId,
      currentStart,
      nextMonthStart
    );
    // Trailing 3 months (previous, not including current).
    const trailingSpend = await totalSpendBetween(
      env.DB,
      householdId,
      threeMonthsAgoStart,
      currentStart
    );

    const trailingAvg = trailingSpend / 3;
    // Guard against cold-start / empty history. We need a non-trivial
    // baseline before claiming anomaly, else the very first expense trips it.
    if (trailingAvg <= 0 || currentSpend <= 0) return null;
    if (currentSpend < trailingAvg * ANOMALY_MULTIPLIER) return null;

    // One fire per household per calendar month.
    const monthKey = currentStart.slice(0, 7); // YYYY-MM
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${monthKey}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 3,
      kind: 'nudge',
      payload: {
        monthKey,
        currentSpendCents: currentSpend,
        trailingAvgCents: Math.round(trailingAvg),
        multiplier: ANOMALY_MULTIPLIER,
        samples: {
          windowStart: threeMonthsAgoStart,
          currentStart,
        },
      },
      idempotencyKey,
    };
  },
};
