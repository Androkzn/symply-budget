/**
 * PensionView — Budget → Pension tab container.
 *
 * Asserts the sub-tab set is Room, Goals, Accounts IN THAT ORDER (Room first) and that
 * the default sub-tab (Room) renders. Child sub-views are stubbed; FilterTabs is captured.
 */

let capturedTabs: { id: string; label: string }[] = [];
jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  return {
    ...actual,
    FilterTabs: (props: { tabs: { id: string; label: string }[] }) => {
      capturedTabs = props.tabs;
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

jest.mock('@stores/pensionStore', () => {
  const state = {
    selectedYear: 2026,
    activeSubTab: 'room',
    setActiveSubTab: jest.fn(),
    setSelectedYear: jest.fn(),
  };
  const usePensionStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { usePensionStore };
});

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

describe('PensionView', () => {
  it('exposes Room, Goals, Contributions sub-tabs in order (Room first, no Accounts) and defaults to Room', async () => {
    const tree = await renderView();

    expect(capturedTabs.map((t) => t.id)).toEqual(['room', 'goals', 'contributions']);
    expect(capturedTabs.map((t) => t.label)).toEqual(['Room', 'Goals', 'Contributions']);
    // Account setup is disabled in the UI — no Accounts tab.
    expect(capturedTabs.some((t) => t.id === 'accounts')).toBe(false);
    // Default sub-tab renders the Room view.
    expect(tree.root.findAllByProps({ testID: 'stub-room' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'stub-goals' }).length).toBe(0);
  });

  it('honors a `?tab=<sub>` deep link by switching the active sub-tab', async () => {
    const { usePensionStore } = require('@stores/pensionStore');
    usePensionStore().setActiveSubTab.mockClear();
    // Spy on the module the SCREEN reads — require(), not `import * as`. The
    // namespace form runs through babel's `_interopRequireWildcard`, which hands
    // back a COPY of the CJS mock object; spying on that copy leaves PensionView's
    // `_expoRouter.…` binding pointing at the original and the deep link silently
    // never fires (this test failed that way).
    const spy = jest
      .spyOn(require('expo-router'), 'useLocalSearchParams')
      .mockReturnValue({ tab: 'contributions' });

    await renderView();

    expect(usePensionStore().setActiveSubTab).toHaveBeenCalledWith('contributions');
    spy.mockRestore();
  });
});
