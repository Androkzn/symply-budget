#!/usr/bin/env node
/**
 * Visual + backend Maestro test report.
 *
 * Turns a Maestro run into a single browsable HTML report per flow: every UI
 * step (tap/assert/openLink/type/swipe/...) shown with its screenshot AND the
 * exact backend calls it triggered (method, path, status, ok/FAIL), plus any
 * e2e-verify-network / e2e-verify-no-network PASS/FAIL result. Answers "what
 * did we check, front AND back, for this action" — not just a pass/fail count.
 *
 * How it works: Maestro already writes commands.json per flow with a real
 * epoch-ms timestamp + status + screenshot path for every step. The app's
 * console logging ([E2E-NET] / [E2E-VERIFY] / [E2E-DB] / [E2E-R2] / [E2E-WS])
 * stamps every line with [t=<epoch ms>] (see src/api/e2eTestObservability.ts).
 * This script matches those lines to the UI step whose time window they fall in.
 *
 * Summary columns, for a local-first suite (Budget) as much as a REST one:
 *   Local writes  — E2E-DB row persist (+ rows actually written)
 *   Sync          — E2E-DB operation=SYNC (mailbox/peer), failed ones counted
 *                   separately, ↑ ops pushed / ↓ ops applied from peers
 *   Conflicts     — peak unresolved CRDT conflicts observed at sync time
 *   Verify checks — e2e-verify-network / -no-network / -persist assertions
 * Columns a suite produced nothing for (sync, uploads, ws, warned) are hidden
 * rather than rendered as a column of zeros.
 *
 * Usage:
 *   node scripts/e2e/generate-report.mjs \
 *     --maestro-dir ~/.maestro/tests/2026-07-31_113428 \
 *     --metro-log /private/tmp/metro-house-run2.log \
 *     --out /private/tmp/e2e-report
 *
 *   --maestro-dir may be a single flow dir (contains commands.json directly)
 *   or a run root containing multiple flow subdirs — both work, and a run
 *   root produces one HTML per flow plus an index.html.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    maestroDir: null,
    metroLog: null,
    out: null,
    flowsConfig: null,
    platform: null,
    environment: null,
    buildNumber: null,
    device: null,
    // Brand identity for the header. Source of truth is brands/<id>/brand.cjs
    // (displayName + assets.appIcon); the runner reads it and passes it in, so
    // this stays brand-agnostic. --app-logo is a path on disk, inlined as a
    // data URI below — the report HTML is committed and must render standalone,
    // and a relative link out to brands/ breaks the moment the report is opened
    // from anywhere but this checkout.
    appName: null,
    appLogo: null,
    // Shell-orchestrated suites (e.g. the two-device multi-member runner) have
    // no Maestro workspace config to size the progress bar from — they know
    // their own flow count, so let them state it directly.
    progressTotal: null,
    // The run has ENDED — set only by a suite's post-exit regeneration. Without
    // it, "finished?" is inferred from completed === total, so a wrong
    // --progress-total leaves a finished run reading "In progress" forever
    // (hit 2026-08-11: the multi-member count said 19 for an 18-flow suite and
    // a fully green run reported 95%, In progress).
    final: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--maestro-dir') args.maestroDir = argv[++i];
    else if (a === '--metro-log') args.metroLog = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--flows-config') args.flowsConfig = argv[++i];
    else if (a === '--platform') args.platform = argv[++i];
    else if (a === '--environment') args.environment = argv[++i];
    else if (a === '--build-number') args.buildNumber = argv[++i];
    else if (a === '--device') args.device = argv[++i];
    else if (a === '--app-name') args.appName = argv[++i];
    else if (a === '--app-logo') args.appLogo = argv[++i];
    else if (a === '--progress-total') args.progressTotal = Number(argv[++i]) || null;
    else if (a === '--verdicts') args.verdicts = argv[++i];
    else if (a === '--final') args.final = true;
  }
  return args;
}

/**
 * The RUNNER's own PASS/FAIL per step, parsed from its summary log.
 *
 * Maestro's commands.json records only the commands it managed to execute, so
 * a flow that died mid-way (driver drop, app crash, unmet assertion after the
 * last recorded command) still reads as "COMPLETED · 0 failed" here. A report
 * that calls a failed run green is worse than no report, so when the runner
 * hands over its verdicts they take precedence for the headline status.
 */
function parseVerdicts(file) {
  if (!file || !existsSync(file)) return null;
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(PASS|FAIL)\s+\[([^\]]+)\]\s+(\S+)/);
    if (m) out.push({ status: m[1], device: m[2], flow: m[3] });
  }
  return out.length ? out : null;
}

function renderVerdicts(verdicts) {
  if (!verdicts) return '';
  const failed = verdicts.filter((v) => v.status === 'FAIL');
  const passed = verdicts.length - failed.length;
  const failList = failed
    .map((v) => `<span class="verdict-fail">${esc(v.flow)} <em>[${esc(v.device)}]</em></span>`)
    .join('');
  // These are FLOW verdicts, one line per flow in the runner's summary log —
  // calling them "step(s)" read as a step-level count and made a 1-flow run
  // look like it had failed 1 of 0 steps (2026-08-25).
  return (
    `<div class="verdicts"><span class="verdict-count">${passed} flow(s) passed` +
    `${failed.length ? ` · <b>${failed.length} failed</b>` : ''}</span>${failList}</div>`
  );
}

// Optional: --flows-config points at a Maestro workspace config.yaml with an
// executionOrder.flowsOrder list — read only to size the progress bar (total
// flow count expected this run); commented-out entries (`# - foo`, used to
// exclude a known-flaky flow without deleting its place in the list) don't
// count. Returns null if not given or unreadable, in which case the report
// just omits the progress bar rather than guessing a total.
function parseFlowsOrder(configPath) {
  if (!configPath || !existsSync(configPath)) return null;
  const lines = readFileSync(configPath, 'utf8').split('\n');
  const flows = [];
  let inList = false;
  for (const line of lines) {
    if (/^\s*flowsOrder:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*([A-Za-z0-9_-]+)\s*$/);
    if (item) {
      flows.push(item[1]);
      continue;
    }
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue; // comment/blank: stay in the list
    if (/^\S/.test(line)) break; // dedented to a new top-level key: list is over
  }
  return flows.length ? flows : null;
}

// Which flow Maestro most recently started, per the run's own maestro.log —
// "in progress" if it hasn't produced a commands.json yet (i.e. isn't in
// completedNames), otherwise it already finished and the log line is stale.
function currentRunningFlow(maestroDir, completedNames) {
  const logPath = path.join(maestroDir, 'maestro.log');
  if (!existsSync(logPath)) return null;
  const text = readFileSync(logPath, 'utf8');
  const matches = [...text.matchAll(/TestSuiteInteractor\.runFlow:\s+Running flow (\S+)/g)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (!completedNames.has(matches[i][1])) return matches[i][1];
  }
  return null;
}

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// ---------- commands.json -> flat step list ----------

