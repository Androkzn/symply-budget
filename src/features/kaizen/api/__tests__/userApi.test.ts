/**
 * Symply Life (brand `symply-kaizen`) — userApi shim tests.
 *
 * The shim re-exports the ecosystem `@api/user` unchanged and layers the interim
 * `uploadAvatar` / `deleteAvatar` affordances on top. We mock the ecosystem module
 * so we can assert the shim preserves it verbatim and that the interim methods
 * behave as documented (upload throws, delete is a client-side no-op).
 *
 * The factory is inlined (not a closed-over const) so the mocked object is fully
 * populated when the shim spreads it at import time; we read the same reference
 * back through the mocked module for the identity assertions.
 */
jest.mock('@api/user', () => ({
  userApi: {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    getSessions: jest.fn(),
  },
}));

import { userApi as ecosystemUserApi } from '@api/user';

import { userApi } from '../userApi';

describe('kaizen userApi shim', () => {
  it('re-exports every ecosystem userApi method unchanged', () => {
    expect(userApi.getProfile).toBe(ecosystemUserApi.getProfile);
    expect(userApi.updateProfile).toBe(ecosystemUserApi.updateProfile);
    expect(userApi.getSessions).toBe(ecosystemUserApi.getSessions);
  });

  it('uploadAvatar rejects — avatar upload is not wired yet (Stage 6)', async () => {
    await expect(userApi.uploadAvatar({ uri: 'file://a.jpg' })).rejects.toThrow(
      'Avatar upload is not available yet.',
    );
  });

  it('deleteAvatar resolves to undefined (client-side no-op)', async () => {
    await expect(userApi.deleteAvatar()).resolves.toBeUndefined();
  });
});
