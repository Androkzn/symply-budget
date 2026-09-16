/**
 * PensionView — coverage sibling.
 *
 * Exercises the interactive/branch surface the primary suite leaves out (uncovered
 * lines 37-58): the year stepper handlers, the FilterTabs `onTabChange` handler, and
 * the render of every sub-tab branch (goals / contributions / accounts) — accounts is
 * retained in code but not surfaced as a tab, so it can only be hit by state.
 */

// FilterTabs is stubbed but we keep a handle on its `onTabChange` so we can drive the
// sub-tab switch (line 58) without a real tab-bar press.
let capturedOnTabChange: ((id: string) => void) | undefined;
jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  return {
    ...actual,
    FilterTabs: (props: { onTabChange: (id: string) => void }) => {
      capturedOnTabChange = props.onTabChange;
      return null;
    },
  };
});

jest.mock('../PensionRoomView', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { PensionRoomView: () => React.createElement(Text, { testID: 'stub-room' }, 'room') };
});
jest.mock('../PensionGoalsView', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { PensionGoalsView: () => React.createElement(Text, { testID: 'stub-goals' }, 'goals') };
});
jest.mock('../PensionContributionsView', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    PensionContributionsView: () =>
      React.createElement(Text, { testID: 'stub-contributions' }, 'contributions'),
  };
});
jest.mock('../PensionAccountsView', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    PensionAccountsView: () => React.createElement(Text, { testID: 'stub-accounts' }, 'accounts'),
  };
});

const mockSetActiveSubTab = jest.fn();
const mockSetSelectedYear = jest.fn();
const mockPensionState: {
  selectedYear: number;
  activeSubTab: string;
  setActiveSubTab: jest.Mock;
  setSelectedYear: jest.Mock;
} = {
  selectedYear: 2026,
  activeSubTab: 'room',
  setActiveSubTab: mockSetActiveSubTab,
  setSelectedYear: mockSetSelectedYear,
};
jest.mock('@stores/pensionStore', () => ({
  usePensionStore: (selector?: (s: typeof mockPensionState) => unknown) =>
    selector ? selector(mockPensionState) : mockPensionState,
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PensionView } from '../PensionView';

async function renderView() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionView />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedOnTabChange = undefined;
  mockPensionState.selectedYear = 2026;
  mockPensionState.activeSubTab = 'room';
});

describe('PensionView (coverage)', () => {
  it('steps the year backward and forward via the year arrows', async () => {
    const tree = await renderView();

    await act(async () => {
      tree.root.findByProps({ testID: 'pension-year-prev' }).props.onPress();
    });
    expect(mockSetSelectedYear).toHaveBeenLastCalledWith(2025);

    await act(async () => {
      tree.root.findByProps({ testID: 'pension-year-next' }).props.onPress();
    });
    expect(mockSetSelectedYear).toHaveBeenLastCalledWith(2027);
    expect(mockSetSelectedYear).toHaveBeenCalledTimes(2);
  });

  it('forwards the FilterTabs selection to setActiveSubTab', async () => {
    await renderView();
    expect(capturedOnTabChange).toBeInstanceOf(Function);

    await act(async () => capturedOnTabChange?.('goals'));
    expect(mockSetActiveSubTab).toHaveBeenCalledWith('goals');
  });

  it('renders the Goals sub-view when Goals is active', async () => {
    mockPensionState.activeSubTab = 'goals';
    const tree = await renderView();

    expect(tree.root.findAllByProps({ testID: 'stub-goals' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'stub-room' }).length).toBe(0);
  });

  it('renders the Contributions sub-view when Contributions is active', async () => {
    mockPensionState.activeSubTab = 'contributions';
    const tree = await renderView();

    expect(tree.root.findAllByProps({ testID: 'stub-contributions' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'stub-room' }).length).toBe(0);
  });

  it('renders the retained (untabbed) Accounts sub-view when accounts is active', async () => {
    mockPensionState.activeSubTab = 'accounts';
    const tree = await renderView();

    expect(tree.root.findAllByProps({ testID: 'stub-accounts' }).length).toBeGreaterThan(0);
  });
});
