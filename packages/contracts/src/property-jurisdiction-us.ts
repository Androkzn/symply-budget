/**
 * US property assessment & tax jurisdictions.
 *
 * The sibling of `property-jurisdiction.ts`, and deliberately *not* the same
 * shape. Canada fits "one authority, one value, one ratio, one rate" almost
 * everywhere. The United States does not, and three structural differences
 * break the Canadian schema outright:
 *
 * 1. **One rate becomes N rates.** A US bill is the sum of levies from every
 *    overlapping taxing district a parcel sits in — county, city, one or more
 *    school districts, community college, park, library, fire, water, hospital,
 *    and in Texas the MUD that financed the subdivision's water lines. Worse,
 *    the *taxable value can differ per district*: Florida's second $25,000
 *    homestead exemption does not apply to school levies, and Colorado assesses
 *    the same house at 7.05% for school levies and 6.80% for local-government
 *    levies **in the same year, on the same bill**. So an assessment ratio is a
 *    property of a *district class*, not of a property — which is why
 *    `assessmentRatioPercent` here is nullable and `districtClassRatios` exists.
 *
 * 2. **Rate basis is not uniform.** Most states quote mills per $1,000; Texas
 *    and Tennessee quote dollars per $100; California quotes a percent. Note
 *    that `per_100` and `percent` are the *same arithmetic* (1% of value is
 *    $1 per $100) and differ only in how the number is printed — the 10x trap
 *    is mistaking either of them for `per_1000`. Applying a Texas rate of
 *    1.2 as if it were mills produces a bill one tenth of the real one, and it
 *    looks plausible enough that nobody notices.
 *
 * 3. **Value is a stack, not a number.** Acquisition-value caps make assessed
 *    value diverge from market value permanently, and the gap is a legally
 *    named quantity the homeowner can lose: California Prop 13 (base year +2%,
 *    resets on sale), Florida Save Our Homes (+3% or CPI), Texas's 10%
 *    homestead cap, Michigan Proposal A (lesser of 1.05x or inflation, uncaps
 *    the year after a transfer), Oregon Measure 50 (3%), Arizona Prop 117 (5%,
 *    and the capped LPV is not appealable while the full cash value is). A
 *    single `assessedValue` field cannot hold this; every jurisdiction below
 *    names all three rungs — market, capped, taxable — separately.
 *
 * Two more facts that shape the UI rather than the maths:
 *
 * - **The homeowner may never receive a bill.** Most mortgaged US homes escrow
 *   property tax, so the county mails the bill to the loan servicer and the
 *   owner gets an information-only statement — or nothing. "You have not
 *   uploaded your tax bill" is therefore not evidence that anything is wrong.
 *   See `US_BILL_DELIVERY`.
 * - **Not every benefit reaches the bill.** New York's STAR is now mostly a
 *   cheque mailed to the homeowner, not a reduction on the bill, which is why
 *   `UsHomesteadExemption.deliveryMethod` exists.
 *
 * Every figure below was verified against the authority's own site in Aug 2026;
 * `sourceUrl` on each state points at what to re-check. Where a commonly cited
 * figure could **not** be confirmed it is listed in `unverifiedFacts` rather
 * than quietly presented as fact or quietly dropped — see `unverifiedFacts` on
 * OH, GA and MI. Dollar amounts on exemptions change yearly (Florida's second
 * homestead band is CPI-indexed; Enhanced STAR's income limit moves every
 * year): treat them as display hints, never as the basis for a calculation the
 * user relies on.
 */

import type { AppealDeadlineRule } from './property-jurisdiction';

/**
 * How a rate is quoted. Getting this wrong is a 10x error in the bill, so it is
 * stored per state rather than inferred from the number's magnitude — a rate of
 * "1.2" is perfectly plausible as both 1.2 mills and $1.2 per $100.
 *
 * `per_100` and `percent` are numerically identical; both exist because the
 * label on screen has to match what the county actually prints.
 */
export type RateBasis = 'per_1000' | 'per_100' | 'percent';

/**
 * Who values the property. Not cosmetic: in Texas the appraisal district is an
 * independent political subdivision and the county tax assessor-collector only
 * *collects*, so sending a Texan to "the county assessor" to dispute a value
 * sends them to an office with no power to change it. In Maryland and Montana
 * there is no county assessor at all.
 */
export type AssessingJurisdictionType = 'county' | 'appraisal_district' | 'municipal' | 'state';

/**
 * A class of taxing district. A parcel belongs to several at once and the bill
 * is their sum — this list is what makes "what is my tax rate?" a question with
 * no single answer.
 */
export type UsDistrictClass =
  | 'state'
  | 'county'
  | 'municipal'
  | 'township'
  | 'school'
  | 'community_college'
  | 'library'
  | 'fire'
  | 'water'
  | 'hospital'
  | 'park'
  | 'mud'
  | 'special_district';

/**
 * An assessment ratio that applies only to certain district classes.
 *
 * Colorado is the proof that this cannot live on the property: the same home,
 * in the same year, is assessed at two different percentages depending on which
 * district is levying. A model with one `assessmentRatioPercent` per property
 * has to pick one and is wrong about the other half of the bill.
 */
export interface UsDistrictClassRatio {
  /** District classes this ratio governs. */
  districtClasses: ReadonlyArray<UsDistrictClass>;
  /** How the state names this ratio, e.g. "Residential — school levies". */
  label: string;
  assessmentRatioPercent: number;
  /**
   * Percentage knocked off actual value *before* the ratio is applied, or null.
   * Colorado's local-government ratio comes with a 10% reduction — applied to
   * the first `actualValueReductionCapUsd` of actual value only, so it is not
   * expressible as a smaller ratio.
   */
  actualValueReductionPercent: number | null;
  /** Ceiling of actual value the reduction applies to, in whole dollars. */
  actualValueReductionCapUsd: number | null;
  note: string;
}

/**
 * An assessment ratio that applies only to part of a state.
 *
 * Illinois needs this: Cook County assesses residential property at 10% while
 * the other 101 counties use 33⅓%. A single statewide number is wrong for
 * whichever side of the county line the household is on, so the state-level
 * `assessmentRatioPercent` is null there and this array carries the truth.
 */
export interface UsSubStateRatio {
  /** Where this ratio applies, e.g. "Cook County". */
  scope: string;
  ratioPercent: number;
  /** How the statute prints it — "33⅓%" is not `33.33`. */
  ratioLabel: string;
  note: string;
}

/**
 * A cap that holds assessed value below market value.
 *
 * `resetsOnSale` is the field that matters most: it is why a buyer's tax bill
 * is nothing like the seller's, and why quoting "the current owner pays $4,200"
 * to a prospective buyer is actively misleading in CA, FL, TX and MI.
 * `portable` is the follow-up — in California (Prop 19) and Florida (DR-501T)
 * the accumulated gap can move with the owner to a new home, and a homeowner
 * who does not know that loses it by missing a filing window.
 */
export interface UsAssessmentCap {
  id: string;
  name: string;
  /** Maximum annual increase in the capped value, in percent. */
  annualLimitPercent: number;
  /** True where the real limit is the *lesser* of the percent and inflation. */
  tiedToInflation: boolean;
  /** True where a sale or transfer of ownership wipes the accumulated gap. */
  resetsOnSale: boolean;
  /** True where the gap can be carried to a replacement home. */
  portable: boolean;
  /** ISO date the cap lapses, for caps with a statutory sunset. Null if none. */
  expiresIso: string | null;
  summary: string;
  url: string;
}

/**
 * Where a homestead benefit lands.
 *
 * `separate_payment` exists because of New York: the STAR *credit* is a cheque
 * or direct deposit to the homeowner, so it never appears on the tax bill at
 * all. A UI that reads benefits off the bill will report a New Yorker as
 * receiving nothing, and a "you may be missing STAR" nudge would be wrong.
 */
export type UsExemptionDelivery = 'reduces_taxable_value' | 'reduces_tax_due' | 'separate_payment';

/**
 * A homestead exemption or equivalent owner-occupier benefit.
 *
 * The two `appliesTo…Levies` booleans are the crux. Florida's first $25,000
 * comes off every levy including school; the second $25,000 band comes off only
 * the non-school levies (s.196.031). New York's STAR is the mirror image — it
 * reduces school tax and nothing else. One boolean cannot say "school only" and
 * "everything but school", so there are two.
 */
export interface UsHomesteadExemption {
  id: string;
  name: string;
  /** Flat dollar amount removed, or null where the benefit is proportional. */
  amountUsd: number | null;
  /** Percentage of value removed, or null where the benefit is a flat amount. */
  percentOfValue: number | null;
  appliesToSchoolLevies: boolean;
  appliesToNonSchoolLevies: boolean;
  deliveryMethod: UsExemptionDelivery;
  /** Filing deadline as printed by the authority, or null where none is set. */
  applicationDeadline: string | null;
  summary: string;
  url: string;
}

/** How the tax year relates to the year the bill is paid. */
export type UsBillingTiming = 'arrears' | 'advance' | 'advance_estimated';

/** Everything that varies by US state. */
export interface UsStateJurisdiction {
  countryCode: 'US';
  /** Two-letter state code as stored in `households.state_province`. */
  regionCode: string;
  regionName: string;

  assessingJurisdictionType: AssessingJurisdictionType;
  /** What that office is actually called locally, e.g. "County Auditor". */
  assessingBodyLabel: string;
  stateAgencyName: string;
  stateAgencyUrl: string;
  /**
   * What the state agency does and — usually more useful — what it does not.
   * Texans routinely escalate to the Comptroller, which has no jurisdiction
   * over appraisal districts and cannot change a value.
   */
  stateRole: string;

  /**
   * Statewide percentage of market value that is assessed, or **null** where no
   * single number is correct: Illinois splits by county, New York lets each
   * assessing unit pick its own level, Pennsylvania runs county base years
   * through a Common Level Ratio, Colorado splits by district class. Null means
   * "do not do this maths without more input", not "unknown".
   */
  assessmentRatioPercent: number | null;
  /** Why the ratio is what it is, or why it is null. Always populated. */
  ratioNote: string | null;
  /** Ratios that vary geographically inside the state (Illinois). */
  subStateRatios: UsSubStateRatio[];
  /** Ratios that vary by taxing district class (Colorado). */
  districtClassRatios: UsDistrictClassRatio[];

