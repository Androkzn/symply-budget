import type { MortgageEvent, MortgageEventType, MortgageTerm } from '@api/mortgage';
import { formatMoney } from '@utils/money';

import type { RateChangeRow } from './mortgageRateHistory';

/**
 * Change-history helpers for the mortgage timeline. A mortgage's history is the
 * union of three stored records: each `mortgage_terms` row (origination + every
 * renewal, with its effective date/rate/term/payment), each `mortgage_events`
 * row (a dated change the user logs by hand) and each rate change DETECTED from
 * the statements' own `mortgage_rate_periods` — which is how a variable / HELOC
 * borrower's rate history actually accumulates: automatically, on every upload,
 * with the lender's exact effective date. `buildChangeTimeline` merges them into
 * one newest-first list the screen renders.
 *
 * Pure + deterministic so it can be unit-tested without a render.
 */
export type HistoryItemKind =
  | 'origination'
  | 'renewal'
  | 'rate_change'
  /** A rate move read off a statement (vs `rate_change`, which the user logged). */
  | 'rate_observed'
  | 'payment_increase'
  | 'lump_sum_prepayment'
  | 'amortization_change';

export interface MortgageHistoryItem {
  key: string;
  /** Effective date of the change, `YYYY-MM-DD`. */
  date: string;
  kind: HistoryItemKind;
  title: string;
  /** Short descriptive lines (rate, term, payment, amount…). */
  lines: string[];
  note: string | null;
}

const EVENT_TITLE: Record<MortgageEventType, string> = {
  rate_change: 'Rate change',
  payment_increase: 'Payment change',
  lump_sum_prepayment: 'Lump-sum prepayment',
  amortization_change: 'Amortization change',
  renewal: 'Renewal',
};

export function pctFromBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function moneyFromCents(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

export function termLengthLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12}-year term` : `${months}-month term`;
}

export function termToHistoryItem(term: MortgageTerm): MortgageHistoryItem {
  const isOrigination = term.sequence <= 1;
  const lines = [`${pctFromBps(term.nominal_rate_bps)} · ${termLengthLabel(term.term_months)}`];
  if (term.scheduled_payment_cents != null) lines.push(`Payment ${moneyFromCents(term.scheduled_payment_cents)}`);
  return {
    key: `term-${term.id}`,
    date: term.term_start_date,
    kind: isOrigination ? 'origination' : 'renewal',
    title: isOrigination ? 'Mortgage started' : `Renewal · term ${term.sequence}`,
    lines,
    note: null,
  };
}

export function eventToHistoryItem(ev: MortgageEvent): MortgageHistoryItem {
  const lines: string[] = [];
  if (ev.new_rate_bps != null) lines.push(`New rate ${pctFromBps(ev.new_rate_bps)}`);
  if (ev.new_payment_cents != null) lines.push(`New payment ${moneyFromCents(ev.new_payment_cents)}`);
  if (ev.amount_cents != null) lines.push(moneyFromCents(ev.amount_cents));
  return {
    key: `event-${ev.id}`,
    date: ev.event_date,
    kind: ev.event_type as HistoryItemKind,
    title: EVENT_TITLE[ev.event_type] ?? 'Change',
    lines,
    note: ev.note,
  };
}

/** A rate move detected from the statements → a timeline row. */
export function rateChangeToHistoryItem(change: RateChangeRow): MortgageHistoryItem {
  const dir = change.deltaBps < 0 ? 'dropped' : 'rose';
  const deltaPct = `${change.deltaBps < 0 ? '−' : '+'}${(Math.abs(change.deltaBps) / 100).toFixed(2)}%`;
  return {
    key: `rate-${change.key}`,
    date: change.date,
    kind: 'rate_observed',
    title: `Rate ${dir} to ${pctFromBps(change.toBps)}`,
    lines: [`${pctFromBps(change.fromBps)} → ${pctFromBps(change.toBps)} · ${deltaPct}`],
    note: 'From your statement',
  };
}

/**
 * Merge terms (renewals) + logged events + statement-detected rate changes into
 * one date-sorted change history, newest first.
 *
 * Two de-duplications keep the list honest:
 *  - `renewal` EVENTS are dropped — each renewal already surfaces as a term row.
 *  - a detected rate change on a date the user ALSO logged a `rate_change` event
 *    is dropped, so a manual entry and its statement confirmation don't read as
 *    two separate moves. The user's own row wins (it may carry a note).
 *
 * Same-date items keep insertion order: term → event → detected rate change,
 * i.e. the structural change first.
 */
export function buildChangeTimeline(
  terms: MortgageTerm[],
  events: MortgageEvent[],
  rateChanges: RateChangeRow[] = []
): MortgageHistoryItem[] {
  const items: MortgageHistoryItem[] = [];
  for (const t of terms) items.push(termToHistoryItem(t));

  const loggedRateDates = new Set<string>();
  for (const e of events) {
    if (e.event_type === 'renewal') continue; // already represented by its term row
    if (e.event_type === 'rate_change') loggedRateDates.add(e.event_date);
    items.push(eventToHistoryItem(e));
  }

  for (const c of rateChanges) {
    if (loggedRateDates.has(c.date)) continue; // the user already logged this move
    items.push(rateChangeToHistoryItem(c));
  }

  // Array.sort is stable, so equal-date items keep insertion order (terms first).
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
