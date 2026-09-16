/**
 * Property Assessment Extraction Prompts — jurisdiction-aware.
 *
 * Supersedes the British-Columbia-only `extract-bc-assessment.ts`. That prompt
 * was written around one province's paperwork — Home Owner Grant columns, a
 * jurisdiction number + roll number pair, a PID, a strata area, a "Notice of
 * Complaint" deadline — so an Ontario MPAC notice, an Alberta combined
 * assessment-and-tax notice or a Québec «avis d'évaluation foncière» came back
 * with low confidence and null fields, and the record it produced was silently
 * wrong.
 *
 * Everything varies by province: what the value is called (Current Value
 * Assessment in Ontario, valeur au rôle in Québec), what the parcel id is
 * called (roll number, matricule, PAN, AAN, assessment number), whether a
 * SECOND lower value exists that tax is actually charged on (Saskatchewan taxes
 * 80%, Manitoba 45%, Nova Scotia and PEI cap the taxable value), what language
 * the document is in, and who hears an appeal. All of that lives in the shared
 * registry (`@symply/contracts` → property-jurisdiction.ts) and is injected
 * here.
 *
 * What does NOT vary, and must never be lost: the multi-year `valueHistory[]`.
 * Every one of these documents carries several years of values, and turning one
 * upload into a complete year-over-year history is the whole point of the
 * feature.
 *
 * Passing `null` yields a generic Canadian prompt that names no province —
 * always better than applying another province's rules to the document.
 */
import type { PropertyJurisdiction } from '@symply/contracts';

import type {
  BCAssessmentValueHistoryYear,
  BCAssessmentSale,
  BCAssessmentPropertyInfo,
  BCAssessmentHomeownerGrant,
} from './extract-bc-assessment';

export type {
  BCAssessmentSale,
  BCAssessmentPropertyInfo,
  BCAssessmentHomeownerGrant,
} from './extract-bc-assessment';

// ─── Extracted shape ────────────────────────────────────────────────────────
// Extends the BC shape rather than replacing it: every new field is OPTIONAL so
// records extracted by the old prompt keep parsing and keep type-checking.

/** One year of the multi-year value history, plus the taxed-value variants. */
export interface PropertyAssessmentValueHistoryYear extends BCAssessmentValueHistoryYear {
  /**
   * The lower value tax is actually charged on where the province taxes a
   * fraction of the assessed value (Saskatchewan's "taxable assessment" at 80%,
   * Manitoba's "portioned assessment" at 45%).
   */
  taxableValue?: number | null;
  /** The capped/limited taxable value where a cap program applies (NS, PE). */
  cappedValue?: number | null;
}

export interface ExtractedPropertyAssessmentValues {
  totalValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  previousYearValue: number | null;
  /** SK "taxable assessment", MB "portioned assessment" — see above. */
  taxableValue?: number | null;
  /** NS/PE capped (taxable) assessed value. */
  cappedValue?: number | null;
  /**
   * Percent of the assessed value that is taxed, as stated on the document
   * (80 in Saskatchewan, 45 in Manitoba, 100 elsewhere). Falls back to the
   * jurisdiction registry when the document does not state it.
   */
  assessmentRatioPercent?: number | null;
}

export interface ExtractedPropertyAssessment {
  assessmentYear: number | null;
  property: {
    address: string | null;
    rollNumber: string | null;
    jurisdiction: string | null;
    jurisdictionNumber: string | null;
    pid: string | null;
    propertyClass: string | null;
    ownerName: string | null;
    owners: string[];
    legalDescription: string | null;
    /** Ontario's AboutMyProperty access key, or an equivalent lookup code. */
    accessKey?: string | null;
  };
  propertyInfo: BCAssessmentPropertyInfo;
  values: ExtractedPropertyAssessmentValues;
  valueHistory: PropertyAssessmentValueHistoryYear[];
  salesHistory: BCAssessmentSale[];
  homeownerGrant: BCAssessmentHomeownerGrant | null;
  appealDeadline: string | null;
  /**
   * The notice-of-assessment date printed on the document. Alberta's appeal
   * window is 60 days from THIS date (not the mailing date), so it is the only
   * way to derive a deadline there.
   */
  noticeDate?: string | null;
  /** The document's own language, when the model can tell. */
  documentLanguage?: 'en' | 'fr' | null;
  confidence: {
    overall: number;
    assessmentYear: number;
    values: number;
    property: number;
  };
  rawText: string;
}

