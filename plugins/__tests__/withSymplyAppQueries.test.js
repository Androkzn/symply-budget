/**
 * withSymplyAppQueries — Android <queries> package visibility for the "Symply
 * apps" grid, so Linking.canOpenURL can see which sibling brands are installed.
 */
const {
  addSymplyQueries,
  SIBLING_PACKAGES,
} = require('../withSymplyAppQueries');

describe('addSymplyQueries', () => {
  it('adds every sibling package and skips the app’s own', () => {
    const manifest = {};
    addSymplyQueries(manifest, 'com.symply.house');

    const names = manifest.queries[0].package.map((p) => p.$['android:name']);
    expect(names).toEqual([
      'com.symply.budget',
      'com.symply.kaizen',
      'com.symply.language',
      'com.symply.health',
    ]);
    expect(names).not.toContain('com.symply.house');
  });

  it('lists all five when the app is not one of the brands', () => {
    const manifest = {};
    addSymplyQueries(manifest, undefined);
    const names = manifest.queries[0].package.map((p) => p.$['android:name']);
    expect(names).toEqual(SIBLING_PACKAGES);
  });

  it('is idempotent — re-running does not duplicate entries', () => {
    const manifest = {};
    addSymplyQueries(manifest, 'com.symply.budget');
    addSymplyQueries(manifest, 'com.symply.budget');
    expect(manifest.queries[0].package).toHaveLength(4);
  });

  it('reuses an existing <queries> block and merges without clobbering', () => {
    const manifest = {
      queries: [{ package: [{ $: { 'android:name': 'com.other.app' } }] }],
    };
    addSymplyQueries(manifest, 'com.symply.house');
    const names = manifest.queries[0].package.map((p) => p.$['android:name']);
    expect(manifest.queries).toHaveLength(1);
    expect(names).toContain('com.other.app');
    expect(names).toContain('com.symply.budget');
  });
});
