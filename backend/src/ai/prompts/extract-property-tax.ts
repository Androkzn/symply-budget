/**
 * Property Tax Notice Extraction Prompts — jurisdiction-aware.
 *
 * This prompt used to name British-Columbia cities outright and describe only
 * BC's three-column layout (No Grant / Basic Home Owner Grant / Senior grant).
 * That layout exists nowhere else: Alberta bills a municipal line plus a
 * provincial education line, Manitoba adds a school-division levy and a
 * Provincial Education Support Levy and then NETS a credit off the total,
 * Ontario bills twice a year (an interim bill, then a final bill), and Québec
 * issues a «compte de taxes» in French with school tax billed separately.
 *
 * So the prompt is now built per jurisdiction from the shared registry
 * (`@symply/contracts` → property-jurisdiction.ts). The BC grant-column
 * handling is preserved verbatim — but only when the jurisdiction IS British
 * Columbia. `null` yields a generic Canadian prompt that names no province.
 *
 * The `EXTRACT_PROPERTY_TAX_*` constants remain exported as the generic
 * (jurisdiction-unknown) defaults so existing callers keep working.
 */
import type { PropertyJurisdiction } from '@symply/contracts';

// ─── Jurisdiction-specific reading hints ────────────────────────────────────

const JURISDICTION_TAX_HINTS: Readonly<Record<string, string>> = {
  BC: `BC property tax notices typically present three amount columns:
- Column A "No Grant" = the full amount due if you do NOT claim the Home Owner Grant
- Column B "Basic Grant" = amount due after the basic Home Owner Grant
- Column C "Senior / Additional Grant" = amount due after the senior/additional grant

The headline "AMOUNT DUE" is the No-Grant (Column A) total. Extract that as financial.totalTaxAmount, Column B as financial.amountWithBasicGrant and Column C as financial.amountWithSeniorGrant, and set homeownerGrant.eligible to true whenever those columns or amounts are present.
The property is identified by a FOLIO number, often with an access code for the municipality's online service. The notice usually also restates the net assessed value used for taxation (the "GENERAL" value).
Penalties are stated as a percentage applied after a stated date — capture both.`,

  AB: `Alberta notices are frequently a COMBINED assessment and tax notice — the assessed value and the tax bill on one page. Extract the tax side here.
The bill carries TWO separate tax lines that must both be captured in lineItems:
- the MUNICIPAL tax line (your city/town/county's own levy), and
- the PROVINCIAL EDUCATION PROPERTY TAX line (sometimes split into a public and a separate/Catholic school portion).
Some bills add local improvement or special levies — capture each as its own line item.
There is NO homeowner grant in Alberta: set homeownerGrant.eligible to false and leave the grant amounts null unless the document genuinely shows a grant.
The property is identified by a ROLL NUMBER. Many municipalities offer a monthly payment plan (TIPP-style) — if an instalment amount and date are shown, return them as the advance payment.`,

  SK: `Saskatchewan bills apply mill rates to the TAXABLE ASSESSMENT (a fixed percentage of the assessed value), not to the assessed value itself. If the notice prints both figures, return the assessed value as assessedValue and the taxable assessment as taxableValue.
Capture each levy as its own line item — typically a municipal levy, an education (school) levy, and sometimes a library or local improvement levy.
There is NO homeowner grant in Saskatchewan; leave the grant fields null.
The property is identified by an ASSESSMENT NUMBER, sometimes alongside a municipal roll number.`,

  MB: `Manitoba bills are calculated on the PORTIONED ASSESSMENT (a fixed percentage of the assessed value), not on the assessed value. If both figures are printed, return the assessed value as assessedValue and the portioned assessment as taxableValue.
Capture EVERY levy as its own line item — typically:
- the MUNICIPAL levy,
- the SCHOOL DIVISION levy, and
- the PROVINCIAL EDUCATION SUPPORT LEVY.
Then, CRITICALLY: the Homeowners Affordability Tax Credit (and any Seniors' School Tax Rebate) appears as a CREDIT line that is SUBTRACTED from the total. That means the AMOUNT OWING is LESS than the TAX LEVIED. Do not confuse the two:
- financial.taxLevied = the total of the levy lines, BEFORE the credit
- financial.totalCredits = the credit amount(s) netted off
- financial.amountOwing = what the homeowner must actually pay, AFTER the credit
Return the credit as a line item with kind "credit" and a POSITIVE amount (the sign is carried by the kind, not by the number). Never report the levied total as the amount owing, and never report the amount owing as the levied total.
The property is identified by a ROLL NUMBER. A TIPP-style monthly instalment plan may be shown — return an instalment amount and date as the advance payment.`,

  ON: `Ontario municipalities bill in TWO stages, and the notice will say which one it is:
- an INTERIM bill early in the year, based on a fraction of last year's total, and
- a FINAL bill once the year's rates are set, which shows the annual total and subtracts what the interim bill already charged.
Set billingStage to "interim" or "final" accordingly ("combined" if one document covers the whole year). On a final bill, financial.taxLevied is the full-year levy and financial.amountOwing is what is still payable after the interim amount is credited — do not report the full-year levy as the amount now owing.
Capture each line item: the municipal (lower-tier) portion, any regional/upper-tier portion, and the PROVINCIAL EDUCATION tax portion.
The property is identified by a 19-digit ROLL NUMBER, usually printed in dotted groups — return it in full, including leading zeros. The value shown is the Current Value Assessment (CVA).
Ontario has no on-bill homeowner grant; its relief is claimed on the income tax return, so leave the grant fields null unless the bill itself shows a credit.
Bills are normally payable in several instalments — return the next/main instalment as the main payment and an earlier or additional instalment as the advance payment.`,

  QC: `The document is normally a «compte de taxes municipales» written in French.
Capture each levy as its own line item — «taxe foncière générale», «taxe spéciale», «taxe d'eau»/«service de l'eau», «matières résiduelles», and any «taxe d'arrondissement» or sector levy.
«Taxes scolaires» are billed SEPARATELY by the centre de services scolaire, so a school-tax line normally will NOT appear on the municipal bill; if you are given a «compte de taxes scolaires», extract it as its own document.
A «droit de mutation» (welcome tax) is a ONE-TIME land-transfer charge on purchase — it is NOT annual property tax. Never add it to the annual total; if the document is a droit de mutation notice, say so in rawText and leave the annual fields null.
The property is identified by a «numéro de matricule». Bills are usually payable in two «versements» (instalments) — return them as the advance and main payments.
There is no on-bill homeowner grant; Québec relief is claimed on the income tax return.`,

  NB: `New Brunswick combines assessment and tax on one "Property Assessment and Tax Notice", and the PROVINCE bills the provincial portion.
Capture each line item: the municipal/local service district rate and the provincial rate.
The Residential Property Tax Credit is applied ON THE BILL for a registered principal residence, so it appears as a credit that reduces the amount owing below the amount levied — return it as a credit line item and keep taxLevied and amountOwing distinct.
The property is identified by a Property Account Number (PAN).`,

  NS: `Nova Scotia municipalities bill on the CAPPED (taxable) assessed value, which is lower than the market value the assessor determined. If both are printed, return the market value as assessedValue and the capped value as taxableValue.
Capture each line item: the general/residential municipal rate, any area rate or local improvement charge, plus fire protection and provincial mandatory contributions where shown.
The property is identified by an Assessment Account Number (AAN).
Bills are commonly issued twice a year (an interim and a final) — set billingStage when the document says which it is.`,

  PE: `Prince Edward Island bills the provincial and municipal portions on one notice.
Owner-occupied principal residences pay a REDUCED provincial rate, shown as a provincial property tax credit that lowers the amount owing below the amount levied — return it as a credit line item and keep taxLevied and amountOwing distinct.
Capture each line item: the provincial property tax, the municipal property tax and any fire district or waste levy.
The property is identified by a PARCEL NUMBER.`,

  NL: `Newfoundland and Labrador municipalities bill separately from the assessment agency.
Capture each line item: the municipal residential property tax, plus any water/sewer tax, which is commonly a separate flat charge on the same bill.
The property is identified by an ASSESSMENT NUMBER.
There is no province-wide homeowner grant, though a municipality may show its own senior or low-income discount as a credit line — capture it as a credit and keep taxLevied and amountOwing distinct.`,

  YT: `Yukon municipalities bill their own property tax; the territory bills rural properties directly.
The Home Owners Grant reduces the tax on a principal residence and may appear as a credit line or a separate grant amount — capture it, and keep the amount levied distinct from the amount owing after the grant.
The property is identified by a ROLL NUMBER. Capture each line item, including any school levy and local improvement charge.`,

  NT: `Taxation communities bill their own property tax; the territory bills the general taxation area.
Capture each line item, including the education/school levy where one is shown.
The property is identified by a ROLL NUMBER. A property tax assistance rebate for seniors or people with disabilities may appear as a credit line — capture it and keep the amount levied distinct from the amount owing.`,

  NU: `Iqaluit bills its own property tax; the territory bills the general taxation area.
Capture each line item, including the education/school levy where one is shown.
The property is identified by a ROLL NUMBER. Senior/disability tax relief may appear as a credit line — capture it and keep the amount levied distinct from the amount owing.`,
};