const LEAF_TYPES = new Set([
  'tapOnElement',
  'assertConditionCommand',
  'openLinkCommand',
  'inputTextCommand',
  'swipeCommand',
  'scrollUntilVisibleCommand',
  'hideKeyboardCommand',
  'launchAppCommand',
  'stopAppCommand',
  'eraseTextCommand',
  'extendedWaitUntilCommand',
]);
const CONTAINER_TYPES = new Set([
  'runFlowCommand',
  'repeatCommand',
  'applyConfigurationCommand',
  'defineVariablesCommand',
]);

function flattenCommands(commands, acc) {
  for (const entry of commands ?? []) {
    const cmdKey = Object.keys(entry.command ?? {})[0];
    const meta = entry.metadata ?? {};
    const evaluated = meta.evaluatedCommand ?? entry.command ?? {};

    if (LEAF_TYPES.has(cmdKey) && meta.status && meta.status !== 'SKIPPED') {
      acc.push({
        seq: meta.sequenceNumber ?? acc.length,
        depth: meta.depth ?? 0,
        timestamp: meta.timestamp ?? null,
        duration: meta.duration ?? 0,
        status: meta.status,
        type: cmdKey,
        detail: evaluated[cmdKey] ?? entry.command[cmdKey],
        artifacts: meta.artifacts ?? [],
      });
    }

    if (CONTAINER_TYPES.has(cmdKey)) {
      const nested = evaluated[cmdKey]?.commands;
      if (Array.isArray(nested)) flattenCommands(nested, acc);
    }
  }
  return acc;
}

function labelForStep(step) {
  const d = step.detail ?? {};
  switch (step.type) {
    case 'tapOnElement': {
      const sel = d.selector ?? {};
      const target = sel.idRegex ? `id="${sel.idRegex}"` : sel.textRegex ? `text="${sel.textRegex}"` : sel.point ? `point ${sel.point}` : 'element';
      return `Tap ${target}`;
    }
    case 'assertConditionCommand': {
      const cond = d.condition ?? {};
      if (cond.visible) {
        const v = cond.visible;
        const target = v.idRegex ? `id="${v.idRegex}"` : v.textRegex ? `text="${v.textRegex}"` : 'element';
        return `Assert visible: ${target}`;
      }
      if (cond.notVisible) {
        const v = cond.notVisible;
        const target = v.idRegex ? `id="${v.idRegex}"` : v.textRegex ? `text="${v.textRegex}"` : 'element';
        return `Assert NOT visible: ${target}`;
      }
      return 'Assert condition';
    }
    case 'extendedWaitUntilCommand': {
      const v = d.visibility?.idRegex ?? d.visibility?.textRegex ?? d.notVisibility?.idRegex ?? d.notVisibility?.textRegex;
      return `Wait until ${d.notVisibility ? 'NOT visible' : 'visible'}: ${v ?? 'element'}`;
    }
    case 'openLinkCommand':
      return `Open link: ${d.link ?? ''}`;
    case 'inputTextCommand':
      return `Type: "${d.text ?? ''}"`;
    case 'swipeCommand':
      return `Swipe ${d.direction ?? ''}`.trim();
    case 'scrollUntilVisibleCommand': {
      const sel = d.selector ?? {};
      return `Scroll until visible: ${sel.idRegex ?? sel.textRegex ?? 'element'}`;
    }
    case 'hideKeyboardCommand':
      return 'Hide keyboard';
    case 'launchAppCommand':
      return 'Launch app';
    case 'stopAppCommand':
      return 'Stop app';
    case 'eraseTextCommand':
      return 'Erase text';
    default:
      return step.type;
  }
}

/** Deep-link openLink steps get a friendlier label + parsed intent for our own e2e-* observability links. */
function classifyOpenLink(link) {
  if (!link) return null;
  const m = link.match(/^[a-z-]+:\/\/(e2e-[a-z-]+)\??(.*)$/i);
  if (!m) return null;
  const [, host, query] = m;
  const params = Object.fromEntries(new URLSearchParams(query));
  return { host, params };
}

// ---------- metro log -> timestamped events ----------

