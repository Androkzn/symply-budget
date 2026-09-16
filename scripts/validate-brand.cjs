#!/usr/bin/env node
/**
 * Validates brand packs before EAS / local builds.
 * Usage: APP_BRAND=symply-house node scripts/validate-brand.cjs [brandId]
 *
 * Checks identity, assets, tokens, OAuth client IDs, and iOS companion IDs
 * (widget / watch / App Group) for uniqueness across the fleet.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function loadBrands() {
  const brandsDir = path.join(root, 'brands');
  return fs
    .readdirSync(brandsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => d.name);
}

function readBrandCjs(id) {
  const cjs = path.join(root, 'brands', id, 'brand.cjs');
  const ts = path.join(root, 'brands', id, 'brand.ts');
  if (fs.existsSync(cjs)) {
    // Clear cache so repeated CI runs see edits
    delete require.cache[require.resolve(cjs)];
    return require(cjs);
  }
  if (!fs.existsSync(ts)) {
    throw new Error(`Missing brand.cjs / brand.ts for ${id}`);
  }
  // Fallback: regex parse (legacy packs without brand.cjs)
  const src = fs.readFileSync(ts, 'utf8');
  const pick = key => {
    const m = src.match(new RegExp(`${key}:\\s*['"]([^'"]+)['"]`));
    return m ? m[1] : null;
  };
  const nested = (block, key) => {
    const re = new RegExp(
      `${block}:\\s*\\{[\\s\\S]*?${key}:\\s*['"]([^'"]+)['"]`,
    );
    return src.match(re)?.[1] ?? null;
  };
  return {
    id: pick('id') || id,
    displayName: pick('displayName'),
    slug: pick('slug'),
    scheme: pick('scheme'),
    iosBundleId: pick('iosBundleId'),
    androidPackage: pick('androidPackage'),
    easProjectId: pick('easProjectId'),
    colors: { primary: src.match(/primary:\s*['"](#[0-9A-Fa-f]{6})['"]/)?.[1] },
    assets: {
      appIcon: pick('appIcon'),
      splashLight: pick('splashLight'),
      splashDark: pick('splashDark'),
      logoHorizontal: pick('logoHorizontal'),
      logoSplash: pick('logoSplash'),
    },
    integrations: {
      googleAuth: {
        iosClientId: nested('googleAuth', 'iosClientId'),
        androidClientId: nested('googleAuth', 'androidClientId'),
        webClientId: nested('googleAuth', 'webClientId'),
      },
      googleDrive: {
        iosClientId: nested('googleDrive', 'iosClientId'),
        androidClientId: nested('googleDrive', 'androidClientId'),
        webClientId: nested('googleDrive', 'webClientId'),
      },
      appleAuth: { enabled: /appleAuth:\s*\{[^}]*enabled:\s*true/.test(src) },
    },
    ios: {
      widgetBundleId: nested('ios', 'widgetBundleId'),
      watchBundleId: nested('ios', 'watchBundleId'),
      watchExtensionBundleId: nested('ios', 'watchExtensionBundleId'),
      appGroup: nested('ios', 'appGroup'),
    },
    features: {
      budget: src.match(/budget:\s*['"](off|minimal|full)['"]/)?.[1],
      widget: true,
      watch: true,
      googleDrive: true,
    },
  };
}

function requireString(brand, label, value, failedRef) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    console.error(`  ✗ missing ${label}`);
    failedRef.v = true;
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

/**
 * BUILD-3: after tokens:build / sync:widget-theme, committed Widget DesignTokens
 * must match the active APP_BRAND (colors + appGroup identity).
 */
