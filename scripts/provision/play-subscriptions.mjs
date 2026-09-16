// Symply Ecosystem — create Pro subscription products (monthly + yearly) in the
// Google Play Console for all 5 apps, matching the App Store Connect product IDs:
//   com.symply.<brand>.pro.monthly   (auto-renewing base plan "monthly", P1M)
//   com.symply.<brand>.pro.yearly    (auto-renewing base plan "yearly",  P1Y)
// Base plans are created as DRAFT with NO price (business decision — set in Play
// Console / via regionalConfigs later). Idempotent: existing subscriptions are skipped.
//
//   env: SA_PATH (service-account JSON with androidpublisher scope, linked in Play Console)
//   flags: --dry-run
//
// PREREQUISITES (interactive, one-time — NOT automatable via this API):
//   1) The 5 app records exist in Google Play Console (com.symply.<brand>).
//   2) The service account SA_PATH is granted access under
//      Play Console → Users & permissions (or Setup → API access) with permission
//      to manage the apps. Until then the API returns 404 "Package not found".
//   3) Google Play Android Developer API enabled on the GCP project (done 2026-07-14).
import crypto from 'node:crypto';
import fs from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const REGIONS_VERSION = '2022/02'; // current Play region catalog version
const SA = JSON.parse(fs.readFileSync(process.env.SA_PATH, 'utf8'));

function b64url(i) { return Buffer.from(i).toString('base64url'); }
async function mintToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: SA.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const si = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(si), SA.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${si}.${sig}` }),
  });
  const j = await res.json();
  if (!res.ok) { console.error('TOKEN FAILED:', res.status, JSON.stringify(j)); process.exit(1); }
  return j.access_token;
}
let AT;
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {}; if (text) { try { json = JSON.parse(text); } catch { json = { raw: text }; } }
  return { status: res.status, ok: res.ok, json };
}
const errStr = (j) => j?.error?.message || j?.raw || JSON.stringify(j);

const BRANDS = ['house', 'budget', 'kaizen', 'language', 'health'];
const PLANS = [
  { suffix: 'pro.monthly', basePlanId: 'monthly', period: 'P1M', title: 'Pro Monthly', desc: 'Full Pro access, billed monthly.' },
  { suffix: 'pro.yearly',  basePlanId: 'yearly',  period: 'P1Y', title: 'Pro Yearly',  desc: 'Full Pro access, billed yearly.' },
];

function subscriptionBody(pkg, productId, p) {
  return {
    packageName: pkg,
    productId,
    listings: [{ languageCode: 'en-US', title: p.title, description: p.desc }],
    basePlans: [{
      basePlanId: p.basePlanId,
      regionalConfigs: [], // no price yet — DRAFT until priced
      autoRenewingBasePlanType: {
        billingPeriodDuration: p.period,
        gracePeriodDuration: 'P0D',
        accountHoldDuration: 'P30D',
        resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE',
        prorationMode: 'SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE',
        legacyCompatible: false,
      },
    }],
  };
}

AT = await mintToken();
console.log(`✓ androidpublisher token for ${SA.client_email}${DRY ? '  [DRY RUN]' : ''}\n`);
for (const brand of BRANDS) {
  const pkg = `com.symply.${brand}`;
  console.log(`══ ${pkg} ══`);
  for (const p of PLANS) {
    const productId = `${pkg}.${p.suffix}`;
    const existing = await api('GET', `/applications/${pkg}/subscriptions/${productId}`);
    if (existing.ok) { console.log(`    = ${productId} exists — skip`); continue; }
    if (existing.status === 404 && /Package not found/i.test(errStr(existing.json))) {
      console.log(`    ✗ ${pkg}: Package not found — app not in Play Console or SA not linked (see prereqs). Skipping app.`);
      break;
    }
    if (DRY) { console.log(`    + [dry] ${productId} (${p.period}, base plan "${p.basePlanId}")`); continue; }
    const res = await api('POST',
      `/applications/${pkg}/subscriptions?productId=${encodeURIComponent(productId)}&regionsVersion.version=${REGIONS_VERSION}`,
      subscriptionBody(pkg, productId, p));
    if (!res.ok) { console.log(`    ! ${productId} failed: ${res.status} ${errStr(res.json)}`); continue; }
    console.log(`    + created ${productId} (${p.period}, base plan "${p.basePlanId}", DRAFT)`);
  }
  console.log('');
}
console.log(DRY ? '[DRY RUN — nothing written]'
  : '✓ Done. Add prices (regionalConfigs) and activate the base plans in Play Console to complete.');
