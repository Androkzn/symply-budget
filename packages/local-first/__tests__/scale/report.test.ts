/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * `compare`'s exit code is how Stages 1-5 are judged, so a comparator that
 * never fails (or always fails) would quietly invalidate five stages of
 * evidence. Driven end to end through the real script with synthetic JSONL.
 *
 * The cases below exist because the first version of this comparator could not
 * fail on: a phase that crashed, a metric that vanished, any `ops`/`count`/
 * `ratio` metric at all, a collapse in a higher-is-better metric, or a 10x
 * regression in `apply.*` (which it read at `min`, where min is noise). Each of
 * those is one test here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPORT = fileURLToPath(
  new URL('../../../../scripts/e2e/lib/budget-scale-report.mjs', import.meta.url),
);

const dir = mkdtempSync(join(tmpdir(), 'symply-scale-report-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ENV = {
  node: 'v22.15.0',
  v8: '12.4',
  arch: 'arm64',
  platform: 'darwin',
  cpu: 'Apple M3 Pro',
  cores: 12,
  loadavg1: 1.2,
  heapLimitMb: 8240,
  gcAvailable: true,
};

const CORPUS = 'corpus-test-0001';

type Row = {
  metric: string;
  unit: string;
  value: number;
  /** p50 when it must differ from min — the apply.* case. */
  p50?: number;
  years?: number;
  phase?: string;
  status?: string;
  loadOverridden?: boolean;
  dir?: string | null;
  stat?: string;
  corpus?: string;
};

function jsonl(name: string, rows: Row[]): string {
  const file = join(dir, name);
  const lines = rows.map((row) =>
    JSON.stringify({
      schema: 1,
      runId: 'unit',
      ts: '2026-08-12T00:00:00.000Z',
      phase: row.phase ?? 'edit',
      metric: row.metric,
      scale: { years: row.years ?? 5, adults: 2, rows: 11833, ops: 17750 },
      unit: row.unit,
      n: 3,
      min: row.value,
      p50: row.p50 ?? row.value,
      p95: row.p50 ?? row.value,
      mean: row.p50 ?? row.value,
      ...(row.dir === null ? {} : { dir: row.dir ?? 'lower' }),
      stat: row.stat ?? 'min',
      corpus: row.corpus ?? CORPUS,
      ...(row.loadOverridden ? { loadOverridden: true } : {}),
      env: ENV,
      status: row.status ?? 'ok',
    }),
  );
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function run(args: string[]): { status: number; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync('node', [REPORT, ...args], { encoding: 'utf8' }) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const BASE_ROWS: Row[] = [
  { metric: 'edit.total.today', unit: 'ms', value: 1000 },
  { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000 },
];

function baselineJson(name: string, rows: Row[] = BASE_ROWS): string {
  const file = join(dir, name);
  const source = jsonl(`${name}.jsonl`, rows);
  const result = run([source, '--emit-baseline', file]);
  expect(result.status).toBe(0);
  return file;
}

describe('budget-scale-report compare', () => {
  const baseline = baselineJson('baseline.json');

  it('exits 0 on a 3% time move', () => {
    const run3 = jsonl('t3.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1030 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000 },
    ]);
    const result = run([run3, '--compare', baseline]);
    expect(result.stdout).toContain('+3.0%');
    expect(result.status).toBe(0);
  });

  it('exits 1 on a 15% time regression', () => {
    const run15 = jsonl('t15.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1150 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000 },
    ]);
    const result = run([run15, '--compare', baseline]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('REGRESSION');
    expect(result.stdout).toContain('1 regression(s)');
  });

  it('exits 0 on a 0.5% byte move but 1 on a 2% one', () => {
    const small = jsonl('b05.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_005_000 },
    ]);
    expect(run([small, '--compare', baseline]).status).toBe(0);

    const large = jsonl('b2.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_020_000 },
    ]);
    expect(run([large, '--compare', baseline]).status).toBe(1);
  });

  it('treats an improvement in a lower-is-better metric as passing however large', () => {
    const faster = jsonl('fast.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 20 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 10_000 },
    ]);
    const result = run([faster, '--compare', baseline]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('-98.0%');
  });

  it('names a metric that appeared, without failing on it', () => {
    const shifted = jsonl('shift-new.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000 },
      { metric: 'edit.brand.new', unit: 'ms', value: 5 },
    ]);
    const result = run([shifted, '--compare', baseline]);
    expect(result.stdout).toContain('NEW');
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The gate must be able to FAIL. Every case below passed the first comparator.
// ---------------------------------------------------------------------------

describe('budget-scale-report compare — a run that did not happen must fail', () => {
  const baseline = baselineJson('missing-baseline.json');

  it('fails when a baseline metric is missing from the run', () => {
    // The OOM-at-10-years case: the phase never produced its metrics.
    const partial = jsonl('partial.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000 },
    ]);
    const result = run([partial, '--compare', baseline]);
    expect(result.stdout).toContain('MISSING FROM RUN');
    expect(result.stdout).toContain('1 regression(s)');
    expect(result.status).toBe(1);
  });

  it('fails when the driver recorded a crashed phase', () => {
    const crashed = jsonl('crashed-end.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000 },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000 },
      { metric: 'coldopen', unit: 'count', value: 0, phase: 'end', status: 'crashed', years: 10 },
    ]);
    const result = run([crashed, '--compare', baseline]);
    expect(result.stdout).toContain('CRASHED');
    expect(result.status).toBe(1);
  });

  it('fails when a measurement record is itself marked crashed', () => {
    const crashed = jsonl('crashed-metric.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 0, status: 'crashed' },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000 },
    ]);
    const result = run([crashed, '--compare', baseline]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('CRASHED');
  });
});

describe('budget-scale-report compare — counts and ratios are gated', () => {
  const COUNT_BASE: Row[] = [
    { metric: 'batchcap.maxOpsUnderCap', unit: 'ops', value: 546, dir: 'higher' },
    { metric: 'batchcap.chunksForFullLog', unit: 'count', value: 34, dir: 'lower' },
    { metric: 'batchcap.bytesPerOp', unit: 'ratio', value: 703, dir: 'lower' },
    { metric: 'batchcap.opsPerDay', unit: 'ratio', value: 9.73, dir: 'flat' },
  ];
  const baseline = baselineJson('counts.json', COUNT_BASE);

  const withOverrides = (name: string, overrides: Record<string, number>) =>
    jsonl(
      name,
      COUNT_BASE.map((row) =>
        overrides[row.metric] === undefined ? row : { ...row, value: overrides[row.metric]! },
      ),
    );

  it('passes when nothing moved', () => {
    expect(run([withOverrides('counts-same.jsonl', {}), '--compare', baseline]).status).toBe(0);
  });

  it('fails when the product number that killed the product halves', () => {
    // batchcap.maxOpsUnderCap is unit `ops`: higher is better, so -50% is the
    // regression. The first comparator printed "ok … -50.1%" and exited 0.
    const result = run([
      withOverrides('counts-collapse.jsonl', { 'batchcap.maxOpsUnderCap': 273 }),
      '--compare',
      baseline,
    ]);
    expect(result.stdout).toContain('REGRESSION');
    expect(result.stdout).toContain('batchcap.maxOpsUnderCap');
    expect(result.status).toBe(1);
  });

  it('fails when a lower-is-better count or ratio grows', () => {
    const result = run([
      withOverrides('counts-grow.jsonl', {
        'batchcap.chunksForFullLog': 51,
        'batchcap.bytesPerOp': 1200,
      }),
      '--compare',
      baseline,
    ]);
    expect(result.stdout).toContain('2 regression(s)');
    expect(result.status).toBe(1);
  });

  it('passes when a higher-is-better count improves', () => {
    const result = run([
      withOverrides('counts-better.jsonl', { 'batchcap.maxOpsUnderCap': 900 }),
      '--compare',
      baseline,
    ]);
    expect(result.status).toBe(0);
  });

  it('fails a flat corpus invariant in EITHER direction', () => {
    for (const [name, value] of [
      ['counts-flat-up.jsonl', 12],
      ['counts-flat-down.jsonl', 6],
    ] as const) {
      const result = run([
        withOverrides(name, { 'batchcap.opsPerDay': value }),
        '--compare',
        baseline,
      ]);
      expect(result.status, name).toBe(1);
    }
  });

  it('refuses to grade a metric that declares no direction', () => {
    const undeclared = jsonl('undeclared.jsonl', [
      { metric: 'batchcap.maxOpsUnderCap', unit: 'ops', value: 546, dir: null },
      { metric: 'batchcap.chunksForFullLog', unit: 'count', value: 34, dir: 'lower' },
      { metric: 'batchcap.bytesPerOp', unit: 'ratio', value: 703, dir: 'lower' },
      { metric: 'batchcap.opsPerDay', unit: 'ratio', value: 9.73, dir: 'flat' },
    ]);
    const result = run([undeclared, '--compare', baseline]);
    expect(result.stdout).toContain('NO DIRECTION');
    expect(result.status).toBe(1);
  });
});

describe('budget-scale-report compare — the statistic the producer designates', () => {
  // apply.* declares stat:"p50": every sample walks a different prefix of a
  // linear scan, so min reports the luckiest one and is scale-invariant noise.
  const APPLY_BASE: Row[] = [
    { metric: 'apply.patch1', unit: 'ms', value: 0.002, p50: 0.045, phase: 'apply', stat: 'p50' },
  ];
  const baseline = baselineJson('apply.json', APPLY_BASE);

  it('fails on a 10x p50 regression that leaves min untouched', () => {
    const worse = jsonl('apply-worse.jsonl', [
      { metric: 'apply.patch1', unit: 'ms', value: 0.002, p50: 0.45, phase: 'apply', stat: 'p50' },
    ]);
    const result = run([worse, '--compare', baseline]);
    expect(result.stdout).toContain('REGRESSION');
    expect(result.status).toBe(1);
  });

  it('passes when p50 improves even though min got luckier upward', () => {
    const better = jsonl('apply-better.jsonl', [
      { metric: 'apply.patch1', unit: 'ms', value: 0.004, p50: 0.02, phase: 'apply', stat: 'p50' },
    ]);
    expect(run([better, '--compare', baseline]).status).toBe(0);
  });
});

describe('budget-scale-report compare — corpus identity', () => {
  const baseline = baselineJson('corpus.json');

  it('refuses to diff a run generated from a different corpus', () => {
    const other = jsonl('other-corpus.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000, corpus: 'corpus-test-0002' },
      { metric: 'edit.encode.hex.chars', unit: 'chars', value: 1_000_000, corpus: 'corpus-test-0002' },
    ]);
    const result = run([other, '--compare', baseline]);
    expect(result.stdout).toContain('CORPUS');
    expect(result.status).toBe(1);
  });
});

