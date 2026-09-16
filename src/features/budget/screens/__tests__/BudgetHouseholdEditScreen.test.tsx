/**
 * BudgetHouseholdEditScreen — one household's own page.
 *
 * The screen that replaced a swipe action. It is BOTH the edit form and the
 * create form (no `householdId` in the route params means create), and it runs
 * over the same two backends as the rest of Budget's household surface: the
 * local-first engine, where the record lives in this device's sealed identity
 * blob and the photo's bytes live in `documentDirectory`, and the legacy remote
 * path, where both are server writes.
 *
 * What is actually asserted here is the routing: which function a save reached,
 * with which household id, and carrying which fields. Every bug this surface has
 * produced has been of that shape — a rename that went to the active household
 * instead of the one on the card, a create that wrote a D1 row the engine never
 * learned about, a photo deleted by a save that only meant to change a name.
 *
 * The presentational leaves are stubbed to plain RN primitives, EXCEPT
 * `AddressFields`, which is the real component: the address is half of what this
 * screen was built for, and a stubbed one would let a test pass over a form that
 * never wired its fields up.
 */

// --- Presentational leaves -> plain primitives -----------------------------
type MockChildren = { children?: unknown };

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: MockChildren) => React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children, testID }: MockChildren & { testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
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
        React.createElement(Text, { key: 't' }, title ?? null),
        React.createElement(TouchableOpacity, { key: 'b', testID: 'header-back', onPress: onBackPress }),
        React.createElement(View, { key: 'r' }, rightElement ?? null),
      ]),
    HeaderActionButton: ({
      label,
      onPress,
      disabled,
      testID,
    }: {
      label?: string;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement(
        TouchableOpacity,
        { testID, onPress, disabled, accessibilityState: { disabled: !!disabled } },
        React.createElement(Text, null, label ?? null),
      ),
    screenScrollEndTestId: (root: string) => `${root}-scroll-end`,
    ScreenScrollEnd: ({ testID }: { testID?: string }) => React.createElement(View, { testID }),
    /**
     * Stand-in for the shared Camera · Gallery · File · Drive sheet.
     *
     * It renders one tile per source and runs the same tile → picker →
     * `onPicked` chain the real sheet does, so `mockOpenPicker` still decides
     * what gets picked and these cases keep asserting what this screen does
     * with it. What the real four sources DO is `useAttachmentSources`' own
     * suite; this screen only has to hand them a destination.
     */
    AttachmentSourceSheet: ({
      visible,
      onPicked,
      extraAction,
      testIDPrefix,
    }: {
      visible?: boolean;
      onPicked?: (items: Array<{ uri: string }>, source: string) => void;
      extraAction?: { onPress: () => void; testID?: string };
      testIDPrefix?: string;
    }) => {
      if (!visible) return null;
      // `mockOpenPicker` / `mockOpenCamera` by closure, the same way the
      // picker module's own factory reaches them: the arrows below run at
      // press time, long after those consts are initialised.
      const tile = (source: string, open: () => Promise<{ path: string }>) =>
        React.createElement(TouchableOpacity, {
          key: source,
          testID: `${testIDPrefix}-${source}`,
          onPress: async () => {
            const image = await open();
            onPicked?.([{ uri: image.path }], source);
          },
        });
      return React.createElement(View, { testID: `${testIDPrefix}-sheet` }, [
        tile('camera', () => mockOpenCamera({})),
        tile('gallery', () => mockOpenPicker({})),
        extraAction
          ? React.createElement(TouchableOpacity, {
              key: 'extra',
              testID: extraAction.testID ?? `${testIDPrefix}-extra`,
              onPress: extraAction.onPress,
            })
          : null,
      ]);
    },
  };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity, TextInput: RNTextInput } = require('react-native');
  return {
    __esModule: true,
    Card: ({ children }: MockChildren) => React.createElement(View, null, children ?? null),
    Typography: ({ children }: MockChildren) => React.createElement(Text, null, children ?? null),
    GradientButton: ({ title, onPress, testID }: { title?: string; onPress?: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { testID, onPress }, React.createElement(Text, null, title ?? null)),
    TextInput: ({ label, testID, ...rest }: { label?: string; testID?: string }) =>
      React.createElement(View, null, [
        React.createElement(Text, { key: 'l' }, label ?? null),
        React.createElement(RNTextInput, { key: 'i', testID, ...rest }),
      ]),
    // The wheel is a sheet; the test only needs a handle on its commit.
    OptionWheelPickerSheet: ({
      onConfirm,
      testID,
    }: {
      onConfirm?: (value: string) => void;
      testID?: string;
    }) => React.createElement(View, { testID, onConfirm }),
  };
});

