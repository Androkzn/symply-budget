#!/usr/bin/env node
/**
 * Apply the active APP_BRAND to the committed ios/ tree for a native build.
 * Runs on EAS via eas-build-pre-install, and locally via scripts/prepare-xcode.sh.
 *
 * The committed ios/ tree is BRAND-NEUTRAL: project.pbxproj, the entitlements and the
 * Info.plists all reference $(SYMPLY_*) variables that resolve from ios/Brand.xcconfig
 * (the Xcode project-level base config). So "applying a brand" is now just:
 *
 *   1. write ios/Brand.generated.xcconfig  (the four leaf values for this brand).
 *   2. write ios/SymplyEcosystem/Supporting/Expo.plist (expo-updates project URL +
 *      release channel — NOT reachable via $(SYMPLY_*) substitution; see
 *      write-brand-expo-plist.cjs).
 *
 * The app icon is NOT copied anymore: each brand ships a committed per-brand icon set
 * (Images.xcassets/AppIcon-<brand>.appiconset) and the app target's build setting
 * ASSETCATALOG_COMPILER_APPICON_NAME = "AppIcon-$(SYMPLY_BRAND_ID)" selects it — so the
 * icon derives from the same single source as the bundle ID, with zero git churn.
 *
 * No more find/replace across pbxproj / entitlements / plists / Swift — that whole class
 * of baseline-drift / split-brain bug is gone. APP_BRAND must be set explicitly
 * (fail-closed — no silent House default).
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBrandIdFromEnv } = require('../../brands/resolve.cjs');

let brandId;
try {
  brandId = resolveBrandIdFromEnv();
} catch (err) {
  console.error(`[apply-brand-ios] ${err.message}`);
  process.exit(1);
}

// 1. Brand identity → ios/Brand.generated.xcconfig (single source of truth).
execFileSync(process.execPath, [path.join(__dirname, 'write-brand-xcconfig.cjs'), brandId], {
  stdio: 'inherit',
});

// 2. App icon: nothing to do — the icon derives from SYMPLY_BRAND_ID via the app target's
// ASSETCATALOG_COMPILER_APPICON_NAME = "AppIcon-$(SYMPLY_BRAND_ID)" (see the committed
// Images.xcassets/AppIcon-<brand>.appiconset sets). No file-copy → zero git churn.

// 3. expo-updates project URL + release channel → Expo.plist. NOT reachable via
// $(SYMPLY_*) xcconfig substitution like the rest of this tree: it's copied into
// the bundle verbatim by a plain Resources build phase, not processed as an
// Info.plist, so Xcode never substitutes build settings into it. Must be
// rewritten directly per brand — see write-brand-expo-plist.cjs's header for
// what happens when this is skipped.
execFileSync(process.execPath, [path.join(__dirname, 'write-brand-expo-plist.cjs'), brandId], {
  stdio: 'inherit',
});

console.log(`[apply-brand-ios] done for ${brandId} (native tree is brand-neutral; identity via Brand.xcconfig)`);
