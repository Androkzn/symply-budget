#!/usr/bin/env node
/**
 * JSONL -> markdown + committed baseline JSON + regression comparison.
 *
 * The baseline document must be GENERATED, never typed. A hand-written table is
 * a number nobody can reproduce, and this document is the evidence Stages 1-5
 * are graded against. `--compare` with an exit code is what lets a stage's own
 * verification step ASSERT "this got faster" instead of asserting it in prose.
 *
 *   node scripts/e2e/lib/budget-scale-report.mjs <run.jsonl>
 *        [--markdown out.md] [--emit-baseline out.json] [--allow-unclean-baseline]
 *        [--compare baseline.json] [--time-tolerance 0.10] [--bytes-tolerance 0.01]
 *        [--count-tolerance 0.01]
 *
 * exit 0 = ok / within tolerance, 1 = regression, 2 = malformed input or a
 * refusal to publish.
 *
 * WHAT MAKES A GATE REAL
 * ----------------------
 * A gate that cannot fail is worse than no gate: it manufactures confidence.
 * The first version of this comparator could not fail on a crashed phase, on a
 * metric that vanished from the run, on any `ops`/`count`/`ratio` metric, on a
 * COLLAPSE in a higher-is-better metric, or on a 10x `apply.*` regression (it
 * read `min`, which for a linear scan is the luckiest sample and is
 * scale-invariant noise). Each of those is now a failure, and each has a test
 * in `packages/local-first/__tests__/scale/report.test.ts` that was watched
 * failing first.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HERMES_CAVEAT =
  'Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** ' +
  'for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device.';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

/**
 * Which brand's baseline this invocation is rendering. Defaults reproduce the
 * committed Budget document byte-for-byte, so adding House costs Budget nothing;
 * `--label` / `--driver` swap the prose for another brand.
 */
const BRAND = { label: 'Budget V2 local-first', driver: 'budget-scale-bench.sh' };

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.flags[key] = true;
      else {
        out.flags[key] = next;
        i += 1;
      }
    } else out.positional.push(arg);
  }
  return out;
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

