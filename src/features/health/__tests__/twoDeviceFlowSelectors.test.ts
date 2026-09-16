/**
 * Every `id:` a Health two-device Maestro flow drives must exist in the app.
 *
 * ## Why this is a unit test and not "we'll see it when the suite runs"
 *
 * A Maestro selector that matches nothing fails at RUN time, on a booted
 * simulator, after a full iOS build — the slowest, most expensive place in the
 * loop to discover a typo. Worse, it fails identically whether the cause is a
 * typo, a renamed testID, or a screen that was never built at all.
 *
 * That last case is not hypothetical. The He12(partial) suite was authored with
 * 25 flows driving `health-other-device-*`, and the enrolment screen those
 * flows depend on **did not exist** — `HEALTH_ENROLMENT_COPY` was referenced
 * only by a unit test, and House's `src/screens/house-v2/enrolment/` had no
 * Health counterpart. The whole suite would have died at setup. This test
 * catches that in ~2 seconds, before anyone boots a device.
 *
 * ## Why it does not just grep for literals
 *
 * Plenty of real testIDs are built from a template — `` testID={`tab-${route}`} ``,
 * `` testID={`health-body-metric-${option}`} ``. Matching only literals would
 * report ~40 false positives, and a check that cries wolf gets deleted. So
 * template literals are compiled to prefix/suffix patterns and matched too.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const FLOW_DIR = join(REPO_ROOT, 'e2e', 'maestro', 'health-two-device');
const SRC_DIR = join(REPO_ROOT, 'src');

/* ------------------------------------------------------------------ */
/* What the flows drive                                                */
/* ------------------------------------------------------------------ */

function yamlFilesUnder(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => join(dir, f));
}

/**
 * Drop whole-line YAML comments before scanning.
 *
 * These flows carry long rationale headers, and a comment that explains why an
 * id is deliberately NOT asserted — `td-33`'s "there is deliberately no
 * `id: notification-banner` assertion here" — otherwise reads as a selector the
 * app is required to render. A guard that reports an id nobody drives is a
 * guard that gets ignored.
 *
 * Only full-line comments are removed: a `#` inside a selector or a URL is
 * content, not a comment.
 */
function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** `id:` selectors, plus the subflows a flow delegates to. */
function scanFlow(raw: string): { ids: string[]; subflows: string[] } {
  const text = stripComments(raw);
  const ids = [...text.matchAll(/\bid:\s*['"]?([A-Za-z0-9_\-.*${}]+)/g)].map((m) => m[1]);
  const subflows = [...text.matchAll(/runFlow:\s*(\S+\.yaml)/g)].map((m) => m[1]);
  return { ids, subflows };
}

function collectFlowSelectors(): string[] {
  const ids = new Set<string>();
  const visited = new Set<string>();
  const queue = yamlFilesUnder(FLOW_DIR);

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // A missing subflow is reported by its own test below.
    }
    const { ids: found, subflows } = scanFlow(text);
    found.forEach((id) => ids.add(id));
    for (const sf of subflows) queue.push(join(file, '..', sf));
  }

  return [...ids]
    // `${TD_OOB}`-style runtime values and regex selectors cannot be checked here.
    .filter((id) => !id.includes('${') && !id.includes('*') && id.trim() !== '')
    .sort();
}

/* ------------------------------------------------------------------ */
/* What the app actually renders                                       */
/* ------------------------------------------------------------------ */

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...sourceFilesUnder(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function collectAppTestIds(): { literals: Set<string>; patterns: RegExp[] } {
  const literals = new Set<string>();
  const patterns: RegExp[] = [];

  for (const file of sourceFilesUnder(SRC_DIR)) {
    const text = readFileSync(file, 'utf8');

    for (const m of text.matchAll(/testID=["']([^"']+)["']/g)) literals.add(m[1]);
    for (const m of text.matchAll(/testID=\{\s*["']([^"']+)["']\s*\}/g)) literals.add(m[1]);
    // A bare string constant of testID shape — many ids live in a consts file.
    for (const m of text.matchAll(/["']([a-z0-9]+(?:-[a-z0-9]+){2,})["']/g)) literals.add(m[1]);

    // `testID={`health-body-metric-${option}`}` → /^health-body-metric-.+$/
    for (const m of text.matchAll(/testID=\{`([^`]+)`\}/g)) {
      const raw = m[1];
      if (!raw.includes('${')) {
        literals.add(raw);
        continue;
      }
      const segments = raw.split(/\$\{[^}]*\}/);
      // Discard templates with too little literal content to discriminate.
      // `${a}-${b}` compiles to /^.+-.+$/, which matches virtually every
      // testID and makes the whole check pass vacuously — the "guards the
      // guard" case below caught exactly that.
      //
      // The test is TOTAL literal content, not the prefix: `${testID}-continue`
      // has no prefix at all but its `-continue` suffix is plenty specific, and
      // it is how every onboarding step builds its button
      // (`OnboardingStepScreen.tsx:193`). A prefix-only rule threw away seven
      // real ids and reported them as missing.
      if (segments.join('').length < 4) continue;
      const source = segments
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.+');
      patterns.push(new RegExp(`^${source}$`));
    }
  }

  return { literals, patterns };
}

/* ------------------------------------------------------------------ */

const selectors = collectFlowSelectors();
const { literals, patterns } = collectAppTestIds();

const resolves = (id: string): boolean =>
  literals.has(id) || patterns.some((p) => p.test(id));

describe('Health two-device flows — selectors resolve', () => {
  it('finds the flows and the app surface (guards a vacuous pass)', () => {
    // Without floors, a moved directory makes every assertion below trivially true.
    expect(yamlFilesUnder(FLOW_DIR).length).toBeGreaterThanOrEqual(20);
    expect(selectors.length).toBeGreaterThan(50);
    expect(literals.size).toBeGreaterThan(500);
  });

  it('every referenced subflow file exists', () => {
    const missing: string[] = [];
    for (const file of yamlFilesUnder(FLOW_DIR)) {
      for (const sf of scanFlow(readFileSync(file, 'utf8')).subflows) {
        const target = join(file, '..', sf);
        try {
          statSync(target);
        } catch {
          missing.push(`${file.split('/').pop()} → ${sf}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every literal id: selector exists in the app', () => {
    const missing = selectors.filter((id) => !resolves(id));
    expect(missing).toEqual([]);
  });

  it('the template matcher works (guards the guard)', () => {
    // If pattern compilation broke, the previous test would pass by matching
    // everything, or fail on ~40 legitimate dynamic ids.
    expect(resolves('tab-health-weight')).toBe(true);
    expect(resolves('health-body-metric-waist')).toBe(true);
    expect(resolves('definitely-not-a-real-testid-xyz')).toBe(false);
  });
});
