/**
 * Property assessment & tax jurisdictions.
 *
 * One source of truth, shared by the mobile app and the Worker, for "how does
 * property assessment work where this household actually is". The household
 * address already carries `country` + `state_province` + `city`, so the correct
 * jurisdiction is a lookup, never a guess.
 *
 * Why this exists: the feature was built for Greater Vancouver and hardcoded BC
 * rules everywhere — a fixed January 31 appeal deadline, a 100% assessment
 * ratio, the BC Home Owner Grant, a bcassessment.ca link. None of that is true
 * outside BC:
 *
 *   - Saskatchewan taxes 80% of value; Manitoba taxes 45% ("portioned
 *     assessment"). Storing only the assessed value overstates Manitoba tax by
 *     more than 2x.
 *   - Alberta's appeal deadline is *notice date + 60 days*, not a calendar date.
 *   - Saskatchewan's base date is frozen for four years; Ontario's has been
 *     frozen since 2016. A "% change vs last year" of 0 is correct there, not a
 *     bug.
 *   - Alberta and Saskatchewan have no homeowner grant at all.
 *   - Quebec's documents are in French, and school tax is billed separately by
 *     the centre de services scolaire.
 *
 * Every figure below was verified against the authority's own site in Aug 2026;
 * `sourceUrl` on each jurisdiction points at what to re-check. Dollar amounts on
 * relief programs change yearly — treat them as display hints, never as the
 * basis for a calculation the user relies on.
 */

/** Countries where the property surface is available. */
export type PropertyCountryCode = 'CA' | 'US';

/** How a jurisdiction's appeal window is expressed. */
export type AppealDeadlineRule =
  /** A fixed calendar date every year, e.g. BC's January 31. */
  | { kind: 'fixed'; month: number; day: number; note?: string }
  /** N days from the notice-of-assessment date printed on the notice. */
  | { kind: 'days-from-notice'; days: number; note?: string }
  /**
   * The *later* of a fixed calendar date and N days from the notice — a shape
   * that only appears in the US, where a late-mailed notice must not shorten
   * the protest window below the statutory minimum. Texas is "May 15 or 30 days
   * after the notice, whichever is later"; Washington is "July 1 or 30 days".
   *
   * Modelling this as plain `fixed` would silently tell a Texan whose notice
   * arrived on June 1 that their deadline passed two weeks ago; modelling it as
   * plain `days-from-notice` would move an April notice's deadline forward to
   * May 1 and cost them two weeks they actually have.
   */
  | {
      kind: 'fixed-or-days-from-notice';
      month: number;
      day: number;
      days: number;
      note?: string;
    }
  /** Set per municipality and printed on the notice — we cannot derive it. */
  | { kind: 'printed-on-notice'; note: string };

/** A relief program a homeowner may be entitled to. */
export interface PropertyReliefProgram {
  id: string;
  name: string;
  kind: 'grant' | 'credit' | 'rebate' | 'deferral';
  /** One sentence a homeowner would understand. */
  summary: string;
  /** Official application/info page. */
  url: string;
  /**
   * How the homeowner receives it. `on-bill` programs need no action and must
   * not generate a "you may be missing this" nudge; `apply` programs should.
   */
  applyMode: 'on-bill' | 'apply' | 'income-tax-return';
}

/** Everything that varies by province/territory (and, later, by US state). */
export interface PropertyJurisdiction {
  countryCode: PropertyCountryCode;
  /** Province/territory code as stored in `households.state_province`. */
  regionCode: string;
  regionName: string;

  /** Who produces the assessment, e.g. "BC Assessment", "MPAC". */
  authorityName: string;
  authorityUrl: string;
  /** Where a homeowner looks up their own property. Null where none exists. */
  lookupUrl: string | null;
  /** What the user needs in hand to use `lookupUrl`, if anything. */
  lookupHint: string | null;

  /** False where each municipality assesses its own properties (AB, and QC). */
  centralized: boolean;
  /** Years between general reassessments. 1 = annual. */
  cycleYears: number;
  /** Human-readable valuation-date rule shown next to a value. */
  valuationDateRule: string;
  /** Month (1-12) notices are typically mailed, or null where it varies. */
  noticeMonth: number | null;

  appealDeadline: AppealDeadlineRule;
  appealBodyName: string;
  appealBodyUrl: string | null;