const GENERIC_TAX_LAYOUT = `The province is unknown, so do NOT assume any particular province's layout, grant, deadline or terminology — in particular do not assume a three-column homeowner-grant layout, which only some provinces use. Read the labels the document itself prints.

Extract the tax lines that ACTUALLY APPEAR on this bill, whatever they are called: a municipal/general levy, a regional or upper-tier levy, an education or school levy, water/sewer/waste charges, local improvement or area rates, and any credit, grant or rebate line that is netted off the total.
Where a credit is netted off, the AMOUNT OWING is LESS than the TAX LEVIED. Keep them separate: financial.taxLevied is the total before credits, financial.totalCredits is what is netted off, financial.amountOwing is what the homeowner must actually pay. Never report one as the other.`;

const FRENCH_TAX_GLOSSARY = `The document may be written in FRENCH. Read French documents natively — do not refuse, and do not lower your confidence merely because the document is not in English. Use this field glossary:
- «compte de taxes» → the tax bill itself
- «taxes municipales» → municipal tax line items
- «taxes scolaires» → school tax line items (where a centre de services scolaire bills these separately they will not appear on the municipal bill)
- «valeur de l'immeuble» → assessedValue; «valeur du terrain» / «valeur du bâtiment» → its land / building split
- «matricule» → property.folioNumber
- «rôle d'évaluation» → the assessment roll the bill is based on
- «exercice financier» → the fiscal/tax year → taxYear
- «versement» / «échéance» → an instalment and its due date
- «droit de mutation» → the one-time land-transfer ("welcome") tax on purchase — NOT annual property tax, never add it to the annual total
- «solde» / «montant dû» → amount owing; «total des taxes» → tax levied
- «intérêts» / «pénalité» → interest/penalty terms
Set documentLanguage to "fr" for a French document, "en" for an English one.`;

