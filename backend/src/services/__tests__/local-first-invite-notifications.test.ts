/**
 * Who hears about a household enrolment, and when.
 *
 * The rule being pinned is about PEOPLE, not plumbing: at every step of this
 * flow the next move belongs to somebody on another phone, and the wrong
 * recipient is not a cosmetic bug — it is the difference between an owner who
 * knows a stranger is waiting at the door and one who does not.
 *
 * `NotificationService` is stubbed because what matters here is the routing
 * decision. That it writes in-app history before pushing (so a member with push
 * disabled still finds the message in the app) is that class's own contract,
 * covered by its own tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SentNotification = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

const sendNotification = vi.fn(async (_options: SentNotification) => {});

vi.mock('../notification-service', () => ({
  NotificationService: class {
    sendNotification = sendNotification;
  },
}));

import type { Env } from '../../types';
import type { InviteNotificationContext } from '../local-first-control-service';
import {
  BUDGET_INVITE_UPDATE_TYPES,
  notifyBudgetInviteEvent,
  notifyLocalFirstInviteEvent,
} from '../local-first-invite-notifications';

const env = { DB: {} } as unknown as Env;

const OWNER = 'u_owner';
const INVITEE = 'u_invitee';

function context(overrides: Partial<InviteNotificationContext> = {}): InviteNotificationContext {
  return {
    inviteId: 'inv_1',
    shortCode: 'ABC123',
    householdId: 'hh_local_1',
    householdName: 'The Smiths',
    status: 'claimed',
    expiresAt: new Date().toISOString(),
    createdByUserId: OWNER,
    claimedByUserId: INVITEE,
    claimedByName: 'Sam',
    ...overrides,
  };
}

/** Recipients of the last call batch, in the order they were notified. */
function recipients(): string[] {
  return sendNotification.mock.calls.map(([options]) => options.userId);
}

function lastPayload(): SentNotification {
  const call = sendNotification.mock.calls.at(-1);
  if (!call) throw new Error('no notification was sent');
  return call[0];
}

beforeEach(() => sendNotification.mockClear());

describe('claimed', () => {
  it('tells the invite CREATOR, who is the only one who can approve', async () => {
    // The secret lives on the creating device, so only it can derive the six
    // digits. Notifying anyone else would summon someone who cannot act.
    await notifyBudgetInviteEvent(env, 'claimed', context());
    expect(recipients()).toEqual([OWNER]);
  });

  it('names the person in the TITLE, and the household + act in the body', async () => {
    // The title is the half a lock screen always shows and the only half an
    // in-app list shows in full — so it is where the name has to be.
    await notifyBudgetInviteEvent(env, 'claimed', context());
    const payload = lastPayload();
    expect(payload.title).toBe('Sam is waiting to join');
    expect(payload.body).toContain('The Smiths');
    expect(payload.body).toMatch(/six digits/i);
    // …and not twice: a headline and an opening clause both saying "Sam" is
    // the same sentence read out two ways.
    expect(payload.body).not.toContain('Sam');
  });

  it('falls back to "Someone" rather than naming nobody', async () => {
    await notifyBudgetInviteEvent(env, 'claimed', context({ claimedByName: null }));
    expect(lastPayload().title).toBe('Someone is waiting to join');
    expect(lastPayload().body).toMatch(/^Someone claimed/);
  });

  it('carries the routing key and the household the client needs', async () => {
    await notifyBudgetInviteEvent(env, 'claimed', context());
    expect(lastPayload().data).toMatchObject({
      screen: 'BudgetInvite',
      updateType: BUDGET_INVITE_UPDATE_TYPES.claimed,
      householdId: 'hh_local_1',
      inviteId: 'inv_1',
    });
  });
});

