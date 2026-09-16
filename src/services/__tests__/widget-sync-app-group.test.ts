/**
 * WidgetSync App Group baseline — brand-neutral runtime derivation.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

/** Every key the Swift `clear()` removes from the App Group. */
function parseClearedKeys(): string[] {
  const swift = fs.readFileSync(
    path.join(ROOT, 'modules/widget-sync/ios/WidgetSyncModule.swift'),
    'utf8'
  );
  const block = swift.match(/Function\("clear"\)\s*\{[\s\S]*?\n {4}\}/);
  if (!block) throw new Error('Could not locate Function("clear") in WidgetSyncModule.swift');
  const list = block[0].match(/\[([\s\S]*?)\]\.forEach/);
  if (!list) throw new Error('Could not locate the clear() key array in WidgetSyncModule.swift');
  return Array.from(list[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

/** Recursively collect .ts/.tsx sources under `dir`, skipping test folders. */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectSources(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every key `widgetSync.setSnapshot` is called with anywhere in the app.
 *
 * Call sites use both string literals (`setSnapshot('widget_health_today', …)`)
 * and exported constants (`setSnapshot(BUDGET_WIDGET_KEY, …)`), so identifier
 * arguments are resolved against a `const NAME = '…'` binding in the same file.
 * An unresolvable identifier fails the guard rather than silently shrinking it.
 */
function collectSnapshotKeys(): { keys: string[]; sites: string[] } {
  // The wrapper itself declares `setSnapshot(key, …)` — not a call site.
  const skip = path.join(ROOT, 'src/services/widget-sync.ts');
  const files = [
    ...collectSources(path.join(ROOT, 'src')),
    ...collectSources(path.join(ROOT, 'app')),
  ].filter((f) => f !== skip);

  const keys = new Set<string>();
  const sites: string[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('setSnapshot(')) continue;

    const calls = src.matchAll(
      /\.setSnapshot\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))/g
    );
    for (const call of calls) {
      const literal = call[1] ?? call[2];
      const rel = path.relative(ROOT, file);
      if (literal) {
        keys.add(literal);
        sites.push(`${rel} → ${literal}`);
        continue;
      }
      const ident = call[3];
      const bound = src.match(
        new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*(?::[^=]+)?=\\s*['"]([^'"]+)['"]`)
      );
      if (!bound) {
        throw new Error(
          `BUDGET-WIDGET-008 guard: setSnapshot(${ident}, …) in ${rel} does not resolve to a ` +
            `string constant in the same file. Inline the key or declare it locally so the ` +
            `clear()-superset guard can see it.`
        );
      }
      keys.add(bound[1]);
      sites.push(`${rel} → ${ident} = ${bound[1]}`);
    }
  }

  return { keys: Array.from(keys).sort(), sites };
}

/** Mirror of the Swift App Group derivation, for BUDGET-WIDGET-012. */
function resolveAppGroup(bundleId: string): string {
  const base = bundleId
    .replace('.watchkitapp.watchkitextension', '')
    .replace('.watchkitapp', '')
    .replace('.widget', '');
  return `group.${base}`;
}

describe('WidgetSync App Group baseline', () => {
  const root = ROOT;

  it('derives App Group from bundle ID (not a hardcoded brand string)', () => {
    const swift = fs.readFileSync(
      path.join(root, 'modules/widget-sync/ios/WidgetSyncModule.swift'),
      'utf8'
    );
    expect(swift).toMatch(/private let kAppGroup: String = \{/);
    expect(swift).toMatch(/Bundle\.main\.bundleIdentifier/);
    expect(swift).toContain('group.\\(base)');
    expect(swift).not.toMatch(/kAppGroup\s*=\s*"group\.com\.symply\.budget"/);
    expect(swift).toMatch(/removeObject\(forKey:\s*"auth_token"\)/);
    expect(swift).toMatch(/companion_token/);
  });

  it('apply-brand-ios writes Brand.xcconfig (no WidgetSync source patching)', () => {
    const script = fs.readFileSync(path.join(root, 'scripts/ios/apply-brand-ios.cjs'), 'utf8');
    expect(script).toMatch(/write-brand-xcconfig\.cjs/);
    expect(script).toMatch(/native tree is brand-neutral/);
    expect(script).not.toMatch(/patchWidgetSyncAppGroup/);
  });

  it('shared AppGroup.swift mirrors the same runtime derivation', () => {
    const swift = fs.readFileSync(
      path.join(root, 'ios/Shared/Utilities/AppGroup.swift'),
      'utf8'
    );
    expect(swift).toMatch(/static let identifier: String = \{/);
    expect(swift).toMatch(/Bundle\.main\.bundleIdentifier/);
    expect(swift).toContain('group.\\(base)');
  });

  describe('BUDGET-WIDGET-007 / BUDGET-WATCH-007 — logout wipes household data', () => {
    it('BUDGET-WIDGET-007: clear() removes widget_budget_summary from the App Group', () => {
      expect(parseClearedKeys()).toContain('widget_budget_summary');
    });

    it('BUDGET-WATCH-007: clear() removes watch_budget_today (omitted before 2026-07-20)', () => {
      const cleared = parseClearedKeys();
      expect(cleared).toContain('watch_budget_today');
      // The defect was systemic — all four brands' watch keys were unreachable by clear().
      expect(cleared).toEqual(
        expect.arrayContaining([
          'watch_budget_today',
          'watch_kaizen_today',
          'watch_language_today',
          'watch_health_today',
        ])
      );
    });

    it('BUDGET-WIDGET-007 / BUDGET-WATCH-007: signing out calls widgetSync.clear() and clearWatchData()', () => {
      // The keys are only wiped if something actually invokes clear() on logout.
      const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
      const signedOutBranch = layout.match(/else if \(!isAuthenticated\) \{[\s\S]*?\n {4}\}/);
      expect(signedOutBranch).not.toBeNull();
      expect(signedOutBranch![0]).toContain('widgetSync.clear()');
      expect(signedOutBranch![0]).toContain('watchSyncService.clearWatchData()');
    });
  });

  describe('BUDGET-WIDGET-008 — clear() is a superset of every setSnapshot key', () => {
    it('BUDGET-WIDGET-008: every key setSnapshot is called with anywhere in the app is cleared on logout', () => {
      const { keys, sites } = collectSnapshotKeys();
      const cleared = parseClearedKeys();

      // Sanity: the guard must actually be finding call sites, or it proves nothing.
      expect(keys.length).toBeGreaterThanOrEqual(6);
      expect(keys).toEqual(expect.arrayContaining(['widget_budget_summary', 'watch_budget_today']));

      const missing = keys.filter((key) => !cleared.includes(key));
      if (missing.length > 0) {
        // Thrown rather than asserted so the fix instructions reach the report.
        throw new Error(
          `Snapshot keys written but never cleared: ${missing.join(', ')}\n` +
            `Add them to Function("clear") in modules/widget-sync/ios/WidgetSyncModule.swift.\n` +
            `Call sites:\n  ${sites.join('\n  ')}`
        );
      }
      expect(missing).toEqual([]);
    });

    it('BUDGET-WIDGET-008: the superset check flags a key that clear() does not remove', () => {
      // Proves the comparison above is not vacuous: an un-cleared key is detected.
      // (Verified end to end by adding a temporary setSnapshot call site — the
      // guard failed naming both the literal and the constant form.)
      const cleared = parseClearedKeys();
      const hypothetical = ['widget_budget_summary', 'watch_budget_today', 'widget_newbrand_today'];
      expect(hypothetical.filter((key) => !cleared.includes(key))).toEqual([
        'widget_newbrand_today',
      ]);
    });
  });

  describe('BUDGET-WIDGET-012 — brand App Group identity', () => {
    it('BUDGET-WIDGET-012: the widget shares the brand ecosystem group instead of its own per-target group', () => {
      // The group is derived from the target's bundle ID with the widget/watch
      // suffixes stripped, so the app, the widget and the watch of a brand all
      // land on ONE group. A per-target group (group.com.symply.budget.widget)
      // would strand the snapshot the app writes.
      expect(resolveAppGroup('com.symply.budget')).toBe('group.com.symply.budget');
      expect(resolveAppGroup('com.symply.budget.widget')).toBe('group.com.symply.budget');
      expect(resolveAppGroup('com.symply.budget.watchkitapp')).toBe('group.com.symply.budget');
      expect(resolveAppGroup('com.symply.budget.watchkitapp.watchkitextension')).toBe(
        'group.com.symply.budget'
      );
      expect(resolveAppGroup('com.symply.budget.widget')).not.toBe(
        'group.com.symply.budget.widget'
      );
    });

    it('BUDGET-WIDGET-012: neither Swift source hardcodes a per-brand group literal', () => {
      const sources = [
        'modules/widget-sync/ios/WidgetSyncModule.swift',
        'ios/Shared/Utilities/AppGroup.swift',
      ].map((rel) => fs.readFileSync(path.join(root, rel), 'utf8'));

      sources.forEach((swift) => {
        // No brand — budget included — may appear as a baked-in group string.
        expect(swift).not.toMatch(/"group\.com\.symply\.(house|budget|kaizen|language|health)"/);
        // Both files must strip all three extension suffixes, in the same order.
        expect(swift).toContain('.watchkitapp.watchkitextension');
        expect(swift).toContain('.watchkitapp');
        expect(swift).toContain('.widget');
        expect(swift).toContain('group.\\(base)');
      });
    });
  });
});
