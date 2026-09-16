/**
 * Aihousekeeper triggers — plan §5 / §D (Stream D).
 *
 * Each trigger is a pure observer: it inspects state for a single household
 * and returns a `TriggerResult` if it fires this tick, or `null` otherwise.
 * Triggers NEVER call `OutboundDispatcher` — Stream F's consumer handler
 * aggregates these results and routes them.
 *
 * The `TRIGGERS` array is the registry consumed by Stream F. All 11 concrete
 * triggers are exported here so the queue consumer can iterate in a stable
 * order without knowing individual file names.
 *
 * `triggerGuard` enforces a per-(householdId, triggerId) min-cadence gate
 * backed by `CONFIG_KV`. Each trigger calls it first; callers that fire more
 * frequently than `cadenceMinutes` simply get `null` back from `evaluate`
 * without doing any further work.
 */

import type { Env } from '../../../types';

import { anniversaryOfPastEventTrigger } from './anniversary-of-past-event';
import { appointmentImminentTrigger } from './appointment-imminent';
import { contractorQuoteReceivedTrigger } from './contractor-quote-received';
import { costAnomalyTrigger } from './cost-anomaly';
import { dailyBriefingTimeTrigger } from './daily-briefing-time';
import { followupDueTrigger } from './followup-due';
import { newInspectionFindingsTrigger } from './new-inspection-findings';
import { seasonalKickoffTrigger } from './seasonal-kickoff';
import { taskOverdueCriticalTrigger } from './task-overdue-critical';
import { unresolvedQuestionAgingTrigger } from './unresolved-question-aging';
import { weatherActionRequiredTrigger } from './weather-action-required';

// ---------- shared types ----------

export type TriggerSeverity = 1 | 2 | 3 | 4 | 5;
export type TriggerKind = 'briefing' | 'nudge' | 'followup' | 'digest';

export interface TriggerResult {
  triggerId: string;
  householdId: string;
  severity: TriggerSeverity;
  kind?: TriggerKind;
  payload: Record<string, unknown>;
  /** Stable per-occurrence key; used by Stream F to dedupe outbound writes. */
  idempotencyKey: string;
}

export interface Trigger {
  id: string;
  cadenceMinutes: number;
  evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null>;
}

// ---------- trigger registry ----------

/**
 * Ordered list of all concrete triggers. Stream F's queue consumer iterates
 * this array per household per tick.
 */
export const TRIGGERS: Trigger[] = [
  dailyBriefingTimeTrigger,
  taskOverdueCriticalTrigger,
  weatherActionRequiredTrigger,
  appointmentImminentTrigger,
  followupDueTrigger,
  unresolvedQuestionAgingTrigger,
  newInspectionFindingsTrigger,
  anniversaryOfPastEventTrigger,
  seasonalKickoffTrigger,
  costAnomalyTrigger,
  contractorQuoteReceivedTrigger,
];

// ---------- min-cadence guard ----------

/**
 * Returns `true` if the trigger is allowed to run for this household right
 * now, and atomically claims the guard slot so subsequent calls within the
 * cadence window return `false`.
 *
 * Key: `aihousekeeper:trigger-guard:<householdId>:<triggerId>` in `CONFIG_KV`.
 * TTL: 1 hour (plan §D1). Individual triggers with cadence > 1h should
 * additionally check their own cadence inside `evaluate` — the 1h KV TTL is
 * only a cheap hot-path gate, not the authoritative cadence floor.
 *
 * NOTE: KV is eventually consistent across regions. A race between two
 * concurrent ticks can allow both through. Consumers that MUST be single-fire
 * rely on the `idempotencyKey` + the partial-unique index on
 * `assistant_outbound_log.idempotency_key` (plan §A5) for end-to-end dedupe.
 */
export async function triggerGuard(
  env: Env,
  householdId: string,
  triggerId: string
): Promise<boolean> {
  const key = `aihousekeeper:trigger-guard:${householdId}:${triggerId}`;
  const existing = await env.CONFIG_KV.get(key);
  if (existing) return false;
  // 1 hour TTL. Stream F ticks every 15 min, so a trigger with
  // cadenceMinutes ≤ 60 naturally re-arms after the window.
  await env.CONFIG_KV.put(key, '1', { expirationTtl: 3600 });
  return true;
}
