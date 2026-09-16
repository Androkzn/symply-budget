#!/usr/bin/env node
/**
 * JSONL -> the Health He10 baseline markdown.
 *
 * WHY HEALTH HAS ITS OWN RENDERER AND HOUSE DID NOT
 * -------------------------------------------------
 * House reuses `budget-scale-report.mjs` verbatim (`--label` / `--driver` swap
 * the prose) because House measures the same four phases against the same kind
 * of thresholds: "is it slower than last time". Health's He10 has something
 * neither of them has — a NORMATIVE FAIL TABLE (plan §4) whose five rows decide
 * whether Wave C is descoped. A regression report cannot express that: it grades
 * a run against the previous run, not against an absolute threshold, and it has
 * no notion of a Hermes projection.
 *
 * So this renderer produces the He10 document (Exit table first, phases after),
 * and the shared script still emits `health-local-first-scale-baseline.json` so
 * `compare` keeps working exactly as it does for the other two brands. Neither
 * script is modified for the other's sake.
 *
 *   node scripts/e2e/lib/health-scale-report.mjs <run.jsonl> --markdown out.md
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const HERMES_CAVEAT =
  'Measured on V8. Hermes has no optimizing JIT; the audit puts it at **3-15x slower** ' +
  'for string building and pure-JS crypto. Every figure here is a LOWER BOUND for a real device.';

const PHASE_TITLES = {
  coldopen: 'Cold open → first Home paint (checkpoints ON)',
  homehydrate: '`health-homehydrate` — the 17-loader `Promise.all`',
  edit: 'Single meal `mutate`, end to end',
  apply: '`applyLedgerDelta` — one deposit, and the shape breakdown',
};

/** The plan's own wording, in the plan's own order. */
const EXIT_ROWS = [
  { id: 'coldOpenToFirstPaintP50', metric: 'Cold open → first Home paint', threshold: '3.0 s p50' },
  { id: 'coldOpenToFirstPaintP95', metric: 'Cold open → first Home paint', threshold: '5.0 s p95' },
  { id: 'mealMutate', metric: 'Single meal `mutate`', threshold: '250 ms p95' },
  { id: 'applyDeposit', metric: '`applyLedgerDelta`, one deposit', threshold: '500 ms p95' },
  { id: 'homeHydrate', metric: '17-loader `health-homehydrate`', threshold: '1.5 s p95' },
  { id: 'ledgerAndLwwOnDisk', metric: 'Ledger + LWW on disk', threshold: '250 MB' },
];

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
// formatting — deliberately identical to budget-scale-report.mjs so the three
// baseline documents read as one family.
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
      return fmtBytes(value);
    case 'chars':
      return fmtCount(value);
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

function shape(records) {
  const measurements = records.filter((r) => r.phase !== 'end' && r.phase !== 'env');

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
  const crashed = records.filter((r) => r.status === 'crashed');

  return {
    runId: measurements[0]?.runId ?? 'unknown',
    env: measurements[0]?.env ?? {},
    corpus: corpora.length === 1 ? corpora[0] : corpora.length === 0 ? null : 'MIXED',
    loadOverridden: measurements.some((r) => r.loadOverridden),
    crashed,
    scales,
    phases,
    /** metric name -> scaleKey -> record, across every phase. */
    byMetric: new Map(
      [...phases.values()].flatMap((metrics) => [...metrics.entries()]),
    ),
  };
}

/** The gate is normative on the 10-year corpus; anything else is context. */
function gateScale(model) {
  const ten = model.scales.find((s) => s.years === 10);
  return ten ?? model.scales[model.scales.length - 1];
}

