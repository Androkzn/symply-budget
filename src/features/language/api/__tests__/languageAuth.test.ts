/**
 * Verifies the Language auth adapter maps the donor `/api/v1/auth/*` contract
 * (camelCase tokens/user) onto the platform `authApi` shapes the shared
 * LoginScreen + authStore expect (snake_case). Mirrors the live-verified flow.
 */
const mockRequest = jest.fn();
jest.mock('../languageClient', () => ({
  languageRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { languageAuthApi } from '../languageAuth';

const DONOR_AUTH = {
  user: { id: 'u1', email: 'ann@example.com', displayName: 'Ann Lee', avatarUrl: null },
  accessToken: 'AT',
  refreshToken: 'RT',
};

beforeEach(() => mockRequest.mockReset());

describe('languageAuthApi.login', () => {
  it('maps donor camelCase response to platform snake_case AuthResponse', async () => {
    mockRequest.mockResolvedValue(DONOR_AUTH);
    const res = await languageAuthApi.login({ email: 'ann@example.com', password: 'pw' });

    expect(mockRequest).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { email: 'ann@example.com', password: 'pw' },
      auth: false,
    });
    expect(res.access_token).toBe('AT');
    expect(res.refresh_token).toBe('RT');
    expect(res.user.display_name).toBe('Ann Lee');
    expect(res.user.avatar_url).toBeNull();
    // A fresh Language login always routes through learner onboarding.
    expect(res.user.has_completed_onboarding).toBe(false);
    expect(res.expires_in).toBeGreaterThan(0);
  });

  it('maps a null donor displayName to a null platform display_name', async () => {
    mockRequest.mockResolvedValue({
      user: { id: 'u2', email: 'no-name@example.com', displayName: null, avatarUrl: null },
      accessToken: 'AT',
      refreshToken: 'RT',
    });
    const res = await languageAuthApi.login({ email: 'no-name@example.com', password: 'pw' });
    expect(res.user.display_name).toBeNull();
    expect(res.user.avatar_url).toBeNull();
    // House-only onboarding flags default off for the Language brand.
    expect(res.user.has_apple).toBe(false);
    expect(res.user.has_google).toBe(false);
    expect(res.user.has_password).toBe(true);
  });
});

describe('languageAuthApi.register', () => {
  it('sends display_name to the donor as displayName', async () => {
    mockRequest.mockResolvedValue(DONOR_AUTH);
    await languageAuthApi.register({ email: 'ann@example.com', password: 'pw', display_name: 'Ann Lee' });

    expect(mockRequest).toHaveBeenCalledWith('/auth/register', {
      method: 'POST',
      body: { email: 'ann@example.com', password: 'pw', displayName: 'Ann Lee' },
      auth: false,
    });
  });
});

describe('languageAuthApi.refreshToken', () => {
  it('maps { refresh_token } → donor { refreshToken } and back', async () => {
    mockRequest.mockResolvedValue({ accessToken: 'AT2', refreshToken: 'RT2' });
    const res = await languageAuthApi.refreshToken('RT');

    expect(mockRequest).toHaveBeenCalledWith('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: 'RT' },
      auth: false,
    });
    expect(res.access_token).toBe('AT2');
    expect(res.refresh_token).toBe('RT2');
  });
});

describe('languageAuthApi.googleAuth', () => {
  it('maps { id_token } → donor { idToken } and flags is_new_user', async () => {
    mockRequest.mockResolvedValue(DONOR_AUTH);
    const res = await languageAuthApi.googleAuth({ id_token: 'GID' });

    expect(mockRequest).toHaveBeenCalledWith('/auth/google', {
      method: 'POST',
      body: { idToken: 'GID' },
      auth: false,
    });
    expect(res.is_new_user).toBe(false);
    expect(res.access_token).toBe('AT');
  });
});

describe('languageAuthApi.appleAuth', () => {
  it('joins the first + last name into displayName and maps identity token', async () => {
    mockRequest.mockResolvedValue(DONOR_AUTH);
    const res = await languageAuthApi.appleAuth({
      identity_token: 'ID',
      authorization_code: 'CODE',
      user: { email: 'ann@example.com', name: { firstName: 'Ann', lastName: 'Lee' } },
    });

    expect(mockRequest).toHaveBeenCalledWith('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'ID', email: 'ann@example.com', displayName: 'Ann Lee' },
      auth: false,
    });
    expect(res.is_new_user).toBe(false);
    expect(res.access_token).toBe('AT');
  });

  it('sends displayName undefined when no name is provided', async () => {
    mockRequest.mockResolvedValue(DONOR_AUTH);
    await languageAuthApi.appleAuth({ identity_token: 'ID', authorization_code: 'CODE' });

    expect(mockRequest).toHaveBeenCalledWith('/auth/apple', {
      method: 'POST',
      body: { identityToken: 'ID', email: undefined, displayName: undefined },
      auth: false,
    });
  });
});

describe('languageAuthApi.logout', () => {
  it('is a client-side no-op (donor has no /logout)', async () => {
    await expect(languageAuthApi.logout('RT')).resolves.toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('languageAuthApi.forgotPassword', () => {
  it('POSTs the email and passes the server message through', async () => {
    mockRequest.mockResolvedValue({ message: 'Sent!' });
    const res = await languageAuthApi.forgotPassword('ann@example.com');
    expect(mockRequest).toHaveBeenCalledWith('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'ann@example.com' },
      auth: false,
    });
    expect(res.message).toBe('Sent!');
  });

  it('falls back to a default message when the server omits one', async () => {
    mockRequest.mockResolvedValue({});
    const res = await languageAuthApi.forgotPassword('ann@example.com');
    expect(res.message).toBe('If that email exists, a reset link was sent.');
  });
});

describe('languageAuthApi.resetPassword', () => {
  it('maps password → donor newPassword and passes the message through', async () => {
    mockRequest.mockResolvedValue({ message: 'Done' });
    const res = await languageAuthApi.resetPassword('tok', 'newpw');
    expect(mockRequest).toHaveBeenCalledWith('/auth/reset-password', {
      method: 'POST',
      body: { token: 'tok', newPassword: 'newpw' },
      auth: false,
    });
    expect(res.message).toBe('Done');
  });

  it('falls back to a default success message', async () => {
    mockRequest.mockResolvedValue({});
    const res = await languageAuthApi.resetPassword('tok', 'newpw');
    expect(res.message).toBe('Password reset successfully');
  });
});
