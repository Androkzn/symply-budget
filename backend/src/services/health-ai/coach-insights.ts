/**
 * Grounded daily insights — DETERMINISTIC arithmetic over the user's own logged
 * figures. No model is involved at any point in this file.
 *
 * Ported from the donor's
 * `~/Desktop/Symply Ecosystem/Simply Health/backend/src/services/healthCoach/insights/groundedInsights.ts`,
 * whose header states the rule this whole module exists to enforce:
 *
 *   > LLM may only wordsmith an already-approved structured result.
 *
 * ── WHY A SEPARATE, MODEL-FREE PATH ──────────────────────────────────────────
 *
 * Two reasons, and the second is the important one.
 *
 * 1. It is what the coach screen can still show when AI is unavailable, not
 *    entitled, or erroring. These are the person's OWN numbers, added up — not a
 *    fabricated result, so showing them does not violate fail-closed. The screen
 *    says plainly that the coach itself is unavailable.
 * 2. It is the anti-hallucination reference. `composeInsightSpeech` REFUSES to
 *    emit a sentence containing a number that is not in the insight's own
 *    `facts` array. That is a mechanical guarantee that a figure shown to the
 *    user came from their data, and it is the donor's idea, kept.
 *
 * ── DELIBERATE DIFFERENCES FROM THE DONOR ────────────────────────────────────
 *
 *   * **Three of the donor's four suppression gates are dropped.**
 *     `quiet_hours`, `frequency_cap_reached` and `cooldown_active` exist in the
 *     donor because its insights are PUSHED as smart notifications, so cadence
 *     had to be governed. Here they are PULLED — the person opened the coach
 *     screen and asked. Suppressing what someone explicitly opened would be a
 *     bug, not a courtesy. `consent_missing` is kept, and is enforced upstream
 *     at the route as well.
 *   * **Inputs come from the SERVER, not the client.** The donor takes
 *     `today_calories`, `calorie_goal`, … straight off the request body, so a
 *     device can hand it any numbers it likes and get them read back as
 *     "insights". Here the caller is `health-ai-service.ts`, which reads the
 *     user's own rows through `HealthService`. Same reasoning as
 *     `health-body-extras.ts` keeping body insights read-only over HTTP: a
 *     surface that looks derived must actually be derived.
 *   * **`missing` freshness is stated as UNKNOWN, never as zero.** Kept from the
 *     donor, whose caveat wording — "Missing wearable/app data means unknown —
 *     not zero" — is exactly right and is reused almost verbatim.
 */

export type InsightKind = 'calories' | 'protein' | 'water' | 'unknown_data' | 'suppressed';

export interface InsightFact {
  label: string;
  /** The number itself. Every numeral in `speakable` must appear here. */
  value: number;
  unit?: string;
}

export interface GroundedInsight {
  id: string;
  /** Lower sorts first. */
  priority: number;
  kind: InsightKind;
  title: string;
  facts: InsightFact[];
  caveats: string[];
  data_window: { start: string; end: string };
  /** Already validated against `facts` — see `composeInsightSpeech`. */
  speakable: string;
}

export type InsightFreshness = 'fresh' | 'partial' | 'stale' | 'missing';

export interface InsightInputs {
  today_calories?: number | null;
  calorie_goal?: number | null;
  today_protein_g?: number | null;
  protein_goal_g?: number | null;
  today_water_ml?: number | null;
  water_goal_ml?: number | null;
  freshness: InsightFreshness;
  /** False → a single `suppressed` insight and nothing else. */
  consent_insights: boolean;
  window: { start: string; end: string };
}

/**
 * Every numeral in `template` must appear in `facts`, or this throws.
 *
 * The donor throws `ungrounded_number:${n}`; the message is kept because it is
 * the string a failing test should show. This is the mechanical half of the
 * grounding rule the coach prompt states in words — a sentence that says
 * "you are 400 kcal under" when no fact holds 400 cannot be emitted at all.
 *
 * Matching is on the digit runs, ignoring thousands separators, so "1,850" and
 * a fact of 1850 agree.
 */
