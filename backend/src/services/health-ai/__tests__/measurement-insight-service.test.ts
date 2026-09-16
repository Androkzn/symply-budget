/**
 * HEALTH-AI — the body-measurement facts and the sentences derived from them
 * (`measurement-insight-service.ts`).
 *
 * `routes/__tests__/health-ai.test.ts` owns the HTTP contract and the grounding
 * guard. This file owns the arithmetic and the copy that comes out of it, which
 * is worth its own suite for one reason: **every sentence this module emits is
 * shown to a person as a statement about their body**, so the cases that matter
 * are the ones where the honest answer is "nothing moved" or "there is nothing
 * to say yet" — the two a summariser is most tempted to paper over.
 *
 * Pure. No AI, no D1.
 */

import { describe, expect, it } from 'vitest';

import { composeInsightSpeech } from '../coach-insights';
import {
  computeMeasurementFacts,
  deterministicObservations,
  factsForGrounding,
  type MeasurementInsightFacts,
} from '../measurement-insight-service';

function row(date: string, values: Record<string, unknown> = {}, unit = 'cm') {
  return { date, unit, ...values };
}

function facts(rows: ReadonlyArray<Record<string, unknown>>): MeasurementInsightFacts {
  const out = computeMeasurementFacts(rows);
  if ('refusal' in out) throw new Error(`unexpected refusal: ${out.refusal}`);
  return out;
}

describe('Symply Health — measurement facts', () => {
  it('HEALTH-AI-440: no rows at all refuses rather than reporting an empty summary', () => {
    expect(computeMeasurementFacts([])).toEqual({ refusal: 'no_measurements' });
  });

  it('HEALTH-AI-441: rows carrying no GIRTH refuse too, rather than summarising nothing', () => {
    // A member who only ever logged body-fat percentage has rows, but not one
    // measurement this module reports on. "You have logged 2 dates covering 0
    // sites" is a sentence no one should be shown.
    const rows = [
      row('2026-06-01', { body_fat_percentage: 21 }),
      row('2026-07-01', { body_fat_percentage: 20 }),
    ];
    expect(computeMeasurementFacts(rows)).toEqual({ refusal: 'no_measurements' });
  });

  it('HEALTH-AI-442: deltas are latest minus first, sign kept, biggest movement first', () => {
    const f = facts([
      row('2026-06-01', { waist: 88, chest: 100, neck: 38 }),
      row('2026-07-01', { waist: 86.6, chest: 101.9, neck: 38 }),
    ]);
    expect(f.window_from).toBe('2026-06-01');
    expect(f.window_to).toBe('2026-07-01');
    expect(f.dates_logged).toBe(2);
    expect(f.sites_logged).toBe(3);
    // chest +1.9 outranks waist −1.4 by magnitude; a loss is not ranked below a
    // gain just for being negative.
    expect(f.changes.map((c) => c.site)).toEqual(['chest', 'waist', 'neck']);
    expect(f.changes[0].delta).toBe(1.9);
    expect(f.changes[1].delta).toBe(-1.4);
    expect(f.changes[2].delta).toBe(0);
  });

  it('HEALTH-AI-443: a site read only once is listed as having no trend, not as unchanged', () => {
    const f = facts([
      row('2026-06-01', { waist: 88 }),
      row('2026-07-01', { waist: 86, hips: 95 }),
    ]);
    expect(f.changes.map((c) => c.site)).toEqual(['waist']);
    expect(f.single_reading_sites).toEqual(['hips']);
    // It still counts as logged — the person did measure it.
    expect(f.sites_logged).toBe(2);
  });

  it('HEALTH-AI-444: MIXED units report no delta at all, for any site', () => {
    // A difference across centimetres and inches is meaningless, and reporting
    // one is worse than reporting none.
    const f = facts([
      row('2026-06-01', { waist: 88 }, 'cm'),
      row('2026-07-01', { waist: 34 }, 'in'),
    ]);
    expect(f.mixed_units).toBe(true);
    expect(f.changes).toEqual([]);
    expect(f.single_reading_sites).toEqual(['waist']);
  });

  it('HEALTH-AI-445: rows arrive newest-first and are walked oldest → newest', () => {
    // `listMeasurements` orders by date DESC. Reading it in that order would
    // flip the sign of every delta the person is shown.
    const f = facts([row('2026-07-01', { waist: 86 }), row('2026-06-01', { waist: 88 })]);
    expect(f.changes[0]).toMatchObject({
      first: 88,
      latest: 86,
      delta: -2,
      from_date: '2026-06-01',
      to_date: '2026-07-01',
    });
  });
});

