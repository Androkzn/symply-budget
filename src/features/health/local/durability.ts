/**
 * Stage He9 — **durability status**: what actually protects this person's health
 * data right now (plan §10, §17 abort row).
 *
 * ## Why this exists at all
 *
 * §17 says that while §16 Q8 is open, He9 may ship *"no restore claim; ≥2-device
 * durability copy only"*. That sentence names a mechanism but nothing in the app
 * could report on it, and a durability guarantee nobody can see is not a
 * guarantee — it is a hope. This module is the substance behind the copy: a
 * truthful, testable answer to *how many places does a copy of my ledger exist,
 * and when did they last agree*.
 *
 * ## The three facts, and why it is exactly these three
 *
 *  1. **How many of this person's devices are enrolled and active.** This is the
 *     durability mechanism §17 permits. A `ThisDeviceOnly` DEK means an
 *     encrypted iCloud/iTunes backup does not carry the ledger key (§5), so a
 *     second *enrolled device* — not a backup, not Quick Start — is the only
 *     thing standing between a dropped phone and total loss.
 *  2. **Whether a checkpoint has been published.** A checkpoint is what lets an
 *     enrolled device rebuild after the op log is compacted below the watermark
 *     (`sync/checkpoints.ts`). It is stored opaquely on the relay, so it adds
 *     nothing on its own — it is only reachable by a device holding the HDK,
 *     which is why it is reported *alongside* the device count and never as a
 *     substitute for it.
 *  3. **When the devices last synced.** Two devices that have not exchanged ops
 *     for a month hold two different ledgers, and only one of them is current.
 *
 * ## Truthfulness is the whole contract
 *
 * Every field that depends on the network is nullable, and `level` collapses to
 * `'unknown'` the moment the control plane cannot be read. An offline read must
 * never render "your data is safe on two devices" from a cached hope — the one
 * person who will look at this screen is the person who just lost a phone.
 *
 * Vocabulary: devices, never people. Health is one user with N devices
 * (plan §1.2) and the He12 E2E asserts no invite-partner copy on any screen, so
 * "your other device" is the only correct phrasing — see `unsupportedCopy.ts`.
 */
import {
  fetchHealthControlPlaneState,
  fetchLatestHealthCheckpoint,
  HealthSecondUserRefusedError,
} from './controlPlaneClient';
import {
  getLocalHealthDeviceId,
  getLocalHealthHouseholdKeys,
  isLocalHealthSessionOpen,
} from './engine';
import { useHealthSyncStatusStore } from './sync/syncStatusStore';

/* ==================================================================== */
/* Status                                                                */
/* ==================================================================== */

/**
 * `'unknown'` is a first-class answer, not a failure code.
 *
 * The alternative — defaulting to `'this-device-only'` when the control plane is
 * unreachable — would alarm a person on a plane, and defaulting the other way
 * would reassure a person whose second device was revoked. Neither is true, so
 * neither is reported.
 */
export type HealthDurabilityLevel = 'unknown' | 'this-device-only' | 'more-than-one-device';

export type HealthDurabilityStatus = {
  /** No open ledger means nothing below can be established. */
  sessionOpen: boolean;
  /** Whether the device/checkpoint facts below were actually read this run. */
  controlPlaneReachable: boolean;
  thisDeviceId: string | null;
  /** Active enrolled devices, this one included. `null` when unread. */
  enrolledDeviceCount: number | null;
  /** The same count minus this device — what "a copy elsewhere" means. */
  otherDeviceCount: number | null;
  /** `null` when unread; `false` is a real answer and a meaningful one. */
  checkpointPublished: boolean | null;
  checkpointGeneration: number | null;
  /** Checkpoints expire (90 days, `CHECKPOINT_TTL_MS`) — a stale one is not durability. */
  checkpointExpiresAt: string | null;
  /** Epoch ms of the last successful sync, from the live sync status store. */
  lastSyncedAt: number | null;
  level: HealthDurabilityLevel;
};

const UNKNOWN_STATUS: HealthDurabilityStatus = {
  sessionOpen: false,
  controlPlaneReachable: false,
  thisDeviceId: null,
  enrolledDeviceCount: null,
  otherDeviceCount: null,
  checkpointPublished: null,
  checkpointGeneration: null,
  checkpointExpiresAt: null,
  lastSyncedAt: null,
  level: 'unknown',
};

/**
 * Level from facts, in one place so the copy selector cannot invent a fourth
 * rule. Exported for the test, which asserts the boundary rather than the
 * rendering.
 *
 * `more-than-one-device` requires a second *active* device. A published
 * checkpoint deliberately does NOT raise the level on its own: it is ciphertext
 * addressed to HDK-holders, and if this handset is the only HDK-holder alive
 * then the checkpoint is 90 days of unreadable bytes.
 */
export function healthDurabilityLevelOf(input: {
  controlPlaneReachable: boolean;
  enrolledDeviceCount: number | null;
}): HealthDurabilityLevel {
  if (!input.controlPlaneReachable || input.enrolledDeviceCount === null) return 'unknown';
  return input.enrolledDeviceCount >= 2 ? 'more-than-one-device' : 'this-device-only';
}

/**
 * Read the real state. Network-touching, and every network failure downgrades a
 * claim rather than throwing.
 *
 * The one error that is NOT swallowed is `HealthSecondUserRefusedError`: a
 * second `user_id` on a personal household is a fail-closed security condition
 * (He5), and reporting it as "offline" would hide it behind a wifi icon.
 */
