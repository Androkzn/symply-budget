/**
 * Trigger: `unresolved_question_aging` — plan §D7.
 *
 * Reads `assistant_memory WHERE type='unresolved_question' AND
 * created_at < now-14d AND superseded_by_id IS NULL`.
 *
 * Fires when Aihousekeeper has been sitting on an open question from the user for
 * more than two weeks without a resolution or supersession. Severity 2 — a
 * soft nudge to ask the question again, not urgent.
 */

import { and, eq, isNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { assistantMemory } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'unresolved_question_aging';
const AGING_DAYS = 14;

export const unresolvedQuestionAgingTrigger: Trigger = {
  id: TRIGGER_ID,
  // Daily-ish. KV guard TTL is 1h, but the list only changes on user writes
  // and age crossing 14d — polling every 6h is plenty.
  cadenceMinutes: 360,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const cutoffIso = new Date(
      now.getTime() - AGING_DAYS * 24 * 3600_000
    ).toISOString();

    const aged = await db
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
          eq(assistantMemory.type, 'unresolved_question'),
          isNull(assistantMemory.superseded_by_id),
          lt(assistantMemory.created_at, cutoffIso)
        )
      )
      .limit(5)
      .all();

    if (aged.length === 0) return null;

    const ids = aged.map((a) => a.id).join(',');
    const today = now.toISOString().slice(0, 10);
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${today}:${ids}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 2,
      kind: 'nudge',
      payload: {
        agingDays: AGING_DAYS,
        questions: aged.map((a) => ({
          id: a.id,
          // Prefer redacted body to avoid leaking PII downstream.
          body: a.redacted_body ?? a.body,
          createdAt: a.created_at,
        })),
      },
      idempotencyKey,
    };
  },
};
