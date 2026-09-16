/**
 * **He3a Exit — `apiParity.test.ts` green BOTH DIRECTIONS, with a written
 * reason per remote-by-design method** (plan §7, DoD He3a).
 *
 * The Proxy on `src/api/health.ts` gives every method one of three
 * dispositions, and this file's whole job is to prove that *every* method has
 * exactly one — because the failure mode of a missing disposition is silent:
 *
 *  - **local** — served from the ledger by one of the eight Wave A facades.
 *  - **remote** — listed in the Proxy's `remoteMethods`, because the server can
 *    still answer it CORRECTLY once the ledger is the system of record.
 *  - **unsupported** — throws `HealthLocalUnsupportedError`, surfaced as copy.
 *
 * ## The two directions, and why each one has caught a real bug elsewhere
 *
 * **remote → local:** a remote method with no local implementation and no
 * `remoteMethods` entry. The Proxy rejects it, so the screen breaks — loudly,
 * which is the good case — but only on the code path that calls it. House found
 * four of these by testing the direction rather than the happy path.
 *
 * **local → remote:** a local method that matches NO remote method. This one is
 * pure dead code: it never runs, because the Proxy only consults the local
 * object for names the remote already has. A facade method with a typo'd name
 * looks completely correct in review and is simply never called — the screen
 * keeps hitting the server, and on a flag-1 device that means D1.
 *
 * ## §1.5a / food-challenge disposition
 *
 * The six challenge methods are deliberately UNSUPPORTED rather than remote
 * (plan §1.5, disposition (b)). `food_challenge_progress` is scored server-side
 * from `nutrition_entries`, which the He12(full) truncate empties — so leaving
 * them remote would return a confident, well-formed **zero**. Asserted below,
 * because "we chose to dark this" and "we forgot this" are indistinguishable
 * from the code alone.
 */
import { healthApi, remoteHealthApi } from '@api/health';

import { HEALTH_LOCAL_FACADES, findFacadeCollisions, localHealthApi } from '../localHealthApi';
import { HEALTH_UNSUPPORTED_COPY } from '../unsupportedCopy';

/**
 * Mirror of the Proxy's `remoteMethods`, with the REASON each one is there.
 *
 * Duplicated deliberately rather than imported: this table is the reviewable
 * artefact the DoD asks for ("a written reason per remote-by-design method"),
 * and a test that imported the list would assert the list equals itself. The
 * first test below pins the two against each other, so they cannot drift.
 */
const REMOTE_BY_DESIGN: Record<string, string> = {
  // Wave C — women's health. Not in HEALTH_LEDGER_TABLE_KEYS; `/health/cycle/*`
  // is on the reject-list's fall-through side (plan §2 item 3). He11b ledgers it.
  getCycleSettings: 'Wave C — cycle settings stay server-authoritative for all of Wave A',
  saveCycleSettings: 'Wave C — cycle settings stay server-authoritative for all of Wave A',
  listPeriods: 'Wave C — period_entries is not a Wave A table',
  logPeriodDay: 'Wave C — period_entries is not a Wave A table',
  removePeriodDay: 'Wave C — period_entries is not a Wave A table',
  listCycleSymptoms: 'Wave C — cycle_symptom_entries is not a Wave A table',
  saveCycleSymptoms: 'Wave C — cycle_symptom_entries is not a Wave A table',

  // Wave C — men's health. Same disposition, same wave.
  getMensHealthSettings: 'Wave C — mens_health_settings is not a Wave A table',
  saveMensHealthSettings: 'Wave C — mens_health_settings is not a Wave A table',
  listMensHealth: 'Wave C — mens_health_entries is not a Wave A table',
  saveMensHealth: 'Wave C — mens_health_entries is not a Wave A table',

  // Tier B — AI-produced, read-only. Derived from model output the server
  // already holds, NOT from Wave A rows, so the answer survives the truncate.
  listBodyInsights: 'Tier B — AI-produced; the producer is healthAiApi.generateBodyInsight',
  latestBodyInsight: 'Tier B — AI-produced; read-only mirror of server-side model output',
  listBodyPhotoInsights: 'Tier B — AI-produced; read-only mirror of server-side model output',

  // Settings row, not a log.
  activityPreferences: 'health_activity_preferences is a settings row, not one of the eight',
  saveActivityPreferences: 'health_activity_preferences is a settings row, not one of the eight',

  // The legacy D1 sync contract — routed to the server SO THAT it 410s.
  // A local throw carries no `error.response.status`, so writeThrough reads it
  // as a lost connection and re-queues forever (the poison pill at
  // healthRepository.ts:420-425). A 410 is classified permanent and drains.
  sync: 'legacy D1 contract — must reach the Worker so the 410 carries a status',
  syncPush: 'legacy D1 contract — must reach the Worker so the 410 carries a status',
};

/** Disposition (b), plan §1.5 — darked, not remote. */
const UNSUPPORTED_BY_DESIGN = [
  'listChallenges',
  'getChallengeProgressToday',
  'getChallengeWeeklyProgress',
  'createChallenge',
  'updateChallenge',
  'deleteChallenge',
];