  rateBasis: RateBasis;
  /** Anything that changes how a printed rate should be read. */
  rateBasisNote: string | null;
  /** Levies a homeowner should expect to see itemised on the bill. */
  typicalDistrictClasses: ReadonlyArray<UsDistrictClass>;

  /** Bottom of the value stack: what the market says the home is worth. */
  marketValueTerm: string;
  /** Middle rung: market value after any acquisition-value cap. */
  cappedValueTerm: string;
  /** Top rung: the capped value after exemptions — what the rate multiplies. */
  taxableValueTerm: string;
  /**
   * What the state calls the gap between market and capped value, where it has
   * a name. Null where no cap creates one. This is a quantity a homeowner can
   * lose by selling, so it needs a label the bill will match.
   */
  capGapTerm: string | null;
  parcelIdTerm: string;

  caps: UsAssessmentCap[];
  homesteadExemptions: UsHomesteadExemption[];

  appealDeadline: AppealDeadlineRule;
  appealBodyName: string;
  /** Null rather than a guessed URL — a wrong appeal link costs a deadline. */
  appealBodyUrl: string | null;

  /** Years between general reappraisals, or null where there is no cycle. */
  revaluationCycleYears: number | null;
  revaluationNote: string | null;

  /**
   * Month (1-12) the property tax year starts. July in California and New York
   * City; January in the states whose tax year is the calendar year. Getting
   * this wrong files a bill under the wrong year and breaks year-over-year
   * comparisons.
   */
  fiscalYearStartMonth: number;
  billingTiming: UsBillingTiming;
  /**
   * Instalments per year, or null where it depends on the property — New York
   * City bills quarterly below $250,000 of assessed value and semi-annually
   * above it, so no single number is right.
   */
  installmentsPerYear: number | null;
  /**
   * True where due dates have moved recently and must be read off the bill.
   * Cook County's second instalment has landed on Aug 1, then Dec 15, then
   * Oct 1 in three consecutive years — a hardcoded date there is a late fee.
   */
  installmentDueDatesVolatile: boolean;

  /** Real document titles a homeowner might upload here. */
  documentTypes: string[];
  /**
   * Commonly cited claims we could **not** confirm against an official source,
   * stated plainly. Present so the uncertainty travels with the data instead of
   * being lost between the research and the screen. Empty where everything
   * encoded was verified.
   */
  unverifiedFacts: string[];
  notes: string | null;
  /** Page to re-verify these figures against. */
  sourceUrl: string;
}

/**
 * Bill delivery is a nationwide fact, not a state one, so it lives here once
 * rather than as a field repeated identically fifteen times.
 *
 * Most mortgaged US homes escrow property tax: the taxing unit mails the bill
 * to the loan servicer, which pays it out of the escrow account, and the owner
 * receives an information-only statement — sometimes nothing at all. Any copy
 * that says "upload your tax bill" must survive the homeowner genuinely not
 * having one, and "no bill on file" must never read as "unpaid".
 */
export const US_BILL_DELIVERY = Object.freeze({
  escrowedBillGoesToServicer: true,
  ownerTypicallyReceives: 'information-only statement, or nothing',
  note: 'Where the mortgage escrows property tax, the county mails the bill to the loan servicer. The homeowner may only ever see an information-only statement, so an absent bill is not evidence of an unpaid one.',
} as const);

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

const CA_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'CA',
  regionName: 'California',
  assessingJurisdictionType: 'county',
  assessingBodyLabel: 'County Assessor (58 counties)',
  stateAgencyName: 'California State Board of Equalization (BOE)',
  stateAgencyUrl: 'https://www.boe.ca.gov/proptaxes/proptax.htm',
  stateRole:
    'The BOE oversees and issues guidance to the 58 county assessors and assesses state-assessed utilities. It does not value ordinary homes and cannot change your assessment — the county assessor does that.',
  assessmentRatioPercent: 100,
  ratioNote:
    'California taxes 100% of the *factored base year value*, not of market value. The ratio is not where the discount lives — Proposition 13 is. A long-held home is routinely assessed at a fraction of what it would sell for, and that is correct, not stale data.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'percent',
  rateBasisNote:
    'Article XIII A caps the ad valorem rate at 1% of full cash value. Voter-approved bonded indebtedness is added on top, so a real bill is typically 1.1%–1.3%. Rates are printed as percentages, never as mills.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'school',
    'community_college',
    'special_district',
  ],
  marketValueTerm: 'Full cash value (market value)',
  cappedValueTerm: 'Factored base year value',
  taxableValueTerm: 'Net taxable value',
  capGapTerm: 'Proposition 13 benefit (market value less factored base year value)',
  parcelIdTerm: "Assessor's Parcel Number (APN) — Los Angeles County calls it an AIN",
  caps: [
    {
      id: 'ca-prop-13',
      name: 'Proposition 13 base year value limit',
      annualLimitPercent: 2,
      tiedToInflation: true,
      resetsOnSale: true,
      portable: true,
      expiresIso: null,
      summary:
        'Your value is fixed at the price you paid (the base year value) and may rise by no more than 2% a year, or the rate of inflation if that is lower. A sale or new construction resets it to current market value, which is why a new owner two doors down can pay several times what you do. Under Proposition 19, owners 55+, severely disabled owners and wildfire or disaster victims may transfer the base year value to a replacement home up to three times.',
      url: 'https://www.boe.ca.gov/proptaxes/faqs/propositions13.htm',
    },
  ],
  homesteadExemptions: [
    {
      id: 'ca-homeowners-exemption',
      name: "Homeowners' Exemption",
      amountUsd: 7000,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        "$7,000 off the assessed value of an owner-occupied home — worth roughly $70 a year at the 1% rate. Filed once with the county assessor and it stays in place while you live there. It is small enough that many owners assume it isn't worth claiming; it is, because it renews itself.",
      url: 'https://www.boe.ca.gov/proptaxes/homeowners_exemption.htm',
    },
  ],
  appealDeadline: {
    kind: 'fixed',
    month: 9,
    day: 15,
    note: 'The regular filing period opens July 2 and closes September 15. It closes November 30 instead in counties that do not mail a notice of assessed value to every owner — which includes Los Angeles, Orange, San Diego and Riverside. Check the closing date with your own county before relying on September 15.',
  },
  appealBodyName: 'County Assessment Appeals Board',
  appealBodyUrl: 'https://www.boe.ca.gov/proptaxes/asmappeal.htm',
  revaluationCycleYears: null,
  revaluationNote:
    'There is no reappraisal cycle. Value changes only on a change in ownership, on new construction, or by the annual inflation factor — so an unchanged value year after year is the system working.',
  fiscalYearStartMonth: 7,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Assessed Value',
    'Secured Property Tax Bill',
    'Supplemental Property Tax Bill',
    'Notice of Supplemental Assessment',
    "Homeowners' Exemption claim (BOE-266)",
    'Assessment Appeals Board decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'The fiscal year runs July 1 to June 30 and is billed in two instalments: the first is due November 1 and delinquent after December 10, the second due February 1 and delinquent after April 10. Buying a home triggers a *supplemental* bill for the difference between the old and new base year values, prorated — it arrives separately, months later, and is not escrowed, so it surprises almost every first-time buyer.',
  sourceUrl: 'https://www.boe.ca.gov/proptaxes/proptax.htm',
};

