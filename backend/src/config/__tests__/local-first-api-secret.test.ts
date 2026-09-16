/**
 * He0 — `LOCAL_FIRST_API_ENABLED` is a SECRET, not a `[vars]` entry
 * (Health V2 plan §1.7a, Commit 3; DoD He0 "a secret in all three envs and
 * surviving a `deploy:fleet`").
 *
 * Workers put vars and secrets in ONE namespace on `env`. A `[vars]` line of
 * the same name therefore SHADOWS the secret, and every `wrangler deploy` — the
 * next `deploy:fleet` for ANY brand's unrelated change — silently re-applies
 * `"true"` and re-arms `/v2`. That is precisely the failure the kill switch
 * exists to prevent (§1.7 step 3: "it is currently a `[vars]` entry, so a
 * secret alone does not hold"), and it is invisible: the deploy succeeds, the
 * Version ID changes, and the gate is back on.
 *
 * Grepping the committed configs is the only way to catch it, because nothing
 * at runtime can tell a var from a secret.
 *
 * Local `wrangler dev` keeps the value in the gitignored `backend/.dev.vars`;
 * this suite's own runtime value comes from the explicit miniflare binding in
 * `vitest.config.ts`, not from `wrangler.toml`.
 */
import { describe, it, expect } from 'vitest';

import budgetToml from '../../../wrangler.toml?raw';
import localFirstApiSource from '../local-first-api.ts?raw';

const KEY = 'LOCAL_FIRST_API_ENABLED';

const CONFIGS: Array<[name: string, source: string]> = [['wrangler.toml', budgetToml]];

type Section = { header: string; body: string };

/** Split a wrangler TOML into `[header]` sections, body bounded to that header. */
function sections(toml: string): Section[] {
  const out: Section[] = [];
  const lines = toml.split('\n');
  let header = '';
  let body: string[] = [];
  for (const line of lines) {
    const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (match) {
      out.push({ header, body: body.join('\n') });
      header = match[1];
      body = [];
    } else {
      body.push(line);
    }
  }
  out.push({ header, body: body.join('\n') });
  return out;
}

/** `[vars]`, `[env.staging.vars]`, `[env.production.vars]`, … */
const isVarsSection = (header: string): boolean => header === 'vars' || header.endsWith('.vars');

/** An assignment, not a comment: comments explaining the secret are expected. */
const assignsKey = (body: string): boolean =>
  new RegExp(`^\\s*${KEY}\\s*=`, 'm').test(
    body
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
  );

describe(`${KEY} is a secret, never a [vars] entry`, () => {
  it.each(CONFIGS)('%s declares at least one [vars] section (guards the guard)', (_name, toml) => {
    // If the section parser ever stops recognising `[vars]`, every assertion
    // below would pass over an empty list.
    expect(sections(toml).filter((s) => isVarsSection(s.header)).length).toBeGreaterThanOrEqual(3);
  });

  it.each(CONFIGS)('%s has no [vars] assignment of the key', (name, toml) => {
    const offenders = sections(toml)
      .filter((s) => isVarsSection(s.header) && assignsKey(s.body))
      .map((s) => `${name} [${s.header}]`);
    expect(offenders).toEqual([]);
  });

  it.each(CONFIGS)('%s has no assignment of the key in ANY section', (name, toml) => {
    // Belt and braces: a var smuggled into a non-`vars` table would still be
    // wrong, and a typo'd header (`[env.staging.var]`) would dodge the check
    // above.
    const offenders = sections(toml)
      .filter((s) => assignsKey(s.body))
      .map((s) => `${name} [${s.header || '<root>'}]`);
    expect(offenders).toEqual([]);
  });

  it('is still read off `env` as a plain string binding — secrets bind identically', () => {
    // A secret and a var are indistinguishable at the read site; this pins that
    // the reader needs no change, and that the fail-CLOSED literal survives.
    expect(localFirstApiSource).toContain(`env.${KEY} === 'true'`);
  });
});
