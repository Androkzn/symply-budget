/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * RegisterScreen UI — joined register adapter + closed registration error path.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockJoinedRegister = jest.fn();
const mockAuthRegister = jest.fn();
const mockLoginStore = jest.fn();
const mockIsJoined = jest.fn(() => true);

jest.mock('@api/joined-platform-auth', () => ({
  joinedPlatformAuth: {
    register: (...args: unknown[]) => mockJoinedRegister(...args),
    appleAuth: jest.fn(),
    googleAuth: jest.fn(),
  },
}));

jest.mock('@api/platform-spine', () => ({
  isJoinedPlatformBrand: () => mockIsJoined(),
}));

jest.mock('@api/auth', () => ({
  authApi: {
    register: (...args: unknown[]) => mockAuthRegister(...args),
    appleAuth: jest.fn(),
    googleAuth: jest.fn(),
  },
}));

jest.mock('@services/analytics', () => ({
  trackEvent: jest.fn(),
  AnalyticsEvent: { SIGNED_UP: 'signed_up' },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { login: mockLoginStore };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children),
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children),
    AuthWave: () => React.createElement(View, null),
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

import { AxiosError, AxiosHeaders } from 'axios';
import React from 'react';
import { Alert, TextInput } from 'react-native';
import { act } from 'react-test-renderer';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { RegisterScreen } from '../RegisterScreen';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

function renderRegister() {
  return renderOnDevice('iPhone 14 Pro', (
    <RegisterScreen
      navigation={navigation as never}
      route={{ key: 'Register', name: 'Register' } as never}
    />
  ));
}

describe('RegisterScreen Data Bridge UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsJoined.mockReturnValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('renders Create Account heading', () => {
    const r = renderRegister();
    expect(treeText(r)).toMatch(/Create Account/);
    expect(r.root.findByProps({ testID: 'auth-register-submit' })).toBeTruthy();
  });

  it('calls joinedPlatformAuth.register for joined brands', async () => {
    mockJoinedRegister.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', email_verified: false, has_completed_onboarding: false },
      access_token: 'a',
      refresh_token: 'r',
    });
    const r = renderRegister();
    const inputs = r.root.findAllByType(TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('Test User');
      inputs[1].props.onChangeText('user@example.com');
      inputs[2].props.onChangeText('ValidPass123!');
      inputs[3].props.onChangeText('ValidPass123!');
    });
    await act(async () => {
      r.root.findByProps({ testID: 'auth-register-submit' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockJoinedRegister).toHaveBeenCalledWith(
      'user@example.com',
      'ValidPass123!',
      'Test User'
    );
    expect(mockAuthRegister).not.toHaveBeenCalled();
  });

  it('surfaces registration-disabled API error', async () => {
    const err = new AxiosError('Request failed with status code 403');
    err.response = {
      status: 403,
      statusText: 'Forbidden',
      data: { error: { code: 'forbidden', message: 'Public registration is disabled' } },
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    mockJoinedRegister.mockRejectedValue(err);
    const r = renderRegister();
    const inputs = r.root.findAllByType(TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('Test User');
      inputs[1].props.onChangeText('user@example.com');
      inputs[2].props.onChangeText('ValidPass123!');
      inputs[3].props.onChangeText('ValidPass123!');
    });
    await act(async () => {
      r.root.findByProps({ testID: 'auth-register-submit' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Registration Failed',
      expect.stringMatching(/disabled/i)
    );
  });
});
