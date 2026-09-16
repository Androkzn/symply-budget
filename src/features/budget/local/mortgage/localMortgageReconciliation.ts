/**
 * Client-safe mortgage reconciliation (mirrors backend §4.5).
 * Statement closing balances are hard anchors; project forward with the schedule.
 */

import type { MortgageEvent, MortgageStatement } from '@api/mortgage';
import { balanceAfter } from '@features/mortgage/amortization';

const MS_PER_DAY = 86_400_000;
const CENTS = 100;

/** Whole payments between two ISO dates for a frequency of `n` payments/year. */
export function paymentsBetween(fromIso: string, toIso: string, n: number): number {
  const days = Math.floor(
    (new Date(toIso.slice(0, 10)).getTime() - new Date(fromIso.slice(0, 10)).getTime()) /
      MS_PER_DAY,
  );
  if (days <= 0) return 0;
  return Math.floor((days / 365) * n);
}

export type ReconStep =
  | { kind: 'payments'; i: number; payment: number; count: number }
  | { kind: 'lump'; amount: number }
  | { kind: 'anchor'; balance: number };

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

export interface StatementFact {
  statementDate: string;
  interestPaidCents: number | null;
  principalPaidCents: number | null;
  paymentAmountCents: number | null;
  interestRateBps: number | null;
}

export interface LumpEvent {
  eventDate: string;
  amount: number;
}

export interface ReconcileInput {
  originalPrincipal: number;
  i: number;
  payment: number;
  termStartDate: string;
  statements: StatementAnchor[];
  lumpEvents: LumpEvent[];
  paymentsPerYearN: number;
  asOf: string;
}

export interface ReconcileResult {
  currentBalance: number;
  status: 'confirmed' | 'estimated';
  balanceAsOf: string;
  hasAnchor: boolean;
  paymentsSinceAnchor: number;
}

/** Latest statement dated at/before `asOf` (by date, then most recent wins). */
export function pickAnchor(statements: StatementAnchor[], asOf: string): StatementAnchor | null {
  const asOfT = new Date(asOf.slice(0, 10)).getTime();
  const eligible = statements
    .filter((s) => new Date(s.statementDate.slice(0, 10)).getTime() <= asOfT)
    .sort(
      (a, b) =>
        new Date(a.statementDate.slice(0, 10)).getTime() -
        new Date(b.statementDate.slice(0, 10)).getTime(),
    );
  return eligible.length ? eligible[eligible.length - 1] : null;
}

export function reconcileCurrentBalance(input: ReconcileInput): ReconcileResult {
  const anchor = pickAnchor(input.statements, input.asOf);
  const baseDate = anchor ? anchor.statementDate : input.termStartDate;
  const baseBalance = anchor ? anchor.closingBalance : input.originalPrincipal;

  const payments = paymentsBetween(baseDate, input.asOf, input.paymentsPerYearN);
  let balance = balanceAfter(baseBalance, input.i, input.payment, payments);

  const baseT = new Date(baseDate.slice(0, 10)).getTime();
  const asOfT = new Date(input.asOf.slice(0, 10)).getTime();
  for (const e of input.lumpEvents) {
    const t = new Date(e.eventDate.slice(0, 10)).getTime();
    if (t > baseT && t <= asOfT) {
      balance -= e.amount;
    }
  }
  balance = Math.max(0, balance);

  return {
    currentBalance: balance,
    status: anchor && payments === 0 ? 'confirmed' : 'estimated',
    balanceAsOf: baseDate.slice(0, 10),
    hasAnchor: !!anchor,
    paymentsSinceAnchor: payments,
  };
}

export function statementsToAnchors(statements: MortgageStatement[]): StatementAnchor[] {
  return statements.map((s) => ({
    statementDate: s.statement_date,
    closingBalance: s.closing_balance_cents / CENTS,
  }));
}

export function statementsToFacts(statements: MortgageStatement[]): StatementFact[] {
  return statements.map((s) => ({
    statementDate: s.statement_date,
    interestPaidCents: s.interest_paid_cents,
    principalPaidCents: s.principal_paid_cents,
    paymentAmountCents: s.payment_amount_cents,
    interestRateBps: s.interest_rate_bps,
  }));
}

export function lumpEventsFromMortgageEvents(events: MortgageEvent[]): LumpEvent[] {
  const out: LumpEvent[] = [];
  for (const e of events) {
    if (e.event_type === 'lump_sum_prepayment' && e.amount_cents != null) {
      out.push({ eventDate: e.event_date, amount: e.amount_cents / CENTS });
    }
  }
  return out;
}

/** Sum statement interest actuals at/before `asOf`. */
export function sumStatementActuals(
  facts: StatementFact[],
  asOf: string,
): { interest: number; statementsWithInterest: number; throughDate: string | null } {
  const asOfT = new Date(asOf.slice(0, 10)).getTime();
  let interest = 0;
  let statementsWithInterest = 0;
  let throughDate: string | null = null;
  for (const f of facts) {
    if (new Date(f.statementDate.slice(0, 10)).getTime() > asOfT) continue;
    if (f.interestPaidCents != null) {
      interest += f.interestPaidCents / CENTS;
      statementsWithInterest += 1;
    }
    if (throughDate == null || f.statementDate > throughDate) throughDate = f.statementDate;
  }
  return { interest, statementsWithInterest, throughDate };
}
