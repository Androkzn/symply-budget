/**
 * Smart Task Assistant — async enrichment queue handler.
 *
 * Producer: `createQuickTask` (maintenance-service.ts) — inserts a
 * `maintenance_tasks` row with enrichment_status='pending' and the raw capture
 * text, then enqueues a {@link TaskEnrichmentMessage} and returns to the user
 * immediately (the create request finishes in <100ms instead of waiting on a
 * multi-second Claude call).
 *
 * Consumer: this module — calls Claude via `generateStructured`, writes the
 * risk/priority/complexity/time fields + AI subtasks, derives + schedules smart
 * reminders, flips the row to 'enriched', and pushes a notification.
 *
 * Reliability properties (mirrors garden-plan-job-handler.ts):
 *   - **Idempotent.** Skips immediately if the row is already 'enriched'.
 *     Cloudflare Queues is at-least-once; duplicates happen. Subtasks are
 *     delete-then-insert so a redelivery mid-write never double-inserts.
 *   - **Replication-tolerant.** If the producer's INSERT hasn't replicated to
 *     this consumer's D1 region yet, early attempts `retry` instead of acking;
 *     only the final delivery treats a missing row as terminal.
 *   - **Auto-retried** via Queues backoff (`max_retries=3` → 4 deliveries). On
 *     the final delivery a model failure marks the row 'failed' and acks so the
 *     user sees a terminal state rather than a perma-spinner.
 */

