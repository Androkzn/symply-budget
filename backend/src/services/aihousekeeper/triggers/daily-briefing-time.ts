/**
 * Trigger: `daily_briefing_time` — plan §D2.
 *
 * Fires once per household per local-day when the current hour in the
 * household's timezone matches `assistant_identity.briefing_time`.
 *
 * This is the primary "briefing due" signal. It does not itself compose the
 * briefing — Stream F's `composeBriefingsDueThisHour` (§F3) handles that —
 * but we surface a `TriggerResult` so the outbound consumer can coordinate
 * push dispatch alongside other signals for this household.
 *
 * Severity 2: friendly, non-urgent morning greeting.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { assistantIdentity } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';
import { dateInTimezone, hourInTimezone } from '../timezone';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'daily_briefing_time';

export const dailyBriefingTimeTrigger: Trigger = {
  id: TRIGGER_ID,
  // Evaluate every tick; the identity hour-match and idempotencyKey pin it
  // to exactly one fire per local day.
  cadenceMinutes: 15,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const identity = await db
      .select({
        briefing_time: assistantIdentity.briefing_time,
        timezone: assistantIdentity.timezone,
      })
      .from(assistantIdentity)
      .where(eq(assistantIdentity.household_id, householdId))
      .get();

    if (!identity) return null;

    const targetHour = parseInt(identity.briefing_time.split(':')[0] ?? '7', 10);
    if (Number.isNaN(targetHour)) return null;

    const localHour = hourInTimezone(now, identity.timezone);
    if (localHour !== targetHour) return null;

    const localDate = dateInTimezone(now, identity.timezone);
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${localDate}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 2,
      kind: 'briefing',
      payload: {
        date: localDate,
        briefingTime: identity.briefing_time,
        timezone: identity.timezone,
      },
      idempotencyKey,
    };
  },
};
