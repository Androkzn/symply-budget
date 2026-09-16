/**
 * `/budget-chat` route host — brand boundary for the forked Budget chat.
 *
 * Matrix: documents/engineering/testing/matrices/budget.md
 *   BUDGET-NAV-005 / 006
 */

let mockBrandId = 'symply-budget';

// The route gates on isBudgetBrand(); flip the brand through the feature
// helper rather than mutating env (brand id is baked at module load).
jest.mock('@features/budget', () => {
  const actual = jest.requireActual('@features/budget');
  return {
    ...actual,
    isBudgetBrand: () => mockBrandId === 'symply-budget',
    isFullBudget: () => mockBrandId === 'symply-budget',
  };
});

const mockRedirect = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    useLocalSearchParams: () => mockParams,
    Redirect: (props: { href: unknown }) => {
      mockRedirect(props.href);
      return React.createElement(View, { testID: 'redirect' });
    },
  };
});

// `expo-router/react-navigation` is mapped to `@react-navigation/native` by
// jest.config.js, so the container primitives are stubbed here.
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    NavigationIndependentTree: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'independent-tree' }, children),
    NavigationContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'navigation-container' }, children),
  };
});

jest.mock('@features/chat', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ChatNavigator: ({ initialParams }: Record<string, unknown>) =>
      React.createElement(View, { testID: 'budget-chat-navigator', initialParams }),
    budgetChatConfig: { id: 'budget' },
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import BudgetChatRoute from '../budget-chat';

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<BudgetChatRoute />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBrandId = 'symply-budget';
  mockParams = {};
});

describe('/budget-chat route', () => {
  it.each([
    ['symply-house'],
    ['symply-kaizen'],
    ['symply-language'],
    ['symply-health'],
  ])('BUDGET-NAV-005: redirects %s to "/" instead of mounting the chat stack', async brand => {
    mockBrandId = brand;
    const tree = await render();

    expect(mockRedirect).toHaveBeenCalledWith('/');
    expect(
      tree.root.findAllByProps({ testID: 'budget-chat-navigator' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'independent-tree' }),
    ).toHaveLength(0);
  });

  it('BUDGET-NAV-006: mounts BudgetChatNavigator inside a NavigationIndependentTree under Budget', async () => {
    const tree = await render();

    expect(mockRedirect).not.toHaveBeenCalled();

    const tree_ = tree.root.findByProps({ testID: 'independent-tree' });
    // Container nests inside the independent tree, navigator inside the container.
    const container = tree_.findByProps({ testID: 'navigation-container' });
    expect(
      container.findByProps({ testID: 'budget-chat-navigator' }),
    ).toBeTruthy();
  });

  it('BUDGET-NAV-006: forwards the route params to the chat navigator', async () => {
    mockParams = { roomId: 'room-1' };
    const tree = await render();

    const navigator = tree.root.findByProps({
      testID: 'budget-chat-navigator',
    });
    expect(navigator.props.initialParams).toEqual({ roomId: 'room-1' });
  });
});
