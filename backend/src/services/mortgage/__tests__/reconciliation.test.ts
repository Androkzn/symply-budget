import { describe, it, expect } from 'vitest';

import { balanceAfter, periodicRate, roundCents, levelPayment } from '../amortization';
import {
  paymentsBetween,
  walkReconciled,
  pickAnchor,
  reconcileCurrentBalance,
  type ReconStep,
} from '../reconciliation';

const I = periodicRate(0.05, 12, 'semi_annual');
const PMT = roundCents(levelPayment(500_000, I, 300)); // 2908.02

describe('paymentsBetween', () => {
  it('counts whole monthly payments between two dates', () => {
    expect(paymentsBetween('2025-01-01', '2025-12-31', 12)).toBe(11); // ~364 days / 30.42
    expect(paymentsBetween('2025-01-01', '2026-01-02', 12)).toBe(12);
  });
  it('returns 0 when the end is on/before the start', () => {
    expect(paymentsBetween('2025-06-01', '2025-06-01', 12)).toBe(0);
    expect(paymentsBetween('2025-06-01', '2025-01-01', 12)).toBe(0);
  });
});

describe('walkReconciled — event-aware core', () => {
  it('GV-7: composes rate-change segments + a lump prepayment (matches chained engine math)', () => {
    const i2 = periodicRate(0.06, 12, 'semi_annual');
    const p2 = 3115.06;
    const steps: ReconStep[] = [
      { kind: 'payments', i: I, payment: PMT, count: 12 },
      { kind: 'payments', i: i2, payment: p2, count: 12 },
      { kind: 'lump', amount: 20_000 },
      { kind: 'payments', i: i2, payment: p2, count: 12 },
    ];
    let expected = balanceAfter(500_000, I, PMT, 12);
    expected = balanceAfter(expected, i2, p2, 12);
    expected = expected - 20_000;
    expected = balanceAfter(expected, i2, p2, 12);
    expect(walkReconciled(500_000, steps)).toBeCloseTo(expected, 6);
  });

  it('GV-6: an anchor snap discards the pre-anchor drift', () => {
    const steps: ReconStep[] = [
      { kind: 'payments', i: I, payment: PMT, count: 12 },
      { kind: 'anchor', balance: 480_000 }, // statement says 480k, not the theoretical ~490k
      { kind: 'payments', i: I, payment: PMT, count: 1 },
    ];
    // Result continues from the ANCHOR, not the theoretical balance.
    expect(walkReconciled(500_000, steps)).toBeCloseTo(balanceAfter(480_000, I, PMT, 1), 6);
  });

  it('never returns a negative balance', () => {
    expect(walkReconciled(1_000, [{ kind: 'lump', amount: 5_000 }])).toBe(0);
  });
});

describe('pickAnchor', () => {
  const statements = [
    { statementDate: '2025-01-31', closingBalance: 495_000 },
    { statementDate: '2025-07-31', closingBalance: 480_000 },
  ];
  it('picks the latest statement at or before asOf', () => {
    expect(pickAnchor(statements, '2025-08-15')?.closingBalance).toBe(480_000);
    expect(pickAnchor(statements, '2025-03-01')?.closingBalance).toBe(495_000);
  });
  it('returns null when no statement is eligible', () => {
    expect(pickAnchor(statements, '2024-12-01')).toBeNull();
    expect(pickAnchor([], '2025-08-15')).toBeNull();
  });
});

describe('reconcileCurrentBalance — statement overrides schedule', () => {
  const base = {
    originalPrincipal: 500_000,
    i: I,
    payment: PMT,
    termStartDate: '2025-01-01',
    paymentsPerYearN: 12,
    lumpEvents: [],
  };

  it('GV-6: snaps to the statement balance and self-corrects prior drift', () => {
    // A statement one year in reports 480k (a prepayment happened) vs the
    // theoretical ~488k. On the statement date the balance IS 480k (confirmed).
    const onDate = reconcileCurrentBalance({
      ...base,
      statements: [{ statementDate: '2026-01-01', closingBalance: 480_000 }],
      asOf: '2026-01-01',
    });
    expect(onDate.currentBalance).toBe(480_000);
    expect(onDate.status).toBe('confirmed');
    expect(onDate.hasAnchor).toBe(true);

    // One month later it projects forward FROM 480k (not the theoretical ~488k).
    const later = reconcileCurrentBalance({
      ...base,
      statements: [{ statementDate: '2026-01-01', closingBalance: 480_000 }],
      asOf: '2026-02-05',
    });
    const theoreticalNoAnchor = balanceAfter(500_000, I, PMT, 13);
    expect(later.status).toBe('estimated');
    expect(later.currentBalance).toBeLessThan(theoreticalNoAnchor - 5_000); // anchored, not theoretical
  });

  it('falls back to the theoretical schedule when there is no statement', () => {
    const r = reconcileCurrentBalance({ ...base, statements: [], asOf: '2026-01-02' });
    expect(r.hasAnchor).toBe(false);
    expect(r.status).toBe('estimated');
    expect(r.currentBalance).toBeCloseTo(balanceAfter(500_000, I, PMT, 12), 2);
  });

  it('applies a lump sum recorded after the anchor', () => {
    const r = reconcileCurrentBalance({
      ...base,
      statements: [{ statementDate: '2026-01-01', closingBalance: 480_000 }],
      lumpEvents: [{ eventDate: '2026-01-10', amount: 30_000 }],
      asOf: '2026-01-15',
    });
    // 480k anchor, 0 payments elapsed (~14 days < one month), minus 30k lump.
    expect(r.currentBalance).toBe(450_000);
  });

  it('ignores lump sums outside the (anchor, asOf] window', () => {
    const r = reconcileCurrentBalance({
      ...base,
      statements: [{ statementDate: '2026-01-01', closingBalance: 480_000 }],
      // one lump BEFORE the anchor (absorbed by the statement already) and one
      // AFTER asOf (not yet happened) — neither should be applied.
      lumpEvents: [
        { eventDate: '2025-06-01', amount: 15_000 },
        { eventDate: '2026-05-01', amount: 25_000 },
      ],
      asOf: '2026-01-15',
    });
    expect(r.currentBalance).toBe(480_000);
  });
});
