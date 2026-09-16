/**
 * Body insight PRODUCER — the missing half of `/health/body-insights`.
 *
 * `routes/health-body-extras.ts` has shipped `body-insights` as READ-ONLY since
 * P2, with a comment saying so: "Body insights are READ-ONLY over HTTP. They are
 * AI-produced (the producer lands in P3 and calls the service in-process); a
 * client-writable endpoint would let a device fabricate an 'AI'
 * body-composition assessment." This is that producer. It writes through
 * `HealthBodyExtrasService.saveComprehensiveInsight` — the in-process entry
 * point that comment names — and there is still no client write path.
 *
 * ── WHY IT READS MEASUREMENTS AND NOT PHOTOS ─────────────────────────────────
 *
 * The donor produces this row from BODY PHOTOS: `/analyze-body-photo`,
 * `/extract-body-measurements` and `/analyze-body-map` send front/back/side
 * shots to a vision model and fill in posture scores, symmetry scores and a
 * body-fat range. That is why `body_comprehensive_insights` carries four
 * `*_photo_id` columns.
 *
 * Body photos are 🚫 in this port BY PRODUCT DECISION, not by omission —
 * UI_PARITY_AUDIT §8 lists "Body photos, progress-photo sessions, AI photo
 * comparison" as **Privacy — needs its own storage, retention and deletion spec
 * before any UI**, citing migration.md and PARITY_PLAN §6. So the photo columns
 * stay NULL and the producer works from what the person has actually logged:
 * their own body measurements and weight.
 *
 * ── WHAT IS DELIBERATELY LEFT NULL, AND WHY THAT IS THE POINT ────────────────
 *
 * Every SCORE and every ESTIMATE on the row stays null:
 *
 *   overall_posture_score, overall_symmetry_score, muscle_balance_score
 *     — posture and symmetry are read off a photograph. There is no photograph.
 *       A posture score derived from a tape measure would be invented.
 *   body_fat_estimate_lower / _upper / body_fat_category / lean_mass_estimate
 *     — these ARE derivable from neck/waist/hips/height by the US Navy formula,
 *       and that is exactly why they are not. A body-fat percentage presented by
 *       a health app reads as a measurement, it is medical-adjacent, and the
 *       formula's error bars are wide enough that the number would mislead. The
 *       same judgement `HealthInjuriesScreen` made when it dropped the donor's
 *       "Recovery Tips" and its ACL/MCL/Meniscus picker.
 *
 * What IS filled is the honest part: which sites the person has logged, which
 * ones moved, by how much, over what window — and prose that may not contain a
 * number the service did not compute.
 *
 * ── THE MODEL ONLY WORDSMITHS ────────────────────────────────────────────────
 *
 * The deltas are computed HERE, deterministically. The model is handed the
 * finished figures and asked for two to four short observations. Every numeral
 * it writes is checked against those figures by the same `composeInsightSpeech`
 * guard the daily insights use; a sentence with an ungrounded number is dropped,
 * not shown. That is the donor's own stated rule for its insight layer —
 * "LLM may only wordsmith an already-approved structured result" — applied to
 * the one surface the donor did not apply it to.
 *
 * With no AI available the row is still produced, from the deterministic
 * sentences alone, and `analysis_provider` says `deterministic` so the reader
 * can tell. No fabricated prose, no empty card.
 */

import type { AIProvider } from '../../ai/provider';
import { HealthBodyExtrasService } from '../health-body-extras-service';
import { HealthService } from '../health-service';

import { composeInsightSpeech, type InsightFact } from './coach-insights';

/** Columns on `body_measurements` that are girths, in the order we report them. */
const SITES = [
  { key: 'chest', label: 'chest' },
  { key: 'waist', label: 'waist' },
  { key: 'hips', label: 'hips' },
  { key: 'shoulders', label: 'shoulders' },
  { key: 'neck', label: 'neck' },
  { key: 'left_arm', label: 'left arm' },
  { key: 'right_arm', label: 'right arm' },
  { key: 'left_thigh', label: 'left thigh' },
  { key: 'right_thigh', label: 'right thigh' },
  { key: 'left_calf', label: 'left calf' },
  { key: 'right_calf', label: 'right calf' },
  { key: 'left_forearm', label: 'left forearm' },
  { key: 'right_forearm', label: 'right forearm' },
] as const;