export async function getHealthDurabilityStatus(): Promise<HealthDurabilityStatus> {
  if (!isLocalHealthSessionOpen()) return { ...UNKNOWN_STATUS };

  const householdId = getLocalHealthHouseholdKeys().householdId;
  const thisDeviceId = getLocalHealthDeviceId();
  const lastSyncedAt = useHealthSyncStatusStore.getState().lastSyncedAt;

  let enrolledDeviceCount: number | null = null;
  let controlPlaneReachable = false;
  try {
    const state = await fetchHealthControlPlaneState(householdId);
    // `assertHealthPersonalHousehold` inside the fetch already guarantees one
    // user, so every active device here is one of theirs. Counted, not listed:
    // a durability screen needs a number, and device rows are metadata this
    // module has no reason to hold.
    enrolledDeviceCount = state.devices.filter((device) => device.status === 'active').length;
    controlPlaneReachable = true;
  } catch (error) {
    if (error instanceof HealthSecondUserRefusedError) throw error;
    controlPlaneReachable = false;
  }

  let checkpointPublished: boolean | null = null;
  let checkpointGeneration: number | null = null;
  let checkpointExpiresAt: string | null = null;
  if (controlPlaneReachable) {
    try {
      // `null` here is a 404 — "no checkpoint yet" — which is a fact, not a
      // failure. A thrown error is a failure and leaves all three fields null.
      const latest = await fetchLatestHealthCheckpoint(householdId);
      checkpointPublished = latest !== null;
      checkpointGeneration = latest?.generation ?? null;
      checkpointExpiresAt = latest?.expiresAt ?? null;
    } catch {
      checkpointPublished = null;
    }
  }

  return {
    sessionOpen: true,
    controlPlaneReachable,
    thisDeviceId,
    enrolledDeviceCount,
    otherDeviceCount: enrolledDeviceCount === null ? null : Math.max(0, enrolledDeviceCount - 1),
    checkpointPublished,
    checkpointGeneration,
    checkpointExpiresAt,
    lastSyncedAt,
    level: healthDurabilityLevelOf({ controlPlaneReachable, enrolledDeviceCount }),
  };
}

/* ==================================================================== */
/* Copy                                                                  */
/* ==================================================================== */

export type HealthDurabilityCopyEntry = {
  title: string;
  message: string;
};

/**
 * The in-product durability copy — a documented exported constant, in the
 * single-user Health voice.
 *
 * ## Rules this copy is written to, each of which has teeth
 *
 *  - **Devices, never people.** No member, invite, partner, household or owner.
 *    `he9Backup.copy.test.ts` greps for those words and the He12 E2E
 *    (`td-40-no-invite-partner-copy.yaml`) asserts them absent on every screen.
 *  - **No restore claim, in any tense.** §17: *"Ship no restore claim."* Not
 *    "you can restore later", not "we will be able to bring it back". Q8 is
 *    open, so any sentence that implies a new phone can be repopulated is a
 *    promise the app cannot keep — and the person reading it will be reading it
 *    at the worst possible moment. The same test greps for those verbs.
 *  - **Name the mechanism that does exist.** A second enrolled device. That is
 *    the whole of §17's permitted claim, and stating it is what turns "your data
 *    is only here" from a warning into an instruction.
 *  - **No encryption mechanics.** No DEK, no HDK, no AEAD — the same rule
 *    `unsupportedCopy.ts` states for its own entries.
 */
export const HEALTH_DURABILITY_COPY = {
  /** The standing statement, true regardless of how Q8 lands. */
  headline: 'Your health data lives on your devices',
  body:
    'Symply Health keeps your records on the devices you use, not on our servers. ' +
    'That is what stops anyone else reading them — and it also means a copy exists ' +
    'only where you have put one.',

  /** One entry per `HealthDurabilityLevel`. */
  levels: {
    'this-device-only': {
      title: 'This device holds the only copy',
      message:
        'Your health records are on this device and nowhere else. If it is lost, damaged or ' +
        'replaced, they go with it. Adding your other device keeps a second copy in step ' +
        'automatically, and that is what protects them today.',
    },
    'more-than-one-device': {
      title: 'Your devices each hold a copy',
      message:
        'Your health records are kept in step across the devices you have added, so losing ' +
        'one of them does not lose your records. Open Symply Health on each device now and ' +
        'then so they stay up to date with each other.',
    },
    unknown: {
      title: 'We could not check your devices',
      message:
        'Symply Health could not reach the sync service just now, so it cannot tell you how ' +
        'many of your devices hold a copy. Your records on this device are unaffected. ' +
        'Try again when you are back online.',
    },
  },

  /**
   * The archive row. Says what the file is *for* — a copy you hold — and states
   * the limitation in the same breath rather than in a footnote.
   */
  archive: {
    title: 'Save an encrypted copy',
    message:
      'This saves an encrypted copy of your health records wherever you choose to put it. ' +
      'Only a device already set up with your Symply Health data can open it, so keep using ' +
      'your own devices as the way your records stay safe.',
  },

  /**
   * The sentence that must be shown next to any archive action, and the reason
   * `restoreHealthLedgerFromArchive()` throws. Kept separate so a screen cannot
   * render the archive row without a reviewer noticing this one is missing.
   */
  archiveLimit:
    'A saved copy cannot be opened on a device that has not been set up with your Symply Health data.',
} as const;

/** Every string in `HEALTH_DURABILITY_COPY`, flattened — what the copy test greps. */
export function healthDurabilityCopyStrings(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (value && typeof value === 'object') for (const child of Object.values(value)) walk(child);
  };
  walk(HEALTH_DURABILITY_COPY);
  return out;
}

/** Level → copy. One rule, so a screen cannot pick a friendlier entry. */
export function healthDurabilityCopyFor(
  status: Pick<HealthDurabilityStatus, 'level'>,
): HealthDurabilityCopyEntry {
  return HEALTH_DURABILITY_COPY.levels[status.level];
}
