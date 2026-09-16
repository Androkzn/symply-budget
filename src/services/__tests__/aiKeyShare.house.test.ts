/**
 * Household AI key sharing, on House.
 *
 * The mechanism, the envelope, the `/v2` routes and the whole UI are shared with
 * Budget and are covered by `aiKeyShare.test.ts`. What is brand-specific — and
 * what this file pins — is the seam that decides whether the feature exists at
 * all on a device: `householdCryptos()` must resolve HOUSE's engine, House's
 * properties, House's per-property keys and House's routing header.
 *
 * Getting any of that wrong fails silently in the worst way: the sharing section
 * and the picker's "Shared with you" block both hide themselves when there is no
 * household, so a broken adapter looks exactly like "nobody has shared anything"
 * rather than like a bug.
 *
 * The crypto is real (`@symply/local-first` is aliased to source); only the
 * network, the brand and the engine are stubbed.
 */

import { apiClient } from '@api/client';
import { generateHouseholdKeys } from '@symply/local-first';

import {
  canShareAiKeys,
  householdCryptos,
  listSharedAiKeys,
  shareAiKeyWithHousehold,
} from '../aiKeyShare';

const HOUSEHOLD = 'hh-house-1';
const SECOND = 'hh-house-2';
const API_KEY = 'sk-ant-api03-totally-not-real-000000000000000000000wxyz';

const keys = generateHouseholdKeys(HOUSEHOLD);
const secondKeys = generateHouseholdKeys(SECOND);

jest.mock('@brand', () => ({ brand: { id: 'symply-house', displayName: 'Symply House' } }));

jest.mock('@api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u-bob' } }) },
}));

type MockProperty = {
  householdId: string;
  name: string;
  isActive: boolean;
  awaitingEnrolment: boolean;
  keys?: ReturnType<typeof generateHouseholdKeys>;
};
let mockProperties: MockProperty[] = [];

// NOT `{ virtual: true }` — the engine is a real module, and marking a real one
// virtual makes which mock wins depend on resolver-cache state, so the suite
// passes serially and flakes under parallelism.
jest.mock('@features/house/local/engine', () => ({
  listLocalHouseProperties: () => mockProperties,
  // The hydration-free accessor the adapter uses on purpose: the session handle
  // would decrypt each property's whole ledger just to read its HDK.
  getLocalHouseHouseholdKeys: (householdId: string) => {
    const found = mockProperties.find((p) => p.householdId === householdId);
    if (!found || found.awaitingEnrolment) return null;
    return {
      householdKeys: found.keys ?? mockEngineKeys,
      retiredHouseholdKeys: new Map<number, Uint8Array>(),
    };
  },
  // Present so a stray call is a visible failure rather than a silent hydrate.
  getLocalHouseSession: jest.fn(async () => {
    throw new Error('getLocalHouseSession must not be needed to read household keys');
  }),
}));

const mockSync = jest.fn(async () => undefined);
jest.mock('@features/house/local/controlPlaneClient', () => ({
  syncLocalHouseholdToControlPlane: (...args: unknown[]) => mockSync(...(args as [])),
}));

let mockEngineKeys = keys;

function soleProperty(): MockProperty[] {
  return [{ householdId: HOUSEHOLD, name: 'Maple Street', isActive: true, awaitingEnrolment: false }];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngineKeys = keys;
  mockProperties = soleProperty();
});

