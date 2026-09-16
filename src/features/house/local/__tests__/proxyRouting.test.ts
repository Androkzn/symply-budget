/**
 * The Proxy actually routes — asserted, because the default says otherwise.
 *
 * `isHouseLocalFirst()` is deliberately OPT-IN under Jest (see `flag.ts`): House
 * is the brand the Jest baseline runs, so without that opt-out every existing
 * remote-api suite would silently start testing the ledger. The cost of that
 * decision is that nothing exercises the Proxy's local branch by default — so
 * this file turns the flag on explicitly and proves the three behaviours the
 * whole H3 cutover depends on:
 *
 *  1. with the flag ON, an api call reaches the LEDGER, not the network
 *  2. with the flag OFF, the same call reaches the remote module untouched
 *  3. a method with no local counterpart THROWS rather than silently reaching a
 *     server that holds no rows for this household — the failure mode the plan
 *     calls out by name, because an empty screen looks correct
 */
import { HouseLocalUnsupportedError } from '../errors';
import { createHouseLocalProxy } from '../localApiProxy';
import { getHouseUnsupportedCopy } from '../unsupportedCopy';

const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST;
  else process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST = ORIGINAL_FLAG;
});

type FakeApi = {
  list: (householdId: string) => Promise<string>;
  serverOnly: (householdId: string) => Promise<string>;
  notPorted: (householdId: string) => Promise<string>;
  CONSTANT: string;
};

function fakeRemote(): FakeApi {
  return {
    list: async () => 'remote:list',
    serverOnly: async () => 'remote:serverOnly',
    notPorted: async () => 'remote:notPorted',
    CONSTANT: 'remote-constant',
  };
}

const fakeLocal = {
  list: async () => 'local:list',
};

function proxied(remote: FakeApi) {
  return createHouseLocalProxy<FakeApi>(remote, {
    moduleName: 'fake',
    resolveLocal: () => fakeLocal as Partial<Record<keyof FakeApi, unknown>>,
    remoteMethods: ['serverOnly'],
  });
}

describe('with House local-first ON', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST = '1';
  });

  it('routes a ported method to the ledger', async () => {
    await expect(proxied(fakeRemote()).list('hh_1')).resolves.toBe('local:list');
  });

  it('still routes a declared remote-by-design method to the server', async () => {
    // Tier B/C surfaces the ledger will never own. Declared, not accidental.
    await expect(proxied(fakeRemote()).serverOnly('hh_1')).resolves.toBe('remote:serverOnly');
  });

  it('THROWS for a method with no local counterpart', async () => {
    // The whole point. Falling through here would hit a server with no rows for
    // this household: the screen renders empty and correct, and nobody finds out.
    await expect(proxied(fakeRemote()).notPorted('hh_1')).rejects.toBeInstanceOf(
      HouseLocalUnsupportedError,
    );
  });

  it('names the module and method for the engineer, WITHOUT putting it in front of a member', async () => {
    // Both needs are real and they pull opposite ways. The engineer debugging an
    // unported method needs the identifier; the member hitting a P4 feature must
    // never read `fake.notPorted` (DoD H7: "no raw error strings"). Resolved by
    // splitting them: `.method` is the identifier, `.message` is product copy.
    const error = (await proxied(fakeRemote())
      .notPorted('hh_1')
      .catch((e: unknown) => e)) as HouseLocalUnsupportedError;

    expect(error.method).toBe('fake.notPorted');
    expect(error.message).not.toContain('fake.notPorted');
    expect(error.message).toBe(getHouseUnsupportedCopy('fake.notPorted').message);
  });

  it('passes non-function properties straight through', async () => {
    expect(proxied(fakeRemote()).CONSTANT).toBe('remote-constant');
  });

  it('throws at CALL time, not at property-access time', () => {
    // React reads methods off an api object while rendering. Throwing on access
    // would take down a screen that never called the method.
    const api = proxied(fakeRemote());
    expect(() => api.notPorted).not.toThrow();
    expect(typeof api.notPorted).toBe('function');
  });
});

describe('with House local-first OFF', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST = '0';
  });

  it('leaves every method on the remote module', async () => {
    const api = proxied(fakeRemote());
    await expect(api.list('hh_1')).resolves.toBe('remote:list');
    await expect(api.notPorted('hh_1')).resolves.toBe('remote:notPorted');
  });
});

describe('when the local module fails to load', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_HOUSE_LOCAL_FIRST = '1';
  });

  it('falls through to remote rather than taking the screen down', async () => {
    // A brand that does not ship the feature, or a partially-initialised test
    // environment. Correct behaviour is the server, not an exception.
    const api = createHouseLocalProxy<FakeApi>(fakeRemote(), {
      moduleName: 'fake',
      resolveLocal: () => {
        throw new Error('module not built for this brand');
      },
    });
    await expect(api.list('hh_1')).resolves.toBe('remote:list');
  });

  it('falls through when the local module resolves to nothing', async () => {
    const api = createHouseLocalProxy<FakeApi>(fakeRemote(), {
      moduleName: 'fake',
      resolveLocal: () => null,
      strict: false,
    });
    await expect(api.list('hh_1')).resolves.toBe('remote:list');
  });
});
