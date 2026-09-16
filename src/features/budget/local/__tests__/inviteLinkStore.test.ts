/**
 * A tapped invite link, on its way to the Join panel.
 *
 * The link is the whole point of the invite flow being one tap instead of two
 * transcribed strings, so what it accepts — and what it refuses — is pinned
 * here: every scheme the pair has ever been issued under, both halves or
 * nothing, and handed to the screen exactly once.
 */
import { storageHelpers } from '@services/storage';

import {
  captureBudgetInviteLink,
  captureInitialBudgetInviteLink,
  parseBudgetInviteLink,
  takePendingBudgetInvite,
  useBudgetInviteLinkStore,
} from '../inviteLinkStore';

const SECRET = 'e6f1a2b3c4d5e6f708192a3b4c5d6e7f';

beforeEach(async () => {
  useBudgetInviteLinkStore.getState().setPendingInvite(null);
  // The launch-URL guard persists across launches by design, so each test
  // starts from "no invite has ever arrived at launch".
  await storageHelpers.delete('handled-initial-budget-invite');
});

describe('parseBudgetInviteLink', () => {
  it('reads an invite out of the link this app builds', () => {
    expect(
      parseBudgetInviteLink(`simplebudget://lf-invite?id=inv_1&secret=${SECRET}&code=D5YL2Y`),
    ).toEqual({ code: 'D5YL2Y', secret: SECRET });
  });

  it('still accepts the Worker’s legacy payload, so old invites are not dead', () => {
    // `symply-budget://` is what the shared Worker hardcodes. It never opened
    // the app, but an invite already sent in that form can still be pasted.
    expect(
      parseBudgetInviteLink(`symply-budget://lf-invite?id=inv_1&secret=${SECRET}&code=d5yl2y`),
    ).toEqual({ code: 'D5YL2Y', secret: SECRET });
  });

  it('accepts an https landing page carrying the same query', () => {
    expect(
      parseBudgetInviteLink(`https://app.symply.example/lf-invite?code=D5YL2Y&secret=${SECRET}`),
    ).toEqual({ code: 'D5YL2Y', secret: SECRET });
  });

  it('refuses a link with only half the invite', () => {
    // A code with no secret cannot claim anything, and half-filling the form
    // would look like the link had worked.
    expect(parseBudgetInviteLink('simplebudget://lf-invite?code=D5YL2Y')).toBeNull();
    expect(parseBudgetInviteLink(`simplebudget://lf-invite?secret=${SECRET}`)).toBeNull();
  });

  it('ignores every other link the app is opened with', () => {
    expect(parseBudgetInviteLink('simplebudget:///?screen=BudgetInvite')).toBeNull();
    expect(parseBudgetInviteLink('simplebudget://e2e-login?email=a@b.c')).toBeNull();
    expect(parseBudgetInviteLink(null)).toBeNull();
    expect(parseBudgetInviteLink('')).toBeNull();
  });

  it('decodes a percent-escaped secret', () => {
    expect(parseBudgetInviteLink('simplebudget://lf-invite?code=D5YL2Y&secret=a%26c%3Dd')).toEqual({
      code: 'D5YL2Y',
      secret: 'a&c=d',
    });
  });
});

describe('captureBudgetInviteLink', () => {
  it('parks an invite and reports that it owned the link', () => {
    expect(
      captureBudgetInviteLink(`simplebudget://lf-invite?id=inv_1&secret=${SECRET}&code=D5YL2Y`),
    ).toBe(true);
    expect(useBudgetInviteLinkStore.getState().pendingInvite).toEqual({
      code: 'D5YL2Y',
      secret: SECRET,
    });
  });

  it('passes on anything that is not an invite, so other handlers still see it', () => {
    expect(captureBudgetInviteLink('simplebudget://e2e-login?email=a@b.c')).toBe(false);
    expect(useBudgetInviteLinkStore.getState().pendingInvite).toBeNull();
  });

  it('honours a launch url once and treats the replay as spent', async () => {
    // iOS keeps handing back the URL that started the app on every relaunch —
    // observed on Budget-B: an invite tapped once re-opened its join panel,
    // pre-filled, on a launch that had nothing to do with it.
    const link = `simplebudget://lf-invite?secret=${SECRET}&code=D5YL2Y`;

    expect(await captureInitialBudgetInviteLink(link)).toBe(true);
    expect(takePendingBudgetInvite()).toEqual({ code: 'D5YL2Y', secret: SECRET });

    // Same link, next launch: still ours to swallow, but nothing is parked.
    expect(await captureInitialBudgetInviteLink(link)).toBe(true);
    expect(useBudgetInviteLinkStore.getState().pendingInvite).toBeNull();

    // A different invite is a different invite.
    expect(
      await captureInitialBudgetInviteLink(`simplebudget://lf-invite?secret=${SECRET}&code=ABC999`),
    ).toBe(true);
    expect(useBudgetInviteLinkStore.getState().pendingInvite?.code).toBe('ABC999');
  });

  it('still honours a warm tap of a link already spent at launch', async () => {
    const link = `simplebudget://lf-invite?secret=${SECRET}&code=D5YL2Y`;
    await captureInitialBudgetInviteLink(link);
    takePendingBudgetInvite();

    // Tapping the link again while the app is open is a real, fresh intent —
    // the launch-URL guard must not swallow it.
    expect(captureBudgetInviteLink(link)).toBe(true);
    expect(useBudgetInviteLinkStore.getState().pendingInvite?.code).toBe('D5YL2Y');
  });

  it('hands the invite over exactly once', () => {
    captureBudgetInviteLink(`simplebudget://lf-invite?secret=${SECRET}&code=D5YL2Y`);
    expect(takePendingBudgetInvite()).toEqual({ code: 'D5YL2Y', secret: SECRET });
    // A second visit to the screen must not re-fill a form the member cleared.
    expect(takePendingBudgetInvite()).toBeNull();
  });
});
