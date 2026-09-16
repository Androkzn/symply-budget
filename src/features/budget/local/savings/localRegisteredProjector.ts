import type {
  PensionOverview,
  RegisteredAccount,
  RegisteredAccountType,
  RegisteredRoom,
  RegisteredTransaction,
} from '@api/savings';

import type { LocalBudgetLedger } from '../engine';

import {
  getDcPensionRoom,
  getFhsaRoom,
  getRrspRoom,
  getTfsaRoom,
  pensionAdjustmentFromDc,
  requireLimitsForYear,
  SAVINGS_LIMITS,
  type RoomInputs,
  type RoomResult,
} from './savingsLimits';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function txYear(tx: RegisteredTransaction): number {
  return tx.tax_year != null ? tx.tax_year : Number(tx.transaction_date.substring(0, 4));
}

export function recomputeAccountBalance(
  accountId: string,
  transactions: RegisteredTransaction[],
): number {
  return transactions
    .filter((tx) => tx.account_id === accountId)
    .reduce(
      (sum, tx) => sum + (tx.type === 'contribution' ? tx.amount_cents : -tx.amount_cents),
      0,
    );
}

function effectiveGoalCents(account: RegisteredAccount, year: number): number | null {
  if (account.annual_goal_pct != null && account.annual_goal_pct > 0) {
    const limits = SAVINGS_LIMITS[year];
    const typeLimit =
      account.account_type === 'rrsp'
        ? limits?.rrspMax
        : account.account_type === 'tfsa'
          ? limits?.tfsa
          : account.account_type === 'fhsa'
            ? limits?.fhsaAnnual
            : limits?.mpLimit;
    const base =
      account.starting_room_cents ?? account.annual_limit_override_cents ?? typeLimit ?? 0;
    return Math.round((base * account.annual_goal_pct) / 100);
  }
  return account.annual_goal_cents;
}

function resolveRrspPensionAdjustment(
  ledger: LocalBudgetLedger,
  account: RegisteredAccount,
  year: number,
): number | null {
  if (account.pension_adjustment_cents != null) return account.pension_adjustment_cents;
  if (!account.member_id) return null;

  const priorYear = year - 1;
  const dcAccountIds = ledger.registeredAccounts
    .filter(
      (a) =>
        a.household_id === ledger.household.id &&
        a.member_id === account.member_id &&
        (a.account_type === 'dpsp' || a.account_type === 'rpp'),
    )
    .map((a) => a.id);
  if (dcAccountIds.length === 0) return null;

  let dcPriorYearContribs = 0;
  for (const tx of ledger.registeredTransactions) {
    if (!dcAccountIds.includes(tx.account_id)) continue;
    if (tx.type !== 'contribution') continue;
    if (txYear(tx) === priorYear) dcPriorYearContribs += tx.amount_cents;
  }
  if (dcPriorYearContribs === 0) return null;
  return pensionAdjustmentFromDc(priorYear, dcPriorYearContribs);
}

function aggregateRoomInputs(
  account: RegisteredAccount,
  transactions: RegisteredTransaction[],
  year: number,
  pensionAdjustmentCents: number | null,
): RoomInputs {
  let usedThisYear = 0;
  let usedRegular = 0;
  let usedManual = 0;
  let usedSelf = 0;
  let usedEmployer = 0;
  let priorYearWithdrawals = 0;
  let contributionsSinceAsOf = 0;
  let totalLifetimeContributions = 0;

  const asOf = account.room_as_of_date;

  for (const tx of transactions) {
    if (tx.account_id !== account.id) continue;

    const yearForTx = txYear(tx);

    if (tx.type === 'contribution') {
      totalLifetimeContributions += tx.amount_cents;
      if (yearForTx === year) {
        usedThisYear += tx.amount_cents;
        if (tx.kind === 'regular') usedRegular += tx.amount_cents;
        else usedManual += tx.amount_cents;
        if (tx.contributor === 'employer') usedEmployer += tx.amount_cents;
        else usedSelf += tx.amount_cents;
      }
      if (asOf && tx.transaction_date >= asOf) {
        contributionsSinceAsOf += tx.amount_cents;
      }
    } else if (tx.type === 'withdrawal') {
      const dateYear = Number(tx.transaction_date.substring(0, 4));
      if (dateYear < year) priorYearWithdrawals += tx.amount_cents;
    }
  }

  return {
    year,
    startingRoomCents: account.starting_room_cents,
    annualLimitOverrideCents: account.annual_limit_override_cents,
    priorEarnedIncomeCents: account.prior_earned_income_cents,
    pensionAdjustmentCents,
    usedThisYear,
    usedByKind: { regular: usedRegular, manual: usedManual },
    usedByContributor: { self: usedSelf, employer: usedEmployer },
    priorYearWithdrawals,
    contributionsSinceAsOf,
    roomAsOfDate: asOf ?? null,
    totalLifetimeContributions,
    annualGoalCents: effectiveGoalCents(account, year),
  };
}

function roomResultForType(accountType: RegisteredAccountType, inputs: RoomInputs): RoomResult {
  switch (accountType) {
    case 'tfsa':
      return getTfsaRoom(inputs);
    case 'rrsp':
      return getRrspRoom(inputs);
    case 'fhsa':
      return getFhsaRoom(inputs);
    case 'dpsp':
    case 'rpp':
      return getDcPensionRoom(inputs);
    default:
      throw new Error(`Unsupported account type: ${accountType}`);
  }
}

