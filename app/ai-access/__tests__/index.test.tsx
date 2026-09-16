/**
 * Unlock AI screen — brand-neutral copy, feature-flag gating, and navigation.
 *
 * Asserts both access channels render with the active brand name (never
 * "SimpleHouse"), each card is disabled + shows "Coming soon" when its flag is
 * off, and tapping an enabled card routes to the right sub-flow.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: mockPush }),
}));

type Entitlement = {
  canUseAI: boolean;
  isPaid: boolean;
  source: 'simplehouse' | 'byok' | null;
  provider: 'openai' | 'anthropic' | 'gemini' | null;
  byokConnections: Array<{ provider: string }>;
  subscriptionsEnabled: boolean;
  bringYourOwnAIEnabled: boolean;
  aiFeaturesEnabled: boolean;
  denialReason: string | null;
  isLoading: boolean;
};
const mockEntitlement: Entitlement = {
  canUseAI: false,
  isPaid: false,
  source: null,
  provider: null,
  byokConnections: [],
  subscriptionsEnabled: true,
  bringYourOwnAIEnabled: true,
  aiFeaturesEnabled: true,
  denialReason: null,
  isLoading: false,
};
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

import React from 'react';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { brand } from '@brand';

import { renderOnDevice, treeText, pressables } from '../../../src/test-utils/deviceRender';
import UnlockAIScreen from '../index';

const card = (r: ReactTestRenderer, label: string): ReactTestInstance =>
  pressables(r).find((p) => p.props.accessibilityLabel === label)!;

beforeEach(() => {
  mockPush.mockClear();
  Object.assign(mockEntitlement, {
    canUseAI: false,
    isPaid: false,
    source: null,
    provider: null,
    byokConnections: [],
    subscriptionsEnabled: true,
    bringYourOwnAIEnabled: true,
    aiFeaturesEnabled: true,
    denialReason: null,
    isLoading: false,
  });
});

describe('UnlockAIScreen', () => {
  it('renders both channels with the active brand name, never "SimpleHouse"', () => {
    const r = renderOnDevice('iPhone 14 Pro', <UnlockAIScreen />);
    const text = treeText(r);
    expect(text).toContain('Subscribe with Apple');
    expect(text).toContain('Connect your API key');
    expect(text).toContain(brand.displayName); // "Symply House"
    expect(text).not.toContain('SimpleHouse');
  });

  it('routes each enabled card to its sub-flow', () => {
    const r = renderOnDevice('iPhone 14 Pro', <UnlockAIScreen />);
    card(r, 'Subscribe with Apple').props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/ai-access/paywall');
    card(r, 'Connect your API key').props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/ai-access/providers');
  });

  it('disables the Subscribe card and shows "Coming soon" when subscriptions are off', () => {
    mockEntitlement.subscriptionsEnabled = false;
    const r = renderOnDevice('iPhone 14 Pro', <UnlockAIScreen />);
    expect(card(r, 'Subscribe with Apple').props.disabled).toBe(true);
    expect(treeText(r)).toContain('Coming soon');
  });

  it('disables the BYOK card when bring-your-own-AI is off', () => {
    mockEntitlement.bringYourOwnAIEnabled = false;
    const r = renderOnDevice('iPhone 14 Pro', <UnlockAIScreen />);
    expect(card(r, 'Connect your API key').props.disabled).toBe(true);
  });

  it('names the connected provider in the active banner when using an own key', () => {
    Object.assign(mockEntitlement, {
      canUseAI: true,
      source: 'byok',
      provider: 'anthropic',
      byokConnections: [{ provider: 'anthropic' }],
    });
    const r = renderOnDevice('iPhone 14 Pro', <UnlockAIScreen />);
    const text = treeText(r);
    expect(text).toContain('using your own Anthropic Claude key');
    // The manage-providers card surfaces once a key is connected.
    expect(text).toContain('Manage AI providers');
  });

  it('relabels the Apple card to manage/cancel billing when already subscribed', () => {
    Object.assign(mockEntitlement, { canUseAI: true, isPaid: true, source: 'simplehouse' });
    const r = renderOnDevice('iPhone 14 Pro', <UnlockAIScreen />);
    const text = treeText(r);
    expect(text).toContain('Manage Apple subscription');
    expect(text).toContain('cancel billing');
    expect(text).not.toContain('Subscribe with Apple');
  });
});