  /**
   * Percent of assessed value that is actually taxed. 100 in most provinces;
   * 80 in Saskatchewan, 45 in Manitoba. Tax math must use this.
   */
  assessmentRatioPercent: number;
  /** What the taxed value is called when the ratio is not 100. */
  taxableValueTerm: string | null;
  /** What the notice calls the value, e.g. "Current Value Assessment". */
  assessedValueTerm: string;
  /** What the notice calls the property's id, e.g. "Roll number". */
  parcelIdTerm: string;

  reliefPrograms: PropertyReliefProgram[];
  /** Real document titles a homeowner might upload here. */
  documentTypes: string[];
  /** Languages the documents appear in. Drives extraction prompt selection. */
  languages: ReadonlyArray<'en' | 'fr'>;
  /** Anything that changes how a value should be read or displayed. */
  notes: string | null;
  /** Page to re-verify these figures against. */
  sourceUrl: string;
}

const BC: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'BC',
  regionName: 'British Columbia',
  authorityName: 'BC Assessment',
  authorityUrl: 'https://www.bcassessment.ca/',
  lookupUrl: 'https://www.bcassessment.ca/Property/AssessmentSearch',
  lookupHint: 'Search free by address, roll number or PID — no login needed.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule:
    'Market value as of July 1 of the previous year, in the physical condition it was in on October 31.',
  noticeMonth: 1,
  appealDeadline: {
    kind: 'fixed',
    month: 1,
    day: 31,
    note: 'Notice of Complaint to the Property Assessment Review Panel. Moves to the next business day when it falls on a weekend. A further appeal to the Property Assessment Appeal Board is due April 30 and cannot be extended.',
  },
  appealBodyName: 'Property Assessment Review Panel',
  appealBodyUrl: 'https://www.assessmentappeal.bc.ca/',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Jurisdiction number + roll number',
  reliefPrograms: [
    {
      id: 'bc-hog',
      name: 'Home Owner Grant',
      kind: 'grant',
      summary:
        'Up to $570 in Metro Vancouver, the Capital and Fraser Valley regional districts, or $770 elsewhere. Seniors, veterans and people with disabilities may claim up to $845. Reduced by $5 per $1,000 of assessed value above $2,075,000.',
      url: 'https://www2.gov.bc.ca/gov/content/taxes/property-taxes/annual-property-tax/home-owner-grant',
      applyMode: 'apply',
    },
    {
      id: 'bc-deferment',
      name: 'Property Tax Deferment',
      kind: 'deferral',
      summary:
        'The Province pays your property tax and registers a lien. Open to owners 55+, surviving spouses, people with disabilities, and families with children. Needs at least 25% equity.',
      url: 'https://www2.gov.bc.ca/gov/content/taxes/property-taxes/annual-property-tax/property-tax-deferment-program',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment Notice',
    'Property Tax Notice',
    'Rural Property Tax Notice',
    'Property Assessment Review Panel Decision Notice',
    'Home Owner Grant confirmation',
  ],
  languages: ['en'],
  notes:
    'A roll number is only unique within its jurisdiction — always keep the jurisdiction number with it. BC Assessment never bills; your municipality (or the Province, if rural) does.',
  sourceUrl:
    'https://info.bcassessment.ca/services-and-products/Pages/BC%20Assessment%20-%20Key%20Dates.aspx',
};

const AB: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'AB',
  regionName: 'Alberta',
  authorityName: 'Your municipal assessor',
  authorityUrl: 'https://www.alberta.ca/property-assessment',
  lookupUrl: null,
  lookupHint:
    'Alberta has no province-wide lookup — each municipality runs its own. Calgary uses mytax.calgary.ca (roll number + access code); Edmonton uses myproperty.edmonton.ca.',
  centralized: false,
  cycleYears: 1,
  valuationDateRule:
    'Market value as of July 1 of the previous year, in the condition it was in on December 31.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 60,
    note: 'Sixty days from the notice-of-assessment date printed on your notice — which is not the same as the mailing date. The exact deadline is printed on the notice.',
  },
  appealBodyName: 'Assessment Review Board',
  appealBodyUrl: 'https://www.alberta.ca/municipal-property-assessment-complaints-and-appeals',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Roll number',
  reliefPrograms: [
    {
      id: 'ab-sptd',
      name: 'Seniors Property Tax Deferral',
      kind: 'deferral',
      summary:
        'A low-interest government loan covering your residential property tax, repaid when you sell. Age 65+, at least 25% equity, not income-tested.',
      url: 'https://www.alberta.ca/seniors-property-tax-deferral-program',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment Notice',
    'Combined Assessment and Tax Notice',
    'Property Tax Notice',
    'Supplementary Assessment Notice',
    'Amended Assessment Notice',
  ],
  languages: ['en'],
  notes:
    'Alberta has no homeowner grant. Your bill carries two separate lines — municipal tax and the provincial education property tax. Many smaller municipalities combine the assessment and tax notice into one document.',
  sourceUrl: 'https://www.alberta.ca/municipal-property-assessment',
};

