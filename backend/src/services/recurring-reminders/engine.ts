import { and, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { householdMembers } from '../../db/schema';
import { recurringReminders, type RecurringReminder } from '../../db/schema-recurring-reminders';
import type { Env } from '../../types';
import { generateId, nowIso } from '../../utils/id';
import { releaseCronLease, tryAcquireCronLease } from '../cron-lease';
import { NotificationService } from '../notification-service';

import { computeNextNudge, DEFAULT_FREQUENCY, type FrequencyId } from './frequency';
import { getRecurringReminderTypeDef } from './registry';

const RECURRING_REMINDERS_CRON_JOB = 'recurring_reminders_due_sweep';
/** Bounds one cron tick's work — mirrors `processScheduledNotificationsWithClaims`'s own limit(100). */
const MAX_DUE_PER_TICK = 100;

export interface UpsertRecurringReminderParams {
  householdId: string;
  type: string;
  referenceId: string;
  /** e.g. '2026-08' — the recurrence period this row covers. */
  periodKey: string;
  title: string;
  body: string;
  /** Same shape as a push `data` payload — reused verbatim for both the push and the in-app tap. */
  data: Record<string, string>;
  /** When the FIRST nudge for this period should fire. */
  dueAt: Date;
  frequency?: FrequencyId;
}

/**
 * Create the pending reminder for one household+period (no-op if it already
 * exists — idempotent), and mark any older still-pending reminder for the same
 * (household, type, reference) as superseded. A newer period's row means
 * whatever the older one was chasing no longer needs its own nag — mirrors the
 * "roll forward, never stack" behaviour `statement-reminder.ts` had before.
 *
 * Best-effort: never throws, so a failure here can't fail the write (statement
 * commit, etc.) that triggered it.
 */
export async function upsertRecurringReminder(
  _env: Env,
  d1: D1Database,
  params: UpsertRecurringReminderParams
): Promise<void> {
  const { householdId, type, referenceId, periodKey, title, body, data, dueAt } = params;

  try {
    const typeDef = getRecurringReminderTypeDef(type);
    const frequency = params.frequency ?? typeDef?.defaultFrequency ?? DEFAULT_FREQUENCY;
    const db = drizzle(d1);

    const existing = await db
      .select({ id: recurringReminders.id })
      .from(recurringReminders)
      .where(
        and(
          eq(recurringReminders.household_id, householdId),
          eq(recurringReminders.type, type),
          eq(recurringReminders.reference_id, referenceId),
          eq(recurringReminders.period_key, periodKey)
        )
      )
      .get();
    if (existing) return;

    await db
      .update(recurringReminders)
      .set({
        status: 'done',
        completed_at: nowIso(),
        completed_reason: 'superseded',
        updated_at: nowIso(),
      })
      .where(
        and(
          eq(recurringReminders.household_id, householdId),
          eq(recurringReminders.type, type),
          eq(recurringReminders.reference_id, referenceId),
          eq(recurringReminders.status, 'pending'),
          ne(recurringReminders.period_key, periodKey)
        )
      );

    await db.insert(recurringReminders).values({
      id: generateId(),
      household_id: householdId,
      type,
      reference_type: typeDef?.referenceType ?? 'unknown',
      reference_id: referenceId,
      period_key: periodKey,
      status: 'pending',
      title,
      body,
      data: JSON.stringify(data),
      frequency,
      next_nudge_at: dueAt.toISOString(),
      last_nudged_at: null,
      nudge_count: 0,
      snoozed_until: null,
      completed_at: null,
      completed_by_user_id: null,
      completed_reason: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  } catch (error) {
    console.error('[recurring-reminders] upsert failed', {
      type: params.type,
      referenceId: params.referenceId,
      periodKey: params.periodKey,
      error: (error as Error).message,
    });
  }
}

/** Cron entry point — lease-guarded so overlapping ticks skip rather than double-nudge. */
export async function processDueRecurringReminders(env: Env, d1: D1Database): Promise<number> {
  const db = drizzle(d1);
  const leaseHolder = generateId();
  if (!(await tryAcquireCronLease(db, RECURRING_REMINDERS_CRON_JOB, leaseHolder))) return 0;

  try {
    return await processDueRecurringRemindersInner(env, d1);
  } finally {
    await releaseCronLease(db, RECURRING_REMINDERS_CRON_JOB, leaseHolder);
  }
}

async function processDueRecurringRemindersInner(env: Env, d1: D1Database): Promise<number> {
  const db = drizzle(d1);
  const now = nowIso();

  const due = await db
    .select()
    .from(recurringReminders)
    .where(
      and(
        eq(recurringReminders.status, 'pending'),
        lte(recurringReminders.next_nudge_at, now),
        or(isNull(recurringReminders.snoozed_until), lte(recurringReminders.snoozed_until, now))
      )
    )
    .limit(MAX_DUE_PER_TICK)
    .all();

  if (due.length === 0) return 0;

  const notifications = new NotificationService(env, d1);
  let nudged = 0;

  for (const row of due) {
    try {
      const typeDef = getRecurringReminderTypeDef(row.type);

      if (typeDef?.isSatisfied && (await typeDef.isSatisfied(env, d1, row))) {
        await db
          .update(recurringReminders)
          .set({
            status: 'done',
            completed_at: nowIso(),
            completed_reason: 'auto_detected',
            updated_at: nowIso(),
          })
          .where(eq(recurringReminders.id, row.id));
        continue;
      }

      // Household-scoped: nudge every active member, matching how
      // `statement-reminder.ts` fanned out before it moved onto this engine.
      const members = await db
        .select({ user_id: householdMembers.user_id })
        .from(householdMembers)
        .where(and(eq(householdMembers.household_id, row.household_id), isNull(householdMembers.deleted_at)))
        .all();

      let data: Record<string, string> = {};
      try {
        data = row.data ? (JSON.parse(row.data) as Record<string, string>) : {};
      } catch {
        data = {};
      }

      // Materialise into `scheduled_notifications` for "now" — delivery still
      // flows through the standard `processScheduledNotifications` sweep (run
      // right after this one in `cron/scheduled.ts`), never a bespoke path.
      for (const { user_id } of members) {
        await notifications.scheduleNotification({
          userId: user_id,
          householdId: row.household_id,
          type: row.type,
          title: row.title,
          body: row.body,
          data,
          scheduledFor: new Date(),
          referenceType: row.reference_type,
          referenceId: row.reference_id,
        });
      }

      const timezone = await notifications.resolveHouseholdTimezone(row.household_id);
      const nextNudgeAt = computeNextNudge(row.frequency, timezone);

      await db
        .update(recurringReminders)
        .set({
          last_nudged_at: nowIso(),
          nudge_count: row.nudge_count + 1,
          next_nudge_at: nextNudgeAt.toISOString(),
          snoozed_until: null,
          updated_at: nowIso(),
        })
        .where(eq(recurringReminders.id, row.id));

      nudged += 1;
    } catch (error) {
      console.error('[recurring-reminders] nudge failed', {
        id: row.id,
        type: row.type,
        error: (error as Error).message,
      });
    }
  }

  return nudged;
}

/** All still-pending reminders for a household, soonest-due first. */
export async function listActiveRecurringReminders(
  d1: D1Database,
  householdId: string
): Promise<RecurringReminder[]> {
  const db = drizzle(d1);
  return db
    .select()
    .from(recurringReminders)
    .where(and(eq(recurringReminders.household_id, householdId), eq(recurringReminders.status, 'pending')))
    .orderBy(recurringReminders.next_nudge_at)
    .all();
}

/** Manual "Mark done" — same effect whether tapped from the push or the in-app Active list. */
export async function completeRecurringReminder(
  d1: D1Database,
  householdId: string,
  id: string,
  userId: string
): Promise<RecurringReminder | null> {
  const db = drizzle(d1);
  const row = await db
    .select()
    .from(recurringReminders)
    .where(and(eq(recurringReminders.id, id), eq(recurringReminders.household_id, householdId)))
    .get();
  if (!row) return null;
  if (row.status === 'done') return row;

  const completed_at = nowIso();
  await db
    .update(recurringReminders)
    .set({
      status: 'done',
      completed_at,
      completed_by_user_id: userId,
      completed_reason: 'manual',
      updated_at: completed_at,
    })
    .where(eq(recurringReminders.id, id));

  return { ...row, status: 'done', completed_at, completed_by_user_id: userId, completed_reason: 'manual' };
}

/**
 * Stop nagging for one reference entirely (e.g. the underlying obligation was
 * deleted, not just satisfied) — marks any still-pending row for this
 * (type, reference) `done`/`cancelled` rather than waiting for the next
 * `upsertRecurringReminder` period to supersede it. Best-effort, mirrors the
 * other engine mutators.
 */
export async function cancelRecurringRemindersForReference(
  d1: D1Database,
  type: string,
  referenceId: string
): Promise<void> {
  try {
    const db = drizzle(d1);
    await db
      .update(recurringReminders)
      .set({
        status: 'done',
        completed_at: nowIso(),
        completed_reason: 'cancelled',
        updated_at: nowIso(),
      })
      .where(
        and(
          eq(recurringReminders.type, type),
          eq(recurringReminders.reference_id, referenceId),
          eq(recurringReminders.status, 'pending')
        )
      );
  } catch (error) {
    console.error('[recurring-reminders] cancel failed', {
      type,
      referenceId,
      error: (error as Error).message,
    });
  }
}

/**
 * Change how often a still-pending reminder re-nudges. Deliberately does both
 * at once — defers the very next nudge to the new cadence AND keeps using that
 * cadence going forward — so "snooze this" and "change my reminder frequency"
 * are the same user action (see `frequency.ts`).
 */
export async function setRecurringReminderFrequency(
  env: Env,
  d1: D1Database,
  householdId: string,
  id: string,
  frequency: FrequencyId
): Promise<RecurringReminder | null> {
  const db = drizzle(d1);
  const row = await db
    .select()
    .from(recurringReminders)
    .where(and(eq(recurringReminders.id, id), eq(recurringReminders.household_id, householdId)))
    .get();
  if (!row || row.status !== 'pending') return row ?? null;

  const notifications = new NotificationService(env, d1);
  const timezone = await notifications.resolveHouseholdTimezone(householdId);
  const nextNudgeAt = computeNextNudge(frequency, timezone);
  const updated_at = nowIso();

  await db
    .update(recurringReminders)
    .set({ frequency, next_nudge_at: nextNudgeAt.toISOString(), snoozed_until: null, updated_at })
    .where(eq(recurringReminders.id, id));

  return { ...row, frequency, next_nudge_at: nextNudgeAt.toISOString(), snoozed_until: null, updated_at };
}
