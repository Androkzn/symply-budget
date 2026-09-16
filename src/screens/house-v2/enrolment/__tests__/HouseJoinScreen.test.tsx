/**
 * HouseJoinScreen — the invitee half of enrolment.
 *
 * Same setup as the invite suite: real `controlPlaneClient`, mocked transport,
 * so `parseInviteInput` is genuinely the thing pulling a code and secret out of
 * whatever was pasted.
 *
 * The behaviours worth a regression test:
 *  - a claim is never fired before the invite has been LOOKED UP, so a
 *    cancelled, spent or timed-out invite is refused with copy rather than with
 *    a failed claim;
 *  - the confirm is an in-app modal (an iOS `Alert` is invisible to the app
 *    window an automated check snapshots) and it NAMES the home being joined —
 *    naming is its entire job;
 *  - it promises that nothing on this device is removed, because since joining
 *    became additive that is true, and the old destructive warning would make a
 *    member decline a join that costs them nothing;
 *  - after claiming, the screen says approval is still owed rather than implying
 *    the member is in.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
// `unknown`, not `string`: the params carry a code and a secret, and now also
// the `fromOnboarding` flag that tells the screen it is the way IN rather than
// an addition to a device that already has a home.
const mockRouteParams: { current: Record<string, unknown> | undefined } = { current: undefined };

jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    __esModule: true,
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
    // A tapped invite link arrives as route params, handed over by the hub.
    useRoute: () => ({ params: mockRouteParams.current }),
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
      household: { id: 'hh-own', name: 'My Own Place', my_role: 'owner' },
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
    // Read off the DEVICE by the claim, because an invitee may hold no home at
    // all — a new account is given none. A no-op here for the same reason: this
    // screen's device already has one.
    getLocalHouseDeviceId: () => state.ledger.deviceId,
    openHouseDeviceForEnrolment: jest.fn(async () => {}),
    getLocalHouseholdKeys: () => ({ householdId: 'hh-own', hdk: new Uint8Array(32), keyEpoch: 1 }),
    installHouseholdKeys: jest.fn(async () => {}),
    adoptJoinedHousehold: jest.fn(async () => ({
      household: { id: 'hh-shared', name: 'Maple Street House' },
    })),
  };
});

jest.mock('@features/house/local/deviceName', () => ({
  __esModule: true,
  getLocalDeviceName: async () => 'Test device',
  setLocalDeviceName: async (name: string) => name,
}));

jest.mock('@features/house/local/ensureSession', () => ({
  __esModule: true,
  syncHouseholdStoreFromLocalLedger: jest.fn(),
}));

/**
 * The wait is its own machine — a socket, a poll and a persisted claim record —
 * and this suite is about the FORM. Mocked so a test can put the screen on
 * either side of the hand-off without driving three async sources.
 */
const mockWaitState = {
  awaiting: false,
  sas: null as string | null,
  outcome: null as string | null,
  dismiss: jest.fn(),
  refresh: jest.fn(async () => {}),
};
jest.mock('@features/house/local/useHouseJoinWait', () => ({
  __esModule: true,
  useHouseJoinWait: () => mockWaitState,
}));

// The camera modal. It renders nothing until opened, but `expo-camera` pulls a
// native module that has no place in a form test.
jest.mock('@features/house/components/HouseInviteQrScanner', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    HouseInviteQrScanner: ({ visible }: { visible: boolean }) =>
      visible ? React.createElement(View, { testID: 'house-invite-scanner' }) : null,
  };
});

jest.mock('@stores/householdStore', () => {
  const state: Record<string, unknown> = { households: [], currentHousehold: null };
  const useHouseholdStore = (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state);
  useHouseholdStore.getState = () => state;
  useHouseholdStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  return { __esModule: true, useHouseholdStore };
});

