import type { MortgageEvent, MortgageTerm } from '@api/mortgage';

import { buildChangeTimeline, moneyFromCents, pctFromBps, termLengthLabel } from '../mortgageHistory';

const terms = [
  { id: 't1', sequence: 1, nominal_rate_bps: 414, term_months: 36, term_start_date: '2025-06-20', scheduled_payment_cents: 287546 },
  { id: 't2', sequence: 2, nominal_rate_bps: 600, term_months: 60, term_start_date: '2028-06-20', scheduled_payment_cents: 310000 },
] as MortgageTerm[];

const events = [
  { id: 'e0', event_type: 'rate_change', event_date: '2025-06-20', new_rate_bps: 500, new_payment_cents: null, amount_cents: null, note: null },
  { id: 'e1', event_type: 'rate_change', event_date: '2026-01-15', new_rate_bps: 450, new_payment_cents: null, amount_cents: null, note: 'Prime moved' },
  { id: 'e2', event_type: 'lump_sum_prepayment', event_date: '2027-03-01', amount_cents: 1_000_000, new_rate_bps: null, new_payment_cents: null, note: null },
  { id: 'e3', event_type: 'renewal', event_date: '2028-06-20', new_rate_bps: 600, new_payment_cents: 310000, amount_cents: null, note: null },
] as MortgageEvent[];

describe('mortgageHistory formatters', () => {
  it('formats bps → %, cents → money, months → term label', () => {
    expect(pctFromBps(414)).toBe('4.14%');
    expect(pctFromBps(450)).toBe('4.50%');
    expect(moneyFromCents(287546)).toBe('$2,875.46');
    expect(moneyFromCents(1_000_000)).toBe('$10,000.00');
    expect(termLengthLabel(36)).toBe('3-year term');
    expect(termLengthLabel(18)).toBe('18-month term');
  });
});

describe('buildChangeTimeline', () => {
  const items = buildChangeTimeline(terms, events);

  it('drops renewal events (already represented by the term row)', () => {
    expect(items.some((i) => i.key === 'event-e3')).toBe(false);
    expect(items).toHaveLength(5);
  });

  it('sorts newest first, keeping a term ahead of a same-date event', () => {
    expect(items.map((i) => i.key)).toEqual(['term-t2', 'event-e2', 'event-e1', 'term-t1', 'event-e0']);
  });

  it('labels origination + renewal terms with rate/term/payment', () => {
    const orig = items.find((i) => i.key === 'term-t1')!;
    expect(orig.kind).toBe('origination');
    expect(orig.title).toBe('Mortgage started');
    expect(orig.lines).toEqual(['4.14% · 3-year term', 'Payment $2,875.46']);

    const renew = items.find((i) => i.key === 'term-t2')!;
    expect(renew.kind).toBe('renewal');
    expect(renew.title).toBe('Renewal · term 2');
  });

  it('labels events by type with their figures + note', () => {
    const rate = items.find((i) => i.key === 'event-e1')!;
    expect(rate.title).toBe('Rate change');
    expect(rate.lines).toContain('New rate 4.50%');
    expect(rate.note).toBe('Prime moved');

    const lump = items.find((i) => i.key === 'event-e2')!;
    expect(lump.title).toBe('Lump-sum prepayment');
    expect(lump.lines).toContain('$10,000.00');
  });
});