function exitTable(model) {
  const scale = gateScale(model);
  if (!scale) return ['_No scales in this run._', null];

  const lines = [];
  lines.push(`| Metric | Fail above | Measured (Node, V8) | Hermes-estimated (x3, the gate) | Worst case (x15) | Verdict |`);
  lines.push('|---|---|---|---|---|---|');

  let allPass = true;
  let anyMissing = false;

  for (const row of EXIT_ROWS) {
    const pass = model.byMetric.get(`exit.${row.id}.pass`)?.byScale.get(scale.key);
    const node = model.byMetric.get(`exit.${row.id}.node`)?.byScale.get(scale.key);
    const gated = model.byMetric.get(`exit.${row.id}.hermes`)?.byScale.get(scale.key);
    const worst = model.byMetric.get(`exit.${row.id}.hermesWorst`)?.byScale.get(scale.key);
    const bytes = model.byMetric.get(`exit.${row.id}.bytes`)?.byScale.get(scale.key);

    if (!pass) {
      anyMissing = true;
      lines.push(`| ${row.metric} | ${row.threshold} | **missing** | — | — | ⚠️ **NOT MEASURED** |`);
      continue;
    }
    const ok = pass.min === 1;
    if (!ok) allPass = false;

    if (bytes) {
      lines.push(
        `| ${row.metric} | ${row.threshold} | ${fmtBytes(bytes.min)} | n/a — bytes are bytes | n/a | ${ok ? '✅ PASS' : '❌ **FAIL**'} |`,
      );
    } else {
      lines.push(
        `| ${row.metric} | ${row.threshold} | ${fmtMs(node?.min ?? 0)} | ${fmtMs(gated?.min ?? 0)} | ${fmtMs(worst?.min ?? 0)} | ${ok ? '✅ PASS' : '❌ **FAIL**'} |`,
      );
    }
  }

  return [lines.join('\n'), { scale, allPass, anyMissing }];
}

function loaderBreakdown(model) {
  const metrics = model.phases.get('homehydrate');
  if (!metrics) return null;
  const loaders = new Map(
    [...metrics.entries()].filter(([name]) => name.startsWith('homehydrate.loader.')),
  );
  if (loaders.size === 0) return null;

  const scale = gateScale(model);
  const rows = [...loaders.entries()]
    .map(([name, info]) => {
      const record = info.byScale.get(scale.key);
      return { name: name.replace('homehydrate.loader.', ''), record, p50: record?.p50 ?? 0, p95: record?.p95 ?? 0 };
    })
    .sort((a, b) => b.p50 - a.p50);

  const total = rows.reduce((sum, row) => sum + row.p50, 0);
  const out = [`| Loader | p50 | p95 | share of the 17 |`, '|---|---|---|---|'];
  for (const row of rows) {
    out.push(
      `| \`${row.name}\` | ${fmtMs(row.p50)} | ${fmtMs(row.p95)} | ${((row.p50 / Math.max(total, 1e-9)) * 100).toFixed(1)}% |`,
    );
  }
  return { table: out.join('\n'), scale };
}