jest.mock('@api/client', () => ({
  __esModule: true,
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// `completeOnboarding` for the onboarding entry, and the signed-in user for the
// claim — `joinLocalFirstHousehold` reads it to give a device with no home of
// its own the keypair a claim has to present.
// Exposed off the mock rather than closed over, because the factory is hoisted
// above every `const` in this file and runs while the screen is being imported.
jest.mock('@stores/authStore', () => {
  const completeOnboarding = jest.fn();
  const state = { completeOnboarding, user: { id: 'mem-1' } };
  const useAuthStore = (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state);
  useAuthStore.getState = () => state;
  return { __esModule: true, useAuthStore, __completeOnboarding: completeOnboarding };
});

jest.mock('@features/house/local/sync/orchestrator', () => ({
  __esModule: true,
  runHouseLocalSync: jest.fn(async () => {}),
  runHouseLocalSyncFor: jest.fn(async () => {}),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import HouseJoinScreen from '../HouseJoinScreen';

import { buttonTitle, flush, hasTestId, isDisabled, press, textOf, typeIn } from './enrolmentTestKit';

const { apiClient } = require('@api/client') as {
  apiClient: { get: jest.Mock; post: jest.Mock };
};
const { __state: engine } = require('@features/house/local/engine') as {
  __state: { sessionOpen: boolean; awaiting: boolean };
};
const { runHouseLocalSync } = require('@features/house/local/sync/orchestrator') as {
  runHouseLocalSync: jest.Mock;
};

const LINK = 'simplehouse://lf-invite?id=inv_1&secret=sekret-value-0123456789&code=ab12cd';

function lookupResponse(
  overrides?: Partial<{ status: string; expiresAt: string; householdName: string | null }>,
) {
  return {
    data: {
      invite: {
        inviteId: 'inv_1',
        householdId: 'hh-shared',
        householdName: 'Maple Street House',
        status: 'active',
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        ...overrides,
      },
    },
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseJoinScreen />
      </ThemeProvider>,
    );
    await flush();
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  engine.sessionOpen = true;
  engine.awaiting = false;
  mockRouteParams.current = undefined;
  mockWaitState.awaiting = false;
  mockWaitState.sas = null;
  mockWaitState.outcome = null;
  apiClient.get.mockResolvedValue(lookupResponse());
  apiClient.post.mockResolvedValue({ data: { invite: { inviteId: 'inv_1' } } });
});

describe('gating', () => {
  it('works on a device that holds no home of its own', async () => {
    // This screen used to refuse without an open session, on the reasoning that
    // every control-plane call needs one. It no longer does — claiming presents
    // a device keypair, not a household — and refusing is now actively wrong:
    // sign-up mints nothing, so somebody who was invited arrives here holding
    // nothing, and "your home is still opening" describes a home they do not
    // have while blocking the screen that gets them one.
    engine.sessionOpen = false;
    const tree = await renderScreen();

    expect(hasTestId(tree, 'lf-join-gate-notice')).toBe(false);
    expect(hasTestId(tree, 'lf-join-link')).toBe(true);
  });

  it('disables joining and says why while this device awaits approval', async () => {
    mockWaitState.awaiting = true;
    mockWaitState.sas = '123456';
    const tree = await renderScreen();

    expect(buttonTitle(tree, 'lf-join-submit')).toBe('Waiting for approval…');
    expect(isDisabled(tree, 'lf-join-submit')).toBe(true);
    // The digits to read out, on the screen the person is standing on.
    expect(textOf(tree, 'house-join-sas')).toContain('123');
  });
});

describe('what the member pasted', () => {
  it('asks for both halves when the fields are empty, and calls nothing', async () => {
    const tree = await renderScreen();

    await press(tree, 'lf-join-submit');

    expect(textOf(tree, 'lf-join-status')).toContain('code and the secret');
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('refuses a bare code with no secret, without pretending it might work', async () => {
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', 'ab12cd');
    await press(tree, 'lf-join-submit');

    expect(textOf(tree, 'lf-join-status')).toContain('code and the secret');
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('splits a pasted link across both fields, so nobody transcribes a secret', async () => {
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);

    // The parse happened on the keystroke, not on submit — the secret field is
    // filled before the member ever looks at it.
    await press(tree, 'lf-join-submit');
    expect(apiClient.get).toHaveBeenCalledWith(
      '/v2/invites/lookup',
      expect.objectContaining({ params: { code: 'AB12CD' } }),
    );
  });

  it('accepts a code in one field and its secret in the other', async () => {
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', 'ab12cd');
    await typeIn(tree, 'lf-join-secret', 'sekret-value-0123456789');
    await press(tree, 'lf-join-submit');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/v2/invites/lookup',
      expect.objectContaining({ params: { code: 'AB12CD' } }),
    );
    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(true);
  });
});

describe('claiming', () => {
  it('looks up first, names the home in the confirm, then claims and waits for approval', async () => {
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');

    // Looked up, not claimed — nothing has happened to this device yet.
    expect(apiClient.get).toHaveBeenCalledWith(
      '/v2/invites/lookup',
      expect.objectContaining({ params: { code: 'AB12CD' } }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();

    // NAMING is the dialog's whole job: "you will join their home" is not
    // something anybody can meaningfully agree to.
    expect(textOf(tree, 'house-join-confirm-target')).toBe('Maple Street House');
    // …and it promises what is now true: joining ADDS.
    const explain = textOf(tree, 'house-join-confirm-explain');
    expect(explain).toContain('Nothing on this device is removed');
    expect(textOf(tree, 'house-join-confirm-keeping')).toContain('My Own Place');

    await press(tree, 'lf-join-confirm');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-shared/invites/inv_1/claim',
      expect.objectContaining({ secret: 'sekret-value-0123456789', deviceId: 'dev-self' }),
      expect.objectContaining({ headers: { 'X-House-Local-First': '1' } }),
    );
    expect(textOf(tree, 'lf-join-status')).toContain('Request sent');
    // A sync is kicked so the approved key is picked up without waiting for the
    // background schedule.
    expect(runHouseLocalSync).toHaveBeenCalled();
    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(false);
  });

  it('carries the home NAME into the join, so it is not "Shared home" forever', async () => {
    const tree = await renderScreen();
    const { adoptJoinedHousehold } = require('@features/house/local/engine') as {
      adoptJoinedHousehold: jest.Mock;
    };

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');
    await press(tree, 'lf-join-confirm');

    // The name lives in each device's sealed identity blob and no op carries a
    // rename, so the invite lookup is the ONLY chance to learn it.
    expect(adoptJoinedHousehold).toHaveBeenCalledWith({
      householdId: 'hh-shared',
      displayName: 'Maple Street House',
    });
  });

  it('cancelling leaves the device untouched', async () => {
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');
    await press(tree, 'lf-join-cancel');

    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(false);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('reports a failed claim as something to check, not as a stack trace', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Request failed with status code 410'));
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');
    await press(tree, 'lf-join-confirm');

    const shown = textOf(tree, 'lf-join-status');
    expect(shown).toContain('expired');
    expect(shown).not.toContain('status code');
  });

  it('names an invite refused for being minutes from expiry, rather than blaming the code', async () => {
    // The control plane's own refusal: both halves were RIGHT, and telling the
    // member to re-read a perfectly good code sends them nowhere.
    apiClient.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { error: { code: 'invite_expiring' } } },
    });
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');
    await press(tree, 'lf-join-confirm');

    const shown = textOf(tree, 'lf-join-status');
    expect(shown).toContain('about to run out');
    expect(shown).toContain('new one');
  });
});

describe('a tapped invite link', () => {
  it('opens the confirmation already filled in, and claims nothing by arriving', async () => {
    mockRouteParams.current = { code: 'AB12CD', secret: 'sekret-value-0123456789' };
    const tree = await renderScreen();

    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(true);
    expect(textOf(tree, 'house-join-confirm-target')).toBe('Maple Street House');
    // A link forwarded into a group chat must not enrol whoever tapped it first.
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('invites that cannot be used', () => {
  it('names the problem when the invite has been cancelled', async () => {
    apiClient.get.mockResolvedValue(lookupResponse({ status: 'revoked' }));
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');

    expect(textOf(tree, 'lf-join-status')).toContain('cancelled');
    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(false);
  });

  it('treats an active invite whose clock ran out as expired', async () => {
    apiClient.get.mockResolvedValue(
      lookupResponse({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');

    expect(textOf(tree, 'lf-join-status')).toContain('expired');
    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(false);
  });

  it('lets a CLAIMED invite through — it is this device re-confirming its own claim', async () => {
    apiClient.get.mockResolvedValue(lookupResponse({ status: 'claimed' }));
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');

    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(true);
  });

  it('still offers the confirmation when the lookup itself cannot be reached', async () => {
    // Deliberately not fatal: the join re-resolves the code, so an unreachable
    // lookup must not block someone standing in front of the person who invited
    // them. The dialog simply cannot name the home.
    apiClient.get.mockRejectedValue(new Error('Network Error'));
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');

    expect(hasTestId(tree, 'lf-join-confirm-panel')).toBe(true);
    expect(textOf(tree, 'house-join-confirm-target')).toBe('their home');
    expect(textOf(tree, 'lf-join-confirm-panel')).not.toContain('Network Error');
  });
});

/**
 * Reaching this screen BEFORE there is a home.
 *
 * The scanner and the code fields have always been here, but the screen was
 * registered on the settings stack alone — so a member holding an invite on a
 * fresh install could not reach it without first creating a home they did not
 * want. `HouseInviteQrSheet` had been promising the opposite to the person
 * sending the invite ("the invitee's Symply House can scan it") the whole time.
 */
describe('joining as the way IN, from onboarding', () => {
  const completeOnboarding = () =>
    (require('@stores/authStore') as { __completeOnboarding: jest.Mock })
      .__completeOnboarding;

  it('does not offer to finish onboarding before anything has been claimed', async () => {
    mockRouteParams.current = { fromOnboarding: true };
    const tree = await renderScreen();

    expect(hasTestId(tree, 'lf-join-onboarding-continue')).toBe(false);
    expect(completeOnboarding()).not.toHaveBeenCalled();
  });

  it('offers Continue after the claim, and leaves the SAS on screen to be read', async () => {
    mockRouteParams.current = { fromOnboarding: true };
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');
    await press(tree, 'lf-join-confirm');

    expect(textOf(tree, 'lf-join-status')).toContain('Request sent');
    expect(hasTestId(tree, 'lf-join-onboarding-continue')).toBe(true);
    // Not finished FOR them: the status panel carries the number they have to
    // read back to whoever invited them, and completing onboarding swaps this
    // stack out from under it.
    expect(completeOnboarding()).not.toHaveBeenCalled();

    await press(tree, 'lf-join-onboarding-continue');
    expect(completeOnboarding()).toHaveBeenCalled();
  });

  it('stays out of the way when the same screen is opened from Settings', async () => {
    // No `fromOnboarding`: the member already has a home, the hub is behind
    // them, and finishing onboarding is not a thing that can happen here.
    mockRouteParams.current = undefined;
    const tree = await renderScreen();

    await typeIn(tree, 'lf-join-link', LINK);
    await press(tree, 'lf-join-submit');
    await press(tree, 'lf-join-confirm');

    expect(textOf(tree, 'lf-join-status')).toContain('Request sent');
    expect(hasTestId(tree, 'lf-join-onboarding-continue')).toBe(false);
    expect(completeOnboarding()).not.toHaveBeenCalled();
  });
});
