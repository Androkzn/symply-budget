import { healthApi } from '@api/health';

import { dateKeyOf, todayDateKey } from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';
import {
  ageFromBirthYear,
  bmiFor,
  bmrFor,
  bodyCompositionFor,
  tdeeFor,
} from './healthWeightAnalytics';
import type { HealthActivityLevel, HealthGender } from './healthWeightStorage';

/**
 * Symply Health — Body measurements (donor "Body" tab).
 *
 * Donor parity covers the measurement side only. Body PHOTOS stay out: the
 * migration matrix files them under "Later / future Health media spec" because
 * they need their own retention + deletion review. That also excludes every
 * photo-derived field on the donor's `BodyMeasurement` — the planar depths and
 * breadths, the posture score, the per-measurement confidence.
 *
 * Backed by `/health/measurements`. The donor's table carries a column per
 * site; migration `0131_health_body_comprehensive.sql` widened ours from the
 * donor's LEGACY block (14 sites) to its comprehensive one (41), and that
 * migration's header is the authority on which donor fields were left out and
 * why. `METRIC_COLUMN` below is the FE↔column map; the route's zod schema is
 * the other end of it, and a site present in one and not the other is silently
 * discarded (`z.object` strips unknown keys and answers 200).
 */

export const HEALTH_BODY_KEY = 'health.body.v1';

/**
 * Every measurement site the app tracks — the donor's comprehensive set, minus
 * what nothing here can produce.
 *
 * Ordered anatomically (head → torso → arms → legs → whole body → composition)
 * so the array reads like the body it describes; the UI groups it further.
 *
 * Left/right are tracked SEPARATELY for limbs: asymmetry between sides is a
 * real signal (the donor's own body-insight work leans on it), and collapsing
 * them to one "arm" throws that away. That is why the donor's single-sided
 * `forearm`, `wrist` and `ankle` appear here as pairs.
 *
 * The screens are driven entirely off this array, so extending it surfaces the
 * new sites automatically — provided the column exists in `METRIC_COLUMN`, in
 * the migration, and in the route's `measurementFields`.
 */
export const BODY_METRICS = [
  // Upper body
  'neck',
  'shoulders',
  'backWidth',
  'chest',
  'chestUpper',
  'chestUnder',
  // Core
  'waist',
  'waistNavel',
  'waistUpper',
  'waistLower',
  'iliac',
  'hips',
  // Arms
  'leftArm',
  'leftArmMid',
  'rightArm',
  'rightArmMid',
  'leftForearm',
  'leftForearmMid',
  'rightForearm',
  'rightForearmMid',
  'leftWrist',
  'rightWrist',
  // Legs
  'leftThigh',
  'leftThighMid',
  'leftThighLower',
  'rightThigh',
  'rightThighMid',
  'rightThighLower',
  'leftKnee',
  'rightKnee',
  'leftCalf',
  'leftCalfMid',
  'leftCalfLower',
  'rightCalf',
  'rightCalfMid',
  'rightCalfLower',
  'leftAnkle',
  'rightAnkle',
  // Whole body
  'torsoLength',
  'inseam',
  // Composition
  'bodyFat',
] as const;
export type BodyMetric = (typeof BODY_METRICS)[number];

