#!/usr/bin/env node
// Live-API smoke test for the Symply House backend (real deployed Worker).
//
// Unlike the vitest suite (miniflare / local bindings), this exercises the
// REAL staging Worker over HTTPS: health, auth, households, and the House
// calculation endpoints (home-budget monthly-overview / glance, utilities
// dashboard). It asserts the live responses are internally consistent with the
// exact formulas in the source, so a bad deploy or data-shape regression fails
// here.
//
// Credentials are read from the environment — nothing is baked into the file:
//   E2E_EMAIL, E2E_PASSWORD   (see e2e/credentials.local; `set -a; source` it)
//   LIVE_API_BASE             (default: House staging)
//
// Run:  set -a && source ../e2e/credentials.local && set +a && \
//       node scripts/live-api-smoke.mjs
//
// Exit code 0 = all live checks passed, 1 = one or more failed.

const BASE = process.env.LIVE_API_BASE || 'https://simple-house-api-staging.a-tekhtelev.workers.dev';
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

function approxEqual(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
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
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`Live-API smoke test → ${BASE}\n`);
  if (!EMAIL || !PASSWORD) {
    console.error('Missing E2E_EMAIL / E2E_PASSWORD env. Source e2e/credentials.local first.');
    process.exit(2);
  }

  // 1. Public health endpoints
  console.log('[1] Public endpoints');
  const health = await req('/health');
  check(health.status === 200 && health.json?.status === 'ok', 'GET /health -> 200 {status:"ok"}');
  const root = await req('/');
  check(
    root.status === 200 && root.json?.name === 'Simple House API' && root.json?.status === 'healthy',
    'GET / -> 200 Simple House API healthy'
  );

  // 2. Auth guard on a protected route
  console.log('[2] Auth guard');
  const noAuth = await req('/households');
  check(noAuth.status === 401, 'GET /households without token -> 401');

  // 3. Login
  console.log('[3] Login');
  const login = await req('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  check(login.status === 200, 'POST /auth/login -> 200');
  const token = login.json?.access_token;
  check(typeof token === 'string' && token.length > 100, 'login returns access_token JWT');
  check(typeof login.json?.refresh_token === 'string', 'login returns refresh_token');
  check(!!login.json?.user?.id, 'login returns user.id');
  if (!token) {
    report();
    return;
  }

  // 4. Households
  console.log('[4] Households');
  const hh = await req('/households', { token });
  check(hh.status === 200, 'GET /households -> 200');
  const list = Array.isArray(hh.json) ? hh.json : hh.json?.households || hh.json?.data || [];
  check(Array.isArray(list) && list.length > 0, `households list non-empty (${list.length})`);
  const householdId = list[0]?.id;
  if (!householdId) {
    report();
    return;
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  // 5. Home-budget monthly-overview (core calc)
  console.log(`[5] Home-budget monthly-overview ${year}-${month}`);
  const ov = await req(`/households/${householdId}/home-budget/monthly-overview?year=${year}&month=${month}`, { token });
  check(ov.status === 200, 'GET monthly-overview -> 200');
  const o = ov.json || {};
  const numFields = ['plannedBudget', 'actualSpent', 'committedTotal', 'carriedIn', 'transferredOut', 'remainingBudget'];
  check(numFields.every((f) => isFiniteNum(o[f])), 'overview money fields are finite numbers');
  // remainingBudget = plannedBudget + carriedIn - actualSpent - committedTotal - transferredOut
  const expectedRemaining = o.plannedBudget + o.carriedIn - o.actualSpent - o.committedTotal - o.transferredOut;
  check(o.remainingBudget === expectedRemaining, `remainingBudget = planned + carriedIn - spent - committed - transferredOut (${o.remainingBudget})`);
  check(Number.isInteger(o.actualSpent) && o.actualSpent >= 0, 'actualSpent is a non-negative integer (cents)');
  check(Array.isArray(o.items) && typeof o.itemCount === 'number', 'overview has items[] + itemCount');

  // 6. Glance must agree with monthly-overview (both call getMonthlyOverview)
  console.log('[6] Home-budget glance cross-check');
  const gl = await req(`/households/${householdId}/home-budget/glance?year=${year}&month=${month}`, { token });
  check(gl.status === 200, 'GET glance -> 200');
  const g = gl.json || {};
  // `planned` is deliberately NULLED when no budget is set for the month, so the
  // Home status strip / Mira cues can render "—" instead of a misleading "$0"
  // (routes/home-budget.ts: `plannedBudget > 0 ? plannedBudget : null`). Assert
  // that contract, not raw equality — otherwise this fails on any household that
  // simply hasn't budgeted the CURRENT month yet, which is not a defect.
  const expectedPlanned = o.plannedBudget > 0 ? o.plannedBudget : null;
  check(
    g.planned === expectedPlanned,
    `glance.planned mirrors overview.plannedBudget, nulled when unset (${g.planned} vs planned=${o.plannedBudget})`
  );
  check(g.spent === o.actualSpent, `glance.spent === overview.actualSpent (${g.spent})`);
  check(g.remaining === o.remainingBudget, `glance.remaining === overview.remainingBudget (${g.remaining})`);

  // 7. Utilities dashboard (change / changePercent calc)
  console.log('[7] Utilities dashboard');
  const du = await req(`/households/${householdId}/utilities/dashboard`, { token });
  check(du.status === 200, 'GET utilities/dashboard -> 200');
  const d = du.json || {};
  check(isFiniteNum(d.currentMonthTotal) && isFiniteNum(d.prevMonthTotal), 'dashboard month totals are finite');
  if (isFiniteNum(d.change)) {
    check(d.change === d.currentMonthTotal - d.prevMonthTotal, `change === current - prev (${d.change})`);
  }
  if (isFiniteNum(d.changePercent) && d.prevMonthTotal !== 0) {
    check(approxEqual(d.changePercent, (d.change / d.prevMonthTotal) * 100), `changePercent === (change/prev)*100 (${d.changePercent})`);
  }
  check(Array.isArray(d.upcomingBills), 'dashboard has upcomingBills[]');

  // 8. Property overview reachable
  console.log('[8] Utilities property-overview');
  const po = await req(`/households/${householdId}/utilities/property-overview`, { token });
  check(po.status === 200, 'GET utilities/property-overview -> 200');

  // 9. House feature gate: savings API is disabled on the House worker (BUDGET_API_ENABLED=false)
  console.log('[9] House feature gate');
  const sv = await req(`/households/${householdId}/savings`, { token });
  check(sv.status === 404, 'GET /savings -> 404 on House worker (budget API gated off)');

  report();
}

function report() {
  console.log(`\n${'='.repeat(48)}`);
  console.log(`Live-API smoke: ${pass} passed, ${fail} failed`);
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
