// Symply Ecosystem — create Pro subscription groups + monthly/yearly products in
// App Store Connect for all 5 apps. Idempotent: existing groups/subs/localizations
// are reused, never recreated. Does NOT set prices (business decision — left manual).
//   env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH   flags: --dry-run
import crypto from 'node:crypto';
import fs from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const API = 'https://api.appstoreconnect.apple.com';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH } = process.env;
for (const [k, v] of Object.entries({ ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH }))
  if (!v) { console.error(`FATAL: missing env ${k}`); process.exit(2); }

function b64url(i) { return Buffer.from(i).toString('base64url'); }
function mintToken() {
  const header = { alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' };
  const si = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = fs.readFileSync(ASC_KEY_PATH, 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(si), { key, dsaEncoding: 'ieee-p1363' });
  return `${si}.${sig.toString('base64url')}`;
}
const TOKEN = mintToken();
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
const errStr = (j) => j?.errors?.length ? j.errors.map(e => `${e.status} ${e.code}: ${e.detail || e.title}`).join(' | ') : (j?.raw || JSON.stringify(j));

const APPS = [
  { key: 'house',    appId: '6790505308', brand: 'Symply House' },
  { key: 'budget',   appId: '6790505414', brand: 'Symply Budget' },
  { key: 'kaizen',   appId: '6790505368', brand: 'Symply Kaizen' },
  { key: 'language', appId: '6790505445', brand: 'Symply Language' },
  { key: 'health',   appId: '6790505448', brand: 'Symply Health' },
];
const PRODUCTS = [
  { period: 'ONE_MONTH', suffix: 'pro.monthly', display: 'Pro Monthly', desc: 'Full Pro access, billed monthly.' },
  { period: 'ONE_YEAR',  suffix: 'pro.yearly',  display: 'Pro Yearly',  desc: 'Full Pro access, billed yearly.' },
];

async function ensureGroup(app) {
  const ref = `${app.brand} Pro`;
  const list = await api('GET', `/v1/apps/${app.appId}/subscriptionGroups?limit=50&fields[subscriptionGroups]=referenceName`);
  if (!list.ok) throw new Error(`list groups: ${errStr(list.json)}`);
  const found = (list.json.data || []).find(g => g.attributes.referenceName === ref);
  if (found) { console.log(`    = group "${ref}" exists (id=${found.id})`); return found.id; }
  if (DRY) { console.log(`    + [dry] create group "${ref}"`); return 'DRYGROUP'; }
  const res = await api('POST', '/v1/subscriptionGroups', {
    data: { type: 'subscriptionGroups', attributes: { referenceName: ref },
      relationships: { app: { data: { type: 'apps', id: app.appId } } } },
  });
  if (!res.ok) throw new Error(`create group: ${errStr(res.json)}`);
  console.log(`    + created group "${ref}" (id=${res.json.data.id})`);
  return res.json.data.id;
}
async function ensureGroupLocalization(groupId, name) {
  if (DRY || groupId === 'DRYGROUP') { console.log(`      + [dry] group loc "${name}" (en-US)`); return; }
  const list = await api('GET', `/v1/subscriptionGroups/${groupId}/subscriptionGroupLocalizations?limit=50&fields[subscriptionGroupLocalizations]=locale`);
  if (list.ok && (list.json.data || []).some(l => l.attributes.locale === 'en-US')) { console.log('      = group loc en-US exists'); return; }
  const res = await api('POST', '/v1/subscriptionGroupLocalizations', {
    data: { type: 'subscriptionGroupLocalizations', attributes: { name, locale: 'en-US' },
      relationships: { subscriptionGroup: { data: { type: 'subscriptionGroups', id: groupId } } } },
  });
  if (!res.ok) console.log(`      ! group loc skipped: ${errStr(res.json)}`);
  else console.log(`      + group loc "${name}" (en-US)`);
}
async function ensureSubscription(app, groupId, p) {
  const productId = `com.symply.${app.key}.${p.suffix}`;
  const refName = `${app.brand} ${p.display}`.slice(0, 64);
  // existing?
  const list = await api('GET', `/v1/subscriptionGroups/${groupId}/subscriptions?limit=200&fields[subscriptions]=productId,name,state`);
  if (list.ok) {
    const found = (list.json.data || []).find(s => s.attributes.productId === productId);
    if (found) { console.log(`    = sub ${productId} exists [${found.attributes.state}] (id=${found.id})`); await ensureSubLocalization(found.id, p); return { productId, id: found.id, existed: true }; }
  }
  if (DRY) { console.log(`    + [dry] sub ${productId} (${p.period})`); return { productId, id: 'DRYSUB', existed: false }; }
  const res = await api('POST', '/v1/subscriptions', {
    data: { type: 'subscriptions',
      attributes: { name: refName, productId, familySharable: false, subscriptionPeriod: p.period, groupLevel: 1 },
      relationships: { group: { data: { type: 'subscriptionGroups', id: groupId } } } },
  });
  if (!res.ok) throw new Error(`create sub ${productId}: ${errStr(res.json)}`);
  const id = res.json.data.id;
  console.log(`    + created sub ${productId} (${p.period}, id=${id})`);
  await ensureSubLocalization(id, p);
  return { productId, id, existed: false };
}
async function ensureSubLocalization(subId, p) {
  if (DRY || subId === 'DRYSUB') { console.log(`      + [dry] sub loc "${p.display}"`); return; }
  const list = await api('GET', `/v1/subscriptions/${subId}/subscriptionLocalizations?limit=50&fields[subscriptionLocalizations]=locale`);
  if (list.ok && (list.json.data || []).some(l => l.attributes.locale === 'en-US')) { console.log('      = sub loc en-US exists'); return; }
  const res = await api('POST', '/v1/subscriptionLocalizations', {
    data: { type: 'subscriptionLocalizations', attributes: { name: p.display, locale: 'en-US', description: p.desc },
      relationships: { subscription: { data: { type: 'subscriptions', id: subId } } } },
  });
  if (!res.ok) console.log(`      ! sub loc skipped: ${errStr(res.json)}`);
  else console.log(`      + sub loc "${p.display}" / "${p.desc}"`);
}

const summary = [];
for (const app of APPS) {
  console.log(`\n══ ${app.brand} (com.symply.${app.key}, appId=${app.appId}) ══`);
  try {
    const groupId = await ensureGroup(app);
    await ensureGroupLocalization(groupId, `${app.brand} Pro`);
    for (const p of PRODUCTS) {
      const r = await ensureSubscription(app, groupId, p);
      summary.push({ brand: app.brand, productId: r.productId, period: p.period });
    }
  } catch (e) { console.error(`  ✗ ${app.brand}: ${e.message}`); }
}
console.log('\n\n════════ PRODUCT ID SUMMARY ════════');
for (const app of APPS) {
  console.log(`\n${app.brand}:`);
  for (const p of PRODUCTS) console.log(`  com.symply.${app.key}.${p.suffix}`);
}
console.log(DRY ? '\n[DRY RUN — nothing written]' : '\n✓ Done. Set prices per product in App Store Connect to complete (Missing Metadata until priced).');
