/**
 * The unified jurisdiction layer — the one place a screen asks "how does
 * property assessment work here?" without caring which country "here" is.
 *
 * The Canadian registry answers with one authority, one value and one ratio.
 * The US registry cannot: an assessment ratio there belongs to a *class of
 * taxing district* rather than to a property, a rate may be quoted per $1,000,
 * per $100 or as a percent, and value is a stack — market, capped, taxable —
 * whose rungs diverge permanently under an acquisition-value cap. Every
 * assertion below pins a place where flattening the US into the Canadian shape
 * would produce a number that looks entirely plausible and is wrong:
 * a Colorado taxable value computed without naming a district class, a Texan
 * sent to the county assessor's office that has no power over their value, a
 * Texas protest deadline reported as already passed because the notice arrived
 * in June.
 *
 * The two assertions that matter most are the ones that produce *nothing*:
 * `taxableValueNote` refusing Colorado, and `usCountyLookup` refusing a county
 * from the wrong state. Silence is the correct output there, and a helpful
 * default is the bug.
 */

import React from 'react';
import { act, create } from 'react-test-renderer';

import type { Household } from '@api/households';
import {
  jurisdictionForHousehold,
  resolvedJurisdictionForHousehold,
  usePropertyJurisdiction,
  useResolvedJurisdiction,
  assessedValueLabel,
  assessmentAuthorityLabel,
  valueStackLabels,
  taxableValueNote,
  appealDeadlineDisplay,
  usCountyLookup,
  usCountyLookupOptions,
  usBillDeliveryNote,
  type ResolvedJurisdiction,
} from '@hooks/usePropertyJurisdiction';
import { resolveUsJurisdiction, resolvePropertyJurisdiction, US_BILL_DELIVERY } from '@symply/contracts';

const household = (over: Partial<Household> = {}): Household =>
  ({
    id: 'hh-1',
    name: 'Test property',
    country: 'CA',
    state_province: 'BC',
    city: 'Vancouver',
    ...over,
  }) as Household;

const us = (stateCode: string): Household =>
  household({ country: 'US', state_province: stateCode, city: 'Somewhere' });

/** The tagged jurisdiction for a US state, for helpers that take the union. */
const usJurisdiction = (stateCode: string): ResolvedJurisdiction =>
  resolvedJurisdictionForHousehold(us(stateCode));

/** Render a hook in isolation, the way the rest of `src/hooks/__tests__` does. */
function readHook<T>(useIt: () => T): T {
  let captured!: T;
  function Probe() {
    captured = useIt();
    return null;
  }
  act(() => {
    create(React.createElement(Probe));
  });
  return captured;
}

// $500,000, in cents.
const HALF_MILLION = 500_000_00;

describe('resolution across two registries', () => {
  it('tags the country so a caller never has to cast', () => {
    // The whole point of the union: reading `.ca` off a US result — or
    // `authorityName` off a `UsStateJurisdiction` — has to be a compile error,
    // not `undefined` rendered into a heading.
    const ca = resolvedJurisdictionForHousehold(household({ state_province: 'ON' }));
    expect(ca?.country).toBe('CA');
    expect(ca?.country === 'CA' && ca.ca.authorityName).toBe('Municipal Property Assessment Corporation (MPAC)');

    const tx = resolvedJurisdictionForHousehold(us('TX'));
    expect(tx?.country).toBe('US');
    expect(tx?.country === 'US' && tx.us.regionName).toBe('Texas');
  });

  it('returns null for a household we have no rules for, in either country', () => {
    expect(resolvedJurisdictionForHousehold(null)).toBeNull();
    expect(resolvedJurisdictionForHousehold(household({ state_province: null }))).toBeNull();
    // Washington is a real state; it is simply not seeded. Null, not a guess.
    expect(resolvedJurisdictionForHousehold(us('WA'))).toBeNull();
  });

  it('keeps the existing hook Canadian-only so its callers are untouched', () => {
    // `PropertyAssessmentTab`, `PropertyTaxTab` and `PropertyTaxScreen` read
    // `documentTypes`, `authorityName` and `assessedValueTerm` straight off this
    // return value. Widening it to the union would break all three at once, so
    // a US household must still resolve to null here and be seen only through
    // `useResolvedJurisdiction`.
    expect(jurisdictionForHousehold(us('TX'))).toBeNull();
    expect(jurisdictionForHousehold(household())?.authorityName).toBe('BC Assessment');

    const bc = readHook(() => usePropertyJurisdiction(household()));
    expect(bc?.regionCode).toBe('BC');
    expect(bc?.documentTypes[0]).toBe('Property Assessment Notice');

    expect(readHook(() => usePropertyJurisdiction(us('TX')))).toBeNull();
    expect(readHook(() => useResolvedJurisdiction(us('TX')))?.country).toBe('US');
  });
});

