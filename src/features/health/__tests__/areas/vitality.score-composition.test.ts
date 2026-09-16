/**
 * Symply Health — Men's Health (Vitality): how the FOUR sub-scores COMPOSE into
 * the ring figure.
 *
 * `healthVitalityStorage.test.ts` pins each formula on its own — libido is worth
 * 5 points a step, a morning erection is worth 20, and so on. What it does not
 * pin is the composition: which of the screen's ~25 collected fields actually
 * reach a score at all, what the headline number's REAL range is once the four
 * parts are averaged, and where `bounded()` genuinely clamps rather than merely
 * looking like it might.
 *
 * That distinction matters because the ring is the one number on the tab a user
 * reads as a verdict about their own body. Three separate things can drift
 * without any single-formula test noticing:
 *
 *   1. A field the screen collects gets quietly wired INTO the score (or a
 *      scored field gets dropped OUT of it). Ten of the entry's fields are
 *      deliberately score-neutral — they exist for the log and the history row,
 *      not for the verdict — and nothing guarded that.
 *   2. `Math.floor` on the mean gets "tidied up" to `Math.round`. On the best
 *      possible day that is the difference between 98 and 99.
 *   3. `bounded()`'s 0/100 clamps get removed as dead code. Three of the four
 *      sub-scores can never reach either rail, so a reviewer checking two of
 *      them would conclude exactly that — and be wrong.
 *
 * Everything here is arithmetic on pure functions: no API, no storage, no
 * timers.
 */

import {
  activeIssues,
  createEmptyVitalityEntry,
  energyScore,
  erectionScore,
  mentalScore,
  NEUTRAL_SCORE,
  sexualHealthScore,
  vitalityScore,
  vitalityStatus,
  type VitalityEntry,
} from '../../healthVitalityStorage';

const TODAY = '2026-07-13';

function entry(over: Partial<VitalityEntry> = {}): VitalityEntry {
  return { ...createEmptyVitalityEntry(over.date ?? TODAY), ...over };
}

/** The four parts the ring averages, in the order the sub-score tiles show them. */
function parts(e: VitalityEntry): [number, number, number, number] {
  return [sexualHealthScore(e), erectionScore(e), energyScore(e), mentalScore(e)];
}

/**
 * The lowest day the model can express. Every scored input is pushed to its
 * worst end, INCLUDING the counter-intuitive ones: activity plus a satisfaction
 * of 1 nets −2 against the sexual sub-score (the +10 for activity is outweighed
 * by (1−5)×3), so an unsatisfying day scores lower than no day at all.
 */
const WORST: Partial<VitalityEntry> = {
  libido: 1,
  hadPartnerSex: true,
  overallSatisfaction: 1,
  hadPerformanceAnxiety: true,
  hadLowDesire: true,
  hadMorningErection: false,
  erectionQuality: 1,
  hadErectionDifficulty: true,
  hadMaintenanceDifficulty: true,
  energyLevel: 1,
  mentalClarity: 1,
  mood: 1,
  stressLevel: 10,
};

/** The highest day the model can express. */
const BEST: Partial<VitalityEntry> = {
  libido: 10,
  hadPartnerSex: true,
  overallSatisfaction: 10,
  hadMorningErection: true,
  morningErectionQuality: 10,
  erectionQuality: 10,
  energyLevel: 10,
  mentalClarity: 10,
  mood: 10,
  stressLevel: 1,
};

/* ------------------------------------------------------------------ */
/* Which fields reach the score at all                                 */
/* ------------------------------------------------------------------ */

