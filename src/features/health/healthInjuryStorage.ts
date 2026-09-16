import {
  healthInjuriesApi,
  type HealthInjury,
  type HealthInjuryPatch,
  type HealthInjuryPayload,
  type HealthPainLevel,
} from '@api/healthInjuries';
import { storageHelpers } from '@services/storage';

import { todayDateKey } from './healthLocalStorage';
import { healthSyncStateFor, readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — INJURY LOG (ported donor `InjuryModels` + `BodyPainTrackerView`).
 *
 * The record of truth is `/health/injuries*` on the `symply-health-api` Worker;
 * MMKV is an offline read-through cache exactly as in every other Health store.
 *
 * WHY THIS MODULE EXISTS AT ALL: the workout library already *consumes* an
 * injury verdict (`injuryFlag` / "Avoid for now" / the two-tap log guard in
 * `healthExerciseStorage`), but until now nothing in the app could WRITE an
 * injury — so that whole safety surface could only ever fire for a row entered
 * somewhere else. This is the write half.
 *
 * ── THE RULE THIS MODULE PROTECTS ────────────────────────────────────────────
 *
 * **`body_part` must survive the server's folder, or the gate silently dies.**
 *
 * `injuries.body_part` is free text on the wire (the route only bounds it to 60
 * characters). The gate does not compare it literally: it folds it through
 * `canonicalBodyPart()` in `backend/src/services/health-exercise-service.ts`,
 * which lowercases, replaces every NON-ALPHANUMERIC run with `_`, strips a
 * `left_`/`right_`/`l_`/`r_` side affix, then looks the result up in an alias
 * table and finally in `BODY_PART_MUSCLES`.
 *
 * That makes the separator load-bearing:
 *
 *     "Left Knee"  → left_knee → (side stripped) knee     → gate FIRES
 *     "leftKnee"   → leftknee  → (no separator to strip)  → gate NEVER FIRES
 *
 * The donor persists `BodyPart.rawValue`, which is camelCase (`leftKnee`,
 * `lowerBack`). **DELIBERATE DIFFERENCE: we persist the donor's `displayName`
 * instead** ("Left Knee", "Lower Back"). Two reasons, both load-bearing:
 *
 *   1. the space is what lets the deployed folder recognise the part at all, and
 *   2. `body_part` is echoed straight back to the user by the workout library's
 *      injury banner (`humanizeToken(i.bodyPart)`), so a human-readable value is
 *      the correct thing to store anyway.
 *
 * The vocabulary therefore lives in ONE place — `INJURY_BODY_PARTS` below — and
 * `__tests__/healthInjuryStorage.test.ts` proves every entry round-trips through
 * the REAL deployed alias/muscle tables, read out of the backend source. A
 * screen must never send an ad-hoc string.
 *
 * ── SAFETY-SURFACE STANCE ────────────────────────────────────────────────────
 *
 * This module RECORDS what the user tells it and nothing more. It does not
 * diagnose, does not grade, does not advise treatment, and never decides for
 * itself whether an exercise is safe — that verdict is the Worker's and arrives
 * on the catalogue row. Three donor behaviours are deliberately NOT ported:
 *
 *   - the "Recovery Tips" card ("Professional recommendations", "Consult a
 *     professional for persistent pain", "Use RICE: Rest, Ice, Compression,
 *     Elevation") — that is treatment advice;
 *   - `PainLevel.description` ("Noticeable pain, may limit some activities") —
 *     that is the app interpreting a symptom back at the user. The bare level
 *     NAME stays, because that is the user's own report, not our reading of it;
 *   - the clinical muscle-group picker (`BodyPart.muscleGroups` = "ACL", "MCL",
 *     "Meniscus", "Plantar Fascia") — tagging a knee ache "ACL" is
 *     self-diagnosis. The column still exists server-side and stays null; the
 *     gate does not read it (`activeInjuryParts` folds `body_part` only), so
 *     dropping the picker costs the safety surface nothing.
 */

export const HEALTH_INJURIES_KEY = 'health.injuries.v1';

/* ==================================================================== */
/* Body-part vocabulary — the gate's contract                            */
/* ==================================================================== */

/** Donor `BodyRegion`, used only to group the picker. */
export type InjuryRegion = 'headNeck' | 'arms' | 'torso' | 'hips' | 'legs';

export const INJURY_REGION_LABELS: Record<InjuryRegion, string> = {
  headNeck: 'Head & neck',
  arms: 'Arms & shoulders',
  torso: 'Torso',
  hips: 'Hips & pelvis',
  legs: 'Legs & feet',
};

export const INJURY_REGIONS: readonly InjuryRegion[] = [
  'headNeck',
  'arms',
  'torso',
  'hips',
  'legs',
] as const;

export interface InjuryBodyPart {
  /**
   * The donor's `BodyPart.rawValue`. Kept as the stable local key (menu keys,
   * testIDs, cache identity) — it is NEVER what goes on the wire.
   */
  id: string;
  /**
   * What is sent as `body_part` and shown back to the user, verbatim. See the
   * module header: the space is what makes the deployed folder recognise it.
   */
  wire: string;
  region: InjuryRegion;
}

/**
 * The donor's 32 `BodyPart` cases, in the donor's own order and grouping.
 *
 * `wire` is the donor's `displayName`. Which of these the deployed gate can act
 * on is NOT asserted here — it is derived from the backend's own tables in the
 * test, so this list cannot quietly drift away from the Worker.
 */
export const INJURY_BODY_PARTS: readonly InjuryBodyPart[] = [
  { id: 'head', wire: 'Head', region: 'headNeck' },
  { id: 'neck', wire: 'Neck', region: 'headNeck' },

  { id: 'leftShoulder', wire: 'Left Shoulder', region: 'arms' },
  { id: 'rightShoulder', wire: 'Right Shoulder', region: 'arms' },
  { id: 'leftUpperArm', wire: 'Left Upper Arm', region: 'arms' },
  { id: 'rightUpperArm', wire: 'Right Upper Arm', region: 'arms' },
  { id: 'leftElbow', wire: 'Left Elbow', region: 'arms' },
  { id: 'rightElbow', wire: 'Right Elbow', region: 'arms' },
  { id: 'leftForearm', wire: 'Left Forearm', region: 'arms' },
  { id: 'rightForearm', wire: 'Right Forearm', region: 'arms' },
  { id: 'leftWrist', wire: 'Left Wrist', region: 'arms' },
  { id: 'rightWrist', wire: 'Right Wrist', region: 'arms' },
  { id: 'leftHand', wire: 'Left Hand', region: 'arms' },
  { id: 'rightHand', wire: 'Right Hand', region: 'arms' },

  { id: 'chest', wire: 'Chest', region: 'torso' },
  { id: 'upperBack', wire: 'Upper Back', region: 'torso' },
  { id: 'lowerBack', wire: 'Lower Back', region: 'torso' },
  { id: 'abdomen', wire: 'Abdomen', region: 'torso' },

  { id: 'leftHip', wire: 'Left Hip', region: 'hips' },
  { id: 'rightHip', wire: 'Right Hip', region: 'hips' },
  { id: 'groin', wire: 'Groin', region: 'hips' },
  { id: 'glutes', wire: 'Glutes', region: 'hips' },

  { id: 'leftThigh', wire: 'Left Thigh', region: 'legs' },
  { id: 'rightThigh', wire: 'Right Thigh', region: 'legs' },
  { id: 'leftKnee', wire: 'Left Knee', region: 'legs' },
  { id: 'rightKnee', wire: 'Right Knee', region: 'legs' },
  { id: 'leftCalf', wire: 'Left Calf', region: 'legs' },
  { id: 'rightCalf', wire: 'Right Calf', region: 'legs' },
  { id: 'leftAnkle', wire: 'Left Ankle', region: 'legs' },
  { id: 'rightAnkle', wire: 'Right Ankle', region: 'legs' },
  { id: 'leftFoot', wire: 'Left Foot', region: 'legs' },
  { id: 'rightFoot', wire: 'Right Foot', region: 'legs' },
] as const;

/**
 * The parts the DEPLOYED gate cannot act on, so the screen can say so plainly
 * instead of implying a safety effect that will not happen.
 *
 * `canonicalBodyPart` folds these to `head` and `upper_arm`; neither is a key of
 * the Worker's `BODY_PART_MUSCLES`, and no seeded catalogue row lists either as
 * a joint — so an injury here is recorded and shown in history, but no exercise
 * is ever flagged for it. That is the Worker's stance, not a bug in this module:
 * no movement in the 88-row catalogue loads the skull, and the upper arm's
 * muscles reach the gate through the neighbouring elbow instead.
 *
 * The test derives this set from the backend's own tables and asserts it is
 * EXACTLY this list, so the day the Worker learns `upper_arm` the test fails and
 * this note comes out.
 */
export const GATE_UNMAPPED_BODY_PART_IDS: readonly string[] = [
  'head',
  'leftUpperArm',
  'rightUpperArm',
] as const;

export function bodyPartById(id: string): InjuryBodyPart | null {
  return INJURY_BODY_PARTS.find((part) => part.id === id) ?? null;
}

/** Picker groups, in the donor's region order. */
export function bodyPartsByRegion(): Array<{
  region: InjuryRegion;
  label: string;
  parts: InjuryBodyPart[];
}> {
  return INJURY_REGIONS.map((region) => ({
    region,
    label: INJURY_REGION_LABELS[region],
    parts: INJURY_BODY_PARTS.filter((part) => part.region === region),
  }));
}

/** Does the deployed gate act on this part? Drives one line of screen copy. */
export function affectsExerciseSuggestions(id: string): boolean {
  return !GATE_UNMAPPED_BODY_PART_IDS.includes(id);
}

/* ==================================================================== */
/* Pain, type and cause vocabularies                                     */
/* ==================================================================== */

/**
 * Donor `PainLevel`, 0–4, NAMES ONLY.
 *
 * The donor also renders an interpretation under each option ("Noticeable pain,
 * may limit some activities"). That is the app reading a symptom back at the
 * user, so it is not ported — see the module header.
 */
export const PAIN_LEVELS: readonly HealthPainLevel[] = [0, 1, 2, 3, 4] as const;

export const PAIN_LEVEL_LABELS: Record<HealthPainLevel, string> = {
  0: 'None',
  1: 'Mild',
  2: 'Moderate',
  3: 'Severe',
  4: 'Extreme',
};

/** The route's default when `pain_level` is omitted — mirrored so both agree. */
export const DEFAULT_PAIN_LEVEL: HealthPainLevel = 1;

export function isPainLevel(value: unknown): value is HealthPainLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

export function painLevelLabel(value: number): string {
  return isPainLevel(value) ? PAIN_LEVEL_LABELS[value] : PAIN_LEVEL_LABELS[DEFAULT_PAIN_LEVEL];
}

/**
 * Donor `InjuryType`. The wire value is the donor's `rawValue` — these are
 * OPAQUE tokens the server stores and never folds, so camelCase is safe here in
 * a way it is not for `body_part`.
 *
 * The donor's per-type `description` ("Ligament injury", "Inflammation or fluid
 * buildup") is deliberately not ported: naming what a symptom IS would be the
 * app diagnosing.
 */
export const INJURY_TYPES = [
  { id: 'pain', label: 'Pain' },
  { id: 'soreness', label: 'Soreness' },
  { id: 'strain', label: 'Strain' },
  { id: 'sprain', label: 'Sprain' },
  { id: 'tightness', label: 'Tightness' },
  { id: 'weakness', label: 'Weakness' },
  { id: 'numbness', label: 'Numbness' },
  { id: 'swelling', label: 'Swelling' },
  { id: 'bruise', label: 'Bruise' },
  { id: 'other', label: 'Other' },
] as const;

/** The route's default when `injury_type` is omitted. */
export const DEFAULT_INJURY_TYPE = 'pain';

export function injuryTypeLabel(id: string): string {
  return INJURY_TYPES.find((t) => t.id === id)?.label ?? humanizeInjuryToken(id);
}

/** Donor `InjuryCause`. Optional — "Not sure" is the no-value option. */
export const INJURY_CAUSES = [
  { id: 'workout', label: 'Workout' },
  { id: 'overtraining', label: 'Overtraining' },
  { id: 'accident', label: 'Accident' },
  { id: 'sportActivity', label: 'Sport' },
  { id: 'dailyActivity', label: 'Everyday activity' },
  { id: 'sleeping', label: 'Sleep position' },
  { id: 'chronic', label: 'Long-standing' },
  { id: 'unknown', label: 'Not sure' },
] as const;

export function injuryCauseLabel(id: string | null): string {
  if (id === null || id.length === 0) return 'Not stated';
  return INJURY_CAUSES.find((c) => c.id === id)?.label ?? humanizeInjuryToken(id);
}

/** `lower_back` / `sportActivity` → `Lower back` / `Sport activity`. */
export function humanizeInjuryToken(token: string): string {
  const spaced = String(token ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_+/g, ' ')
    .trim();
  if (spaced.length === 0) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/* ==================================================================== */
/* Screen shape                                                          */
/* ==================================================================== */

export interface Injury {
  id: string;
  /** `YYYY-MM-DD`, the user's LOCAL day. */
  date: string;
  /** The wire string — already human-readable, shown verbatim. */
  bodyPart: string;
  painLevel: HealthPainLevel;
  injuryType: string;
  cause: string | null;
  notes: string;
  /** `false` = resolved (healed). Still in history, out of the workout gate. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_INJURIES: Injury[] = [];

/* ==================================================================== */
/* Wire ↔ screen mappers                                                 */
/* ==================================================================== */

function clampPainLevel(value: unknown): HealthPainLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAIN_LEVEL;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded >= 4) return 4;
  return rounded as HealthPainLevel;
}

export function fromWireInjury(row: HealthInjury): Injury {
  return {
    id: row.id,
    date: typeof row.date === 'string' ? row.date : '',
    bodyPart: typeof row.body_part === 'string' ? row.body_part : '',
    painLevel: clampPainLevel(row.pain_level),
    injuryType: row.injury_type ?? DEFAULT_INJURY_TYPE,
    cause: row.cause ?? null,
    notes: row.notes ?? '',
    // The column is INTEGER 0/1 in D1; `=== true` keeps the screen contract
    // boolean-only and treats anything unexpected as RESOLVED rather than
    // active — a stale cache must never invent a gate the server does not have.
    isActive: row.is_active === true,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

/**
 * A cached list, sanitised.
 *
 * `readThrough` only checks that the snapshot is an ARRAY; the rows inside it
 * are what the screen maps over, so an older-schema entry has to be repaired
 * here or the tab crashes on exactly the offline path the cache exists for.
 */
export function normalizeInjuries(raw: Injury[] | null | undefined): Injury[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (row): row is Injury =>
        !!row && typeof row.id === 'string' && typeof row.bodyPart === 'string'
    )
    .map((row) => ({ ...row, painLevel: clampPainLevel(row.painLevel) }));
}

/* ==================================================================== */
/* Ordering and derived views                                            */
/* ==================================================================== */

/**
 * The Worker's own ordering, so offline and online read the same:
 * newest date first, then newest created.
 */
export function sortInjuries(rows: Injury[]): Injury[] {
  return [...rows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );
}

export function activeInjuries(rows: Injury[]): Injury[] {
  return sortInjuries(rows.filter((row) => row.isActive));
}

export function resolvedInjuries(rows: Injury[]): Injury[] {
  return sortInjuries(rows.filter((row) => !row.isActive));
}

export interface InjurySummary {
  active: number;
  resolved: number;
  /** Distinct body parts currently steering the workout library. */
  gatingParts: string[];
}

/**
 * Plain counts. Deliberately NOT the donor's "Avg Pain" tile or its
 * "N requiring attention" subtitle — both read as the app grading the user's
 * condition. Counting rows does not.
 *
 * `gatingParts` only lists parts the deployed gate acts on, so the screen never
 * claims an effect the Worker will not produce.
 */
export function summarizeInjuries(rows: Injury[]): InjurySummary {
  const live = rows.filter((row) => row.isActive);
  const gating = new Set<string>();
  for (const row of live) {
    const part = INJURY_BODY_PARTS.find((p) => p.wire === row.bodyPart);
    // An unknown wording came from another client or an older build; assume it
    // MIGHT gate rather than promising it will not.
    if (part === null || part === undefined || affectsExerciseSuggestions(part.id)) {
      gating.add(row.bodyPart);
    }
  }
  return {
    active: live.length,
    resolved: rows.length - live.length,
    gatingParts: [...gating].sort((a, b) => a.localeCompare(b)),
  };
}

/** "today" / "yesterday" / "4 days ago" — the donor's `daysSinceCreated`, in words. */
export function loggedAgoLabel(date: string, today = todayDateKey()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'date not recorded';
  const then = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(then) || Number.isNaN(now)) return 'date not recorded';
  const days = Math.round((now - then) / 86_400_000);
  if (days < 0) return 'logged for a future date';
  if (days === 0) return 'logged today';
  if (days === 1) return 'logged yesterday';
  return `logged ${days} days ago`;
}

/* ==================================================================== */
/* Input parsing — a keyboardType is a hint, never a guarantee            */
/* ==================================================================== */

/** Digits and dashes only — the field takes a `YYYY-MM-DD` day key. */
export function sanitizeInjuryDateInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^0-9-]/g, '').slice(0, 10);
}

