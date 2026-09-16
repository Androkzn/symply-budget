/**
 * Region gating utilities.
 *
 * Two different gates live here, and they are not interchangeable:
 *
 *   - `isHouseholdInGreaterVancouver` gates the *utilities* extras that really
 *     are Greater-Vancouver-specific — municipal due dates, penalty ladders and
 *     the city portal links in `municipality-configs`.
 *   - `isPropertyAssessmentSupported` gates the *property assessment and tax*
 *     surface, which works anywhere we have jurisdiction rules for. Every
 *     province and territory qualifies, as does every seeded US state; gating it
 *     on Vancouver hid the feature from most of the country, and gating it on
 *     the Canadian registry alone hid it from the US after the US registry
 *     landed.
 */

import type { Household } from '@api/households';
import {
  allUsStateJurisdictions,
  resolvePropertyJurisdiction,
  resolveUsJurisdiction,
} from '@symply/contracts';

// Greater Vancouver Area municipalities (21 municipalities)
const GREATER_VANCOUVER_CITIES = [
  'vancouver',
  'burnaby',
  'surrey',
  'richmond',
  'coquitlam',
  'new westminster',
  'north vancouver',
  'west vancouver',
  'maple ridge',
  'port coquitlam',
  'port moody',
  'pitt meadows',
  'delta',
  'langley',
  'white rock',
  'anmore',
  'belcarra',
  'lions bay',
  'bowen island',
];

/**
 * Check if household is in Greater Vancouver Area
 */
export function isHouseholdInGreaterVancouver(household: Household | null): boolean {
  if (!household) return false;

  // Must be in Canada
  if (household.country !== 'CA') return false;

  // Must be in BC
  if (household.state_province && household.state_province.toUpperCase() !== 'BC') return false;

  // Check if city is in Greater Vancouver
  if (!household.city) return false;

  const cityLower = household.city.toLowerCase().trim();

  // Check exact match or partial match
  for (const gvaCity of GREATER_VANCOUVER_CITIES) {
    if (cityLower === gvaCity || cityLower.includes(gvaCity) || gvaCity.includes(cityLower)) {
      return true;
    }
  }

  // Check for variations like "North Vancouver (City)" or "North Vancouver (District)"
  if (cityLower.includes('north vancouver') || cityLower.includes('langley')) {
    return true;
  }

  return false;
}

/**
 * Get region gate message for utilities feature
 */
export function getUtilitiesRegionGateMessage(): string {
  return 'This feature is currently available for Greater Vancouver Area homeowners only.';
}

/**
 * Whether we know how property assessment works where this household is.
 *
 * True for every Canadian province and territory, and for every seeded US
 * state. Unlike the Vancouver gate, this asks the shared jurisdiction registries
 * rather than a city allowlist, so a household in Toronto, Halifax, Houston or
 * Denver gets the feature with its own authority, deadline and assessment ratio.
 *
 * Both registries are consulted by country rather than one falling through to
 * the other, because `CA` is ambiguous: `('CA', 'BC')` is Canada and
 * `('US', 'CA')` is California. Coverage is asymmetric — Canada is complete at
 * thirteen of thirteen, the US is fifteen states and growing — which is why the
 * gate message below distinguishes them.
 */
export function isPropertyAssessmentSupported(household: Household | null): boolean {
  if (!household) return false;
  if (resolvePropertyJurisdiction(household.country, household.state_province) !== null) {
    return true;
  }
  return resolveUsJurisdiction(household.country, household.state_province) !== null;
}

/**
 * Why the property surface is unavailable, for a household we have no rules for.
 *
 * A US household in an unseeded state is the only case where "not available"
 * means "not yet, in your state" rather than "you have told us too little": all
 * thirteen Canadian regions are seeded, so an unmatched Canadian code is a bad
 * code, while an unmatched US code is usually a real state we simply have not
 * modelled. Saying so — and counting the seeded states from the registry, so the
 * number cannot go stale — keeps the message from implying the whole country is
 * unsupported.
 */
