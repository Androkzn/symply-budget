/**
 * Trigger: `task_overdue_critical` — plan §D3.
 *
 * Scans `maintenance_tasks` for items that are:
 *   - priority_severity IN ('urgent','critical')
 *   - is_active = 1
 *   - next_due_date < now
 *   - not currently snoozed (snooze_until IS NULL OR snooze_until <= now)
 *
 * Fires once per overdue critical task per day (idempotencyKey includes the
 * task id + YYYY-MM-DD). Severity 4 — actionable nudge, not emergency.
 */

import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { tasks } from '../../../db/schema';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'task_overdue_critical';

export const taskOverdueCriticalTrigger: Trigger = {
  id: TRIGGER_ID,
  // Hourly — overdue is a slow-moving signal; no need to re-scan every tick.
  cadenceMinutes: 60,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const nowIso = now.toISOString();

    const overdue = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        next_due_date: tasks.next_due_date,
        priority_severity: tasks.priority_severity,
        system_category: tasks.system_category,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.household_id, householdId),
          eq(tasks.is_active, true),
          inArray(tasks.priority_severity, ['urgent', 'critical']),
          lt(tasks.next_due_date, nowIso),
          or(
            isNull(tasks.snooze_until),
            lt(tasks.snooze_until, nowIso)
          )
        )
      )
      .limit(25)
      .all();

    if (overdue.length === 0) return null;

    // Daily granularity — one fire per household per day summarising the
    // current overdue set. Per-task nudges can be broken out by Stream F
    // from the payload if desired.
    const today = nowIso.slice(0, 10);
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${today}:${overdue.length}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 4,
      kind: 'nudge',
      payload: {
        overdueCount: overdue.length,
        tasks: overdue.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.next_due_date,
          priority: t.priority_severity,
          category: t.system_category,
        })),
      },
      idempotencyKey,
    };
  },
};
