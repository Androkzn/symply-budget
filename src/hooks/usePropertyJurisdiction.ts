/**
 * Resolves the property assessment rules that apply to a household.
 *
 * The household address already carries country + province/state, so we never
 * guess: `useHouseholdStore().currentHousehold` is the input, and the shared
 * registry in `@symply/contracts` is the authority. Screens use this instead of
 * hardcoding BC copy — "BC Assessment", a January 31 appeal deadline and the
 * Home Owner Grant are wrong for eleven of the thirteen provinces and
 * territories.
 *
 * Returns `null` for a household in a region we have no rules for. Callers must
 * fall back to generic copy in that case rather than showing BC's.
 *
 * ## Two registries, one surface
 *
 * Canada and the United States are modelled by two registries with genuinely
 * different shapes (see the header of `property-jurisdiction-us.ts`): a US
 * assessment ratio belongs to a *district class* rather than to a property, a
 * rate can be quoted per $1,000, per $100 or as a percent, and value is a stack
 * — market, capped, taxable — rather than a number. Flattening the US into
 * `PropertyJurisdiction` would lose all three.
 *
 * So the countries meet at a discriminated union, `ResolvedJurisdiction`, and
 * every display helper below accepts either shape. `usePropertyJurisdiction`
 * itself is deliberately unchanged and still Canadian-only — it is consumed by
 * screens that read `PropertyJurisdiction` fields directly, and widening its
 * return type would break them. New callers that need both countries use
 * `useResolvedJurisdiction`.
 */

import { useMemo } from 'react';

import type { Household } from '@api/households';
import { useHouseholdStore } from '@stores/householdStore';
import {
  resolvePropertyJurisdiction,
  resolveUsJurisdiction,
  resolveUsCountyLookup,
  taxableValueCents,
  resolveAppealDeadline,
  usAssessmentRatioPercent,
  usTaxableValueCents,
  usJurisdictionsForState,
  US_BILL_DELIVERY,
  type PropertyJurisdiction,
  type UsStateJurisdiction,
  type UsCountyLookup,
  type UsDistrictClass,
} from '@symply/contracts';

/**
 * A jurisdiction that knows which country it came from.
 *
 * The tag is what lets a caller branch without an `as` cast: `ca` and `us` hold
 * records with no fields in common worth confusing (`authorityName` vs
 * `assessingBodyLabel`, one `assessmentRatioPercent` vs a nullable one plus
 * `districtClassRatios`), so reading the wrong one has to be a compile error
 * rather than `undefined` on screen.
 */
export type ResolvedJurisdiction =
  | { country: 'CA'; ca: PropertyJurisdiction }
  | { country: 'US'; us: UsStateJurisdiction }
  | null;

/**
 * What every display helper below accepts.
 *
 * A bare `PropertyJurisdiction` is allowed so the existing screens — which hold
 * the Canadian record from `usePropertyJurisdiction` — keep compiling and
 * behaving exactly as they did.
 */
export type JurisdictionInput = PropertyJurisdiction | ResolvedJurisdiction;

/**
 * Normalise either accepted shape to the tagged union.
 *
 * `'country' in input` is a safe discriminator precisely because
 * `PropertyJurisdiction` names its country field `countryCode`, not `country`.
 */
function asResolved(input: JurisdictionInput): ResolvedJurisdiction {
  if (!input) return null;
  if ('country' in input) return input;
  return { country: 'CA', ca: input };
}

/** Resolve the jurisdiction for an explicit household. */
export function jurisdictionForHousehold(
  household: Household | null | undefined
): PropertyJurisdiction | null {
  if (!household) return null;
  return resolvePropertyJurisdiction(household.country, household.state_province);
}

/**
 * Resolve either country's jurisdiction for an explicit household.
 *
 * The country code is consulted by both registries rather than either one being
 * a fallback for the other, because `CA` is ambiguous: `('CA', 'BC')` is Canada
 * and `('US', 'CA')` is California. A lookup that tried the Canadian registry
 * and then "fell through" to the US one would be correct only by accident.
 */
export function resolvedJurisdictionForHousehold(
  household: Household | null | undefined
): ResolvedJurisdiction {
  if (!household) return null;

  const ca = resolvePropertyJurisdiction(household.country, household.state_province);
  if (ca) return { country: 'CA', ca };

  const us = resolveUsJurisdiction(household.country, household.state_province);
  if (us) return { country: 'US', us };

  return null;
}

/**
 * The jurisdiction for the household currently in context.
 *
 * Canadian-only, and staying that way: this is what `PropertyAssessmentTab`,
 * `PropertyTaxTab` and `PropertyTaxScreen` read `documentTypes`,
 * `authorityName` and `assessedValueTerm` off directly. A US household resolves
 * to null here — use `useResolvedJurisdiction` to see it.
 */
export function usePropertyJurisdiction(
  household?: Household | null
): PropertyJurisdiction | null {
  const current = useHouseholdStore((s) => s.currentHousehold);
  const target = household === undefined ? current : household;
  return useMemo(() => jurisdictionForHousehold(target), [target]);
}

