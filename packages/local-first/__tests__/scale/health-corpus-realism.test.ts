/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * Every Health phase rests on claims about the corpus that are easy to break
 * silently and expensive to notice later. A corpus that quietly became
 * one-weigh-in-a-day, or single-device, or whose `health_entries` stopped
 * carrying all three `entry_type`s, would still produce a full baseline — of
 * the wrong thing.
 *
 * "Realism matters more than volume" is the stage's instruction, so each `it`
 * here is one realism claim, asserted against the DECLARED day model rather
 * than against a hand-copied constant.
 */
import { describe, expect, it } from 'vitest';

import { utf8Decode } from '../../src/crypto/bytes';

import { enableDevAssertions } from './lib/dev-global';
import {
  CORPUS_END_DATE,
  HEALTH_DAY_MODEL,
  HEALTH_DEFAULT_SEED,
  daysFor,
  generateHealthLedger,
  habitCountFor,
} from './lib/health-ledger-factory';
import {
  authorsFor,
  checkpointTail,
  generateHealthOps,
  makeReferenceOpPayload,
  versionVectorFor,
} from './lib/health-oplog-factory';
import { pseudoBytes } from './lib/oplog-factory';

enableDevAssertions();

const YEARS = 3;
const SPEC = { years: YEARS, adults: 1, seed: HEALTH_DEFAULT_SEED };
const DAYS = daysFor(YEARS);
const HDK = pseudoBytes(32, 0xb0b);

const ledger = generateHealthLedger(SPEC);

function countByDate(rows: Array<Record<string, unknown>>): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const date = String(row.date);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  return byDate;
}

describe('health corpus — the diary is a DIARY', () => {
  it('ends on the pinned day, so every window lands on the same density', () => {
    const dates = ledger.waterEntries.map((row) => String(row.date)).sort();
    expect(dates[dates.length - 1]).toBe(CORPUS_END_DATE);
    // …and spans the requested number of days.
    const unique = new Set(dates);
    expect(unique.size).toBeGreaterThan(DAYS * 0.9);
  });

  it('weighs in on most days, and MORE THAN ONCE on some of them', () => {
    const byDate = countByDate(ledger.weightEntries);
    const multi = [...byDate.values()].filter((n) => n >= 2).length;
    // The flagship S3a case: a `weight_${date}` id builder would LWW the
    // evening reading away, which is why `weightEntries` is in
    // HEALTH_RANDOM_ID_TABLES. A corpus without multi-weigh-in days cannot
    // exercise it.
    expect(multi).toBeGreaterThan(DAYS * 0.1);
    expect(byDate.size).toBeGreaterThan(DAYS * (1 - HEALTH_DAY_MODEL.weight.skip - 0.05));
    expect(ledger.weightEntries.length / DAYS).toBeGreaterThan(1);
    expect(ledger.weightEntries.length / DAYS).toBeLessThan(1.3);
  });

  it('gives every weigh-in a RANDOM id — no natural key (S3a)', () => {
    const byDate = countByDate(ledger.weightEntries);
    const twice = [...byDate.entries()].find(([, n]) => n >= 2);
    expect(twice).toBeDefined();
    const sameDay = ledger.weightEntries.filter((row) => row.date === twice![0]);
    const ids = new Set(sameDay.map((row) => String(row.id)));
    expect(ids.size).toBe(sameDay.length);
    for (const id of ids) expect(id).not.toContain(String(twice![0]));
  });

  it('logs 4-6 water entries on a logged day', () => {
    const byDate = countByDate(ledger.waterEntries);
    for (const n of byDate.values()) {
      expect(n).toBeGreaterThanOrEqual(HEALTH_DAY_MODEL.water.min);
      expect(n).toBeLessThanOrEqual(HEALTH_DAY_MODEL.water.min + HEALTH_DAY_MODEL.water.span - 1);
    }
    expect(byDate.size).toBeGreaterThan(DAYS * 0.9);
  });

  it('logs 3-5 nutrition entries on a logged day, across real meal slots', () => {
    const byDate = countByDate(ledger.nutritionEntries);
    for (const n of byDate.values()) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    const slots = new Set(ledger.nutritionEntries.map((row) => String(row.meal_type)));
    expect([...slots].sort()).toEqual(['breakfast', 'dinner', 'lunch', 'snack']);
  });

  it('carries steps, sleep AND workouts in `health_entries`, each with parseable `data`', () => {
    const types = new Map<string, number>();
    for (const row of ledger.healthEntries) {
      types.set(String(row.entry_type), (types.get(String(row.entry_type)) ?? 0) + 1);
      expect(() => JSON.parse(String(row.data))).not.toThrow();
    }
    expect([...types.keys()].sort()).toEqual(['sleep', 'steps', 'workout']);
    // One steps row per day, sleep most nights, workouts a majority of days.
    expect(types.get('steps')).toBe(DAYS);
    expect(types.get('sleep')! / DAYS).toBeGreaterThan(0.9);
    expect(types.get('workout')! / DAYS).toBeGreaterThan(0.4);
    expect(types.get('workout')! / DAYS).toBeLessThan(0.8);
  });

  it('keeps body measurements SPARSE — in time and in populated sites', () => {
    expect(ledger.bodyMeasurements.length / DAYS).toBeLessThan(0.1);
    expect(ledger.bodyMeasurements.length / DAYS).toBeGreaterThan(0.03);
    for (const row of ledger.bodyMeasurements) {
      const numeric = Object.values(row).filter((v) => typeof v === 'number').length;
      // 8-14 girth sites plus body_fat_percentage — never all 41.
      expect(numeric).toBeGreaterThanOrEqual(9);
      expect(numeric).toBeLessThanOrEqual(16);
    }
  });

  it('keeps 8 habits live at a time, retiring the old ones', () => {
    expect(ledger.userHabits.length).toBe(habitCountFor(YEARS));
    const live = ledger.userHabits.filter((row) => row.is_archived === 0);
    expect(live.length).toBe(HEALTH_DAY_MODEL.habits.concurrent);
    expect(ledger.userHabits.length).toBeGreaterThanOrEqual(HEALTH_DAY_MODEL.habits.concurrent);
  });

  it('logs habits near-daily and keys each log DETERMINISTICALLY (S3b)', () => {
    const perDay = ledger.habitLogs.length / DAYS;
    expect(perDay).toBeGreaterThan(4);
    expect(perDay).toBeLessThanOrEqual(HEALTH_DAY_MODEL.habits.concurrent);
    const seen = new Set<string>();
    for (const row of ledger.habitLogs) {
      // `unique(habit_id, date)` — schema.ts HEALTH_DETERMINISTIC_ID_TABLES.
      expect(String(row.id)).toBe(`hlg_${String(row.habit_id)}_${String(row.date)}`);
      const natural = `${String(row.habit_id)}|${String(row.date)}`;
      expect(seen.has(natural)).toBe(false);
      seen.add(natural);
    }
  });

  it('changes goals a few times a year, keyed on (user, effective_date)', () => {
    expect(ledger.healthGoals.length).toBe(1 + HEALTH_DAY_MODEL.goals.perYear * YEARS);
    const dates = new Set<string>();
    for (const row of ledger.healthGoals) {
      expect(String(row.id)).toBe(`hgl_${String(row.user_id)}_${String(row.effective_date)}`);
      dates.add(String(row.effective_date));
    }
    expect(dates.size).toBe(ledger.healthGoals.length);
  });
});

