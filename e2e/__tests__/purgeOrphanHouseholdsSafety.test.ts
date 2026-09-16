/**
 * `purge-house-orphan-households.mjs` deletes production homes. Its safety rails
 * are the whole tool.
 *
 * ## Why this is a source guard rather than a behavioural test
 *
 * The script is a CLI: it reads `e2e/credentials.local`, logs in, and talks to a
 * live Worker from top-level `main()`. There is no seam to inject a fake API
 * through, and jest does not collect from `scripts/` at all. Standing a fake
 * control plane up to exercise it would be a large amount of scaffolding around
 * a ~190-line script, and the scaffolding would then be the thing under test.
 *
 * So this asserts the CONTRACT in the source. That is weaker than driving the
 * script — it cannot prove the flags behave, only that the guards are still
 * written — and it is deliberately chosen anyway, because the failure it exists
 * to prevent is somebody deleting a rail while refactoring, which is exactly
 * what a source guard catches. The rails themselves were exercised for real
 * against production on 2026-09-03 (dry run, then `--only`, then a re-listing
 * that confirmed 9 → 8 households and the other 8 untouched).
 *
 * ## The rails, and what each one prevents
 *
 * - dry run by default → "delete 30 of this account's homes" is read before it
 *   is run;
 * - `--only` targets ONE named household → the surgical repair cannot become a
 *   sweep, which matters because emptiness is judged only over the API and a
 *   local-first home whose rows live encrypted on another device READS as empty
 *   from the server and is not;
 * - an unknown `--only` id, and the account's last household, are both refused;
 * - the emptiness probe still gates `--only`, and a probe that ERRORS counts as
 *   not-empty — a 500 is not evidence of absence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'e2e', 'purge-house-orphan-households.mjs');
const source = readFileSync(SCRIPT, 'utf8');

/** Index of a marker, asserted present so ordering checks cannot pass vacuously. */
function at(marker: string | RegExp): number {
  const index = typeof marker === 'string' ? source.indexOf(marker) : source.search(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('purge-house-orphan-households — destructive-action rails', () => {
  it('deletes nothing without an explicit --yes', () => {
    expect(source).toMatch(/const apply = argv\.includes\('--yes'\)/);
  });

  it('short-circuits to a printed plan before the DELETE, not after it', () => {
    // `if (!apply) { WOULD…; continue }` must come BEFORE the request, or a dry
    // run deletes.
    expect(at('if (!apply)')).toBeLessThan(at("method: 'DELETE'"));
  });

  it('probes emptiness before it decides to delete', () => {
    expect(at('await isEmpty(')).toBeLessThan(at("method: 'DELETE'"));
  });

  it('treats an unreadable household as NOT empty', () => {
    // Wrong in the safe direction: absence of evidence is not evidence of
    // absence, and the probe is the only thing standing between a member's real
    // home and a delete.
    const probe = source.slice(at('async function isEmpty'), at('async function main'));
    expect(probe).toMatch(/catch[\s\S]*?empty: false/);
  });
});

describe('purge-house-orphan-households — the --only rail', () => {
  const onlyBranch = () => source.slice(at('if (only) {'), at('} else {'));

  it('narrows the candidates to exactly the named household', () => {
    expect(onlyBranch()).toMatch(/candidates = \[target\]/);
  });

  it('cannot silently become a sweep when the id is unknown', () => {
    const branch = onlyBranch();
    expect(branch).toMatch(/if \(!target\)/);
    expect(branch).toMatch(/process\.exit\(2\)/);
  });

  it('refuses to take the account below its last household', () => {
    expect(onlyBranch()).toMatch(/ordered\.length <= 1/);
  });

  it('leaves every other household in the retained set', () => {
    // Not `[]`: the run prints what it is NOT touching, and a member reading
    // "leaving the other 8 untouched" is how the blast radius gets checked.
    expect(onlyBranch()).toMatch(/retained = ordered\.filter\(/);
  });

  it('still answers to --yes — targeting is not an approval', () => {
    // The `--only` path joins the SAME candidate loop, so the dry-run and
    // emptiness rails above cover it too. If this ever grows its own delete
    // call, that is the regression this asserts against.
    expect(source.match(/method: 'DELETE'/g) ?? []).toHaveLength(1);
  });
});
