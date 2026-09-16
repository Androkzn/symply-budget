/**
 * LoginScreen UI — joined-platform adapter wiring (Data Bridge).
 * Uses react-test-renderer via deviceRender (no RNTL dependency).
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockJoinedLogin = jest.fn();
const mockAuthLogin = jest.fn();
const mockLoginStore = jest.fn();
const mockIsJoined = jest.fn(() => true);

jest.mock('@api/joined-platform-auth', () => ({
  joinedPlatformAuth: {
    login: (...args: unknown[]) => mockJoinedLogin(...args),
    appleAuth: jest.fn(),
    googleAuth: jest.fn(),
    refresh: jest.fn(),
  },
}));

jest.mock('@api/platform-spine', () => ({
  isJoinedPlatformBrand: () => mockIsJoined(),
}));

jest.mock('@api/auth', () => ({
  authApi: {
    login: (...args: unknown[]) => mockAuthLogin(...args),
    appleAuth: jest.fn(),
    googleAuth: jest.fn(),
    refreshToken: jest.fn(),
  },
}));

jest.mock('@api/user', () => ({
  userApi: { getProfile: jest.fn() },
}));

jest.mock('@services/biometric', () => ({
  biometricService: {
    isAvailable: jest.fn(async () => false),
    isEnabled: jest.fn(async () => false),
    hasStoredCredentials: jest.fn(async () => false),
    getRememberedEmail: jest.fn(async () => null),
    getBiometricTypeName: jest.fn(async () => 'Biometrics'),
    getCredentialsWithBiometric: jest.fn(),
    updateStoredRefreshToken: jest.fn(),
    rememberEmail: jest.fn(),
    disableBiometric: jest.fn(),
    enableBiometric: jest.fn(),
  },
}));

jest.mock('@services/analytics', () => ({
  trackEvent: jest.fn(),
  AnalyticsEvent: { SIGNED_IN: 'signed_in' },
}));

jest.mock('@brand/assets', () => ({
  brandAssets: { logo: 1, logoSplash: 1 },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      login: mockLoginStore,
      setTokens: jest.fn(),
      biometricEnabled: false,
      setBiometricEnabled: jest.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'safe' }, children),
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children),
    AuthWave: () => React.createElement(View, null),
    // GradientText renders its wordmark/slogan via a `text` prop (not children).
    GradientText: ({ text, children }: { text?: string; children?: React.ReactNode }) =>
      React.createElement(Text, null, text ?? children),
    // HeaderLogo is the brand lockup (ring + gradient wordmark); stubbed here as
    // the login hero uses <HeaderLogo orientation="vertical" glow />.
    HeaderLogo: () => React.createElement(View, null),
    screenScrollViewStyle: { scroll: {} },
  };
});

jest.mock('@components/layout', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AdaptiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: {},
  AppleAuthenticationButtonStyle: {},
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: jest.fn(),
  isAvailableAsync: jest.fn(async () => false),
}));

jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [null, null, jest.fn()],
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

import * as AppleAuthentication from 'expo-apple-authentication';
import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';

import { joinedPlatformAuth } from '@api/joined-platform-auth';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { LoginScreen } from '../LoginScreen';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

const mockSignInAsync = AppleAuthentication.signInAsync as jest.Mock;
const mockIsAppleAvailable = AppleAuthentication.isAvailableAsync as jest.Mock;
const mockJoinedAppleAuth = joinedPlatformAuth.appleAuth as jest.Mock;

function renderLogin() {
  return renderOnDevice('iPhone 14 Pro', (
    <LoginScreen
      navigation={navigation as never}
      route={{ key: 'Login', name: 'Login' } as never}
    />
  ));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LoginScreen Data Bridge UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsJoined.mockReturnValue(true);
    mockJoinedLogin.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', email_verified: true, has_completed_onboarding: true },
      access_token: 'a',
      refresh_token: 'r',
    });
  });

  it('renders the brand header and email sign-in control', () => {
    const r = renderLogin();
    // Header was redesigned to a per-brand wordmark + slogan + subtitle
    // (House baseline subtitle below); the email sign-in control is the data bridge.
    expect(treeText(r)).toContain('Inspect. Maintain. Relax.');
    expect(r.root.findByProps({ testID: 'auth-sign-in-email' })).toBeTruthy();
  });

  it('uses joinedPlatformAuth.login for joined brands', async () => {
    const r = renderLogin();
    await act(async () => {
      r.root.findByProps({ testID: 'auth-sign-in-email' }).props.onPress();
    });
    await flush();
    const email = r.root.findByProps({ testID: 'auth-email-input' });
    const password = r.root.findByProps({ testID: 'auth-password-input' });
    await act(async () => {
      email.props.onChangeText('user@example.com');
      password.props.onChangeText('ValidPass123!');
    });
    await act(async () => {
      r.root.findByProps({ testID: 'auth-sign-in-submit' }).props.onPress();
    });
    await flush();
    expect(mockJoinedLogin).toHaveBeenCalledWith('user@example.com', 'ValidPass123!');
    expect(mockAuthLogin).not.toHaveBeenCalled();
    expect(mockLoginStore).toHaveBeenCalled();
  });

  it('falls back to authApi.login when not joined', async () => {
    mockIsJoined.mockReturnValue(false);
    mockAuthLogin.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', email_verified: true, has_completed_onboarding: true },
      access_token: 'a',
      refresh_token: 'r',
    });
    const r = renderLogin();
    await act(async () => {
      r.root.findByProps({ testID: 'auth-sign-in-email' }).props.onPress();
    });
    await flush();
    await act(async () => {
      r.root.findByProps({ testID: 'auth-email-input' }).props.onChangeText('user@example.com');
      r.root.findByProps({ testID: 'auth-password-input' }).props.onChangeText('ValidPass123!');
    });
    await act(async () => {
      r.root.findByProps({ testID: 'auth-sign-in-submit' }).props.onPress();
    });
    await flush();
    expect(mockAuthLogin).toHaveBeenCalled();
    expect(mockJoinedLogin).not.toHaveBeenCalled();
  });

  it('navigates to Register via Sign Up control', async () => {
    const r = renderLogin();
    await act(async () => {
      r.root.findByProps({ testID: 'auth-go-register' }).props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Register');
  });

  // PLAT-AUTH-036 — the native Apple sheet failing (cancel / Close / no Apple
  // Account, whatever iOS error code) must never surface a "Sign In Failed"
  // alert and must never hit the backend.
  describe('Apple sign-in', () => {
    async function renderWithAppleButton() {
      mockIsAppleAvailable.mockResolvedValue(true);
      const r = renderLogin();
      await flush(); // resolve isAvailableAsync so the Apple button mounts
      return r;
    }

    it('does NOT show an error when the native Apple sheet is dismissed/cancelled', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      // Represents any native rejection: cancel, Close, or no Apple Account.
      mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_UNKNOWN' });

      const r = await renderWithAppleButton();
      await act(async () => {
        r.root.findByProps({ testID: 'auth-sign-in-apple' }).props.onPress();
      });
      await flush();

      expect(mockJoinedAppleAuth).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('does NOT show an error when the native credential lacks tokens', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockSignInAsync.mockResolvedValue({ identityToken: null, authorizationCode: null });

      const r = await renderWithAppleButton();
      await act(async () => {
        r.root.findByProps({ testID: 'auth-sign-in-apple' }).props.onPress();
      });
      await flush();

      expect(mockJoinedAppleAuth).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('DOES show "Sign In Failed" only when the backend exchange fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockSignInAsync.mockResolvedValue({
        identityToken: 'idtok',
        authorizationCode: 'authcode',
        email: 'a@b.com',
        fullName: { givenName: 'A', familyName: 'B' },
      });
      mockJoinedAppleAuth.mockRejectedValue(new Error('backend down'));

      const r = await renderWithAppleButton();
      await act(async () => {
        r.root.findByProps({ testID: 'auth-sign-in-apple' }).props.onPress();
      });
      await flush();

      expect(mockJoinedAppleAuth).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith('Sign In Failed', 'Apple Sign In failed. Please try again.');
      alertSpy.mockRestore();
    });
  });
});
