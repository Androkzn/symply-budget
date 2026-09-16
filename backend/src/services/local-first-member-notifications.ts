import { tryGetAppBrand } from '../config/brand';
import type { Env } from '../types';

import { NotificationService } from './notification-service';

/**
 * Telling somebody that their standing in a household changed.
 *
 * The sibling of `local-first-invite-notifications.ts`, and it exists for the
 * same reason: every one of these events happens on SOMEBODY ELSE's phone. A
 * removal is the sharpest case — the removed member's next sync simply starts
 * failing, and without this the only thing their app can honestly say is
 * nothing at all. Told plainly, "you were removed" is a fact they can act on;
 * left silent it reads as the app breaking.
 *
 * Sent as `household_update` for the same three reasons the invite events are:
 * the notification preferences already understand the type, it is not in
 * `HOUSE_DOMAIN_NOTIFICATION_TYPES` (so it survives on the Budget Worker), and
 * the client routes on `data.updateType` rather than on the type itself.
 *
 * Only ever the member the change is ABOUT. The owner performed it a second
 * ago; an app that notifies you about your own tap is noise.
 *
 * ## Why this is brand-aware
 *
 * Same reason `local-first-invite-notifications.ts` is, and it was fixed there
 * first: the `/v2` routes are SHARED — one codebase, four Workers — so this file
 * runs for House, Budget, Kaizen and Health alike. It used to speak only Budget:
 * `budget_member_*` update types, `screen: 'BudgetInvite'`, and a body about a
 * budget. On a House device that was three separate wrongs — a route the bundle
 * does not host, a vocabulary its client had to special-case, and a sentence
 * about a budget for somebody who has just lost a home.
 *
 * The brand comes from `APP_BRAND`, stamped per Worker in wrangler.toml. An
 * unknown or missing brand falls back to the Budget wording rather than failing:
 * a notification nobody can read is still better than a removal that silently
 * tells nobody.
 */
export type LocalFirstMemberEvent = 'removed' | 'promoted' | 'demoted';

/** Kept for callers and tests that predate the rename. */
export type BudgetMemberEvent = LocalFirstMemberEvent;

/** `data.updateType` per event — the client's routing key. */
export const BUDGET_MEMBER_UPDATE_TYPES: Record<LocalFirstMemberEvent, string> = {
  removed: 'budget_member_removed',
  promoted: 'budget_member_role_changed',
  demoted: 'budget_member_role_changed',
};

export const HOUSE_MEMBER_UPDATE_TYPES: Record<LocalFirstMemberEvent, string> = {
  removed: 'house_member_removed',
  promoted: 'house_member_role_changed',
  demoted: 'house_member_role_changed',
};

export type LocalFirstMemberEventContext = {
  householdId: string;
  householdName: string | null;
  /** The member the change is about — the only recipient. */
  memberUserId: string;
  /** Who performed it. Never notified about their own tap. */
  actorUserId: string;
};

/** Kept for callers and tests that predate the rename. */
export type BudgetMemberEventContext = LocalFirstMemberEventContext;

/**
 * What a brand calls the thing being shared, and which vocabulary its routing
 * keys use.
 *
 * One object rather than parallel switches, for the reason the invite file gives:
 * these travel together in every payload, and splitting them is how a brand ends
 * up with House's screen and Budget's words.
 *
 * `contents` is what the removal body enumerates. It has to be concrete — "your
 * data" prepares nobody — and it has to be the brand's own nouns, because the
 * whole job of that sentence is to tell somebody exactly what is about to
 * disappear off their phone.
 */
type MemberVoice = {
  /** "your home" / "your shared budget" — the fallback when it has no name. */
  unnamed: string;
  /** What the household is called in a sentence: "household" / "home". */
  noun: string;
  /** What is lost, named in the brand's own nouns. */
  contents: string;
  /** What a plain member keeps after a demotion. */
  kept: string;
  /** The `data.screen` sentinel the brand's enrolment hub answers to. */
  screen: string;
  updateTypes: Record<LocalFirstMemberEvent, string>;
};

const BUDGET_VOICE: MemberVoice = {
  unnamed: 'your shared budget',
  noun: 'household',
  contents: 'budget, spending, savings and history',
  kept: 'the budget',
  screen: 'BudgetInvite',
  updateTypes: BUDGET_MEMBER_UPDATE_TYPES,
};

const HOUSE_VOICE: MemberVoice = {
  unnamed: 'your home',
  noun: 'home',
  contents: 'rooms, appliances, tasks, projects and documents',
  kept: 'the home',
  screen: 'HouseInvite',
  updateTypes: HOUSE_MEMBER_UPDATE_TYPES,
};

export function memberVoiceFor(env: Env): MemberVoice {
  return tryGetAppBrand(env) === 'symply-house' ? HOUSE_VOICE : BUDGET_VOICE;
}

function householdLabel(ctx: LocalFirstMemberEventContext, voice: MemberVoice): string {
  return ctx.householdName?.trim() || voice.unnamed;
}

function messageFor(
  event: LocalFirstMemberEvent,
  ctx: LocalFirstMemberEventContext,
  voice: MemberVoice,
): { title: string; body: string } {
  const household = householdLabel(ctx, voice);
  switch (event) {
    case 'removed':
      return {
        // The household is in the title because a history list stacks several
        // of these, and "Removed from a household" says nothing about WHICH
        // until you read past the headline.
        title: `Removed from ${household}`,
        // Says DELETED, because it is. The client erases a household it is no
        // longer a member of rather than keeping a copy that can never change
        // again (`membershipWatch` on the app side) — so this sentence has to
        // be the one that prepares somebody for data that is gone, not one that
        // promises them a frozen copy they will then go looking for.
        body: `Your membership ended, so this ${voice.noun} and everything it held — ${voice.contents} — is removed from your devices.`,
      };
    case 'promoted':
      return {
        title: `You are now an owner of ${household}`,
        body: `You can invite people, approve their devices, and manage who is in the ${voice.noun}.`,
      };
    case 'demoted':
      return {
        title: `Your role in ${household} changed`,
        body: `You are now a member. You keep ${voice.kept} and can still edit it, but managing people is up to the owners.`,
      };
  }
}

/**
 * Send the notification for one membership event.
 *
 * Never throws: a removal is a security act, and it must not be reported as
 * failed because a push token was stale. Callers hand this to `waitUntil` — on
 * Workers an un-awaited promise is cancelled the moment the response returns.
 */
export async function notifyLocalFirstMemberEvent(
  env: Env,
  event: LocalFirstMemberEvent,
  ctx: LocalFirstMemberEventContext,
): Promise<void> {
  if (ctx.memberUserId === ctx.actorUserId) return;
  const voice = memberVoiceFor(env);
  const { title, body } = messageFor(event, ctx, voice);
  const notifications = new NotificationService(env, env.DB);
  try {
    await notifications.sendNotification({
      userId: ctx.memberUserId,
      type: 'household_update',
      title,
      body,
      data: {
        screen: voice.screen,
        updateType: voice.updateTypes[event],
        householdId: ctx.householdId,
        householdName: ctx.householdName ?? '',
      },
      referenceType: 'lf_membership',
      referenceId: ctx.householdId,
    });
  } catch (error) {
    console.error(`[lf-member] ${event} notify failed`, ctx.memberUserId, error);
  }
}

/**
 * The pre-rename name, kept so nothing that imports it breaks mid-deploy — the
 * same courtesy `notifyBudgetInviteEvent` gets next door.
 *
 * @deprecated Use `notifyLocalFirstMemberEvent`.
 */
export const notifyBudgetMemberEvent = notifyLocalFirstMemberEvent;
