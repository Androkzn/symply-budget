/**
 * The words an invite travels in.
 *
 * Pure, and in their own module because the two screens that need them are now
 * separate: the owner's Invite screen writes the share text, and the hub shows
 * an expiry line for an invite it did not mint. A helper reachable only by
 * importing a screen is a helper that gets copied instead.
 */

/**
 * What the owner actually sends.
 *
 * Three things are true about this text and each one is deliberate:
 *
 *  - it carries the **link**, so a tap fills the invitee's form for them;
 *  - it carries the **code and secret in the clear**, because a custom-scheme
 *    link is not tappable in every messenger and a link that does nothing with
 *    no fallback is worse than two strings to type;
 *  - it carries **no verification digits**, and cannot: they do not exist yet.
 *    The SAS is derived from the claiming device's keys, so it is only knowable
 *    after that device has claimed — which is what makes it a check on the
 *    enrolment rather than a token that could be forwarded along with the link.
 */
export function buildBudgetInviteShareText(invite: {
  shortCode: string;
  secret: string;
  link: string;
}): string {
  return [
    'Join my budget in Symply Budget.',
    '',
    `Code: ${invite.shortCode}`,
    `Secret: ${invite.secret}`,
    '',
    'Tap to open it in the app:',
    invite.link,
    '',
    'If the link does nothing, open Symply Budget → Settings → Invite & household and enter the code and secret above.',
  ].join('\n');
}

/** `2026-08-17T12:00:00Z` → `in about 24 hours`, for the expiry line. */
export function describeInviteExpiry(expiresAt: string, now: Date = new Date()): string {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return 'soon';
  const hours = Math.round((expiry.getTime() - now.getTime()) / 3600_000);
  if (hours <= 0) return 'already — create another one';
  if (hours === 1) return 'in about an hour';
  if (hours < 24) return `in about ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'in about a day' : `in about ${days} days`;
}