export function projectRegisteredRoom(
  ledger: LocalBudgetLedger,
  account: RegisteredAccount,
  year: number,
): RegisteredRoom {
  requireLimitsForYear(year);
  const pensionAdjustmentCents =
    account.account_type === 'rrsp'
      ? resolveRrspPensionAdjustment(ledger, account, year)
      : account.pension_adjustment_cents;

  const inputs = aggregateRoomInputs(
    account,
    ledger.registeredTransactions,
    year,
    pensionAdjustmentCents,
  );
  const result = roomResultForType(account.account_type, inputs);

  return {
    accountId: account.id,
    accountType: account.account_type,
    year,
    ...result,
  };
}

/** Materialize missing monthly recurring rows for room-only lines (Pension simple flow). */
export function materializeRecurringContributions(ledger: LocalBudgetLedger): {
  ledger: LocalBudgetLedger;
  changed: boolean;
} {
  const householdId = ledger.household.id;
  const asOf = new Date();
  const currentIndex = asOf.getUTCFullYear() * 12 + asOf.getUTCMonth();

  let changed = false;
  const newTransactions: RegisteredTransaction[] = [...ledger.registeredTransactions];
  const accountUpdates = new Map<string, number>();

  for (const account of ledger.registeredAccounts) {
    if (account.household_id !== householdId) continue;
    if (!account.is_room_only) continue;
    if (!account.recurring_start_month) continue;

    const regular = account.regular_contribution_cents ?? 0;
    const match = account.employer_match_cents ?? 0;
    if (regular <= 0 && match <= 0) continue;

    const [sy, sm] = account.recurring_start_month.split('-').map(Number);
    if (!sy || !sm) continue;
    const startIndex = sy * 12 + (sm - 1);
    if (startIndex > currentIndex) continue;

    const seen = new Set(
      newTransactions
        .filter((tx) => tx.account_id === account.id && tx.kind === 'regular')
        .map((tx) => `${tx.contributor}:${tx.period}`),
    );

    let added = 0;
    for (let idx = startIndex; idx <= currentIndex; idx += 1) {
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const period = `${y}-${pad2(m)}`;
      const transaction_date = `${period}-01`;

      const legs: Array<{ contributor: 'self' | 'employer'; amount: number }> = [];
      if (regular > 0) legs.push({ contributor: 'self', amount: regular });
      if (match > 0) legs.push({ contributor: 'employer', amount: match });

      for (const leg of legs) {
        const key = `${leg.contributor}:${period}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newTransactions.push({
          id: `reg_tx_${account.id}_${key}`,
          account_id: account.id,
          type: 'contribution',
          kind: 'regular',
          contributor: leg.contributor,
          amount_cents: leg.amount,
          transaction_date,
          tax_year: y,
          period,
          notes: null,
          source: 'manual',
          import_batch_id: null,
          created_by: null,
          created_at: new Date().toISOString(),
        });
        added += leg.amount;
      }
    }

    if (added > 0) {
      accountUpdates.set(account.id, (accountUpdates.get(account.id) ?? account.balance_cents) + added);
      changed = true;
    }
  }

  if (!changed) return { ledger, changed: false };

  const updatedAccounts = ledger.registeredAccounts.map((account) => {
    const nextBalance = accountUpdates.get(account.id);
    if (nextBalance == null) return account;
    return { ...account, balance_cents: nextBalance, updated_at: new Date().toISOString() };
  });

  return {
    ledger: {
      ...ledger,
      registeredAccounts: updatedAccounts,
      registeredTransactions: newTransactions,
    },
    changed: true,
  };
}

export function projectPensionOverview(ledger: LocalBudgetLedger, year: number): PensionOverview {
  requireLimitsForYear(year);

  const { ledger: materialized } = materializeRecurringContributions(ledger);
  const accounts = materialized.registeredAccounts
    .filter((a) => a.household_id === materialized.household.id)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const totals = {
    totalBalanceCents: 0,
    totalRoomRemainingCents: 0,
    totalContributedSelfCents: 0,
    totalContributedEmployerCents: 0,
    goalCents: 0,
    goalContributedCents: 0,
    goalPct: 0,
  };
  const warningSet = new Set<string>();
  const groupMap = new Map<
    string,
    PensionOverview['groups'][number]
  >();

  for (const account of accounts) {
    const room = projectRegisteredRoom(materialized, account, year);

    totals.totalBalanceCents += account.balance_cents;
    totals.totalContributedSelfCents += room.usedByContributor.self;
    totals.totalContributedEmployerCents += room.usedByContributor.employer;
    if (account.account_type !== 'dpsp' && account.account_type !== 'rpp') {
      totals.totalRoomRemainingCents += room.roomRemaining;
    }
    if (room.goalCents != null) {
      totals.goalCents += room.goalCents;
      totals.goalContributedCents += room.goalContributedCents;
    }
    for (const w of room.warnings) warningSet.add(w);

    const key = account.member_id ?? '__household__';
    let group = groupMap.get(key);
    if (!group) {
      group = {
        memberId: account.member_id,
        memberName: null,
        memberAvatarUrl: null,
        totalBalanceCents: 0,
        accounts: [],
      };
      groupMap.set(key, group);
    }
    group.totalBalanceCents += account.balance_cents;
    group.accounts.push({ account, memberName: null, room });
  }

  totals.goalPct =
    totals.goalCents > 0
      ? Math.min(100, Math.round((totals.goalContributedCents / totals.goalCents) * 100))
      : 0;

  return {
    year,
    totals,
    groups: Array.from(groupMap.values()),
    warnings: Array.from(warningSet),
  };
}
