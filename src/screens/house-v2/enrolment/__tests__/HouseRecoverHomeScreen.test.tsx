/**
 * HouseRecoverHomeScreen — the only surface that renders the two bootstrap
 * states a device can be stranded in.
 *
 * The bug behind it: a device with no local copy of a home used to create one
 * silently, so a member who reinstalled found an empty home standing where
 * their real one had been (17 of them on staging). The server is asked first
 * now, and the two answers that are not "open" had, until this screen, nothing
 * that could render them.
 *
 * What is worth pinning is therefore not the layout but the four things that
 * put a member back in an empty home if they slip:
 *   - the REAL home is named, so they can see it still exists;
 *   - the explanation is in words a member can act on, not internal ones;
 *   - the two routes out are the two that work, and both actually navigate;
 *   - "start a new home" is last and secondary when it is offered at all, and
 *     is not offered AT ALL while we are merely offline — offered alone it
 *     reads as the way forward, and taking it is how the second empty home
 *     gets made.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockPathname = { current: '/' };

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn() },
  usePathname: () => mockPathname.current,
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

// `@brand` is NOT mocked: jest already runs as `symply-house`, and spreading
// that module's exports evaluates a getter mid-require and throws. The one test
// that needs another brand spies on the real export instead.
jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: jest.fn(() => true),
  isHouseP2PEnabled: () => false,
}));

/**
 * The bootstrap publisher, standing in for `ensureSession`. `__bootstrap.set`
 * is the whole point: the state moves under a mounted screen (a peer approving
 * this device is what ends "recover this home"), so the hook has to follow it
 * rather than read it once on mount.
 */