import { and, eq, isNull, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { generateStructuredWithFallback } from '../../ai/fallback';
import {
  buildEnrichTaskUserPrompt,
  ENRICH_TASK_SCHEMA,
  ENRICH_TASK_SYSTEM_PROMPT,
  type EnrichTaskContext,
  type EnrichTaskMember,
  type EnrichTaskSpace,
  type EnrichedTaskResult,
} from '../../ai/prompts/enrich-task';
import { createProviderAdapter } from '../../ai/provider-factory';
import * as schema from '../../db/schema';
import { assistantIdentity } from '../../db/schema-aihousekeeper';
import type { Database, Env, TaskEnrichmentMessage } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { generateId, now as nowIso } from '../../utils/id';
import {
  daysBetweenIsoDates,
  dueDateFromDaysInTz,
  formatTodayInTz,
} from '../../utils/timezone';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';
import { assertCanUseAI } from '../entitlement-service';
import { NotificationService } from '../notification-service';
import { deriveReminderPlan } from '../reminder-service';
import { TaskService } from '../task-service';
import { isTimeEffort } from '../time-effort';

/** Outcome handed back to the dispatcher, which maps it to ack/retry. */
export type TaskEnrichmentOutcome =
  | { kind: 'enriched'; taskId: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed-permanent'; reason: string }
  | { kind: 'retry'; reason: string };

export interface HandleTaskEnrichmentOptions {
  /** 1-based delivery attempt (`msg.attempts`). */
  attempt: number;
  /** Matches `max_retries`+1 in wrangler.toml — the terminal delivery. */
  maxAttempts: number;
}

/** Enum guards so a hallucinated value never lands in the DB. */
const RISK = new Set(['low', 'medium', 'high', 'critical']);
const COMPLEXITY = new Set(['trivial', 'simple', 'moderate', 'involved', 'expert']);
const PRIORITY = new Set(['nice_to_have', 'low', 'medium', 'high', 'urgent', 'critical']);
const FREQUENCY = new Set([
  'one_time',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
]);

export async function handleTaskEnrichmentJob(
  env: Env,
  body: TaskEnrichmentMessage,
  opts: HandleTaskEnrichmentOptions
): Promise<TaskEnrichmentOutcome> {
  const db = drizzle(env.DB, { schema }) as unknown as Database;

  const existing = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, body.taskId))
    .get();

  if (!existing) {
    // D1 is eventually consistent across regions — the producer's INSERT may
    // not be visible here yet. Retry on early attempts; only the final
    // delivery treats the row as truly gone.
    const exhausted = opts.attempt >= opts.maxAttempts;
    console.warn('[task-enrich] row missing', {
      taskId: body.taskId.slice(0, 8),
      attempt: opts.attempt,
      exhausted,
    });
    return exhausted
      ? { kind: 'skipped', reason: 'row_missing' }
      : { kind: 'retry', reason: 'row_missing' };
  }

  if (existing.enrichment_status === 'enriched') {
    return { kind: 'skipped', reason: 'already_enriched' };
  }

  try {
    await assertCanUseAI(body.userId, env);
  } catch (err) {
    if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
      await db
        .update(schema.tasks)
        .set({
          enrichment_status: 'failed',
          updated_at: nowIso(),
        })
        .where(eq(schema.tasks.id, body.taskId))
        .run();
      console.warn('[task-enrich] entitlement denied', {
        taskId: body.taskId.slice(0, 8),
        code: (err as AIAccessError).code,
      });
      return { kind: 'skipped', reason: 'entitlement_denied' };
    }
    throw err;
  }

  // CAS pending/failed/null/enriching → enriching. The enriching state lets the
  // stuck-row sweep find crashed jobs; reprocessing on retry is safe because
  // every write below is overwrite-or-replace.
  await db
    .update(schema.tasks)
    .set({ enrichment_status: 'enriching', updated_at: nowIso() })
    .where(eq(schema.tasks.id, body.taskId))
    .run();

  const rawText = body.rawText || existing.raw_capture_text || existing.title;

  // Load the household context the model needs to resolve deadlines (today's
  // date in the household timezone) and assignees (the member roster). Best
  // effort — a failure here just means the model falls back to relative dates
  // and no assignee, never a hard error.
  const ctx = await loadHouseholdEnrichContext(db, body.householdId, body.userId);

  console.info('[task-enrich] start', {
    taskId: body.taskId.slice(0, 8),
    householdId: body.householdId.slice(0, 8),
    attempt: opts.attempt,
    rawTextLen: rawText.length,
    rawTextPreview: rawText.slice(0, 120),
    timezone: ctx.promptContext.timezone,
    todayIso: ctx.promptContext.todayIso,
    memberCount: ctx.promptContext.members.length,
    members: ctx.promptContext.members.map((m) => (m.isCreator ? `${m.name}(you)` : m.name)),
  });

  let result: EnrichedTaskResult;
  try {
    // Async enrichment runs on the initiating user's own key when they've
    // connected one (BYOK); else the SimpleHouse-managed key.
    const { apiKey: anthropicKey } = await resolveProviderApiKey(env, body.userId, 'anthropic');
    const ai = createProviderAdapter({
      provider: 'anthropic',
      apiKey: anthropicKey,
      options: {
        onUsage: usageRecorderFor(env, {
          feature: 'task_enrichment',
          householdId: body.householdId,
          userId: body.userId,
        }),
      },
    });
    result = await generateStructuredWithFallback<EnrichedTaskResult>(
      ai,
      env.AIHOUSEKEEPER_BRIEFING_MODEL,
      env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt: ENRICH_TASK_SYSTEM_PROMPT,
        userPrompt: buildEnrichTaskUserPrompt(rawText, ctx.promptContext),
        schema: ENRICH_TASK_SCHEMA,
        maxTokens: 1500,
      }
    );
    console.info('[task-enrich] model result', {
      taskId: body.taskId.slice(0, 8),
      title: result.title,
      needs_clarification: result.needs_clarification,
      risk_level: result.risk_level,
      priority_severity: result.priority_severity,
      suggested_due_in_days: result.suggested_due_in_days,
      suggested_due_date: result.suggested_due_date,
      assignee_name: result.assignee_name,
      subtasks: result.subtasks?.length ?? 0,
    });
  } catch (err) {
    const reason = (err as Error).message ?? 'enrich_failed';
    const exhausted = opts.attempt >= opts.maxAttempts;
    console.warn('[task-enrich] model call failed', {
      taskId: body.taskId.slice(0, 8),
      attempt: opts.attempt,
      exhausted,
      error: reason,
    });
    if (!exhausted) return { kind: 'retry', reason };
    await markFailed(db, body.taskId, reason);
    await sendEnrichedPush(env, body, existing.title, true).catch(() => {});
    return { kind: 'failed-permanent', reason };
  }

  // The model couldn't make sense of the raw text (gibberish, transcription
  // noise, too vague). Don't fabricate a task — flip to a distinct terminal
  // status carrying the question, and stop here (no subtasks/reminders/normal
  // push). CAS on 'enriching' for the same mid-flight-edit safety as below.
  if (result.needs_clarification) {
    const tsClarify = nowIso();
    const updClarify = await db
      .update(schema.tasks)
      .set({
        enrichment_status: 'needs_clarification',
        clarification_question: (result.clarification_question || 'What did you mean?').slice(
          0,
          300
        ),
        enrichment_error: null,
        enrichment_attempts: (existing.enrichment_attempts ?? 0) + 1,
        updated_at: tsClarify,
      })
      .where(
        and(
          eq(schema.tasks.id, body.taskId),
          eq(schema.tasks.enrichment_status, 'enriching')
        )
      )
      .run();

    const clarifyChanges =
      (updClarify as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
    if (clarifyChanges === 0) {
      return { kind: 'skipped', reason: 'row_changed_mid_flight' };
    }

    console.info('[task-enrich] needs_clarification', {
      taskId: body.taskId.slice(0, 8),
      attempt: opts.attempt,
    });

    await sendClarificationPush(env, body, result.clarification_question).catch((err) => {
      console.warn('[task-enrich] clarification push failed (non-fatal)', {
        taskId: body.taskId.slice(0, 8),
        error: (err as Error).message,
      });
    });

    return { kind: 'enriched', taskId: body.taskId };
  }

  // ---- Sanitize + clamp model output before persisting ----
  const riskLevel = RISK.has(result.risk_level) ? result.risk_level : 'medium';
  const complexity = COMPLEXITY.has(result.complexity) ? result.complexity : 'moderate';
  const priority = PRIORITY.has(result.priority_severity)
    ? result.priority_severity
    : 'medium';
  const frequency = FREQUENCY.has(result.frequency) ? result.frequency : 'one_time';
  const timeEffort = isTimeEffort(result.time_effort) ? result.time_effort : 'medium';

  // ---- Purchase detection → optional planned-spending suggestion ----
  // Only carry a cost when the model actually flagged a purchase, and keep
  // max >= min so the UI range never inverts. Costs are in CENTS.
  const isPurchase = !!result.is_purchase;
  let purchaseCostMin = isPurchase ? clampCentsOrNull(result.estimated_cost_min) : null;
  let purchaseCostMax = isPurchase ? clampCentsOrNull(result.estimated_cost_max) : null;
  if (purchaseCostMin != null && purchaseCostMax != null && purchaseCostMax < purchaseCostMin) {
    [purchaseCostMin, purchaseCostMax] = [purchaseCostMax, purchaseCostMin];
  }

  // ---- Resolve the due date in the HOUSEHOLD's timezone ----
  // An explicit calendar date the user spoke ("July 10") wins and is honoured
  // exactly. Otherwise fall back to the relative/priority-derived plan. Either
  // way the final timestamp is anchored to the household's local calendar day,
  // not UTC — the old `addDays` bug shifted "July 10" by up to a day.
  const tz = ctx.promptContext.timezone;
  const explicitDueDays = resolveExplicitDueDays(
    result.suggested_due_date,
    ctx.promptContext.todayIso
  );
  const reminderPlan = deriveReminderPlan({
    priority_severity: priority,
    risk_level: riskLevel,
    suggested_due_in_days: explicitDueDays ?? numOrNull(result.suggested_due_in_days),
  });
  // Honour an explicit user-given date verbatim; only derive/backstop when the
  // user didn't name one.
  const dueInDays = explicitDueDays ?? reminderPlan.due_in_days;
  const nextDueDate = dueDateFromDaysInTz(dueInDays, tz);

  // ---- Resolve the assignee from the model's matched member name ----
  // Every shared task must have an owner: use the member the model matched,
  // otherwise default to the task creator so nothing is ever left unassigned.
  // Personal tasks stay unassigned — they're implicitly the creator's own.
  const matchedAssignee = resolveAssignee(result.assignee_name, ctx.members);
  const assignedTo = matchedAssignee ?? (existing.is_personal ? null : body.userId);
  const matchedSpaceId = resolveSpace(result.space_name, ctx.spaces);

  const ts = nowIso();

  console.info('[task-enrich] resolved', {
    taskId: body.taskId.slice(0, 8),
    timezone: tz,
    explicitDueDays,
    dueInDays,
    nextDueDate,
    reminderDaysBefore: reminderPlan.reminder_days_before,
    assigneeName: result.assignee_name,
    assignedTo: assignedTo ? assignedTo.slice(0, 8) : null,
    spaceName: result.space_name,
    spaceId: matchedSpaceId ? matchedSpaceId.slice(0, 8) : null,
  });

  // CAS on enrichment_status='enriching' so a user edit / cancel that landed
  // mid-flight isn't clobbered. changes===0 → someone moved it on; skip.
  const upd = await db
    .update(schema.tasks)
    .set({
      title: (result.title || existing.title).slice(0, 200),
      description: result.description ?? existing.description,
      system_category: result.system_category ?? existing.system_category,
      risk_level: riskLevel,
      priority_severity: priority,
      complexity,
      time_effort: timeEffort,
      frequency,
      next_due_date: nextDueDate,
      reminder_days_before: reminderPlan.reminder_days_before,
      // Fill in the assignee (model match, else the creator fallback above) only
      // when the user didn't already pick one at capture time. Never clear or
      // overwrite an assignment the user set manually — their explicit choice wins.
      ...(assignedTo && !existing.assigned_to ? { assigned_to: assignedTo } : {}),
      ...(matchedSpaceId && !existing.space_id ? { space_id: matchedSpaceId } : {}),
      why_important: result.why_important ?? null,
      neglect_consequences: result.neglect_consequences ?? null,
      ai_rationale: result.ai_rationale ?? null,
      needs_contractor: !!result.needs_contractor,
      contractor_category: result.needs_contractor
        ? result.contractor_category ?? null
        : null,
      is_purchase: isPurchase,
      purchase_estimated_cost_min: purchaseCostMin,
      purchase_estimated_cost_max: purchaseCostMax,
      enrichment_status: 'enriched',
      enriched_at: ts,
      enrichment_error: null,
      clarification_question: null,
      enrichment_attempts: (existing.enrichment_attempts ?? 0) + 1,
      updated_at: ts,
    })
    .where(
      and(
        eq(schema.tasks.id, body.taskId),
        eq(schema.tasks.enrichment_status, 'enriching')
      )
    )
    .run();

  const changes = (upd as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
  if (changes === 0) {
    return { kind: 'skipped', reason: 'row_changed_mid_flight' };
  }

  // Subtasks: delete-then-insert keeps redeliveries idempotent. Only the AI's
  // generated set is owned here; users add their own later via the normal API.
  await replaceAiSubtasks(db, body.taskId, result.subtasks ?? [], ts);

  // Smart reminders from the derived plan (reuses create/update logic).
  try {
    const maintenance = new TaskService(env, env.DB);
    await maintenance.scheduleRemindersForTask(body.householdId, body.taskId);
  } catch (err) {
    console.warn('[task-enrich] reminder scheduling failed (non-fatal)', {
      taskId: body.taskId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  await sendEnrichedPush(env, body, result.title || existing.title, false).catch((err) => {
    console.warn('[task-enrich] push failed (non-fatal)', {
      taskId: body.taskId.slice(0, 8),
      error: (err as Error).message,
    });
  });

  // If the AI assigned the task to someone other than the creator, ping them.
  if (assignedTo && assignedTo !== body.userId) {
    await sendAssignmentPush(env, body, result.title || existing.title, assignedTo).catch(
      (err) => {
        console.warn('[task-enrich] assignment push failed (non-fatal)', {
          taskId: body.taskId.slice(0, 8),
          error: (err as Error).message,
        });
      }
    );
  }

  console.info('[task-enrich] enriched', {
    taskId: body.taskId.slice(0, 8),
    risk: riskLevel,
    priority,
    effort: timeEffort,
    subtasks: result.subtasks?.length ?? 0,
    nextDueDate,
    assignedTo: assignedTo ? assignedTo.slice(0, 8) : null,
    attempt: opts.attempt,
  });

  return { kind: 'enriched', taskId: body.taskId };
}

/** A member row loaded for assignee matching. */
interface EnrichMemberRow {
  userId: string;
  name: string;
  isCreator: boolean;
}

/** A space row loaded for location matching. */
interface EnrichSpaceRow {
  id: string;
  name: string;
}

/** Household context handed to the prompt + used to resolve the assignee. */
interface HouseholdEnrichContext {
  promptContext: EnrichTaskContext;
  members: EnrichMemberRow[];
  spaces: EnrichSpaceRow[];
}

/**
 * Load today's date (in the household timezone) + the member roster so the
 * model can resolve deadlines and assignees. Never throws — on any failure it
 * degrades to a UTC "today" and an empty roster (no assignee).
 */
async function loadHouseholdEnrichContext(
  db: Database,
  householdId: string,
  creatorUserId: string
): Promise<HouseholdEnrichContext> {
  let timezone = 'UTC';
  try {
    const identity = await db
      .select({ timezone: assistantIdentity.timezone })
      .from(assistantIdentity)
      .where(eq(assistantIdentity.household_id, householdId))
      .get();
    if (identity?.timezone) timezone = identity.timezone;
  } catch (err) {
    console.warn('[task-enrich] timezone lookup failed (defaulting UTC)', {
      householdId: householdId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  let members: EnrichMemberRow[] = [];
  try {
    const rows = await db
      .select({
        userId: schema.householdMembers.user_id,
        displayName: schema.users.display_name,
        email: schema.users.email,
      })
      .from(schema.householdMembers)
      .innerJoin(schema.users, eq(schema.householdMembers.user_id, schema.users.id))
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();
    members = rows
      .filter((r) => !!r.userId)
      .map((r) => ({
        userId: r.userId,
        // Fall back to the email local-part so an unnamed member is still
        // addressable ("john" from john@…), else a generic label.
        name: (r.displayName || r.email?.split('@')[0] || 'Member').trim(),
        isCreator: r.userId === creatorUserId,
      }));
  } catch (err) {
    console.warn('[task-enrich] member lookup failed (no assignee matching)', {
      householdId: householdId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  const today = formatTodayInTz(timezone);
  const promptMembers: EnrichTaskMember[] = members.map((m) => ({
    name: m.name,
    isCreator: m.isCreator,
  }));

  let spaces: EnrichSpaceRow[] = [];
  try {
    const spaceRows = await db
      .select({
        id: schema.householdSpaces.id,
        name: schema.householdSpaces.name,
      })
      .from(schema.householdSpaces)
      .where(
        and(
          eq(schema.householdSpaces.household_id, householdId),
          isNull(schema.householdSpaces.deleted_at)
        )
      )
      .all();
    spaces = spaceRows.map((r) => ({ id: r.id, name: r.name.trim() }));
  } catch (err) {
    console.warn('[task-enrich] space lookup failed (no space matching)', {
      householdId: householdId.slice(0, 8),
      error: (err as Error).message,
    });
  }

  const promptSpaces: EnrichTaskSpace[] = spaces.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return {
    promptContext: {
      todayIso: today.iso,
      todayHuman: today.human,
      timezone: today.zone,
      members: promptMembers,
      spaces: promptSpaces,
    },
    members,
    spaces,
  };
}

/**
 * Convert an explicit model-supplied due date (YYYY-MM-DD) into a non-negative
 * days-from-today offset, or null when absent/invalid/malformed. A date in the
 * past clamps to 0 (today) rather than producing an overdue task on creation.
 */
function resolveExplicitDueDays(
  suggestedDueDate: string | null,
  todayIso: string
): number | null {
  if (!suggestedDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(suggestedDueDate)) return null;
  const diff = daysBetweenIsoDates(todayIso, suggestedDueDate);
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, diff);
}

/**
 * Match the model's chosen display name back to a concrete member user id.
 * Tries exact (case-insensitive) match first, then a lenient contains match so
 * "Sarah" resolves against "Sarah Chen". Returns null when nothing matches.
 */
function resolveAssignee(
  assigneeName: string | null,
  members: EnrichMemberRow[]
): string | null {
  if (!assigneeName || !members.length) return null;
  const wanted = assigneeName.trim().toLowerCase();
  if (!wanted) return null;
  // "me"/"myself" → the creator, in case the model echoed the pronoun.
  if (wanted === 'me' || wanted === 'myself' || wanted === 'i') {
    const creator = members.find((m) => m.isCreator);
    return creator ? creator.userId : null;
  }
  const exact = members.find((m) => m.name.trim().toLowerCase() === wanted);
  if (exact) return exact.userId;
  const partial = members.find((m) => {
    const name = m.name.trim().toLowerCase();
    return name.includes(wanted) || wanted.includes(name);
  });
  return partial ? partial.userId : null;
}

function resolveSpace(
  spaceName: string | null,
  spaces: EnrichSpaceRow[]
): string | null {
  if (!spaceName || !spaces.length) return null;
  const wanted = spaceName.trim().toLowerCase();
  if (!wanted) return null;
  const exact = spaces.find((s) => s.name.trim().toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = spaces.find((s) => {
    const name = s.name.trim().toLowerCase();
    return name.includes(wanted) || wanted.includes(name);
  });
  return partial ? partial.id : null;
}

async function replaceAiSubtasks(
  db: Database,
  taskId: string,
  subtasks: { title: string }[],
  ts: string
): Promise<void> {
  // Hard-delete prior AI subtasks for this task so a retry can't duplicate.
  await db
    .delete(schema.maintenanceSubtasks)
    .where(eq(schema.maintenanceSubtasks.task_id, taskId))
    .run();

  if (!subtasks.length) return;

  const rows = subtasks.slice(0, 12).map((st, i) => ({
    id: generateId(),
    task_id: taskId,
    title: (st.title || `Step ${i + 1}`).slice(0, 200),
    description: null,
    sort_order: i,
    is_completed: false,
    created_at: ts,
    updated_at: ts,
  }));
  await db.insert(schema.maintenanceSubtasks).values(rows).run();
}

async function markFailed(db: Database, taskId: string, reason: string): Promise<void> {
  await db
    .update(schema.tasks)
    .set({
      enrichment_status: 'failed',
      enrichment_error: reason.slice(0, 300),
      updated_at: nowIso(),
    })
    .where(eq(schema.tasks.id, taskId))
    .run()
    .catch((err) => {
      console.warn('[task-enrich] markFailed update failed', {
        taskId: taskId.slice(0, 8),
        error: (err as Error).message,
      });
    });
}

async function sendEnrichedPush(
  env: Env,
  body: TaskEnrichmentMessage,
  title: string,
  failed: boolean
): Promise<void> {
  const notifications = new NotificationService(env, env.DB);
  await notifications.sendNotification({
    userId: body.userId,
    type: failed ? 'task_enrich_failed' : 'task_enriched',
    title: failed ? 'Task saved (needs a tweak)' : 'Task ready',
    body: failed
      ? `"${title}" is saved but couldn't be auto-analyzed — open it to set details.`
      : `"${title}" was analyzed and prioritized.`,
    data: {
      type: failed ? 'task_enrich_failed' : 'task_enriched',
      taskId: body.taskId,
      householdId: body.householdId,
      screen: 'TaskDetail',
    },
    referenceType: 'maintenance_task',
    referenceId: body.taskId,
  });
}

async function sendAssignmentPush(
  env: Env,
  body: TaskEnrichmentMessage,
  title: string,
  assigneeUserId: string
): Promise<void> {
  const notifications = new NotificationService(env, env.DB);
  await notifications.sendNotification({
    userId: assigneeUserId,
    type: 'task_assigned',
    title: 'New task assigned to you',
    body: `You were assigned "${title.slice(0, 120)}"`,
    data: {
      type: 'task_assigned',
      taskId: body.taskId,
      householdId: body.householdId,
      screen: 'TaskDetail',
    },
    referenceType: 'maintenance_task',
    referenceId: body.taskId,
  });
}

async function sendClarificationPush(
  env: Env,
  body: TaskEnrichmentMessage,
  question: string | null
): Promise<void> {
  const notifications = new NotificationService(env, env.DB);
  await notifications.sendNotification({
    userId: body.userId,
    type: 'task_needs_clarification',
    title: 'Quick question about your task',
    body: question || `I couldn't quite parse "${body.rawText}" — open it to clarify.`,
    data: {
      type: 'task_needs_clarification',
      taskId: body.taskId,
      householdId: body.householdId,
      screen: 'TaskDetail',
    },
    referenceType: 'maintenance_task',
    referenceId: body.taskId,
  });
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Sanitize a model-supplied cost (in CENTS): round, drop non-positive/invalid
 * values to null, and cap at $1,000,000 so a hallucinated figure can't poison
 * budget totals.
 */
function clampCentsOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n <= 0) return null;
  return Math.min(n, 100_000_000);
}

/**
 * How long a row may sit in 'enriching' before the sweep reconciles it to
 * 'failed'. Happy path is 2–8s; with 4 deliveries + backoff the worst-case
 * success is ~6min. Pad to 15min.
 */
export const STUCK_ENRICHING_GRACE_MS = 15 * 60 * 1000;

export interface SweepStuckEnrichingResult {
  scanned: number;
  reconciled: number;
}

/**
 * Reconcile tasks stuck in 'enriching' past the grace window (handler crash /
 * DLQ). Flips them to 'failed' so the card stops spinning. Never throws.
 */
export async function sweepStuckEnrichingTasks(
  env: Env,
  now: Date = new Date(),
  graceMs: number = STUCK_ENRICHING_GRACE_MS
): Promise<SweepStuckEnrichingResult> {
  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const cutoffIso = new Date(now.getTime() - graceMs).toISOString();

  let stuck: schema.Task[] = [];
  try {
    stuck = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.enrichment_status, 'enriching'),
          lte(schema.tasks.updated_at, cutoffIso)
        )
      )
      .all();
  } catch (err) {
    console.error('[task-enrich-sweep] scan failed', { error: (err as Error).message });
    return { scanned: 0, reconciled: 0 };
  }

  let reconciled = 0;
  for (const row of stuck) {
    try {
      const upd = await db
        .update(schema.tasks)
        .set({
          enrichment_status: 'failed',
          enrichment_error: 'enrichment_stuck_in_queue',
          updated_at: nowIso(),
        })
        .where(
          and(
            eq(schema.tasks.id, row.id),
            eq(schema.tasks.enrichment_status, 'enriching'),
            lte(schema.tasks.updated_at, cutoffIso)
          )
        )
        .run();
      if (((upd as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0) reconciled += 1;
    } catch (err) {
      console.warn('[task-enrich-sweep] row update failed', {
        taskId: row.id.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }

  if (stuck.length) {
    console.info('[task-enrich-sweep] reconciled', { scanned: stuck.length, reconciled });
  }
  return { scanned: stuck.length, reconciled };
}
