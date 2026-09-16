/**
 * Coach PROPOSALS — the contract that keeps the model out of the database.
 *
 * Ported from the donor's `LoggingProposal`
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/services/healthCoach/contracts/`)
 * and its iOS counterpart `HealthCoachEncoding.payloadHash`.
 *
 * ── THE SHAPE OF THE GUARANTEE ───────────────────────────────────────────────
 *
 * The coach never writes. It emits a proposal carrying a `payload_hash` over the
 * exact numbers it is proposing. The screen shows those numbers; when the person
 * taps Confirm, the client echoes the hash back, and the commit route refuses
 * unless it matches. So:
 *
 *   - a proposal cannot be committed with numbers the person did not see;
 *   - a proposal cannot be committed after it expires (15 minutes, the donor's
 *     window) — a stale suggestion about "today" must not land tomorrow;
 *   - a double tap replays idempotently instead of logging the meal twice,
 *     because `(user_id, operation_id)` is the ledger's primary key.
 *
 * ── THE HASH IS PORTED BYTE-FOR-BYTE ─────────────────────────────────────────
 *
 * FNV-1a, 32-bit, over a canonical JSON encoding with the object keys SORTED, as
 * lowercase hex. The donor computes the same hash on the Swift side
 * (`HealthCoachEncoding.payloadHash`) and the two must agree or every commit
 * 409s. It is a checksum against accidental mutation, NOT a MAC — it is not a
 * secret and it is not signed, and it does not need to be: the commit route
 * re-reads the payload it was sent, and the ledger is user-scoped, so the worst
 * a forged hash buys is the ability to write your own data through a route you
 * could already write to directly.
 *
 * `canonicalJson` sorts keys at every depth. Without that, two encodings of the
 * same proposal hash differently and every commit fails on the client that
 * happened to serialise in a different order — the classic way this contract
 * breaks in production and never in tests.
 */

/**
 * Domains a proposal may target. Mirrors `health_coach_operations.target_type`.
 *
 * `workout`, `period` and `habit` are the three verbs added after the first
 * release. `target_type` is a bare `TEXT NOT NULL` in migration 0128 with no
 * CHECK constraint — deliberately, per that file's header — so widening this
 * union needed no migration. The union IS the constraint, and `validateCommit`
 * is where it is enforced.
 */
export type ProposalTargetType =
  | 'water'
  | 'weight'
  | 'nutrition'
  | 'workout'
  | 'period'
  | 'habit';