describe('Symply Health — deterministic observations', () => {
  it('HEALTH-AI-446: an UNCHANGED site says so instead of announcing a change of 0', () => {
    const f = facts([row('2026-06-01', { waist: 88 }), row('2026-07-01', { waist: 88 })]);
    const lines = deterministicObservations(f);
    expect(lines.some((l) => /reads the same now as at your first reading, 88 cm/.test(l))).toBe(
      true
    );
    expect(lines.join(' ')).not.toMatch(/a change of 0/);
  });

  it('HEALTH-AI-447: single-reading sites get their own line, naming every one', () => {
    const f = facts([
      row('2026-06-01', { waist: 88 }),
      row('2026-07-01', { waist: 86, hips: 95, neck: 38 }),
    ]);
    const lines = deterministicObservations(f);
    const single = lines.find((l) => l.includes('no trend yet'));
    expect(single).toBeTruthy();
    expect(single).toContain('hips');
    expect(single).toContain('neck');
  });

  it('HEALTH-AI-448: mixed units explain the missing delta and suppress the no-trend line', () => {
    // With no delta reportable for ANY site, "these have only one reading" would
    // be a second, contradictory explanation for the same absence.
    const f = facts([
      row('2026-06-01', { waist: 88 }, 'cm'),
      row('2026-07-01', { waist: 34 }, 'in'),
    ]);
    const lines = deterministicObservations(f);
    expect(lines.some((l) => /more than one unit/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('no trend yet'))).toBe(false);
  });

  it('HEALTH-AI-449: at most three movements are described, the biggest ones', () => {
    const f = facts([
      row('2026-06-01', { waist: 88, chest: 100, hips: 95, neck: 38, shoulders: 120 }),
      row('2026-07-01', { waist: 80, chest: 104, hips: 96, neck: 38.2, shoulders: 126 }),
    ]);
    const lines = deterministicObservations(f);
    const movement = lines.filter((l) => l.includes('went from'));
    expect(movement).toHaveLength(3);
    expect(movement.join(' ')).toContain('waist'); // −8, the biggest
    expect(movement.join(' ')).toContain('shoulders'); // +6
    expect(movement.join(' ')).not.toContain('neck'); // +0.2, the smallest
  });

  it('HEALTH-AI-450: every deterministic sentence is grounded in the figures it quotes', () => {
    // `composeInsightSpeech` throws on a numeral that is not in the facts, so
    // re-running it over each line is the same guard the model output goes
    // through — the module must not be able to fail its own rule.
    const f = facts([
      row('2026-06-01', { waist: 88, chest: 100 }),
      row('2026-07-01', { waist: 86.6, chest: 100 }),
      row('2026-08-01', { waist: 86.6, chest: 100, hips: 95 }),
    ]);
    const grounding = factsForGrounding(f);
    for (const line of deterministicObservations(f)) {
      expect(() => composeInsightSpeech(line, grounding)).not.toThrow();
    }
  });

  it('HEALTH-AI-451: the grounding set carries the MAGNITUDE of a loss, not only its sign', () => {
    // A model writes "1.4 cm smaller" for a −1.4 delta; without the absolute
    // value in the facts that true sentence would be dropped as ungrounded.
    const f = facts([row('2026-06-01', { waist: 88 }), row('2026-07-01', { waist: 86.6 })]);
    const labels = factsForGrounding(f);
    expect(labels).toContainEqual({ label: 'waist change', value: -1.4, unit: 'cm' });
    expect(labels).toContainEqual({ label: 'waist change size', value: 1.4, unit: 'cm' });
  });
});