export type ParsedInjuryDate = { valid: true; date: string } | { valid: false };

/**
 * Parse the date field. Blank is INVALID here (unlike the fridge's expiry, an
 * injury always happened on some day) — the form seeds it with today.
 *
 * The round-trip check is load-bearing: V8 ROLLS an out-of-range day OVER rather
 * than failing, so `2026-02-30` parses happily as 2 March. The route's regex
 * would accept it and the row would then sort against a day the user never
 * chose, so it is refused here rather than 400ing (or worse, storing) at the
 * Worker.
 */
export function parseInjuryDateInput(raw: string): ParsedInjuryDate {
  if (typeof raw !== 'string') return { valid: false };
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { valid: false };
  const ts = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(ts)) return { valid: false };
  if (new Date(ts).toISOString().slice(0, 10) !== trimmed) return { valid: false };
  return { valid: true, date: trimmed };
}

/** The route bounds `notes` at 1000 characters; refuse locally rather than 400. */
export const MAX_INJURY_NOTES = 1000;

/* ==================================================================== */
/* Draft → payload                                                       */
/* ==================================================================== */

export interface InjuryDraft {
  /** Donor `BodyPart.rawValue` — resolved to its wire string on the way out. */
  bodyPartId: string | null;
  painLevel: HealthPainLevel;
  injuryType: string;
  cause: string | null;
  date: string;
  notes: string;
}