export interface ProposalMealItem {
  food_name: string;
  grams: number | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/** The 0124 effort enum. NULL = the person did not say, which is not "easy". */
export type ProposalWorkoutIntensity = 'easy' | 'steady' | 'hard' | 'max';

export type ProposalPayload =
  | { kind: 'water'; amount_ml: number }
  | { kind: 'weight'; weight: number; unit: 'kg' | 'lb' }
  | {
      kind: 'nutrition';
      meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
      items: ProposalMealItem[];
    }
  | {
      kind: 'workout';
      workout_type: string;
      minutes: number;
      calories: number | null;
      note: string | null;
      intensity: ProposalWorkoutIntensity | null;
    }
  | { kind: 'period'; flow_level: number; notes: string | null }
  | {
      kind: 'habit';
      habit_id: string;
      /**
       * The name the confirm card SHOWS. Carried on the payload so the commit
       * path can check it against the stored habit and refuse a pair whose id
       * and name disagree — otherwise a proposal could display one habit and
       * tick another, which the hash cannot catch because it covers both fields.
       */
      habit_name: string;
    };

export interface CoachProposal {
  operation_id: string;
  /** Only 'create' today; the column exists for the donor's update/delete verbs. */
  operation_type: 'create';
  target_type: ProposalTargetType;
  /** What the person actually typed, so the review card can quote them. */
  original_text: string;
  normalized_payload: ProposalPayload;
  payload_hash: string;
  /** ISO. 15 minutes out, the donor's window. */
  expires_at: string;
  commit_status: 'proposed';
}

/** The donor's window, in milliseconds. */
export const PROPOSAL_TTL_MS = 15 * 60 * 1000;

/**
 * Deterministic JSON with keys sorted at every depth.
 *
 * `undefined` members are dropped (they are not JSON), arrays keep their order
 * (order is meaning for a list of foods), and numbers are emitted by
 * `JSON.stringify` so `1.0` and `1` both encode as `1` — which is what makes the
 * Swift and TypeScript sides agree.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * FNV-1a 32-bit over the canonical encoding, as 8 lowercase hex digits.
 *
 * Kept identical to the donor's Swift implementation — see the module header for
 * why this is a checksum rather than a signature.
 */
export function payloadHash(payload: unknown): string {
  const text = canonicalJson(payload);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    // `Math.imul` keeps the 32-bit FNV prime multiply exact; `*` would go double.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Bounds a proposal must satisfy before it is ever shown.
 *
 * These are not advisory. Every one of them mirrors the zod cap on the ordinary
 * route that writes the same row, so a proposal can never offer to store a
 * figure the hand-typed path would have refused — which is the specific failure
 * that let a hand-made proposal put `1e12` ml into `water_entries` and 500 the
 * daily summary. Widening one here means widening the route's schema too, and
 * the reverse.
 */
const WATER_MIN_ML = 1;
const WATER_MAX_ML = 5000;
const WEIGHT_MIN = 20;
const WEIGHT_MAX = 700;
const MAX_MEAL_ITEMS = 10;
const FOOD_NAME_MAX = 120;
/** `POST /health/entries/workouts`: type ≤40, 1–1440 min, ≤5000 kcal, note ≤200. */
const WORKOUT_TYPE_MAX = 40;
const WORKOUT_MIN_MINUTES = 1;
const WORKOUT_MAX_MINUTES = 1440;
const WORKOUT_MAX_CALORIES = 5000;
const WORKOUT_NOTE_MAX = 200;
/** `POST /health/cycle/periods`: donor scale 1=spotting … 5=very heavy, note ≤500. */
const PERIOD_MIN_FLOW = 1;
const PERIOD_MAX_FLOW = 5;
const PERIOD_NOTES_MAX = 500;
/** `POST /health/habits`: name ≤60. The id is `newId('habit')`, comfortably under 64. */
const HABIT_NAME_MAX = 60;
const HABIT_ID_MAX = 64;

/**
 * Trim, cut to length, then trim AGAIN — and the second trim is the point.
 *
 * `normalizePayload` has to be IDEMPOTENT on its own output, because
 * `validateCommit` proves a payload is genuine by re-running it and comparing.
 * Plain `s.trim().slice(0, n)` is not: when the cut lands just after a space the
 * result carries trailing whitespace, so a second pass trims it away, the two
 * encodings differ, and a perfectly legitimate proposal is refused as malformed.
 * Trimming after the cut makes the second pass a no-op for every input.
 */
function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max).trim();
}

/**
 * Turn one accepted tool call into a proposal, or return null.
 *
 * Null is the honest answer for a tool call the model got wrong — an
 * out-of-range weight, an empty meal, a negative volume. Building a proposal
 * anyway and letting the commit route 400 later would show the person a card
 * offering to log something the server will refuse.
 */
