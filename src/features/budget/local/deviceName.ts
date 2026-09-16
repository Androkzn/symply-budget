import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { storageHelpers } from '@services/storage';

/**
 * The human name for THIS device in the trusted-device list.
 *
 * The control plane has always carried a `label` per device — registration just
 * sent the constant `'Primary'` and the UI never read it, so Device Sync showed
 * the raw `dev_652de89b0240` and nobody could tell which phone was which.
 *
 * Two sources, in order: whatever the member typed here (kept locally and
 * re-sent on every registration, so a rename survives reinstall of the peer's
 * copy of the row), else the name the OS already knows. Nothing is ever
 * required from the member — the suggestion alone is enough to make the list
 * readable.
 */

export const BUDGET_DEVICE_NAME_KEY = 'budget.local.deviceName.v1';

/** The control plane accepts 120; 40 is what fits one row without truncating. */
export const DEVICE_NAME_MAX_LENGTH = 40;

/** Trim, collapse runs of whitespace, clamp. Empty means "no override". */
export function normalizeDeviceName(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, DEVICE_NAME_MAX_LENGTH);
}

/**
 * What the OS calls this device.
 *
 * `Device.deviceName` is the name the owner gave the phone ("Andrei's iPhone"),
 * except on iOS 16+, where an app without the entitlement gets a generic
 * "iPhone" back instead. That generic answer is not equal to `modelName`
 * ("iPhone 15 Pro") but is a prefix of it — which is how we tell the two apart
 * and fall through to the model, the more useful of the two.
 */
export function suggestDeviceName(): string {
  const given = normalizeDeviceName(Device.deviceName);
  const model = normalizeDeviceName(Device.modelName);
  const generic = !given || model.toLowerCase().startsWith(given.toLowerCase());
  if (!generic) return given;
  if (model) return model;
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android phone';
  return 'This device';
}

/** The name the member typed, or null when they never renamed this device. */
export async function getDeviceNameOverride(): Promise<string | null> {
  const stored = normalizeDeviceName(await storageHelpers.getString(BUDGET_DEVICE_NAME_KEY));
  return stored.length > 0 ? stored : null;
}

/** The name to register and display: the member's, else the OS suggestion. */
export async function getLocalDeviceName(): Promise<string> {
  return (await getDeviceNameOverride()) ?? suggestDeviceName();
}

/**
 * Persist a rename. An empty string clears the override and falls back to the
 * OS suggestion, so "clear the box and save" is a working reset rather than an
 * unnamed device. Returns the name that will be registered.
 */
export async function setLocalDeviceName(raw: string): Promise<string> {
  const name = normalizeDeviceName(raw);
  await storageHelpers.setString(BUDGET_DEVICE_NAME_KEY, name);
  return name.length > 0 ? name : suggestDeviceName();
}

export type DeviceDescription = { name: string; meta: string };

/**
 * Row copy for one trusted device — name on top, plain-language status below.
 *
 * Never the engine's vocabulary: `status` / `epoch N` said nothing to the
 * member who had to decide whether to revoke the thing. The short id only
 * appears for a device nobody has named, where it is the only way to tell two
 * rows apart.
 */
/**
 * How long a device may go without reaching the household before the list
 * stops calling it "Active".
 *
 * Seven days is deliberately generous: a phone left in a drawer over a holiday
 * is not a ghost, and calling a real device dead would push someone to revoke
 * hardware they still use. Ghost enrolments — wiped, re-signed-in, abandoned —
 * never come back at all, so they cross this line and stay across it.
 */
export const DEVICE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Is this device still reaching the household?
 *
 * Falls back to `enrolledAt` when there is no `lastSeenAt`, and that fallback
 * is the whole point rather than a nicety.
 *
 * Treating "no stamp" as merely unknown — and rendering unknown as "Active" —
 * was exactly backwards: a ghost device never syncs, so it never earns a
 * stamp, so it stayed "Active" forever. The only devices the field cannot
 * speak for were precisely the ones it exists to find. Enrolment is the other
 * fact we always have, and it answers the same question: a device that joined
 * a week ago and has not once been seen since is not syncing, whether or not
 * anything ever wrote a timestamp for it.
 *
 * A device enrolled only recently is still `live` — it has not yet had the
 * window in which to prove otherwise, and calling it dead would push someone
 * to revoke hardware they just set up.
 */
export function deviceLiveness(
  lastSeenAt: string | null | undefined,
  enrolledAt?: string | null,
  now: number = Date.now(),
): 'live' | 'stale' | 'unknown' {
  const stamp = lastSeenAt ?? enrolledAt;
  if (!stamp) return 'unknown';
  const seen = Date.parse(stamp);
  if (!Number.isFinite(seen)) return 'unknown';
  return now - seen >= DEVICE_STALE_AFTER_MS ? 'stale' : 'live';
}

export function describeDevice(input: {
  label?: string | null;
  deviceId: string;
  isSelf: boolean;
  status?: string | null;
  enrolledAt?: string | null;
  /** This device's own name, for the self row before the control plane answers. */
  localName?: string | null;
  /** Server-stamped liveness — see `deviceLiveness`. */
  lastSeenAt?: string | null;
  now?: number;
}): DeviceDescription {
  const label = normalizeDeviceName(input.label);
  const localName = normalizeDeviceName(input.localName);
  const named = input.isSelf ? label || localName : label;
  const revoked = input.status === 'revoked';
  // This phone is self-evidently reaching the household — it is the one asking.
  // Its own stamp lands a poll later than the render, so trusting the field
  // here would flash "Not syncing" on the row the member is holding.
  const liveness = input.isSelf
    ? 'live'
    : deviceLiveness(input.lastSeenAt, input.enrolledAt, input.now);

  const parts: string[] = [];
  if (input.isSelf) parts.push('This device');
  if (revoked) {
    parts.push('No longer has access');
  } else if (liveness === 'stale') {
    // The whole point of the field: an enrolment that stopped syncing must not
    // keep presenting itself as "Active" beside devices that are.
    parts.push('Not syncing');
    // "Never synced" is the more useful — and commoner — of the two: a device
    // that was enrolled and then wiped or abandoned has no stamp at all, and
    // saying nothing there would leave the row asserting less than we know.
    const seen = formatEnrolledAt(input.lastSeenAt);
    parts.push(seen ? `last seen ${seen}` : 'never synced');
  } else {
    parts.push('Active');
  }
  const added = formatEnrolledAt(input.enrolledAt);
  if (added && !input.isSelf) parts.push(`added ${added}`);
  if (!named) parts.push(`ID ${shortDeviceId(input.deviceId)}`);

  return {
    name: named || (input.isSelf ? 'This device' : 'Unnamed device'),
    meta: parts.join(' · '),
  };
}

/** Last chunk of the opaque id — enough to tell two unnamed devices apart. */
export function shortDeviceId(deviceId: string): string {
  const bare = deviceId.replace(/^dev[_-]/i, '');
  return bare.length > 6 ? bare.slice(-6) : bare;
}

function formatEnrolledAt(iso?: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
