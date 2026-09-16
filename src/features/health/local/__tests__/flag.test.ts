/**
 * He1 — the client gate (plan §1.7).
 *
 * The ORDERING is the whole point of this suite. `flag.ts` must honour an
 * explicit `=1` / `=0` BEFORE it suppresses the brand default under Jest.
 *
 * An implementation that returns `false` unconditionally when `JEST_WORKER_ID`
 * is set looks equivalent and is not: it makes the `=1` pin below unpassable and
 * leaves the entire Health local path uncoverable by any suite. That regression
 * is exactly what "honours an explicit =1 even under Jest" catches — do not
 * "simplify" it away.
 *
 * Harness note: restore the individual key, never `process.env = {...}`.
 * Reassigning the whole object detaches Node's env magic, after which later
 * writes silently do not take effect — which produced four bogus failures the
 * first time this file was written. Same shape as
 * `src/features/budget/local/__tests__/flag.test.ts`.
 */

const FLAG = 'EXPO_PUBLIC_HEALTH_LOCAL_FIRST';
const P2P = 'EXPO_PUBLIC_HEALTH_P2P';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function loadFlag(): typeof import('../flag') {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../flag') as typeof import('../flag');
}

describe('isHealthLocalFirst', () => {
  const originalFlag = process.env[FLAG];

  afterEach(() => {
    setEnv(FLAG, originalFlag);
    jest.resetModules();
  });

  it('honours an explicit =1 even under Jest', () => {
    // These suites always run with JEST_WORKER_ID set, so this asserts the
    // explicit check runs BEFORE the Jest brand-default suppression.
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    setEnv(FLAG, '1');
    expect(loadFlag().isHealthLocalFirst()).toBe(true);
  });

  it('honours an explicit =0', () => {
    setEnv(FLAG, '0');
    expect(loadFlag().isHealthLocalFirst()).toBe(false);
  });

  it('suppresses the BRAND DEFAULT under Jest when unset', () => {
    // So the existing remote-api suites keep testing the remote HTTP contract
    // rather than being routed into a ledger with no open session.
    setEnv(FLAG, undefined);
    expect(loadFlag().isHealthLocalFirst()).toBe(false);
  });

  it('treats any value other than "1"/"0" as unset', () => {
    for (const value of ['true', 'yes', 'TRUE', '', '2']) {
      setEnv(FLAG, value);
      expect(loadFlag().isHealthLocalFirst()).toBe(false);
    }
  });
});

describe('isHealthP2PEnabled', () => {
  const originalP2P = process.env[P2P];

  afterEach(() => {
    setEnv(P2P, originalP2P);
    jest.resetModules();
  });

  it('is on when =1', () => {
    setEnv(P2P, '1');
    expect(loadFlag().isHealthP2PEnabled()).toBe(true);
  });

  it('is off unless explicitly =1', () => {
    for (const value of [undefined, '0', 'true']) {
      setEnv(P2P, value);
      expect(loadFlag().isHealthP2PEnabled()).toBe(false);
    }
  });

  it('stays off by default — Wave A ships no WebRTC and no SSE', () => {
    setEnv(P2P, undefined);
    expect(loadFlag().isHealthP2PEnabled()).toBe(false);
  });
});
