/**
 * Joined platform auth adapter — House/Budget/Kaizen only.
 */
const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockRefresh = jest.fn();
const mockApple = jest.fn();
const mockGoogle = jest.fn();
const mockLogout = jest.fn();
const mockWipe = jest.fn();
const mockClearCompanion = jest.fn();
const mockSaveCompanion = jest.fn();
const mockPost = jest.fn();
const mockSetAuth = jest.fn();
const mockSetCompanionAuth = jest.fn();

const brandState = { id: 'symply-house' };

jest.mock('@brand', () => ({
  brand: brandState,
  hasBrandCapability: (capability: string) => {
    if (capability === 'platformAuthority') return brandState.id === 'symply-house';
    return true;
  },
}));

jest.mock('../auth', () => ({
  authApi: {
    login: (...args: unknown[]) => mockLogin(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    refreshToken: (...args: unknown[]) => mockRefresh(...args),
    appleAuth: (...args: unknown[]) => mockApple(...args),
    googleAuth: (...args: unknown[]) => mockGoogle(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
  },
}));

jest.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('../platform-spine', () => ({
  isJoinedPlatformBrand: () => true,
  resolveAuthAdapterKind: () => 'joined-platform',
}));

jest.mock('@services/secure-token-storage', () => ({
  wipeLegacyTokenKeys: (...args: unknown[]) => mockWipe(...args),
  clearCompanionToken: (...args: unknown[]) => mockClearCompanion(...args),
  saveCompanionToken: (...args: unknown[]) => mockSaveCompanion(...args),
}));

jest.mock('@services/widget-sync', () => ({
  widgetSync: {
    setAuth: (...args: unknown[]) => mockSetAuth(...args),
    setCompanionAuth: (...args: unknown[]) => mockSetCompanionAuth(...args),
  },
}));

import { joinedPlatformAuth, assertJoinedAuthAllowed } from '../joined-platform-auth';

describe('joinedPlatformAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    brandState.id = 'symply-house';
    mockLogin.mockResolvedValue({
      user: { id: 'u1' },
      access_token: 'a',
      refresh_token: 'r',
    });
    mockWipe.mockResolvedValue(undefined);
  });

  it('assertJoinedAuthAllowed succeeds for joined brand', () => {
    expect(() => assertJoinedAuthAllowed()).not.toThrow();
  });

  it('login wipes legacy keys after success', async () => {
    await joinedPlatformAuth.login('a@b.com', 'pass');
    expect(mockLogin).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pass' });
    expect(mockWipe).toHaveBeenCalled();
  });

  it('register / refresh / social wipe legacy keys', async () => {
    mockRegister.mockResolvedValue({ user: {}, access_token: 'a', refresh_token: 'r' });
    mockRefresh.mockResolvedValue({ access_token: 'a2', refresh_token: 'r2' });
    mockApple.mockResolvedValue({ user: {}, access_token: 'a', refresh_token: 'r' });
    mockGoogle.mockResolvedValue({ user: {}, access_token: 'a', refresh_token: 'r' });

    await joinedPlatformAuth.register('a@b.com', 'pass', 'Name');
    await joinedPlatformAuth.refresh('r');
    await joinedPlatformAuth.appleAuth({ identity_token: 't', authorization_code: 'c' });
    await joinedPlatformAuth.googleAuth({ id_token: 'g' });

    expect(mockWipe).toHaveBeenCalledTimes(4);
  });

  it('logout clears companion token', async () => {
    mockLogout.mockResolvedValue(undefined);
    mockClearCompanion.mockResolvedValue(undefined);
    await joinedPlatformAuth.logout('r');
    expect(mockClearCompanion).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalledWith('r');
  });

  it('mintCompanion stores companion JWT and widget auth context', async () => {
    mockPost.mockResolvedValue({
      data: { companion_token: 'companion.jwt', expires_in: 3600 },
    });
    mockSaveCompanion.mockResolvedValue(undefined);

    const data = await joinedPlatformAuth.mintCompanion('hh_1', 'u_1');
    expect(data.companion_token).toBe('companion.jwt');
    expect(mockSaveCompanion).toHaveBeenCalledWith('companion.jwt');
    expect(mockSetAuth).toHaveBeenCalledWith('hh_1', 'u_1');
    expect(mockSetCompanionAuth).toHaveBeenCalledWith('companion.jwt');
  });

  it('mintCompanion refuses non-House brand', async () => {
    brandState.id = 'symply-budget';
    await expect(joinedPlatformAuth.mintCompanion('hh', 'u')).rejects.toThrow(/House-only/);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
