/**
 * Trigger: `anniversary_of_past_event` — plan §D9.
 *
 * Reads `assistant_memory WHERE is_anniversary_tracked = 1` for the household
 * and checks (in TypeScript, NOT SQL) whether today's month-day matches the
 * `created_at` month-day. Project convention bans SQL date-format
 * scalar calls in application code; D1 SQLite has no MONTH()/DAY()
 * scalar functions either; the per-household
 * anniversary set is small (tens of rows, not thousands) so an in-memory
 * filter is cheap and portable.
 *
 * Severity 2 — nostalgic / helpful nudge, never urgent.
 */

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { assistantMemory } from '../../../db/schema-aihousekeeper';
import { assistantIdentity } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';
import { dateInTimezone } from '../timezone';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'anniversary_of_past_event';

export const anniversaryOfPastEventTrigger: Trigger = {
  id: TRIGGER_ID,
  // Daily — anniversary status only changes at local midnight.
  cadenceMinutes: 360,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);

    // Prefer the household's local date so anniversaries align to the user's
    // calendar day rather than UTC. Fall back to UTC if identity is missing.
    const identity = await db
      .select({ timezone: assistantIdentity.timezone })
      .from(assistantIdentity)
      .where(eq(assistantIdentity.household_id, householdId))
      .get();
    const tz = identity?.timezone ?? 'UTC';
    const localToday = dateInTimezone(now, tz); // YYYY-MM-DD
    const todayMonthDay = localToday.slice(5); // MM-DD

    const tracked = await db
      .select({
        id: assistantMemory.id,
        body: assistantMemory.body,
        redacted_body: assistantMemory.redacted_body,
        created_at: assistantMemory.created_at,
      })
      .from(assistantMemory)
      .where(
        and(
          eq(assistantMemory.household_id, householdId),
          eq(assistantMemory.is_anniversary_tracked, true)
        )
      )
      .limit(200)
      .all();

    // In-TS month-day matching. `created_at` is an ISO timestamp string
    // (datetime('now')), first 10 chars are YYYY-MM-DD.
    const matches = tracked.filter((m) => {
      const createdDate = (m.created_at ?? '').slice(0, 10);
      if (createdDate.length !== 10) return false;
      const monthDay = createdDate.slice(5);
      // Only fire on true anniversaries (different year, same month-day).
      if (createdDate === localToday) return false;
      return monthDay === todayMonthDay;
    });

    if (matches.length === 0) return null;

    const ids = matches.map((m) => m.id).join(',');
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${localToday}:${ids}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 2,
      kind: 'nudge',
      payload: {
        date: localToday,
        anniversaries: matches.map((m) => ({
          id: m.id,
          body: m.redacted_body ?? m.body,
          originalDate: (m.created_at ?? '').slice(0, 10),
        })),
      },
      idempotencyKey,
    };
  },
};
