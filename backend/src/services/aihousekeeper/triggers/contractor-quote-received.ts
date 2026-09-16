/**
 * Trigger: `contractor_quote_received` — plan §D12.
 *
 * Fires when a new `contractor_quotes` row has appeared for the household in
 * the last lookback window and has status='pending' (i.e. the homeowner
 * hasn't yet accepted/rejected). Severity 4 — time-sensitive decision.
 *
 * Newness is defined by `submitted_at` falling inside the lookback window.
 * Idempotency is per-(householdId, quoteId, submitted_at) so even if the
 * quote row is updated (e.g. status flip), we don't re-fire for the same
 * submission.
 */

import { and, desc, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { contractorQuotes } from '../../../db/schema-contractors';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'contractor_quote_received';
const LOOKBACK_HOURS = 24;

export const contractorQuoteReceivedTrigger: Trigger = {
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
        id: contractorQuotes.id,
        task_id: contractorQuotes.task_id,
        contractor_id: contractorQuotes.contractor_id,
        amount: contractorQuotes.amount,
        currency: contractorQuotes.currency,
        submitted_at: contractorQuotes.submitted_at,
        status: contractorQuotes.status,
      })
      .from(contractorQuotes)
      .where(
        and(
          eq(contractorQuotes.household_id, householdId),
          eq(contractorQuotes.status, 'pending'),
          gt(contractorQuotes.submitted_at, lookbackIso)
        )
      )
      .orderBy(desc(contractorQuotes.submitted_at))
      .limit(5)
      .all();

    if (recent.length === 0) return null;

    const signature = recent
      .map((q) => `${q.id}@${q.submitted_at}`)
      .join('|');
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${signature}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 4,
      kind: 'nudge',
      payload: {
        quotes: recent.map((q) => ({
          id: q.id,
          taskId: q.task_id,
          contractorId: q.contractor_id,
          amountCents: q.amount,
          currency: q.currency,
          submittedAt: q.submitted_at,
          status: q.status,
        })),
      },
      idempotencyKey,
    };
  },
};
