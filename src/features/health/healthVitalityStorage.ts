import { healthApi, type HealthMensSettings } from '@api/health';

import { todayDateKey } from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — Men's Health / vitality tracking (donor `MensHealthView`).
 *
 * Ported from the donor's `MensHealthEntry` model and its vitality-score maths:
 * a single entry per day covering libido, sexual activity and satisfaction,
 * erection health, issues, energy/mood/clarity/sleep/stress, and kegel sets.
 *
 * Backed by `/health/mens-health/*` (parity P1) — the donor's
 * `mens_health_entries` table in Health's OWN isolated D1.
 *
 * Like the cycle tracker this is intimate data: user-scoped only, never shared
 * across Symply apps, never sent to an AI provider, excluded from glance
 * surfaces. The score is a wellness self-check — not a diagnosis, which is why
 * the screen carries the donor's disclaimer card.
 */

export const HEALTH_VITALITY_KEY = 'health.vitality.v1';
export const HEALTH_MENS_SETTINGS_KEY = 'health.mensSettings.v1';

/** Every 1–10 field shares one scale, so one clamp covers them all. */
const SCALE_MIN = 1;
const SCALE_MAX = 10;
const MAX_ENTRIES = 400;
const MAX_KEGEL_SETS = 50;
const MAX_NOTE_LENGTH = 200;

export interface VitalityEntry {
  id: string;
  date: string; // YYYY-MM-DD (local) — one entry per day

  /** Sex drive, 1–10. */
  libido: number;
  hadPartnerSex: boolean;
  hadMasturbation: boolean;
  hadOrgasm: boolean;
  /** 1–10, only meaningful when there was activity. */
  overallSatisfaction: number | null;

  hadMorningErection: boolean;
  morningErectionQuality: number | null; // 1–10
  erectionQuality: number | null; // 1–10
  hadEroticDream: boolean;
  /** Desire across the whole day, 1–10 (donor: `sexualDesireLevel`). */
  sexualDesireLevel: number;

  // Issues — each a plain yes/no for the day.
  hadErectionDifficulty: boolean;
  hadMaintenanceDifficulty: boolean;
  hadPrematureEjaculation: boolean;
  hadDelayedEjaculation: boolean;
  hadPerformanceAnxiety: boolean;
  hadLowDesire: boolean;
  hadPainOrDiscomfort: boolean;

  // Energy & mind, all 1–10.
  energyLevel: number;
  mentalClarity: number;
  mood: number;
  sleepQuality: number;
  stressLevel: number;

  exercised: boolean;
  kegelSets: number;
  notes: string;
  loggedAt: string;
}

/** The issue flags, in the order the donor's issues card lists them. */
export const VITALITY_ISSUES = [
  'hadErectionDifficulty',
  'hadMaintenanceDifficulty',
  'hadPrematureEjaculation',
  'hadDelayedEjaculation',
  'hadPerformanceAnxiety',
  'hadLowDesire',
  'hadPainOrDiscomfort',
] as const;
export type VitalityIssue = (typeof VITALITY_ISSUES)[number];

export const VITALITY_ISSUE_LABELS: Record<VitalityIssue, string> = {
  hadErectionDifficulty: 'Difficulty getting an erection',
  hadMaintenanceDifficulty: 'Difficulty maintaining',
  hadPrematureEjaculation: 'Premature ejaculation',
  hadDelayedEjaculation: 'Delayed ejaculation',
  hadPerformanceAnxiety: 'Performance anxiety',
  hadLowDesire: 'Low desire',
  hadPainOrDiscomfort: 'Pain or discomfort',
};

/** The 1–10 sliders shown in the "energy & mind" card. */
export const VITALITY_SCALES = [
  'libido',
  'sexualDesireLevel',
  'energyLevel',
  'mentalClarity',
  'mood',
  'sleepQuality',
  'stressLevel',
] as const;
export type VitalityScale = (typeof VITALITY_SCALES)[number];