/** The tagged jurisdiction for the household currently in context. */
export function useResolvedJurisdiction(household?: Household | null): ResolvedJurisdiction {
  const current = useHouseholdStore((s) => s.currentHousehold);
  const target = household === undefined ? current : household;
  return useMemo(() => resolvedJurisdictionForHousehold(target), [target]);
}

/**
 * The label to show above an assessed value, e.g. "Current Value Assessment"
 * in Ontario or "Valeur foncière" in Quebec. Falls back to plain English.
 *
 * For a US state this is the *capped* rung of the value stack — "Factored base
 * year value" in California, "Appraised value (after the 10% homestead
 * limitation)" in Texas — because that is the number the notice prints next to
 * the word "assessed", and the number a homeowner would type in. Use
 * `valueStackLabels` where all three rungs need naming.
 */
export function assessedValueLabel(jurisdiction: JurisdictionInput): string {
  const resolved = asResolved(jurisdiction);
  if (!resolved) return 'Assessed value';
  if (resolved.country === 'US') return resolved.us.cappedValueTerm;
  return resolved.ca.assessedValueTerm;
}

/**
 * Every rung of the value stack, named the way the jurisdiction names it.
 *
 * Canada has one meaningful rung and so repeats it; the US genuinely has three,
 * and the gap between the first two is a legally named quantity a homeowner can
 * lose by selling (`capGap` — "Homestead cap loss" in Texas, the Proposition 13
 * benefit in California). Null `capGap` means no cap creates one, not that we
 * failed to look it up.
 */
export function valueStackLabels(jurisdiction: JurisdictionInput): {
  market: string;
  capped: string;
  taxable: string;
  capGap: string | null;
} {
  const resolved = asResolved(jurisdiction);

  if (resolved?.country === 'US') {
    const { us } = resolved;
    return {
      market: us.marketValueTerm,
      capped: us.cappedValueTerm,
      taxable: us.taxableValueTerm,
      capGap: us.capGapTerm,
    };
  }

  const assessed = assessedValueLabel(jurisdiction);
  return {
    market: assessed,
    capped: assessed,
    taxable: resolved?.country === 'CA' ? (resolved.ca.taxableValueTerm ?? assessed) : assessed,
    capGap: null,
  };
}

/**
 * The name to put on the assessment surface — the authority the homeowner
 * actually receives their notice from, not "BC Assessment" everywhere.
 *
 * In the US this is the office that *values* the property, which is not always
 * the county assessor and is never the office that bills: Texas is an
 * independent appraisal district (the county tax assessor-collector only
 * collects and cannot change a value), Ohio's is the County Auditor, Florida's
 * the County Property Appraiser. Maryland and Montana have no county assessor
 * at all, so `stateAgencyName` is the only correct answer there.
 *
 * The registry's own wording is returned verbatim rather than shortened — these
 * labels carry the local name of the office, and a homeowner sent to the wrong
 * one can miss a statutory deadline.
 */
export function assessmentAuthorityLabel(jurisdiction: JurisdictionInput): string {
  const resolved = asResolved(jurisdiction);
  if (!resolved) return 'Property assessment';
  if (resolved.country === 'US') {
    const { us } = resolved;
    return us.assessingJurisdictionType === 'state' ? us.stateAgencyName : us.assessingBodyLabel;
  }
  return resolved.ca.authorityName;
}

/** `$1,234,567` from cents, in the country's own separator convention. */
function formatDollars(cents: number, locale: 'en-CA' | 'en-US'): string {
  return `$${Math.round(cents / 100).toLocaleString(locale)}`;
}

/** "Actual value" → "actual value", for use mid-sentence. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Why no taxable value can be derived from the value alone in this state.
 *
 * Composed from the registry's own ratio data rather than from prose, so it
 * stays true as rates change — and so it never contains a figure that could be
 * mistaken for this property's taxable value.
 */
function usRatioUnknownNote(us: UsStateJurisdiction): string {
  if (us.districtClassRatios.length > 0) {
    const classes = us.districtClassRatios
      .map((r) => `${r.label} ${r.assessmentRatioPercent}%`)
      .join('; ');
    return `${us.taxableValueTerm} depends on which class of taxing district is levying (${classes}), so there is no single figure — read each line off your bill.`;
  }

  if (us.subStateRatios.length > 0) {
    const scopes = us.subStateRatios.map((r) => `${r.scope} ${r.ratioLabel}`).join('; ');
    return `${us.taxableValueTerm} depends on where in ${us.regionName} the property is (${scopes}), so it can't be worked out from the value alone.`;
  }

  return `${us.regionName} has no single assessment ratio, so ${lowerFirst(
    us.taxableValueTerm
  )} can't be worked out from the value alone — read it off your notice.`;
}

/**
 * A short line explaining why the taxed value differs from the assessed value,
 * or null where it does not (every province except SK and MB).
 *
 * The US path will refuse rather than guess. Colorado assesses the same home at
 * 7.05% for school levies and 6.80% for local-government levies in the same
 * year, so asking for "the" taxable value without naming a district class is an
 * ill-formed question — it returns the explanation instead of a number. Pass
 * `districtClass` and it will answer for that class. New York, Illinois,
 * Pennsylvania and New Jersey have no single statewide ratio either, and get
 * the same treatment.
 */