function parseMetroLog(logPath) {
  if (!logPath || !existsSync(logPath)) return [];
  const text = readFileSync(logPath, 'utf8');
  const events = [];
  // E2E-NET/R2/WS/DB/UI are all recorded by src/api/e2eTestObservability.ts
  // (network, R2 uploads, WebSocket, local persistence, and UI events,
  // respectively) — every kind it emits must be captured here or it's
  // silently dropped from the report despite the app having logged it.
  const re = /\[(E2E-NET|E2E-VERIFY|E2E-TAG|E2E-R2|E2E-WS|E2E-DB|E2E-UI)\]\s+\[t=(\d+)\]\s+(.*)/;
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    events.push({ kind: m[1], timestamp: Number(m[2]), message: m[3].trim() });
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

function parseNetEvent(message) {
  // "GET /path → 200 ok detail=... matrix=..."
  const m = message.match(/^(\w+)\s+(\S+)\s+→\s+(\S+)\s+(ok|FAIL)(?:\s+detail=(\S+))?(?:\s+matrix=(\S+))?/);
  if (!m) return { raw: message };
  return { method: m[1], url: m[2], status: m[3], ok: m[4] === 'ok', detail: m[5], matrix: m[6] };
}

function parseR2Event(message) {
  // "PUT host/path → 200 ok label=... detail=... matrix=..."
  const m = message.match(/^PUT\s+(\S+)\s+→\s+(\S+)\s+(ok|FAIL)(?:\s+label=(\S+))?(?:\s+detail=(\S+))?(?:\s+matrix=(\S+))?/);
  if (!m) return { raw: message };
  return { target: m[1], status: m[2], ok: m[3] === 'ok', label: m[4], detail: m[5], matrix: m[6] };
}

/** E2E-DB line: "UPSERT budget_sqlite rows=3 …" or "SYNC budget_mailbox applied=1 …" */
function dbOperation(message) {
  const op = message.split(/\s+/, 1)[0];
  return op && op !== message ? op : '';
}

function isDbSyncEvent(e) {
  return e.kind === 'E2E-DB' && dbOperation(e.message) === 'SYNC';
}

function isDbWriteEvent(e) {
  if (e.kind !== 'E2E-DB') return false;
  const op = dbOperation(e.message);
  return op !== '' && op !== 'SYNC' && op !== 'READ' && e.message !== 'buffer cleared';
}

function countEvents(steps, pred) {
  return steps.reduce((n, s) => n + s.events.filter(pred).length, 0);
}

function sumEvents(steps, pred, value) {
  return steps.reduce((n, s) => n + s.events.filter(pred).reduce((k, e) => k + value(e), 0), 0);
}

function num(message, key) {
  const m = message.match(new RegExp(`\\b${key}=(\\d+)`));
  return m ? Number(m[1]) : 0;
}

/** Rows a persist line actually touched — "rows=3", or "projected=2" for a re-projection. */
function dbWriteRows(e) {
  return num(e.message, 'rows') || num(e.message, 'projected') || 0;
}

/**
 * A sync attempt that did NOT complete — the orchestrator logs the failure
 * through the same operation=SYNC channel ("SYNC budget_mailbox FAIL
 * code=offline"), so counting SYNC lines alone scores a dead sync as a
 * healthy one.
 */
function isFailedSyncEvent(e) {
  return isDbSyncEvent(e) && /\bFAIL\b/.test(e.message);
}

function flowMetrics(steps) {
  const netCalls = countEvents(steps, (e) => e.kind === 'E2E-NET');
  const netFails = countEvents(steps, (e) => e.kind === 'E2E-NET' && !parseNetEvent(e.message).ok);
  const persistWrites = countEvents(steps, isDbWriteEvent);
  const persistRows = sumEvents(steps, isDbWriteEvent, dbWriteRows);
  const syncEvents = countEvents(steps, isDbSyncEvent);
  const syncFails = countEvents(steps, isFailedSyncEvent);
  const opsPushed = sumEvents(steps, isDbSyncEvent, (e) => num(e.message, 'pushedOps'));
  const opsApplied = sumEvents(steps, isDbSyncEvent, (e) => num(e.message, 'applied'));
  // Conflicts is a GAUGE (getLocalConflicts().length at sync time), not a
  // per-sync delta — summing it would multiply one unresolved conflict by the
  // number of syncs that observed it. The peak is the honest number.
  const conflicts = steps.reduce(
    (max, s) => s.events.filter(isDbSyncEvent).reduce((k, e) => Math.max(k, num(e.message, 'conflicts')), max),
    0
  );
  const uploads = countEvents(steps, (e) => e.kind === 'E2E-R2');
  const wsEvents = countEvents(steps, (e) => e.kind === 'E2E-WS');
  const verifyChecks = countEvents(steps, (e) => e.kind === 'E2E-VERIFY');
  const verifyFails = countEvents(steps, (e) => e.kind === 'E2E-VERIFY' && e.message.startsWith('FAIL'));
  return {
    netCalls,
    netFails,
    persistWrites,
    persistRows,
    syncEvents,
    syncFails,
    opsPushed,
    opsApplied,
    conflicts,
    uploads,
    wsEvents,
    verifyChecks,
    verifyFails,
  };
}

/** Wall clock of the flow: first step start → last step end. */
function flowDurationMs(steps) {
  const stamped = steps.filter((s) => s.timestamp != null);
  if (stamped.length === 0) return 0;
  const first = stamped[0];
  const last = stamped[stamped.length - 1];
  return Math.max(0, last.timestamp + (last.duration ?? 0) - first.timestamp);
}

function formatDuration(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Which device ran each flow, for suites that drive more than one simulator.
 *
 * Maestro's commands.json says nothing about the device, but the runner's
 * summary log does ("PASS [A] mm-01-signin"), in run order. The aggregated
 * flow dirs are named "<timestamp>__<flow>", so sorting them chronologically
 * and consuming the verdicts of that flow name in order pairs them up — which
 * matters because a two-device suite runs the SAME flow name on A and B.
 */
function assignDevices(summaries, verdicts) {
  if (!verdicts) return;
  const queues = new Map();
  for (const v of verdicts) {
    if (!queues.has(v.flow)) queues.set(v.flow, []);
    queues.get(v.flow).push({ device: v.device, status: v.status });
  }
  for (const s of summaries) {
    const bare = s.name.replace(/^\d{4}-\d{2}-\d{2}_\d{6}__/, '');
    const queue = queues.get(bare);
    const entry = queue && queue.length ? queue.shift() : null;
    s.device = entry ? entry.device : null;
    // Carry the runner's OWN verdict onto the flow, not just the device name.
    // Without it the headline (which trusts the runner) and the per-flow rows
    // (which trust commands.json) can disagree on the same run: 2026-08-25
    // showed "✕ Tested · 1 failed" above a row reading "✓ COMPLETED · 136/136
    // steps passed", because the flow died on an assertNotVisible AFTER its
    // last recorded command. A report that contradicts itself is not
    // trustworthy, so the verdict has to reach the row too.
    s.runnerStatus = entry ? entry.status : null;
  }
}

/**
 * A flow failed if EITHER Maestro recorded a failed step or the runner called
 * it a failure. See `parseVerdicts` — commands.json cannot see a failure that
 * happens after the last command it recorded.
 */
function flowFailed(f) {
  return f.failed > 0 || f.runnerStatus === 'FAIL';
}

// ---------- correlate steps <-> events ----------

function attachEvents(steps, events) {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.timestamp == null) {
      step.events = [];
      continue;
    }
    const windowEnd = i + 1 < steps.length && steps[i + 1].timestamp != null
      ? steps[i + 1].timestamp
      : step.timestamp + Math.max(step.duration, 3000);
    step.events = events.filter((e) => e.timestamp >= step.timestamp && e.timestamp < windowEnd);
  }
  return steps;
}

// ---------- HTML rendering ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Platform/environment/build number/device are supplied by the runner
// wrapper (it knows which suite script, which brand.cjs, and which
// simulator/emulator it invoked) rather than derived here — commands.json/
// metro log carry no such fields themselves. Any of the four can be absent
// (e.g. a manual one-off invocation without the run-info flags) — render
// only what was actually passed rather than a row of "unknown"s.
// Environment is the one field worth colour-coding on sight: reading a
// production run as if it were staging is the expensive mistake.
const ENV_TONE = {
  production: ['#b60205', '#ffebe9', '🚨'],
  prod: ['#b60205', '#ffebe9', '🚨'],
  staging: ['#9a6700', '#fff8c5', '🧪'],
  local: ['#0969da', '#ddf4ff', '💻'],
};

/**
 * Inline the brand logo as a data URI. Returns '' when the file is missing or
 * unreadable — a report is still useful without a logo, so never throw here.
 */
