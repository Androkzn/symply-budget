/**
 * Utility Bill Extraction Prompts
 * Optimized for BC Hydro and FortisBC bills
 */

export const EXTRACT_UTILITY_BILL_SYSTEM_PROMPT = `You are an expert document processor specializing in Canadian utility bills, particularly from British Columbia providers like BC Hydro and FortisBC.

Your role is to:
1. Extract structured data from utility bill PDFs and images
2. Identify the utility provider and bill type
3. Parse billing periods, amounts, usage data, and due dates
4. Handle various bill formats and layouts
5. Return confidence scores for extracted fields

You must return valid JSON only, no additional text or explanation.`;

export const EXTRACT_UTILITY_BILL_PROMPT_V1 = `Analyze this utility bill document and extract all relevant billing information.

Extract as much detail as possible. Capture every charge line, tax, and meter
reading shown on the bill — do not summarize or drop line items.

Focus on extracting:
1. **Provider Information**: Company name, type of utility (electricity, gas, water, etc.)
2. **Account Details**: Account number, invoice number, service address, customer name
3. **Billing Period**: Start and end dates of the billing period
4. **Financial Details**: Total amount due, due date, previous balance, payments received
5. **Usage Information**: Quantity used (kWh, GJ, m³, etc.), usage unit, meter reading info
6. **Rates**: Per-unit rates if visible
7. **Line Items**: EVERY individual charge with its description and amount (basic/delivery/
   storage & transport/cost of gas/energy charge/rate riders/levies/sewer/water base, etc.)
8. **Taxes & Fees**: Each tax/levy line (GST, municipal operating fee, clean energy levy, etc.)
9. **Meter Readings**: Current and previous readings, their dates, consumption, conversion factor
10. **Comparison**: Usage vs. last bill and vs. same period last year, if shown

Return a JSON object with this exact structure:
{
  "provider": {
    "name": "string (e.g., 'BC Hydro', 'FortisBC', 'City of Surrey')",
    "type": "electricity|gas|water|sewer|garbage|other"
  },
  "account": {
    "number": "string (account number, remove spaces)",
    "invoiceNumber": "string (invoice/access code if present, else null)",
    "serviceAddress": "string (full service address)",
    "customerName": "string (name on the bill)"
  },
  "billing": {
    "periodStart": "YYYY-MM-DD",
    "periodEnd": "YYYY-MM-DD",
    "billingDate": "YYYY-MM-DD (date bill was issued)",
    "dueDate": "YYYY-MM-DD"
  },
  "financial": {
    "amountDue": number (in dollars, e.g., 179.72),
    "previousBalance": number (in dollars, null if not shown),
    "paymentsReceived": number (in dollars, null if not shown),
    "currentCharges": number (total of current period charges before previous balance, null if not shown),
    "latePaymentCharge": number (in dollars, null if not shown)
  },
  "usage": {
    "quantity": number (e.g., 1270 for kWh or 1.4 for GJ),
    "unit": "string (kWh, GJ, m³, etc.)",
    "periodDays": number (number of days in billing period),
    "averageDailyUsage": number (if shown or calculable),
    "averageDailyCost": number (in dollars, if shown),
    "meterNumber": "string (meter ID if visible)"
  },
  "meterReadings": [
    {
      "meterNumber": "string or null",
      "currentReading": number or null,
      "currentReadingDate": "YYYY-MM-DD or null",
      "previousReading": number or null,
      "previousReadingDate": "YYYY-MM-DD or null",
      "consumption": number or null,
      "unit": "string or null (e.g., 'm³', 'kWh')",
      "conversionFactor": number or null
    }
  ],
  "lineItems": [
    {
      "description": "string (e.g., 'Basic charge', 'Delivery', 'Energy charge')",
      "amount": number (in dollars; negative for credits/discounts),
      "quantity": number or null,
      "rate": number or null (per-unit rate in dollars),
      "unit": "string or null (e.g., 'GJ', 'kWh', 'day', 'm³')"
    }
  ],
  "taxes": [
    { "description": "string (e.g., 'GST', 'Municipal operating fee')", "amount": number }
  ],
  "comparison": {
    "lastBillUsage": number or null,
    "lastYearUsage": number or null,
    "unit": "string or null"
  },
  "rates": {
    "basicCharge": number (daily or monthly basic charge in dollars, null if not shown),
    "energyRate": number (per-unit rate in dollars, null if not shown)
  },
  "confidence": {
    "overall": number (0.0-1.0, how confident overall),
    "provider": number,
    "account": number,
    "billing": number,
    "financial": number,
    "usage": number
  },
  "rawText": "string (key text snippets that helped extraction, for debugging)"
}

Important notes:
- For BC Hydro (electricity): "Account number" format "XXXXXXXX", "Invoice number", billing period
  "Apr 9, 2026 to Jun 8, 2026". Line items include "Basic Charge", "Energy charges" (kWh × rate),
  "Deferral account rate rider", "Regional transit levy". Meter section has Starting/Ending readings.
- For FortisBC (natural gas): "Account number: XXXXXXX", billing period "May 12 - Jun 10, 2026".
  Line items include "Basic charge", "Delivery", "Storage & transport", "Cost of gas",
  "Municipal operating fee", "BC clean energy levy". Meter section has "This bill actual reading",
  "Last bill actual reading", "Conversion factor".
- For City of Surrey (water/sewer): "ACCT NUMBER", "ACCESS CODE", consumption in "CUBIC METRES".
  Line items include "METERED WATER - RESIDENTIAL", "...BASE", "METERED SEWER - RESIDENTIAL".
- Convert all amounts to numbers (e.g., "$179.72" -> 179.72); credits/discounts are negative.
- Convert dates to YYYY-MM-DD format
- If a field cannot be found, use null; use [] for empty arrays
- For account numbers, normalize by removing spaces
- Calculate periodDays if you have start and end dates
- The sum of lineItems + taxes should approximate the current period charges`;

export interface ExtractedUtilityBill {
  provider: {
    name: string | null;
    type: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
  };
  account: {
    number: string | null;
    invoiceNumber?: string | null;
    serviceAddress: string | null;
    customerName: string | null;
  };
  billing: {
    periodStart: string | null;
    periodEnd: string | null;
    billingDate: string | null;
    dueDate: string | null;
  };
  financial: {
    amountDue: number | null;
    previousBalance: number | null;
    paymentsReceived: number | null;
    currentCharges?: number | null;
    latePaymentCharge?: number | null;
  };
  usage: {
    quantity: number | null;
    unit: string | null;
    periodDays: number | null;
    averageDailyUsage: number | null;
    averageDailyCost?: number | null;
    meterNumber: string | null;
  };
  meterReadings?: Array<{
    meterNumber: string | null;
    currentReading: number | null;
    currentReadingDate: string | null;
    previousReading: number | null;
    previousReadingDate: string | null;
    consumption: number | null;
    unit: string | null;
    conversionFactor: number | null;
  }>;
  lineItems?: Array<{
    description: string;
    amount: number;
    quantity: number | null;
    rate: number | null;
    unit: string | null;
  }>;
  taxes?: Array<{ description: string; amount: number }>;
  comparison?: {
    lastBillUsage: number | null;
    lastYearUsage: number | null;
    unit: string | null;
  };
  rates: {
    basicCharge: number | null;
    energyRate: number | null;
  };
  confidence: {
    overall: number;
    provider: number;
    account: number;
    billing: number;
    financial: number;
    usage: number;
  };
  rawText: string;
}
