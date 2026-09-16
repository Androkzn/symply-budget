/** Client-side BYOK schema/prompts for mortgage statement extract. */

export const MORTGAGE_STATEMENT_IMPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'lender',
    'product_type',
    'has_heloc_portion',
    'mortgage_number_last4',
    'statement_date',
    'closing_balance',
    'interest_paid',
    'principal_paid',
    'payment_amount',
    'interest_rate',
    'confidence',
  ],
  properties: {
    lender: { type: ['string', 'null'] },
    product_type: {
      type: ['string', 'null'],
      enum: ['standard', 'heloc_flexline', 'step', null],
    },
    has_heloc_portion: { type: 'boolean' },
    mortgage_number_last4: { type: ['string', 'null'] },
    statement_date: { type: ['string', 'null'] },
    period_start: { type: ['string', 'null'] },
    period_end: { type: ['string', 'null'] },
    opening_balance: { type: ['number', 'null'] },
    closing_balance: { type: ['number', 'null'] },
    interest_paid: { type: ['number', 'null'] },
    interest_charged: { type: ['number', 'null'] },
    principal_paid: { type: ['number', 'null'] },
    payment_amount: { type: ['number', 'null'] },
    interest_rate: { type: ['number', 'null'] },
    prime_rate: { type: ['number', 'null'] },
    variance: { type: ['number', 'null'] },
    rate_periods: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['effective_date', 'interest_rate'],
        properties: {
          effective_date: { type: 'string' },
          interest_rate: { type: 'number' },
          prime_rate: { type: ['number', 'null'] },
          variance: { type: ['number', 'null'] },
        },
      },
    },
    rate_type: { type: ['string', 'null'], enum: ['fixed', 'variable', null] },
    payment_frequency: { type: ['string', 'null'] },
    property_tax_paid: { type: ['number', 'null'] },
    remaining_amortization: { type: ['string', 'null'] },
    maturity_date: { type: ['string', 'null'] },
    new_advance_amount: { type: ['number', 'null'] },
    confidence: { type: 'number' },
  },
};

export const MORTGAGE_STATEMENT_IMPORT_SYSTEM = `Extract a Canadian residential mortgage statement into structured fields.
PRIVACY: NEVER output full account numbers or borrower names — last 4 digits only in mortgage_number_last4.
For FlexLine/STEP products use the TERM PORTION closing balance, not the revolving limit.
Amounts are dollars (not cents). Return ONLY via the tool.`;

export function buildMortgageStatementImportUserPrompt(sourceText?: string): string {
  if (sourceText?.trim()) {
    return `Extract the mortgage statement fields from this text:\n\n${sourceText.trim()}`;
  }
  return 'Extract the mortgage statement fields from the attached image(s).';
}