export function emptyInjuryDraft(today = todayDateKey()): InjuryDraft {
  return {
    bodyPartId: null,
    painLevel: DEFAULT_PAIN_LEVEL,
    injuryType: DEFAULT_INJURY_TYPE,
    // Donor default. The donor has no cause picker default of "none", so this
    // matches its `@State private var selectedCause: InjuryCause = .workout`.
    cause: 'workout',
    date: today,
    notes: '',
  };
}

/** Re-open an existing row in the form. Unknown wordings resolve to no part. */
export function draftFromInjury(injury: Injury): InjuryDraft {
  const part = INJURY_BODY_PARTS.find((p) => p.wire === injury.bodyPart) ?? null;
  return {
    bodyPartId: part?.id ?? null,
    painLevel: injury.painLevel,
    injuryType: injury.injuryType,
    cause: injury.cause,
    date: injury.date,
    notes: injury.notes,
  };
}

export type DraftValidation =
  | { valid: true; payload: HealthInjuryPayload }
  | { valid: false; message: string };

export const NO_BODY_PART_MESSAGE = 'Choose the area first.';
export const BAD_DATE_MESSAGE = 'Enter the date as YYYY-MM-DD.';
export const LONG_NOTES_MESSAGE = `Keep the note under ${MAX_INJURY_NOTES} characters.`;

