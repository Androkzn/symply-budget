/**
 * Avatar storage is a KEY; the URL is built by whichever Worker serves it.
 *
 * `users.avatar_url` used to hold a fully qualified URL, built from `API_URL`
 * at upload time and then frozen into the row. That is the one column in the
 * schema that stored our own hostname — every other asset (`photo_key`,
 * `image_key`, `file_key`, `thumbnail_key`, …) stores a key and resolves it per
 * request, which is why none of them had this problem.
 *
 * Freezing the host breaks the moment a database moves, and these databases
 * did: every child app's D1 was cloned from House during the split, so Budget,
 * Kaizen and Health each inherited user rows whose avatars named
 * `simple-house-api`. Nine rows across the fleet pointed at another app's
 * Worker — House staging among them, pointing at House PRODUCTION. The image
 * bytes did not travel with the clone, so those apps could not have served
 * them even if they had wanted to: the object exists only in House's bucket.
 *
 * Resolving at read time fixes both halves at once. A stored key is served by
 * the app that owns it, and a legacy absolute URL is REWRITTEN onto the
 * reading app's host rather than trusted — so a row that still says
 * `simple-house-api` stops sending Budget's members to House the first time
 * Budget reads it, with no migration required for correctness.
 */

/** Marks a value as one of ours rather than an identity provider's picture. */
const AVATAR_PATH = '/avatars/';

/**
 * The stored form: a bucket key, e.g. `avatars/<user>-<ts>.jpg`.
 *
 * Kept as a key (not a full URL) precisely so it carries no host.
 */
export function avatarKeyFor(filename: string): string {
  return `avatars/${filename}`;
}

/**
 * The bucket key for a stored value, or null when it is not ours to touch.
 *
 * Used by the delete-on-replace path, which previously matched on
 * `includes('/avatars/')` — true only for the legacy absolute form. Left
 * unchanged it would silently stop deleting replaced avatars the moment writes
 * became keys, leaking an object per re-upload.
 */
export function avatarKeyFromStored(stored: string | null | undefined): string | null {
  if (!stored) return null;

  const marker = stored.indexOf(AVATAR_PATH);
  if (marker >= 0) {
    const filename = stored.slice(marker + AVATAR_PATH.length);
    return filename ? avatarKeyFor(filename) : null;
  }

  if (/^https?:\/\//i.test(stored)) return null; // a provider picture

  const filename = stored.replace(/^avatars\//, '');
  return filename ? avatarKeyFor(filename) : null;
}

/**
 * Turn whatever is in `avatar_url` into a URL this Worker can serve.
 *
 * Three shapes arrive here:
 *  - a key (`avatars/x.jpg`) — the form written from now on;
 *  - one of our legacy absolute URLs (`https://…/avatars/x.jpg`), possibly
 *    naming a DIFFERENT app — rewritten onto this Worker's host;
 *  - a third-party picture from social sign-in (Google/Apple), which is not
 *    ours to rewrite and is returned untouched. Getting this wrong would blank
 *    the avatar of everyone who signed in with a provider, so the check is on
 *    our own `/avatars/` path rather than on "does it start with http".
 */
export function resolveAvatarUrl(
  stored: string | null | undefined,
  apiUrl: string | null | undefined,
): string | null {
  if (!stored) return null;

  const base = (apiUrl ?? '').replace(/\/+$/, '');

  const marker = stored.indexOf(AVATAR_PATH);
  if (marker >= 0) {
    // Ours, however it was stored. Take the filename and re-host it here.
    const filename = stored.slice(marker + AVATAR_PATH.length);
    return filename ? `${base}${AVATAR_PATH}${filename}` : null;
  }

  // A bare key, with or without the `avatars/` prefix stripped somewhere.
  if (!/^https?:\/\//i.test(stored)) {
    const filename = stored.replace(/^avatars\//, '');
    return filename ? `${base}${AVATAR_PATH}${filename}` : null;
  }

  // Somebody else's URL — a provider picture. Leave it exactly as it is.
  return stored;
}