describe('assessment authority labels', () => {
  it('sends a Texan to the appraisal district, not the county assessor', () => {
    // In Texas the appraisal district is an independent political subdivision
    // that sets the value and hears the protest; the county tax assessor-
    // collector only bills and cannot change a value. A protest filed with the
    // wrong office is not filed, and the deadline runs out anyway.
    const label = assessmentAuthorityLabel(usJurisdiction('TX'));
    expect(label).toMatch(/appraisal district/i);
    expect(label).not.toMatch(/county assessor/i);
  });

  it('names Maryland SDAT, because Maryland has no county assessor at all', () => {
    // SDAT assesses all ~2 million Maryland accounts through 24 local offices.
    // "Contact your county assessor" names an office that does not exist.
    const md = resolveUsJurisdiction('US', 'MD')!;
    expect(md.assessingJurisdictionType).toBe('state');
    expect(assessmentAuthorityLabel(usJurisdiction('MD'))).toBe(md.stateAgencyName);
    expect(assessmentAuthorityLabel(usJurisdiction('MD'))).toMatch(/SDAT/);
  });

  it('keeps a plain county-assessor state on its own local office name', () => {
    // North Carolina really is the county assessor — and Ohio really is the
    // County Auditor. Collapsing both to a generic "county assessor" would be
    // wrong in Ohio, which is why the registry's own wording is used verbatim.
    expect(assessmentAuthorityLabel(usJurisdiction('NC'))).toMatch(/county assessor/i);
    expect(assessmentAuthorityLabel(usJurisdiction('OH'))).toMatch(/county auditor/i);
  });

  it('still answers with the Canadian authority, and still falls back', () => {
    // Regression: the existing callers pass a bare `PropertyJurisdiction`.
    expect(assessmentAuthorityLabel(resolvePropertyJurisdiction('CA', 'BC'))).toBe('BC Assessment');
    expect(assessmentAuthorityLabel(null)).toBe('Property assessment');
  });
});

describe('value labels', () => {
  it('labels a US value with the state\'s own capped term, not "assessed value"', () => {
    // The number a US homeowner types off their notice is the capped rung, and
    // each state names it differently. "Assessed value" over a California
    // factored base year value invites the owner to "correct" a figure that is
    // deliberately far below market — and correct.
    expect(assessedValueLabel(usJurisdiction('CA'))).toBe('Factored base year value');
    expect(assessedValueLabel(usJurisdiction('TX'))).toMatch(/10% homestead limitation/);
  });

  it('names all three rungs of the US value stack plus the gap between them', () => {
    // The gap is a legally named quantity the owner loses on sale — quoting the
    // seller's tax bill to a buyer is actively misleading in CA, FL, TX and MI.
    const stack = valueStackLabels(usJurisdiction('TX'));
    expect(stack.market).toBe('Market value');
    expect(stack.capped).toMatch(/Appraised value/);
    expect(stack.taxable).toBe('Taxable value');
    expect(stack.capGap).toBe('Homestead cap loss');

    // Colorado has no acquisition-value cap, so null means "none exists" here.
    expect(valueStackLabels(usJurisdiction('CO')).capGap).toBeNull();
  });

  it('leaves the Canadian labels exactly as they were', () => {
    expect(assessedValueLabel(resolvePropertyJurisdiction('CA', 'ON'))).toContain(
      'Current Value Assessment'
    );
    expect(assessedValueLabel(null)).toBe('Assessed value');
    expect(valueStackLabels(resolvePropertyJurisdiction('CA', 'MB')).taxable).toBe(
      'Portioned assessment'
    );
  });
});

