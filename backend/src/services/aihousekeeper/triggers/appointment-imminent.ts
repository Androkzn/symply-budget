/**
 * Trigger: `appointment_imminent` — plan §D5.
 *
 * Fires when an appointment is scheduled within the next 24 hours. Source:
 * `appointments` table (schema-labor-hub.ts) — status in ('pending',
 * 'confirmed') and scheduled_date within the window.
 *
 * Severity 4 — reminder-class nudge; users expect same-day confirmation.
 *
 * We dedupe per (householdId, appointmentId, local-date) so a user gets at
 * most one imminent-reminder per appointment per day even across retries.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { appointments } from '../../../db/schema-labor-hub';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'appointment_imminent';
const WINDOW_HOURS = 24;

export const appointmentImminentTrigger: Trigger = {
  id: TRIGGER_ID,
  cadenceMinutes: 60,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const nowIso = now.toISOString();
    const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 3600_000).toISOString();

    const rows = await db
      .select({
        id: appointments.id,
        title: appointments.title,
        scheduled_date: appointments.scheduled_date,
        scheduled_time_start: appointments.scheduled_time_start,
        contractor_id: appointments.contractor_id,
        status: appointments.status,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.household_id, householdId),
          inArray(appointments.status, ['pending', 'confirmed']),
          gte(appointments.scheduled_date, nowIso.slice(0, 10)),
          lte(appointments.scheduled_date, windowEnd.slice(0, 10))
        )
      )
      .limit(10)
      .all();

    if (rows.length === 0) return null;

    // Pick the earliest imminent one as the representative result.
    const first = rows[0];
    const today = nowIso.slice(0, 10);
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${first.id}:${today}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 4,
      kind: 'nudge',
      payload: {
        appointments: rows.map((r) => ({
          id: r.id,
          title: r.title,
          scheduledDate: r.scheduled_date,
          scheduledTimeStart: r.scheduled_time_start,
          contractorId: r.contractor_id,
          status: r.status,
        })),
      },
      idempotencyKey,
    };
  },
};