const TX_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'TX',
  regionName: 'Texas',
  assessingJurisdictionType: 'appraisal_district',
  assessingBodyLabel: 'County Appraisal District (CAD)',
  stateAgencyName: "Texas Comptroller — Property Tax Assistance Division (PTAD)",
  stateAgencyUrl: 'https://comptroller.texas.gov/taxes/property-tax/',
  stateRole:
    'PTAD publishes forms, guidance and the property value study, and has **no jurisdiction over appraisal districts** — it cannot change your value or hear your protest. Escalating to the Comptroller instead of protesting to the ARB is how people miss the deadline.',
  assessmentRatioPercent: 100,
  ratioNote:
    'Texas appraises at 100% of market value. There is no assessment ratio to divide by — the relief comes from exemptions and the 10% homestead cap instead.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_100',
  rateBasisNote:
    'Texas quotes rates as dollars per $100 of taxable value, not mills. Reading a 1.25 rate as mills produces a bill one tenth of the real one.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'school',
    'community_college',
    'hospital',
    'mud',
    'special_district',
  ],
  marketValueTerm: 'Market value',
  cappedValueTerm: 'Appraised value (after the 10% homestead limitation)',
  taxableValueTerm: 'Taxable value',
  capGapTerm: 'Homestead cap loss',
  parcelIdTerm: 'Account number (appraisal district property ID)',
  caps: [
    {
      id: 'tx-homestead-10',
      name: 'Residence homestead appraisal cap (Tax Code §23.23)',
      annualLimitPercent: 10,
      tiedToInflation: false,
      resetsOnSale: true,
      portable: false,
      expiresIso: null,
      summary:
        'Once your homestead exemption has been in place a full year, the appraised value may not rise more than 10% a year plus the value of new improvements — however far market value runs ahead. The difference shows on the notice as "homestead cap loss". It ends when the property changes hands.',
      url: 'https://comptroller.texas.gov/taxes/property-tax/exemptions/',
    },
    {
      id: 'tx-circuit-breaker-20',
      name: 'Non-homestead circuit-breaker limitation (Tax Code §23.231)',
      annualLimitPercent: 20,
      tiedToInflation: false,
      resetsOnSale: true,
      portable: false,
      expiresIso: '2026-12-31',
      summary:
        'A temporary 20% annual cap on appraised value for non-homestead property worth $5 million or less. It expires December 31, 2026 — after which those values snap back to market with no limitation, so do not build a multi-year projection on it.',
      url: 'https://comptroller.texas.gov/taxes/property-tax/',
    },
  ],
  homesteadExemptions: [
    {
      id: 'tx-homestead-school',
      name: 'School district residence homestead exemption',
      amountUsd: 140000,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: false,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        'The general residence homestead exemption removes $140,000 of value from school district taxes, raised from $100,000 by SB 4 in the 89th Legislature (2025). School levies are the largest line on most Texas bills, so this is the single biggest reduction available — but it applies to school taxes only.',
      url: 'https://comptroller.texas.gov/taxes/property-tax/exemptions/',
    },
    {
      id: 'tx-homestead-school-over-65',
      name: 'Additional school district exemption, age 65 or older',
      amountUsd: 60000,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: false,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        'A further $60,000 off school district taxes for owners aged 65 or older, on top of the general $140,000. Disabled owners qualify for the same additional amount.',
      url: 'https://comptroller.texas.gov/taxes/property-tax/exemptions/',
    },
    {
      id: 'tx-homestead-fm-road',
      name: 'County farm-to-market road / flood control exemption',
      amountUsd: 3000,
      percentOfValue: null,
      appliesToSchoolLevies: false,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        '$3,000 off the county levy where the county collects a farm-to-market road or flood control tax.',
      url: 'https://comptroller.texas.gov/taxes/property-tax/exemptions/',
    },
    {
      id: 'tx-homestead-local-option',
      name: 'Local option residence homestead exemption',
      amountUsd: null,
      percentOfValue: 20,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        'Any taxing unit may adopt a homestead exemption of up to 20% of appraised value. Whether your city, county or hospital district has done so — and for how much — is a local decision, so two identical homes in neighbouring cities can carry different exemptions.',
      url: 'https://comptroller.texas.gov/taxes/property-tax/exemptions/',
    },
  ],
  appealDeadline: {
    kind: 'fixed-or-days-from-notice',
    month: 5,
    day: 15,
    days: 30,
    note: 'A protest to the Appraisal Review Board is due by May 15, or 30 days after the appraisal district delivered your notice of appraised value, whichever is later. A notice mailed in June therefore does not leave you already out of time.',
  },
  appealBodyName: 'Appraisal Review Board (ARB)',
  appealBodyUrl: 'https://comptroller.texas.gov/taxes/property-tax/protests/',
  revaluationCycleYears: null,
  revaluationNote:
    'Appraisal districts reappraise on their own schedule; many do so annually. The notice of appraised value is the event that starts your protest clock, not the calendar.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: 1,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Appraised Value',
    'Property Tax Statement',
    'Application for Residence Homestead Exemption (Form 50-114)',
    'Notice of Protest (Form 50-132)',
    'Appraisal Review Board order determining protest',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'The appraisal district appraises; the county tax assessor-collector only bills and collects. They are separate offices and a protest filed with the wrong one is not filed. The tax year is the calendar year but the bill straddles it: statements go out around October and are due January 31, delinquent February 1. Texas has no state income tax, which is why school levies and therefore property tax are unusually high.',
  sourceUrl: 'https://comptroller.texas.gov/taxes/property-tax/',
};

const FL_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'FL',
  regionName: 'Florida',
  assessingJurisdictionType: 'county',
  assessingBodyLabel:
    'County Property Appraiser (assesses); County Tax Collector (bills and collects)',
  stateAgencyName: 'Florida Department of Revenue — Property Tax Oversight',
  stateAgencyUrl: 'https://floridarevenue.com/property/Pages/Home.aspx',
  stateRole:
    'The Department of Revenue oversees, trains and audits the county property appraisers and approves the tax rolls. It does not value individual homes and cannot hear a value dispute.',
  assessmentRatioPercent: 100,
  ratioNote:
    'Florida assesses at 100% of just value, then applies Save Our Homes and exemptions. The discount lives in the cap and the exemptions, not in a ratio.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Florida quotes millage — dollars per $1,000 of taxable value. A total of 20 mills on a $300,000 taxable value is $6,000.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'school',
    'water',
    'hospital',
    'library',
    'fire',
    'special_district',
  ],
  marketValueTerm: 'Just value (market value)',
  cappedValueTerm: 'Assessed value (Save Our Homes capped)',
  taxableValueTerm: 'Taxable value',
  capGapTerm: 'Save Our Homes benefit (differential)',
  parcelIdTerm: 'Parcel ID — Miami-Dade and several other counties call it a Folio number',
  caps: [
    {
      id: 'fl-save-our-homes',
      name: 'Save Our Homes assessment limitation',
      annualLimitPercent: 3,
      tiedToInflation: true,
      resetsOnSale: true,
      portable: true,
      expiresIso: null,
      summary:
        'Once your homestead exemption is in place, the assessed value of your home may rise by no more than 3% a year or the change in the Consumer Price Index, whichever is less. The accumulated gap — the Save Our Homes benefit — is lost on a change of ownership, but up to a statutory cap it can be transferred to a new Florida homestead within three years by filing Form DR-501T. Owners who move without filing DR-501T simply lose it.',
      url: 'https://floridarevenue.com/property/Pages/Taxpayers_Exemptions.aspx',
    },
  ],
  homesteadExemptions: [
    {
      id: 'fl-homestead-first-25k',
      name: 'Homestead exemption — first $25,000',
      amountUsd: 25000,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: 'March 1',
      summary:
        'The first $25,000 of assessed value is exempt from **all** levies, school taxes included. Apply once with the county property appraiser on Form DR-501 by March 1; it renews automatically after that.',
      url: 'https://floridarevenue.com/property/Pages/Taxpayers_Exemptions.aspx',
    },
    {
      id: 'fl-homestead-additional-25k',
      name: 'Additional homestead exemption — up to a further $25,000',
      amountUsd: 25000,
      percentOfValue: null,
      appliesToSchoolLevies: false,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: 'March 1',
      summary:
        'A second band of up to $25,000, applying only to assessed value above $50,000 and — critically — **not to school levies** (s.196.031). The amount is indexed to CPI annually. Because school millage is usually the largest single levy on a Florida bill, applying this band to the whole bill overstates the saving substantially.',
      url: 'https://floridarevenue.com/property/Pages/Taxpayers_Exemptions.aspx',
    },
  ],
  appealDeadline: {
    kind: 'days-from-notice',
    days: 25,
    note: 'A petition to the Value Adjustment Board is due 25 days after the property appraiser mails the TRIM notice (Notice of Proposed Property Taxes), which goes out in August. The exact deadline is printed on the TRIM notice — and the TRIM notice, not the tax bill, is the document to act on.',
  },
  appealBodyName: 'Value Adjustment Board (VAB)',
  appealBodyUrl: 'https://floridarevenue.com/property/Pages/Taxpayers_ValueAdjustmentBoards.aspx',
  revaluationCycleYears: 1,
  revaluationNote: 'Just value is set annually as of January 1.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: 1,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'TRIM notice (Notice of Proposed Property Taxes)',
    'Property Tax Bill (Notice of Ad Valorem Taxes and Non-Ad Valorem Assessments)',
    'Original Application for Homestead Exemption (DR-501)',
    'Transfer of Homestead Assessment Difference (DR-501T)',
    'Value Adjustment Board decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'One bill a year, mailed on or around November 1, with a discount ladder for paying early: 4% in November, 3% in December, 2% in January, 1% in February, none in March, delinquent April 1. An escrowed homeowner whose servicer pays in November is getting the 4% discount without ever seeing it. The bill also carries non-ad-valorem assessments (solid waste, stormwater, lighting) which are flat charges, not millage, and no exemption touches them.',
  sourceUrl: 'https://floridarevenue.com/property/Pages/Home.aspx',
};

const NY_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'NY',
  regionName: 'New York',
  assessingJurisdictionType: 'municipal',
  assessingBodyLabel:
    'Town or city assessor — county-level assessing exists only in Nassau and Tompkins; the New York City Department of Finance assesses all five boroughs',
  stateAgencyName:
    'NYS Department of Taxation and Finance — Office of Real Property Tax Services (ORPTS)',
  stateAgencyUrl: 'https://www.tax.ny.gov/pit/property/',
  stateRole:
    'ORPTS sets equalization rates, administers STAR and advises assessors. It does not assess property — with roughly a thousand assessing units, "the New York assessor" does not exist.',
  assessmentRatioPercent: null,
  ratioNote:
    'There is no statewide ratio. Each assessing unit picks its own uniform level of assessment, which may be anywhere from a few percent to 100% of market value, and the state publishes an equalization rate and a residential assessment ratio to convert between them. Comparing a raw assessed value across two towns is meaningless without those.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Most of the state quotes rates per $1,000 of assessed value. New York City is the exception and prints its class tax rates as percentages of billable assessed value.',
  typicalDistrictClasses: ['county', 'municipal', 'township', 'school', 'library', 'fire', 'special_district'],
  marketValueTerm: 'Full market value',
  cappedValueTerm: 'Assessed value (at the local level of assessment)',
  taxableValueTerm: 'Taxable assessed value',
  capGapTerm: null,
  parcelIdTerm:
    'Tax map / Section-Block-Lot number — New York City uses the Borough-Block-Lot (BBL)',
  caps: [],
  homesteadExemptions: [
    {
      id: 'ny-star-credit',
      name: 'STAR credit (School Tax Relief)',
      amountUsd: null,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: false,
      deliveryMethod: 'separate_payment',
      applicationDeadline: null,
      summary:
        'New homeowners receive STAR as a **credit** — a cheque or direct deposit from the state, not a reduction on the tax bill. Income limit $500,000. Because it never touches the bill, a homeowner reading their bill will conclude they are getting nothing; the money arrives separately, usually shortly before the school tax is due.',
      url: 'https://www.tax.ny.gov/pit/property/star/',
    },
    {
      id: 'ny-star-exemption',
      name: 'STAR exemption (legacy)',
      amountUsd: null,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: false,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        'The original form of STAR, which does appear on the school tax bill as a reduction. It is **closed to new homeowners** — only owners who already had it may keep it — and carries a lower income limit of $250,000. So two neighbours can receive the same benefit through two different mechanisms.',
      url: 'https://www.tax.ny.gov/pit/property/star/',
    },
    {
      id: 'ny-enhanced-star',
      name: 'Enhanced STAR',
      amountUsd: null,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: false,
      deliveryMethod: 'separate_payment',
      applicationDeadline: null,
      summary:
        'A larger STAR benefit for owners where at least one owner is 65 or older. The income limit moves every year: $110,750 for 2026 benefits and $113,550 for 2027. Delivered as a credit for anyone not already holding the legacy exemption.',
      url: 'https://www.tax.ny.gov/pit/property/star/eligibility.htm',
    },
  ],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'Grievance Day is set by each assessing unit and published locally; New York City runs its own Tax Commission calendar entirely separate from the rest of the state. Because assessing units are municipal, there is no single statewide date to show — read it off your assessment notice or your assessor\'s published schedule.',
  },
  appealBodyName: 'Board of Assessment Review — New York City Tax Commission in the five boroughs',
  appealBodyUrl: 'https://www.tax.ny.gov/pit/property/contest/',
  revaluationCycleYears: null,
  revaluationNote:
    'Reassessment is at each assessing unit\'s discretion. Some reassess annually; others have not done so in decades, which is exactly why equalization rates exist.',
  fiscalYearStartMonth: 7,
  billingTiming: 'advance',
  installmentsPerYear: null,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Assessment / Notice of Property Value (NYC)',
    'School Tax Bill',
    'Town and County Tax Bill',
    'NYC Property Tax Bill (Statement of Account)',
    'STAR credit check or direct-deposit notice',
    'Board of Assessment Review determination',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'Outside New York City a homeowner gets two separate bills — a school tax bill in the autumn and a town-and-county bill in the winter — from two different collectors, and STAR only touches the first. New York City bills in advance on a July 1 fiscal year: quarterly where assessed value is $250,000 or less, semi-annually above it, which is why there is no single instalment count for the state.',
  sourceUrl: 'https://www.tax.ny.gov/pit/property/',
};