// ─── Prompt builders ────────────────────────────────────────────────────────

function taxJurisdictionOverview(jurisdiction: PropertyJurisdiction): string {
  const lines: string[] = [
    `This bill was issued in ${jurisdiction.regionName}.`,
    `Assessments there are produced by: ${jurisdiction.authorityName}.`,
    `The value the bill is based on is called: "${jurisdiction.assessedValueTerm}".`,
    `The bill identifies the property by: "${jurisdiction.parcelIdTerm}".`,
    `Documents you may be given: ${jurisdiction.documentTypes.join('; ')}.`,
  ];
  if (jurisdiction.taxableValueTerm) {
    lines.push(
      `Tax is charged on a second, lower figure called "${jurisdiction.taxableValueTerm}"${
        jurisdiction.assessmentRatioPercent !== 100
          ? ` — about ${jurisdiction.assessmentRatioPercent}% of the assessed value`
          : ''
      }. Return the assessed value as assessedValue and this figure as taxableValue.`
    );
  }
  const onBill = jurisdiction.reliefPrograms.filter((p) => p.applyMode === 'on-bill');
  if (onBill.length > 0) {
    lines.push(
      `Relief applied directly ON the bill (so the amount owing is lower than the amount levied): ${onBill
        .map((p) => p.name)
        .join('; ')}.`
    );
  }
  if (jurisdiction.notes) {
    lines.push(`Also true here: ${jurisdiction.notes}`);
  }
  return lines.map((l) => `- ${l}`).join('\n');
}