describe('health corpus — the op log is ONE USER on TWO DEVICES', () => {
  const ops = generateHealthOps({
    ledger,
    count: 600,
    hdk: HDK,
    householdId: String(ledger.household.id),
    seed: SPEC.seed,
  });

  it('attributes every op to the same member but different devices', () => {
    expect(new Set(ops.map((op) => op.authorMemberId)).size).toBe(1);
    expect(new Set(ops.map((op) => op.deviceId)).size).toBe(2);
  });

  it('counts seq PER DEVICE, which is what the store does', () => {
    const bySeq = new Map<string, number[]>();
    for (const op of ops) {
      const list = bySeq.get(op.deviceId);
      if (list) list.push(op.seq);
      else bySeq.set(op.deviceId, [op.seq]);
    }
    for (const seqs of bySeq.values()) {
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    }
  });

  it('leaves the log INTERLEAVED — the second device is 30 days behind', () => {
    const lagging = authorsFor(ledger).find((a) => a.lagMs !== 0);
    expect(lagging).toBeDefined();
    const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));
    // A monotonic log would be identical when sorted; this one must not be.
    expect(sorted.map((op) => op.opId)).not.toEqual(ops.map((op) => op.opId));
  });

  it('produces a TWO-entry version vector, the shape a real batch header carries', () => {
    expect(Object.keys(versionVectorFor(ops))).toHaveLength(2);
  });

  it('seals a REAL delta as the op payload, not a made-up buffer', () => {
    const reference = makeReferenceOpPayload(ledger, HDK);
    const payload = JSON.parse(utf8Decode(reference.plaintext)) as Record<string, unknown>;
    expect(Object.keys(payload).length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).toContain('nutritionEntries');
    expect(reference.ciphertext.length).toBeGreaterThan(reference.plaintext.length);
    expect(reference.deltaBytes).toBeGreaterThan(0);
  });

  it('bounds the resident log when checkpoints are ON (He8)', () => {
    const tail = checkpointTail(ops);
    expect(tail.length).toBe(100);
    // The tail is the NEWEST ops — what `listOperationsSince` replays.
    expect(tail[tail.length - 1]!.opId).toBe(ops[ops.length - 1]!.opId);
  });
});