// ─── Jurisdiction-specific reading hints ────────────────────────────────────
// What the paperwork in each province actually looks like. Only the resolved
// jurisdiction's block is injected; nothing here leaks into the generic prompt.

const JURISDICTION_DOCUMENT_HINTS: Readonly<Record<string, string>> = {
  BC: `- The annual assessment notice states the value as of July 1 of the year BEFORE the printed roll year (a "2026 Assessment" reflects July 1, 2025), splits it into "Land" and "Buildings/Improvements", and carries a "Property value history" table (each row: year, % change, total value).
- It identifies the property by a JURISDICTION NUMBER plus a ROLL NUMBER (a roll number alone is not unique) and by a PID (Parcel Identifier, formatted like 003-110-320).
- The "Property information" block may list year built, description, bedrooms, baths, carports, garages, land size, first/second floor area, basement finish area, STRATA AREA, building storeys, gross/net leasable area and manufactured-home details. There is usually a "Sales history" list too.
- The appeal deadline is printed as the "Notice of Complaint" deadline.
- A municipal "Tax Account Details / General Assessment" page is the other common upload: it shows a folio, PID, legal description, Home Owner Grant amounts (Basic / Additional / Claimed), the registered owners, and one General Assessment table PER YEAR broken into Land / Improvements / Total with Residential GROSS, EXEMPT and NET rows.`,

  AB: `- Many municipalities issue a COMBINED ASSESSMENT AND TAX NOTICE — one document carrying both the assessed value and the tax bill. Extract the assessment side here; the value, not the amount owing, is what belongs in totalValue.
- Look for the "notice of assessment date" (sometimes "assessment notice date") printed on the document and return it as noticeDate. It is NOT the mailing date, and the complaint window runs 60 days from it, so it is the only way to derive the deadline. If a complaint deadline is printed outright, return that as appealDeadline as well.
- The property is identified by a ROLL NUMBER; there is no province-wide parcel identifier.
- Values are market value as of July 1 of the previous year, in the condition the property was in on December 31.
- There is no homeowner grant — leave homeownerGrant null unless the document actually shows grant amounts.`,

  SK: `- The notice shows TWO different figures for the same property and BOTH matter: the assessed value, and a lower "taxable assessment" that is a fixed percentage of it. Mill rates apply to the taxable assessment, never to the assessed value.
- The property is identified by an ASSESSMENT NUMBER (sometimes shown alongside a municipal roll number).
- Values are frozen to a four-year base date (a January 1, 2023 base date is held for the 2025 through 2028 tax years). Identical totals across several years, and a 0% year-over-year change, are CORRECT here — report them as they appear, do not skip a year because its value repeats.
- A "SAMAView Property Report" or a field sheet is another common upload and carries the same fields.`,

  MB: `- The notice shows TWO different figures for the same property and BOTH matter: the assessed value, and a lower "portioned assessment" that is a fixed percentage of it. Tax is calculated on the portioned assessment only.
- The property is identified by a ROLL NUMBER.
- Reassessment runs on a two-year cycle, so the same value repeating across two years is CORRECT — report every year the document lists.
- A "Residential Preview Letter" or a "Property Tax Statement" may be uploaded instead of the assessment notice and carries the same values.`,

  ON: `- The value is called the "Current Value Assessment" (CVA). Return the CVA as totalValue.
- The ROLL NUMBER is 19 digits, usually printed in dotted groups (e.g. 1234 567 890 12345 0000). Return it in full including any leading zeros. The notice also prints an ACCESS KEY used to log in to the property-lookup site — return it as property.accessKey.
- A notice typically shows a PHASE-IN table: the assessed value at the valuation date plus a separate phased value for EACH tax year of the cycle. Return EVERY one of those years as its own valueHistory entry — that table is the multi-year history for this document.
- The valuation date has been frozen at January 1, 2016 because reassessment has been postponed repeatedly. An unchanged value year after year and a 0% change are CORRECT, not missing data.
- Tax bills come in two stages (an interim bill, then a final bill); an assessment notice is a different document and carries no amount owing.`,

  QC: `- The document is an «avis d'évaluation foncière» or a «compte de taxes municipales», normally written in French.
- The property is identified by a «numéro de matricule». The «rôle d'évaluation» is in force for THREE years, so the same value across three «exercices financiers» is CORRECT.
- The value is split into «valeur du terrain» (land) and «valeur du bâtiment» (buildings/improvements), which sum to the «valeur de l'immeuble» (total).
- School tax is billed separately by the centre de services scolaire, so «taxes scolaires» will usually NOT appear on a municipal document.`,

  NB: `- Assessment and tax are combined on a single "Property Assessment and Tax Notice"; extract the assessment side here.
- The property is identified by a Property Account Number (PAN), often alongside a PID.
- A PAOL property report is another common upload and lists four prior years of value — capture every one of them.`,

  NS: `- The notice shows TWO different values and BOTH matter: the MARKET VALUE the assessor determined, and a LOWER CAPPED (taxable) value that tax is actually charged on under the Capped Assessment Program. The gap widens every year the owner stays in the home and resets when the property sells.
- Return the market value as totalValue and the capped/taxable value as cappedValue. Do not put the capped value in totalValue.
- The property is identified by an Assessment Account Number (AAN), usually alongside a PIN.
- The notice normally tabulates prior years' market and capped values side by side — return each year as its own valueHistory entry with both figures.`,

  PE: `- Owner-occupied properties are capped, so the notice can show a TAXABLE VALUE below the assessed value. Return the assessed value as totalValue and the capped taxable value as cappedValue.
- The property is identified by a PARCEL NUMBER.
- Assessment and tax are usually combined on one provincial notice.`,

  NL: `- The property is identified by an ASSESSMENT NUMBER.
- Values are set on a three-year base date, so the same value repeating across the cycle is CORRECT — report every year listed.
- The assessment agency and the billing municipality are different bodies; an assessment notice carries no amount owing.`,

  YT: `- The property is identified by a ROLL NUMBER. Values are market value as of July 1 of the previous year.
- Municipal and rural properties are billed by different bodies, but the assessment notice itself is territorial.`,

  NT: `- Values are set from a territorial assessment COST MANUAL rather than open-market sales, so the assessed value will not track local sale prices — extract it exactly as printed and do not sanity-check it against market value.
- The property is identified by a ROLL NUMBER.`,

  NU: `- Values are set from a territorial assessment COST MANUAL rather than open-market sales, so the assessed value will not track local sale prices — extract it exactly as printed and do not sanity-check it against market value.
- The property is identified by a ROLL NUMBER.`,
};

