import { describe, it, expect } from 'vitest';

import {
  attachFeesAndMerge,
  classifyFeeKind,
  extractReferencedCode,
  type FeeLineInput,
} from '../fee-attribution';

function line(partial: Partial<FeeLineInput> & { name: string; amount: number }): FeeLineInput {
  return {
    raw_name: partial.raw_name ?? partial.name,
    raw_code: partial.raw_code ?? null,
    name: partial.name,
    amount: partial.amount,
    saved_amount: partial.saved_amount ?? 0,
    tax_codes: partial.tax_codes ?? [],
    fees: partial.fees,
  };
}

describe('classifyFeeKind', () => {
  it('maps Superstore / Costco / BCL printed words', () => {
    expect(classifyFeeKind('RECYCLING FEE')).toBe('environmental');
    expect(classifyFeeKind('DEPOSIT')).toBe('deposit');
    expect(classifyFeeKind('Container Deposit')).toBe('deposit');
    expect(classifyFeeKind('ENVIRO')).toBe('environmental');
    expect(classifyFeeKind('CRV')).toBe('crv');
    expect(classifyFeeKind('Bag Fee')).toBe('bag');
    expect(classifyFeeKind('2% Milk')).toBeNull();
    expect(classifyFeeKind('service fee')).toBeNull();
  });
});

describe('extractReferencedCode', () => {
  it('reads Costco TPD/610845', () => {
    expect(extractReferencedCode('TPD/610845', null)).toBe('610845');
    expect(extractReferencedCode('KS DC BRIE', '610845')).toBe('610845');
  });
});

describe('attachFeesAndMerge — Superstore-shaped (BC milk)', () => {
  it('attaches recycling + deposit to milk and never emits fee rows', () => {
    const out = attachFeesAndMerge([
      line({ name: '2% Milk', raw_code: '068700009401', amount: 549 }),
      line({ name: 'RECYCLING FEE', amount: 7 }),
      line({ name: 'DEPOSIT', amount: 10 }),
      line({ name: 'LBRT GRK PHAPLE', raw_code: '064100123456', amount: 697 }),
    ]);

    expect(out).toHaveLength(2);
    const milk = out[0];
    expect(milk.name).toBe('2% Milk');
    expect(milk.amount).toBe(566);
    expect(milk.deposit_amount).toBe(10);
    expect(milk.tax_base).toBe(556); // enviro 7 stays in GST base; deposit 10 out
    expect(milk.fees.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(out.some((p) => /deposit|recycling/i.test(p.name))).toBe(false);
  });
});

describe('attachFeesAndMerge — Costco-shaped', () => {
  it('collapses three 43483 Kumatos and attaches TPD/610845 to brie', () => {
    const out = attachFeesAndMerge([
      line({ name: 'KS DC BRIE', raw_code: '610845', amount: 1299, saved_amount: 0 }),
      line({ name: 'TPD/610845', raw_code: '610845', amount: 200, saved_amount: 200 }),
      line({ name: 'Organic Milk', raw_code: '960141', amount: 899 }),
      line({ name: 'ENVIRO', amount: 5 }),
      line({ name: 'DEPOSIT', amount: 25 }),
      line({ name: 'Kumato', raw_code: '43483', amount: 399 }),
      line({ name: 'Kumato', raw_code: '43483', amount: 399 }),
      line({ name: 'Kumato', raw_code: '43483', amount: 399 }),
      line({ name: 'Roti Chicken', raw_code: '111', amount: 799, tax_codes: ['G'] }),
    ]);

    const brie = out.find((p) => p.raw_code === '610845');
    expect(brie?.saved_amount).toBe(200);
    expect(brie?.amount).toBe(1299);

    const milk = out.find((p) => /milk/i.test(p.name));
    expect(milk?.fees.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(milk?.deposit_amount).toBe(25);
    expect(milk?.tax_base).toBe((milk?.amount ?? 0) - 25);

    const kumato = out.find((p) => p.raw_code === '43483');
    expect(kumato?.name).toBe('Kumato');
    expect(kumato?.amount).toBe(1197);

    expect(out.filter((p) => /tpd|enviro|deposit/i.test(p.name))).toHaveLength(0);
    expect(out.find((p) => p.name === 'Roti Chicken')?.tax_codes).toEqual(['G']);
  });
});

describe('attachFeesAndMerge — BCL-shaped', () => {
  it('attaches container deposit to Canadian Club', () => {
    const out = attachFeesAndMerge([
      line({
        name: 'Canadian Club',
        raw_code: '062067040107',
        amount: 2499,
        tax_codes: ['L', 'G'],
      }),
      line({ name: 'Container Deposit', amount: 10 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Canadian Club');
    expect(out[0].amount).toBe(2509);
    expect(out[0].deposit_amount).toBe(10);
    expect(out[0].tax_base).toBe(2499);
    expect(out[0].tax_codes).toEqual(['L', 'G']);
  });
});

describe('attachFeesAndMerge — no semantic merge', () => {
  it('keeps distinct names without a shared code', () => {
    const out = attachFeesAndMerge([
      line({ name: 'Kumato Tomato', amount: 399 }),
      line({ name: 'Vine Tomato', amount: 299 }),
      line({ name: 'Beer', amount: 1200 }),
      line({ name: 'Whisky', amount: 4500 }),
    ]);
    expect(out.map((p) => p.name)).toEqual(['Kumato Tomato', 'Vine Tomato', 'Beer', 'Whisky']);
  });
});