describe('vitality score composition — what actually counts', () => {
  it('HEALTH-VITALITY-200: ten collected fields are deliberately score-NEUTRAL', () => {
    // The tab logs far more than it scores. These ten exist for the daily log
    // and the history row; wiring any of them into the verdict would change a
    // number users have already been reading for months, so the exclusion is a
    // contract and not an oversight. Every one is pushed to an extreme here.
    const neutralised = entry({
      sexualDesireLevel: 10, // DRIVE card, second row — logged, never scored
      sleepQuality: 10, // ENERGY & MIND — the donor scores clarity/mood/stress only
      hadOrgasm: true,
      hadEroticDream: true,
      exercised: true,
      kegelSets: 50,
      notes: 'a very good day indeed',
      // Three of the SEVEN issue flags cost nothing. Only anxiety / low desire
      // (sexual) and erection / maintenance difficulty (erection) subtract.
      hadPrematureEjaculation: true,
      hadDelayedEjaculation: true,
      hadPainOrDiscomfort: true,
    });

    expect(parts(neutralised)).toEqual(parts(entry()));
    expect(vitalityScore(neutralised)).toBe(NEUTRAL_SCORE);

    // …and the counter above the issues card DOES move, so the screen shows
    // three noted issues beside an unchanged 50. That pairing is the point: the
    // log is richer than the verdict, on purpose.
    expect(activeIssues(neutralised)).toEqual([
      'hadPrematureEjaculation',
      'hadDelayedEjaculation',
      'hadPainOrDiscomfort',
    ]);
  });

  it('HEALTH-VITALITY-201: exactly four fields move the sexual sub-score, and no other part', () => {
    // Each scored input is moved ALONE from the neutral day, so a formula that
    // started reading a neighbouring field would show up as a second part
    // changing rather than as a wrong total.
    const cases: Array<[label: string, patch: Partial<VitalityEntry>, expected: number]> = [
      ['libido at the floor', { libido: 1 }, 30], // 50 + (1−5)×5
      ['libido at the ceiling', { libido: 10 }, 75], // 50 + (10−5)×5
      ['activity with no rating', { hadPartnerSex: true }, 60], // +10 flat
      ['solo counts as activity', { hadMasturbation: true }, 60], // the other disjunct
      ['satisfaction rides on activity', { hadPartnerSex: true, overallSatisfaction: 10 }, 75],
      ['performance anxiety', { hadPerformanceAnxiety: true }, 40], // −10
      ['low desire', { hadLowDesire: true }, 35], // −15
    ];

    for (const [label, patch, expected] of cases) {
      const e = entry(patch);
      expect([label, sexualHealthScore(e)]).toEqual([label, expected]);
      // The other three parts are untouched by anything on that list.
      expect([label, erectionScore(e), energyScore(e), mentalScore(e)]).toEqual([label, 50, 50, 50]);
    }

    // Satisfaction with NO activity is inert — rating a day nothing happened on
    // must not pay out.
    expect(sexualHealthScore(entry({ overallSatisfaction: 10 }))).toBe(50);
  });

  it('HEALTH-VITALITY-202: exactly four fields move the erection sub-score, and no other part', () => {
    const cases: Array<[label: string, patch: Partial<VitalityEntry>, expected: number]> = [
      ['a morning erection alone', { hadMorningErection: true }, 70], // +20 flat
      ['morning quality rides on it', { hadMorningErection: true, morningErectionQuality: 10 }, 80],
      ['quality during activity, floor', { erectionQuality: 1 }, 38], // 50 + (1−5)×3
      ['quality during activity, ceiling', { erectionQuality: 10 }, 65], // 50 + (10−5)×3
      ['difficulty getting one', { hadErectionDifficulty: true }, 30], // −20
      ['difficulty maintaining', { hadMaintenanceDifficulty: true }, 35], // −15
    ];

    for (const [label, patch, expected] of cases) {
      const e = entry(patch);
      expect([label, erectionScore(e)]).toEqual([label, expected]);
      expect([label, sexualHealthScore(e), energyScore(e), mentalScore(e)]).toEqual([
        label,
        50,
        50,
        50,
      ]);
    }

    // Morning QUALITY with no morning erection is inert, exactly as satisfaction
    // is without activity — the same "rating something that did not happen"
    // guard, on the other card.
    expect(erectionScore(entry({ morningErectionQuality: 10 }))).toBe(50);
  });

  it('HEALTH-VITALITY-203: energy and mental read only their own inputs', () => {
    // energyScore is the one part with no branches at all: level × 10.
    expect(energyScore(entry({ energyLevel: 1 }))).toBe(10);
    expect(energyScore(entry({ energyLevel: 10 }))).toBe(100);
    // …and it ignores the OTHER four ENERGY & MIND rows entirely.
    expect(
      energyScore(entry({ energyLevel: 6, mentalClarity: 1, mood: 1, sleepQuality: 1, stressLevel: 10 }))
    ).toBe(60);

    // mentalScore blends three of the five: clarity ×5, mood ×5, stress −3/pt
    // ABOVE the midpoint (so low stress ADDS).
    expect(mentalScore(entry({ mentalClarity: 10, mood: 5, stressLevel: 5 }))).toBe(75);
    expect(mentalScore(entry({ mentalClarity: 5, mood: 10, stressLevel: 5 }))).toBe(75);
    expect(mentalScore(entry({ stressLevel: 1 }))).toBe(62); // 25 + 25 + 12
    expect(mentalScore(entry({ stressLevel: 10 }))).toBe(35); // 25 + 25 − 15
    // Sleep quality is on the same card and is NOT part of it.
    expect(mentalScore(entry({ sleepQuality: 1 }))).toBe(50);
  });
});