jest.mock('@features/house/local/ensureSession', () => {
  const listeners = new Set<(state: unknown) => void>();
  const state: { current: unknown } = { current: { status: 'idle' } };
  return {
    __esModule: true,
    __bootstrap: {
      set(next: unknown) {
        state.current = next;
        for (const listener of listeners) listener(next);
      },
      reset() {
        state.current = { status: 'idle' };
        listeners.clear();
      },
    },
    getHouseLocalBootstrapState: () => state.current,
    subscribeToHouseLocalBootstrapState: (listener: (s: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startNewHouseholdOnThisDevice: jest.fn(async () => undefined),
    ensureHouseLocalSession: jest.fn(async () => undefined),
  };
});

/**
 * The invitee's own claim. Its own machine — a socket, a poll and a persisted
 * record — and this suite is about which CARD the screen chooses, so it is
 * mocked to the two answers that choice turns on: waiting on an approval this
 * device asked for, or not.
 */
const mockJoinWait = {
  awaiting: false,
  sas: null as string | null,
  outcome: null as string | null,
  dismiss: jest.fn(),
  refresh: jest.fn(async () => {}),
};
jest.mock('@features/house/local/useHouseJoinWait', () => ({
  __esModule: true,
  useHouseJoinWait: () => mockJoinWait,
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import {
  HouseRecoverHomeScreen,
  useHouseRecoveryGate,
  type HouseRecoveryState,
} from '../HouseRecoverHomeScreen';

import { allText, flush, hasTestId, press } from './enrolmentTestKit';

const { router } = require('expo-router') as { router: { push: jest.Mock } };
const brandModule = require('@brand') as { isHouseBrand: () => boolean };
const { isHouseLocalFirst } = require('@features/house/local/flag') as {
  isHouseLocalFirst: jest.Mock;
};
const {
  __bootstrap: bootstrap,
  startNewHouseholdOnThisDevice,
  ensureHouseLocalSession,
} = require('@features/house/local/ensureSession') as {
  __bootstrap: { set: (next: unknown) => void; reset: () => void };
  startNewHouseholdOnThisDevice: jest.Mock;
  ensureHouseLocalSession: jest.Mock;
};

const OAK = { id: 'hh_local_oak', name: 'The Oak House' };
const MILL = { id: 'hh_local_mill', name: 'Mill Cottage' };

const RECOVER: HouseRecoveryState = { status: 'recover-this-home', households: [OAK] };
const OFFLINE: HouseRecoveryState = { status: 'undecided-offline' };

async function renderScreen(state: HouseRecoveryState) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HouseRecoverHomeScreen state={state} />
      </ThemeProvider>,
    );
    await flush();
  });
  return tree;
}

/** Every `house-recover-*` control in tree order — the order a member reads. */
function controlIdsInOrder(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll(
      (n) =>
        typeof n.props?.testID === 'string' &&
        n.props.testID.startsWith('house-recover-') &&
        typeof n.props?.onPress === 'function' &&
        typeof n.props?.title === 'string',
    )
    .map((n) => n.props.testID as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  bootstrap.reset();
  mockPathname.current = '/';
  isHouseLocalFirst.mockReturnValue(true);
  startNewHouseholdOnThisDevice.mockResolvedValue(undefined);
  ensureHouseLocalSession.mockResolvedValue(undefined);
  mockJoinWait.awaiting = false;
  mockJoinWait.sas = null;
  mockJoinWait.outcome = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('when the account owns homes this phone holds no key for', () => {
  /**
   * The single most important line on the screen. "You have a home you cannot
   * open" is unbearable without being told WHICH — and being shown their real
   * home by name is the difference between a member waiting and a member
   * creating the empty replacement this whole change exists to prevent.
   */
  it('names the real home rather than describing it in the abstract', async () => {
    const tree = await renderScreen(RECOVER);

    expect(hasTestId(tree, 'house-recover-home-screen')).toBe(true);
    expect(hasTestId(tree, `house-recover-home-${OAK.id}`)).toBe(true);
    expect(collectRenderedText(tree)).toContain('The Oak House');
  });

  /** A member with three homes must see three, not "some homes". */
  it('names every home the account owns, not just the first', async () => {
    const tree = await renderScreen({
      status: 'recover-this-home',
      households: [OAK, MILL],
    });

    expect(hasTestId(tree, `house-recover-home-${OAK.id}`)).toBe(true);
    expect(hasTestId(tree, `house-recover-home-${MILL.id}`)).toBe(true);
    expect(collectRenderedText(tree)).toContain('Mill Cottage');
  });

  /**
   * This screen is the first thing a reinstalling member sees, and the words
   * that describe the state internally — ledger, control plane, mint, enrolment
   * — describe nothing they can act on. The explanation has to be about a key
   * and a phone or it is not an explanation.
   */
  it('explains the cause without any of the words only we use', async () => {
    const tree = await renderScreen(RECOVER);
    const text = allText(tree).toLowerCase();

    expect(text).toContain('key');
    expect(text).toContain('phone');
    for (const jargon of ['ledger', 'control plane', 'mint', 'enrolment', 'enrollment']) {
      expect(text).not.toContain(jargon);
    }
  });

  /**
   * Two routes exist and both work; a third would be an invention that ends in
   * a dead end. The pushes are asserted rather than the labels because a button
   * that navigates nowhere is the failure a member actually hits.
   */
  it('offers the two recovery routes that exist, and both navigate', async () => {
    const tree = await renderScreen(RECOVER);

    expect(hasTestId(tree, 'house-recover-device-sync')).toBe(true);
    expect(hasTestId(tree, 'house-recover-restore-backup')).toBe(true);

    await press(tree, 'house-recover-device-sync');
    expect(router.push).toHaveBeenCalledWith('/device-sync');

    await press(tree, 'house-recover-restore-backup');
    expect(router.push).toHaveBeenCalledWith('/house-backup');
  });

  /**
   * The dangerous button. It has to be reachable — a member whose other phone
   * is gone and who kept no backup must be able to carry on — but it must never
   * read as the way forward: it is last, it is the only secondary control, and
   * its copy says in as many words that it does not bring the home back.
   */
  it('keeps "start a new home" last, secondary, and honest about what it does', async () => {
    const tree = await renderScreen(RECOVER);

    const order = controlIdsInOrder(tree);
    expect(order).toEqual([
      'house-recover-device-sync',
      'house-recover-restore-backup',
      'house-recover-start-new',
    ]);

    const button = tree.root.findAll(
      (n) => n.props?.testID === 'house-recover-start-new' && typeof n.props?.title === 'string',
    )[0];
    expect(button?.props.variant).toBe('secondary');

    // The promise the copy must NOT make, stated as its negative.
    expect(allText(tree)).toContain('does not bring back the home above');
  });

  it('starts a new home only when the member asks for one', async () => {
    const tree = await renderScreen(RECOVER);
    expect(startNewHouseholdOnThisDevice).not.toHaveBeenCalled();

    await press(tree, 'house-recover-start-new');
    expect(startNewHouseholdOnThisDevice).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same bootstrap state, a completely different person.
 *
 * Sign-up no longer mints a home nobody asked for, so somebody who joins by
 * invite has ONE property and it is key-less until the owner approves — which
 * derives `recover-this-home` for them too. The state is right and every route
 * the recovery card offers is wrong: there is no other phone with this home on
 * it and no backup to restore, and "start a new, empty home" walks them out of
 * the home they were invited to.
 */
describe('when the wait is an invite this device asked for', () => {
  const CLAIMED: HouseRecoveryState = {
    status: 'recover-this-home',
    households: [{ id: 'hh_shared_maple', name: 'Maple Street House' }],
  };

  it('shows the digits to read back, not the recovery routes', async () => {
    mockJoinWait.awaiting = true;
    mockJoinWait.sas = '481920';

    const tree = await renderScreen(CLAIMED);

    expect(hasTestId(tree, 'house-join-sas-panel')).toBe(true);
    expect(hasTestId(tree, 'house-recover-device-sync')).toBe(false);
    expect(hasTestId(tree, 'house-recover-restore-backup')).toBe(false);
  });

  it('never offers to start an empty home instead of the one they were invited to', async () => {
    // The single worst outcome available on this screen for this person: they
    // are one approval away from a shared home, and the button makes a
    // different, empty one.
    mockJoinWait.awaiting = true;
    mockJoinWait.sas = '481920';

    const tree = await renderScreen(CLAIMED);

    expect(hasTestId(tree, 'house-recover-start-new')).toBe(false);
    expect(controlIdsInOrder(tree)).toEqual([]);
  });

  it('keeps telling them how a claim ENDED, rather than reverting to recovery', async () => {
    // A cancelled or expired invite drops the property, and the explanation is
    // the only thing left that says why the home went away.
    mockJoinWait.awaiting = false;
    mockJoinWait.outcome = 'revoked';

    const tree = await renderScreen(CLAIMED);

    expect(hasTestId(tree, 'house-join-outcome-panel')).toBe(true);
    expect(hasTestId(tree, 'house-recover-device-sync')).toBe(false);
  });

  it('still shows the recovery routes to a device with no claim of its own', async () => {
    // The reinstall — unchanged, and the reason the two are told apart by the
    // claim rather than by the property set they share.
    const tree = await renderScreen(RECOVER);

    expect(hasTestId(tree, 'house-join-sas-panel')).toBe(false);
    expect(hasTestId(tree, 'house-recover-device-sync')).toBe(true);
  });

  /**
   * Awaiting with no digits — the blank, inescapable gate.
   *
   * `awaiting` is the engine's `session.awaitingKeys`; `sas` comes from a claim
   * record this device persisted. They are independent, so `awaiting && !sas`
   * is ordinary: it is true on EVERY mount while `recallJoinSas()` resolves,
   * and permanently for a device awaiting keys that never claimed an invite
   * here — reproduced on House-A with `my_role: 'member'`, no key and no claim.
   *
   * Keyed on `awaiting` alone this rendered the invitee card — "Read them the
   * number below" — above a panel that returns null without a SAS. One
   * paragraph, no number, no controls, drawn over the whole app. The member's
   * words were "no way to close it", and there genuinely was none.
   */
  it('falls back to the recovery routes when it is waiting with no digits', async () => {
    mockJoinWait.awaiting = true;
    mockJoinWait.sas = null;

    const tree = await renderScreen(CLAIMED);

    // The card that would have been a dead end is not the one shown...
    expect(hasTestId(tree, 'house-join-sas-panel')).toBe(false);
    // ...and the member has doors again.
    expect(hasTestId(tree, 'house-recover-device-sync')).toBe(true);
    expect(hasTestId(tree, 'house-recover-restore-backup')).toBe(true);
  });

  it('never renders a gate with no controls at all', async () => {
    // The property that actually matters, stated directly: this screen covers
    // the entire app, so a branch reaching zero controls traps the member with
    // no way out but force-quitting.
    mockJoinWait.awaiting = true;
    mockJoinWait.sas = null;

    const tree = await renderScreen(CLAIMED);

    expect(controlIdsInOrder(tree).length).toBeGreaterThan(0);
  });
});

describe('when the server could not be reached', () => {
  /**
   * The state exists precisely so that nothing is created on a guess. Offering
   * "start a new home" as the only control on screen would re-create the guess
   * with the member's finger on it, which is a worse version of the bug.
   */
  it('never offers to start a new home when we do not know what the account owns', async () => {
    const tree = await renderScreen(OFFLINE);

    expect(hasTestId(tree, 'house-recover-home-screen')).toBe(true);
    expect(hasTestId(tree, 'house-recover-start-new')).toBe(false);
    expect(hasTestId(tree, 'house-recover-retry')).toBe(true);
  });

  it('retries the check the bootstrap deferred', async () => {
    const tree = await renderScreen(OFFLINE);

    await press(tree, 'house-recover-retry');
    expect(ensureHouseLocalSession).toHaveBeenCalledTimes(1);
  });

  /**
   * `ensureHouseLocalSession` RESOLVES when the network is still down — it
   * simply defers again. A retry that reported success on a resolved promise
   * would leave the member looking at an unchanged screen that had just told
   * them it worked.
   */
  it('does not claim success when the retry resolves without opening anything', async () => {
    bootstrap.set({ status: 'undecided-offline' });
    const tree = await renderScreen(OFFLINE);

    await press(tree, 'house-recover-retry');

    expect(allText(tree)).toContain('Still no answer');
  });
});

describe('getting out of the way', () => {
  /**
   * The screen is drawn ABOVE the shell, so the routes it sends the member to
   * open underneath it. Without this, tapping "Set up from my other phone"
   * looks like a button that does nothing.
   */
  it('renders nothing while the member is standing on one of its own destinations', async () => {
    mockPathname.current = '/device-sync';
    const oneWayOut = await renderScreen(RECOVER);
    expect(hasTestId(oneWayOut, 'house-recover-home-screen')).toBe(false);

    mockPathname.current = '/house-backup';
    const theOther = await renderScreen(RECOVER);
    expect(hasTestId(theOther, 'house-recover-home-screen')).toBe(false);

    mockPathname.current = '/tasks';
    const anywhereElse = await renderScreen(RECOVER);
    expect(hasTestId(anywhereElse, 'house-recover-home-screen')).toBe(true);
  });
});

describe('useHouseRecoveryGate', () => {
  function Probe({ onState }: { onState: (state: HouseRecoveryState | null) => void }) {
    onState(useHouseRecoveryGate());
    return null;
  }

  async function mountProbe() {
    const seen: Array<HouseRecoveryState | null> = [];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<Probe onState={(s) => seen.push(s)} />);
      await flush();
    });
    return { seen, tree, last: () => seen[seen.length - 1] };
  }

  /**
   * This hook decides what the whole app renders. Diverting on a healthy state
   * would put a recovery screen in front of a member whose home is right there.
   */
  it('diverts for nothing but the two states that need a member', async () => {
    const probe = await mountProbe();
    expect(probe.last()).toBeNull();

    await act(async () => {
      bootstrap.set({ status: 'open', householdId: 'hh_local_oak' });
      await flush();
    });
    expect(probe.last()).toBeNull();

    // The state a brand-new account sits in from sign-up until it asks for a
    // home. It is the most ordinary first minute the product has, and putting
    // "your home is not on this phone yet" over it would be both wrong and
    // inescapable — there is no home to recover and no other phone to ask.
    await act(async () => {
      bootstrap.set({ status: 'awaiting-first-home' });
      await flush();
    });
    expect(probe.last()).toBeNull();

    await act(async () => {
      bootstrap.set(RECOVER);
      await flush();
    });
    expect(probe.last()).toEqual(RECOVER);
  });

  /**
   * A peer approving this device is what ends "recover this home", and nothing
   * on this screen is the trigger. A hook that read the state once on mount
   * would strand the member on a recovery screen for a home they now hold.
   */
  it('follows the state out of recovery when the keys arrive from a peer', async () => {
    bootstrap.set(RECOVER);
    const probe = await mountProbe();
    expect(probe.last()).toEqual(RECOVER);

    await act(async () => {
      bootstrap.set({ status: 'open', householdId: OAK.id });
      await flush();
    });
    expect(probe.last()).toBeNull();
  });

  /** Health, Kaizen and Language have no homes and no local copy of one. */
  it('never diverts on a brand that has no homes, or on a server-backed build', async () => {
    bootstrap.set(RECOVER);

    const brandSpy = jest.spyOn(brandModule, 'isHouseBrand').mockReturnValue(false);
    expect((await mountProbe()).last()).toBeNull();

    brandSpy.mockReturnValue(true);
    isHouseLocalFirst.mockReturnValue(false);
    expect((await mountProbe()).last()).toBeNull();
  });
});
