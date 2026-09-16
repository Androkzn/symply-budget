import { create } from 'zustand';

/**
 * "Something happened to an invite" — the nudge that keeps the Invite &
 * Household screen honest while it is on screen.
 *
 * Household enrolment is the one Budget flow where the next state change
 * originates on ANOTHER person's phone: they claim, they approve, they cancel.
 * The screen has no way to observe that — the local ledger does not move until
 * the household key actually arrives — so a device sitting on Invite &
 * Household would show "Waiting for approval…" for as long as it stayed there,
 * however many times the other side acted.
 *
 * The push notification already reaches this app; this is what turns receiving
 * it into a screen that has changed. Deliberately a bare counter and not the
 * payload: the screen re-reads the control plane rather than trusting a push to
 * describe household state, because a push is delivered best-effort, can arrive
 * out of order, and is the one input to this flow an attacker can most easily
 * make noise on.
 *
 * Free of imports from the budget engine on purpose — the notification handler
 * runs on every launch for every brand, and pulling the local-first ledger into
 * that path would cost every start.
 */

type EnrolmentSignalState = {
  /** Bumped whenever an invite notification lands. */
  revision: number;
  bump: () => void;
};

export const useBudgetEnrolmentSignal = create<EnrolmentSignalState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/** `data.updateType` values the Worker sends for invite lifecycle events. */
export const BUDGET_INVITE_UPDATE_TYPES = new Set([
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
export function signalBudgetInviteUpdate(data: Record<string, unknown> | undefined): boolean {
  const updateType = typeof data?.updateType === 'string' ? data.updateType : undefined;
  if (!updateType || !BUDGET_INVITE_UPDATE_TYPES.has(updateType)) return false;
  useBudgetEnrolmentSignal.getState().bump();
  return true;
}

/**
 * `data.updateType` values the Worker sends when a MEMBERSHIP changes — someone
 * was removed, promoted or demoted. Sent only to the member the change is about
 * (see `local-first-member-notifications.ts`).
 */
export const BUDGET_MEMBER_UPDATE_TYPES = new Set([
  'budget_member_removed',
  'budget_member_role_changed',
]);

/**
 * Note a membership notification, and — for a removal — go and check.
 *
 * `budget_member_removed` is the one push in this file that has to DO
 * something rather than nudge a screen: the household it names is gone, and
 * every row it holds has to come off this device. The check is what does that,
 * and it is what decides, not this payload — the push only makes it happen now
 * instead of on the next sync. Same reasoning as the counter above: a push is
 * best-effort, can arrive out of order, and is the easiest input to this flow
 * for an attacker to make noise on. A forged one costs a `GET /v2/households`.
 *
 * DYNAMICALLY imported so this module keeps the property its header claims:
 * the notification handler runs on every launch for every brand, and
 * `membershipWatch` reaches the engine, the household store and the reminder
 * scheduler. The import is paid only by a device that actually receives one of
 * these, which is a device that has just lost a household.
 *
 * Also bumped, because the removed member is very often standing on Invite &
 * Household when it lands — that is where this notification navigates.
 */
export function signalBudgetMemberUpdate(data: Record<string, unknown> | undefined): boolean {
  const updateType = typeof data?.updateType === 'string' ? data.updateType : undefined;
  if (!updateType || !BUDGET_MEMBER_UPDATE_TYPES.has(updateType)) return false;
  useBudgetEnrolmentSignal.getState().bump();
  if (updateType === 'budget_member_removed') {
    void import('./membershipWatch')
      .then((m) => m.purgeRevokedBudgetHouseholds('push-member-removed', { force: true }))
      .catch((error: unknown) => {
        // The sync fan-out asks the same question on its own schedule.
        console.warn('[budget.local] membership check after push skipped', error);
      });
  }
  return true;
}
