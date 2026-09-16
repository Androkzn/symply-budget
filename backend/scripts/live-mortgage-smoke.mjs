#!/usr/bin/env node
// Live-API smoke for the Budget MORTGAGE management surface (real deployed Worker).
//
// Unlike the vitest suite (miniflare), this hits the REAL Budget STAGING Worker
// over HTTPS and exercises the property-management endpoints end-to-end:
//   create → GET-by-id (full unmasked record) → add statement → add offer →
//   DELETE (full cascade wipe) → confirm gone (404 + absent from list).
// It is SELF-CLEANING (deletes the mortgage it creates) and targets STAGING, so
// it never pollutes production data.
//
// Credentials from the environment (see e2e/credentials.local):
//   E2E_EMAIL, E2E_PASSWORD
//   LIVE_API_BASE  (default: Budget staging)
//
// Run:  set -a && source ../e2e/credentials.local && set +a && \
//       node scripts/live-mortgage-smoke.mjs
//
// Exit 0 = all live checks passed, 1 = one or more failed.

const BASE = process.env.LIVE_API_BASE || 'https://simple-budget-api-staging.a-tekhtelev.workers.dev';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

let pass = 0;
let fail = 0;
const failures = [];

function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

async function req(path, { token, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body (e.g. 204) */
  }
  return { status: res.status, json };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  console.log(`Live mortgage smoke → ${BASE}\n`);
  if (!EMAIL || !PASSWORD) {
    console.error('Missing E2E_EMAIL / E2E_PASSWORD env. Source e2e/credentials.local first.');
    process.exit(2);
  }

  // 1. Login
  console.log('[1] Login');
  const login = await req('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  check(login.status === 200, 'POST /auth/login -> 200');
  const token = login.json?.access_token;
  check(typeof token === 'string' && token.length > 100, 'login returns access_token JWT');
  if (!token) return report();

  // 2. Household
  console.log('[2] Households');
  const hh = await req('/households', { token });
  const list = Array.isArray(hh.json) ? hh.json : hh.json?.households || hh.json?.data || [];
  check(hh.status === 200 && list.length > 0, `GET /households -> 200 non-empty (${list.length})`);
  const householdId = list[0]?.id;
  if (!householdId) return report();
  const b = (p) => `/households/${householdId}/mortgage${p}`;

  let mortgageId = null;
  try {
    // 3. Create a mortgage (with address + home value so GET-by-id can prove them).
    console.log('[3] Create mortgage');
    const created = await req(b(''), {
      token,
      method: 'POST',
      body: {
        nickname: 'E2E Smoke Home',
        lender: 'TD',
        originalPrincipalCents: 50_000_000,
        originalAmortizationMonths: 300,
        startDate: todayISO(),
        rateType: 'fixed',
        compounding: 'semi_annual',
        nominalRateBps: 500,
        termMonths: 60,
        paymentFrequency: 'monthly',
        propertyAddress: '123 Smoke St',
        currentHomeValueCents: 60_000_000,
      },
    });
    check(created.status === 201, 'POST /mortgage -> 201');
    mortgageId = created.json?.id;
    check(!!mortgageId, 'create returns a mortgage id');
    if (!mortgageId) return report();

    // 4. GET by id — the NEW endpoint: full, unmasked record for the edit form.
    console.log('[4] GET /:mortgageId (new endpoint)');
    const one = await req(b(`/${mortgageId}`), { token });
    check(one.status === 200, 'GET /:mortgageId -> 200');
    check(one.json?.id === mortgageId, 'record id matches');
    check(one.json?.property_address === '123 Smoke St', 'raw property_address returned (unmasked)');
    check(one.json?.current_home_value_cents === 60_000_000, 'current_home_value_cents returned');

    // 5. Seed children: a statement + an offer.
    console.log('[5] Add statement + offer');
    const stmt = await req(b(`/${mortgageId}/statements`), {
      token,
      method: 'POST',
      body: { statementDate: todayISO(), closingBalanceCents: 48_000_000 },
    });
    check(stmt.status === 201, 'POST /statements -> 201');
    const offer = await req(b(`/${mortgageId}/offers`), {
      token,
      method: 'POST',
      body: { bankName: 'RBC', offeredRateBps: 400, rateType: 'fixed', termMonths: 60 },
    });
    check(offer.status === 201, 'POST /offers -> 201');

    // 6. DELETE — the CHANGED endpoint: a full cascade wipe.
    console.log('[6] Delete mortgage (full wipe)');
    const del = await req(b(`/${mortgageId}`), { token, method: 'DELETE' });
    check(del.status === 204, 'DELETE /:mortgageId -> 204');
    mortgageId = null; // consumed — nothing to clean up

    // 7. Confirm it (and its artifacts) are gone.
    console.log('[7] Confirm removed');
    const gone = await req(b(`/${created.json.id}`), { token });
    check(gone.status === 404, 'GET deleted /:mortgageId -> 404');
    const afterStmts = await req(b(`/${created.json.id}/statements`), { token });
    check(afterStmts.status === 404, 'GET deleted /:mortgageId/statements -> 404 (children gone)');
    const relist = await req(b(''), { token });
    const remaining = (relist.json?.mortgages || []).some((m) => m.id === created.json.id);
    check(!remaining, 'deleted mortgage absent from list');
  } finally {
    // Safety net: if any assertion above threw before the delete, clean up.
    if (mortgageId) {
      await req(b(`/${mortgageId}`), { token, method: 'DELETE' }).catch(() => {});
      console.log('  🧹 cleaned up leftover test mortgage');
    }
  }

  report();
}

function report() {
  console.log(`\n${'='.repeat(48)}`);
  console.log(`Live mortgage smoke: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
