/**
 * `maintenance_suggestions` + home insight, displaced onto the device
 * (plan §9, locked assignment row *"`maintenance_suggestions`, home insight →
 * **P1** on-device rules — suggestions get simpler than the server's AI pass, at
 * least initially"*).
 *
 * Two of the five Tier-D tables die here. `maintenance_suggestions` used to be
 * written by a Worker cron doing an AI pass over D1; under E2EE that D1 is
 * empty, so the table is not "degraded", it is *gone*. What replaces it is this
 * file: rules over the ledger, run on demand, on device.
 *
 * **Why the rules are worth having even though they are simpler.** Every rule
 * below fires on a fact the member entered — a due date they set, a warranty
 * they typed, a service they logged. None of them guesses. That makes the output
 * defensible in a way the server's AI pass never quite was, and — the point the
 * plan makes about grounding — it sees the *whole current* ledger rather than
 * whatever had synced to the server.
 *
 * **Where Stage B earns its place.** A home with rows but no rule hits is the
 * interesting case: nothing is overdue, no warranty is closing, and the member
 * still wants to know what to look at. That is a judgement call, so it goes to
 * the member's own provider with an allowlisted projection — task titles and
 * dates, appliance make/model and dates, home features. Not `description`, not
 * `notes`, not `serial_number`, not `assigned_to`; see `egressAllowlist.ts` for
 * why each of those is missing.
 *
 * **Stage A answers `[]` rather than escalating on an empty home.** "You have no
 * tasks and no appliances, so there is nothing to suggest" is a correct
 * deterministic answer. Spending the member's provider credits to be told the
 * same thing is not a fallback, it is a bug.
 */
import type {
  LocalAppliance,
  LocalApplianceServiceHistory,
  LocalHomeFeature,
  LocalTask,
} from '../types';

import {
  buildHouseAiContext,
  runHouseAiLadder,
  type HouseAiLadderResult,
} from './houseAiLadder';
import { houseByokPort, type HouseByokPort } from './houseByokClient';

export type HomeInsightKind =
  | 'task_overdue'
  | 'task_due_soon'
  | 'appliance_warranty_expiring'
  | 'appliance_service_due'
  | 'appliance_end_of_life'
  | 'assistant_suggestion';

export type HomeInsightPriority = 'high' | 'medium' | 'low';

export type HomeInsight = {
  /**
   * Stable across runs, derived from the row it concerns. A card list that
   * re-keys every refresh loses scroll position and animates like a glitch.
   */
  id: string;
  kind: HomeInsightKind;
  /** Member-facing. Never contains an identifier. */
  title: string;
  detail: string;
  priority: HomeInsightPriority;
  source: 'rules' | 'assistant';
  taskId?: string;
  applianceId?: string;
};

/** Thresholds, named and exported so a test pins the behaviour, not a magic 14. */
export const DUE_SOON_DAYS = 14;
export const WARRANTY_NOTICE_DAYS = 60;
export const SERVICE_INTERVAL_DAYS = 365;
export const END_OF_LIFE_NOTICE_DAYS = 365;

/**
 * A card list, not a report. The H10 ten-year corpus produces hundreds of
 * overdue rows on a neglected home; showing all of them is the same as showing
 * none.
 */
export const MAX_HOME_INSIGHTS = 12;

/**
 * Rows the projection is allowed to consider. Well under
 * `buildHouseAiContext`'s own 200 clamp, because a prompt that costs the member
 * money should carry the recent slice, not the archive.
 */
const MAX_CONTEXT_ROWS_PER_TABLE = 60;

export type HomeInsightsLedgerView = {
  tasks?: readonly LocalTask[];
  appliances?: readonly LocalAppliance[];
  applianceServiceHistory?: readonly LocalApplianceServiceHistory[];
  homeFeatures?: readonly LocalHomeFeature[];
};

export type HomeInsightsInput = {
  ledger: HomeInsightsLedgerView;
  householdId?: string;
  today?: Date;
  byok?: HouseByokPort;
};

const PRIORITY_RANK: Record<HomeInsightPriority, number> = { high: 0, medium: 1, low: 2 };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Midnight-local for a `YYYY-MM-DD` (or full ISO) value.
 *
 * `new Date('2026-08-13')` is UTC midnight, so on a device in UTC-7 a task due
 * today reads as overdue by seven hours. Parsing the calendar fields into a
 * LOCAL date is the same correction `logic/garbageSchedule.ts` documents, and
 * the reason "overdue" here means what the member's calendar says.
 */
function toLocalDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function ownedBy<T extends object>(
  rows: readonly T[] | undefined,
  householdId: string | undefined,
): T[] {
  const all = rows ? [...rows] : [];
  if (!householdId) return all;
  return all.filter((row) => {
    // A row with no `household_id` is kept: not every House DTO carries one, and
    // dropping those would silently blank a real home on a single-property
    // device that happens to pass an id.
    const owner = (row as { household_id?: string }).household_id;
    return !owner || owner === householdId;
  });
}