const IL_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'IL',
  regionName: 'Illinois',
  assessingJurisdictionType: 'county',
  assessingBodyLabel:
    'Cook County Assessor in Cook; township assessors or the county Supervisor of Assessments in the other 101 counties',
  stateAgencyName: 'Illinois Department of Revenue',
  stateAgencyUrl: 'https://tax.illinois.gov/localgovernments/property.html',
  stateRole:
    'IDOR states plainly that it "does not administer property tax". It issues the state equalization factor and guidance; assessment, billing and collection are entirely local.',
  assessmentRatioPercent: null,
  ratioNote:
    'Illinois has no single ratio — it splits inside the state. Cook County assesses residential property at 10% of market value; the other 101 counties use 33⅓% (35 ILCS 200/9-145). Applying the Cook ratio downstate understates the assessment by more than three times, and applying the downstate ratio in Cook overstates it by the same factor.',
  subStateRatios: [
    {
      scope: 'Cook County',
      ratioPercent: 10,
      ratioLabel: '10%',
      note: 'Cook assesses residential property at 10% of market value under its own classification ordinance, then applies the state equalizer.',
    },
    {
      scope: 'The other 101 counties',
      ratioPercent: 100 / 3,
      ratioLabel: '33⅓%',
      note: '35 ILCS 200/9-145 sets the statutory level at 33⅓% of fair cash value outside Cook.',
    },
  ],
  districtClassRatios: [],
  rateBasis: 'percent',
  rateBasisNote:
    'Illinois bills print the combined rate as a percentage of Equalized Assessed Value (e.g. 7.204%), which is arithmetically the same as dollars per $100 — and ten times a mill rate.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'township',
    'school',
    'community_college',
    'library',
    'park',
    'fire',
    'special_district',
  ],
  marketValueTerm: 'Fair market value',
  cappedValueTerm: 'Assessed value, then Equalized Assessed Value (EAV) after the state equalizer',
  taxableValueTerm: 'EAV less exemptions',
  capGapTerm: null,
  parcelIdTerm: 'Property Index Number (PIN) — 14 digits in Cook County',
  caps: [],
  homesteadExemptions: [
    {
      id: 'il-general-homestead',
      name: 'General Homestead Exemption',
      amountUsd: null,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: null,
      summary:
        'An owner-occupier reduction subtracted from Equalized Assessed Value, not from market value — the order matters, because it is applied after the state equalizer. The amount is set by statute and differs in Cook County; check the figure with your county before quoting it.',
      url: 'https://tax.illinois.gov/localgovernments/property.html',
    },
  ],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'Appeals open and close township by township on a rolling calendar published by the assessor and the Board of Review, so there is no single county-wide date, let alone a statewide one. A further appeal to the state Property Tax Appeal Board runs from the Board of Review\'s decision.',
  },
  appealBodyName: 'County Board of Review — then the Illinois Property Tax Appeal Board (PTAB)',
  appealBodyUrl: 'https://tax.illinois.gov/localgovernments/property.html',
  revaluationCycleYears: 3,
  revaluationNote:
    'Cook County reassesses on a triennial cycle by township group (city, north, south). Downstate counties operate on a four-year general assessment cycle.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: true,
  documentTypes: [
    'Notice of Proposed Assessed Valuation',
    'First Installment Tax Bill',
    'Second Installment Tax Bill',
    'Board of Review final decision',
    'PTAB decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'Illinois bills a year in arrears in two instalments — the first is a flat percentage of the prior year, the second carries the actual rate. Cook County\'s second-instalment due date has moved from August 1 to December 15 to October 1 across three consecutive years, so it must be read from the bill and never hardcoded or predicted from last year. Cook is also the only county that runs assessed value through a state equalizer to reach EAV before exemptions come off; a calculation that subtracts exemptions from assessed value rather than EAV is wrong there.',
  sourceUrl: 'https://tax.illinois.gov/localgovernments/property.html',
};

const PA_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'PA',
  regionName: 'Pennsylvania',
  assessingJurisdictionType: 'county',
  assessingBodyLabel: 'County Assessment Office',
  stateAgencyName: 'PA Department of Community and Economic Development — Tax Equalization Division',
  stateAgencyUrl:
    'https://dced.pa.gov/local-government/boards-committees/tax-equalization-division/',
  stateRole:
    'The Tax Equalization Division calculates and publishes each county\'s Common Level Ratio annually. It does not assess property; counties do, and there is no state-mandated reassessment cycle at all.',
  assessmentRatioPercent: null,
  ratioNote:
    'Pennsylvania has no statewide ratio and no reassessment mandate. Each county assesses against its own frozen base year — some decades old — and the state publishes a Common Level Ratio per county per year to convert market value to that base. County CLRs range from near 100% down to single digits, so an assessed value here is not comparable to one in the next county and is not a market value.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Pennsylvania quotes millage. A homeowner receives three separate millages — county, municipality and school district — and typically three separate bills.',
  typicalDistrictClasses: ['county', 'municipal', 'township', 'school'],
  marketValueTerm: 'Market value',
  cappedValueTerm: 'Assessed value (county base year value)',
  taxableValueTerm: 'Assessed value less any homestead exclusion',
  capGapTerm: null,
  parcelIdTerm: 'Parcel number / Tax map number (format is county-specific)',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'The annual appeal deadline is set by county class — commonly August 1 or September 1 — and is published by your county assessment office. Because Pennsylvania counties reassess on no fixed schedule, most owners are appealing an existing value rather than a new notice.',
  },
  appealBodyName: 'County Board of Assessment Appeals',
  appealBodyUrl: null,
  revaluationCycleYears: null,
  revaluationNote:
    'There is no statutory reassessment cycle. Some counties have not reassessed since the 1970s or 1980s, which is precisely what the Common Level Ratio exists to paper over.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: null,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Assessment Change',
    'County/Municipal Real Estate Tax Bill',
    'School Real Estate Tax Bill',
    'Board of Assessment Appeals decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'County and municipal bills usually run on the calendar year while school district bills run on a July fiscal year, so a Pennsylvania homeowner holds bills covering two different periods at once. The Homestead/Farmstead Exclusion under the Taxpayer Relief Act is set by each school district from gaming revenue; the amounts and the application deadline were not verified for this build and are deliberately not encoded rather than guessed.',
  sourceUrl: 'https://dced.pa.gov/local-government/boards-committees/tax-equalization-division/',
};

const OH_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'OH',
  regionName: 'Ohio',
  assessingJurisdictionType: 'county',
  assessingBodyLabel: 'County Auditor',
  stateAgencyName: 'Ohio Department of Taxation',
  stateAgencyUrl: 'https://tax.ohio.gov/government/real-state',
  stateRole:
    'The Department of Taxation supervises and approves county reappraisals and updates. The county auditor — not an "assessor", a title Ohio does not use — actually values property.',
  // The 35% figure is what every Ohio bill visibly uses, so nulling it would
  // make the model less useful than the paper the homeowner is holding. It is
  // kept, and the doubt is carried in `ratioNote` *and* `unverifiedFacts` so it
  // cannot be read as confirmed.
  assessmentRatioPercent: 35,
  ratioNote:
    'UNVERIFIED. Ohio is widely cited as assessing residential property at 35% of appraised market value, and Ohio bills do show a "35% value" line, but this figure could not be confirmed against an official source for this build. Treat it as a display hint and confirm with the county auditor before using it in a calculation.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Ohio quotes millage against the assessed (35%) value. Ohio bills also distinguish the full voted rate from the lower "effective" rate produced by HB 920 tax reduction factors, so the rate that actually applies is not the rate the levy was passed at.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'township',
    'school',
    'library',
    'park',
    'special_district',
  ],
  marketValueTerm: 'Appraised (100%) market value',
  cappedValueTerm: 'Assessed (taxable) value',
  taxableValueTerm: 'Assessed value less reductions and credits',
  capGapTerm: null,
  parcelIdTerm: 'Parcel number (county auditor format)',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'A complaint against valuation is filed with the county Board of Revision against a given tax year; the county auditor publishes the filing window. Check the closing date with your county auditor — it is tied to the tax list, not to a notice you receive.',
  },
  appealBodyName: 'County Board of Revision',
  appealBodyUrl: 'https://tax.ohio.gov/government/real-state',
  revaluationCycleYears: 6,
  revaluationNote:
    'A full reappraisal every six years, with a triennial update in the third year of each cycle. Counties are on staggered cycles, so a neighbouring county may reassess in a different year — a flat value in Ohio usually means you are between cycle years, not that data is stale.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Value Change',
    'Real Estate Tax Bill',
    'Complaint Against the Valuation of Real Property (DTE 1)',
    'Board of Revision decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [
    'The 35% residential assessment ratio could not be confirmed against an official Ohio source for this build. It is encoded because Ohio bills visibly use it, but it must be re-verified before it drives a calculation.',
  ],
  notes:
    'Ohio taxes a fraction of appraised value, so the number on the bill is not the market value the auditor determined — both appear on the notice and confusing them roughly triples the apparent value. Bills are paid in arrears in two half-year instalments.',
  sourceUrl: 'https://tax.ohio.gov/government/real-state',
};

