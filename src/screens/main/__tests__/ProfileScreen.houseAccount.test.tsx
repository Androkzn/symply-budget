/**
 * ProfileScreen — the House account rows that moved here off the More tab.
 *
 * House's More tab is the overflow-tabs hub now, so ACCOUNT had to go somewhere.
 * Profile is where it belongs and where half of it already was: Sign out and
 * Delete account have always been on this screen, and "which copies of this home
 * exist, who is let in, how do I sign in, what did I agree to" are questions
 * about the account and the device rather than about the app's behaviour — which
 * is what the settings hub behind the gear keeps.
 *
 * The ids are deliberately UNCHANGED (`settings-row-household-members`,
 * `settings-row-device-sync`, `settings-row-biometric`, …). They name the row,
 * a dozen Maestro flows already speak them, and `settings-row-device-sync` in
 * particular is a contract with the two-device runner's `LF_SETTINGS_ROW`
 * default. This suite pins that they survived the move, which is the part a
 * rename would silently break without any test going red.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('expo-linking', () => ({
  __esModule: true,
  createURL: (path: string) => `symplyhouse://${path}`,
  openURL: jest.fn(() => Promise.resolve(true)),
}));

// House is the Jest brand, so the rows under test are the default. The flag that
// gates the three local-first rows is NOT: `isHouseLocalFirst()` returns false
// under Jest by design (flag.ts), so it is forced on here — otherwise this suite
// would assert the absence of rows it is meant to be proving.
let mockLocalFirst = true;
jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockLocalFirst,
}));

jest.mock('@features/house/local/backup/useHouseBackupSummaryLine', () => ({
  __esModule: true,
  useHouseBackupSummaryLine: () => ({ line: 'Backs up weekly', needsAttention: false }),
}));

let mockBiometricAvailable = true;
jest.mock('@hooks/useBiometricQuickSignIn', () => ({
  __esModule: true,
  useBiometricQuickSignIn: () => ({
    available: mockBiometricAvailable,
    typeName: 'Face ID',
    enabled: false,
    busy: false,
    toggle: jest.fn(),
    icon: 'scan-outline',
  }),
}));

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

jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    // `households` is read by ScreenHeader's property switcher, which renders
    // above this screen — omit it and the header throws before a row exists.
    const s = {
      currentHousehold: { id: 'hh-1', name: 'Maple Street' },
      households: [{ id: 'hh-1', name: 'Maple Street' }],
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/featureFlagStore', () => ({
  __esModule: true,
  isFeatureEnabled: () => true,
}));

jest.mock('@services/image-picker-compat', () => ({ __esModule: true, default: {} }));

const mockNavigateToHouseholds = jest.fn();
const mockNavigateToHouseInvite = jest.fn();
const mockNavigateToHouseDeviceSync = jest.fn();
const mockNavigateToHouseBackup = jest.fn();
jest.mock('@services/navigation', () => ({
  __esModule: true,
  navigateToHouseholds: () => mockNavigateToHouseholds(),
  navigateToHouseInvite: () => mockNavigateToHouseInvite(),
  navigateToHouseDeviceSync: () => mockNavigateToHouseDeviceSync(),
  navigateToHouseBackup: () => mockNavigateToHouseBackup(),
}));

import React from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { act } from 'react-test-renderer';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { ProfileScreen } from '../ProfileScreen';

const render = () =>
  renderOnDevice(
    'iPhone 14 Pro',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nav/route props unused by these rows
    <ProfileScreen navigation={{} as any} route={{} as any} />,
  );

const node = (r: ReactTestRenderer, id: string): ReactTestInstance | undefined =>
  r.root.findAll((n) => n.props?.testID === id)[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalFirst = true;
  mockBiometricAvailable = true;
});

describe('ProfileScreen — House account rows', () => {
  it('PROFILE-HOUSE-001: renders HOME & SHARING with all four rows', () => {
    const r = render();

    expect(node(r, 'house-sync-sharing-section')).toBeTruthy();
    expect(node(r, 'settings-row-household-members')).toBeTruthy();
    expect(node(r, 'settings-row-house-invite')).toBeTruthy();
    expect(node(r, 'settings-row-device-sync')).toBeTruthy();
    expect(node(r, 'settings-row-house-backup')).toBeTruthy();
  });

  it('PROFILE-HOUSE-002: each row leaves this tab through the navigation helpers', () => {
    const r = render();

    act(() => node(r, 'settings-row-household-members')!.props.onPress());
    expect(mockNavigateToHouseholds).toHaveBeenCalledTimes(1);

    act(() => node(r, 'settings-row-house-invite')!.props.onPress());
    expect(mockNavigateToHouseInvite).toHaveBeenCalledTimes(1);

    act(() => node(r, 'settings-row-device-sync')!.props.onPress());
    expect(mockNavigateToHouseDeviceSync).toHaveBeenCalledTimes(1);

    act(() => node(r, 'settings-row-house-backup')!.props.onPress());
    expect(mockNavigateToHouseBackup).toHaveBeenCalledTimes(1);
  });

  it('PROFILE-HOUSE-003: the ledger rows hide when local-first is off, and Household stays', () => {
    mockLocalFirst = false;
    const r = render();

    // A build with no ledger has no devices, no key and no archives to describe.
    expect(node(r, 'settings-row-house-invite')).toBeUndefined();
    expect(node(r, 'settings-row-device-sync')).toBeUndefined();
    expect(node(r, 'settings-row-house-backup')).toBeUndefined();
    // …but the server-side household is real either way.
    expect(node(r, 'settings-row-household-members')).toBeTruthy();
  });

  it('PROFILE-HOUSE-004: quick sign-in keeps its historical row and toggle ids', () => {
    const r = render();

    expect(node(r, 'settings-row-biometric')).toBeTruthy();
    expect(node(r, 'settings-toggle-biometric')).toBeTruthy();
  });

  it('PROFILE-HOUSE-005: no biometric row until the platform says one is enrolled', () => {
    mockBiometricAvailable = false;
    const r = render();

    expect(node(r, 'settings-row-biometric')).toBeUndefined();
  });

  it('PROFILE-HOUSE-006: ABOUT opens the root legal routes, not the Settings stack', () => {
    const r = render();

    act(() => node(r, 'profile-terms-of-service')!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/terms-of-service');

    act(() => node(r, 'profile-privacy-policy')!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/privacy-policy');
  });
});
