/**
 * HEALTH-AI — the deterministic medical-escalation matcher (`coach-safety.ts`).
 *
 * This is the whole clinical-safety layer of the coach, so it is tested as a
 * SAFETY surface rather than as a function: both directions are scored, because
 * both failures are real. A miss sends someone describing chest pain to a
 * language model; a false positive replaces a legitimate answer with an
 * emergency notice and teaches the person to ignore it.
 *
 * No AI is involved anywhere in this file, by design — that is the point of the
 * module. Pure, I/O-free, no D1.
 */

import { describe, expect, it } from 'vitest';

import {
  ESCALATION_CATEGORIES,
  matchEscalation,
  type EscalationCategory,
} from '../coach-safety';

/** One phrase per category, in the register a person actually types. */
const HITS: Array<{ category: EscalationCategory; text: string }> = [
  { category: 'suicide_self_harm', text: 'i want to die, nothing helps' },
  { category: 'suicide_self_harm', text: 'I have been cutting myself again' },
  { category: 'immediate_danger', text: 'someone is hurting me right now' },
  { category: 'chest_pain', text: 'I have chest pain after my run' },
  { category: 'chest_pain', text: 'is this a heart attack' },
  { category: 'stroke_signs', text: 'my face is drooping and I have slurred speech' },
  { category: 'breathing_difficulty', text: "I can't breathe properly today" },
  { category: 'anaphylaxis', text: 'my throat is closing after eating peanuts' },
  { category: 'severe_bleeding', text: 'the cut wont stop bleeding' },
  { category: 'poisoning_overdose', text: 'I think I swallowed bleach' },
  { category: 'medication_overdose', text: 'I took too many pills by mistake' },
  { category: 'severe_glucose', text: 'I think this is hypoglycemia' },
  { category: 'pregnancy_red_flag', text: 'I am bleeding while pregnant' },
];

/**
 * Ordinary coach traffic. Several of these are near-misses on purpose — they
 * contain a word from a pattern in a harmless context, which is exactly what a
 * bare substring match would trip on.
 */
const MISSES: string[] = [
  'log 500 ml of water',
  'I weighed 82.4 kg this morning',
  'how much protein have I had today',
  'my chest workout was hard, my chest muscles are sore',
  'I am dying to know how many calories I have left',
  'I ate a whole box of pills-shaped candy',
  'add 200 g chicken breast to lunch',
  'the gym was so hot I could barely breathe at the end of the set',
  'my sugar intake was high yesterday',
  'I want to cut my calories a bit',
];

describe('Symply Health coach — medical escalation', () => {
  it('HEALTH-AI-001: every category is reachable from a phrase a person would type', () => {
    const seen = new Set<EscalationCategory>();
    for (const { category, text } of HITS) {
      const match = matchEscalation(text);
      expect(match, `no escalation for: ${text}`).not.toBeNull();
      seen.add(match!.category);
      expect(match!.category).toBe(category);
    }
    // An orphaned rule is a rule nobody has read since it was written.
    expect([...seen].sort()).toEqual([...new Set(ESCALATION_CATEGORIES)].sort());
  });

  it('HEALTH-AI-002: ordinary logging and fitness talk never escalates', () => {
    for (const text of MISSES) {
      expect(matchEscalation(text), `false escalation for: ${text}`).toBeNull();
    }
  });

  it('HEALTH-AI-003: every message says help was NOT contacted, in the copy and in the flag', () => {
    for (const { text } of HITS) {
      const match = matchEscalation(text)!;
      expect(match.claims_help_contacted).toBe(false);
      expect(match.collect_location).toBe(false);
      // The sentence matters as much as the flag: an app that leaves someone
      // believing help is on the way is worse than one that says nothing.
      expect(match.message).toMatch(/I (cannot|have not) (reach|call|contact)/i);
    }
  });

  it('HEALTH-AI-004: no message diagnoses, prescribes, or names a treatment', () => {
    // The donor's sibling endpoints claim osteopathy expertise and write a
    // "Clinical summary". Nothing this layer says may do the same. Each message
    // states a REASON TO SEEK CARE ("chest pain can be serious"), which is not a
    // finding, and never tells anyone what is wrong with them or what to take.
    // `you have (?!been)` is the load-bearing clause: it blocks "you have
    // angina" while allowing the anaphylaxis line's "if you have been
    // prescribed one", which refers to a prescription someone else wrote. See
    // the next case.
    const forbidden =
      /(\byou (?:have|are having|appear to) (?!been\b))|(\bthis is (?:a|an)\b)|(\bdiagnos)|(\bdosage\b)|(\bmilligrams?\b)|(\d+\s*mg\b)|(\bRICE\b)|(\bice it\b)|(\brest it\b)/i;
    for (const { text } of HITS) {
      expect(matchEscalation(text)!.message, text).not.toMatch(forbidden);
    }
  });

  it('HEALTH-AI-005: the one medication sentence points at an EXISTING prescription', () => {
    // Anaphylaxis is the single category where naming a medication is right —
    // an adrenaline auto-injector is the difference between outcomes, and the
    // donor says the same. The wording is deliberately conditional and refers
    // to something a clinician already prescribed: it does NOT prescribe, does
    // not name a drug, and does not give a dose. Pinned so a well-meaning edit
    // cannot turn it into instructions.
    const anaphylaxis = matchEscalation('my throat is closing after eating peanuts')!;
    expect(anaphylaxis.category).toBe('anaphylaxis');
    expect(anaphylaxis.message).toContain('if you have been prescribed one');
    expect(anaphylaxis.message).not.toMatch(/\b(epinephrine|adrenaline|epipen|inject|\d+\s*mg)\b/i);
  });

  it('HEALTH-AI-006: the first matching rule wins, most acute first', () => {
    // Self-harm outranks the medication reading of the same sentence.
    const both = matchEscalation('I took too many pills because I want to die');
    expect(both?.category).toBe('suicide_self_harm');
  });

  it('HEALTH-AI-007: empty, null and undefined input never escalate', () => {
    expect(matchEscalation('')).toBeNull();
    expect(matchEscalation(null)).toBeNull();
    expect(matchEscalation(undefined)).toBeNull();
  });

  it('HEALTH-AI-008: matching is case-insensitive', () => {
    expect(matchEscalation('CHEST PAIN')?.category).toBe('chest_pain');
    expect(matchEscalation('Chest Pain')?.category).toBe('chest_pain');
  });
});