/**
 * Turn a form draft into a request body, or say — in plain words, never a raw
 * validator string — why it cannot be sent.
 *
 * `body_part` is resolved from the picker id, so the wire vocabulary can only
 * ever be one of `INJURY_BODY_PARTS`. That is the single choke point the gate
 * contract depends on.
 */
export function validateInjuryDraft(draft: InjuryDraft): DraftValidation {
  const part = draft.bodyPartId === null ? null : bodyPartById(draft.bodyPartId);
  if (part === null) return { valid: false, message: NO_BODY_PART_MESSAGE };

  const date = parseInjuryDateInput(draft.date);
  if (!date.valid) return { valid: false, message: BAD_DATE_MESSAGE };

  const notes = draft.notes.trim();
  if (notes.length > MAX_INJURY_NOTES) return { valid: false, message: LONG_NOTES_MESSAGE };

  return {
    valid: true,
    payload: {
      date: date.date,
      body_part: part.wire,
      pain_level: isPainLevel(draft.painLevel) ? draft.painLevel : DEFAULT_PAIN_LEVEL,
      injury_type: draft.injuryType,
      cause: draft.cause === null || draft.cause.length === 0 ? null : draft.cause,
      notes: notes.length === 0 ? null : notes,
    },
  };
}

/* ==================================================================== */
/* Failure copy — no raw error string ever reaches the UI                 */
/* ==================================================================== */

