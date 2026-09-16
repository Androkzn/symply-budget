/**
 * "When does my garbage go out?" — the first real consumer of the ladder
 * (plan §9, locked assignment row *"garbage AI-detect → P2 BYOK; Stage-A
 * deterministic parse works with no key"*).
 *
 * **Stage A is the product here, not a fallback.** The member who has set their
 * collection days — which is every member who has been through the Garbage tab
 * once — gets their answer from `expandCollectionDates`, the same expansion the
 * Worker used to run (`logic/garbageSchedule.ts`). No key, no network, no
 * provider, no latency. That is the majority case and it is deliberately the
 * cheap one.
 *
 * **Stage B has exactly one job:** the member has told us their municipality but
 * has not configured any streams — the state the ledger is in the moment
 * `getSchedule` auto-creates the row (see `schema.ts`, the S3b note on
 * `garbageSchedules`). A model that knows "Burnaby, BC" can propose the usual
 * pattern; the member then confirms it. Note what leaves the device for that:
 * `municipality` and nothing else, because that is all the egress allowlist
 * names for this table. The street address lives on `households`, which is a
 * forbidden table — so the one field that would make the guess *accurate* is
 * also the one field that would identify the home, and the allowlist decides
 * that trade rather than a prompt author.
 *
 * **The dates are still computed on device even on the Stage-B path.** The model
 * returns a *pattern* (`GarbageScheduleType[]`); `expandCollectionDates` turns it
 * into dates. A model is not allowed to do calendar arithmetic that the member
 * will act on, and this way the Stage-A and Stage-B answers are produced by the
 * same code and cannot disagree about what "biweekly, week B" means.
 *
 * **Stage C** is reached when there is no schedule row at all (nothing to reason
 * from) or the provider declined — always as ladder copy, never a raw error.
 */
import type { CollectionDate, GarbageScheduleType } from '@api/garbage-collection';

import { expandCollectionDates } from '../logic/garbageSchedule';
import type { LocalGarbageSchedule } from '../types';

import {
  buildHouseAiContext,
  runHouseAiLadder,
  type HouseAiLadderResult,
} from './houseAiLadder';
import { houseByokPort, type HouseByokPort } from './houseByokClient';

/** Window the answer covers. Matches the Garbage tab's own default. */
export const GARBAGE_INFERENCE_DAYS_AHEAD = 30;

export type GarbageDayAnswer = {
  /** `schedule` = computed from what the member saved; `assistant` = a guess. */
  source: 'schedule' | 'assistant';
  /** Upcoming pickups, soonest first. Always computed on device. */
  next: CollectionDate[];
  /** The streams the answer rests on — a draft when it came from the assistant. */
  streams: GarbageScheduleType[];
  /** One line a card can render without further formatting. */
  summary: string;
  /**
   * True only on the assistant path. A guessed schedule must be confirmed before
   * it is saved: getting bin day wrong is a week of rubbish on the drive.
   */
  needsConfirmation: boolean;
};

/**
 * The slice of the ledger this helper reads.
 *
 * Structural and narrow so a real `HouseLedger` satisfies it while a fixture of
 * one row also does — and so the function cannot reach a table it has no
 * business reading.
 */
export type GarbageLedgerView = {
  garbageSchedules?: readonly LocalGarbageSchedule[];
};