export function taxableValueNote(
  jurisdiction: JurisdictionInput,
  assessedCents: number | null | undefined,
  districtClass?: UsDistrictClass | null
): string | null {
  const resolved = asResolved(jurisdiction);
  if (!resolved) return null;
  if (assessedCents == null) return null;

  if (resolved.country === 'US') {
    const { us } = resolved;
    const ratio = usAssessmentRatioPercent(us, districtClass);
    // Unknowable without more input — never fall through to a number that
    // silently assumed 100%.
    if (ratio === null) return usRatioUnknownNote(us);
    if (ratio === 100) return null;

    const taxable = usTaxableValueCents(assessedCents, us, districtClass);
    if (taxable === null) return usRatioUnknownNote(us);

    const classRatio = districtClass
      ? us.districtClassRatios.find((r) => r.districtClasses.includes(districtClass))
      : undefined;
    const term = classRatio?.label ?? us.taxableValueTerm;
    return `${term}: ${formatDollars(taxable, 'en-US')} (${ratio}% of ${lowerFirst(
      us.marketValueTerm
    )})`;
  }

  const { ca } = resolved;
  if (ca.assessmentRatioPercent === 100) return null;
  const taxable = taxableValueCents(assessedCents, ca);
  const term = ca.taxableValueTerm ?? 'Taxable value';
  return `${term}: ${formatDollars(taxable, 'en-CA')} (${ca.assessmentRatioPercent}% of assessed value)`;
}

/**
 * The appeal deadline to display for an assessment year: a real date where the
 * rule allows one, otherwise the jurisdiction's explanation of where to find it.
 *
 * Both registries carry the same `AppealDeadlineRule`, including the US-only
 * `fixed-or-days-from-notice` variant — Texas is "May 15, or 30 days after the
 * notice, whichever is later", so a notice mailed in June does not leave the
 * owner already out of time.
 */
export function appealDeadlineDisplay(
  jurisdiction: JurisdictionInput,
  assessmentYear: number,
  noticeDate?: string | null
): { date: string | null; note: string | null } {
  const resolved = asResolved(jurisdiction);
  if (!resolved) return { date: null, note: null };
  const rules = resolved.country === 'US' ? resolved.us : resolved.ca;
  const date = resolveAppealDeadline(rules, assessmentYear, noticeDate);
  return { date, note: rules.appealDeadline.note ?? null };
}

/**
 * The counties in this US state we have a hand-verified lookup for.
 *
 * Empty for a Canadian jurisdiction, and empty for a US state with no seeded
 * counties — which is the common case. An empty result means "we have no
 * verified lookup", never "this state has no counties", and the caller must not
 * synthesise a county URL from a name or a FIPS code: there is no national
 * lookup and no URL naming pattern, so a guessed link 404s and a homeowner
 * following it to appeal a value can miss a deadline.
 */
export function usCountyLookupOptions(jurisdiction: JurisdictionInput): UsCountyLookup[] {
  const resolved = asResolved(jurisdiction);
  if (resolved?.country !== 'US') return [];
  return usJurisdictionsForState(resolved.us.regionCode);
}

/**
 * The county lookup for a US household, when one can be resolved.
 *
 * Resolvable means: the household is in a seeded US state, a FIPS code is known
 * for it, and that code is a county *in that state*. The last check is the
 * point — a FIPS code that has drifted out of sync with the address would
 * otherwise send a Florida homeowner to a Texas appraisal district. Returns
 * null rather than a near-miss; `usCountyLookupOptions` is what a picker shows
 * when no code is on file.
 *
 * The code is passed in rather than derived from the address because a county
 * cannot be inferred from a city: Virginia's 38 independent cities sit inside
 * no county at all, and New York City has no county assessor.
 */
export function usCountyLookup(
  jurisdiction: JurisdictionInput,
  countyFips: string | number | null | undefined
): UsCountyLookup | null {
  const resolved = asResolved(jurisdiction);
  if (resolved?.country !== 'US') return null;

  const county = resolveUsCountyLookup(countyFips);
  if (!county) return null;
  return county.stateCode === resolved.us.regionCode ? county : null;
}

/**
 * How a US homeowner actually receives their tax bill — or does not.
 *
 * Most mortgaged US homes escrow property tax, so the county mails the bill to
 * the loan servicer and the owner sees an information-only statement, sometimes
 * nothing. Any "upload your tax bill" copy has to survive that, and "no bill on
 * file" must never read as "unpaid". Null outside the US, where the bill goes
 * to the owner.
 */
export function usBillDeliveryNote(jurisdiction: JurisdictionInput): string | null {
  const resolved = asResolved(jurisdiction);
  if (resolved?.country !== 'US') return null;
  return US_BILL_DELIVERY.note;
}

export type { PropertyJurisdiction, UsStateJurisdiction, UsCountyLookup, UsDistrictClass };
