/**
 * SoftTransferImportScreen — House → Budget import flow (package picker + consent).
 */

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      title,
      onBackPress,
    }: {
      title?: string;
      onBackPress?: () => void;
    }) =>
      React.createElement(
        View,
        null,
        React.createElement(View, {
          testID: 'back-button',
          onPress: onBackPress,
        }),
        React.createElement(Text, { testID: 'screen-header' }, title ?? '')
      ),
    screenScrollViewStyle: { scroll: {} },
    BackButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement(View, { testID: testID ?? 'back-button', onPress }),
  };
});

const mockListPackages = jest.fn();
jest.mock('@api/smart-engine', () => ({
  smartEngineApi: {
    listPackages: (...args: unknown[]) => mockListPackages(...args),
    listConsents: jest.fn().mockResolvedValue([]),
    grantConsent: jest.fn(),
    prepare: jest.fn(),
    exportPackage: jest.fn(),
    importPackage: jest.fn(),
  },
  createIdempotencyKey: () => 'test-idempotency-key-16',
}));

jest.mock('@brand', () => {
  const { getBrandById } = jest.requireActual('../../../../../brands') as {
    getBrandById: (id: string) => { id: string };
  };
  const budget = getBrandById('symply-budget');
  return {
    __esModule: true,
    brand: budget,
    brandId: 'symply-budget',
    getBrandById,
    getBrand: () => budget,
    isHouseBrand: () => false,
    isFullBudget: () => true,
    isHouseOrFullBudgetBrand: () => true,
    isHouseBudgetTransferPair: (a: string, b: string) =>
      (a === 'symply-house' && b === 'symply-budget') ||
      (a === 'symply-budget' && b === 'symply-house'),
    isHealthCapableBrand: () => false,
    isLanguageCapableBrand: () => false,
    isSmartEngineCapableBrand: () => true,
    isJoinedPlatformBrand: () => true,
    hasBrandCapability: () => true,
  };
});

jest.mock('@features/budget', () => ({
  isBudgetBrand: () => true,
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      households: [{ id: 'hh-budget', name: 'Our Budget', city: 'Toronto' }],
      currentHousehold: { id: 'hh-budget', name: 'Our Budget', city: 'Toronto' },
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SoftTransferImportScreen } from '../SoftTransferImportScreen';

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SoftTransferImportScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return tree;
}

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  return root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string)
    .join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListPackages.mockResolvedValue([
    {
      package_id: 'profile.core.v1',
      version: 1,
      source_brand_id: 'symply-house',
      destination_brand_id: 'symply-budget',
      field_manifest: ['displayName'],
      requires_source_household: false,
      requires_destination_household: false,
    },
    {
      package_id: 'house.property.v1',
      version: 1,
      source_brand_id: 'symply-house',
      destination_brand_id: 'symply-budget',
      field_manifest: ['cityRegion'],
      requires_source_household: true,
      requires_destination_household: false,
    },
  ]);
});

describe('SoftTransferImportScreen', () => {
  it('renders the import flow with shared summary package options', async () => {
    const tree = await renderScreen();
    const text = allText(tree.root);

    expect(text).toContain('Import a shared summary');
    expect(text).toContain('Profile basics');
    expect(text).toContain('Household property summary');
    expect(mockListPackages).toHaveBeenCalled();
  });

  it('goes back when the header back button is pressed', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'back-button' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('shows a clear message when Soft Transfer is disabled (403)', async () => {
    const { AxiosError } = require('axios');
    mockListPackages.mockRejectedValue(
      new AxiosError('Forbidden', '403', undefined, undefined, {
        status: 403,
        data: { error: { message: 'Soft Transfer is disabled' } },
      })
    );

    const tree = await renderScreen();
    const text = allText(tree.root);
    expect(text).toContain('Soft Transfer is not enabled yet');
  });
});
