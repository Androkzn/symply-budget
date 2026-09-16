import { create } from 'zustand';

import { storageHelpers } from '@services/storage';

/**
 * An invite link that was tapped, waiting for the Invite & Household screen.
 *
 * Joining a household is the one enrolment step that starts on the OTHER
 * person's phone, and until now it started with them retyping two opaque
 * strings — a six-character code and a long secret — read off a message.
 * A tapped `simplebudget://lf-invite?id=…&secret=…&code=…` link carries both,
 * so the screen can arrive already filled in.
 *
 * Held here rather than passed as route params for two reasons:
 *
 *  - the secret must not travel through the router. Route params end up in
 *    navigation state (and in anything that logs a route), and this one opens
 *    a household;
 *  - the tap can land before there is anywhere to put it. A cold start opens
 *    on the sign-in screen, and the Budget stack does not exist yet — so the
 *    link waits here until the authenticated shell is up, exactly like
 *    `inviteStore`'s `pendingJoinToken` does for House's shareable invites.
 *
 * Deliberately free of imports from the budget engine: the root layout parses
 * every incoming URL on startup for every brand, and pulling the local-first
 * ledger into that path would cost every launch.
 */

export type PendingBudgetInvite = {
  code: string;
  secret: string;
};

type BudgetInviteLinkState = {
  pendingInvite: PendingBudgetInvite | null;
  setPendingInvite: (invite: PendingBudgetInvite | null) => void;
};

export const useBudgetInviteLinkStore = create<BudgetInviteLinkState>((set) => ({
  pendingInvite: null,
  setPendingInvite: (pendingInvite) => set({ pendingInvite }),
}));

/**
 * Read an invite out of a tapped link.
 *
 * Accepts every shape the code + secret pair travels in:
 *
 *  - `simplebudget://lf-invite?id=…&secret=…&code=…` — what this app builds;
 *  - `symply-budget://lf-invite?…` — what the shared Worker still hands back,
 *    so an invite created by an older build is not dead on arrival;
 *  - `https://…/lf-invite?…` — a future web landing page, which needs no client
 *    change to start working.
 *
 * Anything without BOTH halves returns null: a code alone cannot claim an
 * invite, and half-filling the form would look like it had worked.
 */
export function parseBudgetInviteLink(url: string | null | undefined): PendingBudgetInvite | null {
  if (!url || !/lf-invite/i.test(url)) return null;
  const read = (key: string) => {
    const match = url.match(new RegExp(`[?&]${key}=([^&\\s#]+)`, 'i'));
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]!);
    } catch {
      return match[1]!;
    }
  };
  const code = read('code')?.trim().toUpperCase();
  const secret = read('secret')?.trim();
  if (!code || !secret) return null;
  return { code, secret };
}

/**
 * Park a tapped invite link, if that is what the URL is.
 *
 * Returns true when the link was ours, so the caller can stop handing the URL
 * to other handlers.
 */
export function captureBudgetInviteLink(url: string | null | undefined): boolean {
  const invite = parseBudgetInviteLink(url);
  if (!invite) return false;
  // Never logged: the secret in this URL is half of what opens the household.
  console.log('[budget-invite] invite link captured', invite.code);
  useBudgetInviteLinkStore.getState().setPendingInvite(invite);
  return true;
}

/** Invite codes already taken off a COLD-START url — see below for why. */
const HANDLED_INITIAL_INVITE_KEY = 'handled-initial-budget-invite';

/**
 * How many spent codes are kept. Twenty is far past what any member reaches —
 * an invite is claimed once — and it exists only so a device that is handed
 * invite after invite cannot grow this value without bound.
 */
const HANDLED_INITIAL_INVITE_LIMIT = 20;

/**
 * The codes this device has already honoured at launch.
 *
 * BR-016 made this a LIST. It used to be one slot holding the last code, which
 * was sound only while a device could belong to one household: honouring a
 * second invite overwrote the memory of the first, so a launch URL for the first
 * invite became indistinguishable from a fresh tap and re-opened its join panel,
 * pre-filled, for a household the member had already joined. Now that joining
 * ADDS a household, members hold several and are handed several invites, so that
 * overwrite stopped being theoretical.
 *
 * Keyed by invite CODE rather than by household — deliberately, and it is the
 * finer grain of the two: one household issues many invites, each spent
 * separately, and the code is the only identifier the URL actually carries. It
 * is also the only one available here. This module is loaded by the root layout
 * to parse every launch URL for every brand, long before sign-in, so the
 * household id does not exist yet and reaching for the engine to find one would
 * put the local-first ledger on every cold start of every app in the fleet.
 *
 * Every read degrades to "nothing is spent": a corrupt or unreadable value
 * replays one invite, which re-opens a filled form. Dropping a real invite on
 * the floor is the worse failure of the two.
 */
async function readHandledInitialInvites(): Promise<string[]> {
  let raw: string | null | undefined = null;
  try {
    raw = await storageHelpers.getString(HANDLED_INITIAL_INVITE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === 'string') : [];
  } catch {
    // The pre-BR-016 value was the bare code, not JSON. Read it as the
    // one-element list it always meant: migrating it here costs a string
    // comparison, and not migrating it would replay the last invite every
    // existing device in the field was launched with.
    return [raw];
  }
}

/**
 * Same, for the URL the app was launched with.
 *
 * `Linking.getInitialURL()` returns the URL that started the app and keeps
 * returning it on every relaunch — the OS re-delivers the original launch URL,
 * not just the first time. Observed on Budget-B while building this: an invite
 * tapped once had its join panel re-open, pre-filled, on a launch that had
 * nothing to do with it. So a cold-start invite is honoured once per code and
 * then remembered as spent; a warm `url` event is always a real, fresh tap and
 * needs no such guard. `inviteStore.shouldForwardInviteToken` makes the same
 * distinction for House's shareable invites, for the same reason.
 *
 * Returns true when the URL was an invite link at all — replay included — so
 * the caller stops offering it to other handlers either way.
 */
export async function captureInitialBudgetInviteLink(
  url: string | null | undefined,
): Promise<boolean> {
  const invite = parseBudgetInviteLink(url);
  if (!invite) return false;
  const handled = await readHandledInitialInvites();
  if (handled.includes(invite.code)) {
    console.log('[budget-invite] launch url is a spent invite — ignoring', invite.code);
    return true;
  }
  try {
    // Newest last, oldest trimmed: the codes most likely to be re-delivered as a
    // launch URL are the recent ones, so they are the ones worth keeping.
    const next = [...handled, invite.code].slice(-HANDLED_INITIAL_INVITE_LIMIT);
    await storageHelpers.setString(HANDLED_INITIAL_INVITE_KEY, JSON.stringify(next));
  } catch {
    // Same call as the read: an unremembered invite replays once, it does not
    // disappear.
  }
  console.log('[budget-invite] invite link captured at launch', invite.code);
  useBudgetInviteLinkStore.getState().setPendingInvite(invite);
  return true;
}

/**
 * Take the parked invite, clearing it — the Invite screen calls this when it is
 * ready to fill the form, so one tap fills it once.
 */
export function takePendingBudgetInvite(): PendingBudgetInvite | null {
  const pending = useBudgetInviteLinkStore.getState().pendingInvite;
  if (pending) useBudgetInviteLinkStore.getState().setPendingInvite(null);
  return pending;
}
