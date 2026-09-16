/**
 * BudgetHouseholdScreen — Symply Budget's shared-budget household manager.
 *
 * Unlike a property-manager app, a Budget household is just a group of
 * people who share one budget — no address, photo, floor plans or tax. This
 * suite verifies the Budget-native surface: the empty state, the populated list
 * (name + member count + Active/Switch affordance), switching the active
 * household (store + data refresh), opening member management, and the
 * name-only create flow that posts to the shared households API.
 *
 * There are TWO backends behind that one surface, and the suite is split to
 * match: the legacy remote path (D1 rows through `householdsApi`) and the
 * local-first path, where BR-016 made a household a SESSION in the local engine.
 * Every case below states which one it is exercising, because the same button
 * calls a different function in each and the whole class of bug this screen has
 * produced is a handler reaching for the wrong one.
 *
 * The presentational leaves (@components/common, @components/ui, BottomSheet,
 * Icon, Swipeable) are stubbed to plain RN primitives so the test exercises the
 * screen's data/logic rather than component internals; the household store, the
 * households API, the local engine, DataContext and the focus effect are mocked
 * so every call can be asserted.
 */

// --- Presentational leaves -> plain primitives -----------------------------
type MockChildren = { children?: unknown };

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: MockChildren) => React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children }: MockChildren) => React.createElement(View, null, children ?? null),
    // `rightElement` is rendered, not dropped: the screen's primary action —
    // add a household — lives in that slot, so a stub that swallowed it would
    // make every "tap add" case below silently unreachable.
    ScreenHeader: ({
      title,
      onBackPress,
      rightElement,
    }: {
      title?: unknown;
      onBackPress?: () => void;
      rightElement?: unknown;
    }) =>
      React.createElement(View, { testID: 'screen-header' }, [
        React.createElement(View, { key: 't' }, title ?? null),
        React.createElement(View, { key: 'b', testID: 'header-back', onPress: onBackPress }),
        React.createElement(View, { key: 'r' }, (rightElement as React.ReactNode) ?? null),
      ]),
    HeaderActionButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { testID, onPress }, null),
    screenScrollViewStyle: { scroll: { flex: 1 } },
    screenScrollEndTestId: (screenRootTestId: string) => `${screenRootTestId}-scroll-end`,
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      React.createElement(View, { testID: testID ?? 'screen-scroll-end' }),
  };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    Card: ({ children }: MockChildren) => React.createElement(View, null, children),
    Typography: ({ children }: MockChildren) => React.createElement(Text, null, children),
  };
});

// The shared sheet double: children only mount while visible, and the header
// keeps the sheet's commit (Save / Create) — a children-only stub would hide
// the one control these tests press.
jest.mock('@components/ui/BottomSheet', () => mockCreateBottomSheet({ wrapInView: true }));

jest.mock('@components/ui/Icon', () => ({
  __esModule: true,
  Icon: () => null,
}));

// Kept although the screen no longer uses `Swipeable` — that is exactly what it
// is for now. The stub renders any right-swipe actions and a `swipe-open-trigger`
// eagerly, so "hides nothing behind a gesture" fails loudly the day a swipe
// comes back to a household card, instead of passing because the real Swipeable
// renders nothing under a test renderer.
jest.mock('react-native-gesture-handler/Swipeable', () => {
  const React = require('react');
  const { View } = require('react-native');
  const fakeAnimated = { interpolate: () => 0 };
  return {
    __esModule: true,
    default: (props: any) => {
      const right =
        typeof props.renderRightActions === 'function'
          ? props.renderRightActions(fakeAnimated, fakeAnimated)
          : null;
      return React.createElement(View, null, [
        React.createElement(View, { key: 'actions' }, right),
        React.createElement(View, { key: 'body' }, props.children),
        React.createElement(View, {
          key: 'open',
          testID: 'swipe-open-trigger',
          onPress: props.onSwipeableWillOpen,
        }),
      ]);
    },
  };
});