const GA_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'GA',
  regionName: 'Georgia',
  assessingJurisdictionType: 'county',
  assessingBodyLabel: 'County Board of Tax Assessors',
  stateAgencyName: 'Georgia Department of Revenue — Local Government Services',
  stateAgencyUrl: 'https://dor.georgia.gov/local-government-services',
  stateRole:
    'Local Government Services approves county digests and issues rules. County boards of tax assessors value property; the tax commissioner bills and collects.',
  assessmentRatioPercent: 40,
  ratioNote:
    'Georgia assesses residential property at 40% of fair market value statewide. Applying a Georgia millage rate to full market value overstates the bill by two and a half times, and the error is invisible because the result still looks like a plausible tax bill.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote: 'Georgia quotes millage against the 40% assessed value.',
  typicalDistrictClasses: ['state', 'county', 'municipal', 'school', 'fire', 'special_district'],
  marketValueTerm: 'Fair market value',
  cappedValueTerm: 'Assessed value (40% of fair market value)',
  taxableValueTerm: 'Net assessed value after exemptions',
  capGapTerm: null,
  parcelIdTerm: 'Parcel ID / Map & Parcel number',
  caps: [],
  homesteadExemptions: [
    {
      id: 'ga-standard-homestead',
      name: 'Standard homestead exemption',
      amountUsd: 2000,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: 'April 1',
      summary:
        '$2,000 off the 40% assessed value of an owner-occupied home. Many counties and school districts adopt larger local exemptions on top, so the state figure is a floor, not the whole benefit.',
      url: 'https://dor.georgia.gov/local-government-services',
    },
    {
      id: 'ga-senior-homestead-65',
      name: 'Homestead exemption, age 65 or older',
      amountUsd: 4000,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: true,
      deliveryMethod: 'reduces_taxable_value',
      applicationDeadline: 'April 1',
      summary:
        '$4,000 for owners aged 65 or older whose income (excluding certain retirement and social security income) does not exceed $10,000. The income test is low enough that most seniors do not qualify for this one and should look at their county\'s local senior exemption instead.',
      url: 'https://dor.georgia.gov/local-government-services',
    },
  ],
  appealDeadline: {
    kind: 'days-from-notice',
    days: 45,
    note: 'An appeal is due 45 days from the date on your Annual Notice of Assessment. The closing date printed on the notice governs — Georgia mails a notice to every owner every year, so the notice, not the bill, is the trigger.',
  },
  appealBodyName: 'County Board of Equalization',
  appealBodyUrl: 'https://dor.georgia.gov/local-government-services',
  revaluationCycleYears: 1,
  revaluationNote:
    'Counties must maintain the digest at fair market value and mail an annual notice of assessment to every owner, so values are reviewed yearly.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: null,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Annual Notice of Assessment',
    'Property Tax Bill',
    'Homestead exemption application',
    'Board of Equalization decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [
    'House Bill 581\'s statewide floating homestead exemption — under which a local government may opt out — could not be verified for this build. No figures for it are encoded. If a Georgia homeowner\'s assessed value appears capped relative to market value, HB 581 is the likely reason and must be researched before it is modelled.',
  ],
  notes:
    'Georgia mails an Annual Notice of Assessment to every property owner every year and that notice, not the tax bill, starts the appeal clock. The notice also carries an estimate of the tax, which is not a bill and is not payable.',
  sourceUrl: 'https://dor.georgia.gov/local-government-services',
};

const NC_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'NC',
  regionName: 'North Carolina',
  assessingJurisdictionType: 'county',
  assessingBodyLabel: 'County Assessor (Tax Assessor)',
  stateAgencyName: 'North Carolina Department of Revenue — Property Tax Division',
  stateAgencyUrl: 'https://www.ncdor.gov/taxes-forms/property-tax',
  stateRole:
    'The Property Tax Division advises counties, administers the appraisal of public service companies, and staffs the Property Tax Commission, which hears appeals from county boards. Counties do the valuing.',
  assessmentRatioPercent: 100,
  ratioNote:
    'North Carolina assesses at 100% of market value as of the last countywide revaluation — which may be up to eight years ago. A value that looks low against today\'s market is usually a stale base year, not an error.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_100',
  rateBasisNote:
    'North Carolina quotes rates as dollars (or cents) per $100 of valuation, not mills. A county rate of 0.60 means $0.60 per $100, i.e. 0.6% — ten times a mill reading of the same number.',
  typicalDistrictClasses: ['county', 'municipal', 'fire', 'school', 'special_district'],
  marketValueTerm: 'Market value',
  cappedValueTerm: 'Appraised value (as of the last revaluation)',
  taxableValueTerm: 'Assessed value',
  capGapTerm: null,
  parcelIdTerm: 'Parcel Identification Number (PIN)',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'An appeal is filed with the county Board of Equalization and Review, which convenes and adjourns on dates the county publishes each spring — the adjournment date is the deadline and it differs by county. A further appeal to the state Property Tax Commission runs from the county board\'s written decision.',
  },
  appealBodyName: 'County Board of Equalization and Review — then the NC Property Tax Commission',
  appealBodyUrl: 'https://www.ncdor.gov/taxes-forms/property-tax',
  revaluationCycleYears: 8,
  revaluationNote:
    'Counties must revalue at least every eight years (the octennial cycle); many populous counties elect a four-year cycle. Between revaluations the value is frozen, so several years of no change is expected — and then one very large jump.',
  fiscalYearStartMonth: 7,
  billingTiming: 'arrears',
  installmentsPerYear: 1,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Real Property Assessed Value',
    'Combined Vehicle and Property Tax Notice',
    'Property Tax Bill',
    'Board of Equalization and Review decision',
    'Property Tax Commission decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'A revaluation year produces one large step change rather than annual drift, so a year-over-year percentage comparison across a revaluation boundary is not comparing like with like. Counties bill on a July fiscal year with one annual bill.',
  sourceUrl: 'https://www.ncdor.gov/taxes-forms/property-tax',
};

const MI_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'MI',
  regionName: 'Michigan',
  assessingJurisdictionType: 'municipal',
  assessingBodyLabel: 'City or township assessor (MCL 211.10(1))',
  stateAgencyName: 'Michigan Department of Treasury — State Tax Commission',
  stateAgencyUrl: 'https://www.michigan.gov/treasury/local/stc',
  stateRole:
    'The State Tax Commission supervises assessing and certifies assessors; counties equalize. The city or township assessor values your home — Michigan has no county assessor.',
  assessmentRatioPercent: 50,
  ratioNote:
    'UNVERIFIED. Assessed value is stated as 50% of true cash value, giving the State Equalized Value (SEV). The 50% figure is cited to Michigan Constitution Article IX §3 but was not independently fetched for this build. Note that SEV is not what you are taxed on — taxable value is, and Proposal A holds it below SEV.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Michigan quotes millage against taxable value. Homestead ("principal residence") property is exempt from a portion of school operating millage, so the total millage differs between an owner-occupied home and the identical house next door held as a rental.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'township',
    'school',
    'community_college',
    'library',
    'special_district',
  ],
  marketValueTerm: 'True cash value (market value)',
  cappedValueTerm: 'Taxable value (Proposal A capped)',
  taxableValueTerm: 'Taxable value',
  capGapTerm: 'The SEV-to-taxable-value gap',
  parcelIdTerm: 'Parcel number (city or township format)',
  caps: [
    {
      id: 'mi-proposal-a',
      name: 'Proposal A taxable value cap (MCL 211.27a)',
      annualLimitPercent: 5,
      tiedToInflation: true,
      resetsOnSale: true,
      portable: false,
      expiresIso: null,
      summary:
        'Taxable value is the lesser of (a) the prior year\'s taxable value less losses, multiplied by the lesser of 1.05 or the inflation rate multiplier, plus additions, and (b) the current State Equalized Value. In practice inflation binds, not the 5%. The year after a transfer of ownership the cap is removed and taxable value "uncaps" to full SEV — which is why a buyer\'s bill can jump sharply in year two, not year one, and catches people who budgeted from the seller\'s figures.',
      url: 'https://www.michigan.gov/taxes/property',
    },
  ],
  homesteadExemptions: [
    {
      id: 'mi-principal-residence-exemption',
      name: 'Principal Residence Exemption (PRE)',
      amountUsd: null,
      percentOfValue: null,
      appliesToSchoolLevies: true,
      appliesToNonSchoolLevies: false,
      deliveryMethod: 'reduces_tax_due',
      applicationDeadline: null,
      summary:
        'Exempts an owner-occupied principal residence from a portion of the local school district operating millage. It removes a levy rather than reducing value, so it shows up as a lower total millage on the bill rather than as a smaller assessment.',
      url: 'https://www.michigan.gov/taxes/property/principal-residence-exemption',
    },
  ],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'You must first protest to your local Board of Review, which sits in March — organising on the Tuesday after the first Monday and meeting from the second Monday in March. Appearing before the Board of Review is mandatory before the Michigan Tax Tribunal will hear a residential appeal, so missing the March window forfeits the year entirely. Exact sitting times are published by your city or township.',
  },
  appealBodyName: 'Local Board of Review — then the Michigan Tax Tribunal',
  appealBodyUrl: 'https://www.michigan.gov/taxtrib',
  revaluationCycleYears: 1,
  revaluationNote:
    'Assessors must value annually; the assessment change notice arrives in February ahead of the March Board of Review.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Assessment, Taxable Valuation and Property Classification',
    'Summer Property Tax Bill',
    'Winter Property Tax Bill',
    'Principal Residence Exemption Affidavit (Form 2368)',
    'Property Transfer Affidavit (Form L-4260)',
    'Board of Review decision',
    'Michigan Tax Tribunal decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [
    'The rule that assessed value equals 50% of true cash value is cited to Michigan Constitution Article IX §3 but was not independently fetched for this build. It is encoded because every Michigan assessment notice is built on it, but it should be re-verified before it drives a calculation.',
  ],
  notes:
    'Michigan sends two bills in the same calendar year from the same treasurer: a summer bill due July 1 that accrues interest after September 14, and a winter bill due December 1 that takes a penalty after February 14. Treating them as two years of tax doubles the annual figure. The notice shows three different numbers — true cash value, SEV and taxable value — and only the last one is multiplied by the millage. Note that michigan.gov sits behind an edge WAF that returns "Access Denied" to plain HTTP clients; these links are live in a browser and a link checker reporting them dead is wrong.',
  sourceUrl: 'https://www.michigan.gov/taxes/property',
};