const SK: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'SK',
  regionName: 'Saskatchewan',
  authorityName: 'Saskatchewan Assessment Management Agency (SAMA)',
  authorityUrl: 'https://www.sama.sk.ca/',
  lookupUrl: 'https://www.sama.sk.ca/property-owner-services/assessments-online-samaview',
  lookupHint:
    'SAMAView needs a free account and covers SAMA-serviced municipalities only. Saskatoon, Regina, Prince Albert, North Battleford and Swift Current assess their own and have separate lookups.',
  centralized: false,
  cycleYears: 4,
  valuationDateRule:
    'Base date of January 1, 2023 — held for the 2025 through 2028 tax years. Your value will not change until the 2029 revaluation.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'Thirty days from the day your municipality advertises the assessment roll — sixty days in a revaluation year. The closing date is advertised locally and printed on the notice.',
  },
  appealBodyName: 'Board of Revision',
  appealBodyUrl:
    'https://www.saskatchewan.ca/residents/taxes-and-investments/property-taxes/property-assessment-appeals',
  assessmentRatioPercent: 80,
  taxableValueTerm: 'Taxable assessment',
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Assessment number',
  reliefPrograms: [
    {
      id: 'sk-seniors-deferral',
      name: 'Seniors Education Property Tax Deferral',
      kind: 'deferral',
      summary:
        'A repayable loan covering the education portion of your tax. Age 65+, household income under $70,000, at least 25% equity.',
      url: 'https://www.saskatchewan.ca/residents/taxes-and-investments/property-taxes/seniors-education-property-tax-deferral-program',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Assessment Notice',
    'Property Tax Notice',
    'SAMAView Property Report',
    'Field sheet',
    'Board of Revision decision',
  ],
  languages: ['en'],
  notes:
    'Residential property is taxed on 80% of its assessed value, so a $500,000 home has a $400,000 taxable assessment. Mill rates apply to the taxable assessment, never to the assessed value.',
  sourceUrl: 'https://www.saskatchewan.ca/residents/taxes-and-investments/property-taxes/revaluation',
};

const MB: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'MB',
  regionName: 'Manitoba',
  authorityName: 'Manitoba Property Assessment Services',
  authorityUrl: 'https://www.gov.mb.ca/mao/public/default.aspx',
  lookupUrl: 'https://web22.gov.mb.ca/mao/public/search_select.aspx',
  lookupHint:
    'Manitoba Assessment Online covers everywhere except Winnipeg. Winnipeg has its own search at winnipegassessment.com.',
  centralized: true,
  cycleYears: 2,
  valuationDateRule:
    'Market value as of the reference date — April 1, 2023 for the 2025 and 2026 tax years, April 1, 2025 for 2027 and 2028.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'The deadline is printed on the front of your assessment notice and is set by your municipality around its Board of Revision sitting.',
  },
  appealBodyName: 'Board of Revision',
  appealBodyUrl: 'https://www.gov.mb.ca/mao/public/bor_dates.aspx',
  assessmentRatioPercent: 45,
  taxableValueTerm: 'Portioned assessment',
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Roll number',
  reliefPrograms: [
    {
      id: 'mb-hatc',
      name: 'Homeowners Affordability Tax Credit',
      kind: 'credit',
      summary:
        'Up to $1,600 for the 2026 tax year on your principal residence. Applied straight to your tax bill once you have declared the property as your principal residence.',
      url: 'https://www.gov.mb.ca/finance/tao/hatc.html',
      applyMode: 'on-bill',
    },
    {
      id: 'mb-seniors-school-rebate',
      name: "Seniors' School Tax Rebate",
      kind: 'rebate',
      summary:
        'For homeowners 65+, reduced by 1% of family net income over $40,000.',
      url: 'https://www.gov.mb.ca/finance/tao/sstrebate.html',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment Notice',
    'Residential Preview Letter',
    'Property Tax Statement',
    'Board of Revision decision',
    'TIPP statement',
  ],
  languages: ['en'],
  notes:
    'Residential property is taxed on 45% of its assessed value — the "portioned assessment". Reassessment runs on a two-year cycle, so a new assessment notice does not change the bill you are holding. The Homeowners Affordability Tax Credit is netted off the bill, so the amount owing is less than the tax levied.',
  sourceUrl: 'https://www.gov.mb.ca/mao/public/reassessment/brochure.pdf',
};