function inlineLogo(logoPath) {
  if (!logoPath) return '';
  const abs = path.isAbsolute(logoPath) ? logoPath : path.join(process.cwd(), logoPath);
  if (!existsSync(abs)) {
    console.warn(`[generate-report] --app-logo not found, header logo omitted: ${abs}`);
    return '';
  }
  try {
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    let src = abs;
    // index.html is committed. A full-size app icon (~300-500 KB) inlines to
    // ~650 KB of base64 on EVERY run directory, so downscale a large raster to
    // header size first. sips is macOS-only, which is where these suites run;
    // if it is missing, ship without a logo rather than commit the bloat.
    const LOGO_MAX_BYTES = 32 * 1024;
    if (ext !== '.svg' && statSync(abs).size > LOGO_MAX_BYTES) {
      const scaled = path.join(os.tmpdir(), `symply-report-logo-${path.basename(abs)}`);
      const r = spawnSync('sips', ['-Z', '96', abs, '--out', scaled], { stdio: 'ignore' });
      if (r.status === 0 && existsSync(scaled) && statSync(scaled).size <= LOGO_MAX_BYTES) {
        src = scaled;
      } else {
        console.warn(
          `[generate-report] --app-logo is ${Math.round(statSync(abs).size / 1024)} KB and could not be downscaled; omitting to keep the committed report small: ${abs}`
        );
        return '';
      }
    }
    const buf = readFileSync(src);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    // Warn rather than swallow — a silent catch here hid a bad import once and
    // the logo just never appeared, with nothing to explain why.
    console.warn(`[generate-report] could not inline --app-logo (${abs}): ${e.message}`);
    return '';
  }
}

function platformIcon(platform) {
  const p = String(platform).toLowerCase();
  if (p.includes('android')) return '🤖';
  if (p.includes('ios') || p.includes('ipad') || p.includes('iphone')) return '📱';
  return '🖥';
}

function chip(icon, label, value, color, bg) {
  return (
    `<span class="chip" style="color:${color};background:${bg};border-color:${color}33">` +
    `<span class="chip-ico">${icon}</span>` +
    `<span class="chip-key">${esc(label)}</span>` +
    `<span class="chip-val">${esc(value)}</span></span>`
  );
}

function renderRunInfo(runInfo) {
  if (!runInfo) return '';
  const chips = [];
  if (runInfo.platform) {
    chips.push(chip(platformIcon(runInfo.platform), 'Platform', runInfo.platform, '#24292f', '#f6f8fa'));
  }
  if (runInfo.environment) {
    const [color, bg, ico] = ENV_TONE[String(runInfo.environment).toLowerCase()] ?? ['#57606a', '#f6f8fa', '⚙'];
    chips.push(chip(ico, 'Env', runInfo.environment, color, bg));
  }
  if (runInfo.buildNumber) {
    chips.push(chip('🏷', 'Build', runInfo.buildNumber, '#8250df', '#fbefff'));
  }
  if (runInfo.device) {
    // A two-device run passes "A+B" — split it so each simulator reads as its
    // own chip rather than one long unreadable string.
    for (const d of String(runInfo.device).split('+')) {
      chips.push(chip('📲', 'Device', d.trim(), '#0550ae', '#ddf4ff'));
    }
  }
  if (!chips.length) return '';
  return `<div class="chips">${chips.join('')}</div>`;
}

// Top-level verdict, so the state of the run is legible before reading a
// single row: still going, finished clean, or finished with failures.
function renderRunStatus(progress, totalFailed, verdicts, isFinal) {
  const runnerFailed = verdicts ? verdicts.filter((v) => v.status === 'FAIL').length : 0;
  // Runner verdicts win: they see failures commands.json cannot.
  const failedCount = runnerFailed || totalFailed;
  // `--final` is the suite saying "I have exited". Only fall back to counting
  // flows when nobody told us, because the count is an estimate the runner
  // supplies by hand and a stale one must not outrank a real ending.
  const running = !isFinal && progress && progress.total && progress.completed < progress.total;
  if (running) {
    return `<span class="run-status running"><span class="dot"></span>In progress</span>`;
  }
  if (failedCount > 0) {
    return `<span class="run-status failed">✕ Tested · ${failedCount} failed</span>`;
  }
  // A run that ENDED without reaching its flow total did not pass — it stopped.
  //
  // "all passed" here is the most dangerous line the report can print: every
  // flow that ran was green, so nothing looks wrong, and the fourteen flows that
  // never ran are invisible. That is how an aborted run — a dropped XCUITest
  // driver, a fail-fast exit, a kill — gets read as a clean suite.
  if (isFinal && progress && progress.total && progress.completed < progress.total) {
    return `<span class="run-status stopped">◐ Stopped early · ${progress.completed} of ${progress.total} flows ran</span>`;
  }
  return `<span class="run-status passed">✓ Tested · all passed</span>`;
}

function statusBadge(status) {
  const map = { COMPLETED: ['#1a7f37', '#dafbe1', '✓'], FAILED: ['#b60205', '#ffebe9', '✕'], WARNED: ['#9a6700', '#fff8c5', '!'] };
  const [color, bg, glyph] = map[status] ?? ['#57606a', '#f6f8fa', '•'];
  return `<span class="badge" style="color:${color};background:${bg}">${glyph} ${esc(status)}</span>`;
}

// A step's raw Maestro status is WARNED whenever an `optional: true` command's
// condition wasn't met — a deliberate, no-action-needed outcome (see
// stepOptionalInfo/renderWarnedExplanation). Counting every one of those
// toward "N warned" trains readers to ignore the count (or re-investigate a
// false alarm every time) — so anything WARNED-and-optional is "noteworthy"
// only if it DOESN'T have that explanation (Maestro emitting WARNED for some
// other, currently unobserved reason), which is worth a look.
function isNoteworthyWarned(step) {
  return step.status === 'WARNED' && stepOptionalInfo(step) === null;
}

function stepBadge(step) {
  if (step.status === 'WARNED' && !isNoteworthyWarned(step)) {
    return `<span class="badge" style="color:#57606a;background:#f6f8fa">○ OPTIONAL</span>`;
  }
  return statusBadge(step.status);
}

