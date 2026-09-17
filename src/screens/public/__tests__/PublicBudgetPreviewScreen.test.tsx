/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

const colors = {
  primary: '#168A80',
  success: '#2E9B62',
  error: '#D64545',
  warning: '#B7791F',
  card: '#FFFFFF',
  borderColor: '#D7DEDC',
  backgroundSecondary: '#F1F5F3',
  surfaceSelected: '#E2F3F0',
  textPrimary: '#17211F',
  textSecondary: '#65736F',
};

jest.mock('@theme', () => ({
  __esModule: true,
  useAppColors: () => colors,
}));

jest.mock('@components/common/AppBackground', () => ({
  AppBackground: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    require('react').createElement(require('react-native').View, { testID }, children)
  ),
}));

jest.mock('@components/common/HeaderLogo', () => ({
  HeaderLogo: () => require('react').createElement(require('react-native').View, { testID: 'header-logo' }),
}));

jest.mock('@components/ui/Icon', () => ({
  Icon: ({ name, testID }: { name: string; testID?: string }) => (
    require('react').createElement(require('react-native').Text, { testID }, name)
  ),
}));

jest.mock('@components/ui/Typography', () => ({
  Typography: ({ children }: { children?: React.ReactNode }) =>
    require('react').createElement(require('react-native').Text, null, children),
}));

jest.mock('@/platform/web/public-preview-bridge', () => ({
  announcePublicBudgetPreviewInteraction: jest.fn(),
  announcePublicBudgetPreviewScreen: jest.fn(),
  startPublicBudgetPreviewBridge: jest.fn(() => jest.fn()),
}));

import { PublicBudgetPreviewScreen } from '../PublicBudgetPreviewScreen';

function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<PublicBudgetPreviewScreen />);
  });
  return tree;
}

function renderedText(tree: ReactTestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((node) => (typeof node.props.children === 'string' ? node.props.children : ''))
    .join(' ');
}

describe('PublicBudgetPreviewScreen', () => {
  it('renders deterministic seeded budget data without an empty state', () => {
    const tree = renderScreen();
    const text = renderedText(tree);

    expect(tree.root.findByProps({ testID: 'public-budget-preview' })).toBeTruthy();
    expect(text).toContain('September 2026');
    expect(text).toContain('$3,452');
    expect(text).toContain('Housing');
    expect(text).toContain('Home insurance');
    expect(text).toContain('No account, credentials, or production API access is used.');
  });

  it('supports local-only section, month, category, and planning interactions', () => {
    const tree = renderScreen();

    act(() => {
      tree.root.findByProps({ testID: 'public-budget-tab-spending' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'public-budget-spending-view' })).toBeTruthy();

    act(() => {
      tree.root.findByProps({ testID: 'public-budget-category-food' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'public-budget-category-detail' })).toBeTruthy();

    act(() => {
      tree.root.findByProps({ testID: 'public-budget-month-next' }).props.onPress();
    });
    expect(renderedText(tree)).toContain('October 2026');

    act(() => {
      tree.root.findByProps({ testID: 'public-budget-tab-planning' }).props.onPress();
    });
    act(() => {
      tree.root.findByProps({ testID: 'public-budget-plan-mortgage' }).props.onPress();
    });
    expect(renderedText(tree)).toContain('reserved in this plan');
  });
});
