/**
 * HouseInviteCreateScreen — the owner half of enrolment.
 *
 * Renders the REAL screen against a mocked `apiClient` and a mocked engine, so
 * `controlPlaneClient` itself is the real thing: the URLs, the invite link
 * scheme and the error handling are exercised rather than stubbed. What is
 * asserted here is the part that has bitten before:
 *
 *  - the `[E2E-INVITE]` marker, in the exact shape the two-device suite scrapes,
 *    with `household=` LAST because property names contain spaces;
 *  - the home earning its control-plane row BEFORE the invite is minted — an
 *    invite POSTed against a home the server has never heard of is a 403, and
 *    the member is told to check their connection about a state no amount of
 *    network will change;
 *  - approval echoing back the KEYS the owner verified, not whatever the
 *    approve response carries — a screen that used the response would let the
 *    control plane show honest keys during the comparison and substitute its own
 *    straight after;
 *  - outstanding invites being listed and cancellable, because a code minted on
 *    a previous run of the app is otherwise live until it expires with nothing
 *    in the UI able to reach it.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    __esModule: true,
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
    // The screen re-reads its lists on focus; in tests that is "on mount".
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ title }: { title?: string }) =>
      React.createElement(Text, { testID: 'screen-header' }, title ?? ''),
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => true,
  isHouseP2PEnabled: () => false,
}));

jest.mock('@features/house/local/engine', () => {
  const state = {
    sessionOpen: true,
    awaiting: false,
    ledger: {
      deviceId: 'dev-self',
      memberId: 'mem-1',
      household: { id: 'hh-1', name: 'Maple Street House', my_role: 'owner' },
    },
  };
  const identity = {
    signingPublicKey: new Uint8Array([1, 2, 3]),
    agreementPublicKey: new Uint8Array([4, 5, 6]),
  };
  return {
    __esModule: true,
    __state: state,
    getLocalHouseLedger: () => state.ledger,
    isLocalHouseSessionOpen: () => state.sessionOpen,
    isAwaitingHouseEnrolment: () => state.awaiting,
    getActiveHouseholdId: () => (state.sessionOpen ? state.ledger.household.id : null),
    // Every control-plane call resolves the property it is about through this.
    listLocalHouseProperties: () =>
      state.sessionOpen
        ? [
            {
              householdId: state.ledger.household.id,
              deviceId: state.ledger.deviceId,
              name: state.ledger.household.name,
              role: 'owner',
              isActive: true,
              hydrated: true,
              awaitingEnrolment: state.awaiting,
            },
          ]
        : [],
    getLocalHouseSession: async () => ({
      householdId: state.ledger.household.id,
      ledger: state.ledger,
      identity,
      householdKeys: { householdId: state.ledger.household.id, hdk: new Uint8Array(32), keyEpoch: 1 },
      retiredHouseholdKeys: new Map(),
      awaitingEnrolment: state.awaiting,
    }),
    getLocalHouseStore: () => ({ getMeta: async () => null, setMeta: async () => undefined }),
    subscribeToHouseLedgerChanges: () => () => {},
    getLocalHouseIdentity: () => identity,
    getLocalHouseholdKeys: () => ({ householdId: 'hh-1', hdk: new Uint8Array(32), keyEpoch: 1 }),
    installHouseholdKeys: jest.fn(async () => {}),
    adoptJoinedHousehold: jest.fn(async () => ({ household: { id: 'hh-1', name: 'Joined' } })),
  };
});

jest.mock('@features/house/local/deviceName', () => ({
  __esModule: true,
  getLocalDeviceName: async () => 'Test device',
  setLocalDeviceName: async (name: string) => name,
  DEVICE_NAME_MAX_LENGTH: 40,
  normalizeDeviceName: (raw?: string | null) => (raw ?? '').trim(),
}));

// Pulled in by `controlPlaneClient` for the join path only; the real module
// starts the whole local-first session machinery at import time.
jest.mock('@features/house/local/ensureSession', () => ({
  __esModule: true,
  syncHouseholdStoreFromLocalLedger: jest.fn(),
}));

// The socket the hooks keep open while an enrolment screen is on top. Its own
// suite covers it; here it would open a WebSocket against nothing.
jest.mock('@features/house/local/enrolmentLive', () => ({
  __esModule: true,
  useHouseEnrolmentLive: () => {},
}));

jest.mock('@stores/notificationStore', () => {
  const state = { refreshUnreadCount: jest.fn() };
  const useNotificationStore = (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state);
  useNotificationStore.getState = () => state;
  return { __esModule: true, useNotificationStore };
});

jest.mock('@api/client', () => ({
  __esModule: true,
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('@features/house/local/sync/hdkTransfer', () => ({
  __esModule: true,
  depositHdkForDevice: jest.fn(async () => {}),
}));

jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: jest.fn(async () => true),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { deriveEnrolmentSas, formatEnrolmentSas } from '@symply/local-first';

import { __resetHouseControlPlaneRegistrationForTests } from '../../../../features/house/local/controlPlaneClient';
import HouseInviteCreateScreen from '../HouseInviteCreateScreen';

import { flush, hasTestId, press, textOf } from './enrolmentTestKit';

const { apiClient } = require('@api/client') as {
  apiClient: { get: jest.Mock; post: jest.Mock; delete: jest.Mock };
};
const { __state: engine } = require('@features/house/local/engine') as {
  __state: { sessionOpen: boolean; awaiting: boolean };
};

const CREATED_INVITE = {
  inviteId: 'inv_1',
  shortCode: 'AB12CD',
  secret: 'sekret-value-0123456789',
  role: 'ADULT',
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  inviteeEmail: null,
  universalLink: 'https://example.invalid/ignored',
  qrPayload: 'symply-house://lf-invite?id=inv_1&secret=sekret-value-0123456789&code=AB12CD',
};

/** The claiming device's real keys, as the pending endpoint reports them. */
const PEER_SIGNING_KEY = 'aa'.repeat(32);
const PEER_AGREEMENT_KEY = 'bb'.repeat(32);

