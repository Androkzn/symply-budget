/**
 * Mortgage reconciliation — the rule that makes our numbers match the bank's
 * (implementation plan §4.5). The theoretical amortization schedule drifts from
 * reality (rounding, prepayments, VRM split changes, rate resets). Every
 * confirmed statement `closing_balance` is a HARD ANCHOR: we snap the running
 * balance to it and continue from the actual figure, self-correcting all prior
 * drift. Between anchors the balance is projected (and flagged "estimated").
 *
 * Pure + I/O-free like the engine, so it is fully unit-testable (GV-6, GV-7).
 */

import { balanceAfter } from './amortization';

const MS_PER_DAY = 86_400_000;

/** Whole payments between two ISO dates for a frequency of `n` payments/year. */
export function paymentsBetween(fromIso: string, toIso: string, n: number): number {
  const days = Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_DAY);
  if (days <= 0) return 0;
  return Math.floor(days / (365 / n));
}

/**
 * A step in an event-aware reconciled walk:
 *  - `payments`: apply `count` level payments at periodic rate `i`.
 *  - `lump`: subtract a lump-sum prepayment from the balance.
 *  - `anchor`: SNAP the balance to a statement's confirmed closing balance
 *    (overrides whatever the theoretical walk produced — self-correcting drift).
 */
export type ReconStep =
  | { kind: 'payments'; i: number; payment: number; count: number }
  | { kind: 'lump'; amount: number }
  | { kind: 'anchor'; balance: number };

/**
 * Walk a reconciled balance through an ordered sequence of steps. This is the
 * event-aware core: rate changes become new `payments` segments (each with its
 * own `i`/`payment`), prepayments are `lump` steps, and statements are `anchor`
 * snaps. The result never goes negative.
 */
export function walkReconciled(startBalance: number, steps: ReconStep[]): number {
  let balance = startBalance;
  for (const step of steps) {
    if (step.kind === 'payments') {
      balance = balanceAfter(balance, step.i, step.payment, step.count);
    } else if (step.kind === 'lump') {
      balance -= step.amount;
    } else {
      balance = step.balance;
    }
  }
  return Math.max(0, balance);
}

export interface StatementAnchor {
  statementDate: string;
  closingBalance: number;
}

export interface LumpEvent {
  eventDate: string;
  amount: number;
}

export interface ReconcileInput {
  originalPrincipal: number;
  /** Current term periodic rate. */
  i: number;
  /** Current term payment (dollars). */
  payment: number;
  termStartDate: string;
  statements: StatementAnchor[];
  lumpEvents: LumpEvent[];
  paymentsPerYearN: number;
  asOf: string;
}

export interface ReconcileResult {
  currentBalance: number;
  /** 'confirmed' when the balance IS a statement figure (no forward projection);
   *  'estimated' when projected past the last anchor (or no statement exists). */
  status: 'confirmed' | 'estimated';
  /** The date the balance is anchored to (statement date, or term start). */
  balanceAsOf: string;
  /** Whether a real statement anchored the balance. */
  hasAnchor: boolean;
  /** Scheduled payments projected forward since the anchor. */
  paymentsSinceAnchor: number;
}

/** Latest statement dated at/before `asOf` (by date, then most recent wins). */
export function pickAnchor(statements: StatementAnchor[], asOf: string): StatementAnchor | null {
  const eligible = statements
    .filter((s) => new Date(s.statementDate).getTime() <= new Date(asOf).getTime())
    .sort((a, b) => new Date(a.statementDate).getTime() - new Date(b.statementDate).getTime());
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/**
 * Current outstanding balance, anchored to the latest statement and projected
 * forward with the current term's payment. Lump-sum prepayments after the anchor
 * are applied. When no statement exists, falls back to the theoretical schedule
 * from term start.
 */
export function reconcileCurrentBalance(input: ReconcileInput): ReconcileResult {
  const anchor = pickAnchor(input.statements, input.asOf);
  const baseDate = anchor ? anchor.statementDate : input.termStartDate;
  const baseBalance = anchor ? anchor.closingBalance : input.originalPrincipal;

  const payments = paymentsBetween(baseDate, input.asOf, input.paymentsPerYearN);
  let balance = balanceAfter(baseBalance, input.i, input.payment, payments);

  // Apply lump sums strictly after the anchor and at/before asOf. (A statement
  // dated after a lump sum will re-anchor and absorb it exactly.)
  for (const e of input.lumpEvents) {
    const t = new Date(e.eventDate).getTime();
    if (t > new Date(baseDate).getTime() && t <= new Date(input.asOf).getTime()) {
      balance -= e.amount;
    }
  }
  balance = Math.max(0, balance);

  return {
    currentBalance: balance,
    status: anchor && payments === 0 ? 'confirmed' : 'estimated',
    balanceAsOf: baseDate,
    hasAnchor: !!anchor,
    paymentsSinceAnchor: payments,
  };
}