const ON: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'ON',
  regionName: 'Ontario',
  authorityName: 'Municipal Property Assessment Corporation (MPAC)',
  authorityUrl: 'https://www.mpac.ca/en',
  lookupUrl: 'https://www.aboutmyproperty.ca/',
  lookupHint:
    'AboutMyProperty needs the roll number and access key printed on your Property Assessment Notice.',
  centralized: true,
  cycleYears: 4,
  valuationDateRule:
    'Values are still based on the January 1, 2016 valuation date. Ontario has postponed its reassessment repeatedly, so your assessed value has not changed in years — that is expected, not an error.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'printed-on-notice',
    note: 'The Request for Reconsideration deadline is printed on your Property Assessment Notice. Because Ontario is between reassessments, most owners have not received a new notice recently.',
  },
  appealBodyName: 'Assessment Review Board',
  appealBodyUrl: 'https://tribunalsontario.ca/arb/',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Current Value Assessment (CVA)',
  parcelIdTerm: 'Roll number + access key',
  reliefPrograms: [
    {
      id: 'on-shptg',
      name: "Senior Homeowners' Property Tax Grant",
      kind: 'grant',
      summary:
        'For low-to-moderate-income homeowners 64+, claimed on your income tax return.',
      url: 'https://www.ontario.ca/page/ontario-senior-homeowners-property-tax-grant',
      applyMode: 'income-tax-return',
    },
    {
      id: 'on-oeptc',
      name: 'Ontario Energy and Property Tax Credit',
      kind: 'credit',
      summary:
        'Helps with property tax and sales tax on energy, paid through the Ontario Trillium Benefit. Claimed on your income tax return.',
      url: 'https://www.ontario.ca/page/ontario-trillium-benefit',
      applyMode: 'income-tax-return',
    },
  ],
  documentTypes: [
    'MPAC Property Assessment Notice',
    'Interim Property Tax Bill',
    'Final Property Tax Bill',
    'Request for Reconsideration decision',
    'Assessment Review Board decision',
  ],
  languages: ['en', 'fr'],
  notes:
    'Ontario bills in two instalments — an interim bill early in the year based on last year, then a final bill once rates are set. Your bill includes a provincial education tax portion.',
  sourceUrl: 'https://www.mpac.ca/en',
};

const QC: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'QC',
  regionName: 'Quebec',
  authorityName: "Votre municipalité — rôle d'évaluation foncière",
  authorityUrl: 'https://www.quebec.ca/habitation-territoire/evaluation-fonciere',
  lookupUrl: 'https://montreal.ca/role-evaluation-fonciere',
  lookupHint:
    "Quebec publishes the rôle d'évaluation per municipality. The link opens Montréal's; elsewhere, search your city's site for «rôle d'évaluation foncière».",
  centralized: false,
  cycleYears: 3,
  valuationDateRule:
    "Market value as of July 1, eighteen months before the rôle takes effect. Each rôle stands for three years.",
  noticeMonth: null,
  appealDeadline: {
    kind: 'fixed',
    month: 4,
    day: 30,
    note: "Demande de révision, due April 30 of the first year the rôle is in force.",
  },
  appealBodyName: 'Tribunal administratif du Québec',
  appealBodyUrl: 'https://www.taq.gouv.qc.ca/',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: "Valeur foncière (valeur au rôle)",
  parcelIdTerm: 'Numéro de matricule',
  reliefPrograms: [
    {
      id: 'qc-solidarity',
      name: 'Crédit d’impôt pour solidarité',
      kind: 'credit',
      summary:
        'The solidarity tax credit includes a housing component, claimed on your Quebec income tax return.',
      url: 'https://www.revenuquebec.ca/en/citizens/tax-credits/solidarity-tax-credit/',
      applyMode: 'income-tax-return',
    },
    {
      id: 'qc-seniors-grant',
      name: 'Grant for seniors to offset a municipal tax increase',
      kind: 'grant',
      summary:
        'For owners 65+ whose assessment rose sharply, claimed on your Quebec income tax return.',
      url: 'https://www.revenuquebec.ca/en/citizens/tax-credits/grant-for-seniors-to-offset-a-municipal-tax-increase/',
      applyMode: 'income-tax-return',
    },
  ],
  documentTypes: [
    "Avis d'évaluation foncière",
    'Compte de taxes municipales',
    'Compte de taxes scolaires',
    "Certificat du rôle d'évaluation",
    'Droit de mutation (welcome tax) notice',
  ],
  languages: ['fr', 'en'],
  notes:
    'Quebec documents are in French. School tax is billed separately by your centre de services scolaire, so it will not appear on the municipal bill. Buying a home also triggers a one-time droit de mutation ("welcome tax").',
  sourceUrl: 'https://montreal.ca/sujets/roles-devaluation-fonciere',
};