export type InjuryWriteStatus = 'saved' | 'offline' | 'rejected';

export const OFFLINE_WRITE_MESSAGE =
  'Saved on this device — it will sync when you are back online.';
export const MISSING_INJURY_MESSAGE = 'That entry is no longer in your log.';

/**
 * Friendly copy for a request the SERVER refused, or `null` when the failure
 * looks like a lost connection. Only the HTTP status is ever inspected — the
 * error's own message is never read, so a raw string cannot leak into the UI.
 */
export function rejectionMessageFor(error: unknown): string | null {
  const status = httpStatusOf(error);
  if (status === undefined) return null; // no answer at all → treat as offline
  if (status === 404) return MISSING_INJURY_MESSAGE;
  if (status === 400 || status === 422) return 'That could not be saved. Please try again.';
  if (status === 401 || status === 403) return 'Please sign in again to save this.';
  if (status >= 500) return null; // a server wobble behaves like being offline
  return 'That could not be saved. Please try again.';
}

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/* ==================================================================== */
/* Reads                                                                 */
/* ==================================================================== */

/**
 * ACTIVE **and** RESOLVED in one call.
 *
 * The `?active=` filter is deliberately not used: caching a filtered response
 * under the one snapshot key would leave an offline read showing only whichever
 * half the user last looked at, and history is the whole point of `resolve` not
 * being a delete.
 */
