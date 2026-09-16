/**
 * BUDGET-CORNER-025 — the client half of the divergent brand-gate 404 envelope.
 *
 * The Worker returns two different bodies for the same 404:
 *   requireBrandCapability() → { error: { code: 'not_found', message: 'Not found' } }
 *   requireBudgetApi()       → { error: 'Not found' }                  ← bare string
 *
 * The client error path must render a usable message for BOTH and must never
 * produce "[object Object]" or crash reading `.code` off a string. Server half:
 * `backend/src/middleware/__tests__/brand-gate.test.ts`.
 */
import { AxiosError, AxiosHeaders } from 'axios';

import { extractApiErrorCode } from '@/errors/AIAccessError';
import { getApiErrorMessage } from '@utils/apiError';

/** The exact bodies the two middlewares emit (kept literal on purpose). */
const CAPABILITY_BODY = { error: { code: 'not_found', message: 'Not found' } };
const BUDGET_BODY = { error: 'Not found' };

function mk404(data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders(), url: '/households/hh_1/utilities' };
  const error = new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', config);
  error.response = {
    status: 404,
    statusText: 'Not Found',
    data,
    headers: {},
    config,
  } as AxiosError['response'];
  return error;
}

const FALLBACK = "That feature isn't available in this app.";

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  // getApiErrorMessage logs the raw error in __DEV__ — keep the output clean.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('getApiErrorMessage — object envelope (requireBrandCapability)', () => {
  it('BUDGET-CORNER-025: renders the server message for the { code, message } shape', () => {
    expect(getApiErrorMessage(mk404(CAPABILITY_BODY), FALLBACK)).toBe('Not found');
  });

  it('BUDGET-CORNER-025: never yields "[object Object]" for the object shape', () => {
    const msg = getApiErrorMessage(mk404(CAPABILITY_BODY), FALLBACK);
    expect(msg).not.toContain('[object Object]');
    expect(typeof msg).toBe('string');
  });
});

describe('getApiErrorMessage — string envelope (requireBudgetApi)', () => {
  it('BUDGET-CORNER-025: falls back to a readable message for the bare-string shape', () => {
    // `body.error` is a string, so `body.error.code` is undefined and the
    // user-facing check fails → the caller's fallback is shown. Crucially the
    // string is never stringified into the toast.
    const msg = getApiErrorMessage(mk404(BUDGET_BODY), FALLBACK);
    expect(msg).toBe(FALLBACK);
    expect(msg).not.toContain('[object Object]');
  });

  it('BUDGET-CORNER-025: does not throw reading .code off a string error body', () => {
    expect(() => getApiErrorMessage(mk404(BUDGET_BODY), FALLBACK)).not.toThrow();
  });
});

describe('getApiErrorMessage — both shapes together', () => {
  it('BUDGET-CORNER-025: every gate body yields a non-empty, non-"[object Object]" string', () => {
    for (const body of [CAPABILITY_BODY, BUDGET_BODY, { error: null }, {}, undefined]) {
      const msg = getApiErrorMessage(mk404(body), FALLBACK);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain('[object Object]');
      expect(msg).not.toContain('undefined');
    }
  });

  it('BUDGET-CORNER-025: a non-Axios throw still renders the fallback', () => {
    expect(getApiErrorMessage(new Error('boom'), FALLBACK)).toBe(FALLBACK);
    expect(getApiErrorMessage('a bare string', FALLBACK)).toBe(FALLBACK);
    expect(getApiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });
});

describe('extractApiErrorCode — the interceptor path', () => {
  it('BUDGET-CORNER-025: extracts not_found from the object shape', () => {
    expect(extractApiErrorCode(CAPABILITY_BODY)).toBe('not_found');
  });

  it('BUDGET-CORNER-025: returns undefined (never throws) for the string shape', () => {
    // The client interceptor does `error?.code ?? code` on the body — with a
    // string `error` that is undefined, which must not become a truthy code.
    expect(() =>
      extractApiErrorCode(BUDGET_BODY as unknown as { error?: { code?: string } })
    ).not.toThrow();
    expect(extractApiErrorCode(BUDGET_BODY as unknown as { error?: { code?: string } })).toBeUndefined();
  });

  it('BUDGET-CORNER-025: neither 404 shape is mistaken for an AI-access denial', () => {
    for (const body of [CAPABILITY_BODY, BUDGET_BODY]) {
      const code = extractApiErrorCode(body as unknown as { error?: { code?: string } });
      expect(code === 'ai_access_required').toBe(false);
    }
  });
});