// Focus effect -> run the callback once on mount (drives fetchHouseholds).
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
  // The screen navigates through the stack's own type rather than the screen
  // prop's composite one — see the comment on the hook call there.
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    // The screen is pushed from Invite & Household, so it asks whether there
    // is anything to go back to before deciding how to reach the hub.
    canGoBack: () => mockCanGoBack(),
  }),
}));

const mockCanGoBack = jest.fn(() => true);
const mockRefreshAll = jest.fn().mockResolvedValue(undefined);
jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ refreshAll: mockRefreshAll, refreshActivePropertyData: mockRefreshAll }),
}));

// Whole-state store mock (the screen destructures, no selector).
const mockStoreActions = {
  fetchHouseholds: jest.fn().mockResolvedValue(undefined),
  setCurrentHousehold: jest.fn(),
  addHousehold: jest.fn(),
  updateHousehold: jest.fn(),
  removeHousehold: jest.fn(),
};
let mockHouseholds: any[] = [];
let mockCurrentHousehold: any = null;
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: () => ({
    households: mockHouseholds,
    currentHousehold: mockCurrentHousehold,
    ...mockStoreActions,
  }),
}));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockLeave = jest.fn();
jest.mock('@api/households', () => ({
  __esModule: true,
  householdsApi: {
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
    leave: (...a: unknown[]) => mockLeave(...a),
  },
}));

// Local-first gate + engine. Under BR-016 a Budget household is a SESSION in the
// local engine — rows, op log, key epoch, checkpoint watermark and sync cursors
// all partitioned by `household_id` — so create, switch, rename and remove are
// engine calls and `householdsApi` must stay untouched on this path. Each engine
// entry point is its own jest.fn so a test can prove which one a button reached.
let mockLocalFirst = false;
let mockSessionOpen = false;
jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

const mockRename = jest.fn();
const mockCreateLocal = jest.fn();
const mockActivateLocal = jest.fn();
const mockRemoveLocal = jest.fn();
/** Whichever household the ENGINE has active — `getLocalLedger` reads the active
 *  session, which is how `refreshEnrolledDevices` decides whose devices to count. */
let mockActiveLocalId = 'hh_local_a1';
/** Household ids this device holds but has no key for — drives the awaiting-enrolment copy. */
let mockAwaitingIds: string[] = [];
jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => mockSessionOpen,
  getLocalLedger: () => ({ household: { id: mockActiveLocalId, name: 'Household A' } }),
  listLocalBudgetHouseholds: () =>
    mockAwaitingIds.map((householdId) => ({ householdId, awaitingEnrolment: true })),
  renameLocalHousehold: (...a: unknown[]) => mockRename(...a),
  createLocalBudgetHousehold: (...a: unknown[]) => mockCreateLocal(...a),
  activateLocalBudgetHousehold: (...a: unknown[]) => mockActivateLocal(...a),
  removeLocalBudgetHousehold: (...a: unknown[]) => mockRemoveLocal(...a),
}));

// The engine-authoritative republish. Mocked rather than run because the point
// of every local-first case below is WHICH source the list came from: the store
// is published from the session registry, never appended to row by row.
const mockSyncStore = jest.fn();
jest.mock('@features/budget/local/ensureSession', () => ({
  __esModule: true,
  syncHouseholdStoreFromLocalLedger: () => mockSyncStore(),
}));

// Forwards its argument: the screen names the household explicitly, because the
// one it just created or renamed need not be the active one.
const mockSyncControlPlane = jest.fn().mockResolvedValue(undefined);
/**
 * Leaving is now two acts in a fixed order: end the membership on the control
 * plane, THEN erase this device's copy. Both halves are mockable here because
 * the order is the whole point — a wipe that runs when the leave failed is a
 * member who has destroyed their data and is still in the household.
 */