jest.mock('@components/ui/Icon', () => ({ __esModule: true, Icon: () => null }));

// No key in the test bundle, so `AddressFields` renders its plain-field path —
// which is the path a clone without `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` gets.
// Stubbed anyway so the library is never loaded here.
jest.mock('react-native-google-places-autocomplete', () => ({
  __esModule: true,
  GooglePlacesAutocomplete: () => null,
}));

// The roster is the ACTIVE household's, published from the control plane. Its
// own suite covers it; here it only has to be distinguishable from absent.
jest.mock('@features/budget/components/BudgetHouseholdMembersCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BudgetHouseholdMembersCard: () => React.createElement(View, { testID: 'members-card' }),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams: { current: { householdId?: string } | undefined } = { current: undefined };
jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

const mockRefreshAll = jest.fn().mockResolvedValue(undefined);
jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ refreshAll: mockRefreshAll, refreshActivePropertyData: mockRefreshAll }),
}));

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

const mockApiCreate = jest.fn();
const mockApiUpdate = jest.fn();
const mockApiDelete = jest.fn();
const mockApiLeave = jest.fn();
const mockApiUploadPhoto = jest.fn();
const mockApiDeletePhoto = jest.fn();
jest.mock('@api/households', () => ({
  __esModule: true,
  householdsApi: {
    create: (...a: unknown[]) => mockApiCreate(...a),
    update: (...a: unknown[]) => mockApiUpdate(...a),
    delete: (...a: unknown[]) => mockApiDelete(...a),
    leave: (...a: unknown[]) => mockApiLeave(...a),
    uploadPhoto: (...a: unknown[]) => mockApiUploadPhoto(...a),
    deletePhoto: (...a: unknown[]) => mockApiDeletePhoto(...a),
  },
}));

let mockLocalFirst = true;
jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

const mockUpdateLocal = jest.fn();
const mockCreateLocal = jest.fn();
const mockActivateLocal = jest.fn();
const mockRemoveLocal = jest.fn();
jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  updateLocalHousehold: (...a: unknown[]) => mockUpdateLocal(...a),
  createLocalBudgetHousehold: (...a: unknown[]) => mockCreateLocal(...a),
  activateLocalBudgetHousehold: (...a: unknown[]) => mockActivateLocal(...a),
  removeLocalBudgetHousehold: (...a: unknown[]) => mockRemoveLocal(...a),
}));

const mockSyncStore = jest.fn();
jest.mock('@features/budget/local/ensureSession', () => ({
  __esModule: true,
  syncHouseholdStoreFromLocalLedger: () => mockSyncStore(),
}));

const mockSyncControlPlane = jest.fn().mockResolvedValue(undefined);
const mockIsOnControlPlane = jest.fn().mockResolvedValue(true);
const mockLeaveHousehold = jest.fn().mockResolvedValue({ devices: [], keyEpoch: 2 });
jest.mock('@features/budget/local/controlPlaneClient', () => ({
  __esModule: true,
  syncLocalHouseholdToControlPlane: (...a: unknown[]) => mockSyncControlPlane(...a),
  budgetHouseholdIsOnControlPlane: (...a: unknown[]) => mockIsOnControlPlane(...a),
  leaveBudgetHousehold: (...a: unknown[]) => mockLeaveHousehold(...a),
}));

