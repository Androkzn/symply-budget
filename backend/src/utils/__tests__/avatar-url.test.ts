import { describe, expect, it } from 'vitest';

import { avatarKeyFor, avatarKeyFromStored, resolveAvatarUrl } from '../avatar-url';

/**
 * `users.avatar_url` was the one column in the schema storing our own hostname,
 * frozen in at upload time. Every child app's D1 was cloned from House, so nine
 * rows across the fleet named `simple-house-api` — including House STAGING
 * naming House PRODUCTION — and the R2 objects never travelled with the clone.
 *
 * Resolving at read time is what removes the cross-app dependency, so these
 * cases pin the three shapes that reach it and, above all, the one it must NOT
 * touch: a social-sign-in picture. Rewriting those would blank the avatar of
 * every member who signed in with Google or Apple.
 */
const BUDGET = 'https://simple-budget-api-staging.example.workers.dev';
const HOUSE = 'https://simple-house-api.example.workers.dev';

describe('resolveAvatarUrl', () => {
  it('serves a stored key from the reading app', () => {
    expect(resolveAvatarUrl('avatars/u1-123.jpg', BUDGET)).toBe(`${BUDGET}/avatars/u1-123.jpg`);
  });

  /** The whole point: a cloned row stops pointing at the app it came from. */
  it('re-hosts a legacy URL that names another app', () => {
    expect(resolveAvatarUrl(`${HOUSE}/avatars/u1-123.jpg`, BUDGET)).toBe(
      `${BUDGET}/avatars/u1-123.jpg`,
    );
  });

  it('re-hosts a legacy URL that names this app, unchanged in effect', () => {
    expect(resolveAvatarUrl(`${BUDGET}/avatars/u1-123.jpg`, BUDGET)).toBe(
      `${BUDGET}/avatars/u1-123.jpg`,
    );
  });

  /**
   * Guard rail. Provider pictures are not ours to re-host — pointing them at
   * our own `/avatars/` would 404 every social-sign-in member at once.
   */
  it('leaves a social sign-in picture alone', () => {
    const google = 'https://lh3.googleusercontent.com/a/ACg8ocK123=s96-c';
    expect(resolveAvatarUrl(google, BUDGET)).toBe(google);
  });

  it('has no avatar to resolve for null, undefined or empty', () => {
    expect(resolveAvatarUrl(null, BUDGET)).toBeNull();
    expect(resolveAvatarUrl(undefined, BUDGET)).toBeNull();
    expect(resolveAvatarUrl('', BUDGET)).toBeNull();
  });

  it('tolerates a trailing slash on the configured host', () => {
    expect(resolveAvatarUrl('avatars/u1.jpg', `${BUDGET}/`)).toBe(`${BUDGET}/avatars/u1.jpg`);
  });

  /** A bare filename, from any older write path. */
  it('accepts a filename with no prefix', () => {
    expect(resolveAvatarUrl('u1-123.jpg', BUDGET)).toBe(`${BUDGET}/avatars/u1-123.jpg`);
  });
});

describe('avatarKeyFromStored', () => {
  it('reads the key back out of both stored shapes', () => {
    expect(avatarKeyFromStored('avatars/u1-123.jpg')).toBe('avatars/u1-123.jpg');
    expect(avatarKeyFromStored(`${HOUSE}/avatars/u1-123.jpg`)).toBe('avatars/u1-123.jpg');
  });

  /**
   * Delete-on-replace runs through this. Returning a key for a provider
   * picture would try to delete an object we never stored.
   */
  it('claims no key for a picture we do not own', () => {
    expect(avatarKeyFromStored('https://lh3.googleusercontent.com/a/ACg8ocK123')).toBeNull();
    expect(avatarKeyFromStored(null)).toBeNull();
  });
});

describe('avatarKeyFor', () => {
  it('stores a key, never a host', () => {
    const key = avatarKeyFor('u1-123.jpg');
    expect(key).toBe('avatars/u1-123.jpg');
    expect(key).not.toMatch(/^https?:/);
  });
});

/**
 * The round trip, which is how the first fix leaked.
 *
 * Reads hand the client a resolved ABSOLUTE url, and a profile save posts it
 * back. The update path stored that verbatim ("it's already a URL"), so every
 * save re-froze the reading Worker's host into the row — observed re-poisoning
 * a row with `simple-house-api-staging` one minute after the migration.
 */
describe('profile save round trip', () => {
  const store = (incoming: string) => avatarKeyFromStored(incoming) ?? incoming;

  it('normalizes our own resolved url back down to a key', () => {
    expect(store(`${BUDGET}/avatars/u1-123.jpg`)).toBe('avatars/u1-123.jpg');
  });

  /** Even one naming a different app — the row must not carry it forward. */
  it('normalizes another app’s url down to a key too', () => {
    expect(store(`${HOUSE}/avatars/u1-123.jpg`)).toBe('avatars/u1-123.jpg');
  });

  it('leaves an already-key value alone', () => {
    expect(store('avatars/u1-123.jpg')).toBe('avatars/u1-123.jpg');
  });

  it('stores a provider picture unchanged', () => {
    const google = 'https://lh3.googleusercontent.com/a/ACg8ocK123=s96-c';
    expect(store(google)).toBe(google);
  });
});
