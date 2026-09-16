/**
 * BC Assessment Notice Extraction Prompts
 * Handles TWO related British-Columbia documents that both carry assessed-value
 * data:
 *   1. The annual "Assessment Notice" mailed by BC Assessment every January. It
 *      states the value as of July 1 of the PRIOR year, the land/buildings split,
 *      a multi-year "Property value history" table (year · change% · total), the
 *      property characteristics (year built, beds, baths, floor areas, …), a
 *      recent "Sales history", the roll/jurisdiction number and the appeal
 *      (Notice of Complaint) deadline.
 *   2. The municipal "Tax Account Details / General Assessment" page (e.g. City
 *      of Surrey online services), which lists a full per-year assessment table
 *      broken into Land / Improvements / Total with GROSS·EXEMPT·NET rows, plus
 *      home-owner-grant amounts and the registered owners.
 *
 * The goal is to extract AS MUCH as possible about EVERY year present, not just
 * the current roll year. This is a DIFFERENT document from the municipal
 * property-tax NOTICE — see extract-property-tax.ts for that.
 */

export const EXTRACT_BC_ASSESSMENT_SYSTEM_PROMPT = `You are an expert document processor specializing in British Columbia property assessment documents — both the annual BC Assessment "Assessment Notice" and municipal "Tax Account Details / General Assessment" pages.

Your role is to:
1. Extract structured data from BC Assessment PDFs and images
2. Identify the current assessment (roll) year, jurisdiction, roll/folio number, jurisdiction number and PID
3. Parse the current total assessed value and the split between land value and buildings/improvements value
4. Capture the COMPLETE multi-year value history — every year shown in any "Property value history" or "General Assessment" table, each with its total, land, improvements and year-over-year change when available
5. Capture the property's physical characteristics (year built, description, bedrooms, baths, carports, garages, land size, floor/basement areas, storeys, leasable areas, manufactured-home details)
6. Capture the sales history, the registered owner(s), the home-owner-grant amounts and the appeal (Notice of Complaint) deadline
7. Return confidence scores for extracted fields

Be exhaustive: if the document shows seven years of assessments, return seven history entries. Never truncate the history. You must return valid JSON only, no additional text or explanation.`;

