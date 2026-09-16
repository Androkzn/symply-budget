import { describe, it, expect } from 'vitest';

import { toReceiptDraft, toReceiptMime } from '../receipt/draft';
import type { ReceiptScanResult } from '../receipt/types';

describe('toReceiptDraft', () => {
  it('clones scan fields without sharing item array identity', () => {
    const scan: ReceiptScanResult = {
      vendor: 'Costco',
      purchase_date: '2026-07-01',
      category_id: 'cat_1',
      category_name: 'Groceries',
      items: [
        {
          raw_name: '2% MILK',
          raw_code: '068700009401',
          name: 'Milk',
          name_suggestions: ['Milk', '2% Milk'],
          amount: 499,
          tax_amount: 0,
          saved_amount: 50,
          deposit_amount: 10,
          fees: [{ kind: 'deposit', label: 'Deposit', amount: 10 }],
          category_id: 'cat_1',
          category_name: 'Groceries',
          category_suggestions: [{ id: 'cat_2', name: 'Household' }],
        },
        {
          raw_name: 'Wine',
          raw_code: null,
          name: 'Wine',
          name_suggestions: ['Wine'],
          amount: 2239,
          tax_amount: 240,
          saved_amount: 0,
          deposit_amount: 0,
          fees: [],
          category_id: 'cat_2',
          category_name: 'Alcohol',
          category_suggestions: [],
        },
      ],
      subtotal_amount: 2498,
      tax_amount: 240,
      total_amount: 2738,
      tax_breakdown: [{ label: 'GST', amount: 240 }],
      tax_source: 'printed-coded',
      region_known: true,
      receipt_country: 'CA',
      receipt_region: 'BC',
      receipt_currency: 'CAD',
    };
    const draft = toReceiptDraft(scan);
    expect(draft).toEqual(scan);
    expect(draft.items).not.toBe(scan.items);
    expect(draft.items[0]).not.toBe(scan.items[0]);
    expect(draft.items[0].fees).not.toBe(scan.items[0].fees);
    expect(draft.items[1].category_id).toBe('cat_2');
    expect(draft.items[1].category_name).toBe('Alcohol');
    expect(draft.items[0].raw_code).toBe('068700009401');
    expect(draft.items[0].deposit_amount).toBe(10);
  });
});

describe('toReceiptMime', () => {
  it('maps known mimes and defaults to jpeg', () => {
    expect(toReceiptMime('application/pdf')).toBe('application/pdf');
    expect(toReceiptMime('image/png')).toBe('image/png');
    expect(toReceiptMime('image/webp')).toBe('image/webp');
    expect(toReceiptMime('image/jpg')).toBe('image/jpeg');
    expect(toReceiptMime(undefined)).toBe('image/jpeg');
  });
});
