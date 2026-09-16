/**
 * A device awaiting enrolment must be able to tell a wait from a dead end.
 *
 * The failing case that produced this: House-iPad held a home whose only other
 * enrolled device was a PREVIOUS identity of the same simulator — same label,
 * last seen two days earlier, destroyed by a reinstall. Nobody was left to
 * deposit the household key, so the device polled `HDK wrap not found` on every
 * heartbeat and the UI said "Waiting for the home key" indefinitely.
 *
 * The asymmetry that matters here: a false "still waiting" costs a member time,
 * while a false "unreachable" tells them their home is gone while their
 * partner's phone is merely in a drawer. Every ambiguous case below therefore
 * has to resolve to "still waiting".
 */
import { DEVICE_STALE_AFTER_MS } from '../deviceName';
import { canEnrolmentStillBeApproved } from '../enrolmentReachability';

const NOW = Date.parse('2026-09-03T18:00:00.000Z');
const SELF = 'dev_self';

const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

describe('canEnrolmentStillBeApproved', () => {
  it('is false when this device is the only one enrolled', () => {
    // Nothing to wait for: no other device has ever held the key.
    expect(
      canEnrolmentStillBeApproved([{ deviceId: SELF, status: 'active', lastSeenAt: ago(0) }], SELF, NOW),
    ).toBe(false);
  });

  it('is false when every other device has gone stale — the observed failure', () => {
    // The House-iPad case, with the stale peer aged past the threshold.
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      { deviceId: 'dev_dead', status: 'active', lastSeenAt: ago(DEVICE_STALE_AFTER_MS + DAY) },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(false);
  });

  it('is true while another device is still reaching the home', () => {
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      { deviceId: 'dev_owner', status: 'active', lastSeenAt: ago(2 * DAY) },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(true);
  });

  it('does NOT write off a device merely because the owner has not opened the app in days', () => {
    // Two days of silence is the exact state that looked identical to the dead
    // case. Below the stale threshold it must still read as a live approver —
    // this is the boundary the honest answer depends on.
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      { deviceId: 'dev_owner', status: 'active', lastSeenAt: ago(DEVICE_STALE_AFTER_MS - 1) },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(true);
  });

  it('ignores revoked devices — they hold no current key to hand over', () => {
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      { deviceId: 'dev_revoked', status: 'revoked', lastSeenAt: ago(0) },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(false);
  });

  it('falls back to enrolledAt, so a never-synced device still ages out', () => {
    // A device enrolled long ago that never once synced earns no `lastSeenAt`.
    // Treating the missing stamp as "unknown, therefore alive" is what let ghost
    // enrolments present as approvers forever.
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      {
        deviceId: 'dev_ghost',
        status: 'active',
        lastSeenAt: null,
        enrolledAt: ago(DEVICE_STALE_AFTER_MS + DAY),
      },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(false);
  });

  it('treats a freshly enrolled device as a live approver', () => {
    // An invite accepted moments ago has had no window in which to prove
    // otherwise; calling it dead would tell a member to abandon a home that is
    // seconds from opening.
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      { deviceId: 'dev_new', status: 'active', lastSeenAt: null, enrolledAt: ago(60_000) },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(true);
  });

  it('keeps waiting when a device carries no dates at all', () => {
    // Neither stamp: the record predates liveness tracking. Unknown is not dead.
    const devices = [
      { deviceId: SELF, status: 'active', lastSeenAt: ago(0) },
      { deviceId: 'dev_undated', status: 'active' },
    ];
    expect(canEnrolmentStillBeApproved(devices, SELF, NOW)).toBe(true);
  });

  it('is false on an empty roster rather than throwing', () => {
    expect(canEnrolmentStillBeApproved([], SELF, NOW)).toBe(false);
  });
});