const PENDING_REQUEST = {
  inviteId: 'inv_1',
  shortCode: 'AB12CD',
  role: 'ADULT',
  expiresAt: CREATED_INVITE.expiresAt,
  claimedByUserId: 'u2',
  claimedByEmail: 'partner@example.com',
  claimedByDisplayName: 'Partner',
  claimedDeviceId: 'dev-peer',
  claimedDeviceLabel: "Partner's iPhone",
  claimedSigningPublicKey: PEER_SIGNING_KEY,
  claimedAgreementPublicKey: PEER_AGREEMENT_KEY,
};

/** What the two GETs on this screen answer, routed by URL. */
const served = {
  pending: [] as unknown[],
  outstanding: [] as unknown[],
  pendingError: null as unknown,
};

function serveGet(url: string) {
  if (url.endsWith('/invites/pending')) {
    if (served.pendingError) return Promise.reject(served.pendingError);
    return Promise.resolve({ data: { pending: served.pending } });
  }
  if (url.endsWith('/invites/outstanding')) {
    return Promise.resolve({ data: { invites: served.outstanding } });
  }
  return Promise.resolve({ data: {} });
}

/**
 * The digits the screen must show — derived by the same function the screen
 * uses, from the same inputs, so the assertion pins the WIRING (right keys,
 * right secret) rather than restating a hash the derivation test already owns.
 */
