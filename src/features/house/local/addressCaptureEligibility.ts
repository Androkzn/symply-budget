/**
 * Whose home is this device allowed to be asked about?
 *
 * The address-capture gate (`usePropertyAddressCaptureGate`) raises
 * `CreateHouseholdScreen` full-screen, with no back button, over any House home
 * that has no `country` / `state_province`. That is right for a home this
 * device MINTED — local-first seeds those homes with a locale-guessed country
 * and nothing else, and nobody would ever be asked for the address otherwise.
 *
 * It is wrong for a home this device JOINED, and wrong in a way that locks a
 * member out of the app:
 *
 *  - Accepting an invite calls `adoptJoinedHousehold`, which builds a
 *    PLACEHOLDER household (`buildHousehold`) with every address field null and
 *    marks the session `awaitingKeys`. The owner's real address is not missing —
 *    it has not arrived yet, and cannot until the owner approves the device and
 *    the household keys land, at which point it replays in as ops.
 *  - So between "accepted the invite" and "owner approved", the gate asks the
 *    invitee to type an address they do not know, for a home that is not theirs,
 *    and refuses to let them past until they do.
 *  - `useHouseRecoveryGate` does not cover this. It only suppresses the gate
 *    when EVERY property is awaiting enrolment, and joining always adds a
 *    pending property BESIDE an open one — `adoptJoinedHousehold` needs an open
 *    session to adopt beside. The invitee is therefore `status: 'open'` and the
 *    gate fires.
 *
 * Two clauses, each answering a different half of "is this mine to describe?":
 *
 *  - `awaitingEnrolment` — the address is in flight, not absent. Asking now is
 *    asking for something that arrives on its own in a moment.
 *  - role is not `owner` — a member cannot be responsible for a home's address.
 *    If a joined home genuinely has no region, the OWNER is who the gate should
 *    reach, on the owner's device. An invitee later promoted to owner answers
 *    true again, which is correct: they can now set it, and by then the home has
 *    an address anyway so the gate stays shut.
 *
 * Fails OPEN (returns true) whenever there is no local session or no matching
 * property, so the server-backed path and every non-local-first caller keep the
 * behaviour they had before this existed.
 */
import { isLocalHouseSessionOpen, listLocalHouseProperties } from './engine';

export function isHouseAddressCaptureEligible(householdId: string | null | undefined): boolean {
  if (!householdId) return true;
  if (!isLocalHouseSessionOpen()) return true;

  const property = listLocalHouseProperties().find((p) => p.householdId === householdId);
  // A household the store knows and the engine does not is not a joined home —
  // it is the server-backed path, which this rule has nothing to say about.
  if (!property) return true;

  if (property.awaitingEnrolment) return false;
  return property.role.trim().toLowerCase() === 'owner';
}
