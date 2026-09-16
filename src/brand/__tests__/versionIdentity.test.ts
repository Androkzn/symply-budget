/**
 * Per-app iOS version identity — drift guard.
 *
 * Each brand owns its OWN version/build (`iosVersion` / `iosBuildNumber` in
 * brands/<id>/brand.cjs). Those values are pinned into the native Xcode project
 * per brand-configuration (project-level Debug-<brand> / Release-<brand>) by
 * scripts/ios/ensure-brand-configurations.rb, so the version follows the SCHEME
 * you archive — independent of the gitignored Brand.generated.xcconfig override.
 *
 * This suite reads the committed native project + brand packs and fails if they
 * ever drift apart. It is the regression guard for the bug where MARKETING_VERSION
 * / CURRENT_PROJECT_VERSION were hardcoded (and stale: app=4, widget=26, watch=34)
 * in project.pbxproj AND the Info.plist literals silently overrode the build
 * settings — so every brand shipped the wrong, shared version.
 */
import fs from 'fs';
import path from 'path';

// Single source of truth for brand packs (same resolver the build tooling reads).
const { BRANDS } = require('../../../brands/resolve.cjs') as {
  BRANDS: Record<string, { id: string; iosVersion?: unknown; iosBuildNumber?: unknown }>;
};

const ROOT = path.resolve(__dirname, '../../..');
const IOS = path.join(ROOT, 'ios');
const PBXPROJ = path.join(IOS, 'SymplyEcosystem.xcodeproj', 'project.pbxproj');

const BRAND_IDS = [
  'symply-house',
  'symply-budget',
  'symply-kaizen',
  'symply-language',
  'symply-health',
] as const;

const loadBrand = (id: string) => BRANDS[id];

const pbxproj = fs.readFileSync(PBXPROJ, 'utf8');

/** Every XCBuildConfiguration object, split so each `body` is bounded to one object. */
function xcbuildConfigs(): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  // Non-greedy from each object's `isa` to its own (lowercase) `name = "…";` — build
  // setting KEYS are UPPER_SNAKE, so lowercase `name = ` only marks the object name.
  const re = /isa = XCBuildConfiguration;([\s\S]*?)\bname = "?([^";]+)"?;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pbxproj)) !== null) out.push({ body: m[1], name: m[2] });
  return out;
}

/**
 * Read the value assigned to `key` inside the build configuration named `configName`
 * (e.g. `Release-house`). Several objects share the name (project + per-target); only
 * the project-level one keeps the SYMPLY_* pins (targets delete them to inherit), so
 * return the first object that actually defines `key`.
 */
function projectConfigSetting(configName: string, key: string): string | undefined {
  for (const cfg of xcbuildConfigs()) {
    if (cfg.name !== configName) continue;
    const m = cfg.body.match(new RegExp(`\\b${key} = ([^;]+);`));
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return undefined;
}

describe('iOS per-app version identity', () => {
  it.each(BRAND_IDS)('%s brand.cjs declares a valid iosVersion + iosBuildNumber', (id) => {
    const brand = loadBrand(id);
    expect(typeof brand.iosVersion).toBe('string');
    expect(brand.iosVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isInteger(brand.iosBuildNumber)).toBe(true);
    expect(brand.iosBuildNumber as number).toBeGreaterThan(0);
  });

  it.each(BRAND_IDS)(
    '%s native Release/Debug configs pin SYMPLY_* to the brand.cjs version',
    (id) => {
      const brand = loadBrand(id);
      const short = id.replace(/^symply-/, '');
      for (const base of ['Release', 'Debug']) {
        const cfg = `${base}-${short}`;
        expect(projectConfigSetting(cfg, 'SYMPLY_MARKETING_VERSION')).toBe(String(brand.iosVersion));
        expect(projectConfigSetting(cfg, 'SYMPLY_BUILD_NUMBER')).toBe(String(brand.iosBuildNumber));
      }
    }
  );

  it('never hardcodes MARKETING_VERSION / CURRENT_PROJECT_VERSION — always the SYMPLY_* variables', () => {
    // Negative lookbehind excludes the SYMPLY_MARKETING_VERSION pins (whose tail is
    // literally "MARKETING_VERSION = 1.0.0;") — we only want the real build-setting keys.
    const marketing = pbxproj.match(/(?<![A-Z_])MARKETING_VERSION = ([^;]+);/g) ?? [];
    const current = pbxproj.match(/(?<![A-Z_])CURRENT_PROJECT_VERSION = ([^;]+);/g) ?? [];
    expect(marketing.length).toBeGreaterThan(0);
    expect(current.length).toBeGreaterThan(0);
    for (const line of marketing) expect(line).toContain('$(SYMPLY_MARKETING_VERSION)');
    for (const line of current) expect(line).toContain('$(SYMPLY_BUILD_NUMBER)');
  });

  it('app + widget Info.plist reference the build-setting variables, not literals', () => {
    for (const plist of [
      path.join(IOS, 'SymplyEcosystem', 'Info.plist'),
      path.join(IOS, 'SymplyEcosystemWidget', 'Info.plist'),
    ]) {
      const xml = fs.readFileSync(plist, 'utf8');
      expect(xml).toMatch(
        /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/
      );
      expect(xml).toMatch(
        /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/
      );
    }
  });

  it('Brand.xcconfig ships House-default version vars as the fallback for plain Debug/Release', () => {
    const xc = fs.readFileSync(path.join(IOS, 'Brand.xcconfig'), 'utf8');
    expect(xc).toMatch(/^SYMPLY_MARKETING_VERSION = \d+\.\d+\.\d+/m);
    expect(xc).toMatch(/^SYMPLY_BUILD_NUMBER = \d+/m);
  });
});
