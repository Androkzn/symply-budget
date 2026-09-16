/**
 * HOUSE-MM — every `LF_*` selector the two-device runner injects must be an id
 * that the shipped screens actually render.
 *
 * The house-multi-member suite does not hardcode its enrolment ids. It reads
 * them from one table of `LF_*="${LF_*:-default}"` lines in the runner and
 * substitutes them into eight flows, precisely so that when the H3 §5.1 screens
 * landed the ids could be repointed in ONE place rather than eight YAML files.
 *
 * The cost of that indirection is that nothing checked the table against the
 * app. It drifted exactly as you would expect: the screens shipped in
 * `f60558b0` under an `lf-*` vocabulary while the runner still defaulted to the
 * `house-settings-*` names invented before the screens existed. Ten of fifteen
 * selectors pointed at nothing. Nobody found out, because finding out required
 * booting two simulators and getting through phase 1 — and phase 1 is gated on
 * a second account that does not exist yet, so the suite had never run at all.
 *
 * This test is the cheap version of that discovery. It parses the runner's
 * defaults and greps `src/` for each one, so a rename breaks a 200ms unit test
 * instead of a 40-minute device run that nobody has scheduled.
 *
 * What it deliberately does NOT check: that the id is reachable, or on the
 * right screen, or spelled the same in the flow that uses it. Those need a
 * running app. This checks the one thing a static tree can prove — that the
 * string the runner is about to inject exists in the product at all.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../..');
const RUNNER_PATH = join(REPO_ROOT, 'scripts/e2e/run-house-multi-member-sync.sh');

/**
 * `LF_FOO="${LF_FOO:-some-id}"` → `['LF_FOO', 'some-id']`.
 *
 * Anchored to the start of a line so a mention inside a comment or a `note`
 * string cannot be mistaken for an assignment.
 */
function parseSelectorDefaults(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /^(LF_[A-Z_]+)="\$\{\1:-([^}"]+)\}"/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.set(match[1]!, match[2]!);
  }
  return found;
}

const runnerSource = readFileSync(RUNNER_PATH, 'utf8');
const selectors = parseSelectorDefaults(runnerSource);

/**
 * Does any file under `src/` contain this exact id?
 *
 * `git grep -F` rather than a manual walk: it honours .gitignore, so a stale
 * build artifact or a node_modules copy cannot satisfy the assertion.
 */
function idAppearsInSource(id: string): boolean {
  try {
    execFileSync('git', ['grep', '-lF', id, '--', 'src', 'app'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    // git grep exits 1 when there are no matches.
    return false;
  }
}

describe('house-multi-member selector contract', () => {
  it('parses the runner table (guard against a silently-empty test)', () => {
    // If the assignment shape ever changes, every `it.each` below would vanish
    // and the suite would pass by testing nothing.
    expect(selectors.size).toBeGreaterThanOrEqual(15);
    expect(selectors.get('LF_SCREEN')).toBe('profile-screen');
  });

  it.each([...selectors.entries()])(
    '%s → "%s" is an id that exists in src/ or app/',
    (_name, id) => {
      expect(idAppearsInSource(id)).toBe(true);
    },
  );

  it('pins the device-sync row id, which is a contract with HouseSyncSharingSection', () => {
    // This one is load-bearing in a way the others are not: it is the only
    // entry point a member has to the whole local-first surface, and
    // `mm-open-lf-settings` scrolls PROFILE looking for exactly this string.
    // The row moved there with the rest of the enrolment rows when House's
    // settings went behind the header gear; the id did not change, because it
    // names the row and eight flows already speak it.
    expect(selectors.get('LF_SETTINGS_ROW')).toBe('settings-row-device-sync');
  });

  it('asserts BR-044 on the conflict element, not on Budget-flavoured prose', () => {
    // House deliberately refuses "merge conflict" as member-facing copy
    // (HouseSyncStatusCard.tsx:5-11), so the runner must not grep for it.
    // `house-sync-conflicts` renders only when conflicts > 0, which makes the
    // id's presence the proof BR-044 actually wants.
    expect(selectors.get('LF_SYNC_CONFLICTS')).toBe('house-sync-conflicts');
    expect(runnerSource).not.toMatch(/device_shows\s+"\$\{?_?u\}?"\s+"merge conflict"/);
  });
});
