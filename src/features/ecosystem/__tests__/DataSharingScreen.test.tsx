/**
 * DataSharingScreen — active Soft Transfer consents (list / empty / error).
 *
 * Guards the regression where the live screen surfaced a bare "Network Error"
 * card: the earlier Budget alias test mocked the whole screen away and never
 * rendered the loading / empty / error / consent branches. This renders the
 * REAL screen against a mocked smartEngineApi so each branch is exercised.
 */

const mockGoBack = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
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
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      React.createElement(
        View,
        null,
        React.createElement(View, { testID: 'back-button', onPress: onBackPress }),
        React.createElement(Text, { testID: 'screen-header' }, title ?? '')
      ),
    screenScrollViewStyle: { scroll: {} },
  };
});

const mockListConsents = jest.fn();
const mockRevokeConsent = jest.fn();
jest.mock('@api/smart-engine', () => ({
  smartEngineApi: {
    listConsents: (...args: unknown[]) => mockListConsents(...args),
    revokeConsent: (...args: unknown[]) => mockRevokeConsent(...args),
    listPackages: jest.fn().mockResolvedValue([]),
    grantConsent: jest.fn(),
    prepare: jest.fn(),
    exportPackage: jest.fn(),
    importPackage: jest.fn(),
  },
  createIdempotencyKey: () => 'test-idempotency-key-16',
}));

jest.mock('@brand', () => {
  const { getBrandById } = jest.requireActual('../../../../brands') as {
    getBrandById: (id: string) => { id: string; displayName: string };
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
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { households: [{ id: 'hh-budget', name: 'Our Budget' }] };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { DataSharingScreen } from '../DataSharingScreen';

const ACTIVE_CONSENT = {
  id: 'consent-1',
  package_id: 'profile.core.v1',
  source_brand_id: 'symply-house',
  destination_brand_id: 'symply-budget',
  purpose: 'Share profile basics',
  consent_version: 1,
  status: 'active',
  expires_at: null,
  revoked_at: null,
  created_at: '2026-07-01T00:00:00Z',
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <DataSharingScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return tree;
}

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === 'string') out.push(x);
  };
  root.findAll(() => true).forEach((n) => {
    const children = n.props?.children;
    // Split text like "Symply House → Symply Budget" arrives as a string array.
    if (Array.isArray(children)) children.forEach(push);
    else push(children);
  });
  // Collapse whitespace so interpolated copy (e.g. "as {brand}." -> double space)
  // matches plain substrings.
  return out.join(' ').replace(/\s+/g, ' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListConsents.mockResolvedValue([ACTIVE_CONSENT]);
  mockRevokeConsent.mockResolvedValue({ id: 'consent-1', status: 'revoked' });
});

describe('DataSharingScreen', () => {
  it('renders an active consent returned by the API', async () => {
    const tree = await renderScreen();
    const text = allText(tree.root);

    expect(mockListConsents).toHaveBeenCalled();
    expect(text).toContain('Symply House');
    expect(text).toContain('Symply Budget');
    expect(text).toContain('Share profile basics');
    expect(text).toContain('Revoke');
    // Footer proves the shared screen rendered with Budget household context.
    expect(text).toContain('Signed in as Symply Budget');
  });

  it('shows the empty state when the API returns no active consents', async () => {
    mockListConsents.mockResolvedValue([]);

    const tree = await renderScreen();
    const text = allText(tree.root);

    expect(text).toContain('No active sharing permissions');
    expect(text).not.toContain('Revoke');
  });

  it('shows friendly offline copy on a no-response failure, never raw "Network Error"', async () => {
    // Axios "Network Error" == request got NO response (error.response undefined).
    // This is exactly the live screenshot: it MUST resolve to the curated offline
    // copy, not the raw developer string leaked straight from axios.
    const { AxiosError } = require('axios');
    mockListConsents.mockRejectedValue(new AxiosError('Network Error'));

    const tree = await renderScreen();
    const text = allText(tree.root);

    expect(text).toContain("We couldn't reach the server");
    expect(text).not.toContain('Network Error');
    expect(text).not.toContain('No active sharing permissions');
  });

  it('renders the friendly copy when Soft Transfer is disabled (403)', async () => {
    const { AxiosError } = require('axios');
    mockListConsents.mockRejectedValue(
      new AxiosError('Forbidden', '403', undefined, undefined, {
        status: 403,
        data: { error: { message: 'Soft Transfer is disabled' } },
      } as never)
    );

    const tree = await renderScreen();
    const text = allText(tree.root);

    expect(text).toContain('Soft Transfer is not enabled yet');
  });

  it('goes back when the header back button is pressed', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'back-button' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
