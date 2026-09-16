/**
 * US property jurisdiction registry — the rules that decide how an assessed
 * value is read and taxed in each state.
 *
 * The Canadian registry exists because the feature shipped assuming British
 * Columbia everywhere. This one exists because the *shape* of the Canadian
 * registry is itself a Canadian assumption: one authority, one value, one
 * ratio, one rate. Every assertion below pins a US fact that breaks one of
 * those four assumptions, because each of them is a bug that would look
 * completely plausible on screen — a Texas bill computed as mills is one tenth
 * of the real one and still looks like a tax bill; a Florida homestead applied
 * to school levies overstates the saving on the largest line of the bill; a
 * Maricopa lookup keyed on a number silently misses every Arizona county.
 *
 * Note `packages/**` is outside the root jest roots, so the registry is
 * exercised here, through the same `@symply/contracts` import the app uses.
 */

import {
  US_STATE_JURISDICTIONS,
  US_COUNTY_LOOKUPS,
  US_BILL_DELIVERY,
  usJurisdictionKey,
  resolveUsJurisdiction,
  allUsStateJurisdictions,
  usJurisdictionsForState,
  normalizeUsFips,
  resolveUsCountyLookup,
  usAssessmentRatioPercent,
  usTaxableValueCents,
  resolveAppealDeadline,
  resolvePropertyJurisdiction,
  type UsStateJurisdiction,
} from '@symply/contracts';

/** The fourteen seeded states, plus Colorado as the split-ratio special case. */
const SEEDED_STATES = [
  'CA',
  'TX',
  'FL',
  'NY',
  'IL',
  'PA',
  'OH',
  'GA',
  'NC',
  'MI',
  'NJ',
  'VA',
  'MD',
  'MT',
  'CO',
];

const state = (code: string): UsStateJurisdiction => {
  const found = resolveUsJurisdiction('US', code);
  if (!found) throw new Error(`Expected a seeded jurisdiction for US-${code}`);
  return found;
};

/** Every string anywhere in the object graph, so link checks cannot be dodged. */
const allStrings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => allStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => allStrings(v, out));
  return out;
};

