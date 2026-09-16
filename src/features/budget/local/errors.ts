export class BudgetLocalUnsupportedError extends Error {
  constructor(method: string) {
    super(
      `Budget local-first: "${method}" is not available offline yet. Core money CRUD works without the network.`,
    );
    this.name = 'BudgetLocalUnsupportedError';
  }
}

export class BudgetLocalNotReadyError extends Error {
  constructor() {
    super('Budget local-first session is not open. Sign in once to provision the local ledger.');
    this.name = 'BudgetLocalNotReadyError';
  }
}

/**
 * Raised for writes attempted between claiming an invite and receiving the
 * household data key. Ops sealed under this device's pre-join key would be
 * undecryptable by every peer AND by this device once the real HDK installs,
 * so the write is refused rather than silently lost.
 */
export class BudgetLocalEnrolmentPendingError extends Error {
  constructor() {
    super('Waiting for the household owner to approve this device. Changes are paused until then.');
    this.name = 'BudgetLocalEnrolmentPendingError';
  }
}

/**
 * A household was addressed that this device holds no ledger for (BR-016 B2).
 *
 * Distinct from `BudgetLocalNotReadyError` on purpose. "Not ready" means no
 * session is open at all and the fix is to sign in; this means a session IS open
 * and background work named a household that is not in the registry — a stale
 * sync cursor, a push wake for a household the member just left, a screen
 * holding an id across a switch. Collapsing the two would send the member to a
 * sign-in prompt for a condition signing in cannot fix.
 */
export class BudgetLocalUnknownHouseholdError extends Error {
  readonly code = 'budget_local_unknown_household';
  /**
   * `loaded` / `active` are part of the MESSAGE, not just fields, because the
   * bare form ("no ledger for X") is unactionable in a log: it cannot tell
   * "the engine holds nothing at all" (session never opened, or was torn down
   * and not reopened) from "the engine holds a DIFFERENT household" (the store
   * is pointing at a stale id after a switch). Those have opposite fixes, and
   * on 2026-08-22 a Budget-C run produced ~1700 of these with no way to
   * distinguish them from the log alone.
   */
  constructor(householdId: string, loaded?: readonly string[], active?: string | null) {
    const detail =
      loaded === undefined
        ? ''
        : loaded.length === 0
          ? ' No sessions are open on this device.'
          : ` Open sessions: [${loaded.join(', ')}]; active: ${active ?? 'none'}.`;
    super(`No local ledger for household ${householdId} on this device.${detail}`);
    this.name = 'BudgetLocalUnknownHouseholdError';
  }
}

/**
 * Cancelling an invite the owner has already approved (control plane: 409).
 *
 * The refusal is correct and permanent: the approved device is enrolled, and
 * dropping the invite would not un-enrol it — that is device revocation, a
 * different act with different consequences. It is named because the screen
 * showing the invite cannot tell this apart from a dead network otherwise, and
 * "check you are online and try again" sends somebody to their router over a
 * state no amount of network will change. Seen in production: an owner approved
 * a device, the list of sent invites was never re-read, and every Cancel tap on
 * the row that stayed behind 409'd as an offline error.
 */
export class BudgetInviteAlreadyApprovedError extends Error {
  readonly code = 'budget_invite_already_approved';
  constructor() {
    super('That invite was already approved — the device it enrolled is a member now.');
    this.name = 'BudgetInviteAlreadyApprovedError';
  }
}

/**
 * Cancelling an invite the control plane no longer has live (404).
 *
 * The other way a row in "invites you have sent" goes stale: it was cancelled
 * from another device, or the expiry sweep retired it, between the list being
 * read and the button being tapped. The outcome the owner asked for is already
 * true, so this is not a failure — but it is not the "the code no longer works"
 * of a cancel this device performed either, and the two must not read alike.
 */
export class BudgetInviteGoneError extends Error {
  readonly code = 'budget_invite_gone';
  constructor() {
    super('That invite is no longer live — it was already cancelled, or it expired.');
    this.name = 'BudgetInviteGoneError';
  }
}

/**
 * Claiming an invite with less than the control plane's minimum life left (409).
 *
 * Not a failure of the code or the secret — both were right — so it must not
 * read as one. A claim only starts the wait; the owner still has to compare six
 * digits and approve, and an invite in its last minutes cannot survive that. The
 * control plane refuses rather than accepting a claim that is already doomed,
 * which is what leaves the invitee with something to do about it: ask for a new
 * invite, on a screen that is still able to accept one.
 */
export class BudgetInviteExpiringError extends Error {
  readonly code = 'budget_invite_expiring';
  constructor() {
    super('That invite is about to run out. Ask them to send a new one.');
    this.name = 'BudgetInviteExpiringError';
  }
}

export class CategoryNameConflictError extends Error {
  constructor(name: string) {
    super(`Category name already exists: ${name}`);
    this.name = 'CategoryNameConflictError';
  }
}