const NB: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'NB',
  regionName: 'New Brunswick',
  authorityName: 'Service New Brunswick — Property Assessment Services',
  authorityUrl: 'https://www2.snb.ca/content/snb/en/sites/property-assessment.html',
  lookupUrl: 'https://paol.snb.ca/?lang=en',
  lookupHint:
    'PAOL is free and public — search by civic address, PAN or PID. It shows four prior years of value. Owner-only actions need the access key from your notice.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule:
    'Market value as of January 1 of the year before the tax year.',
  noticeMonth: 1,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 30,
    note: 'Request for Review, due 30 days from the date on your assessment notice.',
  },
  appealBodyName: 'Assessment and Planning Appeal Board',
  appealBodyUrl: 'https://www2.snb.ca/content/snb/en/sites/property-assessment.html',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Property Account Number (PAN)',
  reliefPrograms: [
    {
      id: 'nb-residential-credit',
      name: 'Residential Property Tax Credit',
      kind: 'credit',
      summary:
        'Removes the provincial property tax rate on your principal residence. Applied to your bill once registered.',
      url: 'https://www.gnb.ca/en/topic/family-home-community/housing-property/property-tax.html',
      applyMode: 'on-bill',
    },
    {
      id: 'nb-tax-allowance',
      name: 'Low-Income Property Tax Allowance',
      kind: 'credit',
      summary: 'A reduction for low-income owner-occupants, applied for annually.',
      url: 'https://www.gnb.ca/en/topic/family-home-community/housing-property/property-tax/property-tax-allowance.html',
      applyMode: 'apply',
    },
    {
      id: 'nb-seniors-deferral',
      name: 'Property Tax Deferral Program for Seniors',
      kind: 'deferral',
      summary: 'Defer the annual increase in property tax on your principal residence.',
      url: 'https://www.gnb.ca/en/topic/family-home-community/housing-property/property-tax/property-tax-deferral-program-seniors.html',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment and Tax Notice',
    'Request for Review decision',
    'PAOL property report',
  ],
  languages: ['en', 'fr'],
  notes:
    'New Brunswick combines assessment and tax on a single notice, and the Province — not the municipality — bills the provincial portion.',
  sourceUrl: 'https://www2.snb.ca/content/snb/en/sites/property-assessment/faq.html',
};

const NS: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'NS',
  regionName: 'Nova Scotia',
  authorityName: 'Property Valuation Services Corporation (PVSC)',
  authorityUrl: 'https://www.pvsc.ca/',
  lookupUrl: 'https://webapi.pvsc.ca/Search/SearchByLocation',
  lookupHint: 'Search by address. Your own full property report needs the AAN and PIN from your notice.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule:
    'Market value as of January 1 of the year before the tax year, in its physical condition as of December 1.',
  noticeMonth: 1,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 31,
    note: 'Thirty-one days from the date on your assessment notice.',
  },
  appealBodyName: 'Nova Scotia Assessment Appeal Tribunal',
  appealBodyUrl: 'https://nserbt.ca/nsrab/mandates/property-assessment-appeals',
  assessmentRatioPercent: 100,
  taxableValueTerm: 'Capped (taxable) assessed value',
  assessedValueTerm: 'Market value',
  parcelIdTerm: 'Assessment Account Number (AAN)',
  reliefPrograms: [
    {
      id: 'ns-cap',
      name: 'Capped Assessment Program (CAP)',
      kind: 'credit',
      summary:
        'Limits how much the taxable assessment on your owner-occupied home can rise each year. Applied automatically once your property is registered as owner-occupied.',
      url: 'https://www.pvsc.ca/en/home/aboutus/capped-assessment-program.aspx',
      applyMode: 'on-bill',
    },
    {
      id: 'ns-seniors-rebate',
      name: 'Property Tax Rebate for Seniors',
      kind: 'rebate',
      summary:
        'Refunds part of the municipal property tax you paid, for seniors receiving the Guaranteed Income Supplement.',
      url: 'https://beta.novascotia.ca/apply-property-tax-rebate-seniors',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment Notice',
    'Property Tax Bill',
    'PVSC My Property Report',
    'Assessment appeal decision',
  ],
  languages: ['en'],
  notes:
    'Your notice shows two different values — the market value PVSC assessed, and the lower capped value you are actually taxed on. The gap between them widens every year you stay in the home, and resets when the property sells.',
  sourceUrl: 'https://www.pvsc.ca/',
};

