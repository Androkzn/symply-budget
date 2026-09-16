/**
 * Trigger: `new_inspection_findings` — plan §D8.
 *
 * Fires when a `reports` row transitions to status='completed' with
 * total_findings_count > 0 in the last scan window. Aihousekeeper surfaces a summary
 * so the user can route into the report detail screen.
 *
 * We detect newness by comparing `processing_completed_at` against a recent
 * window (current tick - cadence * 2) rather than maintaining a per-report
 * dispatched flag — the idempotencyKey (report id + completion timestamp)
 * keeps duplicates out of the outbound log.
 *
 * Severity 3 — informational; critical findings push severity to 4.
 */

import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { reports } from '../../../db/schema';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult, type TriggerSeverity } from './index';

const TRIGGER_ID = 'new_inspection_findings';
const LOOKBACK_HOURS = 2;

export const newInspectionFindingsTrigger: Trigger = {
  id: TRIGGER_ID,
  cadenceMinutes: 60,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const lookbackIso = new Date(
      now.getTime() - LOOKBACK_HOURS * 3600_000
    ).toISOString();

    const recent = await db
      .select({
        id: reports.id,
        filename: reports.filename,
        total_findings_count: reports.total_findings_count,
        critical_findings_count: reports.critical_findings_count,
        processing_completed_at: reports.processing_completed_at,
      })
      .from(reports)
      .where(
        and(
          eq(reports.household_id, householdId),
          eq(reports.status, 'completed'),
          gt(reports.processing_completed_at, lookbackIso)
        )
      )
      .limit(5)
      .all();

    if (recent.length === 0) return null;

    // Filter to those that actually have findings.
    const withFindings = recent.filter(
      (r) => (r.total_findings_count ?? 0) > 0
    );
    if (withFindings.length === 0) return null;

    const totalCritical = withFindings.reduce(
      (sum, r) => sum + (r.critical_findings_count ?? 0),
      0
    );
    const severity: TriggerSeverity = totalCritical > 0 ? 4 : 3;

    const signature = withFindings
      .map((r) => `${r.id}@${r.processing_completed_at}`)
      .join('|');
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${signature}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity,
      kind: 'nudge',
      payload: {
        reports: withFindings.map((r) => ({
          id: r.id,
          filename: r.filename,
          totalFindings: r.total_findings_count ?? 0,
          criticalFindings: r.critical_findings_count ?? 0,
          completedAt: r.processing_completed_at,
        })),
        totalCritical,
      },
      idempotencyKey,
    };
  },
};
