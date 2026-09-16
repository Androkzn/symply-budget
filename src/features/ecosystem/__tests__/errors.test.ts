/**
 * Soft Transfer / Data-sharing error copy.
 *
 * The golden rule: the UI must NEVER show a raw backend/system string
 * ("Invalid or expired token", "unauthorized", a stack message). Every path
 * through `resolveSoftTransferErrorMessage` returns curated, user-friendly copy
 * keyed off the HTTP status category.
 */

import { AxiosError, AxiosHeaders } from 'axios';

import {
  SOFT_TRANSFER_DISABLED_MESSAGE,
  isSessionExpiredError,
  isSoftTransferDisabledError,
  resolveSoftTransferErrorMessage,
} from '../errors';

function axiosErrorWith(status: number | undefined, data?: unknown): AxiosError {
  const err = new AxiosError('Request failed with status code ' + status);
  if (status !== undefined) {
    err.response = {
      status,
      statusText: '',
      data,
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
  }
  return err;
}

describe('resolveSoftTransferErrorMessage', () => {
  it('never leaks the backend 401 "Invalid or expired token" string', () => {
    const err = axiosErrorWith(401, { error: { code: 'unauthorized', message: 'Invalid or expired token' } });
    const msg = resolveSoftTransferErrorMessage(err);
    expect(msg).not.toMatch(/invalid or expired token/i);
    expect(msg).not.toMatch(/unauthorized/i);
    expect(msg).toMatch(/session has expired/i);
  });

  it('maps a network failure (no response) to an offline message', () => {
    expect(resolveSoftTransferErrorMessage(axiosErrorWith(undefined))).toMatch(/couldn't reach the server/i);
  });

  it('maps 403 to a friendly no-access message', () => {
    expect(resolveSoftTransferErrorMessage(axiosErrorWith(403, { error: { message: 'forbidden' } }))).toMatch(
      /don't have access/i
    );
  });

  it('keeps the intentional Soft-Transfer-disabled message (a real user-facing 403)', () => {
    const err = axiosErrorWith(403, { error: { message: 'Soft Transfer is disabled for this environment' } });
    expect(isSoftTransferDisabledError(err)).toBe(true);
    expect(resolveSoftTransferErrorMessage(err)).toBe(SOFT_TRANSFER_DISABLED_MESSAGE);
  });

  it('maps 5xx to a server-problem message', () => {
    expect(resolveSoftTransferErrorMessage(axiosErrorWith(503))).toMatch(/server ran into a problem/i);
  });

  it('genericizes other 4xx without echoing the raw body', () => {
    const err = axiosErrorWith(409, { error: { message: 'consent_row_conflict' } });
    const msg = resolveSoftTransferErrorMessage(err);
    expect(msg).not.toMatch(/consent_row_conflict/);
    expect(msg).toMatch(/something went wrong/i);
  });

  it('genericizes plain thrown errors (system message never shown)', () => {
    expect(resolveSoftTransferErrorMessage(new Error('TypeError: undefined is not a function'))).toBe(
      'Something went wrong. Please try again.'
    );
  });

  it('isSessionExpiredError flags 401 only', () => {
    expect(isSessionExpiredError(axiosErrorWith(401))).toBe(true);
    expect(isSessionExpiredError(axiosErrorWith(500))).toBe(false);
    expect(isSessionExpiredError(new Error('nope'))).toBe(false);
  });
});
