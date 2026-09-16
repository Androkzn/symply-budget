/**
 * Receipt scanning — single-step vision extraction (v2).
 *
 * Reads a photo (or PDF) of ANY purchase receipt and returns each purchased
 * line item with a human name, up to 7 name suggestions (including Title Case
 * of the printed line), category + alt names, attached fees, and raw tax flags.
 * Amounts are always in CENTS. Fees (deposit / environmental / CRV / bag)
 * attach to the parent item — they are never their own expenses.
 *
 * Do NOT semantically merge similar foods ("Tomatoes") or drinks ("Alcohol").
 * Collapse only lines that share the same printed item code, or the exact same
 * raw name when no code is present.
 *
 * MULTI-SEGMENT: several images may be consecutive parts of ONE long receipt.
 */

export type RawReceiptFeeKind = 'deposit' | 'environmental' | 'bag' | 'crv' | 'other';

export interface RawGroceryReceiptFee {
  kind: RawReceiptFeeKind;
  label: string;
  amount: number;
}

export interface RawGroceryReceiptItem {
  /** Printed line as read (SKU / cryptic text). */
  raw_name: string;
  /** UPC / PLU / retailer item # digits, or null. */
  raw_code: string | null;
  /** Best human name in Title Case. */
  name: string;
  /** ≤7 guesses; MUST include Title Case of raw_name. */
  name_suggestions: string[];
  /** PRE-tax price paid for this line, in CENTS (after any discount, fees included). */
  amount: number;
  /** Amount saved on this line via discount/sale, in CENTS. 0 if full price. */
  saved_amount: number;
  /**
   * Raw sales-tax flag letters printed against THIS line, each as a single
   * uppercase letter (e.g. ["G"], ["G","P"], ["H"], ["L"]). Split combined
   * markers like "GP" into ["G","P"]. Empty array when the line carries no
   * tax flag. These letters map to the codes in `tax_summary`.
   */
  tax_codes: string[];
  /**
   * Best-fit spending category for this item, chosen VERBATIM from the
   * household's category list supplied in the prompt, or null when none fits.
   */
  category?: string | null;
  /** Up to 3 alternate household category names, verbatim. */
  category_suggestions?: string[];
  /** Fees attached to THIS parent item. Never emit fees as their own items. */
  fees?: RawGroceryReceiptFee[];
}

/** One tax line from the receipt's summary/legend, e.g. "(P) PST 7%  4.41". */
export interface RawGroceryReceiptTax {
  code: string | null;
  label: string;
  rate_percent: number | null;
  amount: number;
}

export interface RawGroceryReceipt {
  /** Store name, or "Other" if unreadable. Never null. */
  vendor: string;
  purchase_date: string | null;
  items: RawGroceryReceiptItem[];
  tax_summary: RawGroceryReceiptTax[];
  subtotal: number | null;
  total: number | null;
  receipt_country?: string | null;
  receipt_region?: string | null;
  /** ISO 4217 the prices are printed in, or null when nothing said. */
  receipt_currency?: string | null;
}

