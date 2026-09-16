/**
 * Inter-worker client — edge tokens + HTTP fallback guards.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  fetchSiblingHttp,
  getHouseService,
  getBudgetService,
  getKaizenService,
} from '../../src/services/inter-worker-client';

import { baseEnv } from './helpers';

describe('service binding getters', () => {
  it('returns bindings when present', () => {
    const ping = async () => ({ ok: true as const, brand: 'symply-house' });
    const env = baseEnv({
      APP_BRAND: 'symply-budget',
      HOUSE_SERVICE: { ping },
      BUDGET_SERVICE: { ping },
      KAIZEN_SERVICE: { ping },
    });
    expect(getHouseService(env)?.ping).toBeTypeOf('function');
    expect(getBudgetService(env)?.ping).toBeTypeOf('function');
    expect(getKaizenService(env)?.ping).toBeTypeOf('function');
  });
});

describe('fetchSiblingHttp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when fallback URL missing', async () => {
    const env = baseEnv({ APP_BRAND: 'symply-budget' });
    await expect(fetchSiblingHttp(env, 'house', '/auth/login', { method: 'POST' })).rejects.toThrow(
      /house_unreachable/
    );
  });

  it('attaches caller brand + Budget→House service token', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const env = baseEnv({
      APP_BRAND: 'symply-budget',
      HOUSE_API_FALLBACK_URL: 'https://house.example/',
      PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE: 'budget-token',
    });

    await fetchSiblingHttp(env, 'house', 'auth/login', {
      method: 'POST',
      body: '{}',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined];
    const url = String(call[0]);
    const headers = new Headers(call[1]?.headers);
    expect(url).toContain('https://house.example/auth/login');
    expect(headers.get('X-Platform-Caller-Brand')).toBe('symply-budget');
    expect(headers.get('X-Platform-Service-Token')).toBe('budget-token');
  });

  it('attaches House→Kaizen token when House calls Kaizen', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const env = baseEnv({
      APP_BRAND: 'symply-house',
      KAIZEN_API_FALLBACK_URL: 'https://kaizen.example',
      PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN: 'house-kaizen',
    });

    await fetchSiblingHttp(env, 'kaizen', '/health');
    const call = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined];
    const headers = new Headers(call[1]?.headers);
    expect(headers.get('X-Platform-Service-Token')).toBe('house-kaizen');
    expect(headers.get('X-Platform-Caller-Brand')).toBe('symply-house');
  });
});
