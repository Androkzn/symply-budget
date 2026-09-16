/**
 * The tapped invite link — House's half of the QR hand-off.
 *
 * This module is loaded by the root layout to parse EVERY launch URL for every
 * brand, before sign-in, which is why it is free of the local-first engine and
 * why the parse is a regex rather than a router. What is pinned here is the part
 * that is invisible when it breaks:
 *
 *  - both schemes, because the shared Worker still stamps `symply-house://` into
 *    `invite.qrPayload` and an invite created by an older build must not be dead
 *    on arrival;
 *  - BOTH halves required, because a code with no secret cannot claim anything
 *    and half-filling the form looks like it worked;
 *  - the cold-start replay guard, because `Linking.getInitialURL()` keeps
 *    returning the URL the app was launched with on every relaunch — so an
 *    invite tapped once would re-open its join dialog for ever.
 */
import { storageHelpers } from '@services/storage';

import {
  captureHouseInviteLink,
  captureInitialHouseInviteLink,
  parseHouseInviteLink,
  takePendingHouseInvite,
  useHouseInviteLinkStore,
} from '../inviteLinkStore';


const HANDLED_KEY = 'handled-initial-house-invite';

beforeEach(async () => {
  useHouseInviteLinkStore.getState().setPendingInvite(null);
  await storageHelpers.delete(HANDLED_KEY);
});

describe('parseHouseInviteLink', () => {
  it('reads the link this app builds', () => {
    expect(
      parseHouseInviteLink('simplehouse://lf-invite?id=inv_1&secret=sekret&code=ab12cd'),
    ).toEqual({ code: 'AB12CD', secret: 'sekret' });
  });

  it("reads the shared Worker's own payload, so an older invite still opens", () => {
    // `symply-house://` is the app's CODE ID, not a scheme — it opens nothing —
    // but the query it carries is the same invite, and refusing to parse it
    // would strand anyone handed a payload from a build that predates the
    // client-side link builder.
    expect(
      parseHouseInviteLink('symply-house://lf-invite?id=inv_1&secret=sekret&code=AB12CD'),
    ).toEqual({ code: 'AB12CD', secret: 'sekret' });
  });

  it('reads an https landing page, which needs no client change to start working', () => {
    expect(
      parseHouseInviteLink('https://symply.app/lf-invite?code=ab12cd&secret=sekret'),
    ).toEqual({ code: 'AB12CD', secret: 'sekret' });
  });

  it('decodes a percent-escaped secret rather than claiming with the escapes', () => {
    expect(
      parseHouseInviteLink('simplehouse://lf-invite?code=AB12CD&secret=a%2Bb%3Dc'),
    ).toEqual({ code: 'AB12CD', secret: 'a+b=c' });
  });

  it('refuses a link missing either half — half-filling the form looks like it worked', () => {
    expect(parseHouseInviteLink('simplehouse://lf-invite?code=AB12CD')).toBeNull();
    expect(parseHouseInviteLink('simplehouse://lf-invite?secret=sekret')).toBeNull();
  });

  it('ignores URLs that are not invites at all', () => {
    expect(parseHouseInviteLink('simplehouse://device-sync')).toBeNull();
    expect(parseHouseInviteLink(null)).toBeNull();
    expect(parseHouseInviteLink(undefined)).toBeNull();
  });
});

describe('captureHouseInviteLink — a warm tap', () => {
  it('parks the invite and reports that the URL was ours', () => {
    expect(captureHouseInviteLink('simplehouse://lf-invite?code=AB12CD&secret=sekret')).toBe(true);
    expect(useHouseInviteLinkStore.getState().pendingInvite).toEqual({
      code: 'AB12CD',
      secret: 'sekret',
    });
  });

  it('leaves a URL that is not an invite for the other handlers', () => {
    expect(captureHouseInviteLink('simplehouse://device-sync')).toBe(false);
    expect(useHouseInviteLinkStore.getState().pendingInvite).toBeNull();
  });

  it('never logs the secret — it is half of what opens the home', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    captureHouseInviteLink('simplehouse://lf-invite?code=AB12CD&secret=sekret');
    const lines = log.mock.calls.flat().map(String).join(' ');
    expect(lines).toContain('AB12CD');
    expect(lines).not.toContain('sekret');
    log.mockRestore();
  });

  it('is taken once, so one tap fills the form once', () => {
    captureHouseInviteLink('simplehouse://lf-invite?code=AB12CD&secret=sekret');
    expect(takePendingHouseInvite()).toEqual({ code: 'AB12CD', secret: 'sekret' });
    expect(takePendingHouseInvite()).toBeNull();
  });
});

describe('captureInitialHouseInviteLink — the launch URL', () => {
  const LINK = 'simplehouse://lf-invite?code=AB12CD&secret=sekret';

  it('honours a fresh launch invite', async () => {
    expect(await captureInitialHouseInviteLink(LINK)).toBe(true);
    expect(useHouseInviteLinkStore.getState().pendingInvite).toEqual({
      code: 'AB12CD',
      secret: 'sekret',
    });
  });

  it('ignores the SAME code on a later launch, because the OS re-delivers it', async () => {
    await captureInitialHouseInviteLink(LINK);
    useHouseInviteLinkStore.getState().setPendingInvite(null);

    // Still "ours" — the caller must stop offering it to other handlers — but
    // nothing is parked, so no join dialog re-opens.
    expect(await captureInitialHouseInviteLink(LINK)).toBe(true);
    expect(useHouseInviteLinkStore.getState().pendingInvite).toBeNull();
  });

  it('honours a DIFFERENT code after one has been spent', async () => {
    // The reason this is a list and not one slot: joining ADDS a home, so
    // members hold several and are handed several invites. One slot would let
    // the second invite erase the memory of the first, and the first would then
    // replay on the next launch.
    await captureInitialHouseInviteLink(LINK);
    useHouseInviteLinkStore.getState().setPendingInvite(null);

    await captureInitialHouseInviteLink('simplehouse://lf-invite?code=ZZ99YY&secret=other');
    expect(useHouseInviteLinkStore.getState().pendingInvite).toEqual({
      code: 'ZZ99YY',
      secret: 'other',
    });

    // …and the FIRST one is still remembered as spent.
    useHouseInviteLinkStore.getState().setPendingInvite(null);
    await captureInitialHouseInviteLink(LINK);
    expect(useHouseInviteLinkStore.getState().pendingInvite).toBeNull();
  });

  it('migrates the one-slot value a device in the field may already hold', async () => {
    // Written by a build that stored the bare code rather than JSON. Read as the
    // one-element list it always meant, so that invite does not replay once for
    // every existing device the moment this ships.
    await storageHelpers.setString(HANDLED_KEY, 'AB12CD');

    expect(await captureInitialHouseInviteLink(LINK)).toBe(true);
    expect(useHouseInviteLinkStore.getState().pendingInvite).toBeNull();
  });

  it('replays rather than dropping when the store cannot be read', async () => {
    // Dropping a real invite on the floor is the worse of the two failures: a
    // replay costs one pre-filled form, a drop costs the member the join.
    const getString = jest
      .spyOn(storageHelpers, 'getString')
      .mockRejectedValueOnce(new Error('unreadable'));

    expect(await captureInitialHouseInviteLink(LINK)).toBe(true);
    expect(useHouseInviteLinkStore.getState().pendingInvite).not.toBeNull();
    getString.mockRestore();
  });

  it('leaves a non-invite launch URL alone', async () => {
    expect(await captureInitialHouseInviteLink('simplehouse://device-sync')).toBe(false);
  });
});
