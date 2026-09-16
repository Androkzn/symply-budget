import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { z } from 'zod';

import { householdMembers } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import {
  completeRecurringReminder,
  listActiveRecurringReminders,
  setRecurringReminderFrequency,
} from '../services/recurring-reminders/engine';
import { FREQUENCY_PRESETS, isValidFrequency, type FrequencyId } from '../services/recurring-reminders/frequency';
import type { Env } from '../types';
import { ForbiddenError } from '../utils/errors';

/**
 * The user-facing half of the recurring-reminders engine (`services/recurring-reminders/`):
 * list what's still pending for a household, mark one done, or change how often
 * it re-nudges. Brand-agnostic — mounted under `/households/:householdId/recurring-reminders`
 * on every Worker (mirrors `scheduled_notifications`/`notification_history`), same as the
 * shared chat routes. A tap on the push notification itself and a tap on the in-app
 * "Active" list both resolve to these same two actions.
 */
const recurringReminders = new Hono<{ Bindings: Env }>();

recurringReminders.use('/*', authMiddleware());

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

async function assertHouseholdMember(env: Env, householdId: string, userId: string): Promise<void> {
  const db = drizzle(env.DB);
  const member = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
    .get();
  if (!member) throw new ForbiddenError('You do not have access to this household');
}

/** GET / → still-pending reminders for the household + the frequency picker's options. */
recurringReminders.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertHouseholdMember(c.env, householdId, userId);

  const reminders = await listActiveRecurringReminders(c.env.DB, householdId);
  return c.json({ reminders, frequencyOptions: FREQUENCY_PRESETS });
});

/** POST /:id/complete → "Mark done"; stops further nudges for this period. */
recurringReminders.post('/:id/complete', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertHouseholdMember(c.env, householdId, userId);

  const reminder = await completeRecurringReminder(c.env.DB, householdId, c.req.param('id'), userId);
  if (!reminder) return c.json({ error: 'Not found' }, 404);
  return c.json({ reminder });
});

const frequencySchema = z.object({
  frequency: z.string().refine(isValidFrequency, { message: 'Invalid frequency' }),
});

/** POST /:id/frequency → change cadence; also defers the very next nudge to it. */
recurringReminders.post('/:id/frequency', zValidator('json', frequencySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertHouseholdMember(c.env, householdId, userId);

  const { frequency } = c.req.valid('json');
  const reminder = await setRecurringReminderFrequency(
    c.env,
    c.env.DB,
    householdId,
    c.req.param('id'),
    frequency as FrequencyId
  );
  if (!reminder) return c.json({ error: 'Not found' }, 404);
  return c.json({ reminder });
});

export default recurringReminders;
