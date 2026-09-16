import { sha256 } from '@noble/hashes/sha256';

import { utf8Encode } from './bytes';

/**
 * Enrolment SAS — the short authentication string two humans compare before a
 * household data key is wrapped to a newly enrolled device.
 *
 * ## What it is for
 *
 * At enrolment the owner's device wraps the HDK to an agreement public key it
 * did not generate and cannot otherwise vouch for: the key arrives from the
 * control plane, which is the one party the product's privacy claim says must
 * not be able to read household content (BRD G4 / BR-042 / BR-067). A control
 * plane that returns its OWN key there is handed the household in wrapped form
 * and can decrypt every epoch after it.
 *
 * Nothing on the wire can detect that — both devices are talking to the very
 * party that would be lying. So the check is moved off the wire and onto the
 * two people: each device derives six digits from the key it believes is being
 * enrolled, they read them to each other, and they match only if the control
 * plane relayed the real key.
 *
 * The invitee derives from ITS OWN keys. The owner derives from the keys the
 * control plane reported. Equality is therefore exactly the statement "what I
 * was told to encrypt to is what they actually hold".
 *
 * ## Why the invite secret is an ingredient
 *
 * Without it this would be forgeable offline. An adversary in the control plane
 * sees the real claimed keys, so it can compute the honest digits and then grind
 * its own keypairs until one produces the same six — twenty bits is ~10^6 tries,
 * which is seconds of work. The comparison would pass and the substitution
 * would succeed.
 *
 * The invite secret closes that: the server stores only `sha256(secret)` (see
 * the claim path), while both humans' devices hold the secret itself — the owner
 * because it created the invite, the invitee because it was sent it. An
 * adversary that cannot compute the SAS at all cannot grind a key to match one.
 *
 * That is also why the secret must never be sent back to the server as part of
 * approval, and why the SAS cannot be verified server-side. Both are deliberate:
 * a check the untrusted party can perform is a check it can also fake.
 *
 * ## Why digits
 *
 * Decimal, not emoji or words. Emoji SAS is being deprecated in Matrix
 * (MSC4405) because two people on a phone call cannot reliably name the same
 * picture — "spanner"/"wrench" between English speakers, worse across
 * languages. Digits are read aloud identically by everyone.
 */

/**
 * Domain separator. Keeps this digest from ever colliding with another SHA-256
 * over adjacent material (the HDK wrap AAD, checkpoint roots, deterministic
 * ids) — a digest that means one thing here must not be replayable as another
 * thing there. Version suffix: changing the derivation changes this string, so
 * mismatched builds fail the comparison loudly instead of silently agreeing.
 */
const SAS_DOMAIN = 'symply-enrolment-sas-v1';

/** Six digits — the whole string a human reads aloud. */
const SAS_DIGITS = 6;
const SAS_MODULUS = 10 ** SAS_DIGITS;

export type EnrolmentSasInput = {
  /** The invite being approved — pins the SAS to one enrolment. */
  inviteId: string;
  /** Invite secret, known to both humans' devices and to no one else. */
  inviteSecret: string;
  /** Signing key of the device being enrolled, lowercase hex. */
  signingPublicKeyHex: string;
  /** Agreement key the HDK would be wrapped to, lowercase hex. */
  agreementPublicKeyHex: string;
};

/**
 * Derive the six digits both sides display.
 *
 * Inputs are lowercased and joined with a separator that cannot occur inside
 * any of them (hex and ids are alphanumeric), so no two distinct inputs can
 * canonicalise to the same string — `ab|cd` and `a|bcd` must not collide.
 */
export function deriveEnrolmentSas(input: EnrolmentSasInput): string {
  const canonical = [
    SAS_DOMAIN,
    input.inviteId.trim(),
    input.inviteSecret.trim(),
    input.signingPublicKeyHex.trim().toLowerCase(),
    input.agreementPublicKeyHex.trim().toLowerCase(),
  ].join('|');

  const digest = sha256(utf8Encode(canonical));
  // First four bytes, big-endian, reduced to six digits. `>>> 0` because the
  // top bit set would otherwise make this negative and the modulus with it.
  const head =
    (((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0) % SAS_MODULUS;
  return String(head).padStart(SAS_DIGITS, '0');
}

/**
 * `123456` → `123 456`. Grouped for reading aloud only — never compare the
 * formatted form, and never send it anywhere.
 */
export function formatEnrolmentSas(sas: string): string {
  return `${sas.slice(0, 3)} ${sas.slice(3)}`;
}