/** System prompt for the tax-notice extractor, tuned to one jurisdiction. */
export function buildPropertyTaxSystemPrompt(jurisdiction: PropertyJurisdiction | null): string {
  const scope = jurisdiction
    ? `municipal and provincial property tax notices from ${jurisdiction.regionName}, Canada`
    : `Canadian municipal and provincial property tax notices`;

  const grantDuty =
    jurisdiction?.regionCode === 'BC'
      ? `\n4. Parse the Home Owner Grant columns (No Grant / Basic Grant / Senior-Additional Grant)`
      : `\n4. Parse every tax, levy, charge and credit line the notice actually prints, and keep the total LEVIED separate from the amount OWING after credits`;

  const languageDuty =
    !jurisdiction || jurisdiction.languages.includes('fr')
      ? `\n7. Read documents in English or French equally well and report which language you saw`
      : '';

  return `You are an expert document processor specializing in ${scope}.

Your role is to:
1. Extract structured data from property tax notice PDFs and images
2. Identify the municipality, tax year, property, and the account/folio/roll number
3. Parse the total taxes due, due dates, and any advance/instalment amounts${grantDuty}
5. Capture penalty and interest rules and their dates
6. Return confidence scores for extracted fields${languageDuty}

You must return valid JSON only, no additional text or explanation.`;
}

/**
 * The extraction instruction, tuned to one jurisdiction's bill layout. Pass
 * `null` for a generic Canadian prompt that names no province.
 */
