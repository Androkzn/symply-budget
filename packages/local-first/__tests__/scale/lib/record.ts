/**
 * JSONL recorder — one object per line, fsync'd as produced.
 *
 * "Easy to re-run and easy to diff" is a hard requirement of this stage, and
 * the free-text `ROW | …` lines the existing hot-path bench emits cannot be
 * diffed programmatically. Each line is flushed and fsync'd immediately so a
 * later OOM keeps every earlier measurement: the audit already recorded an OOM
 * at a 4 GB heap, so this is a real path, and the MISSING terminal `end` record
 * is exactly how the driver detects the crash and writes a `status:"crashed"`
 * row on the child's behalf.
 */
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';

import type { ScaleId } from './ledger-factory';
import type { ScaleEnv, Stats } from './measure';

/**
 * `homehydrate` is Health's fourth phase (plan §4, stage He10): the 17-way
 * `Promise.all` of `load*()` that `HealthHomeScreen.tsx:198-219` fires on every
 * focus. It is additive — Budget and House emit no records under it, so their
 * committed baselines are unchanged.
 */
export type ScalePhase =
  | 'edit'
  | 'apply'
  | 'coldopen'
  | 'batchcap'
  | 'checkpoint'
  | 'homehydrate';
export type ScaleUnit = 'ms' | 'bytes' | 'chars' | 'ops' | 'count' | 'ratio';
export type ScaleStatus = 'ok' | 'crashed' | 'skipped';

/**
 * Which way is WORSE for this metric. Declared by the producer and carried on
 * every record, because the comparator cannot know: `chunksForFullLog` going up
 * is a regression, `maxOpsUnderCap` going up is the fix, and `opsPerDay` moving
 * at all means the corpus changed underneath both. A one-sided `delta > tol`
 * check read the collapse of every higher-is-better metric as an improvement,
 * and units the comparator had no opinion about (`ops`, `count`, `ratio` — 56
 * of 192 baseline metrics, including every number that answers "does sync still
 * work") could not fail the gate at all. A record with no `dir` is now a
 * comparator FAILURE, so the ungated class cannot come back silently.
 */
export type MetricDirection = 'lower' | 'higher' | 'flat';

/**
 * Which statistic grades this metric. `min` for almost everything (Stage 0 had
 * to retract a 2.8x claim that was a GC-inflated p50), but `p50` for `apply.*`,
 * where every sample walks a different prefix of a linear scan and min reports
 * the luckiest one — the committed baseline showed apply.patch1 min flat at
 * ~0.002 ms from 1 to 10 years while p50 went 0.011 -> 0.080 ms.
 */
export type MetricStat = 'min' | 'p50';

export type ScaleRecord = {
  schema: 1;
  runId: string;
  ts: string;
  phase: ScalePhase | 'env' | 'end';
  metric: string;
  scale: ScaleId | null;
  unit: ScaleUnit;
  n: number;
  min: number;
  p50: number;
  p95: number;
  mean: number;
  dir: MetricDirection;
  stat: MetricStat;
  /** Identity of the generated corpus — `compare` refuses to diff across two. */
  corpus: string;
  notes?: string;
  loadOverridden?: boolean;
  env: ScaleEnv;
  status: ScaleStatus;
};

export interface Recorder {
  time(metric: string, st: Stats, notes?: string, opts?: { stat?: MetricStat; dir?: MetricDirection }): void;
  size(metric: string, value: number, unit: 'bytes' | 'chars', notes?: string): void;
  ratio(metric: string, value: number, dir: MetricDirection, notes?: string): void;
  count(metric: string, value: number, unit: 'ops' | 'count', dir: MetricDirection, notes?: string): void;
  end(status?: ScaleStatus): void;
}

export function openRecorder(input: {
  phase: ScalePhase;
  scale: ScaleId | null;
  env: ScaleEnv;
  corpus: string;
  runId?: string;
  out?: string;
  loadOverridden?: boolean;
}): Recorder {
  const runId = input.runId ?? process.env.SCALE_RUN_ID ?? `local-${Date.now()}`;
  const out = input.out ?? process.env.SCALE_OUT ?? '';
  const fd = out ? openSync(out, 'a') : null;

  const write = (record: ScaleRecord) => {
    const line = `${JSON.stringify(record)}\n`;
    if (fd != null) {
      writeSync(fd, line);
      // Per line, not per run: an OOM three metrics later must not take the
      // metrics already produced with it.
      fsyncSync(fd);
    } else {
      process.stdout.write(line);
    }
  };

  const base = (
    metric: string,
    unit: ScaleUnit,
    st: Stats,
    dir: MetricDirection,
    stat: MetricStat,
    notes?: string,
  ): ScaleRecord => ({
    schema: 1,
    runId,
    ts: new Date().toISOString(),
    phase: input.phase,
    metric,
    scale: input.scale,
    unit,
    n: st.n,
    min: st.min,
    p50: st.p50,
    p95: st.p95,
    mean: st.mean,
    dir,
    stat,
    corpus: input.corpus,
    ...(notes ? { notes } : {}),
    ...(input.loadOverridden ? { loadOverridden: true } : {}),
    env: input.env,
    status: 'ok',
  });

  const flat = (value: number): Stats => ({ n: 1, min: value, p50: value, p95: value, mean: value });

  return {
    time(metric, st, notes, opts) {
      write(base(metric, 'ms', st, opts?.dir ?? 'lower', opts?.stat ?? 'min', notes));
    },
    size(metric, value, unit, notes) {
      write(base(metric, unit, flat(value), 'lower', 'min', notes));
    },
    ratio(metric, value, dir, notes) {
      write(base(metric, 'ratio', flat(value), dir, 'min', notes));
    },
    count(metric, value, unit, dir, notes) {
      write(base(metric, unit, flat(value), dir, 'min', notes));
    },
    end(status = 'ok') {
      write({ ...base('end', 'count', flat(0), 'flat', 'min'), phase: 'end', status });
      if (fd != null) {
        fsyncSync(fd);
        closeSync(fd);
      }
    },
  };
}

/** Append a record produced by the DRIVER (e.g. a crashed child). */
export function appendRecord(file: string, record: ScaleRecord): void {
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function readRecords(file: string): ScaleRecord[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ScaleRecord);
}
