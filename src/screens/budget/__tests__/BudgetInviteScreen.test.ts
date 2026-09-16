/**
 * What the owner sends, and what they must not.
 *
 * The invite is verified out of band: the invitee's device shows three words
 * and the owner taps the one they read out. That check is worth exactly nothing
 * if the answer travels in the same message as the invite — which is what the
 * old "copy the code, link, secret AND the OOB words (pick #2)" clipboard blob
 * did. So the share text is a pure function and its contents are pinned here.
 */
import {
  buildBudgetInviteShareText,
  describeInviteExpiry,
} from '@features/budget/local/inviteCopy';

const INVITE = {
  shortCode: 'D5YL2Y',
  secret: 'e6f1a2b3c4d5e6f708192a3b4c5d6e7f',
  link: 'simplebudget://lf-invite?id=inv_1&secret=e6f1a2b3c4d5e6f708192a3b4c5d6e7f&code=D5YL2Y',
};

describe('buildBudgetInviteShareText', () => {
  it('carries the link, so one tap fills their form', () => {
    expect(buildBudgetInviteShareText(INVITE)).toContain(INVITE.link);
  });

  it('carries the code and secret in writing too', () => {
    // A custom-scheme link is not tappable in every messenger, and a dead link
    // with no fallback is worse than two strings to type.
    const text = buildBudgetInviteShareText(INVITE);
    expect(text).toContain('D5YL2Y');
    expect(text).toContain(INVITE.secret);
  });

  it('never carries the word that verifies them', () => {
    const text = buildBudgetInviteShareText(INVITE);
    for (const word of ['lotus', 'anchor', 'pepper']) {
      expect(text).not.toContain(word);
    }
    // Nor any hint of which one to pick.
    expect(text.toLowerCase()).not.toContain('word');
  });

  it('says where to type them when the link does nothing', () => {
    expect(buildBudgetInviteShareText(INVITE)).toMatch(/Invite & household/i);
  });
});

describe('describeInviteExpiry', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  const inHours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

  it('reads as a human would say it', () => {
    expect(describeInviteExpiry(inHours(24), now)).toBe('in about a day');
    expect(describeInviteExpiry(inHours(5), now)).toBe('in about 5 hours');
    expect(describeInviteExpiry(inHours(1), now)).toBe('in about an hour');
    expect(describeInviteExpiry(inHours(72), now)).toBe('in about 3 days');
  });

  it('says an expired invite is spent rather than pretending it is fresh', () => {
    expect(describeInviteExpiry(inHours(-1), now)).toMatch(/already/);
  });

  it('degrades quietly on an unparseable timestamp', () => {
    expect(describeInviteExpiry('garbage', now)).toBe('soon');
  });
});
