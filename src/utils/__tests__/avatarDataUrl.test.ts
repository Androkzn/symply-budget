import * as FileSystem from 'expo-file-system/legacy';

import { avatarUriToDataUrl } from '../avatarDataUrl';

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
}));

const readAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;

describe('avatarUriToDataUrl', () => {
  beforeEach(() => {
    readAsStringAsync.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads native file URIs through expo-file-system', async () => {
    readAsStringAsync.mockResolvedValue('bmF0aXZl');

    await expect(
      avatarUriToDataUrl('file:///avatar.jpg', 'image/jpeg', 'ios'),
    ).resolves.toBe('data:image/jpeg;base64,bmF0aXZl');
  });

  it('reads Expo Web blob URLs through the browser instead of expo-file-system', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => ({
        arrayBuffer: async () => new TextEncoder().encode('web-avatar').buffer,
      }),
    } as Response);

    await expect(
      avatarUriToDataUrl('blob:http://localhost/avatar', 'image/png', 'web'),
    ).resolves.toMatch(/^data:image\/png;base64,/);
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('keeps an existing image data URL unchanged', async () => {
    const dataUrl = 'data:image/webp;base64,d2VicA==';
    await expect(avatarUriToDataUrl(dataUrl, 'image/webp', 'web')).resolves.toBe(dataUrl);
  });
});
