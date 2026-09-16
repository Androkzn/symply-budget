/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * LoginScreen — remember-last-login biometric CTA visibility + email prefill.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn((..._args: unknown[]) => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockHandleBiometricLogin = jest.fn(async (..._args: unknown[]) => true);

jest.mock('@hooks/useBiometricLogin', () => ({
  useBiometricLogin: () => ({
    canBiometricLogin: true,
    biometricAvailable: true,
    biometricEnabled: true,
    biometricType: 'Face ID',
    biometricLoading: false,
    rememberedEmail: 'remembered@example.com',
    handleBiometricLogin: (...a: unknown[]) => mockHandleBiometricLogin(...a),
  }),
}));

jest.mock('@api/joined-platform-auth', () => ({
  joinedPlatformAuth: {
    login: jest.fn(),
    appleAuth: jest.fn(),
    googleAuth: jest.fn(),
    refresh: jest.fn(),
  },
}));

jest.mock('@api/platform-spine', () => ({
  isJoinedPlatformBrand: () => true,
}));

jest.mock('@api/auth', () => ({
  authApi: {
    login: jest.fn(),
    appleAuth: jest.fn(),
    googleAuth: jest.fn(),
    refreshToken: jest.fn(),
  },
}));

jest.mock('@api/user', () => ({
  userApi: { getProfile: jest.fn() },
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
      login: jest.fn(),
      setTokens: jest.fn(),
      biometricEnabled: true,
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
    GradientText: ({ text, children }: { text?: string; children?: React.ReactNode }) =>
      React.createElement(Text, null, text ?? children),
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
  isAvailableAsync: jest.fn(async (..._args: unknown[]) => false),
}));

jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [null, null, jest.fn()],
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

import React from 'react';
import { act } from 'react-test-renderer';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { LoginScreen } from '../LoginScreen';

const navigation = {
  navigate: jest.fn(),
  getParent: () => ({ navigate: jest.fn() }),
} as never;

function renderLogin() {
  return renderOnDevice(
    'iPhone 14 Pro',
    <LoginScreen
      navigation={navigation}
      route={{ key: 'Login', name: 'Login', params: {} } as never}
    />
  );
}

describe('LoginScreen biometric remember-last-login UI', () => {
  it('shows Face ID CTA without expanding the email form', () => {
    const tree = renderLogin();

    expect(tree.root.findByProps({ testID: 'auth-biometric-login' })).toBeTruthy();
    expect(treeText(tree)).toContain('Sign in with Face ID');
    expect(tree.root.findAllByProps({ testID: 'auth-email-input' })).toHaveLength(0);
  });

  it('prefills the remembered email when the email form is opened', async () => {
    const tree = renderLogin();

    await act(async () => {
      tree.root.findByProps({ testID: 'auth-sign-in-email' }).props.onPress();
    });

    const emailInput = tree.root.findByProps({ testID: 'auth-email-input' });
    expect(emailInput.props.value).toBe('remembered@example.com');
  });
});