export const BODY_METRIC_LABELS: Record<BodyMetric, string> = {
  neck: 'Neck',
  shoulders: 'Shoulders',
  backWidth: 'Back width',
  chest: 'Chest',
  chestUpper: 'Upper chest',
  chestUnder: 'Under bust',
  waist: 'Waist',
  waistNavel: 'Waist at navel',
  waistUpper: 'Upper belly',
  waistLower: 'Lower belly',
  iliac: 'Iliac crest',
  hips: 'Hips',
  leftArm: 'Left arm',
  leftArmMid: 'Left arm (mid)',
  rightArm: 'Right arm',
  rightArmMid: 'Right arm (mid)',
  leftForearm: 'Left forearm',
  leftForearmMid: 'Left forearm (mid)',
  rightForearm: 'Right forearm',
  rightForearmMid: 'Right forearm (mid)',
  leftWrist: 'Left wrist',
  rightWrist: 'Right wrist',
  leftThigh: 'Left thigh',
  leftThighMid: 'Left thigh (mid)',
  leftThighLower: 'Left thigh (lower)',
  rightThigh: 'Right thigh',
  rightThighMid: 'Right thigh (mid)',
  rightThighLower: 'Right thigh (lower)',
  leftKnee: 'Left knee',
  rightKnee: 'Right knee',
  leftCalf: 'Left calf',
  leftCalfMid: 'Left calf (mid)',
  leftCalfLower: 'Left calf (lower)',
  rightCalf: 'Right calf',
  rightCalfMid: 'Right calf (mid)',
  rightCalfLower: 'Right calf (lower)',
  leftAnkle: 'Left ankle',
  rightAnkle: 'Right ankle',
  torsoLength: 'Torso length',
  inseam: 'Inseam',
  bodyFat: 'Body fat',
};

/**
 * Where to put the tape, in one line.
 *
 * A trend is only meaningful if the same point is measured each time, and half
 * of these sites are defined by a landmark rather than by "the widest bit". The
 * donor puts an SF Symbol next to each field and no words at all, which is why
 * its comprehensive points were only ever filled by its photo pipeline.
 */
export const BODY_METRIC_HINTS: Record<BodyMetric, string> = {
  neck: 'Just below the Adam’s apple, tape level all the way round.',
  shoulders: 'Widest point across the deltoids, arms relaxed.',
  backWidth: 'Across the back, shoulder blade to shoulder blade.',
  chest: 'Fullest point, usually at the nipple line, after a normal breath out.',
  chestUpper: 'Above the nipple line, under the armpits.',
  chestUnder: 'Directly under the bust, on the rib cage.',
  waist: 'Narrowest point of the torso — for most people just above the navel.',
  waistNavel: 'Level with the navel. A fixed landmark, unlike the narrowest point.',
  waistUpper: 'About 5 cm (2 in) above the navel.',
  waistLower: 'About 5 cm (2 in) below the navel.',
  iliac: 'Level with the top of the hip bones.',
  hips: 'Fullest point around the seat, feet together.',
  leftArm: 'Bicep at its widest, arm relaxed at your side.',
  leftArmMid: 'Halfway between shoulder and elbow.',
  rightArm: 'Bicep at its widest, arm relaxed at your side.',
  rightArmMid: 'Halfway between shoulder and elbow.',
  leftForearm: 'Widest point below the elbow.',
  leftForearmMid: 'Halfway between elbow and wrist.',
  rightForearm: 'Widest point below the elbow.',
  rightForearmMid: 'Halfway between elbow and wrist.',
  leftWrist: 'Narrowest point, just below the wrist bone.',
  rightWrist: 'Narrowest point, just below the wrist bone.',
  leftThigh: 'Widest point, high up under the glute fold.',
  leftThighMid: 'Halfway between hip and knee.',
  leftThighLower: 'Just above the knee.',
  rightThigh: 'Widest point, high up under the glute fold.',
  rightThighMid: 'Halfway between hip and knee.',
  rightThighLower: 'Just above the knee.',
  leftKnee: 'Around the middle of the kneecap, leg straight.',
  rightKnee: 'Around the middle of the kneecap, leg straight.',
  leftCalf: 'Widest point, standing with weight on both feet.',
  leftCalfMid: 'Halfway between knee and ankle.',
  leftCalfLower: 'Just above the ankle bone.',
  rightCalf: 'Widest point, standing with weight on both feet.',
  rightCalfMid: 'Halfway between knee and ankle.',
  rightCalfLower: 'Just above the ankle bone.',
  leftAnkle: 'Narrowest point above the ankle bones.',
  rightAnkle: 'Narrowest point above the ankle bones.',
  torsoLength: 'Base of the neck straight down to the natural waist.',
  inseam: 'Inside of the leg, crotch to floor, no shoes.',
  bodyFat: 'Whatever your calipers, scale or measurement gave you.',
};