function expectedSas() {
  return deriveEnrolmentSas({
    inviteId: CREATED_INVITE.inviteId,
    inviteSecret: CREATED_INVITE.secret,
    signingPublicKeyHex: PEER_SIGNING_KEY,
    agreementPublicKeyHex: PEER_AGREEMENT_KEY,
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseInviteCreateScreen />
      </ThemeProvider>,
    );
    await flush();
  });
  return tree;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  __resetHouseControlPlaneRegistrationForTests();
  engine.sessionOpen = true;
  engine.awaiting = false;
  served.pending = [];
  served.outstanding = [];
  served.pendingError = null;
  apiClient.get.mockImplementation((url: string) => serveGet(url));
  apiClient.post.mockResolvedValue({ data: { invite: CREATED_INVITE } });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('gating', () => {
  it('shows member-facing copy instead of a dead button while the session is opening', async () => {
    engine.sessionOpen = false;
    const tree = await renderScreen();

    expect(hasTestId(tree, 'lf-invite-create')).toBe(false);
    expect(textOf(tree, 'lf-invite-gate-notice')).toContain('Still getting your home ready');
    // Nothing is asked of the control plane before there is a home to ask about.
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

describe('creating an invite', () => {
  it('emits the E2E marker with household LAST, and shows the code and link', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const tree = await renderScreen();

    await press(tree, 'lf-invite-create');

    // No `ttlHours`: the server's own default (an hour) is deliberately not
    // overridden by the client, so a shortened window applies everywhere at once.
    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites',
      { role: 'ADULT' },
      expect.objectContaining({ headers: { 'X-House-Local-First': '1' } }),
    );

    // The suite's scrape depends on this shape exactly: `household=` must be the
    // final field, because a property name contains spaces and would otherwise
    // swallow whatever came after it.
    const marker = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('[E2E-INVITE]'));
    expect(marker).toBe(
      '[E2E-INVITE] code=AB12CD secret=sekret-value-0123456789 household=Maple Street House',
    );

    expect(textOf(tree, 'lf-invite-created-title')).toBe('Invite created');
    expect(textOf(tree, 'lf-invite-code')).toBe('AB12CD');
    // The link is built by the real `buildHouseInviteLink`, so this also pins
    // the brand scheme. Deliberately NOT the server's `qrPayload`, which carries
    // `symply-house://` — a code id, not a scheme, that opens nothing.
    expect(textOf(tree, 'lf-invite-link')).toContain('simplehouse://lf-invite?');
    expect(textOf(tree, 'lf-invite-link')).toContain('code=AB12CD');
    expect(textOf(tree, 'lf-invite-link')).not.toContain('symply-house://');
    expect(textOf(tree, 'lf-invite-expiry')).toContain('Expires in about an hour');

    log.mockRestore();
  });

  it('registers the home before minting, so the invite is not POSTed at a home the server has never heard of', async () => {
    const tree = await renderScreen();
    await press(tree, 'lf-invite-create');

    const urls = apiClient.post.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe('/v2/households');
    expect(urls[1]).toBe('/v2/households/hh-1/invites');
  });

  it('sends the role the owner picked', async () => {
    const tree = await renderScreen();
    await press(tree, 'lf-invite-role-owner');
    await press(tree, 'lf-invite-create');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites',
      { role: 'OWNER' },
      expect.anything(),
    );
  });

  it('binds the invite to an address when the owner typed one', async () => {
    const tree = await renderScreen();
    const { typeIn } = require('./enrolmentTestKit') as {
      typeIn: (t: unknown, id: string, v: string) => Promise<void>;
    };
    await typeIn(tree, 'house-invite-invitee-email', ' them@example.com ');
    await press(tree, 'lf-invite-create');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites',
      { role: 'ADULT', inviteeEmail: 'them@example.com' },
      expect.anything(),
    );
    // …and the hint says which of the two invites they are getting.
    expect(textOf(tree, 'house-invite-binding-hint')).toContain('Only this account');
  });

  it('says the invite could not be created, and shows no code, when minting fails', async () => {
    apiClient.post.mockRejectedValue(new Error('Network Error'));
    const tree = await renderScreen();

    await press(tree, 'lf-invite-create');

    // Still a connectivity sentence — this failure genuinely IS the network —
    // but `getApiErrorMessage` now words it, so the screen no longer has to
    // guess. The assertion follows the helper rather than pinning copy the
    // screen stopped owning.
    expect(alertSpy).toHaveBeenCalledWith(
      'Could not create an invite',
      expect.stringContaining('Unable to connect'),
    );
    // A raw transport string must never reach the member.
    expect(hasTestId(tree, 'lf-invite-created-panel')).toBe(false);
  });

  /**
   * The lie this screen used to tell, and the reason the offline sentence is a
   * FALLBACK now rather than the whole answer.
   *
   * Every failure to mint used to render "this needs a connection". A 403 is
   * not a connection problem and no amount of signal fixes it: the coordinator
   * refuses an invite from anyone who is not an OWNER
   * (`handleCreateInvite`), and it says so. On 2026-09-04 an owner's partner
   * spent an evening retrying "Could not create invite. Check you are online."
   * on a phone that was demonstrably online and getting 200s on every other
   * request — the server had been answering `Owner required` the whole time.
   *
   * `forbidden` is in `USER_FACING_CODES`, so the reason survives to the alert.
   */
  it('shows the reason the server gave, instead of blaming the connection', async () => {
    const { AxiosError } = require('axios') as typeof import('axios');
    const refusal = new AxiosError('Request failed with status code 403');
    refusal.response = {
      status: 403,
      data: { error: { code: 'forbidden', message: 'Owner required' } },
    } as never;
    apiClient.post.mockRejectedValue(refusal);
    const tree = await renderScreen();

    await press(tree, 'lf-invite-create');

    expect(alertSpy).toHaveBeenCalledWith('Could not create an invite', 'Owner required');
    // The old copy must not survive anywhere in the alert: it sends the member
    // to their router for a permission problem.
    expect(alertSpy).not.toHaveBeenCalledWith(
      'Could not create an invite',
      expect.stringContaining('needs a connection'),
    );
    expect(hasTestId(tree, 'lf-invite-created-panel')).toBe(false);
  });
});

