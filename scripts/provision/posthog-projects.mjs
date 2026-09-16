#!/usr/bin/env node
// Create the 4 remaining PostHog projects (Budget, Kaizen, Language, Health) and
// write each new project token (phc_...) into its brands/<id>/brand.cjs pack.
// Idempotent: existing projects (by name) are reused. House is already set.
//
// Env: POSTHOG_PERSONAL_API_KEY (phx_...), POSTHOG_HOST (default US cloud)
// Flags: --dry-run

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const DRY = process.argv.includes('--dry-run');
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

if (!KEY) { console.error('FATAL: POSTHOG_PERSONAL_API_KEY not set'); process.exit(2); }
if (!KEY.startsWith('phx_')) {
  console.error(`FATAL: key does not start with phx_ (got ${KEY.slice(0, 4)}…) — that's a project token, not a personal API key.`);
  process.exit(2);
}

async function api(method, apiPath, body) {
  const res = await fetch(HOST + apiPath, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  if (text) { try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; } }
  return { status: res.status, ok: res.ok, json };
}

// brand id (brands/<id>) : PostHog project name
const APPS = [
  { brand: 'simple-budget', name: 'Symply Budget' },
  { brand: 'symply-kaizen', name: 'Symply Kaizen' },
  { brand: 'simple-language', name: 'Symply Language' },
  { brand: 'simple-health', name: 'Symply Health' },
];

function writeBrandKey(brand, token) {
  const file = path.join(ROOT, 'brands', brand, 'brand.cjs');
  let src = fs.readFileSync(file, 'utf8');
  const re = /posthog:\s*\{\s*apiKey:\s*''\s*\}/;
  if (!re.test(src)) return { file, changed: false, reason: 'no empty posthog apiKey (already set?)' };
  if (!DRY) fs.writeFileSync(file, src.replace(re, `posthog: { apiKey: '${token}' }`));
  return { file, changed: true };
}

async function main() {
  const me = await api('GET', '/api/users/@me/');
  if (!me.ok) {
    console.error(`✗ AUTH FAILED (${me.status}): ${JSON.stringify(me.json).slice(0, 200)}`);
    console.error('  Check the personal API key + region host.');
    process.exit(1);
  }
  const orgId = me.json.organization?.id;
  const orgName = me.json.organization?.name;
  if (!orgId) { console.error('✗ could not resolve current organization'); process.exit(1); }
  console.log(`✓ Auth OK — ${HOST} — org: ${orgName} (${orgId})${DRY ? '  [DRY RUN]' : ''}\n`);

  const list = await api('GET', `/api/organizations/${orgId}/projects/?limit=200`);
  const existing = list.json.results || [];
  let fail = 0;

  for (const app of APPS) {
    let proj = existing.find((p) => p.name === app.name);
    if (!proj) {
      if (DRY) { console.log(`+ would create project "${app.name}" → brands/${app.brand}/brand.cjs`); continue; }
      const created = await api('POST', `/api/organizations/${orgId}/projects/`, { name: app.name });
      if (!created.ok) { console.log(`✗ ${app.name}: ${JSON.stringify(created.json).slice(0, 200)}`); fail = 1; continue; }
      proj = created.json;
      console.log(`+ created "${app.name}" (project ${proj.id})`);
    } else {
      console.log(`= exists  "${app.name}" (project ${proj.id})`);
    }
    const token = proj.api_token;
    if (!token) { console.log(`  ✗ no api_token returned for ${app.name}`); fail = 1; continue; }
    const w = writeBrandKey(app.brand, token);
    console.log(`  ${w.changed ? 'wrote' : 'skip '} ${path.relative(ROOT, w.file)} ${w.reason ? '(' + w.reason + ')' : ''} → ${token}`);
  }

  console.log('\n' + (fail ? '⚠ some projects failed — see above.' : '✓ PostHog projects provisioned and brand packs updated.'));
  process.exit(fail);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