describe('approved', () => {
  it('tells the CLAIMANT, whose wait just ended', async () => {
    // Nothing on their device would say so: the household key arrives by
    // mailbox on the next sync, minutes later.
    await notifyBudgetInviteEvent(env, 'approved', context({ status: 'approved' }));
    expect(recipients()).toEqual([INVITEE]);
  });

  it('says nothing when there is no claimant to tell', async () => {
    await notifyBudgetInviteEvent(env, 'approved', context({ claimedByUserId: null }));
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('revoked', () => {
  it('tells the claimant only — the owner just tapped the button', async () => {
    await notifyBudgetInviteEvent(env, 'revoked', context({ status: 'revoked' }));
    expect(recipients()).toEqual([INVITEE]);
    // The household is in the TITLE: a history list stacks several of these,
    // and "Invite cancelled" on its own says nothing about which invite.
    expect(lastPayload().title).toBe('Invite to The Smiths cancelled');
  });

  it('never tells the person who just tapped Cancel', async () => {
    // One person enrolling their own second device is BOTH parties to the
    // invite. Without this they cancel an invite and are told, a second later,
    // that "the invite was cancelled before your device was approved" — which
    // reads as somebody else having reached in and done it.
    await notifyBudgetInviteEvent(
      env,
      'revoked',
      context({ status: 'revoked', claimedByUserId: OWNER, actorUserId: OWNER }),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('still tells a claimant who is somebody else', async () => {
    await notifyBudgetInviteEvent(
      env,
      'revoked',
      context({ status: 'revoked', actorUserId: OWNER }),
    );
    expect(recipients()).toEqual([INVITEE]);
  });

  it('stays silent on an invite nobody had claimed', async () => {
    await notifyBudgetInviteEvent(
      env,
      'revoked',
      context({ status: 'revoked', claimedByUserId: null }),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('expired', () => {
  it('tells both sides — one was waiting, the other never got round to it', async () => {
    await notifyBudgetInviteEvent(env, 'expired', context({ status: 'expired' }));
    expect(recipients().sort()).toEqual([INVITEE, OWNER].sort());
  });

  it('tells one person once when both sides are the same account', async () => {
    // The common case: one person enrolling their own second device.
    await notifyBudgetInviteEvent(
      env,
      'expired',
      context({ status: 'expired', claimedByUserId: OWNER }),
    );
    expect(recipients()).toEqual([OWNER]);
  });
});

describe('delivery failures', () => {
  it('never lets a dead push token break the enrolment that triggered it', async () => {
    sendNotification.mockRejectedValueOnce(new Error('expo down'));
    await expect(notifyBudgetInviteEvent(env, 'claimed', context())).resolves.toBeUndefined();
  });
});

describe('household naming', () => {
  it('says something a human recognises when the household has no name', async () => {
    await notifyBudgetInviteEvent(env, 'claimed', context({ householdName: null }));
    expect(lastPayload().body).toContain('your shared budget');
    // …and never the raw id.
    expect(lastPayload().body).not.toContain('hh_local_1');
  });

  it('names the household in every title the claimant sees', async () => {
    // These land in one list, one under the other. A title that names only the
    // event ("Invite expired") cannot be told from the one above it.
    await notifyBudgetInviteEvent(env, 'approved', context({ status: 'approved' }));
    expect(lastPayload().title).toBe('You are in The Smiths');

    await notifyBudgetInviteEvent(
      env,
      'expired',
      context({ status: 'expired', createdByUserId: OWNER, claimedByUserId: INVITEE }),
    );
    const titles = sendNotification.mock.calls.map(([options]) => options.title);
    expect(titles).toContain('Invite to The Smiths expired');
    expect(titles).toContain('Your invite to The Smiths expired');
  });
});

/**
 * The same four events, spoken in the brand the Worker actually is.
 *
 * `/v2` is one codebase behind four Workers, so this file runs for House as well
 * as Budget. Sending House members a `budget_*` update type, a `BudgetInvite`
 * screen sentinel and a body about "your shared budget" was three separate
 * wrongs: a route the bundle does not host, a vocabulary its client has to
 * special-case, and a sentence about a budget for somebody invited to a home.
 *
 * `APP_BRAND` is the source, stamped per Worker in wrangler.toml, so the cron
 * sweep that sends `expired` resolves it exactly as a request does.
 */
describe('brand voice', () => {
  const houseEnv = { DB: {}, APP_BRAND: 'symply-house' } as unknown as Env;
  const budgetEnv = { DB: {}, APP_BRAND: 'symply-budget' } as unknown as Env;

  it('routes a House Worker to the House hub, in House vocabulary', async () => {
    await notifyLocalFirstInviteEvent(houseEnv, 'claimed', context());
    expect(lastPayload().data.screen).toBe('HouseInvite');
    expect(lastPayload().data.updateType).toBe('house_join_request_received');
    expect(lastPayload().body).toContain('Invite & home');
  });

  it('routes a Budget Worker to the Budget hub, unchanged', async () => {
    await notifyLocalFirstInviteEvent(budgetEnv, 'claimed', context());
    expect(lastPayload().data.screen).toBe('BudgetInvite');
    expect(lastPayload().data.updateType).toBe('budget_join_request_received');
    expect(lastPayload().body).toContain('Invite & Household');
  });

  it('calls an unnamed home a home, not a shared budget', async () => {
    await notifyLocalFirstInviteEvent(houseEnv, 'claimed', context({ householdName: null }));
    expect(lastPayload().body).toContain('your home');
    expect(lastPayload().body).not.toContain('budget');
  });

  it('falls back to the Budget voice when the brand is missing, rather than telling nobody', async () => {
    // A notification nobody can route is still better than an enrolment that
    // silently notifies no one, so an unset APP_BRAND must not throw.
    const unbranded = { DB: {} } as unknown as Env;
    await expect(
      notifyLocalFirstInviteEvent(unbranded, 'claimed', context()),
    ).resolves.toBeUndefined();
    expect(lastPayload().data.updateType).toBe('budget_join_request_received');
  });

  it('speaks the brand on the cron-driven expiry too, where there is no request to read', async () => {
    await notifyLocalFirstInviteEvent(
      houseEnv,
      'expired',
      context({ status: 'expired', createdByUserId: OWNER, claimedByUserId: INVITEE }),
    );
    const updateTypes = sendNotification.mock.calls.map(([options]) => options.data.updateType);
    expect(new Set(updateTypes)).toEqual(new Set(['house_invite_expired']));
  });
});