/**
 * Which sites the app offers up front, and which sit behind "detailed sites".
 *
 * PRIMARY is the donor's own manual-entry sheet (`BodyMeasurementsEntrySheet`:
 * Upper Body / Arms / Legs / Other), expressed per side — neck, shoulders,
 * chest, waist, hips, arm, forearm, wrist, thigh, calf, ankle, torso length,
 * inseam — plus body fat, which the RN Body tab has always collected.
 *
 * DETAILED is the rest of the donor's comprehensive set: the extra points up an
 * arm, a leg or a belly that the donor itself only ever filled from a photo. A
 * tape can take every one of them, which is why they are here at all, but
 * putting forty-one fields in front of someone who wanted to log a waist is a
 * worse app, so they are one tap away rather than always on.
 */
export const BODY_METRIC_TIERS = ['primary', 'detailed'] as const;
export type BodyMetricTier = (typeof BODY_METRIC_TIERS)[number];

const DETAILED_METRICS = new Set<BodyMetric>([
  'backWidth',
  'chestUpper',
  'chestUnder',
  'waistNavel',
  'waistUpper',
  'waistLower',
  'iliac',
  'leftArmMid',
  'rightArmMid',
  'leftForearmMid',
  'rightForearmMid',
  'leftThighMid',
  'leftThighLower',
  'rightThighMid',
  'rightThighLower',
  'leftKnee',
  'rightKnee',
  'leftCalfMid',
  'leftCalfLower',
  'rightCalfMid',
  'rightCalfLower',
]);

export function bodyMetricTier(metric: BodyMetric): BodyMetricTier {
  return DETAILED_METRICS.has(metric) ? 'detailed' : 'primary';
}

export const PRIMARY_BODY_METRICS: readonly BodyMetric[] = BODY_METRICS.filter(
  (metric) => bodyMetricTier(metric) === 'primary',
);

export const LENGTH_UNITS = ['cm', 'in'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** Body fat is a percentage, every other metric is a length. */
export function unitForMetric(metric: BodyMetric, preferred: LengthUnit): string {
  return metric === 'bodyFat' ? '%' : preferred;
}

export interface BodyEntry {
  id: string;
  date: string; // YYYY-MM-DD (local) — the day the measurement was TAKEN
  metric: BodyMetric;
  value: number;
  unit: string; // 'cm' | 'in' | '%'
  loggedAt: string;
}

/**
 * Site-readings held on the device, not rows.
 *
 * One taped session is ONE server row but up to forty-one entries here, so the
 * old 400 would have been ten sessions. Raised alongside the route's own row
 * limit so the Body tab's "All" range can still reach a first measurement.
 */
const MAX_BODY_ENTRIES = 4000;
const MAX_LENGTH_VALUE = 400; // cm or in — generous sanity bound
const MAX_PERCENT_VALUE = 100;

/** Inches → centimetres, the one conversion factor in this module. */
const CM_PER_INCH = 2.54;

export function isBodyMetric(value: string): value is BodyMetric {
  return (BODY_METRICS as readonly string[]).includes(value);
}

/** One decimal place, comma or dot; blank/invalid/out-of-range → null. */
export function parseMeasurementInput(raw: string, metric: BodyMetric): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  const max = metric === 'bodyFat' ? MAX_PERCENT_VALUE : MAX_LENGTH_VALUE;
  if (!Number.isFinite(value) || value <= 0 || value > max) return null;
  return Math.round(value * 10) / 10;
}

