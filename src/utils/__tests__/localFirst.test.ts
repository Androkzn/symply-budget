/**
 * `isLocalFirstBuild()` is the single switch that decides whether a connectivity
 * outage is allowed to reach the UI at all — `NetworkBlockOverlay` renders
 * nothing when it is true. It had no direct coverage, and the overlay's own
 * suite mocks it, so a broken flag underneath would have shipped green while
 * putting the "No internet connection" block back in front of a Budget member
 * whose data is entirely on the device.
 */

export {}; // module scope — these helper names are common in sibling suites

const FLAGS = [
  'EXPO_PUBLIC_HOUSE_LOCAL_FIRST',
  'EXPO_PUBLIC_BUDGET_LOCAL_FIRST',
  'EXPO_PUBLIC_HEALTH_LOCAL_FIRST',
] as const;

const original = FLAGS.map((name) => [name, process.env[name]] as const);

function setFlags(values: Partial<Record<(typeof FLAGS)[number], string>>) {
  for (const name of FLAGS) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  jest.resetModules();
});

/** Re-imported per case: the flags read `process.env` fresh, but a reset keeps
 *  a stale module graph from answering for an env the case just changed. */
function load() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../localFirst') as typeof import('../localFirst');
  return mod.isLocalFirstBuild();
}

describe('isLocalFirstBuild', () => {
  it('is true on the Budget V2 build — the flag every Budget profile ships', () => {
    setFlags({ EXPO_PUBLIC_BUDGET_LOCAL_FIRST: '1' });
    expect(load()).toBe(true);
  });

  it('is true on the House V2 build', () => {
    setFlags({ EXPO_PUBLIC_HOUSE_LOCAL_FIRST: '1' });
    expect(load()).toBe(true);
  });

  it('is true on the Health V2 build', () => {
    setFlags({ EXPO_PUBLIC_HEALTH_LOCAL_FIRST: '1' });
    expect(load()).toBe(true);
  });

  // The kill-switch drill: turning Budget's local path off must also hand the
  // connectivity gate back, because that build really does depend on a Worker.
  it('is false when every app flag is explicitly off', () => {
    setFlags({
      EXPO_PUBLIC_HOUSE_LOCAL_FIRST: '0',
      EXPO_PUBLIC_BUDGET_LOCAL_FIRST: '0',
      EXPO_PUBLIC_HEALTH_LOCAL_FIRST: '0',
    });
    expect(load()).toBe(false);
  });

  // One app's kill switch must not speak for the others.
  it('stays true for Budget when House and Health are off', () => {
    setFlags({
      EXPO_PUBLIC_HOUSE_LOCAL_FIRST: '0',
      EXPO_PUBLIC_BUDGET_LOCAL_FIRST: '1',
      EXPO_PUBLIC_HEALTH_LOCAL_FIRST: '0',
    });
    expect(load()).toBe(true);
  });
});