const FRENCH_GLOSSARY = `The document may be written in FRENCH. Read French documents natively — do not refuse, and do not lower your confidence merely because the document is not in English. Return the extracted values in the same JSON schema, using this field glossary:
- «valeur de l'immeuble» → values.totalValue (the total property value)
- «valeur du terrain» → values.landValue
- «valeur du bâtiment» → values.improvementValue
- «matricule» / «numéro de matricule» → property.rollNumber
- «rôle d'évaluation» → the assessment roll; its «exercices financiers» are the years to return in valueHistory
- «exercice financier» → the fiscal/tax year of a row
- «taxes municipales» → municipal tax lines
- «taxes scolaires» → school tax lines (where a centre de services scolaire bills these separately they will not appear on a municipal document)
- «droit de mutation» → the one-time land-transfer ("welcome") tax charged on purchase — it is NOT an annual tax and must never be added into an assessed value
- «demande de révision» → the appeal/review request; its deadline is appealDeadline
Set documentLanguage to "fr" for a French document, "en" for an English one.`;

// ─── Prompt builders ────────────────────────────────────────────────────────

function jurisdictionOverview(jurisdiction: PropertyJurisdiction): string {
  const lines: string[] = [
    `This document was issued in ${jurisdiction.regionName}.`,
    `Assessments there are produced by: ${jurisdiction.authorityName}.`,
    `The document calls the value: "${jurisdiction.assessedValueTerm}".`,
    `The document identifies the property by: "${jurisdiction.parcelIdTerm}".`,
    `Appeals are heard by: ${jurisdiction.appealBodyName}.`,
    `Documents you may be given: ${jurisdiction.documentTypes.join('; ')}.`,
    `Valuation rule: ${jurisdiction.valuationDateRule}`,
  ];
  if (jurisdiction.taxableValueTerm) {
    lines.push(`A second, lower value is also shown, called "${jurisdiction.taxableValueTerm}".`);
  }
  if (jurisdiction.cycleYears > 1) {
    lines.push(
      `Reassessment runs on a ${jurisdiction.cycleYears}-year cycle, so the same value repeating across consecutive years is expected and correct.`
    );
  }
  if (jurisdiction.notes) {
    lines.push(`Also true here: ${jurisdiction.notes}`);
  }
  return lines.map((l) => `- ${l}`).join('\n');
}