describe('approving a claimed device', () => {
  /**
   * Create first, then load the queue: creating is what puts the invite secret
   * on this device, and the secret is an ingredient of the digits. A test that
   * skipped it would exercise the "cannot verify" branch by accident.
   */
  async function renderWithPendingRequest() {
    const tree = await renderScreen();
    await press(tree, 'lf-invite-create');
    served.pending = [PENDING_REQUEST];
    await press(tree, 'lf-invite-requests-refresh');
    return tree;
  }

  it('names the person and device, shows the digits, and approves with the verified keys', async () => {
    const tree = await renderWithPendingRequest();

    expect(hasTestId(tree, 'lf-invite-requests-panel')).toBe(true);
    // Who, not just which code — the owner has to have something to refuse on.
    expect(textOf(tree, 'house-join-request-banner-inv_1')).toContain('Partner');
    expect(textOf(tree, 'house-join-request-banner-inv_1')).toContain("Partner's iPhone");
    expect(textOf(tree, 'house-request-sas-inv_1')).toBe(formatEnrolmentSas(expectedSas()));

    apiClient.post.mockResolvedValue({
      data: { approved: { userId: 'u2', deviceId: 'dev-peer', agreementPublicKey: 'ff00' } },
    });
    await press(tree, 'lf-invite-approve-request');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites/inv_1/approve',
      {
        confirmedSigningPublicKey: PEER_SIGNING_KEY,
        confirmedAgreementPublicKey: PEER_AGREEMENT_KEY,
      },
      expect.anything(),
    );

    // The other half of the property — that the home key is wrapped to the
    // VERIFIED key rather than to the `ff00` the response carries — cannot be
    // observed here: the deposit is reached through a dynamic import (to break a
    // module cycle) and is swallowed by its own try/catch under Jest.

    expect(alertSpy).toHaveBeenCalledWith('Device approved', expect.stringContaining('enrolled'));
    // Approved requests leave the queue rather than inviting a second tap.
    expect(hasTestId(tree, 'lf-invite-requests-panel')).toBe(false);
  });

  it('refuses to offer approval when this device cannot derive the digits', async () => {
    // No create on this device, so no invite secret — nothing to check against.
    served.pending = [{ ...PENDING_REQUEST, inviteId: 'inv_unknown' }];
    const tree = await renderScreen();

    expect(hasTestId(tree, 'house-request-sas-missing-inv_unknown')).toBe(true);
    // The approve control is absent, not merely disabled: an unverifiable
    // enrolment must not be one tap away from being admitted.
    expect(hasTestId(tree, 'lf-invite-approve-request')).toBe(false);
  });

  it('keeps the request in the queue when the claim changed under the owner', async () => {
    const tree = await renderWithPendingRequest();
    apiClient.post.mockRejectedValueOnce(new Error('claim_changed'));

    await press(tree, 'lf-invite-approve-request');

    expect(alertSpy).toHaveBeenCalledWith('Not approved', expect.stringContaining('afresh'));
    // Retryable: load the list again and compare afresh, not a dead end.
    expect(hasTestId(tree, 'lf-invite-requests-panel')).toBe(true);
  });

  it('says plainly that nobody is waiting when the owner asks', async () => {
    const tree = await renderScreen();
    await press(tree, 'lf-invite-requests-refresh');

    expect(alertSpy).toHaveBeenCalledWith(
      'Join requests',
      expect.stringContaining('No one is waiting'),
    );
  });

  it('surfaces member-facing copy when the queue cannot be read', async () => {
    served.pendingError = new Error('Network Error');
    const tree = await renderScreen();
    await press(tree, 'lf-invite-requests-refresh');

    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('online'));
    // Never the transport's own words.
    expect(alertSpy.mock.calls.flat().join(' ')).not.toContain('Network Error');
  });
});

