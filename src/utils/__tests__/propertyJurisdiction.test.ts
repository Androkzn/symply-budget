/**
 * Property jurisdiction registry — the rules that decide how an assessed value
 * is read and taxed in each province and territory.
 *
 * These tests exist because the feature shipped assuming British Columbia
 * everywhere. The assertions below are deliberately specific about the facts
 * that differ between provinces (assessment ratios, appeal-deadline shapes,
 * which provinces have no homeowner grant), because a "helpful" default that
 * silently applies BC's rules to a Winnipeg household is exactly the bug this
 * registry was written to prevent.
 *
 * Note `packages/**` is outside the root jest roots, so the registry is
 * exercised here, through the same `@symply/contracts` import the app uses.
 */

import type { Household } from '@api/households';
import {
  PROPERTY_JURISDICTIONS,
  propertyJurisdictionKey,
  resolvePropertyJurisdiction,
  propertyJurisdictionsForCountry,
  taxableValueCents,
  resolveAppealDeadline,
  allUsStateJurisdictions,
  resolveUsJurisdiction,
} from '@symply/contracts';

import {
  isPropertyAssessmentSupported,
  getPropertyAssessmentGateMessage,
  isHouseholdInGreaterVancouver,
} from '../region-gating';

const household = (over: Partial<Household> = {}): Household =>
  ({
    id: 'hh-1',
    name: 'Test property',
    country: 'CA',
    state_province: 'BC',
    city: 'Vancouver',
    ...over,
  }) as Household;

const ALL_CA = [
  'BC',
  'AB',
  'SK',
  'MB',
  'ON',
  'QC',
  'NB',
  'NS',
  'PE',
  'NL',
  'YT',
  'NT',
  'NU',
];

