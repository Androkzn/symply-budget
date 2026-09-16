#!/usr/bin/env node
/**
 * Preflight: is this brand's iosBuildNumber actually free on TestFlight?
 *
 * Why this exists
 * ---------------
 * A build number is only rejected at the very END of the pipeline — after a
 * ~20 minute archive, after export, during upload — with:
 *
 *   ERROR ITMS-4238: "Redundant Binary Upload. There already exists a binary
 *   upload with build version '29' for train '1.0.0'"
 *
 * That happened to House: brands/symply-house/brand.cjs still said 29 while
 * build 29 had already been uploaded on 2026-07-31. The whole archive was wasted.
 * Ten seconds of API call up front beats twenty minutes of rebuild.
 *
 * Read-only. Authenticates with the App Store Connect **API key** (Keychain
 * `symply.asc.key_id` / `symply.asc.issuer_id` / `symply.asc.key_path`), so it
 * needs no Apple ID password and never triggers 2FA.
 *
 *   node scripts/ios/check-testflight-build-number.mjs symply-house
 *
 * Exit codes: 0 = free (safe to archive) · 1 = taken (bump first) · 2 = cannot check.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ASC app ids come from eas.json's submit profiles — one source of truth, so a new
// app record only has to be recorded in one place.
const ASC_APP_ID_BY_BRAND = (() => {
  const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
  const out = {};
  for (const [name, profile] of Object.entries(eas.submit ?? {})) {
    const ios = profile?.ios;
    if (!ios?.bundleIdentifier || !ios?.ascAppId) continue;
    const brand = `symply-${ios.bundleIdentifier.split('.').pop()}`;
    out[brand] = { ascAppId: ios.ascAppId, bundleId: ios.bundleIdentifier, profile: name };
  }
  return out;
})();

const brandId = process.argv[2] || process.env.APP_BRAND || process.env.EXPO_PUBLIC_APP_BRAND;
if (!brandId) {
  console.error('[check-testflight-build-number] brand required, e.g. symply-house');
  process.exit(2);
}

const brandPath = path.join(ROOT, 'brands', brandId, 'brand.cjs');
if (!fs.existsSync(brandPath)) {
  console.error(`[check-testflight-build-number] no brand pack at ${brandPath}`);
  process.exit(2);
}
const { createRequire } = await import('node:module');
const brand = createRequire(import.meta.url)(brandPath);

const version = String(brand.iosVersion ?? '1.0.0');
const build = brand.iosBuildNumber;
if (build == null) {
  console.error(`[check-testflight-build-number] ${brandId} declares no iosBuildNumber`);
  process.exit(2);
}

const app = ASC_APP_ID_BY_BRAND[brandId];
if (!app) {
  console.error(`[check-testflight-build-number] no ascAppId for ${brandId} in eas.json submit profiles`);
  process.exit(2);
}

/** Read a Keychain generic password, or exit(2) with a human-actionable message. */
function keychain(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    console.error(
      `[check-testflight-build-number] Keychain item "${service}" not found — cannot reach App Store Connect.\n` +
        '  This check is optional; skip it and verify the build number by hand in TestFlight.',
    );
    process.exit(2);
  }
}

/** ES256 JWT for the ASC API (10-minute life, the maximum Apple accepts). */
function ascToken() {
  const keyPath = keychain('symply.asc.key_path').replace(/^~/, process.env.HOME ?? '');
  if (!fs.existsSync(keyPath)) {
    console.error(`[check-testflight-build-number] ASC private key missing at ${keyPath}`);
    process.exit(2);
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keychain('symply.asc.key_id'), typ: 'JWT' });
  const body = b64({
    iss: keychain('symply.asc.issuer_id'),
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  });
  const signer = crypto.createSign('SHA256');
  signer.update(`${head}.${body}`);
  const der = signer.sign(crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8')));
  // Apple wants the raw r||s pair, not the ASN.1 DER that Node emits.
  let o = 2;
  const rLen = der[o + 1];
  o += 2;
  let r = der.subarray(o, o + rLen);
  o += rLen;
  const sLen = der[o + 1];
  o += 2;
  let s = der.subarray(o, o + sLen);
  const pad = (b) =>
    b.length > 32 ? b.subarray(b.length - 32) : Buffer.concat([Buffer.alloc(32 - b.length), b]);
  const sig = Buffer.concat([pad(r), pad(s)]).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const token = ascToken();
const res = await fetch(
  `https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${app.ascAppId}` +
    // `preReleaseVersion` MUST be listed in fields[builds] as well as in `include`:
    // a sparse fieldset drops relationships too, which silently yields "no builds
    // on this train" and defeats the whole check.
    '&limit=200&sort=-version' +
    '&fields[builds]=version,uploadedDate,processingState,preReleaseVersion' +
    '&include=preReleaseVersion&fields[preReleaseVersions]=version',
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!res.ok) {
  console.error(
    `[check-testflight-build-number] App Store Connect returned ${res.status} ${res.statusText}\n` +
      (await res.text()).slice(0, 400),
  );
  process.exit(2);
}
const json = await res.json();

// Build numbers only collide WITHIN a train (the CFBundleShortVersionString).
// Bumping the marketing version frees the whole number space again.
const trainById = new Map(
  (json.included ?? [])
    .filter((i) => i.type === 'preReleaseVersions')
    .map((i) => [i.id, i.attributes.version]),
);
const sameTrain = (json.data ?? []).filter(
  (b) => trainById.get(b.relationships?.preReleaseVersion?.data?.id) === version,
);
const taken = new Set(sameTrain.map((b) => String(b.attributes.version)));
const numeric = [...taken].map(Number).filter((n) => Number.isFinite(n));
const highest = numeric.length ? Math.max(...numeric) : 0;

console.log(`${brand.displayName ?? brandId} — ${app.bundleId} (ASC app ${app.ascAppId})`);
console.log(`  train "${version}" on TestFlight: ${numeric.length ? [...numeric].sort((a, b) => a - b).join(', ') : '(no builds yet)'}`);
console.log(`  brands/${brandId}/brand.cjs wants build ${build}`);

if (taken.has(String(build))) {
  const uploaded = sameTrain.find((b) => String(b.attributes.version) === String(build));
  console.error(
    `\n  ✗ BUILD ${build} IS ALREADY ON TESTFLIGHT (uploaded ${uploaded?.attributes.uploadedDate}).\n` +
      `    Uploading it again fails with ITMS-4238 (Redundant Binary Upload).\n` +
      `    Fix: set iosBuildNumber: ${highest + 1} in brands/${brandId}/brand.cjs,\n` +
      `    then re-run ./scripts/prepare-xcode.sh ${brandId} before archiving.`,
  );
  process.exit(1);
}
if (Number(build) < highest) {
  console.error(
    `\n  ✗ BUILD ${build} IS BELOW the highest build on this train (${highest}).\n` +
      `    App Store Connect requires an increasing build number. Use ${highest + 1}.`,
  );
  process.exit(1);
}
console.log(`\n  ✓ build ${build} is free on train ${version} — safe to archive.`);