function renderEventLine(e) {
  if (e.kind === 'E2E-NET') {
    const n = parseNetEvent(e.message);
    if (n.raw) return `<div class="ev net">${esc(n.raw)}</div>`;
    const cls = n.ok ? 'ok' : 'fail';
    return `<div class="ev net ${cls}"><span class="pill">${esc(n.method)}</span> ${esc(n.url)} → <b>${esc(n.status)}</b> ${n.ok ? 'ok' : 'FAIL'}${n.detail ? ` <span class="muted">detail=${esc(n.detail)}</span>` : ''}${n.matrix ? ` <span class="tag">${esc(n.matrix)}</span>` : ''}</div>`;
  }
  if (e.kind === 'E2E-VERIFY') {
    const cls = e.message.startsWith('PASS') ? 'ok' : e.message.startsWith('FAIL') ? 'fail' : '';
    return `<div class="ev verify ${cls}">🔍 ${esc(e.message)}</div>`;
  }
  if (e.kind === 'E2E-TAG') {
    return `<div class="ev tag">🏷 ${esc(e.message)}</div>`;
  }
  if (e.kind === 'E2E-R2') {
    const n = parseR2Event(e.message);
    if (n.raw) return `<div class="ev net">📦 ${esc(n.raw)}</div>`;
    const cls = n.ok ? 'ok' : 'fail';
    return `<div class="ev net ${cls}">📦 <span class="pill">PUT</span> ${esc(n.target)} → <b>${esc(n.status)}</b> ${n.ok ? 'ok' : 'FAIL'}${n.label ? ` <span class="muted">label=${esc(n.label)}</span>` : ''}${n.detail ? ` <span class="muted">detail=${esc(n.detail)}</span>` : ''}${n.matrix ? ` <span class="tag">${esc(n.matrix)}</span>` : ''}</div>`;
  }
  if (e.kind === 'E2E-WS') {
    return `<div class="ev">🔌 ${esc(e.message)}</div>`;
  }
  if (e.kind === 'E2E-DB') {
    if (isDbSyncEvent(e)) {
      return `<div class="ev">🔄 ${esc(e.message)}</div>`;
    }
    return `<div class="ev">💾 ${esc(e.message)}</div>`;
  }
  if (e.kind === 'E2E-UI') {
    return `<div class="ev">👆 ${esc(e.message)}</div>`;
  }
  return `<div class="ev">${esc(e.message)}</div>`;
}

// A WARNED step is, in every case observed so far, an `optional: true`
// command whose condition wasn't met within its timeout — Maestro's designed
// distinction from FAILED (a REQUIRED condition not met, which does need
// fixing). optional/timeout live in different spots per command type:
// assertConditionCommand/extendedWaitUntilCommand carry `optional`+`timeout`
// at the top level; tapOnElement carries `optional` at the top level (and
// mirrors it onto `selector.optional`, which is not itself meaningful).
function stepOptionalInfo(step) {
  const d = step.detail ?? {};
  if (d.optional !== true) return null;
  return { timeout: d.timeout ?? null };
}

function renderWarnedExplanation(step) {
  if (step.status !== 'WARNED') return '';
  const opt = stepOptionalInfo(step);
  if (!opt) {
    // Observed WARNED always pairs with optional:true; if that ever isn't the
    // case, this IS worth a look — keep it visually distinct (amber), unlike
    // the benign case below.
    return `<div class="warned-note noteworthy">⚠ WARNED — status reported by Maestro, but this step isn't marked <code>optional: true</code> in its own command data. Reason unclear from commands.json; check maestro.log for this step's sequence number.</div>`;
  }
  const timeoutMs = opt.timeout ? `${opt.timeout}ms` : 'its timeout';
  return `<div class="warned-note benign">○ Optional check — condition wasn't met within ${esc(timeoutMs)}, but this step is marked <code>optional: true</code> in the flow, so it did NOT fail the run. This is normally a deliberate best-effort/conditional check (e.g. "dismiss this screen if it happens to be showing") — expected whenever that branch doesn't apply this run, not a bug. Excluded from the warned count above; not counted as noteworthy.</div>`;
}

function renderStep(step, flowDir, assetsDir, flowSlug) {
  const shot = step.artifacts.find((a) => a.type === 'SCREENSHOT');
  let shotHtml = '';
  if (shot) {
    const src = path.join(flowDir, shot.path);
    if (existsSync(src)) {
      const destName = `${flowSlug}-${path.basename(shot.path)}`;
      copyFileSync(src, path.join(assetsDir, destName));
      shotHtml = `<a class="shot-link" href="assets/${destName}" target="_blank"><img class="shot" src="assets/${destName}" loading="lazy" /></a>`;
    }
  }

  let label = labelForStep(step);
  const linkInfo = step.type === 'openLinkCommand' ? classifyOpenLink(step.detail?.link) : null;
  if (linkInfo) {
    const { host, params } = linkInfo;
    if (host === 'e2e-verify-network') {
      label = `🔍 Verify backend: ${params.method ?? 'GET'} ${params.path ?? ''}${params.status ? ` expect ${params.status}` : ''}`;
    } else if (host === 'e2e-verify-no-network') {
      label = `🔍 Verify NO call fired: ${params.method ?? '*'} ${params.path ?? ''}`;
    } else if (host === 'e2e-clear-log') {
      label = '🧹 Clear observability log';
    } else if (host === 'e2e-tag-matrix') {
      label = `🏷 Tag matrix row: ${params.row ?? ''}`;
    } else if (host === 'e2e-dump-log') {
      label = '📋 Dump observability snapshot';
    }
  }

  const eventsHtml = step.events.length
    ? `<div class="events">${step.events.map(renderEventLine).join('')}</div>`
    : '';

  const cssStatus = isNoteworthyWarned(step) ? 'warned' : step.status === 'WARNED' ? 'completed' : step.status.toLowerCase();
  return `
  <div class="step ${cssStatus}" id="step-${step.seq}">
    <div class="step-head">
      <span class="seq">#${step.seq}</span>
      ${stepBadge(step)}
      <span class="label">${esc(label)}</span>
      <span class="dur muted">${step.duration}ms</span>
    </div>
    <div class="step-body">
      ${shotHtml}
      <div class="step-detail">${renderWarnedExplanation(step)}${eventsHtml || '<div class="muted small">No network / local-db activity in this step\'s window.</div>'}</div>
    </div>
  </div>`;
}