function renderMarkdown(model, git) {
  const { env, scales } = model;
  const [exit, verdict] = exitTable(model);
  const breakdown = loaderBreakdown(model);
  const out = [];

  out.push('# Symply Health V2 local-first — scale baseline (stage He10)');
  out.push('');
  out.push(
    '**GENERATED — do not hand-edit.** Produced by `scripts/e2e/lib/health-scale-report.mjs` ' +
      'from a run of `scripts/e2e/lib/health-scale-bench.sh`. Re-run and regenerate; do not patch numbers in.',
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
  out.push('| `--expose-gc` | ' + (env.gcAvailable ? 'yes' : 'no') + ' |');
  out.push(`| Corpus fingerprint | ${model.corpus ?? '**absent**'} |`);
  out.push('| Checkpoints (He8) | **ON** — the log is compacted below the published watermark |');
  out.push('');

  out.push(
    '> ## ⚠️ Node-measured. One on-device Hermes anchor is still owed before He3 perf claims.\n> \n' +
      '> Every millisecond below was produced by V8 on a developer laptop. Nothing here has run ' +
      'on a phone. The plan\'s DoD for He10 lists that anchor explicitly and it is **NOT DONE**: ' +
      'until one exists, the Hermes columns are an arithmetic projection over the audit\'s 3-15x ' +
      'band, not a measurement, and no He3 performance claim may cite this document as device ' +
      'evidence.',
  );
  out.push('');

  if (model.loadOverridden) {
    out.push(
      '> **WARNING — load gate overridden.** At least one record was captured above ' +
        `loadavg 3.0 (SCALE_ALLOW_LOAD=1, loadavg[0] ${env.loadavg1}). These numbers are ` +
        'provisional: they include scheduling noise from whatever else the machine was doing. ' +
        'Re-take on a quiet machine before quoting them as a baseline.',
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

  // ---- the Exit table, first ------------------------------------------
  out.push('## 1. He10 Exit criteria — the plan\'s normative fail table');
  out.push('');
  out.push(
    verdict?.scale
      ? `Graded on the **${verdict.scale.key}** corpus (${verdict.scale.scale?.rows.toLocaleString('en-US')} rows, ` +
          `${verdict.scale.scale?.ops.toLocaleString('en-US')} ops), with checkpoints ON.`
      : '',
  );
  out.push('');
  out.push(exit);
  out.push('');
  out.push(
    '**Which number is gated.** The plan gates "on the Hermes-estimated 10-year corpus". The ' +
      'audit\'s Hermes penalty is a BAND (3-15x), not a constant, so the gate runs at the ' +
      '**optimistic** end: a breach at x3 fails even if Hermes turns out to be at its friendliest, ' +
      'and is therefore unambiguous. **A PASS at x3 is explicitly NOT a pass at x15** — read the ' +
      'worst-case column before treating any row here as headroom. `SCALE_HERMES_MULTIPLIER` ' +
      'overrides the gate multiplier once an on-device anchor replaces the band with a measurement.',
  );
  out.push('');
  if (verdict && !verdict.allPass) {
    out.push(
      '> ❌ **AT LEAST ONE THRESHOLD IS BREACHED.** Per plan §4 this **descopes Wave C** ' +
        '(cycle / fridge / foods stay on D1 or disabled) unless N5-style mitigations — stamp ' +
        'interning → column pruning → field grouping — close the gap. Do not silently ship. ' +
        'The scale phase that measured it FAILS, so this cannot be missed by reading past a table.',
    );
    out.push('');
  }

  // ---- the phases -------------------------------------------------------
  out.push('Scales (rows / ops, from the pinned generator):');
  out.push('');
  out.push('| Scale | Rows | Ops |');
  out.push('|---|---|---|');
  for (const s of scales) {
    if (!s.scale) continue;
    out.push(`| ${s.key} | ${s.scale.rows.toLocaleString('en-US')} | ${s.scale.ops.toLocaleString('en-US')} |`);
  }
  out.push('');
  out.push(
    '`1a` is one ADULT, not one device: a Health household has exactly one user (plan §1.2) and ' +
      'the generator pins it. The multi-device property that makes the op log interleaved is two ' +
      'DEVICES, one of them 30 days behind.',
  );
  out.push('');

  let n = 2;
  for (const [phase, title] of Object.entries(PHASE_TITLES)) {
    const metrics = model.phases.get(phase);
    if (!metrics) continue;
    const shown = new Map([...metrics.entries()].filter(([name]) => !name.startsWith('exit.') && !name.startsWith('homehydrate.loader.')));
    out.push(`## ${n}. ${title}`);
    n += 1;
    out.push('');
    out.push(table(shown, scales));
    out.push('');
    if (phase === 'homehydrate' && breakdown) {
      out.push(`### Per-loader breakdown (${breakdown.scale.key})`);
      out.push('');
      out.push(
        'The seventeen are modelled against the ledger, not imported: every `load*()` in ' +
          '`src/features/health/health*Storage.ts` pulls `@api/health` and `@services/storage`, ' +
          'which do not resolve outside the mobile tsconfig, and today they read an MMKV cache the ' +
          'network filled — measuring that would answer the wrong question. Four of the seventeen ' +
          '(`loadHealthPrefs`, `loadNoteForDate`, `loadHomeLayout`, `loadChallengesWidgetExpanded`) ' +
          'stay in MMKV by design and are modelled as the small key read they are.',
      );
      out.push('');
      out.push(breakdown.table);
      out.push('');
    }
    out.push(
      `_${HERMES_CAVEAT} Each metric is shown at the statistic it is graded on — min for sizes and ` +
        'one-shot figures, p50 for timings, where every sample walks a different prefix of a linear ' +
        'scan and min reports the luckiest one. The Exit gate above reads **p95**._',
    );
    out.push('');
  }

  // ---- caveats ----------------------------------------------------------
  out.push('## What this does NOT measure');
  out.push('');
  out.push(
    '- **Hermes.** Every number is V8. ⚠️ **One on-device Hermes anchor is still owed before any ' +
      'He3 performance claim cites this document.** The 3-15x band is the audit\'s, it varies per ' +
      'operation (string building and pure-JS crypto are worst), and no millisecond here is a ' +
      'device millisecond.',
  );
  out.push(
    '- **The SQLite read itself.** `coldopen.listRows` runs against `MemoryLocalFirstStore`, not ' +
      '`SqliteLocalFirstStore`, and is reported separately for exactly that reason — the only ' +
      'off-device driver is a fake whose lookups are `Array.some`. Quote `coldopen.cpu` and ' +
      '`coldopen.toFirstPaint`, both of which exclude it.',
  );
  out.push(
    '- **React.** `coldopen.toFirstPaint` ends when the 17-loader `Promise.all` resolves. The ' +
      'state commits and the render pass that follow are real cost this harness cannot reach from ' +
      'Node, so the first-paint figure is a FLOOR even before the Hermes multiplier.',
  );
  out.push(
    '- **Real Ed25519.** Op signatures in the corpus are 64 pseudo-random bytes: correct for size ' +
      'and for the persist/batch paths, silent about verify cost.',
  );
  out.push(
    '- **The full-log replay.** With checkpoints ON a cold open replays only the unpublished tail ' +
      '(≤100 ops), which is what the plan asks for. `coldopen.fullLogReplay.projectedMs` is ' +
      'DECLARED ARITHMETIC over the measured per-op tail cost, not a measurement — it exists to put ' +
      'a number on what He8 buys.',
  );
  out.push(
    '- **Sync itself.** No relay, no chunk round trip, no second device applying what a first one ' +
      'produced. The corpus does carry a two-device op log and a populated LWW watermark map, so ' +
      'the merge machinery is under load, but delivery is not.',
  );
  out.push(
    '- **HealthKit.** Wave B (He11a) adds a `healthkit` source and re-fires the same hydrate after ' +
      'every sync (`useHealthKitSyncHydration`). The corpus is manual-source only, so ' +
      '`homehydrate.onFocus` is the closest thing here to that second hydrate.',
  );
  out.push('');
  out.push('## How to re-run');
  out.push('');
  out.push('```sh');
  out.push('scripts/e2e/lib/health-scale-bench.sh guard      # cheap corpus + realism guards');
  out.push('scripts/e2e/lib/health-scale-bench.sh run        # measure, write JSONL');
  out.push('scripts/e2e/lib/health-scale-bench.sh baseline   # run + regenerate this file');
  out.push('scripts/e2e/lib/health-scale-bench.sh compare /tmp/symply-scale/<runId>.jsonl');
  out.push('```');
  out.push('');
  out.push(
    'The phases **assert** the Exit table: a breach fails the vitest run, not just this document. ' +
      '`compare` additionally exits non-zero on a regression beyond tolerance in either direction, ' +
      'on a metric present in the baseline but missing from the run, on a crashed phase, and on a ' +
      'run whose corpus fingerprint differs from the baseline\'s.',
  );
  out.push('');

  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length !== 1) {
    process.stderr.write('usage: health-scale-report.mjs <run.jsonl> --markdown out.md\n');
    process.exit(2);
  }
  const model = shape(readRecords(positional[0]));
  const markdown = renderMarkdown(model, gitInfo());
  if (flags.markdown && typeof flags.markdown === 'string') {
    writeFileSync(flags.markdown, markdown);
    process.stdout.write(`wrote ${flags.markdown}\n`);
  } else {
    process.stdout.write(markdown);
  }
}

main();