export const VITALITY_SCALE_LABELS: Record<VitalityScale, string> = {
  libido: 'Libido',
  sexualDesireLevel: 'Desire through the day',
  energyLevel: 'Energy',
  mentalClarity: 'Mental clarity',
  mood: 'Mood',
  sleepQuality: 'Sleep quality',
  stressLevel: 'Stress',
};

export const VITALITY_SCALE_ICONS: Record<VitalityScale, string> = {
  libido: 'heart-rate',
  sexualDesireLevel: 'mood',
  energyLevel: 'energy-active',
  mentalClarity: 'insights',
  mood: 'mood',
  sleepQuality: 'sleep',
  stressLevel: 'stress',
};

export function createEmptyVitalityEntry(date = todayDateKey()): VitalityEntry {
  return {
    id: `vitality-${date}`,
    date,
    libido: 5,
    hadPartnerSex: false,
    hadMasturbation: false,
    hadOrgasm: false,
    overallSatisfaction: null,
    hadMorningErection: false,
    morningErectionQuality: null,
    erectionQuality: null,
    hadEroticDream: false,
    sexualDesireLevel: 5,
    hadErectionDifficulty: false,
    hadMaintenanceDifficulty: false,
    hadPrematureEjaculation: false,
    hadDelayedEjaculation: false,
    hadPerformanceAnxiety: false,
    hadLowDesire: false,
    hadPainOrDiscomfort: false,
    energyLevel: 5,
    mentalClarity: 5,
    mood: 5,
    sleepQuality: 5,
    stressLevel: 5,
    exercised: false,
    kegelSets: 0,
    notes: '',
    loggedAt: '',
  };
}

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return SCALE_MIN;
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(n)));
}

export function clampKegelSets(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_KEGEL_SETS, Math.round(n));
}

/* ------------------------------------------------------------------ */
/* Scores — ported verbatim from the donor's computed properties       */
/* ------------------------------------------------------------------ */

/** Donor neutral baseline when a day has not been logged at all. */
export const NEUTRAL_SCORE = 50;

