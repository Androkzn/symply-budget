#!/usr/bin/env node
/**
 * Seed shared E2E test accounts across fleet staging APIs.
 *
 * - House (authority): register or login, ensure household, mark onboarding complete.
 * - Budget / Kaizen: login (auth proxies to House; mirrors local user).
 * - Health: copy user + household from House D1, then login (local auth, not proxied).
 * - Language: register or login on backend-language Worker.
 * - Then copies House-scoped data → Budget/Kaizen D1 via migrate-house-to-budget.mjs.
 *
 * Usage (from repo root):
 *   eval "$(./scripts/secrets/export-env.sh)"
 *   node scripts/e2e/seed-fleet-test-users.mjs
 *   node scripts/e2e/seed-fleet-test-users.mjs --pair production
 *
 * Env: E2E_EMAIL, E2E_PASSWORD, E2E_EMAIL_SECONDARY, E2E_PASSWORD_SECONDARY
 * Never commit credentials — set in e2e/credentials.local only.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND = join(ROOT, 'backend');

const STAGING = {
  house: 'https://simple-house-api-staging.a-tekhtelev.workers.dev',
  budget: 'https://simple-budget-api-staging.a-tekhtelev.workers.dev',
  kaizen: 'https://symply-kaizen-api-staging.a-tekhtelev.workers.dev',
  health: 'https://symply-health-api-staging.a-tekhtelev.workers.dev',
  language: 'https://simple-language-api-staging.a-tekhtelev.workers.dev',
};

const PRODUCTION = {
  house: 'https://simple-house-api.a-tekhtelev.workers.dev',
  budget: 'https://simple-budget-api.a-tekhtelev.workers.dev',
  kaizen: 'https://symply-kaizen-api.a-tekhtelev.workers.dev',
  health: 'https://symply-health-api.a-tekhtelev.workers.dev',
  language: 'https://simple-language-api.a-tekhtelev.workers.dev',
};

function loadCredentialsLocal() {
  const path = join(ROOT, 'e2e/credentials.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function parseArgs(argv) {
  let pair = 'staging';
  let skipMigrate = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pair') pair = argv[++i];
    else if (argv[i] === '--skip-migrate') skipMigrate = true;
    else throw new Error(`Unknown arg: ${argv[i]}`);
  }
  if (!['staging', 'production'].includes(pair)) throw new Error('--pair staging|production');
  return { pair, skipMigrate };
}

function accounts() {
  const primary = {
    email: process.env.E2E_EMAIL || 'a.tekhtelev@gmail.com',
    password: process.env.E2E_PASSWORD || '',
    displayName: 'E2E Primary',
  };
  const secondaryEmail =
    process.env.E2E_EMAIL_SECONDARY || 'andrei.tekhytelev@gmail.com';
  const secondaryPassword =
    process.env.E2E_PASSWORD_SECONDARY || process.env.E2E_PASSWORD || '';
  const list = [primary];
  if (secondaryEmail && secondaryEmail !== primary.email) {
    list.push({
      email: secondaryEmail,
      password: secondaryPassword,
      displayName: 'E2E Secondary',
    });
  }
  return list.filter((a) => a.email && a.password);
}

async function jsonFetch(url, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function pickToken(data) {
  return (
    data.accessToken ||
    data.access_token ||
    data.token ||
    data.tokens?.accessToken ||
    data.tokens?.access_token ||
    null
  );
}

async function houseLoginOrRegister(base, { email, password, displayName }) {
  let res = await jsonFetch(`${base}/auth/login`, {
    method: 'POST',
    body: { email, password },
  });
  if (res.ok && pickToken(res.data)) {
    return { token: pickToken(res.data), user: res.data.user, mode: 'login' };
  }
  res = await jsonFetch(`${base}/auth/register`, {
    method: 'POST',
    body: { email, password, display_name: displayName },
  });
  if (res.ok && pickToken(res.data)) {
    return { token: pickToken(res.data), user: res.data.user, mode: 'register' };
  }
  throw new Error(`House auth failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`);
}

async function ensureHousehold(base, token) {
  const list = await jsonFetch(`${base}/households`, { token });
  const households =
    list.data.households ?? (Array.isArray(list.data) ? list.data : []);
  if (households.length > 0) {
    return households[0].id ?? households[0].household?.id;
  }
  const created = await jsonFetch(`${base}/households`, {
    method: 'POST',
    token,
    body: {
      name: 'E2E Test Home',
      address_line1: '8135 138 Street',
      city: 'Surrey',
      state_province: 'BC',
      country: 'CA',
    },
  });
  if (!created.ok) {
    throw new Error(`Create household failed: ${created.status} ${JSON.stringify(created.data)}`);
  }
  return (
    created.data.household?.id ??
    created.data.id ??
    created.data.householdId
  );
}

async function completeOnboarding(base, token) {
  for (const step of ['household', 'report', 'garbage', 'floor_plan', 'complete']) {
    await jsonFetch(`${base}/users/me/onboarding/${step}`, { method: 'POST', token });
  }
}

async function childLogin(label, base, creds) {
  const res = await jsonFetch(`${base}/auth/login`, {
    method: 'POST',
    body: { email: creds.email, password: creds.password },
  });
  if (!res.ok || !pickToken(res.data)) {
    throw new Error(`${label} login failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return pickToken(res.data);
}

async function languageLoginOrRegister(base, creds) {
  const prefix = `${base}/api/v1/auth`;
  let res = await jsonFetch(`${prefix}/login`, {
    method: 'POST',
    body: { email: creds.email, password: creds.password },
  });
  if (res.ok && pickToken(res.data)) return { mode: 'login', token: pickToken(res.data) };
  res = await jsonFetch(`${prefix}/register`, {
    method: 'POST',
    body: {
      email: creds.email,
      password: creds.password,
      displayName: creds.displayName,
    },
  });
  if (res.ok && pickToken(res.data)) return { mode: 'register', token: pickToken(res.data) };
  throw new Error(`Language auth failed: ${res.status} ${JSON.stringify(res.data)}`);
}

function runMigrate(emails, pair, target) {
  const script = join(BACKEND, 'scripts/migrate-house-to-budget.mjs');
  const emailArg = emails.join(',');
  console.log(`\n>> migrate house → ${target} (${pair}) for ${emailArg}`);
  execFileSync(
    process.execPath,
    [
      script,
      '--emails',
      emailArg,
      '--target',
      target,
      '--pair',
      pair,
      '--apply',
    ],
    { cwd: BACKEND, stdio: 'inherit' }
  );
}

async function main() {
  loadCredentialsLocal();
  const { pair, skipMigrate } = parseArgs(process.argv);
  const bases = pair === 'production' ? PRODUCTION : STAGING;
  const users = accounts();
  if (users.length === 0) {
    console.error('No accounts — set E2E_EMAIL and E2E_PASSWORD in e2e/credentials.local');
    process.exit(1);
  }

  console.log(`Seeding ${users.length} account(s) on ${pair}…`);

  for (const creds of users) {
    console.log(`\n=== ${creds.email} @ House ===`);
    const { mode, token } = await houseLoginOrRegister(bases.house, creds);
    console.log(`  House ${mode} OK`);
    const hhId = await ensureHousehold(bases.house, token);
    console.log(`  Household: ${hhId}`);
    await completeOnboarding(bases.house, token);
    console.log('  Onboarding marked complete');

    for (const [label, base] of [
      ['Budget', bases.budget],
      ['Kaizen', bases.kaizen],
    ]) {
      await childLogin(label, base, creds);
      console.log(`  ${label} login OK (House proxy + mirror)`);
    }

    console.log(`\n=== ${creds.email} @ Language ===`);
    const lang = await languageLoginOrRegister(bases.language, creds);
    console.log(`  Language ${lang.mode} OK`);
  }

  if (!skipMigrate) {
    const emails = users.map((u) => u.email);
    if (pair === 'staging') {
      runMigrate(emails, pair, 'budget');
      runMigrate(emails, pair, 'kaizen');
    }
    runMigrate(emails, pair, 'health');
    for (const creds of users) {
      console.log(`\n=== ${creds.email} @ Health ===`);
      await childLogin('Health', bases.health, creds);
      console.log('  Health login OK (House D1 mirror)');
    }
  }

  console.log('\nDone — fleet test accounts seeded.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
