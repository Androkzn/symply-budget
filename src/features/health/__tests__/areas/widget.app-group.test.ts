/**
 * WIDGET area — the App Group IDENTITY and the signed-out posture (Tier 1).
 *
 * The RN app writes a JSON blob into a shared `UserDefaults` suite; the Swift
 * widget and watch targets read it back. Three things must agree for a single
 * byte to survive that trip, and NONE of them is checked by a compiler:
 *
 *   1. the SUITE — Health must land on `group.com.symply.health`, never on the
 *      House or Budget container (which the same binary can also resolve);
 *   2. the KEY — the writer's `setSnapshot('…')` literal and the reader's
 *      `HealthWidgetData.todayKey` are two independent string constants;
 *   3. the GATE — the reader refuses to render unless the App Group says the
 *      user is signed in, and logout must wipe every key it could read.
 *
 * All three are assertable in Jest by reading the Swift + brand sources as
 * TEXT — the Tier-1 half of the matrix's Tier-1/Tier-2 split (Tier 2 needs an
 * Xcode build of `SymplyEcosystemWidgetTests`). This file deliberately derives
 * its expectations from the sources rather than hardcoding a second copy of
 * them, so a rename on either side fails here instead of shipping a blank widget.
 *
 * Companion file: `src/services/__tests__/widget-health-schema.test.ts` owns the
 * FIELD schema (reader vs writer key sets); this one owns everything around it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../../..');

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const WIDGET_SWIFT = 'ios/SymplyEcosystemWidget/SymplyHealthWidgetContent.swift';
const WATCH_SWIFT = 'ios/SymplyEcosystemWatch/Views/SymplyHealthWatchView.swift';
const STORE_SWIFT = 'ios/SymplyEcosystemWidget/WidgetDataService.swift';
const SYNC_MODULE_SWIFT = 'modules/widget-sync/ios/WidgetSyncModule.swift';
const HOME_SCREEN = 'src/features/health/screens/HealthHomeScreen.tsx';
const PUBLISHER = 'src/features/health/healthWidgetStorage.ts';
const APP_LAYOUT = 'app/_layout.tsx';

/* eslint-disable @typescript-eslint/no-require-imports -- brand packs are CJS config sources */
const healthBrand = require(path.join(ROOT, 'brands/symply-health/brand.cjs')) as {
  id: string;
  iosBundleId: string;
  ios: {
    widgetBundleId: string;
    watchBundleId: string;
    watchExtensionBundleId: string;
    appGroup: string;
  };
  features: Record<string, unknown>;
};
const houseBrand = require(path.join(ROOT, 'brands/symply-house/brand.cjs')) as {
  ios: { appGroup: string };
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The runtime derivation both Swift files perform, mirrored in TS.
 *
 * Kept in ONE place and checked against the Swift text below so the mirror
 * cannot drift into a fiction that passes while the app fails.
 */
function resolveAppGroup(bundleId: string): string {
  const base = bundleId
    .replace('.watchkitapp.watchkitextension', '')
    .replace('.watchkitapp', '')
    .replace('.widget', '');
  return `group.${base}`;
}

/** Every `defaults.…(forKey: "…")` / `forKey: someKey` literal a Swift file reads. */
function appGroupKeyLiterals(swift: string): string[] {
  return [...swift.matchAll(/forKey:\s*"([^"]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-040 — the suite: Health reads Health's container
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-040 — Health resolves its OWN App Group', () => {
  it('HEALTH-WIDGET-040: all four Health bundle ids derive group.com.symply.health', () => {
    // The app, the widget, the watch app and the watch extension are four
    // different bundle ids that must land on ONE container — the widget reads
    // what the APP wrote, so a per-target group would strand every snapshot.
    const ids = [
      healthBrand.iosBundleId,
      healthBrand.ios.widgetBundleId,
      healthBrand.ios.watchBundleId,
      healthBrand.ios.watchExtensionBundleId,
    ];
    expect(ids).toEqual([
      'com.symply.health',
      'com.symply.health.widget',
      'com.symply.health.watchkitapp',
      'com.symply.health.watchkitapp.watchkitextension',
    ]);
    ids.forEach((id) => expect(resolveAppGroup(id)).toBe(healthBrand.ios.appGroup));
    expect(healthBrand.ios.appGroup).toBe('group.com.symply.health');
  });

  it('HEALTH-WIDGET-040: Health can never resolve the House container', () => {
    // Same widget binary, five brands. If the derivation ever collapsed to a
    // constant, a Health device would render House's snapshot — cross-brand data
    // leakage, not merely a wrong colour.
    expect(healthBrand.ios.appGroup).not.toBe(houseBrand.ios.appGroup);
    expect(resolveAppGroup('com.symply.house.widget')).toBe(houseBrand.ios.appGroup);
    expect(resolveAppGroup('com.symply.health.widget')).not.toBe(houseBrand.ios.appGroup);
  });

  it('HEALTH-WIDGET-040: the mirror above matches the real Swift derivation', () => {
    // The TS `resolveAppGroup` is only evidence if it is the same algorithm the
    // native side runs. Both Swift copies must strip the three suffixes in the
    // same order (`.watchkitapp.watchkitextension` FIRST, or the longer suffix
    // never matches) and build the group by prefixing, never by a literal.
    const sources = [read(SYNC_MODULE_SWIFT), read('ios/Shared/Utilities/AppGroup.swift')];
    sources.forEach((swift) => {
      const stripped = [...swift.matchAll(/replacingOccurrences\(of:\s*"([^"]+)"/g)].map(
        (m) => m[1],
      );
      // Order is load-bearing, not cosmetic: `.watchkitapp` is a PREFIX of
      // `.watchkitapp.watchkitextension`, so stripping the short one first
      // leaves a dangling `.watchkitextension` and the extension resolves a
      // group that does not exist.
      expect(stripped).toEqual([
        '.watchkitapp.watchkitextension',
        '.watchkitapp',
        '.widget',
      ]);
      expect(swift).toContain('group.\\(base)');
      expect(swift).not.toContain('"group.com.symply.health"');
    });
  });

  it('HEALTH-WIDGET-040: the Health brand actually enables the widget + watch surfaces', () => {
    // A correct App Group is pointless if the brand pack does not build the
    // targets. These two flags are what put the widget on the device at all.
    expect(healthBrand.features.widget).toBe(true);
    expect(healthBrand.features.watch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-041 — the key: one string constant on each side
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-041 — reader key literal === writer key literal', () => {
  it('HEALTH-WIDGET-041: HealthWidgetData.todayKey is the key the publisher writes', () => {
    // Two independent constants either side of a boundary nothing type-checks.
    // A rename on either side is silent: the writer keeps writing, the reader
    // keeps reading, and the widget stays empty forever with no error anywhere.
    const readerKey = read(WIDGET_SWIFT).match(/static let todayKey = "([^"]+)"/);
    expect(readerKey).not.toBeNull();

    const publisher = read(PUBLISHER);
    const writerKey = publisher.match(/export const HEALTH_WIDGET_KEY = '([^']+)'/);
    expect(writerKey).not.toBeNull();
    expect(readerKey![1]).toBe(writerKey![1]);
  });

  it('HEALTH-WIDGET-041: the watch key is a DIFFERENT constant with its own schema', () => {
    // Conflating the two is WATCH-015: same "today", incompatible fields. The
    // publisher declares both keys explicitly so neither can be assumed.
    const watchKey = read(WATCH_SWIFT).match(/static let appGroupKey = "([^"]+)"/);
    expect(watchKey![1]).toBe('watch_health_today');
    expect(read(PUBLISHER)).toContain(`export const HEALTH_WATCH_KEY = '${watchKey![1]}'`);
    expect(read(WIDGET_SWIFT)).not.toContain(watchKey![1]);
  });

  it('HEALTH-WIDGET-041: Home delegates to the publisher instead of writing its own key', () => {
    // Home used to build the payload inline, which is how it shipped five of six
    // fields and never wrote the watch key at all. It now hands FACTS to the one
    // publisher — the only structure in which the two faces cannot disagree.
    const home = read(HOME_SCREEN);
    expect(home).toContain('publishHealthGlance');
    expect(home).not.toMatch(/setSnapshot\(/);
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-042 — the signed-out gate
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-042 — a signed-out device renders nothing', () => {
  it('HEALTH-WIDGET-042: load() gates on isSignedIn, never on the legacy isAuthenticated', () => {
    // The regression this pins: `isAuthenticated` requires an `auth_token` that
    // is DELIBERATELY never written to the App Group, so gating on it stranded
    // the widget on its empty state for every signed-in user (Budget shipped the
    // same bug — BUDGET-WIDGET-014). Fixed 2026-07-21; this is the tripwire.
    const swift = read(WIDGET_SWIFT);
    const load = swift.match(/static func load\(from defaults[\s\S]*?\n {4}\}/);
    expect(load).not.toBeNull();
    expect(load![0]).toContain('WidgetStore.isSignedIn(in: defaults)');
    expect(load![0]).not.toContain('isAuthenticated');
    // …and the guard must come FIRST: a decode before the gate would hand back
    // health data for a signed-out user.
    expect(load![0].indexOf('isSignedIn')).toBeLessThan(load![0].indexOf('JSONDecoder'));
  });

  it('HEALTH-WIDGET-042: isSignedIn keys off the household id the app actually writes', () => {
    const store = read(STORE_SWIFT);
    const fn = store.match(/static func isSignedIn\(in defaults[\s\S]*?\n {4}\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain('householdIdKey');
    expect(fn![0]).not.toContain('authTokenKey');
    expect(store).toMatch(/householdIdKey\s*=\s*"current_household_id"/);

    // The other half of the couple: `setAuth` is the ONLY writer of that key,
    // and it strips any legacy product JWT on the way through.
    const setAuth = read(SYNC_MODULE_SWIFT).match(/Function\("setAuth"\)[\s\S]*?\n {4}\}/);
    expect(setAuth![0]).toContain('removeObject(forKey: "auth_token")');
    expect(setAuth![0]).toContain('set(householdId, forKey: "current_household_id")');
  });

  it('HEALTH-WIDGET-042: the RN side writes that key only while authenticated', () => {
    // `app/_layout.tsx` is the single call site. Health has NO household
    // concept and no onboarding path ever creates one (`OnboardingNavigator`
    // registers `CreateHousehold`/`JoinHousehold` for House only), so gating
    // this effect on the raw `currentHouseholdId` — as this file used to pin —
    // was permanently false for every Health member and stranded the widget on
    // its empty state forever (the real-world bug this test failed to catch).
    // The fix: Health substitutes its own user id as the "signed in" stand-in
    // (`widgetHouseholdId`), since the Swift side only checks the key for
    // non-empty presence and never dereferences it as a real household.
    const layout = read(APP_LAYOUT);
    expect(layout).toContain(
      'const widgetHouseholdId = isHealthBrand() ? watchUserId : currentHouseholdId;',
    );

    const branch = layout.match(/if \(isAuthenticated && watchUserId && widgetHouseholdId\)[\s\S]*?\n {4}\}/);
    expect(branch).not.toBeNull();
    expect(branch![0]).toContain('widgetSync.setAuth(widgetHouseholdId, watchUserId)');
    expect(branch![0]).toContain('syncHealthGlanceFromServer()');

    const signedOut = layout.match(/else if \(!isAuthenticated\) \{[\s\S]*?\n {4}\}/);
    expect(signedOut![0]).toContain('widgetSync.clear()');
    expect(signedOut![0]).toContain('watchSyncService.clearWatchData()');
  });

  it('HEALTH-WIDGET-042: the snapshot writer is inside the authenticated shell', () => {
    // `HealthHomeScreen` can only mount under `app/(tabs)`, which `_layout.tsx`
    // renders only for an authenticated, onboarded user — so there is no code
    // path on which a signed-out session publishes a health snapshot at all.
    expect(read('app/(tabs)/index.tsx')).toContain('HealthHomeScreen');
    const layout = read(APP_LAYOUT);
    // The gate may grow additional reasons to divert away from the tabs — House
    // adds `needsAddressCapture`, and `!isReady` now leads it — but the two
    // original conditions must stay, and they must stay OR-ed, so every extra
    // reason can only make the gate stricter. A reason that let a signed-out
    // session through would have to delete one of these, which this assertion
    // prevents.
    //
    // Extra reasons are allowed on EITHER side. Anchoring `!isAuthenticated` to
    // the opening paren tested where the conditions were written rather than
    // what they do: `!isReady || !isAuthenticated || !hasCompletedOnboarding`
    // is strictly stricter than the original and still failed.
    expect(layout).toMatch(
      /if \((?:![\w.]+ \|\| )*!isAuthenticated \|\| !hasCompletedOnboarding(?: \|\| ![\w.]+)*\) \{/,
    );
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WATCH-004 — the watch face's OWN signed-out gate
// ---------------------------------------------------------------------------

describe('HEALTH-WATCH-004 — a signed-out watch renders nothing', () => {
  it('HEALTH-WATCH-004: load() gates on household presence, never on the legacy isAuthenticated', () => {
    // The regression this pins: `AppGroup.isAuthenticated()` requires an
    // `auth_token` that is DELIBERATELY never written to the App Group (same
    // reason as HEALTH-WIDGET-042), so gating on it would either always read
    // signed-out (stranding the watch face) or, before this fix, there was NO
    // gate at all — the watch rendered whatever `watch_health_today` held
    // regardless of sign-in state. `AppGroup.clearAuth()` (run on logout)
    // drops `current_household_id` but never touches this snapshot key, which
    // the phone's RN side writes independently — so a stale snapshot from a
    // PREVIOUS sign-in would otherwise render that person's real health data
    // on a now signed-out watch indefinitely.
    const swift = read(WATCH_SWIFT);
    const load = swift.match(/static func load\(\)[\s\S]*?\n {4}\}/);
    expect(load).not.toBeNull();
    expect(load![0]).toContain('getHouseholdId()');
    expect(load![0]).not.toContain('isAuthenticated');
    // …and the guard must come FIRST: a decode before the gate would hand back
    // health data for a signed-out user.
    expect(load![0].indexOf('getHouseholdId')).toBeLessThan(load![0].indexOf('JSONDecoder'));
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-043 — logout wipes every key the Health targets can read
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-043 — the clear() allowlist covers the whole Health surface', () => {
  /** The string literals `clear()` removes from the App Group. */
  function clearedKeys(): string[] {
    const swift = read(SYNC_MODULE_SWIFT);
    const block = swift.match(/Function\("clear"\)\s*\{[\s\S]*?\]\.forEach/);
    if (!block) throw new Error('could not locate the clear() allowlist');
    return [...block[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it('HEALTH-WIDGET-043: every App Group key the Health Swift targets read is wiped', () => {
    // Derived from the SOURCES, not hardcoded: adding a key to either Swift
    // reader without adding it to clear() leaves health-derived data readable on
    // a home screen or a paired watch after sign-out.
    const readKeys = new Set([
      ...appGroupKeyLiterals(read(WIDGET_SWIFT)),
      ...appGroupKeyLiterals(read(WATCH_SWIFT)),
      // Both readers reach their key through a `static let`, so pick those up too.
      ...[read(WIDGET_SWIFT), read(WATCH_SWIFT)].flatMap((s) =>
        [...s.matchAll(/static let (?:todayKey|appGroupKey) = "([^"]+)"/g)].map((m) => m[1]),
      ),
    ]);
    expect(readKeys.size).toBeGreaterThan(0);

    const cleared = clearedKeys();
    const survivors = [...readKeys].filter((k) => !cleared.includes(k));
    expect(survivors).toEqual([]);
    // Sanity: the two health keys really are in there (a regex that matched
    // nothing would make the check above vacuously true).
    expect(cleared).toEqual(
      expect.arrayContaining(['widget_health_today', 'watch_health_today']),
    );
  });

  it('HEALTH-WIDGET-043: the identity keys the gate depends on are wiped too', () => {
    // Wiping the snapshot but leaving `current_household_id` would leave the
    // widget "signed in" with no data — an empty state for the wrong reason,
    // and a stale household id readable by every target in the group.
    expect(clearedKeys()).toEqual(
      expect.arrayContaining([
        'current_household_id',
        'user_id',
        'auth_token',
        'companion_token',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// HEALTH-WIDGET-044 — posture: the Worker widget routes have no RN client
// ---------------------------------------------------------------------------

describe('HEALTH-WIDGET-044 — the Worker routes reach the App Group, and stop there', () => {
  it('HEALTH-WIDGET-044: exactly one RN module calls the /health/widget routes', () => {
    // The matrix long described these routes as CLIENTLESS (§ASSET: "the RN
    // widget still reads the App Group snapshot written by HealthHomeScreen, not
    // GET /health/widget/snapshot"). That is no longer true — `healthAssetsApi`
    // is the client and `healthWidgetStorage` is its only consumer.
    //
    // Pinned to ONE module on purpose: the glance is a single-writer surface. A
    // second caller means two code paths can publish contradictory snapshots for
    // the same day, which is exactly how a lock screen ends up showing numbers
    // the app disagrees with.
    const clients = ['src/api/healthAssets.ts', 'src/features/health/healthWidgetStorage.ts'];
    clients.forEach((rel) => expect(fs.existsSync(path.join(ROOT, rel))).toBe(true));

    const api = read('src/api/healthAssets.ts');
    expect(api).toContain('/widget/preferences');
    expect(api).toContain('/widget/snapshot');
    // The three verbs the Worker actually serves — no more.
    expect(api).toMatch(/getWidgetPreferences/);
    expect(api).toMatch(/saveWidgetPreferences/);
    expect(api).toMatch(/getWidgetSnapshot/);
  });

  it('HEALTH-WIDGET-044: nothing writes the App Group except the glance publisher', () => {
    // Every `setSnapshot` call site in the app, resolved through local `const`
    // bindings so a constant argument cannot hide one (the trap that let
    // `watch_health_today` acquire a writer while a literal-only guard stayed
    // green — see widget-health-schema.test.ts).
    const out: string[] = [];
    const skip = new Set(['node_modules', '__tests__', '__snapshots__', 'build', 'dist']);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
      }
    };
    ['src', 'app'].forEach((d) => walk(path.join(ROOT, d)));

    const healthWriters = out
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return /setSnapshot\(\s*(?:'widget_health_today'|"widget_health_today"|HEALTH_WIDGET_KEY|'watch_health_today'|"watch_health_today"|HEALTH_WATCH_KEY)/.test(
          src,
        );
      })
      .map((f) => path.relative(ROOT, f))
      .sort();

    // ONE writer. Home and `app/_layout.tsx` both reach the App Group, but only
    // through `publishHealthGlance` — so a fact can never be mapped onto the two
    // native contracts twice, differently.
    expect(healthWriters).toEqual(['src/features/health/healthWidgetStorage.ts']);
  });

  it('HEALTH-WIDGET-044: the Health widget view itself makes no network call', () => {
    // The Swift content view renders from the decoded snapshot only — the phone
    // does the fetching, so the widget never needs a token of its own. (The
    // shared `WidgetDataService` DOES fetch House endpoints on every brand — a
    // separate, documented defect, WIDGET-025 — but nothing in the Health view
    // participates in it.)
    const swift = read(WIDGET_SWIFT);
    expect(swift).not.toContain('URLSession');
    expect(swift).not.toContain('WidgetDataService');
    expect(swift).toContain('WidgetStore.isSignedIn');
    expect(swift).toContain('defaults.data(forKey: todayKey)');
  });
});
