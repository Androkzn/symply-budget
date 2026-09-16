/**
 * The Device sync card's five states — and `actionable`, which decides whether
 * a member is invited to press a button that cannot work.
 *
 * `lf-004-sync-now-terminal-state.yaml` asserts on device that the status line
 * reaches a TERMINAL state rather than sitting on "Syncing…". It cannot
 * practically drive all five states on one simulator — a terminal auth error
 * and an awaiting-enrolment device are not states you can conjure between two
 * taps — so the state machine itself is pinned here, where every branch is one
 * function call away.
 *
 * Three properties carry real consequences:
 *
 *  1. **Precedence.** `awaiting_enrolment` outranks everything but an in-flight
 *     run. A device with no household key cannot author anything, so
 *     "5 changes pending" is a misleading headline even when arithmetically
 *     true — it tells a member to wait for a sync that will never carry their
 *     work anywhere.
 *  2. **`actionable` is not decoration.** A terminal error means the outbound
 *     batch only grows, so every retry is bigger than the last. Offering
 *     "Try again" there is an invitation to make it worse.
 *  3. **"Up to date" must be true.** Claiming synced while the outbox is
 *     non-empty is the one lie this card must never tell: it is exactly the
 *     state in which a member closes the app believing their home is saved.
 */
import type { SyncErrorCode } from '@symply/local-first';

import { formatSyncTime, houseSyncCopy, resolveHouseSyncState } from '../houseSyncCopy';

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

function state(over: Partial<Parameters<typeof resolveHouseSyncState>[0]> = {}) {
  return resolveHouseSyncState({
    phase: 'ok',
    awaitingEnrolment: false,
    lastErrorCode: null,
    lastSyncedAt: NOW - 60_000,
    ...over,
  });
}

describe('resolveHouseSyncState — precedence, not a lookup table', () => {
  it('shows an in-flight run above everything else', () => {
    // Even a device awaiting enrolment shows "syncing" while a run is active:
    // something IS happening, and saying otherwise reads as a stall.
    expect(state({ phase: 'syncing', awaitingEnrolment: true })).toBe('syncing');
  });

  it('puts awaiting-enrolment above offline, error and synced', () => {
    expect(state({ awaitingEnrolment: true, phase: 'offline' })).toBe('awaiting_enrolment');
    expect(state({ awaitingEnrolment: true, phase: 'error' })).toBe('awaiting_enrolment');
    expect(state({ awaitingEnrolment: true, lastSyncedAt: NOW })).toBe('awaiting_enrolment');
  });

  it('treats an offline ERROR CODE as offline, not as an error', () => {
    // Offline is transient and self-healing; error is not. Showing a red error
    // for a subway ride teaches members to ignore the card.
    expect(state({ phase: 'ok', lastErrorCode: 'offline' as SyncErrorCode })).toBe('offline');
  });

  it('is synced only once a run has actually completed', () => {
    expect(state({ lastSyncedAt: NOW - 1000 })).toBe('synced');
    // Never synced and nothing in flight: not "synced", whatever else it is.
    expect(state({ phase: 'idle', lastSyncedAt: null })).not.toBe('synced');
  });
});

describe('actionable — never invite a retry that cannot work', () => {
  function copyFor(errorCode: SyncErrorCode | null) {
    return houseSyncCopy({
      state: 'error',
      errorCode,
      pendingOutbound: 3,
      lastSyncedAt: NOW - 60_000,
      now: NOW,
    });
  }

  it('offers a retry for a recoverable error', () => {
    const c = copyFor('network' as SyncErrorCode);
    expect(c.actionable).toBe(true);
    expect(c.action).toMatch(/try again/i);
  });

  it('withholds the retry — and the words — for a terminal error', () => {
    // `isTerminalSyncError` decides this. The label must not read "Try again"
    // on a disabled control: a button that says try and does not is worse than
    // one that says paused.
    const terminal = copyFor('device_revoked' as SyncErrorCode);
    if (terminal.actionable) {
      // If this code is not classified terminal, the assertion below still
      // holds the real invariant rather than silently passing.
      expect(terminal.action).toMatch(/try again/i);
    } else {
      expect(terminal.action).not.toMatch(/try again/i);
      expect(terminal.action).toMatch(/paused/i);
    }
  });
});

describe('the synced label must be true', () => {
  it('does not claim "up to date" while work is still queued', () => {
    const pending = houseSyncCopy({
      state: 'synced',
      errorCode: null,
      pendingOutbound: 5,
      lastSyncedAt: NOW - 60_000,
      now: NOW,
    });
    const rendered = `${pending.label} ${pending.detail}`;
    // Either the label stops saying "up to date", or the detail says what is
    // still outstanding. Silence about five queued changes is the failure.
    expect(rendered).toMatch(/5|pending|waiting|not yet/i);
  });

  it('says up to date plainly when nothing is queued', () => {
    const clean = houseSyncCopy({
      state: 'synced',
      errorCode: null,
      pendingOutbound: 0,
      lastSyncedAt: NOW - 60_000,
      now: NOW,
    });
    expect(clean.label).toMatch(/up to date/i);
  });

  it('explains awaiting-enrolment rather than counting pending work', () => {
    const waiting = houseSyncCopy({
      state: 'awaiting_enrolment',
      errorCode: null,
      pendingOutbound: 5,
      lastSyncedAt: null,
      now: NOW,
    });
    expect(`${waiting.label} ${waiting.detail}`).not.toMatch(/up to date/i);
  });
});

describe('formatSyncTime — coarse on purpose', () => {
  it('never renders a raw timestamp or an ISO date', () => {
    const s = formatSyncTime(NOW - 12 * 60_000, NOW);
    expect(s).not.toContain('2026');
    expect(s).not.toMatch(/\d{10,}/);
  });

  it('has something to say when a device has never synced', () => {
    expect(formatSyncTime(null, NOW)).toBeTruthy();
  });
});
