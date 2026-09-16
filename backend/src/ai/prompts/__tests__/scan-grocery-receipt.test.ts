/**
 * scan-grocery-receipt prompt/schema invariants (v2).
 *
 * These guard the *response-quality contract* of the receipt reader at the
 * instruction level — the part a mocked-provider unit test can never see.
 */
import { describe, it, expect } from 'vitest';

import {
  SCAN_GROCERY_RECEIPT_SCHEMA,
  SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
  SCAN_GROCERY_RECEIPT_USER_PROMPT,
  buildScanReceiptUserPrompt,
} from '../scan-grocery-receipt';

/** Reach a nested JSON-schema node without `any` noise. */
function node(obj: unknown, ...path: string[]): Record<string, unknown> {
  let cur: unknown = obj;
  for (const key of path) cur = (cur as Record<string, unknown>)?.[key];
  return cur as Record<string, unknown>;
}

describe('scan-grocery-receipt — generic (not grocery-only) contract', () => {
  const sys = SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT.toLowerCase();

  it('frames the reader for ANY receipt type, not just groceries', () => {
    expect(SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT).toMatch(/receipt reader/i);
    expect(sys).toContain('any kind');
    expect(sys).toMatch(/do not limit yourself to groceries/i);
  });

  it('explicitly welcomes non-food item types (alcohol, electronics, etc.)', () => {
    for (const kind of ['alcohol', 'electronics', 'clothing', 'household', 'medicine', 'services']) {
      expect(sys).toContain(kind);
    }
  });

  it('attaches fees and deposits to the parent — never as their own items', () => {
    expect(sys).toMatch(/fees attach to the parent/i);
    expect(sys).toMatch(/do not emit them as their own items/i);
    expect(sys).toMatch(/deposit/);
    for (const drop of ['subtotal', 'total', 'tax', 'change', 'loyalty']) {
      expect(sys).toContain(drop);
    }
  });

  it('never lists tax as an includable item type', () => {
    const readRule =
      SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT.split('\n').find((l) => /read any kind of item/i.test(l)) ?? '';
    expect(readRule).not.toMatch(/\btax\b/i);
  });
});

describe('scan-grocery-receipt — naming contract (no semantic merge)', () => {
  const sys = SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT;

  it('forbids collapsing distinct products into Tomatoes or Alcohol', () => {
    expect(sys).toMatch(/do not semantically merge/i);
    expect(sys).toContain('Tomatoes');
    expect(sys).toContain('Alcohol');
    expect(sys).toMatch(/Kumato/);
  });

  it('requires Title Case of the printed line in name_suggestions', () => {
    expect(sys).toMatch(/ICE CREAM 4L/);
    expect(sys).toMatch(/Ice Cream 4l/);
    expect(sys).toMatch(/name_suggestions/);
  });

  it('the user prompt also forbids Tomatoes / Alcohol collapse', () => {
    expect(SCAN_GROCERY_RECEIPT_USER_PROMPT).toMatch(/any kind/i);
    expect(SCAN_GROCERY_RECEIPT_USER_PROMPT).toMatch(/Tomatoes/);
    expect(SCAN_GROCERY_RECEIPT_USER_PROMPT).toMatch(/Alcohol/);
    expect(SCAN_GROCERY_RECEIPT_USER_PROMPT).toMatch(/Do NOT collapse/i);
  });
});

