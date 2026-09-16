#!/usr/bin/env node
/**
 * Patch committed android/ applicationId + google-services.json for the active
 * APP_BRAND. Runs on EAS via eas-build-pre-install before the native build.
 *
 * The committed android/ IS House's config (applicationId com.symply.house,
 * google-services.json = brands/symply-house/). For other brands we swap the
 * applicationId (what Google Sign-In / Play match) and drop in that brand's
 * google-services.json (so the Firebase plugin's package check passes).
 * `namespace` (the R-class package) is left as-is — applicationId != namespace
 * is fine and avoids moving the Java package directory.
 *
 * Fail-closed: APP_BRAND must be set (no silent House default). Patching hard-fails
 * if House baseline strings are missing or android/ is not on the House baseline.
 */
const fs = require('fs');
const path = require('path');
const { resolveBrandIdFromEnv, getBrandById } = require('../../brands/resolve.cjs');

const root = path.join(__dirname, '..', '..');

const HOUSE_APPLICATION_ID = 'com.symply.house';
const HOUSE_APP_NAME = 'Symply House';
const HOUSE_APP_SCHEME = 'simplehouse';
const HOUSE_ANDROID_SCHEME =
  'com.googleusercontent.apps.144228018802-c03usi8aoom1lgh9p3mgq74m10o5ojd8';

function fail(message) {
  console.error(`[apply-brand-android] ${message}`);
  process.exit(1);
}

let brandId;
try {
  brandId = resolveBrandIdFromEnv();
} catch (err) {
  fail(err.message);
}

const brand = getBrandById(brandId);
const pkg = brand.androidPackage;
if (!pkg) {
  fail(`${brandId} has no androidPackage`);
}

function androidPackageToBrandId(applicationId) {
  if (!applicationId || !applicationId.startsWith('com.symply.')) {
    return null;
  }
  return `symply-${applicationId.slice('com.symply.'.length)}`;
}

function detectSourceApplicationId(gradle) {
  const match = gradle.match(/applicationId\s+'([^']+)'/);
  return match ? match[1] : null;
}

/** Replace `search` once; error if neither search nor replacement is present. */
function requireReplace(content, search, replacement, label) {
  if (content.includes(replacement)) {
    return content;
  }
  if (!content.includes(search)) {
    fail(`missing House baseline for ${label}: expected "${search}"`);
  }
  return content.split(search).join(replacement);
}

const gradlePath = path.join(root, 'android/app/build.gradle');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const sourceApplicationId = detectSourceApplicationId(gradle);
if (!sourceApplicationId) {
  fail('could not detect applicationId in android/app/build.gradle');
}

const sourceBrandId = androidPackageToBrandId(sourceApplicationId);

if (sourceApplicationId === pkg) {
  console.log(
    `[apply-brand-android] ${brandId} — android/ already matches (${pkg}), no patch needed`,
  );
  process.exit(0);
}

if (sourceBrandId !== 'symply-house') {
  fail(
    `android/ baseline is ${sourceApplicationId} (${sourceBrandId ?? 'unknown'}), not House ` +
      `(${HOUSE_APPLICATION_ID}). Reset android/ to the House baseline before patching.`,
  );
}

// 1) applicationId in build.gradle: com.symply.house → this brand's package.
let patchedGradle = requireReplace(
  gradle,
  `applicationId '${HOUSE_APPLICATION_ID}'`,
  `applicationId '${pkg}'`,
  'applicationId',
);
if (patchedGradle !== gradle) {
  fs.writeFileSync(gradlePath, patchedGradle);
  console.log(`[apply-brand-android] build.gradle applicationId → ${pkg}`);
}

// 2) google-services.json: use this brand's (package_name must equal applicationId).
const brandGsvc = path.join(root, 'brands', brandId, 'google-services.json');
const destGsvc = path.join(root, 'android/app/google-services.json');
if (!fs.existsSync(brandGsvc)) {
  fail(`no brands/${brandId}/google-services.json — required for ${brandId} builds`);
}
fs.copyFileSync(brandGsvc, destGsvc);
console.log(`[apply-brand-android] google-services.json ← brands/${brandId}/`);

