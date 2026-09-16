/**
 * HEALTH-AI — proposals, the payload hash, and the commit contract
 * (`coach-proposals.ts`).
 *
 * The property being defended: **the coach cannot write, and a proposal cannot
 * be committed with numbers the person did not see.** Everything below is a
 * facet of that.
 *
 * `canonicalJson` is scored separately because it is the piece that breaks in
 * production and never in a happy-path test: two encodings of the same proposal
 * that differ only in key ORDER hash differently, so every commit from the
 * client that happened to serialise the other way 409s.
 *
 * Pure. No AI, no D1.
 */

import { describe, expect, it } from 'vitest';

import {
  buildProposal,
  canonicalJson,
  payloadHash,
  PROPOSAL_TTL_MS,
  validateCommit,
  type CoachProposal,
} from '../coach-proposals';

const NOW = new Date('2026-07-25T10:00:00.000Z');
let counter = 0;
const newId = () => `hop_test_${++counter}`;

function build(toolName: string, input: unknown): CoachProposal | null {
  return buildProposal({ toolName, input, originalText: 'test', now: NOW, newId });
}

describe('Symply Health coach — proposals', () => {
  describe('canonicalJson + payloadHash', () => {
    it('HEALTH-AI-030: key ORDER cannot change the hash', () => {
      const a = { kind: 'water', amount_ml: 500 };
      const b = { amount_ml: 500, kind: 'water' };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(payloadHash(a)).toBe(payloadHash(b));
    });

    it('HEALTH-AI-031: nested key order cannot change it either', () => {
      const a = { kind: 'nutrition', meal_type: null, items: [{ food_name: 'Egg', grams: 50 }] };
      const b = { items: [{ grams: 50, food_name: 'Egg' }], meal_type: null, kind: 'nutrition' };
      expect(payloadHash(a)).toBe(payloadHash(b));
    });

    it('HEALTH-AI-032: ARRAY order DOES change it — a list of foods is ordered', () => {
      const a = { items: [{ food_name: 'Egg' }, { food_name: 'Toast' }] };
      const b = { items: [{ food_name: 'Toast' }, { food_name: 'Egg' }] };
      expect(payloadHash(a)).not.toBe(payloadHash(b));
    });

    it('HEALTH-AI-033: any change to a number changes the hash', () => {
      expect(payloadHash({ kind: 'water', amount_ml: 500 })).not.toBe(
        payloadHash({ kind: 'water', amount_ml: 501 })
      );
    });

    it('HEALTH-AI-034: the hash is 8 lowercase hex digits (FNV-1a 32-bit)', () => {
      // The Swift side computes the same digest; a width or case change here
      // 409s every commit from a donor-shaped client.
      expect(payloadHash({ kind: 'water', amount_ml: 500 })).toMatch(/^[0-9a-f]{8}$/);
      expect(payloadHash({})).toMatch(/^[0-9a-f]{8}$/);
    });

    it('HEALTH-AI-035: null and undefined members are distinguished, not conflated', () => {
      // `undefined` is not JSON and is dropped; `null` is a value.
      expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
      expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}');
    });
  });

  describe('buildProposal', () => {
    it('HEALTH-AI-036: water rounds to whole millilitres and carries a live expiry', () => {
      const p = build('prepare_log_water', { amount_ml: 499.6 })!;
      expect(p.normalized_payload).toEqual({ kind: 'water', amount_ml: 500 });
      expect(p.commit_status).toBe('proposed');
      expect(Date.parse(p.expires_at) - NOW.getTime()).toBe(PROPOSAL_TTL_MS);
      expect(p.payload_hash).toBe(payloadHash(p.normalized_payload));
    });

    it('HEALTH-AI-037: an out-of-range figure produces NO proposal at all', () => {
      // Refusing here rather than at commit time is the point: a card offering
      // to log something the server will reject is worse than no card.
      expect(build('prepare_log_water', { amount_ml: 0 })).toBeNull();
      expect(build('prepare_log_water', { amount_ml: 99999 })).toBeNull();
      expect(build('prepare_log_weight', { weight: 4, unit: 'kg' })).toBeNull();
      expect(build('prepare_log_weight', { weight: 900, unit: 'kg' })).toBeNull();
    });

    it('HEALTH-AI-038: weight keeps the unit the person used and is never converted', () => {
      const kg = build('prepare_log_weight', { weight: 82.44, unit: 'kg' })!;
      const lb = build('prepare_log_weight', { weight: 181.8, unit: 'lb' })!;
      expect(kg.normalized_payload).toEqual({ kind: 'weight', weight: 82.44, unit: 'kg' });
      expect(lb.normalized_payload).toEqual({ kind: 'weight', weight: 181.8, unit: 'lb' });
    });

    it('HEALTH-AI-039: an unknown unit is refused rather than defaulted to kg', () => {
      expect(build('prepare_log_weight', { weight: 82, unit: 'stone' })).toBeNull();
      expect(build('prepare_log_weight', { weight: 82 })).toBeNull();
    });

    it('HEALTH-AI-040: a meal keeps null macros as null — never zero', () => {
      // Zero calories is a claim; null is "the coach did not know", which is
      // what the prompt asks it to answer when it has no reliable figure.
      const p = build('prepare_log_meal', {
        items: [{ food_name: 'Soup', grams: 300 }],
      })!;
      expect(p.normalized_payload).toEqual({
        kind: 'nutrition',
        meal_type: null,
        items: [
          { food_name: 'Soup', grams: 300, calories: null, protein_g: null, carbs_g: null, fat_g: null },
        ],
      });
    });

    it('HEALTH-AI-041: an empty or nameless meal produces no proposal', () => {
      expect(build('prepare_log_meal', { items: [] })).toBeNull();
      expect(build('prepare_log_meal', { items: [{ food_name: '   ' }] })).toBeNull();
      expect(build('prepare_log_meal', {})).toBeNull();
    });

    it('HEALTH-AI-042: an unknown tool name never becomes a proposal', () => {
      expect(build('prepare_log_blood_pressure', { systolic: 120 })).toBeNull();
      expect(build('delete_everything', {})).toBeNull();
    });

    it('HEALTH-AI-043: a meal is capped at ten items', () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ food_name: `Food ${i}` }));
      const p = build('prepare_log_meal', { items })!;
      expect((p.normalized_payload as { items: unknown[] }).items).toHaveLength(10);
    });
  });

  describe('validateCommit', () => {
    const proposal = build('prepare_log_water', { amount_ml: 500 })!;

    it('HEALTH-AI-044: the happy path passes with the hash the person was shown', () => {
      const out = validateCommit({
        proposal,
        confirmedHash: proposal.payload_hash,
        now: NOW,
      });
      expect(out.ok).toBe(true);
    });

    it('HEALTH-AI-045: a TAMPERED payload is refused even with a matching echo', () => {
      // The attack this closes: change the numbers, keep the hash field, echo it
      // back. Re-hashing the payload we were handed is what catches it.
      const tampered = {
        ...proposal,
        normalized_payload: { kind: 'water', amount_ml: 4000 },
      };
      const out = validateCommit({
        proposal: tampered,
        confirmedHash: proposal.payload_hash,
        now: NOW,
      });
      expect(out).toEqual({ ok: false, reason: 'payload_hash_mismatch' });
    });

    it('HEALTH-AI-046: a payload the client never confirmed is refused', () => {
      const out = validateCommit({ proposal, confirmedHash: 'deadbeef', now: NOW });
      expect(out).toEqual({ ok: false, reason: 'payload_hash_mismatch' });
    });

    it('HEALTH-AI-047: an expired proposal is refused', () => {
      const later = new Date(NOW.getTime() + PROPOSAL_TTL_MS + 1000);
      const out = validateCommit({
        proposal,
        confirmedHash: proposal.payload_hash,
        now: later,
      });
      expect(out).toEqual({ ok: false, reason: 'proposal_expired' });
    });

    it('HEALTH-AI-048: tampering is reported as tampering even when also stale', () => {
      // Order matters: "expired" would let a tampered payload look like a
      // harmless timing problem.
      const later = new Date(NOW.getTime() + PROPOSAL_TTL_MS + 1000);
      const tampered = {
        ...proposal,
        normalized_payload: { kind: 'water', amount_ml: 4000 },
      };
      const out = validateCommit({
        proposal: tampered,
        confirmedHash: proposal.payload_hash,
        now: later,
      });
      expect(out).toEqual({ ok: false, reason: 'payload_hash_mismatch' });
    });

    it('HEALTH-AI-049: a payload whose kind disagrees with target_type is refused', () => {
      const mismatched = { ...proposal, target_type: 'weight' as const };
      const out = validateCommit({
        proposal: mismatched,
        confirmedHash: proposal.payload_hash,
        now: NOW,
      });
      expect(out).toEqual({ ok: false, reason: 'invalid_proposal' });
    });

    it('HEALTH-AI-050: garbage in every shape is refused, never thrown', () => {
      for (const bad of [null, undefined, 'proposal', 42, {}, { operation_id: '' }]) {
        const out = validateCommit({ proposal: bad, confirmedHash: 'x', now: NOW });
        expect(out.ok).toBe(false);
      }
    });

    it('HEALTH-AI-406: a target_type outside the three domains is refused before anything is read', () => {
      // `health_coach_operations.target_type` is one of water/weight/nutrition.
      // A fourth would reach `writeDomain`, whose final branch assumes
      // nutrition, and log an unrelated payload as a meal.
      for (const targetType of ['blood_pressure', 'steps', '', null, 42]) {
        const out = validateCommit({
          proposal: { ...proposal, target_type: targetType },
          confirmedHash: proposal.payload_hash,
          now: NOW,
        });
        expect(out, String(targetType)).toEqual({ ok: false, reason: 'invalid_proposal' });
      }
    });

    it('HEALTH-AI-407: a non-string hash or expiry is refused rather than compared', () => {
      // `Date.parse(undefined)` is NaN and `payloadHash(x) !== 123` is always
      // true, so both would "work" — as a refusal with the wrong reason, or as
      // an expiry check that silently never passes.
      for (const over of [
        { payload_hash: 123 },
        { payload_hash: null },
        { expires_at: 0 },
        { expires_at: null },
      ]) {
        const out = validateCommit({
          proposal: { ...proposal, ...over },
          confirmedHash: proposal.payload_hash,
          now: NOW,
        });
        expect(out, JSON.stringify(over)).toEqual({ ok: false, reason: 'invalid_proposal' });
      }
    });

    /* ------------- the hash is a checksum, not a signature ------------- */

    /**
     * `payload_hash` is FNV-1a over a public encoding, so a caller can mint one
     * for any payload it likes — the module header says so. Everything the
     * commit path then writes therefore has to be re-derived rather than
     * trusted. These are the payloads a real proposal could never have carried.
     */
    function forge(payload: unknown, targetType: string) {
      return {
        ...proposal,
        target_type: targetType,
        normalized_payload: payload,
        payload_hash: payloadHash(payload),
      };
    }

    function commitForged(payload: unknown, targetType: string) {
      const p = forge(payload, targetType);
      return validateCommit({ proposal: p, confirmedHash: p.payload_hash, now: NOW });
    }

    it('HEALTH-AI-400: a self-hashed OUT-OF-RANGE volume is refused, not stored', () => {
      // Without the re-derivation this passed every check and wrote 1e12 ml
      // straight into `water_entries`, through a path whose own zod cap is
      // 10 000 — the daily summary then reports a number no glass could hold.
      expect(commitForged({ kind: 'water', amount_ml: 1e12 }, 'water')).toEqual({
        ok: false,
        reason: 'invalid_proposal',
      });
      expect(commitForged({ kind: 'water', amount_ml: -250 }, 'water')).toEqual({
        ok: false,
        reason: 'invalid_proposal',
      });
    });

    it('HEALTH-AI-401: a self-hashed non-numeric figure is refused rather than written as text', () => {
      // SQLite is dynamically typed, so a string in a REAL column is STORED as
      // text — and the next `total + amount_ml` concatenates instead of adding.
      expect(commitForged({ kind: 'water', amount_ml: '250' }, 'water')).toEqual({
        ok: false,
        reason: 'invalid_proposal',
      });
      expect(commitForged({ kind: 'weight', weight: '80', unit: 'kg' }, 'weight')).toEqual({
        ok: false,
        reason: 'invalid_proposal',
      });
    });

    it('HEALTH-AI-402: a unit no column accepts is a 400-shaped refusal, never a constraint 500', () => {
      // `weight_entries.unit` is CHECK-constrained to kg/lb/lbs. Handing the
      // insert 'stone' would throw out of the service and surface as a 500.
      expect(commitForged({ kind: 'weight', weight: 80, unit: 'stone' }, 'weight')).toEqual({
        ok: false,
        reason: 'invalid_proposal',
      });
    });

    it('HEALTH-AI-403: a meal whose items are not a list is refused rather than iterated', () => {
      expect(commitForged({ kind: 'nutrition', meal_type: null, items: 'egg' }, 'nutrition')).toEqual(
        { ok: false, reason: 'invalid_proposal' }
      );
      expect(commitForged({ kind: 'nutrition', meal_type: null, items: [] }, 'nutrition')).toEqual({
        ok: false,
        reason: 'invalid_proposal',
      });
    });

    it('HEALTH-AI-404: a meal slot outside the four the column allows is refused', () => {
      const forged = commitForged(
        {
          kind: 'nutrition',
          meal_type: 'brunch',
          items: [
            { food_name: 'Eggs', grams: null, calories: 200, protein_g: null, carbs_g: null, fat_g: null },
          ],
        },
        'nutrition'
      );
      expect(forged).toEqual({ ok: false, reason: 'invalid_proposal' });
    });

    it('HEALTH-AI-405: a genuine proposal survives re-derivation unchanged', () => {
      // The guard must not cost a real commit. Every kind round-trips to itself.
      for (const p of [
        build('prepare_log_water', { amount_ml: 500 })!,
        build('prepare_log_weight', { weight: 82.44, unit: 'kg' })!,
        build('prepare_log_meal', {
          meal_type: 'lunch',
          items: [{ food_name: 'Soup', grams: 300, calories: 210 }],
        })!,
      ]) {
        const out = validateCommit({ proposal: p, confirmedHash: p.payload_hash, now: NOW });
        expect(out.ok).toBe(true);
        // And the payload handed on is the re-derived one, equal to the original.
        expect((out as { proposal: CoachProposal }).proposal.normalized_payload).toEqual(
          p.normalized_payload
        );
      }
    });

    /**
     * The three verbs added after the first release. Everything above proves
     * the re-derivation for water/weight/nutrition; this closes the same proof
     * for `workout`, `period` and `habit` — the exact class of gap the module
     * header calls out by name ("a `workout` payload that reached `writeDomain`
     * without being re-derived could carry 100000 minutes or a 40-megabyte
     * note"). `COMMITTABLE_TARGETS` and `renormalizePayload` are private to this
     * module, so `validateCommit` is the only seam that can prove they actually
     * cover the three added kinds rather than merely declaring them in a type.
     */
    it('HEALTH-AI-408: a self-hashed WORKOUT with an out-of-range figure is refused, not stored', () => {
      // Mirrors HEALTH-AI-400 for the verb the module header names directly:
      // `POST /health/entries/workouts` caps minutes at 1440 and calories at
      // 5000. A client that hashes its own forgery must not buy past either.
      expect(
        commitForged(
          {
            kind: 'workout',
            workout_type: 'Running',
            minutes: 100000,
            calories: null,
            note: null,
            intensity: null,
          },
          'workout'
        )
      ).toEqual({ ok: false, reason: 'invalid_proposal' });

      expect(
        commitForged(
          {
            kind: 'workout',
            workout_type: 'Running',
            minutes: 30,
            calories: 99999,
            note: null,
            intensity: null,
          },
          'workout'
        )
      ).toEqual({ ok: false, reason: 'invalid_proposal' });

      // An intensity outside the 0124 enum is exactly as forgeable as a bad unit
      // was for weight (HEALTH-AI-402) — a value no column accepts must not
      // reach the insert as a constraint 500.
      expect(
        commitForged(
          {
            kind: 'workout',
            workout_type: 'Running',
            minutes: 30,
            calories: null,
            note: null,
            intensity: 'brutal',
          },
          'workout'
        )
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
    });

    it('HEALTH-AI-409: a self-hashed PERIOD day outside the 1-5 flow scale is refused', () => {
      // `POST /health/cycle/periods` accepts flow_level 1-5. A forged 9 would
      // otherwise land as a claim about the person's body nobody made.
      expect(
        commitForged({ kind: 'period', flow_level: 9, notes: null }, 'period')
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
      expect(
        commitForged({ kind: 'period', flow_level: 0, notes: null }, 'period')
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
      // A non-numeric flow is exactly the "stored as text" hole HEALTH-AI-401
      // closes for water/weight.
      expect(
        commitForged({ kind: 'period', flow_level: '3', notes: null }, 'period')
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
    });

    it('HEALTH-AI-410: a self-hashed HABIT with an empty id or an over-length name is refused', () => {
      // `prepare_log_habit` requires a non-empty id and caps the name at 60 —
      // the same bounds `POST /health/habits` enforces. A forged empty id would
      // otherwise sail through `writeDomain`'s `habits.find` as "not found" at
      // best, or match by coincidence at worst; refusing it here is cheaper and
      // earlier than either.
      expect(
        commitForged({ kind: 'habit', habit_id: '', habit_name: 'Meditate' }, 'habit')
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
      expect(
        commitForged(
          { kind: 'habit', habit_id: 'habit_med', habit_name: 'x'.repeat(61) },
          'habit'
        )
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
      // An id over the `newId('habit')` length ceiling is equally forgeable.
      expect(
        commitForged(
          { kind: 'habit', habit_id: 'x'.repeat(65), habit_name: 'Meditate' },
          'habit'
        )
      ).toEqual({ ok: false, reason: 'invalid_proposal' });
    });

    it('HEALTH-AI-411: a genuine workout, period and habit proposal survives re-derivation unchanged', () => {
      // The counterpart of HEALTH-AI-405 for the three added verbs — the guard
      // must not cost a real commit for these either.
      for (const p of [
        build('prepare_log_workout', { workout_type: 'Running', minutes: 32, calories: 310 })!,
        build('prepare_log_period_day', { flow_level: 3, notes: 'cramping' })!,
        build('prepare_log_habit', { habit_id: 'habit_med', habit_name: 'Meditate' })!,
      ]) {
        const out = validateCommit({ proposal: p, confirmedHash: p.payload_hash, now: NOW });
        expect(out.ok).toBe(true);
        expect((out as { proposal: CoachProposal }).proposal.normalized_payload).toEqual(
          p.normalized_payload
        );
      }
    });
  });
});