describe('budget-scale-report — publishing a baseline', () => {
  it('refuses to publish a baseline captured above the load gate', () => {
    const noisy = jsonl('noisy.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000, loadOverridden: true },
    ]);
    const out = join(dir, 'noisy-baseline.json');
    const md = join(dir, 'noisy-baseline.md');
    // `bench.sh baseline` passes both flags in one invocation, so a refusal
    // that had already written the markdown would leave the committed .md and
    // .json describing different runs.
    const result = run([noisy, '--markdown', md, '--emit-baseline', out]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('load gate');
    expect(existsSync(out)).toBe(false);
    expect(existsSync(md)).toBe(false);
  });

  it('refuses to publish a baseline with a crashed phase in it', () => {
    const crashed = jsonl('crashed-baseline.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000 },
      { metric: 'coldopen', unit: 'count', value: 0, phase: 'end', status: 'crashed', years: 10 },
    ]);
    const out = join(dir, 'crashed-baseline.json');
    expect(run([crashed, '--emit-baseline', out]).status).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('publishes anyway when the override is explicit, and marks it unusable', () => {
    const noisy = jsonl('noisy2.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000, loadOverridden: true },
    ]);
    const out = join(dir, 'noisy2-baseline.json');
    const result = run([noisy, '--emit-baseline', out, '--allow-unclean-baseline']);
    expect(result.status).toBe(0);
    const written = JSON.parse(readFileSync(out, 'utf8')) as {
      gate: { usable: boolean; reasons: string[] };
    };
    expect(written.gate.usable).toBe(false);
    expect(written.gate.reasons.join(' ')).toContain('load');
  });

  it('marks a clean capture usable', () => {
    const clean = jsonl('clean.jsonl', BASE_ROWS);
    const out = join(dir, 'clean-baseline.json');
    expect(run([clean, '--emit-baseline', out]).status).toBe(0);
    const written = JSON.parse(readFileSync(out, 'utf8')) as { gate: { usable: boolean } };
    expect(written.gate.usable).toBe(true);
  });

  it('warns loudly when comparing against an unusable baseline', () => {
    const noisy = jsonl('noisy3.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 1000, loadOverridden: true },
    ]);
    const out = join(dir, 'noisy3-baseline.json');
    expect(run([noisy, '--emit-baseline', out, '--allow-unclean-baseline']).status).toBe(0);

    const later = jsonl('later.jsonl', [{ metric: 'edit.total.today', unit: 'ms', value: 1000 }]);
    const result = run([later, '--compare', out]);
    expect(result.stdout).toContain('NOT A GATE');
  });
});

describe('budget-scale-report markdown', () => {
  it('renders the load-override and crashed banners when those records are present', () => {
    const file = jsonl('banners.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 10, loadOverridden: true },
      { metric: 'coldopen', unit: 'count', value: 0, phase: 'end', status: 'crashed', years: 10 },
    ]);
    const out = join(dir, 'banners.md');
    expect(run([file, '--markdown', out]).status).toBe(0);
    const markdown = readFileSync(out, 'utf8');
    expect(markdown).toContain('WARNING — load gate overridden');
    expect(markdown).toContain('phase run(s) crashed');
    expect(markdown).toContain('NOT A REGRESSION GATE');
    expect(markdown).toContain('Hermes');
  });

  it('renders a crashed cell rather than a zero', () => {
    const file = jsonl('crash.jsonl', [
      { metric: 'edit.total.today', unit: 'ms', value: 0, status: 'crashed' },
    ]);
    const out = join(dir, 'crash.md');
    expect(run([file, '--markdown', out]).status).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('**crashed**');
  });

  it('exits 2 on malformed input rather than pretending', () => {
    const bad = join(dir, 'bad.jsonl');
    writeFileSync(bad, 'not json\n');
    expect(run([bad]).status).toBe(2);
  });
});
