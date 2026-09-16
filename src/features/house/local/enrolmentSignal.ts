import { create } from 'zustand';

/**
 * "Something happened to an invite" — the nudge that keeps the Invite & home
 * screen honest while it is on screen.
 *
 * Home enrolment is the one House flow where the next state change originates
 * on ANOTHER person's phone: they claim, they approve, they cancel. The screen
 * has no way to observe that — the local ledger does not move until the home
 * data key actually arrives — so a device sitting on Invite & home would show
 * "Waiting for approval…" for as long as it stayed there, however many times
 * the other side acted.
 *
 * The push notification already reaches this app; this is what turns receiving
 * it into a screen that has changed. Deliberately a bare counter and not the
 * payload: the screen re-reads the control plane rather than trusting a push to
 * describe home state, because a push is delivered best-effort, can arrive out
 * of order, and is the one input to this flow an attacker can most easily make
 * noise on.
 *
 * Free of imports from the house engine on purpose — the notification handler
 * runs on every launch for every brand, and pulling the local-first ledger into
 * that path would cost every start.
 */

type EnrolmentSignalState = {
  /** Bumped whenever an invite notification lands. */
  revision: number;
  bump: () => void;
};

export const useHouseEnrolmentSignal = create<EnrolmentSignalState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/**
 * `data.updateType` values the Worker sends for invite lifecycle events.
 *
 * Both spellings, deliberately. The Worker now picks its wording per brand
 * (`local-first-invite-notifications.ts`), but the `budget_*` names shipped
 * first and were sent to EVERY brand — House included — because the `/v2`
 * routes are shared. A House device holding an older notification row, or one
 * running against a Worker that has not been redeployed yet, must still be able
 * to route its own invite events; the House Worker only ever sends House
 * members' events either way, so accepting both cannot cross a brand boundary.
 */
export const HOUSE_INVITE_UPDATE_TYPES = new Set([
  'house_join_request_received',
  'house_join_approved',
  'house_invite_revoked',
  'house_invite_expired',
  'budget_join_request_received',
  'budget_join_approved',
  'budget_invite_revoked',
  'budget_invite_expired',
]);

/**
 * Note an invite notification, whoever it was for.
 *
 * Returns true when the payload was one of ours, so the caller can stop
 * offering it to other handlers.
 */
export function signalHouseInviteUpdate(data: Record<string, unknown> | undefined): boolean {
  const updateType = typeof data?.updateType === 'string' ? data.updateType : undefined;
  if (!updateType || !HOUSE_INVITE_UPDATE_TYPES.has(updateType)) return false;
  useHouseEnrolmentSignal.getState().bump();
  return true;
}

/**
 * `data.updateType` values the Worker sends when a MEMBERSHIP changes — someone
 * was removed, promoted or demoted. Sent only to the member the change is about
 * (see `local-first-member-notifications.ts`).
 *
 * Both spellings, for exactly the reason the invite set above carries both: the
 * `budget_*` names shipped first and the shared `/v2` routes sent them to every
 * brand. A House device holding an older notification row, or one running
 * against a Worker that has not been redeployed yet, must still recognise its
 * own removal — and the House Worker only ever sends House members' events, so
 * accepting both cannot cross a brand boundary.
 */
export const HOUSE_MEMBER_UPDATE_TYPES = new Set([
  'house_member_removed',
  'house_member_role_changed',
  'budget_member_removed',
  'budget_member_role_changed',
]);

/** The removals, by either spelling — the two that have to DO something. */
const HOUSE_MEMBER_REMOVED_TYPES = new Set(['house_member_removed', 'budget_member_removed']);

/**
 * Note a membership notification, and — for a removal — go and check.
 *
 * A removal is the one push in this file that has to DO something rather than
 * nudge a screen: the home it names is gone, and every row it holds has to come
 * off this device. The check is what does that, and it is what decides, not this
 * payload — the push only makes it happen now instead of on the next sync. Same
 * reasoning as the counter above: a push is best-effort, can arrive out of
 * order, and is the easiest input to this flow for an attacker to make noise on.
 * A forged one costs a `GET /v2/households`.
 *
 * DYNAMICALLY imported so this module keeps the property its header claims: the
 * notification handler runs on every launch for every brand, and
 * `membershipWatch` reaches the engine, the household store and the reminder
 * scheduler. The import is paid only by a device that actually receives one of
 * these, which is a device that has just lost a home.
 *
 * Also bumped, because the removed member is very often standing on Invite &
 * home when it lands — that is where this notification navigates.
 */
export function signalHouseMemberUpdate(data: Record<string, unknown> | undefined): boolean {
  const updateType = typeof data?.updateType === 'string' ? data.updateType : undefined;
  if (!updateType || !HOUSE_MEMBER_UPDATE_TYPES.has(updateType)) return false;
  useHouseEnrolmentSignal.getState().bump();
  if (HOUSE_MEMBER_REMOVED_TYPES.has(updateType)) {
    void import('./membershipWatch')
      .then((m) => m.purgeRevokedHouseProperties('push-member-removed', { force: true }))
      .catch((error: unknown) => {
        // The sync fan-out asks the same question on its own schedule.
        console.warn('[house.local] membership check after push skipped', error);
      });
  }
  return true;
}
