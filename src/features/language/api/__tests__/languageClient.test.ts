/**
 * Covers the low-level Language fetch client: base-URL + `/api/v1` prefixing,
 * bearer-auth header injection, JSON (de)serialization, the one-shot 401 →
 * refresh → retry flow (donor contract), and error mapping to LanguageApiError.
 * The shared authStore and env are mocked so this exercises the real client.
 */
const mockAuthState: {
  token: string | null;
  refreshToken: string | null;
  setTokens: jest.Mock;
} = { token: 'AT', refreshToken: 'RT', setTokens: jest.fn() };

jest.mock('@config/env', () => ({ ENV: { API_BASE_URL: 'https://lang.test' } }));
jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => mockAuthState },
}));

import { languageRequest, LanguageApiError, LANGUAGE_API_PREFIX } from '../languageClient';

function mockResponse(status: number, body: unknown, ok?: boolean): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    text: async () => text,
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  mockAuthState.token = 'AT';
  mockAuthState.refreshToken = 'RT';
  mockAuthState.setTokens = jest.fn();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('languageRequest — URL + headers', () => {
  it('prefixes the base URL and /api/v1, defaults to GET with auth header', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
    const res = await languageRequest<{ ok: boolean }>('/assessment/status');

    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://lang.test${LANGUAGE_API_PREFIX}/assessment/status`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer AT');
    expect(init.headers['content-type']).toBe('application/json');
    // GET with no body must not serialize a body.
    expect(init.body).toBeUndefined();
  });

  it('serializes the body and honors the method for writes', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { created: true }));
    await languageRequest('/cards', { method: 'POST', body: { word: 'hola' } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ word: 'hola' }));
  });

  it('omits the Authorization header when auth:false', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
    await languageRequest('/auth/login', { method: 'POST', body: {}, auth: false });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('omits Authorization when auth is on but no token exists', async () => {
    mockAuthState.token = null;
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
    await languageRequest('/user/profile');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('forwards an AbortSignal', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
    await languageRequest('/progress', { signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('languageRequest — 401 refresh + retry', () => {
  it('refreshes once on 401 then retries the original request with the new token', async () => {
    // 1) original → 401, 2) refresh → new tokens, 3) retry → 200
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(mockResponse(200, { accessToken: 'AT2', refreshToken: 'RT2' }))
      .mockImplementationOnce((url: string, init: RequestInit) => {
        // authStore.setTokens is a mock, so the retry still reads the OLD token
        // from state — assert the refresh endpoint + retry were attempted.
        expect(url).toBe(`https://lang.test${LANGUAGE_API_PREFIX}/progress`);
        void init;
        return Promise.resolve(mockResponse(200, { retried: true }));
      });

    const res = await languageRequest<{ retried: boolean }>('/progress');

    expect(res).toEqual({ retried: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
    expect(refreshUrl).toBe(`https://lang.test${LANGUAGE_API_PREFIX}/auth/refresh`);
    expect(JSON.parse(refreshInit.body)).toEqual({ refreshToken: 'RT' });
    expect(mockAuthState.setTokens).toHaveBeenCalledWith('AT2', 'RT2');
  });

  it('does not retry when there is no refresh token', async () => {
    mockAuthState.refreshToken = null;
    fetchMock.mockResolvedValueOnce(mockResponse(401, { error: 'expired' }));

    await expect(languageRequest('/progress')).rejects.toThrow(LanguageApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when retryOnAuth:false', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { error: 'expired' }));
    await expect(languageRequest('/progress', { retryOnAuth: false })).rejects.toThrow(
      LanguageApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a thrown refresh request and surfaces the original 401', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { error: 'expired' }))
      .mockRejectedValueOnce(new Error('network down during refresh'));

    await expect(languageRequest('/progress')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockAuthState.setTokens).not.toHaveBeenCalled();
  });

  it('does not retry when the refresh returns a body without tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(mockResponse(200, { accessToken: 'AT2' })); // missing refreshToken

    await expect(languageRequest('/progress')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockAuthState.setTokens).not.toHaveBeenCalled();
  });

  it('surfaces the original 401 when the refresh itself fails', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(mockResponse(500, { error: 'nope' }));

    await expect(languageRequest('/progress')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockAuthState.setTokens).not.toHaveBeenCalled();
  });

  it('does not attempt refresh for a 401 on an unauthenticated request', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { error: 'bad creds' }));
    await expect(
      languageRequest('/auth/login', { method: 'POST', body: {}, auth: false }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('languageRequest — error mapping', () => {
  it('maps a 4xx validation error to a generic, status-identifiable message — never the raw server body', async () => {
    // `languageErrorMessage` deliberately does not echo `body.error` for a
    // status like 422: surfacing the donor backend's raw error text
    // unmapped would leak server-internal wording into the UI.
    fetchMock.mockResolvedValueOnce(mockResponse(422, { error: 'Invalid card' }));
    await expect(languageRequest('/cards', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'LanguageApiError',
      status: 422,
      message: 'Language request failed (422)',
    });
  });

  it('maps any 5xx status to the generic service-unreachable message, regardless of body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(500, { detail: 'boom' }));
    await expect(languageRequest('/progress')).rejects.toThrow(
      'The service could not be reached just now. Please try again.'
    );
  });

  it('falls back to a status-identifiable message for an unmapped 4xx with no error field', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(400, {}));
    await expect(languageRequest('/progress')).rejects.toThrow('Language request failed (400)');
  });

  it('handles a non-JSON error body without throwing a parse error', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(502, 'Bad Gateway'));
    const err = await languageRequest('/progress').catch((e) => e);
    expect(err).toBeInstanceOf(LanguageApiError);
    if (!(err instanceof LanguageApiError)) throw err;
    expect(err.status).toBe(502);
    expect(err.body).toBe('Bad Gateway');
  });
});

describe('languageRequest — body parsing', () => {
  it('returns undefined for an empty 200 body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, ''));
    const res = await languageRequest('/plan', { method: 'PUT', body: {} });
    expect(res).toBeUndefined();
  });

  it('returns the raw string when a 200 body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, 'pong'));
    const res = await languageRequest<string>('/health');
    expect(res).toBe('pong');
  });
});
