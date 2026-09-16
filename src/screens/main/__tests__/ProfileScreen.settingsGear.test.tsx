/**
 * ProfileScreen — header settings gear.
 *
 * The gear must land on the app's OWN settings screen, which is brand-specific:
 *  - full Budget → `BudgetSettings` (sync, backup, invites, monthly budget),
 *    which lives in the Budget stack nested inside the Home tab;
 *  - House → `/house-settings`, the root route that mounts the Settings stack on
 *    House's own hub, pushed ABOVE the tabs so back returns to the tab that was
 *    open. House's More tab is the overflow-tabs hub now and no longer holds
 *    settings, so `/settings` would land the member on a screen without them;
 *  - every other brand → the shared settings hub on `/settings`.
 *
 * Two destinations are wrong, and both were shipped before these tests existed:
 *  - `/settings`, which in the Budget brand is the "More" tab (`tabRegistry`
 *    titles that route More);
 *  - the Home DASHBOARD, which is where `router.push({pathname: '/', params})`
 *    lands — an imperative push re-focuses an already-mounted tab WITHOUT
 *    delivering the new params, so the Budget stack never sees `screen`. Only
 *    the Linking door delivers them (same finding as `app/_layout.tsx`), so
 *    these tests assert on Linking, not on router.push.
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

const mockOpenURL = jest.fn((_url: string) => Promise.resolve(true));
jest.mock('expo-linking', () => ({
  __esModule: true,
  createURL: (path: string, opts?: { queryParams?: Record<string, string> }) => {
    const query = new URLSearchParams(opts?.queryParams ?? {}).toString();
    return `symplybudget://${path}${query ? `?${query}` : ''}`;
  },
  openURL: (url: string) => mockOpenURL(url),
}));

// The default test brand is `symply-house` (minimal budget), so the full-Budget
// branch would never be exercised. Force the mode the same way the Budget suites
// do — through `@features/budget`, which re-exports the brand capability.
let mockFullBudget = true;
jest.mock('@features/budget', () => {
  const actual = jest.requireActual('@features/budget');
  return {
    ...actual,
    isFullBudget: () => mockFullBudget,
  };
});

// …and the brand itself, for the same reason in the other direction: the House
// branch is checked FIRST, so a suite that only forced `isFullBudget` would keep
// hitting it while pretending to be Budget.
//
// A Proxy rather than `{...actual}`: `@brand` exports lazy getters and takes
// part in a require cycle, so spreading it here READS every one of them while
// `brand/capabilities` is still mid-require — which throws before a single test
// runs. The Proxy forwards each read at call time instead, once the cycle has
// settled.
let mockHouseBrand = false;
jest.mock('@brand', () => {
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get: (target, prop, receiver) =>
      prop === 'isHouseBrand' ? () => mockHouseBrand : Reflect.get(target, prop, receiver),
  });
});

jest.mock('@contexts/SubscriptionContext', () => ({
  __esModule: true,
  useSubscription: () => ({
    subscription: { status: 'active', provider: 'revenuecat' },
    isPremium: false,
    refreshSubscription: jest.fn(),
  }),
}));

jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => ({ source: null, provider: null, byokConnections: [] }),
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

jest.mock('@stores/featureFlagStore', () => ({
  __esModule: true,
  isFeatureEnabled: () => true,
}));

jest.mock('@services/image-picker-compat', () => ({ __esModule: true, default: {} }));

import React from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import { renderOnDevice, pressables } from '../../../test-utils/deviceRender';
import { ProfileScreen } from '../ProfileScreen';

const gear = (r: ReactTestRenderer): ReactTestInstance | undefined =>
  pressables(r).find(
    (p) => (p.props as { testID?: string }).testID === 'profile-settings-button'
  );

const render = () =>
  renderOnDevice(
    'iPhone 14 Pro',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nav/route props unused by the header
    <ProfileScreen navigation={{} as any} route={{} as any} />
  );

const nonceOf = (call: number): string =>
  new URL(mockOpenURL.mock.calls[call][0]).searchParams.get('navNonce')!;

beforeEach(() => {
  mockPush.mockClear();
  mockOpenURL.mockClear();
  mockFullBudget = true;
  mockHouseBrand = false;
});

describe('ProfileScreen — settings gear', () => {
  it('PROFILE-GEAR-001: renders a gear in the header', () => {
    const r = render();
    expect(gear(r)).toBeDefined();
  });

  it('PROFILE-GEAR-002: full Budget opens Budget Settings through the Linking door', () => {
    const r = render();
    gear(r)!.props.onPress();

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    const url = new URL(mockOpenURL.mock.calls[0][0]);
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('screen')).toBe('BudgetSettings');
    expect(url.searchParams.get('navNonce')).toEqual(expect.any(String));
  });

  it('PROFILE-GEAR-003: full Budget never pushes a route — push does not deliver params to a mounted tab', () => {
    const r = render();
    gear(r)!.props.onPress();

    // Guards the regression that landed on the Home dashboard: `/settings` is
    // the More tab, and `router.push({pathname:'/'})` silently drops `screen`.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('PROFILE-GEAR-004: a second visit sends a fresh nonce so the stack dedupe does not swallow it', () => {
    const r = render();
    gear(r)!.props.onPress();
    const first = nonceOf(0);

    // Same mounted screen, tapped again — the Home tab (and its dedupe ref)
    // outlives this screen, so the nonce must differ.
    jest.spyOn(Date, 'now').mockReturnValue(Number(first) + 1000);
    gear(r)!.props.onPress();

    expect(nonceOf(1)).not.toBe(first);
    jest.restoreAllMocks();
  });

  it('PROFILE-GEAR-005: other brands keep the shared /settings hub', () => {
    mockFullBudget = false;
    const r = render();
    gear(r)!.props.onPress();

    expect(mockPush).toHaveBeenCalledWith('/settings');
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('PROFILE-GEAR-006: House opens its own hub above the tabs, not the More tab', () => {
    mockFullBudget = false;
    mockHouseBrand = true;
    const r = render();
    gear(r)!.props.onPress();

    // `/settings` would be the More tab, which is the overflow-tabs hub now —
    // the settings the gear promises are not on it.
    expect(mockPush).toHaveBeenCalledWith('/house-settings');
    expect(mockPush).not.toHaveBeenCalledWith('/settings');
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});