/** The earliest warranty expiry recorded on an appliance, whichever policy. */
function warrantyExpiry(appliance: LocalAppliance): Date | null {
  const candidates = [
    appliance.warranty?.manufacturer?.expiration,
    appliance.warranty?.extended?.expiration,
  ]
    .map(toLocalDay)
    .filter((d): d is Date => d !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, next) => (next < earliest ? next : earliest));
}

/**
 * Stage A — the rules. Pure, synchronous, offline.
 *
 * Exported on its own because it is the part that must keep working when
 * everything else about AI is switched off, and a test should be able to call it
 * without constructing a ladder.
 */
export function buildHomeInsightsStageA(
  ledger: HomeInsightsLedgerView,
  today: Date,
  householdId?: string,
): HomeInsight[] {
  const day = startOfDay(today);
  const insights: HomeInsight[] = [];

  const tasks = ownedBy(ledger.tasks, householdId);
  const appliances = ownedBy(ledger.appliances, householdId);
  const history = ownedBy(ledger.applianceServiceHistory, householdId);

  // ---- Tasks: overdue, then closing in --------------------------------------
  for (const task of tasks) {
    if (task.is_active === false) continue;
    const due = toLocalDay(task.next_due_date);
    if (!due) continue;
    const delta = daysBetween(day, due);

    if (delta < 0) {
      insights.push({
        id: `task_overdue:${task.id}`,
        kind: 'task_overdue',
        title: task.title,
        detail: `Overdue by ${plural(Math.abs(delta), 'day', 'days')}.`,
        priority: 'high',
        source: 'rules',
        taskId: task.id,
      });
    } else if (delta <= DUE_SOON_DAYS) {
      insights.push({
        id: `task_due_soon:${task.id}`,
        kind: 'task_due_soon',
        title: task.title,
        detail: delta === 0 ? 'Due today.' : `Due in ${plural(delta, 'day', 'days')}.`,
        priority: 'medium',
        source: 'rules',
        taskId: task.id,
      });
    }
  }

  // ---- Appliances: warranty, service cadence, end of life -------------------
  const lastServiceByAppliance = new Map<string, Date>();
  for (const entry of history) {
    const serviced = toLocalDay(entry.service_date);
    if (!serviced) continue;
    const existing = lastServiceByAppliance.get(entry.appliance_id);
    if (!existing || serviced > existing) lastServiceByAppliance.set(entry.appliance_id, serviced);
  }

  for (const appliance of appliances) {
    const expiry = warrantyExpiry(appliance);
    if (expiry) {
      const delta = daysBetween(day, expiry);
      if (delta >= 0 && delta <= WARRANTY_NOTICE_DAYS) {
        insights.push({
          id: `appliance_warranty_expiring:${appliance.id}`,
          kind: 'appliance_warranty_expiring',
          title: `${appliance.name} warranty ends soon`,
          detail:
            delta === 0
              ? 'The warranty ends today. Worth logging any outstanding faults now.'
              : `The warranty ends in ${plural(delta, 'day', 'days')}. Worth logging any outstanding faults now.`,
          priority: 'medium',
          source: 'rules',
          applianceId: appliance.id,
        });
      }
    }

    /**
     * Service cadence is judged from the member's OWN history only.
     *
     * The tempting rule — "anything older than a year needs a service" — fires
     * on a toaster and teaches members to ignore the list. An appliance the
     * member has serviced before is one they consider serviceable, and the gap
     * since is a fact rather than a guess.
     */
    const lastService = lastServiceByAppliance.get(appliance.id);
    if (lastService) {
      const since = daysBetween(lastService, day);
      if (since >= SERVICE_INTERVAL_DAYS) {
        insights.push({
          id: `appliance_service_due:${appliance.id}`,
          kind: 'appliance_service_due',
          title: `${appliance.name} is due for a service`,
          detail: `Last serviced ${plural(since, 'day', 'days')} ago.`,
          priority: 'low',
          source: 'rules',
          applianceId: appliance.id,
        });
      }
    }

    // End of life needs both a start date and an expected lifespan; without
    // either there is nothing to project and the rule stays quiet.
    const start = toLocalDay(appliance.install_date ?? appliance.purchase_date);
    const lifespanYears = appliance.expected_lifespan;
    if (start && typeof lifespanYears === 'number' && lifespanYears > 0) {
      const end = new Date(start.getFullYear() + lifespanYears, start.getMonth(), start.getDate());
      const delta = daysBetween(day, end);
      if (delta <= END_OF_LIFE_NOTICE_DAYS) {
        insights.push({
          id: `appliance_end_of_life:${appliance.id}`,
          kind: 'appliance_end_of_life',
          title: `${appliance.name} is near the end of its expected life`,
          detail:
            delta < 0
              ? `It has passed its expected ${lifespanYears}-year life. Worth budgeting for a replacement.`
              : `It reaches its expected ${lifespanYears}-year life in ${plural(delta, 'day', 'days')}. Worth budgeting for a replacement.`,
          priority: 'low',
          source: 'rules',
          applianceId: appliance.id,
        });
      }
    }
  }

  // Stable order: priority, then the id. Sorting by id inside a priority band is
  // arbitrary but *deterministic*, which is what a list that re-renders on every
  // ledger bump needs — see `MAX_HOME_INSIGHTS`, which would otherwise drop a
  // different tail on every refresh.
  insights.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return a.id.localeCompare(b.id);
  });

  return insights.slice(0, MAX_HOME_INSIGHTS);
}