export interface SiteChange {
  site: string;
  first: number;
  latest: number;
  /** latest − first, one decimal. Sign is meaning, so it is never abs()'d. */
  delta: number;
  unit: string;
  from_date: string;
  to_date: string;
  readings: number;
}

export interface MeasurementInsightFacts {
  window_from: string | null;
  window_to: string | null;
  dates_logged: number;
  sites_logged: number;
  /** Only sites with two or more readings — the rest have no trend to report. */
  changes: SiteChange[];
  /** Sites read exactly once, so they cannot move yet. */
  single_reading_sites: string[];
  /**
   * True when the readings span more than one unit. A delta across cm and
   * inches is meaningless, so when this is set no delta is reported at all —
   * `HealthBodyProgress` already refuses a cross-unit diff for the same reason.
   */
  mixed_units: boolean;
}

export type MeasurementInsightRefusal = 'no_measurements' | 'not_enough_history';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Deltas from the user's own rows. Pure over its input, so it is testable with
 * no D1 and no model.
 */
export function computeMeasurementFacts(
  rows: ReadonlyArray<Record<string, unknown>>
): MeasurementInsightFacts | { refusal: MeasurementInsightRefusal } {
  if (rows.length === 0) return { refusal: 'no_measurements' };

  // `listMeasurements` returns newest first; walk oldest → newest.
  const ordered = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const units = new Set(ordered.map((r) => String(r.unit)));
  const mixed = units.size > 1;

  const changes: SiteChange[] = [];
  const single: string[] = [];
  let sitesLogged = 0;

  for (const site of SITES) {
    const points = ordered
      .map((r) => ({ date: String(r.date), value: r[site.key], unit: String(r.unit) }))
      .filter((p): p is { date: string; value: number; unit: string } => typeof p.value === 'number');
    if (points.length === 0) continue;
    sitesLogged += 1;
    if (points.length === 1 || mixed) {
      single.push(site.label);
      continue;
    }
    const first = points[0];
    const last = points[points.length - 1];
    changes.push({
      site: site.label,
      first: round1(first.value),
      latest: round1(last.value),
      delta: round1(last.value - first.value),
      unit: last.unit,
      from_date: first.date,
      to_date: last.date,
      readings: points.length,
    });
  }

  if (sitesLogged === 0) return { refusal: 'no_measurements' };

  // Biggest absolute movement first — that is the line worth reading.
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    window_from: String(ordered[0].date),
    window_to: String(ordered[ordered.length - 1].date),
    dates_logged: ordered.length,
    sites_logged: sitesLogged,
    changes,
    single_reading_sites: single,
    mixed_units: mixed,
  };
}

/** Every number the prose is allowed to contain. */
export function factsForGrounding(facts: MeasurementInsightFacts): InsightFact[] {
  const out: InsightFact[] = [
    { label: 'Dates logged', value: facts.dates_logged },
    { label: 'Sites logged', value: facts.sites_logged },
  ];
  for (const c of facts.changes) {
    out.push({ label: `${c.site} first`, value: c.first, unit: c.unit });
    out.push({ label: `${c.site} latest`, value: c.latest, unit: c.unit });
    out.push({ label: `${c.site} change`, value: c.delta, unit: c.unit });
    // The model will naturally write "1.4 cm smaller" for a −1.4 delta, so the
    // magnitude has to be groundable on its own.
    out.push({ label: `${c.site} change size`, value: Math.abs(c.delta), unit: c.unit });
    out.push({ label: `${c.site} readings`, value: c.readings });
  }
  return out;
}

