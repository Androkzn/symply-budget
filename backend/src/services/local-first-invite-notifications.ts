import { tryGetAppBrand } from '../config/brand';
import type { Env } from '../types';

import type { InviteNotificationContext } from './local-first-control-service';
import { NotificationService } from './notification-service';

/**
 * Telling both sides of a local-first enrolment what just happened.
 *
 * Enrolment is the one flow where the next step is always somebody ELSE's, on
 * another phone, and nothing else says so. The invitee claims an invite and sits
 * on "Waiting for approval…" with no way to know whether the owner has even
 * noticed; the owner has to think to re-open the screen and check who is
 * waiting. Every state change here reaches the person whose turn it is, or whose
 * wait just ended.
 *
 * All four go out as `household_update`, which is deliberate: it is a type the
 * notification preferences already understand, it is not in
 * `HOUSE_DOMAIN_NOTIFICATION_TYPES` (so it survives on every Worker in the
 * fleet), and the client routes on `data.updateType` rather than on the type.
 *
 * ## Why this is brand-aware
 *
 * The `/v2` routes are SHARED — one codebase, four Workers — so this file runs
 * for House, Budget, Kaizen and Health alike. It used to speak only Budget:
 * `budget_*` update types, `screen: 'BudgetInvite'`, and a body about "your
 * shared budget". On a House device that is three separate wrongs — a route the
 * bundle does not host, a vocabulary its client has to special-case, and a
 * sentence about a budget for somebody who was invited to a home.
 *
 * The brand comes from `APP_BRAND`, stamped per Worker in wrangler.toml, so it
 * is available to the cron sweep as well as to a request. An unknown or missing
 * brand falls back to the Budget wording rather than failing: a notification
 * nobody can read is still better than an enrolment that silently tells nobody.
 *
 * `sendNotification` writes the in-app notification history FIRST and pushes
 * second — the history is the durable record, push is best-effort — so a member
 * with push disabled still finds this in the app.
 */
export type LocalFirstInviteEvent = 'claimed' | 'approved' | 'revoked' | 'expired';

/** Kept for callers and tests that predate the rename. */
export type BudgetInviteEvent = LocalFirstInviteEvent;

/** `data.updateType` per event — the client's routing key. */
export const BUDGET_INVITE_UPDATE_TYPES: Record<LocalFirstInviteEvent, string> = {
  claimed: 'budget_join_request_received',
  approved: 'budget_join_approved',
  revoked: 'budget_invite_revoked',
  expired: 'budget_invite_expired',
};

export const HOUSE_INVITE_UPDATE_TYPES: Record<LocalFirstInviteEvent, string> = {
  claimed: 'house_join_request_received',
  approved: 'house_join_approved',
  revoked: 'house_invite_revoked',
  expired: 'house_invite_expired',
};

/**
 * What a brand calls the thing being shared, where its client answers these, and
 * which vocabulary its routing keys use.
 *
 * One object rather than three parallel switches: the three travel together in
 * every payload, and splitting them is how a brand ends up with House's screen
 * and Budget's words.
 */
type BrandVoice = {
  /** "your home" / "your shared budget" — the fallback when it has no name. */
  unnamed: string;
  /** Where the member goes to act, named as the app names it. */
  surface: string;
  /** The `data.screen` sentinel that surface answers to. */
  screen: string;
  updateTypes: Record<LocalFirstInviteEvent, string>;
};

const BUDGET_VOICE: BrandVoice = {
  unnamed: 'your shared budget',
  surface: 'Invite & Household',
  screen: 'BudgetInvite',
  updateTypes: BUDGET_INVITE_UPDATE_TYPES,
};

const HOUSE_VOICE: BrandVoice = {
  unnamed: 'your home',
  surface: 'Invite & home',
  screen: 'HouseInvite',
  updateTypes: HOUSE_INVITE_UPDATE_TYPES,
};

export function inviteVoiceFor(env: Env): BrandVoice {
  return tryGetAppBrand(env) === 'symply-house' ? HOUSE_VOICE : BUDGET_VOICE;
}

function householdLabel(ctx: InviteNotificationContext, voice: BrandVoice): string {
  return ctx.householdName?.trim() || voice.unnamed;
}

/**
 * Who hears about each event, and what it says.
 *
 * Both parties on `expired`, because an invite that ran out disappoints two
 * people: the one who was waiting to be let in, and the one who never got round
 * to letting them. Only the claimant on `revoked` — the owner is the one who did
 * it, and an app that notifies you about your own tap is noise.
 */