export const SCAN_GROCERY_RECEIPT_SCHEMA: Record<string, unknown> = {
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
      description:
        'Store / merchant name printed on the receipt. Use "Other" if unreadable — never null.',
    },
    purchase_date: {
      type: ['string', 'null'],
      description:
        'Purchase date as YYYY-MM-DD if printed on the receipt (convert any format), else null.',
    },
    receipt_country: {
      type: ['string', 'null'],
      description: 'Country from the printed store address if present (CA, US, …), else null.',
    },
    receipt_region: {
      type: ['string', 'null'],
      description:
        'Province/state from the printed store address if present (BC, ON, CA, …), else null.',
    },
    receipt_currency: {
      type: ['string', 'null'],
      description:
        'ISO 4217 code PRINTED on the receipt (USD, CAD, EUR, GBP, JPY, …) or a symbol unique to one currency. Null for a bare "$" — never inferred from the store address, which is reported separately.',
    },
    items: {
      type: 'array',
      description:
        'One entry per purchased PRODUCT. Attach bottle deposits, recycling/enviro levies, CRV, and bag fees to the parent item in `fees` — do NOT emit those as their own items. Do NOT emit discount/rebate lines (ARCP, TPD/#####, YOU SAVED) as items — fold them into the parent `saved_amount`. Do NOT emit receipt summary rows (subtotal, total, tax totals, amount tendered, payment/change, loyalty). Do NOT collapse different products into "Tomatoes" or "Alcohol".',
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
          raw_name: {
            type: 'string',
            description: 'The line as printed (SKU / cryptic text), e.g. "LBRT GRK PHAPLE" or "ICE CREAM 4L".',
          },
          raw_code: {
            type: ['string', 'null'],
            description:
              'UPC, PLU, or retailer item number printed on the line (digits only), or null. Costco item # and Superstore UPC belong here. For a TPD/610845 rebate, this is 610845 on the PARENT, not a separate item.',
          },
          name: {
            type: 'string',
            description:
              'DEFAULT to the broadest everyday product class a shopper recognises at a glance ("Milk", not "Partly Skimmed Milk 1%"; "Dessert", not "Traditional Fudge") — this is what leads the row before anyone taps anything. Exception: keep distinct products distinct when the specific identity IS the point — "Kumato Tomato" stays Kumato, not "Tomatoes"; "Canadian Club" stays Canadian Club, not "Alcohol". Expand cryptic SKUs either way ("LBRT GRK PHAPLE" → "Liberte Greek Pineapple").',
          },
          name_suggestions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Up to 7 name guesses ordered GENERIC to SPECIFIC. First entry should match `name` (the broad everyday class). MUST also include the Title Case of raw_name as the LAST entry (e.g. "ICE CREAM 4L" → "Ice Cream 4l").',
          },
          amount: {
            type: 'integer',
            description:
              'PRE-TAX price PAID for this line in CENTS (dollars x 100), AFTER subtracting any discount shown for it but BEFORE sales tax, INCLUDING attached fees. e.g. $5.49 → 549. Must be >= 0. Do NOT add tax here.',
          },
          saved_amount: {
            type: 'integer',
            description:
              'How much was saved on this line via a sale/discount/coupon/member price, in CENTS. Look for negative lines, "ARCP", "TPD/#####", "SAVED", "-$X.XX", "lmt", or a regular-vs-sale / struck-through price difference tied to this item (including by item code). 0 if the item was full price.',
          },
          tax_codes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The raw sales-tax flag letters printed next to THIS line, each a single UPPERCASE letter. Split a combined marker: "GP" → ["G","P"]. BC liquor often prints "L" (PST Liquor 10%) plus "G" (GST). Use [] when the line has NO tax flag. These letters must match a `code` in `tax_summary`. Copy exactly what is printed; do NOT invent flags. Store status codes like RJ/RQ with $0 tax are NOT tax flags.',
          },
          category: {
            type: ['string', 'null'],
            description:
              'The single best-fit spending category for THIS item, copied VERBATIM (exact spelling and case) from the household category list given in the user message. Fresh/pantry food → "Groceries"; alcoholic drinks → the alcohol/liquor category if present else "Groceries". If the list has none that reasonably fits, use null. NEVER invent a category name that is not in the provided list.',
          },
          category_suggestions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Up to 3 alternate household category names, copied VERBATIM. Empty array if no alts. Never invent names.',
          },
          fees: {
            type: 'array',
            description:
              'Fees that belong to THIS product. kind: deposit (refundable container), environmental (recycling/enviro levy — not refundable), crv (US CRV), bag, other. Superstore "RECYCLING FEE" / Costco "ENVIRO" → environmental. "DEPOSIT" / "Container Deposit" → deposit. US "CRV" → crv. Never list these as separate items.',
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
                amount: {
                  type: 'integer',
                  description: 'Fee amount in CENTS.',
                },
              },
            },
          },
        },
      },
    },
    tax_summary: {
      type: 'array',
      description:
        'Every SALES-TAX line from the receipt summary or legend (e.g. "(P) PST 7%  4.41", "(G) GST 5%  4.75", "(L) PST Liquor 10%", "HST 13%  6.50"). One entry per tax line. Empty array [] only if the receipt shows no tax at all.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'label', 'rate_percent', 'amount'],
        properties: {
          code: {
            type: ['string', 'null'],
            description:
              'The single UPPERCASE flag letter this tax line applies to (e.g. "G", "P", "H", "L"). Use null only when the receipt prints one unlabelled TAX total with no per-item letters.',
          },
          label: {
            type: 'string',
            description: 'Tax name as printed: "GST", "PST", "PST Liquor", "HST", "QST", "VAT", or "Sales Tax".',
          },
          rate_percent: {
            type: ['number', 'null'],
            description: 'Percent rate as printed (5, 7, 10, 13, 20, ...), or null if not shown.',
          },
          amount: {
            type: 'integer',
            description: 'Tax amount charged for this line in CENTS (dollars x 100). e.g. $4.41 → 441.',
          },
        },
      },
    },
    subtotal: {
      type: ['integer', 'null'],
      description: 'Pre-tax subtotal in CENTS if printed on the receipt, else null.',
    },
    total: {
      type: ['integer', 'null'],
      description: 'Grand total actually charged (with tax) in CENTS if printed, else null.',
    },
  },
};

