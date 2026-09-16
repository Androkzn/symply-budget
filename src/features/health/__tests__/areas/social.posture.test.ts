/**
 * Symply Health — SOCIAL: the POSTURE GUARD for a surface that is deliberately
 * not ported to the client.
 *
 * ## What ships, and what does not
 *
 * `backend/src/routes/health-social.ts` is real, mounted and deployed: 35
 * handlers over 29 paths for family sharing, accountability buddies, community
 * rooms, joinable challenges and the scoped metric-share grants that make any of
 * it readable. It is also DISABLED, and it has ZERO React Native callers. The
 * only thing between it and live cross-user health sharing is the literal string
 * `'true'` in `CONFIG_KV.health_social_enabled`, and a privacy review that has
 * not been signed off (documents/apps/symply-health/PARITY_PLAN.md §5 P4).
 *
 * There is therefore no UI to test, and inventing one would be worse than
 * useless. What this file does instead is make the POSTURE executable, so the
 * day it changes it changes loudly:
 *
 *   1. THE GATE STILL DENIES BY DEFAULT. The predicate is lifted out of the
 *      shipped backend source and RUN here, so this asserts behaviour rather
 *      than spelling: absent, `''`, `'1'`, `'yes'`, `'TRUE'`, `'true\n'` must
 *      every one of them mean OFF. The repo's usual convention is the opposite
 *      (`routes/savings.ts`: absent means ENABLED), so "someone made it
 *      consistent with the others" is a realistic way to ship this live.
 *   2. THE GATE STILL RUNS BEFORE AUTH, in the router AND in `src/index.ts`.
 *      That ordering is the difference between a 404 and a 401 on a disabled
 *      fleet, and a 401 confirms the surface exists.
 *   3. THERE IS STILL NO CLIENT. If an RN caller appears, this guard does not
 *      simply fail — it requires a matching client test to exist alongside it.
 *   4. THE HONEST COPY STAYS HONEST. `healthSettingsStorage` ships family and
 *      community notification toggles whose disclosure text says, in so many
 *      words, that neither feature exists yet. Landing social without rewriting
 *      that copy would turn a deliberate disclosure into a lie.
 *
 * ## To the porter who lands this feature
 *
 * DELETE THIS FILE. Every assertion here describes the not-ported state; none
 * of it is a requirement of the shipped feature. Replace it with real client
 * tests for the screens and the API module you add, and with the privacy review
 * these guards are standing in for.
 *
 * The backend contract itself is covered, in depth, by
 * `backend/src/routes/__tests__/health-social{,-gate,-authz}.test.ts` and
 * `backend/src/services/__tests__/health-social-service.test.ts` — those run on
 * Vitest. This file is Jest, i.e. the suite a mobile developer actually runs, so
 * the two cheap cross-checks (1 and 2) are repeated here on purpose.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
  HEALTH_NOTIFICATION_GROUPS,
} from '../../healthSettingsStorage';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const ROUTE_FILE = path.join(REPO_ROOT, 'backend/src/routes/health-social.ts');
const INDEX_FILE = path.join(REPO_ROOT, 'backend/src/index.ts');

const routeSource = fs.readFileSync(ROUTE_FILE, 'utf8');
const indexSource = fs.readFileSync(INDEX_FILE, 'utf8');

/**
 * Comments stripped, so an assertion about what the file DOES is never
 * satisfied — or broken — by what its header says ABOUT what it does. The route
 * header names `isTruthyKvFlag()` and `config-flags.ts` explicitly, to explain
 * why it does not use them; that prose must not read as a use.
 *
 * Approximate by design (it would mangle a `//` inside a string literal); this
 * file contains none, and the assertions below are all about identifiers.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const routeCode = stripComments(routeSource);

/* ==================================================================== */
/* 1. The gate denies by default — the predicate, actually executed      */
/* ==================================================================== */

/**
 * Lift `isHealthSocialEnabled`'s BODY out of the shipped source and compile it.
 *
 * Importing the module itself is not an option from Jest: it pulls in hono,
 * drizzle and the whole Worker `Env`. Asserting on the source text alone would
 * be the kind of drifting string-match the posture-guard rules forbid. Compiling
 * the body gives the real thing — if someone rewrites the predicate, THIS runs
 * the rewrite.
 */
function loadGatePredicate(): (flag: string | null | undefined) => boolean {
  const match = routeSource.match(
    /export function isHealthSocialEnabled\([^)]*\)\s*:\s*boolean\s*\{([\s\S]*?)\n\}/
  );
  if (!match) {
    throw new Error(
      'isHealthSocialEnabled is gone or its signature changed. That function IS the kill ' +
        'switch — re-derive this guard against whatever replaced it before deleting it.'
    );
  }
  // The body is plain JS (`return flag === 'true';`). Anything that needs a
  // TypeScript transform to run is itself a signal worth failing on.
  //
  // The `no-new-func` disable is deliberate: EXECUTING the shipped predicate,
  // rather than pattern-matching its text, is this guard's entire value. The
  // input is a fixed in-repo source file, never user data.
  // eslint-disable-next-line no-new-func
  return new Function('flag', match[1]) as (flag: string | null | undefined) => boolean;
}

