/** Client-side receipt BYOK prompts — mirrors backend scan-grocery-receipt v2. */

export const RECEIPT_IMPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendor',
    'purchase_date',
    'items',
    'tax_summary',
    'subtotal',
    'total',
    'receipt_country',
    'receipt_region',
    'receipt_currency',
  ],
  properties: {
    vendor: {
      type: 'string',
      description: 'Store name. Use "Other" if unreadable — never null.',
    },
    purchase_date: { type: ['string', 'null'] },
    receipt_country: { type: ['string', 'null'] },
    receipt_region: { type: ['string', 'null'] },
    receipt_currency: {
      type: ['string', 'null'],
      description:
        'ISO 4217 code PRINTED on the receipt (USD, CAD, EUR…) or a unique symbol. Null for a bare "$" — never inferred from the store address.',
    },
    items: {
      type: 'array',
      description:
        'One entry per purchased PRODUCT. Attach deposits/recycling/CRV/bag fees in fees[]. Do NOT emit fee or discount lines as items. Do NOT collapse products into Tomatoes or Alcohol.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'raw_name',
          'raw_code',
          'name',
          'name_suggestions',
          'amount',
          'saved_amount',
          'tax_codes',
          'category',
          'category_suggestions',
          'fees',
          'quantity',
          'unit',
        ],
        properties: {
          raw_name: { type: 'string' },
          raw_code: { type: ['string', 'null'] },
          name: {
            type: 'string',
            description:
              'DEFAULT to the broadest everyday product class a shopper recognises at a glance ("Milk", not "Prt Skm Milk 1%") — unless the item is protected by the no-semantic-merge rule (Kumato Tomato, Canadian Club), which keeps its specific identity instead.',
          },
          quantity: {
            type: ['number', 'null'],
            description:
              'Quantity when the line states one (fuel volume, weight). Null for ordinary counted items.',
          },
          unit: {
            type: ['string', 'null'],
            description:
              'Unit for quantity exactly as printed: G/gal for gallons, L for litres, lb/kg for weight. Null when the line is a plain count.',
          },
          name_suggestions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Up to 7 guesses ordered GENERIC \u2192 SPECIFIC: broad everyday class first (usually equal to name), Title Case of raw_name verbatim last.',
          },
          amount: { type: 'integer', description: 'Pre-tax cents paid, fees included' },
          saved_amount: { type: 'integer' },
          tax_codes: { type: 'array', items: { type: 'string' } },
          category: { type: ['string', 'null'] },
          category_suggestions: { type: 'array', items: { type: 'string' } },
          fees: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'label', 'amount'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['deposit', 'environmental', 'bag', 'crv', 'other'],
                },
                label: { type: 'string' },
                amount: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    tax_summary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'label', 'rate_percent', 'amount'],
        properties: {
          code: { type: ['string', 'null'] },
          label: { type: 'string' },
          rate_percent: { type: ['number', 'null'] },
          amount: { type: 'integer' },
        },
      },
    },
    subtotal: { type: ['integer', 'null'] },
    total: { type: ['integer', 'null'] },
  },
};

export const RECEIPT_IMPORT_SYSTEM = `You are a receipt reader. Extract every purchased PRODUCT from any kind of receipt (grocery, liquor, pharmacy, electronics, household, services).

Rules:
- Fees attach to the parent: deposit / recycling / enviro / CRV / bag go in fees[] and are included in amount. Do NOT emit them as their own items.
- Discounts (ARCP, TPD/#####, lmt, regular-vs-paid) fold into saved_amount. Attach TPD/##### by item code.
- Do NOT semantically merge. Kumato Tomato stays Kumato, not Tomatoes. Canadian Club stays Canadian Club, not Alcohol. Collapse only shared raw_code (or identical raw_name when no code).
- raw_name is the printed line. raw_code is UPC/PLU/retailer item # digits or null.
- name: DEFAULT to the broadest everyday product class a shopper recognises
  at a glance — Milk, not "Prt Skm Milk 1%"; Dessert, not "Trads Fudge". This
  is what the shopper sees FIRST, before tapping anything, so lead generic
  even when the printed line names a specific brand, flavour or size.
  Exception: the items the merge rule above protects keep their recognisable
  identity as name instead (Kumato Tomato, Canadian Club) — their broad class
  is still offered in name_suggestions, just never forced into name.
- name_suggestions: up to 7 guesses ordered GENERIC → SPECIFIC — the reverse
  of how the receipt reads. Two rungs are mandatory:
  (1) FIRST rung matches name — the broad everyday class from the rule
      above, and
  (2) LAST rung is Title Case of raw_name verbatim (ICE CREAM 4L → Ice Cream 4l),
      so the exact printed variant is never lost, only never the default.
  The generic rung leads for a reason: it is how someone groups a year of
  receipts. Never default to the brand or the flavour, even though it stays
  one tap away.
  PRT SKM MILK 1% → Milk, Dairy, Partly Skimmed Milk 1%, Prt Skm Milk 1%
  TRADS FUDGE → Dessert, Fudge, Chocolate Fudge, Traditional Fudge, Trads Fudge
  FRUIT BTF   → Candy, Fruit Snack, Fruit Bites, Fruit Btf
- amount is PRE-TAX cents paid, fees included, tax excluded.
- quantity / unit: fill these ONLY when the line states a measured amount. A fuel line prints both ("Supreme-+ 10.068G" with "PRICE/GAL $6.099" → quantity 10.068, unit "G"); so does produce sold by weight ("CARROTS 2.4 lb"). Copy the unit as printed and do NOT convert it. A plain counted item is quantity null, unit null — "2 @ $3.00" is a count, not a measure.
- tax_codes: single uppercase letters printed on the line (G, P, L, H). [] if none. RJ/RQ with $0 tax are not tax flags.
- category and category_suggestions: verbatim household names or null / [].
- vendor: store name, or "Other" if unreadable.
- receipt_currency: ONLY a currency the receipt PRINTS — an explicit code ("USD", "CAD $", "EUR") or a symbol unique to one currency (£ € ₹ R$). Do NOT infer it from the store's address: report the address in receipt_country/receipt_region and leave this null. A bare "$" is null. The app pairs the address with the member's own region to decide, and a guess here overrides that.
- Exclude subtotal / total / tax / payment / loyalty rows.
Never invent items.`;

export function buildReceiptImportUserPrompt(categoryNames: string[], sourceText?: string): string {
  const categories =
    categoryNames.length > 0
      ? `Household categories (pick verbatim or null): ${categoryNames.join(', ')}`
      : 'No category list — use null categories.';
  const extra = sourceText?.trim()
    ? `\n\nRefine this local draft extracted from receipt text:\n${sourceText.trim()}`
    : '\n\nRead the attached receipt image(s) and extract every purchased product.';
  return `${categories}${extra}`;
}