describe('taxable value notes', () => {
  it('refuses to invent a Colorado taxable value without a district class', () => {
    // Colorado assesses the same home at 7.05% for school levies and 6.80% for
    // local-government levies, in the same year, on the same bill. Any single
    // number is wrong about half the bill — so the honest output is an
    // explanation with no dollar figure in it at all.
    const note = taxableValueNote(usJurisdiction('CO'), HALF_MILLION);
    expect(note).not.toBeNull();
    expect(note).not.toContain('$');
    expect(note).toMatch(/district/i);
    expect(note).toContain('7.05%');
    expect(note).toContain('6.8%');
  });

  it('answers Colorado once a district class is named', () => {
    // The question becomes well-formed, so a number is now correct — and the
    // two classes must not agree, or the refusal above was pointless.
    const school = taxableValueNote(usJurisdiction('CO'), HALF_MILLION, 'school');
    const local = taxableValueNote(usJurisdiction('CO'), HALF_MILLION, 'county');

    expect(school).toContain('$35,250'); // 7.05% of $500,000
    expect(school).toMatch(/school/i);
    // 6.80% of $500,000 less the 10% reduction on the first $700,000 of value.
    expect(local).toContain('$30,600');
    expect(local).not.toEqual(school);
  });

  it('produces a figure for a state with one statewide ratio', () => {
    // Ohio taxes 35% of appraised value everywhere, so there is no ambiguity to
    // refuse — declining here would be as unhelpful as guessing in Colorado.
    const note = taxableValueNote(usJurisdiction('OH'), 300_000_00);
    expect(note).toContain('$105,000'); // 35% of $300,000
    expect(note).toContain('35%');
  });

  it('refuses every other state with no single ratio, and says why', () => {
    // Illinois splits by county (Cook 10% vs 33⅓% elsewhere); New York lets each
    // of ~1,000 assessing units pick its own level; Pennsylvania runs county
    // base years through a Common Level Ratio; New Jersey assesses municipally.
    for (const state of ['IL', 'NY', 'PA', 'NJ']) {
      const note = taxableValueNote(usJurisdiction(state), HALF_MILLION);
      expect(note).not.toBeNull();
      expect(note).not.toContain('$');
    }
    expect(taxableValueNote(usJurisdiction('IL'), HALF_MILLION)).toMatch(/Cook/);
  });

  it('says nothing where a US state taxes the full value', () => {
    // Texas, Maryland and North Carolina all assess at 100%. A note there would
    // restate the value the user is already looking at.
    for (const state of ['TX', 'MD', 'NC']) {
      expect(taxableValueNote(usJurisdiction(state), HALF_MILLION)).toBeNull();
    }
  });

  it('leaves the Canadian notes byte-for-byte unchanged', () => {
    // Regression against the existing property tabs, which render this string.
    expect(taxableValueNote(resolvePropertyJurisdiction('CA', 'SK'), HALF_MILLION)).toBe(
      'Taxable assessment: $400,000 (80% of assessed value)'
    );
    expect(taxableValueNote(resolvePropertyJurisdiction('CA', 'MB'), HALF_MILLION)).toBe(
      'Portioned assessment: $225,000 (45% of assessed value)'
    );
    expect(taxableValueNote(resolvePropertyJurisdiction('CA', 'BC'), HALF_MILLION)).toBeNull();
    expect(taxableValueNote(resolvePropertyJurisdiction('CA', 'SK'), null)).toBeNull();
    expect(taxableValueNote(null, HALF_MILLION)).toBeNull();
  });
});