describe('householdCryptos on House', () => {
  it('resolves House properties, not just Budget households', async () => {
    const [property, ...rest] = await householdCryptos();
    expect(rest).toHaveLength(0);
    expect(property).toEqual(
      expect.objectContaining({
        householdId: HOUSEHOLD,
        displayName: 'Maple Street',
        isActive: true,
        keyEpoch: keys.keyEpoch,
      }),
    );
    expect(property.hdk).toEqual(keys.hdk);
    expect(await canShareAiKeys()).toBe(true);
  });

  it('routes on the House header — the Budget one would 404 on this Worker', async () => {
    const [property] = await householdCryptos();
    expect(property.headers).toEqual({ 'X-House-Local-First': '1' });
  });

  it('names an unnamed property something a member can read', async () => {
    mockProperties = [{ ...soleProperty()[0], name: '' }];
    const [property] = await householdCryptos();
    expect(property.displayName).toBe('Your home');
  });

  it('skips a property still awaiting enrolment', async () => {
    // Claimed an invite but the owner has not wrapped the key to us yet: the
    // session holds a placeholder HDK, so anything sealed with it is junk.
    mockProperties = [{ ...soleProperty()[0], awaitingEnrolment: true }];
    expect(await householdCryptos()).toEqual([]);
    expect(await canShareAiKeys()).toBe(false);
  });

  it('returns every property this device holds, active first', async () => {
    mockProperties = [
      { householdId: SECOND, name: 'The Cabin', isActive: false, awaitingEnrolment: false, keys: secondKeys },
      { householdId: HOUSEHOLD, name: 'Maple Street', isActive: true, awaitingEnrolment: false, keys },
    ];
    const resolved = await householdCryptos();
    // Active first is what makes a later `find` prefer the property the member
    // is actually looking at when two of them lend the same provider.
    expect(resolved.map((p) => p.householdId)).toEqual([HOUSEHOLD, SECOND]);
    expect(resolved[1].hdk).toEqual(secondKeys.hdk);
  });

  it('claims the control-plane row through House’s own sync', async () => {
    const [property] = await householdCryptos();
    await property.ensureRegistered();
    // A property that has never invited anyone is local-only — no `lf_households`
    // row — and every `/v2` call 404s until this runs.
    expect(mockSync).toHaveBeenCalledWith(HOUSEHOLD);
  });
});

describe('sharing from a House device', () => {
  it('seals under the property HDK and PUTs with the House header', async () => {
    jest
      .mocked(apiClient.put)
      .mockResolvedValue({ data: { share: { id: 's1', keyHint: 'wxyz' } } } as never);

    await shareAiKeyWithHousehold({ provider: 'anthropic', apiKey: API_KEY, householdId: HOUSEHOLD });

    const [url, body, config] = jest.mocked(apiClient.put).mock.calls[0]!;
    expect(url).toBe(`/v2/households/${HOUSEHOLD}/ai-key-shares/anthropic`);
    expect(config).toEqual({ headers: { 'X-House-Local-First': '1' } });
    // The plaintext key never leaves the device — asserted on the real request
    // body rather than by trusting that the sealer was called.
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect((body as { keyEpoch: number }).keyEpoch).toBe(keys.keyEpoch);
  });

  it('lists shares per property, so one property’s 404 is not the whole list', async () => {
    mockProperties = [
      { householdId: HOUSEHOLD, name: 'Maple Street', isActive: true, awaitingEnrolment: false, keys },
      { householdId: SECOND, name: 'The Cabin', isActive: false, awaitingEnrolment: false, keys: secondKeys },
    ];
    jest.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.includes(SECOND)) throw new Error('404 — never registered');
      return {
        data: {
          shares: [
            {
              id: 'share-1',
              provider: 'anthropic',
              ownerUserId: 'u-ann',
              ownerName: 'Ann',
              keyHint: 'wxyz',
              keyEpoch: keys.keyEpoch,
              envelopeVersion: 'v1',
              createdAt: '2026-09-01T00:00:00.000Z',
              isMine: false,
              consented: false,
            },
          ],
          keyEpoch: keys.keyEpoch,
        },
      };
    });

    const { shares } = await listSharedAiKeys();
    expect(shares).toHaveLength(1);
    expect(shares[0]).toEqual(
      expect.objectContaining({ householdId: HOUSEHOLD, householdName: 'Maple Street' }),
    );
  });
});