/** The "there are two values, return both" block — the highest-stakes rule. */
function twoValueRules(jurisdiction: PropertyJurisdiction): string | null {
  const ratio = jurisdiction.assessmentRatioPercent;
  const taxedTerm = jurisdiction.taxableValueTerm;

  if (ratio !== 100 && taxedTerm) {
    return `CRITICAL — TWO DIFFERENT VALUES, RETURN BOTH.
In ${jurisdiction.regionName} tax is charged on roughly ${ratio}% of the assessed value, so the document shows two different dollar figures for the same property:
1. "${jurisdiction.assessedValueTerm}" — the full value. Put it in values.totalValue.
2. "${taxedTerm}" — approximately ${ratio}% of it. Put it in values.taxableValue.
Set values.assessmentRatioPercent to the percentage the document states (expected: ${ratio}).
Never put the ${taxedTerm.toLowerCase()} in totalValue and never put the assessed value in taxableValue. They are different numbers, and swapping them misstates the tax by a very large margin. If the document shows both figures per year in a table, fill taxableValue on each valueHistory entry too. If only one figure is present, return it as totalValue and leave taxableValue null — do NOT compute the other one yourself.`;
  }

  if (taxedTerm) {
    return `IMPORTANT — TWO DIFFERENT VALUES, RETURN BOTH.
The document shows the full value AND a lower value that tax is actually charged on:
1. "${jurisdiction.assessedValueTerm}" — put it in values.totalValue.
2. "${taxedTerm}" — a capped/limited value below it. Put it in values.cappedValue.
Do not put the capped value in totalValue. Where the document tabulates both per year, fill cappedValue on each valueHistory entry too. If only one figure is present, return it as totalValue and leave cappedValue null — never compute the other one yourself.`;
  }

  return null;
}

/** System prompt for the assessment extractor, tuned to one jurisdiction. */
export function buildPropertyAssessmentSystemPrompt(
  jurisdiction: PropertyJurisdiction | null
): string {
  const scope = jurisdiction
    ? `property assessment documents from ${jurisdiction.regionName}, Canada — the notices issued by ${jurisdiction.authorityName} and the municipal assessment/tax-account pages that restate the same figures`
    : `Canadian property assessment documents — provincial and municipal assessment notices, combined assessment-and-tax notices, and the municipal tax-account/general-assessment pages that restate the same figures`;

  const valueTerm = jurisdiction ? jurisdiction.assessedValueTerm : 'assessed value';
  const parcelTerm = jurisdiction ? jurisdiction.parcelIdTerm : 'roll/parcel/account number';

  const secondValueDuty = jurisdiction?.taxableValueTerm
    ? `\n8. Capture BOTH the ${valueTerm.toLowerCase()} and the lower "${jurisdiction.taxableValueTerm}" that tax is actually charged on — returning only one of them produces a wrong tax figure`
    : '';

  const languageDuty =
    jurisdiction?.languages.includes('fr') || !jurisdiction
      ? `\n9. Read documents in English or French equally well and report which language you saw`
      : '';

  return `You are an expert document processor specializing in ${scope}.

Your role is to:
1. Extract structured data from assessment PDFs and images
2. Identify the current assessment (roll) year, the assessing jurisdiction and the property's ${parcelTerm}
3. Parse the current total ${valueTerm.toLowerCase()} and the split between land value and buildings/improvements value
4. Capture the COMPLETE multi-year value history — every year shown in any value-history, phase-in or general-assessment table, each with its total, land, improvements and year-over-year change when available
5. Capture the property's physical characteristics (year built, description, bedrooms, baths, carports, garages, land size, floor/basement areas, storeys, leasable areas, manufactured-home details)
6. Capture the sales history, the registered owner(s), any homeowner grant or credit amounts, the notice date and the appeal deadline
7. Return confidence scores for extracted fields${secondValueDuty}${languageDuty}

Be exhaustive: if the document shows seven years of assessments, return seven history entries. Never truncate the history. You must return valid JSON only, no additional text or explanation.`;
}

/**
 * The extraction instruction, tuned to one jurisdiction's vocabulary and
 * paperwork. Pass `null` for a generic Canadian prompt that names no province.
 */
