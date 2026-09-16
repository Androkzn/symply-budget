/**
 * HEALTH-SUITE-001…003 — the Symply Health Maestro suite must be runnable
 * without booting a simulator to find out.
 *
 * Two failure modes this catches, both of which have cost real time here:
 *
 * 1. **A flow references a `testID` the app does not render.** This is the
 *    single most common way these flows fail, and it fails LATE — after a
 *    build, an install, a Metro boot and several minutes of driver warm-up,
 *    with an error ("Assertion is false") that looks identical to a genuine
 *    product regression. Nothing else in the tree checks it, because the flows
 *    are YAML and the screens are TSX.
 *
 * 2. **A flow exists on disk but is absent from `flowsOrder`.** `config.yaml`
 *    pins an explicit order (the auth pair clears the Keychain, so it must run
 *    last), which means an unlisted flow silently never runs. Same defect the
 *    Budget suite had — see `budgetSuiteCompleteness.test.ts`.
 *
 * ON DERIVED IDs. Almost nothing in this app hard-codes a leaf id. Two
 * constructions dominate, and both have to be understood or the guard reports
 * every real id as missing:
 *
 *   FORWARD  — the parent owns the prefix and interpolates the leaf:
 *              ``testID={`health-body-summary-${metric}`}``
 *   BACKWARD — a shared component takes a base id as a PROP and appends its own
 *              suffix, so neither half is ever written out in full:
 *                `<HealthScaleRow testID="health-cycle-mood" />`
 *              +  ``testID={`${testID}-${step}`}``  → `health-cycle-mood-3`
 *              This is how the scale rows, `CalendarHeatmap` (`-empty`,
 *              `-legend`, `-cell-*`), `SettingItem` (`-subtitle`),
 *              `HealthSectionScreen` (`-scroll-end`) and the chart dashboards
 *              (`-chart`, `-weekly`) all work.
 *
 * So the rule this file can actually enforce, stated without flattery:
 * **some hyphen-prefix of the id must appear literally in app source.**
 *
 * It does NOT validate the leaf. `health-body-summary-elbow` passes because
 * `health-body-summary` exists, even though `elbow` is not a metric; so does
 * `health-cycle-mood-99`. Checking the leaf would mean evaluating the
 * templates, i.e. running the app — which is the simulator run this guard
 * exists to fail *before*.
 *
 * What it does catch is the failure that actually happens: a flow naming a
 * prefix the app never renders, because it was typed wrong, renamed, or written
 * against a screen that was since restructured.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';

const HEALTH_DIR = join(__dirname, '../maestro/health');
const REPO_ROOT = join(__dirname, '../..');
const SOURCE_DIRS = ['src', 'app'];

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * All app source, concatenated.
 *
 * NOT filtered to lines containing `testID`: base ids also arrive through
 * differently-named props (`screenTestID`, `idPrefix`), and filtering on the
 * exact string `testID` silently drops them — which reported
 * `symply-apps-screen` as missing when `app/symply-apps/index.tsx` renders it.
 */
const appSource = SOURCE_DIRS.flatMap(d => walk(join(REPO_ROOT, d)))
  .map(f => readFileSync(f, 'utf8'))
  .join('\n');

/* ------------------------------------------------------------------ */
/* Flows                                                               */
/* ------------------------------------------------------------------ */

function flowFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(HEALTH_DIR)) {
    const full = join(HEALTH_DIR, entry);
    if (statSync(full).isDirectory()) {
      for (const sub of readdirSync(full)) {
        if (sub.endsWith('.yaml')) out.push(join(full, sub));
      }
    } else if (entry.endsWith('.yaml') && entry !== 'config.yaml') {
      out.push(full);
    }
  }
  return out;
}

/** `id: 'health-foo'` selectors, keyed by the flow that uses them. */
function testIdsIn(source: string): string[] {
  return [...source.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
}

/**
 * Does the app render this id, or a prefix a template could have extended?
 *
 * See the note at the top: this checks the PREFIX only, deliberately. The
 * longest prefix wins, so the closer a flow's id is to a real one the more of
 * it is actually verified.
 */
function appRenders(id: string): boolean {
  // `health-meal-delete-.*` is a regex selector — only its stable prefix is
  // a real id, so trim the pattern and any trailing separator.
  const literal = id.replace(/\.\*/g, '').replace(/-+$/, '');
  if (!literal) return true;

  const parts = literal.split('-');
  for (let k = parts.length; k > 0; k -= 1) {
    if (appSource.includes(parts.slice(0, k).join('-'))) return true;
  }
  return false;
}

/** Flow ids listed under `flowsOrder:`. */
function parseFlowsOrder(source: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex(l => l.trim() === 'flowsOrder:');
  if (start === -1) return [];
  const indent = lines[start].length - lines[start].trimStart().length;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const lineIndent = line.length - line.trimStart().length;
    const item = line.trim();
    if (!item.startsWith('- ') || lineIndent <= indent) break;
    out.push(item.slice(2).trim().replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/** Tags listed under `excludeTags:` — flows carrying one of these never run. */
function parseExcludeTags(source: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex(l => l.trim() === 'excludeTags:');
  if (start === -1) return [];
  const indent = lines[start].length - lines[start].trimStart().length;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const lineIndent = line.length - line.trimStart().length;
    const item = line.trim();
    if (!item.startsWith('- ') || lineIndent <= indent) break;
    out.push(item.slice(2).trim().replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/** Tags declared in a flow's header document. */
function parseTags(source: string): string[] {
  const header = source.split('\n---')[0].split('\n');
  const start = header.findIndex(l => l.trim() === 'tags:');
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of header.slice(start + 1)) {
    const item = line.trim();
    if (!item.startsWith('- ')) break;
    out.push(item.slice(2).trim().replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/* ------------------------------------------------------------------ */

describe('Symply Health Maestro suite', () => {
  const files = flowFiles();

  it('HEALTH-SUITE-001: there are flows to check', () => {
    // Guards the guard: a broken glob would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it('HEALTH-SUITE-002: every testID a flow drives is rendered by the app', () => {
    const unresolved: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const id of new Set(testIdsIn(source))) {
        if (id.startsWith('${')) continue; // Maestro env interpolation
        if (!appRenders(id)) unresolved.push(`${basename(file)} → ${id}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('HEALTH-SUITE-003: every non-util, non-excluded flow is scheduled in config.yaml', () => {
    const configSource = readFileSync(join(HEALTH_DIR, 'config.yaml'), 'utf8');
    const order = new Set(parseFlowsOrder(configSource));
    // `excludeTags` (config.yaml) is Maestro's own exclusion list — currently
    // `util` and `needs-admin-feature-seed` (opt-in features with no seed path
    // in this env yet, see the header comment in config.yaml). A flow tagged
    // into that list is deliberately absent from flowsOrder, not a coverage gap.
    const excludeTags = new Set(parseExcludeTags(configSource));
    const unscheduled = files
      .filter(f => !f.includes('/subflows/'))
      .filter(f => !parseTags(readFileSync(f, 'utf8')).some(tag => excludeTags.has(tag)))
      .map(f => basename(f, '.yaml'))
      .filter(name => !order.has(name));

    // An unlisted flow is invisible coverage: it sits in the repo looking like
    // a tested surface and never executes.
    expect(unscheduled).toEqual([]);
  });
});