/** Every value that must mean OFF. See the route header for why each is listed. */
const MUST_NOT_ENABLE: ReadonlyArray<readonly [string, string | null | undefined]> = [
  ['absent (fresh environment, no key)', undefined],
  ['null (KV miss)', null],
  ['empty string', ''],
  ['false', 'false'],
  ['FALSE', 'FALSE'],
  ['True', 'True'],
  ['TRUE', 'TRUE'],
  // `config-flags.ts` treats these two as truthy. This gate must not.
  ['1', '1'],
  ['yes', 'yes'],
  ['on', 'on'],
  // The single likeliest operator mistake: a shell newline captured by
  // `wrangler kv key put ... --path`.
  ['true with a trailing newline', 'true\n'],
  ['true with surrounding spaces', ' true '],
  ['JSON-encoded string', '"true"'],
  ['JSON object', '{"health_social_enabled":true}'],
];

describe('Health social — the kill switch denies by default', () => {
  const isEnabled = loadGatePredicate();

  it('enables the surface for exactly one value in the universe', () => {
    expect(isEnabled('true')).toBe(true);
    for (const [label, value] of MUST_NOT_ENABLE) {
      // Paired with the label so a failure names WHICH value slipped through.
      expect([label, isEnabled(value)]).toEqual([label, false]);
    }
  });

  it('is not routed through the repo truthy-flag helper', () => {
    // `services/config-flags.ts` accepts '1' / 'yes' / 'on', and
    // `routes/savings.ts` treats an ABSENT key as ENABLED. Either convention
    // applied here would turn a half-finished rollout into live cross-user
    // health sharing, so the route must not import them.
    expect(routeCode).not.toMatch(/isTruthyKvFlag|config-flags/);
    expect(routeCode).toMatch(/HEALTH_SOCIAL_FLAG_KEY\s*=\s*'health_social_enabled'/);
  });

  it('is never pre-seeded to on by configuration', () => {
    // A `[vars]` entry, a migration, or a deploy script that writes the key
    // would bypass the human decision the flag exists to require.
    const configs = [
      'backend/wrangler.toml',
      'backend/wrangler.health.toml',
      'backend/wrangler.budget.toml',
      'backend/wrangler.kaizen.toml',
    ]
      .map((rel) => path.join(REPO_ROOT, rel))
      .filter((file) => fs.existsSync(file));
    expect(configs.length).toBeGreaterThan(0);
    for (const file of configs) {
      expect([file, fs.readFileSync(file, 'utf8').includes('health_social_enabled')]).toEqual([
        file,
        false,
      ]);
    }
  });
});

/* ==================================================================== */
/* 2. The gate runs before auth, in both places it is registered         */
/* ==================================================================== */