function assertGeneratedWidgetTokens(brandId) {
  const tokensPath = path.join(
    root,
    'ios/SymplyEcosystemWidget/DesignTokens.generated.swift'
  );
  if (!fs.existsSync(tokensPath)) {
    console.error(`  ✗ missing ${path.relative(root, tokensPath)}`);
    return false;
  }
  const src = fs.readFileSync(tokensPath, 'utf8');
  const expected = `static let brandId = "${brandId}"`;
  if (!src.includes(expected)) {
    const found = src.match(/static let brandId = "([^"]+)"/)?.[1] ?? '(none)';
    console.error(
      `  ✗ DesignTokens.generated.swift brandId="${found}" ≠ APP_BRAND="${brandId}" — run: APP_BRAND=${brandId} npm run design:build`
    );
    return false;
  }
  console.log(`  ✓ DesignTokens.generated.swift brandId=${brandId}`);
  return true;
}

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const assertGeneratedTokens = argv.includes('--assert-generated-tokens');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const target =
    positional[0] ||
    process.env.APP_BRAND ||
    process.env.EXPO_PUBLIC_APP_BRAND;
  const ids = loadBrands();
  if (ids.length === 0) {
    console.error('No brands found under brands/');
    process.exit(1);
  }

  const sharedTokens = path.join(root, 'brands/_shared/tokens.base.json');
  if (!fs.existsSync(sharedTokens)) {
    console.error('Missing brands/_shared/tokens.base.json');
    process.exit(1);
  }
  console.log('✓ brands/_shared/tokens.base.json');

  const resolveCjs = path.join(root, 'brands/resolve.cjs');
  if (!fs.existsSync(resolveCjs)) {
    console.error('Missing brands/resolve.cjs (required for app.config.ts)');
    process.exit(1);
  }
  console.log('✓ brands/resolve.cjs');

  const seen = {
    iosBundleId: new Map(),
    androidPackage: new Map(),
    widgetBundleId: new Map(),
    watchBundleId: new Map(),
    watchExtensionBundleId: new Map(),
    appGroup: new Map(),
    scheme: new Map(),
    slug: new Map(),
  };

  let failed = false;
  const failedRef = {
    get v() {
      return failed;
    },
    set v(x) {
      failed = x;
    },
  };

  const toCheck = target ? [target] : ids;
  for (const id of toCheck) {
    if (!ids.includes(id)) {
      console.error(`Unknown brand id: ${id}. Known: ${ids.join(', ')}`);
      process.exit(1);
    }
    const brand = readBrandCjs(id);
    console.log(`Validating brand: ${brand.id || id}`);

    if (brand.id && brand.id !== id) {
      console.error(`  ✗ brand.id "${brand.id}" !== folder "${id}"`);
      failed = true;
    }

    requireString(brand, 'displayName', brand.displayName, failedRef);
    requireString(brand, 'slug', brand.slug, failedRef);
    requireString(brand, 'scheme', brand.scheme, failedRef);
    requireString(brand, 'iosBundleId', brand.iosBundleId, failedRef);
    requireString(brand, 'androidPackage', brand.androidPackage, failedRef);
    requireString(brand, 'easProjectId', brand.easProjectId, failedRef);

    const assets = brand.assets || {};
    for (const key of [
      'appIcon',
      'splashLight',
      'splashDark',
      'logoHorizontal',
      'logoSplash',
    ]) {
      const rel = assets[key];
      if (!rel) {
        console.error(`  ✗ missing assets.${key}`);
        failed = true;
        continue;
      }
      const abs = path.resolve(root, rel);
      if (!fs.existsSync(abs)) {
        console.error(`  ✗ asset not found (${key}): ${rel}`);
        failed = true;
      } else {
        console.log(`  ✓ assets.${key}`);
      }
    }

    const tokensJson = path.join(root, 'brands', id, 'tokens.json');
    if (!fs.existsSync(tokensJson)) {
      console.error('  ✗ missing tokens.json');
      failed = true;
    } else {
      console.log('  ✓ tokens.json');
    }

    const primary = brand.colors?.primary;
    if (!primary || !/^#[0-9A-Fa-f]{6}$/.test(primary)) {
      console.error('  ✗ missing/invalid colors.primary');
      failed = true;
    } else {
      console.log(`  ✓ primary ${primary}`);
    }

    const ga = brand.integrations?.googleAuth || {};
    for (const k of ['iosClientId', 'androidClientId', 'webClientId']) {
      requireString(brand, `integrations.googleAuth.${k}`, ga[k], failedRef);
    }
    const gd = brand.integrations?.googleDrive || {};
    for (const k of ['iosClientId', 'androidClientId', 'webClientId']) {
      requireString(brand, `integrations.googleDrive.${k}`, gd[k], failedRef);
    }
    if (brand.integrations?.appleAuth?.enabled !== true) {
      console.error('  ✗ integrations.appleAuth.enabled must be true for fleet apps');
      failed = true;
    } else {
      console.log('  ✓ appleAuth.enabled');
    }

    const ios = brand.ios || {};
    for (const k of [
      'widgetBundleId',
      'watchBundleId',
      'watchExtensionBundleId',
      'appGroup',
    ]) {
      requireString(brand, `ios.${k}`, ios[k], failedRef);
    }

    const budget = brand.features?.budget;
    if (budget !== 'off' && budget !== 'minimal' && budget !== 'full') {
      console.error('  ✗ features.budget must be off|minimal|full');
      failed = true;
    } else {
      console.log(`  ✓ features.budget=${budget}`);
    }

    // Uniqueness across fleet (skip when validating a single brand)
    if (!target) {
      const uniq = [
        ['iosBundleId', brand.iosBundleId],
        ['androidPackage', brand.androidPackage],
        ['widgetBundleId', ios.widgetBundleId],
        ['watchBundleId', ios.watchBundleId],
        ['watchExtensionBundleId', ios.watchExtensionBundleId],
        ['appGroup', ios.appGroup],
        ['scheme', brand.scheme],
        ['slug', brand.slug],
      ];
      for (const [key, value] of uniq) {
        if (!value) continue;
        const prev = seen[key].get(value);
        if (prev && prev !== id) {
          console.error(`  ✗ duplicate ${key} "${value}" (also ${prev})`);
          failed = true;
        } else {
          seen[key].set(value, id);
        }
      }
    }
  }

  // resolve.cjs must list every brand folder
  delete require.cache[require.resolve(resolveCjs)];
  const { BRANDS } = require(resolveCjs);
  for (const id of ids) {
    if (!BRANDS[id]) {
      console.error(`brands/resolve.cjs missing registry entry for "${id}"`);
      failed = true;
    }
  }

  if (assertGeneratedTokens) {
    const brandId = target;
    if (!brandId) {
      console.error(
        '--assert-generated-tokens requires APP_BRAND / EXPO_PUBLIC_APP_BRAND or a brand argv'
      );
      failed = true;
    } else if (!assertGeneratedWidgetTokens(brandId)) {
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('Brand validation passed.');
}

main();