const NJ_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'NJ',
  regionName: 'New Jersey',
  assessingJurisdictionType: 'municipal',
  assessingBodyLabel: 'Municipal assessor, supervised by the County Board of Taxation',
  stateAgencyName: 'NJ Division of Taxation — Local Property Tax',
  stateAgencyUrl: 'https://www.nj.gov/treasury/taxation/lpt/localtax.shtml',
  stateRole:
    'The Division of Taxation sets standards and administers state relief programs. Each of the 564 municipalities has its own assessor, and the county board of taxation equalizes and hears appeals.',
  assessmentRatioPercent: null,
  ratioNote:
    'Each municipality assesses at its own ratio to true value, and the state publishes an average ratio (the "Chapter 123" or Director\'s ratio) per municipality per year to make appeals workable. A New Jersey assessed value is therefore not a market value and is not comparable across town lines.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_100',
  rateBasisNote:
    'New Jersey quotes the General Tax Rate as dollars per $100 of assessed value. Rates above 2.0 are common — reading one as mills understates the bill tenfold.',
  typicalDistrictClasses: ['county', 'municipal', 'school', 'fire', 'library', 'special_district'],
  marketValueTerm: 'True value (market value)',
  cappedValueTerm: 'Assessed value',
  taxableValueTerm: 'Net taxable value',
  capGapTerm: null,
  parcelIdTerm: 'Block and Lot (with Qualifier where applicable)',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'fixed',
    month: 4,
    day: 1,
    note: 'An appeal to the County Board of Taxation is due April 1, or May 1 in a municipality that has implemented a revaluation or reassessment for that year. Because a revaluation moves the date, confirm which applies to your town before relying on April 1.',
  },
  appealBodyName: 'County Board of Taxation — then the NJ Tax Court',
  appealBodyUrl: 'https://www.nj.gov/treasury/taxation/lpt/localtax.shtml',
  revaluationCycleYears: null,
  revaluationNote:
    'Revaluations are ordered municipality by municipality rather than on a statewide cycle, and a revaluation year shifts the appeal deadline to May 1.',
  fiscalYearStartMonth: 1,
  billingTiming: 'advance_estimated',
  installmentsPerYear: 4,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Assessment (postcard)',
    'Quarterly Property Tax Bill',
    'Estimated Tax Bill',
    'County Board of Taxation judgment',
    'Tax Court of New Jersey judgment',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'New Jersey bills quarterly, due February 1, May 1, August 1 and November 1. The first two quarters are *estimated* from the prior year\'s value and rate because the current year\'s rate is not struck until mid-year; the third quarter reconciles the whole year, so the August bill is routinely much larger or smaller than the two before it. Treating Q1 as one quarter of the annual bill is wrong.',
  sourceUrl: 'https://www.nj.gov/treasury/taxation/lpt/localtax.shtml',
};

const VA_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'VA',
  regionName: 'Virginia',
  assessingJurisdictionType: 'county',
  assessingBodyLabel:
    'County or independent city — locally elected Commissioner of the Revenue, or an appointed assessor in the larger localities',
  stateAgencyName: 'Virginia Department of Taxation — Local Tax',
  stateAgencyUrl: 'https://www.tax.virginia.gov/localities',
  stateRole:
    'The Department of Taxation assists localities and administers state taxes. Real estate assessment and billing are entirely local; the state does not value homes.',
  assessmentRatioPercent: 100,
  ratioNote:
    'Virginia assesses at 100% of fair market value. The variation is in how often localities reassess, not in the ratio.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_100',
  rateBasisNote:
    'Virginia quotes rates as dollars per $100 of assessed value. A rate of 1.11 is 1.11%, not 1.11 mills.',
  typicalDistrictClasses: ['county', 'municipal', 'special_district'],
  marketValueTerm: 'Fair market value',
  cappedValueTerm: 'Assessed value',
  taxableValueTerm: 'Assessed value',
  capGapTerm: null,
  parcelIdTerm: 'Parcel ID / GPIN / Map reference (format varies by locality)',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'Each locality runs its own administrative review with the assessor followed by an appeal to the local Board of Equalization, and publishes its own deadlines on the reassessment notice. Virginia\'s independent cities are not part of any county, so "look it up with the county" is wrong advice for roughly forty of them.',
  },
  appealBodyName: 'Local Board of Equalization — then the Circuit Court',
  appealBodyUrl: 'https://www.tax.virginia.gov/localities',
  revaluationCycleYears: null,
  revaluationNote:
    'Reassessment frequency is set locally — annually in most of Northern Virginia, every two to six years elsewhere.',
  fiscalYearStartMonth: 7,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Reassessment',
    'Real Estate Tax Bill',
    'Board of Equalization decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'Virginia has 38 independent cities that are not inside any county — a Richmond or Alexandria address must be resolved to the city, not to a surrounding county, or the lookup finds nothing. Most localities bill twice a year on a July fiscal year, but both the schedule and the number of instalments are set locally.',
  sourceUrl: 'https://www.tax.virginia.gov/localities',
};

const MD_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'MD',
  regionName: 'Maryland',
  // The exception that justifies `AssessingJurisdictionType` having a 'state'
  // member at all: a US property model that assumes a county assessor exists
  // has nowhere to put Maryland.
  assessingJurisdictionType: 'state',
  assessingBodyLabel:
    'Maryland State Department of Assessments and Taxation (SDAT), through 24 local state assessment offices',
  stateAgencyName: 'Maryland State Department of Assessments and Taxation (SDAT)',
  stateAgencyUrl: 'https://dat.maryland.gov/realproperty/Pages/default.aspx',
  stateRole:
    'SDAT itself assesses all of Maryland\'s roughly two million property accounts through 24 local offices — one per county plus Baltimore City. **There is no county assessor to contact.** Counties and municipalities set rates and collect; they do not value.',
  assessmentRatioPercent: 100,
  ratioNote:
    'Maryland assesses at 100% of fair market value. Any increase found at a triennial reassessment is phased in over the three years of the cycle, so the assessed value on a bill can sit below the full new value without a cap being involved.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_100',
  rateBasisNote:
    'Maryland quotes rates as dollars per $100 of assessed value, and a homeowner pays both a state rate and a county (and sometimes municipal) rate.',
  typicalDistrictClasses: ['state', 'county', 'municipal', 'special_district'],
  marketValueTerm: 'Full cash value (market value)',
  cappedValueTerm: 'Phased-in assessed value',
  taxableValueTerm: 'Assessed value less credits',
  capGapTerm: 'Phase-in difference',
  parcelIdTerm: 'Account number (District – Subdistrict – Account identifier)',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'days-from-notice',
    days: 45,
    note: 'An appeal is due 45 days from the date on the Notice of Assessment. Because only one third of the state is reassessed each year, most owners receive no notice in a given year — and that is the normal case, not a lost letter.',
  },
  appealBodyName:
    'SDAT supervisor of assessments — then the Property Tax Assessment Appeal Board and the Maryland Tax Court',
  appealBodyUrl: 'https://dat.maryland.gov/realproperty/Pages/default.aspx',
  revaluationCycleYears: 3,
  revaluationNote:
    'Every property is reassessed once every three years; the state is divided into three groups and one group is reassessed each year. Any increase is phased in equally over the three years.',
  fiscalYearStartMonth: 7,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Assessment',
    'Real Property Tax Bill',
    'Homestead Tax Credit application',
    'Homeowners\' Property Tax Credit application',
    'Property Tax Assessment Appeal Board decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'Maryland is one of only two states in this registry where the state itself does the assessing — sending a Maryland homeowner to "the county assessor" sends them to an office that does not exist. Bills run on a July 1 fiscal year and are issued by the county or municipal finance office using SDAT\'s values.',
  sourceUrl: 'https://dat.maryland.gov/realproperty/Pages/default.aspx',
};