// 3) App display name (strings.xml app_name). House baseline = "Symply House".
const stringsPath = path.join(root, 'android/app/src/main/res/values/strings.xml');
if (!fs.existsSync(stringsPath)) {
  fail(`missing ${stringsPath}`);
}
let strings = fs.readFileSync(stringsPath, 'utf8');
const stringsBefore = strings;
strings = requireReplace(
  strings,
  `<string name="app_name">${HOUSE_APP_NAME}</string>`,
  `<string name="app_name">${brand.displayName}</string>`,
  'app_name',
);
if (strings !== stringsBefore) {
  fs.writeFileSync(stringsPath, strings);
  console.log(`[apply-brand-android] app_name → ${brand.displayName}`);
}

// 3a) App's own deep-link URL scheme in AndroidManifest.xml (simplehouse://, used by
// Maestro E2E deep links, invite links, Metro dev-client connect). House baseline =
// "simplehouse"; swap to this brand's scheme.
if (!brand.scheme) {
  fail(`${brandId} has no scheme`);
}
if (brand.scheme !== HOUSE_APP_SCHEME) {
  const manifestPath2 = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  if (!fs.existsSync(manifestPath2)) {
    fail(`missing ${manifestPath2}`);
  }
  let manifestForScheme = fs.readFileSync(manifestPath2, 'utf8');
  const manifestForSchemeBefore = manifestForScheme;
  manifestForScheme = requireReplace(
    manifestForScheme,
    `<data android:scheme="${HOUSE_APP_SCHEME}"/>`,
    `<data android:scheme="${brand.scheme}"/>`,
    'app deep-link scheme',
  );
  if (manifestForScheme !== manifestForSchemeBefore) {
    fs.writeFileSync(manifestPath2, manifestForScheme);
    console.log(`[apply-brand-android] app deep-link scheme → ${brand.scheme}`);
  }
}

// 3b) Google Drive OAuth redirect scheme in AndroidManifest.xml (reversed Android
// client ID). House baseline = House's android client; swap to this brand's.
const androidGoogle =
  brand.integrations &&
  brand.integrations.googleAuth &&
  brand.integrations.googleAuth.androidClientId;
if (androidGoogle) {
  const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  const brandScheme =
    'com.googleusercontent.apps.' +
    androidGoogle.replace(/\.apps\.googleusercontent\.com$/, '');
  if (!fs.existsSync(manifestPath)) {
    fail(`missing ${manifestPath}`);
  }
  if (brandScheme !== HOUSE_ANDROID_SCHEME) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    const manifestBefore = manifest;
    manifest = requireReplace(
      manifest,
      HOUSE_ANDROID_SCHEME,
      brandScheme,
      'Google Drive redirect scheme',
    );
    if (manifest !== manifestBefore) {
      fs.writeFileSync(manifestPath, manifest);
      console.log('[apply-brand-android] Google Drive redirect scheme → brand android client');
    }
  }
}

// 4) Launcher icons: copy this brand's pre-generated per-density webps over the
// committed House icons (adaptive foreground + legacy square/round, 5 densities).
const iconRoot = path.join(root, 'brands', brandId, 'android-icons');
if (!fs.existsSync(iconRoot)) {
  fail(`no brands/${brandId}/android-icons — required for ${brandId} builds`);
}
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const names = ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp'];
let copied = 0;
for (const density of densities) {
  for (const name of names) {
    const source = path.join(iconRoot, `mipmap-${density}`, name);
    const destination = path.join(root, 'android/app/src/main/res', `mipmap-${density}`, name);
    if (fs.existsSync(source) && fs.existsSync(path.dirname(destination))) {
      fs.copyFileSync(source, destination);
      copied++;
    }
  }
}
if (copied === 0) {
  fail(`brands/${brandId}/android-icons exists but no icon files were copied`);
}
console.log(
  `[apply-brand-android] launcher icons ← brands/${brandId}/android-icons (${copied} files)`,
);

console.log(`[apply-brand-android] done for ${brandId} → ${pkg} (${brand.displayName})`);