export const SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT = `You are a receipt reader. You are given one OR MORE images (or a PDF) of a purchase receipt of ANY kind — grocery/supermarket, liquor/alcohol, pharmacy, electronics, hardware, clothing, restaurant, gas station, department store, online order, etc. Extract every purchased PRODUCT as a separate entry, whatever the item type, and capture the receipt's sales-tax breakdown.

MULTIPLE IMAGES = ONE RECEIPT: When several images are provided, they are consecutive sections of ONE long receipt photographed in parts. Read them in the given order as a single continuous receipt, top to bottom. Do NOT treat them as separate receipts. If a line is visible at the bottom of one image and repeats at the top of the next (overlap), count it only ONCE. There is exactly ONE tax summary and ONE grand total for the whole receipt — it usually appears on the last section.

Rules:
- Read ANY kind of item: food, drinks, alcohol, electronics, clothing, household goods, pet supplies, medicine, services. Do NOT limit yourself to groceries and do NOT skip an item just because it is not food.
- FEES ATTACH TO THE PARENT: bottle deposits, container deposits, recycling fees, enviro/environmental levies, CRV, and bag fees belong in that product's \`fees\` array and are included in its \`amount\`. Do NOT emit them as their own items. Superstore "RECYCLING FEE" / Costco "ENVIRO" → kind environmental. "DEPOSIT" / "Container Deposit" → kind deposit. US "CRV" → kind crv. Ignore fee *subtotals* and payment/tax/total rows.
- DISCOUNTS ATTACH BY CODE: "TPD/610845", "ARCP", "lmt", struck-through regular vs paid, and "YOU SAVED" lines fold into the parent item's \`saved_amount\`. Attach TPD/##### by the referenced item number, not "the line above".
- Do NOT semantically merge. "Kumato Tomato" and "Vine Tomato" stay two items (not "Tomatoes"). Beer and whisky stay two items (not "Alcohol"). Collapse ONLY lines that share the same raw_code, or the exact same raw_name when no code is printed.
- raw_name: the line as printed. raw_code: UPC / PLU / retailer item # digits, or null.
- name: DEFAULT to the broadest everyday product class a shopper recognises at a glance ("Milk", not "Prt Skm Milk 1%"; "Dessert", not "Trads Fudge") — this is what leads the row before anyone taps anything, so lead generic even when the printed line names a specific brand, flavour, or size. Exception: keep distinct products distinct when the specific identity is the point of the purchase — "Kumato Tomato" stays Kumato, not "Tomatoes"; "Canadian Club" stays Canadian Club, not "Alcohol"; their broad class still appears in name_suggestions, just never forced into name. Expand cryptic SKUs either way ("LBRT GRK PHAPLE" → "Liberte Greek Pineapple").
- name_suggestions: up to 7 guesses ordered GENERIC → SPECIFIC — the reverse of how the receipt reads. Two rungs are MANDATORY: (1) the FIRST rung matches name — the broad everyday class from the rule above, and (2) the LAST rung is the Title Case of raw_name verbatim ("ICE CREAM 4L" → "Ice Cream 4l"), so the exact printed variant is never lost, only never the default. The generic rung leads for a reason: it is how someone groups a year of receipts. Never default to the brand or the flavour, even though it stays one tap away. WORKED EXAMPLES: "PRT SKM MILK 1%" → ["Milk","Dairy","Partly Skimmed Milk 1%","Prt Skm Milk 1%"]; "TRADS FUDGE" → ["Dessert","Fudge","Chocolate Fudge","Traditional Fudge","Trads Fudge"]; "FRUIT BTF" → ["Candy","Fruit Snack","Fruit Bites","Fruit Btf"].
- Transcribe carefully; do NOT guess an unrelated item from a partial word. If a code is genuinely unreadable, use a broad category ("grocery item", "household item") rather than inventing something specific.
- quantity / unit: fill these ONLY when the line states a measured amount, copying the unit EXACTLY as printed and never converting it. A fuel pump line prints both ("Supreme-+ 10.068G" alongside "PRICE/GAL $6.099" → quantity 10.068, unit "G"); so does anything sold by weight ("CARROTS ORG 2.4 lb"). A plain counted item is quantity null and unit null — "2 @ $3.00" is a count, not a measure.
- amount: the PRE-TAX price actually PAID for that line, in CENTS, after any discount applied to it but BEFORE sales tax, INCLUDING attached fees. Never fold tax into amount.
- saved_amount: the discount/sale/coupon/member savings for that line, in CENTS (0 if full price). Include regular-vs-sale / "lmt" differences, not only ARCP.
- tax_codes: copy the raw sales-tax flag letters printed next to the line, each as a single UPPERCASE letter, splitting combined markers ("GP" → ["G","P"]). Use [] when the line has no tax flag. Many receipts print a legend such as "(G) GST 5%", "(P) PST 7%", "(L) PST Liquor 10%"; use those letters. Basic groceries are usually tax-exempt (no flag). RJ/RQ store status codes with $0 tax are NOT tax flags.
- category: choose the single best-fit category for each item, copied VERBATIM from the household's category list provided in the user message (exact spelling and case). Food and pantry staples are "Groceries"; alcohol goes to a liquor/alcohol category if one exists, otherwise "Groceries". If NOTHING in the list reasonably fits, return null. NEVER output a category that is not in the provided list, and never invent one.
- category_suggestions: up to 3 alternate names from the same list, or [].
- Quantity lines: multiply unit price by quantity, then subtract any discount. WORKED EXAMPLE: a line "LBRT GRK PNAPLE  2 @ $6.97 = $13.94" immediately followed by "ARCP  (-$2.79)" becomes ONE item: raw_name "LBRT GRK PNAPLE", name "Liberte Greek Pineapple", amount 1115 (1394 paid minus 279 discount), saved_amount 279.
- tax_summary: capture EVERY sales-tax line from the receipt's summary/legend as its own entry with the flag letter (code), label, percent rate, and amount in cents. WORKED EXAMPLE: a receipt footer "(P) PST 7%  4.41" and "(G) GST 5%  4.75" becomes tax_summary [{code:"P",label:"PST",rate_percent:7,amount:441},{code:"G",label:"GST",rate_percent:5,amount:475}]. If the receipt only shows one unlabelled "TAX 3.20" with no per-item letters, use [{code:null,label:"Sales Tax",rate_percent:null,amount:320}]. Empty array [] only when there is genuinely no tax.
- vendor: the store name. Use "Other" if unreadable (never null).
- receipt_country / receipt_region: from the printed address when present.
- receipt_currency: ONLY a currency the receipt PRINTS — an explicit code ("USD", "CAD $", "EUR") or a symbol unique to one currency (£ € ₹ R$). Do NOT infer it from the store's address: that belongs in receipt_country / receipt_region, and the app pairs it with the member's own region to decide whether the receipt is foreign. A bare "$" is null. A wrong currency here silently rewrites every amount on the receipt.
- subtotal / total: read the pre-tax subtotal and the grand total (with tax) in cents if printed, else null.
- EXCLUDE from items the receipt's summary / accounting rows: subtotal, total / grand total, tax totals, amount tendered, card/cash payment, change due, points/loyalty balances, and store address / phone / cashier info. Tax rows belong in tax_summary, not items. Fees and deposits are NOT items — they attach to the parent.
- Never invent items, prices, or taxes. Read what is printed. Only return an empty items array if the image is truly unreadable (blurry, blank, or not a receipt).

Always return via the "output" tool.`;