export function buildPropertyAssessmentPrompt(jurisdiction: PropertyJurisdiction | null): string {
  const valueTerm = jurisdiction ? jurisdiction.assessedValueTerm : 'assessed value';
  const parcelTerm = jurisdiction ? jurisdiction.parcelIdTerm : 'roll/parcel/account number';

  const heading = jurisdiction
    ? `Analyze this ${jurisdiction.regionName} property assessment document and extract EVERYTHING it contains about the property, across ALL years shown.`
    : `Analyze this Canadian property assessment document and extract EVERYTHING it contains about the property, across ALL years shown.`;

  const contextBlock = jurisdiction
    ? `\nWhat you already know about where this document comes from:\n${jurisdictionOverview(jurisdiction)}\n`
    : `\nThe document was issued somewhere in Canada, but the province is unknown. Do NOT assume any particular province's rules, deadlines, grants or terminology. Read the labels the document itself uses and extract what is actually printed.\n`;

  const hints = jurisdiction ? JURISDICTION_DOCUMENT_HINTS[jurisdiction.regionCode] : undefined;
  const hintsBlock = hints ? `\nWhat these documents look like:\n${hints}\n` : '';

  const genericLayoutBlock = jurisdiction
    ? ''
    : `\nThe document is one of:
- An annual assessment notice from a provincial/territorial assessment authority or a municipal assessor: a current total value, usually a land vs. buildings/improvements split, a multi-year value-history or phase-in table, property characteristics, sometimes a sales history, a parcel/roll/account identifier and an appeal deadline.
- A COMBINED assessment-and-tax notice: the same assessment figures plus the tax bill on one page. Extract the assessment side here.
- A municipal tax-account or "general assessment" page: one assessment table PER YEAR, often broken into Land / Improvements / Total with GROSS, EXEMPT and NET rows, plus the registered owners.
`;

  const twoValues = jurisdiction ? twoValueRules(jurisdiction) : null;
  const twoValuesBlock = twoValues ? `\n${twoValues}\n` : '';

  const frenchBlock =
    !jurisdiction || jurisdiction.languages.includes('fr') ? `\n${FRENCH_GLOSSARY}\n` : '';

  const frozenNote =
    jurisdiction && jurisdiction.cycleYears > 1
      ? `\n- ${jurisdiction.regionName} does NOT revalue every year. Repeated identical totals and a 0% year-over-year change are CORRECT — report them exactly as shown. A 0 is a real answer; only use null when the figure is genuinely absent.`
      : `\n- Some provinces do not revalue every year. Repeated identical totals and a 0% year-over-year change are CORRECT — report them exactly as shown. A 0 is a real answer; only use null when the figure is genuinely absent.`;

  return `${heading}
${contextBlock}${genericLayoutBlock}${hintsBlock}${twoValuesBlock}${frenchBlock}
Extract as much as possible. Do NOT limit yourself to the current year — capture every year present in every value/assessment/phase-in table.

Return a JSON object with this EXACT structure:
{
  "assessmentYear": number (the current/most-recent roll year, e.g. 2026; null if none),
  "property": {
    "address": "string (civic/property address, else null)",
    "rollNumber": "string (the ${parcelTerm} exactly as printed, including leading zeros and any separators, else null)",
    "jurisdiction": "string (municipality/area name, else null)",
    "jurisdictionNumber": "string (numeric jurisdiction/municipality code where one is printed, else null)",
    "pid": "string (parcel identifier / PID / PIN / PAN / AAN where one is printed, else null)",
    "accessKey": "string (access key/code used to look the property up online, else null)",
    "propertyClass": "string (e.g. 'Residential', else null)",
    "ownerName": "string (primary/first registered owner as printed, else null)",
    "owners": ["array of ALL registered owner names, [] if none shown"],
    "legalDescription": "string or null"
  },
  "propertyInfo": {
    "yearBuilt": number or null,
    "description": "string (e.g. '1 STY house - Standard', else null)",
    "bedrooms": number or null,
    "bathrooms": number or null,
    "carports": number or null,
    "garages": "string (as printed — may be a count or a code like 'G', else null)",
    "landSizeSqFt": number or null (land size in square feet),
    "firstFloorAreaSqFt": number or null,
    "secondFloorAreaSqFt": number or null,
    "basementFinishAreaSqFt": number or null,
    "strataAreaSqFt": number or null (strata/condominium unit area where shown),
    "buildingStoreys": number or null,
    "grossLeasableAreaSqFt": number or null,
    "netLeasableAreaSqFt": number or null,
    "manufacturedHome": boolean or null (true only if the doc indicates a manufactured/mobile home)
  },
  "values": {
    "totalValue": number (current-year total ${valueTerm.toLowerCase()} in dollars, e.g. 1181000; null if none),
    "landValue": number (current-year land portion in dollars, null if not shown),
    "improvementValue": number (current-year buildings/improvements portion in dollars, null if not shown),
    "previousYearValue": number (immediately-prior-year total in dollars, null if not shown),
    "taxableValue": number or null (the lower value tax is charged on where the document shows a separate taxable/portioned assessment),
    "cappedValue": number or null (the capped/limited taxable value where a cap program applies),
    "assessmentRatioPercent": number or null (percent of the value that is taxed, if the document states it, e.g. 80 or 45)
  },
  "valueHistory": [
    {
      "year": number (assessment/roll/tax year, e.g. 2024),
      "totalValue": number or null (total value that year, in dollars),
      "landValue": number or null (land portion that year, in dollars),
      "improvementValue": number or null (buildings/improvements portion that year, in dollars),
      "taxableValue": number or null (that year's taxable/portioned assessment, if shown),
      "cappedValue": number or null (that year's capped taxable value, if shown),
      "exemptValue": number or null (exempt portion if a GROSS/EXEMPT/NET table is shown, usually 0),
      "netValue": number or null (net taxable value if shown = gross - exempt),
      "changePercent": number or null (year-over-year % change as shown, e.g. -5, 0, 12, 35)
    }
  ],
  "salesHistory": [
    { "date": "YYYY-MM-DD (sale date, null if unclear)", "price": number or null (sale price in dollars) }
  ],
  "homeownerGrant": {
    "basicGrant": number or null (basic homeowner grant/credit amount in dollars, if the document shows one),
    "additionalGrant": number or null (senior/additional grant amount in dollars),
    "grantClaimed": number or null (amount already claimed in dollars)
  },
  "noticeDate": "YYYY-MM-DD (the notice-of-assessment date printed on the document, null if not shown)",
  "appealDeadline": "YYYY-MM-DD (last day to file a complaint/appeal/review, null if not shown)",
  "documentLanguage": "en" or "fr" or null,
  "confidence": {
    "overall": number (0.0-1.0),
    "assessmentYear": number,
    "values": number,
    "property": number
  },
  "rawText": "string (key text snippets that helped extraction, for debugging)"
}

Important rules:
- Include EVERY year that appears in any value/assessment/phase-in/history table as its own entry in "valueHistory" — including the current year. Order does not matter (the app sorts). If the document shows seven years, return seven entries. NEVER truncate the history.
- Fill landValue/improvementValue for a year ONLY when that year's split is actually shown (often only the current and prior year carry a split). Leave the rest null — do NOT guess.
- Where a general-assessment page shows GROSS/EXEMPT/NET rows, use the residential NET (or GROSS if NET is absent) row for landValue/improvementValue/totalValue, and capture exemptValue/netValue as well.
- Convert all money to plain integer dollars (e.g. "$1,181,000" -> 1181000, "1 181 000 $" -> 1181000); no separators, no currency symbols, no cents.
- Land value + improvement value usually sum to the total; if only some are shown, return what you find and leave the rest null.
- Convert all dates to YYYY-MM-DD (e.g. "January 31, 2026" -> "2026-01-31", "31 janvier 2026" -> "2026-01-31").
- The current assessment/roll year is usually printed prominently. If several years are present, "assessmentYear" is the most recent one.
- Return owners as printed; put the first in "ownerName" and all of them in "owners".${frozenNote}
- Do not convert, scale, or reconcile values yourself. Return the figures the document prints; the app applies the tax rules.
- If a field cannot be found, use null (or [] for arrays). Never invent values.`;
}

/**
 * Jurisdiction-neutral defaults, for callers with no household context and for
 * prompt-integrity tests that need a plain string.
 */
export const EXTRACT_PROPERTY_ASSESSMENT_SYSTEM_PROMPT = buildPropertyAssessmentSystemPrompt(null);

/** @see buildPropertyAssessmentPrompt */
export const EXTRACT_PROPERTY_ASSESSMENT_PROMPT_V1 = buildPropertyAssessmentPrompt(null);