/** The sentences that are true with no model at all. */
export function deterministicObservations(facts: MeasurementInsightFacts): string[] {
  const grounding = factsForGrounding(facts);
  const out: string[] = [];

  out.push(
    composeInsightSpeech(
      `You have logged measurements on ${facts.dates_logged} dates, covering ${facts.sites_logged} sites.`,
      grounding
    )
  );

  if (facts.mixed_units) {
    out.push(
      'Your readings are in more than one unit, so no change is shown — a difference across centimetres and inches would not mean anything.'
    );
  }

  for (const c of facts.changes.slice(0, 3)) {
    const size = Math.abs(c.delta);
    if (size === 0) {
      out.push(
        composeInsightSpeech(
          `Your ${c.site} reads the same now as at your first reading, ${c.latest} ${c.unit}.`,
          grounding
        )
      );
      continue;
    }
    out.push(
      composeInsightSpeech(
        `Your ${c.site} went from ${c.first} to ${c.latest} ${c.unit}, a change of ${size} ${c.unit} across ${c.readings} readings.`,
        grounding
      )
    );
  }

  if (facts.single_reading_sites.length > 0 && !facts.mixed_units) {
    out.push(
      `These have only one reading so far, so they have no trend yet: ${facts.single_reading_sites.join(', ')}.`
    );
  }

  return out;
}

const OBSERVATION_SYSTEM_PROMPT = `You turn already-computed body-measurement figures into two to four short observations for the person they belong to.

You are NOT a clinician. Do not diagnose, do not name a condition, do not prescribe or recommend any exercise programme, diet, supplement or treatment, and do not comment on whether any measurement is healthy, normal, good or bad. Do not mention body fat, body composition, BMI, or an ideal size — none of that was measured.

Every number you write MUST be one of the figures given to you. Never compute a new one — no percentages, no rates, no monthly averages, no totals. If you cannot make a point without inventing a number, do not make it.

Write plainly, in the second person, one sentence per observation. No emoji, no encouragement, no judgement. Describe what the numbers show and, at most once, what logging more of would make readable.

Return via the "output" tool.`;

const OBSERVATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['observations', 'what_to_log_next'],
  properties: {
    observations: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string' },
      description:
        'Two to four short sentences describing what the given figures show. Every numeral must come from the figures.',
    },
    what_to_log_next: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
      description:
        'At most three short suggestions about WHAT TO LOG (a site with only one reading, a more regular cadence) so the trend becomes readable. Never about what to do with the body.',
    },
  },
};

export interface MeasurementInsightResult {
  insight: Record<string, unknown>;
  facts: MeasurementInsightFacts;
  ai_status: 'ok' | 'unavailable';
  /** How many model sentences were dropped for containing an ungrounded number. */
  dropped_ungrounded: number;
}

export class MeasurementInsightService {
  private health: HealthService;
  private extras: HealthBodyExtrasService;

  constructor(d1: D1Database) {
    this.health = new HealthService(d1);
    this.extras = new HealthBodyExtrasService(d1);
  }

