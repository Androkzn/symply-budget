/**
 * ProfileScreen — avatar upload.
 *
 * Regression coverage for the "Failed to upload avatar" bug: the screen used
 * to convert the picked image via `fetch(uri).blob()` + `FileReader.readAsDataURL`,
 * which is unreliable for local `file://` URIs under the New Architecture. The
 * fix reads the file as base64 via `expo-file-system` (the pattern already used
 * everywhere else in the app for this exact conversion) and builds the data URL
 * from the picker's own reported mime type.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('@contexts/SubscriptionContext', () => ({
  __esModule: true,
  useSubscription: () => ({
    subscription: { status: 'active', provider: 'apple' },
    isPremium: false,
    refreshSubscription: jest.fn(),
  }),
}));

jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => ({ source: null, provider: null, byokConnections: [] }),
}));

const mockUpdateProfile = jest.fn(() => Promise.resolve());
const mockUser: { avatar_url: string | null } = { avatar_url: null };
jest.mock('@contexts/ProfileContext', () => ({
  __esModule: true,
  useProfile: () => ({
    user: {
      display_name: 'Andrei',
      email: 'a@example.com',
      email_verified: true,
      created_at: '2026-01-20T00:00:00.000Z',
      get avatar_url() {
        return mockUser.avatar_url;
      },
    },
    isLoading: false,
    updateProfile: mockUpdateProfile,
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

const mockOpenPicker = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openPicker: (...args: unknown[]) => mockOpenPicker(...args),
    openCamera: jest.fn(),
  },
}));

const mockReadAsStringAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
}));

jest.mock('@api/subscription', () => ({
  __esModule: true,
  subscriptionApi: { cancelSubscription: jest.fn(() => Promise.resolve({})) },
}));

import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';

import { renderOnDevice, pressables } from '../../../test-utils/deviceRender';
import { ProfileScreen } from '../ProfileScreen';

const avatarButton = (r: ReturnType<typeof renderOnDevice>) =>
  pressables(r).find(
    (p) => (p.props as { testID?: string }).testID === 'profile-avatar-edit'
  )!;

/**
 * A tile in the shared source sheet the avatar now opens.
 *
 * The avatar used to raise a two-option `Alert`; it is now the app-wide
 * Camera · Gallery · File · Drive sheet, so the gallery is a tile with a
 * testID rather than an alert button matched on its label.
 */
const sourceTile = (
  r: ReturnType<typeof renderOnDevice>,
  source: 'camera' | 'gallery' | 'file' | 'drive'
) =>
  pressables(r).find(
    (p) => (p.props as { testID?: string }).testID === `profile-avatar-${source}`
  );

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockUpdateProfile.mockClear();
  mockUpdateProfile.mockResolvedValue(undefined);
  mockOpenPicker.mockClear();
  mockReadAsStringAsync.mockClear();
  mockUser.avatar_url = null;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

const render = () =>
  renderOnDevice(
    'iPhone 14 Pro',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- nav/route props unused
    <ProfileScreen navigation={{} as any} route={{} as any} />
  );

const flush = () => new Promise((resolve) => setImmediate(resolve));

const pickFromLibrary = async (r: ReturnType<typeof renderOnDevice>) => {
  await act(async () => {
    avatarButton(r).props.onPress();
  });
  await act(async () => {
    sourceTile(r, 'gallery')!.props.onPress();
    // Flush the picker/processAndUploadImage async chain (file read →
    // catch/finally → setState) inside act() so React commits are batched.
    await flush();
    await flush();
  });
};

describe('ProfileScreen — avatar upload', () => {
  /**
   * The avatar reaches the same four sources as every other upload surface.
   *
   * It shipped with Take Photo and Choose from Library only, which excluded
   * anyone whose portrait had arrived by email (Files) or lived in a shared
   * Drive folder — silently, because a two-option picker works perfectly for
   * everyone else.
   */
  it('offers all four sources, not just camera and library', async () => {
    const r = render();
    await act(async () => {
      avatarButton(r).props.onPress();
    });

    for (const source of ['camera', 'gallery', 'file', 'drive'] as const) {
      expect(sourceTile(r, source)).toBeDefined();
    }
  });

  it('offers Remove only when there is a photo to remove', async () => {
    const r = render();
    await act(async () => {
      avatarButton(r).props.onPress();
    });
    const removeTile = () =>
      pressables(r).find(
        (p) =>
          (p.props as { testID?: string }).testID === 'profile-avatar-remove'
      );
    expect(removeTile()).toBeUndefined();

    mockUser.avatar_url = 'https://cdn/avatar.jpg';
    const withPhoto = render();
    await act(async () => {
      avatarButton(withPhoto).props.onPress();
    });
    expect(
      pressables(withPhoto).find(
        (p) =>
          (p.props as { testID?: string }).testID === 'profile-avatar-remove'
      )
    ).toBeDefined();
  });

  it('reads the picked file as base64 via expo-file-system and uploads a data URL', async () => {
    mockOpenPicker.mockResolvedValue({
      path: 'file:///tmp/mock-avatar.jpg',
      width: 400,
      height: 400,
      mime: 'image/jpeg',
      size: 12345,
    });
    mockReadAsStringAsync.mockResolvedValue('ZmFrZS1iYXNlNjQ=');

    const r = render();
    await pickFromLibrary(r);

    expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///tmp/mock-avatar.jpg', {
      encoding: 'base64',
    });
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      avatar_url: 'data:image/jpeg;base64,ZmFrZS1iYXNlNjQ=',
    });
    expect(alertSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      'Failed to upload avatar'
    );
  });

  it('surfaces the error alert when the file read fails, without crashing', async () => {
    mockOpenPicker.mockResolvedValue({
      path: 'file:///tmp/mock-avatar.jpg',
      width: 400,
      height: 400,
      mime: 'image/jpeg',
      size: 12345,
    });
    mockReadAsStringAsync.mockRejectedValue(new Error('read failed'));

    const r = render();
    await pickFromLibrary(r);

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('common.error', 'Failed to upload avatar');
  });
});