export function buildPropertyTaxPrompt(jurisdiction: PropertyJurisdiction | null): string {
  const isBC = jurisdiction?.regionCode === 'BC';

  const heading = jurisdiction
    ? `Analyze this ${jurisdiction.regionName} property tax notice and extract all relevant information.`
    : `Analyze this Canadian property tax notice and extract all relevant information.`;

  const contextBlock = jurisdiction
    ? `\nWhat you already know about where this bill comes from:\n${taxJurisdictionOverview(jurisdiction)}\n`
    : '';

  const hints = jurisdiction ? JURISDICTION_TAX_HINTS[jurisdiction.regionCode] : undefined;
  const layoutBlock = `\n${hints ?? GENERIC_TAX_LAYOUT}\n`;

  const frenchBlock =
    !jurisdiction || jurisdiction.languages.includes('fr') ? `\n${FRENCH_TAX_GLOSSARY}\n` : '';

  const totalTaxMeaning = isBC
    ? `the No-Grant (Column A) amount due`
    : `the amount the notice presents as payable — after any credit already netted off on the bill`;

  const grantField = isBC
    ? `  "homeownerGrant": {
    "eligible": boolean (true when the notice shows Home Owner Grant columns/amounts),
    "basicAmount": number (basic grant amount in dollars, e.g. 570, null if not shown),
    "seniorAmount": number (senior/additional grant amount in dollars, e.g. 845, null if not shown),
    "claimUrl": "string (grant application URL if shown, else null)"
  },`
    : `  "homeownerGrant": {
    "eligible": boolean (true ONLY when this notice itself shows a homeowner grant the owner claims; false otherwise),
    "basicAmount": number or null (grant amount in dollars if the notice shows one),
    "seniorAmount": number or null (senior/additional grant amount in dollars if shown),
    "claimUrl": "string (grant application URL if shown, else null)"
  },`;

  const grantNote = isBC
    ? `- If the notice shows Home Owner Grant columns or amounts, set homeownerGrant.eligible to true.`
    : `- Do NOT invent a homeowner grant. Set homeownerGrant.eligible to false unless this notice itself shows a grant the owner claims. A credit already netted off the bill is a credit line item, not a claimable grant.`;

  return `${heading}
${contextBlock}${layoutBlock}${frenchBlock}
Focus on extracting:
1. **Municipality**: The city/municipality/authority that issued the notice
2. **Tax Year**: The year the notice is for (e.g. 2026)
3. **Property**: Service/property address, account/folio/roll number, access code, legal description, owner name, property class
4. **Assessed Value**: The value the tax is based on — and, where the notice prints a separate taxable/portioned/capped figure, that one too
5. **Financial**: the total levied, any credits netted off, and the amount actually owing${
    isBC ? ', plus the No-Grant / Basic-Grant / Senior-Grant column totals' : ''
  }
6. **Line items**: every tax, levy, charge, credit or rebate line the notice prints, in document order
7. **Payment schedule**: The main due date; and, if the notice shows an advance/instalment payment, its amount and due date
8. **Penalty**: The penalty/interest rule text, its percentage, and the date after which it applies

Return a JSON object with this exact structure:
{
  "municipality": {
    "name": "string (the issuing municipality/authority as printed)"
  },
  "property": {
    "address": "string (property/service address)",
    "folioNumber": "string (the account/folio/roll number exactly as printed, including leading zeros and separators)",
    "accessCode": "string (access code/key if present, else null)",
    "legalDescription": "string or null",
    "ownerName": "string (name(s) on the notice)",
    "propertyClass": "string (e.g. 'Residential', null if not shown)"
  },
  "taxYear": number (e.g. 2026),
  "assessedValue": number (the assessed value in dollars, e.g. 1181000),
  "taxableValue": number or null (the taxable/portioned/capped value the rate is applied to, when the notice prints one separately),
  "assessmentRatioPercent": number or null (percent of the assessed value that is taxed, if the notice states it, e.g. 80 or 45),
  "billingStage": "interim" | "final" | "combined" | "annual" | null (what the notice says it is),
  "financial": {
    "totalTaxAmount": number (${totalTaxMeaning}, in dollars, e.g. 5053.34),
    "taxLevied": number or null (total of all levy/charge lines BEFORE any credit),
    "totalCredits": number or null (total of credit/rebate/grant lines netted off this bill),
    "amountOwing": number or null (what the owner must actually pay AFTER those credits),
    "amountWithBasicGrant": number or null${isBC ? ' (Column B in dollars)' : ' (only if the notice shows such a column)'},
    "amountWithSeniorGrant": number or null${isBC ? ' (Column C in dollars)' : ' (only if the notice shows such a column)'}
  },
  "lineItems": [
    {
      "label": "string (the line's label exactly as printed)",
      "amount": number or null (the line's amount in dollars, ALWAYS POSITIVE),
      "kind": "levy" | "credit" | "grant" | "fee" | "penalty" | "other"
    }
  ],
  "payment": {
    "mainDueDate": "YYYY-MM-DD (main due date)",
    "mainAmount": number (amount due on the main due date in dollars),
    "advanceDueDate": "YYYY-MM-DD (advance/instalment due date, null if none)",
    "advanceAmount": number (advance/instalment amount in dollars, null if none)
  },
${grantField}
  "penalty": {
    "description": "string (penalty/interest rule as printed)",
    "percentage": number (penalty percentage, e.g. 5 or 10, null if not shown),
    "afterDate": "YYYY-MM-DD (date after which the penalty applies, null if not shown)"
  },
  "documentLanguage": "en" or "fr" or null,
  "confidence": {
    "overall": number (0.0-1.0, how confident overall),
    "municipality": number,
    "taxYear": number,
    "financial": number,
    "payment": number
  },
  "rawText": "string (key text snippets that helped extraction, for debugging)"
}

Important notes:
- Convert all money to numbers (e.g. "$5,053.34" -> 5053.34, "5 053,34 $" -> 5053.34); do NOT include thousands separators or currency symbols.
- The assessed value is a whole-dollar number (e.g. "1,181,000" -> 1181000).
- Convert dates to YYYY-MM-DD (e.g. "July 2, 2026" -> "2026-07-02", "2 juillet 2026" -> "2026-07-02").
- Line item amounts are ALWAYS POSITIVE; the "kind" carries the sign. A credit of $1,600 is {"amount": 1600, "kind": "credit"}, never -1600.
- A credit netted off the bill makes the amount owing LESS than the tax levied. Report both, and never substitute one for the other.
- Only report line items that actually appear. Do not invent a levy because a similar bill elsewhere would have one.
- If the notice only shows one due date (no advance/instalment), set advanceDueDate and advanceAmount to null.
${grantNote}
- If a field cannot be found, use null (or [] for arrays). Never invent values.
- The tax year is usually printed at the top (e.g. "2026 PROPERTY TAX NOTICE").`;
}