function bounded(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function sexualHealthScore(entry: VitalityEntry | null): number {
  if (!entry) return NEUTRAL_SCORE;
  let score = 50;
  score += (entry.libido - 5) * 5;
  if (entry.hadPartnerSex || entry.hadMasturbation) {
    score += 10;
    if (entry.overallSatisfaction !== null) {
      score += (entry.overallSatisfaction - 5) * 3;
    }
  }
  if (entry.hadPerformanceAnxiety) score -= 10;
  if (entry.hadLowDesire) score -= 15;
  return bounded(score);
}

export function erectionScore(entry: VitalityEntry | null): number {
  if (!entry) return NEUTRAL_SCORE;
  let score = 50;
  if (entry.hadMorningErection) {
    score += 20;
    if (entry.morningErectionQuality !== null) {
      score += (entry.morningErectionQuality - 5) * 2;
    }
  }
  if (entry.erectionQuality !== null) {
    score += (entry.erectionQuality - 5) * 3;
  }
  if (entry.hadErectionDifficulty) score -= 20;
  if (entry.hadMaintenanceDifficulty) score -= 15;
  return bounded(score);
}

export function energyScore(entry: VitalityEntry | null): number {
  if (!entry) return NEUTRAL_SCORE;
  return bounded(entry.energyLevel * 10);
}

export function mentalScore(entry: VitalityEntry | null): number {
  if (!entry) return NEUTRAL_SCORE;
  const score = entry.mentalClarity * 5 + entry.mood * 5 - (entry.stressLevel - 5) * 3;
  return bounded(score);
}

/** The headline figure: the mean of the four sub-scores (donor formula). */
export function vitalityScore(entry: VitalityEntry | null): number {
  return Math.floor(
    (sexualHealthScore(entry) + erectionScore(entry) + energyScore(entry) + mentalScore(entry)) /
      4,
  );
}

export function vitalityStatus(score: number): string {
  if (score >= 80) return 'Peak performance';
  if (score >= 60) return 'Good condition';
  if (score >= 40) return 'Room for improvement';
  return 'Needs attention';
}

export function libidoDescription(entry: VitalityEntry | null): string {
  if (!entry) return 'Track your sex drive';
  if (entry.libido >= 8) return 'High drive';
  if (entry.libido >= 5) return 'Normal range';
  return 'Below average';
}

export function activeIssues(entry: VitalityEntry | null): VitalityIssue[] {
  if (!entry) return [];
  return VITALITY_ISSUES.filter((issue) => entry[issue]);
}

export interface VitalityTrend {
  daysLogged: number;
  averageScore: number;
  averageEnergy: number;
  kegelSets: number;
  issueDays: number;
}

/** Averages over LOGGED days only — the same rule the Trends tab uses. */
export function summarizeVitality(
  entries: VitalityEntry[],
  dayKeys: string[],
): VitalityTrend {
  const inRange = new Set(dayKeys);
  const days = entries.filter((e) => inRange.has(e.date));
  if (days.length === 0) {
    return { daysLogged: 0, averageScore: 0, averageEnergy: 0, kegelSets: 0, issueDays: 0 };
  }
  return {
    daysLogged: days.length,
    averageScore: Math.round(
      days.reduce((s, e) => s + vitalityScore(e), 0) / days.length,
    ),
    averageEnergy:
      Math.round((days.reduce((s, e) => s + e.energyLevel, 0) / days.length) * 10) / 10,
    kegelSets: days.reduce((s, e) => s + e.kegelSets, 0),
    issueDays: days.filter((e) => activeIssues(e).length > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/* Guided kegel session — the donor's KegelWorkoutView, as pure state   */
/* ------------------------------------------------------------------ */

/**
 * The donor's timings, unchanged: a five-second squeeze, a five-second release,
 * three sets by default.
 *
 * The session model is a pure reducer rather than logic living inside a
 * `setInterval` callback, for two reasons. A timer that owns its own state
 * drifts when the app backgrounds mid-set and cannot be reasoned about at all;
 * and the only thing this exercise asks of a person is that they follow a
 * rhythm with their eyes shut, which means the rhythm has to be exactly right.
 *
 * Nothing here interprets the exercise. It counts seconds and sets.
 */
export const KEGEL_SQUEEZE_SECONDS = 5;
export const KEGEL_RELAX_SECONDS = 5;
export const KEGEL_DEFAULT_SETS = 3;
/** Session lengths offered on the screen. The donor hard-coded three. */
export const KEGEL_SET_OPTIONS = [3, 5, 10] as const;
const MAX_KEGEL_SESSION_SETS = 30;

export const KEGEL_PHASES = ['squeeze', 'relax'] as const;
export type KegelPhase = (typeof KEGEL_PHASES)[number];

export const KEGEL_PHASE_LABELS: Record<KegelPhase, string> = {
  squeeze: 'Squeeze',
  relax: 'Relax',
};

/**
 * Donor `KegelPhase.description` — what to DO, verbatim.
 *
 * This is technique, in the same register as the instructions already shipped
 * on every row of the exercise library: it describes the movement being timed.
 * It makes no claim about what the exercise achieves, and the screen carries
 * nothing that does.
 */
export const KEGEL_PHASE_INSTRUCTIONS: Record<KegelPhase, string> = {
  squeeze: 'Tighten your pelvic floor muscles as if stopping urination.',
  relax: 'Release and let your muscles fully relax.',
};

export function kegelPhaseSeconds(phase: KegelPhase): number {
  return phase === 'squeeze' ? KEGEL_SQUEEZE_SECONDS : KEGEL_RELAX_SECONDS;
}

export type KegelStatus = 'idle' | 'running' | 'paused' | 'done';

export interface KegelSession {
  status: KegelStatus;
  phase: KegelPhase;
  /** Seconds left in the current phase — the number on screen. */
  secondsLeft: number;
  /** 1-based set the person is on. */
  set: number;
  totalSets: number;
  /** Sets fully finished (squeeze AND relax) — the figure that gets logged. */
  completedSets: number;
}

export function clampSessionSets(n: number): number {
  if (!Number.isFinite(n) || n < 1) return KEGEL_DEFAULT_SETS;
  return Math.min(MAX_KEGEL_SESSION_SETS, Math.round(n));
}

export function createKegelSession(totalSets = KEGEL_DEFAULT_SETS): KegelSession {
  return {
    status: 'idle',
    phase: 'squeeze',
    secondsLeft: KEGEL_SQUEEZE_SECONDS,
    set: 1,
    totalSets: clampSessionSets(totalSets),
    completedSets: 0,
  };
}

export function startKegelSession(session: KegelSession): KegelSession {
  // Resuming a paused session keeps its place; starting from idle or done
  // rewinds, because a half-finished set cannot be resumed honestly after the
  // person has stopped holding.
  if (session.status === 'paused') return { ...session, status: 'running' };
  return { ...createKegelSession(session.totalSets), status: 'running' };
}

export function pauseKegelSession(session: KegelSession): KegelSession {
  return session.status === 'running' ? { ...session, status: 'paused' } : session;
}

/**
 * One second of the session.
 *
 * The donor's rule: the readout counts 5→1, then the phase flips. A squeeze and
 * its release together are one completed set; the last release ends the
 * session.
 */
export function tickKegelSession(session: KegelSession): KegelSession {
  if (session.status !== 'running') return session;
  if (session.secondsLeft > 1) {
    return { ...session, secondsLeft: session.secondsLeft - 1 };
  }
  if (session.phase === 'squeeze') {
    return { ...session, phase: 'relax', secondsLeft: KEGEL_RELAX_SECONDS };
  }
  const completedSets = session.completedSets + 1;
  if (session.set < session.totalSets) {
    return {
      ...session,
      phase: 'squeeze',
      secondsLeft: KEGEL_SQUEEZE_SECONDS,
      set: session.set + 1,
      completedSets,
    };
  }
  return { ...session, status: 'done', secondsLeft: 0, completedSets };
}

/** Fraction of the CURRENT phase elapsed, for the ring. */
export function kegelPhaseProgress(session: KegelSession): number {
  const total = kegelPhaseSeconds(session.phase);
  if (session.status === 'done') return 1;
  return Math.max(0, Math.min(1, (total - session.secondsLeft) / total));
}

/** "Set 2 of 3" / "Session complete". */
export function kegelProgressLabel(session: KegelSession): string {
  if (session.status === 'done') return 'Session complete';
  return `Set ${session.set} of ${session.totalSets}`;
}

/* ------------------------------------------------------------------ */
/* Which cards to show (donor MensHealthSettingsSheet)                 */
/* ------------------------------------------------------------------ */

/**
 * The donor's tracking toggles, narrowed to the sections this screen ACTUALLY
 * renders.
 *
 * The table also carries `track_night_erection`, `track_day_erection` and
 * `track_exercise`; those rows have no counterpart here (the RN entry form has
 * no night/day erection or workout field), and a switch that hides nothing
 * would be furniture. They are left at their stored values and never written.
 *
 * This is a display preference, and on this screen that matters more than
 * usual: it is what lets someone keep a vitality log without being asked, every
 * single day, about the one thing they would rather not be asked about.
 */
export const MENS_TRACK_SECTIONS = [
  'trackLibido',
  'trackSexualDesire',
  'trackSexualActivity',
  'trackMorningErection',
  'trackEroticDreams',
  'trackIssues',
  'trackEnergy',
  'trackKegels',
] as const;
export type MensTrackSection = (typeof MENS_TRACK_SECTIONS)[number];

export const MENS_TRACK_LABELS: Record<MensTrackSection, string> = {
  trackLibido: 'Libido',
  trackSexualDesire: 'Desire through the day',
  trackSexualActivity: 'Activity and satisfaction',
  trackMorningErection: 'Erection health',
  trackEroticDreams: 'Erotic dreams',
  trackIssues: 'Anything off today',
  trackEnergy: 'Energy and mind',
  trackKegels: 'Kegels',
};

/** Screen key → the `mens_health_settings` column the route writes. */
export const MENS_TRACK_COLUMN: Record<MensTrackSection, string> = {
  trackLibido: 'track_libido',
  trackSexualDesire: 'track_sexual_desire',
  trackSexualActivity: 'track_sexual_activity',
  trackMorningErection: 'track_morning_erection',
  trackEroticDreams: 'track_erotic_dreams',
  trackIssues: 'track_issues',
  trackEnergy: 'track_energy',
  trackKegels: 'track_kegels',
};

export type MensTrackSettings = Record<MensTrackSection, boolean>;

/** Everything on, matching the table's own column defaults. */
export const DEFAULT_MENS_TRACK_SETTINGS: MensTrackSettings = {
  trackLibido: true,
  trackSexualDesire: true,
  trackSexualActivity: true,
  trackMorningErection: true,
  trackEroticDreams: true,
  trackIssues: true,
  trackEnergy: true,
  trackKegels: true,
};

/**
 * The donor's three quick presets, minus the switches that have no section.
 * They choose a LAYOUT — which cards are on screen — and assert nothing about
 * the person using them.
 */
export const MENS_TRACK_PRESETS: Array<{
  key: string;
  label: string;
  settings: MensTrackSettings;
}> = [
  { key: 'all', label: 'Show everything', settings: { ...DEFAULT_MENS_TRACK_SETTINGS } },
  {
    key: 'minimal',
    label: 'Minimal',
    settings: {
      trackLibido: true,
      trackSexualDesire: false,
      trackSexualActivity: false,
      trackMorningErection: true,
      trackEroticDreams: false,
      trackIssues: false,
      trackEnergy: true,
      trackKegels: false,
    },
  },
  {
    key: 'erection',
    label: 'Erection health',
    settings: {
      trackLibido: true,
      trackSexualDesire: true,
      trackSexualActivity: false,
      trackMorningErection: true,
      trackEroticDreams: true,
      trackIssues: true,
      trackEnergy: false,
      trackKegels: true,
    },
  },
];

function settingsFromWire(row: HealthMensSettings | null): MensTrackSettings {
  if (!row) return { ...DEFAULT_MENS_TRACK_SETTINGS };
  const source = row as unknown as Record<string, unknown>;
  const next = { ...DEFAULT_MENS_TRACK_SETTINGS };
  for (const section of MENS_TRACK_SECTIONS) {
    const value = source[MENS_TRACK_COLUMN[section]];
    // D1 hands booleans back as 0/1 through some paths; treat both, and leave
    // the default in place for anything else rather than coercing it to false.
    if (value === true || value === 1) next[section] = true;
    else if (value === false || value === 0) next[section] = false;
  }
  return next;
}

async function fetchMensTrackSettings(): Promise<MensTrackSettings> {
  return settingsFromWire((await healthApi.getMensHealthSettings()).settings);
}

export async function loadMensTrackSettings(): Promise<MensTrackSettings> {
  const stored = await readThrough<Partial<MensTrackSettings>>(
    HEALTH_MENS_SETTINGS_KEY,
    fetchMensTrackSettings,
    {}
  );
  const merged = { ...DEFAULT_MENS_TRACK_SETTINGS };
  for (const section of MENS_TRACK_SECTIONS) {
    if (typeof stored[section] === 'boolean') merged[section] = stored[section] as boolean;
  }
  return merged;
}

export async function saveMensTrackSettings(
  patch: Partial<MensTrackSettings>
): Promise<MensTrackSettings> {
  const next = { ...(await loadMensTrackSettings()), ...patch };
  // Build the body from the fixed column map — the route spreads it straight
  // into the UPDATE, so an unmapped key would fail the whole write.
  const body: Record<string, boolean> = {};
  for (const section of MENS_TRACK_SECTIONS) {
    body[MENS_TRACK_COLUMN[section]] = next[section];
  }
  return writeThrough(
    HEALTH_MENS_SETTINGS_KEY,
    () => healthApi.saveMensHealthSettings(body),
    async () => next,
    next,
    `sections=${MENS_TRACK_SECTIONS.filter((s) => next[s]).length}/${MENS_TRACK_SECTIONS.length}`
  );
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function isValidEntry(entry: VitalityEntry | null | undefined): entry is VitalityEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    Number.isFinite(entry.libido) &&
    Number.isFinite(entry.energyLevel)
  );
}

/** Wire row → screen entry. Nulls become the donor's neutral defaults. */
function fromWire(row: Record<string, unknown>): VitalityEntry {
  const empty = createEmptyVitalityEntry(String(row.date));
  // Generic in the fallback so `num(k, 5)` narrows to `number`: a widened
  // `number | null` return forced a `?? 5` on every neutral-defaulted column
  // that could never fire, and dead guards hide the ones that can.
  const num = <F extends number | null>(k: string, fallback: F): number | F => {
    const v = row[k];
    return typeof v === 'number' ? v : fallback;
  };
  const bool = (k: string) => row[k] === true || row[k] === 1;
  return {
    ...empty,
    id: String(row.id ?? empty.id),
    date: String(row.date),
    libido: num('libido', 5),
    hadPartnerSex: bool('had_partner_sex'),
    hadMasturbation: bool('had_masturbation'),
    hadOrgasm: bool('had_orgasm'),
    overallSatisfaction: num('overall_satisfaction', null),
    hadMorningErection: bool('had_morning_erection'),
    morningErectionQuality: num('morning_erection_quality', null),
    erectionQuality: num('erection_quality', null),
    hadEroticDream: bool('had_erotic_dream'),
    sexualDesireLevel: num('sexual_desire_level', 5),
    hadErectionDifficulty: bool('had_erection_difficulty'),
    hadMaintenanceDifficulty: bool('had_maintenance_difficulty'),
    hadPrematureEjaculation: bool('had_premature_ejaculation'),
    hadDelayedEjaculation: bool('had_delayed_ejaculation'),
    hadPerformanceAnxiety: bool('had_performance_anxiety'),
    hadLowDesire: bool('had_low_desire'),
    hadPainOrDiscomfort: bool('had_pain_or_discomfort'),
    energyLevel: num('energy_level', 5),
    mentalClarity: num('mental_clarity', 5),
    mood: num('mood', 5),
    sleepQuality: num('sleep_quality', 5),
    stressLevel: num('stress_level', 5),
    exercised: bool('exercised'),
    kegelSets: num('kegel_sets', 0),
    notes: typeof row.notes === 'string' ? row.notes : '',
    loggedAt: String(row.updated_at ?? ''),
  };
}

/** Screen entry → the donor's snake_case columns. */
function toWire(entry: VitalityEntry): Record<string, unknown> {
  return {
    date: entry.date,
    libido: entry.libido,
    had_partner_sex: entry.hadPartnerSex,
    had_masturbation: entry.hadMasturbation,
    had_orgasm: entry.hadOrgasm,
    overall_satisfaction: entry.overallSatisfaction,
    had_morning_erection: entry.hadMorningErection,
    morning_erection_quality: entry.morningErectionQuality,
    erection_quality: entry.erectionQuality,
    had_erotic_dream: entry.hadEroticDream,
    sexual_desire_level: entry.sexualDesireLevel,
    had_erection_difficulty: entry.hadErectionDifficulty,
    had_maintenance_difficulty: entry.hadMaintenanceDifficulty,
    had_premature_ejaculation: entry.hadPrematureEjaculation,
    had_delayed_ejaculation: entry.hadDelayedEjaculation,
    had_performance_anxiety: entry.hadPerformanceAnxiety,
    had_low_desire: entry.hadLowDesire,
    had_pain_or_discomfort: entry.hadPainOrDiscomfort,
    energy_level: entry.energyLevel,
    mental_clarity: entry.mentalClarity,
    mood: entry.mood,
    sleep_quality: entry.sleepQuality,
    stress_level: entry.stressLevel,
    exercised: entry.exercised,
    kegel_sets: entry.kegelSets,
    notes: entry.notes,
  };
}

async function fetchVitality(): Promise<VitalityEntry[]> {
  const res = await healthApi.listMensHealth();
  return (res.entries ?? [])
    .map((row) => fromWire(row as unknown as Record<string, unknown>))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ENTRIES);
}

export async function loadVitalityEntries(): Promise<VitalityEntry[]> {
  const entries = await readThrough(HEALTH_VITALITY_KEY, fetchVitality, []);
  return entries.filter(isValidEntry).sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadVitalityForDate(
  date = todayDateKey(),
): Promise<VitalityEntry | null> {
  return (await loadVitalityEntries()).find((e) => e.date === date) ?? null;
}

/** One entry per day — saving merges into that day rather than appending. */
export async function saveVitalityEntry(
  patch: Partial<Omit<VitalityEntry, 'id' | 'date' | 'loggedAt'>>,
  date = todayDateKey(),
): Promise<VitalityEntry[]> {
  const existing = (await loadVitalityForDate(date)) ?? createEmptyVitalityEntry(date);
  const merged: VitalityEntry = {
    ...existing,
    ...patch,
    id: `vitality-${date}`,
    date,
    libido: clampScale(patch.libido ?? existing.libido),
    sexualDesireLevel: clampScale(patch.sexualDesireLevel ?? existing.sexualDesireLevel),
    energyLevel: clampScale(patch.energyLevel ?? existing.energyLevel),
    mentalClarity: clampScale(patch.mentalClarity ?? existing.mentalClarity),
    mood: clampScale(patch.mood ?? existing.mood),
    sleepQuality: clampScale(patch.sleepQuality ?? existing.sleepQuality),
    stressLevel: clampScale(patch.stressLevel ?? existing.stressLevel),
    kegelSets: clampKegelSets(patch.kegelSets ?? existing.kegelSets),
    notes: (patch.notes ?? existing.notes).trim().slice(0, MAX_NOTE_LENGTH),
    loggedAt: new Date().toISOString(),
  };
  const others = (await loadVitalityEntries()).filter((e) => e.date !== date);
  const optimistic = [merged, ...others]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ENTRIES);
  const body = toWire(merged) as Record<string, unknown> & { date: string };
  return writeThrough(
    HEALTH_VITALITY_KEY,
    () => healthApi.saveMensHealth(body),
    fetchVitality,
    optimistic,
    `date=${date} score=${vitalityScore(merged)}`,
    // `mens_health_entries` reconciles on `(user, date)` — `date` alone dedups.
    { queue: { collection: 'mens_health_entries', row: body } }
  );
}

/**
 * Clearing a day writes an EMPTY entry rather than issuing a delete: the donor
 * has no per-day delete endpoint, and an empty day is semantically "logged
 * nothing", which is what the screen means by clearing it.
 */
export async function deleteVitalityEntry(date: string): Promise<VitalityEntry[]> {
  const optimistic = (await loadVitalityEntries()).filter((e) => e.date !== date);
  const body = toWire(createEmptyVitalityEntry(date)) as Record<string, unknown> & { date: string };
  return writeThrough(
    HEALTH_VITALITY_KEY,
    () => healthApi.saveMensHealth(body),
    fetchVitality,
    optimistic,
    `clear date=${date}`,
    { queue: { collection: 'mens_health_entries', row: body } }
  );
}