export const EXTRACT_BC_ASSESSMENT_PROMPT_V1 = `Analyze this BC Assessment document and extract EVERYTHING it contains about the property, across ALL years shown.

The document is one of:
- A BC Assessment "Assessment Notice": shows the current total assessed value (as of July 1 of the year BEFORE the printed roll year — e.g. a "2026 Assessment" reflects value as of July 1, 2025), the split into "Land" and "Buildings/Improvements", a "Property value history" table listing several prior years (each row: year, % change, total value), a "Property information" block (year built, description, bedrooms, baths, carports, garages, land size, first/second floor area, basement finish area, strata area, building storeys, gross/net leasable area, manufactured home), a "Sales history" list, the legal description + PID, jurisdiction + roll number, and an appeal deadline.
- A municipal "Tax Account Details" page: shows a folio, PID, address, legal description, home-owner-grant amounts (Basic / Additional / Claimed), the registered owners, and one "General Assessment" table PER YEAR broken into Land / Improvements / Total with Residential GROSS, EXEMPT and NET rows.

Extract as much as possible. Do NOT limit yourself to the current year — capture every year present in every value/assessment table.

Return a JSON object with this EXACT structure:
{
  "assessmentYear": number (the current/most-recent roll year, e.g. 2026; null if none),
  "property": {
    "address": "string (civic/property address, else null)",
    "rollNumber": "string (roll or folio number, e.g. '6282-89962-X', else null)",
    "jurisdiction": "string (municipality/area name, e.g. 'Surrey', else null)",
    "jurisdictionNumber": "string (numeric jurisdiction code, e.g. '326', else null)",
    "pid": "string (Parcel Identifier, e.g. '003-110-320', else null)",
    "propertyClass": "string (e.g. '01 - Residential' or 'Residential', else null)",
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
    "strataAreaSqFt": number or null,
    "buildingStoreys": number or null,
    "grossLeasableAreaSqFt": number or null,
    "netLeasableAreaSqFt": number or null,
    "manufacturedHome": boolean or null (true only if the doc indicates a manufactured/mobile home)
  },
  "values": {
    "totalValue": number (current-year total assessed value in dollars, e.g. 1181000; null if none),
    "landValue": number (current-year land portion in dollars, null if not shown),
    "improvementValue": number (current-year buildings/improvements portion in dollars, null if not shown),
    "previousYearValue": number (immediately-prior-year total in dollars, null if not shown)
  },
  "valueHistory": [
    {
      "year": number (assessment/roll year, e.g. 2024),
      "totalValue": number or null (total assessed value that year, in dollars),
      "landValue": number or null (land portion that year, in dollars),
      "improvementValue": number or null (buildings/improvements portion that year, in dollars),
      "exemptValue": number or null (exempt portion if a GROSS/EXEMPT/NET table is shown, usually 0),
      "netValue": number or null (net taxable value if shown = gross - exempt),
      "changePercent": number or null (year-over-year % change as shown, e.g. -5, 12, 35)
    }
  ],
  "salesHistory": [
    { "date": "YYYY-MM-DD (sale date, null if unclear)", "price": number or null (sale price in dollars) }
  ],
  "homeownerGrant": {
    "basicGrant": number or null (Basic Home Owner Grant amount in dollars),
    "additionalGrant": number or null (Additional Home Owner Grant amount in dollars),
    "grantClaimed": number or null (amount already claimed in dollars)
  },
  "appealDeadline": "YYYY-MM-DD (last day to file a complaint/appeal, null if not shown)",
  "confidence": {
    "overall": number (0.0-1.0),
    "assessmentYear": number,
    "values": number,
    "property": number
  },
  "rawText": "string (key text snippets that helped extraction, for debugging)"
}

Important rules:
- Include EVERY year that appears in any value/assessment/history table as its own entry in "valueHistory" — including the current year. Order does not matter (the app sorts).
- On a BC Assessment notice, the "Property value history" table usually gives only year + %change + total; fill landValue/improvementValue for a year ONLY when that year's split is actually shown (typically the current and prior year). Leave the rest null — do NOT guess.
- On a municipal "General Assessment" page, use the Residential NET (or GROSS if NET absent) row for landValue/improvementValue/totalValue, and capture exemptValue/netValue when the GROSS/EXEMPT/NET breakdown is present.
- Convert all money to plain integer dollars (e.g. "$1,181,000" -> 1181000, "1,081,000" -> 1081000); no separators, no currency symbols, no cents.
- Land value + improvement value usually sum to the total; if only some are shown, return what you find and leave the rest null.
- Convert all dates to YYYY-MM-DD (e.g. "January 31, 2026" -> "2026-01-31", "Jun 12, 2025" -> "2025-06-12").
- The current assessment/roll year is usually printed prominently (e.g. "2026 Assessment as of July 1, 2025" or "Total value $1,181,000"). If several years are present, "assessmentYear" is the most recent one.
- Return owners as printed; put the first in "ownerName" and all of them in "owners".
- If a field cannot be found, use null (or [] for arrays). Never invent values.`;

export interface BCAssessmentValueHistoryYear {
  year: number;
  totalValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  exemptValue: number | null;
  netValue: number | null;
  changePercent: number | null;
}

export interface BCAssessmentSale {
  date: string | null;
  price: number | null;
}

export interface BCAssessmentPropertyInfo {
  yearBuilt: number | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carports: number | null;
  garages: string | null;
  landSizeSqFt: number | null;
  firstFloorAreaSqFt: number | null;
  secondFloorAreaSqFt: number | null;
  basementFinishAreaSqFt: number | null;
  strataAreaSqFt: number | null;
  buildingStoreys: number | null;
  grossLeasableAreaSqFt: number | null;
  netLeasableAreaSqFt: number | null;
  manufacturedHome: boolean | null;
}

export interface BCAssessmentHomeownerGrant {
  basicGrant: number | null;
  additionalGrant: number | null;
  grantClaimed: number | null;
}

export interface ExtractedBCAssessment {
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
  };
  propertyInfo: BCAssessmentPropertyInfo;
  values: {
    totalValue: number | null;
    landValue: number | null;
    improvementValue: number | null;
    previousYearValue: number | null;
  };
  valueHistory: BCAssessmentValueHistoryYear[];
  salesHistory: BCAssessmentSale[];
  homeownerGrant: BCAssessmentHomeownerGrant | null;
  appealDeadline: string | null;
  confidence: {
    overall: number;
    assessmentYear: number;
    values: number;
    property: number;
  };
  rawText: string;
}
