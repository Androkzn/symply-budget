import {
  BUDGET_INVITE_LINK_SCHEME,
  buildBudgetInviteLink,
  parseInviteInput,
} from '@features/budget/local/controlPlaneClient';

describe('parseInviteInput', () => {
  it('reads code + secret out of the QR/link payload', () => {
    expect(parseInviteInput('symply-budget://lf-invite?id=inv_1&secret=abc123&code=D5YL2Y')).toEqual({
      shortCode: 'D5YL2Y',
      secret: 'abc123',
    });
  });
  it('accepts a whitespace-separated code and secret', () => {
    expect(parseInviteInput('d5yl2y  abc123')).toEqual({ shortCode: 'D5YL2Y', secret: 'abc123' });
  });
  it('treats a lone value as the short code', () => {
    expect(parseInviteInput(' d5yl2y ')).toEqual({ shortCode: 'D5YL2Y', secret: null });
  });
  it('returns nulls for empty input so the manual fields win', () => {
    expect(parseInviteInput('   ')).toEqual({ shortCode: null, secret: null });
  });
});

describe('buildBudgetInviteLink', () => {
  const invite = { inviteId: 'inv_1', shortCode: 'D5YL2Y', secret: 'sekret-value-0123456789' };

  it('builds simplebudget:// — the scheme this app actually registers', () => {
    // `symply-budget://` is the app's code id, not a scheme. It is what the
    // shared Worker returns in `qrPayload`, it parses perfectly, and it opens
    // nothing on either platform — which is the whole reason this exists.
    const link = buildBudgetInviteLink(invite);
    expect(link.startsWith(`${BUDGET_INVITE_LINK_SCHEME}://lf-invite?`)).toBe(true);
    expect(link.startsWith('symply-budget://')).toBe(false);
  });

  it('carries both halves, so a tap can fill the invitee’s form', () => {
    expect(parseInviteInput(buildBudgetInviteLink(invite))).toEqual({
      shortCode: 'D5YL2Y',
      secret: 'sekret-value-0123456789',
    });
  });

  it('escapes a secret that would otherwise break the query string', () => {
    // The Worker mints 32 hex characters, but nothing in the link's shape may
    // depend on that — a `&` in a secret would silently truncate the link.
    const link = buildBudgetInviteLink({ ...invite, secret: 'a&c=d' });
    expect(link).toContain('secret=a%26c%3Dd');
    expect(parseInviteInput(link).secret).toBe('a&c=d');
  });
});