/**
 * Jurisdiction-neutral defaults, for callers with no household context and for
 * prompt-integrity tests that need a plain string.
 */
export const EXTRACT_PROPERTY_TAX_SYSTEM_PROMPT = buildPropertyTaxSystemPrompt(null);

/** @see buildPropertyTaxPrompt */
export const EXTRACT_PROPERTY_TAX_PROMPT_V1 = buildPropertyTaxPrompt(null);

// ─── Extracted shape ────────────────────────────────────────────────────────
// Every field added for non-BC bills is OPTIONAL, so records extracted by the
// old BC-only prompt keep parsing and keep type-checking.

export type PropertyTaxLineItemKind = 'levy' | 'credit' | 'grant' | 'fee' | 'penalty' | 'other';

/** One printed tax/levy/charge/credit line. `amount` is always positive. */
export interface PropertyTaxLineItem {
  label: string;
  amount: number | null;
  kind: PropertyTaxLineItemKind;
}

export interface ExtractedPropertyTax {
  municipality: {
    name: string | null;
  };
  property: {
    address: string | null;
    folioNumber: string | null;
    accessCode: string | null;
    legalDescription: string | null;
    ownerName: string | null;
    propertyClass: string | null;
  };
  taxYear: number | null;
  assessedValue: number | null;
  /** SK taxable assessment / MB portioned assessment / NS-PE capped value. */
  taxableValue?: number | null;
  /** Percent of the assessed value that is taxed, when the bill states it. */
  assessmentRatioPercent?: number | null;
  /** Ontario's interim vs final bill, and the combined notices elsewhere. */
  billingStage?: 'interim' | 'final' | 'combined' | 'annual' | null;
  financial: {
    totalTaxAmount: number | null;
    amountWithBasicGrant: number | null;
    amountWithSeniorGrant: number | null;
    /** Total of the levy lines BEFORE any credit is netted off. */
    taxLevied?: number | null;
    /** Total of the credit/rebate lines netted off this bill. */
    totalCredits?: number | null;
    /**
     * What is actually payable after those credits. Strictly less than
     * `taxLevied` wherever an on-bill credit applies (Manitoba's Homeowners
     * Affordability Tax Credit, New Brunswick's Residential Property Tax
     * Credit, PEI's provincial credit).
     */
    amountOwing?: number | null;
  };
  /** Every printed tax/levy/charge/credit line, in document order. */
  lineItems?: PropertyTaxLineItem[];
  payment: {
    mainDueDate: string | null;
    mainAmount: number | null;
    advanceDueDate: string | null;
    advanceAmount: number | null;
  };
  homeownerGrant: {
    eligible: boolean;
    basicAmount: number | null;
    seniorAmount: number | null;
    claimUrl: string | null;
  };
  penalty: {
    description: string | null;
    percentage: number | null;
    afterDate: string | null;
  };
  documentLanguage?: 'en' | 'fr' | null;
  confidence: {
    overall: number;
    municipality: number;
    taxYear: number;
    financial: number;
    payment: number;
  };
  rawText: string;
}
