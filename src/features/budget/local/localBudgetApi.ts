import type {
  AffordabilityPlan,
  BudgetCategory,
  BudgetEncouragement,
  BudgetGoal,
  BudgetItem,
  BudgetOverview,
  BudgetTransferContext,
  BulkPlanInput,
  BulkSuggestionRequest,
  BulkSuggestionResponse,
  CreateTransferRequest,
  Expense,
  MonthlyOverview,
  ReceiptScanProgress,
  SubBudget,
  SubBudgetProgress,
  TimelineItem,
  TimelineSummary,
} from '@api/budget';
import { lexiconRelatives } from '@screens/budget/budgetNameLexicon';
import { defaultCategoryId } from '@symply/contracts';

import { estimateBulkMonths, type BulkEstimateAlias } from '../bulk/bulkEstimate';
import {
  addMonths,
  countedCentsForMonth,
  forEachCounted,
  lastPlanMonth,
  monthExpenseView,
  monthKeyOf,
  normalizeBulkPlan,
  spentByMonth,
} from '../bulk/bulkSplit';
import { BULK_PREVIEW_MONTHS } from '../bulk/bulkTypes';

// Polyfill before engine/@symply/local-first (noble caches crypto at import).
import './cryptoPolyfill';

import {
  EMPTY_CATEGORY_MERGE,
  applyCategoryMerge,
  countCategoryReferences,
  planCategoryMerge,
  type CategoryMergeOutcome,
} from './categoryDedupe';
import { defaultCategories } from './defaults';
import { quickAddFromExpenses, quickAddFromPlanned, type QuickAddSuggestionLists } from './quickAddSuggestions';
import {
  getLocalLedgerFor,
  isHouseholdBootstrapPending,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from './engine';
import { CategoryNameConflictError } from './errors';
import { expenseInMonth, isoNow, monthKey, newLocalId } from './ids';
import { chunkRowsForOp } from './projection';
import { listAliasHints, remapAliasCategories } from './receiptAliases';

/*
 * Writes run against a NAMED household rather than whichever one is active.
 *
 * Every method here already took a `householdId`, because the remote `budgetApi`
 * does — but until BR-016 that parameter was decorative. One session existed, so
 * the active ledger was always the right ledger and the id was at most a filter.
 * With several households on one device it stops being decorative and becomes a
 * correctness boundary.
 *
 * `mutateLocalLedger` deliberately has no `forHouseholdId`: it writes to the
 * ACTIVE session and nothing else (see its header in `engine.ts`). So a call
 * naming another household has exactly two honest outcomes — move the session,
 * or refuse. Writing anyway would push household B's expense into household A's
 * ledger, sealed correctly under A's HDK and therefore invisible to every
 * integrity check the engine has: the row decrypts, the op verifies, and the
 * defect surfaces later as A's member reading a stranger's grocery bill
 * (plan §2, hazards 2 and 3). Filtering on `household_id` afterwards does not
 * save it either — the row was authored into A and syncs to A's peers.
 *
 * This file used to own a private `withHousehold(id, run)` that activated and
 * then ran — and that shape was racy, because activation is queued on the
 * engine's session chain while `mutateLocalLedger` is not: a sibling facade call
 * for another household could land its activation between the two halves and
 * take the write with it. `runOnHousehold` holds the chain across BOTH halves,
 * and lives in the engine because the sibling facades (savings, wishes, loans,
 * mortgage, renewals) write the same ledger and a lock here would not see them.
 *
 * Reads deliberately do NOT come through it. A read resolves its ledger with
 * `getLocalLedgerFor(householdId)`, which hydrates on demand WITHOUT moving the
 * active pointer — a background refresh for household B must not yank the screen
 * the member is looking at over to B.
 */

function emptyAffordability(remaining: number): AffordabilityPlan {
  return {
    remaining_budget: remaining,
    used_budget: 0,
    affordable: [],
    deferred: [],
  };
}

/**
 * Every derived-value helper below takes the ledger it should read, rather than
 * reaching for the active one.
 *
 * They used to call `getLocalLedger()` themselves, which read as harmless when a
 * device held one household: the caller's `householdId` and the active ledger
 * could not disagree. They can now, and a helper that resolves its own source
 * would answer household A's totals for a question asked about B — with no
 * parameter anywhere in the call to reveal it. Passing the ledger in makes the
 * household the caller resolved the only household the answer can come from.
 */
function resolveGoal(source: LocalBudgetLedger, year: number, month: number): BudgetGoal {
  const existing = source.goals.find((g) => g.year === year && g.month === month);
  if (existing) return existing;
  const now = isoNow();
  return {
    id: `goal_${year}_${month}`,
    household_id: source.household.id,
    year,
    month,
    planned_budget: null,
    actual_spent: 0,
    category_budgets: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * "Spent this month" — through the month lens, so a bulk purchase counts its
 * portion here and its other portions in the months they belong to. Every
 * month-scoped number in this file goes through `monthExpenseView`; nothing
 * filters `expenses` by date to build a total on its own.
 */
function spentInMonth(source: LocalBudgetLedger, year: number, month: number): number {
  return monthExpenseView(source.expenses, year, month).totalCents;
}

/** One pass over expenses instead of one full scan per month. */
function spentByMonthKey(source: LocalBudgetLedger): Map<string, number> {
  return spentByMonth(source.expenses);
}

export type AddExpenseInput = {
  title: string;
  description?: string;
  amount: number;
  expense_date: string;
  category_id?: string;
  budget_item_id?: string;
  vendor?: string;
  saved_amount?: number;
  tax_amount?: number;
  deposit_amount?: number;
  /** Spread over months (stock-up). Validated by `normalizeBulkPlan` before anything is written. */
  bulk?: BulkPlanInput | null;
};

/**
 * Single source of the stored Expense shape — batched and single writes share it.
 *
 * `createdBy` is passed rather than read from `getLocalMemberId()`. The member id
 * is device-scoped and identical across every household on this device, so the
 * global accessor would in fact be right — but it reads the ACTIVE session, and
 * a row builder that quietly depends on which household happens to be active is
 * one refactor away from being wrong. The caller already has the ledger.
 */
function buildExpenseRow(householdId: string, createdBy: string, data: AddExpenseInput): Expense {
  return {
    id: newLocalId('exp'),
    household_id: householdId,
    budget_item_id: data.budget_item_id ?? null,
    category_id: data.category_id ?? null,
    title: data.title,
    description: data.description ?? null,
    amount: data.amount,
    saved_amount: data.saved_amount ?? 0,
    tax_amount: data.tax_amount ?? 0,
    deposit_amount: data.deposit_amount ?? 0,
    expense_date: data.expense_date,
    vendor: data.vendor ?? null,
    receipt_key: null,
    created_by: createdBy,
    created_at: isoNow(),
    bulk: data.bulk ? normalizeBulkPlan(data.bulk, data.expense_date) : null,
  };
}

/** Increment once per expense that names a category, exactly as addExpense did. */
function bumpCategoryUsage(ledger: LocalBudgetLedger, expenses: Expense[]): void {
  let byId: Map<string, BudgetCategory> | null = null;
  for (const expense of expenses) {
    if (!expense.category_id) continue;
    if (!byId) {
      byId = new Map(ledger.categories.map((c) => [c.id, c]));
    }
    const cat = byId.get(expense.category_id);
    if (cat) cat.usage_count = (cat.usage_count ?? 0) + 1;
  }
}

/**
 * Upsert one month's goal row in place. Extracted so `setMonthlyGoal` and the
 * batched `applyGoalToYear` cannot drift into writing different row shapes.
 */
function upsertGoalRow(
  ledger: LocalBudgetLedger,
  householdId: string,
  year: number,
  month: number,
  data: { planned_budget?: number | null; notes?: string | null },
  actualSpent: number,
  now: string,
): BudgetGoal {
  const idx = ledger.goals.findIndex((g) => g.year === year && g.month === month);
  if (idx >= 0) {
    const prev = ledger.goals[idx]!;
    const goal: BudgetGoal = {
      ...prev,
      planned_budget:
        data.planned_budget !== undefined ? data.planned_budget : prev.planned_budget,
      notes: data.notes !== undefined ? data.notes : prev.notes,
      actual_spent: actualSpent,
      updated_at: now,
    };
    ledger.goals[idx] = goal;
    return goal;
  }
  const goal: BudgetGoal = {
    id: `goal_${year}_${month}`,
    household_id: householdId,
    year,
    month,
    planned_budget: data.planned_budget ?? null,
    actual_spent: actualSpent,
    category_budgets: null,
    notes: data.notes ?? null,
    created_at: now,
    updated_at: now,
  };
  ledger.goals.push(goal);
  return goal;
}

function openItemsForMonth(
  source: LocalBudgetLedger,
  year: number,
  month: number,
): BudgetItem[] {
  const prefix = monthKey(year, month);
  return source.items.filter((item) => {
    if (item.status === 'completed' || item.status === 'cancelled') return false;
    if (item.target_date?.startsWith(prefix)) return true;
    return item.year === year && item.timeframe === 'month';
  });
}

function computeSubBudgetProgress(
  source: LocalBudgetLedger,
  year: number,
  month: number,
): {
  entries: SubBudgetProgress[];
  totalCapCents: number;
  plannedBudget: number;
  overAllocatedBy: number;
} {
  const goal = resolveGoal(source, year, month);
  const plannedBudget = goal.planned_budget ?? 0;
  // A bulk purchase's portion lands in its category each month — that is what
  // makes the category cap survive a stock-up.
  const byCategorySpent = monthExpenseView(source.expenses, year, month).byCategoryCents;

  const entries: SubBudgetProgress[] = [];
  let totalCapCents = 0;
  for (const sub of source.subBudgets) {
    if (sub.year !== year) continue;
    if (sub.month !== null && sub.month !== month) continue;
    const category = source.categories.find((c) => c.id === sub.category_id);
    if (!category) continue;
    let cap = 0;
    if (sub.limit_type === 'amount') {
      cap = sub.amount_cents ?? 0;
    } else if (sub.percent_bps != null && plannedBudget > 0) {
      cap = Math.round((plannedBudget * sub.percent_bps) / 10_000);
    }
    const spent = byCategorySpent.get(sub.category_id) ?? 0;
    totalCapCents += cap;
    entries.push({
      category_id: sub.category_id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      limit_type: sub.limit_type,
      percent_bps: sub.percent_bps,
      cap_cents: cap,
      spent_cents: spent,
      remaining_cents: cap - spent,
      over: spent > cap,
      scope: sub.month == null ? 'default' : 'month',
    });
  }

  return {
    entries,
    totalCapCents,
    plannedBudget,
    overAllocatedBy: Math.max(0, totalCapCents - plannedBudget),
  };
}

function toTimelineItem(item: BudgetItem, category: BudgetCategory | null): TimelineItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    estimatedCostMin: item.estimated_cost_min,
    estimatedCostMax: item.estimated_cost_max,
    actualCost: item.actual_cost,
    priority: item.priority,
    status: item.status,
    targetDate: item.target_date,
    timeframe: item.timeframe,
    year: item.year,
    quarter: item.quarter,
    sourceType: item.source_type,
    sourceId: item.source_id,
    category,
    createdAt: item.created_at,
  };
}

/**
 * Local implementation of the budgetApi surface used by Budget screens.
 * AI methods run against the member's own provider key and throw
 * `BudgetLocalUnsupportedError` when no key is connected on this device.
 *
 * Since BR-016 this device can hold several households at once, and the
 * `householdId` every method takes is load-bearing rather than decorative:
 *
 *  - **writes** go through `runOnHousehold(householdId, …)`, which activates the
 *    named household before `mutateLocalLedger` binds to the active session;
 *  - **reads** resolve their ledger with `getLocalLedgerFor(householdId)`, which
 *    hydrates that household on demand without moving the active pointer.
 *
 * Neither one reaches for `getLocalLedger()` any more. That accessor answers
 * "whatever is on screen", which was indistinguishable from "the household you
 * asked about" while a device held one — and is a cross-household read or write
 * the moment it holds two.
 */
export const localBudgetApi = {
  getCategories: async (householdId: string, options?: { includeHidden?: boolean }) => {
    const source = await getLocalLedgerFor(householdId);
    const cats = source.categories
      .filter((c) => c.household_id === householdId)
      .filter((c) => (options?.includeHidden ? true : !c.hidden))
      .slice()
      .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return { categories: cats };
  },

  createCategory: async (
    householdId: string,
    data: { name: string; icon?: string; color?: string },
  ) =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      const name = data.name.trim();
      const exists = source.categories.some(
        (c) => c.household_id === householdId && c.name.toLowerCase() === name.toLowerCase(),
      );
      if (exists) throw new CategoryNameConflictError(name);
      const category: BudgetCategory = {
        id: newLocalId('cat'),
        household_id: householdId,
        name,
        icon: data.icon ?? null,
        color: data.color ?? null,
        sort_order: source.categories.length,
        created_at: isoNow(),
        usage_count: 0,
        is_default: false,
        hidden: false,
      };
      await mutateLocalLedger(
        (ledger) => {
          ledger.categories.push(category);
        },
        {
          opType: 'CATEGORY_CREATE',
          entityType: 'category',
          entityId: category.id,
          payload: category,
        },
      );
      return { category };
    }),

  /**
   * Give a household the seed categories it predates.
   *
   * `defaultCategories` runs once, at mint. Every name added to it afterwards
   * therefore reaches new households only — which on a local-first app means
   * nobody, because the ledger on disk is the whole product. This is the other
   * half: it reconciles an existing ledger against the current seed list by
   * NAME, so adding a seed stays a one-line edit.
   *
   * Three things make it safe to run on every launch:
   *
   *  - **Deleting a default is a hide, not a delete** (`deleteCategory` above),
   *    so a category the member switched off still holds its name and is not
   *    resurrected. Only a RENAMED default can come back as a second row, which
   *    is the same edge the server-side backfill has lived with since v2.
   *  - **The id is derived from the name**, not from the seed's position. Two
   *    devices in one household both back-filling author the SAME row id, and
   *    the projection's LWW collapses them into one row instead of leaving the
   *    household with two Parkings. An index-derived id (`cat_default_12`)
   *    could not do this: inserting a seed mid-list renumbers everything after
   *    it, so the two devices would disagree the moment their builds differ.
   *  - **It writes only what is missing**, and returns 0 without touching the
   *    op log in the overwhelmingly common case.
   *
   * Authored through `mutateLocalLedger` rather than poked into the array, so
   * the rows persist, sync to peers and land in the checkpoint like any other
   * write. `is_default: true` — these ARE the seeds, and a member must be able
   * to hide them rather than being offered a delete that a relaunch undoes.
   */
  backfillDefaultCategories: async (householdId: string): Promise<{ added: string[] }> =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      const own = source.categories.filter((c) => c.household_id === householdId);
      // NOT into a household this device joined and has not yet received.
      //
      // Two costs, and the second one is the expensive one. The obvious one is
      // duplicates: a member with nothing to dedupe against seeds all 42 and
      // pushes 42 locally-invented categories at an owner who already has their
      // own (the hazard `adoptJoinedHousehold` refuses to create and this
      // undoes). The quiet one is that authoring ANY op moves this device's
      // version vector off empty — and `syncOneHousehold` only bootstraps from
      // a checkpoint while the vector IS empty. So the seed spends the one
      // bootstrap window the member gets, permanently, and the household's
      // history can never arrive. (Production, 2026-08-23: a joiner seeded 42
      // categories at first launch and the ledger stayed empty from then on.)
      if (own.length === 0 && (source.household.my_role ?? '').toLowerCase() !== 'owner') {
        return { added: [] };
      }
      // Nor while this device is still waiting for the household's history. An
      // owner's fresh phone adopts its own household EMPTY and passes the role
      // check above; seeding in that window put 43 name-derived rows beside the
      // positional-id rows the checkpoint then installed — the duplicate "Pets"
      // of 2026-09. `mergeDuplicateCategories` repairs a household that already
      // has them; this stops minting new ones.
      if (await isHouseholdBootstrapPending(householdId)) return { added: [] };
      const have = new Set(own.map((c) => c.name.trim().toLowerCase()));
      const missing = defaultCategories(householdId).filter(
        (seed) => !have.has(seed.name.trim().toLowerCase()),
      );
      if (missing.length === 0) return { added: [] };

      const now = isoNow();
      const rows: BudgetCategory[] = missing.map((seed, index) => ({
        ...seed,
        id: defaultCategoryId(seed.name),
        sort_order: own.length + index,
        created_at: now,
        usage_count: 0,
        is_default: true,
        hidden: false,
      }));
      await mutateLocalLedger(
        (ledger) => {
          ledger.categories.push(...rows);
        },
        {
          opType: 'CATEGORY_CREATE',
          entityType: 'category',
          entityId: rows[0]!.id,
          payload: rows,
        },
      );
      console.log(
        `[BudgetLocal] seeded ${rows.length} missing default categories`,
        rows.map((row) => row.name),
      );
      return { added: rows.map((row) => row.name) };
    }),

  /**
   * Collapse categories that share a name onto one row — see `categoryDedupe`
   * for the why and the survivor rule.
   *
   * Runs at session open and after every ledger change on the active household
   * (`categoryReconcile`), and costs a 40-row scan when there is nothing to do.
   * When there is, it is ONE op: the survivor's folded fields, the losers'
   * tombstones and every re-pointed spending, planned item and sub-budget
   * travel in a single delta, so a peer never projects the half-merged state.
   *
   * Not while the household's history is still landing: a merge over a partial
   * ledger would tombstone a category whose spendings are still in flight.
   */
  mergeDuplicateCategories: async (
    householdId: string,
  ): Promise<CategoryMergeOutcome & { deferred?: boolean }> =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      const plan = planCategoryMerge(source.categories, householdId);
      if (plan.groups.length === 0 && countCategoryReferences(source, plan.remap) === 0) {
        return EMPTY_CATEGORY_MERGE;
      }
      if (await isHouseholdBootstrapPending(householdId)) {
        return { ...EMPTY_CATEGORY_MERGE, deferred: true };
      }
      let outcome: CategoryMergeOutcome = EMPTY_CATEGORY_MERGE;
      await mutateLocalLedger(
        (ledger) => {
          outcome = applyCategoryMerge(ledger, plan, householdId);
        },
        {
          opType: 'CATEGORY_MERGE',
          entityType: 'category',
          entityId: plan.groups[0]?.winner.id ?? [...plan.remap.values()][0] ?? 'category',
          // Intent only — the rows travel in the delta.
          payload: {
            groups: plan.groups.map((group) => ({
              name: group.name,
              kept: group.winner.id,
              dropped: group.losers.map((loser) => loser.id),
            })),
          },
        },
      );
      // Device-local: the receipt scanner's learned aliases may still file a
      // line under a dropped id. Best effort — the ledger is already right.
      try {
        await remapAliasCategories(plan.remap);
      } catch (error) {
        console.warn('[BudgetLocal] receipt alias remap skipped', error);
      }
      if (outcome.merged.length > 0 || outcome.repointed > 0) {
        console.log('[BudgetLocal] merged duplicate categories', {
          merged: outcome.merged.map((m) => `${m.name}: ${m.droppedIds.join(',')} -> ${m.keptId}`),
          repointed: outcome.repointed,
          droppedSubBudgets: outcome.droppedSubBudgets,
        });
      }
      return outcome;
    }),

  updateCategory: async (
    householdId: string,
    categoryId: string,
    data: {
      name?: string;
      icon?: string;
      color?: string;
      sort_order?: number;
      hidden?: boolean;
    },
  ) =>
    runOnHousehold(householdId, async () => {
      let updated: BudgetCategory | undefined;
      await mutateLocalLedger(
        (ledger) => {
          const cat = ledger.categories.find(
            (c) => c.id === categoryId && c.household_id === householdId,
          );
          if (!cat) throw new Error('Category not found');
          if (data.name != null) {
            const clash = ledger.categories.some(
              (c) =>
                c.id !== categoryId &&
                c.household_id === householdId &&
                c.name.toLowerCase() === data.name!.trim().toLowerCase(),
            );
            if (clash) throw new CategoryNameConflictError(data.name);
            cat.name = data.name.trim();
          }
          if (data.icon !== undefined) cat.icon = data.icon ?? null;
          if (data.color !== undefined) cat.color = data.color ?? null;
          if (data.sort_order !== undefined) cat.sort_order = data.sort_order;
          if (data.hidden !== undefined) cat.hidden = data.hidden;
          updated = { ...cat };
        },
        { opType: 'CATEGORY_UPDATE', entityType: 'category', entityId: categoryId, payload: data },
      );
      return { category: updated! };
    }),

  deleteCategory: async (householdId: string, categoryId: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          const cat = ledger.categories.find(
            (c) => c.id === categoryId && c.household_id === householdId,
          );
          if (!cat) throw new Error('Category not found');
          if (cat.is_default) {
            cat.hidden = true;
          } else {
            ledger.categories = ledger.categories.filter((c) => c.id !== categoryId);
          }
        },
        { opType: 'CATEGORY_DELETE', entityType: 'category', entityId: categoryId, payload: {} },
      );
    }),

  addExpense: async (householdId: string, data: AddExpenseInput) =>
    runOnHousehold(householdId, async () => {
      // Built AFTER the activation, so `memberId` comes from the household this
      // expense is being written into rather than from the one it left behind.
      const source = await getLocalLedgerFor(householdId);
      const expense = buildExpenseRow(householdId, source.memberId, data);
      await mutateLocalLedger(
        (ledger) => {
          ledger.expenses.push(expense);
          bumpCategoryUsage(ledger, [expense]);
        },
        { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: expense.id, payload: expense },
      );
      return { expense };
    }),

  addExpensesBulk: async (householdId: string, expenses: AddExpenseInput[]) =>
    runOnHousehold(householdId, async () => {
      // One op per chunk, not one op per row. Calling addExpense in a loop meant
      // N full capture+diff+seal+persist cycles on a ledger that grew each pass —
      // quadratic, and N whole-ledger re-encryptions for one user gesture.
      const source = await getLocalLedgerFor(householdId);
      const created = expenses.map((row) => buildExpenseRow(householdId, source.memberId, row));
      for (const chunk of chunkRowsForOp(created)) {
        await mutateLocalLedger(
          (ledger) => {
            ledger.expenses.push(...chunk);
            bumpCategoryUsage(ledger, chunk);
          },
          {
            opType: 'EXPENSE_CREATE_BULK',
            entityType: 'expense',
            entityId: chunk[0]!.id,
            // Intent carries the shape only — the rows already travel in the
            // delta, and duplicating them doubles the sealed op for nothing.
            payload: { count: chunk.length, household_id: householdId },
          },
        );
      }
      return { expenses: created };
    }),

  getExpenses: async (
    householdId: string,
    filters?: {
      start_date?: string;
      end_date?: string;
      category_id?: string;
      limit?: number;
      year?: number;
      month?: number;
    },
  ) => {
    const source = await getLocalLedgerFor(householdId);
    let rows = source.expenses.filter((e) => e.household_id === householdId);
    if (filters?.year != null && filters?.month != null) {
      rows = rows.filter((e) => expenseInMonth(e.expense_date, filters.year!, filters.month!));
    }
    if (filters?.start_date) {
      rows = rows.filter((e) => e.expense_date >= filters.start_date!);
    }
    if (filters?.end_date) {
      rows = rows.filter((e) => e.expense_date <= filters.end_date!);
    }
    if (filters?.category_id) {
      rows = rows.filter((e) => e.category_id === filters.category_id);
    }
    rows = rows.slice().sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1));
    if (filters?.limit != null) {
      rows = rows.slice(0, filters.limit);
    }
    return { expenses: rows };
  },

  getExpense: async (householdId: string, expenseId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const expense = source.expenses.find(
      (e) => e.id === expenseId && e.household_id === householdId,
    );
    if (!expense) throw new Error('Expense not found');
    return { expense };
  },

  updateExpense: async (
    householdId: string,
    expenseId: string,
    data: {
      title?: string;
      description?: string | null;
      amount?: number;
      expense_date?: string;
      category_id?: string | null;
      saved_amount?: number;
      tax_amount?: number;
      deposit_amount?: number;
      vendor?: string | null;
      /** Replace the stock-up plan; `null` clears it. Omit to leave it alone. */
      bulk?: BulkPlanInput | null;
    },
  ) =>
    runOnHousehold(householdId, async () => {
      // Validate the plan against the date the row will END UP with, and do it
      // before the mutation so a bad plan is refused without touching the row.
      const source = await getLocalLedgerFor(householdId);
      const current = source.expenses.find(
        (e) => e.id === expenseId && e.household_id === householdId,
      );
      if (!current) throw new Error('Expense not found');
      const nextDate = data.expense_date ?? current.expense_date;
      const nextPlan =
        data.bulk === undefined
          ? undefined
          : data.bulk
            ? normalizeBulkPlan(data.bulk, nextDate)
            : null;

      let updated: Expense | undefined;
      await mutateLocalLedger(
        (ledger) => {
          const expense = ledger.expenses.find(
            (e) => e.id === expenseId && e.household_id === householdId,
          );
          if (!expense) throw new Error('Expense not found');
          const previousMonth = monthKeyOf(expense.expense_date);
          if (data.title !== undefined) expense.title = data.title;
          if (data.description !== undefined) expense.description = data.description;
          if (data.amount !== undefined) expense.amount = data.amount;
          if (data.expense_date !== undefined) expense.expense_date = data.expense_date;
          if (data.category_id !== undefined) expense.category_id = data.category_id;
          if (data.saved_amount !== undefined) expense.saved_amount = data.saved_amount;
          if (data.tax_amount !== undefined) expense.tax_amount = data.tax_amount;
          if (data.deposit_amount !== undefined) expense.deposit_amount = data.deposit_amount;
          if (data.vendor !== undefined) expense.vendor = data.vendor;
          if (nextPlan !== undefined) {
            expense.bulk = nextPlan;
          } else if (
            expense.bulk &&
            data.expense_date !== undefined &&
            expense.bulk.start_month === previousMonth
          ) {
            // The plan followed the purchase month; keep it there when the date moves.
            expense.bulk = { ...expense.bulk, start_month: monthKeyOf(expense.expense_date) };
          }
          updated = { ...expense };
        },
        { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: expenseId, payload: data },
      );
      return { expense: updated! };
    }),

  deleteExpense: async (householdId: string, expenseId: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.expenses = ledger.expenses.filter(
            (e) => !(e.id === expenseId && e.household_id === householdId),
          );
        },
        { opType: 'EXPENSE_DELETE', entityType: 'expense', entityId: expenseId, payload: {} },
      );
    }),

  /**
   * How many months a stock-up should last, from this household's own ledger —
   * plus the twelve months the form previews (cap and counted total each).
   * Read-only; nothing here touches the ledger or the network.
   */
  getBulkSuggestion: async (
    householdId: string,
    data: BulkSuggestionRequest,
  ): Promise<BulkSuggestionResponse> => {
    const source = await getLocalLedgerFor(householdId);
    const expenses = source.expenses.filter((e) => e.household_id === householdId);

    // Receipt aliases live in device storage, not the ledger. They sharpen the
    // estimate when present and are simply absent when storage is not there.
    let aliases: BulkEstimateAlias[] = [];
    try {
      aliases = (await listAliasHints()).map((hint) => ({ key: hint.key, name: hint.name }));
    } catch {
      aliases = [];
    }

    const suggestion = estimateBulkMonths({
      title: data.title,
      categoryId: data.category_id ?? null,
      amountCents: data.amount,
      savedCents: data.saved_amount ?? 0,
      purchaseDate: data.expense_date,
      quantity: data.quantity,
      unit: data.unit,
      excludeExpenseId: data.exclude_expense_id,
      expenses,
      categories: source.categories,
      aliases,
      lexiconRelatives,
    });

    const counted = spentByMonth(expenses.filter((e) => e.id !== data.exclude_expense_id));
    const purchaseMonth = monthKeyOf(data.expense_date);
    const monthContext = Array.from({ length: BULK_PREVIEW_MONTHS }, (_, i) => {
      const month = addMonths(purchaseMonth, i);
      const goal = source.goals.find((g) => monthKey(g.year, g.month) === month);
      return {
        month,
        plannedBudget: goal?.planned_budget ?? null,
        countedCents: counted.get(month) ?? 0,
      };
    });
    return { suggestion, monthContext };
  },

  createItem: async (
    householdId: string,
    data: {
      title: string;
      description?: string;
      category_id?: string;
      timeframe: string;
      year?: number;
      quarter?: number;
      estimated_cost_min?: number;
      estimated_cost_max?: number;
      priority: 'critical' | 'high' | 'medium' | 'low';
      target_date?: string;
      is_recurring?: boolean;
      recurrence_frequency?: 'monthly' | 'quarterly' | 'yearly';
    },
  ) =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      const now = isoNow();
      const item: BudgetItem = {
        id: newLocalId('item'),
        household_id: householdId,
        category_id: data.category_id ?? null,
        timeframe: data.timeframe,
        year: data.year ?? null,
        quarter: data.quarter ?? null,
        title: data.title,
        description: data.description ?? null,
        estimated_cost_min: data.estimated_cost_min ?? null,
        estimated_cost_max: data.estimated_cost_max ?? null,
        actual_cost: null,
        priority: data.priority,
        status: 'planned',
        is_recurring: data.is_recurring ?? false,
        recurrence_frequency: data.recurrence_frequency ?? null,
        source_type: null,
        source_id: null,
        target_date: data.target_date ?? null,
        completed_at: null,
        created_by: source.memberId,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          ledger.items.push(item);
        },
        { opType: 'ITEM_CREATE', entityType: 'budget_item', entityId: item.id, payload: item },
      );
      return { item };
    }),

  getItem: async (householdId: string, itemId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const item = source.items.find((i) => i.id === itemId && i.household_id === householdId);
    if (!item) throw new Error('Item not found');
    return { item };
  },

  updateItem: async (
    householdId: string,
    itemId: string,
    data: Partial<{
      title: string;
      description: string;
      category_id: string;
      timeframe: string;
      year: number;
      quarter: number;
      estimated_cost_min: number;
      estimated_cost_max: number;
      actual_cost: number;
      priority: 'critical' | 'high' | 'medium' | 'low';
      status: BudgetItem['status'];
      target_date: string | null;
    }>,
  ) =>
    runOnHousehold(householdId, async () => {
      let updated: BudgetItem | undefined;
      await mutateLocalLedger(
        (ledger) => {
          const item = ledger.items.find((i) => i.id === itemId && i.household_id === householdId);
          if (!item) throw new Error('Item not found');
          Object.assign(item, data);
          item.updated_at = isoNow();
          if (data.status === 'completed' && !item.completed_at) {
            item.completed_at = isoNow();
          }
          updated = { ...item };
        },
        { opType: 'ITEM_UPDATE', entityType: 'budget_item', entityId: itemId, payload: data },
      );
      return { item: updated! };
    }),

  deleteItem: async (householdId: string, itemId: string) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.items = ledger.items.filter(
            (i) => !(i.id === itemId && i.household_id === householdId),
          );
        },
        { opType: 'ITEM_DELETE', entityType: 'budget_item', entityId: itemId, payload: {} },
      );
    }),

  /**
   * Wrapped once around the whole composition rather than relying on the three
   * calls inside to each wrap themselves. They do — but a read, a write and a
   * second write that each re-check the active household independently could
   * straddle a switch made in between, and the item would then be completed in
   * one household while its expense landed in another.
   */
  recordPlannedSpending: async (
    householdId: string,
    itemId: string,
    data?: { amount?: number; expense_date?: string },
  ) =>
    runOnHousehold(householdId, async () => {
      const { item } = await localBudgetApi.getItem(householdId, itemId);
      const amount =
        data?.amount ??
        item.estimated_cost_max ??
        item.estimated_cost_min ??
        0;
      const { expense } = await localBudgetApi.addExpense(householdId, {
        title: item.title,
        description: item.description ?? undefined,
        amount,
        expense_date: data?.expense_date ?? isoNow().slice(0, 10),
        category_id: item.category_id ?? undefined,
        budget_item_id: item.id,
      });
      const { item: updated } = await localBudgetApi.updateItem(householdId, itemId, {
        status: 'completed',
        actual_cost: amount,
      });
      return { expense, item: updated };
    }),

  getTimeline: async (householdId: string): Promise<BudgetOverview> => {
    const source = await getLocalLedgerFor(householdId);
    const categories = source.categories.filter((c) => c.household_id === householdId);
    const items = source.items.filter((i) => i.household_id === householdId);
    const byTimeframe = new Map<string, TimelineItem[]>();
    for (const item of items) {
      const cat = categories.find((c) => c.id === item.category_id) ?? null;
      const list = byTimeframe.get(item.timeframe) ?? [];
      list.push(toTimelineItem(item, cat));
      byTimeframe.set(item.timeframe, list);
    }
    const timeline: TimelineSummary[] = [...byTimeframe.entries()].map(([timeframe, rows]) => ({
      timeframe,
      label: timeframe,
      itemCount: rows.length,
      totalEstimatedMin: rows.reduce((s, r) => s + (r.estimatedCostMin ?? 0), 0),
      totalEstimatedMax: rows.reduce((s, r) => s + (r.estimatedCostMax ?? 0), 0),
      totalActual: rows.reduce((s, r) => s + (r.actualCost ?? 0), 0),
      items: rows,
    }));
    const categoryStats = categories.map((category) => {
      const catItems = items.filter((i) => i.category_id === category.id);
      return {
        category,
        itemCount: catItems.length,
        totalEstimated: catItems.reduce(
          (s, i) => s + (i.estimated_cost_max ?? i.estimated_cost_min ?? 0),
          0,
        ),
        totalSpent: source.expenses
          .filter((e) => e.category_id === category.id)
          .reduce((s, e) => s + e.amount, 0),
      };
    });
    return {
      timeline,
      totalPlanned: {
        min: items.reduce((s, i) => s + (i.estimated_cost_min ?? 0), 0),
        max: items.reduce((s, i) => s + (i.estimated_cost_max ?? i.estimated_cost_min ?? 0), 0),
      },
      totalSpent: source.expenses
        .filter((e) => e.household_id === householdId)
        .reduce((s, e) => s + e.amount, 0),
      categories: categoryStats,
    };
  },

  getMonthlyGoal: async (householdId: string, year: number, month: number) => {
    const source = await getLocalLedgerFor(householdId);
    const goal = { ...resolveGoal(source, year, month), household_id: householdId };
    goal.actual_spent = spentInMonth(source, year, month);
    return { goal };
  },

  setMonthlyGoal: async (
    householdId: string,
    year: number,
    month: number,
    data: { planned_budget?: number | null; notes?: string | null },
  ) =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      const now = isoNow();
      const actualSpent = spentInMonth(source, year, month);
      let goal!: BudgetGoal;
      await mutateLocalLedger(
        (ledger) => {
          goal = upsertGoalRow(ledger, householdId, year, month, data, actualSpent, now);
        },
        {
          opType: 'GOAL_SET',
          entityType: 'budget_goal',
          // The old code read `goal.id` off the pre-mutation literal, so this was
          // always the derived id even when an existing row carried another one.
          entityId: `goal_${year}_${month}`,
          payload: data,
        },
      );
      return { goal };
    }),

  applyGoalToYear: async (
    householdId: string,
    year: number,
    month: number,
    plannedBudget: number,
  ) =>
    runOnHousehold(householdId, async () => {
      // Resolve the month set first (identical skip rule), then write all of them
      // in ONE op — this used to be up to 12 separate ops, each re-encrypting the
      // whole ledger, for a single "apply to the rest of the year" tap.
      const source = await getLocalLedgerFor(householdId);
      const updatedMonths: number[] = [];
      for (let m = month; m <= 12; m += 1) {
        const existing = source.goals.find((g) => g.year === year && g.month === m);
        if (existing?.planned_budget != null && m !== month) continue;
        updatedMonths.push(m);
      }
      if (updatedMonths.length === 0) return { updatedMonths };

      const spent = spentByMonthKey(source);
      const now = isoNow();
      await mutateLocalLedger(
        (ledger) => {
          for (const m of updatedMonths) {
            upsertGoalRow(
              ledger,
              householdId,
              year,
              m,
              { planned_budget: plannedBudget },
              spent.get(monthKey(year, m)) ?? 0,
              now,
            );
          }
        },
        {
          opType: 'GOAL_APPLY_YEAR',
          entityType: 'budget_goal',
          entityId: `goal_${year}_${month}`,
          payload: { year, month, planned_budget: plannedBudget, count: updatedMonths.length },
        },
      );
      return { updatedMonths };
    }),

  scheduleNextMonthBudgetReminder: async (_householdId: string, year: number, month: number) => {
    let nextYear = year;
    let nextMonth = month + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    return { scheduledFor: `${monthKey(nextYear, nextMonth)}-01` };
  },

  getMonthlyOverview: async (
    householdId: string,
    year: number,
    month: number,
  ): Promise<MonthlyOverview> => {
    const source = await getLocalLedgerFor(householdId);
    const goal = (await localBudgetApi.getMonthlyGoal(householdId, year, month)).goal;
    const plannedBudget = goal.planned_budget ?? 0;
    const view = monthExpenseView(source.expenses, year, month);
    const actualSpent = view.totalCents;
    const items = openItemsForMonth(source, year, month);
    // Rows dated in the month — the purchase events. A bulk parent's counted
    // share is in `bulkPortions`; the list renders that, not `amount`.
    const expenses = (await localBudgetApi.getExpenses(householdId, { year, month })).expenses;
    const remainingBudget = plannedBudget - actualSpent;
    const sub = computeSubBudgetProgress(source, year, month);
    const affordability = emptyAffordability(remainingBudget);
    const bulkPortions = [
      ...view.counted.flatMap((row) => (row.portion ? [row.portion] : [])),
      ...view.reserved,
    ];
    return {
      goal,
      plannedBudget,
      actualSpent,
      committedTotal: items.reduce(
        (s, i) => s + (i.estimated_cost_max ?? i.estimated_cost_min ?? 0),
        0,
      ),
      carriedIn: 0,
      transferredOut: 0,
      remainingBudget,
      affordability,
      yearAffordability: affordability,
      quarterAffordability: affordability,
      nextMonthAffordability: affordability,
      nextYearAffordability: affordability,
      items,
      expenses,
      itemCount: items.length,
      savedTotal: view.savedCents,
      depositsTotal: view.depositsCents,
      taxesTotal: view.taxCents,
      subBudgets: {
        entries: sub.entries,
        totalCapCents: sub.totalCapCents,
        plannedBudget: sub.plannedBudget,
        overAllocatedBy: sub.overAllocatedBy,
      },
      bulkPortions,
      bulkReservedTotal: view.reserved.reduce((sum, portion) => sum + portion.portion_cents, 0),
      bulkDeferredTotal: view.deferredCents,
      bulkLastMonth: lastPlanMonth(source.expenses),
    };
  },

  getQuickAddSuggestions: async (
    householdId: string,
    kind: 'planned' | 'spent',
  ): Promise<QuickAddSuggestionLists> => {
    // `householdId` used to be `void`-ed here: one session meant the active
    // ledger was the only ledger, so naming one was ceremony. It now selects.
    const source = await getLocalLedgerFor(householdId);
    // Same grouping and row shape as the Worker — see quickAddSuggestions.ts
    // for why the shape matters (a spent chip without `amount` is a dead chip).
    return kind === 'spent'
      ? quickAddFromExpenses(source.expenses)
      : quickAddFromPlanned(source.items);
  },

  getSubBudgets: async (householdId: string, year: number, month: number) => {
    const source = await getLocalLedgerFor(householdId);
    const sub = computeSubBudgetProgress(source, year, month);
    return {
      subBudgets: sub.entries,
      totals: {
        totalCapCents: sub.totalCapCents,
        plannedBudget: sub.plannedBudget,
        overAllocatedBy: sub.overAllocatedBy,
      },
      rows: source.subBudgets.filter((s) => s.year === year),
    };
  },

  upsertSubBudget: async (
    householdId: string,
    data: {
      category_id: string;
      year: number;
      month: number | null;
      limit_type: 'amount' | 'percent';
      amount_cents?: number | null;
      percent_bps?: number | null;
    },
  ) =>
    runOnHousehold(householdId, async () => {
      const now = isoNow();
      let subBudget: SubBudget = {
        id: newLocalId('sub'),
        household_id: householdId,
        category_id: data.category_id,
        year: data.year,
        month: data.month,
        limit_type: data.limit_type,
        amount_cents: data.amount_cents ?? null,
        percent_bps: data.percent_bps ?? null,
        created_at: now,
        updated_at: now,
      };
      await mutateLocalLedger(
        (ledger) => {
          const idx = ledger.subBudgets.findIndex(
            (s) =>
              s.category_id === data.category_id &&
              s.year === data.year &&
              s.month === data.month,
          );
          if (idx >= 0) {
            const prev = ledger.subBudgets[idx]!;
            subBudget = {
              ...prev,
              limit_type: data.limit_type,
              amount_cents: data.amount_cents ?? null,
              percent_bps: data.percent_bps ?? null,
              updated_at: now,
            };
            ledger.subBudgets[idx] = subBudget;
          } else {
            ledger.subBudgets.push(subBudget);
          }
        },
        {
          opType: 'SUB_BUDGET_UPSERT',
          entityType: 'sub_budget',
          entityId: subBudget.id,
          payload: data,
        },
      );
      return { subBudget };
    }),

  deleteSubBudget: async (
    householdId: string,
    data: { category_id: string; year: number; month: number | null },
  ) =>
    runOnHousehold(householdId, async () => {
      await mutateLocalLedger(
        (ledger) => {
          ledger.subBudgets = ledger.subBudgets.filter(
            (s) =>
              !(
                s.household_id === householdId &&
                s.category_id === data.category_id &&
                s.year === data.year &&
                s.month === data.month
              ),
          );
        },
        {
          opType: 'SUB_BUDGET_DELETE',
          entityType: 'sub_budget',
          entityId: `${data.category_id}:${data.year}:${data.month}`,
          payload: data,
        },
      );
    }),

  getTransferContext: async (
    householdId: string,
    year: number,
    month: number,
  ): Promise<BudgetTransferContext> => {
    const source = await getLocalLedgerFor(householdId);
    const overview = await localBudgetApi.getMonthlyOverview(householdId, year, month);
    return {
      year,
      month,
      monthLabel: monthKey(year, month),
      leftoverCents: Math.max(0, overview.remainingBudget),
      plannedBudgetCents: overview.plannedBudget,
      actualSpentCents: overview.actualSpent,
      carriedInCents: overview.carriedIn ?? 0,
      transferredOutCents: overview.transferredOut ?? 0,
      bulkDeferredCents: overview.bulkDeferredTotal ?? 0,
      destinations: [
        {
          type: 'next_month',
          id: null,
          label: 'Next month',
          sublabel: null,
          icon: 'calendar',
        },
      ],
      history: source.transfers.slice().reverse(),
    };
  },

  createTransfer: async (householdId: string, data: CreateTransferRequest) =>
    runOnHousehold(householdId, async () => {
      const record = {
        id: newLocalId('xfer'),
        amountCents: data.amount_cents,
        destinationType: data.destination_type,
        destinationLabel:
          data.destination_type === 'next_month' ? 'Next month' : data.destination_type,
        note: data.note ?? null,
        createdAt: isoNow(),
      };
      await mutateLocalLedger(
        (ledger) => {
          ledger.transfers.push(record);
          if (data.destination_type === 'next_month') {
            let nextYear = data.source_year;
            let nextMonth = data.source_month + 1;
            if (nextMonth > 12) {
              nextMonth = 1;
              nextYear += 1;
            }
            // Record as history only in Phase 1; carried-in accounting refined later.
            void nextYear;
            void nextMonth;
          }
        },
        { opType: 'TRANSFER_CREATE', entityType: 'transfer', entityId: record.id, payload: data },
      );
      return localBudgetApi.getTransferContext(householdId, data.source_year, data.source_month);
    }),

  deleteTransfer: async (householdId: string, transferId: string) =>
    runOnHousehold(householdId, async () => {
      const year = new Date().getFullYear();
      const month = new Date().getMonth() + 1;
      await mutateLocalLedger(
        (ledger) => {
          ledger.transfers = ledger.transfers.filter((t) => t.id !== transferId);
        },
        { opType: 'TRANSFER_DELETE', entityType: 'transfer', entityId: transferId, payload: {} },
      );
      return localBudgetApi.getTransferContext(householdId, year, month);
    }),

  getEncouragement: async (
    householdId: string,
    year: number,
    month: number,
  ): Promise<BudgetEncouragement> => {
    const overview = await localBudgetApi.getMonthlyOverview(householdId, year, month);
    const remaining = overview.remainingBudget;
    const isPositive = remaining >= 0;
    return {
      tone: isPositive ? 'positive' : 'watch',
      emoji: isPositive ? '✅' : '👀',
      headline: isPositive ? 'On track locally' : 'Over local budget',
      message: isPositive
        ? 'Your offline ledger shows room left this month.'
        : 'Spending is ahead of this month’s local budget.',
      highlight: null,
      plannedBudgetCents: overview.plannedBudget,
      actualSpentCents: overview.actualSpent,
      remainingBudgetCents: remaining,
      paceSavingsCents: null,
      spentThisWeekCents: 0,
      spentLastWeekCents: 0,
      weekOverWeekDeltaCents: null,
      ytdSavingsCents: 0,
      monthsUnderBudgetStreak: 0,
      isPositive,
    };
  },

  /**
   * Generated on the device from this month's local overview, through the
   * member's own provider key — the backend cannot summarize a ledger it never
   * receives. Throws `BudgetLocalUnsupportedError` only when no key is
   * connected; a provider or network failure surfaces as itself so the caller
   * can say what actually went wrong.
   *
   * `forceRefresh` now means here what it means on the remote transport: skip
   * the cached answer. Without it, a month whose prompt is unchanged reuses the
   * previous generation instead of billing the member's key again.
   */
  getInsights: async (
    householdId: string,
    year: number,
    month: number,
    forceRefresh = false,
  ) => {
    const overview = await localBudgetApi.getMonthlyOverview(householdId, year, month);
    const { runLocalInsights } = await import('./ai/localInsights');
    return runLocalInsights({ householdId, year, month, overview, forceRefresh });
  },

  getCategoryProductTrends: async (
    householdId: string,
    categoryId: string,
    year: number,
    month: number,
    months = 6,
  ) => {
    const source = await getLocalLedgerFor(householdId);
    const category =
      categoryId === 'uncategorized'
        ? null
        : source.categories.find((c) => c.id === categoryId) ?? null;
    const monthLabels: string[] = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date(year, month - 1 - i, 1);
      monthLabels.push(monthKey(d.getFullYear(), d.getMonth() + 1));
    }
    const rows = source.expenses.filter((e) => {
      if (e.household_id !== householdId) return false;
      if (categoryId === 'uncategorized') return !e.category_id;
      return e.category_id === categoryId;
    });
    const productMap = new Map<string, { total: number; count: number; byMonth: Map<string, number> }>();
    const bucketFor = (expense: Expense) => {
      const key = expense.title.trim().toLowerCase();
      let bucket = productMap.get(key);
      if (!bucket) {
        bucket = { total: 0, count: 0, byMonth: new Map() };
        productMap.set(key, bucket);
      }
      return bucket;
    };
    // Totals and counts are purchase EVENTS; the per-month series is what the
    // month lens counted, so a stock-up reads as steady consumption, not a spike.
    for (const expense of rows) {
      const bucket = bucketFor(expense);
      bucket.total += expense.amount;
      bucket.count += 1;
    }
    forEachCounted(rows, (expense, mk, cents) => {
      const bucket = bucketFor(expense);
      bucket.byMonth.set(mk, (bucket.byMonth.get(mk) ?? 0) + cents);
    });
    const current = monthLabels[monthLabels.length - 1]!;
    const previous = monthLabels[monthLabels.length - 2] ?? current;
    const products = [...productMap.entries()].map(([name, stats]) => {
      const currentAmount = stats.byMonth.get(current) ?? 0;
      const previousAmount = stats.byMonth.get(previous) ?? 0;
      let trend: 'up' | 'down' | 'flat' | 'new' = 'flat';
      if (previousAmount === 0 && currentAmount > 0) trend = 'new';
      else if (currentAmount > previousAmount) trend = 'up';
      else if (currentAmount < previousAmount) trend = 'down';
      return {
        name,
        total: stats.total,
        count: stats.count,
        currentAmount,
        currentCount: stats.count,
        previousAmount,
        averageAmount: Math.round(stats.total / Math.max(1, monthLabels.length)),
        trend,
        byMonth: monthLabels.map((m) => ({
          month: m,
          amount: stats.byMonth.get(m) ?? 0,
          count: 0,
        })),
      };
    });
    const monthlyTotals = monthLabels.map((m) =>
      rows.reduce((s, e) => s + countedCentsForMonth(e, m), 0),
    );
    return {
      categoryId,
      categoryName: category?.name ?? null,
      months: monthLabels,
      monthlyTotals,
      currentMonthTotal: monthlyTotals[monthlyTotals.length - 1] ?? 0,
      previousMonthTotal: monthlyTotals[monthlyTotals.length - 2] ?? 0,
      products: products.sort((a, b) => b.currentAmount - a.currentAmount),
    };
  },

  syncFromTasks: async () => ({ created: 0, message: 'Local-first: task sync skipped' }),

  /**
   * The import ladder writes nothing — it returns a draft the screen confirms —
   * but it still runs through `runOnHousehold`, because it RESOLVES against a
   * ledger it picks itself: `householdCategories()` in `ai/localImportLadder.ts`
   * reads `getLocalLedger()` and then filters on the id it was handed. For a
   * non-active household those two disagree, the filter matches nothing, and
   * every line on the receipt comes back uncategorized — a wrong answer that
   * looks like a thin receipt rather than like a bug.
   *
   * Activating makes the ladder's own read correct. The durable fix is a
   * `forHouseholdId` on the ladder itself; that file is not this one's to change.
   */
  scanReceipt: async (
    householdId: string,
    files:
      | { uri: string; type: string; name: string }
      | Array<{ uri: string; type: string; name: string }>,
    _region?: { country?: string | null; stateProvince?: string | null },
    _aliases?: Array<{ key: string; name: string; categoryId?: string | null }>,
    onProgress?: (progress: ReceiptScanProgress) => void,
  ) =>
    runOnHousehold(householdId, async () => {
      const { runReceiptImportLadder } =
        await import('./ai/localImportLadder');
      // Nothing uploads on this path — the images go straight from the device to
      // the member's own provider — so `reading` is the only stage to report.
      return runReceiptImportLadder({
        householdId,
        files,
        onItemsRead: onProgress ? (items) => onProgress({ stage: 'reading', items }) : undefined,
      });
    }),

  aiDetectItems: async (
    householdId: string,
    data: { text: string; year?: number; month?: number },
  ) =>
    runOnHousehold(householdId, async () => {
      const { runAiDetectItemsLadder } = await import('./ai/localImportLadder');
      return runAiDetectItemsLadder({
        householdId,
        text: data.text,
        year: data.year,
        month: data.month,
      });
    }),

  aiDetectItemsWithFile: async (
    householdId: string,
    data: {
      text?: string;
      file: { uri: string; type: string; name: string };
      year?: number;
      month?: number;
    },
  ) =>
    runOnHousehold(householdId, async () => {
      const { runAiDetectItemsLadder } = await import('./ai/localImportLadder');
      return runAiDetectItemsLadder({
        householdId,
        text: data.text,
        file: data.file,
        year: data.year,
        month: data.month,
      });
    }),
};
