/**
 * Per-provider detail — usage panel + billing/usage deep links + management.
 *
 * Asserts the provider renders, its estimated spend shows, the billing link
 * opens the provider console, and Disconnect (after confirm) hits the API.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockValidate = jest.fn().mockResolvedValue({});
const mockDelete = jest.fn().mockResolvedValue({ success: true });
jest.mock('@api/aiAccess', () => ({
  __esModule: true,
  aiAccessApi: {
    validateConnection: (...a: unknown[]) => mockValidate(...a),
    deleteConnection: (...a: unknown[]) => mockDelete(...a),
  },
}));

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockEntitlement = {
  byokConnections: [
    { provider: 'openai', status: 'valid', keyHint: '•••• 9Z2X', lastValidatedAt: '2026-07-01T00:00:00.000Z', capabilities: ['text'], selectedModelId: 'openai.gpt-5.6-sol', leaseExpiresAt: null },
  ],
  invalidate: mockInvalidate,
  bringYourOwnAIEnabled: true,
  providerEnabled: { openai: true, anthropic: true, gemini: true },
};
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

const mockUsage = {
  currency: 'USD',
  range: { days: 30 },
  provider: 'openai',
  totals: { requests: 5, tokens: 41000, costUsd: 0.19 },
  byFeature: [{ feature: 'budget_chat', requests: 5, tokens: 41000, costUsd: 0.19 }],
  byModel: [],
  byProvider: [],
  byDay: [{ date: '2026-07-20', requests: 5, tokens: 41000, costUsd: 0.19 }],
};
jest.mock('@hooks/useAiUsage', () => ({
  __esModule: true,
  useAiUsage: () => ({ householdId: 'h1', usage: mockUsage, isLoading: false, isError: false, refetch: jest.fn() }),
}));

jest.mock('@services/toastManager', () => ({ __esModule: true, showToast: jest.fn() }));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ provider: 'openai' }),
}));

import React from 'react';
import { Alert, Linking } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { renderOnDevice, treeText } from '../../../src/test-utils/deviceRender';
import ProviderDetailScreen from '../provider/[provider]';

const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
  (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
});
const byTestID = (r: ReactTestRenderer, id: string): ReactTestInstance =>
  r.root.findAll((n) => n.props?.testID === id)[0];

beforeEach(() => {
  mockValidate.mockClear();
  mockDelete.mockClear();
  mockInvalidate.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  openURLSpy.mockClear();
  alertSpy.mockClear();
});

describe('ProviderDetailScreen', () => {
  it('renders the provider label and its estimated spend', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderDetailScreen />);
    const text = treeText(r);
    expect(text).toContain('OpenAI');
    expect(text).toContain('$0.19');
    expect(text).toContain('ESTIMATE');
  });

  it('opens the provider billing page', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderDetailScreen />);
    byTestID(r, 'ai-billing-link-openai').props.onPress();
    expect(openURLSpy).toHaveBeenCalledWith('https://platform.openai.com/settings/organization/billing/overview');
  });

  it('disconnects (after confirm) and navigates back', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderDetailScreen />);
    await act(async () => {
      r.root.findAll((n) => n.props?.accessibilityLabel === 'Disconnect')[0].props.onPress();
    });
    expect(alertSpy).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('openai');
    expect(mockBack).toHaveBeenCalled();
  });
});