describe('appeal deadlines across both countries', () => {
  it('gives Texas the later of May 15 and notice + 30 days', () => {
    // The `fixed-or-days-from-notice` shape exists for exactly this. Read as a
    // plain fixed date, a June notice would be reported as already out of time;
    // read as plain days-from-notice, an April notice would lose two weeks the
    // owner actually has.
    const tx = usJurisdiction('TX');
    expect(tx?.country === 'US' && tx.us.appealDeadline.kind).toBe('fixed-or-days-from-notice');

    // Early notice: the statutory date is later, so it wins.
    expect(appealDeadlineDisplay(tx, 2026, '2026-04-01').date).toBe('2026-05-15');
    // Late notice: notice + 30 is later, so the window extends past May 15.
    expect(appealDeadlineDisplay(tx, 2026, '2026-06-10').date).toBe('2026-07-10');
    // No notice on file: May 15 is the earliest the deadline can ever be, and
    // is the honest answer rather than null.
    expect(appealDeadlineDisplay(tx, 2026).date).toBe('2026-05-15');
    expect(appealDeadlineDisplay(tx, 2026).note).toMatch(/whichever is later/i);
  });

  it('returns the note, not a date, where only the US notice can say', () => {
    // Colorado and North Carolina publish a closing date per county each spring.
    for (const state of ['CO', 'NC']) {
      const { date, note } = appealDeadlineDisplay(usJurisdiction(state), 2026, '2026-05-01');
      expect(date).toBeNull();
      expect(note).toBeTruthy();
    }
  });

  it('leaves the Canadian deadlines unchanged', () => {
    expect(appealDeadlineDisplay(resolvePropertyJurisdiction('CA', 'BC'), 2026).date).toBe(
      '2026-01-31'
    );
    expect(
      appealDeadlineDisplay(resolvePropertyJurisdiction('CA', 'AB'), 2026, '2026-01-14').date
    ).toBe('2026-03-15');
    expect(appealDeadlineDisplay(null, 2026)).toEqual({ date: null, note: null });
  });
});

describe('county lookups and bill delivery', () => {
  it('resolves a seeded county for the state it is actually in', () => {
    expect(usCountyLookup(usJurisdiction('TX'), '48201')?.countyName).toBe('Harris');
    // A FIPS code that survived a JSON round-trip as a number still resolves.
    expect(usCountyLookup(usJurisdiction('TX'), 48201)?.assessorAgency).toMatch(/HCAD/);
  });

  it('refuses a county from the wrong state rather than returning a near-miss', () => {
    // A FIPS code drifted out of sync with the address is the realistic failure,
    // and it would otherwise send a Texan to a Florida property appraiser.
    expect(usCountyLookup(usJurisdiction('TX'), '12086')).toBeNull();
    expect(usCountyLookup(usJurisdiction('TX'), null)).toBeNull();
    expect(usCountyLookup(usJurisdiction('TX'), '99999')).toBeNull();
    // Canada has no county lookups at all.
    expect(usCountyLookup(resolvePropertyJurisdiction('CA', 'BC'), '48201')).toBeNull();
  });

  it('offers only hand-verified counties, and offers none where we have none', () => {
    // There is no national lookup and no URL naming pattern, so an empty list
    // means "we have no verified lookup" — never "synthesise one from the
    // county name". A guessed link 404s and can cost a statutory deadline.
    expect(usCountyLookupOptions(usJurisdiction('TX')).map((c) => c.countyName)).toEqual([
      'Dallas',
      'Harris',
    ]);
    expect(usCountyLookupOptions(usJurisdiction('MT'))).toEqual([]);
    expect(usCountyLookupOptions(resolvePropertyJurisdiction('CA', 'BC'))).toEqual([]);
  });

  it('explains that an escrowed US bill never reaches the homeowner', () => {
    // Most mortgaged US homes escrow, so the county mails the bill to the loan
    // servicer. "You have not uploaded your tax bill" must not read as a problem
    // — and "no bill on file" must never read as "unpaid".
    expect(usBillDeliveryNote(usJurisdiction('TX'))).toBe(US_BILL_DELIVERY.note);
    expect(usBillDeliveryNote(usJurisdiction('TX'))).toMatch(/servicer/i);
    // Canadian municipalities bill the owner directly, so there is nothing to say.
    expect(usBillDeliveryNote(resolvePropertyJurisdiction('CA', 'BC'))).toBeNull();
    expect(usBillDeliveryNote(null)).toBeNull();
  });
});
