/**
 * Trigger: `followup_due` — plan §D6.
 *
 * Reads `assistant_followups WHERE status='pending' AND scheduled_for <= now`
 * for the household. Every due followup surfaces as a single TriggerResult;
 * the actual fire/silent-close decision is delegated to `FollowupRunner`
 * downstream (§B7) — this trigger is only a signal.
 *
 * Severity 3 — followups are user-authored reminders, middle of the road.
 */

import { and, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { assistantFollowups } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'followup_due';

export const followupDueTrigger: Trigger = {
  id: TRIGGER_ID,
  // Every 15 min; the status='pending' AND scheduled_for<=now filter keeps
  // the query cheap, and followups are time-sensitive.
  cadenceMinutes: 15,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const nowIso = now.toISOString();

    const due = await db
      .select({
        id: assistantFollowups.id,
        prompt: assistantFollowups.prompt,
        scheduled_for: assistantFollowups.scheduled_for,
        origin: assistantFollowups.origin,
        context_ref_json: assistantFollowups.context_ref_json,
      })
      .from(assistantFollowups)
      .where(
        and(
          eq(assistantFollowups.household_id, householdId),
          eq(assistantFollowups.status, 'pending'),
          lte(assistantFollowups.scheduled_for, nowIso)
        )
      )
      .limit(10)
      .all();

    if (due.length === 0) return null;

    const ids = due.map((d) => d.id).join(',');
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${ids}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 3,
      kind: 'followup',
      payload: {
        followups: due.map((d) => ({
          id: d.id,
          prompt: d.prompt,
          scheduledFor: d.scheduled_for,
          origin: d.origin,
          contextRefJson: d.context_ref_json,
        })),
      },
      idempotencyKey,
    };
  },
};