const mockIsOnControlPlane = jest.fn().mockResolvedValue(true);
const mockLeaveHousehold = jest.fn().mockResolvedValue({ devices: [], keyEpoch: 2 });
jest.mock('@features/budget/local/controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: jest.fn().mockResolvedValue({ devices: [] }),
  syncLocalHouseholdToControlPlane: (...a: unknown[]) => mockSyncControlPlane(...a),
  budgetHouseholdIsOnControlPlane: (...a: unknown[]) => mockIsOnControlPlane(...a),
  leaveBudgetHousehold: (...a: unknown[]) => mockLeaveHousehold(...a),
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { createBottomSheetMock as mockCreateBottomSheet } from '../../../../test-utils/mockBottomSheet';

import { ThemeProvider } from '@contexts/ThemeContext';
// The real class, deliberately: the screen translates it with `instanceof`, so a
// stub would pass the test while the member still read "No local ledger for
// household hh_local_9f…" on screen.
import { BudgetLocalUnknownHouseholdError } from '@features/budget/local/errors';

import { BudgetHouseholdScreen, householdSubtitle } from '../BudgetHouseholdScreen';

const HH_ACTIVE = {
  id: 'hh1',
  name: 'Family',
  member_count: 3,
  my_role: 'owner',
};
const HH_OTHER = {
  id: 'hh2',
  name: 'Roommates',
  member_count: 2,
  my_role: 'member',
};

// Same object the mocked `useNavigation` hands the screen, so a test can assert
// on either the prop or the hook without them drifting apart.

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join('');
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        {/* No props: the screen reads navigation through the hook, and pinning
            it to one route's props is what stopped it being registrable as
            `BudgetHouseholds` on the Budget stack. */}
        <BudgetHouseholdScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` wipes the implementation too, so the default — pushed from
  // the hub, therefore something to go back to — is restored per test.
  mockCanGoBack.mockReturnValue(true);
  mockHouseholds = [];
  mockCurrentHousehold = null;
  mockLocalFirst = false;
  mockSessionOpen = false;
  mockActiveLocalId = 'hh_local_a1';
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});


describe('BudgetHouseholdScreen', () => {
  it('shows the shared-budget empty state and never mentions properties/addresses', async () => {
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('Households');
    expect(texts).toContain('No households yet');
    expect(texts).toContain('share the same budget');
    // No House/property framing leaks in.
    expect(texts.toLowerCase()).not.toContain('property');
    expect(texts.toLowerCase()).not.toContain('address');

    // Focusing the screen refreshes the household list.
    expect(mockStoreActions.fetchHouseholds).toHaveBeenCalled();
  });

  it('renders each household with its members, an Active badge, and a Switch action', async () => {
    mockHouseholds = [HH_ACTIVE, HH_OTHER];
    mockCurrentHousehold = HH_ACTIVE;

    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('Family');
    expect(texts).toContain('Roommates');
    expect(texts).toContain('Active');
    // NOT `member_count`. That server number counts rows in the shared
    // households table, which Budget V2 neither writes nor reads — it was the
    // "2 members" sitting above a members list that said "Active Members (1)".
    expect(texts).not.toContain('3 members');

    // The active one has no Switch button; the other does.
    expect(tree.root.findAllByProps({ testID: 'household-switch-hh1' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'household-switch-hh2' }).length).toBeGreaterThan(0);
  });

  it("opens the household's own page rather than switching to it", async () => {
    // The card used to do two things in one tap: activate whichever household
    // you touched, then open the invite hub — which acts on "the active
    // household" and takes no id. So LOOKING at a household silently moved the
    // budget you were in. It now pushes that household's own page, addressed by
    // id, and switching is the button beside it.
    mockHouseholds = [HH_ACTIVE, HH_OTHER];
    mockCurrentHousehold = HH_ACTIVE;
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'household-card-hh2' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholdEdit', { householdId: 'hh2' });
    // `HouseholdMembers` is House's model — email invitations, a /join/<token>
    // link, server member rows — and Budget shares a budget by enrolling a
    // DEVICE, so that screen showed a roster the control plane never heard of.
    expect(mockNavigate).not.toHaveBeenCalledWith('HouseholdMembers', expect.anything());
  });

  it('switches the active household and refreshes budget data', async () => {
    mockHouseholds = [HH_ACTIVE, HH_OTHER];
    mockCurrentHousehold = HH_ACTIVE;
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'household-switch-hh2' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockStoreActions.setCurrentHousehold).toHaveBeenCalledWith(HH_OTHER);
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it('adds a household on the same screen that edits one', async () => {
    // `BudgetHouseholdEdit` with no `householdId` IS the create form, so a new
    // household is named, pictured and addressed in one save. It used to be a
    // name-only sheet here, which left every household needing a second,
    // separate edit for everything else about it.
    mockHouseholds = [HH_ACTIVE];
    mockCurrentHousehold = HH_ACTIVE;
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'fab-add-household' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholdEdit');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('goes back when the header back button is pressed', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'header-back' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('hides nothing behind a gesture — the card itself is the way in', async () => {
    // Renaming lived behind a swipe-left revealing an Edit button: invisible
    // until performed, unreachable by a screen reader, undiscovered by most
    // members, and — in a UI test — a gesture whose failure looks exactly like a
    // stale assertion. The second tap target it carried, a "Manage members &
    // invites" strip that opened the invite hub, is on the household's page now.
    mockHouseholds = [HH_ACTIVE, HH_OTHER];
    mockCurrentHousehold = HH_ACTIVE;
    const tree = await renderScreen();

    expect(tree.root.findAllByProps({ testID: 'household-swipe-edit-hh1' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'swipe-open-trigger' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'household-manage-members-hh1' })).toHaveLength(0);
  });
});

/**
 * BR-016 — many households per device, under local-first.
 *
 * These cases replace the interim single-household ones, which asserted the Add
 * FAB, Delete and Leave were HIDDEN. They were hidden because the engine held
 * exactly one household per device and every one of those buttons wrote to D1
 * through an API the engine never read: `householdsApi.create` produced a row
 * the engine never learned about, which the next refresh — publishing the
 * engine's set — dropped from the list while it survived on the server. That is
 * the orphaning that failed `budget-households` and `budget-household-switch` on
 * "the new household is still visible".
 *
 * The engine now holds one SESSION per household, so the affordances are real
 * again and the fix is a ROUTING one: every act goes to the engine, and the
 * assertions below are as much about what is NOT called as what is.
 */
describe('BudgetHouseholdScreen — local-first (BR-016 multi-household)', () => {
  const HH_A = { id: 'hh_local_a1', name: 'Household A', my_role: 'owner' };
  const HH_B = { id: 'hh_local_b2', name: 'Household B', my_role: 'owner' };
  const NEW_HH = { id: 'hh_local_new', name: 'Trip Fund', my_role: 'owner' };

  beforeEach(() => {
    mockLocalFirst = true;
    // A session IS open — the branch where it is not is the legacy one, where
    // `fetchHouseholds()` is what opens it.
    mockSessionOpen = true;
    mockActiveLocalId = HH_A.id;
    mockHouseholds = [HH_A, HH_B];
    mockCurrentHousehold = HH_A;
    mockCreateLocal.mockResolvedValue({ household: NEW_HH });
    mockActivateLocal.mockResolvedValue(undefined);
    mockRemoveLocal.mockResolvedValue(undefined);
    mockRename.mockResolvedValue({ ...HH_A, name: 'Renamed' });
    // Shared by default, so the server half of leaving is exercised unless a
    // test says the household was never on the control plane.
    mockIsOnControlPlane.mockResolvedValue(true);
    mockLeaveHousehold.mockResolvedValue({ devices: [], keyEpoch: 2 });
  });

  it('publishes the household list from the engine, never from D1', async () => {
    await renderScreen();

    expect(mockSyncStore).toHaveBeenCalled();
    // `fetchHouseholds()` collapses `households` to the ACTIVE ledger's single
    // household — the refresh that used to delete a just-created household from
    // the list moments after it appeared. A cold household's name and role are
    // already in the session registry, so publishing from the engine decrypts
    // nothing and needs no network.
    expect(mockStoreActions.fetchHouseholds).not.toHaveBeenCalled();
  });

  it('offers Add again, and hands the create to the household form', async () => {
    const tree = await renderScreen();

    // The interim single-household build hid this FAB. Multi-household is what
    // it was hidden for.
    expect(tree.root.findAllByProps({ testID: 'fab-add-household' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'fab-add-household' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholdEdit');
    // Neither backend is written from this screen any more — the form owns the
    // whole create, engine included.
    expect(mockCreateLocal).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('switches by activating the engine session, not by assigning the store', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: `household-switch-${HH_B.id}` }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(mockActivateLocal).toHaveBeenCalledWith(HH_B.id);
    // Assigning `currentHousehold` on its own leaves every local domain facade
    // called with an id the engine never activated, and they throw on that
    // mismatch: Savings, Mortgage and Loans render empty over data that is on
    // disk, decrypted, one id away.
    expect(mockStoreActions.setCurrentHousehold).not.toHaveBeenCalled();
    expect(mockSyncStore).toHaveBeenCalled();
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it('opens a background household without activating it', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: `household-card-${HH_B.id}` }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    // `BudgetHouseholdEdit` is ADDRESSED: name, photo, address and removal all
    // take the household id, so a household the engine has not activated can be
    // opened and edited without moving the member's budget out from under them.
    // Only the member roster needs the active session, and that screen offers
    // switching as a button rather than performing it behind a tap.
    expect(mockNavigate).toHaveBeenCalledWith('BudgetHouseholdEdit', {
      householdId: HH_B.id,
    });
    expect(mockActivateLocal).not.toHaveBeenCalled();
  });

  it('translates an unknown household into something the member can act on', async () => {
    // A card showing a household this device holds no ledger for — a row left
    // behind by a sign-out, or an id held across a switch. "No local ledger for
    // household hh_local_b2 on this device" names nothing they can do.
    mockActivateLocal.mockRejectedValueOnce(new BudgetLocalUnknownHouseholdError(HH_B.id));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: `household-switch-${HH_B.id}` }).props.onPress();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      expect.stringContaining('no longer holds that household')
    );
  });

  it('leaks no engine call into the legacy remote path', async () => {
    mockLocalFirst = false;
    mockSessionOpen = false;
    mockHouseholds = [HH_ACTIVE];
    mockCurrentHousehold = HH_ACTIVE;

    const tree = await renderScreen();

    expect(tree.root.findAllByProps({ testID: 'fab-add-household' }).length).toBeGreaterThan(0);
    expect(mockCreateLocal).not.toHaveBeenCalled();
    expect(mockActivateLocal).not.toHaveBeenCalled();
    expect(mockRemoveLocal).not.toHaveBeenCalled();
  });
});

/**
 * What a card is allowed to claim about who shares a budget.
 *
 * The rule: only the control plane knows, and only for the household this
 * device holds a ledger for. Everything else says nothing rather than
 * repeating a server count that has been wrong on screen.
 */
describe('householdSubtitle', () => {
  it('counts enrolled devices for the active household', () => {
    expect(householdSubtitle({ my_role: 'owner' }, true, 2)).toBe('2 devices • owner');
    expect(householdSubtitle({ my_role: 'member' }, true, 1)).toBe('1 device • member');
  });

  it('says nothing about size until the control plane has answered', () => {
    // A count that might be wrong is worse than no count — this is the state
    // during the fetch, and after it fails.
    expect(householdSubtitle({ my_role: 'owner' }, true, null)).toBe('owner');
  });

  it('never guesses at a household this device holds no ledger for', () => {
    expect(householdSubtitle({ my_role: 'member' }, false, 4)).toBe('member');
  });

  it('degrades to the count alone when the role is unknown', () => {
    // A household row that arrived without a role — the count is still true.
    expect(householdSubtitle({ my_role: undefined as never }, true, 3)).toBe('3 devices');
  });
});