const MT_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'MT',
  regionName: 'Montana',
  assessingJurisdictionType: 'state',
  assessingBodyLabel: 'Montana Department of Revenue — Property Assessment Division',
  stateAgencyName: 'Montana Department of Revenue — Property Assessment Division',
  stateAgencyUrl: 'https://revenue.mt.gov/property/',
  stateRole:
    'The Department of Revenue values all taxable property in the state. Counties apply the department\'s values to calculate, bill and collect tax — they do not assess.',
  assessmentRatioPercent: 100,
  ratioNote:
    'The Department of Revenue values property at 100% of market value. Montana then applies statutory tax rates by property class to reach taxable value, so the number the mills are applied to is a small fraction of market value — do not read Montana\'s taxable value as an assessment ratio of the kind other states use.',
  subStateRatios: [],
  districtClassRatios: [],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Montana quotes mills against taxable value, which is itself a statutory percentage of market value by class. Two multiplications, not one.',
  typicalDistrictClasses: ['state', 'county', 'municipal', 'school', 'fire', 'special_district'],
  marketValueTerm: 'Market value',
  cappedValueTerm: 'Assessed value',
  taxableValueTerm: 'Taxable value (market value × the statutory class tax rate)',
  capGapTerm: null,
  parcelIdTerm: 'Geocode / Assessor code',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'days-from-notice',
    days: 30,
    note: 'A Request for Informal Review (Form AB-26) is due within 30 days of the date on the Classification and Appraisal Notice; an appeal to the county tax appeal board follows from the department\'s determination.',
  },
  appealBodyName: 'County Tax Appeal Board — then the Montana Tax Appeal Board',
  appealBodyUrl: 'https://revenue.mt.gov/property/',
  revaluationCycleYears: 2,
  revaluationNote:
    'Residential property is reappraised on a two-year cycle, so values step rather than drift.',
  fiscalYearStartMonth: 7,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Classification and Appraisal Notice',
    'Property Tax Bill',
    'Request for Informal Review (Form AB-26)',
    'County Tax Appeal Board decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'The second of the two state-assessed states here. Note that the older mtrevenue.gov domain 301-redirects to revenue.mt.gov — a stored link to the old host still works but should be updated.',
  sourceUrl: 'https://revenue.mt.gov/property/',
};

/**
 * Colorado is not one of the fourteen seeded states — it is here because it is
 * the clearest single proof that an assessment ratio belongs to a taxing
 * district class rather than to a property.
 *
 * In the same year, on the same bill, the same house is assessed at 7.05% for
 * school district levies and 6.80% for local-government levies. There is no
 * "Colorado assessment ratio" to store in one number, and any schema that
 * offers only one is wrong about part of every Colorado bill.
 */
const CO_STATE: UsStateJurisdiction = {
  countryCode: 'US',
  regionCode: 'CO',
  regionName: 'Colorado',
  assessingJurisdictionType: 'county',
  assessingBodyLabel: 'County Assessor',
  stateAgencyName: 'Colorado Division of Property Taxation',
  stateAgencyUrl: 'https://dpt.colorado.gov/residential-school-assessment-rate',
  stateRole:
    'The Division of Property Taxation publishes the assessment rates and administers the state Board of Assessment Appeals. County assessors value property.',
  assessmentRatioPercent: null,
  ratioNote:
    'Deliberately null: Colorado has two residential assessment rates in force at once for the 2026 tax year — 7.05% for school district levies and 6.80% for local-government levies, the latter after a 10% reduction of the first $700,000 of actual value. Picking either one as "the" Colorado ratio miscalculates the other half of the bill. Use `districtClassRatios`.',
  subStateRatios: [],
  districtClassRatios: [
    {
      districtClasses: ['school'],
      label: 'Residential — school district levies',
      assessmentRatioPercent: 7.05,
      actualValueReductionPercent: null,
      actualValueReductionCapUsd: null,
      note: 'The residential school assessment rate for the 2026 tax year, published by the Division of Property Taxation. Any value reduction applying on the school side was not part of the verified figures for this build and is not encoded.',
    },
    {
      districtClasses: ['county', 'municipal', 'fire', 'library', 'park', 'water', 'hospital', 'special_district'],
      label: 'Residential — local government levies',
      assessmentRatioPercent: 6.8,
      actualValueReductionPercent: 10,
      actualValueReductionCapUsd: 700000,
      note: 'The residential local-government rate for the 2026 tax year, applied after reducing actual value by 10% of the first $700,000. The reduction is capped in dollars, so it is not expressible as a smaller flat rate.',
    },
  ],
  rateBasis: 'per_1000',
  rateBasisNote:
    'Colorado quotes mills against assessed value — and because assessed value is under 7% of actual value, a Colorado mill levy of 80 or 100 is normal rather than extraordinary.',
  typicalDistrictClasses: [
    'county',
    'municipal',
    'school',
    'fire',
    'library',
    'park',
    'water',
    'hospital',
    'special_district',
  ],
  marketValueTerm: 'Actual value',
  cappedValueTerm: 'Actual value after any statutory value reduction',
  taxableValueTerm: 'Assessed value (differs per district class)',
  capGapTerm: null,
  parcelIdTerm: 'Schedule or Parcel number',
  caps: [],
  homesteadExemptions: [],
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'A protest is filed with the county assessor after the Notice of Valuation is mailed in spring; the county publishes the closing date on the notice. A further appeal runs to the county Board of Equalization and then the state Board of Assessment Appeals.',
  },
  appealBodyName: 'County Board of Equalization — then the Board of Assessment Appeals',
  appealBodyUrl: 'https://dpt.colorado.gov/',
  revaluationCycleYears: 2,
  revaluationNote: 'Colorado reappraises on a two-year cycle in odd-numbered years.',
  fiscalYearStartMonth: 1,
  billingTiming: 'arrears',
  installmentsPerYear: 2,
  installmentDueDatesVolatile: false,
  documentTypes: [
    'Notice of Valuation',
    'Property Tax Statement',
    'Notice of Determination',
    'Board of Equalization decision',
    'Information-only tax statement (escrowed)',
  ],
  unverifiedFacts: [],
  notes:
    'Colorado is included as the documented special case for split assessment rates rather than as a fully modelled state. Its residential rates have been changed repeatedly by legislation since Gallagher was repealed, so re-check `sourceUrl` before quoting a rate for any tax year other than 2026.',
  sourceUrl: 'https://dpt.colorado.gov/residential-school-assessment-rate',
};

/**
 * Every seeded US state, keyed `"US-<state>"`.
 *
 * Keyed the same way as the Canadian registry so that `('CA', 'BC')` cannot
 * accidentally hit a US entry and `('US', 'CA')` cannot hit a Canadian one —
 * `CA` is both California and Canada, and a country-blind lookup on the region
 * code alone would silently hand a Vancouver household California's Prop 13.
 */
export const US_STATE_JURISDICTIONS: Readonly<Record<string, UsStateJurisdiction>> = Object.freeze({
  'US-CA': CA_STATE,
  'US-TX': TX_STATE,
  'US-FL': FL_STATE,
  'US-NY': NY_STATE,
  'US-IL': IL_STATE,
  'US-PA': PA_STATE,
  'US-OH': OH_STATE,
  'US-GA': GA_STATE,
  'US-NC': NC_STATE,
  'US-MI': MI_STATE,
  'US-NJ': NJ_STATE,
  'US-VA': VA_STATE,
  'US-MD': MD_STATE,
  'US-MT': MT_STATE,
  'US-CO': CO_STATE,
});

// ---------------------------------------------------------------------------
// County lookups
// ---------------------------------------------------------------------------

/**
 * Where a homeowner looks up their own parcel, per county.
 *
 * **There is no national property lookup, and there is no URL naming pattern.**
 * Every entry below was found and confirmed by hand. Nothing here is derivable:
 * assessor and collector are frequently different agencies on different
 * domains; some counties (Cook) run one joint portal for both; New York City
 * has no county assessor at all and the Department of Finance covers all five
 * boroughs; some hosts sit behind a WAF or serve an incomplete TLS chain and
 * cannot be probed automatically. Do **not** write code that synthesises a
 * county URL from a county name or a FIPS code — it will produce plausible
 * links that 404, and a homeowner following a dead link to appeal a value can
 * miss a statutory deadline. Add counties by hand, verified, or not at all.
 */
export interface UsCountyLookup {
  /**
   * Five-digit county FIPS code, stored as a **string**. The leading zero is
   * load-bearing: Maricopa is "04013", and `Number("04013")` is 4013 — which
   * formats back as a four-digit code that matches no county and silently
   * breaks every lookup in the states whose FIPS codes begin with a zero
   * (Arizona, Alabama, Alaska, Arkansas, California, Colorado, Connecticut,
   * Delaware, DC, Florida and Georgia — a third of the country).
   */
  fips: string;
  countyName: string;
  /** Two-letter state code. Need not have a seeded `UsStateJurisdiction`. */
  stateCode: string;
  /** Who values the property here. */
  assessorAgency: string;
  assessorUrl: string;
  /** Who bills and collects here — frequently a different office entirely. */
  taxAgency: string;
  taxUrl: string;
  /** What this county calls the parcel identifier on its own forms. */
  parcelIdLabel: string;
  note?: string;
}

