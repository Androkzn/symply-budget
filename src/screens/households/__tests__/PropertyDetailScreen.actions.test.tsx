/**
 * PropertyDetailScreen — header "…" actions menu.
 *
 * Set active / Edit details / Delete-or-Leave used to be buttons in the hero
 * card; they now live behind the header menu, which makes the menu the ONLY
 * route to a destructive call. These tests drive the real screen through that
 * menu: which rows it offers (role- and active-dependent), and what each row
 * actually does. Only native boundaries are mocked (Alert/ActionSheetIOS, the
 * households API, the store, the tab bodies).
 */

jest.mock('expo-router/react-navigation', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => React.createElement(View, props) };
});

// ScreenHeader stub surfaces the rightElement so the "…" button is pressable.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ rightElement }: { rightElement?: React.ReactNode }) =>
      React.createElement(View, { testID: 'screen-header' }, rightElement ?? null),
  };
});

const mockGetPropertyInsights = jest.fn();
jest.mock('@features/utilities/api/utilities', () => ({
  utilitiesApi: { getPropertyInsights: (...a: unknown[]) => mockGetPropertyInsights(...a) },
}));

const mockDelete = jest.fn();
const mockLeave = jest.fn();
jest.mock('@api/households', () => ({
  householdsApi: {
    delete: (...a: unknown[]) => mockDelete(...a),
    leave: (...a: unknown[]) => mockLeave(...a),
  },
}));

const mockRefreshActivePropertyData = jest.fn();
jest.mock('@contexts/DataContext', () => ({
  useData: () => ({ refreshActivePropertyData: mockRefreshActivePropertyData }),
}));

const mockSetCurrentHousehold = jest.fn();
const mockRemoveHousehold = jest.fn();
let mockStoreState: {
  households: Array<Record<string, unknown>>;
  currentHousehold: Record<string, unknown> | null;
};
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({
    ...mockStoreState,
    setCurrentHousehold: mockSetCurrentHousehold,
    removeHousehold: mockRemoveHousehold,
  }),
}));

// The tab bodies each pull in their own API/feature tree; none of them is under
// test here.
jest.mock('../property-tabs/PropertyOverviewTab', () => ({ PropertyOverviewTab: () => null }));
jest.mock('../property-tabs/PropertyTaxTab', () => ({ PropertyTaxTab: () => null }));
jest.mock('../property-tabs/PropertyAssessmentTab', () => ({ PropertyAssessmentTab: () => null }));
jest.mock('../property-tabs/PropertyMembersTab', () => ({ PropertyMembersTab: () => null }));

import React from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PropertyDetailScreen } from '../PropertyDetailScreen';

const HID = 'hh-1';

function makeHousehold(overrides: Record<string, unknown> = {}) {
  return {
    id: HID,
    name: 'Andrei',
    my_role: 'owner',
    member_count: 1,
    photo_url: null,
    address_line1: '1 Elm St',
    city: 'Calgary',
    state_province: 'AB',
    ...overrides,
  };
}

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockPopTo = jest.fn();

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PropertyDetailScreen
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          navigation={{ goBack: mockGoBack, navigate: mockNavigate, popTo: mockPopTo } as any}
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          route={{ params: { householdId: HID } } as any}
        />
      </ThemeProvider>
    );
  });
  await flush();
  renderers.push(tree);
  return tree;
}

/** Press the header "…" and return the labels the menu offered. */
async function openMenu(tree: ReactTestRenderer.ReactTestRenderer): Promise<string[]> {
  await act(async () => {
    tree.root.findByProps({ testID: 'property-detail-menu' }).props.onPress();
  });
  if (Platform.OS === 'ios') {
    const [options] = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1)!;
    return options.options as string[];
  }
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  return (buttons as Array<{ text: string }>).map((b) => b.text);
}

/** Invoke the menu row with the given label. */
async function pressMenuRow(label: string) {
  if (Platform.OS === 'ios') {
    const [options, callback] = (
      ActionSheetIOS.showActionSheetWithOptions as jest.Mock
    ).mock.calls.at(-1)!;
    const index = (options.options as string[]).indexOf(label);
    expect(index).toBeGreaterThanOrEqual(0);
    await act(async () => {
      callback(index);
    });
    return;
  }
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  const button = (buttons as Array<{ text: string; onPress?: () => void }>).find(
    (b) => b.text === label
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.onPress?.();
  });
}

/** Confirm the most recent destructive Alert by pressing its non-cancel button. */
async function confirmAlert(label: string) {
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  const button = (buttons as Array<{ text: string; onPress?: () => void }>).find(
    (b) => b.text === label
  );
  expect(button).toBeDefined();
  await act(async () => {
    await button!.onPress?.();
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPropertyInsights.mockResolvedValue(null);
  mockDelete.mockResolvedValue(undefined);
  mockLeave.mockResolvedValue(undefined);
  mockRefreshActivePropertyData.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation(() => undefined);
  mockStoreState = { households: [makeHousehold()], currentHousehold: makeHousehold() };
});

afterEach(() => {
  act(() => {
    renderers.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* already gone */
      }
    });
  });
  renderers.length = 0;
  jest.restoreAllMocks();
});

