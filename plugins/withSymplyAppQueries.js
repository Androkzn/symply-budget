const {
  withAndroidManifest,
  createRunOncePlugin,
} = require('@expo/config-plugins');

/**
 * Android package-visibility for the "Symply apps" grid.
 *
 * Android 11+ (targetSdk 30) hides other installed apps from a package unless it
 * declares them in a <queries> block. Without this, Linking.canOpenURL for a
 * sibling brand's scheme always returns false, so the grid could never detect
 * which Symply apps are installed. We know every sibling's package name, so we
 * list them explicitly (precise and scheme-independent). The iOS equivalent —
 * LSApplicationQueriesSchemes — is set in app.config.ts.
 *
 * Keep in sync with each brand's androidPackage in brands/<id>/brand.cjs.
 * Listing the active app's own package is harmless (a no-op) but we skip it.
 */
const SIBLING_PACKAGES = [
  'com.symply.house',
  'com.symply.budget',
  'com.symply.kaizen',
  'com.symply.language',
  'com.symply.health',
];

/**
 * Pure manifest mutation — exported for unit testing. Adds a <package> visibility
 * entry for every sibling brand (except the app's own package) into the first
 * <queries> block, creating it if absent and never duplicating an entry.
 */
function addSymplyQueries(manifest, selfPackage) {
  if (!Array.isArray(manifest.queries)) {
    manifest.queries = [];
  }
  // Reuse the first <queries> block if one exists (e.g. added by another
  // plugin), otherwise create it — Android merges multiple blocks anyway.
  let queries = manifest.queries[0];
  if (!queries) {
    queries = {};
    manifest.queries.push(queries);
  }
  if (!Array.isArray(queries.package)) {
    queries.package = [];
  }

  const existing = new Set(
    queries.package.map(p => p && p.$ && p.$['android:name']).filter(Boolean),
  );

  for (const pkg of SIBLING_PACKAGES) {
    if (pkg === selfPackage || existing.has(pkg)) continue;
    queries.package.push({ $: { 'android:name': pkg } });
    existing.add(pkg);
  }

  return manifest;
}

function withSymplyAppQueries(config) {
  return withAndroidManifest(config, cfg => {
    addSymplyQueries(cfg.modResults.manifest, cfg.android && cfg.android.package);
    return cfg;
  });
}

module.exports = createRunOncePlugin(
  withSymplyAppQueries,
  'symply-app-queries',
  '1.0.0',
);
module.exports.addSymplyQueries = addSymplyQueries;
module.exports.SIBLING_PACKAGES = SIBLING_PACKAGES;
