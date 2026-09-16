/**
 * HouseOtherHouseholdsCard — the escape hatch for homes the ACCOUNT holds and
 * this DEVICE does not.
 *
 * Same setup as the other enrolment suites: real `controlPlaneClient` over a
 * mocked transport, so the URLs and the response shapes this card depends on are
 * genuinely the ones being exercised — which matters most for the assertions
 * that a call was NOT made.
 *
 * The behaviours worth a regression test are the ones that are dangerous to get
 * wrong rather than the ones that are easy to see:
 *  - silence when there is no drift, because this card sits under a list the
 *    member came for and an empty heading is a question with no answer;
 *  - a remote-only home is actually listed — the one thing the app could not do
 *    before, and the reason an account reached 17 invisible homes;
 *  - no Leave button for a sole owner, because the server refuses it with 409
 *    `last_owner_cannot_leave` and a button that cannot work is worse than none;
 *  - a failed lookup renders nothing instead of throwing, because this screen
 *    has to work with no network at all;
 *  - taking a home off the account is confirmed first — it is irreversible and
 *    the row it acts on may be the member's real home.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockNavigate = jest.fn();

jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    __esModule: true,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true }),
    useRoute: () => ({ params: undefined }),
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

/**
 * The engine stands for "what this device HOLDS". `__state.held` is the whole
 * point of the suite — the diff is against it.
 */
jest.mock('@features/house/local/engine', () => {
  const state = {
    held: [{ householdId: 'hh_local_mine', name: 'My Own Place', role: 'owner' }] as Array<{
      householdId: string;
      name: string;
      role: string;
    }>,
    ledger: {
      deviceId: 'dev-self',
      memberId: 'mem-1',
      household: { id: 'hh_local_mine', name: 'My Own Place', my_role: 'owner' },
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
    isLocalHouseSessionOpen: () => true,
    isAwaitingHouseEnrolment: () => false,
    getActiveHouseholdId: () => state.ledger.household.id,
    listLocalHouseProperties: () =>
      state.held.map((h) => ({
        householdId: h.householdId,
        deviceId: state.ledger.deviceId,
        name: h.name,
        role: h.role,
        isActive: h.householdId === state.ledger.household.id,
        hydrated: true,
        awaitingEnrolment: false,
      })),
    getLocalHouseSession: async () => ({
      householdId: state.ledger.household.id,
      ledger: state.ledger,
      identity,
      householdKeys: {
        householdId: state.ledger.household.id,
        hdk: new Uint8Array(32),
        keyEpoch: 1,
      },
      retiredHouseholdKeys: new Map(),
      awaitingEnrolment: false,
    }),
    getLocalHouseStore: () => ({ getMeta: async () => null, setMeta: async () => undefined }),
    subscribeToHouseLedgerChanges: () => () => {},
    getLocalHouseIdentity: () => identity,
    getLocalHouseholdKeys: () => ({
      householdId: 'hh_local_mine',
      hdk: new Uint8Array(32),
      keyEpoch: 1,
    }),
    installHouseholdKeys: jest.fn(async () => {}),
    adoptJoinedHousehold: jest.fn(async () => ({
      household: { id: 'hh_local_mine', name: 'My Own Place' },
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

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { HouseOtherHouseholdsCard } from '../HouseOtherHouseholdsCard';

import { flush, hasTestId, press } from './enrolmentTestKit';

const { apiClient } = require('@api/client') as {
  apiClient: { get: jest.Mock; post: jest.Mock };
};
const { __state: engine } = require('@features/house/local/engine') as {
  __state: { held: Array<{ householdId: string; name: string; role: string }> };
};
const { useHouseholdStore } = require('@stores/householdStore') as {
  useHouseholdStore: { setState: (patch: Record<string, unknown>) => void };
};

type RemoteHousehold = { id: string; display_name: string; role: string; key_epoch: number };
type RemoteMember = { userId: string; role: string; status: string };

const MINE: RemoteHousehold = {
  id: 'hh_local_mine',
  display_name: 'My Own Place',
  role: 'OWNER',
  key_epoch: 1,
};
const ORPHAN: RemoteHousehold = {
  id: 'hh_local_9f3a771c',
  display_name: 'Andrei',
  role: 'OWNER',
  key_epoch: 1,
};

/**
 * One transport for both reads the card makes. Routing on the URL rather than on
 * call order is what lets a test change the roster without caring whether the
 * list has been re-read in between.
 */
function serve(households: RemoteHousehold[], members: RemoteMember[]) {
  apiClient.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/state')) {
      const householdId = url.split('/')[3] ?? '';
      return { data: { state: { householdId, keyEpoch: 1, securityRevision: 1, members, devices: [] } } };
    }
    return { data: { households } };
  });
}

async function renderCard() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseOtherHouseholdsCard />
      </ThemeProvider>,
    );
    await flush();
  });
  return tree;
}

/** The buttons handed to the last `Alert.alert`, so a test can accept or cancel. */
function alertButtons(): Array<{ text?: string; style?: string; onPress?: () => void }> {
  const alertMock = Alert.alert as unknown as jest.Mock;
  const call = alertMock.mock.calls[alertMock.mock.calls.length - 1];
  return (call?.[2] ?? []) as Array<{ text?: string; style?: string; onPress?: () => void }>;
}