const mockSaveImage = jest.fn();
const mockDeleteImage = jest.fn();
jest.mock('@features/budget/local/householdMedia', () => ({
  __esModule: true,
  saveHouseholdImageLocal: (...a: unknown[]) => mockSaveImage(...a),
  deleteHouseholdImageLocal: (...a: unknown[]) => mockDeleteImage(...a),
  resolveHouseholdImageUri: (key: string | null) =>
    key ? `file:///documents/household-images/${key.split('/').pop()}` : null,
}));

const mockOpenPicker = jest.fn();
const mockOpenCamera = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openPicker: (...a: unknown[]) => mockOpenPicker(...a),
    openCamera: (...a: unknown[]) => mockOpenCamera(...a),
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetHouseholdEditScreen } from '../BudgetHouseholdEditScreen';

const HH = {
  id: 'hh_local_a1',
  name: 'Sweet Home',
  address_line1: null,
  address_line2: null,
  city: null,
  state_province: null,
  postal_code: null,
  country: null,
  photo_key: null,
  photo_url: null,
  member_count: 3,
  my_role: 'owner' as const,
};

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      React.createElement(ThemeProvider, null, React.createElement(BudgetHouseholdEditScreen)),
    );
  });
  return tree;
}

/** Type into a field and press Save, flushing the async save. */
async function save(tree: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByProps({ testID: 'household-save-btn' }).props.onPress();
  });
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => {
    tree.root.findByProps({ testID }).props.onChangeText(text);
  });
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalFirst = true;
  mockHouseholds = [{ ...HH }];
  mockCurrentHousehold = { ...HH };
  mockRouteParams.current = { householdId: HH.id };
  mockUpdateLocal.mockResolvedValue({ ...HH, name: 'Sweet Home' });
  mockCreateLocal.mockResolvedValue({ household: { id: 'hh_local_new' } });
  mockActivateLocal.mockResolvedValue(undefined);
  mockRemoveLocal.mockResolvedValue(undefined);
  mockSaveImage.mockResolvedValue('households/local/deadbeef.jpg');
  mockApiUpdate.mockResolvedValue({ household: { ...HH, name: 'Renamed' } });
  mockApiCreate.mockResolvedValue({ household: { ...HH, id: 'hh_remote' } });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Local-first — edit
// ---------------------------------------------------------------------------