export const HOME_INSIGHTS_SYSTEM_PROMPT = [
  'You suggest home maintenance for a household app.',
  'You are given a minimised, anonymised slice of the household: task titles and',
  'dates, appliance make/model and dates, and structural features. There are no',
  'names, no address, no notes and no free text.',
  'Suggest at most five concrete things worth doing, each grounded in a row you',
  'were given. Do not invent appliances or rooms. Do not ask questions.',
].join(' ');

export const HOME_INSIGHTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'detail'],
      },
    },
  },
  required: ['suggestions'],
};

type RawSuggestions = {
  suggestions?: Array<{ title?: unknown; detail?: unknown; priority?: unknown }>;
};

/**
 * Map a provider answer into the same shape the rules produce.
 *
 * Ids are positional plus a slug of the title so two suggestions with the same
 * text do not collide, and so the list is stable if the same answer is produced
 * twice. Anything without a usable title is dropped rather than rendered as an
 * empty card.
 */
export function normalizeAssistantInsights(raw: RawSuggestions | null): HomeInsight[] {
  const out: HomeInsight[] = [];
  const suggestions = raw?.suggestions ?? [];
  for (let index = 0; index < suggestions.length; index += 1) {
    const item = suggestions[index]!;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;
    const detail = typeof item.detail === 'string' ? item.detail.trim() : '';
    const priority: HomeInsightPriority =
      item.priority === 'high' || item.priority === 'low' ? item.priority : 'medium';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    out.push({
      id: `assistant_suggestion:${index}:${slug}`,
      kind: 'assistant_suggestion',
      title,
      detail,
      priority,
      source: 'assistant',
    });
  }
  return out.slice(0, MAX_HOME_INSIGHTS);
}

/**
 * Run the ladder for home insight.
 *
 * Reading the three outcomes:
 *  - **Stage A with rows** — the normal case, offline and instant.
 *  - **Stage A with `[]`** — an empty home, answered without spending anything.
 *  - **Stage B / C** — a home with rows and nothing mechanically wrong, where a
 *    key buys a judgement call and no key says so in the member's language.
 */
export async function buildHomeInsights(
  input: HomeInsightsInput,
): Promise<HouseAiLadderResult<HomeInsight[]>> {
  const today = input.today ?? new Date();
  const byok = input.byok ?? houseByokPort;
  const householdId = input.householdId;

  const tasks = ownedBy(input.ledger.tasks, householdId);
  const appliances = ownedBy(input.ledger.appliances, householdId);
  const serviceHistory = ownedBy(input.ledger.applianceServiceHistory, householdId);
  const homeFeatures = ownedBy(input.ledger.homeFeatures, householdId);

  const rules = buildHomeInsightsStageA(input.ledger, today, householdId);
  const hasMaterial = tasks.length > 0 || appliances.length > 0;

  /**
   * Stage A "declines" only when there is something to reason about and the
   * rules found nothing. `null` is the ladder's fall-through signal, so an empty
   * home must return `[]` — returning `null` there would escalate every brand-new
   * household straight to a provider on its first launch.
   */
  const deterministic: HomeInsight[] | null =
    rules.length > 0 ? rules : hasMaterial ? null : [];

  // Only allowlisted tables are requested. `householdMembers` would make the
  // suggestions friendlier ("ask Sam to…") and is a forbidden table, so it is
  // not requested here — the refusal is proven in the tests rather than relied
  // on in production code.
  const context = buildHouseAiContext(
    {
      tasks,
      appliances,
      applianceServiceHistory: serviceHistory,
      homeFeatures,
    },
    ['tasks', 'appliances', 'applianceServiceHistory', 'homeFeatures'],
    { maxRowsPerTable: MAX_CONTEXT_ROWS_PER_TABLE },
  );

  return runHouseAiLadder<HomeInsight[]>({
    stageA: () => deterministic,
    stageB: async (projected) => {
      const raw = await byok.generate<RawSuggestions>({
        systemPrompt: HOME_INSIGHTS_SYSTEM_PROMPT,
        userPrompt: 'What is worth doing around this home in the next month?',
        schema: HOME_INSIGHTS_SCHEMA,
        context: projected,
      });
      const mapped = normalizeAssistantInsights(raw);
      return mapped.length > 0 ? mapped : null;
    },
    context,
    // Same discipline as the garbage consumer: the vault is consulted only when
    // Stage A has already declined, so a deterministic answer costs no I/O.
    hasProviderKey: deterministic === null ? await byok.hasKey() : false,
  });
}