function readRecords(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const records = [];
  for (const [index, line] of lines.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${index + 1} is not JSON`);
    }
    if (parsed.schema !== 1) throw new Error(`${file}:${index + 1} unknown schema ${parsed.schema}`);
    records.push(parsed);
  }
  if (records.length === 0) throw new Error(`${file} has no records`);
  return records;
}

const scaleKey = (scale) => (scale ? `${scale.years}y/${scale.adults}a` : '-');

function gitInfo() {
  const run = (args) => {
    try {
      return execFileSync('git', args, { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };
  return { sha: run(['rev-parse', 'HEAD']) || 'unknown', dirty: run(['status', '--porcelain']) !== '' };
}

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------

const PHASE_TITLES = {
  edit: '1. Single-field edit, end to end',
  apply: '2. `applyLedgerDelta` throughput',
  coldopen: '3. Cold open (snapshot path)',
  batchcap: '4. Op batch vs the relay cap',
  checkpoint: '5. Checkpoint (reserved for Stage 4)',
};

function shape(records) {
  const measurements = records.filter((r) => r.phase !== 'end' && r.phase !== 'env');
  const ends = records.filter((r) => r.phase === 'end');

  const scales = [];
  for (const record of measurements) {
    const key = scaleKey(record.scale);
    if (!scales.some((s) => s.key === key)) {
      scales.push({ key, years: record.scale?.years ?? 0, scale: record.scale });
    }
  }
  scales.sort((a, b) => a.years - b.years);

  const phases = new Map();
  for (const record of measurements) {
    if (!phases.has(record.phase)) phases.set(record.phase, new Map());
    const metrics = phases.get(record.phase);
    if (!metrics.has(record.metric)) metrics.set(record.metric, { unit: record.unit, byScale: new Map() });
    metrics.get(record.metric).byScale.set(scaleKey(record.scale), record);
  }

  const corpora = [...new Set(measurements.map((r) => r.corpus).filter(Boolean))];

  return {
    scales,
    phases,
    measurements,
    env: measurements[0].env,
    runId: measurements[0].runId,
    loadOverridden: measurements.some((r) => r.loadOverridden),
    /** Both the driver's `phase:"end"` crash rows and any metric marked crashed. */
    crashed: [...ends.filter((r) => r.status === 'crashed'), ...measurements.filter((r) => r.status === 'crashed')],
    ends,
    corpus: corpora.length === 1 ? corpora[0] : corpora.length === 0 ? null : 'MIXED',
  };
}

/**
 * Everything that disqualifies a run from being published as THE baseline.
 * Kept separate from `warnings` (which are noted but not blocking) because a
 * baseline is the reference five stages are graded against: publishing one
 * captured on a loaded machine, or one with a hole in it, poisons every later
 * comparison in a way nobody can see from the numbers.
 */
function gateReasons(model) {
  const reasons = [];
  if (model.loadOverridden) {
    reasons.push(
      `captured above the load gate (SCALE_ALLOW_LOAD=1, loadavg[0] ${model.env.loadavg1}) — ` +
        'the timings include whatever else the machine was doing',
    );
  }
  if (model.crashed.length > 0) {
    reasons.push(
      `${model.crashed.length} phase run(s) crashed — the baseline would have holes that ` +
        'later runs cannot be graded against',
    );
  }
  if (!model.corpus) {
    reasons.push(
      'no corpus fingerprint on the records — this run predates corpus fingerprinting and ' +
        'cannot be proven to have measured the same corpus a later run does',
    );
  } else if (model.corpus === 'MIXED') {
    reasons.push('records carry more than one corpus fingerprint — the phases did not agree');
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

function fmtMs(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v >= 10) return `${v.toFixed(0)} ms`;
  if (v >= 1) return `${v.toFixed(2)} ms`;
  return `${v.toFixed(3)} ms`;
}

function fmtCount(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} k`;
  return String(Math.round(v));
}

function fmtBytes(v) {
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(2)} MiB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
  return `${Math.round(v)} B`;
}

/** The statistic the producer designated as this metric's headline. */
const statOf = (record) => (record.stat === 'p50' ? 'p50' : 'min');
const headline = (record) => (statOf(record) === 'p50' ? record.p50 : record.min);

function fmtCell(record) {
  if (!record) return '—';
  if (record.status === 'crashed') return '**crashed**';
  const value = headline(record);
  switch (record.unit) {
    case 'ms':
      if (record.n <= 1) return fmtMs(value);
      return statOf(record) === 'p50'
        ? `${fmtMs(record.p50)} <br><sub>p50 · min ${fmtMs(record.min)} · p95 ${fmtMs(record.p95)} · n=${record.n}</sub>`
        : `${fmtMs(record.min)} <br><sub>p50 ${fmtMs(record.p50)} · p95 ${fmtMs(record.p95)} · n=${record.n}</sub>`;
    case 'bytes':
      return `${fmtBytes(value)}`;
    case 'chars':
      return `${fmtCount(value)}`;
    case 'ops':
    case 'count':
      return fmtCount(value);
    case 'ratio':
      return value >= 1000 ? fmtCount(value) : value.toFixed(value < 10 ? 2 : 1);
    default:
      return String(value);
  }
}