describe('invites already sent', () => {
  const OUTSTANDING = {
    inviteId: 'inv_old',
    shortCode: 'ZZ99YY',
    status: 'active' as const,
    role: 'ADULT',
    expiresAt: new Date(Date.now() + 7200 * 1000).toISOString(),
    inviteeEmail: null,
    createdByUserId: 'u1',
    createdAt: new Date().toISOString(),
    claimedByUserId: null,
    claimedByEmail: null,
    claimedByDisplayName: null,
  };

  it('lists codes minted on a previous run, which the screen could otherwise never reach', async () => {
    served.outstanding = [OUTSTANDING];
    const tree = await renderScreen();

    expect(textOf(tree, 'house-invite-outstanding-code-ZZ99YY')).toBe('ZZ99YY');
  });

  it('cancels one, and says the code no longer works', async () => {
    served.outstanding = [OUTSTANDING];
    const tree = await renderScreen();

    apiClient.post.mockResolvedValueOnce({ data: {} });
    await press(tree, 'house-invite-revoke-ZZ99YY');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites/inv_old/revoke',
      {},
      expect.anything(),
    );
    expect(textOf(tree, 'house-invite-revoke-note')).toContain('no longer works');
  });

  it('names an already-approved invite as a device to remove, not as a network failure', async () => {
    served.outstanding = [OUTSTANDING];
    const tree = await renderScreen();

    // 409 — the invite was approved between the list being read and the tap.
    // `isAxiosError` is what `axios.isAxiosError` keys on, and the client reads
    // the status only through it: a bare `{ response }` object is treated as an
    // unknown failure and rethrown, which is the correct behaviour for one.
    apiClient.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    await press(tree, 'house-invite-revoke-ZZ99YY');

    const note = textOf(tree, 'house-invite-revoke-note');
    expect(note).toContain('already approved');
    // The one place it CAN be undone, rather than "check you are online".
    expect(note).toContain('Devices');
    expect(note).not.toContain('online');
  });
});
