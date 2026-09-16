/**
 * SubscriptionSection — the shared, brand-agnostic subscription surface every
 * app in the ecosystem mounts. Mounted directly here (not through any screen)
 * to prove it renders + behaves standalone:
 *  - the AI status lines (own BYOK key wins over tier; PRO-included) and the
 *    FREE "Unlock AI" upsell — what the plan grants, NOT a manage entry: that
 *    moved to the Settings AI row (@components/ai/useAIAccessEntry), so nothing
 *    here may route to /ai-access/manage;
 *  - the PRO-only "Manage subscription" action with its AI-turns-off warning;
 *  - provider-aware cancel routing (Apple deep-link vs backend cancel endpoint).
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockSubscription = {
  subscription: { status: 'active', provider: 'revenuecat' as string | null },
  isPremium: false,
  refreshSubscription: jest.fn(),
};
jest.mock('@contexts/SubscriptionContext', () => ({
  __esModule: true,
  useSubscription: () => mockSubscription,
}));

const mockEntitlement: {
  source: 'simplehouse' | 'byok' | null;
  provider: 'openai' | 'anthropic' | 'gemini' | null;
  byokConnections: Array<{ provider: string }>;
} = { source: null, provider: null, byokConnections: [] };
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

jest.mock('@contexts/I18nContext', () => ({
  __esModule: true,
  useI18n: () => ({ t: (k: string) => k }),
}));

let mockAiFeaturesEnabled = true;
jest.mock('@stores/featureFlagStore', () => ({
  __esModule: true,
  isFeatureEnabled: (flag: string) =>
    flag === 'aiFeaturesEnabled' ? mockAiFeaturesEnabled : true,
}));

const mockOpenURL = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));

const mockCancelSubscription = jest.fn((..._args: unknown[]) => Promise.resolve({}));
jest.mock('@api/subscription', () => ({
  __esModule: true,
  subscriptionApi: { cancelSubscription: (...a: unknown[]) => mockCancelSubscription(...a) },
}));

import React from 'react';
import { Alert } from 'react-native';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import { renderOnDevice, treeText, pressables } from '../../../test-utils/deviceRender';
import { SubscriptionSection } from '../SubscriptionSection';

const aiButton = (r: ReactTestRenderer): ReactTestInstance | undefined =>
  pressables(r).find((p) => (p.props as { testID?: string }).testID === 'profile-ai-access-button');

const manageButton = (r: ReactTestRenderer): ReactTestInstance | undefined =>
  pressables(r).find(
    (p) => (p.props as { testID?: string }).testID === 'profile-manage-subscription-button'
  );

const pressAlertButton = (alertSpy: jest.SpyInstance, label: string) => {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as
    | Array<{ text?: string; onPress?: () => void }>
    | undefined;
  buttons?.find((b) => b.text?.includes(label))?.onPress?.();
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockPush.mockClear();
  mockOpenURL.mockClear();
  mockCancelSubscription.mockClear();
  mockAiFeaturesEnabled = true;
  mockSubscription.isPremium = false;
  mockSubscription.subscription = { status: 'active', provider: 'revenuecat' };
  Object.assign(mockEntitlement, { source: null, provider: null, byokConnections: [] });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => alertSpy.mockRestore());

const render = () => renderOnDevice('iPhone 14 Pro', <SubscriptionSection />);

describe('SubscriptionSection — AI affordance', () => {
  it('FREE + no key: shows the Unlock AI upsell', () => {
    expect(treeText(render())).toContain('Unlock AI');
  });

  it('FREE + no key: the Unlock AI upsell opens the hub', () => {
    const r = render();
    aiButton(r)!.props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/ai-access');
  });

  it('own key connected (byok): states the own account, offers no manage button', () => {
    Object.assign(mockEntitlement, {
      source: 'byok',
      provider: 'anthropic',
      byokConnections: [{ provider: 'anthropic' }],
    });
    const r = render();
    const text = treeText(r);
    expect(text).toContain('Using your own ChatGPT, Gemini or Claude account');
    expect(text).not.toContain('Manage AI access');
    // Managing a connected key is the Settings row's job now — a button here is
    // the removed duplicate coming back.
    expect(aiButton(r)).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalledWith('/ai-access/manage');
  });

  it('PRO + no key: states AI is included, offers no manage button', () => {
    mockSubscription.isPremium = true;
    const r = render();
    const text = treeText(r);
    expect(text).toContain('AI included with your subscription');
    expect(text).not.toContain('Manage AI access');
    expect(aiButton(r)).toBeUndefined();
  });

  it('hides the AI affordance entirely when aiFeaturesEnabled is off', () => {
    mockAiFeaturesEnabled = false;
    mockSubscription.isPremium = true;
    const text = treeText(render());
    expect(text).not.toContain('Unlock AI');
    expect(text).not.toContain('AI included with your subscription');
  });
});

describe('SubscriptionSection — Manage / Cancel subscription', () => {
  it('FREE: no Manage subscription button', () => {
    expect(manageButton(render())).toBeUndefined();
  });

  it('PRO: shows the button + AI-turns-off warning when no own key', () => {
    mockSubscription.isPremium = true;
    const r = render();
    expect(manageButton(r)).toBeDefined();
    expect(treeText(r)).toContain('Canceling PRO turns off AI unless you connect your own provider.');
  });

  it('PRO + own key: no AI-turns-off warning (own key survives cancel)', () => {
    mockSubscription.isPremium = true;
    Object.assign(mockEntitlement, {
      source: 'byok',
      provider: 'openai',
      byokConnections: [{ provider: 'openai' }],
    });
    expect(treeText(render())).not.toContain('Canceling PRO turns off AI');
  });

  it('Apple-billed (revenuecat): deep-links to Apple, never hits the backend', () => {
    mockSubscription.isPremium = true;
    const r = render();
    manageButton(r)!.props.onPress();
    pressAlertButton(alertSpy, 'Apple');
    expect(mockOpenURL).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });

  it('legacy null provider is treated as Apple-billed', () => {
    mockSubscription.isPremium = true;
    mockSubscription.subscription = { status: 'active', provider: null };
    const r = render();
    manageButton(r)!.props.onPress();
    pressAlertButton(alertSpy, 'Apple');
    expect(mockOpenURL).toHaveBeenCalled();
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });

  it('web-billed (stripe): confirms then calls the backend cancel endpoint', () => {
    mockSubscription.isPremium = true;
    mockSubscription.subscription = { status: 'active', provider: 'stripe' };
    const r = render();
    manageButton(r)!.props.onPress();
    pressAlertButton(alertSpy, 'Cancel subscription');
    expect(mockCancelSubscription).toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});
