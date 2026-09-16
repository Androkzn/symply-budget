#!/usr/bin/env node
/**
 * Sync Watch AppIcon-<brand>.appiconset from the iOS per-brand app icons.
 * Watch builds use ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon-$(SYMPLY_BRAND_ID)
 * (same as the main app). Also refreshes the legacy AppIcon.appiconset (House)
 * so the Xcode target list has a named "AppIcon" set.
 *
 *   node scripts/ios/sync-watch-app-icons.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const iosIcons = path.join(root, 'ios', 'SymplyEcosystem', 'Images.xcassets');
const watchAssets = path.join(
  root,
  'ios',
  'SymplyEcosystemWatchApp Watch App',
  'Assets.xcassets',
);

const BRANDS = ['house', 'budget', 'kaizen', 'language', 'health'];

const watchContents = {
  images: [
    {
      filename: 'App-Icon-1024x1024@1x.png',
      idiom: 'universal',
      platform: 'watchos',
      size: '1024x1024',
    },
  ],
  info: { author: 'xcode', version: 1 },
};

function copyIconPng(srcSet, destSet) {
  const src = path.join(srcSet, 'App-Icon-1024x1024@1x.png');
  if (!fs.existsSync(src)) {
    throw new Error(`missing ${src}`);
  }
  fs.mkdirSync(destSet, { recursive: true });
  fs.copyFileSync(src, path.join(destSet, 'App-Icon-1024x1024@1x.png'));
  fs.writeFileSync(path.join(destSet, 'Contents.json'), JSON.stringify(watchContents, null, 2) + '\n');
}

for (const brand of BRANDS) {
  const srcSet = path.join(iosIcons, `AppIcon-${brand}.appiconset`);
  const destSet = path.join(watchAssets, `AppIcon-${brand}.appiconset`);
  copyIconPng(srcSet, destSet);
  console.log(`[sync-watch-app-icons] AppIcon-${brand}`);
}

// Legacy / Xcode target-list set → House (template default)
copyIconPng(path.join(iosIcons, 'AppIcon-house.appiconset'), path.join(watchAssets, 'AppIcon.appiconset'));
console.log('[sync-watch-app-icons] AppIcon (house fallback)');

// Main app: named AppIcon.appiconset so Xcode's target list doesn't pick
// AppIcon-budget (alphabetically first among AppIcon-*). Build still uses
// AppIcon-$(SYMPLY_BRAND_ID) for the real product icon.
const mainAppIcon = path.join(iosIcons, 'AppIcon.appiconset');
const houseSet = path.join(iosIcons, 'AppIcon-house.appiconset');
fs.mkdirSync(mainAppIcon, { recursive: true });
for (const file of ['App-Icon-1024x1024@1x.png', 'App-Icon-Dark-1024x1024@1x.png', 'Contents.json']) {
  const from = path.join(houseSet, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(mainAppIcon, file));
}
console.log('[sync-watch-app-icons] main AppIcon.appiconset ← house (Xcode target list)');
console.log('[sync-watch-app-icons] done');