describe('registry coverage', () => {
  it('resolves every seeded state', () => {
    expect(allUsStateJurisdictions()).toHaveLength(SEEDED_STATES.length);
    for (const code of SEEDED_STATES) {
      expect(resolveUsJurisdiction('US', code)).not.toBeNull();
    }
  });

  it('returns null rather than guessing for states we have not modelled', () => {
    // Washington and Arizona are real states with real rules we have not
    // encoded. Showing them California's would be worse than showing nothing.
    expect(resolveUsJurisdiction('US', 'WA')).toBeNull();
    expect(resolveUsJurisdiction('US', 'AZ')).toBeNull();
    expect(resolveUsJurisdiction('US', 'ZZ')).toBeNull();
    expect(resolveUsJurisdiction('US', null)).toBeNull();
    expect(resolveUsJurisdiction(null, 'CA')).toBeNull();
  });

  it('never resolves a Canadian household against the US registry', () => {
    // `CA` is both California and Canada. A lookup keyed on the region code
    // alone would hand a British Columbia household Proposition 13, and a
    // Vancouver household a 1% rate cap that does not exist there.
    expect(resolveUsJurisdiction('CA', 'BC')).toBeNull();
    expect(resolveUsJurisdiction('CA', 'ON')).toBeNull();
    // …and the reverse: the Canadian registry must not answer for a US state.
    expect(resolvePropertyJurisdiction('US', 'CA')).toBeNull();
    expect(resolvePropertyJurisdiction('US', 'TX')).toBeNull();
  });

  it('is case and whitespace insensitive, like the Canadian lookup', () => {
    expect(resolveUsJurisdiction('us', 'tx')?.regionCode).toBe('TX');
    expect(resolveUsJurisdiction(' US ', ' ca ')?.regionCode).toBe('CA');
  });

  it('builds keys predictably', () => {
    expect(usJurisdictionKey('US', 'FL')).toBe('US-FL');
    expect(usJurisdictionKey('US', null)).toBeNull();
    expect(usJurisdictionKey(null, 'FL')).toBeNull();
  });

  it('gives every state a source page and real document types', () => {
    for (const j of Object.values(US_STATE_JURISDICTIONS)) {
      expect(j.sourceUrl).toMatch(/^https:\/\//);
      expect(j.stateAgencyUrl).toMatch(/^https:\/\//);
      expect(j.stateAgencyName.length).toBeGreaterThan(0);
      expect(j.assessingBodyLabel.length).toBeGreaterThan(0);
      expect(j.documentTypes.length).toBeGreaterThan(0);
      expect(j.notes).toBeTruthy();
      expect(j.ratioNote).toBeTruthy();
    }
  });

  it('links only over https, everywhere in the registry', () => {
    // A tax authority link is a link someone follows to meet a deadline. An
    // http:// link on a captive hotel wifi is an interception opportunity, and
    // several of these hosts (Cook, LA) already have TLS quirks worth pinning.
    const strings = allStrings(Object.values(US_STATE_JURISDICTIONS)).concat(
      allStrings(Object.values(US_COUNTY_LOOKUPS)),
    );
    const links = strings.filter(s => s.toLowerCase().startsWith('http'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toMatch(/^https:\/\//);
    }
  });
});

describe('rate basis — the ten-times error', () => {
  it('quotes Texas per $100 and California as a percent', () => {
    // These two are asserted by name because confusing either with `per_1000`
    // is a 10x error in the bill that still produces a plausible-looking
    // number. A Texas rate of 1.25 is $1.25 per $100 (1.25%); read as mills it
    // becomes 0.125% and a $6,000 bill turns into $600 with nothing to flag it.
    expect(state('TX').rateBasis).toBe('per_100');
    expect(state('CA').rateBasis).toBe('percent');
    expect(state('TX').rateBasis).not.toBe('per_1000');
    expect(state('CA').rateBasis).not.toBe('per_1000');
  });

  it('keeps the millage states on per_1000', () => {
    for (const code of ['FL', 'GA', 'OH', 'PA', 'MI', 'NY', 'MT', 'CO']) {
      expect(state(code).rateBasis).toBe('per_1000');
    }
  });

  it('explains the basis in words wherever a bill could be misread', () => {
    for (const j of Object.values(US_STATE_JURISDICTIONS)) {
      expect(j.rateBasisNote).toBeTruthy();
    }
  });
});

describe('one rate becomes N rates', () => {
  it('assesses Colorado at two different ratios in the same year', () => {
    // The clearest proof that an assessment ratio belongs to a taxing district
    // class rather than to a property: the same house, on the same bill, is
    // 7.05% for school levies and 6.80% for local government. A schema with one
    // ratio per property is wrong about part of every Colorado bill.
    const co = state('CO');
    expect(co.assessmentRatioPercent).toBeNull();
    expect(usAssessmentRatioPercent(co, 'school')).toBe(7.05);
    expect(usAssessmentRatioPercent(co, 'county')).toBe(6.8);
    expect(usAssessmentRatioPercent(co, 'municipal')).toBe(6.8);
  });

  it('produces a different taxable value per district class in Colorado', () => {
    const co = state('CO');
    const million = 1_000_000_00; // $1,000,000 in cents.

    // School: 7.05% of actual value, no reduction encoded.
    expect(usTaxableValueCents(million, co, 'school')).toBe(70_500_00);
    // Local government: 10% off the first $700,000, then 6.80%.
    // (1,000,000 - 70,000) x 6.80% = 63,240.
    expect(usTaxableValueCents(million, co, 'county')).toBe(63_240_00);
  });

  it('caps Colorado\'s value reduction in dollars, not proportionally', () => {
    // The reduction is 10% of the *first* $700,000, so it is not expressible as
    // a smaller flat rate — on a cheaper home the whole value is reducible.
    const co = state('CO');
    // ($500,000 - $50,000) x 6.80% = $30,600.
    expect(usTaxableValueCents(500_000_00, co, 'county')).toBe(30_600_00);
  });

  it('refuses to compute a Colorado taxable value without a district class', () => {
    // Asking "what is the Colorado ratio?" is an ill-formed question. Returning
    // null forces the caller to show `ratioNote` rather than pick a side.
    const co = state('CO');
    expect(usAssessmentRatioPercent(co)).toBeNull();
    expect(usTaxableValueCents(1_000_000_00, co)).toBeNull();
  });

  it('splits Illinois geographically instead of by district', () => {
    // Illinois is the other axis: Cook County assesses residential at 10% and
    // the other 101 counties at 33 1/3%. A single statewide number is wrong by
    // more than 3x for whichever side of the county line the household is on.
    const il = state('IL');
    expect(il.assessmentRatioPercent).toBeNull();
    expect(il.subStateRatios).toHaveLength(2);

    const cook = il.subStateRatios.find(r => r.scope.includes('Cook'));
    expect(cook?.ratioPercent).toBe(10);
    expect(cook?.ratioLabel).toBe('10%');

    const rest = il.subStateRatios.find(r => !r.scope.includes('Cook'));
    expect(rest?.ratioPercent).toBeCloseTo(33.3333, 3);
    expect(rest?.ratioLabel).toBe('33⅓%');
  });

  it('still applies a single ratio where the state really has one', () => {
    expect(usAssessmentRatioPercent(state('GA'))).toBe(40);
    expect(usAssessmentRatioPercent(state('TX'))).toBe(100);
    // $500,000 in Georgia is taxed on 40% of it.
    expect(usTaxableValueCents(500_000_00, state('GA'))).toBe(200_000_00);
  });

  it('lists the overlapping districts a bill is actually made of', () => {
    // "What is my tax rate?" has no single answer in the US, and Texas MUDs are
    // the reminder — a subdivision's water district levy is on the bill and is
    // invisible to anyone who models one county rate.
    for (const j of Object.values(US_STATE_JURISDICTIONS)) {
      expect(j.typicalDistrictClasses.length).toBeGreaterThan(1);
    }
    expect(state('TX').typicalDistrictClasses).toContain('mud');
    expect(state('CA').typicalDistrictClasses).toContain('community_college');
  });
});

describe('exemptions that do not apply to the whole bill', () => {
  it('applies only the first Florida homestead band to school levies', () => {
    // s.196.031: the first $25,000 comes off every levy; the second band comes
    // off non-school levies only. School millage is usually the largest single
    // line on a Florida bill, so treating the second band as universal
    // overstates the saving by roughly the school share of the bill.
    const fl = state('FL');
    const first = fl.homesteadExemptions.find(e => e.id === 'fl-homestead-first-25k');
    const additional = fl.homesteadExemptions.find(e => e.id === 'fl-homestead-additional-25k');

    expect(first?.appliesToSchoolLevies).toBe(true);
    expect(first?.appliesToNonSchoolLevies).toBe(true);

    expect(additional?.appliesToSchoolLevies).toBe(false);
    expect(additional?.appliesToNonSchoolLevies).toBe(true);

    expect(first?.amountUsd).toBe(25000);
    expect(additional?.amountUsd).toBe(25000);
    expect(first?.applicationDeadline).toBe('March 1');
  });

  it('mirrors that for Texas — the big homestead exemption is school-only', () => {
    const tx = state('TX');
    const school = tx.homesteadExemptions.find(e => e.id === 'tx-homestead-school');
    expect(school?.amountUsd).toBe(140_000);
    expect(school?.appliesToSchoolLevies).toBe(true);
    expect(school?.appliesToNonSchoolLevies).toBe(false);

    const over65 = tx.homesteadExemptions.find(e => e.id === 'tx-homestead-school-over-65');
    expect(over65?.amountUsd).toBe(60_000);

    // The county farm-to-market exemption is the inverse — non-school only.
    const fm = tx.homesteadExemptions.find(e => e.id === 'tx-homestead-fm-road');
    expect(fm?.amountUsd).toBe(3_000);
    expect(fm?.appliesToSchoolLevies).toBe(false);

    // The local option is proportional rather than a flat amount.
    const local = tx.homesteadExemptions.find(e => e.id === 'tx-homestead-local-option');
    expect(local?.percentOfValue).toBe(20);
    expect(local?.amountUsd).toBeNull();
  });

  it('pays New York STAR as a cheque that never reaches the bill', () => {
    // The STAR credit is a payment to the homeowner, not a reduction of the
    // tax due. A UI that reads benefits off the bill will report a New Yorker
    // as receiving nothing, and "you may be missing STAR" would be wrong.
    const ny = state('NY');
    const credit = ny.homesteadExemptions.find(e => e.id === 'ny-star-credit');
    expect(credit?.deliveryMethod).toBe('separate_payment');
    // …and STAR is School TAx Relief: it touches school levies and nothing else.
    expect(credit?.appliesToSchoolLevies).toBe(true);
    expect(credit?.appliesToNonSchoolLevies).toBe(false);

    // The legacy exemption is the same benefit through a different mechanism,
    // which is why two neighbours can both "have STAR" and see different bills.
    const legacy = ny.homesteadExemptions.find(e => e.id === 'ny-star-exemption');
    expect(legacy?.deliveryMethod).toBe('reduces_taxable_value');

    // Enhanced STAR's income limit moves every year — pinned so a stale figure
    // is a failing test rather than wrong advice to a 65-year-old.
    const enhanced = ny.homesteadExemptions.find(e => e.id === 'ny-enhanced-star');
    expect(enhanced?.summary).toContain('$110,750');
    expect(enhanced?.summary).toContain('$113,550');
  });

  it('records Michigan\'s PRE as removing a levy, not reducing a value', () => {
    const pre = state('MI').homesteadExemptions.find(
      e => e.id === 'mi-principal-residence-exemption',
    );
    expect(pre?.deliveryMethod).toBe('reduces_tax_due');
    expect(pre?.appliesToSchoolLevies).toBe(true);
  });

  it('gives every exemption a link and a stated delivery method', () => {
    for (const j of Object.values(US_STATE_JURISDICTIONS)) {
      for (const e of j.homesteadExemptions) {
        expect(e.url).toMatch(/^https:\/\//);
        expect(['reduces_taxable_value', 'reduces_tax_due', 'separate_payment']).toContain(
          e.deliveryMethod,
        );
        // A flat amount or a percentage, never both and never neither without
        // saying so in prose — an exemption with two nulls must still explain
        // itself, because the figure is set locally.
        expect(e.summary.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('value is a stack, not a number', () => {
  it('flags every cap that resets when the property sells', () => {
    // This is the field that decides whether the seller's tax bill tells a
    // buyer anything. In these three states it tells them almost nothing.
    for (const [code, capId] of [
      ['CA', 'ca-prop-13'],
      ['FL', 'fl-save-our-homes'],
      ['MI', 'mi-proposal-a'],
    ] as const) {
      const cap = state(code).caps.find(c => c.id === capId);
      expect(cap).toBeDefined();
      expect(cap!.resetsOnSale).toBe(true);
    }
  });

  it('records the annual limit each cap actually imposes', () => {
    expect(state('CA').caps.find(c => c.id === 'ca-prop-13')?.annualLimitPercent).toBe(2);
    expect(state('FL').caps.find(c => c.id === 'fl-save-our-homes')?.annualLimitPercent).toBe(3);
    expect(state('MI').caps.find(c => c.id === 'mi-proposal-a')?.annualLimitPercent).toBe(5);
    expect(state('TX').caps.find(c => c.id === 'tx-homestead-10')?.annualLimitPercent).toBe(10);
  });

  it('knows which caps are really "the lesser of the percent and inflation"', () => {
    // Prop 13, Save Our Homes and Proposal A are all inflation-bounded, so the
    // headline percentage is a ceiling that rarely binds. The Texas 10% cap is
    // a flat statutory limit and is not.
    expect(state('CA').caps[0].tiedToInflation).toBe(true);
    expect(state('FL').caps[0].tiedToInflation).toBe(true);
    expect(state('MI').caps[0].tiedToInflation).toBe(true);
    expect(state('TX').caps.find(c => c.id === 'tx-homestead-10')?.tiedToInflation).toBe(false);
  });

  it('marks the portable caps, because the gap is lost by not filing', () => {
    // California (Prop 19) and Florida (DR-501T) let the accumulated benefit
    // move to a new home. Michigan does not — a Michigan owner who moves starts
    // again at full SEV.
    expect(state('CA').caps[0].portable).toBe(true);
    expect(state('FL').caps[0].portable).toBe(true);
    expect(state('MI').caps[0].portable).toBe(false);
  });

  it('carries the sunset on the Texas circuit breaker', () => {
    // A cap with an expiry is a cap that cannot be projected forward. This one
    // lapses at the end of 2026 and those values snap back to market.
    const cb = state('TX').caps.find(c => c.id === 'tx-circuit-breaker-20');
    expect(cb?.expiresIso).toBe('2026-12-31');
    expect(cb?.annualLimitPercent).toBe(20);
    // Everything else is open-ended, and must not be assumed to expire.
    expect(state('CA').caps[0].expiresIso).toBeNull();
    expect(state('FL').caps[0].expiresIso).toBeNull();
  });

  it('names all three rungs of the value stack for every state', () => {
    // Market, capped, taxable. A single `assessedValue` field cannot hold a
    // California home assessed at a third of what it would sell for.
    for (const j of Object.values(US_STATE_JURISDICTIONS)) {
      expect(j.marketValueTerm.length).toBeGreaterThan(0);
      expect(j.cappedValueTerm.length).toBeGreaterThan(0);
      expect(j.taxableValueTerm.length).toBeGreaterThan(0);
    }
  });

  it('names the gap wherever a cap creates one the owner can lose', () => {
    expect(state('FL').capGapTerm).toMatch(/Save Our Homes/i);
    expect(state('TX').capGapTerm).toMatch(/cap loss/i);
    expect(state('CA').capGapTerm).toMatch(/Proposition 13/i);
    expect(state('MI').capGapTerm).toBeTruthy();
    // States with no cap have no gap, and must not invent a term for one.
    expect(state('GA').capGapTerm).toBeNull();
  });
});

describe('appeal deadlines', () => {
  it('gives a Texan the later of May 15 and thirty days from the notice', () => {
    // Texas Tax Code: a protest is due May 15 *or* 30 days after the notice was
    // delivered, whichever is later. Modelled as a plain fixed date it tells an
    // owner whose notice arrived in June that they are already out of time;
    // modelled as plain days-from-notice it costs an April notice two weeks.
    const tx = state('TX');
    expect(tx.appealDeadline.kind).toBe('fixed-or-days-from-notice');

    // Early notice: 30 days lands before May 15, so the statutory date wins.
    expect(resolveAppealDeadline(tx, 2026, '2026-04-01')).toBe('2026-05-15');
    // Late notice: 30 days runs past May 15, so the notice date wins.
    expect(resolveAppealDeadline(tx, 2026, '2026-06-10')).toBe('2026-07-10');
    // Exactly on the boundary: identical dates, so either branch is correct.
    expect(resolveAppealDeadline(tx, 2026, '2026-04-15')).toBe('2026-05-15');
  });

  it('still answers for Texas when no notice date is known', () => {
    // Unlike a pure days-from-notice rule, we always know at least the
    // statutory floor — and it is the earliest the deadline can ever be, so it
    // is safe to show. Returning null here would hide a real deadline.
    const tx = state('TX');
    expect(resolveAppealDeadline(tx, 2026)).toBe('2026-05-15');
    expect(resolveAppealDeadline(tx, 2027)).toBe('2027-05-15');
    expect(resolveAppealDeadline(tx, 2026, 'not-a-date')).toBe('2026-05-15');
  });

  it('derives Florida from the TRIM notice, not the tax bill', () => {
    // Florida's window is 25 days from the TRIM mailing in August. By the time
    // the tax bill arrives in November the window has closed, so a UI that
    // waits for the bill has already missed it.
    const fl = state('FL');
    expect(fl.appealDeadline.kind).toBe('days-from-notice');
    expect(resolveAppealDeadline(fl, 2026, '2026-08-18')).toBe('2026-09-12');
    expect(resolveAppealDeadline(fl, 2026)).toBeNull();
  });

  it('derives California September 15 and warns about the November counties', () => {
    const ca = state('CA');
    expect(resolveAppealDeadline(ca, 2026)).toBe('2026-09-15');
    // Los Angeles, Orange, San Diego and Riverside close November 30 instead,
    // which is a two-and-a-half month difference for a third of the state.
    expect(ca.appealDeadline.note).toContain('November 30');
    expect(ca.appealDeadline.note).toContain('Los Angeles');
  });

  it('derives New Jersey April 1 and flags the revaluation exception', () => {
    const nj = state('NJ');
    expect(resolveAppealDeadline(nj, 2026)).toBe('2026-04-01');
    expect(nj.appealDeadline.note).toContain('May 1');
  });

  it('counts Georgia, Maryland and Montana forward from the notice', () => {
    expect(resolveAppealDeadline(state('GA'), 2026, '2026-05-20')).toBe('2026-07-04');
    expect(resolveAppealDeadline(state('MD'), 2026, '2026-01-02')).toBe('2026-02-16');
    expect(resolveAppealDeadline(state('MT'), 2026, '2026-06-15')).toBe('2026-07-15');
  });

  it('returns null where the deadline is genuinely set locally', () => {
    // New York's assessing units are municipal and Illinois appeals open
    // township by township, so there is no statewide date to derive. Inventing
    // one would be worse than saying "read it off your notice".
    for (const code of ['NY', 'IL', 'PA', 'OH', 'NC', 'MI', 'VA', 'CO']) {
      const j = state(code);
      expect(j.appealDeadline.kind).toBe('printed-on-notice');
      expect(resolveAppealDeadline(j, 2026, '2026-03-01')).toBeNull();
      // …but always explains where to find it, so the UI has something to say.
      expect(j.appealDeadline.note).toBeTruthy();
    }
  });

  it('records that Michigan\'s March Board of Review is mandatory', () => {
    // Skipping the local Board of Review forfeits the whole year — the Tax
    // Tribunal will not hear a residential appeal that did not start there.
    const mi = state('MI');
    expect(mi.appealDeadline.note).toMatch(/mandatory/i);
    expect(mi.appealBodyName).toContain('Board of Review');
    expect(mi.appealBodyName).toContain('Tax Tribunal');
  });

  it('never sends a Texan to the Comptroller to change a value', () => {
    // PTAD has no jurisdiction over appraisal districts. Escalating there
    // instead of protesting to the ARB is how people miss May 15.
    const tx = state('TX');
    expect(tx.appealBodyName).toContain('Appraisal Review Board');
    expect(tx.stateRole).toMatch(/no jurisdiction/i);
  });
});

describe('who actually assesses', () => {
  it('assesses Texas through an appraisal district, not the county assessor', () => {
    // The appraisal district is an independent political subdivision; the
    // county tax assessor-collector only collects. A protest filed with the
    // collector is not filed.
    const tx = state('TX');
    expect(tx.assessingJurisdictionType).toBe('appraisal_district');
    expect(tx.assessingBodyLabel).toMatch(/Appraisal District/i);
  });

  it('assesses Maryland and Montana at state level, with no county assessor', () => {
    // Sending a Maryland homeowner to "the county assessor" sends them to an
    // office that does not exist — SDAT assesses all ~2m accounts itself.
    expect(state('MD').assessingJurisdictionType).toBe('state');
    expect(state('MD').stateRole).toMatch(/no county assessor/i);
    expect(state('MT').assessingJurisdictionType).toBe('state');
    expect(state('MD').revaluationCycleYears).toBe(3);
  });

  it('assesses New York, New Jersey and Michigan municipally', () => {
    // Roughly a thousand assessing units in New York and 564 in New Jersey —
    // "the state assessor" does not exist in any of the three.
    expect(state('NY').assessingJurisdictionType).toBe('municipal');
    expect(state('NJ').assessingJurisdictionType).toBe('municipal');
    expect(state('MI').assessingJurisdictionType).toBe('municipal');
    expect(state('NY').assessingBodyLabel).toMatch(/Nassau/);
    expect(state('MI').assessingBodyLabel).toMatch(/211\.10/);
  });

  it('calls the Ohio office an auditor, because Ohio has no assessor', () => {
    expect(state('OH').assessingBodyLabel).toMatch(/Auditor/i);
  });

  it('keeps Virginia\'s independent cities out of a county lookup', () => {
    // 38 cities in Virginia sit inside no county at all, so resolving a Richmond
    // or Alexandria address to a surrounding county finds nothing.
    expect(state('VA').assessingBodyLabel).toMatch(/independent city/i);
    expect(state('VA').notes).toMatch(/independent cities/i);
  });
});

describe('billing, which is not the same as assessment', () => {
  it('bills New Jersey quarterly on estimated figures for the first half-year', () => {
    // Q1 and Q2 use the prior year's value and rate because the current rate is
    // not struck until mid-year, so Q3 reconciles the whole year and is
    // routinely far bigger. Treating Q1 as a quarter of the annual bill is wrong.
    const nj = state('NJ');
    expect(nj.billingTiming).toBe('advance_estimated');
    expect(nj.installmentsPerYear).toBe(4);
    expect(nj.notes).toContain('February 1');
  });

  it('bills New York City in advance, with no single instalment count', () => {
    // Quarterly at or below $250,000 of assessed value, semi-annually above it
    // — so the number depends on the property, and null is the honest answer.
    const ny = state('NY');
    expect(ny.billingTiming).toBe('advance');
    expect(ny.installmentsPerYear).toBeNull();
    expect(ny.fiscalYearStartMonth).toBe(7);
  });

  it('runs California on a July fiscal year billed in arrears', () => {
    expect(state('CA').fiscalYearStartMonth).toBe(7);
    expect(state('CA').billingTiming).toBe('arrears');
    expect(state('CA').installmentsPerYear).toBe(2);
    expect(state('CA').notes).toContain('supplemental');
  });

  it('flags Cook County due dates as volatile so nothing hardcodes them', () => {
    // Cook's second instalment has landed on Aug 1, then Dec 15, then Oct 1 in
    // three consecutive years. A hardcoded date there is a late-payment fee.
    const il = state('IL');
    expect(il.installmentDueDatesVolatile).toBe(true);
    expect(il.notes).toContain('never hardcoded');

    // …and it is the only one, so the flag still means something.
    const volatileStates = Object.values(US_STATE_JURISDICTIONS).filter(
      j => j.installmentDueDatesVolatile,
    );
    expect(volatileStates.map(j => j.regionCode)).toEqual(['IL']);
  });

  it('records that the homeowner may never receive a bill at all', () => {
    // Most mortgaged US homes escrow, so the county mails the bill to the loan
    // servicer. "No bill on file" must never be read as "unpaid", and a nudge
    // to upload a bill has to survive there being none.
    expect(US_BILL_DELIVERY.escrowedBillGoesToServicer).toBe(true);
    expect(US_BILL_DELIVERY.note).toMatch(/servicer/i);

    for (const j of Object.values(US_STATE_JURISDICTIONS)) {
      expect(j.documentTypes).toContain('Information-only tax statement (escrowed)');
    }
  });

  it('keeps Florida\'s early-payment discount ladder where a homeowner sees it', () => {
    // An escrowed owner whose servicer pays in November gets 4% off and never
    // knows; an owner paying themselves in March gets nothing and is delinquent
    // on April 1.
    const fl = state('FL');
    expect(fl.notes).toContain('4%');
    expect(fl.notes).toContain('April 1');
  });
});

describe('unverified facts stay visible', () => {
  it('flags exactly the three claims we could not confirm', () => {
    // The rule is that uncertainty travels with the data. A figure encoded
    // without its doubt is indistinguishable from a verified one three months
    // later, and a figure silently dropped is re-researched from scratch.
    const flagged = Object.values(US_STATE_JURISDICTIONS)
      .filter(j => j.unverifiedFacts.length > 0)
      .map(j => j.regionCode)
      .sort();
    expect(flagged).toEqual(['GA', 'MI', 'OH']);
  });

  it('keeps Ohio\'s 35% ratio usable but visibly unconfirmed', () => {
    // Nulling it would make the model less useful than the bill the homeowner
    // is holding, which shows a 35% line. So it is encoded, and the doubt is
    // carried in both the ratio note and the unverified list.
    const oh = state('OH');
    expect(oh.assessmentRatioPercent).toBe(35);
    expect(oh.ratioNote).toMatch(/UNVERIFIED/);
    expect(oh.unverifiedFacts.join(' ')).toMatch(/35%/);
  });

  it('encodes no figures at all for Georgia HB 581', () => {
    // HB 581's floating homestead exemption is real and unverified, so it is
    // named as a lead to follow rather than modelled with invented numbers.
    const ga = state('GA');
    expect(ga.unverifiedFacts.join(' ')).toMatch(/581/);
    expect(ga.caps).toHaveLength(0);
    // The exemptions we did verify are still there and still exact.
    expect(ga.homesteadExemptions.find(e => e.id === 'ga-standard-homestead')?.amountUsd).toBe(2000);
    expect(ga.homesteadExemptions.find(e => e.id === 'ga-senior-homestead-65')?.amountUsd).toBe(
      4000,
    );
  });

  it('marks Michigan\'s 50% assessment rule as cited but not fetched', () => {
    const mi = state('MI');
    expect(mi.assessmentRatioPercent).toBe(50);
    expect(mi.ratioNote).toMatch(/UNVERIFIED/);
    expect(mi.unverifiedFacts.join(' ')).toMatch(/Article IX/);
  });

  it('leaves the verified states with an empty list, not a placeholder', () => {
    for (const code of ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'NC', 'NJ', 'VA', 'MD', 'MT', 'CO']) {
      expect(state(code).unverifiedFacts).toEqual([]);
    }
  });
});

describe('county lookups', () => {
  it('keys FIPS as a string so the leading zero survives', () => {
    // Maricopa is "04013". `Number("04013")` is 4013, which formats back as a
    // four-digit code matching no county — and it silently breaks every county
    // in the eleven states whose FIPS codes start with a zero.
    expect(Number('04013')).toBe(4013);
    expect(String(Number('04013'))).toBe('4013');
    expect(US_COUNTY_LOOKUPS['4013']).toBeUndefined();

    const maricopa = resolveUsCountyLookup('04013');
    expect(maricopa?.countyName).toBe('Maricopa');
    expect(maricopa?.fips).toBe('04013');
    expect(typeof maricopa?.fips).toBe('string');
  });

  it('stores every key as five digits', () => {
    for (const [key, county] of Object.entries(US_COUNTY_LOOKUPS)) {
      expect(key).toMatch(/^\d{5}$/);
      expect(county.fips).toBe(key);
    }
    // And at least one really does start with a zero, or the test above is
    // guarding nothing.
    expect(Object.keys(US_COUNTY_LOOKUPS).some(k => k.startsWith('0'))).toBe(true);
  });

  it('recovers a FIPS code that has already lost its leading zero', () => {
    // This is exactly how the zero goes missing: a JSON round-trip, a
    // spreadsheet import, or a parseInt in a caller. Padding it back is cheap.
    expect(normalizeUsFips(4013)).toBe('04013');
    expect(normalizeUsFips('4013')).toBe('04013');
    expect(normalizeUsFips(' 06037 ')).toBe('06037');
    expect(resolveUsCountyLookup(4013)?.countyName).toBe('Maricopa');
    expect(resolveUsCountyLookup(6037)?.countyName).toBe('Los Angeles');
  });

  it('rejects junk rather than padding it into a plausible key', () => {
    expect(normalizeUsFips('abc')).toBeNull();
    expect(normalizeUsFips('123456')).toBeNull();
    expect(normalizeUsFips('')).toBeNull();
    expect(normalizeUsFips(null)).toBeNull();
    expect(resolveUsCountyLookup('nope')).toBeNull();
  });

  it('returns null for a county we have not verified, and guesses nothing', () => {
    // There is no national lookup and no URL naming pattern. A synthesised
    // county URL produces a plausible dead link, and a homeowner following a
    // dead link to appeal a value can miss a statutory deadline.
    expect(resolveUsCountyLookup('06001')).toBeNull();
    expect(usJurisdictionsForState('WY')).toEqual([]);
  });

  it('separates the assessor from the collector where they differ', () => {
    // Harris County is the clearest case: HCAD sets the value and hears the
    // protest, the county tax assessor-collector only bills. Two agencies, two
    // domains, and the wrong one cannot help with a value.
    const harris = resolveUsCountyLookup('48201');
    expect(harris?.assessorAgency).toMatch(/Appraisal District/i);
    expect(harris?.taxAgency).toMatch(/Tax Assessor-Collector/i);
    expect(harris?.assessorUrl).not.toBe(harris?.taxUrl);
    expect(harris?.parcelIdLabel).toBe('Account Number');
  });

  it('points both Cook County roles at the one joint portal on purpose', () => {
    // Not a copy-paste slip: the Assessor's own site sits behind a WAF and the
    // Treasurer's serves an incomplete TLS chain, so the joint portal is the
    // only reliable entry point. The note says so, so nobody "fixes" it.
    const cook = resolveUsCountyLookup('17031');
    expect(cook?.assessorUrl).toBe(cook?.taxUrl);
    expect(cook?.note).toMatch(/WAF/);
    expect(cook?.note).toMatch(/TLS/);
    expect(cook?.parcelIdLabel).toBe('PIN');
  });

  it('records that New York City, not Kings County, assesses Brooklyn', () => {
    // There is no Kings County assessor. The parcel identifier is a BBL, not a
    // county roll number, and the same portal serves all five boroughs.
    const kings = resolveUsCountyLookup('36047');
    expect(kings?.assessorAgency).toMatch(/New York City Department of Finance/);
    expect(kings?.parcelIdLabel).toBe('BBL');
    expect(kings?.note).toMatch(/no Kings County assessor/i);
  });

  it('uses each county\'s own name for the parcel identifier', () => {
    // "APN" is wrong in Los Angeles (AIN), in Miami-Dade (Folio), in Cook
    // (PIN), in Texas (Account Number) and in New York City (BBL). Asking for
    // the wrong identifier is asking for something the owner cannot find.
    expect(resolveUsCountyLookup('06037')?.parcelIdLabel).toBe('AIN');
    expect(resolveUsCountyLookup('12086')?.parcelIdLabel).toBe('Folio Number');
    expect(resolveUsCountyLookup('06073')?.parcelIdLabel).toBe('APN');
  });

  it('lists the counties we have for one state, ordered by name', () => {
    expect(usJurisdictionsForState('CA').map(c => c.countyName)).toEqual([
      'Los Angeles',
      'Orange',
      'Riverside',
      'San Diego',
    ]);
    expect(usJurisdictionsForState('tx').map(c => c.countyName)).toEqual(['Dallas', 'Harris']);
    expect(usJurisdictionsForState(null)).toEqual([]);
  });

  it('keeps a county lookup useful even where the state is not modelled', () => {
    // Maricopa is seeded; Arizona is not. A verified county lookup is worth
    // having on its own, and the two registries are deliberately independent.
    expect(resolveUsCountyLookup('04013')).not.toBeNull();
    expect(resolveUsJurisdiction('US', 'AZ')).toBeNull();
  });
});
