/**
 * Shared fixtures for the Stage 3 projection suites.
 *
 * `emptyLedger` mirrors the one in multiMemberSync.test.ts rather than
 * importing it, because that file is the merge contract and must stay
 * self-contained; this module holds only what the scale/parking suites need.
 */
import { defaultCategories } from '../defaults';
import type { LocalBudgetLedger } from '../engine';
import type { OpStamp } from '../projection';

export function emptyLedger(
  householdId = 'hh_test',
  memberId = 'member-local',
  deviceId = 'dev-local',
): LocalBudgetLedger {
  return {
    version: 1,
    household: {
      id: householdId,
      name: 'Shared household',
      address_line1: null,
      address_line2: null,
      city: null,
      state_province: null,
      postal_code: null,
      country: 'CA',
      unit_system: null,
      photo_key: null,
      photo_url: null,
      purchase_price: null,
      purchase_date: null,
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      member_count: 2,
      my_role: 'owner',
    },
    memberId,
    deviceId,
    categories: defaultCategories(householdId),
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    mortgages: [],
    mortgageTerms: [],
    mortgageStatements: [],
    mortgageEvents: [],
    mortgageOffers: [],
    savingsIncome: [],
    savingsSpending: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    savingsCategories: [],
    savingsIncomeTemplates: [],
    savingsMonthlyTargets: [],
    budgetLoans: [],
    budgetRenewals: [],
    registeredAccounts: [],
    registeredTransactions: [],
    wishes: [],
    wishEntries: [],
    wishAttachments: [],
    ops: [],
    lww: {},
    conflicts: [],
  } as unknown as LocalBudgetLedger;
}

export function expenseRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    household_id: 'hh_test',
    budget_item_id: null,
    category_id: null,
    title: `Expense ${id}`,
    description: null,
    amount: 1000,
    saved_amount: 0,
    tax_amount: 0,
    deposit_amount: 0,
    expense_date: '2026-08-10',
    vendor: null,
    receipt_key: null,
    created_by: 'member-local',
    created_at: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

/** HLCs sort by wall clock first, so `at` alone orders these deterministically. */
export function stampAt(at: number, author = 'member-peer', opId = `op-${at}`): OpStamp {
  return {
    hlc: `${String(1_800_000_000_000 + at).padStart(15, '0')}-0-devpeer1`,
    authorMemberId: author,
    opId,
  };
}
