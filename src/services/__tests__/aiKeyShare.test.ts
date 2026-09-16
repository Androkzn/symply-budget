/**
 * Household AI key sharing — the device-side guarantees.
 *
 * Two things matter here and are easy to regress:
 *
 *  1. **The plaintext key never leaves the device.** What goes on the wire is an
 *     envelope sealed under the household key. Asserted by searching the actual
 *     request body for the key, not by trusting that `sealAiKeyShare` was called.
 *  2. **Revocation takes effect.** A borrowed key lives in memory only, and the
 *     moment the share stops resolving the module must stop serving it — the
 *     alternative (a cached key outliving the share) is exactly the failure the
 *     no-persistence design exists to prevent.
 *
 * The crypto is real (`@symply/local-first` is aliased to source); only the
 * network, the brand and the engine are stubbed.
 */

import { AxiosError } from 'axios';

import { apiClient } from '@api/client';
import { generateHouseholdKeys, sealAiKeyShare } from '@symply/local-first';


import {
  acceptSharedAiKey,
  aiKeyShareErrorMessage,
  borrowSharedAiKey,
  forgetBorrowedAiKeys,
  getBorrowedAiKey,
  listSharedAiKeys,
  shareAiKeyWithHousehold,
} from '../aiKeyShare';

const HOUSEHOLD = 'hh-1';
const OWNER = 'u-ann';
const API_KEY = 'sk-ant-api03-totally-not-real-000000000000000000000wxyz';

const keys = generateHouseholdKeys(HOUSEHOLD);

jest.mock('@brand', () => ({ brand: { id: 'symply-budget', displayName: 'Symply Budget' } }));

jest.mock('@api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u-bob' } }) },
}));

// NOT `{ virtual: true }` — the engine is a real module, and marking a real one
// virtual makes which mock wins depend on resolver-cache state, so the suite
// passes serially and flakes under parallelism.
jest.mock('@features/budget/local/engine', () => ({
  getLocalHouseholdKeys: () => mockEngineKeys,
  getLocalRetiredHouseholdKeys: () => mockRetired,
  listLocalBudgetHouseholds: () => mockHouseholds,
  getLocalBudgetSession: async (householdId: string) => {
    const found = mockHouseholds.find((h) => h.householdId === householdId);
    if (!found) throw new Error(`no session for ${householdId}`);
    // Falls through to the live module-level keys so the rotation cases can keep
    // reassigning `mockEngineKeys` after `beforeEach` has built the list.
    return {
      householdId,
      householdKeys: found.keys ?? mockEngineKeys,
      retiredHouseholdKeys: found.retired ?? mockRetired,
    };
  },
}));

jest.mock('@features/budget/local/controlPlaneClient', () => ({
  syncLocalHouseholdToControlPlane: jest.fn(async () => undefined),
}));

let mockEngineKeys = keys;
let mockRetired = new Map<number, Uint8Array>();

/** The households this device holds, active first — what the engine reports. */
type MockHousehold = {
  householdId: string;
  name: string;
  isActive: boolean;
  awaitingEnrolment: boolean;
  /** Omit to track the live `mockEngineKeys` — see `getLocalBudgetSession` above. */
  keys?: ReturnType<typeof generateHouseholdKeys>;
  retired?: Map<number, Uint8Array>;
};
let mockHouseholds: MockHousehold[] = [];

function soleHousehold(): MockHousehold[] {
  return [{ householdId: HOUSEHOLD, name: 'Sweet Home', isActive: true, awaitingEnrolment: false }];
}

/** A share row as the control plane would list it. */
function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    provider: 'anthropic',
    ownerUserId: OWNER,
    ownerName: 'Ann',
    keyHint: 'wxyz',
    keyEpoch: keys.keyEpoch,
    envelopeVersion: 'v1',
    createdAt: '2026-09-01T00:00:00.000Z',
    isMine: false,
    consented: true,
    ...overrides,
  };
}

/** The envelope Ann's device would have published. */
function sealedByAnn(epoch = keys.keyEpoch, hdk = keys.hdk): string {
  return sealAiKeyShare({
    hdk,
    ctx: { householdId: HOUSEHOLD, keyEpoch: epoch, provider: 'anthropic', ownerUserId: OWNER },
    apiKey: API_KEY,
  });
}