export function buildProposal(args: {
  toolName: string;
  input: unknown;
  originalText: string;
  now: Date;
  newId: () => string;
}): CoachProposal | null {
  const payload = normalizePayload(args.toolName, args.input);
  if (!payload) return null;

  return {
    operation_id: args.newId(),
    operation_type: 'create',
    target_type: payload.kind,
    original_text: args.originalText,
    normalized_payload: payload,
    payload_hash: payloadHash(payload),
    expires_at: new Date(args.now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    commit_status: 'proposed',
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Optional macro: a number when present and finite, otherwise null. Never NaN. */
function optNum(v: unknown): number | null {
  const n = num(v);
  return n === null || n < 0 ? null : n;
}

function normalizePayload(toolName: string, rawInput: unknown): ProposalPayload | null {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  if (toolName === 'prepare_log_water') {
    const ml = num(input.amount_ml);
    if (ml === null) return null;
    const rounded = Math.round(ml);
    if (rounded < WATER_MIN_ML || rounded > WATER_MAX_ML) return null;
    return { kind: 'water', amount_ml: rounded };
  }

  if (toolName === 'prepare_log_weight') {
    const weight = num(input.weight);
    const unit = input.unit;
    if (weight === null) return null;
    if (unit !== 'kg' && unit !== 'lb') return null;
    if (weight < WEIGHT_MIN || weight > WEIGHT_MAX) return null;
    // Two decimals is what a scale shows and what the weight routes store.
    return { kind: 'weight', weight: Math.round(weight * 100) / 100, unit };
  }

  if (toolName === 'prepare_log_meal') {
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const items: ProposalMealItem[] = [];
    for (const raw of rawItems.slice(0, MAX_MEAL_ITEMS)) {
      const it = (raw ?? {}) as Record<string, unknown>;
      const name = clampText(it.food_name, FOOD_NAME_MAX);
      if (name.length === 0) continue;
      items.push({
        food_name: name,
        grams: optNum(it.grams),
        calories: optNum(it.calories),
        protein_g: optNum(it.protein_g),
        carbs_g: optNum(it.carbs_g),
        fat_g: optNum(it.fat_g),
      });
    }
    if (items.length === 0) return null;
    const mealType = input.meal_type;
    const meal_type =
      mealType === 'breakfast' || mealType === 'lunch' || mealType === 'dinner' || mealType === 'snack'
        ? mealType
        : null;
    return { kind: 'nutrition', meal_type, items };
  }

  if (toolName === 'prepare_log_workout') {
    const workout_type = clampText(input.workout_type, WORKOUT_TYPE_MAX);
    if (workout_type.length === 0) return null;

    const rawMinutes = num(input.minutes);
    if (rawMinutes === null) return null;
    const minutes = Math.round(rawMinutes);
    if (minutes < WORKOUT_MIN_MINUTES || minutes > WORKOUT_MAX_MINUTES) return null;

    // Burned energy is OPTIONAL and stays null unless the person read it off a
    // device. An out-of-range figure refuses the whole proposal rather than
    // being quietly clamped: a clamped burn is a number nobody stated.
    const rawCalories = num(input.calories);
    const calories = rawCalories === null ? null : Math.round(rawCalories);
    if (calories !== null && (calories < 0 || calories > WORKOUT_MAX_CALORIES)) return null;

    const note = clampText(input.note, WORKOUT_NOTE_MAX);
    const rawIntensity = input.intensity;
    const intensity: ProposalWorkoutIntensity | null =
      rawIntensity === 'easy' ||
      rawIntensity === 'steady' ||
      rawIntensity === 'hard' ||
      rawIntensity === 'max'
        ? rawIntensity
        : null;

    return {
      kind: 'workout',
      workout_type,
      minutes,
      calories,
      note: note.length > 0 ? note : null,
      intensity,
    };
  }

  if (toolName === 'prepare_log_period_day') {
    const rawFlow = num(input.flow_level);
    if (rawFlow === null) return null;
    const flow_level = Math.round(rawFlow);
    // No default: `period_entries.flow_level` defaults to 3 in SQL, and letting
    // an unstated level fall through to "medium" would put a claim about the
    // person's body on a row they never made. Out of range is a refusal.
    if (flow_level < PERIOD_MIN_FLOW || flow_level > PERIOD_MAX_FLOW) return null;
    const notes = clampText(input.notes, PERIOD_NOTES_MAX);
    return { kind: 'period', flow_level, notes: notes.length > 0 ? notes : null };
  }

  if (toolName === 'prepare_log_habit') {
    const habit_id = clampText(input.habit_id, HABIT_ID_MAX);
    const habit_name = clampText(input.habit_name, HABIT_NAME_MAX);
    // Both are required. The id is what gets ticked; the name is what the person
    // reads on the card, and the commit path refuses the pair unless the stored
    // habit answers to both. Ownership of the id is re-checked there too — this
    // is a pure function and cannot see the database.
    if (habit_id.length === 0 || habit_name.length === 0) return null;
    return { kind: 'habit', habit_id, habit_name };
  }

  return null;
}

/**
 * Re-derive the canonical form of a payload that CLAIMS to be a proposal.
 *
 * `normalizePayload` is idempotent on its own output — rounding a rounded
 * millilitre, trimming a trimmed name and re-clamping a clamped list all give
 * back the same value — so "would `buildProposal` have produced exactly this?"
 * is answerable by running the payload back through it and comparing.
 *
 * Returns null for anything that could not have been proposed.
 */
function renormalizePayload(payload: unknown): ProposalPayload | null {
  const kind = (payload as { kind?: unknown } | null)?.kind;
  if (kind === 'water') return normalizePayload('prepare_log_water', payload);
  if (kind === 'weight') return normalizePayload('prepare_log_weight', payload);
  if (kind === 'nutrition') return normalizePayload('prepare_log_meal', payload);
  if (kind === 'workout') return normalizePayload('prepare_log_workout', payload);
  if (kind === 'period') return normalizePayload('prepare_log_period_day', payload);
  if (kind === 'habit') return normalizePayload('prepare_log_habit', payload);
  return null;
}

/**
 * Kinds this build knows how to re-derive. A `target_type` outside this set is
 * refused BEFORE the payload is looked at.
 *
 * Kept as one list rather than a chain of `!==` comparisons because the chain is
 * how the next verb gets added to the union, shipped, and silently accepted at
 * commit without ever going through `renormalizePayload` — the exact hole the
 * re-derivation exists to close.
 */
const COMMITTABLE_TARGETS: ReadonlySet<string> = new Set<ProposalTargetType>([
  'water',
  'weight',
  'nutrition',
  'workout',
  'period',
  'habit',
]);

/**
 * Everything the commit route must be satisfied of before it writes.
 *
 * Split out from the route so the rules are testable without a request, and so
 * the ORDER of the checks is visible: shape, then hash, then expiry. Hash before
 * expiry is deliberate — a tampered payload should read as tampered, not as
 * merely stale.
 *
 * THE PAYLOAD IS RE-DERIVED, NOT TRUSTED. `payload_hash` is a checksum, not a
 * signature (see the module header), so a caller can hand over any payload it
 * likes and hash it itself. Everything downstream — the volume written to
 * `water_entries`, the `unit` a CHECK constraint accepts, the fact that `items`
 * is an array at all — used to come straight off that unverified object, which
 * meant a hand-made proposal could store `amount_ml: 1e12`, or a `unit` no
 * column accepts (a 500, not a 400), through a path whose own zod route caps
 * would have refused it. Running it back through the normaliser puts the commit
 * route under exactly the bounds `buildProposal` applies, and the VALIDATED copy
 * is what is returned, so no caller can accidentally use the raw one.
 *
 * EVERY TARGET TYPE GOES THROUGH THIS, including the three added later. The
 * three verbs `workout`, `period` and `habit` are in `COMMITTABLE_TARGETS` and
 * in `renormalizePayload`, and a kind in one but not the other is refused rather
 * than trusted: a `workout` payload that reached `writeDomain` without being
 * re-derived could carry 100000 minutes or a 40-megabyte note, and it would be a
 * 500 in the entry table rather than a 400 here. `target_unavailable` covers the
 * one check this pure function CANNOT make — whether the habit id belongs to the
 * caller — which is why that check lives in the commit path and not here.
 */
export type CommitRefusal =
  | 'invalid_proposal'
  | 'payload_hash_mismatch'
  | 'proposal_expired'
  /**
   * The proposal was genuine and current, but the row it points at is not
   * writable for this user — today, a habit id that is not theirs, was deleted,
   * or no longer answers to the name the card displayed. Distinct from
   * `invalid_proposal` because nothing about the payload is malformed: the
   * person confirmed something real that has since moved, and the honest answer
   * is "ask again", not "that was never valid".
   */
  | 'target_unavailable';

export function validateCommit(args: {
  proposal: unknown;
  confirmedHash: unknown;
  now: Date;
}): { ok: true; proposal: CoachProposal } | { ok: false; reason: CommitRefusal } {
  const p = args.proposal as CoachProposal | null;
  if (!p || typeof p !== 'object') return { ok: false, reason: 'invalid_proposal' };
  if (typeof p.operation_id !== 'string' || p.operation_id.length === 0) {
    return { ok: false, reason: 'invalid_proposal' };
  }
  if (typeof p.target_type !== 'string' || !COMMITTABLE_TARGETS.has(p.target_type)) {
    return { ok: false, reason: 'invalid_proposal' };
  }
  if (typeof p.payload_hash !== 'string' || typeof p.expires_at !== 'string') {
    return { ok: false, reason: 'invalid_proposal' };
  }
  const payload = p.normalized_payload as ProposalPayload | undefined;
  if (!payload || payload.kind !== p.target_type) {
    return { ok: false, reason: 'invalid_proposal' };
  }
  // A payload `buildProposal` could not have produced is malformed, not
  // tampered — so this reads as `invalid_proposal` (400) rather than a hash
  // mismatch (409), and it runs BEFORE the hash so an out-of-bounds figure is
  // never reported as merely "the numbers changed".
  const canonical = renormalizePayload(payload);
  if (!canonical || canonicalJson(canonical) !== canonicalJson(payload)) {
    return { ok: false, reason: 'invalid_proposal' };
  }

  // The hash must describe the payload we were actually handed …
  if (payloadHash(payload) !== p.payload_hash) {
    return { ok: false, reason: 'payload_hash_mismatch' };
  }
  // … and the client must echo the hash it was SHOWN.
  if (args.confirmedHash !== p.payload_hash) {
    return { ok: false, reason: 'payload_hash_mismatch' };
  }

  const expiry = Date.parse(p.expires_at);
  if (!Number.isFinite(expiry) || expiry < args.now.getTime()) {
    return { ok: false, reason: 'proposal_expired' };
  }

  // The re-derived copy, never the caller's — see the header.
  return { ok: true, proposal: { ...p, normalized_payload: canonical } };
}
