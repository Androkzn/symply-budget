import type {
  AddTransactionRequest,
  CreateRegisteredAccountRequest,
  MemberMonthlyContribution,
  PensionOverview,
  RegisteredAccount,
  RegisteredImportCommitRequest,
  RegisteredRoom,
  RegisteredTransaction,
  UpdateRegisteredAccountRequest,
} from '@api/savings';

import {
  getLocalLedger,
  getLocalLedgerFor,
  getLocalMemberId,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
import { isoNow, newLocalId } from '../ids';
import { chunkRowsForOp } from '../projection';

import {
  materializeRecurringContributions,
  pad2,
  projectPensionOverview,
  projectRegisteredRoom,
  recomputeAccountBalance,
} from './localRegisteredProjector';
import { requireLimitsForYear } from './savingsLimits';

/*
 * Registered-accounts WRITES run through the engine's `runOnHousehold(id, work)`,
 * which activates the named household first (BR-016 B5). Same contract as every
 * other Budget facade — one helper, in the engine, for all seven.
 *
 * `mutateLocalLedger` writes into the ACTIVE session and takes no household, so
 * a call naming another household can only move the session or refuse. Writing
 * anyway would file household B's TFSA contribution against household A's
 * accounts — and because a registered write also recomputes a balance, the
 * damage would be an arithmetic result, not a stray row anyone would spot.
 *
 * It replaced `assertHousehold`, whose throw was the right answer for a
 * one-household device and a dead end for a two-household one; the refusal half
 * survives inside `runOnHousehold`, which raises
 * `BudgetLocalUnknownHouseholdError` for an id this device holds no ledger for.
 * It also replaced this file's private copy of the helper, which activated on the
 * engine's session chain but ran the write off it — leaving a window in which a
 * sibling facade's activation could redirect the write to another household.
 *
 * READS stay out of it and take `getLocalLedgerFor(householdId)` instead — it
 * hydrates the named household without moving the session, so a projection for a
 * background household is exact and costs no activation.
 */

/**
 * The account lookups take the ledger they are to read. Under one household that
 * was always the active ledger and the argument would have been noise; under
 * BR-016 it is the difference between reading the household the caller named and
 * reading whichever one happens to be on screen.
 */
function findAccount(
  ledger: LocalBudgetLedger,
  householdId: string,
  accountId: string,
): RegisteredAccount | undefined {
  return ledger.registeredAccounts.find(
    (a) => a.id === accountId && a.household_id === householdId,
  );
}

function requireAccount(
  ledger: LocalBudgetLedger,
  householdId: string,
  accountId: string,
): RegisteredAccount {
  const account = findAccount(ledger, householdId, accountId);
  if (!account) throw new Error('Registered account not found');
  return account;
}

function findMemberLine(
  ledger: LocalBudgetLedger,
  householdId: string,
  memberId: string,
  accountType: 'tfsa' | 'rrsp',
): RegisteredAccount | undefined {
  return ledger.registeredAccounts
    .filter(
      (a) =>
        a.household_id === householdId &&
        a.member_id === memberId &&
        a.account_type === accountType,
    )
    .sort((a, b) => Number(a.is_room_only) - Number(b.is_room_only) || a.created_at.localeCompare(b.created_at))[0];
}

function normAmount(v: number | null | undefined): number | null {
  return v == null || v <= 0 ? null : v;
}

/** Stored shape of a newly created account — shared by the single and batched paths. */
function buildAccountRow(
  householdId: string,
  data: CreateRegisteredAccountRequest,
  now: string,
): RegisteredAccount {
  return {
    id: data.id,
    household_id: householdId,
    member_id: data.member_id ?? null,
    account_type: data.account_type,
    institution: data.institution ?? null,
    is_employer_plan: data.is_employer_plan ?? false,
    employer_name: data.employer_name ?? null,
    balance_cents: data.balance_cents ?? 0,
    starting_room_cents: data.starting_room_cents ?? null,
    annual_limit_override_cents: data.annual_limit_override_cents ?? null,
    regular_contribution_cents: data.regular_contribution_cents ?? null,
    annual_goal_cents: data.annual_goal_cents ?? null,
    annual_goal_pct: null,
    is_room_only: false,
    employer_match_cents: null,
    recurring_start_month: null,
    room_as_of_date: data.room_as_of_date ?? null,
    prior_earned_income_cents: data.prior_earned_income_cents ?? null,
    pension_adjustment_cents: data.pension_adjustment_cents ?? null,
    currency: 'CAD',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Field-by-field merge for an account update. Extracted so the batched import
 * path cannot drift from `updateAccount` into writing a different row.
 */
function mergeAccountUpdate(
  existing: RegisteredAccount,
  data: UpdateRegisteredAccountRequest,
  now: string,
): RegisteredAccount {
  return {
    ...existing,
    member_id: data.member_id !== undefined ? data.member_id : existing.member_id,
    account_type: data.account_type ?? existing.account_type,
    institution: data.institution !== undefined ? data.institution : existing.institution,
    is_employer_plan: data.is_employer_plan ?? existing.is_employer_plan,
    employer_name: data.employer_name !== undefined ? data.employer_name : existing.employer_name,
    balance_cents: data.balance_cents ?? existing.balance_cents,
    starting_room_cents:
      data.starting_room_cents !== undefined
        ? data.starting_room_cents
        : existing.starting_room_cents,
    annual_limit_override_cents:
      data.annual_limit_override_cents !== undefined
        ? data.annual_limit_override_cents
        : existing.annual_limit_override_cents,
    regular_contribution_cents:
      data.regular_contribution_cents !== undefined
        ? data.regular_contribution_cents
        : existing.regular_contribution_cents,
    annual_goal_cents:
      data.annual_goal_cents !== undefined ? data.annual_goal_cents : existing.annual_goal_cents,
    room_as_of_date:
      data.room_as_of_date !== undefined ? data.room_as_of_date : existing.room_as_of_date,
    prior_earned_income_cents:
      data.prior_earned_income_cents !== undefined
        ? data.prior_earned_income_cents
        : existing.prior_earned_income_cents,
    pension_adjustment_cents:
      data.pension_adjustment_cents !== undefined
        ? data.pension_adjustment_cents
        : existing.pension_adjustment_cents,
    updated_at: now,
  };
}

/**
 * Create the member's room-only line in ONE op. The contribution paths used to
 * create the account and then immediately issue a second op that did nothing
 * but flip `is_room_only`, so every member line cost two whole-ledger
 * re-encryptions and shipped the row twice.
 */
async function ensureRoomOnlyAccount(
  householdId: string,
  memberId: string,
  accountType: 'tfsa' | 'rrsp',
  payload: unknown,
): Promise<RegisteredAccount> {
  const now = isoNow();
  const account: RegisteredAccount = {
    ...buildAccountRow(
      householdId,
      { id: newLocalId('reg_acct'), member_id: memberId, account_type: accountType, balance_cents: 0 },
      now,
    ),
    is_room_only: true,
  };
  await mutateLocalLedger(
    (ledger) => {
      ledger.registeredAccounts = [...ledger.registeredAccounts, account];
    },
    {
      opType: 'REGISTERED_MEMBER_LINE_ENSURE',
      entityType: 'registered_account',
      entityId: account.id,
      payload,
    },
  );
  return account;
}

function txYear(tx: RegisteredTransaction): number {
  return tx.tax_year != null ? tx.tax_year : Number(tx.transaction_date.substring(0, 4));
}

/**
 * Callers must already be inside `runOnHousehold(householdId, …)`: this reads and
 * writes the ACTIVE ledger, so it has no way to materialize into a household
 * that is not the one on the engine.
 */
async function materializeIfNeeded(householdId: string): Promise<void> {
  const ledger = getLocalLedger();
  const { ledger: next, changed } = materializeRecurringContributions(ledger);
  if (!changed) return;

  await mutateLocalLedger(
    (l) => {
      l.registeredAccounts = next.registeredAccounts;
      l.registeredTransactions = next.registeredTransactions;
    },
    {
      opType: 'REGISTERED_MATERIALIZE_RECURRING',
      entityType: 'registered_account',
      entityId: householdId,
      payload: { householdId },
    },
  );
}

export const localRegisteredApi = {
  listAccounts: async (householdId: string) => {
    const ledger = await getLocalLedgerFor(householdId);
    const accounts = ledger.registeredAccounts
      .filter((a) => a.household_id === householdId)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { accounts };
  },

  /**
   * A read in name only: `materializeIfNeeded` turns due recurring contributions
   * into real transactions through `mutateLocalLedger`, so the overview has to
   * own the active session like any other write.
   */
  getRegisteredOverview: async (householdId: string, year: number): Promise<PensionOverview> => {
    // Year validation first, for the same reason as `addMemberContribution`: a
    // year this app has no contribution limits for must not cost a switch.
    requireLimitsForYear(year);
    return runOnHousehold(householdId, async () => {
      await materializeIfNeeded(householdId);
      return projectPensionOverview(getLocalLedger(), year);
    });
  },

  createAccount: async (householdId: string, data: CreateRegisteredAccountRequest) =>
    runOnHousehold(householdId, async () => {
      const existing = findAccount(getLocalLedger(), householdId, data.id);
      if (existing) return { account: existing };

      const account = buildAccountRow(householdId, data, isoNow());

      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredAccounts = [...ledger.registeredAccounts, account];
        },
        {
          opType: 'REGISTERED_ACCOUNT_CREATE',
          entityType: 'registered_account',
          entityId: account.id,
          payload: account,
        },
      );

      return { account };
    }),

  updateAccount: async (
    householdId: string,
    id: string,
    data: UpdateRegisteredAccountRequest,
  ) =>
    runOnHousehold(householdId, async () => {
      requireAccount(getLocalLedger(), householdId, id);
      let updated: RegisteredAccount | null = null;

      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== id) return a;
            updated = mergeAccountUpdate(a, data, isoNow());
            return updated;
          });
        },
        {
          opType: 'REGISTERED_ACCOUNT_UPDATE',
          entityType: 'registered_account',
          entityId: id,
          payload: data,
        },
      );

      if (!updated) throw new Error('Registered account not found');
      return { account: updated };
    }),

  deleteAccount: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      requireAccount(getLocalLedger(), householdId, id);
      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredAccounts = ledger.registeredAccounts.filter((a) => a.id !== id);
          ledger.registeredTransactions = ledger.registeredTransactions.filter(
            (tx) => tx.account_id !== id,
          );
        },
        {
          opType: 'REGISTERED_ACCOUNT_DELETE',
          entityType: 'registered_account',
          entityId: id,
          payload: { id },
        },
      );
    }),

  setMemberLine: async (
    householdId: string,
    data: {
      member_id: string;
      account_type: 'tfsa' | 'rrsp';
      room_cents?: number;
      goal_cents?: number | null;
      goal_pct?: number | null;
      regular_contribution_cents?: number | null;
      employer_match_cents?: number | null;
    },
  ) =>
    runOnHousehold(householdId, async () => {
      const existing = findMemberLine(
        getLocalLedger(),
        householdId,
        data.member_id,
        data.account_type,
      );

      const effRoom =
        data.room_cents !== undefined ? normAmount(data.room_cents) : existing?.starting_room_cents ?? null;

      let effGoalCents = existing?.annual_goal_cents ?? null;
      let effGoalPct = existing?.annual_goal_pct ?? null;
      if (data.goal_pct !== undefined || data.goal_cents !== undefined) {
        const pct = normAmount(data.goal_pct);
        const cents = normAmount(data.goal_cents);
        if (pct != null) {
          effGoalPct = Math.min(100, pct);
          effGoalCents = null;
        } else if (cents != null) {
          effGoalCents = cents;
          effGoalPct = null;
        } else {
          effGoalCents = null;
          effGoalPct = null;
        }
      }

      const isRoomOnly = existing ? existing.is_room_only : true;
      const effRegular = isRoomOnly
        ? data.regular_contribution_cents !== undefined
          ? normAmount(data.regular_contribution_cents)
          : existing?.regular_contribution_cents ?? null
        : existing?.regular_contribution_cents ?? null;
      const effMatch = isRoomOnly
        ? data.employer_match_cents !== undefined
          ? normAmount(data.employer_match_cents)
          : existing?.employer_match_cents ?? null
        : existing?.employer_match_cents ?? null;

      const recurringActive = isRoomOnly && (effRegular != null || effMatch != null);
      const asOf = new Date();
      const currentMonth = `${asOf.getUTCFullYear()}-${pad2(asOf.getUTCMonth() + 1)}`;
      const effStartMonth = isRoomOnly
        ? recurringActive
          ? existing?.recurring_start_month ?? currentMonth
          : null
        : existing?.recurring_start_month ?? null;

      const hasAnything =
        effRoom != null ||
        effGoalCents != null ||
        effGoalPct != null ||
        effRegular != null ||
        effMatch != null;

      if (existing) {
        if (!hasAnything && existing.is_room_only) {
          const txCount = getLocalLedger().registeredTransactions.filter(
            (tx) => tx.account_id === existing.id,
          ).length;
          if (txCount === 0) {
            await mutateLocalLedger(
              (ledger) => {
                ledger.registeredAccounts = ledger.registeredAccounts.filter(
                  (a) => a.id !== existing.id,
                );
              },
              {
                opType: 'REGISTERED_MEMBER_LINE_CLEAR',
                entityType: 'registered_account',
                entityId: existing.id,
                payload: data,
              },
            );
            return { account: null };
          }
        }

        let updated: RegisteredAccount | null = null;
        await mutateLocalLedger(
          (ledger) => {
            ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
              if (a.id !== existing.id) return a;
              updated = {
                ...a,
                starting_room_cents: effRoom,
                annual_goal_cents: effGoalCents,
                annual_goal_pct: effGoalPct,
                regular_contribution_cents: effRegular,
                employer_match_cents: effMatch,
                recurring_start_month: effStartMonth,
                updated_at: isoNow(),
              };
              return updated;
            });
          },
          {
            opType: 'REGISTERED_MEMBER_LINE_UPSERT',
            entityType: 'registered_account',
            entityId: existing.id,
            payload: data,
          },
        );
        return { account: updated };
      }

      if (!hasAnything) return { account: null };

      const id = newLocalId('reg_acct');
      const now = isoNow();
      const account: RegisteredAccount = {
        id,
        household_id: householdId,
        member_id: data.member_id,
        account_type: data.account_type,
        institution: null,
        is_employer_plan: false,
        employer_name: null,
        balance_cents: 0,
        starting_room_cents: effRoom,
        annual_limit_override_cents: null,
        regular_contribution_cents: effRegular,
        annual_goal_cents: effGoalCents,
        annual_goal_pct: effGoalPct,
        is_room_only: true,
        employer_match_cents: effMatch,
        recurring_start_month: effStartMonth,
        room_as_of_date: null,
        prior_earned_income_cents: null,
        pension_adjustment_cents: null,
        currency: 'CAD',
        created_at: now,
        updated_at: now,
      };

      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredAccounts = [...ledger.registeredAccounts, account];
        },
        {
          opType: 'REGISTERED_MEMBER_LINE_CREATE',
          entityType: 'registered_account',
          entityId: id,
          payload: account,
        },
      );

      return { account };
    }),

  addMemberContribution: async (
    householdId: string,
    data: {
      id?: string;
      member_id: string;
      account_type: 'tfsa' | 'rrsp';
      amount_cents: number;
      contributor?: 'self' | 'employer';
      employer_amount_cents?: number;
      transaction_date?: string;
    },
  ) => {
    // Argument validation stays OUTSIDE `runOnHousehold`: a malformed amount is
    // not a reason to move the member's session. Rejecting the call and leaving
    // them where they were is the whole difference.
    if (data.amount_cents <= 0) throw new Error('Contribution must be greater than zero');
    const employerAmountCents = data.employer_amount_cents ?? 0;
    if (employerAmountCents < 0) throw new Error('Employer amount cannot be negative');

    return runOnHousehold(householdId, async () => {
      let { account } = await localRegisteredApi.setMemberLine(householdId, {
        member_id: data.member_id,
        account_type: data.account_type,
      });

      if (!account) {
        account = await ensureRoomOnlyAccount(householdId, data.member_id, data.account_type, data);
      }

      const asOf = new Date();
      const transaction_date =
        data.transaction_date ??
        `${asOf.getUTCFullYear()}-${pad2(asOf.getUTCMonth() + 1)}-${pad2(asOf.getUTCDate())}`;
      const tax_year = Number(transaction_date.substring(0, 4));
      const transactionId = data.id ?? newLocalId('reg_tx');

      const existingTx = getLocalLedger().registeredTransactions.find(
        (tx) => tx.id === transactionId,
      );
      if (existingTx) {
        return {
          account: requireAccount(getLocalLedger(), householdId, account.id),
          transaction: existingTx,
        };
      }

      const now = isoNow();
      const primary: RegisteredTransaction = {
        id: transactionId,
        account_id: account.id,
        type: 'contribution',
        kind: 'manual',
        contributor: data.contributor ?? 'self',
        amount_cents: data.amount_cents,
        transaction_date,
        tax_year,
        period: null,
        notes: null,
        source: 'manual',
        import_batch_id: null,
        created_by: getLocalMemberId(),
        created_at: now,
      };

      const employerTx: RegisteredTransaction | null =
        employerAmountCents > 0
          ? {
              id: newLocalId('reg_tx'),
              account_id: account.id,
              type: 'contribution',
              kind: 'manual',
              contributor: 'employer',
              amount_cents: employerAmountCents,
              transaction_date,
              tax_year,
              period: null,
              notes: null,
              source: 'manual',
              import_batch_id: null,
              created_by: getLocalMemberId(),
              created_at: now,
            }
          : null;

      const delta = data.amount_cents + employerAmountCents;
      let refreshed: RegisteredAccount | null = null;

      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredTransactions = [
            ...ledger.registeredTransactions,
            primary,
            ...(employerTx ? [employerTx] : []),
          ];
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== account!.id) return a;
            refreshed = { ...a, balance_cents: a.balance_cents + delta, updated_at: isoNow() };
            return refreshed;
          });
        },
        {
          opType: 'REGISTERED_MEMBER_CONTRIBUTION',
          entityType: 'registered_transaction',
          entityId: transactionId,
          payload: { primary, employerTx },
        },
      );

      return { account: refreshed!, transaction: primary };
    });
  },

  getMemberMonthly: async (
    householdId: string,
    memberId: string,
    accountType: 'tfsa' | 'rrsp',
    year: number,
  ): Promise<{ months: MemberMonthlyContribution[] }> => {
    const ledger = await getLocalLedgerFor(householdId);
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      selfCents: 0,
      employerCents: 0,
    }));

    const account = findMemberLine(ledger, householdId, memberId, accountType);
    if (!account) return { months };

    for (const tx of ledger.registeredTransactions) {
      if (tx.account_id !== account.id) continue;
      if (tx.type !== 'contribution' || tx.kind !== 'regular') continue;
      if (!tx.period?.startsWith(`${year}-`)) continue;
      const m = Number(tx.period.substring(5, 7));
      if (m < 1 || m > 12) continue;
      if (tx.contributor === 'employer') months[m - 1].employerCents += tx.amount_cents;
      else months[m - 1].selfCents += tx.amount_cents;
    }

    return { months };
  },

  backfillMemberContributions: async (
    householdId: string,
    data: {
      member_id: string;
      account_type: 'tfsa' | 'rrsp';
      year: number;
      entries: Array<{ month: number; self_cents: number; employer_cents: number }>;
    },
  ) =>
    runOnHousehold(householdId, async () => {
      let { account } = await localRegisteredApi.setMemberLine(householdId, {
        member_id: data.member_id,
        account_type: data.account_type,
      });

      if (!account) {
        account = await ensureRoomOnlyAccount(householdId, data.member_id, data.account_type, data);
      }

      const newRows: RegisteredTransaction[] = [];
      for (const entry of data.entries) {
        if (entry.month < 1 || entry.month > 12) continue;
        const period = `${data.year}-${pad2(entry.month)}`;
        const transaction_date = `${period}-01`;
        const legs: Array<{ contributor: 'self' | 'employer'; amount: number }> = [
          { contributor: 'self', amount: Math.max(0, Math.round(entry.self_cents)) },
          { contributor: 'employer', amount: Math.max(0, Math.round(entry.employer_cents)) },
        ];
        for (const leg of legs) {
          if (leg.amount <= 0) continue;
          newRows.push({
            id: newLocalId('reg_tx'),
            account_id: account.id,
            type: 'contribution',
            kind: 'regular',
            contributor: leg.contributor,
            amount_cents: leg.amount,
            transaction_date,
            tax_year: data.year,
            period,
            notes: null,
            source: 'manual',
            import_batch_id: null,
            created_by: getLocalMemberId(),
            created_at: isoNow(),
          });
        }
      }

      let refreshed: RegisteredAccount | null = null;
      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredTransactions = [
            ...ledger.registeredTransactions.filter(
              (tx) =>
                !(
                  tx.account_id === account!.id &&
                  tx.type === 'contribution' &&
                  tx.kind === 'regular' &&
                  tx.period?.startsWith(`${data.year}-`)
                ),
            ),
            ...newRows,
          ];
          const balance = recomputeAccountBalance(account!.id, ledger.registeredTransactions);
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== account!.id) return a;
            refreshed = { ...a, balance_cents: balance, updated_at: isoNow() };
            return refreshed;
          });
        },
        {
          opType: 'REGISTERED_MEMBER_BACKFILL',
          entityType: 'registered_account',
          entityId: account.id,
          payload: data,
        },
      );

      return { account: refreshed! };
    }),

  deleteMemberContributions: async (
    householdId: string,
    data: { member_id: string; account_type: 'tfsa' | 'rrsp'; year: number },
  ) =>
    runOnHousehold(householdId, async () => {
      const existing = findMemberLine(
        getLocalLedger(),
        householdId,
        data.member_id,
        data.account_type,
      );
      if (!existing) return { account: null };

      const txns = getLocalLedger().registeredTransactions.filter(
        (tx) => tx.account_id === existing.id,
      );
      const yearContribIds = txns
        .filter(
          (tx) => tx.type === 'contribution' && txYear(tx) === data.year,
        )
        .map((tx) => tx.id);

      const remaining = txns.filter((tx) => !yearContribIds.includes(tx.id));
      const balance = remaining.reduce(
        (sum, tx) => sum + (tx.type === 'contribution' ? tx.amount_cents : -tx.amount_cents),
        0,
      );

      const hasRoom = (existing.starting_room_cents ?? 0) > 0;
      const hasGoal = existing.annual_goal_cents != null || existing.annual_goal_pct != null;

      if (existing.is_room_only && !hasRoom && !hasGoal && remaining.length === 0) {
        await mutateLocalLedger(
          (ledger) => {
            ledger.registeredAccounts = ledger.registeredAccounts.filter(
              (a) => a.id !== existing.id,
            );
            ledger.registeredTransactions = ledger.registeredTransactions.filter(
              (tx) => tx.account_id !== existing.id,
            );
          },
          {
            opType: 'REGISTERED_MEMBER_CONTRIBUTIONS_CLEAR',
            entityType: 'registered_account',
            entityId: existing.id,
            payload: data,
          },
        );
        return { account: null };
      }

      let refreshed: RegisteredAccount | null = null;
      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredTransactions = ledger.registeredTransactions.filter(
            (tx) => !yearContribIds.includes(tx.id),
          );
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== existing.id) return a;
            refreshed = {
              ...a,
              ...(a.is_room_only
                ? {
                    regular_contribution_cents: null,
                    employer_match_cents: null,
                    recurring_start_month: null,
                  }
                : {}),
              balance_cents: balance,
              updated_at: isoNow(),
            };
            return refreshed;
          });
        },
        {
          opType: 'REGISTERED_MEMBER_CONTRIBUTIONS_DELETE',
          entityType: 'registered_account',
          entityId: existing.id,
          payload: data,
        },
      );

      return { account: refreshed };
    }),

  getRoom: async (householdId: string, accountId: string, year: number): Promise<RegisteredRoom> => {
    const ledger = await getLocalLedgerFor(householdId);
    const account = requireAccount(ledger, householdId, accountId);
    requireLimitsForYear(year);
    return projectRegisteredRoom(ledger, account, year);
  },

  applyRegularContribution: async (
    householdId: string,
    accountId: string,
    data: { year: number; month: number },
  ) =>
    runOnHousehold(householdId, async () => {
      const account = requireAccount(getLocalLedger(), householdId, accountId);
      if (account.regular_contribution_cents == null) {
        return { created: false, transaction: null, account };
      }

      const period = `${data.year}-${pad2(data.month)}`;
      const transaction_date = `${data.year}-${pad2(data.month)}-01`;

      const existing = getLocalLedger().registeredTransactions.find(
        (tx) =>
          tx.account_id === accountId &&
          tx.kind === 'regular' &&
          tx.period === period &&
          tx.contributor === 'self',
      );
      if (existing) {
        return { created: false, transaction: null, account };
      }

      const tx: RegisteredTransaction = {
        id: newLocalId('reg_tx'),
        account_id: accountId,
        type: 'contribution',
        kind: 'regular',
        contributor: 'self',
        amount_cents: account.regular_contribution_cents,
        transaction_date,
        tax_year: data.year,
        period,
        notes: null,
        source: 'manual',
        import_batch_id: null,
        created_by: getLocalMemberId(),
        created_at: isoNow(),
      };

      let refreshed: RegisteredAccount | null = null;
      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredTransactions = [...ledger.registeredTransactions, tx];
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== accountId) return a;
            refreshed = {
              ...a,
              balance_cents: a.balance_cents + account.regular_contribution_cents!,
              updated_at: isoNow(),
            };
            return refreshed;
          });
        },
        {
          opType: 'REGISTERED_APPLY_REGULAR',
          entityType: 'registered_transaction',
          entityId: tx.id,
          payload: { accountId, ...data },
        },
      );

      return { created: true, transaction: tx, account: refreshed! };
    }),

  addTransaction: async (
    householdId: string,
    accountId: string,
    data: AddTransactionRequest,
  ) =>
    runOnHousehold(householdId, async () => {
      const account = requireAccount(getLocalLedger(), householdId, accountId);
      const existing = getLocalLedger().registeredTransactions.find((tx) => tx.id === data.id);
      if (existing) {
        return {
          transaction: existing,
          account: requireAccount(getLocalLedger(), householdId, accountId),
        };
      }

      const tx: RegisteredTransaction = {
        id: data.id,
        account_id: accountId,
        type: data.type,
        kind: data.kind ?? 'manual',
        contributor: data.contributor ?? 'self',
        amount_cents: data.amount_cents,
        transaction_date: data.transaction_date,
        tax_year: data.tax_year ?? null,
        period: null,
        notes: data.notes ?? null,
        source: 'manual',
        import_batch_id: null,
        created_by: getLocalMemberId(),
        created_at: isoNow(),
      };

      const delta = data.type === 'contribution' ? data.amount_cents : -data.amount_cents;
      let refreshed: RegisteredAccount | null = null;

      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredTransactions = [...ledger.registeredTransactions, tx];
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== accountId) return a;
            refreshed = { ...a, balance_cents: account.balance_cents + delta, updated_at: isoNow() };
            return refreshed;
          });
        },
        {
          opType: 'REGISTERED_TRANSACTION_ADD',
          entityType: 'registered_transaction',
          entityId: tx.id,
          payload: tx,
        },
      );

      return { transaction: tx, account: refreshed! };
    }),

  deleteTransaction: async (householdId: string, accountId: string, txId: string) =>
    runOnHousehold(householdId, async () => {
      const account = requireAccount(getLocalLedger(), householdId, accountId);
      const tx = getLocalLedger().registeredTransactions.find(
        (t) => t.id === txId && t.account_id === accountId,
      );
      if (!tx) throw new Error('Registered transaction not found');

      const delta = tx.type === 'contribution' ? -tx.amount_cents : tx.amount_cents;

      await mutateLocalLedger(
        (ledger) => {
          ledger.registeredTransactions = ledger.registeredTransactions.filter(
            (t) => t.id !== txId,
          );
          ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
            if (a.id !== accountId) return a;
            return { ...a, balance_cents: account.balance_cents + delta, updated_at: isoNow() };
          });
        },
        {
          opType: 'REGISTERED_TRANSACTION_DELETE',
          entityType: 'registered_transaction',
          entityId: txId,
          payload: { txId },
        },
      );
    }),

  // The extract ladder itself reads no ledger, but it exists only to be fed to
  // `commitRegisteredImport(householdId, …)`, which writes. Activating up front
  // means an id this device holds no ledger for is refused BEFORE the member
  // waits on an AI call, instead of after.
  extractRegisteredStatementText: async (householdId: string, text: string) =>
    runOnHousehold(householdId, async () => {
      const { runRegisteredStatementExtractLadder } = await import('../ai/localImportLadder');
      return runRegisteredStatementExtractLadder({ text });
    }),

  extractRegisteredStatementFile: async (
    householdId: string,
    file: { uri: string; name: string; type: string },
    text?: string,
  ) =>
    runOnHousehold(householdId, async () => {
      const { runRegisteredStatementExtractLadder } = await import('../ai/localImportLadder');
      return runRegisteredStatementExtractLadder({ text, file });
    }),

  commitRegisteredImport: async (householdId: string, data: RegisteredImportCommitRequest) =>
    runOnHousehold(householdId, async () => {
      const createdAccountIds: string[] = [];
      let transactionCount = 0;
      const batchId = data.import_batch_id;
      const now = isoNow();
      const memberId = getLocalMemberId();

      // Phase 1 — resolve every account row and every transaction row with no
      // writes at all. This used to issue one create/update op PLUS one
      // transaction op per account, so a 3-account statement import was six
      // whole-ledger re-encryptions.
      const accountRows: RegisteredAccount[] = [];
      const txRows: RegisteredTransaction[] = [];
      const balanceTargets: Array<{ accountId: string; override: number | null }> = [];

      for (const input of data.accounts) {
        const accountType = input.account_type;
        if (!accountType) continue;

        let accountId = input.existing_account_id ?? null;
        const existing = accountId
          ? findAccount(getLocalLedger(), householdId, accountId)
          : undefined;
        if (accountId && existing) {
          accountRows.push(
            mergeAccountUpdate(
              existing,
              {
                institution: input.institution,
                is_employer_plan: input.is_employer_plan,
                employer_name: input.employer_name,
                balance_cents: input.balance_cents,
                annual_goal_cents: input.annual_goal_cents,
                starting_room_cents: input.starting_room_cents,
                member_id: input.member_id,
              },
              now,
            ),
          );
        } else {
          accountId = input.id ?? newLocalId('reg_acct');
          // `createAccount` short-circuits on an id it already holds, and the old
          // code still counted it as created — preserved on both points.
          if (!findAccount(getLocalLedger(), householdId, accountId)) {
            accountRows.push(
              buildAccountRow(
                householdId,
                {
                  id: accountId,
                  member_id: input.member_id ?? null,
                  account_type: accountType,
                  institution: input.institution ?? null,
                  is_employer_plan: input.is_employer_plan ?? false,
                  employer_name: input.employer_name ?? null,
                  balance_cents: input.balance_cents ?? 0,
                  annual_goal_cents: input.annual_goal_cents ?? null,
                  starting_room_cents: input.starting_room_cents ?? null,
                },
                now,
              ),
            );
          }
          createdAccountIds.push(accountId);
        }

        const contribs = input.contributions ?? [];
        if (contribs.length === 0) continue;

        const txs: RegisteredTransaction[] = contribs
          .filter((c) => c.amount_cents > 0 && c.transaction_date)
          .map((c) => ({
            id: c.id || newLocalId('reg_tx'),
            account_id: accountId!,
            type: 'contribution' as const,
            kind: 'manual' as const,
            contributor: c.contributor ?? 'self',
            amount_cents: c.amount_cents,
            transaction_date: c.transaction_date,
            tax_year: c.tax_year ?? Number(c.transaction_date.substring(0, 4)),
            period: null,
            notes: null,
            source: 'ai_import' as const,
            import_batch_id: batchId,
            created_by: memberId,
            created_at: now,
          }));

        if (txs.length === 0) continue;
        txRows.push(...txs);
        balanceTargets.push({ accountId: accountId!, override: input.balance_cents ?? null });
      }

      // Phase 2 — write. Accounts first (the transactions reference them), then
      // the transactions in byte-bounded chunks so no single op can approach the
      // relay's deposit cap.
      for (const chunk of chunkRowsForOp(accountRows)) {
        await mutateLocalLedger(
          (ledger) => {
            const byId = new Map(chunk.map((row) => [row.id, row]));
            const replaced = new Set<string>();
            ledger.registeredAccounts = ledger.registeredAccounts.map((a) => {
              const next = byId.get(a.id);
              if (!next) return a;
              replaced.add(a.id);
              return next;
            });
            const fresh = chunk.filter((row) => !replaced.has(row.id));
            if (fresh.length > 0) {
              ledger.registeredAccounts = [...ledger.registeredAccounts, ...fresh];
            }
          },
          {
            opType: 'REGISTERED_IMPORT_ACCOUNTS_BULK',
            entityType: 'registered_account',
            entityId: batchId,
            payload: { batchId, count: chunk.length },
          },
        );
      }

      const txChunks = chunkRowsForOp(txRows);
      for (let i = 0; i < txChunks.length; i += 1) {
        const chunk = txChunks[i]!;
        // Balances are recomputed over the FULL post-insert transaction set, so
        // they ride the last chunk rather than costing an op of their own.
        const isLast = i === txChunks.length - 1;
        await mutateLocalLedger(
          (ledger) => {
            const existingIds = new Set(ledger.registeredTransactions.map((t) => t.id));
            const fresh = chunk.filter((t) => !existingIds.has(t.id));
            ledger.registeredTransactions = [...ledger.registeredTransactions, ...fresh];
            transactionCount += fresh.length;
            if (!isLast) return;
            const stamp = isoNow();
            for (const target of balanceTargets) {
              const idx = ledger.registeredAccounts.findIndex((a) => a.id === target.accountId);
              if (idx < 0) continue;
              ledger.registeredAccounts[idx] = {
                ...ledger.registeredAccounts[idx]!,
                balance_cents:
                  target.override != null
                    ? target.override
                    : recomputeAccountBalance(target.accountId, ledger.registeredTransactions),
                updated_at: stamp,
              };
            }
          },
          {
            opType: 'REGISTERED_IMPORT_COMMIT_BULK',
            entityType: 'registered_account',
            entityId: batchId,
            payload: { batchId, txCount: chunk.length },
          },
        );
      }

      return { import_batch_id: batchId, createdAccountIds, transactionCount };
    }),

  undoRegisteredImport: async (householdId: string, importBatchId: string) =>
    runOnHousehold(householdId, async () => {
      let deleted = 0;
      const affected = new Set(
        getLocalLedger()
          .registeredTransactions.filter((tx) => tx.import_batch_id === importBatchId)
          .map((tx) => tx.account_id),
      );
      await mutateLocalLedger(
        (ledger) => {
          const before = ledger.registeredTransactions.length;
          ledger.registeredTransactions = ledger.registeredTransactions.filter(
            (tx) => tx.import_batch_id !== importBatchId,
          );
          deleted = before - ledger.registeredTransactions.length;
          for (const accountId of affected) {
            const idx = ledger.registeredAccounts.findIndex((a) => a.id === accountId);
            if (idx < 0) continue;
            ledger.registeredAccounts[idx] = {
              ...ledger.registeredAccounts[idx],
              balance_cents: recomputeAccountBalance(accountId, ledger.registeredTransactions),
              updated_at: isoNow(),
            };
          }
        },
        {
          opType: 'REGISTERED_IMPORT_UNDO',
          entityType: 'registered_account',
          entityId: householdId,
          payload: { importBatchId },
        },
      );
      return { deleted };
    }),
};
