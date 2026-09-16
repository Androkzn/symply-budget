/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * `stats()` decides which number becomes the headline in a document five stages
 * of work are graded against, and the recorder's crash resilience is the whole
 * reason a 10-year OOM is a result rather than a lost afternoon. Both are
 * cheap to get subtly wrong and cheap to pin.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_MAX_LOAD1, assertMeasurableEnvironment, envInfo, exact, stats } from './lib/measure';
import { openRecorder, readRecords, type ScaleRecord } from './lib/record';

const dir = mkdtempSync(join(tmpdir(), 'symply-scale-record-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('stats', () => {
  it('reports min/p50/p95 for a known sample', () => {
    const st = stats([5, 1, 3, 2, 4, 100, 6, 7, 8, 9]);
    expect(st.n).toBe(10);
    expect(st.min).toBe(1);
    expect(st.p50).toBe(6); // sorted[5]
    expect(st.p95).toBe(100); // sorted[9]
    expect(st.mean).toBeCloseTo(14.5, 10);
  });

  it('does not mutate the caller array', () => {
    const samples = [3, 1, 2];
    stats(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('refuses an empty sample rather than reporting NaN', () => {
    expect(() => stats([])).toThrow(/no samples/);
  });

  it('exact() flattens a single measurement', () => {
    expect(exact(42)).toEqual({ n: 1, min: 42, p50: 42, p95: 42, mean: 42 });
  });
});

describe('recorder', () => {
  it('writes one valid JSON object per line and terminates with an end record', () => {
    const out = join(dir, 'ok.jsonl');
    const recorder = openRecorder({
      phase: 'edit',
      scale: { years: 1, adults: 2, rows: 2437, ops: 3656 },
      env: envInfo(),
      corpus: 'corpus-unit-test',
      runId: 'test-run',
      out,
    });
    recorder.time('edit.demo', stats([1, 2, 3]));
    recorder.size('edit.bytes', 4096, 'bytes', 'note');
    recorder.ratio('edit.ratio', 1.5, 'lower');
    recorder.count('edit.ops', 17, 'ops', 'higher');
    recorder.end();

    const lines = readFileSync(out, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    const records = readRecords(out);
    expect(records.map((r) => r.metric)).toEqual([
      'edit.demo',
      'edit.bytes',
      'edit.ratio',
      'edit.ops',
      'end',
    ]);
    expect(records[0]!.unit).toBe('ms');
    expect(records[0]!.min).toBe(1);
    // Every record carries the two things the comparator cannot infer: which
    // way is worse, and which corpus produced it.
    expect(records.map((r) => r.dir)).toEqual(['lower', 'lower', 'lower', 'higher', 'flat']);
    expect(records.every((r) => r.corpus === 'corpus-unit-test')).toBe(true);
    expect(records[0]!.stat).toBe('min');
    expect(records[1]!.notes).toBe('note');
    expect(records[4]!.phase).toBe('end');
    expect(records.every((r) => r.runId === 'test-run')).toBe(true);
    expect(records.every((r) => r.schema === 1)).toBe(true);
  });

  it('keeps every earlier line when the run never reaches end()', () => {
    // This is the OOM case: the child dies mid-phase. Each line is fsync'd as
    // produced, so the partial file is still readable and the MISSING end
    // record is what tells the driver to write a crashed row.
    const out = join(dir, 'crash.jsonl');
    const recorder = openRecorder({
      phase: 'coldopen',
      scale: null,
      env: envInfo(),
      corpus: 'corpus-unit-test',
      runId: 'crash-run',
      out,
    });
    recorder.time('coldopen.a', stats([1]));
    recorder.time('coldopen.b', stats([2]));
    // …process dies here; end() never runs.

    const records = readRecords(out);
    expect(records).toHaveLength(2);
    expect(records.some((r: ScaleRecord) => r.phase === 'end')).toBe(false);
  });

  it('stamps the load override on every record', () => {
    const out = join(dir, 'loaded.jsonl');
    const recorder = openRecorder({
      phase: 'apply',
      scale: null,
      env: envInfo(),
      corpus: 'corpus-unit-test',
      runId: 'loaded-run',
      out,
      loadOverridden: true,
    });
    recorder.time('apply.demo', stats([1]));
    recorder.end();
    expect(readRecords(out).every((r) => r.loadOverridden === true)).toBe(true);
  });
});

describe('load gate', () => {
  it('refuses to record above the threshold', () => {
    const previous = process.env.SCALE_ALLOW_LOAD;
    delete process.env.SCALE_ALLOW_LOAD;
    try {
      expect(() => assertMeasurableEnvironment({ maxLoad1: -1 })).toThrow(/refuses to record/);
    } finally {
      if (previous !== undefined) process.env.SCALE_ALLOW_LOAD = previous;
    }
  });

  it('records anyway when SCALE_ALLOW_LOAD=1, and says so', () => {
    const previous = process.env.SCALE_ALLOW_LOAD;
    process.env.SCALE_ALLOW_LOAD = '1';
    try {
      expect(assertMeasurableEnvironment({ maxLoad1: -1 })).toEqual({ overridden: true });
    } finally {
      if (previous === undefined) delete process.env.SCALE_ALLOW_LOAD;
      else process.env.SCALE_ALLOW_LOAD = previous;
    }
  });

  it('passes on a quiet machine', () => {
    expect(assertMeasurableEnvironment({ maxLoad1: Number.MAX_SAFE_INTEGER })).toEqual({
      overridden: false,
    });
  });

  it('has a documented default', () => {
    expect(DEFAULT_MAX_LOAD1).toBe(3.0);
  });
});