export function getPropertyAssessmentGateMessage(household: Household | null): string {
  if (!household?.country) {
    return 'Add your property address to see assessment and tax tracking for your area.';
  }
  if (!household.state_province) {
    return 'Add your province or state to your property address to see assessment and tax tracking.';
  }
  if (household.country.trim().toUpperCase() === 'US') {
    const seeded = allUsStateJurisdictions().length;
    return `Assessment and tax tracking isn't available in ${household.state_province} yet — we cover ${seeded} US states so far, and more are on the way.`;
  }
  return `Assessment and tax tracking isn't available for ${household.state_province} yet.`;
}

/**
 * Which of the four ways the property surface can be closed applies here.
 *
 * `'no-household'` — nothing to gate on yet (no home on this device).
 * `'no-country'`   — a home exists but has no country.
 * `'no-region'`    — a home exists with a country but no province/state.
 * `'unsupported-region'` — a complete address we simply have no rules for.
 *
 * The first three are the same defect wearing different hats: the member has
 * told us too little, and an address form closes the gate. The fourth is not
 * fixable by typing anything — no address seeds a jurisdiction we have not
 * modelled — and offering "Add your address" there sends the member round a
 * loop that cannot end.
 */
export type PropertyAssessmentGateReason =
  | 'no-household'
  | 'no-country'
  | 'no-region'
  | 'unsupported-region';

/**
 * The gate, in a shape a screen can render a BUTTON from.
 *
 * `getPropertyAssessmentGateMessage` says what is wrong; it does not say
 * whether the member can do anything about it, and on screen the two cases read
 * almost identically. That is how "Add your province or state to your property
 * address…" ended up shown to members who had no route to any address form at
 * all — the copy named a fix and the surface offered none.
 */
export interface PropertyAssessmentGate {
  /** True when jurisdiction rules exist — nothing gated, nothing to say. */
  supported: boolean;
  /** Null exactly when `supported` is true. */
  reason: PropertyAssessmentGateReason | null;
  /** The same text `getPropertyAssessmentGateMessage` returns; null when supported. */
  message: string | null;
  /** Whether capturing an address closes this gate — i.e. show an action. */
  fixableByAddress: boolean;
}

/**
 * The actionable companion to `getPropertyAssessmentGateMessage`.
 *
 * Deliberately built ON TOP of the two existing exports rather than beside
 * them: the message must never drift from the one other screens already show,
 * and `supported` must never disagree with the predicate the rest of the app
 * gates on. Both are re-derived here, not re-implemented.
 */
export function getPropertyAssessmentGate(
  household: Household | null
): PropertyAssessmentGate {
  if (isPropertyAssessmentSupported(household)) {
    return { supported: true, reason: null, message: null, fixableByAddress: false };
  }

  // Mirrors `getPropertyAssessmentGateMessage`'s branch order on purpose, so a
  // reason can never name a field the message does not talk about.
  let reason: PropertyAssessmentGateReason;
  if (!household) {
    reason = 'no-household';
  } else if (!household.country) {
    reason = 'no-country';
  } else if (!household.state_province) {
    reason = 'no-region';
  } else {
    reason = 'unsupported-region';
  }

  return {
    supported: false,
    reason,
    message: getPropertyAssessmentGateMessage(household),
    fixableByAddress: reason !== 'unsupported-region',
  };
}

/**
 * Is this home one address away from having a working property surface?
 *
 * The case this exists for: House local-first auto-mints a household on any
 * device with no local ledger, seeding `country` and nothing else. A member who
 * reinstalls the app is already onboarded at the ACCOUNT level, so no onboarding
 * step ever runs again and the only screen that collects city/province is never
 * shown — the home stays jurisdiction-less forever and the assessment and tax
 * surface stays shut with a message naming a fix the member cannot reach.
 *
 * `'no-household'` is excluded deliberately. A null household is not a home
 * missing an address — it is the household store not loaded yet, or a brand
 * with no household domain at all (Health, Kaizen, Language). Treating it as
 * "needs capture" would flash an address form at every member on every cold
 * start, which is worse than the bug.
 */
export function householdNeedsAddressCapture(household: Household | null): boolean {
  if (!household) return false;
  const gate = getPropertyAssessmentGate(household);
  return !gate.supported && gate.fixableByAddress;
}