export const SCAN_GROCERY_RECEIPT_USER_PROMPT =
  'Read this receipt and extract every product purchased — of any kind (food, drinks, alcohol, electronics, household goods, services, etc.) — with raw_name, raw_code, a human Title Case name, up to 7 name_suggestions (must include Title Case of the printed line), the PRE-tax price paid per item in cents (fees included on the parent), how much was saved on each via discounts (including lmt / regular-vs-paid and TPD/##### by item code), attached fees (never separate items), the raw tax flag letters printed on each line, and the best-fit category plus up to 3 alt names. Do NOT collapse different products into "Tomatoes" or "Alcohol". Also return the store name (or "Other"), purchase date, printed address country/region, the ISO 4217 currency PRINTED on the receipt (null if only a bare "$" — do not infer it from the address), the full tax summary (each GST/PST/HST/VAT/L line with its amount), the subtotal, and the grand total if present. If several images are attached, they are sections of ONE receipt — read them in order as a single receipt.';

/**
 * Compose the receipt user prompt, appending the household's category names so
 * the model can tag each item with a real, pickable category. When no category
 * names are available the base prompt is returned unchanged (model may emit
 * null categories, which the server maps to the Groceries fallback).
 */
export function buildScanReceiptUserPrompt(categoryNames: readonly string[]): string {
  const names = categoryNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return SCAN_GROCERY_RECEIPT_USER_PROMPT;
  return (
    `${SCAN_GROCERY_RECEIPT_USER_PROMPT}\n\n` +
    `Categorize each item using ONLY these household categories (copy the name VERBATIM, ` +
    `or use null if none fits): ${names.join(', ')}.`
  );
}