const CSS = `
:root { color-scheme: light dark; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f6f8fa; color: #1f2328; }
@media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } .step { background: #161b22 !important; border-color: #30363d !important; } .step-head { border-color: #30363d !important; } .events { background: #0d1117 !important; } header { background: #161b22 !important; border-color: #30363d !important; } table.summary td, table.summary th { border-color: #30363d !important; } .warned-note.benign { background: #21262d !important; border-color: #30363d !important; color: #8b949e !important; } .warned-note.noteworthy { background: #3a3216 !important; border-color: #6b5c1e !important; color: #e6edf3 !important; } .warned-note code { background: rgba(255,255,255,0.12) !important; } .app-name { color: #8b949e !important; } .app-logo { box-shadow: 0 0 0 1px rgba(255,255,255,0.14) !important; } }
header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #d0d7de; padding: 16px 24px; z-index: 10; }
h1 { font-size: 18px; margin: 0 0 4px; }
.meta { font-size: 13px; color: #57606a; }
main { max-width: 1040px; margin: 0 auto; padding: 20px 24px 80px; }
.step { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
.step.failed { border-color: #ffb0a8; }
.step.warned { border-color: #f0d878; }
.step-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #eaeef2; font-size: 13px; }
.seq { color: #8b949e; font-variant-numeric: tabular-nums; }
.label { font-weight: 600; flex: 1; }
.dur { font-size: 11px; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 10px; }
.step-body { display: flex; gap: 12px; padding: 10px 12px; align-items: flex-start; }
.shot { width: 90px; border-radius: 6px; border: 1px solid #d0d7de; display: block; }
.shot-link { flex-shrink: 0; }
.step-detail { flex: 1; min-width: 0; }
.warned-note { border-radius: 6px; padding: 6px 8px; font-size: 12px; margin-bottom: 8px; line-height: 1.5; }
.warned-note.benign { background: #f6f8fa; border: 1px solid #d0d7de; color: #57606a; }
.warned-note.noteworthy { background: #fff8c5; border: 1px solid #f0d878; }
.warned-note code { background: rgba(0,0,0,0.06); border-radius: 3px; padding: 1px 4px; }
.events { background: #f6f8fa; border-radius: 6px; padding: 6px 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.ev { padding: 2px 0; word-break: break-word; }
.ev.ok { color: #1a7f37; }
.ev.fail { color: #b60205; font-weight: 600; }
.ev.tag { color: #6639ba; }
.pill { background: #eaeef2; border-radius: 4px; padding: 0 4px; font-weight: 600; }
.tag { background: #ede4ff; color: #6639ba; border-radius: 10px; padding: 0 6px; font-size: 11px; }
.muted { color: #8b949e; }
.small { font-size: 12px; }
table.summary { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
table.summary td, table.summary th { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; font-size: 13px; }
table.summary th { background: #f6f8fa; }
a { color: #0969da; }
.title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.app-logo { width: 34px; height: 34px; border-radius: 8px; object-fit: contain; flex: none; box-shadow: 0 0 0 1px rgba(0,0,0,0.08); }
.title-text { display: flex; flex-direction: column; }
.app-name { font-size: 13px; font-weight: 600; color: #57606a; line-height: 1.2; }
.title-text h1 { margin: 0; }
.run-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;
  padding: 4px 12px; border-radius: 999px; border: 1px solid transparent; }
.run-status.running { color: #0550ae; background: #ddf4ff; border-color: #0550ae33; }
.run-status.passed  { color: #1a7f37; background: #dafbe1; border-color: #1a7f3733; }
.run-status.failed  { color: #b60205; background: #ffebe9; border-color: #b6020533; }
.run-status.stopped { color: #9a6700; background: #fff8c5; border-color: #9a670033; }
.run-status .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor;
  animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 1;
  padding: 5px 10px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
.chip-ico { font-size: 13px; }
.chip-key { text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; opacity: 0.75; }
.chip-val { font-weight: 600; }
.header-progress { margin-top: 12px; }
.verdicts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; }
.verdict-count { color: #57606a; }
.verdict-fail { color: #b60205; background: #ffebe9; border: 1px solid #b6020533;
  border-radius: 999px; padding: 3px 10px; font-weight: 600; }
.verdict-fail em { font-style: normal; opacity: 0.7; font-weight: 400; }
@media (prefers-color-scheme: dark) { .verdict-fail { background: #67060c !important; color: #ffa198 !important; } }
@media (prefers-color-scheme: dark) {
  .run-status.running { background: #0c2d6b !important; color: #79c0ff !important; }
  .run-status.passed  { background: #0f5323 !important; color: #7ee787 !important; }
  .run-status.failed  { background: #67060c !important; color: #ffa198 !important; }
  .run-status.stopped { background: #5c4813 !important; color: #f2cc60 !important; }
  .chip { filter: brightness(0.85) saturate(1.2); }
}
.progress-wrap { margin-top: 10px; }
.progress-label { font-size: 12px; color: #57606a; margin-bottom: 4px; }
.progress-bar { height: 8px; border-radius: 4px; background: #eaeef2; overflow: hidden; }
.progress-fill { height: 100%; background: #0969da; transition: width 0.3s ease; }
.progress-fill.done { background: #1a7f37; }
@media (prefers-color-scheme: dark) { .progress-bar { background: #21262d !important; } }
.progress-footer { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; border-top: 1px solid #d0d7de; padding: 8px 24px; z-index: 20; box-shadow: 0 -2px 8px rgba(0,0,0,0.06); }
.progress-footer .progress-wrap { margin-top: 0; }
body.has-progress-footer main { padding-bottom: 64px; }
@media (prefers-color-scheme: dark) { .progress-footer { background: #161b22 !important; border-color: #30363d !important; } }
.controls { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
.controls input { flex: 1; max-width: 320px; padding: 5px 10px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 13px; background: #fff; color: inherit; }
.controls button { padding: 5px 10px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 12px; background: #f6f8fa; cursor: pointer; }
@media (prefers-color-scheme: dark) { .controls input, .controls button { background: #161b22 !important; border-color: #30363d !important; color: #e6edf3; } summary { background: #161b22 !important; } details.flow-group { border-color: #30363d !important; } }
details.flow-group { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 10px; overflow: hidden; scroll-margin-top: 90px; }
details.flow-group.has-fail { border-color: #ffb0a8; }
details.flow-group.has-warn:not(.has-fail) { border-color: #f0d878; }
details.flow-group summary { list-style: none; cursor: pointer; padding: 10px 14px; display: flex; align-items: center; gap: 10px; background: #f6f8fa; user-select: none; }
details.flow-group summary::-webkit-details-marker { display: none; }
details.flow-group summary::before { content: '▸'; display: inline-block; transition: transform 0.15s; color: #8b949e; }
details.flow-group[open] summary::before { transform: rotate(90deg); }
.flow-name { font-weight: 600; flex: 1; }
.flow-stats { font-size: 12px; color: #57606a; }
.flow-body { padding: 12px 14px; }
`;

function renderFlowHtml(flowName, steps, runInfo) {
  const total = steps.length;
  const failed = steps.filter((s) => s.status === 'FAILED').length;
  const warned = steps.filter(isNoteworthyWarned).length;
  const m = flowMetrics(steps);

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(flowName)} — E2E report</title>
<style>${CSS}</style></head>
<body>
<header>
  <h1>${esc(flowName)}</h1>
  ${renderRunInfo(runInfo)}
  <div class="meta">${total} steps · ${formatDuration(flowDurationMs(steps))} · ${failed} failed · ${warned} warned · ${m.netCalls} backend calls (${m.netFails} failed) · ${m.persistWrites} local writes (${m.persistRows} rows) · ${m.syncEvents} sync (${m.syncFails} failed, ↑${m.opsPushed} ↓${m.opsApplied}, ${m.conflicts} conflicts) · ${m.uploads} uploads · ${m.wsEvents} ws events · ${m.verifyChecks} verify checks (${m.verifyFails} failed)</div>
