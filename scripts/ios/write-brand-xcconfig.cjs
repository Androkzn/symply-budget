#!/usr/bin/env node
/**
 * Write ios/Brand.generated.xcconfig for one brand — the SINGLE place brand identity
 * enters the native tree. Everything else (bundle IDs, App Group, entitlements, watch
 * companion id, URL schemes) derives from these four leaf values via ios/Brand.xcconfig.
 *
 * Source of truth: brands/<id>/brand.cjs. This file is gitignored, so switching brands
 * produces zero git churn.
 *
 *   node scripts/ios/write-brand-xcconfig.cjs symply-budget
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const brandId = process.argv[2] || process.env.APP_BRAND || process.env.EXPO_PUBLIC_APP_BRAND;
if (!brandId) {
  console.error(
    '[write-brand-xcconfig] brand required: pass argv[2] or set APP_BRAND / EXPO_PUBLIC_APP_BRAND (no silent House default)'
  );
  process.exit(1);
}

function loadBrand(id) {
  const p = path.join(root, 'brands', id, 'brand.cjs');
  if (!fs.existsSync(p)) {
    console.error(`[write-brand-xcconfig] brand not found: ${id} (${p})`);
    process.exit(1);
  }
  return require(p);
}

function googleUrlScheme(brand) {
  const iosClientId =
    brand && brand.integrations && brand.integrations.googleAuth && brand.integrations.googleAuth.iosClientId;
  if (!iosClientId) return null;
  return 'com.googleusercontent.apps.' + iosClientId.replace(/\.apps\.googleusercontent\.com$/, '');
}

const brand = loadBrand(brandId);
const shortId = brandId.replace(/^symply-/, ''); // house|budget|kaizen|language|health
const google = googleUrlScheme(brand);
if (!google) {
  console.warn(`[write-brand-xcconfig] ${brandId} has no googleAuth.iosClientId — Google Sign-In URL scheme will fall back to the bundle id`);
}

const marketingVersion = brand.iosVersion || '1.0.0';
const buildNumber = brand.iosBuildNumber;
if (buildNumber === undefined || buildNumber === null) {
  console.warn(
    `[write-brand-xcconfig] ${brandId} has no iosBuildNumber in brand.cjs — falling back to House default from Brand.xcconfig`
  );
}

const lines = [
  '// GENERATED — do not edit. Active-brand override for ios/Brand.xcconfig.',
  `// Written by scripts/ios/write-brand-xcconfig.cjs for ${brandId}.`,
  '// Gitignored: switching brands leaves no git churn. Only the leaf values',
  '// live here; all bundle IDs / app group / entitlements derive from SYMPLY_BRAND_ID.',
  `SYMPLY_BRAND_ID = ${shortId}`,
  `SYMPLY_DISPLAY_NAME = ${brand.displayName}`,
  `SYMPLY_URL_SCHEME = ${brand.scheme}`,
  `SYMPLY_GOOGLE_URL_SCHEME = ${google || '$(SYMPLY_BUNDLE_ID)'}`,
  // Per-app version identity (source of truth: brands/<id>/brand.cjs). Every native
  // target reads these via Brand.xcconfig, so app + widget + watch always match.
  `SYMPLY_MARKETING_VERSION = ${marketingVersion}`,
  ...(buildNumber === undefined || buildNumber === null ? [] : [`SYMPLY_BUILD_NUMBER = ${buildNumber}`]),
  '',
].join('\n');

const out = path.join(root, 'ios', 'Brand.generated.xcconfig');
fs.writeFileSync(out, lines);
console.log(
  `[write-brand-xcconfig] ${brandId} → ios/Brand.generated.xcconfig ` +
    `(com.symply.${shortId}, "${brand.displayName}", ${brand.scheme}://, ` +
    `v${marketingVersion}${buildNumber != null ? ` (${buildNumber})` : ''})`,
);
