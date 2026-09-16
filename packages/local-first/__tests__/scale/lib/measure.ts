/**
 * Timing primitives and the load gate.
 *
 * WHY min IS THE HEADLINE
 * -----------------------
 * Stage 0 had to publicly retract a 2.8x encoder claim that turned out to be a
 * GC-inflated p50 — min-of-3 showed 1.2x
 * (documents/engineering/budget-local-first-stage0-implemented.md, "Honest note
 * on the headline number"). min is the closest thing to the machine's actual
 * cost; p95 is reported alongside so GC pressure stays visible instead of being
 * averaged away.
 */
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import * as v8 from 'node:v8';

export type Stats = { n: number; min: number; p50: number; p95: number; mean: number };

export type ScaleEnv = {
  node: string;
  v8: string;
  arch: string;
  platform: string;
  cpu: string;
  cores: number;
  loadavg1: number;
  heapLimitMb: number;
  gcAvailable: boolean;
};

export function stats(samples: number[]): Stats {
  if (samples.length === 0) throw new Error('stats: no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    n: sorted.length,
    min: sorted[0]!,
    p50: at(0.5),
    p95: at(0.95),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

/** A single exact value expressed as Stats, for sizes and counts. */
export function exact(value: number): Stats {
  return { n: 1, min: value, p50: value, p95: value, mean: value };
}

export function forceGc(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) gc();
}

export function timeIt(
  fn: () => void,
  opts: { iters: number; warmup?: number; gcBetween?: boolean },
): Stats {
  const warmup = opts.warmup ?? Math.min(2, opts.iters);
  for (let i = 0; i < warmup; i += 1) fn();
  const samples: number[] = [];
  for (let i = 0; i < opts.iters; i += 1) {
    if (opts.gcBetween) forceGc();
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

export function envInfo(): ScaleEnv {
  const cpus = os.cpus();
  return {
    node: process.version,
    v8: process.versions.v8,
    arch: process.arch,
    platform: process.platform,
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    loadavg1: Number(os.loadavg()[0]!.toFixed(2)),
    heapLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024),
    gcAvailable: typeof (globalThis as { gc?: () => void }).gc === 'function',
  };
}

/**
 * Above this 1-minute load average the machine is not a measuring instrument.
 * This checkout runs concurrent agent sessions; it read 5.25 while this harness
 * was being written. A baseline taken then is noise wearing a table.
 */
export const DEFAULT_MAX_LOAD1 = 3.0;

export function assertMeasurableEnvironment(opts?: { maxLoad1?: number }): { overridden: boolean } {
  const max = opts?.maxLoad1 ?? DEFAULT_MAX_LOAD1;
  const load1 = os.loadavg()[0]!;
  if (load1 <= max) return { overridden: false };
  if (process.env.SCALE_ALLOW_LOAD === '1') return { overridden: true };
  throw new Error(
    `scale harness refuses to record: loadavg[0]=${load1.toFixed(2)} > ${max.toFixed(2)}. ` +
      'Quiesce the machine, or set SCALE_ALLOW_LOAD=1 to record anyway — every record ' +
      'is then stamped and the generated report carries a warning banner.',
  );
}

export const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