function table(metrics, scales) {
  const header = `| Metric | Unit | ${scales.map((s) => s.key).join(' | ')} |`;
  const rule = `|---|---|${scales.map(() => '---').join('|')}|`;
  const rows = [...metrics.entries()].map(([metric, info]) => {
    const cells = scales.map((s) => fmtCell(info.byScale.get(s.key)));
    return `| \`${metric}\` | ${info.unit} | ${cells.join(' | ')} |`;
  });
  return [header, rule, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------

function renderMarkdown(model, git) {
  const { env, scales } = model;
  const reasons = gateReasons(model);
  const out = [];

  out.push(`# ${BRAND.label} — scale baseline`);
  out.push('');
  out.push(
    '**GENERATED — do not hand-edit.** Produced by `scripts/e2e/lib/budget-scale-report.mjs` ' +
      `from a run of \`scripts/e2e/lib/${BRAND.driver}\`. Re-run and regenerate; do not patch numbers in.`,
  );
  out.push('');
  out.push(
    `Run \`${model.runId}\` · git \`${git.sha.slice(0, 12)}\`${git.dirty ? ' **(working tree dirty — the measured tree is not the committed tree)**' : ''}`,
  );
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Node | ${env.node} (V8 ${env.v8}) |`);
  out.push(`| Machine | ${env.cpu} x${env.cores}, ${env.platform}-${env.arch} |`);
  out.push(`| Heap limit | ${env.heapLimitMb} MB |`);
  out.push(`| loadavg[0] at capture | ${env.loadavg1} |`);
  out.push(`| \`--expose-gc\` | ${env.gcAvailable ? 'yes' : 'no'} |`);
  out.push(`| Corpus fingerprint | ${model.corpus ?? '**absent**'} |`);
  out.push('');

  if (reasons.length > 0) {
    out.push(
      '> ## NOT A REGRESSION GATE\n> \n' +
        '> This capture is **provisional**. `compare` will refuse to grade timings against it. ' +
        `Re-take it (\`${BRAND.driver} baseline\`) on a quiet machine before any stage is ` +
        'judged by it. Reasons:\n> \n' +
        reasons.map((r) => `> - ${r}`).join('\n'),
    );
    out.push('');
  }
  if (model.loadOverridden) {
    out.push(
      '> **WARNING — load gate overridden.** At least one record was captured above ' +
        `loadavg 3.0 (SCALE_ALLOW_LOAD=1). These numbers are provisional: they include ` +
        'scheduling noise from whatever else the machine was doing. Re-take on a quiet ' +
        'machine before quoting them as a baseline.',
    );
    out.push('');
  }
  if (model.crashed.length > 0) {
    const which = model.crashed.map((r) => `${r.phase === 'end' ? r.metric : r.phase} @ ${scaleKey(r.scale)}`);
    out.push(
      `> **WARNING — ${model.crashed.length} phase run(s) crashed** (${which.join(', ')}). ` +
        'A crashed column is a GAP, not a zero.',
    );
    out.push('');
  }

  out.push(`> ${HERMES_CAVEAT}`);
  out.push('');
  out.push('Scales (rows / ops, from the pinned generator):');
  out.push('');
  out.push('| Scale | Rows | Ops |');
  out.push('|---|---|---|');
  for (const s of scales) {
    if (!s.scale) continue;
    out.push(`| ${s.key} | ${s.scale.rows.toLocaleString('en-US')} | ${s.scale.ops.toLocaleString('en-US')} |`);
  }
  out.push('');

  for (const [phase, title] of Object.entries(PHASE_TITLES)) {
    const metrics = model.phases.get(phase);
    if (!metrics) continue;
    out.push(`## ${title}`);
    out.push('');
    out.push(table(metrics, scales));
    out.push('');
    out.push(
      `_${HERMES_CAVEAT} Each metric is shown at the statistic it is graded on — min for most, ` +
        'p50 for `apply.*`, where every sample walks a different prefix of a linear scan and min ' +
        'reports the luckiest one._',
    );
    out.push('');
  }

  out.push('## What this does NOT measure');
  out.push('');
  out.push(
    '- **Hermes.** Every number is V8. The audit puts Hermes at 3-15x slower and the ' +
      'multiplier varies per operation (string building and pure-JS crypto are worst). ' +
      'Nobody should quote a millisecond from this document as a device millisecond. ' +
      'An on-device harness would need product source this stage does not own.',
  );
  out.push(
    '- **The SQLite journal branch of cold open** (`resolveLedgerOps`, engine.ts:444-458). ' +
      'The only off-device driver is `__tests__/helpers/fake-sqlite-driver.ts`, whose ' +
      '`hasOperation` is `Array.some` and whose `insertOperation` adds a second linear ' +
      'scan; rehydrating tens of thousands of ops would measure the fake\'s O(n^2), not ' +
      'the product. `coldopen.total` is the snapshot path ONLY.',
  );
  out.push(
    '- **Real Ed25519 signing and verification.** Op signatures in the corpus are 64 ' +
      'pseudo-random bytes: correct for size and for the persist/batch paths, but this ' +
      'harness says nothing about verify cost — which Stage 5\'s bootstrap decision needs ' +
      '(the audit estimates 83 s of blocked Ed25519 for ~40,000 ops).',
  );
  out.push(
    '- **The 4-member household.** The audit quotes 11,833 rows at 5y/2 adults and 24,703 ' +
      'at 5y/4 members. No linear composition satisfies both with a non-negative fixed ' +
      'term (it implies F = -1,037). The generator reproduces the 2-adult reference ' +
      'exactly and yields 22,655 at 4 adults. Any 4-member column is generator-derived ' +
      'and needs a product call before it is cited as the audit\'s figure.',
  );
  out.push(
    '- **Sync itself.** No relay, no chunking round trip, no second device applying what a ' +
      'first one produced. `batchcap` measures what a batch COSTS, not whether it arrives. ' +
      'The corpus does carry a multi-device op log and a populated LWW watermark map, so ' +
      'the merge machinery is under load here, but delivery is not.',
  );
  out.push('');
  out.push('## How to re-run');
  out.push('');
  out.push('```sh');
  out.push(`scripts/e2e/lib/${BRAND.driver} guard      # cheap correctness guards`);
  out.push(`scripts/e2e/lib/${BRAND.driver} baseline   # full run + regenerate this file`);
  out.push(`scripts/e2e/lib/${BRAND.driver} compare /tmp/symply-scale/<runId>.jsonl`);
  out.push('```');
  out.push('');
  out.push(
    '`compare` exits non-zero on a regression beyond tolerance in EITHER direction (each ' +
      'metric declares which way is worse), on a metric that is in the baseline but missing ' +
      'from the run, on a crashed phase, and on a run whose corpus fingerprint differs from ' +
      'the baseline\'s. That exit code is how Stages 1-5 are judged.',
  );
  out.push('');

  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// baseline json / compare
// ---------------------------------------------------------------------------

const baselineKey = (record) => `${record.phase}|${record.metric}|${scaleKey(record.scale)}`;

function toBaseline(model, records, git) {
  const metrics = {};
  for (const record of records) {
    if (record.phase === 'end' || record.phase === 'env') continue;
    metrics[baselineKey(record)] = {
      unit: record.unit,
      n: record.n,
      min: record.min,
      p50: record.p50,
      p95: record.p95,
      dir: record.dir ?? null,
      stat: statOf(record),
      status: record.status,
    };
  }
  const reasons = gateReasons(model);
  return {
    schema: 1,
    runId: model.runId,
    generatedAt: new Date().toISOString(),
    git,
    env: model.env,
    corpus: model.corpus,
    loadOverridden: model.loadOverridden,
    gate: { usable: reasons.length === 0, reasons },
    scales: model.scales.filter((s) => s.scale).map((s) => s.scale),
    metrics,
  };
}

/** Which tolerance a unit is graded with. Every unit is graded — that is the point. */
function toleranceFor(unit, tolerances) {
  switch (unit) {
    case 'ms':
      return tolerances.time;
    case 'bytes':
    case 'chars':
      return tolerances.bytes;
    case 'ops':
    case 'count':
    case 'ratio':
      return tolerances.count;
    default:
      return null;
  }
}

/**
 * `dir` says which way is WORSE, and it comes from the producer rather than
 * from a name-matching table here, so a new metric cannot be silently ungated:
 * a record with no `dir` is a failure, not a skip.
 */
function regressedBy(dir, delta, tolerance) {
  if (dir === 'lower') return delta > tolerance;
  if (dir === 'higher') return delta < -tolerance;
  if (dir === 'flat') return Math.abs(delta) > tolerance;
  return true;
}

function compare(model, records, baselineFile, tolerances) {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  if (baseline.schema !== 1) throw new Error(`${baselineFile}: unknown schema`);

  const lines = [];
  const rows = [];
  let regressions = 0;

  const baselineGate = baseline.gate ?? {
    usable: false,
    reasons: ['baseline predates the publish gate — re-take it'],
  };
  if (!baselineGate.usable) {
    lines.push('##############################################################');
    lines.push('# NOT A GATE: the baseline itself is provisional.');
    for (const reason of baselineGate.reasons) lines.push(`#   - ${reason}`);
    lines.push(`# Re-take it on a quiet machine: ${BRAND.driver} baseline`);
    lines.push('##############################################################');
  }
  // Timings from a loaded machine are noise; sizes and counts from one are not.
  // So a load-tainted baseline degrades to grading only the deterministic
  // metrics — declared out loud, right here, rather than silently.
  const untrustedTimings = !baselineGate.usable && baselineGate.reasons.some((r) => /load/.test(r));

  // A different corpus is not a slower corpus. Diffing across one is how a
  // harness reports a generator change as a product regression.
  if ((model.corpus ?? null) !== (baseline.corpus ?? null)) {
    lines.push(
      `CORPUS MISMATCH: run \`${model.corpus ?? 'absent'}\` vs baseline \`${baseline.corpus ?? 'absent'}\`. ` +
        'These numbers were produced from different corpora and cannot be diffed. Re-take the baseline.',
    );
    lines.push('');
    lines.push('1 regression(s) beyond tolerance (corpus mismatch).');
    return { text: lines.join('\n'), regressions: 1 };
  }

  for (const record of model.crashed) {
    const where = record.phase === 'end' ? record.metric : record.phase;
    rows.push({ key: `${where} @ ${scaleKey(record.scale)}`, note: 'CRASHED', delta: null, fatal: true });
    regressions += 1;
  }

  for (const record of records) {
    if (record.phase === 'end' || record.phase === 'env') continue;
    if (record.status === 'crashed') continue; // already counted above
    const key = baselineKey(record);
    const previous = baseline.metrics[key];
    if (!previous) {
      rows.push({ key, note: 'NEW', delta: null });
      continue;
    }

    const stat = statOf(record);
    const before = previous[stat] ?? previous.min;
    const after = record[stat] ?? record.min;
    const tolerance = toleranceFor(record.unit, tolerances);

    if (!record.dir) {
      rows.push({ key, note: 'NO DIRECTION', delta: null, fatal: true });
      regressions += 1;
      continue;
    }
    if (previous.dir && previous.dir !== record.dir) {
      rows.push({ key, note: 'DIRECTION CHANGED', delta: null, fatal: true });
      regressions += 1;
      continue;
    }
    if (tolerance === null) {
      rows.push({ key, note: `UNGRADED UNIT ${record.unit}`, delta: null, fatal: true });
      regressions += 1;
      continue;
    }
    if (untrustedTimings && record.unit === 'ms') {
      rows.push({ key, note: 'NOT GRADED (noisy baseline)', delta: null });
      continue;
    }

    if (before === 0) {
      const worse = after !== 0 && record.dir !== 'higher';
      rows.push({ key, note: `BASELINE ZERO -> ${after}`, delta: null, fatal: worse });
      if (worse) regressions += 1;
      continue;
    }

    const delta = (after - before) / before;
    const regressed = regressedBy(record.dir, delta, tolerance);
    if (regressed) regressions += 1;
    rows.push({ key, before, after, delta, regressed, unit: record.unit, dir: record.dir });
  }

  // A metric in the baseline that the run never produced is the OOM / crashed /
  // silently-removed case. It is the single most important thing this gate has
  // to catch, and the first version of it printed a note and moved on.
  for (const missing of Object.keys(baseline.metrics)) {
    if (!records.some((r) => r.phase !== 'end' && r.phase !== 'env' && baselineKey(r) === missing)) {
      rows.push({ key: missing, note: 'MISSING FROM RUN', delta: null, fatal: true });
      regressions += 1;
    }
  }

  if (model.loadOverridden) {
    lines.push('WARNING: this run was captured above the load gate — its timings include noise.');
  }
  if (model.env.cpu !== baseline.env.cpu || model.env.node !== baseline.env.node) {
    lines.push(
      `WARNING: different machine/runtime (${baseline.env.cpu} ${baseline.env.node} -> ` +
        `${model.env.cpu} ${model.env.node}). Times are not comparable; sizes still are.`,
    );
  }
  for (const row of rows.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity))) {
    if (row.note) {
      lines.push(`  ${row.note.padEnd(16)} ${row.key}`);
      continue;
    }
    const pct = `${row.delta >= 0 ? '+' : ''}${(row.delta * 100).toFixed(1)}%`;
    lines.push(
      `  ${(row.regressed ? 'REGRESSION' : 'ok').padEnd(16)} ${row.key.padEnd(56)} ${pct.padStart(8)}`,
    );
  }
  lines.push('');
  lines.push(
    `${regressions} regression(s) beyond tolerance (time >${(tolerances.time * 100).toFixed(0)}%, ` +
      `bytes >${(tolerances.bytes * 100).toFixed(0)}%, counts/ratios >${(tolerances.count * 100).toFixed(0)}%, ` +
      'either direction per the metric\'s declared polarity).',
  );
  return { text: lines.join('\n'), regressions };
}

