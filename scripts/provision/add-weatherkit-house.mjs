#!/usr/bin/env node
// Enable the WeatherKit capability on com.symply.house (House only).
// Native iOS WeatherKit needs the App ID capability (no key required — a key is
// only for the WeatherKit REST API). Tries the known capabilityType spellings.
import crypto from 'node:crypto';
import fs from 'node:fs';
const API = 'https://api.appstoreconnect.apple.com';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH } = process.env;
const b64 = (i) => Buffer.from(i).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const si = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
const TOKEN = `${si}.${crypto.sign('sha256', Buffer.from(si), { key: fs.readFileSync(ASC_KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t }; }
  return { status: r.status, ok: r.ok, json: j };
}

const found = await api('GET', '/v1/bundleIds?filter[identifier]=com.symply.house&limit=5&include=bundleIdCapabilities');
const rec = (found.json.data || []).find((b) => b.attributes?.identifier === 'com.symply.house');
if (!rec) { console.error('com.symply.house not found'); process.exit(1); }
const have = new Set((found.json.included || []).filter((i) => i.type === 'bundleIdCapabilities').map((i) => i.attributes?.capabilityType));
console.log('current caps:', [...have].join(', '));
if ([...have].some((c) => /WEATHER/i.test(c))) { console.log('✓ WeatherKit already enabled'); process.exit(0); }

for (const type of ['WEATHERKIT', 'WEATHER_KIT']) {
  const res = await api('POST', '/v1/bundleIdCapabilities', {
    data: { type: 'bundleIdCapabilities', attributes: { capabilityType: type }, relationships: { bundleId: { data: { type: 'bundleIds', id: rec.id } } } },
  });
  if (res.ok) { console.log(`✓ enabled WeatherKit via capabilityType="${type}"`); process.exit(0); }
  console.log(`  ${type} → ${res.status}: ${(res.json.errors || []).map((e) => e.detail || e.title).join('; ') || JSON.stringify(res.json).slice(0, 160)}`);
}
console.log('\n✗ WeatherKit not enableable via the API with known type names — likely portal-only (Identifiers → com.symply.house → WeatherKit).');
process.exit(2);