/* ------------------------------------------------------------------ */
/* Where bounded() actually fires                                      */
/* ------------------------------------------------------------------ */

describe('vitality score composition — the 0/100 rails', () => {
  it('HEALTH-VITALITY-204: mentalScore is the ONLY part that can overflow either rail', () => {
    // Raw 10×5 + 10×5 − (1−5)×3 = 112 → clamped to 100.
    expect(mentalScore(entry({ mentalClarity: 10, mood: 10, stressLevel: 1 }))).toBe(100);
    // Raw 1×5 + 1×5 − (10−5)×3 = −5 → clamped to 0. This is the ONLY input in
    // the whole model that reaches the lower rail, so deleting `Math.max(0, …)`
    // as dead code would surface here and nowhere else — and it would put a
    // NEGATIVE number into a ring that renders it as a percentage.
    expect(mentalScore(entry({ mentalClarity: 1, mood: 1, stressLevel: 10 }))).toBe(0);
  });

  it('HEALTH-VITALITY-205: the other three parts have narrower REAL ranges than 0–100', () => {
    // Documented deliberately: a future reader must not "simplify" a formula on
    // the assumption that every part spans the full rail.
    //   sexual   3 … 100  (100 is reachable EXACTLY, the clamp never fires)
    //   erection 3 …  95  (the ceiling is unreachable — max +20 +10 +15)
    //   energy  10 … 100  (level is itself clamped to 1–10)
    expect(sexualHealthScore(entry(WORST))).toBe(3);
    expect(sexualHealthScore(entry(BEST))).toBe(100);

    expect(erectionScore(entry(WORST))).toBe(3);
    expect(erectionScore(entry(BEST))).toBe(95);

    expect(energyScore(entry(WORST))).toBe(10);
    expect(energyScore(entry(BEST))).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* The headline figure                                                 */
/* ------------------------------------------------------------------ */

describe('vitality score composition — the ring figure', () => {
  it('HEALTH-VITALITY-206: all four parts carry EQUAL weight', () => {
    // A plain mean, not a weighted one. Moving any single part by the same
    // amount must move the headline by the same amount, or one axis of the
    // user's day silently counts for more than another.
    const base = vitalityScore(entry());
    expect(base).toBe(50);

    // +20 on one part = +5 on the headline (20 / 4), whichever part it is.
    expect(vitalityScore(entry({ hadMorningErection: true }))).toBe(55); // erection 50→70
    expect(vitalityScore(entry({ energyLevel: 7 }))).toBe(55); // energy 50→70
    expect(vitalityScore(entry({ mentalClarity: 9 }))).toBe(55); // mental 50→70
    expect(vitalityScore(entry({ libido: 9 }))).toBe(55); // sexual 50→70
  });

  it('HEALTH-VITALITY-207: the mean is FLOORED, never rounded', () => {
    // clarity 6, mood 5, stress 6 → mental 30 + 25 − 3 = 52; the other three
    // parts stay at 50, so the mean is 202/4 = 50.5 EXACTLY. `Math.round` would
    // report 51 — the headline would read higher than any part justifies.
    const halfway = entry({ mentalClarity: 6, mood: 5, stressLevel: 6 });
    expect(parts(halfway)).toEqual([50, 50, 50, 52]);
    expect(vitalityScore(halfway)).toBe(50);
    expect(Math.round(202 / 4)).toBe(51); // what the bug would have said
  });

  it('HEALTH-VITALITY-208: the ring can never actually read 0 or 100', () => {
    // The REAL range of the headline is 4 … 98, because two of the four parts
    // cannot reach their own rails. Worth pinning: a "the ring never fills"
    // bug report is expected behaviour, and a 0 or a 100 on screen would mean
    // the formula changed.
    const worst = entry(WORST);
    expect(parts(worst)).toEqual([3, 3, 10, 0]);
    expect(vitalityScore(worst)).toBe(4); // floor(16 / 4)
    expect(vitalityStatus(4)).toBe('Needs attention');

    const best = entry(BEST);
    expect(parts(best)).toEqual([100, 95, 100, 100]);
    // 395 / 4 = 98.75 → floored. This is also the strongest floor-vs-round
    // case on the whole tab: rounding would report 99.
    expect(vitalityScore(best)).toBe(98);
    expect(vitalityStatus(98)).toBe('Peak performance');
  });

  it('HEALTH-VITALITY-209: an all-defaults day and an unlogged day agree at 50', () => {
    // The screen chooses between these two by `loggedAt.length > 0`, and they
    // must produce the SAME number — otherwise the ring would visibly jump the
    // moment a user touched any control, before they had told it anything.
    expect(vitalityScore(null)).toBe(NEUTRAL_SCORE);
    expect(vitalityScore(entry())).toBe(NEUTRAL_SCORE);
    expect(parts(entry())).toEqual([50, 50, 50, 50]);
    // …but only the STATUS band is shared. The caption differs, which is what
    // tells the user which of the two states they are looking at (see the
    // screen suite).
    expect(vitalityStatus(vitalityScore(null))).toBe('Room for improvement');
  });

  it('HEALTH-VITALITY-210: a one-field day scores from that field alone', () => {
    // The realistic first interaction: open the tab, tap one segment, leave.
    // Three of the four parts must stay at the neutral 50 so the ring reflects
    // exactly what was said and nothing more.
    const onlyLibido = entry({ libido: 10 });
    expect(parts(onlyLibido)).toEqual([75, 50, 50, 50]);
    expect(vitalityScore(onlyLibido)).toBe(56); // floor(225 / 4) = 56.25 → 56

    const onlyEnergy = entry({ energyLevel: 10 });
    expect(parts(onlyEnergy)).toEqual([50, 50, 100, 50]);
    expect(vitalityScore(onlyEnergy)).toBe(62); // floor(250 / 4) = 62.5 → 62

    // …and a single ISSUE, which is the only single tap that can push the
    // headline DOWN from neutral.
    const onlyIssue = entry({ hadLowDesire: true });
    expect(parts(onlyIssue)).toEqual([35, 50, 50, 50]);
    expect(vitalityScore(onlyIssue)).toBe(46); // floor(185 / 4) = 46.25 → 46
  });

  it('HEALTH-VITALITY-211: every status band is reachable from a real entry', () => {
    // The bands are asserted numerically elsewhere; what is asserted HERE is
    // that each one corresponds to a day someone can actually have. A band no
    // entry can produce is dead copy.
    const band = (over: Partial<VitalityEntry>) => vitalityStatus(vitalityScore(entry(over)));

    expect(band(BEST)).toBe('Peak performance');
    expect(band({ libido: 8, energyLevel: 8, mentalClarity: 8, mood: 8 })).toBe('Good condition');
    expect(band({})).toBe('Room for improvement');
    expect(band(WORST)).toBe('Needs attention');
  });
});
