import { storageHelpers } from '@services/storage';

/**
 * Invite secrets this device issued, kept until the invite is spent.
 *
 * The owner needs the secret twice: once to send it, and again — later, on a
 * screen it may have navigated away from and back to — to derive the enrolment
 * SAS it shows the human approving the join. The secret is an ingredient of
 * that digest precisely because the server does not hold it (it stores only a
 * hash), so there is no way to re-fetch it: an owner that forgets it cannot
 * verify anyone, and an owner that cannot verify has nothing to approve on.
 *
 * Shared by every brand's enrolment flow rather than copied into each — the
 * three control-plane clients differ, this does not.
 *
 * Never leaves the device. Never logged. Never sent back to the control plane.
 */

const STORE_KEY = 'lf-created-invite-secrets-v1';

type StoredInvite = {
  secret: string;
  /** ISO — the invite's own expiry, used to prune. */
  expiresAt: string;
};

type StoredInvites = Record<string, StoredInvite>;

async function readAll(): Promise<StoredInvites> {
  try {
    const raw = await storageHelpers.getString(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredInvites;
  } catch {
    // Unreadable store reads as empty. The cost is an owner who has to create a
    // fresh invite; the alternative — throwing here — would break the screen.
    return {};
  }
}

/**
 * Drop invites whose own expiry has passed. Runs on every write so a device
 * that issues invites for years does not accumulate live secrets for them;
 * expiry is the invite's, so nothing usable is ever discarded early.
 */
function prune(invites: StoredInvites, now: number): StoredInvites {
  const kept: StoredInvites = {};
  for (const [inviteId, entry] of Object.entries(invites)) {
    const expiry = Date.parse(entry?.expiresAt ?? '');
    if (Number.isNaN(expiry) || expiry > now) kept[inviteId] = entry;
  }
  return kept;
}

export async function rememberInviteSecret(input: {
  inviteId: string;
  secret: string;
  expiresAt: string;
}): Promise<void> {
  const invites = prune(await readAll(), Date.now());
  invites[input.inviteId] = { secret: input.secret, expiresAt: input.expiresAt };
  try {
    await storageHelpers.setString(STORE_KEY, JSON.stringify(invites));
  } catch {
    // Best effort. The invite still works for as long as the screen holds it in
    // memory, which covers the common create-then-approve-in-one-sitting path.
  }
}

/** The secret for an invite this device issued, or null if it is gone. */
export async function recallInviteSecret(inviteId: string): Promise<string | null> {
  const invites = await readAll();
  return invites[inviteId]?.secret ?? null;
}

/**
 * The digits THIS device must read out while it waits to be approved — and, once
 * the wait is over without an approval, how it ended.
 *
 * Kept on disk rather than in screen state because joining is destructive: it
 * rebinds the local ledger and switches household, which unmounts the screen
 * that started it. A number held in `useState` dies there — observed on the
 * two-device run, where the join screen was already gone by the first assertion
 * after the confirm tap. Without this the invitee has nothing to read to the
 * owner, and the comparison cannot happen at all.
 *
 * The OUTCOME is written here for the same reason and one more: it is the only
 * copy of "your invite died" that outlives the half-joined household. Once the
 * dead claim is dropped the engine no longer says this device is waiting for
 * anything, so a banner derived from engine state alone would vanish on the
 * next render and leave the person staring at a screen that had silently
 * reverted. It also stops the wait panel flashing the old digits on every
 * mount while a lookup goes to the control plane to re-learn what this record
 * already knows.
 *
 * One entry, not a map: a device can be awaiting exactly one enrolment.
 */
const JOIN_SAS_KEY = 'lf-pending-join-sas-v1';

/**
 * How a wait ended without this device being let in.
 *
 * `removed` is the third ending and the one that used to have no name: the
 * claim was APPROVED and the device then taken off the household — the member
 * was removed, or this device revoked — before the household key ever reached
 * it. The invite reads `approved`, so nothing in the invite's own lifecycle
 * says anything is wrong, and a device checking only that waits forever on a
 * key nobody is going to send. Observed on Budget-B, still showing "Waiting to
 * be let in" with the Join button disabled by that wait, so the person could
 * not claim the replacement invite either.
 */
export type JoinOutcome = 'revoked' | 'expired' | 'removed';

export type PendingJoin = {
  inviteId: string;
  /** The household claimed — whose enrolment this record is about. */
  householdId: string | null;
  sas: string;
  /** Set once the control plane says the wait ended badly. */
  outcome?: JoinOutcome;
};

export async function rememberJoinSas(input: {
  inviteId: string;
  householdId: string;
  sas: string;
}): Promise<void> {
  try {
    // Written whole, so a new claim clears the previous claim's outcome: the
    // banner about the invite that died is answered by claiming another one.
    await storageHelpers.setString(JOIN_SAS_KEY, JSON.stringify(input));
  } catch {
    // Best effort — the screen still shows it for as long as it stays mounted.
  }
}

/** The digits to display while this device waits, or null once it is enrolled. */
export async function recallJoinSas(): Promise<PendingJoin | null> {
  try {
    const raw = await storageHelpers.getString(JOIN_SAS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingJoin>;
    if (!parsed?.sas || !parsed?.inviteId) return null;
    return {
      inviteId: parsed.inviteId,
      // Absent in records written before this field existed. Null is honest —
      // callers fall back to the active household rather than guessing.
      householdId: parsed.householdId ?? null,
      sas: parsed.sas,
      ...(parsed.outcome === 'revoked' || parsed.outcome === 'expired'
        ? { outcome: parsed.outcome }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Record how a wait ended, keeping the record itself.
 *
 * Deliberately not a delete: the person is owed an explanation for a household
 * that is about to disappear from their device, and this is what carries it
 * across the remount that follows.
 */
export async function noteJoinOutcome(outcome: JoinOutcome): Promise<void> {
  const pending = await recallJoinSas();
  if (!pending || pending.outcome === outcome) return;
  try {
    await storageHelpers.setString(JOIN_SAS_KEY, JSON.stringify({ ...pending, outcome }));
  } catch {
    // Best effort — the live lookup still drives this session's banner.
  }
}

/** Clear once the household key has landed, or once the person has read why it did not. */
export async function forgetJoinSas(): Promise<void> {
  try {
    await storageHelpers.delete(JOIN_SAS_KEY);
  } catch {
    // A stale number is only shown while the engine still says this device is
    // awaiting enrolment, so it stops being rendered whether or not this
    // succeeded.
  }
}

/** Forget a spent invite — call after approval, or when it is revoked. */
export async function forgetInviteSecret(inviteId: string): Promise<void> {
  const invites = await readAll();
  if (!invites[inviteId]) return;
  delete invites[inviteId];
  try {
    await storageHelpers.setString(STORE_KEY, JSON.stringify(prune(invites, Date.now())));
  } catch {
    // Leaving a spent secret behind is harmless: the invite is already approved
    // and cannot be claimed again.
  }
}