const PE: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'PE',
  regionName: 'Prince Edward Island',
  authorityName: 'Taxation and Property Records, Department of Finance',
  authorityUrl:
    'https://www.princeedwardisland.ca/en/topic/property-assessment-and-tax',
  lookupUrl: 'https://www.princeedwardisland.ca/en/information/finance/property-information',
  lookupHint: 'Look up a parcel by number or address through the provincial property information service.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule: 'Market value, updated annually by the Province.',
  noticeMonth: 5,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 90,
    note: 'A Request for Reconsideration is due within 90 days of the notice date.',
  },
  appealBodyName: 'Island Regulatory and Appeals Commission (IRAC)',
  appealBodyUrl: 'https://www.irac.pe.ca/',
  assessmentRatioPercent: 100,
  taxableValueTerm: 'Taxable value (owner-occupied cap)',
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Parcel number',
  reliefPrograms: [
    {
      id: 'pe-provincial-credit',
      name: 'Provincial Property Tax Credit',
      kind: 'credit',
      summary:
        'Owner-occupied residences pay a reduced provincial rate. Applied once your principal-residence status is on file.',
      url: 'https://www.princeedwardisland.ca/en/information/finance/provincial-property-tax-credits',
      applyMode: 'on-bill',
    },
    {
      id: 'pe-deferral',
      name: 'Seniors Property Tax Deferral',
      kind: 'deferral',
      summary: 'Defer provincial property tax on your principal residence.',
      url: 'https://www.princeedwardisland.ca/en/service/apply-seniors-property-tax-deferral-program',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment and Tax Notice',
    'Property Tax Statement',
    'Request for Reconsideration decision',
  ],
  languages: ['en'],
  notes:
    'Owner-occupied properties get both a reduced provincial rate and a cap on annual assessment increases, so your taxable value can sit below your assessed value.',
  sourceUrl: 'https://www.princeedwardisland.ca/en/topic/property-assessment-and-tax',
};

const NL: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'NL',
  regionName: 'Newfoundland and Labrador',
  authorityName: 'Municipal Assessment Agency',
  authorityUrl: 'https://maa.ca/',
  lookupUrl: 'https://maa.ca/assessments/assessment-search/',
  lookupHint: 'Search the agency’s assessment roll by address or assessment number.',
  centralized: true,
  cycleYears: 3,
  valuationDateRule:
    'Market value as of the base date set for the current three-year assessment cycle.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 30,
    note: 'Thirty days from the date on your assessment notice. An appeal fee applies and is refunded if you succeed.',
  },
  appealBodyName: 'Assessment Review Commissioner',
  appealBodyUrl: 'https://maa.ca/appeals/how-to-appeal/',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Assessment number',
  reliefPrograms: [],
  documentTypes: [
    'Property Assessment Notice',
    'Municipal Property Tax Bill',
    'Assessment appeal decision',
  ],
  languages: ['en'],
  notes:
    'St. John’s and other municipalities bill separately from the assessment agency. There is no province-wide homeowner grant; some municipalities offer their own senior or low-income discounts.',
  sourceUrl: 'https://maa.ca/faq/base-date/',
};