export function formatMeasurement(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The day a reading belongs to.
 *
 * `date` is the day the member says they took it; `loggedAt` is when they typed
 * it in. Since the Body tab gained date navigation those are routinely
 * different days, and every "when" in this module means the former.
 */
export function bodyEntryDay(entry: BodyEntry): string {
  return entry.date || dateKeyOf(entry.loggedAt);
}

/**
 * Newest MEASUREMENT DAY first, then newest typed.
 *
 * Sorting by `loggedAt` alone was correct only while every reading was stamped
 * today. With back-dating, a Tuesday reading typed on Friday would otherwise
 * out-rank Friday's own reading and be reported as "latest" — the summary tile,
 * the delta, the compare card and the ratios all read the first match.
 */
export function compareBodyEntriesDesc(a: BodyEntry, b: BodyEntry): number {
  const byDay = bodyEntryDay(b).localeCompare(bodyEntryDay(a));
  return byDay !== 0 ? byDay : b.loggedAt.localeCompare(a.loggedAt);
}

/**
 * Latest reading per metric plus the change against the previous reading of the
 * SAME metric and unit — a converted delta across units would be misleading, so
 * mixed units report no delta (same rule as `weightDelta`).
 */
export interface BodyMetricSummary {
  metric: BodyMetric;
  latest: BodyEntry | null;
  delta: number | null;
  count: number;
}

export function summarizeBody(entries: BodyEntry[]): BodyMetricSummary[] {
  return BODY_METRICS.map((metric) => {
    const forMetric = entries.filter((e) => e.metric === metric).sort(compareBodyEntriesDesc);
    const [latest, previous] = forMetric;
    const comparable = latest && previous && latest.unit === previous.unit;
    return {
      metric,
      latest: latest ?? null,
      delta: comparable ? Math.round((latest.value - previous.value) * 10) / 10 : null,
      count: forMetric.length,
    };
  });
}

function isValidEntry(entry: BodyEntry | null | undefined): entry is BodyEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.metric === 'string' &&
    isBodyMetric(entry.metric) &&
    Number.isFinite(entry.value)
  );
}

/**
 * Screen metric → donor column.
 *
 * The legacy columns (0119) each already ARE the donor's comprehensive point of
 * the same name — `waist` is its `waistNarrowest`, `chest` its `chestFull`,
 * `left_arm` its `leftArmUpper`, `left_forearm` its `leftForearmUpper`,
 * `left_calf` its `leftCalfUpper`, `shoulders` its `shoulderWidth` — so those
 * are mapped once, not twice. See the 0131 migration header.
 */
export const METRIC_COLUMN: Record<BodyMetric, string> = {
  neck: 'neck',
  shoulders: 'shoulders',
  backWidth: 'back_width',
  chest: 'chest',
  chestUpper: 'chest_upper',
  chestUnder: 'chest_under',
  waist: 'waist',
  waistNavel: 'waist_navel',
  waistUpper: 'waist_upper',
  waistLower: 'waist_lower',
  iliac: 'iliac',
  hips: 'hips',
  leftArm: 'left_arm',
  leftArmMid: 'left_arm_mid',
  rightArm: 'right_arm',
  rightArmMid: 'right_arm_mid',
  leftForearm: 'left_forearm',
  leftForearmMid: 'left_forearm_mid',
  rightForearm: 'right_forearm',
  rightForearmMid: 'right_forearm_mid',
  leftWrist: 'left_wrist',
  rightWrist: 'right_wrist',
  leftThigh: 'left_thigh',
  leftThighMid: 'left_thigh_mid',
  leftThighLower: 'left_thigh_lower',
  rightThigh: 'right_thigh',
  rightThighMid: 'right_thigh_mid',
  rightThighLower: 'right_thigh_lower',
  leftKnee: 'left_knee',
  rightKnee: 'right_knee',
  leftCalf: 'left_calf',
  leftCalfMid: 'left_calf_mid',
  leftCalfLower: 'left_calf_lower',
  rightCalf: 'right_calf',
  rightCalfMid: 'right_calf_mid',
  rightCalfLower: 'right_calf_lower',
  leftAnkle: 'left_ankle',
  rightAnkle: 'right_ankle',
  torsoLength: 'torso_length',
  inseam: 'inseam',
  bodyFat: 'body_fat_percentage',
};

/** One measurement ROW can hold several sites — fan it out into screen rows. */
function fromWireMeasurement(row: Record<string, unknown>): BodyEntry[] {
  const out: BodyEntry[] = [];
  const unit = String(row.unit ?? 'cm');
  for (const metric of BODY_METRICS) {
    const value = row[METRIC_COLUMN[metric]];
    // A pre-0131 Worker omits the comprehensive keys entirely and a post-0131
    // one sends them as null for a site nobody measured. Both mean "no reading"
    // and both fail this guard, which is why the wire type marks them optional.
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out.push({
      id: `${String(row.id)}:${metric}`,
      date: String(row.date),
      metric,
      value,
      unit: metric === 'bodyFat' ? '%' : unit === 'inches' ? 'in' : unit,
      loggedAt: String(row.created_at ?? `${String(row.date)}T12:00:00.000Z`),
    });
  }
  return out;
}