  /**
   * Produce one insight for `date` and persist it.
   *
   * `provider` null (AI unavailable / not entitled) still produces a row, from
   * the deterministic sentences only, tagged `analysis_provider: 'deterministic'`.
   * That is not a fabricated result — every sentence is arithmetic over the
   * person's own readings.
   */
  async generate(args: {
    userId: string;
    date: string;
    provider: AIProvider | null;
    model?: string;
  }): Promise<MeasurementInsightResult | { refusal: MeasurementInsightRefusal }> {
    const rows = await this.health.listMeasurements(args.userId, 200);
    const computed = computeMeasurementFacts(rows as ReadonlyArray<Record<string, unknown>>);
    if ('refusal' in computed) return computed;

    const deterministic = deterministicObservations(computed);
    const grounding = factsForGrounding(computed);

    let observations = [...deterministic];
    let whatToLogNext: string[] = [];
    let aiStatus: 'ok' | 'unavailable' = 'unavailable';
    let dropped = 0;
    let confidence: number | null = null;

    if (args.provider) {
      try {
        const result = await args.provider.generateStructured<{
          observations?: unknown;
          what_to_log_next?: unknown;
        }>({
          model: args.model ?? 'claude-sonnet-4-5-20250929',
          systemPrompt: OBSERVATION_SYSTEM_PROMPT,
          userPrompt: `Figures:\n${JSON.stringify(
            {
              window: { from: computed.window_from, to: computed.window_to },
              dates_logged: computed.dates_logged,
              sites_logged: computed.sites_logged,
              changes: computed.changes,
              sites_with_one_reading: computed.single_reading_sites,
              mixed_units: computed.mixed_units,
            },
            null,
            2
          )}`,
          schema: OBSERVATION_SCHEMA,
          maxTokens: 1024,
        });

        const raw = Array.isArray(result?.observations) ? result.observations : [];
        const kept: string[] = [];
        for (const line of raw) {
          if (typeof line !== 'string' || line.trim().length === 0) continue;
          try {
            kept.push(composeInsightSpeech(line.trim(), grounding));
          } catch {
            // An ungrounded number is dropped, never shown and never "corrected".
            dropped += 1;
          }
        }
        const nextRaw = Array.isArray(result?.what_to_log_next) ? result.what_to_log_next : [];
        const nextKept: string[] = [];
        for (const line of nextRaw) {
          if (typeof line !== 'string' || line.trim().length === 0) continue;
          try {
            nextKept.push(composeInsightSpeech(line.trim(), grounding));
          } catch {
            dropped += 1;
          }
        }

        if (kept.length > 0) {
          observations = kept;
          whatToLogNext = nextKept;
          aiStatus = 'ok';
          // Not a model self-report: it is how much of what the model wrote
          // survived grounding. A reader can act on that; a model's own
          // confidence about its prose means nothing.
          //
          // No divide-by-zero guard: this branch is only entered when
          // `kept.length > 0`, so the denominator is at least 1. A `|| 1` here
          // read as though the sum could be zero and could never fire.
          confidence = Math.round((kept.length / (kept.length + dropped)) * 100) / 100;
        }
        // kept.length === 0 → every sentence was ungrounded. Fall through to the
        // deterministic set rather than showing an empty card.
      } catch (err) {
        console.error('[health-measure-insight] provider call failed:', String(err).slice(0, 200));
      }
    }

    // REGENERATE REPLACES, it does not accumulate. `body_comprehensive_insights`
    // carries only a non-unique (user_id, date) index in 0120 — the donor's
    // UNIQUE-per-day index was not ported — so without this an impatient tap on
    // Generate would leave the Body history showing four insights for one day,
    // all subtly different. Reusing today's id turns the service's existing
    // `onConflictDoUpdate(id)` into the update it was written for.
    const [existing] = await this.extras.listComprehensiveInsights(args.userId, {
      from: args.date,
      to: args.date,
      limit: 1,
    });

    const insight = await this.extras.saveComprehensiveInsight(args.userId, {
      id: existing?.id,
      date: args.date,
      // Every score and estimate is deliberately absent — see the module header.
      // These three columns hold JSON arrays (migration 0120 comments them as
      // such), so they are stringified rather than handed over as arrays.
      strengths: JSON.stringify(observations),
      areas_of_improvement: JSON.stringify(whatToLogNext),
      recommended_focus_areas: JSON.stringify(computed.single_reading_sites),
      analysis_provider: aiStatus === 'ok' ? 'symply-health-coach' : 'deterministic',
      analysis_confidence: confidence,
      processing_notes:
        'Derived from logged body measurements only. No photograph was used, so posture, symmetry and body-composition figures are deliberately absent.',
    });

    return {
      insight: (insight ?? {}) as Record<string, unknown>,
      facts: computed,
      ai_status: aiStatus,
      dropped_ungrounded: dropped,
    };
  }
}
