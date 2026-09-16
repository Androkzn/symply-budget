/**
 * Regression guard: the top-level `app.onError` handler (src/index.ts) must map
 * every ApiError subclass by name, in sync with the errorHandler middleware
 * (src/middleware/error-handler.ts).
 *
 * Routes mounted before `app.use('*', errorHandler())` surface their thrown
 * errors at `app.onError` instead of the middleware. If a subclass name is
 * missing from onError's allow-list it falls through to a generic 500 — which
 * is exactly what made `deleteRoom`/`setParticipants` on the dedicated AI
 * assistant room return 500 instead of a friendly 400 ("The AI assistant chat
 * can't be deleted."). Keep the two lists aligned so ApiErrors stay 4xx.
 */
import { describe, expect, it } from 'vitest';

import indexSource from '../index.ts?raw';
import middlewareSource from '../middleware/error-handler.ts?raw';

/** ApiError subclasses that must map to their statusCode (not a 500). */
const REQUIRED_API_ERRORS = [
  'ApiError',
  'ValidationError',
  'UnauthorizedError',
  'ForbiddenError',
  'NotFoundError',
  'BadRequestError',
  'ConflictError',
  'GoneError',
  'RateLimitError',
  'ServiceUnavailableError',
  'AIAccessError',
];

/** Extract the `apiErrorNames = [ ... ]` array literal from onError. */
function onErrorNames(): string[] {
  const m = indexSource.match(/apiErrorNames\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/'([A-Za-z]+Error)'/g)].map((x) => x[1]);
}

describe('app.onError ApiError mapping (regression)', () => {
  const names = onErrorNames();

  it('lists every required ApiError subclass by name', () => {
    for (const cls of REQUIRED_API_ERRORS) {
      expect(names, `onError must map ${cls} to its statusCode`).toContain(cls);
    }
  });

  it('explicitly includes BadRequestError (the assistant-room delete/participant path)', () => {
    expect(names).toContain('BadRequestError');
  });

  it('stays in sync with the errorHandler middleware allow-list', () => {
    // Every ApiError name the middleware maps must also be mapped by onError,
    // so an error surfacing at either handler yields the same 4xx (not a 500).
    const middlewareNames = new Set(
      [...middlewareSource.matchAll(/name === '([A-Za-z]+Error)'/g)].map((x) => x[1])
    );
    for (const cls of middlewareNames) {
      expect(names, `onError missing ${cls} that the middleware maps`).toContain(cls);
    }
  });
});