async function fetchBodyEntries(): Promise<BodyEntry[]> {
  const res = await healthApi.listMeasurements();
  return (res.measurements ?? [])
    .flatMap((row) => fromWireMeasurement(row as unknown as Record<string, unknown>))
    .sort(compareBodyEntriesDesc)
    .slice(0, MAX_BODY_ENTRIES);
}

export async function loadBodyEntries(): Promise<BodyEntry[]> {
  const entries = await readThrough(HEALTH_BODY_KEY, fetchBodyEntries, []);
  return entries.filter(isValidEntry).sort(compareBodyEntriesDesc);
}

/** Every reading taken on one day, newest-typed first. */
export function bodyEntriesForDay(entries: BodyEntry[], date: string): BodyEntry[] {
  return entries.filter((entry) => bodyEntryDay(entry) === date).sort(compareBodyEntriesDesc);
}

/**
 * Write one taping SESSION — the donor's entry sheet, which saves every field
 * the member filled as a single row.
 *
 * One row per session rather than one per site is the donor's own shape, and it
 * is what keeps forty-one sites from becoming forty-one rows a day: the trend
 * charts read sites, but the server pages rows.
 *
 * `unit` applies to the LENGTHS. Body fat rides the same row as a percentage —
 * the column is a percentage by definition and the server ignores the row's
 * length unit for it — which is why a session of nothing but body fat still has
 * to name a length unit the route will accept.
 */
export async function addBodySession(
  values: Partial<Record<BodyMetric, number>>,
  unit: LengthUnit,
  date: string = todayDateKey(),
): Promise<BodyEntry[]> {
  const loggedAt = new Date().toISOString();
  const written = (Object.entries(values) as [BodyMetric, number][]).filter(
    ([metric, value]) => isBodyMetric(metric) && Number.isFinite(value),
  );
  if (written.length === 0) return loadBodyEntries();

  const body: Record<string, unknown> = { date, unit };
  const optimisticRows: BodyEntry[] = [];
  for (const [metric, value] of written) {
    body[METRIC_COLUMN[metric]] = value;
    optimisticRows.push({
      // The real id arrives on the refetch; this one only has to be unique and
      // to carry the metric after the `:` so a delete can find its column.
      id: `pending-${loggedAt}:${metric}`,
      date,
      metric,
      value,
      unit: metric === 'bodyFat' ? '%' : unit,
      loggedAt,
    });
  }

  const optimistic = [...optimisticRows, ...(await loadBodyEntries())].sort(compareBodyEntriesDesc);
  return writeThrough(
    HEALTH_BODY_KEY,
    () => healthApi.createMeasurement(body as { date: string; unit: LengthUnit }),
    fetchBodyEntries,
    optimistic,
    `session date=${date} sites=${written.length}`,
    {
      // Same `pending-${loggedAt}` the optimistic rows' ids are built from
      // (`pending-${loggedAt}:${metric}`, the part before the `:`) — the id a
      // follow-up offline read of this same session would resolve to.
      queue: { collection: 'body_measurements', row: { id: `pending-${loggedAt}`, ...body } },
    },
  );
}

/** One site, one reading — the quick-add path. A session of exactly one. */
export async function addBodyEntry(
  metric: BodyMetric,
  value: number,
  unit: string,
  date: string = todayDateKey(),
): Promise<BodyEntry[]> {
  // Body fat is a percentage; the row still needs a length unit, and the server
  // ignores it for the percentage column.
  const lengthUnit: LengthUnit = unit === 'in' ? 'in' : 'cm';
  return addBodySession({ [metric]: value } as Partial<Record<BodyMetric, number>>, lengthUnit, date);
}

