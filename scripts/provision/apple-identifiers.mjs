#!/usr/bin/env node
// Symply Ecosystem — Apple Developer identifier provisioning (App Store Connect API).
//
// Creates the App ID matrix (main + widget + watch + watch-extension) for all 5 apps
// and enables the required capabilities on each. Idempotent: existing identifiers and
// capabilities are reused, never deleted. App Group *entities* and their assignment are
// NOT handled here (not exposed by the ASC API — done manually in track B); this only
// enables the APP_GROUPS *capability* flag on each identifier.
//
// Credentials come from the environment (see run-apple-identifiers.sh):
//   ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH
//
// Flags: --dry-run  (plan only, no writes)

import crypto from 'node:crypto';
import fs from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const API = 'https://api.appstoreconnect.apple.com';

const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH } = process.env;
for (const [k, v] of Object.entries({ ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH })) {
  if (!v) { console.error(`FATAL: missing env ${k}`); process.exit(2); }
}

// ---- JWT (ES256) --------------------------------------------------------------
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function mintToken() {
  const header = { alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = fs.readFileSync(ASC_KEY_PATH, 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${sig.toString('base64url')}`;
}
let TOKEN = mintToken();

// ---- API helper ---------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  if (text) { try { json = JSON.parse(text); } catch { json = { raw: text }; } }
  return { status: res.status, ok: res.ok, json };
}
function errStr(json) {
  if (json?.errors?.length) return json.errors.map((e) => `${e.status} ${e.code}: ${e.detail || e.title}`).join(' | ');
  return json?.raw || JSON.stringify(json);
}

// ---- Matrix -------------------------------------------------------------------
// Capability enum values are App Store Connect API `capabilityType`s.
const CAP = {
  PUSH: 'PUSH_NOTIFICATIONS',
  SIWA: 'APPLE_ID_AUTH',       // Sign in with Apple
  GROUPS: 'APP_GROUPS',
  DOMAINS: 'ASSOCIATED_DOMAINS',
  HEALTH: 'HEALTHKIT',
};
const APPS = [
  { key: 'house', title: 'House' },
  { key: 'budget', title: 'Budget' },
  { key: 'kaizen', title: 'Kaizen' },
  { key: 'language', title: 'Language' },
  { key: 'health', title: 'Health' },
];

function identifiersFor(app) {
  const base = `com.symply.${app.key}`;
  const mainCaps = [CAP.PUSH, CAP.SIWA, CAP.GROUPS, CAP.DOMAINS];
  if (app.key === 'health') mainCaps.push(CAP.HEALTH);
  return [
    { id: base, name: `Symply ${app.title}`, caps: mainCaps },
    { id: `${base}.widget`, name: `Symply ${app.title} Widget`, caps: [CAP.GROUPS] },
    { id: `${base}.watchkitapp`, name: `Symply ${app.title} Watch`, caps: [CAP.GROUPS, CAP.PUSH] },
    { id: `${base}.watchkitapp.watchkitextension`, name: `Symply ${app.title} Watch Ext`, caps: [CAP.GROUPS] },
  ];
}

// ---- Operations ---------------------------------------------------------------
async function findBundleId(identifier) {
  const { json } = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200&include=bundleIdCapabilities`);
  const match = (json.data || []).find((b) => b.attributes?.identifier === identifier);
  if (!match) return null;
  const caps = (json.included || [])
    .filter((i) => i.type === 'bundleIdCapabilities')
    .map((i) => i.attributes?.capabilityType)
    .filter(Boolean);
  return { id: match.id, caps: new Set(caps) };
}

async function createBundleId(identifier, name) {
  const body = { data: { type: 'bundleIds', attributes: { identifier, name, platform: 'IOS', seedId: undefined } } };
  const { ok, json } = await api('POST', '/v1/bundleIds', body);
  if (!ok) throw new Error(`create ${identifier}: ${errStr(json)}`);
  return { id: json.data.id, caps: new Set() };
}

async function addCapability(bundleInternalId, capabilityType) {
  const attributes = { capabilityType };
  // Sign in with Apple requires an explicit consent configuration or Apple 409s.
  if (capabilityType === CAP.SIWA) {
    attributes.settings = [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT' }] }];
  }
  const body = {
    data: {
      type: 'bundleIdCapabilities',
      attributes,
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundleInternalId } } },
    },
  };
  const { ok, json } = await api('POST', '/v1/bundleIdCapabilities', body);
  if (ok) return 'added';
  // Only swallow genuine "already enabled"; surface every other failure.
  const msg = errStr(json);
  if (/already enabled|already exists/i.test(msg)) return 'present';
  throw new Error(`${capabilityType}: ${msg}`);
}

// ---- Run ----------------------------------------------------------------------
async function main() {
  // Preflight: validate credentials with a cheap read.
  const pf = await api('GET', '/v1/apps?limit=1');
  if (!pf.ok) {
    console.error(`\n✗ AUTH FAILED (${pf.status}): ${errStr(pf.json)}`);
    console.error('  Check issuer id / key id / .p8 path and that the key role is Admin or App Manager.');
    process.exit(1);
  }
  console.log(`✓ Auth OK (issuer ${ASC_ISSUER_ID.slice(0, 8)}…, key ${ASC_KEY_ID})${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

  const summary = [];
  let hardFail = 0;

  for (const app of APPS) {
    console.log(`── Symply ${app.title} ──`);
    for (const idf of identifiersFor(app)) {
      let row = { identifier: idf.id, created: false, capsAdded: [], capsPresent: [], error: '' };
      try {
        let existing = await findBundleId(idf.id);
        if (!existing) {
          if (DRY_RUN) {
            console.log(`  + would create ${idf.id}  caps=[${idf.caps.join(', ')}]`);
            summary.push({ ...row, created: 'dry' });
            continue;
          }
          existing = await createBundleId(idf.id, idf.name);
          row.created = true;
          console.log(`  + created ${idf.id}`);
        } else {
          console.log(`  = exists  ${idf.id}`);
        }
        for (const cap of idf.caps) {
          if (existing.caps.has(cap)) { row.capsPresent.push(cap); continue; }
          if (DRY_RUN) { console.log(`      would enable ${cap}`); row.capsAdded.push(cap); continue; }
          const r = await addCapability(existing.id, cap);
          if (r === 'added') { row.capsAdded.push(cap); console.log(`      + ${cap}`); }
          else { row.capsPresent.push(cap); }
        }
      } catch (e) {
        row.error = e.message;
        hardFail++;
        console.log(`  ✗ ${idf.id}: ${e.message}`);
      }
      summary.push(row);
    }
    console.log('');
  }

  // Report
  const created = summary.filter((r) => r.created === true).length;
  const capsAdded = summary.reduce((n, r) => n + r.capsAdded.length, 0);
  console.log('══════════════════════════════════════════════');
  console.log(`Identifiers: ${summary.length} total · ${created} newly created · ${summary.filter((r) => r.created === false && !r.error).length} pre-existing`);
  console.log(`Capabilities: ${capsAdded} enabled this run`);
  if (hardFail) {
    console.log(`\n⚠ ${hardFail} identifier(s) had errors — see above.`);
    process.exit(1);
  }
  console.log('\n✓ Identifier provisioning complete.');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
