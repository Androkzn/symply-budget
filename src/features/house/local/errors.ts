import { getHouseUnsupportedCopy } from './unsupportedCopy';

/**
 * House local-first error codes (plan Appendix C).
 *
 * Named errors, not string matching: `app.onError` on the Worker and the client
 * error handlers both key on `name`, and the sync status card renders copy per
 * code.
 */
export class HouseLocalUnsupportedError extends Error {
  readonly code = 'house_local_unsupported';
  /** The P4 feature that is off, for logs — never for a member to read. */
  readonly method: string;
  /** Member-facing copy (DoD H7: "no raw error strings"). */
  readonly title: string;
  readonly memberMessage: string;
  /** Connecting an AI provider turns this one back on — see `unsupportedCopy`. */
  readonly needsAiProvider: boolean;

  constructor(method: string) {
    const copy = getHouseUnsupportedCopy(method);
    // `message` carries the member-facing text, not the method identifier: any
    // screen that renders `error.message` — and several do — would otherwise put
    // a string like `tasks.compareTaskQuotesWithAI` in front of a member. The
    // identifier stays available as `.method` for logging.
    super(copy.message);
    this.name = 'HouseLocalUnsupportedError';
    this.method = method;
    this.title = copy.title;
    this.memberMessage = copy.message;
    this.needsAiProvider = copy.needsAiProvider === true;
  }
}

export class HouseLocalNotReadyError extends Error {
  readonly code = 'house_local_not_ready';
  constructor() {
    super(
      'House local-first session is not open. Sign in once to provision the local ledger.',
    );
    this.name = 'HouseLocalNotReadyError';
  }
}

/**
 * Raised for writes attempted between claiming an invite and receiving the
 * household data key. Ops sealed under this device's pre-join key would be
 * undecryptable by every peer AND by this device once the real HDK installs,
 * so the write is refused rather than silently lost.
 */
export class HouseLocalEnrolmentPendingError extends Error {
  readonly code = 'house_local_enrolment_pending';
  constructor() {
    super(
      'Waiting for the household owner to approve this device. Changes are paused until then.',
    );
    this.name = 'HouseLocalEnrolmentPendingError';
  }
}

/** A property was addressed that this device holds no ledger for (H5 precursor). */
export class HouseLocalUnknownPropertyError extends Error {
  readonly code = 'house_local_unknown_property';
  constructor(householdId: string) {
    super(`No local ledger for property ${householdId} on this device.`);
    this.name = 'HouseLocalUnknownPropertyError';
  }
}

/**
 * Cancelling an invite the control plane has already approved (409).
 *
 * A refusal about the invite's own state, not about the network — so
 * "check you are online and try again" sends somebody to their router over a
 * state no amount of network will change. The device that invite enrolled is a
 * member now, and taking it back out is device revocation on Device sync, a
 * different act with different consequences.
 */
export class HouseInviteAlreadyApprovedError extends Error {
  readonly code = 'house_invite_already_approved';
  constructor() {
    super(
      'That invite was already approved — the device it enrolled is a member now.',
    );
    this.name = 'HouseInviteAlreadyApprovedError';
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
export class HouseInviteGoneError extends Error {
  readonly code = 'house_invite_gone';
  constructor() {
    super(
      'That invite is no longer live — it was already cancelled, or it expired.',
    );
    this.name = 'HouseInviteGoneError';
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
export class HouseInviteExpiringError extends Error {
  readonly code = 'house_invite_expiring';
  constructor() {
    super('That invite is about to run out. Ask them to send a new one.');
    this.name = 'HouseInviteExpiringError';
  }
}
