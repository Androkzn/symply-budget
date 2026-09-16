/**
 * SymplyAppsScreen — the "Get the Symply apps" grid. Renders the REAL screen
 * (House baseline) and asserts it lists the other four apps with install status,
 * routes an install to the store / manual-confirm to the data-sharing step, and
 * reflects an existing consent as "Connected".
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import SymplyAppsScreen from '../index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  // Run the focus effect immediately, like a mounted+focused screen.
  useFocusEffect: (cb: () => void) => {
    const ReactMock = require('react');
    ReactMock.useEffect(() => cb(), []);
  },
}));

const mockListConsents = jest.fn();
jest.mock('@api/smart-engine', () => ({
  smartEngineApi: {
    listConsents: () => mockListConsents(),
  },
}));

// canOpenURL → false for every sibling, so all start "Not installed". Exposed
// both flat and under `default` — react-native's index.js getter reads
// `.default`, while this file's assertions `require` the module directly.
jest.mock('react-native/Libraries/Linking/Linking', () => {
  const mock = {
    canOpenURL: jest.fn().mockResolvedValue(false),
    openURL: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  return { ...mock, default: mock };
});

// Keep the branded scaffold out of the way — just render its children.
jest.mock('@components/ai/AIFlowScaffold', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AIFlowScaffold: ({ children, screenTestID }: { children?: React.ReactNode; screenTestID?: string }) =>
      ReactMock.createElement(View, { testID: screenTestID }, children),
  };
});

function press(root: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = root.root.findAll(
    (n) => n.props.testID === testID && typeof n.props.onPress === 'function',
  )[0];
  act(() => node.props.onPress());
}

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      React.createElement(ThemeProvider, null, React.createElement(SymplyAppsScreen)),
    );
  });
  return tree;
}

describe('SymplyAppsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListConsents.mockResolvedValue([]);
  });

  it('lists the four sibling apps (House baseline)', async () => {
    const tree = render();
    await act(async () => {
      await Promise.resolve();
    });
    for (const id of ['symply-budget', 'symply-kaizen', 'symply-language', 'symply-health']) {
      expect(
        tree.root.findAll((n) => n.props.testID === `sibling-app-${id}`).length,
      ).toBeGreaterThanOrEqual(1);
    }
    // The active House app is not listed.
    expect(tree.root.findAll((n) => n.props.testID === 'sibling-app-symply-house').length).toBe(0);
  });

  it('confirming a Budget install routes to the data-sharing step', async () => {
    const tree = render();
    await act(async () => {
      await Promise.resolve();
    });
    press(tree, 'already-installed-symply-budget');
    expect(mockPush).toHaveBeenCalledWith('/symply-apps/share?app=symply-budget');
  });

  it('shows an Open button and launches the sibling app once installed', async () => {
    const tree = render();
    await act(async () => {
      await Promise.resolve();
    });
    press(tree, 'already-installed-symply-budget');
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      tree.root.findAll(
        (n) => n.props.testID === 'open-symply-budget' && typeof n.props.onPress === 'function',
      ).length,
    ).toBeGreaterThanOrEqual(1);
    press(tree, 'open-symply-budget');
    const { openURL } = require('react-native/Libraries/Linking/Linking');
    expect(openURL).toHaveBeenCalledWith('simplebudget://');
  });

  it('shows "Connected" when an active profile consent already exists', async () => {
    mockListConsents.mockResolvedValue([
      {
        id: 'c1',
        package_id: 'profile.core.v1',
        source_brand_id: 'symply-house',
        destination_brand_id: 'symply-budget',
        status: 'active',
      },
    ]);
    const tree = render();
    await act(async () => {
      await Promise.resolve();
    });
    // Budget shows Connected; no other app does.
    expect(
      tree.root.findAll((n) => n.props.testID === 'app-status-connected').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      tree.root.findAll((n) => n.props.testID === 'share-symply-budget').length,
    ).toBe(0);
  });
});