describe('scan-grocery-receipt — schema shape', () => {
  it('requires vendor, purchase_date, and items at the top level', () => {
    expect(SCAN_GROCERY_RECEIPT_SCHEMA.required).toEqual(
      expect.arrayContaining(['vendor', 'purchase_date', 'items'])
    );
    expect(node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items').type).toBe('array');
  });

  it('each item requires name/amount/saved_amount with integer-cent amounts', () => {
    const item = node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items', 'items');
    expect(item.required).toEqual(
      expect.arrayContaining([
        'raw_name',
        'raw_code',
        'name',
        'name_suggestions',
        'amount',
        'saved_amount',
        'fees',
      ])
    );
    expect(node(item, 'properties', 'amount').type).toBe('integer');
    expect(node(item, 'properties', 'saved_amount').type).toBe('integer');
  });

  it('the item-name description keeps products distinct', () => {
    const nameDesc = String(
      node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items', 'items', 'properties', 'name').description
    );
    expect(nameDesc).toMatch(/Kumato/);
    expect(nameDesc).toMatch(/Canadian Club/);
    expect(nameDesc).not.toMatch(/GROUPABLE/);
  });

  it('the items description forbids extra keys but keeps the model to the summary-row exclusions', () => {
    const itemObj = node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items', 'items');
    expect(itemObj.additionalProperties).toBe(false);
    const itemsDesc = String(node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items').description);
    expect(itemsDesc).toMatch(/subtotal, total, tax totals/i);
  });
});

describe('scan-grocery-receipt — sales-tax contract', () => {
  const sys = SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT;

  it('captures per-item tax flag letters (tax_codes) instead of discarding tax', () => {
    const item = node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items', 'items');
    expect(item.required).toEqual(expect.arrayContaining(['tax_codes']));
    expect(node(item, 'properties', 'tax_codes').type).toBe('array');
    const desc = String(node(item, 'properties', 'tax_codes').description);
    expect(desc).toMatch(/\["G","P"\]|G","P/);
    expect(desc).toMatch(/tax_summary/);
  });

  it('captures a top-level tax_summary with code/label/rate/amount per tax line', () => {
    expect(SCAN_GROCERY_RECEIPT_SCHEMA.required).toEqual(
      expect.arrayContaining(['tax_summary', 'subtotal', 'total'])
    );
    const taxItem = node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'tax_summary', 'items');
    expect(taxItem.required).toEqual(
      expect.arrayContaining(['code', 'label', 'rate_percent', 'amount'])
    );
    expect(node(taxItem, 'properties', 'amount').type).toBe('integer');
  });

  it('instructs the model to read GST/PST/HST legends and worked-example them', () => {
    expect(sys).toMatch(/tax_summary/);
    expect(sys).toMatch(/PST/);
    expect(sys).toMatch(/GST/);
    expect(sys).toMatch(/PRE-TAX price actually PAID/i);
  });
});

describe('scan-grocery-receipt — multi-segment (one receipt across images)', () => {
  const sys = SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT;

  it('tells the model several images are ONE receipt read in order', () => {
    expect(sys).toMatch(/ONE RECEIPT/i);
    expect(sys).toMatch(/consecutive sections|sections of ONE/i);
    expect(sys).toMatch(/count it only ONCE|overlap/i);
    expect(SCAN_GROCERY_RECEIPT_USER_PROMPT).toMatch(/several images|sections of ONE receipt/i);
  });
});

describe('scan-grocery-receipt — per-item category contract', () => {
  it('requires a `category` on every item and allows null', () => {
    const item = node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items', 'items');
    expect(item.required).toEqual(expect.arrayContaining(['category', 'category_suggestions']));
    const category = node(item, 'properties', 'category');
    expect(category.type).toEqual(['string', 'null']);
  });

  it('the category description forces a VERBATIM pick from the provided list or null', () => {
    const desc = String(
      node(SCAN_GROCERY_RECEIPT_SCHEMA, 'properties', 'items', 'items', 'properties', 'category')
        .description
    );
    expect(desc).toMatch(/verbatim/i);
    expect(desc).toMatch(/null/i);
    expect(desc).toMatch(/never invent/i);
  });

  it('the system prompt instructs per-item categorization from the household list', () => {
    const sys = SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT.toLowerCase();
    expect(sys).toContain('category');
    expect(sys).toMatch(/verbatim/i);
    expect(sys).toMatch(/never output a category that is not in the provided list/i);
  });

  it('buildScanReceiptUserPrompt injects the household category names', () => {
    const withCats = buildScanReceiptUserPrompt(['Groceries', 'Alcohol', 'Household']);
    expect(withCats).toContain('Groceries');
    expect(withCats).toContain('Alcohol');
    expect(withCats).toContain('Household');
    expect(withCats).toMatch(/verbatim/i);
    expect(withCats).toMatch(/null if none fits/i);
  });

  it('buildScanReceiptUserPrompt returns the base prompt unchanged when no categories exist', () => {
    expect(buildScanReceiptUserPrompt([])).toBe(SCAN_GROCERY_RECEIPT_USER_PROMPT);
    expect(buildScanReceiptUserPrompt(['  ', ''])).toBe(SCAN_GROCERY_RECEIPT_USER_PROMPT);
  });
});