export function composeInsightSpeech(template: string, facts: readonly InsightFact[]): string {
  const allowed = new Set(facts.map((f) => String(f.value)));
  const numerals = template.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? [];
  for (const n of numerals) {
    if (!allowed.has(n)) {
      throw new Error(`ungrounded_number:${n}`);
    }
  }
  return template;
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * The insights for one day, highest priority first.
 *
 * A metric with no goal produces a plain "you logged X" insight rather than
 * nothing: the figure is still the person's own and still worth stating. A
 * metric with neither figure nor goal produces nothing at all — an insight that
 * says "you logged 0" about a day the person never opened the app is a lie
 * dressed as a fact.
 */
export function computeGroundedInsights(inputs: InsightInputs): GroundedInsight[] {
  const window = inputs.window;

  if (!inputs.consent_insights) {
    const facts: InsightFact[] = [];
    return [
      {
        id: 'suppressed_consent',
        priority: 0,
        kind: 'suppressed',
        title: 'Insights are turned off',
        facts,
        caveats: ['You have not agreed to let the coach read your logged data.'],
        data_window: window,
        speakable: composeInsightSpeech(
          'I am not reading your logged data because you have not turned insights on.',
          facts
        ),
      },
    ];
  }

  if (inputs.freshness === 'missing') {
    const facts: InsightFact[] = [];
    return [
      {
        id: 'unknown_data',
        priority: 0,
        kind: 'unknown_data',
        title: 'Not enough logged yet',
        facts,
        caveats: ['Missing data means unknown — not zero.'],
        data_window: window,
        speakable: composeInsightSpeech(
          'I do not have enough logged data to say anything about today yet.',
          facts
        ),
      },
    ];
  }

  const out: GroundedInsight[] = [];
  const staleCaveat =
    inputs.freshness === 'stale'
      ? ['Some of this is from an older sync and may be behind.']
      : inputs.freshness === 'partial'
        ? ['Some of today may not have synced yet.']
        : [];

  // ---- Calories -----------------------------------------------------------
  const kcal = inputs.today_calories;
  const kcalGoal = inputs.calorie_goal;
  if (typeof kcal === 'number') {
    if (typeof kcalGoal === 'number' && kcalGoal > 0) {
      const logged = round(kcal);
      const goal = round(kcalGoal);
      const diff = Math.abs(goal - logged);
      const facts: InsightFact[] = [
        { label: 'Logged', value: logged, unit: 'kcal' },
        { label: 'Goal', value: goal, unit: 'kcal' },
        { label: logged > goal ? 'Over' : 'Remaining', value: diff, unit: 'kcal' },
      ];
      out.push({
        id: 'calories',
        priority: 1,
        kind: 'calories',
        title: 'Calories today',
        facts,
        caveats: [...staleCaveat],
        data_window: window,
        speakable: composeInsightSpeech(
          logged > goal
            ? `You have logged ${logged} kcal today, ${diff} over your goal of ${goal}.`
            : `You have logged ${logged} kcal today, ${diff} under your goal of ${goal}.`,
          facts
        ),
      });
    } else {
      const logged = round(kcal);
      const facts: InsightFact[] = [{ label: 'Logged', value: logged, unit: 'kcal' }];
      out.push({
        id: 'calories',
        priority: 1,
        kind: 'calories',
        title: 'Calories today',
        facts,
        caveats: ['No calorie goal is set, so there is nothing to compare this against.', ...staleCaveat],
        data_window: window,
        speakable: composeInsightSpeech(`You have logged ${logged} kcal today.`, facts),
      });
    }
  }

  // ---- Protein ------------------------------------------------------------
  const protein = inputs.today_protein_g;
  const proteinGoal = inputs.protein_goal_g;
  if (typeof protein === 'number') {
    const logged = round(protein);
    if (typeof proteinGoal === 'number' && proteinGoal > 0) {
      const goal = round(proteinGoal);
      const diff = Math.abs(goal - logged);
      const facts: InsightFact[] = [
        { label: 'Logged', value: logged, unit: 'g' },
        { label: 'Goal', value: goal, unit: 'g' },
        { label: logged > goal ? 'Over' : 'Remaining', value: diff, unit: 'g' },
      ];
      out.push({
        id: 'protein',
        priority: 2,
        kind: 'protein',
        title: 'Protein today',
        facts,
        caveats: [...staleCaveat],
        data_window: window,
        speakable: composeInsightSpeech(
          logged >= goal
            ? `You have logged ${logged} g of protein today and your goal is ${goal}.`
            : `You have logged ${logged} g of protein today, ${diff} short of your goal of ${goal}.`,
          facts
        ),
      });
    } else {
      const facts: InsightFact[] = [{ label: 'Logged', value: logged, unit: 'g' }];
      out.push({
        id: 'protein',
        priority: 2,
        kind: 'protein',
        title: 'Protein today',
        facts,
        caveats: ['No protein goal is set.', ...staleCaveat],
        data_window: window,
        speakable: composeInsightSpeech(`You have logged ${logged} g of protein today.`, facts),
      });
    }
  }

  // ---- Water --------------------------------------------------------------
  const water = inputs.today_water_ml;
  const waterGoal = inputs.water_goal_ml;
  if (typeof water === 'number') {
    const logged = round(water);
    if (typeof waterGoal === 'number' && waterGoal > 0) {
      const goal = round(waterGoal);
      const diff = Math.abs(goal - logged);
      const facts: InsightFact[] = [
        { label: 'Logged', value: logged, unit: 'ml' },
        { label: 'Goal', value: goal, unit: 'ml' },
        { label: logged >= goal ? 'Over' : 'Remaining', value: diff, unit: 'ml' },
      ];
      out.push({
        id: 'water',
        priority: 3,
        kind: 'water',
        title: 'Water today',
        facts,
        caveats: [...staleCaveat],
        data_window: window,
        speakable: composeInsightSpeech(
          logged >= goal
            ? `You have logged ${logged} ml of water today and your target is ${goal}.`
            : `You have logged ${logged} ml of water today, ${diff} short of your target of ${goal}.`,
          facts
        ),
      });
    } else {
      const facts: InsightFact[] = [{ label: 'Logged', value: logged, unit: 'ml' }];
      out.push({
        id: 'water',
        priority: 3,
        kind: 'water',
        title: 'Water today',
        facts,
        caveats: ['No water target is set.', ...staleCaveat],
        data_window: window,
        speakable: composeInsightSpeech(`You have logged ${logged} ml of water today.`, facts),
      });
    }
  }

  if (out.length === 0) {
    const facts: InsightFact[] = [];
    return [
      {
        id: 'unknown_data',
        priority: 0,
        kind: 'unknown_data',
        title: 'Not enough logged yet',
        facts,
        caveats: ['Missing data means unknown — not zero.'],
        data_window: window,
        speakable: composeInsightSpeech(
          'I do not have enough logged data to say anything about today yet.',
          facts
        ),
      },
    ];
  }

  return out.sort((a, b) => a.priority - b.priority);
}
