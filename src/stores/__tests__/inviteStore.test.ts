/**
 * Invite deep-link helpers.
 *
 * Guards the fix for the "Invite Unavailable on every launch" bug: a one-time
 * invite tap was being replayed on every cold start because
 * `Linking.getInitialURL()` keeps returning the original launch URL. The
 * dedup lives in `shouldForwardInviteToken` — a cold-start URL is honored only
 * the first time its token is seen, while warm (`url` event) taps always are.
 */

import { parseJoinToken, shouldForwardInviteToken } from '@stores/inviteStore';

describe('parseJoinToken', () => {
  it('extracts the token from a full `/join/<token>` universal link', () => {
    expect(parseJoinToken('https://simplehouse.app/join/abc123')).toBe('abc123');
  });

  it('extracts the code from a short `/j/<code>` link', () => {
    expect(parseJoinToken('https://simplehouse.app/j/XY7Q')).toBe('XY7Q');
  });

  it('handles the custom scheme and strips query/hash', () => {
    expect(parseJoinToken('simplehouse://join/tok-9?ref=sms#x')).toBe('tok-9');
  });

  it('url-decodes the captured token', () => {
    expect(parseJoinToken('https://simplehouse.app/join/a%20b')).toBe('a b');
  });

  it('returns null for non-invite urls and empty input', () => {
    expect(parseJoinToken('https://simplehouse.app/tasks/1')).toBeNull();
    expect(parseJoinToken(null)).toBeNull();
    expect(parseJoinToken(undefined)).toBeNull();
    expect(parseJoinToken('')).toBeNull();
  });
});

describe('shouldForwardInviteToken', () => {
  it('honors a cold-start initial URL the first time its token is seen', () => {
    expect(
      shouldForwardInviteToken({ token: 'abc', handledToken: undefined, fromInitialUrl: true })
    ).toBe(true);
  });

  it('ignores a cold-start initial URL whose token was already handled (the bug)', () => {
    // The OS re-delivers the launch URL on every relaunch — this must NOT replay.
    expect(
      shouldForwardInviteToken({ token: 'abc', handledToken: 'abc', fromInitialUrl: true })
    ).toBe(false);
  });

  it('honors a cold-start initial URL when a different invite was handled before', () => {
    expect(
      shouldForwardInviteToken({ token: 'new-token', handledToken: 'old-token', fromInitialUrl: true })
    ).toBe(true);
  });

  it('always honors a warm `url` event, even for an already-handled token', () => {
    // A live tap while the app is running is a genuine user action.
    expect(
      shouldForwardInviteToken({ token: 'abc', handledToken: 'abc', fromInitialUrl: false })
    ).toBe(true);
    expect(
      shouldForwardInviteToken({ token: 'abc', handledToken: undefined, fromInitialUrl: false })
    ).toBe(true);
  });
});
