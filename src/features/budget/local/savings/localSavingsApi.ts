import type {
  ApplyMonthRequest,
  CreateGoalRequest,
  CreateIncomeRequest,
  CreateIncomeTemplateRequest,
  CreateRecurringPaymentRequest,
  CreateSavingsCategoryRequest,
  CreateSpendingRequest,
  ProjectionMethod,
  SetProjectionTargetsRequest,
  UpdateGoalRequest,
  UpdateIncomeRequest,
  UpdateIncomeTemplateRequest,
  UpdateRecurringPaymentRequest,
  UpdateSavingsCategoryRequest,
  UpdateSpendingRequest,
} from '@api/savings';
import { getSavedProjectionMethod, useSavingsStore } from '@stores/savingsStore';

import '../cryptoPolyfill';
import {
  getLocalLedger,
  getLocalLedgerFor,
  getLocalMemberId,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';
import { isoNow, monthKey, newLocalId } from '../ids';
import { chunkRowsForOp } from '../projection';

import { localRegisteredApi } from './localRegisteredApi';
import {
  applyProjectionTargets,
  compareYears,
  getEmergencyFundSuggestion,
  getHistoryYears,
  getOverview,
  getRecurringApplyStatus,
  getRecurringPaymentMonthlyHistory,
  getRecurringYearlyGroupBreakdown,
  getTrend,
  getYearHistory,
  goalWithPace,
  listIncomeInMonth,
  listRecurring,
  listSpendingInMonth,
  spendingDateForRecurring,
} from './localSavingsProjector';
import { isRecurringPaymentActiveInMonth } from './recurringScope';
import { getScenarioProjection as getProjection } from './scenarioProjection';

/**
 * `hasRecurringApplied` / `hasTemplateApplied` (localSavingsProjector) are
 * O(rows) predicates. Called once per (month × payment) inside a single
 * mutator they are O(rows × iterations) — 12 months × 40 payments over a
 * 7,000-row table is 3.4M comparisons on the JS thread, and Hermes is 3–8x
 * slower than the numbers measured here. These build the same answer once.
 *
 * The projector is not this stage's file to change, so the predicates stay
 * where they are and only these two call sites are de-quadraticized.
 */
function appliedRecurringKeys(ledger: LocalBudgetLedger): Set<string> {
  const keys = new Set<string>();
  for (const row of ledger.savingsSpending) {
    if (row.recurring_payment_id && row.period) {
      keys.add(`${row.recurring_payment_id}|${row.period}`);
    }
  }
  return keys;
}

function appliedTemplateKeys(ledger: LocalBudgetLedger): Set<string> {
  const keys = new Set<string>();
  for (const row of ledger.savingsIncome) {
    if (row.template_id && row.period) keys.add(`${row.template_id}|${row.period}`);
  }
  return keys;
}

/*
 * Savings WRITES run through the engine's `runOnHousehold(id, work)`, which
 * activates the named household first (BR-016 B5).
 *
 * `mutateLocalLedger` is bound to the ACTIVE session by design — the engine
 * deliberately gave it no `forHouseholdId` — so a call naming another household
 * has exactly two honest outcomes: move the session, or refuse. Writing anyway
 * would land household B's income in household A's ledger, which is the one
 * failure BR-016 exists to make impossible.
 *
 * It replaced `assertHousehold`, which threw on every such call. That was the
 * right answer while a device could hold only one household and became a wall
 * the moment it could hold two: anything naming a non-active household died with
 * "Savings household mismatch for local ledger" rather than doing the obvious
 * thing. Activating is what the member meant — they addressed that household.
 * The refusal half survives inside `runOnHousehold`, which raises
 * `BudgetLocalUnknownHouseholdError` for an id this device holds no ledger for.
 *
 * It also replaced this file's own copy of the helper, which activated and then
 * ran without holding the engine's session chain across the write — so a savings
 * write and, say, a mortgage write for two different households could interleave
 * and land in each other's ledgers. Six other facades carried the same copy;
 * the lock has to live where the ledger does.
 *
 * READS deliberately do NOT come through it — they take
 * `getLocalLedgerFor(householdId)`, which hydrates that household on demand and
 * returns its own ledger without moving the session. A read has no reason to
 * flip the app, and routing reads through it would let a stale refetch (a screen
 * that outlived a switch still holds the old id) drag the member back into the
 * household they just left.
 */

function unsupported(method: string): never {
  throw new BudgetLocalUnsupportedError(method);
}

/**
 * The row lookups take the ledger they are to read rather than reaching for the
 * active one. Under a single household those were the same object; under BR-016
 * they are not, and a helper that quietly read the active ledger would answer a
 * background household's read with the wrong household's rows — the exact bleed
 * the `household_id` filter below only *looks* like it prevents.
 */
function requireIncome(ledger: LocalBudgetLedger, householdId: string, id: string) {
  const row = ledger.savingsIncome.find((e) => e.id === id && e.household_id === householdId);
  if (!row) throw new Error('Income entry not found');
  return row;
}

function requireSpending(ledger: LocalBudgetLedger, householdId: string, id: string) {
  const row = ledger.savingsSpending.find((e) => e.id === id && e.household_id === householdId);
  if (!row) throw new Error('Spending entry not found');
  return row;
}

function requireCategory(ledger: LocalBudgetLedger, householdId: string, id: string) {
  const row = ledger.savingsCategories.find((c) => c.id === id && c.household_id === householdId);
  if (!row) throw new Error('Savings category not found');
  return row;
}

function requireGoal(ledger: LocalBudgetLedger, householdId: string, id: string) {
  const row = ledger.savingsGoals.find((g) => g.id === id && g.household_id === householdId);
  if (!row) throw new Error('Savings goal not found');
  return row;
}

function requireRecurring(ledger: LocalBudgetLedger, householdId: string, id: string) {
  const row = ledger.savingsRecurringPayments.find(
    (p) => p.id === id && p.household_id === householdId,
  );
  if (!row) throw new Error('Recurring payment not found');
  return row;
}

function requireIncomeTemplate(ledger: LocalBudgetLedger, householdId: string, id: string) {
  const row = ledger.savingsIncomeTemplates.find(
    (t) => t.id === id && t.household_id === householdId,
  );
  if (!row) throw new Error('Income template not found');
  return row;
}

/**
 * Local implementation of the savingsApi surface for Budget V2 local-first.
 * Registered accounts and AI import routes throw `BudgetLocalUnsupportedError`.
 */
export const localSavingsApi = {
  getOverview: async (householdId: string, year: number, month: number) => {
    return getOverview(await getLocalLedgerFor(householdId), year, month);
  },

  getTrend: async (householdId: string, year: number, month: number, months = 6) => {
    return getTrend(await getLocalLedgerFor(householdId), year, month, months);
  },

  listIncome: async (householdId: string, year: number, month: number) => {
    return { entries: listIncomeInMonth(await getLocalLedgerFor(householdId), year, month) };
  },

  createIncome: async (householdId: string, data: CreateIncomeRequest) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      const memberId = getLocalMemberId();
      const entry = {
        id: data.id,
        household_id: householdId,
        member_id: data.member_id ?? memberId,
        source_type: data.source_type,
        label: data.label,
        amount_cents: data.amount_cents,
        income_date: data.income_date,
        currency: data.currency ?? 'CAD',
        notes: data.notes ?? null,
        template_id: null,
        period: data.income_date.slice(0, 7),
        status: 'confirmed' as const,
        rolled_over_from_entry_id: null,
        created_by: memberId,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          if (!ledger.savingsIncome.some((e) => e.id === data.id)) {
            ledger.savingsIncome.push(entry);
          }
        },
        { opType: 'SAVINGS_INCOME_CREATE', entityType: 'savings_income', entityId: data.id, payload: entry },
      );
      // Read back through the ACTIVE ledger: `runOnHousehold` just made this
      // household active, and `mutateLocalLedger` wrote into that same session.
      return { entry: requireIncome(getLocalLedger(), householdId, data.id) };
    }),

  updateIncome: async (householdId: string, id: string, data: UpdateIncomeRequest) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsIncome.find((e) => e.id === id && e.household_id === householdId);
          if (!row) throw new Error('Income entry not found');
          if (data.member_id !== undefined) row.member_id = data.member_id;
          if (data.source_type !== undefined) row.source_type = data.source_type;
          if (data.label !== undefined) row.label = data.label;
          if (data.amount_cents !== undefined) row.amount_cents = data.amount_cents;
          if (data.income_date !== undefined) {
            row.income_date = data.income_date;
            row.period = data.income_date.slice(0, 7);
          }
          if (data.currency !== undefined) row.currency = data.currency;
          if (data.notes !== undefined) row.notes = data.notes;
          if (row.status === 'draft') row.status = 'confirmed';
          row.updated_at = isoNow();
        },
        { opType: 'SAVINGS_INCOME_UPDATE', entityType: 'savings_income', entityId: id, payload: data },
      );
      return { entry: requireIncome(getLocalLedger(), householdId, id) };
    }),

  deleteIncome: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsIncome = ledger.savingsIncome.filter(
            (e) => !(e.id === id && e.household_id === householdId),
          );
        },
        { opType: 'SAVINGS_INCOME_DELETE', entityType: 'savings_income', entityId: id, payload: {} },
      );
    }),

  confirmIncome: async (householdId: string, id: string, data?: UpdateIncomeRequest) =>
    // The whole pair is inside one `runOnHousehold`, not just the confirm op. The
    // nested `updateIncome` re-enters it and finds the household already active,
    // so it costs nothing — but hoisting it means the update and the confirm
    // cannot be split across a switch by anything racing between them.
    runOnHousehold(householdId, async () => {
      if (data && Object.keys(data).length > 0) {
        await localSavingsApi.updateIncome(householdId, id, data);
      }
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsIncome.find((e) => e.id === id && e.household_id === householdId);
          if (!row) throw new Error('Income entry not found');
          row.status = 'confirmed';
          row.updated_at = isoNow();
        },
        { opType: 'SAVINGS_INCOME_CONFIRM', entityType: 'savings_income', entityId: id, payload: data ?? {} },
      );
      return { entry: requireIncome(getLocalLedger(), householdId, id) };
    }),

  confirmAllDraftIncome: async (householdId: string, year: number, month: number) =>
    runOnHousehold(householdId, async () => {
      let confirmed = 0;
      await mutateLocalLedger(
        (ledger) => {
          for (const row of ledger.savingsIncome) {
            if (row.household_id !== householdId || row.status !== 'draft') continue;
            if (!row.income_date.startsWith(monthKey(year, month))) continue;
            row.status = 'confirmed';
            row.updated_at = isoNow();
            confirmed++;
          }
        },
        {
          opType: 'SAVINGS_INCOME_CONFIRM_ALL',
          entityType: 'savings_income',
          entityId: monthKey(year, month),
          payload: { year, month },
        },
      );
      return { confirmed };
    }),

  listSpending: async (householdId: string, year: number, month: number) => {
    return { entries: listSpendingInMonth(await getLocalLedgerFor(householdId), year, month) };
  },

  createSpending: async (householdId: string, data: CreateSpendingRequest) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      const memberId = getLocalMemberId();
      const entry = {
        id: data.id,
        household_id: householdId,
        category_id: data.category_id ?? null,
        label: data.label,
        amount_cents: data.amount_cents,
        currency: data.currency ?? 'CAD',
        spending_date: data.spending_date,
        notes: data.notes ?? null,
        recurring_payment_id: null,
        period: data.spending_date.slice(0, 7),
        created_by: memberId,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          if (!ledger.savingsSpending.some((e) => e.id === data.id)) {
            ledger.savingsSpending.push(entry);
          }
        },
        { opType: 'SAVINGS_SPENDING_CREATE', entityType: 'savings_spending', entityId: data.id, payload: entry },
      );
      return { entry: requireSpending(getLocalLedger(), householdId, data.id) };
    }),

  updateSpending: async (householdId: string, id: string, data: UpdateSpendingRequest) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsSpending.find((e) => e.id === id && e.household_id === householdId);
          if (!row) throw new Error('Spending entry not found');
          if (data.category_id !== undefined) row.category_id = data.category_id;
          if (data.label !== undefined) row.label = data.label;
          if (data.amount_cents !== undefined) row.amount_cents = data.amount_cents;
          if (data.spending_date !== undefined) {
            row.spending_date = data.spending_date;
            row.period = data.spending_date.slice(0, 7);
          }
          if (data.currency !== undefined) row.currency = data.currency;
          if (data.notes !== undefined) row.notes = data.notes;
          row.updated_at = isoNow();
        },
        { opType: 'SAVINGS_SPENDING_UPDATE', entityType: 'savings_spending', entityId: id, payload: data },
      );
      return { entry: requireSpending(getLocalLedger(), householdId, id) };
    }),

  deleteSpending: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsSpending = ledger.savingsSpending.filter(
            (e) => !(e.id === id && e.household_id === householdId),
          );
        },
        { opType: 'SAVINGS_SPENDING_DELETE', entityType: 'savings_spending', entityId: id, payload: {} },
      );
    }),

  listCategories: async (householdId: string) => {
    const ledger = await getLocalLedgerFor(householdId);
    const categories = ledger.savingsCategories
      .filter((c) => c.household_id === householdId)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return { categories };
  },

  createCategory: async (householdId: string, data: CreateSavingsCategoryRequest) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      const category = {
        id: newLocalId('sav_cat'),
        household_id: householdId,
        name: data.name.trim(),
        icon: data.icon ?? null,
        color: data.color ?? null,
        is_essential: data.is_essential ?? false,
        sort_order: getLocalLedger().savingsCategories.length,
        created_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsCategories.push(category);
        },
        { opType: 'SAVINGS_CATEGORY_CREATE', entityType: 'savings_category', entityId: category.id, payload: category },
      );
      return { category };
    }),

  updateCategory: async (householdId: string, id: string, data: UpdateSavingsCategoryRequest) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsCategories.find((c) => c.id === id && c.household_id === householdId);
          if (!row) throw new Error('Savings category not found');
          if (data.name !== undefined) row.name = data.name.trim();
          if (data.icon !== undefined) row.icon = data.icon ?? null;
          if (data.color !== undefined) row.color = data.color ?? null;
          if (data.is_essential !== undefined) row.is_essential = data.is_essential;
          if (data.sort_order !== undefined) row.sort_order = data.sort_order;
        },
        { opType: 'SAVINGS_CATEGORY_UPDATE', entityType: 'savings_category', entityId: id, payload: data },
      );
      return { category: requireCategory(getLocalLedger(), householdId, id) };
    }),

  deleteCategory: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsCategories = ledger.savingsCategories.filter(
            (c) => !(c.id === id && c.household_id === householdId),
          );
        },
        { opType: 'SAVINGS_CATEGORY_DELETE', entityType: 'savings_category', entityId: id, payload: {} },
      );
    }),

  listGoals: async (householdId: string) => {
    const ledger = await getLocalLedgerFor(householdId);
    const goals = ledger.savingsGoals
      .filter((g) => g.household_id === householdId)
      .map(goalWithPace);
    return { goals };
  },

  createGoal: async (householdId: string, data: CreateGoalRequest) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      const goal = {
        id: data.id,
        household_id: householdId,
        type: data.type,
        name: data.name,
        target_amount_cents: data.target_amount_cents,
        current_amount_cents: data.current_amount_cents ?? 0,
        target_date: data.target_date ?? null,
        months_of_expenses: data.months_of_expenses ?? null,
        monthly_allocation_cents: data.monthly_allocation_cents ?? null,
        currency: 'CAD',
        status: 'active' as const,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          if (!ledger.savingsGoals.some((g) => g.id === data.id)) {
            ledger.savingsGoals.push(goal);
          }
        },
        { opType: 'SAVINGS_GOAL_CREATE', entityType: 'savings_goal', entityId: data.id, payload: goal },
      );
      return { goal: goalWithPace(requireGoal(getLocalLedger(), householdId, data.id)) };
    }),

  updateGoal: async (householdId: string, id: string, data: UpdateGoalRequest) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsGoals.find((g) => g.id === id && g.household_id === householdId);
          if (!row) throw new Error('Savings goal not found');
          if (data.name !== undefined) row.name = data.name;
          if (data.target_amount_cents !== undefined) row.target_amount_cents = data.target_amount_cents;
          if (data.current_amount_cents !== undefined) row.current_amount_cents = data.current_amount_cents;
          if (data.target_date !== undefined) row.target_date = data.target_date;
          if (data.months_of_expenses !== undefined) row.months_of_expenses = data.months_of_expenses;
          if (data.monthly_allocation_cents !== undefined) {
            row.monthly_allocation_cents = data.monthly_allocation_cents;
          }
          if (data.status !== undefined) row.status = data.status;
          row.updated_at = isoNow();
        },
        { opType: 'SAVINGS_GOAL_UPDATE', entityType: 'savings_goal', entityId: id, payload: data },
      );
      return { goal: goalWithPace(requireGoal(getLocalLedger(), householdId, id)) };
    }),

  deleteGoal: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsGoals = ledger.savingsGoals.filter(
            (g) => !(g.id === id && g.household_id === householdId),
          );
        },
        { opType: 'SAVINGS_GOAL_DELETE', entityType: 'savings_goal', entityId: id, payload: {} },
      );
    }),

  getEmergencyFundSuggestion: async (householdId: string, months = 6) => {
    return getEmergencyFundSuggestion(await getLocalLedgerFor(householdId), months);
  },

  listIncomeTemplates: async (householdId: string) => {
    const ledger = await getLocalLedgerFor(householdId);
    const templates = ledger.savingsIncomeTemplates
      .filter((t) => t.household_id === householdId)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { templates };
  },

  createIncomeTemplate: async (householdId: string, data: CreateIncomeTemplateRequest) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      const memberId = getLocalMemberId();
      const template = {
        id: data.id,
        household_id: householdId,
        member_id: data.member_id ?? memberId,
        source_type: data.source_type,
        label: data.label,
        amount_cents: data.amount_cents,
        currency: 'CAD',
        day_of_month: data.day_of_month ?? null,
        active: data.active ?? true,
        created_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          if (!ledger.savingsIncomeTemplates.some((t) => t.id === data.id)) {
            ledger.savingsIncomeTemplates.push(template);
          }
        },
        {
          opType: 'SAVINGS_INCOME_TEMPLATE_CREATE',
          entityType: 'savings_income_template',
          entityId: data.id,
          payload: template,
        },
      );
      return { template: requireIncomeTemplate(getLocalLedger(), householdId, data.id) };
    }),

  updateIncomeTemplate: async (householdId: string, id: string, data: UpdateIncomeTemplateRequest) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsIncomeTemplates.find(
            (t) => t.id === id && t.household_id === householdId,
          );
          if (!row) throw new Error('Income template not found');
          if (data.member_id !== undefined) row.member_id = data.member_id;
          if (data.source_type !== undefined) row.source_type = data.source_type;
          if (data.label !== undefined) row.label = data.label;
          if (data.amount_cents !== undefined) row.amount_cents = data.amount_cents;
          if (data.day_of_month !== undefined) row.day_of_month = data.day_of_month;
          if (data.active !== undefined) row.active = data.active;
        },
        {
          opType: 'SAVINGS_INCOME_TEMPLATE_UPDATE',
          entityType: 'savings_income_template',
          entityId: id,
          payload: data,
        },
      );
      return { template: requireIncomeTemplate(getLocalLedger(), householdId, id) };
    }),

  deleteIncomeTemplate: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsIncomeTemplates = ledger.savingsIncomeTemplates.filter(
            (t) => !(t.id === id && t.household_id === householdId),
          );
        },
        {
          opType: 'SAVINGS_INCOME_TEMPLATE_DELETE',
          entityType: 'savings_income_template',
          entityId: id,
          payload: {},
        },
      );
    }),

  applyIncomeTemplates: async (householdId: string, data: ApplyMonthRequest) =>
    runOnHousehold(householdId, async () => {
      const { year, month } = data;
      const period = monthKey(year, month);
      const memberId = getLocalMemberId();
      const ledger = getLocalLedger();
      const applied = appliedTemplateKeys(ledger);
      let skipped = 0;

      // Rows are built OUTSIDE the mutator so they can be chunked. A household
      // with hundreds of templates otherwise produced a single op — measured at
      // 400 templates it was one 192,254-char delta, 3x MAX_OP_DELTA_BYTES and
      // half a relay deposit on its own, so two of them could not share one.
      const rows: LocalBudgetLedger['savingsIncome'] = [];
      for (const tpl of ledger.savingsIncomeTemplates) {
        if (tpl.household_id !== householdId || !tpl.active) continue;
        if (applied.has(`${tpl.id}|${period}`)) {
          skipped++;
          continue;
        }
        applied.add(`${tpl.id}|${period}`);
        const income_date = spendingDateForRecurring(year, month, tpl.day_of_month);
        const now = isoNow();
        rows.push({
          id: newLocalId('sav_inc'),
          household_id: householdId,
          member_id: tpl.member_id,
          source_type: tpl.source_type,
          label: tpl.label,
          amount_cents: tpl.amount_cents,
          income_date,
          currency: tpl.currency,
          notes: null,
          template_id: tpl.id,
          period,
          status: 'confirmed',
          rolled_over_from_entry_id: null,
          created_by: memberId,
          created_at: now,
          updated_at: now,
        });
      }

      // Nothing to write → no op. The old shape still sealed and persisted a
      // whole-ledger op whose delta was null when every template was applied.
      for (const chunk of chunkRowsForOp(rows)) {
        await mutateLocalLedger(
          (l) => {
            l.savingsIncome.push(...chunk);
          },
          {
            opType: 'SAVINGS_INCOME_APPLY_TEMPLATES',
            entityType: 'savings_income',
            entityId: period,
            // The rows travel in the delta; repeating them in the intent would
            // double the sealed op for nothing.
            payload: { year, month, count: chunk.length, household_id: householdId },
          },
        );
      }
      return { created: rows.length, skipped };
    }),

  listRecurringPayments: async (householdId: string, year?: number, month?: number) => {
    return listRecurring(await getLocalLedgerFor(householdId), year, month);
  },

  createRecurringPayment: async (householdId: string, data: CreateRecurringPaymentRequest) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      const memberId = getLocalMemberId();
      const isAutomated = data.is_automated ?? false;
      const isCustomScope = data.scope_type === 'custom_months';
      const item = {
        id: data.id,
        household_id: householdId,
        category_id: data.category_id ?? null,
        label: data.label,
        amount_cents: data.amount_cents,
        currency: 'CAD',
        day_of_month: isAutomated ? null : (data.day_of_month ?? null),
        group_label: data.group_label ?? null,
        is_essential: data.is_essential ?? false,
        active: data.active ?? true,
        is_automated: isAutomated,
        scope_type: isCustomScope ? ('custom_months' as const) : ('all_year' as const),
        scope_year: isCustomScope ? (data.scope_year ?? null) : null,
        active_months: isCustomScope ? (data.active_months ?? []) : null,
        source: 'manual' as const,
        created_by: memberId,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          if (!ledger.savingsRecurringPayments.some((p) => p.id === data.id)) {
            ledger.savingsRecurringPayments.push(item);
          }
        },
        {
          opType: 'SAVINGS_RECURRING_CREATE',
          entityType: 'savings_recurring',
          entityId: data.id,
          payload: item,
        },
      );
      return { item: requireRecurring(getLocalLedger(), householdId, data.id) };
    }),

  updateRecurringPayment: async (
    householdId: string,
    id: string,
    data: UpdateRecurringPaymentRequest,
  ) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const row = ledger.savingsRecurringPayments.find(
            (p) => p.id === id && p.household_id === householdId,
          );
          if (!row) throw new Error('Recurring payment not found');
          if (data.category_id !== undefined) row.category_id = data.category_id;
          if (data.label !== undefined) row.label = data.label;
          if (data.amount_cents !== undefined) row.amount_cents = data.amount_cents;
          if (data.day_of_month !== undefined) row.day_of_month = data.day_of_month;
          if (data.group_label !== undefined) row.group_label = data.group_label;
          if (data.is_essential !== undefined) row.is_essential = data.is_essential;
          if (data.active !== undefined) row.active = data.active;
          if (data.is_automated !== undefined) {
            row.is_automated = data.is_automated;
            if (data.is_automated) row.day_of_month = null;
          }
          if (data.scope_type !== undefined) {
            row.scope_type = data.scope_type === 'custom_months' ? 'custom_months' : 'all_year';
            if (row.scope_type === 'all_year') {
              row.scope_year = null;
              row.active_months = null;
            }
          }
          if (data.scope_year !== undefined) row.scope_year = data.scope_year;
          if (data.active_months !== undefined) row.active_months = data.active_months;
          row.updated_at = isoNow();
        },
        {
          opType: 'SAVINGS_RECURRING_UPDATE',
          entityType: 'savings_recurring',
          entityId: id,
          payload: data,
        },
      );
      return { item: requireRecurring(getLocalLedger(), householdId, id) };
    }),

  deleteRecurringPayment: async (householdId: string, id: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.savingsRecurringPayments = ledger.savingsRecurringPayments.filter(
            (p) => !(p.id === id && p.household_id === householdId),
          );
        },
        {
          opType: 'SAVINGS_RECURRING_DELETE',
          entityType: 'savings_recurring',
          entityId: id,
          payload: {},
        },
      );
    }),

  getRecurringPaymentMonthlyHistory: async (householdId: string, id: string, year: number) => {
    const ledger = await getLocalLedgerFor(householdId);
    const payment = requireRecurring(ledger, householdId, id);
    return getRecurringPaymentMonthlyHistory(ledger, payment, year);
  },

  propagateRecurringPayment: async (
    householdId: string,
    id: string,
    data: { year: number; fromMonth: number; toMonth: number },
  ) =>
    runOnHousehold(householdId, async () => {
      const payment = requireRecurring(getLocalLedger(), householdId, id);
      const lo = Math.min(data.fromMonth, data.toMonth);
      const hi = Math.max(data.fromMonth, data.toMonth);
      const periods: string[] = [];
      for (let m = lo; m <= hi; m++) {
        if (isRecurringPaymentActiveInMonth(payment, data.year, m)) {
          periods.push(monthKey(data.year, m));
        }
      }
      if (!periods.length) return { updated: 0 };

      let updated = 0;
      await mutateLocalLedger(
        (ledger) => {
          for (const row of ledger.savingsSpending) {
            if (row.household_id !== householdId || row.recurring_payment_id !== id) continue;
            if (!row.period || !periods.includes(row.period)) continue;
            row.amount_cents = payment.amount_cents;
            row.label = payment.label;
            row.category_id = payment.category_id;
            row.updated_at = isoNow();
            updated++;
          }
        },
        {
          opType: 'SAVINGS_RECURRING_PROPAGATE',
          entityType: 'savings_recurring',
          entityId: id,
          payload: data,
        },
      );
      return { updated };
    }),

  applyRecurringPayments: async (householdId: string, data: ApplyMonthRequest) => {
    return localSavingsApi.applyRecurringPaymentsToMonths(householdId, [
      { year: data.year, month: data.month },
    ]).then((r) => ({ created: r.created, skipped: r.skipped }));
  },

  applyRecurringPaymentsToMonths: async (
    householdId: string,
    months: Array<{ year: number; month: number }>,
  ) =>
    runOnHousehold(householdId, async () => {
      const memberId = getLocalMemberId();
      const ledger = getLocalLedger();
      const active = ledger.savingsRecurringPayments.filter((p) => p.active);
      const applied = appliedRecurringKeys(ledger);
      let skipped = 0;

      // Built outside the mutator so the write can be chunked. A full-year apply
      // is months x payments: 12 x 40 measured as ONE 196,436-char delta, 3x
      // MAX_OP_DELTA_BYTES and ~51% of a whole relay deposit after AEAD+base64.
      // It fit only because 480 happens to be small; nothing bounded it.
      const rows: LocalBudgetLedger['savingsSpending'] = [];
      for (const { year, month } of months) {
        const period = monthKey(year, month);
        for (const p of active) {
          if (p.household_id !== householdId) continue;
          if (!isRecurringPaymentActiveInMonth(p, year, month)) continue;
          if (applied.has(`${p.id}|${period}`)) {
            skipped++;
            continue;
          }
          applied.add(`${p.id}|${period}`);
          const spending_date = spendingDateForRecurring(year, month, p.day_of_month);
          const now = isoNow();
          rows.push({
            id: newLocalId('sav_spend'),
            household_id: householdId,
            category_id: p.category_id,
            label: p.label,
            amount_cents: p.amount_cents,
            currency: p.currency,
            spending_date,
            notes: null,
            recurring_payment_id: p.id,
            period,
            created_by: memberId,
            created_at: now,
            updated_at: now,
          });
        }
      }

      for (const chunk of chunkRowsForOp(rows)) {
        await mutateLocalLedger(
          (l) => {
            l.savingsSpending.push(...chunk);
          },
          {
            opType: 'SAVINGS_RECURRING_APPLY',
            entityType: 'savings_recurring',
            entityId: householdId,
            payload: { months: months.length, count: chunk.length, household_id: householdId },
          },
        );
      }

      return { created: rows.length, skipped, months: months.length };
    }),

  getRecurringApplyStatus: async (householdId: string, year: number) => {
    return getRecurringApplyStatus(await getLocalLedgerFor(householdId), year);
  },

  getRecurringYearlyGroupBreakdown: async (householdId: string, year: number) => {
    return getRecurringYearlyGroupBreakdown(await getLocalLedgerFor(householdId), year);
  },

  getHistoryYears: async (householdId: string) => {
    return getHistoryYears(await getLocalLedgerFor(householdId));
  },

  getYearHistory: async (householdId: string, year: number) => {
    return getYearHistory(await getLocalLedgerFor(householdId), year);
  },

  compareYears: async (householdId: string, years: number[]) => {
    return compareYears(await getLocalLedgerFor(householdId), years);
  },

  getProjection: async (householdId: string, year: number, method?: ProjectionMethod) => {
    return getProjection(await getLocalLedgerFor(householdId), year, new Date(), method ?? await getSavedProjectionMethod(householdId));
  },

  setProjectionTargets: async (householdId: string, data: SetProjectionTargetsRequest) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          applyProjectionTargets(ledger, data);
        },
        {
          opType: 'SAVINGS_PROJECTION_TARGETS',
          entityType: 'savings_projection',
          entityId: String(data.year),
          payload: data,
        },
      );
      return getProjection(getLocalLedger(), data.year, new Date(), await getSavedProjectionMethod(householdId));
    }),

  // Local app preference: shared by every forecast reader, scoped to household.
  setDefaultProjectionMethod: async (householdId: string, year: number, method: ProjectionMethod) => {
    const ledger = await getLocalLedgerFor(householdId);
    await getSavedProjectionMethod(householdId);
    const projection = getProjection(ledger, year, new Date(), method);
    useSavingsStore.getState().setProjectionMethod(householdId, projection.method);
    return projection;
  },

  // ---- Registered accounts / Pension (localRegisteredApi) ----
  ...localRegisteredApi,

  // ---- AI data import (local ladder: text → optional BYOK → confirm) ----
  //
  // The ladder and the commit both read the ACTIVE ledger — `localImportLadder`
  // takes its category list from `getLocalLedger().categories` and
  // `confirmSavingsImport` writes through `mutateLocalLedger` — so these run
  // under `runOnHousehold` even though only the commit is nominally a write.
  // Analysing against A's categories and committing into B is the same bleed as
  // a misrouted write, only harder to see afterwards.
  importAnalyze: async (
    householdId: string,
    text: string,
    scope: import('@api/savings').SavingsImportScope = 'all',
  ) =>
    runOnHousehold(householdId, async () => {
      const { runSavingsImportLadder } = await import('../ai/localImportLadder');
      const { createLocalImportJob } = await import('../ai/localImportJobStore');
      const draft = await runSavingsImportLadder({ householdId, text, scope });
      const jobId = createLocalImportJob(householdId, draft, { sourceKind: 'text' });
      return { jobId, draft };
    }),

  importAnalyzeWithFile: async (
    householdId: string,
    file: { uri: string; type: string; name: string },
    text?: string,
    scope: import('@api/savings').SavingsImportScope = 'all',
  ) =>
    runOnHousehold(householdId, async () => {
      const { runSavingsImportLadder } = await import('../ai/localImportLadder');
      const { createLocalImportJob } = await import('../ai/localImportJobStore');
      const draft = await runSavingsImportLadder({
        householdId,
        text: text?.trim() ?? '',
        scope,
        file,
      });
      const jobId = createLocalImportJob(householdId, draft, {
        sourceKind: 'file',
        fileName: file.name,
        mimeType: file.type,
      });
      return { jobId, draft };
    }),

  /**
   * The only import call that touches no ledger at all: the job store is keyed
   * by `(householdId, jobId)` and already returns null across a household
   * boundary, so it needs neither an activation nor a hydrate. Sending it
   * through `runOnHousehold` would flip the app just to look up a draft.
   */
  importGet: async (householdId: string, jobId: string) => {
    const { getLocalImportJob } = await import('../ai/localImportJobStore');
    const stored = getLocalImportJob(householdId, jobId);
    if (!stored) throw new Error('Import job not found');
    return stored;
  },

  importCommit: async (
    householdId: string,
    jobId: string,
    selections: import('@api/savings').SavingsImportDraft,
  ) =>
    runOnHousehold(householdId, async () => {
      const { getLocalImportJob } = await import('../ai/localImportJobStore');
      const stored = getLocalImportJob(householdId, jobId);
      if (!stored) throw new Error('Import job not found');
      if (stored.job.status === 'committed') {
        const { countLocalImportCommitted } = await import('../ai/confirmSavingsImport');
        return countLocalImportCommitted(householdId, jobId);
      }
      const { commitLocalSavingsImport } = await import('../ai/confirmSavingsImport');
      return commitLocalSavingsImport(householdId, jobId, selections);
    }),

  importCommitHistory: async (
    householdId: string,
    jobId: string,
    selections: import('@api/savings').SavingsHistorySelections,
  ) =>
    runOnHousehold(householdId, async () => {
      const { commitLocalSavingsHistoryImport } = await import('../ai/confirmSavingsImport');
      return commitLocalSavingsHistoryImport(householdId, jobId, selections);
    }),

  importUndoHistory: async () => unsupported('importUndoHistory'),
  importDelete: async () => unsupported('importDelete'),
};

export type LocalSavingsApi = typeof localSavingsApi;
