import * as Linking from 'expo-linking';

import {
  buildE2ELoginUrl,
  consumeE2ELogin,
  hasPendingE2ELogin,
  subscribeE2ELogin,
  trySetE2ELoginFromUrl,
} from '../e2e-autologin';

jest.mock('expo-linking', () => ({
  parse: jest.fn(),
}));

describe('e2e-autologin', () => {
  beforeEach(() => {
    consumeE2ELogin();
    jest.clearAllMocks();
  });

  it('buildE2ELoginUrl encodes email and password for Maestro openLink', () => {
    expect(buildE2ELoginUrl('a.tekhtelev@gmail.com', 'Andrei123!')).toBe(
      'simplehouse://e2e-login?submit=1&email=a.tekhtelev%40gmail.com&password=Andrei123%21'
    );
  });

  it('stores credentials from the e2e-login deep link in dev', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: {
        email: 'test@example.com',
        password: 'secret',
        submit: '1',
      },
    });

    expect(trySetE2ELoginFromUrl('simplehouse://e2e-login?submit=1')).toBe(true);

    const credentials = consumeE2ELogin();
    expect(credentials).toEqual({
      email: 'test@example.com',
      password: 'secret',
      autoSubmit: true,
    });
    expect(hasPendingE2ELogin()).toBe(false);
  });

  it('accepts /e2e-login path and submit=true', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: null,
      path: '/e2e-login',
      queryParams: {
        email: 'user@example.com',
        password: 'pass',
        submit: 'true',
      },
    });

    expect(trySetE2ELoginFromUrl('simplehouse:///e2e-login?submit=true')).toBe(true);

    expect(consumeE2ELogin()).toEqual({
      email: 'user@example.com',
      password: 'pass',
      autoSubmit: true,
    });
  });

  it('stores credentials without autoSubmit when submit is absent', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: {
        email: 'test@example.com',
        password: 'secret',
      },
    });

    expect(trySetE2ELoginFromUrl('simplehouse://e2e-login')).toBe(true);

    expect(consumeE2ELogin()).toEqual({
      email: 'test@example.com',
      password: 'secret',
      autoSubmit: false,
    });
  });

  it('rejects e2e-login URLs missing email or password', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: { email: 'only-email@example.com' },
    });
    expect(trySetE2ELoginFromUrl('simplehouse://e2e-login')).toBe(false);
    expect(consumeE2ELogin()).toBeNull();

    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: { password: 'only-password' },
    });
    expect(trySetE2ELoginFromUrl('simplehouse://e2e-login')).toBe(false);
    expect(consumeE2ELogin()).toBeNull();
  });

  it('ignores unrelated URLs', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'join',
      queryParams: { token: 'abc' },
    });

    expect(trySetE2ELoginFromUrl('simplehouse://join/abc')).toBe(false);
    expect(consumeE2ELogin()).toBeNull();
  });

  it('notifies subscribeE2ELogin listeners when credentials arrive', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: {
        email: 'listener@example.com',
        password: 'secret',
        submit: '1',
      },
    });

    const listener = jest.fn();
    const unsubscribe = subscribeE2ELogin(listener);

    expect(trySetE2ELoginFromUrl('simplehouse://e2e-login')).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      email: 'listener@example.com',
      password: 'secret',
      autoSubmit: true,
    });

    unsubscribe();
    listener.mockClear();

    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: {
        email: 'second@example.com',
        password: 'secret',
      },
    });
    trySetE2ELoginFromUrl('simplehouse://e2e-login');
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns false outside dev builds', () => {
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-login',
      queryParams: {
        email: 'test@example.com',
        password: 'secret',
      },
    });

    expect(trySetE2ELoginFromUrl('simplehouse://e2e-login')).toBe(false);
    expect(consumeE2ELogin()).toBeNull();

    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  });
});
