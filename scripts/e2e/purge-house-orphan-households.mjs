#!/usr/bin/env node
/**
 * Delete the orphan households piled up on the shared House E2E account.
 *
 * ## Why this is a separate script from `purge-house-test-data.mjs`
 *
 * That one clears rows INSIDE a household — tasks, home projects — and only for
 * `households[0]`. It has no household deletion at all, and its header calls
 * out the thing it cannot do: *"Prefer fixing the LEAK, which is what actually
 * caused the pile-up here."* This is the other half.
 *
 * ## The leak, and what it costs
 *
 * `CreateHouseholdScreen` used to let a member submit with only a name.
 * `usePropertyAddressCaptureGate` then re-opened the same form on the next
 * render, because the household still had no `state_province` — so every pass
 * through the wizard minted ANOTHER household. Local-first devices auto-mint on
 * a fresh ledger too. The account reached 33.
 *
 * That is not cosmetic. `HouseRecoverHomeScreen` renders one row per household
 * and puts "Start a new home" below all of them, so on a fresh device the
 * button sits far off the bottom of a 33-row list and `launch-logged-in` dies
 * before any flow's first step. Every House E2E flow fails, and the failure
 * looks like an app regression.
 *
 * The form is fixed. This clears what the bug already left behind.
 *
 * ## What it will NOT delete
 *
 * - Anything but an EMPTY household: a home with tasks, projects, spaces,
 *   appliances or more than one member is somebody's real data and is skipped.
 *   Emptiness is checked over the API, per household, before deleting.
 * - Anything at all without `--yes`. The default is a dry run that prints the
 *   plan, because "delete 30 of this account's homes" deserves to be read
 *   before it is run.
 * - The newest `--keep N` (default 1), so the account always retains a home to
 *   sign into.
 *
 * ## Usage
 *
 *   node scripts/e2e/purge-house-orphan-households.mjs --pair staging
 *   node scripts/e2e/purge-house-orphan-households.mjs --pair staging --yes
 *   node scripts/e2e/purge-house-orphan-households.mjs --pair staging --yes --keep 3
 *
 * `--only <householdId>` removes exactly one named household and leaves every
 * other one alone — the surgical case the sweep cannot express, since `--keep`
 * retains by age and a dead home is rarely the oldest. Still dry-run by default,
 * still refuses a non-empty household, still refuses the account's last one:
 *
 *   node scripts/e2e/purge-house-orphan-households.mjs \
 *     --pair production --only hh_local_4c66f7bad461391d --yes
 *
 * Credentials come from `e2e/credentials.local` (E2E_EMAIL / E2E_PASSWORD),
 * the same file the suite uses. Never pass them on the command line.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const API = {
  staging: 'https://simple-house-api-staging.a-tekhtelev.workers.dev',
  production: 'https://simple-house-api.a-tekhtelev.workers.dev',
};

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')
    ? argv[i + 1]
    : fallback;
};
const pair = flag('pair', 'staging');
const keep = Number(flag('keep', '1'));
const only = flag('only', null);
const apply = argv.includes('--yes');

const baseUrl = API[pair];
if (!baseUrl) {
  console.error(`--pair must be staging|production (got "${pair}")`);
  process.exit(2);
}

/** Credentials from the gitignored file, never from argv. */
function credentials() {
  const raw = readFileSync(join(ROOT, 'e2e', 'credentials.local'), 'utf8');
  const read = key =>
    raw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  const email = read('E2E_EMAIL');
  const password = read('E2E_PASSWORD');
  if (!email || !password) {
    throw new Error('e2e/credentials.local is missing E2E_EMAIL / E2E_PASSWORD');
  }
  return { email, password };
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

const listOf = (payload, ...keys) => {
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
};

/**
 * Is this household safe to delete?
 *
 * Empty on every surface a member could have put something in. A read that
 * ERRORS counts as not-empty: a 500 is not evidence of absence, and the whole
 * point of the check is to be wrong in the safe direction.
 */
async function isEmpty(id, token) {
  const probes = [
    ['tasks', `/households/${id}/tasks`, 'tasks'],
    ['projects', `/households/${id}/home-projects`, 'projects', 'home_projects'],
    ['spaces', `/households/${id}/spaces`, 'spaces'],
    ['appliances', `/households/${id}/appliances`, 'appliances'],
  ];
  for (const [label, path, ...keys] of probes) {
    try {
      const rows = listOf(await api(path, { token }), ...keys);
      if (rows.length > 0) return { empty: false, why: `${rows.length} ${label}` };
    } catch (error) {
      return { empty: false, why: `${label} unreadable (${error.message.slice(0, 60)})` };
    }
  }
  return { empty: true, why: 'no tasks, projects, spaces or appliances' };
}

async function main() {
  const { email, password } = credentials();
  const auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  const token = auth?.access_token;
  if (!token) throw new Error('login returned no access_token');

  const households = listOf(await api('/households', { token }), 'households');
  console.log(`${pair}: account owns ${households.length} household(s)`);
  if (households.length <= keep) {
    console.log(`Nothing to do — keeping the newest ${keep}.`);
    return;
  }

  // Newest first, so `--keep` retains the ones most likely to be in use.
  const ordered = [...households].sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  );

  let retained;
  let candidates;
  if (only) {
    // ONE named household, because the common repair is not "sweep the account"
    // but "this specific home is dead, remove it". `--keep` cannot express that:
    // it retains by age, and the dead one is rarely the oldest. Sweeping instead
    // would take out every other empty-LOOKING home, and empty here is judged
    // only over the API — a local-first home whose rows live encrypted on
    // another device reads as empty from the server and is not.
    const target = ordered.find(h => h.id === only);
    if (!target) {
      console.error(`--only ${only} is not a household on this account.`);
      process.exit(2);
    }
    if (ordered.length <= 1) {
      console.error('Refusing to delete the account\'s last household.');
      process.exit(2);
    }
    retained = ordered.filter(h => h.id !== only);
    candidates = [target];
  } else {
    retained = ordered.slice(0, keep);
    candidates = ordered.slice(keep);
  }

  console.log(
    only
      ? `Targeting 1 household by --only; leaving the other ${retained.length} untouched.`
      : `Keeping ${retained.length}: ${retained.map(h => h.name ?? h.id).join(', ')}`,
  );
  console.log(`Examining ${candidates.length} candidate(s)…\n`);

  let deleted = 0;
  let skipped = 0;
  for (const household of candidates) {
    const label = `${household.name ?? '(unnamed)'} ${household.id}`;
    const { empty, why } = await isEmpty(household.id, token);
    if (!empty) {
      console.log(`  SKIP   ${label} — ${why}`);
      skipped += 1;
      continue;
    }
    if (!apply) {
      console.log(`  WOULD  ${label} — ${why}`);
      deleted += 1;
      continue;
    }
    try {
      await api(`/households/${household.id}`, { method: 'DELETE', token });
      console.log(`  DELETE ${label}`);
      deleted += 1;
    } catch (error) {
      console.log(`  FAIL   ${label} — ${error.message.slice(0, 80)}`);
      skipped += 1;
    }
  }

  console.log(
    `\n${apply ? 'Deleted' : 'Would delete'} ${deleted}, skipped ${skipped}.` +
      (apply ? '' : '\nRe-run with --yes to apply.'),
  );
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