describe('Health social — the gate is the first decision', () => {
  it('the router applies the flag BEFORE authMiddleware', () => {
    // Order inside routes/health-social.ts: brand → flag → auth. A flag that
    // runs after auth answers 401 to an anonymous probe of a disabled fleet,
    // which is a yes/no answer to "does this surface exist?".
    const flagAt = routeSource.indexOf("healthSocial.use('/*', requireHealthSocialFlag())");
    const authAt = routeSource.indexOf("healthSocial.use('/*', authMiddleware())");
    expect(flagAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(authAt);
  });

  it('src/index.ts registers the gate BEFORE the first /health mount', () => {
    /**
     * The load-bearing one, and the one a router-only test cannot see. Hono
     * applies a mounted router's `use('/*')` to every path under the shared
     * prefix, and `routes/health.ts` mounts FIRST at `/health` with
     * `use('/*', authMiddleware())`. Without these two lines ahead of it, auth
     * runs before the social router's own chain is ever reached — which is
     * exactly the 401 leak this surface shipped with.
     */
    const subtree = indexSource.indexOf("app.use('/health/social/*', requireHealthSocialFlag())");
    const bare = indexSource.indexOf("app.use('/health/social', requireHealthSocialFlag())");
    const firstHealthMount = indexSource.indexOf("app.route('/health', healthRoutes)");
    expect(subtree).toBeGreaterThan(-1);
    // `/health/social/*` does not match `/health/social`, so the bare path
    // needs its own registration or it falls through to auth.
    expect(bare).toBeGreaterThan(-1);
    expect(firstHealthMount).toBeGreaterThan(-1);
    expect(subtree).toBeLessThan(firstHealthMount);
    expect(bare).toBeLessThan(firstHealthMount);
  });
});

/* ==================================================================== */
/* 3. There is still no client                                           */
/* ==================================================================== */

/** The path prefixes the Worker owns. A client that talks to it names one. */
const SOCIAL_PATHS = [
  '/social/family',
  '/social/buddies',
  '/social/challenges',
  '/social/community',
  '/social/shares',
] as const;

/** Walk a directory for source files, skipping tests and generated output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // `__tests__` is skipped so THIS file's own strings never match, and
        // so an eventual client's tests are counted separately (below).
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe('Health social — no React Native caller', () => {
  it('the API client module does not exist', () => {
    // Module RESOLUTION, not a grep: `@api/healthSocial` is the name every
    // sibling surface uses (`@api/healthFood`, `@api/healthAi`, …), so this is
    // the path a port would create.
    expect(() => require.resolve('@api/healthSocial')).toThrow();
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/api/healthSocial.ts'))).toBe(false);
  });

  it('nothing under src/ or app/ requests a social path — and if it does, it is tested', () => {
    /**
     * Not `expect(count).toBe(0)`. The contract this asserts is conditional and
     * survives the feature landing:
     *
     *   no caller            → posture holds, nothing more to check;
     *   caller + client test → someone ported it properly, and the failure
     *                          message tells them to delete this guard;
     *   caller, no test      → FAIL. A screen is talking to 29 cross-user
     *                          health-sharing endpoints with nothing asserting
     *                          what it sends or renders.
     */
    const roots = ['src', 'app'].map((rel) => path.join(REPO_ROOT, rel));
    const callers = roots
      .flatMap(sourceFiles)
      .filter((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return SOCIAL_PATHS.some((p) => text.includes(p)) || /\bhealthSocial\b/.test(text);
      })
      .map((file) => path.relative(REPO_ROOT, file));

    if (callers.length === 0) {
      expect(callers).toEqual([]);
      return;
    }

    const clientTests = [
      path.join(REPO_ROOT, 'src/api/__tests__/healthSocial.test.ts'),
      path.join(REPO_ROOT, 'src/features/health/__tests__/areas/social.client.test.ts'),
    ].filter((file) => fs.existsSync(file));

    expect(
      clientTests.length > 0
        ? []
        : [
            'Symply Health SOCIAL has grown a React Native caller but no client test:',
            ...callers.map((c) => `  - ${c}`),
            '',
            'That surface is 29 cross-user health-sharing endpoints behind a deny-by-default',
            'KV flag whose privacy review is unsigned. Before shipping a caller:',
            '  1. add src/api/__tests__/healthSocial.test.ts (or areas/social.client.test.ts),',
            '  2. add the SOCIAL rows to documents/engineering/testing/matrices/health.md,',
            '  3. get the privacy review signed off, and',
            '  4. DELETE this posture guard — it describes the not-ported state.',
          ]
    ).toEqual([]);
  });

  it('the Health tab pool offers no social destination', () => {
    // The tab pool is what the More hub renders. A social entry here is the
    // moment the feature becomes reachable by a member.
    // brand.cjs is CommonJS config, and loading it BY PATH is the point: an
    // `import` would resolve whichever brand is active in this build rather
    // than the Health one specifically.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const brand = require(path.join(REPO_ROOT, 'brands/symply-health/brand.cjs')) as {
      tabs: Array<{ route: string; label: string }>;
    };
    expect(brand.tabs.length).toBeGreaterThan(0);
    const social = brand.tabs.filter((tab) =>
      /social|family|buddy|buddies|communit|challenge|friend/i.test(`${tab.route} ${tab.label}`)
    );
    expect(social).toEqual([]);
  });
});

/* ==================================================================== */
/* 4. The honest copy stays honest                                       */
/* ==================================================================== */

describe('Health social — the notification settings do not promise a feature that is off', () => {
  it('the family and community groups both disclose that nothing sends them', () => {
    // `healthSettingsStorage` is the ONE shipped client surface that mentions
    // family sharing and the community at all. Its disclosure strings are the
    // reason a member is not misled by a switch that gates nothing — and they
    // become false the moment the social surface is enabled.
    for (const id of ['sharing', 'community'] as const) {
      const group = HEALTH_NOTIFICATION_GROUPS.find((g) => g.id === id);
      expect([id, Boolean(group)]).toEqual([id, true]);
      expect([id, group?.disclosure]).toEqual([id, expect.stringMatching(/\byet\b/)]);
    }
  });

  it('community traffic is opt-IN, family traffic is merely recorded', () => {
    // Community events are generated by strangers, so they default OFF. The
    // family switches default ON because they gate nothing today — if that ever
    // stops being true, this expectation is where the decision gets revisited.
    expect(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES.notify_community_recipe_created).toBe(false);
    expect(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES.notify_community_achievement).toBe(false);
  });

  it('no notification flag is named after a share GRANT', () => {
    // The grant table is the only thing that makes another member's health data
    // readable. It must never acquire a client-side mirror in a preferences
    // blob, where "off" would look like revocation without being one.
    const flags = Object.keys(DEFAULT_HEALTH_NOTIFICATION_PREFERENCES);
    expect(flags.filter((f) => /share_scope|grant|metric_share|shared_with/.test(f))).toEqual([]);
  });
});