const YT: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'YT',
  regionName: 'Yukon',
  authorityName: 'Property Assessment and Taxation, Government of Yukon',
  authorityUrl: 'https://yukon.ca/en/property-assessment-and-taxes',
  lookupUrl: null,
  lookupHint:
    'Yukon has no public online lookup. Contact Property Assessment and Taxation, or your municipality, for your assessment.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule: 'Market value as of July 1 of the previous year.',
  noticeMonth: 3,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 30,
    note: 'Thirty days from the notice date, to the Board of Revision.',
  },
  appealBodyName: 'Board of Revision',
  appealBodyUrl: 'https://yukon.ca/en/property-assessment-and-taxes',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Roll number',
  reliefPrograms: [
    {
      id: 'yt-hog',
      name: 'Home Owners Grant',
      kind: 'grant',
      summary:
        'Reduces property tax on your Yukon principal residence, with a larger grant for seniors.',
      url: 'https://yukon.ca/en/property-assessment-and-taxes',
      applyMode: 'apply',
    },
  ],
  documentTypes: [
    'Property Assessment Notice',
    'Property Tax Notice',
    'Board of Revision decision',
  ],
  languages: ['en'],
  notes:
    'Whitehorse and other municipalities bill their own property tax; the Government of Yukon bills rural properties directly.',
  sourceUrl: 'https://yukon.ca/en/property-assessment-and-taxes',
};

const NT: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'NT',
  regionName: 'Northwest Territories',
  authorityName: 'Property Assessment and Taxation, Municipal and Community Affairs',
  authorityUrl: 'https://www.maca.gov.nt.ca/en/services/property-assessment-and-taxation',
  lookupUrl: null,
  lookupHint:
    'No public online lookup. Contact Municipal and Community Affairs, or your community government, for your assessment.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule: 'Assessed value under the territorial assessment manual, not open-market value.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 30,
    note: 'Thirty days from the notice date, to the Board of Revision.',
  },
  appealBodyName: 'Territorial Board of Revision',
  appealBodyUrl: 'https://www.eia.gov.nt.ca/en/territorial-board-revision',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Roll number',
  reliefPrograms: [
    {
      id: 'nt-ptap',
      name: 'Property Tax Assistance Program',
      kind: 'rebate',
      summary:
        'Relief on territorial property tax for seniors and people with disabilities in general taxation areas.',
      url: 'https://www.fin.gov.nt.ca/en/PTAP',
      applyMode: 'apply',
    },
  ],
  documentTypes: ['Property Assessment Notice', 'Property Tax Notice'],
  languages: ['en'],
  notes:
    'NWT assesses to a territorial cost manual rather than market value, so your assessed value will not track local sale prices. Taxation communities bill their own tax; the Territory bills the general taxation area.',
  sourceUrl: 'https://www.maca.gov.nt.ca/en/services/property-assessment-and-taxation',
};

const NU: PropertyJurisdiction = {
  countryCode: 'CA',
  regionCode: 'NU',
  regionName: 'Nunavut',
  authorityName: 'Property Assessment and Taxation, Government of Nunavut',
  authorityUrl: 'https://www.gov.nu.ca/en/taxation-and-insurance/property-tax',
  lookupUrl: null,
  lookupHint:
    'No public online lookup. Contact the Department of Community and Government Services, or your municipality, for your assessment.',
  centralized: true,
  cycleYears: 1,
  valuationDateRule: 'Assessed value under the territorial assessment manual, not open-market value.',
  noticeMonth: null,
  appealDeadline: {
    kind: 'days-from-notice',
    days: 30,
    note: 'Thirty days from the notice date, to the Board of Revision.',
  },
  appealBodyName: 'Board of Revision',
  appealBodyUrl: 'https://www.gov.nu.ca/en/taxation-and-insurance/property-tax',
  assessmentRatioPercent: 100,
  taxableValueTerm: null,
  assessedValueTerm: 'Assessed value',
  parcelIdTerm: 'Roll number',
  reliefPrograms: [
    {
      id: 'nu-scpdptr',
      name: 'Senior Citizens and People with Disabilities Property Tax Relief',
      kind: 'rebate',
      summary:
        'Property tax relief for eligible seniors and people with disabilities, renewed annually.',
      url: 'https://www.gov.nu.ca/en/taxation-and-insurance/property-tax',
      applyMode: 'apply',
    },
  ],
  documentTypes: ['Notice of Assessment', 'Property Tax Notice'],
  languages: ['en'],
  notes:
    'Nunavut assesses to a territorial cost manual rather than market value. Iqaluit bills its own property tax; the Government of Nunavut bills the general taxation area.',
  sourceUrl: 'https://www.gov.nu.ca/en/taxation-and-insurance/property-tax',
};

