/**
 * Per-brand shape of a local-first household — **who** may be in one.
 *
 * Health plan §1.2 ("Personal, not household") / §6 Stage He5, promoted into
 * DoD He0: a Health household is one implicit **personal** ledger — exactly ONE
 * `user_id` with N devices ("your other device"). House and Budget households
 * are multi-member by design: an invite is how a *second person* joins.
 *
 * One Worker serves four brands, so the rule cannot be "reject a second user";
 * it has to be brand-scoped. The brand comes from `APP_BRAND`, stamped per
 * Worker by the fleet deploy and resolved fail-closed by `getAppBrand` — the
 * same resolution `LOCAL_FIRST_WAKE_POLICY` uses, so the two halves of the
 * personal-household decision (peer-wake exclusion and membership) are keyed off
 * one source and cannot drift into disagreement.
 *
 * The two are in fact the SAME decision seen twice, which is why they must agree.
 * `LOCAL_FIRST_WAKE_POLICY` now excludes the depositing DEVICE on every brand —
 * a peer is a device, and a member's own second device is a peer — so the peer
 * query carries no user-scoping predicate at all. That makes this table the only
 * thing keeping "a Health household holds one user" true, rather than one of two
 * (plan §2 item 4c). It is also why `personal` still cannot be inferred from the
 * wake policy: the wake no longer distinguishes the brands, and membership is
 * the only place the distinction survives.
 */
import type { Env } from '../types';

import { getAppBrand, type AppBrand } from './brand';

export interface LocalFirstHouseholdPolicy {
  /**
   * True when the household may only ever hold the owning `user_id`.
   * Invites are DEVICE enrolment for that same user, never member invites.
   */
  readonly personal: boolean;
}

export const LOCAL_FIRST_HOUSEHOLD_POLICY: Record<AppBrand, LocalFirstHouseholdPolicy> = {
  'symply-budget': { personal: false },
  'symply-house': { personal: false },
  'symply-health': { personal: true },
  // Kaizen has `localFirstApi: false`, so `requireLocalFirstApi()` 404s `/v2`
  // before any of this runs. Present only so the map is total over AppBrand — a
  // partial map would let a future brand fall through to `undefined` and read as
  // "not personal" by accident.
  'symply-kaizen': { personal: false },
};

export function resolveHouseholdPolicy(env: Env): LocalFirstHouseholdPolicy {
  return LOCAL_FIRST_HOUSEHOLD_POLICY[getAppBrand(env)];
}

/** True on a brand whose local-first households hold exactly one `user_id`. */
export function isPersonalHouseholdBrand(env: Env): boolean {
  return resolveHouseholdPolicy(env).personal;
}