describe('PropertyDetailScreen header actions', () => {
  it('omits "Set active" for the property that is already active', async () => {
    const tree = await renderScreen();
    expect(await openMenu(tree)).toEqual(
      expect.arrayContaining(['Edit details', 'Delete property'])
    );
    expect(await openMenu(tree)).not.toContain('Set active');
  });

  it('offers "Set active" for a non-active property and switches to it', async () => {
    mockStoreState = {
      households: [makeHousehold(), makeHousehold({ id: 'hh-2', name: 'Cabin' })],
      currentHousehold: makeHousehold({ id: 'hh-2', name: 'Cabin' }),
    };
    const tree = await renderScreen();

    expect(await openMenu(tree)).toContain('Set active');
    await pressMenuRow('Set active');
    await flush();

    expect(mockSetCurrentHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ id: HID })
    );
    expect(mockRefreshActivePropertyData).toHaveBeenCalled();
  });

  it('shows a "Set active" button on the hero of a non-active property and switches to it', async () => {
    mockStoreState = {
      households: [makeHousehold(), makeHousehold({ id: 'hh-2', name: 'Cabin' })],
      currentHousehold: makeHousehold({ id: 'hh-2', name: 'Cabin' }),
    };
    const tree = await renderScreen();

    const button = tree.root.findByProps({ testID: 'property-detail-set-active' });
    await act(async () => {
      button.props.onPress();
    });
    await flush();

    expect(mockSetCurrentHousehold).toHaveBeenCalledWith(expect.objectContaining({ id: HID }));
    expect(mockRefreshActivePropertyData).toHaveBeenCalled();
  });

  it('hides the hero "Set active" button once the property is the active one', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'property-detail-set-active' })).toHaveLength(0);
  });

  it('routes "Edit details" to the household editor', async () => {
    const tree = await renderScreen();
    await openMenu(tree);
    await pressMenuRow('Edit details');

    expect(mockNavigate).toHaveBeenCalledWith('HouseholdManagement', {
      editHouseholdId: HID,
    });
  });

  it('deletes the property for an owner, drops the row and lands on My Properties', async () => {
    mockStoreState = {
      households: [makeHousehold(), makeHousehold({ id: 'hh-2', name: 'Cabin' })],
      currentHousehold: makeHousehold(),
    };
    const tree = await renderScreen();

    await openMenu(tree);
    await pressMenuRow('Delete property');
    await confirmAlert('Delete');

    expect(mockDelete).toHaveBeenCalledWith(HID);
    expect(mockLeave).not.toHaveBeenCalled();
    expect(mockRemoveHousehold).toHaveBeenCalledWith(HID);
    // Active slot handed to the survivor before we leave.
    expect(mockSetCurrentHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'hh-2' })
    );
    expect(mockPopTo).toHaveBeenCalledWith('HouseholdManagement');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('still leaves for My Properties when the survivor refresh fails', async () => {
    mockStoreState = {
      households: [makeHousehold(), makeHousehold({ id: 'hh-2', name: 'Cabin' })],
      currentHousehold: makeHousehold(),
    };
    mockRefreshActivePropertyData.mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const tree = await renderScreen();

    await openMenu(tree);
    await pressMenuRow('Delete property');
    await confirmAlert('Delete');

    expect(mockRemoveHousehold).toHaveBeenCalledWith(HID);
    expect(mockPopTo).toHaveBeenCalledWith('HouseholdManagement');
    // A failed refresh is not an error the user has to acknowledge here.
    expect(Alert.alert).not.toHaveBeenCalledWith('Error', expect.anything());
  });

  it('leaves for My Properties when the property vanishes from the store', async () => {
    const tree = await renderScreen();
    expect(mockPopTo).not.toHaveBeenCalled();

    // Deleting the LAST property empties the store — the case that used to
    // strand the user on a nameless, memberless screen.
    mockStoreState = { households: [], currentHousehold: null };
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <PropertyDetailScreen
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            navigation={{ goBack: mockGoBack, navigate: mockNavigate, popTo: mockPopTo } as any}
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            route={{ params: { householdId: HID } } as any}
          />
        </ThemeProvider>
      );
    });
    await flush();

    expect(mockPopTo).toHaveBeenCalledWith('HouseholdManagement');
  });

  it('offers Leave (not Delete) for a member, and calls the leave endpoint', async () => {
    mockStoreState = {
      households: [makeHousehold({ my_role: 'member' })],
      currentHousehold: makeHousehold({ my_role: 'member' }),
    };
    const tree = await renderScreen();

    const labels = await openMenu(tree);
    expect(labels).toContain('Leave property');
    expect(labels).not.toContain('Delete property');

    await pressMenuRow('Leave property');
    await confirmAlert('Leave');

    expect(mockLeave).toHaveBeenCalledWith(HID);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockPopTo).toHaveBeenCalledWith('HouseholdManagement');
  });

  it('keeps the screen when the delete call fails', async () => {
    mockDelete.mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const tree = await renderScreen();

    await openMenu(tree);
    await pressMenuRow('Delete property');
    await confirmAlert('Delete');

    expect(mockRemoveHousehold).not.toHaveBeenCalled();
    expect(mockPopTo).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'offline');
  });
});