function recipientsFor(
  event: LocalFirstInviteEvent,
  ctx: InviteNotificationContext,
  voice: BrandVoice,
): Array<{ userId: string; title: string; body: string }> {
  const household = householdLabel(ctx, voice);
  switch (event) {
    case 'claimed': {
      // The name goes in the TITLE, which is the half a lock screen always shows
      // and the only half an in-app list shows in full. "Someone is waiting to
      // join" is answered by the very next sentence, so the owner has to read
      // past the headline to learn something we already knew — and WHO is
      // waiting is the entire basis on which they approve or refuse.
      const named = ctx.claimedByName?.trim();
      return [
        {
          userId: ctx.createdByUserId,
          title: named ? `${named} is waiting to join` : 'Someone is waiting to join',
          // Names the act the owner has to perform, not just the fact. The
          // approval is a six-digit comparison, and saying so here means the
          // owner arrives already knowing what they are being asked to do.
          body: `${named ? 'They' : 'Someone'} claimed your invite to ${household}. Open ${voice.surface} to compare the six digits and approve.`,
        },
      ];
    }
    case 'approved':
      return ctx.claimedByUserId
        ? [
            {
              userId: ctx.claimedByUserId,
              title: `You are in ${household}`,
              body: 'Your device was approved. It will pick up everything on its next sync.',
            },
          ]
        : [];
    case 'revoked':
      // Nobody hears about their own tap. `claimedByUserId === actorUserId` is
      // the ordinary case of one person enrolling their own second device: they
      // are both parties to the invite, and telling them their invite was
      // cancelled a second after they cancelled it reads as a failure — as if
      // somebody else had reached in and done it.
      return ctx.claimedByUserId && ctx.claimedByUserId !== ctx.actorUserId
        ? [
            {
              userId: ctx.claimedByUserId,
              // The household goes in the title for the same reason the
              // claimant's name does above: a history list stacks several of
              // these, and "Invite cancelled" three times over says nothing
              // about WHICH invite until you read past the headline.
              title: `Invite to ${household} cancelled`,
              body: 'It was cancelled before your device was approved. Ask whoever invited you for a new one.',
            },
          ]
        : [];
    case 'expired': {
      const rows: Array<{ userId: string; title: string; body: string }> = [];
      if (ctx.claimedByUserId) {
        rows.push({
          userId: ctx.claimedByUserId,
          title: `Invite to ${household} expired`,
          body: 'It ran out before your device was approved. Ask whoever invited you for a new one.',
        });
      }
      // …and the owner, whose pending request quietly died. Skipped when they
      // are the same account enrolling a second device, which is the common case
      // — one person does not need telling twice.
      if (ctx.createdByUserId && ctx.createdByUserId !== ctx.claimedByUserId) {
        rows.push({
          userId: ctx.createdByUserId,
          title: `Your invite to ${household} expired`,
          body: 'It ran out before you approved it. Generate a new QR code if they still need in.',
        });
      }
      return rows;
    }
  }
}

/**
 * Send the notifications for one invite event.
 *
 * Never throws: an enrolment must not fail because a push token was stale.
 * Callers hand this to `waitUntil` — on Workers an un-awaited promise is
 * cancelled the moment the response is returned, which is exactly how the House
 * join-request notification was silently lost once before.
 */
export async function notifyLocalFirstInviteEvent(
  env: Env,
  event: LocalFirstInviteEvent,
  ctx: InviteNotificationContext,
): Promise<void> {
  const voice = inviteVoiceFor(env);
  const recipients = recipientsFor(event, ctx, voice);
  if (recipients.length === 0) return;
  const notifications = new NotificationService(env, env.DB);
  await Promise.all(
    recipients.map((recipient) =>
      notifications
        .sendNotification({
          userId: recipient.userId,
          type: 'household_update',
          title: recipient.title,
          body: recipient.body,
          data: {
            screen: voice.screen,
            updateType: voice.updateTypes[event],
            householdId: ctx.householdId,
            householdName: ctx.householdName ?? '',
            inviteId: ctx.inviteId,
            shortCode: ctx.shortCode,
          },
          referenceType: 'lf_invite',
          referenceId: ctx.inviteId,
        })
        .catch((error) => {
          console.error(`[lf-invite] ${event} notify failed`, recipient.userId, error);
        }),
    ),
  );
}

/**
 * The pre-rename name, kept so nothing that imports it breaks mid-deploy.
 *
 * @deprecated Use `notifyLocalFirstInviteEvent`.
 */
export const notifyBudgetInviteEvent = notifyLocalFirstInviteEvent;
