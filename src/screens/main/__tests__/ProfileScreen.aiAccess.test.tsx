/**
 * ProfileScreen — Subscription card AI affordance.
 *
 * The card states what the plan grants in AI terms, reflecting *entitlement*
 * rather than tier:
 *  - a connected own key (BYOK) wins over tier — it survives a PRO cancellation,
 *    so the card shows "Using your own ChatGPT, Gemini or Claude account";
 *  - PRO with no own key shows "AI included…";
 *  - FREE with no key shows the "Unlock AI" upsell.
 *
 * What it must NOT carry is a "Manage AI access" button: that entry moved to
 * Settings → AI, where it is the single, state-aware row every brand renders
 * from `@components/ai/useAIAccessEntry`. The tests below hold that line — two
 * entry points with two destinations for one subject is what the move deleted.
 *
 * The real screen renders through <ThemeProvider> off mocked contexts + hooks.
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

// Subscription tier is flipped per test.
const mockSubscription = {
  subscription: { status: 'active', provider: 'apple' },
  isPremium: false,
  refreshSubscription: jest.fn(),
};
jest.mock('@contexts/SubscriptionContext', () => ({
  __esModule: true,
  useSubscription: () => mockSubscription,
}));

// AI entitlement (BYOK state) is flipped per test.
const mockEntitlement: {
  source: 'simplehouse' | 'byok' | null;
  provider: 'openai' | 'anthropic' | 'gemini' | null;
  byokConnections: Array<{ provider: string }>;
} = {
  source: null,
  provider: null,
  byokConnections: [],
};
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

jest.mock('@contexts/ProfileContext', () => ({
  __esModule: true,
  useProfile: () => ({
    user: {
      display_name: 'Andrei',
      email: 'a@example.com',
      email_verified: true,
      created_at: '2026-01-20T00:00:00.000Z',
      avatar_url: null,
    },
    isLoading: false,
    updateProfile: jest.fn(),
  }),
}));

jest.mock('@contexts/DataContext', () => ({
  __esModule: true,
  useData: () => ({ lastSyncAt: null }),
}));

jest.mock('@contexts/I18nContext', () => ({
  __esModule: true,
  useI18n: () => ({ t: (k: string) => k }),
}));

jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { logout: () => void }) => unknown) =>
    selector({ logout: jest.fn() }),
}));

let mockAiFeaturesEnabled = true;
jest.mock('@stores/featureFlagStore', () => ({
  __esModule: true,
  isFeatureEnabled: (flag: string) =>
    flag === 'aiFeaturesEnabled' ? mockAiFeaturesEnabled : true,
}));

jest.mock('@services/image-picker-compat', () => ({ __esModule: true, default: {} }));

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
import { ProfileScreen } from '../ProfileScreen';

const aiButton = (r: ReactTestRenderer): ReactTestInstance | undefined =>
  pressables(r).find(
    (p) => (p.props as { testID?: string }).testID === 'profile-ai-access-button'
  );

const manageButton = (r: ReactTestRenderer): ReactTestInstance | undefined =>
  pressables(r).find(
    (p) => (p.props as { testID?: string }).testID === 'profile-manage-subscription-button'
  );

/** Fire the alert button whose text contains `label` from the last Alert.alert call. */
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

afterEach(() => {
  alertSpy.mockRestore();
});

const render = () =>
  renderOnDevice(
    'iPhone 14 Pro',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nav/route props unused by the AI + subscription sections
    <ProfileScreen navigation={{} as any} route={{} as any} />
  );

describe('ProfileScreen — AI access affordance', () => {
  it('FREE + no key: shows the Unlock AI upsell', () => {
    const r = render();
    expect(treeText(r)).toContain('Unlock AI');
  });

  it('own key connected (source=byok): shows the own-account line, no manage button', () => {
    Object.assign(mockEntitlement, {
      source: 'byok',
      provider: 'anthropic',
      byokConnections: [{ provider: 'anthropic' }],
    });
    const r = render();
    const text = treeText(r);
    expect(text).toContain('Using your own ChatGPT, Gemini or Claude account');
    expect(text).not.toContain('Manage AI access');
    expect(text).not.toContain('Unlock AI');
    expect(aiButton(r)).toBeUndefined();
  });

  it('own key survives a PRO cancellation (FREE + byok) — still the own-provider state', () => {
    mockSubscription.isPremium = false;
    Object.assign(mockEntitlement, {
      source: 'byok',
      provider: 'openai',
      byokConnections: [{ provider: 'openai' }],
    });
    const r = render();
    expect(treeText(r)).toContain('Using your own ChatGPT, Gemini or Claude account');
    expect(aiButton(r)).toBeUndefined();
  });

  it('PRO + no key: shows AI-included, and still no manage button', () => {
    mockSubscription.isPremium = true;
    const r = render();
    const text = treeText(r);
    expect(text).toContain('AI included with your subscription');
    expect(text).not.toContain('Manage AI access');
    expect(aiButton(r)).toBeUndefined();
  });

  it('PRO + own key: the own-provider state wins over tier', () => {
    mockSubscription.isPremium = true;
    Object.assign(mockEntitlement, {
      source: 'byok',
      provider: 'gemini',
      byokConnections: [{ provider: 'gemini' }],
    });
    const r = render();
    const text = treeText(r);
    expect(text).toContain('Using your own ChatGPT, Gemini or Claude account');
    expect(text).not.toContain('AI included with your subscription');
  });

  it('FREE + no key: Unlock AI is the only AI route left on the card, and it opens the hub', () => {
    // The upsell stays — it is a subscription CTA. What must not come back is a
    // second, state-aware manage entry pointing somewhere else.
    const r = render();
    aiButton(r)!.props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/ai-access');
    expect(mockPush).not.toHaveBeenCalledWith('/ai-access/manage');
  });

  it('hides the AI affordance entirely when aiFeaturesEnabled is off', () => {
    mockAiFeaturesEnabled = false;
    mockSubscription.isPremium = true;
    const r = render();
    const text = treeText(r);
    expect(text).not.toContain('Unlock AI');
    expect(text).not.toContain('Manage AI access');
  });
});

describe('ProfileScreen — Manage / Cancel subscription', () => {
  it('FREE: no Manage subscription button', () => {
    mockSubscription.isPremium = false;
    const r = render();
    expect(manageButton(r)).toBeUndefined();
  });

  it('PRO: shows the Manage subscription button', () => {
    mockSubscription.isPremium = true;
    const r = render();
    expect(manageButton(r)).toBeDefined();
  });

  it('PRO + no own key: warns AI turns off on cancel', () => {
    mockSubscription.isPremium = true;
    const r = render();
    expect(treeText(r)).toContain('Canceling PRO turns off AI unless you connect your own provider.');
  });

  it('PRO + own key: no AI-turns-off warning (own key survives cancel)', () => {
    mockSubscription.isPremium = true;
    Object.assign(mockEntitlement, {
      source: 'byok',
      provider: 'openai',
      byokConnections: [{ provider: 'openai' }],
    });
    const r = render();
    expect(treeText(r)).not.toContain('Canceling PRO turns off AI');
  });

  it('Apple-billed (revenuecat): deep-links to Apple, never hits the backend', () => {
    mockSubscription.isPremium = true;
    mockSubscription.subscription = { status: 'active', provider: 'revenuecat' };
    const r = render();
    manageButton(r)!.props.onPress();
    pressAlertButton(alertSpy, 'Apple');
    expect(mockOpenURL).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });

  it('legacy null provider is treated as Apple-billed', () => {
    mockSubscription.isPremium = true;
    // @ts-expect-error — legacy rows carry a null provider
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
