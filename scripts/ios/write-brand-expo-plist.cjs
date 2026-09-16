#!/usr/bin/env node
/**
 * Write ios/SymplyEcosystem/Supporting/Expo.plist for one brand.
 *
 * expo-updates reads its EAS Update project URL and release channel from this
 * plist at every launch (EXUpdatesCheckOnLaunch = ALWAYS) — but unlike every
 * other native identity value (bundle IDs, App Group, entitlements, watch
 * companion id, URL schemes, app icon), this one was never wired into the
 * brand-neutral ios/ tree: it shipped as a plain committed file carrying
 * House's own EXUpdatesURL (its easProjectId) and channel
 * (symply-house-production) verbatim. Every other brand's local Debug build
 * inherited House's values unless this script has since run for it — on
 * launch, expo-updates would ask HOUSE's EAS Update project for an update on
 * a channel that project doesn't have, and in the one observed case (Health,
 * 2026-07-31) that happened to still resolve to a real, servable House build,
 * which the app then rendered in place of its own JS.
 *
 * Mirrors write-brand-xcconfig.cjs: source of truth is brands/<id>/brand.cjs,
 * this file is gitignored, so switching brands produces zero git churn.
 *
 *   node scripts/ios/write-brand-expo-plist.cjs symply-health
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const brandId = process.argv[2] || process.env.APP_BRAND || process.env.EXPO_PUBLIC_APP_BRAND;
if (!brandId) {
  console.error(
    '[write-brand-expo-plist] brand required: pass argv[2] or set APP_BRAND / EXPO_PUBLIC_APP_BRAND (no silent House default)'
  );
  process.exit(1);
}

function loadBrand(id) {
  const p = path.join(root, 'brands', id, 'brand.cjs');
  if (!fs.existsSync(p)) {
    console.error(`[write-brand-expo-plist] brand not found: ${id} (${p})`);
    process.exit(1);
  }
  return require(p);
}

const brand = loadBrand(brandId);
if (!brand.easProjectId) {
  console.error(`[write-brand-expo-plist] ${brandId} has no easProjectId in brand.cjs — cannot set EXUpdatesURL`);
  process.exit(1);
}

const plistPath = path.join(root, 'ios', 'SymplyEcosystem', 'Supporting', 'Expo.plist');
if (!fs.existsSync(plistPath)) {
  console.error(`[write-brand-expo-plist] missing ${plistPath} — run \`git checkout\` on it once, or restore from a sibling brand's checkout`);
  process.exit(1);
}

const url = `https://u.expo.dev/${brand.easProjectId}`;
const channel = `${brandId}-production`;

function plistBuddy(command) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plistPath]);
}

plistBuddy(`Set :EXUpdatesURL ${url}`);
plistBuddy(`Set :EXUpdatesRequestHeaders:expo-channel-name ${channel}`);

console.log(`[write-brand-expo-plist] ${brandId} → Expo.plist (EXUpdatesURL=${url}, channel=${channel})`);