describe('registry coverage', () => {
  it('covers every Canadian province and territory', () => {
    expect(propertyJurisdictionsForCountry('CA')).toHaveLength(ALL_CA.length);
    for (const region of ALL_CA) {
      expect(resolvePropertyJurisdiction('CA', region)).not.toBeNull();
    }
  });

  it('gives every jurisdiction an authority, a source and real document types', () => {
    for (const j of Object.values(PROPERTY_JURISDICTIONS)) {
      expect(j.authorityName.length).toBeGreaterThan(0);
      expect(j.authorityUrl).toMatch(/^https:\/\//);
      expect(j.sourceUrl).toMatch(/^https:\/\//);
      expect(j.documentTypes.length).toBeGreaterThan(0);
      expect(j.languages.length).toBeGreaterThan(0);
    }
  });

  it('gives every relief program an official link and a stated apply mode', () => {
    for (const j of Object.values(PROPERTY_JURISDICTIONS)) {
      for (const p of j.reliefPrograms) {
        expect(p.url).toMatch(/^https:\/\//);
        expect(['on-bill', 'apply', 'income-tax-return']).toContain(p.applyMode);
      }
    }
  });

  it('pairs a lookup hint with every jurisdiction that has no lookup url', () => {
    for (const j of Object.values(PROPERTY_JURISDICTIONS)) {
      if (j.lookupUrl === null) {
        expect(j.lookupHint).toBeTruthy();
      }
    }
  });
});

describe('resolution', () => {
  it('is case and whitespace insensitive', () => {
    expect(resolvePropertyJurisdiction('ca', 'on')?.regionCode).toBe('ON');
    expect(resolvePropertyJurisdiction(' CA ', ' bc ')?.regionCode).toBe('BC');
  });

  it('returns null rather than guessing for missing or unknown regions', () => {
    expect(resolvePropertyJurisdiction('CA', null)).toBeNull();
    expect(resolvePropertyJurisdiction(null, 'BC')).toBeNull();
    expect(resolvePropertyJurisdiction('CA', 'ZZ')).toBeNull();
    // The US *does* have a registry now — a separate one, with a different
    // shape. This function must still answer null for every US state, seeded or
    // not: the two registries stay separate on purpose, and a US household is
    // resolved through `resolveUsJurisdiction` instead.
    expect(resolvePropertyJurisdiction('US', 'WA')).toBeNull();
    expect(resolvePropertyJurisdiction('US', 'TX')).toBeNull();
    expect(resolveUsJurisdiction('US', 'TX')).not.toBeNull();
  });

  it('keeps the two registries apart, because CA is both Canada and California', () => {
    // The single most dangerous key collision in this feature. If either lookup
    // ever normalised on the region code alone, a Vancouver household would be
    // handed Proposition 13 and a Californian would be handed the BC Home Owner
    // Grant — both perfectly plausible on screen.
    expect(resolvePropertyJurisdiction('CA', 'BC')!.regionName).toBe('British Columbia');
    expect(resolveUsJurisdiction('US', 'CA')!.regionName).toBe('California');
    expect(resolveUsJurisdiction('CA', 'BC')).toBeNull();
    expect(resolveUsJurisdiction('CA', 'CA')).toBeNull();
    expect(resolvePropertyJurisdiction('US', 'CA')).toBeNull();
  });

  it('builds keys predictably', () => {
    expect(propertyJurisdictionKey('CA', 'MB')).toBe('CA-MB');
    expect(propertyJurisdictionKey('CA', null)).toBeNull();
  });
});

describe('assessment ratios', () => {
  it('taxes Saskatchewan at 80% and Manitoba at 45% of assessed value', () => {
    expect(resolvePropertyJurisdiction('CA', 'SK')!.assessmentRatioPercent).toBe(80);
    expect(resolvePropertyJurisdiction('CA', 'MB')!.assessmentRatioPercent).toBe(45);
  });

  it('taxes the other provinces at 100%', () => {
    for (const region of ALL_CA.filter((r) => r !== 'SK' && r !== 'MB')) {
      expect(resolvePropertyJurisdiction('CA', region)!.assessmentRatioPercent).toBe(100);
    }
  });

  it('converts an assessed value to the value actually taxed', () => {
    const sk = resolvePropertyJurisdiction('CA', 'SK');
    const mb = resolvePropertyJurisdiction('CA', 'MB');
    const bc = resolvePropertyJurisdiction('CA', 'BC');

    // $500,000 in cents.
    const assessed = 500_000_00;

    expect(taxableValueCents(assessed, sk)).toBe(400_000_00);
    expect(taxableValueCents(assessed, mb)).toBe(225_000_00);
    expect(taxableValueCents(assessed, bc)).toBe(assessed);
  });

  it('leaves the value untouched when no jurisdiction is known', () => {
    expect(taxableValueCents(123_456, null)).toBe(123_456);
  });

  it('rounds to whole cents rather than emitting fractions', () => {
    const mb = resolvePropertyJurisdiction('CA', 'MB');
    // 333333 * 0.45 = 149999.85 → must not leak a fractional cent.
    expect(Number.isInteger(taxableValueCents(333_333, mb))).toBe(true);
  });

  it('names the taxed value wherever it differs from the assessed value', () => {
    expect(resolvePropertyJurisdiction('CA', 'SK')!.taxableValueTerm).toBe(
      'Taxable assessment'
    );
    expect(resolvePropertyJurisdiction('CA', 'MB')!.taxableValueTerm).toBe(
      'Portioned assessment'
    );
  });
});

describe('appeal deadlines', () => {
  it('derives a fixed date for British Columbia', () => {
    const bc = resolvePropertyJurisdiction('CA', 'BC');
    expect(resolveAppealDeadline(bc, 2026)).toBe('2026-01-31');
  });

  it('derives Quebec April 30 from the assessment year', () => {
    const qc = resolvePropertyJurisdiction('CA', 'QC');
    expect(resolveAppealDeadline(qc, 2027)).toBe('2027-04-30');
  });

  it('counts Alberta forward from the notice date, not the calendar', () => {
    const ab = resolvePropertyJurisdiction('CA', 'AB');
    expect(ab!.appealDeadline.kind).toBe('days-from-notice');
    expect(resolveAppealDeadline(ab, 2026, '2026-01-14')).toBe('2026-03-15');
  });

  it('gives up honestly when Alberta has no notice date yet', () => {
    const ab = resolvePropertyJurisdiction('CA', 'AB');
    expect(resolveAppealDeadline(ab, 2026)).toBeNull();
    expect(resolveAppealDeadline(ab, 2026, 'not-a-date')).toBeNull();
  });

  it('returns null where the deadline is only printed on the notice', () => {
    for (const region of ['SK', 'MB', 'ON']) {
      const j = resolvePropertyJurisdiction('CA', region);
      expect(j!.appealDeadline.kind).toBe('printed-on-notice');
      expect(resolveAppealDeadline(j, 2026, '2026-01-05')).toBeNull();
      // …but always explains where to find it, so the UI has something to say.
      expect(j!.appealDeadline.note).toBeTruthy();
    }
  });

  it('never hands another province British Columbia January 31', () => {
    for (const region of ALL_CA.filter((r) => r !== 'BC')) {
      const j = resolvePropertyJurisdiction('CA', region);
      expect(resolveAppealDeadline(j, 2026, '2026-01-14')).not.toBe('2026-01-31');
    }
  });
});

describe('relief programs', () => {
  it('has no homeowner grant in Alberta, Saskatchewan or Newfoundland', () => {
    expect(
      resolvePropertyJurisdiction('CA', 'AB')!.reliefPrograms.filter((p) => p.kind === 'grant')
    ).toHaveLength(0);
    expect(
      resolvePropertyJurisdiction('CA', 'SK')!.reliefPrograms.filter((p) => p.kind === 'grant')
    ).toHaveLength(0);
    expect(resolvePropertyJurisdiction('CA', 'NL')!.reliefPrograms).toHaveLength(0);
  });

  it('keeps the BC Home Owner Grant as something the owner must apply for', () => {
    const hog = resolvePropertyJurisdiction('CA', 'BC')!.reliefPrograms.find(
      (p) => p.id === 'bc-hog'
    );
    expect(hog?.applyMode).toBe('apply');
    expect(hog?.url).toContain('gov.bc.ca');
  });

  it('treats the Manitoba credit as automatic, so it is not nagged about', () => {
    const hatc = resolvePropertyJurisdiction('CA', 'MB')!.reliefPrograms.find(
      (p) => p.id === 'mb-hatc'
    );
    expect(hatc?.applyMode).toBe('on-bill');
  });
});

describe('jurisdiction quirks that change how a value reads', () => {
  it('flags Quebec as French so extraction picks the right prompt', () => {
    expect(resolvePropertyJurisdiction('CA', 'QC')!.languages).toContain('fr');
  });

  it('keeps Ontario on its frozen 2016 valuation date', () => {
    const on = resolvePropertyJurisdiction('CA', 'ON')!;
    expect(on.valuationDateRule).toContain('2016');
    expect(on.assessedValueTerm).toContain('Current Value Assessment');
  });

  it('holds Saskatchewan on a four-year cycle and Manitoba on two', () => {
    expect(resolvePropertyJurisdiction('CA', 'SK')!.cycleYears).toBe(4);
    expect(resolvePropertyJurisdiction('CA', 'MB')!.cycleYears).toBe(2);
  });

  it('records that Nova Scotia notices carry a capped value below market value', () => {
    const ns = resolvePropertyJurisdiction('CA', 'NS')!;
    expect(ns.taxableValueTerm).toMatch(/capped/i);
    expect(ns.reliefPrograms.some((p) => p.id === 'ns-cap')).toBe(true);
  });

  it('marks Alberta and Quebec as assessed municipality by municipality', () => {
    expect(resolvePropertyJurisdiction('CA', 'AB')!.centralized).toBe(false);
    expect(resolvePropertyJurisdiction('CA', 'QC')!.centralized).toBe(false);
    expect(resolvePropertyJurisdiction('CA', 'BC')!.centralized).toBe(true);
  });
});

describe('region gating', () => {
  it('opens the property surface to every province, not just Vancouver', () => {
    for (const region of ALL_CA) {
      expect(isPropertyAssessmentSupported(household({ state_province: region }))).toBe(true);
    }
  });

  it('is no longer coupled to the Greater Vancouver check', () => {
    const toronto = household({ state_province: 'ON', city: 'Toronto' });
    expect(isHouseholdInGreaterVancouver(toronto)).toBe(false);
    expect(isPropertyAssessmentSupported(toronto)).toBe(true);
  });

  it('stays closed where we have no rules', () => {
    expect(isPropertyAssessmentSupported(null)).toBe(false);
    expect(isPropertyAssessmentSupported(household({ state_province: null }))).toBe(false);
    // Washington stays closed because *Washington* is unseeded, not because the
    // household is American. That distinction is new: until the US registry
    // landed this assertion held for every US state, and now it holds only for
    // the ones we have not modelled. See the United States block below.
    expect(isPropertyAssessmentSupported(household({ country: 'US', state_province: 'WA' }))).toBe(
      false
    );
  });

  it('explains what is missing instead of blaming the region', () => {
    expect(getPropertyAssessmentGateMessage(household({ country: null }))).toMatch(/address/i);
    expect(getPropertyAssessmentGateMessage(household({ state_province: null }))).toMatch(
      /province or state/i
    );
    expect(
      getPropertyAssessmentGateMessage(household({ country: 'US', state_province: 'WA' }))
    ).toContain('WA');
  });
});

describe('region gating — the United States', () => {
  const usHousehold = (over: Partial<Household> = {}): Household =>
    household({ country: 'US', state_province: 'TX', city: 'Houston', ...over });

  it('opens the property surface to every seeded US state', () => {
    // The US model was complete and tested for months while the gate still
    // consulted only the Canadian registry, so a Houston household was told the
    // feature did not exist for it. A fully modelled state that nobody can
    // reach is the same as an unmodelled one.
    const seeded = allUsStateJurisdictions();
    expect(seeded.length).toBeGreaterThan(0);
    for (const state of seeded) {
      expect(isPropertyAssessmentSupported(usHousehold({ state_province: state.regionCode }))).toBe(
        true
      );
    }
  });

  it('names the state, not the country, when the state is unseeded', () => {
    // "Not available in the United States" would be false — fifteen states are
    // modelled — and it tells a homeowner in an unseeded state to stop asking.
    expect(isPropertyAssessmentSupported(usHousehold({ state_province: 'WA' }))).toBe(false);

    const message = getPropertyAssessmentGateMessage(usHousehold({ state_province: 'WA' }));
    expect(message).toContain('WA');
    expect(message).toContain(String(allUsStateJurisdictions().length));
    expect(message).not.toMatch(/United States|the US\b|your country/i);
  });

  it('will not open a US state through the Canadian gate, or the reverse', () => {
    // A country/region pair that matches neither registry must stay closed even
    // when both halves are individually valid somewhere.
    expect(isPropertyAssessmentSupported(household({ country: 'US', state_province: 'BC' }))).toBe(
      false
    );
    expect(isPropertyAssessmentSupported(household({ country: 'CA', state_province: 'TX' }))).toBe(
      false
    );
    // …but 'CA'/'CA' is the trap: British Columbia's country code and
    // California's state code are the same two letters.
    expect(isPropertyAssessmentSupported(household({ country: 'CA', state_province: 'CA' }))).toBe(
      false
    );
    expect(isPropertyAssessmentSupported(usHousehold({ state_province: 'CA' }))).toBe(true);
  });

  it('leaves Canadian households exactly as they were', () => {
    // Regression: opening the US gate must not have changed a single Canadian
    // answer, including the Vancouver utilities gate it sits next to.
    for (const region of ALL_CA) {
      expect(isPropertyAssessmentSupported(household({ state_province: region }))).toBe(true);
    }
    expect(isPropertyAssessmentSupported(household({ state_province: 'ZZ' }))).toBe(false);
    expect(isHouseholdInGreaterVancouver(household())).toBe(true);
    expect(isHouseholdInGreaterVancouver(usHousehold())).toBe(false);
    expect(
      getPropertyAssessmentGateMessage(household({ state_province: 'ZZ' }))
    ).not.toMatch(/US states/i);
  });
});