</header>
<main>
${steps.map((s, i, arr) => renderStep(s, s.__flowDir, s.__assetsDir, s.__slug)).join('\n')}
</main>
</body></html>`;
}

// One self-contained document: every flow as a collapsible <details> group
// (failed/warned ones start open, passing ones start closed), a summary
// table up top linking down to each group, and a filter box — so the whole
// suite's results are readable in one place instead of clicking through a
// separate file per flow.
function renderCombinedHtml(flows, generatedAt, progress, runInfo, verdicts, isFinal) {
  const totalFailed = flows.reduce((n, f) => n + f.failed, 0);
  const totalWarned = flows.reduce((n, f) => n + f.warned, 0);

  const totalSteps = flows.reduce((n, f) => n + f.total, 0);
  const passedSteps = totalSteps - totalFailed - totalWarned;

  let progressHtml = '';
  if (progress && progress.total) {
    const pct = Math.min(100, Math.round((progress.completed / progress.total) * 100));
    const done = progress.completed >= progress.total;
    // "flows (100%)" counts flows that RAN, not flows that passed — printing it
    // beside a failed run read as "everything is green" (2026-08-25). Name the
    // failures here so the bar cannot be mistaken for a pass rate.
    const failedFlows = flows.filter(flowFailed).length;
    const label = `${progress.completed} / ${progress.total} flows ran (${pct}%) · ${passedSteps} / ${totalSteps} steps passed${
      failedFlows ? ` · <b style="color:#b60205">${failedFlows} flow(s) failed</b>` : ''
    }${!done && progress.current ? ` · running: ${esc(progress.current)}` : ''}`;
    progressHtml = `
  <div class="progress-wrap">
    <div class="progress-label">${label}</div>
    <div class="progress-bar"><div class="progress-fill${done ? ' done' : ''}" style="width:${pct}%"></div></div>
  </div>`;
  }

  // Columns that are all-zero for a suite are noise, not information — a House
  // UI suite has no uploads/sync/conflicts, a Budget local-first suite has all
  // three. Render only the ones this run actually produced.
  const showUploads = flows.some((f) => f.uploads > 0);
  const showWs = flows.some((f) => f.wsEvents > 0);
  const showWarned = flows.some((f) => f.warned > 0);
  const showSync = flows.some((f) => f.syncEvents > 0);
  // Two-device suites (multi-member sync) run the same flow name twice; without
  // this column the two rows are indistinguishable.
  const showDevice = new Set(flows.map((f) => f.device).filter(Boolean)).size > 1;

  const rows = flows
    .map(
      (f) => `<tr>
        <td><a href="#flow-${esc(f.name)}">${esc(f.name)}</a></td>
        ${showDevice ? `<td>${esc(f.device ?? '—')}</td>` : ''}
        <td>${f.total}</td>
        <td style="color:${f.failed ? '#b60205' : '#1a7f37'}">${f.failed}</td>
        ${showWarned ? `<td>${f.warned}</td>` : ''}
        <td>${formatDuration(f.durationMs)}</td>
        <td>${f.netCalls}${f.netFails ? ` <span style="color:#b60205">(${f.netFails} failed)</span>` : ''}</td>
        <td>${f.persistWrites}${f.persistRows ? ` <span class="muted small">${f.persistRows} rows</span>` : ''}</td>
        ${
          showSync
            ? `<td>${f.syncEvents}${f.syncFails ? ` <span style="color:#b60205">(${f.syncFails} failed)</span>` : ''}` +
              `${f.opsPushed || f.opsApplied ? ` <span class="muted small">↑${f.opsPushed} ↓${f.opsApplied}</span>` : ''}</td>` +
              `<td style="color:${f.conflicts ? '#b60205' : 'inherit'}">${f.conflicts}</td>`
            : ''
        }
        ${showUploads ? `<td>${f.uploads}</td>` : ''}
        ${showWs ? `<td>${f.wsEvents}</td>` : ''}
        <td>${f.verifyChecks}${f.verifyFails ? ` <span style="color:#b60205">(${f.verifyFails} failed)</span>` : ''}</td>
      </tr>`
    )
    .join('\n');

  const groups = flows
    .map((f) => {
      const cls = flowFailed(f) ? 'has-fail' : f.warned ? 'has-warn' : '';
      const stats =
        `${f.total} steps · ${formatDuration(f.durationMs)} · ${f.netCalls} calls (${f.netFails} failed) · ` +
        `${f.persistWrites} local writes (${f.persistRows} rows)` +
        `${f.syncEvents ? ` · ${f.syncEvents} sync (${f.syncFails} failed, ↑${f.opsPushed} ↓${f.opsApplied}, ${f.conflicts} conflicts)` : ''} · ` +
        `${f.verifyChecks} verify (${f.verifyFails} failed)`;
      return `
<details class="flow-group ${cls}" id="flow-${esc(f.name)}" data-name="${esc(f.name.toLowerCase())}">
  <summary>
    <span class="flow-name">${esc(f.name)}${f.device ? ` <span class="muted small">[${esc(f.device)}]</span>` : ''}</span>
    ${statusBadge(flowFailed(f) ? 'FAILED' : f.warned ? 'WARNED' : 'COMPLETED')}
    <span class="flow-stats">${stats}${
      f.runnerStatus === 'FAIL' && !f.failed
        ? ' · <b style="color:#b60205">runner reported FAIL after the last recorded step</b>'
        : ''
    }</span>
  </summary>
  <div class="flow-body">
    ${f.steps.map((s) => renderStep(s, s.__flowDir, s.__assetsDir, s.__slug)).join('\n')}
  </div>