/** Every supported jurisdiction, keyed `"<country>-<region>"`. */
export const PROPERTY_JURISDICTIONS: Readonly<Record<string, PropertyJurisdiction>> =
  Object.freeze({
    'CA-BC': BC,
    'CA-AB': AB,
    'CA-SK': SK,
    'CA-MB': MB,
    'CA-ON': ON,
    'CA-QC': QC,
    'CA-NB': NB,
    'CA-NS': NS,
    'CA-PE': PE,
    'CA-NL': NL,
    'CA-YT': YT,
    'CA-NT': NT,
    'CA-NU': NU,
  });

/** Build the registry key for a country/region pair. */
export function propertyJurisdictionKey(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined
): string | null {
  if (!countryCode || !regionCode) return null;
  return `${countryCode.trim().toUpperCase()}-${regionCode.trim().toUpperCase()}`;
}

/**
 * Resolve the jurisdiction for a household's country + province/state.
 * Returns null when we have no rules for that region — callers should fall back
 * to generic copy rather than showing another region's rules.
 */
export function resolvePropertyJurisdiction(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined
): PropertyJurisdiction | null {
  const key = propertyJurisdictionKey(countryCode, regionCode);
  if (!key) return null;
  return PROPERTY_JURISDICTIONS[key] ?? null;
}

/** Every jurisdiction we support in one country, ordered by region name. */
export function propertyJurisdictionsForCountry(
  countryCode: PropertyCountryCode
): PropertyJurisdiction[] {
  return Object.values(PROPERTY_JURISDICTIONS)
    .filter((j) => j.countryCode === countryCode)
    .sort((a, b) => a.regionName.localeCompare(b.regionName));
}

/**
 * Convert an assessed value to the value tax is actually charged on.
 * A no-op at 100%; halves the base in Manitoba. Cents in, cents out.
 */
export function taxableValueCents(
  assessedValueCents: number,
  jurisdiction: PropertyJurisdiction | null
): number {
  if (!jurisdiction || jurisdiction.assessmentRatioPercent === 100) {
    return assessedValueCents;
  }
  return Math.round((assessedValueCents * jurisdiction.assessmentRatioPercent) / 100);
}

/** `YYYY-MM-DD` for a month/day in a given year. Zero-padded, never local-time. */
function isoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * `noticeDate + days`, as an ISO date, or null when the notice date is missing
 * or unparseable. UTC arithmetic so a device in UTC-8 does not shift the answer
 * back a day at the month boundary.
 */
function daysAfterNotice(noticeDate: string | null | undefined, days: number): string | null {
  if (!noticeDate) return null;
  const parsed = new Date(noticeDate);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The appeal deadline for a given assessment year, as an ISO date, when we can
 * derive one. Returns null where the deadline is only knowable from the notice
 * — the caller should show `appealDeadline.note` instead of inventing a date.
 *
 * The parameter is structural rather than `PropertyJurisdiction` so the US
 * registry — whose jurisdictions carry the same `AppealDeadlineRule` but a
 * completely different surrounding shape — can share this one implementation.
 * Two copies of date arithmetic is two places for an off-by-one to hide.
 */
export function resolveAppealDeadline(
  jurisdiction: { appealDeadline: AppealDeadlineRule } | null | undefined,
  assessmentYear: number,
  noticeDate?: string | null
): string | null {
  if (!jurisdiction) return null;
  const rule = jurisdiction.appealDeadline;

  if (rule.kind === 'fixed') {
    return isoDate(assessmentYear, rule.month, rule.day);
  }

  if (rule.kind === 'days-from-notice') {
    return daysAfterNotice(noticeDate, rule.days);
  }

  if (rule.kind === 'fixed-or-days-from-notice') {
    const fixed = isoDate(assessmentYear, rule.month, rule.day);
    const fromNotice = daysAfterNotice(noticeDate, rule.days);
    // No usable notice date: the statutory date is still the honest answer, and
    // it is the earliest the deadline can ever be. Never null here — unlike a
    // pure `days-from-notice` rule, we always know at least this much.
    if (!fromNotice) return fixed;
    // Both are `YYYY-MM-DD`, so a string compare *is* a date compare.
    return fromNotice > fixed ? fromNotice : fixed;
  }

  return null;
}