const COUNTY_LOOKUPS: ReadonlyArray<UsCountyLookup> = Object.freeze([
  {
    fips: '06037',
    countyName: 'Los Angeles',
    stateCode: 'CA',
    assessorAgency: 'Los Angeles County Office of the Assessor',
    assessorUrl: 'https://portal.assessor.lacounty.gov/',
    taxAgency: 'Los Angeles County Treasurer and Tax Collector',
    taxUrl: 'https://vcheck.ttc.lacounty.gov/',
    parcelIdLabel: 'AIN',
    note: 'Los Angeles calls the parcel identifier an Assessor Identification Number (AIN) rather than an APN, and does not mail a notice of value to every owner — which is why its appeal window closes November 30 rather than September 15.',
  },
  {
    fips: '17031',
    countyName: 'Cook',
    stateCode: 'IL',
    assessorAgency: 'Cook County Assessor (via the joint Cook County Property Info portal)',
    assessorUrl: 'https://www.cookcountypropertyinfo.com/',
    taxAgency: 'Cook County Treasurer (via the joint Cook County Property Info portal)',
    taxUrl: 'https://www.cookcountypropertyinfo.com/',
    parcelIdLabel: 'PIN',
    note: 'Both roles point at the one joint portal on purpose: the Assessor\'s own site sits behind a WAF that blocks automated access, and the Treasurer\'s site serves an incomplete TLS chain that some clients reject. The joint portal is the reliable entry point for both value and balance.',
  },
  {
    fips: '48201',
    countyName: 'Harris',
    stateCode: 'TX',
    assessorAgency: 'Harris Central Appraisal District (HCAD)',
    assessorUrl: 'https://hcad.org/quicksearch/',
    taxAgency: 'Harris County Tax Assessor-Collector',
    taxUrl: 'https://www.hctax.net/Property/PropertyTax',
    parcelIdLabel: 'Account Number',
    note: 'The clearest example of the Texas split: HCAD sets the value and hears the protest, the county tax assessor-collector only bills. They are separate organisations with separate account searches.',
  },
  {
    fips: '04013',
    countyName: 'Maricopa',
    stateCode: 'AZ',
    assessorAgency: 'Maricopa County Assessor',
    assessorUrl: 'https://mcassessor.maricopa.gov/',
    taxAgency: 'Maricopa County Treasurer',
    taxUrl: 'https://treasurer.maricopa.gov/Parcel',
    parcelIdLabel: 'Parcel Number',
    note: 'FIPS "04013" — the leading zero is why this field is a string. Arizona is also not a seeded state here, which is deliberate: a county lookup is useful on its own and does not require the state to be modelled.',
  },
  {
    fips: '06073',
    countyName: 'San Diego',
    stateCode: 'CA',
    assessorAgency: 'San Diego County Assessor/Recorder/County Clerk',
    assessorUrl:
      'https://www.sdarcc.gov/content/arcc/home/divisions/assessor/secured-assessment-roll-search.html',
    taxAgency: 'San Diego County Treasurer-Tax Collector',
    taxUrl: 'https://wps.sdttc.com/WebPayments/CoSDTreasurer2/search',
    parcelIdLabel: 'APN',
    note: 'One of the California counties that does not mail a notice of value to every owner, so the appeal window closes November 30.',
  },
  {
    fips: '06059',
    countyName: 'Orange',
    stateCode: 'CA',
    assessorAgency: 'Orange County Assessor',
    assessorUrl: 'https://assessedvalue.ocassessor.gov/',
    taxAgency: 'Orange County Treasurer-Tax Collector',
    taxUrl: 'https://taxbill.octreasurer.gov/',
    parcelIdLabel: 'APN',
    note: 'Appeal window closes November 30 rather than September 15.',
  },
  {
    fips: '12086',
    countyName: 'Miami-Dade',
    stateCode: 'FL',
    assessorAgency: 'Miami-Dade County Property Appraiser',
    assessorUrl: 'https://apps.miamidadepa.gov/propertysearch/',
    taxAgency: 'Miami-Dade County Tax Collector',
    taxUrl: 'https://mdctaxcollector.gov/',
    parcelIdLabel: 'Folio Number',
    note: 'Miami-Dade calls the parcel ID a Folio Number. As everywhere in Florida, the property appraiser assesses and the tax collector bills.',
  },
  {
    fips: '48113',
    countyName: 'Dallas',
    stateCode: 'TX',
    assessorAgency: 'Dallas Central Appraisal District (DCAD)',
    assessorUrl: 'https://www.dallascad.org/SearchAddr.aspx',
    taxAgency: 'Dallas County Tax Office',
    taxUrl: 'https://www.dallascounty.org/departments/tax/property-tax.php',
    parcelIdLabel: 'Account Number',
  },
  {
    fips: '36047',
    countyName: 'Kings',
    stateCode: 'NY',
    assessorAgency: 'New York City Department of Finance',
    assessorUrl: 'https://propertyinformationportal.nyc.gov/',
    taxAgency: 'New York City Department of Finance',
    taxUrl: 'https://a836-pts-access.nyc.gov/care/',
    parcelIdLabel: 'BBL',
    note: 'There is no Kings County assessor. The NYC Department of Finance assesses and bills all five boroughs, and the parcel identifier is the Borough-Block-Lot (BBL), not a county roll number. The same two URLs serve Bronx, New York, Queens and Richmond counties.',
  },
  {
    fips: '06065',
    countyName: 'Riverside',
    stateCode: 'CA',
    assessorAgency: 'Riverside County Assessor-County Clerk-Recorder',
    assessorUrl: 'https://rivcoview.rivcoacr.org/',
    taxAgency: 'Riverside County Treasurer-Tax Collector',
    taxUrl: 'https://ca-riverside-ttc.publicaccessnow.com/PropertySearch.aspx',
    parcelIdLabel: 'APN',
    note: 'Appeal window closes November 30 rather than September 15.',
  },
]);

/** Every seeded county lookup, keyed by five-digit FIPS string. */
export const US_COUNTY_LOOKUPS: Readonly<Record<string, UsCountyLookup>> = Object.freeze(
  COUNTY_LOOKUPS.reduce<Record<string, UsCountyLookup>>((acc, county) => {
    acc[county.fips] = county;
    return acc;
  }, {}),
);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Build the registry key for a country/state pair. */
export function usJurisdictionKey(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined,
): string | null {
  if (!countryCode || !regionCode) return null;
  return `${countryCode.trim().toUpperCase()}-${regionCode.trim().toUpperCase()}`;
}

/**
 * Resolve the US jurisdiction for a household's country + state.
 *
 * The country code is required, not optional, precisely because `CA` is
 * ambiguous: `('US', 'CA')` is California and `('CA', 'BC')` is Canada. A
 * lookup that took only the region code would resolve a British Columbia
 * household against the US registry the moment someone added a `BC` entry, and
 * would resolve Canada itself if the key were ever normalised to the country.
 * Returns null for anything not seeded — callers must fall back to generic copy
 * rather than showing another state's rules.
 */
export function resolveUsJurisdiction(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined,
): UsStateJurisdiction | null {
  const key = usJurisdictionKey(countryCode, regionCode);
  if (!key) return null;
  return US_STATE_JURISDICTIONS[key] ?? null;
}

/** Every seeded US state, ordered by state name. */
export function allUsStateJurisdictions(): UsStateJurisdiction[] {
  return Object.values(US_STATE_JURISDICTIONS).sort((a, b) =>
    a.regionName.localeCompare(b.regionName),
  );
}

/**
 * The assessing jurisdictions we can point at inside one state — which in the
 * US means counties, not the state itself. Ordered by county name.
 *
 * Returns an empty array for a state with no seeded counties, which is the
 * common case: the county list is hand-verified and deliberately short. An
 * empty result means "we have no verified lookup", never "this state has no
 * counties", and the caller must not synthesise one.
 */
export function usJurisdictionsForState(stateCode: string | null | undefined): UsCountyLookup[] {
  if (!stateCode) return [];
  const code = stateCode.trim().toUpperCase();
  return COUNTY_LOOKUPS.filter(c => c.stateCode === code).sort((a, b) =>
    a.countyName.localeCompare(b.countyName),
  );
}

/**
 * Normalise a FIPS code to the canonical five-character string.
 *
 * Accepts a number as well as a string because that is exactly how the leading
 * zero gets lost — a JSON round-trip, a spreadsheet import or a `parseInt` in a
 * caller turns "04013" into 4013. Padding it back is cheap; failing the lookup
 * silently is not. Returns null for anything that is not a plausible FIPS code
 * rather than padding arbitrary junk into a five-character key.
 */
export function normalizeUsFips(fips: string | number | null | undefined): string | null {
  if (fips === null || fips === undefined) return null;
  const raw = typeof fips === 'number' ? String(fips) : fips.trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  return raw.padStart(5, '0');
}

/**
 * Resolve a county lookup by FIPS code. Tolerates a lost leading zero (see
 * `normalizeUsFips`) and returns null when we have no verified entry — there is
 * no national lookup to fall back to and no URL to guess.
 */
export function resolveUsCountyLookup(
  fips: string | number | null | undefined,
): UsCountyLookup | null {
  const key = normalizeUsFips(fips);
  if (!key) return null;
  return US_COUNTY_LOOKUPS[key] ?? null;
}

/**
 * The assessment ratio that applies to one class of taxing district.
 *
 * This function is the reason `taxableValueCents` from the Canadian registry
 * cannot simply be reused: in Canada the ratio is a property of the province,
 * so one number answers the question. In Colorado the answer depends on which
 * district is levying, and asking without naming the district class is asking
 * an ill-formed question. Returns null where the state has no single ratio and
 * no ratio for the class given — the caller must show `ratioNote`, not guess.
 */
export function usAssessmentRatioPercent(
  jurisdiction: UsStateJurisdiction | null | undefined,
  districtClass?: UsDistrictClass | null,
): number | null {
  if (!jurisdiction) return null;
  if (districtClass) {
    const match = jurisdiction.districtClassRatios.find(r =>
      r.districtClasses.includes(districtClass),
    );
    if (match) return match.assessmentRatioPercent;
  }
  return jurisdiction.assessmentRatioPercent;
}

/**
 * Convert a market value to the value one district class actually taxes.
 * Cents in, cents out.
 *
 * Applies any district-class value reduction first (Colorado's 10% of the first
 * $700,000 of actual value) and then the ratio, because the two compose in that
 * order and reversing them changes the answer. Returns null where the ratio is
 * unknown — an unknown ratio must surface as "we cannot compute this", never as
 * a value that silently assumed 100%.
 */
export function usTaxableValueCents(
  marketValueCents: number,
  jurisdiction: UsStateJurisdiction | null | undefined,
  districtClass?: UsDistrictClass | null,
): number | null {
  if (!jurisdiction) return null;

  const classRatio = districtClass
    ? jurisdiction.districtClassRatios.find(r => r.districtClasses.includes(districtClass))
    : undefined;

  const ratio = classRatio?.assessmentRatioPercent ?? jurisdiction.assessmentRatioPercent;
  if (ratio === null || ratio === undefined) return null;

  let base = marketValueCents;
  if (classRatio?.actualValueReductionPercent) {
    const capCents =
      classRatio.actualValueReductionCapUsd === null
        ? base
        : classRatio.actualValueReductionCapUsd * 100;
    const reducible = Math.min(base, capCents);
    base -= Math.round((reducible * classRatio.actualValueReductionPercent) / 100);
  }

  return Math.round((base * ratio) / 100);
}