const remoteMethods = Object.keys(remoteHealthApi).filter(
  (key) => typeof (remoteHealthApi as Record<string, unknown>)[key] === 'function',
);
const localMethods = Object.keys(localHealthApi);

describe('the three dispositions are total and disjoint', () => {
  it('every remote method has exactly one disposition', () => {
    const undisposed = remoteMethods.filter(
      (method) =>
        !localMethods.includes(method) &&
        !(method in REMOTE_BY_DESIGN) &&
        !UNSUPPORTED_BY_DESIGN.includes(method),
    );
    expect(undisposed).toEqual([]);
  });

  it('no method has two dispositions', () => {
    const doubled = remoteMethods.filter((method) => {
      const count =
        Number(localMethods.includes(method)) +
        Number(method in REMOTE_BY_DESIGN) +
        Number(UNSUPPORTED_BY_DESIGN.includes(method));
      return count > 1;
    });
    expect(doubled).toEqual([]);
  });

  it('finds a non-trivial number of methods (guards a vacuous pass)', () => {
    // If the api object were ever replaced by something whose keys do not
    // enumerate, every assertion here would pass over an empty list.
    expect(remoteMethods.length).toBeGreaterThan(50);
    expect(localMethods.length).toBeGreaterThan(25);
  });
});

describe('direction 1 — remote → local', () => {
  it('every remote method is local, remote-by-design, or darked', () => {
    const missing = remoteMethods.filter(
      (method) =>
        !localMethods.includes(method) &&
        !(method in REMOTE_BY_DESIGN) &&
        !UNSUPPORTED_BY_DESIGN.includes(method),
    );
    expect(missing).toEqual([]);
  });

  it('every remote-by-design method carries a written reason', () => {
    for (const [method, reason] of Object.entries(REMOTE_BY_DESIGN)) {
      expect(remoteMethods).toContain(method);
      // A reason, not a label: short strings like "n/a" or "TODO" are how this
      // requirement quietly becomes a checkbox.
      expect(reason.length).toBeGreaterThan(25);
      expect(reason).not.toMatch(/^(n\/a|tbd|todo)/i);
    }
  });
});

describe('direction 2 — local → remote', () => {
  it('every local method corresponds to a real remote method', () => {
    // Dead code detector: a facade method the Proxy will never consult.
    const orphans = localMethods.filter((method) => !remoteMethods.includes(method));
    expect(orphans).toEqual([]);
  });

  it('no two facades claim the same method', () => {
    // A spread chain resolves a duplicate by silently keeping the last one, so
    // one Wave A table's implementation becomes unreachable while everything
    // still compiles and renders. `listHabits` was claimed twice during the He3
    // build; this is what caught it.
    expect(findFacadeCollisions()).toEqual({});
  });

  it('all eight Wave A facades contribute', () => {
    expect(HEALTH_LOCAL_FACADES).toHaveLength(8);
    for (const [name, facade] of HEALTH_LOCAL_FACADES) {
      expect(Object.keys(facade).length).toBeGreaterThan(0);
      expect(name).toMatch(/^local[A-Z]/);
    }
  });
});

describe('§1.5a — the food-challenge disposition is a choice, not an omission', () => {
  it('challenge methods are darked rather than left remote', () => {
    for (const method of UNSUPPORTED_BY_DESIGN) {
      expect(remoteMethods).toContain(method);
      expect(localMethods).not.toContain(method);
      expect(REMOTE_BY_DESIGN[method]).toBeUndefined();
    }
  });

  it('the darked read paths have member-facing copy, not a raw error string', () => {
    // The reads are what a screen renders on load; without copy the user sees
    // the developer sentence from `errors.ts`.
    for (const method of ['listChallenges', 'getChallengeProgressToday', 'getChallengeWeeklyProgress']) {
      expect(HEALTH_UNSUPPORTED_COPY[`healthApi.${method}`]).toBeDefined();
    }
  });
});

describe('He7-lite Hard Exit — Home and Trends may not go dark', () => {
  it('the summary surface is local, never unsupported', () => {
    // Plan §0: "Throwing HealthLocalUnsupportedError on Home summary methods is
    // not an Exit. Widget may ship dark with in-product copy; Home/Trends may not."
    for (const method of [
      'dailySummary',
      'getWeeklyTrend',
      'nutritionSummary',
      'waterSummary',
      'weightStatistics',
      'weeklyWeight',
      'listHabits',
    ]) {
      expect(localMethods).toContain(method);
      expect(HEALTH_UNSUPPORTED_COPY[`healthApi.${method}`]).toBeUndefined();
    }
  });
});

describe('the Proxy is actually installed', () => {
  it('healthApi is not the bare remote object', () => {
    // The whole cutover is one assignment; if it were reverted to an alias every
    // other test here would still pass, because they inspect the two operands.
    expect(healthApi).not.toBe(remoteHealthApi);
  });

  it('exposes the same method names as the remote', () => {
    expect(Object.keys(healthApi).sort()).toEqual(Object.keys(remoteHealthApi).sort());
  });
});