export type GarbageDayInferenceInput = {
  ledger: GarbageLedgerView;
  /** Which property to answer for. Omit on a single-property device. */
  householdId?: string;
  /** Injectable clock — the parity fixtures pin a date, production passes none. */
  today?: Date;
  daysAhead?: number;
  /** Injected in tests; production uses the real Keychain-backed client. */
  byok?: HouseByokPort;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const STREAM_LABELS: Record<GarbageScheduleType['type'], string> = {
  garbage: 'Garbage',
  recycling: 'Recycling',
  organics: 'Organics',
  yardWaste: 'Yard waste',
  bulkItem: 'Bulk items',
};

const VALID_STREAM_TYPES = Object.keys(STREAM_LABELS) as GarbageScheduleType['type'][];
const VALID_FREQUENCIES: GarbageScheduleType['frequency'][] = [
  'weekly',
  'biweekly',
  'monthly',
  'seasonal',
  'on-request',
];

/**
 * `YYYY-MM-DD` → `Wed 12 Aug`.
 *
 * Built from the string's own parts and a LOCAL `Date`, never `new Date(key)` —
 * that parses as UTC midnight and renders the previous day for every member west
 * of Greenwich, which is the same timezone bug `logic/garbageSchedule.ts` calls
 * out in its header.
 */
function formatDateKey(key: string): string {
  const parts = key.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return key;
  const date = new Date(year, month - 1, day);
  return `${WEEKDAY_LABELS[date.getDay()]} ${day} ${MONTH_LABELS[month - 1]}`;
}

function describeTypes(types: readonly string[]): string {
  const labels = types.map((t) => STREAM_LABELS[t as GarbageScheduleType['type']] ?? t);
  if (labels.length <= 1) return labels[0] ?? 'Collection';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]!.toLowerCase()}`;
}

function summarise(next: readonly CollectionDate[], daysAhead: number): string {
  const first = next[0];
  if (!first) {
    return `Nothing is scheduled for collection in the next ${daysAhead} days.`;
  }
  const verb = first.types.length > 1 ? 'go out' : 'goes out';
  return `${describeTypes(first.types)} ${verb} ${formatDateKey(first.date)}.`;
}

/** A stream the expansion can actually do something with. */
function isUsableStream(stream: GarbageScheduleType | null | undefined): boolean {
  return !!stream && !!stream.type && !!stream.frequency;
}

function pickSchedule(
  ledger: GarbageLedgerView,
  householdId?: string,
): LocalGarbageSchedule | null {
  const rows = ledger.garbageSchedules ?? [];
  if (!householdId) return rows[0] ?? null;
  return rows.find((row) => row.household_id === householdId) ?? null;
}

/**
 * Stage A — deterministic, offline, free.
 *
 * Returns `null` (fall through) only when the member has saved no streams. Note
 * that "streams exist but none land in the next 30 days" is an *answer*, not a
 * gap: an on-request-only municipality is correctly described by "nothing is
 * scheduled", and escalating that to a paid provider would buy the member
 * nothing.
 */
export function inferGarbageDayStageA(
  schedule: LocalGarbageSchedule | null,
  today: Date,
  daysAhead: number,
): GarbageDayAnswer | null {
  if (!schedule) return null;
  const streams = (schedule.schedules ?? []).filter(isUsableStream);
  if (streams.length === 0) return null;

  const next = expandCollectionDates(streams, daysAhead, today);
  return {
    source: 'schedule',
    next,
    streams,
    summary: summarise(next, daysAhead),
    needsConfirmation: false,
  };
}

export const GARBAGE_INFERENCE_SYSTEM_PROMPT = [
  'You infer municipal waste collection patterns for a home maintenance app.',
  'You are given a municipality name and nothing else — no address, no names.',
  'Return the collection pattern that municipality most commonly publishes.',
  'If you do not recognise the municipality, return an empty schedules array',
  'rather than inventing a pattern. A wrong bin day costs the member a week.',
].join(' ');

export const GARBAGE_INFERENCE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    schedules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: VALID_STREAM_TYPES },
          frequency: { type: 'string', enum: VALID_FREQUENCIES },
          dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
          week: { type: 'string', enum: ['A', 'B'] },
        },
        required: ['type', 'frequency'],
      },
    },
  },
  required: ['schedules'],
};

type RawInferredSchedule = {
  schedules?: Array<Record<string, unknown>>;
};

/**
 * Keep only what the expansion can trust.
 *
 * A model will happily return `dayOfWeek: 7`, `frequency: 'fortnightly'` or a
 * stream type we have no bin for. Passing that into `expandCollectionDates`
 * produces either silence or an infinite-looking window; dropping it produces an
 * honest partial answer.
 */
export function normalizeInferredStreams(raw: RawInferredSchedule | null): GarbageScheduleType[] {
  const out: GarbageScheduleType[] = [];
  for (const item of raw?.schedules ?? []) {
    const type = item.type as GarbageScheduleType['type'];
    const frequency = item.frequency as GarbageScheduleType['frequency'];
    if (!VALID_STREAM_TYPES.includes(type)) continue;
    if (!VALID_FREQUENCIES.includes(frequency)) continue;

    const stream: GarbageScheduleType = { type, frequency };
    const dayOfWeek = item.dayOfWeek;
    if (typeof dayOfWeek === 'number' && Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6) {
      stream.dayOfWeek = dayOfWeek;
    }
    if (item.week === 'A' || item.week === 'B') stream.week = item.week;
    out.push(stream);
  }
  return out;
}

/**
 * Run the ladder for garbage day.
 *
 * Stage B is only wired when there is something for it to work from — a schedule
 * row carrying a municipality. Without that, `stageB` is left undefined and the
 * ladder returns Stage C `not_supported`, which is the truthful answer: no key
 * in the world lets the assistant guess a bin day for an unknown town.
 */
export async function inferGarbageDay(
  input: GarbageDayInferenceInput,
): Promise<HouseAiLadderResult<GarbageDayAnswer>> {
  const today = input.today ?? new Date();
  const daysAhead = input.daysAhead ?? GARBAGE_INFERENCE_DAYS_AHEAD;
  const byok = input.byok ?? houseByokPort;
  const schedule = pickSchedule(input.ledger, input.householdId);

  // Only the one row this answer concerns is offered to the projection — the
  // context builder would clamp at 200 rows anyway, but handing it the whole
  // table and trusting the clamp is how a multi-property device leaks a second
  // home's municipality into a prompt about the first.
  const context = buildHouseAiContext(
    { garbageSchedules: schedule ? [schedule] : [] },
    ['garbageSchedules'],
  );

  const canAsk = !!schedule?.municipality?.trim();

  /**
   * Stage A is evaluated BEFORE the vault is consulted, and the ladder is then
   * handed the cached result. Two reasons, both load-bearing:
   *  - a member with a saved schedule never triggers a Keychain read to answer
   *    a question that needed no key;
   *  - a test can prove Stage A performs no I/O at all by passing a port whose
   *    `hasKey`/`generate` throw. If the answer still comes back, Stage A is
   *    genuinely offline (DoD H7: "Stage A parse tested offline").
   */
  const deterministic = inferGarbageDayStageA(schedule, today, daysAhead);
  const needsStageB = deterministic === null && canAsk;

  return runHouseAiLadder<GarbageDayAnswer>({
    stageA: () => deterministic,
    stageB: canAsk
      ? async (projected) => {
          const raw = await byok.generate<RawInferredSchedule>({
            systemPrompt: GARBAGE_INFERENCE_SYSTEM_PROMPT,
            userPrompt:
              'Infer the usual waste collection pattern for the municipality in the context below.',
            schema: GARBAGE_INFERENCE_SCHEMA,
            context: projected,
            maxTokens: 512,
          });
          const streams = normalizeInferredStreams(raw);
          if (streams.length === 0) return null;

          const next = expandCollectionDates(streams, daysAhead, today);
          /**
           * A guess that yields no pickups is a failed guess, not an answer.
           *
           * The asymmetry with Stage A is deliberate. There, "no dates in the
           * window" describes a schedule the member configured themselves — an
           * on-request-only municipality — and saying so is correct. Here it
           * means the model returned a pattern the expansion cannot use
           * (typically a weekly stream with the `dayOfWeek` normalised away),
           * and rendering "nothing is scheduled" would present that failure as
           * a fact about the member's home.
           */
          if (next.length === 0) return null;

          return {
            source: 'assistant',
            next,
            streams,
            summary: `${summarise(next, daysAhead)} Check this against your city before you rely on it.`,
            needsConfirmation: true,
          };
        }
      : undefined,
    context,
    hasProviderKey: needsStageB ? await byok.hasKey() : false,
  });
}
