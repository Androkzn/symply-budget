#!/usr/bin/env node
// Verify: fetch every Symply identifier and confirm its capabilities match the
// expected matrix. Read-only. Exits non-zero if anything expected is missing.
import crypto from 'node:crypto';
import fs from 'node:fs';
const API = 'https://api.appstoreconnect.apple.com';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH } = process.env;
const b64url = (i) => Buffer.from(i).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const si = `${b64url(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
const TOKEN = `${si}.${crypto.sign('sha256', Buffer.from(si), { key: fs.readFileSync(ASC_KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
async function api(path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const t = await res.text(); return t ? JSON.parse(t) : {};
}

const APPS = [['house', 'House'], ['budget', 'Budget'], ['kaizen', 'Kaizen'], ['language', 'Language'], ['health', 'Health']];
function expected(key) {
  const base = `com.symply.${key}`;
  const main = ['PUSH_NOTIFICATIONS', 'APPLE_ID_AUTH', 'APP_GROUPS', 'ASSOCIATED_DOMAINS'];
  if (key === 'health') main.push('HEALTHKIT');
  return [
    [base, main],
    [`${base}.widget`, ['APP_GROUPS']],
    [`${base}.watchkitapp`, ['APP_GROUPS', 'PUSH_NOTIFICATIONS']],
    [`${base}.watchkitapp.watchkitextension`, ['APP_GROUPS']],
  ];
}

let missing = 0;
for (const [key, title] of APPS) {
  console.log(`── Symply ${title} ──`);
  for (const [idf, want] of expected(key)) {
    const r = await api(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(idf)}&limit=5&include=bundleIdCapabilities`);
    const rec = (r.data || []).find((b) => b.attributes?.identifier === idf);
    if (!rec) { console.log(`  ✗ MISSING identifier ${idf}`); missing++; continue; }
    const have = new Set((r.included || []).filter((i) => i.type === 'bundleIdCapabilities').map((i) => i.attributes?.capabilityType));
    const gaps = want.filter((c) => !have.has(c));
    const tag = gaps.length ? `✗ missing [${gaps.join(', ')}]` : '✓';
    if (gaps.length) missing++;
    console.log(`  ${tag}  ${idf}`);
  }
}
console.log('\n' + (missing ? `⚠ ${missing} gap(s) found.` : '✓ All 20 identifiers present with expected capabilities.'));
process.exit(missing ? 1 : 0);
