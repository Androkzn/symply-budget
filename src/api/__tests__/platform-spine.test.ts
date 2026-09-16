/**
 * Platform spine client gates — joined vs Language.
 */
const mockHasBrandCapability = jest.fn();
const mockIsJoinedPlatformBrand = jest.fn();

jest.mock('@brand', () => ({
  brand: { id: 'symply-house' },
  hasBrandCapability: (...args: unknown[]) => mockHasBrandCapability(...args),
  isJoinedPlatformBrand: (...args: unknown[]) => mockIsJoinedPlatformBrand(...args),
}));

jest.mock('@config/env', () => ({
  ENV: { IS_PRODUCTION: false },
}));

import {
  resolveAuthAdapterKind,
  getPlatformSpineApiUrl,
  createSpineClientHeaders,
} from '../platform-spine';

beforeEach(() => {
  mockHasBrandCapability.mockReset();
  mockIsJoinedPlatformBrand.mockReset();
  mockHasBrandCapability.mockImplementation((key: string, id?: string) => {
    if (key !== 'joinedPlatform') return false;
    const resolvedId = id ?? 'symply-house';
    return resolvedId !== 'symply-language';
  });
  mockIsJoinedPlatformBrand.mockImplementation((id?: string) =>
    mockHasBrandCapability('joinedPlatform', id ?? 'symply-house'),
  );
});

describe('platform-spine', () => {
  it('resolves joined-platform for House/Budget/Kaizen/Health', () => {
    expect(resolveAuthAdapterKind('symply-house')).toBe('joined-platform');
    expect(resolveAuthAdapterKind('symply-budget')).toBe('joined-platform');
    expect(resolveAuthAdapterKind('symply-kaizen')).toBe('joined-platform');
    expect(resolveAuthAdapterKind('symply-health')).toBe('joined-platform');
  });

  it('resolves language-legacy for Language only', () => {
    expect(resolveAuthAdapterKind('symply-language')).toBe('language-legacy');
  });

  it('throws for unknown brand', () => {
    mockIsJoinedPlatformBrand.mockReturnValue(false);
    expect(() => resolveAuthAdapterKind('unknown-brand')).toThrow(/Unknown brand/);
  });

  it('returns staging House spine URL for joined brands', () => {
    expect(getPlatformSpineApiUrl()).toBe(
      'https://simple-house-api-staging.a-tekhtelev.workers.dev'
    );
  });

  it('includes caller brand header', () => {
    const headers = createSpineClientHeaders('tok') as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-Platform-Caller-Brand']).toBe('symply-house');
  });

  it('refuses spine URL when joinedPlatform capability is false', () => {
    mockHasBrandCapability.mockReturnValue(false);
    expect(() => getPlatformSpineApiUrl()).toThrow(/refused/);
  });
});