function leaveCalls(): string[] {
  return apiClient.post.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/leave'));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  engine.held = [{ householdId: 'hh_local_mine', name: 'My Own Place', role: 'owner' }];
  useHouseholdStore.setState({ households: [{ id: 'hh_local_mine', name: 'My Own Place' }] });
  serve([MINE], [{ userId: 'u1', role: 'OWNER', status: 'active' }]);
  apiClient.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('when there is nothing wrong', () => {
  /**
   * Most members hold every home they belong to. A permanently-mounted card
   * announcing "0 other homes" would train them to ignore the one moment it has
   * something to say.
   */
  it('renders nothing at all when the account holds no home this device is missing', async () => {
    const tree = await renderCard();

    expect(hasTestId(tree, 'house-other-households-card')).toBe(false);
    expect(collectRenderedText(tree)).toEqual([]);
  });
});

describe('showing the drift', () => {
  /**
   * The whole point. Before this card an account could accumulate homes — 17 on
   * staging — that no screen in the app could name, including to their owner.
   */
  it('lists a home the account has that this device does not hold', async () => {
    serve([MINE, ORPHAN], [{ userId: 'u1', role: 'OWNER', status: 'active' }]);

    const tree = await renderCard();

    expect(hasTestId(tree, 'house-other-households-card')).toBe(true);
    expect(hasTestId(tree, `house-other-household-${ORPHAN.id}`)).toBe(true);
    // The home this device DOES hold is not drift and must not be listed —
    // offering to remove it would be offering to break the member's own phone.
    expect(hasTestId(tree, `house-other-household-${MINE.id}`)).toBe(false);
    expect(collectRenderedText(tree)).toContain('Andrei');
  });

  /**
   * A home the device lost from the engine but that the published store still
   * lists is not drift the member can act on — it is two local sources
   * disagreeing. Counting it would put an irreversible "remove from account"
   * beside a home they still have.
   */
  it('treats a home named by either local source as held', async () => {
    serve([MINE, ORPHAN], [{ userId: 'u1', role: 'OWNER', status: 'active' }]);
    engine.held = [];
    useHouseholdStore.setState({
      households: [
        { id: 'hh_local_mine', name: 'My Own Place' },
        { id: ORPHAN.id, name: 'Andrei' },
      ],
    });

    const tree = await renderCard();

    expect(hasTestId(tree, 'house-other-households-card')).toBe(false);
  });
});

describe('what the member can do about it', () => {
  /**
   * `POST /v2/households/:id/leave` answers 409 `last_owner_cannot_leave` when
   * an owner tries to walk out on people who would be left with a home nobody
   * can administer. Rendering the button anyway would spend a destructive
   * confirmation on a call that cannot succeed.
   */
  it('does not offer to leave a home this member is the only owner of', async () => {
    serve([MINE, ORPHAN], [
      { userId: 'u1', role: 'OWNER', status: 'active' },
      { userId: 'u2', role: 'ADULT', status: 'active' },
    ]);

    const tree = await renderCard();
    await press(tree, `house-other-household-options-${ORPHAN.id}`);

    expect(hasTestId(tree, `house-other-household-leave-${ORPHAN.id}`)).toBe(false);
    expect(collectRenderedText(tree).join(' ')).toContain('only person in charge');
    expect(leaveCalls()).toEqual([]);
  });

  /**
   * The mirror case, and the one the 17 orphans are all in: the coordinator lets
   * the LAST person in a home leave, owner or not, because nobody is stranded.
   * That is the only act that takes a row off `/v2/households`.
   */
  it('offers to remove a home nobody else is in', async () => {
    serve([MINE, ORPHAN], [{ userId: 'u1', role: 'OWNER', status: 'active' }]);

    const tree = await renderCard();
    await press(tree, `house-other-household-options-${ORPHAN.id}`);

    expect(hasTestId(tree, `house-other-household-leave-${ORPHAN.id}`)).toBe(true);
  });

  /**
   * Irreversible, and the row it acts on may be the member's real home sitting on
   * a phone they still own. A tap must ask before it acts, and must not act at
   * all if the answer is no.
   */
  it('asks before taking a home off the account, and does nothing until confirmed', async () => {
    serve([MINE, ORPHAN], [{ userId: 'u1', role: 'OWNER', status: 'active' }]);

    const tree = await renderCard();
    await press(tree, `house-other-household-options-${ORPHAN.id}`);
    await press(tree, `house-other-household-leave-${ORPHAN.id}`);

    expect(Alert.alert).toHaveBeenCalled();
    expect(leaveCalls()).toEqual([]);

    const destructive = alertButtons().find((b) => b.style === 'destructive');
    expect(destructive).toBeDefined();
    await act(async () => {
      destructive?.onPress?.();
      await flush();
    });

    expect(leaveCalls()).toEqual([`/v2/households/${ORPHAN.id}/leave`]);
  });
});

describe('when the network is not there', () => {
  /**
   * This card runs a lookup on a screen that must work offline. A rejected
   * lookup is normal, not exceptional — it may not blow up the homes list it
   * sits under, and it may not put a dialog in front of it either.
   */
  it('renders nothing rather than throwing when the account list cannot be read', async () => {
    apiClient.get.mockRejectedValue(new Error('Network Error'));

    const tree = await renderCard();

    expect(hasTestId(tree, 'house-other-households-card')).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  /**
   * A failed ROSTER read is narrower: the row is real and still listed, so the
   * member gets a retry inside it instead of losing the row.
   */
  it('keeps the row and offers a retry when the roster read fails', async () => {
    apiClient.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/state')) throw new Error('Network Error');
      return { data: { households: [MINE, ORPHAN] } };
    });

    const tree = await renderCard();
    await press(tree, `house-other-household-options-${ORPHAN.id}`);

    expect(hasTestId(tree, `house-other-household-${ORPHAN.id}`)).toBe(true);
    expect(hasTestId(tree, `house-other-household-retry-${ORPHAN.id}`)).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
