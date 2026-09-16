/**
 * HEALTH-AI — grounded daily insights (`coach-insights.ts`).
 *
 * The load-bearing property is `composeInsightSpeech`: a sentence containing a
 * number that is not in the insight's own `facts` cannot be emitted at all. That
 * is the mechanical half of the coach's grounding rule — the prompt asks the
 * model not to invent figures, this makes the deterministic path incapable of it
 * — so it is scored in both directions.
 *
 * The second property scored here is the one the donor's own caveat states:
 * **missing data is UNKNOWN, never zero.** A person who did not open the app did
 * not eat nothing, and an insight that says "you logged 0 kcal" about that day
 * is a lie made of true arithmetic.
 *
 * No AI, no D1.
 */

import { describe, expect, it } from 'vitest';

import {
  composeInsightSpeech,
  computeGroundedInsights,
  type InsightFact,
  type InsightInputs,
} from '../coach-insights';

const WINDOW = { start: '2026-07-25T00:00:00.000Z', end: '2026-07-25T23:59:59.999Z' };

function inputs(over: Partial<InsightInputs> = {}): InsightInputs {
  return {
    freshness: 'fresh',
    consent_insights: true,
    window: WINDOW,
    ...over,
  };
}

describe('Symply Health coach — grounded insights', () => {
  describe('composeInsightSpeech', () => {
    const facts: InsightFact[] = [
      { label: 'Logged', value: 1850, unit: 'kcal' },
      { label: 'Goal', value: 2100, unit: 'kcal' },
      { label: 'Remaining', value: 250, unit: 'kcal' },
    ];

    it('HEALTH-AI-010: passes a sentence whose every numeral is a fact', () => {
      expect(
        composeInsightSpeech('You logged 1850 kcal against a goal of 2100, 250 under.', facts)
      ).toContain('1850');
    });

    it('HEALTH-AI-011: REFUSES a sentence containing a number no fact holds', () => {
      // 12% is the classic hallucination: plausible, derived, and ungrounded.
      expect(() => composeInsightSpeech('You are 12 percent under your goal.', facts)).toThrow(
        'ungrounded_number:12'
      );
    });

    it('HEALTH-AI-012: a thousands separator still matches the bare fact', () => {
      // "1,850" and a fact of 1850 are the same number; a naive matcher would
      // split it into 1 and 850 and refuse a correct sentence.
      expect(composeInsightSpeech('You logged 1,850 kcal.', facts)).toContain('1,850');
    });

    it('HEALTH-AI-013: a sentence with no numbers at all is always allowed', () => {
      expect(composeInsightSpeech('You have not logged anything yet today.', [])).toBeTruthy();
    });
  });

  describe('computeGroundedInsights', () => {
    it('HEALTH-AI-014: no consent produces exactly one suppressed insight and no figures', () => {
      const out = computeGroundedInsights(
        inputs({ consent_insights: false, today_calories: 1850, calorie_goal: 2100 })
      );
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe('suppressed');
      // The figures must not leak through the suppression.
      expect(out[0].facts).toEqual([]);
      expect(out[0].speakable).not.toMatch(/\d/);
    });

    it('HEALTH-AI-015: missing freshness says UNKNOWN and never prints a zero', () => {
      const out = computeGroundedInsights(inputs({ freshness: 'missing' }));
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe('unknown_data');
      expect(out[0].caveats.join(' ')).toMatch(/not zero/i);
      expect(out[0].speakable).not.toMatch(/\b0\b/);
    });

    it('HEALTH-AI-016: an all-null day is unknown_data, not three zeroes', () => {
      const out = computeGroundedInsights(inputs());
      expect(out.map((i) => i.kind)).toEqual(['unknown_data']);
    });

    it('HEALTH-AI-017: calories under goal state logged, goal and the gap', () => {
      const out = computeGroundedInsights(
        inputs({ today_calories: 1850, calorie_goal: 2100 })
      );
      const calories = out.find((i) => i.kind === 'calories')!;
      expect(calories.facts.map((f) => f.value)).toEqual([1850, 2100, 250]);
      expect(calories.speakable).toContain('250');
      expect(calories.speakable).toContain('under');
    });

    it('HEALTH-AI-018: over goal is named as over, not as a negative remainder', () => {
      const out = computeGroundedInsights(
        inputs({ today_calories: 2400, calorie_goal: 2100 })
      );
      const calories = out.find((i) => i.kind === 'calories')!;
      expect(calories.speakable).toContain('300 over');
      expect(calories.speakable).not.toContain('-300');
      expect(calories.facts.find((f) => f.label === 'Over')?.value).toBe(300);
    });

    it('HEALTH-AI-019: a figure with no goal is still reported, and says so', () => {
      const out = computeGroundedInsights(inputs({ today_water_ml: 1200 }));
      const water = out.find((i) => i.kind === 'water')!;
      expect(water.speakable).toContain('1200');
      expect(water.caveats.join(' ')).toMatch(/no water target/i);
    });

    it('HEALTH-AI-020: insights come back in priority order — calories, protein, water', () => {
      const out = computeGroundedInsights(
        inputs({
          today_calories: 1850,
          calorie_goal: 2100,
          today_protein_g: 90,
          protein_goal_g: 130,
          today_water_ml: 1200,
          water_goal_ml: 2500,
        })
      );
      expect(out.map((i) => i.kind)).toEqual(['calories', 'protein', 'water']);
    });

    it('HEALTH-AI-021: a stale window says so, on every insight it produced', () => {
      const out = computeGroundedInsights(
        inputs({ freshness: 'stale', today_calories: 1850, calorie_goal: 2100 })
      );
      expect(out[0].caveats.join(' ')).toMatch(/older sync/i);
    });

    it('HEALTH-AI-452: a PARTIAL window gets its own caveat, not the stale one', () => {
      // `stale` and `partial` are different claims — "this is behind" versus
      // "some of today is missing" — and a reader acts on them differently.
      // `HealthCoachService.freshnessOf` only emits fresh/missing today, so this
      // arm is reachable only through the pure function; it stays because the
      // input type declares the state and a caller may legitimately pass it.
      const out = computeGroundedInsights(
        inputs({ freshness: 'partial', today_calories: 1850, calorie_goal: 2100 })
      );
      expect(out[0].caveats.join(' ')).toMatch(/may not have synced/i);
      expect(out[0].caveats.join(' ')).not.toMatch(/older sync/i);
    });

    it('HEALTH-AI-022: every emitted sentence is grounded in its own facts', () => {
      // The guarantee end-to-end: re-running the composer over each result must
      // not throw for any input combination the module can produce.
      const combos: InsightInputs[] = [
        inputs({ today_calories: 1850, calorie_goal: 2100 }),
        inputs({ today_calories: 2400, calorie_goal: 2100 }),
        inputs({ today_calories: 1850 }),
        inputs({ today_protein_g: 90, protein_goal_g: 130 }),
        inputs({ today_protein_g: 140, protein_goal_g: 130 }),
        inputs({ today_protein_g: 90 }),
        inputs({ today_water_ml: 1200, water_goal_ml: 2500 }),
        inputs({ today_water_ml: 2600, water_goal_ml: 2500 }),
        inputs({ today_water_ml: 1200 }),
      ];
      for (const combo of combos) {
        for (const insight of computeGroundedInsights(combo)) {
          expect(() => composeInsightSpeech(insight.speakable, insight.facts)).not.toThrow();
        }
      }
    });

    it('HEALTH-AI-023: fractional logged figures are rounded before they are spoken', () => {
      // Raw sums carry float noise (1849.9999996); a coach that reads that out
      // is not wrong, it is unreadable.
      const out = computeGroundedInsights(
        inputs({ today_calories: 1849.9999996, calorie_goal: 2100 })
      );
      expect(out[0].speakable).toContain('1850');
      expect(out[0].speakable).not.toMatch(/\d\.\d/);
    });
  });
});