async function fetchInjuries(): Promise<Injury[]> {
  const payload = await healthInjuriesApi.listInjuries();
  return (payload?.injuries ?? []).map(fromWireInjury);
}

export async function loadInjuries(): Promise<Injury[]> {
  return sortInjuries(
    normalizeInjuries(await readThrough(HEALTH_INJURIES_KEY, fetchInjuries, [...EMPTY_INJURIES]))
  );
}

export function injuriesOffline(): boolean {
  return healthSyncStateFor(HEALTH_INJURIES_KEY) === 'offline';
}

/* ==================================================================== */
/* Writes                                                                */
/* ==================================================================== */

export interface InjuryWriteResult {
  injuries: Injury[];
  status: InjuryWriteStatus;
  message: string | null;
}

/**
 * One write, one contract — shared by add / edit / resolve / reactivate /
 * delete, because all five differ only in the request and the optimistic list.
 *
 * Three outcomes, same as every other Health store:
 *  - `saved`    — the Worker took it;
 *  - `offline`  — the request never landed, so the optimistic list stands and
 *                 the user still sees what they just did;
 *  - `rejected` — the Worker refused it. The optimistic list is ROLLED BACK,
 *                 because it does not exist server-side and a phantom injury
 *                 would keep "gating" exercises that the Worker never flags.
 */
async function runInjuryWrite(
  before: Injury[],
  optimistic: Injury[],
  write: () => Promise<unknown>,
  detail: string,
  offlineMessage: string
): Promise<InjuryWriteResult> {
  // A holder rather than a `let`: TypeScript does not track assignments made
  // inside the callback below.
  const outcome: { rejection: string | null } = { rejection: null };

  const rows = await writeThrough(
    HEALTH_INJURIES_KEY,
    async () => {
      try {
        await write();
      } catch (error) {
        outcome.rejection = rejectionMessageFor(error);
        throw error;
      }
    },
    fetchInjuries,
    optimistic,
    detail
  );

  if (outcome.rejection !== null) {
    await storageHelpers.setObject(HEALTH_INJURIES_KEY, before);
    return { injuries: before, status: 'rejected', message: outcome.rejection };
  }

  const offline = injuriesOffline();
  return {
    injuries: sortInjuries(normalizeInjuries(rows)),
    status: offline ? 'offline' : 'saved',
    message: offline ? offlineMessage : null,
  };
}