/**
 * Remove ONE reading.
 *
 * A row is a whole session, so deleting the row to remove one bad waist figure
 * would take every other site measured that morning with it. Where the row
 * still holds other sites, the site's own column is cleared instead
 * (`PATCH /measurements/:id`, 0131); where it was the row's only site, the row
 * is tombstoned as before — which is also the only path any row written before
 * this change can take, since the old client wrote one site per row.
 */
export async function deleteBodyEntry(id: string): Promise<BodyEntry[]> {
  const current = await loadBodyEntries();
  const optimistic = current.filter((e) => e.id !== id);

  // Screen ids are `<rowId>:<metric>`.
  const separator = id.lastIndexOf(':');
  const rowId = separator === -1 ? id : id.slice(0, separator);
  const metric = separator === -1 ? '' : id.slice(separator + 1);
  const siblings = current.filter((e) => e.id !== id && e.id.startsWith(`${rowId}:`));

  const clearsOneSite = siblings.length > 0 && isBodyMetric(metric);
  return writeThrough(
    HEALTH_BODY_KEY,
    () =>
      clearsOneSite
        ? healthApi.updateMeasurement(rowId, { [METRIC_COLUMN[metric as BodyMetric]]: null })
        : healthApi.deleteMeasurement(rowId),
    fetchBodyEntries,
    optimistic,
    `${clearsOneSite ? 'clear site' : 'delete row'} id=${id}`,
  );
}

/* ------------------------------------------------------------------ */
/* Ratios (donor `waistToHipRatio` & co, derived not stored)           */
/* ------------------------------------------------------------------ */

/**
 * A ratio is UNITLESS, so unlike a delta it may be computed across units.
 *
 * `summarizeBody` refuses to subtract a 31 in reading from a 78 cm one because
 * the answer would be a change the body never made. Dividing them is a
 * different operation: 78 cm ÷ 96 cm and 30.7 in ÷ 37.8 in are the same number
 * to two decimal places, which is all these are ever shown to. Everything is
 * normalised to centimetres first so the arithmetic is done once.
 */
function toCm(value: number, unit: string): number | null {
  if (unit === 'cm') return value;
  if (unit === 'in') return value * CM_PER_INCH;
  return null; // '%' — not a length
}

export const BODY_RATIO_KEYS = [
  'waistToHip',
  'waistToHeight',
  'chestToWaist',
  'shoulderToWaist',
] as const;
export type BodyRatioKey = (typeof BODY_RATIO_KEYS)[number];

interface RatioDefinition {
  key: BodyRatioKey;
  label: string;
  /** What the number IS. Never what it means for the person's health. */
  description: string;
  numerator: BodyMetric;
  /** `null` = the denominator is the member's height, not a measured site. */
  denominator: BodyMetric | null;
}

/**
 * The donor's four `BodyMeasurement` ratio fields, computed rather than stored.
 *
 * The donor's own UI grades three of them ("Healthy range" in green, "Above
 * average" in orange). That is deliberately not ported: a threshold rendered in
 * traffic-light colours beside a body measurement is a clinical judgement, and
 * this app does not make one. The description says what the ratio measures and
 * the change column says which way it is going; the reader draws the
 * conclusion.
 */
export const BODY_RATIOS: readonly RatioDefinition[] = [
  {
    key: 'waistToHip',
    label: 'Waist to hip',
    description: 'Waist divided by hips — how the two compare, whatever your size.',
    numerator: 'waist',
    denominator: 'hips',
  },
  {
    key: 'waistToHeight',
    label: 'Waist to height',
    description: 'Waist divided by your height. Needs the height on your weight goal.',
    numerator: 'waist',
    denominator: null,
  },
  {
    key: 'chestToWaist',
    label: 'Chest to waist',
    description: 'Chest divided by waist — the donor’s V-taper figure.',
    numerator: 'chest',
    denominator: 'waist',
  },
  {
    key: 'shoulderToWaist',
    label: 'Shoulder to waist',
    description: 'Shoulders divided by waist.',
    numerator: 'shoulders',
    denominator: 'waist',
  },
];