// ---------------------------------------------------------------------------

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length !== 1) {
    process.stderr.write('usage: budget-scale-report.mjs <run.jsonl> [--markdown f] [--emit-baseline f] [--compare f] [--label L] [--driver D]\n');
    return 2;
  }

  let records;
  try {
    records = readRecords(positional[0]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  if (typeof flags.label === 'string') BRAND.label = flags.label;
  if (typeof flags.driver === 'string') BRAND.driver = flags.driver;

  const model = shape(records);
  const git = gitInfo();

  // Decided BEFORE anything is written: `bench.sh baseline` passes --markdown
  // and --emit-baseline in one invocation, and a refusal that had already
  // written the markdown would leave the two committed documents describing
  // different runs.
  if (flags['emit-baseline']) {
    const reasons = gateReasons(model);
    const override =
      flags['allow-unclean-baseline'] === true || process.env.SCALE_ALLOW_UNCLEAN_BASELINE === '1';
    if (reasons.length > 0 && !override) {
      process.stdout.write(
        `refusing to publish ${flags['emit-baseline']}:\n` +
          `${reasons.map((r) => `  - ${r}\n`).join('')}` +
          'A baseline is what five stages are graded against. Re-take it on a quiet machine, ' +
          'or pass --allow-unclean-baseline (SCALE_ALLOW_UNCLEAN_BASELINE=1) to publish it ' +
          'stamped gate.usable=false, in which case `compare` will not grade timings against it.\n',
      );
      return 2;
    }
  }

  if (flags.markdown) {
    writeFileSync(flags.markdown, renderMarkdown(model, git));
    process.stdout.write(`wrote ${flags.markdown}\n`);
  }
  if (flags['emit-baseline']) {
    writeFileSync(flags['emit-baseline'], `${JSON.stringify(toBaseline(model, records, git), null, 2)}\n`);
    process.stdout.write(`wrote ${flags['emit-baseline']}\n`);
  }
  if (flags.compare) {
    const tolerances = {
      time: Number(flags['time-tolerance'] ?? 0.1),
      bytes: Number(flags['bytes-tolerance'] ?? 0.01),
      count: Number(flags['count-tolerance'] ?? 0.01),
    };
    const result = compare(model, records, flags.compare, tolerances);
    process.stdout.write(`${result.text}\n`);
    return result.regressions > 0 ? 1 : 0;
  }
  if (!flags.markdown && !flags['emit-baseline']) {
    process.stdout.write(renderMarkdown(model, git));
  }
  return 0;
}

process.exit(main());