/** A placeholder row so the list reflects the add before the Worker answers. */
function optimisticRow(payload: HealthInjuryPayload): Injury {
  const now = new Date().toISOString();
  return {
    // Prefixed so a screen can tell "not yet acknowledged by the server" apart
    // from a real `inj_…` id if it ever needs to.
    id: `pending_${now}_${payload.body_part}`,
    date: payload.date ?? todayDateKey(),
    bodyPart: payload.body_part,
    painLevel: isPainLevel(payload.pain_level) ? payload.pain_level : DEFAULT_PAIN_LEVEL,
    injuryType: payload.injury_type ?? DEFAULT_INJURY_TYPE,
    cause: payload.cause ?? null,
    notes: payload.notes ?? '',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function addInjury(payload: HealthInjuryPayload): Promise<InjuryWriteResult> {
  const before = await loadInjuries();
  return runInjuryWrite(
    before,
    sortInjuries([optimisticRow(payload), ...before]),
    () => healthInjuriesApi.createInjury(payload),
    `add injury part=${payload.body_part}`,
    OFFLINE_WRITE_MESSAGE
  );
}

export async function editInjury(
  id: string,
  patch: HealthInjuryPatch
): Promise<InjuryWriteResult> {
  const before = await loadInjuries();
  const optimistic = before.map((row) =>
    row.id === id
      ? {
          ...row,
          date: patch.date ?? row.date,
          bodyPart: patch.body_part ?? row.bodyPart,
          painLevel: isPainLevel(patch.pain_level) ? patch.pain_level : row.painLevel,
          injuryType: patch.injury_type ?? row.injuryType,
          cause: patch.cause === undefined ? row.cause : patch.cause,
          notes: patch.notes === undefined ? row.notes : (patch.notes ?? ''),
          isActive: patch.is_active === undefined ? row.isActive : patch.is_active,
        }
      : row
  );
  return runInjuryWrite(
    before,
    sortInjuries(optimistic),
    () => healthInjuriesApi.updateInjury(id, patch),
    `edit injury id=${id}`,
    OFFLINE_WRITE_MESSAGE
  );
}

export const RESOLVE_OFFLINE_MESSAGE =
  'Marked resolved on this device — it will sync when you are back online.';

/**
 * The injury HEALED.
 *
 * NOT a delete: the row stays in history and in `?active=false`; it only leaves
 * the workout-suppression set, which is what makes the flagged exercises in the
 * library become normal again.
 */
export async function resolveInjury(id: string): Promise<InjuryWriteResult> {
  const before = await loadInjuries();
  return runInjuryWrite(
    before,
    before.map((row) => (row.id === id ? { ...row, isActive: false } : row)),
    () => healthInjuriesApi.resolveInjury(id),
    `resolve injury id=${id}`,
    RESOLVE_OFFLINE_MESSAGE
  );
}

export const REACTIVATE_OFFLINE_MESSAGE =
  'Reopened on this device — it will sync when you are back online.';

/**
 * A flare-up. The route allows `is_active: true` on PUT deliberately, and the
 * donor's own UI cannot do this — DELIBERATE DIFFERENCE, because the donor
 * filters healed rows out of every list and they become permanently unreachable.
 */
export async function reactivateInjury(id: string): Promise<InjuryWriteResult> {
  const before = await loadInjuries();
  return runInjuryWrite(
    before,
    before.map((row) => (row.id === id ? { ...row, isActive: true } : row)),
    () => healthInjuriesApi.updateInjury(id, { is_active: true }),
    `reactivate injury id=${id}`,
    REACTIVATE_OFFLINE_MESSAGE
  );
}

export const DELETE_OFFLINE_MESSAGE =
  'Removed on this device — it will sync when you are back online.';

export async function deleteInjury(id: string): Promise<InjuryWriteResult> {
  const before = await loadInjuries();
  return runInjuryWrite(
    before,
    before.filter((row) => row.id !== id),
    () => healthInjuriesApi.deleteInjury(id),
    `delete injury id=${id}`,
    DELETE_OFFLINE_MESSAGE
  );
}