function stubList(rows: ReturnType<typeof shareRow>[]): void {
  jest.mocked(apiClient.get).mockResolvedValue({
    data: { shares: rows, keyEpoch: keys.keyEpoch },
  } as never);
}

function stubEnvelope(ciphertext: string, keyEpoch = keys.keyEpoch): void {
  jest.mocked(apiClient.post).mockResolvedValue({
    data: {
      envelope: {
        id: 'share-1',
        provider: 'anthropic',
        ownerUserId: OWNER,
        ciphertext,
        keyEpoch,
        envelopeVersion: 'v1',
      },
    },
  } as never);
}

describe('aiKeyShare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forgetBorrowedAiKeys();
    mockEngineKeys = keys;
    mockRetired = new Map();
    mockHouseholds = soleHousehold();
  });

  describe('publishing', () => {
    it('sends a sealed envelope, never the key', async () => {
      jest.mocked(apiClient.put).mockResolvedValue({
        data: { share: { id: 'share-1', keyHint: 'wxyz' } },
      } as never);

      await shareAiKeyWithHousehold({ provider: 'anthropic', apiKey: API_KEY });

      const [, body] = jest.mocked(apiClient.put).mock.calls[0]!;
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(API_KEY);
      expect(serialized).not.toContain('sk-ant');
      expect((body as { keyHint: string }).keyHint).toBe('wxyz');
      expect((body as { keyEpoch: number }).keyEpoch).toBe(keys.keyEpoch);
    });

    it('seals under the household key, so a member can open it', async () => {
      jest.mocked(apiClient.put).mockResolvedValue({
        data: { share: { id: 'share-1', keyHint: 'wxyz' } },
      } as never);
      // Bob is the sharer here (the auth mock), so the AAD owner is Bob.
      await shareAiKeyWithHousehold({ provider: 'anthropic', apiKey: API_KEY });
      const [, body] = jest.mocked(apiClient.put).mock.calls[0]!;

      stubEnvelope((body as { ciphertext: string }).ciphertext);
      jest.mocked(apiClient.post).mockResolvedValue({
        data: {
          envelope: {
            id: 'share-1',
            provider: 'anthropic',
            ownerUserId: 'u-bob',
            ciphertext: (body as { ciphertext: string }).ciphertext,
            keyEpoch: keys.keyEpoch,
            envelopeVersion: 'v1',
          },
        },
      } as never);

      const opened = await borrowSharedAiKey({ householdId: HOUSEHOLD, shareId: 'share-1' });
      expect(opened.apiKey).toBe(API_KEY);
    });
  });

  describe('borrowing', () => {
    it('unseals a share published by another member', async () => {
      stubList([shareRow()]);
      stubEnvelope(sealedByAnn());

      const borrowedKey = await getBorrowedAiKey('anthropic');
      expect(borrowedKey).toEqual({
        provider: 'anthropic',
        apiKey: API_KEY,
        ownerUserId: OWNER,
      });
    });

    it('serves the second call from memory instead of the network', async () => {
      stubList([shareRow()]);
      stubEnvelope(sealedByAnn());

      await getBorrowedAiKey('anthropic');
      await getBorrowedAiKey('anthropic');

      expect(apiClient.post).toHaveBeenCalledTimes(1);
    });

    it('ignores a share the member has not accepted', async () => {
      stubList([shareRow({ consented: false })]);
      expect(await getBorrowedAiKey('anthropic')).toBeNull();
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('ignores the member’s own share — that key is already theirs', async () => {
      stubList([shareRow({ isMine: true })]);
      expect(await getBorrowedAiKey('anthropic')).toBeNull();
    });

    it('opens a share sealed before a key rotation, from the retired ring', async () => {
      const oldHdk = keys.hdk;
      const rotated = generateHouseholdKeys(HOUSEHOLD, 2);
      mockEngineKeys = { ...rotated, householdId: HOUSEHOLD };
      mockRetired = new Map([[1, oldHdk]]);

      stubList([shareRow({ keyEpoch: 1 })]);
      stubEnvelope(sealedByAnn(1, oldHdk), 1);

      const borrowedKey = await getBorrowedAiKey('anthropic');
      expect(borrowedKey?.apiKey).toBe(API_KEY);
    });

    it('reports a share it cannot open rather than calling the provider with junk', async () => {
      const rotated = generateHouseholdKeys(HOUSEHOLD, 2);
      mockEngineKeys = { ...rotated, householdId: HOUSEHOLD };
      mockRetired = new Map(); // never received epoch 1

      stubEnvelope(sealedByAnn(1, keys.hdk), 1);
      await expect(
        borrowSharedAiKey({ householdId: HOUSEHOLD, shareId: 'share-1' }),
      ).rejects.toThrow(/older household key/i);
    });
  });

  describe('revocation', () => {
    it('stops serving the key once the share no longer resolves', async () => {
      stubList([shareRow()]);
      stubEnvelope(sealedByAnn());
      expect(await getBorrowedAiKey('anthropic')).not.toBeNull();

      // Ann stopped sharing: the list no longer carries it. The cached copy must
      // not outlive the share — that is the whole point of not persisting it.
      forgetBorrowedAiKeys();
      stubList([]);

      expect(await getBorrowedAiKey('anthropic')).toBeNull();
    });

    it('drops the cached key when the control plane refuses the envelope', async () => {
      stubList([shareRow()]);
      stubEnvelope(sealedByAnn());
      await getBorrowedAiKey('anthropic');

      forgetBorrowedAiKeys();
      jest.mocked(apiClient.post).mockRejectedValue(new Error('404 not found'));

      expect(await getBorrowedAiKey('anthropic')).toBeNull();
    });

    it('degrades to no shared key when the network is down, rather than throwing', async () => {
      jest.mocked(apiClient.get).mockRejectedValue(new Error('offline'));
      await expect(getBorrowedAiKey('anthropic')).resolves.toBeNull();
    });
  });

  /**
   * Regression, from production: a member of "Sweet Home" whose device had
   * minted its own household on first launch — the ordinary state for anyone
   * who opened Budget before joining — was enrolled in BOTH. The owner shared
   * three keys into Sweet Home and she got the push notification, because
   * notifications are addressed off the control plane's membership rows. Her
   * device then listed shares for its ACTIVE household, her own, and found
   * none. Three keys sat waiting behind a screen that showed nothing.
   *
   * So the module must read every household this device holds, and every write
   * must address the household the SHARE is in, never the active one.
   */
  describe('multi-household devices', () => {
    const PERSONAL = 'hh_local_personal';
    const personalKeys = generateHouseholdKeys(PERSONAL);

    /** Her device: personal household active, Sweet Home joined in the background. */
    function personalActiveSweetHomeJoined(): void {
      mockHouseholds = [
        {
          householdId: PERSONAL,
          name: 'Anastasia',
          isActive: true,
          awaitingEnrolment: false,
          keys: personalKeys,
          retired: new Map(),
        },
        {
          householdId: HOUSEHOLD,
          name: 'Sweet Home',
          isActive: false,
          awaitingEnrolment: false,
          keys,
          retired: new Map(),
        },
      ];
    }

    /** Empty for the personal household, the owner's three keys for Sweet Home. */
    function stubPerHousehold(): void {
      jest.mocked(apiClient.get).mockImplementation((async (url: string) => {
        const shares = url.includes(HOUSEHOLD) ? [shareRow({ consented: false })] : [];
        return { data: { shares, keyEpoch: keys.keyEpoch } };
      }) as never);
    }

    it('lists a key shared into a household that is NOT the active one', async () => {
      personalActiveSweetHomeJoined();
      stubPerHousehold();

      const { shares } = await listSharedAiKeys();
      expect(shares).toHaveLength(1);
      expect(shares[0]).toMatchObject({
        provider: 'anthropic',
        householdId: HOUSEHOLD,
        householdName: 'Sweet Home',
      });
    });

    it('unseals it with the SHARING household’s key, not the active one', async () => {
      personalActiveSweetHomeJoined();
      // Consented this time, so the borrow path runs end to end.
      jest.mocked(apiClient.get).mockImplementation((async (url: string) => {
        const shares = url.includes(HOUSEHOLD) ? [shareRow()] : [];
        return { data: { shares, keyEpoch: keys.keyEpoch } };
      }) as never);
      stubEnvelope(sealedByAnn());

      const borrowedKey = await getBorrowedAiKey('anthropic');
      expect(borrowedKey?.apiKey).toBe(API_KEY);

      // Addressed to Sweet Home. Under the active household's id the Worker
      // would 404 and, before that, the personal HDK would not have opened it.
      const [envelopeUrl] = jest.mocked(apiClient.post).mock.calls[0]!;
      expect(envelopeUrl).toContain(HOUSEHOLD);
      expect(envelopeUrl).not.toContain(PERSONAL);
    });

    it('records consent against the share’s household', async () => {
      personalActiveSweetHomeJoined();
      jest.mocked(apiClient.post).mockResolvedValue({ data: { ok: true } } as never);

      await acceptSharedAiKey({
        householdId: HOUSEHOLD,
        shareId: 'share-1',
        provider: 'anthropic',
        consentVersion: 'v1',
      });

      const [consentUrl] = jest.mocked(apiClient.post).mock.calls[0]!;
      expect(consentUrl).toBe(`/v2/households/${HOUSEHOLD}/ai-key-shares/share-1/consent`);
    });

    it('keeps one household’s failure from blanking the others', async () => {
      personalActiveSweetHomeJoined();
      // The personal household has never registered with the control plane, so
      // its list 404s. That must not hide Sweet Home's keys — the single-request
      // version lost the whole section to exactly this.
      jest.mocked(apiClient.get).mockImplementation((async (url: string) => {
        if (url.includes(PERSONAL)) throw new Error('404 not found');
        return { data: { shares: [shareRow()], keyEpoch: keys.keyEpoch } };
      }) as never);

      const { shares } = await listSharedAiKeys();
      expect(shares.map((s) => s.householdId)).toEqual([HOUSEHOLD]);
    });

    it('skips a household whose key has not arrived yet', async () => {
      personalActiveSweetHomeJoined();
      // Claimed the invite, still waiting on the owner to wrap the HDK: the
      // session holds a placeholder, so anything sealed with it is junk.
      mockHouseholds[1]!.awaitingEnrolment = true;
      stubPerHousehold();

      const { shares } = await listSharedAiKeys();
      expect(shares).toEqual([]);
    });
  });

  /**
   * Regression: a member sharing their Gemini key in production was shown
   * "Request failed with status code 500" — axios's own string, which names
   * neither what broke nor whether retrying helps. (The 500 was the control
   * plane missing `lf_ai_key_shares`.) The toast must never be that again,
   * while the deliberately-worded local preconditions must still survive.
   */
  describe('error copy', () => {
    function axiosFailure(status: number, body?: unknown) {
      return new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_RESPONSE',
        undefined,
        undefined,
        { status, data: body, statusText: '', headers: {}, config: {} } as never,
      );
    }

    it('never shows axios\'s own "status code" string', () => {
      const message = aiKeyShareErrorMessage(axiosFailure(500), 'Could not share that key.');
      expect(message).toBe('Could not share that key.');
      expect(message).not.toMatch(/status code/i);
    });

    it("prefers the Worker's message when the failure is one a member can act on", () => {
      const message = aiKeyShareErrorMessage(
        axiosFailure(400, {
          error: {
            code: 'validation_error',
            message: 'Sealed under a stale key epoch; re-share from an up-to-date device',
          },
        }),
        'Could not share that key.',
      );
      expect(message).toMatch(/stale key epoch/);
    });

    it('keeps a technical Worker message out of the toast', () => {
      const message = aiKeyShareErrorMessage(
        axiosFailure(400, {
          error: { code: 'validation_error', message: 'D1_ERROR: no such table: lf_ai_key_shares' },
        }),
        'Could not share that key.',
      );
      expect(message).toBe('Could not share that key.');
    });

    it('surfaces this module\'s own preconditions verbatim', async () => {
      mockEngineKeys = { ...keys, hdk: new Uint8Array() };
      const error = await shareAiKeyWithHousehold({
        provider: 'anthropic',
        apiKey: API_KEY,
      }).catch((e: unknown) => e);

      expect(aiKeyShareErrorMessage(error, 'Could not share that key.')).toBe(
        'Key sharing needs a household on this device.',
      );
    });
  });
});
