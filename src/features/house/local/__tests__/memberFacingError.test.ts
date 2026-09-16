/**
 * `toMemberFacingError` — the piece that makes P4 copy actually reach a member.
 *
 * **Why this exists at all.** `unsupportedCopy.ts` put per-feature copy on
 * `HouseLocalUnsupportedError`, and that looked like the DoD line was met. An
 * audit of the screens showed it was not: no House screen renders it, and
 * `GarbageDetectScreen` — the one that appeared to — read the axios envelope:
 *
 * ```ts
 * (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
 * ```
 *
 * A local-first error never went near the network, so it has no `.response`,
 * so that expression is `undefined` every time and the member saw the screen's
 * own generic sentence. The copy existed and was unreachable.
 *
 * The ordering below is the whole contract, and it is the thing that would
 * silently regress: **deliberate local copy must beat a transport message**, and
 * both must beat the screen's fallback.
 */
import { HouseLocalNotReadyError, HouseLocalUnsupportedError } from '../errors';
import { memberFacingMessage, toMemberFacingError } from '../memberFacingError';
import { HOUSE_UNSUPPORTED_COPY } from '../unsupportedCopy';

const FALLBACK = 'We could not do that just now. Please try again.';

describe('a deliberately-disabled P4 feature', () => {
  it('shows its own copy, not the screen fallback', () => {
    const result = toMemberFacingError(
      new HouseLocalUnsupportedError('garbage-collection.aiDetect'),
      FALLBACK,
    );
    expect(result.message).toBe(HOUSE_UNSUPPORTED_COPY['garbage-collection.aiDetect']!.message);
    expect(result.message).not.toBe(FALLBACK);
  });

  it('carries a title a sheet or Alert can use', () => {
    const result = toMemberFacingError(
      new HouseLocalUnsupportedError('tasks.getTaskQuotes'),
      FALLBACK,
    );
    expect(result.title).toBe(HOUSE_UNSUPPORTED_COPY['tasks.getTaskQuotes']!.title);
  });

  it('is marked expected — it is a product state, not a failure', () => {
    // Screens can use this to choose an informational presentation over an
    // error one. "Photo detection is off in private mode" is not a crash.
    expect(
      toMemberFacingError(new HouseLocalUnsupportedError('tasks.getTaskQuotes'), FALLBACK).expected,
    ).toBe(true);
  });

  it('never leaks the method identifier', () => {
    const result = toMemberFacingError(
      new HouseLocalUnsupportedError('tasks.compareTaskQuotesWithAI'),
      FALLBACK,
    );
    expect(`${result.title} ${result.message}`).not.toContain('compareTaskQuotesWithAI');
  });
});

describe('the regression that motivated this file', () => {
  it('reads a local-first error that has NO .response at all', () => {
    // The exact shape the old axios-only extractor could not see. If this ever
    // returns the fallback again, the copy has gone unreachable a second time.
    const error = new HouseLocalUnsupportedError('garbage-collection.aiDetect');
    expect((error as unknown as { response?: unknown }).response).toBeUndefined();
    expect(memberFacingMessage(error, FALLBACK)).not.toBe(FALLBACK);
  });

  it('prefers local copy even when an error somehow carries both', () => {
    // Defence against a future wrapper that attaches a transport envelope to a
    // local error: the deliberate copy still wins.
    const hybrid = Object.assign(new HouseLocalUnsupportedError('tasks.getTaskQuotes'), {
      response: { data: { error: { message: 'Internal Server Error' } } },
    });
    expect(memberFacingMessage(hybrid, FALLBACK)).not.toBe('Internal Server Error');
  });
});

describe('genuine server errors still surface their message', () => {
  it('reads the nested /v2 envelope', () => {
    const err = { response: { data: { error: { code: 'quota_exceeded', message: 'Storage full' } } } };
    expect(memberFacingMessage(err, FALLBACK)).toBe('Storage full');
  });

  it('reads the flat legacy envelope', () => {
    expect(memberFacingMessage({ response: { data: { error: 'Not found' } } }, FALLBACK)).toBe(
      'Not found',
    );
  });

  it('reads a bare message field', () => {
    expect(memberFacingMessage({ response: { data: { message: 'Bad gateway' } } }, FALLBACK)).toBe(
      'Bad gateway',
    );
  });

  it('is not marked expected — these are real failures', () => {
    const err = { response: { data: { error: { message: 'Storage full' } } } };
    expect(toMemberFacingError(err, FALLBACK).expected).toBe(false);
  });
});

describe('falling back', () => {
  it.each([
    ['a bare Error', new Error('kaboom')],
    ['a string', 'kaboom'],
    ['null', null],
    ['undefined', undefined],
    ['an empty envelope', { response: { data: {} } }],
    ['a blank remote message', { response: { data: { error: { message: '   ' } } } }],
  ])('uses the screen fallback for %s', (_label, err) => {
    expect(memberFacingMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('never surfaces a raw thrown Error message to a member', () => {
    // `new Error('kaboom')` is developer text. The screen's own sentence is the
    // member-facing one, so it wins.
    expect(memberFacingMessage(new Error('TypeError: undefined is not a function'), FALLBACK)).toBe(
      FALLBACK,
    );
  });
});

describe('session-not-ready is explained, not reported as a fault', () => {
  it('gets its own reassuring copy', () => {
    const result = toMemberFacingError(new HouseLocalNotReadyError(), FALLBACK);
    expect(result.expected).toBe(true);
    expect(result.message).toMatch(/moment|nothing is lost/i);
    expect(result.message).not.toBe(FALLBACK);
  });

  it('does not leak the developer sentence from the error itself', () => {
    // `HouseLocalNotReadyError.message` says "Sign in once to provision the
    // local ledger" — accurate for an engineer, meaningless to a member.
    expect(toMemberFacingError(new HouseLocalNotReadyError(), FALLBACK).message).not.toContain(
      'provision',
    );
  });
});