describe('local-first: editing a household', () => {
  it('saves the name against THAT household id, not the active session', async () => {
    // A background household: the id is what makes this assertion meaningful.
    mockCurrentHousehold = { ...HH, id: 'hh_local_other', name: 'Other' };
    mockHouseholds = [{ ...HH }, mockCurrentHousehold];
    const tree = render();

    type(tree, 'household-name-input', 'Beach House');
    await save(tree);

    expect(mockUpdateLocal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Beach House' }),
      HH.id,
    );
    expect(mockApiUpdate).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('writes the address the member typed', async () => {
    const tree = render();

    type(tree, 'household-address-line1', '742 Evergreen Terrace');
    type(tree, 'household-address-city', 'Springfield');
    type(tree, 'household-address-postal', 'V6B 1A1');
    await save(tree);

    expect(mockUpdateLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        address_line1: '742 Evergreen Terrace',
        city: 'Springfield',
        postal_code: 'V6B 1A1',
        country: 'CA',
      }),
      HH.id,
    );
  });

  it('clears an address to nulls — including the country', async () => {
    // A household that HAS an address; the member empties every field.
    mockHouseholds = [
      { ...HH, address_line1: '1 Main St', city: 'Toronto', state_province: 'ON', country: 'CA' },
    ];
    mockCurrentHousehold = mockHouseholds[0];
    const tree = render();

    type(tree, 'household-address-line1', '');
    type(tree, 'household-address-city', '');
    // The province is the wheel's, not a text field — "Not set" is its first
    // option, and an address is not empty while it still names one.
    act(() => {
      tree.root
        .findByProps({ testID: 'household-address-region-picker' })
        .props.onConfirm('');
    });
    await save(tree);

    const [edits] = mockUpdateLocal.mock.calls[0];
    expect(edits.address_line1).toBeNull();
    expect(edits.city).toBeNull();
    // A country with nothing else is not an address — it would render as a
    // household whose only address line reads "Canada".
    expect(edits.country).toBeNull();
  });

  it('refuses a blank name without touching the engine', async () => {
    const tree = render();
    type(tree, 'household-name-input', '   ');
    await save(tree);

    expect(mockUpdateLocal).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Name required', expect.any(String));
  });

  it('leaves the stored photo alone when only the name changed', async () => {
    mockHouseholds = [{ ...HH, photo_key: 'households/local/old.jpg' }];
    mockCurrentHousehold = mockHouseholds[0];
    const tree = render();

    type(tree, 'household-name-input', 'Renamed');
    await save(tree);

    const [edits] = mockUpdateLocal.mock.calls[0];
    // Not `photo_key: null` — an untouched photo and a removed one are different
    // saves, and collapsing them deletes a picture the member never touched.
    expect(edits).not.toHaveProperty('photo_key');
    expect(mockSaveImage).not.toHaveBeenCalled();
    expect(mockDeleteImage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Local-first — the photo
// ---------------------------------------------------------------------------

describe('local-first: the household photo', () => {
  /** Drive the shared source sheet the photo tile opens. */
  async function pickFromLibrary(tree: ReactTestRenderer.ReactTestRenderer) {
    act(() => {
      tree.root.findByProps({ testID: 'household-photo-picker' }).props.onPress();
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'budget-household-photo-gallery' })
        .props.onPress();
    });
  }

  it('copies a picked image into device storage and stores its key', async () => {
    mockOpenPicker.mockResolvedValue({ path: 'file:///tmp/picked.jpg' });
    const tree = render();

    await pickFromLibrary(tree);
    await save(tree);

    expect(mockSaveImage).toHaveBeenCalledWith('file:///tmp/picked.jpg');
    expect(mockUpdateLocal).toHaveBeenCalledWith(
      expect.objectContaining({ photo_key: 'households/local/deadbeef.jpg' }),
      HH.id,
    );
  });

  it('deletes the replaced file only after the record stops naming it', async () => {
    mockHouseholds = [{ ...HH, photo_key: 'households/local/old.jpg' }];
    mockCurrentHousehold = mockHouseholds[0];
    mockOpenPicker.mockResolvedValue({ path: 'file:///tmp/picked.jpg' });
    mockUpdateLocal.mockResolvedValue({ ...HH, photo_key: 'households/local/deadbeef.jpg' });
    const tree = render();

    await pickFromLibrary(tree);
    await save(tree);

    expect(mockUpdateLocal).toHaveBeenCalled();
    expect(mockDeleteImage).toHaveBeenCalledWith('households/local/old.jpg');
    expect(mockUpdateLocal.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteImage.mock.invocationCallOrder[0],
    );
  });

  it('records a removal as an explicit null', async () => {
    mockHouseholds = [{ ...HH, photo_key: 'households/local/old.jpg' }];
    mockCurrentHousehold = mockHouseholds[0];
    const tree = render();

    act(() => {
      tree.root.findByProps({ testID: 'household-photo-picker' }).props.onPress();
    });
    act(() => {
      tree.root
        .findByProps({ testID: 'budget-household-photo-remove' })
        .props.onPress();
    });
    await save(tree);

    expect(mockSaveImage).not.toHaveBeenCalled();
    expect(mockUpdateLocal).toHaveBeenCalledWith(
      expect.objectContaining({ photo_key: null, photo_url: null }),
      HH.id,
    );
  });

  it('offers Remove Photo only when there is one', () => {
    const tree = render();
    act(() => {
      tree.root.findByProps({ testID: 'household-photo-picker' }).props.onPress();
    });
    expect(
      tree.root.findAllByProps({ testID: 'budget-household-photo-remove' }),
    ).toHaveLength(0);
  });

  /**
   * The household photo reaches the same four sources as every other upload
   * surface. It shipped with Take Photo and Choose from Library, which left
   * out exactly the images a household photo usually IS — a listing shot or a
   * family picture that arrived from someone else.
   */
  it('offers the shared source sheet rather than a two-option alert', () => {
    const tree = render();
    act(() => {
      tree.root.findByProps({ testID: 'household-photo-picker' }).props.onPress();
    });
    expect(
      tree.root.findAllByProps({ testID: 'budget-household-photo-sheet' }).length,
    ).toBeGreaterThan(0);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Local-first — create
// ---------------------------------------------------------------------------

describe('local-first: creating a household', () => {
  beforeEach(() => {
    mockRouteParams.current = undefined;
  });

  it('mints it with the name, address and photo in ONE call, then activates', async () => {
    mockOpenPicker.mockResolvedValue({ path: 'file:///tmp/new.jpg' });
    const tree = render();

    type(tree, 'household-name-input', 'Trip Fund');
    type(tree, 'household-address-city', 'Vancouver');
    act(() => {
      tree.root.findByProps({ testID: 'household-photo-picker' }).props.onPress();
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'budget-household-photo-gallery' })
        .props.onPress();
    });
    await save(tree);

    expect(mockCreateLocal).toHaveBeenCalledWith({
      displayName: 'Trip Fund',
      details: expect.objectContaining({
        name: 'Trip Fund',
        city: 'Vancouver',
        photo_key: 'households/local/deadbeef.jpg',
      }),
    });
    // Creating does not activate in the engine; the screen does, because a
    // member who just named a household means to be in it.
    expect(mockActivateLocal).toHaveBeenCalledWith('hh_local_new');
    // The list is published from the engine's session registry, never appended
    // to row by row — that is what stopped a new household vanishing.
    expect(mockSyncStore).toHaveBeenCalled();
    expect(mockApiCreate).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows no members section and no danger zone before the household exists', () => {
    const tree = render();
    expect(tree.root.findAllByProps({ testID: 'members-card' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'household-destructive-btn' })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

describe('members', () => {
  it('shows the roster for the ACTIVE household', () => {
    const tree = render();
    expect(tree.root.findAllByProps({ testID: 'members-card' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'household-activate-btn' })).toHaveLength(0);
  });

  it('offers to switch instead of naming another household’s people', async () => {
    mockCurrentHousehold = { ...HH, id: 'hh_local_other', name: 'Other' };
    mockHouseholds = [{ ...HH }, mockCurrentHousehold];
    const tree = render();

    // The roster, the invite flow and every approval act on whichever household
    // the ENGINE has active, so showing it here would name the wrong people.
    expect(tree.root.findAllByProps({ testID: 'members-card' })).toHaveLength(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'household-activate-btn' }).props.onPress();
    });
    expect(mockActivateLocal).toHaveBeenCalledWith(HH.id);
    expect(mockSyncStore).toHaveBeenCalled();
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it('pushes Invite & Household from the manage row', () => {
    const tree = render();
    act(() => {
      tree.root.findByProps({ testID: `household-manage-members-${HH.id}` }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('BudgetInvite');
  });
});

// ---------------------------------------------------------------------------
// Delete / leave
// ---------------------------------------------------------------------------

describe('local-first: delete and leave', () => {
  /** Confirm whichever destructive Alert the screen just raised. */
  async function confirmDestructive() {
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const action = buttons.find((button) => button.text === 'Delete' || button.text === 'Leave');
    await act(async () => {
      await action?.onPress?.();
    });
  }

  it('refuses to remove the last household BEFORE asking to confirm', async () => {
    mockHouseholds = [{ ...HH }];
    const tree = render();

    act(() => {
      tree.root.findByProps({ testID: 'household-destructive-btn' }).props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'This is your only household',
      expect.stringContaining('always keeps one household open'),
    );
    // No confirmation was offered, so nothing can have been removed.
    expect(mockRemoveLocal).not.toHaveBeenCalled();
  });

  it('ends the membership before erasing this device’s copy', async () => {
    mockHouseholds = [{ ...HH }, { ...HH, id: 'hh_local_b' }];
    const tree = render();

    act(() => {
      tree.root.findByProps({ testID: 'household-destructive-btn' }).props.onPress();
    });
    await confirmDestructive();

    expect(mockLeaveHousehold).toHaveBeenCalledWith(HH.id);
    expect(mockRemoveLocal).toHaveBeenCalledWith(HH.id);
    expect(mockLeaveHousehold.mock.invocationCallOrder[0]).toBeLessThan(
      mockRemoveLocal.mock.invocationCallOrder[0],
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('does not erase anything when the membership could not be ended', async () => {
    mockHouseholds = [{ ...HH }, { ...HH, id: 'hh_local_b' }];
    mockLeaveHousehold.mockRejectedValueOnce({ response: { status: 500 } });
    const tree = render();

    act(() => {
      tree.root.findByProps({ testID: 'household-destructive-btn' }).props.onPress();
    });
    await confirmDestructive();

    expect(mockRemoveLocal).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Could not leave', expect.any(String));
  });

  it('says Leave, not Delete, for a member', () => {
    mockHouseholds = [{ ...HH, my_role: 'member' }, { ...HH, id: 'hh_local_b' }];
    mockCurrentHousehold = mockHouseholds[0];
    const tree = render();

    act(() => {
      tree.root.findByProps({ testID: 'household-destructive-btn' }).props.onPress();
    });
    expect(alertSpy.mock.calls[0][0]).toBe('Leave Household');
  });
});

// ---------------------------------------------------------------------------
// Remote path (local-first off)
// ---------------------------------------------------------------------------

describe('remote path', () => {
  beforeEach(() => {
    mockLocalFirst = false;
  });

  it('PATCHes the household and uploads the photo separately', async () => {
    mockOpenPicker.mockResolvedValue({ path: 'file:///tmp/picked.jpg' });
    const tree = render();

    type(tree, 'household-name-input', 'Renamed');
    act(() => {
      tree.root.findByProps({ testID: 'household-photo-picker' }).props.onPress();
    });
    await act(async () => {
      tree.root
        .findByProps({ testID: 'budget-household-photo-gallery' })
        .props.onPress();
    });
    await save(tree);

    expect(mockApiUpdate).toHaveBeenCalledWith(HH.id, expect.objectContaining({ name: 'Renamed' }));
    expect(mockApiUploadPhoto).toHaveBeenCalledWith(HH.id, 'file:///tmp/picked.jpg');
    // The photo is R2 on this path, not a file in `documentDirectory`.
    expect(mockSaveImage).not.toHaveBeenCalled();
    expect(mockUpdateLocal).not.toHaveBeenCalled();
  });

  it('creates through the households API', async () => {
    mockRouteParams.current = undefined;
    const tree = render();

    type(tree, 'household-name-input', 'Roommates');
    await save(tree);

    expect(mockApiCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Roommates' }));
    expect(mockCreateLocal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A household that went away
// ---------------------------------------------------------------------------

it('says so when the household is no longer on this device', () => {
  mockRouteParams.current = { householdId: 'hh_local_gone' };
  const tree = render();

  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain('no longer on this device');
  expect(tree.root.findAllByProps({ testID: 'household-name-input' })).toHaveLength(0);
});
