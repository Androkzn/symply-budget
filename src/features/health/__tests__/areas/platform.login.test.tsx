/**
 * Symply Health — the login boundary, on the SHARED LoginScreen.
 *
 * Health ships no auth screen of its own: `src/screens/auth/LoginScreen.tsx` is
 * the same component every brand renders, and only `brandId` makes it read as
 * Symply Health. That leaves three Health-specific contracts, none of which had
 * a test:
 *
 *   1. IDENTITY — the slogan and subtitle `login-screen-controls.yaml` asserts
 *      on the simulator actually reach the screen. `loginTheme.test.ts` pins the
 *      strings in the map; nothing pinned that the screen renders THEM for this
 *      brand (a `getBrandLoginTheme(brandId)` that silently fell back to Kaizen
 *      would paint mint/teal on the red brand with no type error).
 *   2. THE AUTH PATH — Health is a joined-platform brand, so credentials must go
 *      through `joinedPlatformAuth`, never House's `authApi`.
 *   3. THE FAILURE COPY — an empty submit, a wrong password and an
 *      unrecognisable error each have to behave, and the wrong-password message
 *      must not disclose whether the account exists.
 *
 * The Apple-sheet cancellation paths and the biometric flow belong to
 * `LoginScreen.data-bridge.test.tsx` / `LoginScreen.biometric.test.tsx` and are
 * deliberately not repeated here.
 *
 * Shared source is NOT modified.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Only the brand IDENTITY is swapped — a Proxy rather than a spread because
// @brand ⇄ capabilities is a circular import (see platform.tabCustomization).
jest.mock('@brand', () => {
  const pack = require('../../../../../brands/symply-health/brand.cjs');
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'brand') return pack;
      if (prop === 'brandId') return pack.id;
      return Reflect.get(target, prop);
    },
  });
});

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

jest.mock('@api/user', () => ({ userApi: { getProfile: jest.fn() } }));

// The biometric half of the screen has its own suite; pinned OFF here so the
// email form is the only path under test and no auto-prompt races it.
jest.mock('@hooks/useBiometricLogin', () => ({
  useBiometricLogin: () => ({
    canBiometricLogin: false,
    biometricType: 'Face ID',
    biometricLoading: false,
    rememberedEmail: null,
    handleBiometricLogin: jest.fn(),
  }),
}));

jest.mock('@services/analytics', () => ({
  trackEvent: jest.fn(),
  AnalyticsEvent: { SIGNED_IN: 'signed_in' },
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
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'safe' }, children),
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, null, children),
    AuthWave: () => ReactMock.createElement(View, null),
    // GradientText renders the slogan through a `text` prop, not children.
    GradientText: ({ text, children }: { text?: string; children?: React.ReactNode }) =>
      ReactMock.createElement(Text, null, text ?? children),
    HeaderLogo: () => ReactMock.createElement(View, { testID: 'header-logo' }),
    screenScrollViewStyle: { scroll: {} },
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

jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));

import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';

import { getBrandLoginTheme } from '@brand/loginTheme';

import { LoginScreen } from '../../../../screens/auth/LoginScreen';
import { renderOnDevice, treeText } from '../../../../test-utils/deviceRender';

/** The fleet-wide shared E2E account (registration is disabled fleet-wide). */
const SEEDED_EMAIL = 'a.tekhtelev@gmail.com';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

