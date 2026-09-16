#!/usr/bin/env node
/**
 * Purge House E2E test-data residue.
 *
 * ## Read this before assuming it mirrors the Budget script
 *
 * `purge-budget-test-data.mjs` deletes rows over the API because Budget's test
 * household is server-backed. House is NOT, and copying that script verbatim
 * would have produced a tool that reports success while deleting nothing.
 *
 * Measured 2026-08-26 against the shared staging test household:
 *
 * | Entity        | Rows on the Worker | Rows the app shows |
 * |---------------|--------------------|--------------------|
 * | home-projects | 0                  | 15                 |
 * | tasks         | 10                 | —                  |
 *
 * The projects are on the DEVICE LEDGER, sealed, and the Worker holds
 * ciphertext it cannot enumerate — that is the whole point of local-first. So
 * there are two different residues with two different remedies, and this script
 * only owns the first:
 *
 *  1. **Server-backed rows** (tasks, and anything a server-backed household
 *     created) — deletable here, by name, over the API.
 *  2. **Local-first ledger rows** (home projects on this household) — NOT
 *     reachable from here, and NOT safely cleared by reinstalling the app.
 *
 *     ⚠️ DO NOT `simctl uninstall` / erase to clear them. Measured 2026-08-26:
 *     wiping the container destroys the device's ENROLMENT along with the
 *     ledger, so the device rejoins as an unapproved one and every write is
 *     refused with "Waiting for the household owner to approve this device.
 *     Changes are paused until then." The suite then fails on any mutating
 *     flow, and recovering needs an owner action on ANOTHER device — a far
 *     worse problem than the residue you were clearing.
 *
 *     If ledger residue genuinely has to go, do it through the app (archive
 *     the projects) or re-enrol the device deliberately afterwards. Prefer
 *     fixing the LEAK, which is what actually caused the pile-up here.
 *
 * ## The leak this does not fix, and should not have to
 *
 * The 15 projects were not a missing-cleanup problem, they were a LEAK:
 * `subflows/open-home-project-hub.yaml` reused an existing project only when it
 * was `visible`, and once the list was long enough the reusable one sat below
 * the fold, so every run created another and pushed it further down. That is
 * fixed at source in the subflow (it scrolls to find it first). A purge tool is
 * the mop, not the tap — if this script starts finding a lot to delete, look
 * for a new leak rather than scheduling it more often.
 *
 * Usage:
 *   node scripts/e2e/purge-house-test-data.mjs [--pair staging] [--dry-run]
 *
 * Credentials come from E2E_EMAIL / E2E_PASSWORD, the same env the seeder uses.
 * Never hardcode secrets here.
 */

const API = {
  staging: 'https://simple-house-api-staging.a-tekhtelev.workers.dev',
  production: 'https://simple-house-api.a-tekhtelev.workers.dev',
};

// Only ever delete rows whose name is unmistakably test residue. Anything a
// human might have created by hand must survive an accidental run of this.
const TEST_NAME = /(E2E|Maestro Test|Test Item|BlankE2E)/i;

const args = process.argv.slice(2);
const pair = (() => {
  const i = args.indexOf('--pair');
  return i >= 0 ? args[i + 1] : 'staging';
})();
const dryRun = args.includes('--dry-run');

const email = process.env.E2E_EMAIL || 'a.tekhtelev@gmail.com';
const password = process.env.E2E_PASSWORD || '';

if (!password) {
  console.error('E2E_PASSWORD is not set — source e2e/credentials.local and retry.');
  process.exit(2);
}

const baseUrl = API[pair];
if (!baseUrl) {
  console.error(`--pair must be staging|production (got "${pair}")`);
  process.exit(2);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

function listOf(payload, ...keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function main() {
  const auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  const token = auth?.access_token;
  if (!token) throw new Error('login returned no access_token');

  const households = listOf(await api('/households', { token }), 'households');
  const household = households[0];
  if (!household?.id) throw new Error('no household on this account');
  console.log(`household ${household.id} (${pair})${dryRun ? ' — DRY RUN' : ''}`);

  let deleted = 0;
  let kept = 0;

  // Tasks — the one House entity confirmed to hold server-side test residue.
  const tasks = listOf(await api(`/households/${household.id}/tasks`, { token }), 'tasks');
  for (const task of tasks) {
    const name = task.title || task.name || '';
    if (!TEST_NAME.test(name)) {
      kept += 1;
      continue;
    }
    console.log(`  ${dryRun ? 'would delete' : 'delete'} task “${name}”`);
    if (!dryRun) {
      await api(`/households/${household.id}/tasks/${task.id}`, { method: 'DELETE', token });
    }
    deleted += 1;
  }

  // Home projects — expected to be EMPTY on a local-first household. Reported
  // rather than skipped silently, so a server-backed household still gets swept
  // and a surprising non-zero count here is visible instead of assumed.
  const projects = listOf(
    await api(`/households/${household.id}/home-projects`, { token }),
    'projects'
  );
  for (const project of projects) {
    const name = project.title || '';
    if (!TEST_NAME.test(name)) {
      kept += 1;
      continue;
    }
    // The feature has no DELETE route by design — archive IS its delete.
    console.log(`  ${dryRun ? 'would archive' : 'archive'} project “${name}”`);
    if (!dryRun) {
      await api(`/households/${household.id}/home-projects/${project.id}/archive`, {
        method: 'POST',
        token,
        body: {},
      });
    }
    deleted += 1;
  }

  console.log(
    `\n${dryRun ? 'would remove' : 'removed'} ${deleted} row(s); kept ${kept} non-test row(s)`
  );
  if (projects.length === 0) {
    console.log(
      'home-projects: 0 rows on the Worker — this household is local-first, so its\n' +
        'projects live on the device ledger and cannot be purged from here.\n' +
        'Do NOT uninstall/erase to clear them: that destroys the device enrolment\n' +
        'too, and every write is then refused until the household owner re-approves\n' +
        'the device from another one. Archive them in-app instead.'
    );
  }
}

main().catch((error) => {
  console.error(`purge failed: ${error.message}`);
  process.exit(1);
});
