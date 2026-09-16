/**
 * Can this device's enrolment still be approved by ANYONE?
 *
 * A device that has claimed a property but holds no household key sits in
 * `awaitingEnrolment`: it syncs, applies nothing, and waits for an existing key
 * holder to deposit an HDK wrap in its mailbox. That wait is normally seconds —
 * the owner reads six digits and taps approve.
 *
 * It is not always a wait. When the only other enrolled devices are dead — a
 * phone that was wiped, reinstalled or lost — nobody is left who can deposit the
 * wrap, and the state never resolves. Observed on House-iPad 2026-09-03: a home
 * whose sole other device was a previous identity of the SAME simulator, last
 * seen two days earlier and gone for good. That device polled `HDK wrap not
 * found … blobsSeen=0` on every heartbeat, forever, and the orchestrator's own
 * comment names the hazard — such a device "syncs forever, applies nothing, and
 * looks identical to one that is simply up to date".
 *
 * The two cases are indistinguishable from inside the waiting device, which is
 * why nothing caught this: "waiting" and "waiting for someone who will never
 * come" produce identical logs, identical UI and identical silence. The only
 * evidence that separates them is whether any OTHER device is still reaching the
 * home, and the control plane already stamps exactly that (`lastSeenAt`).
 *
 * Deliberately conservative — this answers "is hope lost", and a false yes tells
 * a member their home is unrecoverable while their partner's phone is merely in
 * a drawer:
 *
 *   - Only `stale` counts against a device. `deviceLiveness` returns `unknown`
 *     when no stamp exists at all, and a device nobody can date must not be
 *     written off.
 *   - Recently-enrolled devices are `live` by construction (see
 *     `deviceLiveness`), so an invite accepted moments ago is never called dead.
 *   - Revoked devices are ignored: they hold no current key and could not
 *     approve anything even if they were online.
 *
 * The consequence is that this stays false for `DEVICE_STALE_AFTER_MS` (7 days)
 * after the last live device disappears. That delay is the honest answer, not a
 * shortcoming: for those 7 days "the owner has not opened the app yet" is a
 * genuinely possible explanation, and only the passage of time rules it out.
 */
import { deviceLiveness } from './deviceName';

/** The slice of a control-plane device record this question needs. */
export type EnrolmentApprover = {
  deviceId: string;
  status?: string | null;
  lastSeenAt?: string | null;
  enrolledAt?: string | null;
};

/**
 * True while some other active device could still hand over the household key.
 *
 * False means the enrolment is unreachable: every other enrolled device has
 * stopped reaching the home, so no approval can arrive and the member needs a
 * different road (restore from backup) rather than more waiting.
 */
export function canEnrolmentStillBeApproved(
  devices: readonly EnrolmentApprover[],
  ownDeviceId: string,
  now: number = Date.now(),
): boolean {
  return devices.some((device) => {
    // This device is the one asking. It cannot approve itself into a home whose
    // key it does not have — that is the entire predicament.
    if (device.deviceId === ownDeviceId) return false;
    if (device.status !== 'active') return false;
    return deviceLiveness(device.lastSeenAt, device.enrolledAt, now) !== 'stale';
  });
}