export interface BodyRatioResult {
  key: BodyRatioKey;
  label: string;
  description: string;
  /** Two decimal places, or null when an input has never been measured. */
  latest: number | null;
  latestDate: string | null;
  previous: number | null;
  previousDate: string | null;
  /** `latest − previous`, or null without two comparable days. */
  change: number | null;
  /** Member-facing names of the inputs with no reading yet. */
  missing: string[];
}

/** day → site → centimetres, taking each day's newest reading of a site. */
function centimetresByDay(entries: BodyEntry[]): Map<string, Map<BodyMetric, number>> {
  const byDay = new Map<string, Map<BodyMetric, number>>();
  // Newest first, so the FIRST reading seen for a (day, site) is that day's.
  for (const entry of [...entries].sort(compareBodyEntriesDesc)) {
    const cm = toCm(entry.value, entry.unit);
    if (cm === null) continue;
    const day = bodyEntryDay(entry);
    const sites = byDay.get(day) ?? new Map<BodyMetric, number>();
    if (!sites.has(entry.metric)) sites.set(entry.metric, cm);
    byDay.set(day, sites);
  }
  return byDay;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The four ratios, each on the last two days where ALL of its inputs were
 * measured.
 *
 * Deliberately not "latest waist ÷ latest hips": those two can be weeks apart,
 * and a ratio built from readings taken at different times is a number about no
 * particular day. A ratio only exists on a day both sites were taped, which is
 * also why the card names the date it belongs to.
 */
export function bodyRatios(entries: BodyEntry[], heightCm: number | null): BodyRatioResult[] {
  const byDay = centimetresByDay(entries);
  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b)); // oldest first

  return BODY_RATIOS.map((definition) => {
    const points: { date: string; value: number }[] = [];
    for (const day of days) {
      const sites = byDay.get(day);
      const top = sites?.get(definition.numerator);
      const bottom =
        definition.denominator === null ? heightCm : sites?.get(definition.denominator);
      if (top === undefined || bottom === undefined || bottom === null || bottom <= 0) continue;
      points.push({ date: day, value: round2(top / bottom) });
    }

    const missing: string[] = [];
    const hasSite = (metric: BodyMetric) =>
      days.some((day) => byDay.get(day)?.has(metric) === true);
    if (!hasSite(definition.numerator)) missing.push(BODY_METRIC_LABELS[definition.numerator]);
    if (definition.denominator === null) {
      if (heightCm === null || !Number.isFinite(heightCm)) missing.push('Height');
    } else if (!hasSite(definition.denominator)) {
      missing.push(BODY_METRIC_LABELS[definition.denominator]);
    }

    const latest = points[points.length - 1] ?? null;
    const previous = points.length > 1 ? points[points.length - 2] : null;
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      latest: latest?.value ?? null,
      latestDate: latest?.date ?? null,
      previous: previous?.value ?? null,
      previousDate: previous?.date ?? null,
      change: latest && previous ? round2(latest.value - previous.value) : null,
      missing,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Left / right differences (donor's symmetry SCORES, without a score) */
/* ------------------------------------------------------------------ */

const SYMMETRY_PAIRS: ReadonlyArray<{ label: string; left: BodyMetric; right: BodyMetric }> = [
  { label: 'Arm', left: 'leftArm', right: 'rightArm' },
  { label: 'Arm (mid)', left: 'leftArmMid', right: 'rightArmMid' },
  { label: 'Forearm', left: 'leftForearm', right: 'rightForearm' },
  { label: 'Forearm (mid)', left: 'leftForearmMid', right: 'rightForearmMid' },
  { label: 'Wrist', left: 'leftWrist', right: 'rightWrist' },
  { label: 'Thigh', left: 'leftThigh', right: 'rightThigh' },
  { label: 'Thigh (mid)', left: 'leftThighMid', right: 'rightThighMid' },
  { label: 'Thigh (lower)', left: 'leftThighLower', right: 'rightThighLower' },
  { label: 'Knee', left: 'leftKnee', right: 'rightKnee' },
  { label: 'Calf', left: 'leftCalf', right: 'rightCalf' },
  { label: 'Calf (mid)', left: 'leftCalfMid', right: 'rightCalfMid' },
  { label: 'Calf (lower)', left: 'leftCalfLower', right: 'rightCalfLower' },
  { label: 'Ankle', left: 'leftAnkle', right: 'rightAnkle' },
];

export interface BodySideRow {
  label: string;
  left: BodyEntry;
  right: BodyEntry;
  /** left − right in the shared unit, or null when the units differ. */
  difference: number | null;
  unit: string;
  unitMismatch: boolean;
}

/**
 * Every left/right pair where BOTH sides have a reading.
 *
 * The donor stores three symmetry SCORES (`min ÷ max`, rendered as a
 * percentage with a colour). A score is a grade, and a graded body measurement
 * is exactly what this app does not do — so the difference is shown in the
 * member's own unit and nothing is scored, ranked or coloured by size. Pairs
 * measured in different units report no difference, the same rule
 * `summarizeBody` and the compare card already follow.
 */
export function bodySideDifferences(entries: BodyEntry[]): BodySideRow[] {
  const summaries = new Map(summarizeBody(entries).map((s) => [s.metric, s.latest]));
  const rows: BodySideRow[] = [];
  for (const pair of SYMMETRY_PAIRS) {
    const left = summaries.get(pair.left) ?? null;
    const right = summaries.get(pair.right) ?? null;
    if (!left || !right) continue;
    const unitMismatch = left.unit !== right.unit;
    rows.push({
      label: pair.label,
      left,
      right,
      unit: left.unit,
      unitMismatch,
      difference: unitMismatch ? null : Math.round((left.value - right.value) * 10) / 10,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* BMI / BMR / lean mass                                               */
/* ------------------------------------------------------------------ */

export interface BodyCompositionSummary {
  bmi: number | null;
  bmr: number | null;
  tdee: number | null;
  fatMassKg: number | null;
  leanMassKg: number | null;
  bodyFatPercent: number | null;
  /** Member-facing names of the inputs that would unlock more of the above. */
  missing: string[];
}

/**
 * The donor's `bodyCompositionCard`, from inputs this app already holds.
 *
 * NOTHING IS RECOMPUTED HERE. `bmiFor`, `bmrFor`, `tdeeFor` and
 * `bodyCompositionFor` live in `healthWeightAnalytics` because the Weight tab
 * renders the same figures, and two copies of Mifflin–St Jeor is how two tabs
 * come to disagree about one person's BMR. This function only gathers the
 * inputs and says which are missing.
 *
 * The biometrics (height, sex, birth year, activity level) are the ones
 * migration 0125 added to `health_goals` and `healthWeightStorage` already
 * reads; the body-fat percentage is this tab's own `body_fat_percentage`.
 *
 * Every figure is null until its inputs are real — a BMR with a guessed
 * activity level is a calorie number the member would act on.
 */
export function summarizeBodyComposition(input: {
  weightKg: number | null;
  heightCm: number | null;
  gender: HealthGender | null;
  birthYear: number | null;
  activityLevel: HealthActivityLevel | null;
  bodyFatPercent: number | null;
  today?: string;
}): BodyCompositionSummary {
  const today = input.today ?? todayDateKey();
  const bmi = bmiFor(input.weightKg, input.heightCm);
  const bmr = bmrFor({
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    age: ageFromBirthYear(input.birthYear, today),
    gender: input.gender,
  });
  const composition = bodyCompositionFor(input.weightKg, input.bodyFatPercent);

  const missing: string[] = [];
  if (input.weightKg === null) missing.push('A weight reading');
  if (input.heightCm === null) missing.push('Height');
  if (input.gender === null) missing.push('Sex');
  if (input.birthYear === null) missing.push('Birth year');
  if (input.activityLevel === null) missing.push('Activity level');
  if (input.bodyFatPercent === null) missing.push('A body-fat reading');

  return {
    bmi,
    bmr,
    tdee: tdeeFor(bmr, input.activityLevel),
    fatMassKg: composition?.fatMassKg ?? null,
    leanMassKg: composition?.leanMassKg ?? null,
    bodyFatPercent: composition?.bodyFatPercent ?? null,
    missing,
  };
}