</details>`;
    })
    .join('\n');

  // While the suite is still running, reload the page itself on a timer —
  // this is a plain file the poll loop overwrites on disk every ~15-30s;
  // without this the browser tab just sits on whatever it loaded first and
  // never shows newer content until manually refreshed (came up repeatedly
  // in practice). Stops once the run completes so a reviewer reading the
  // final results doesn't get their scroll position/expand state reset.
  const autoRefresh =
    progress && progress.completed < progress.total
      ? `<script>setTimeout(function () { location.reload(); }, 15000);</script>`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>E2E report</title>
<style>${CSS}</style>${autoRefresh}</head>
<body${progressHtml ? ' class="has-progress-footer"' : ''}>
<header>
  <div class="title-row">
    ${runInfo?.appLogoSrc ? `<img class="app-logo" src="${runInfo.appLogoSrc}" alt="" />` : ''}
    <div class="title-text">
      ${runInfo?.appName ? `<div class="app-name">${esc(runInfo.appName)}</div>` : ''}
      <h1>E2E test report</h1>
    </div>
    ${renderRunStatus(progress, totalFailed, verdicts, isFinal)}
  </div>
  ${renderRunInfo(runInfo)}
  ${renderVerdicts(verdicts)}
  <div class="meta">${flows.length} flow(s) · ${flows.filter(flowFailed).length} failed · ${totalWarned} warned · updated ${esc(generatedAt)}</div>
  ${progressHtml ? `<div class="header-progress">${progressHtml}</div>` : ''}
  <div class="controls">
    <input id="filter" type="text" placeholder="Filter flows by name…" oninput="__filterFlows(this.value)" />
    <button onclick="__setAllOpen(true)">Expand all</button>
    <button onclick="__setAllOpen(false)">Collapse all</button>
  </div>
</header>
<main>
<table class="summary">
<tr><th>Flow</th>${showDevice ? '<th>Device</th>' : ''}<th>Steps</th><th>Failed</th>${showWarned ? '<th>Warned</th>' : ''}<th>Duration</th><th>Backend calls</th><th>Local writes</th>${showSync ? '<th>Sync</th><th>Conflicts</th>' : ''}${showUploads ? '<th>Uploads</th>' : ''}${showWs ? '<th>WS events</th>' : ''}<th>Verify checks</th></tr>
${rows}
</table>
${groups}
</main>
${progressHtml ? `<div class="progress-footer">${progressHtml}</div>` : ''}
<script>
function __filterFlows(q) {
  q = q.toLowerCase();
  document.querySelectorAll('.flow-group').forEach(function (el) {
    el.style.display = el.dataset.name.indexOf(q) === -1 ? 'none' : '';
  });
}
function __setAllOpen(open) {
  document.querySelectorAll('.flow-group').forEach(function (el) { el.open = open; });
}
</script>
</body></html>`;
}

// ---------- main ----------

function findFlowDirs(maestroDir) {
  if (existsSync(path.join(maestroDir, 'commands.json'))) {
    return [{ name: path.basename(maestroDir), dir: maestroDir }];
  }
  // existsSync (not statSync directly) first — a dangling symlink (aggregator
  // dirs use symlinks into ~/.maestro/tests/, which prune-maestro-disk.sh or
  // manual cleanup can remove out from under an already-linked entry) makes
  // statSync throw ENOENT and crash the whole report; existsSync just
  // returns false for it, so it's silently skipped instead.
  const entries = readdirSync(maestroDir).filter((f) => {
    const p = path.join(maestroDir, f);
    return existsSync(p) && statSync(p).isDirectory() && existsSync(path.join(p, 'commands.json'));
  });
  // Chronological: aggregated dirs are "<timestamp>__<flow>", and run order is
  // what pairs a row with the runner's verdict (and its device) below.
  entries.sort();
  return entries.map((name) => ({ name, dir: path.join(maestroDir, name) }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.maestroDir || !args.out) {
    console.error(
      'Usage: generate-report.mjs --maestro-dir <dir> --metro-log <file> --out <dir> ' +
        '[--platform iOS|Android] [--environment staging|production] [--build-number <n>] [--device <name>]'
    );
    process.exit(1);
  }
  const maestroDir = expandHome(args.maestroDir);
  const outDir = expandHome(args.out);
  const assetsDir = path.join(outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const events = parseMetroLog(args.metroLog ? expandHome(args.metroLog) : null);
  const flowDirs = findFlowDirs(maestroDir);
  if (flowDirs.length === 0) {
    console.error(`No commands.json found under ${maestroDir}`);
    process.exit(1);
  }
  const runInfo = {
    platform: args.platform,
    environment: args.environment,
    buildNumber: args.buildNumber,
    device: args.device,
    appName: args.appName,
    // Read once per run, not per flow — a full suite regenerates this file
    // every poll interval and the icon is re-inlined into each flow page.
    appLogoSrc: inlineLogo(args.appLogo),
  };

  const summaries = [];
  let skippedFlows = 0;
  for (const { name, dir } of flowDirs) {
    const commandsPath = path.join(dir, 'commands.json');
    // A live run reads this file while Maestro is still writing it, so a
    // half-flushed commands.json is NORMAL mid-suite, not corruption. Skipping
    // that one flow costs a single tile until the next poll; throwing kills the
    // whole report. That is not hypothetical: an unguarded parse here died with
    // "Unexpected end of JSON input" and every 30s regeneration died the same
    // way, so the report sat frozen at 17 flows for 4.3 hours while the suite
    // ran on — and nothing surfaced that the run was still alive.
    let raw;
    try {
      raw = JSON.parse(readFileSync(commandsPath, 'utf8'));
    } catch (e) {
      skippedFlows += 1;
      console.warn(`[generate-report] skipping ${name}: unreadable commands.json (${e.message})`);
      continue;
    }
    const steps = flattenCommands(raw, []).sort((a, b) => a.seq - b.seq);
    attachEvents(steps, events);
    for (const s of steps) {
      s.__flowDir = dir;
      s.__assetsDir = assetsDir;
      s.__slug = name;
    }
    const html = renderFlowHtml(name, steps, runInfo);
    const file = `${name}.html`;
    writeFileSync(path.join(outDir, file), html);

    const m = flowMetrics(steps);
    summaries.push({
      name,
      file,
      steps,
      total: steps.length,
      failed: steps.filter((s) => s.status === 'FAILED').length,
      warned: steps.filter(isNoteworthyWarned).length,
      durationMs: flowDurationMs(steps),
      device: null,
      ...m,
    });
    console.log(`Wrote ${path.join(outDir, file)} (${steps.length} steps, ${m.netCalls} backend calls, ${m.persistWrites} local writes, ${m.syncEvents} sync)`);
  }

  const verdicts = parseVerdicts(expandHome(args.verdicts));
  assignDevices(summaries, verdicts);
  const flowsOrder = parseFlowsOrder(expandHome(args.flowsConfig));
  // `--progress-total` lets a shell-orchestrated suite size the bar itself;
  // otherwise fall back to the Maestro workspace's flowsOrder length.
  const plannedTotal = args.progressTotal ?? (flowsOrder ? flowsOrder.length : null);
  const progress = plannedTotal
    ? {
        total: plannedTotal,
        completed: summaries.length,
        current: currentRunningFlow(maestroDir, new Set(summaries.map((s) => s.name))),
      }
    : null;

  // Combined document ALWAYS written (even for a single flow so far) — this
  // is the one file to keep open/refresh while a suite is still running, per
  // flow expand/collapse instead of clicking through separate per-flow files.
  writeFileSync(
    path.join(outDir, 'index.html'),
    renderCombinedHtml(summaries, new Date().toLocaleString(), progress, runInfo, verdicts, args.final)
  );
  console.log(
    `Wrote ${path.join(outDir, 'index.html')} (combined, ${summaries.length} flow(s)${
      progress ? `, ${progress.completed}/${progress.total}${progress.current ? `, running ${progress.current}` : ''}` : ''
    })`
  );
}

main();