function renderLogin() {
  return renderOnDevice(
    'iPhone 14 Pro',
    <LoginScreen
      navigation={navigation as never}
      route={{ key: 'Login', name: 'Login' } as never}
    />,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

type Rendered = ReturnType<typeof renderLogin>;

/** Open the email form and type a credential pair into it. */
async function typeCredentials(r: Rendered, email: string, password: string) {
  await act(async () => {
    r.root.findByProps({ testID: 'auth-sign-in-email' }).props.onPress();
  });
  await flush();
  await act(async () => {
    r.root.findByProps({ testID: 'auth-email-input' }).props.onChangeText(email);
    r.root.findByProps({ testID: 'auth-password-input' }).props.onChangeText(password);
  });
}

async function submit(r: Rendered) {
  await act(async () => {
    r.root.findByProps({ testID: 'auth-sign-in-submit' }).props.onPress();
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsJoined.mockReturnValue(true);
  mockJoinedLogin.mockResolvedValue({
    user: {
      id: 'health-user',
      email: SEEDED_EMAIL,
      email_verified: true,
      has_completed_onboarding: true,
    },
    access_token: 'access',
    refresh_token: 'refresh',
  });
});

describe('Health login — brand identity (HEALTH-AUTH-025..026)', () => {
  it('HEALTH-AUTH-025: renders Health’s slogan and subtitle, not the Kaizen fallback', () => {
    const r = renderLogin();
    const text = treeText(r);
    const theme = getBrandLoginTheme('symply-health');

    // The exact strings `login-screen-controls.yaml` asserts on the simulator.
    expect(text).toContain('Health, Simplified');
    expect(text).toContain('Track. Move. Thrive.');
    expect(text).toContain(theme.slogan);
    expect(text).toContain(theme.subtitle);
  });

  it('HEALTH-AUTH-026: shows no other brand’s login copy', () => {
    const r = renderLogin();
    const text = treeText(r);

    for (const foreign of [
      'Home, Handled',
      'Inspect. Maintain. Relax.',
      'Money, Mastered',
      'Plan. Spend. Save.',
      'Focus. Practice. Progress.',
      'Fluency, Faster',
      'Symply House',
      'SimpleHouse',
    ]) {
      expect(text).not.toContain(foreign);
    }
  });

  it('HEALTH-AUTH-027: offers Apple, Google, Email and Sign Up before any form is open', () => {
    const r = renderLogin();

    // Apple is iOS-availability gated (`isAvailableAsync` resolves false here),
    // so only the three unconditional controls are asserted — the flow on device
    // covers the Apple button.
    expect(r.root.findByProps({ testID: 'auth-sign-in-google' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'auth-sign-in-email' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'auth-go-register' })).toBeTruthy();
    // The email form is behind the "Sign in with Email" control, not open.
    expect(r.root.findAllByProps({ testID: 'auth-email-input' })).toHaveLength(0);
  });
});

describe('Health login — the joined-platform auth path (HEALTH-AUTH-028)', () => {
  it('HEALTH-AUTH-028: Health is a joined-platform brand and signs in through that adapter', async () => {
    // Capability first, so the assertion below is not just asserting the mock.
    const { isJoinedPlatformBrand } = jest.requireActual('@brand/capabilities');
    expect(isJoinedPlatformBrand('symply-health')).toBe(true);

    const r = renderLogin();
    await typeCredentials(r, SEEDED_EMAIL, 'Andrei123!');
    await submit(r);

    expect(mockJoinedLogin).toHaveBeenCalledWith(SEEDED_EMAIL, 'Andrei123!');
    // House's own auth client must never be reached from a Health build.
    expect(mockAuthLogin).not.toHaveBeenCalled();
    expect(mockLoginStore).toHaveBeenCalledWith(
      expect.objectContaining({ email: SEEDED_EMAIL }),
      'access',
      'refresh',
    );
  });

  it('HEALTH-AUTH-029: trims the typed email before it reaches the API', async () => {
    // iOS autocorrect and a pasted address both leave trailing spaces; the
    // account would not be found and the member would be told their password
    // was wrong.
    const r = renderLogin();
    await typeCredentials(r, `  ${SEEDED_EMAIL} `, 'Andrei123!');
    await submit(r);

    expect(mockJoinedLogin).toHaveBeenCalledWith(SEEDED_EMAIL, 'Andrei123!');
  });
});

describe('Health login — validation (HEALTH-AUTH-030..031)', () => {
  it('HEALTH-AUTH-030: an empty submit is refused client-side, with no request', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = renderLogin();

    await act(async () => {
      r.root.findByProps({ testID: 'auth-sign-in-email' }).props.onPress();
    });
    await flush();
    await submit(r);

    expect(treeText(r)).toContain('Please enter your email and password');
    // The guard is local: no network call, and no "Login Failed" alert either —
    // an alert for a field the member simply has not filled in yet is noise.
    expect(mockJoinedLogin).not.toHaveBeenCalled();
    expect(mockAuthLogin).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockLoginStore).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('HEALTH-AUTH-031: whitespace-only credentials are treated as empty', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = renderLogin();
    await typeCredentials(r, '   ', '   ');
    await submit(r);

    expect(treeText(r)).toContain('Please enter your email and password');
    expect(mockJoinedLogin).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('Health login — failure copy (HEALTH-AUTH-032..034)', () => {
  it('HEALTH-AUTH-032: a rejected sign-in shows the server’s message and keeps the form', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockJoinedLogin.mockRejectedValue({
      response: { data: { error: { message: 'Invalid email or password' } } },
    });

    const r = renderLogin();
    await typeCredentials(r, SEEDED_EMAIL, 'wrong-password');
    await submit(r);

    expect(treeText(r)).toContain('Invalid email or password');
    expect(alertSpy).toHaveBeenCalledWith('Login Failed', 'Invalid email or password');
    // No session, and the member is still on the form they can retry from.
    expect(mockLoginStore).not.toHaveBeenCalled();
    expect(r.root.findByProps({ testID: 'auth-email-input' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'auth-sign-in-submit' }).props.disabled).toBe(false);
    alertSpy.mockRestore();
  });

  it('HEALTH-AUTH-033: an unrecognisable failure falls back to enumeration-safe copy', async () => {
    // A 500, a CORS failure or a dropped connection all arrive without the error
    // envelope. The fallback must not say "no account with that email" — the
    // message is identical whether or not the account exists.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockJoinedLogin.mockRejectedValue(new Error('Network request failed'));

    const r = renderLogin();
    await typeCredentials(r, 'nobody@example.com', 'whatever');
    await submit(r);

    const text = treeText(r);
    expect(text).toContain('Invalid email or password');
    // Neither the raw system string nor an account-existence hint reaches the UI.
    expect(text).not.toContain('Network request failed');
    expect(text).not.toMatch(/no account|not found|does not exist|unknown user/i);
    alertSpy.mockRestore();
  });

  it('HEALTH-AUTH-034: the submit button unsticks after a failure', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockJoinedLogin.mockRejectedValue(new Error('boom'));

    const r = renderLogin();
    await typeCredentials(r, SEEDED_EMAIL, 'wrong');
    await submit(r);

    // `finally { setLoading(false) }` — a spinner left running would strand the
    // member on a screen with no way forward and no way back.
    expect(r.root.findByProps({ testID: 'auth-sign-in-submit' }).props.loading).toBe(false);

    // …and a second attempt with the right password still works.
    mockJoinedLogin.mockResolvedValue({
      user: { id: 'health-user', email: SEEDED_EMAIL },
      access_token: 'a2',
      refresh_token: 'r2',
    });
    await submit(r);
    expect(mockLoginStore).toHaveBeenCalledWith(expect.anything(), 'a2', 'r2');
    alertSpy.mockRestore();
  });
});

describe('Health login — the rest of the form (HEALTH-AUTH-035..036)', () => {
  it('HEALTH-AUTH-035: the password toggle flips masking and its accessibility label', async () => {
    const r = renderLogin();
    await typeCredentials(r, SEEDED_EMAIL, 'Andrei123!');

    const field = () => r.root.findByProps({ testID: 'auth-password-input' });
    const toggle = () => r.root.findByProps({ testID: 'auth-password-toggle' });

    expect(field().props.secureTextEntry).toBe(true);
    expect(toggle().props.accessibilityLabel).toBe('Show password');

    await act(async () => toggle().props.onPress());
    expect(field().props.secureTextEntry).toBe(false);
    expect(toggle().props.accessibilityLabel).toBe('Hide password');

    await act(async () => toggle().props.onPress());
    expect(field().props.secureTextEntry).toBe(true);
  });

  it('HEALTH-AUTH-036: Forgot password and Sign Up leave the login screen intact', async () => {
    const r = renderLogin();
    await typeCredentials(r, SEEDED_EMAIL, 'Andrei123!');

    await act(async () => {
      r.root.findByProps({ testID: 'auth-forgot-password' }).props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('ForgotPassword');

    await act(async () => {
      r.root.findByProps({ testID: 'auth-go-register' }).props.onPress();
    });
    // Registration is disabled fleet-wide, so this asserts the affordance
    // navigates — not that an account can be created (see matrix §0).
    expect(navigation.navigate).toHaveBeenCalledWith('Register');
    // Neither detour signs anybody in or fires a request.
    expect(mockJoinedLogin).not.toHaveBeenCalled();
    expect(mockLoginStore).not.toHaveBeenCalled();
  });
});
