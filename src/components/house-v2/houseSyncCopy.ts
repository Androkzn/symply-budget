/**
 * Member-facing copy for the House V2 sync surface.
 *
 * Pure functions, no React — so the wording itself is unit-testable and the card
 * stays a rendering concern. Two rules the whole file exists to enforce:
 *
 * 1. **Never render `lastError`.** It is a raw system string (`Request failed
 *    with status code 413`, `aead: unseal failed`) kept for logs. The store
 *    already classifies the failure into a `SyncErrorCode`; that code is what the
 *    UI is allowed to speak from.
 * 2. **Never dress a permanent failure as a transient one.** `payload_too_large`
 *    is terminal — the outbound batch only grows, so every retry is bigger than
 *    the last. Telling a member "tap to retry" there is a promise the app cannot
 *    keep, which is exactly the bug `isTerminalSyncError` was introduced to name.
 */
import { isTerminalSyncError, type SyncErrorCode } from '@symply/local-first';

/**
 * What the card is showing. Derived from the store rather than stored, so the
 * precedence between "waiting for approval" and "offline" lives in one place.
 */
export type HouseSyncState =
  | 'awaiting_enrolment'
  | 'syncing'
  | 'offline'
  | 'error'
  | 'synced'
  | 'idle';

export type HouseSyncCopy = {
  /** The one-line state, e.g. "Up to date". */
  label: string;
  /** The sentence under it. Empty string when the label says everything. */
  detail: string;
  /** Label for the action button. */
  action: string;
  /**
   * False when pressing the action cannot possibly help. The button is then
   * disabled instead of inviting a retry that is guaranteed to fail.
   */
  actionable: boolean;
};

/** Inputs the copy depends on — everything else on the store is diagnostic. */
export type HouseSyncCopyInput = {
  state: HouseSyncState;
  errorCode: SyncErrorCode | null;
  pendingOutbound: number;
  lastSyncedAt: number | null;
  now?: number;
};

/**
 * Resolve the state the card should show, in precedence order.
 *
 * Enrolment wins over everything except an in-flight run: a device that is still
 * waiting for the household key cannot author anything, so "5 changes pending"
 * would be a misleading headline even when it is arithmetically true.
 */
export function resolveHouseSyncState(input: {
  phase: 'idle' | 'syncing' | 'ok' | 'error' | 'offline';
  awaitingEnrolment: boolean;
  lastErrorCode: SyncErrorCode | null;
  lastSyncedAt: number | null;
}): HouseSyncState {
  if (input.phase === 'syncing') return 'syncing';
  if (input.awaitingEnrolment) return 'awaiting_enrolment';
  if (input.phase === 'offline' || input.lastErrorCode === 'offline') return 'offline';
  if (input.phase === 'error') return 'error';
  if (input.lastSyncedAt != null) return 'synced';
  return 'idle';
}

/**
 * "Just now" / "12 minutes ago" / "yesterday" / a date.
 *
 * Deliberately coarse: a member reading a sync card wants to know whether it is
 * fresh, not the second it happened, and a ticking "37 seconds ago" is noise
 * that also forces the card to re-render every tick.
 */
export function formatSyncTime(lastSyncedAt: number | null, now = Date.now()): string {
  if (lastSyncedAt == null) return 'Not yet';
  const deltaMs = now - lastSyncedAt;
  // Clock skew (or a peer's timestamp) can put "last synced" slightly ahead of
  // this device's clock. "In 3 minutes" would be nonsense; "Just now" is true.
  if (deltaMs < 60_000) return 'Just now';

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(lastSyncedAt).toLocaleDateString();
}

function pendingSentence(pendingOutbound: number): string {
  if (pendingOutbound <= 0) return '';
  return pendingOutbound === 1
    ? '1 change is waiting to send.'
    : `${pendingOutbound} changes are waiting to send.`;
}

/**
 * Copy per failure code.
 *
 * Every sentence has to leave the member knowing two things: whether their data
 * is safe (it always is — the ledger is local) and whether they should do
 * something. Anything that is not both of those is decoration.
 */
function errorCopy(code: SyncErrorCode | null): Pick<HouseSyncCopy, 'label' | 'detail'> {
  switch (code) {
    case 'payload_too_large':
      return {
        label: 'Sync is paused',
        detail:
          'This device has more changes waiting than we can send in one go. Nothing is lost, but syncing will not restart on its own — please get in touch so we can clear the backlog.',
      };
    case 'auth':
      return {
        label: 'Sign in again to sync',
        detail:
          'Your session expired, so we cannot reach your household right now. Everything you changed is safe on this device.',
      };
    case 'key_epoch':
      return {
        label: 'Your household key changed',
        detail:
          'Someone was added or removed, so the household re-keyed. Try again — this usually clears on the next sync.',
      };
    case 'decrypt':
      return {
        label: 'One update could not be read',
        detail:
          'An update from another device did not open on this one, so it was skipped. Try again; if it keeps happening, that device may need to send it fresh.',
      };
    case 'server':
      return {
        label: 'Sync is unavailable',
        detail:
          'We could not reach the sync service. Your changes are safe on this device and will go out when it is back.',
      };
    case 'offline':
      return {
        label: 'You are offline',
        detail:
          'Everything you change is saved on this device and will sync as soon as you are back online.',
      };
    default:
      return {
        label: 'Sync did not finish',
        detail: 'Your changes are safe on this device. Try again in a moment.',
      };
  }
}

export function houseSyncCopy(input: HouseSyncCopyInput): HouseSyncCopy {
  const pending = pendingSentence(input.pendingOutbound);

  switch (input.state) {
    case 'syncing':
      return {
        label: 'Syncing…',
        detail: pending || 'Checking for changes from the rest of your household.',
        action: 'Syncing…',
        actionable: false,
      };

    case 'awaiting_enrolment':
      return {
        label: 'Waiting for approval',
        detail:
          'Someone already in this home has to approve this device before it can join. Until then you can look around, but changes you make here stay on this device.',
        action: 'Check again',
        actionable: true,
      };

    case 'offline': {
      const copy = errorCopy('offline');
      return {
        label: copy.label,
        detail: pending ? `${pending} ${copy.detail}` : copy.detail,
        action: 'Try again',
        actionable: true,
      };
    }

    case 'error': {
      const copy = errorCopy(input.errorCode);
      const terminal = input.errorCode != null && isTerminalSyncError(input.errorCode);
      return {
        label: copy.label,
        detail: pending ? `${pending} ${copy.detail}` : copy.detail,
        action: terminal ? 'Sync paused' : 'Try again',
        actionable: !terminal,
      };
    }

    case 'synced': {
      const when = formatSyncTime(input.lastSyncedAt, input.now);
      return {
        label: pending ? 'Almost up to date' : 'Up to date',
        detail: pending
          ? `${pending} Last synced ${when.toLowerCase()}.`
          : `Last synced ${when.toLowerCase()}.`,
        action: 'Sync now',
        actionable: true,
      };
    }

    case 'idle':
    default:
      return {
        label: 'Not synced yet',
        detail: pending
          ? `${pending} Sync to send them to the rest of your household.`
          : 'This home has not synced on this device yet.',
        action: 'Sync now',
        actionable: true,
      };
  }
}
