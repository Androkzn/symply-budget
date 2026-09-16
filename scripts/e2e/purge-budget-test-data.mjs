#!/usr/bin/env node
/**
 * Purge Budget E2E test-data residue from the shared staging test household.
 *
 * Flows create recurring payments named "<Something> Test Item" and delete them
 * in a cleanup block that only runs when the flow PASSES. Every failed run
 * therefore leaves its rows behind, and they accumulate: by 2026-08-25 the
 * Monthly list held four "Renewal Test Item", three "Months Chart Test Item"
 * and two "Loan Chart Test Item" rows.
 *
 * That residue breaks flows on its own, so it has to be cleared at the data
 * layer rather than worked around in YAML:
 *  - Flows tap rows BY NAME. With duplicates, Maestro takes the first match,
 *    which is a row from an older run rather than the one just created — so a
 *    detail sheet either opens on the wrong item or not at all.
 *  - Cleanup drains are bounded (`repeat: times: N`); a backlog deeper than the
 *    bound can never clear itself, so the residue is self-sustaining.
 *  - Long lists push targets far off screen and slow every scroll.
 *
 * Usage:
 *   node scripts/e2e/purge-budget-test-data.mjs [--pair staging] [--dry-run]
 *
 * Credentials come from the same env the seeder uses (E2E_EMAIL/E2E_PASSWORD),
 * defaulting to the shared fleet test account. Never hardcode secrets here.
 */

const API = {
  staging: 'https://simple-budget-api-staging.a-tekhtelev.workers.dev',
  production: 'https://simple-budget-api.a-tekhtelev.workers.dev',
};

// Only ever delete rows whose label is unmistakably test residue. Anything a
// human might have created by hand must survive an accidental run of this.
const TEST_LABEL = /(Test Item|E2E Test|Maestro Test)/i;

const args = process.argv.slice(2);
const pair = (() => {
  const i = args.indexOf('--pair');
  return i >= 0 ? args[i + 1] : 'staging';
})();
const dryRun = args.includes('--dry-run');

const email = process.env.E2E_EMAIL || 'a.tekhtelev@gmail.com';
const password = process.env.E2E_PASSWORD || '';

if (!password) {
  console.error('E2E_PASSWORD is not set — export it (or source the secrets helper) and retry.');
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
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

function extractToken(data) {
  return (
    data?.accessToken ||
    data?.access_token ||
    data?.token ||
    data?.tokens?.accessToken ||
    data?.tokens?.access_token ||
    null
  );
}

const main = async () => {
  const login = await api('/auth/login', { method: 'POST', body: { email, password } });
  const token = extractToken(login);
  if (!token) throw new Error('login succeeded but no access token was returned');

  const households = await api('/households', { token });
  const list = households?.households || households?.data || households || [];
  if (!Array.isArray(list) || list.length === 0) throw new Error('no households for this account');

  let removed = 0;
  let kept = 0;

  for (const household of list) {
    const hid = household.id || household.household_id;
    if (!hid) continue;

    const view = await api(`/households/${hid}/savings/recurring-payments`, { token });
    const payments = view?.payments || view?.recurringPayments || view?.data || [];
    if (!Array.isArray(payments)) continue;

    const residue = payments.filter((p) => TEST_LABEL.test(p.label || p.name || ''));
    kept += payments.length - residue.length;

    if (residue.length === 0) {
      console.log(`household ${hid}: clean (${payments.length} payments, none matching)`);
      continue;
    }

    console.log(`household ${hid}: ${residue.length} test rows of ${payments.length} total`);
    for (const p of residue) {
      const label = p.label || p.name;
      if (dryRun) {
        console.log(`  would delete: ${label} (${p.id})`);
        continue;
      }
      try {
        await api(`/households/${hid}/savings/recurring-payments/${p.id}`, { method: 'DELETE', token });
        removed += 1;
        console.log(`  deleted: ${label}`);
      } catch (err) {
        console.error(`  FAILED to delete ${label}: ${err.message}`);
      }
    }
  }

  console.log(`\n${dryRun ? '[dry run] ' : ''}removed ${removed} test rows; left ${kept} real payments untouched.`);
};

main().catch((err) => {
  console.error(`purge failed: ${err.message}`);
  process.exit(1);
});
