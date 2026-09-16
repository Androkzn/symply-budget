/**
 * PropertySwitcher — the "Manage Households" footer of the switch sheet.
 *
 * The sheet lists households; this row is the only way from it to the screen
 * that CHANGES one, so what it is wired to is the whole feature. Two managers
 * sit behind one label — full Budget has its own list in the Budget stack,
 * every other brand has `HouseholdManagement` in Settings — which is the fork
 * `SettingsNavigator` makes for the same route, and the fork asserted here.
 *
 * The navigation must also happen AFTER the sheet has animated away: it is a
 * full-screen Modal owned by this component, so a push fired at the start of
 * the dismissal lands under a sheet that is still on screen.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { Household } from '@api/households';
import { ThemeProvider } from '@contexts/ThemeContext';

import { PropertySwitcher } from '../PropertySwitcher';

// Only the two brand PREDICATES are swapped — `brand` itself stays real,
// because the theme reads its palette at module load (`src/theme/colors.ts`).
let mockIsHouseBrand = false;
let mockIsFullBudget = true;
jest.mock('@brand', () => {
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'isHouseBrand') return () => mockIsHouseBrand;
      if (prop === 'isFullBudget') return () => mockIsFullBudget;
      return Reflect.get(target, prop);
    },
  });
});

const mockNavigateToBudgetHouseholds = jest.fn();
const mockNavigateToHouseholds = jest.fn();
jest.mock('@services/navigation', () => ({
  navigateToBudgetHouseholds: () => mockNavigateToBudgetHouseholds(),
  navigateToHouseholds: () => mockNavigateToHouseholds(),
}));

// The engine is only reached by a ROW press (and only under local-first); this
// suite presses the footer, so the flag stays off and the module is never
// imported — stubbed anyway so a stray import can't pull SQLite into the run.
jest.mock('@features/budget/local/flag', () => ({ isBudgetLocalFirst: () => false }));

const households: Household[] = [
  { id: 'hh_1', name: 'Анастасия Техтелева' } as Household,
  { id: 'hh_2', name: 'Sweet Home' } as Household,
];

let mockStore = {
  households,
  currentHousehold: households[1],
  propertyMode: 'single' as 'single' | 'all',
  setCurrentHousehold: jest.fn(),
  setPropertyMode: jest.fn(),
};
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => mockStore,
}));

jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

async function openSheet(): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PropertySwitcher />
      </ThemeProvider>,
    );
  });
  await act(async () => {
    tree.root.findByProps({ testID: 'property-switcher-trigger' }).props.onPress();
  });
  return tree;
}

function pressManage(tree: Tree): void {
  act(() => {
    tree.root.findByProps({ testID: 'property-switcher-manage' }).props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockIsHouseBrand = false;
  mockIsFullBudget = true;
  mockStore = {
    households,
    currentHousehold: households[1],
    propertyMode: 'single',
    setCurrentHousehold: jest.fn(),
    setPropertyMode: jest.fn(),
  };
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PropertySwitcher — manage row', () => {
  it('names the destination in the brand\'s own vocabulary', async () => {
    const tree = await openSheet();
    expect(
      tree.root.findByProps({ testID: 'property-switcher-manage' }).props.accessibilityLabel,
    ).toBe('Manage Households');

    mockIsHouseBrand = true;
    const houseTree = await openSheet();
    expect(
      houseTree.root.findByProps({ testID: 'property-switcher-manage' }).props.accessibilityLabel,
    ).toBe('Manage Properties');
  });

  it('navigates full Budget to its own households list, once the sheet is gone', async () => {
    const tree = await openSheet();
    pressManage(tree);

    // Still mid-dismissal: navigating here would push under a visible sheet.
    expect(mockNavigateToBudgetHouseholds).not.toHaveBeenCalled();

    act(() => {
      jest.runAllTimers();
    });
    expect(mockNavigateToBudgetHouseholds).toHaveBeenCalledTimes(1);
    expect(mockNavigateToHouseholds).not.toHaveBeenCalled();
  });

  it('navigates every other brand to Settings → HouseholdManagement', async () => {
    mockIsFullBudget = false;
    mockIsHouseBrand = true;
    const tree = await openSheet();
    pressManage(tree);
    act(() => {
      jest.runAllTimers();
    });

    expect(mockNavigateToHouseholds).toHaveBeenCalledTimes(1);
    expect(mockNavigateToBudgetHouseholds).not.toHaveBeenCalled();
  });
});
