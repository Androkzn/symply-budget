import {
  SERVER_DEFAULT_CATEGORY_NAMES,
  SERVER_SEED_CATEGORIES,
  type DefaultBudgetCategory,
} from '@symply/contracts';
import { eq, and, gte, lt, sql, desc, asc, isNull, ne } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers, tasks } from '../db/schema';
import {
  budgetCategories,
  budgetItems,
  budgetGoals,
  budgetSubBudgets,
  budgetTransfers,
  expenses,
  type BudgetCategory,
  type BudgetItem,
  type BudgetGoal,
  type SubBudget,
  type Expense,
} from '../db/schema-budget';
import { savingsGoals, registeredAccounts } from '../db/schema-savings';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { now } from '../utils/id';

import { planAffordability, type AffordabilityItem, type AffordabilityPlan } from './budget-affordability';
import {
  buildQuickAddSuggestionsFromExpenses,
  buildQuickAddSuggestionsFromPlanned,
  type BudgetQuickAddSuggestion,
} from './budget-quick-add';
import { SavingsService } from './savings-service';

/** Max active tasks considered per syncFromTasks call (N+1 guard). */
const SYNC_FROM_TASKS_LIMIT = 500;

/** Bound params per expense INSERT row (must match drizzle `expenses` columns). */
export const EXPENSE_INSERT_COLUMNS = 17;
/** Max existing task-linked budget items loaded per syncFromTasks call. */
const SYNC_FROM_TASKS_LINKS_LIMIT = 500;

/** Map a task's priority_severity onto the budget item's coarser priority enum. */
export function budgetPriorityFromTaskSeverity(severity: string | null): string {
  switch (severity) {
    case 'critical':
    case 'urgent':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      // nice_to_have, low, or unset
      return 'low';
  }
}

/** Planning horizon (intent-based). See `budgetItems.horizon`. */
export type BudgetHorizon = 'short_term' | 'long_term' | 'someday';

/** Short-term vs long-term boundary: a target date within 12 months is "soon". */
export const SHORT_TERM_MAX_DAYS = 365;

/**
 * Derive a planning horizon from a target date. An item with a date within
 * ~12 months is `short_term`; further out is `long_term`. With no (valid) date
 * it's a `someday` wish — cost, if present, is only a display ballpark and does
 * not change the horizon.
 */
export function budgetHorizonFrom(targetDate?: string | null): BudgetHorizon {
  if (targetDate) {
    const target = Date.parse(`${targetDate}T00:00:00Z`);
    if (Number.isFinite(target)) {
      const days = Math.round((target - Date.now()) / 86_400_000);
      return days <= SHORT_TERM_MAX_DAYS ? 'short_term' : 'long_term';
    }
  }
  return 'someday';
}

/**
 * Bucket a target date (YYYY-MM-DD) into the budget timeframe enum by how far
 * out it is. No date → 'immediate' (an undated purchase the user can retime).
 */
export function budgetTimeframeFromDate(targetDate?: string): string {
  if (!targetDate) return 'immediate';
  const target = Date.parse(`${targetDate}T00:00:00Z`);
  if (!Number.isFinite(target)) return 'immediate';
  const days = Math.round((target - Date.now()) / 86_400_000);
  if (days <= 30) return 'immediate';
  if (days <= 45) return '1_month';
  if (days <= 135) return '3_months';
  if (days <= 270) return '6_months';
  if (days <= 545) return '1_year';
  if (days <= 1095) return '2_years';
  if (days <= 2555) return '5_years';
  return '10_years';
}

/**
 * Whether a name is one the app seeds itself.
 *
 * The seed lists live in `@symply/contracts` (`budget-categories.ts`), one table
 * shared with the local-first client and the brand icon map — adding a category
 * is a row there, not an edit here.
 *
 * A predefined category is togglable via a show/hide switch and never
 * deletable; anything else is a member's own custom category, which they own
 * and can delete. Derived from the name so the client stays thin and no extra
 * column is needed — which also means a CUSTOM category a member happens to
 * name "Garden" is treated as predefined.
 */
function isDefaultCategory(name: string): boolean {
  return SERVER_DEFAULT_CATEGORY_NAMES.has(name.trim().toLowerCase());
}

export interface BudgetCategoryWithUsage extends BudgetCategory {
  usage_count: number;
  /** True for app-seeded default categories — hidden via a toggle, not deleted. */
  is_default: boolean;
}

interface TimelineItem {
  id: string;
  title: string;
  description: string | null;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  actualCost: number | null;
  priority: string;
  status: string;
  targetDate: string | null;
  timeframe: string;
  year: number | null;
  quarter: number | null;
  sourceType: string | null;
  sourceId: string | null;
  category: BudgetCategory | null;
  createdAt: string;
}

interface TimelineSummary {
  timeframe: string;
  label: string;
  itemCount: number;
  totalEstimatedMin: number;
  totalEstimatedMax: number;
  totalActual: number;
  items: TimelineItem[];
}

interface BudgetOverview {
  timeline: TimelineSummary[];
  totalPlanned: { min: number; max: number };
  totalSpent: number;
  categories: Array<{
    category: BudgetCategory;
    itemCount: number;
    totalEstimated: number;
    totalSpent: number;
  }>;
}

export interface MonthlyOverview {
  goal: BudgetGoal;
  plannedBudget: number;
  actualSpent: number;
  committedTotal: number;
  /** Leftover carried IN from the previous month via a 'next_month' transfer, in cents. */
  carriedIn: number;
  /** Leftover moved OUT of this month to any destination, in cents. */
  transferredOut: number;
  remainingBudget: number;
  affordability: AffordabilityPlan;
  /**
   * Whole-year affordability: how still-open planned spendings fit into the
   * remaining annual budget. Powers the "This year" window on the
   * Planned-spending-fit card. Computed for the same `year` this overview is for.
   */
  yearAffordability: AffordabilityPlan;
  /**
   * Quarter-scoped affordability: the same fit computed over the calendar
   * quarter that contains `month` (its 3 months' pooled leftover). Powers the
   * "This quarter" window — the mid-point between the monthly and yearly views.
   */
  quarterAffordability: AffordabilityPlan;
  /** Next-month fit: how planned items dated next month fit next month's pool. */
  nextMonthAffordability: AffordabilityPlan;
  /** Next-calendar-year fit: planned items next year vs. next year's pooled budget. */
  nextYearAffordability: AffordabilityPlan;
  /** Planned budget items targeted this month. */
  items: BudgetItem[];
  /** Recorded expenses this month. */
  expenses: Expense[];
  itemCount: number;
  /** Total saved on discounts/sales this month, in cents (sum of expense.saved_amount). */
  savedTotal: number;
  /** Container deposits + US CRV paid this month, in cents (sum of expense.deposit_amount). */
  depositsTotal: number;
  /** Sales tax included in this month's spending, in cents (sum of expense.tax_amount). */
  taxesTotal: number;
  /** Per-category sub-budget caps + spend for this month, plus over-allocation totals. */
  subBudgets: SubBudgetSummary;
}

/** Sub-budget limit kinds — a fixed amount or a percent of the month's total. */
export type SubBudgetLimitType = 'amount' | 'percent';

/** Where a resolved sub-budget cap came from, in precedence order. */
export type SubBudgetScope = 'month' | 'default' | 'legacy';

/** A sub-budget cap resolved to concrete cents for a specific month. */
export interface ResolvedSubBudget {
  category_id: string;
  limit_type: SubBudgetLimitType;
  /** Raw stored amount in cents (limit_type = 'amount'); null for percent. */
  amount_cents: number | null;
  /** Raw stored basis points 0-10000 (limit_type = 'percent'); null for amount. */
  percent_bps: number | null;
  /** Cap resolved against this month's planned_budget, in cents. */
  cap_cents: number;
  scope: SubBudgetScope;
}

/** A resolved sub-budget joined with the category and this month's actual spend. */
export interface SubBudgetProgress {
  category_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  limit_type: SubBudgetLimitType;
  percent_bps: number | null;
  cap_cents: number;
  spent_cents: number;
  /** cap_cents - spent_cents (negative when over). */
  remaining_cents: number;
  over: boolean;
  scope: SubBudgetScope;
}

/** Per-category sub-budget progress for a month plus over-allocation totals. */
export interface SubBudgetSummary {
  entries: SubBudgetProgress[];
  totalCapCents: number;
  plannedBudget: number;
  /** max(0, totalCapCents - plannedBudget) — how far sub-budgets exceed the total. */
  overAllocatedBy: number;
}

/** One month's roll-up for a single product within a category. */
export interface CategoryProductMonth {
  /** Calendar month, 'YYYY-MM'. */
  month: string;
  /** Total spent on this product that month, in cents. */
  amount: number;
  /** Number of times the product was purchased that month. */
  count: number;
}

/**
 * A product (grouped by normalized title) purchased within a category, with its
 * per-month spend history so the client can render a trend (e.g. milk, yogurt).
 */
export interface CategoryProductTrend {
  /** Display name — most recently used original casing. */
  name: string;
  /** Total spent across the whole window, in cents. */
  total: number;
  /** Total purchases across the whole window. */
  count: number;
  /** Spend in the anchor (current) month, in cents. */
  currentAmount: number;
  /** Purchases in the anchor (current) month. */
  currentCount: number;
  /** Spend in the month immediately before the anchor, in cents. */
  previousAmount: number;
  /** Mean monthly spend across the window, in cents. */
  averageAmount: number;
  /** Direction of the current month vs the previous month. */
  trend: 'up' | 'down' | 'flat' | 'new';
  /** One entry per month in the window, oldest first (parallel to `months`). */
  byMonth: CategoryProductMonth[];
}

/** Product-level spending breakdown + trends for a single category over N months. */
export interface CategoryProductTrends {
  /** Category id, or 'uncategorized' for expenses with no category. */
  categoryId: string;
  categoryName: string | null;
  /** Chronological list of the months covered, 'YYYY-MM' (oldest first). */
  months: string[];
  /** Total category spend per month, in cents (parallel to `months`). */
  monthlyTotals: number[];
  /** Total category spend in the anchor month, in cents. */
  currentMonthTotal: number;
  /** Total category spend in the month before the anchor, in cents. */
  previousMonthTotal: number;
  /** Products sorted by current-month spend (desc), then all-time total. */
  products: CategoryProductTrend[];
}

// ============ BUDGET TRANSFERS ============

export type TransferDestinationType = 'next_month' | 'savings_goal' | 'registered_account';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Human month label, e.g. (2026, 7) → "July 2026". */
function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? String(month)} ${year}`;
}

/** Whole-dollar display for hint/sublabel copy, e.g. 123456 → "$1,235". */
function fmtDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return '$' + dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A place this month's leftover can be moved to, ready for the client to render. */
export interface TransferDestinationOption {
  type: TransferDestinationType;
  /** Goal/account id; null for next_month. */
  id: string | null;
  label: string;
  sublabel: string | null;
  /** Ionicon name for the client. */
  icon: string;
}

/** A recorded transfer, with a stable display label for history rows. */
export interface BudgetTransferRecord {
  id: string;
  amountCents: number;
  destinationType: TransferDestinationType;
  destinationLabel: string;
  note: string | null;
  createdAt: string;
}

/** Everything the Budget Transfer screen needs in one round trip. */
export interface BudgetTransferContext {
  year: number;
  month: number;
  monthLabel: string;
  /** Available to move now = max(0, remainingBudget) for this month, in cents. */
  leftoverCents: number;
  plannedBudgetCents: number;
  actualSpentCents: number;
  carriedInCents: number;
  transferredOutCents: number;
  destinations: TransferDestinationOption[];
  history: BudgetTransferRecord[];
}

export interface CreateTransferInput {
  sourceYear: number;
  sourceMonth: number;
  amountCents: number;
  destinationType: TransferDestinationType;
  /** Required for savings_goal / registered_account; ignored for next_month. */
  destinationId?: string | null;
  note?: string | null;
}

export class BudgetService {
  private db: DrizzleD1Database;
  private env: Env;
  /** Raw handle kept so transfers can delegate to SavingsService(env, d1). */
  private d1: D1Database;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.d1 = d1;
    this.db = drizzle(d1);
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId))
      )
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  // ============ CATEGORIES ============

  async getCategories(
    householdId: string,
    userId: string,
    options?: { includeHidden?: boolean }
  ): Promise<BudgetCategoryWithUsage[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let categories = await this.db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .orderBy(asc(budgetCategories.sort_order))
      .all();

    if (categories.length > 0) {
      // Sweep a concurrent double-seed (two entry points can seed at once).
      categories = await this.dedupeDuplicateCategories(categories);
    }

    // Seed when the household holds no defaults — not merely when it holds
    // nothing. A household whose first write was a CUSTOM category (create one
    // before ever opening the budget screen) has rows but no defaults, and
    // keying off `length === 0` left it without them permanently.
    //
    // Deleting one default does not bring it back: the other 57 still satisfy
    // this, and `createDefaultCategories` only inserts names that are missing.
    // Only a household stripped of every default re-seeds, which is the right
    // answer for what is otherwise an empty picker.
    if (!categories.some((c) => isDefaultCategory(c.name))) {
      categories = await this.createDefaultCategories(householdId);
    }

    const usageCounts = await this.getCategoryUsageCounts(householdId);

    // Hidden categories are toggled-off defaults: excluded from pickers, suggestions
    // and the dashboard by default. The management screen (and internal lookups that
    // must resolve labels for existing items) pass includeHidden to see them all.
    const includeHidden = options?.includeHidden ?? false;

    // Most-used categories surface first; ties fall back to sort_order so
    // unused categories still appear in a stable, predictable order.
    return categories
      .filter((category) => includeHidden || !category.hidden)
      .map((category) => ({
        ...category,
        usage_count: usageCounts.get(category.id) ?? 0,
        is_default: isDefaultCategory(category.name),
      }))
      .sort((a, b) => b.usage_count - a.usage_count || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  /**
   * Resolve the household's "Groceries" category for receipt scanning without
   * the broad seeding/backfill side-effects of getCategories(). If the household
   * already has categories we only look one up (never resurrecting a Groceries
   * category the user deliberately deleted, nor adding backfill defaults). Only a
   * brand-new household with no categories at all gets the defaults seeded, so
   * first-time budgeting still works.
   */
  async resolveGroceriesCategory(
    householdId: string,
    userId: string
  ): Promise<{ id: string; name: string } | null> {
    const { grocery } = await this.resolveScanCategories(householdId, userId);
    return grocery;
  }

  /**
   * Category context for receipt scanning: the household's pickable categories
   * plus the "Groceries" fallback, sharing ONE read with the same no-side-effect
   * guarantees as {@link resolveGroceriesCategory} — seed defaults only for a
   * brand-new (empty) household, never backfill or resurrect a deleted category.
   * `pool` matches what the mobile picker shows, so AI category names can be
   * mapped back to real ids the user could have chosen themselves.
   */
  async resolveScanCategories(
    householdId: string,
    userId: string
  ): Promise<{ pool: Array<{ id: string; name: string }>; grocery: { id: string; name: string } | null }> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .orderBy(asc(budgetCategories.sort_order))
      .all();

    const source = existing.length === 0 ? await this.createDefaultCategories(householdId) : existing;
    // Hidden categories are toggled-off defaults — excluded from pickers, so the
    // AI must not tag items with them either.
    const pool = source
      .filter((c) => !c.hidden)
      .map((c) => ({ id: c.id, name: c.name }));
    const grocery = pool.find((c) => c.name.trim().toLowerCase() === 'groceries') ?? null;
    return { pool, grocery };
  }

  private async insertCategories(
    householdId: string,
    defs: readonly DefaultBudgetCategory[],
    startSortOrder: number
  ): Promise<BudgetCategory[]> {
    const timestamp = now();
    const categories: BudgetCategory[] = [];

    for (let i = 0; i < defs.length; i++) {
      const category: BudgetCategory = {
        id: crypto.randomUUID(),
        household_id: householdId,
        name: defs[i].name,
        icon: defs[i].brandIcon,
        color: defs[i].color,
        sort_order: startSortOrder + i,
        hidden: false,
        created_at: timestamp,
      };

      await this.db.insert(budgetCategories).values(category);
      categories.push(category);
    }

    return categories;
  }

  private async createDefaultCategories(householdId: string): Promise<BudgetCategory[]> {
    const defaults = SERVER_SEED_CATEGORIES;
    // Idempotency guard. Two entry points seed an empty household — getCategories
    // and resolveScanCategories — and the app can fire both at once (opening the
    // budget screen while scanning/importing). Re-read right before inserting and
    // only add names that aren't already present, so a sequential double-call
    // can't duplicate the whole default set. (A true simultaneous race is swept
    // by dedupeDuplicateCategories on the next read.)
    const existing = await this.db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .orderBy(asc(budgetCategories.sort_order))
      .all();
    const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const missing = defaults.filter((def) => !existingNames.has(def.name.trim().toLowerCase()));
    const created =
      missing.length > 0 ? await this.insertCategories(householdId, missing, existing.length) : [];
    return [...existing, ...created];
  }

  /**
   * Collapse duplicate categories sharing a name (case-insensitive) — the legacy
   * result of a concurrent double-seed. Keeps the lowest sort_order (oldest) row,
   * repoints every referencing budget item / expense / sub-budget to it, then
   * deletes the extras. Gated implicitly: it only issues writes when a duplicate
   * name actually exists, so it's a cheap no-op for healthy households.
   */
  private async dedupeDuplicateCategories(
    categories: BudgetCategory[]
  ): Promise<BudgetCategory[]> {
    const byName = new Map<string, BudgetCategory[]>();
    for (const cat of categories) {
      const key = cat.name.trim().toLowerCase();
      (byName.get(key) ?? byName.set(key, []).get(key)!).push(cat);
    }

    const losers: string[] = [];
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      // Survivor = lowest sort_order, id as a deterministic tiebreak.
      const sorted = [...group].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id < b.id ? -1 : 1)
      );
      const survivor = sorted[0];
      for (const dup of sorted.slice(1)) {
        // Repoint items + expenses (nullable FKs — a plain UPDATE is safe).
        await this.db
          .update(budgetItems)
          .set({ category_id: survivor.id })
          .where(eq(budgetItems.category_id, dup.id));
        await this.db
          .update(expenses)
          .set({ category_id: survivor.id })
          .where(eq(expenses.category_id, dup.id));
        // Sub-budgets carry a UNIQUE(household, year, month, category) index, so a
        // blind repoint could collide with the survivor's own cap for the same
        // period. Move only non-colliding rows; drop the rest.
        const survivorScopes = new Set(
          (
            await this.db
              .select({ year: budgetSubBudgets.year, month: budgetSubBudgets.month })
              .from(budgetSubBudgets)
              .where(eq(budgetSubBudgets.category_id, survivor.id))
              .all()
          ).map((r) => `${r.year}:${r.month ?? 'default'}`)
        );
        const dupSubs = await this.db
          .select({ id: budgetSubBudgets.id, year: budgetSubBudgets.year, month: budgetSubBudgets.month })
          .from(budgetSubBudgets)
          .where(eq(budgetSubBudgets.category_id, dup.id))
          .all();
        for (const sub of dupSubs) {
          if (survivorScopes.has(`${sub.year}:${sub.month ?? 'default'}`)) {
            await this.db.delete(budgetSubBudgets).where(eq(budgetSubBudgets.id, sub.id));
          } else {
            await this.db
              .update(budgetSubBudgets)
              .set({ category_id: survivor.id })
              .where(eq(budgetSubBudgets.id, sub.id));
          }
        }
        await this.db.delete(budgetCategories).where(eq(budgetCategories.id, dup.id));
        losers.push(dup.id);
      }
    }

    if (losers.length === 0) return categories;
    const dropped = new Set(losers);
    return categories.filter((c) => !dropped.has(c.id));
  }

  private async getCategoryUsageCounts(householdId: string): Promise<Map<string, number>> {
    const [itemRows, expenseRows] = await Promise.all([
      this.db
        .select({ category_id: budgetItems.category_id, count: sql<number>`count(*)` })
        .from(budgetItems)
        .where(eq(budgetItems.household_id, householdId))
        .groupBy(budgetItems.category_id)
        .all(),
      this.db
        .select({ category_id: expenses.category_id, count: sql<number>`count(*)` })
        .from(expenses)
        .where(eq(expenses.household_id, householdId))
        .groupBy(expenses.category_id)
        .all(),
    ]);

    const counts = new Map<string, number>();
    for (const row of [...itemRows, ...expenseRows]) {
      if (!row.category_id) continue;
      counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + Number(row.count));
    }
    return counts;
  }

  async createCategory(
    householdId: string,
    userId: string,
    input: { name: string; icon?: string; color?: string }
  ): Promise<BudgetCategory> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .all();

    const trimmedName = input.name.trim();
    if (existing.some((c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      throw new ConflictError(`A category named "${trimmedName}" already exists.`);
    }

    const category: BudgetCategory = {
      id: crypto.randomUUID(),
      household_id: householdId,
      name: trimmedName,
      icon: input.icon || null,
      color: input.color || null,
      sort_order: existing.length,
      hidden: false,
      created_at: now(),
    };

    await this.db.insert(budgetCategories).values(category);
    return category;
  }

  async updateCategory(
    householdId: string,
    categoryId: string,
    userId: string,
    updates: Partial<{ name: string; icon: string; color: string; sortOrder: number; hidden: boolean }>
  ): Promise<BudgetCategory> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Budget category');
    }

    const updateData: Record<string, unknown> = {};
    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (trimmedName.toLowerCase() !== existing.name.trim().toLowerCase()) {
        const siblings = await this.db
          .select({ id: budgetCategories.id, name: budgetCategories.name })
          .from(budgetCategories)
          .where(eq(budgetCategories.household_id, householdId))
          .all();
        if (
          siblings.some(
            (c) => c.id !== categoryId && c.name.trim().toLowerCase() === trimmedName.toLowerCase()
          )
        ) {
          throw new ConflictError(`A category named "${trimmedName}" already exists.`);
        }
      }
      updateData.name = trimmedName;
    }
    if (updates.icon !== undefined) updateData.icon = updates.icon;
    if (updates.color !== undefined) updateData.color = updates.color;
    if (updates.sortOrder !== undefined) updateData.sort_order = updates.sortOrder;
    if (updates.hidden !== undefined) updateData.hidden = updates.hidden;

    await this.db.update(budgetCategories).set(updateData).where(eq(budgetCategories.id, categoryId));

    return { ...existing, ...updateData } as BudgetCategory;
  }

  async deleteCategory(householdId: string, categoryId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Budget category');
    }

    // No ON DELETE behavior is defined on budgetItems.category_id, so detach
    // referencing items first to avoid an FK violation.
    await this.db
      .update(budgetItems)
      .set({ category_id: null })
      .where(eq(budgetItems.category_id, categoryId));

    // Sub-budgets require a category (NOT NULL FK, no ON DELETE), so drop any
    // caps tied to this category outright rather than detaching.
    await this.db.delete(budgetSubBudgets).where(eq(budgetSubBudgets.category_id, categoryId));

    await this.db.delete(budgetCategories).where(eq(budgetCategories.id, categoryId));
  }

  // ============ SUB-BUDGETS (per-category caps) ============

  /**
   * Resolve every category's sub-budget cap for one month, in cents.
   *
   * Precedence per category: a `month = M` override beats the `month IS NULL`
   * recurring default. Percent caps resolve live against `plannedBudget` so they
   * follow changes to the month's total. Categories with a stored row are always
   * returned; categories with no row but a legacy `budget_goals.category_budgets`
   * entry are surfaced as an `amount` cap (scope 'legacy') so pre-existing data
   * isn't lost. `plannedBudget` is the month's total cap in cents (0 if unset).
   */
  async resolveSubBudgets(
    householdId: string,
    userId: string,
    year: number,
    month: number,
    plannedBudget: number
  ): Promise<ResolvedSubBudget[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const rows = await this.db
      .select()
      .from(budgetSubBudgets)
      .where(
        and(
          eq(budgetSubBudgets.household_id, householdId),
          eq(budgetSubBudgets.year, year),
          sql`(${budgetSubBudgets.month} IS NULL OR ${budgetSubBudgets.month} = ${month})`
        )
      )
      .all();

    // Month override wins over the yearly default for each category.
    const byCategory = new Map<string, SubBudget>();
    for (const row of rows) {
      const existing = byCategory.get(row.category_id);
      if (!existing || (existing.month == null && row.month != null)) {
        byCategory.set(row.category_id, row);
      }
    }

    const resolved: ResolvedSubBudget[] = [];
    for (const row of byCategory.values()) {
      resolved.push({
        category_id: row.category_id,
        limit_type: row.limit_type as SubBudgetLimitType,
        amount_cents: row.amount_cents ?? null,
        percent_bps: row.percent_bps ?? null,
        cap_cents: this.resolveCapCents(row, plannedBudget),
        scope: row.month != null ? 'month' : 'default',
      });
    }

    // Legacy fallback: category_budgets JSON entries for categories without a row.
    const legacy = await this.getLegacyCategoryBudgets(householdId, year, month);
    for (const [categoryId, cents] of legacy) {
      if (byCategory.has(categoryId)) continue;
      resolved.push({
        category_id: categoryId,
        limit_type: 'amount',
        amount_cents: cents,
        percent_bps: null,
        cap_cents: cents,
        scope: 'legacy',
      });
    }

    return resolved;
  }

  /** Turn a stored sub-budget row into a concrete cap in cents for a month. */
  private resolveCapCents(row: SubBudget, plannedBudget: number): number {
    if (row.limit_type === 'percent') {
      return Math.round((plannedBudget * (row.percent_bps ?? 0)) / 10000);
    }
    return row.amount_cents ?? 0;
  }

  /** Read the legacy `budget_goals.category_budgets` JSON map ({categoryId: cents}). */
  private async getLegacyCategoryBudgets(
    householdId: string,
    year: number,
    month: number
  ): Promise<Map<string, number>> {
    const goal = await this.db
      .select({ category_budgets: budgetGoals.category_budgets })
      .from(budgetGoals)
      .where(
        and(
          eq(budgetGoals.household_id, householdId),
          eq(budgetGoals.year, year),
          eq(budgetGoals.month, month)
        )
      )
      .get();

    const map = new Map<string, number>();
    if (!goal?.category_budgets) return map;
    try {
      const parsed = JSON.parse(goal.category_budgets) as Record<string, number>;
      for (const [categoryId, cents] of Object.entries(parsed)) {
        if (typeof cents === 'number' && Number.isFinite(cents)) map.set(categoryId, cents);
      }
    } catch {
      // Malformed JSON — treat as no legacy caps.
    }
    return map;
  }

  /**
   * Create or update one category's sub-budget cap. Keyed by
   * (household, year, month|default, category) — `month` null is the recurring
   * default, 1-12 an override. Exactly one of amountCents/percentBps must be set,
   * matching limitType.
   */
  async upsertSubBudget(
    householdId: string,
    userId: string,
    input: {
      categoryId: string;
      year: number;
      month: number | null;
      limitType: SubBudgetLimitType;
      amountCents?: number | null;
      percentBps?: number | null;
    }
  ): Promise<SubBudget> {
    await this.checkHouseholdAccess(householdId, userId);

    const amountCents = input.limitType === 'amount' ? input.amountCents ?? null : null;
    const percentBps = input.limitType === 'percent' ? input.percentBps ?? null : null;

    if (input.limitType === 'amount' && (amountCents == null || amountCents < 0)) {
      throw new ValidationError('A dollar sub-budget needs a non-negative amount');
    }
    if (input.limitType === 'percent' && (percentBps == null || percentBps < 0 || percentBps > 10000)) {
      throw new ValidationError('A percent sub-budget must be between 0 and 100%');
    }

    // Verify the category belongs to this household.
    const category = await this.db
      .select({ id: budgetCategories.id })
      .from(budgetCategories)
      .where(
        and(
          eq(budgetCategories.id, input.categoryId),
          eq(budgetCategories.household_id, householdId)
        )
      )
      .get();
    if (!category) throw new NotFoundError('Budget category');

    const existing = await this.db
      .select()
      .from(budgetSubBudgets)
      .where(
        and(
          eq(budgetSubBudgets.household_id, householdId),
          eq(budgetSubBudgets.year, input.year),
          input.month == null
            ? isNull(budgetSubBudgets.month)
            : eq(budgetSubBudgets.month, input.month),
          eq(budgetSubBudgets.category_id, input.categoryId)
        )
      )
      .get();

    if (existing) {
      const updateData = {
        limit_type: input.limitType,
        amount_cents: amountCents,
        percent_bps: percentBps,
        updated_at: now(),
      };
      await this.db
        .update(budgetSubBudgets)
        .set(updateData)
        .where(eq(budgetSubBudgets.id, existing.id));
      return { ...existing, ...updateData } as SubBudget;
    }

    const timestamp = now();
    const row: SubBudget = {
      id: crypto.randomUUID(),
      household_id: householdId,
      category_id: input.categoryId,
      year: input.year,
      month: input.month,
      limit_type: input.limitType,
      amount_cents: amountCents,
      percent_bps: percentBps,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await this.db.insert(budgetSubBudgets).values(row);
    return row;
  }

  /** Remove one category's sub-budget cap for a scope (month override or default). */
  async deleteSubBudget(
    householdId: string,
    userId: string,
    input: { categoryId: string; year: number; month: number | null }
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .delete(budgetSubBudgets)
      .where(
        and(
          eq(budgetSubBudgets.household_id, householdId),
          eq(budgetSubBudgets.year, input.year),
          input.month == null
            ? isNull(budgetSubBudgets.month)
            : eq(budgetSubBudgets.month, input.month),
          eq(budgetSubBudgets.category_id, input.categoryId)
        )
      );
  }

  /** All raw sub-budget rows for a year (both defaults and overrides), for editing. */
  async getSubBudgetRows(householdId: string, userId: string, year: number): Promise<SubBudget[]> {
    await this.checkHouseholdAccess(householdId, userId);

    return this.db
      .select()
      .from(budgetSubBudgets)
      .where(
        and(eq(budgetSubBudgets.household_id, householdId), eq(budgetSubBudgets.year, year))
      )
      .all();
  }

  /**
   * Resolve sub-budget caps for a month and join them with the category label and
   * that month's actual spend. `monthExpenses`/`plannedBudget` can be passed in to
   * reuse work already done by the caller (e.g. getMonthlyOverview); otherwise they
   * are fetched here.
   */
  async getSubBudgetProgress(
    householdId: string,
    userId: string,
    year: number,
    month: number,
    precomputed?: { plannedBudget: number; monthExpenses: Expense[] }
  ): Promise<SubBudgetSummary> {
    await this.checkHouseholdAccess(householdId, userId);

    let plannedBudget = precomputed?.plannedBudget;
    let monthExpenses = precomputed?.monthExpenses;

    if (plannedBudget == null || monthExpenses == null) {
      const goal = await this.getOrCreateMonthlyGoal(householdId, userId, year, month);
      plannedBudget = goal.planned_budget ?? 0;
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonthYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const monthEnd = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;
      monthExpenses = await this.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.household_id, householdId),
            gte(expenses.expense_date, monthStart),
            lt(expenses.expense_date, monthEnd)
          )
        )
        .all();
    }

    const resolved = await this.resolveSubBudgets(householdId, userId, year, month, plannedBudget);

    // Per-category actual spend this month.
    const spentByCategory = new Map<string, number>();
    for (const exp of monthExpenses) {
      if (!exp.category_id) continue;
      spentByCategory.set(exp.category_id, (spentByCategory.get(exp.category_id) ?? 0) + exp.amount);
    }

    // Category labels (include hidden so a capped-but-hidden category still renders).
    const categories = await this.db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.household_id, householdId))
      .all();
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const entries: SubBudgetProgress[] = resolved
      .map((sub) => {
        const category = categoryById.get(sub.category_id);
        const spent = spentByCategory.get(sub.category_id) ?? 0;
        return {
          category_id: sub.category_id,
          name: category?.name ?? 'Category',
          icon: category?.icon ?? null,
          color: category?.color ?? null,
          limit_type: sub.limit_type,
          percent_bps: sub.percent_bps,
          cap_cents: sub.cap_cents,
          spent_cents: spent,
          remaining_cents: sub.cap_cents - spent,
          over: spent > sub.cap_cents,
          scope: sub.scope,
        };
      })
      // Over-cap first, then largest cap, so the most pressing rows lead.
      .sort((a, b) => Number(b.over) - Number(a.over) || b.cap_cents - a.cap_cents);

    const totalCapCents = entries.reduce((sum, e) => sum + e.cap_cents, 0);

    return {
      entries,
      totalCapCents,
      plannedBudget,
      overAllocatedBy: Math.max(0, totalCapCents - plannedBudget),
    };
  }

  // ============ BUDGET ITEMS ============

  async createBudgetItem(
    householdId: string,
    userId: string,
    input: {
      title: string;
      description?: string;
      categoryId?: string;
      horizon?: BudgetHorizon;
      timeframe?: string;
      year?: number;
      quarter?: number;
      estimatedCostMin?: number;
      estimatedCostMax?: number;
      priority: string;
      targetDate?: string;
      isRecurring?: boolean;
      recurrenceFrequency?: string;
      sourceType?: string;
      sourceId?: string;
    }
  ): Promise<BudgetItem> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = crypto.randomUUID();
    const timestamp = now();

    // `horizon` is the source of truth; derive it from the date when the caller
    // doesn't set it explicitly. `timeframe` is kept in sync for back-compat.
    const horizon = input.horizon ?? budgetHorizonFrom(input.targetDate);

    const item: BudgetItem = {
      id,
      household_id: householdId,
      category_id: input.categoryId || null,
      horizon,
      timeframe: input.timeframe ?? budgetTimeframeFromDate(input.targetDate),
      year: input.year || null,
      quarter: input.quarter || null,
      title: input.title,
      description: input.description || null,
      estimated_cost_min: input.estimatedCostMin || null,
      estimated_cost_max: input.estimatedCostMax || null,
      actual_cost: null,
      priority: input.priority,
      status: 'planned',
      is_recurring: input.isRecurring || false,
      recurrence_frequency: input.recurrenceFrequency || null,
      source_type: input.sourceType || 'manual',
      source_id: input.sourceId || null,
      target_date: input.targetDate || null,
      completed_at: null,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await this.db.insert(budgetItems).values(item);

    return item;
  }

  /**
   * Accept the AI's "this task is a purchase" suggestion: create a planned
   * spending item linked back to the task (source_type='task') and pin its id
   * onto the task for the chip's "added" state.
   *
   * Idempotent — if the task already points at a still-existing budget item we
   * return that one instead of creating a duplicate (double-taps, retries).
   */
  async createBudgetItemFromTask(
    householdId: string,
    userId: string,
    taskId: string
  ): Promise<BudgetItem> {
    await this.checkHouseholdAccess(householdId, userId);

    const task = await this.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.id, taskId), eq(tasks.household_id, householdId), isNull(tasks.deleted_at))
      )
      .get();
    if (!task) throw new NotFoundError('Task');

    // Idempotency: reuse the existing linked item if it still exists.
    if (task.budget_item_id) {
      const linked = await this.db
        .select()
        .from(budgetItems)
        .where(
          and(eq(budgetItems.id, task.budget_item_id), eq(budgetItems.household_id, householdId))
        )
        .get();
      if (linked) return linked as BudgetItem;
    }

    // next_due_date may be a full ISO timestamp; budget target_date is a calendar day.
    const targetDate = task.next_due_date ? task.next_due_date.slice(0, 10) : undefined;

    const item = await this.createBudgetItem(householdId, userId, {
      title: task.title,
      description: task.description || undefined,
      timeframe: budgetTimeframeFromDate(targetDate),
      priority: budgetPriorityFromTaskSeverity(task.priority_severity),
      estimatedCostMin: task.purchase_estimated_cost_min ?? undefined,
      estimatedCostMax: task.purchase_estimated_cost_max ?? undefined,
      targetDate,
      sourceType: 'task',
      sourceId: taskId,
    });

    await this.db
      .update(tasks)
      .set({ budget_item_id: item.id, updated_at: now() })
      .where(eq(tasks.id, taskId));

    return item;
  }

  async updateBudgetItem(
    householdId: string,
    itemId: string,
    userId: string,
    updates: Partial<{
      title: string;
      description: string;
      categoryId: string;
      horizon: BudgetHorizon;
      timeframe: string;
      year: number;
      quarter: number;
      estimatedCostMin: number;
      estimatedCostMax: number;
      actualCost: number;
      priority: string;
      status: string;
      targetDate: string | null;
    }>
  ): Promise<BudgetItem> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(budgetItems)
      .where(and(eq(budgetItems.id, itemId), eq(budgetItems.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Budget item');
    }

    const updateData: Record<string, unknown> = {
      updated_at: now(),
    };

    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.categoryId !== undefined) updateData.category_id = updates.categoryId;
    // Horizon is the source of truth. Respect an explicit change; otherwise, if
    // the target date changed, re-derive it so the two never drift apart.
    if (updates.horizon !== undefined) {
      updateData.horizon = updates.horizon;
    } else if (updates.targetDate !== undefined) {
      updateData.horizon = budgetHorizonFrom(updates.targetDate);
    }
    if (updates.timeframe !== undefined) updateData.timeframe = updates.timeframe;
    if (updates.year !== undefined) updateData.year = updates.year;
    if (updates.quarter !== undefined) updateData.quarter = updates.quarter;
    if (updates.estimatedCostMin !== undefined) updateData.estimated_cost_min = updates.estimatedCostMin;
    if (updates.estimatedCostMax !== undefined) updateData.estimated_cost_max = updates.estimatedCostMax;
    if (updates.actualCost !== undefined) updateData.actual_cost = updates.actualCost;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.status !== undefined) {
      updateData.status = updates.status;
      if (updates.status === 'completed') {
        updateData.completed_at = now();
      }
    }
    if (updates.targetDate !== undefined) updateData.target_date = updates.targetDate;

    await this.db.update(budgetItems).set(updateData).where(eq(budgetItems.id, itemId));

    return { ...existing, ...updateData } as BudgetItem;
  }

  async deleteBudgetItem(householdId: string, itemId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .delete(budgetItems)
      .where(and(eq(budgetItems.id, itemId), eq(budgetItems.household_id, householdId)));

    // Clear the convenience pointer on any task that surfaced this item so its
    // "add to planned spending" chip re-appears rather than pointing at a
    // deleted item.
    await this.db
      .update(tasks)
      .set({ budget_item_id: null, updated_at: now() })
      .where(and(eq(tasks.budget_item_id, itemId), eq(tasks.household_id, householdId)));
  }

  // ============ TIMELINE VIEW ============

  async getTimeline(householdId: string, userId: string): Promise<BudgetOverview> {
    await this.checkHouseholdAccess(householdId, userId);

    // Get all categories (including hidden ones) so items assigned to a category
    // the user later hid still resolve their label here instead of going blank.
    const categories = await this.getCategories(householdId, userId, { includeHidden: true });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // Get all budget items
    const items = await this.db
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.household_id, householdId))
      .orderBy(asc(budgetItems.timeframe), asc(budgetItems.year), asc(budgetItems.quarter))
      .all();

    // Get expenses for actual spending
    const allExpenses = await this.db
      .select()
      .from(expenses)
      .where(eq(expenses.household_id, householdId))
      .all();

    // Define timeframes
    const timeframes = [
      { key: 'immediate', label: 'Immediate (0-30 days)' },
      { key: '1_month', label: '1 Month' },
      { key: '3_months', label: '3 Months' },
      { key: '6_months', label: '6 Months' },
      { key: '1_year', label: '1 Year' },
      { key: '2_years', label: '2-3 Years' },
      { key: '5_years', label: '5 Years' },
      { key: '10_years', label: '5-10 Years' },
    ];

    // Group items by timeframe
    const timeline: TimelineSummary[] = timeframes.map((tf) => {
      const tfItems = items.filter((item) => item.timeframe === tf.key);

      const mapped: TimelineItem[] = tfItems.map((item) => ({
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
        category: item.category_id ? categoryMap.get(item.category_id) || null : null,
        createdAt: item.created_at,
      }));

      return {
        timeframe: tf.key,
        label: tf.label,
        itemCount: tfItems.length,
        totalEstimatedMin: tfItems.reduce((sum, item) => sum + (item.estimated_cost_min || 0), 0),
        totalEstimatedMax: tfItems.reduce((sum, item) => sum + (item.estimated_cost_max || 0), 0),
        totalActual: tfItems.reduce((sum, item) => sum + (item.actual_cost || 0), 0),
        items: mapped,
      };
    });

    // Calculate totals
    const totalPlanned = {
      min: items.reduce((sum, item) => sum + (item.estimated_cost_min || 0), 0),
      max: items.reduce((sum, item) => sum + (item.estimated_cost_max || 0), 0),
    };
    const totalSpent = allExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    // Category breakdown
    const categoryStats = categories.map((category) => {
      const catItems = items.filter((item) => item.category_id === category.id);
      const catExpenses = allExpenses.filter((exp) => exp.category_id === category.id);

      return {
        category,
        itemCount: catItems.length,
        totalEstimated: catItems.reduce(
          (sum, item) => sum + ((item.estimated_cost_min || 0) + (item.estimated_cost_max || 0)) / 2,
          0
        ),
        totalSpent: catExpenses.reduce((sum, exp) => sum + exp.amount, 0),
      };
    });

    return {
      timeline,
      totalPlanned,
      totalSpent,
      categories: categoryStats,
    };
  }

  // ============ MONTHLY GOALS ============

  async getOrCreateMonthlyGoal(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<BudgetGoal> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(budgetGoals)
      .where(
        and(
          eq(budgetGoals.household_id, householdId),
          eq(budgetGoals.year, year),
          eq(budgetGoals.month, month)
        )
      )
      .get();

    if (existing) return existing;

    const timestamp = now();
    const goal: BudgetGoal = {
      id: crypto.randomUUID(),
      household_id: householdId,
      year,
      month,
      planned_budget: null,
      actual_spent: 0,
      category_budgets: null,
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await this.db.insert(budgetGoals).values(goal);
    return goal;
  }

  async setMonthlyGoal(
    householdId: string,
    userId: string,
    year: number,
    month: number,
    input: { plannedBudget: number; categoryBudgets?: Record<string, number>; notes?: string }
  ): Promise<BudgetGoal> {
    const goal = await this.getOrCreateMonthlyGoal(householdId, userId, year, month);

    const updateData: Record<string, unknown> = {
      planned_budget: input.plannedBudget,
      updated_at: now(),
    };
    if (input.categoryBudgets !== undefined) {
      updateData.category_budgets = JSON.stringify(input.categoryBudgets);
    }
    if (input.notes !== undefined) updateData.notes = input.notes;

    await this.db.update(budgetGoals).set(updateData).where(eq(budgetGoals.id, goal.id));

    return { ...goal, ...updateData } as BudgetGoal;
  }

  /** Whether any month this year already has a planned_budget set, for the first-time-setup prompt. */
  async hasAnyBudgetSetForYear(householdId: string, userId: string, year: number): Promise<boolean> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select({ id: budgetGoals.id })
      .from(budgetGoals)
      .where(
        and(
          eq(budgetGoals.household_id, householdId),
          eq(budgetGoals.year, year),
          sql`${budgetGoals.planned_budget} IS NOT NULL`
        )
      )
      .get();

    return !!existing;
  }

  /** Fills planned_budget for every month after `fromMonth` this year that has no budget set yet. */
  async applyBudgetToRemainingMonths(
    householdId: string,
    userId: string,
    year: number,
    fromMonth: number,
    plannedBudget: number
  ): Promise<number[]> {
    const updatedMonths: number[] = [];

    for (let month = fromMonth + 1; month <= 12; month++) {
      const goal = await this.getOrCreateMonthlyGoal(householdId, userId, year, month);
      if (goal.planned_budget == null) {
        await this.db
          .update(budgetGoals)
          .set({ planned_budget: plannedBudget, updated_at: now() })
          .where(eq(budgetGoals.id, goal.id));
        updatedMonths.push(month);
      }
    }

    return updatedMonths;
  }

  /** Household member user IDs, for fanning out budget reminder notifications. */
  async getHouseholdMemberIds(householdId: string, userId: string): Promise<string[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const rows = await this.db
      .select({ userId: householdMembers.user_id })
      .from(householdMembers)
      .where(eq(householdMembers.household_id, householdId))
      .all();

    return rows.map((r) => r.userId);
  }

  // ============ MONTHLY OVERVIEW ============

  async getMonthlyOverview(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<MonthlyOverview> {
    await this.checkHouseholdAccess(householdId, userId);

    const goal = await this.getOrCreateMonthlyGoal(householdId, userId, year, month);

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const monthEnd = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;

    // Spendings dated into this month drive the month's balance + affordability
    // ranking. Undated ("Anytime") spendings aren't tied to any month, so they
    // surface in EVERY month's list but never consume a specific month's budget
    // (counting their cost against all 12 months would multiply it). The mobile
    // Spendings view renders them in a separate, lower-priority "Anytime"
    // section — keeping scheduled spendings ranked above unscheduled ones.
    const datedItems = await this.db
      .select()
      .from(budgetItems)
      .where(
        and(
          eq(budgetItems.household_id, householdId),
          gte(budgetItems.target_date, monthStart),
          lt(budgetItems.target_date, monthEnd)
        )
      )
      .all();

    const undatedItems = await this.db
      .select()
      .from(budgetItems)
      .where(
        and(eq(budgetItems.household_id, householdId), isNull(budgetItems.target_date))
      )
      .orderBy(asc(budgetItems.priority))
      .all();

    const items = [...datedItems, ...undatedItems];

    const monthExpenses = await this.db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          gte(expenses.expense_date, monthStart),
          lt(expenses.expense_date, monthEnd)
        )
      )
      .orderBy(desc(expenses.expense_date))
      .all();

    const actualSpent = monthExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const savedTotal = monthExpenses.reduce((sum, exp) => sum + (exp.saved_amount ?? 0), 0);
    const depositsTotal = monthExpenses.reduce((sum, exp) => sum + (exp.deposit_amount ?? 0), 0);
    const taxesTotal = monthExpenses.reduce((sum, exp) => sum + (exp.tax_amount ?? 0), 0);

    // In-progress items are locked in. Open planned items compete via the
    // affordability planner below — not subtracted here (would double-count).
    const committedTotal = datedItems
      .filter((item) => item.status === 'in_progress')
      .reduce((sum, item) => {
        const min = item.estimated_cost_min ?? 0;
        const max = item.estimated_cost_max ?? min;
        return sum + Math.round((min + max) / 2);
      }, 0);

    const plannedBudget = goal.planned_budget ?? 0;

    // Budget transfers reshape the balance: leftover carried IN from a prior
    // month's 'next_month' transfer adds to this month's pool, and anything
    // transferred OUT (to next month, a savings goal, or a registered account)
    // is already spoken for — subtracting it here is what stops the same
    // leftover from being moved twice.
    const { carriedIn, transferredOut } = await this.getTransferAggregates(
      householdId,
      year,
      month
    );
    const remainingBudget =
      plannedBudget + carriedIn - actualSpent - committedTotal - transferredOut;

    // Affordability ranks open planned spendings for this month.
    const affordabilityItems: AffordabilityItem[] = datedItems
      .filter((item) => item.status === 'planned')
      .map((item) => ({
        id: item.id,
        title: item.title,
        priority: item.priority as AffordabilityItem['priority'],
        target_date: item.target_date,
        estimated_cost_min: item.estimated_cost_min,
        estimated_cost_max: item.estimated_cost_max,
        actual_cost: item.actual_cost,
        status: item.status as AffordabilityItem['status'],
      }));

    const affordability = planAffordability(affordabilityItems, Math.max(0, remainingBudget));

    const yearAffordability = await this.getYearAffordability(householdId, year);

    // Forward "when" windows, aligned to the item form's date presets — the same
    // range engine pooling the relevant months. Quarter = the 3 months of the
    // calendar quarter containing `month`; next month; next calendar year.
    const qStart = Math.floor((month - 1) / 3) * 3 + 1;
    const quarterAffordability = await this.getRangeAffordability(householdId, year, qStart, qStart + 2);
    const nmYear = month === 12 ? year + 1 : year;
    const nmMonth = month === 12 ? 1 : month + 1;
    const nextMonthAffordability = await this.getRangeAffordability(householdId, nmYear, nmMonth, nmMonth);
    const nextYearAffordability = await this.getRangeAffordability(householdId, year + 1, 1, 12);

    const openItems = items.filter(
      (item) => item.status === 'planned' || item.status === 'in_progress' || item.status === 'deferred'
    );

    // Per-category sub-budget caps + spend. Reuses the month's already-fetched
    // expenses + planned budget so it adds no extra spend query.
    const subBudgets = await this.getSubBudgetProgress(householdId, userId, year, month, {
      plannedBudget,
      monthExpenses,
    });

    return {
      goal,
      plannedBudget,
      actualSpent,
      committedTotal,
      carriedIn,
      transferredOut,
      remainingBudget,
      affordability,
      yearAffordability,
      quarterAffordability,
      nextMonthAffordability,
      nextYearAffordability,
      items: openItems,
      expenses: monthExpenses,
      itemCount: openItems.length + monthExpenses.length,
      savedTotal,
      depositsTotal,
      taxesTotal,
      subBudgets,
    };
  }

  /**
   * Year-scoped affordability: how the household's still-open planned spendings
   * fit into the WHOLE year's remaining budget. Powers the "This year" window on
   * the Planned-spending-fit card.
   *
   * Remaining budget is computed PER MONTH and floored at zero before summing:
   *   remaining = Σ months  max(0, cap(m) − spent(m) − committed(m))
   *
   * The per-month floor (rather than a single annual − spent − committed) is the
   * whole point:
   *   1. A month you've blown past (e.g. a one-off 10k repair against a 500 cap)
   *      contributes 0 — it can't go negative and drag the WHOLE year to $0,
   *      which is the bug that made every planned item show "Won't fit".
   *   2. Months without an explicit budget row inherit the average of the months
   *      that DO have one (households typically set one recurring monthly budget
   *      and rows are created lazily), so the pool always reflects a full year.
   * Year-level goal rows (month IS NULL) are a direct annual figure added on top.
   * The fit ranks every planned item dated this year plus undated "Anytime" ones.
   */
  private async getYearAffordability(
    householdId: string,
    year: number
  ): Promise<AffordabilityPlan> {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;

    const goalRows = await this.db
      .select({ month: budgetGoals.month, planned: budgetGoals.planned_budget })
      .from(budgetGoals)
      .where(and(eq(budgetGoals.household_id, householdId), eq(budgetGoals.year, year)))
      .all();

    // Explicit per-month caps keyed by month (1–12). Year-level rows (month IS
    // NULL) are a direct annual figure, added on top exactly once.
    const monthlyCap = new Map<number, number>();
    let yearLevelPlanned = 0;
    for (const g of goalRows) {
      if (g.planned == null) continue;
      if (g.month == null) yearLevelPlanned += g.planned;
      else monthlyCap.set(g.month, g.planned);
    }

    // Months without an explicit cap inherit the average of the months that do,
    // so the pool reflects a full 12-month year rather than only budgeted months.
    const setCaps = [...monthlyCap.values()];
    const avgMonthlyCap =
      setCaps.length > 0
        ? Math.round(setCaps.reduce((sum, c) => sum + c, 0) / setCaps.length)
        : 0;
    const capForMonth = (month: number) => monthlyCap.get(month) ?? avgMonthlyCap;

    // Actual spend grouped by calendar month (expense_date is 'YYYY-MM-DD…').
    const yearExpenses = await this.db
      .select({ date: expenses.expense_date, amount: expenses.amount })
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          gte(expenses.expense_date, yearStart),
          lt(expenses.expense_date, yearEnd)
        )
      )
      .all();
    const spendByMonth = new Map<number, number>();
    for (const e of yearExpenses) {
      const month = Number(e.date.slice(5, 7));
      spendByMonth.set(month, (spendByMonth.get(month) ?? 0) + e.amount);
    }

    // Planned items due this year, plus undated "Anytime" spendings (which
    // aren't tied to any month and belong to the year's pool exactly once).
    const datedItems = await this.db
      .select()
      .from(budgetItems)
      .where(
        and(
          eq(budgetItems.household_id, householdId),
          gte(budgetItems.target_date, yearStart),
          lt(budgetItems.target_date, yearEnd)
        )
      )
      .all();
    const undatedItems = await this.db
      .select()
      .from(budgetItems)
      .where(and(eq(budgetItems.household_id, householdId), isNull(budgetItems.target_date)))
      .all();

    // In-progress items are locked in against their target month (mirrors the
    // monthly logic, which subtracts committed from that month's balance).
    const committedByMonth = new Map<number, number>();
    for (const item of datedItems) {
      if (item.status !== 'in_progress' || !item.target_date) continue;
      const min = item.estimated_cost_min ?? 0;
      const max = item.estimated_cost_max ?? min;
      const month = Number(item.target_date.slice(5, 7));
      committedByMonth.set(month, (committedByMonth.get(month) ?? 0) + Math.round((min + max) / 2));
    }

    // Sum each month's leftover, floored at 0 so an overspent month contributes
    // nothing rather than eating other months' budget (the "$0 year" bug).
    let remainingBudget = yearLevelPlanned;
    for (let month = 1; month <= 12; month++) {
      const leftover =
        capForMonth(month) - (spendByMonth.get(month) ?? 0) - (committedByMonth.get(month) ?? 0);
      if (leftover > 0) remainingBudget += leftover;
    }

    const affordabilityItems: AffordabilityItem[] = [...datedItems, ...undatedItems]
      .filter((item) => item.status === 'planned')
      .map((item) => ({
        id: item.id,
        title: item.title,
        priority: item.priority as AffordabilityItem['priority'],
        target_date: item.target_date,
        estimated_cost_min: item.estimated_cost_min,
        estimated_cost_max: item.estimated_cost_max,
        actual_cost: item.actual_cost,
        status: item.status as AffordabilityItem['status'],
      }));

    return planAffordability(affordabilityItems, Math.max(0, remainingBudget));
  }

  /**
   * Affordability fit over an arbitrary INCLUSIVE range of calendar months
   * `[startMonth..endMonth]` in `year` — the shared engine behind the "This
   * quarter", "Next month" and "Next year" windows. Same per-month-floored
   * pooling as {@link getYearAffordability}: each month contributes
   * `max(0, cap − spend − committed)` so an overspent month can't drag the pool
   * negative. Ranks planned items dated in the range plus undated "Anytime" ones.
   *
   * Months without an explicit cap inherit the average of the year's set months
   * (households usually set one recurring monthly budget). When the target year
   * has NO caps at all (e.g. next year isn't budgeted yet) it falls back to the
   * previous year's average, so a forward window still reflects a real pool.
   * Unlike the whole-year view it does NOT fold in year-level (month IS NULL)
   * goal rows — an annual lump sum can't be attributed to a sub-year range.
   */
  private async getRangeAffordability(
    householdId: string,
    year: number,
    startMonth: number,
    endMonth: number
  ): Promise<AffordabilityPlan> {
    const rangeStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endBoundYear = endMonth === 12 ? year + 1 : year;
    const endBoundMonth = endMonth === 12 ? 1 : endMonth + 1;
    const rangeEnd = `${endBoundYear}-${String(endBoundMonth).padStart(2, '0')}-01`;

    // Per-month caps for the year → an average that fills unset months.
    const goalRows = await this.db
      .select({ month: budgetGoals.month, planned: budgetGoals.planned_budget })
      .from(budgetGoals)
      .where(and(eq(budgetGoals.household_id, householdId), eq(budgetGoals.year, year)))
      .all();

    const monthlyCap = new Map<number, number>();
    for (const g of goalRows) {
      if (g.planned == null || g.month == null) continue;
      monthlyCap.set(g.month, g.planned);
    }
    const setCaps = [...monthlyCap.values()];
    let avgMonthlyCap =
      setCaps.length > 0
        ? Math.round(setCaps.reduce((sum, c) => sum + c, 0) / setCaps.length)
        : 0;

    // Unbudgeted target year → inherit the previous year's average so a forward
    // window (e.g. "Next year") still reflects the household's recurring budget.
    if (setCaps.length === 0) {
      const priorRows = await this.db
        .select({ month: budgetGoals.month, planned: budgetGoals.planned_budget })
        .from(budgetGoals)
        .where(and(eq(budgetGoals.household_id, householdId), eq(budgetGoals.year, year - 1)))
        .all();
      const priorCaps = priorRows
        .filter((g) => g.planned != null && g.month != null)
        .map((g) => g.planned as number);
      if (priorCaps.length > 0) {
        avgMonthlyCap = Math.round(priorCaps.reduce((sum, c) => sum + c, 0) / priorCaps.length);
      }
    }
    const capForMonth = (m: number) => monthlyCap.get(m) ?? avgMonthlyCap;

    // Actual spend grouped by calendar month within the range.
    const rangeExpenses = await this.db
      .select({ date: expenses.expense_date, amount: expenses.amount })
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          gte(expenses.expense_date, rangeStart),
          lt(expenses.expense_date, rangeEnd)
        )
      )
      .all();
    const spendByMonth = new Map<number, number>();
    for (const e of rangeExpenses) {
      const m = Number(e.date.slice(5, 7));
      spendByMonth.set(m, (spendByMonth.get(m) ?? 0) + e.amount);
    }

    const datedItems = await this.db
      .select()
      .from(budgetItems)
      .where(
        and(
          eq(budgetItems.household_id, householdId),
          gte(budgetItems.target_date, rangeStart),
          lt(budgetItems.target_date, rangeEnd)
        )
      )
      .all();
    const undatedItems = await this.db
      .select()
      .from(budgetItems)
      .where(and(eq(budgetItems.household_id, householdId), isNull(budgetItems.target_date)))
      .all();

    const committedByMonth = new Map<number, number>();
    for (const item of datedItems) {
      if (item.status !== 'in_progress' || !item.target_date) continue;
      const min = item.estimated_cost_min ?? 0;
      const max = item.estimated_cost_max ?? min;
      const m = Number(item.target_date.slice(5, 7));
      committedByMonth.set(m, (committedByMonth.get(m) ?? 0) + Math.round((min + max) / 2));
    }

    let remainingBudget = 0;
    for (let m = startMonth; m <= endMonth; m++) {
      const leftover = capForMonth(m) - (spendByMonth.get(m) ?? 0) - (committedByMonth.get(m) ?? 0);
      if (leftover > 0) remainingBudget += leftover;
    }

    const affordabilityItems: AffordabilityItem[] = [...datedItems, ...undatedItems]
      .filter((item) => item.status === 'planned')
      .map((item) => ({
        id: item.id,
        title: item.title,
        priority: item.priority as AffordabilityItem['priority'],
        target_date: item.target_date,
        estimated_cost_min: item.estimated_cost_min,
        estimated_cost_max: item.estimated_cost_max,
        actual_cost: item.actual_cost,
        status: item.status as AffordabilityItem['status'],
      }));

    return planAffordability(affordabilityItems, Math.max(0, remainingBudget));
  }

  // ============ BUDGET TRANSFERS ============

  /**
   * Net effect of recorded transfers on a month's balance:
   *   carriedIn      — 'next_month' transfers landing IN this month
   *   transferredOut — ALL transfers drawn OUT of this month
   * Subtracting transferredOut is what prevents the same leftover being moved twice.
   */
  private async getTransferAggregates(
    householdId: string,
    year: number,
    month: number
  ): Promise<{ carriedIn: number; transferredOut: number }> {
    const outRows = await this.db
      .select({ amount: budgetTransfers.amount_cents })
      .from(budgetTransfers)
      .where(
        and(
          eq(budgetTransfers.household_id, householdId),
          eq(budgetTransfers.source_year, year),
          eq(budgetTransfers.source_month, month)
        )
      )
      .all();

    const inRows = await this.db
      .select({ amount: budgetTransfers.amount_cents })
      .from(budgetTransfers)
      .where(
        and(
          eq(budgetTransfers.household_id, householdId),
          eq(budgetTransfers.destination_type, 'next_month'),
          eq(budgetTransfers.dest_year, year),
          eq(budgetTransfers.dest_month, month)
        )
      )
      .all();

    return {
      carriedIn: inRows.reduce((sum, r) => sum + r.amount, 0),
      transferredOut: outRows.reduce((sum, r) => sum + r.amount, 0),
    };
  }

  /**
   * One-shot payload for the Budget Transfer screen: this month's still-movable
   * leftover, the destinations it can go to (next month, savings goals,
   * registered accounts), and the transfers already made from this month.
   */
  async getTransferContext(
    householdId: string,
    userId: string,
    year: number,
    month: number
  ): Promise<BudgetTransferContext> {
    await this.checkHouseholdAccess(householdId, userId);

    const overview = await this.getMonthlyOverview(householdId, userId, year, month);
    const leftoverCents = Math.max(0, overview.remainingBudget);

    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;

    const destinations: TransferDestinationOption[] = [
      {
        type: 'next_month',
        id: null,
        label: `Next month · ${monthLabel(nextYear, nextMonth)}`,
        sublabel: 'Roll it into next month’s budget',
        icon: 'arrow-forward-circle-outline',
      },
    ];

    const savingsService = new SavingsService(this.env, this.d1);

    // Savings + registered accounts are optional subsystems — a household that
    // hasn't set them up simply gets fewer destinations, never an error.
    try {
      const goals = await savingsService.listGoals(householdId, userId);
      for (const g of goals) {
        if (g.status === 'archived') continue;
        destinations.push({
          type: 'savings_goal',
          id: g.id,
          label: g.name,
          sublabel: `${fmtDollars(g.current_amount_cents)} of ${fmtDollars(
            g.target_amount_cents
          )} saved`,
          icon: g.type === 'emergency_fund' ? 'shield-checkmark-outline' : 'flag-outline',
        });
      }
    } catch {
      // savings tables absent / no access — skip goal destinations
    }

    try {
      const accounts = await savingsService.listAccounts(householdId, userId);
      for (const a of accounts) {
        const inst = a.institution ? ` · ${a.institution}` : '';
        destinations.push({
          type: 'registered_account',
          id: a.id,
          label: `${a.account_type.toUpperCase()}${inst}`,
          sublabel: `Balance ${fmtDollars(a.balance_cents)}`,
          icon: 'card-outline',
        });
      }
    } catch {
      // registered accounts absent / no access — skip account destinations
    }

    const rows = await this.db
      .select()
      .from(budgetTransfers)
      .where(
        and(
          eq(budgetTransfers.household_id, householdId),
          eq(budgetTransfers.source_year, year),
          eq(budgetTransfers.source_month, month)
        )
      )
      .orderBy(desc(budgetTransfers.created_at))
      .all();

    const history: BudgetTransferRecord[] = rows.map((r) => ({
      id: r.id,
      amountCents: r.amount_cents,
      destinationType: r.destination_type as TransferDestinationType,
      destinationLabel: r.destination_label,
      note: r.note,
      createdAt: r.created_at,
    }));

    return {
      year,
      month,
      monthLabel: monthLabel(year, month),
      leftoverCents,
      plannedBudgetCents: overview.plannedBudget,
      actualSpentCents: overview.actualSpent,
      carriedInCents: overview.carriedIn,
      transferredOutCents: overview.transferredOut,
      destinations,
      history,
    };
  }

  /**
   * Move `amountCents` of this month's leftover to a destination. Validates the
   * amount against the STILL-available leftover (already net of prior transfers,
   * so it can't be over-drawn), performs the destination-side effect, then
   * records the ledger row. Returns the refreshed context. Idempotency is not
   * assumed here — the client disables the button while in flight.
   */
  async createTransfer(
    householdId: string,
    userId: string,
    input: CreateTransferInput
  ): Promise<BudgetTransferContext> {
    await this.checkHouseholdAccess(householdId, userId);

    const { sourceYear, sourceMonth, amountCents, destinationType, destinationId, note } = input;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new ValidationError({ amount_cents: ['Transfer amount must be greater than zero'] });
    }

    const overview = await this.getMonthlyOverview(householdId, userId, sourceYear, sourceMonth);
    const available = Math.max(0, overview.remainingBudget);
    if (amountCents > available) {
      throw new ValidationError({
        amount_cents: [`Transfer exceeds this month’s leftover of ${fmtDollars(available)}`],
      });
    }

    const id = crypto.randomUUID();
    const today = now().slice(0, 10);

    let destYear: number | null = null;
    let destMonth: number | null = null;
    let goalId: string | null = null;
    let accountId: string | null = null;
    let destinationRefId: string | null = null;
    let destinationLabel: string;

    if (destinationType === 'next_month') {
      destYear = sourceMonth === 12 ? sourceYear + 1 : sourceYear;
      destMonth = sourceMonth === 12 ? 1 : sourceMonth + 1;
      destinationLabel = `${monthLabel(destYear, destMonth)} budget`;
    } else if (destinationType === 'savings_goal') {
      if (!destinationId) throw new ValidationError({ destination_id: ['A savings goal is required'] });
      const goal = await this.db
        .select()
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, destinationId), eq(savingsGoals.household_id, householdId)))
        .get();
      if (!goal) throw new NotFoundError('Savings goal');
      goalId = goal.id;
      destinationLabel = goal.name;
      const savingsService = new SavingsService(this.env, this.d1);
      await savingsService.updateGoal(householdId, userId, goal.id, {
        current_amount_cents: goal.current_amount_cents + amountCents,
      });
    } else if (destinationType === 'registered_account') {
      if (!destinationId) {
        throw new ValidationError({ destination_id: ['A registered account is required'] });
      }
      const account = await this.db
        .select()
        .from(registeredAccounts)
        .where(
          and(
            eq(registeredAccounts.id, destinationId),
            eq(registeredAccounts.household_id, householdId)
          )
        )
        .get();
      if (!account) throw new NotFoundError('Registered account');
      accountId = account.id;
      const inst = account.institution ? ` · ${account.institution}` : '';
      destinationLabel = `${account.account_type.toUpperCase()}${inst}`;
      const savingsService = new SavingsService(this.env, this.d1);
      destinationRefId = crypto.randomUUID();
      await savingsService.addTransaction(householdId, userId, account.id, {
        id: destinationRefId,
        type: 'contribution',
        kind: 'manual',
        amount_cents: amountCents,
        transaction_date: today,
        tax_year: sourceYear,
        notes: note ?? `Transfer from ${monthLabel(sourceYear, sourceMonth)} budget`,
      });
    } else {
      throw new ValidationError({ destination_type: ['Unknown transfer destination'] });
    }

    await this.db.insert(budgetTransfers).values({
      id,
      household_id: householdId,
      source_year: sourceYear,
      source_month: sourceMonth,
      amount_cents: amountCents,
      destination_type: destinationType,
      dest_year: destYear,
      dest_month: destMonth,
      goal_id: goalId,
      account_id: accountId,
      destination_ref_id: destinationRefId,
      destination_label: destinationLabel,
      note: note ?? null,
      created_by: userId,
    });

    return this.getTransferContext(householdId, userId, sourceYear, sourceMonth);
  }

  /**
   * Undo a transfer: reverse its destination-side effect (goal amount /
   * registered-account balance) then drop the ledger row, which restores the
   * source month's leftover and removes any carry-in from the target month.
   */
  async deleteTransfer(
    householdId: string,
    userId: string,
    transferId: string
  ): Promise<BudgetTransferContext> {
    await this.checkHouseholdAccess(householdId, userId);

    const row = await this.db
      .select()
      .from(budgetTransfers)
      .where(and(eq(budgetTransfers.id, transferId), eq(budgetTransfers.household_id, householdId)))
      .get();
    if (!row) throw new NotFoundError('Budget transfer');

    if (row.destination_type === 'savings_goal' && row.goal_id) {
      const goal = await this.db
        .select()
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, row.goal_id), eq(savingsGoals.household_id, householdId)))
        .get();
      if (goal) {
        const nextCurrent = Math.max(0, goal.current_amount_cents - row.amount_cents);
        const savingsService = new SavingsService(this.env, this.d1);
        await savingsService.updateGoal(householdId, userId, goal.id, {
          current_amount_cents: nextCurrent,
          // Reactivate a goal that this transfer had auto-flipped to 'achieved'.
          ...(goal.status === 'achieved' && nextCurrent < goal.target_amount_cents
            ? { status: 'active' }
            : {}),
        });
      }
    } else if (
      row.destination_type === 'registered_account' &&
      row.account_id &&
      row.destination_ref_id
    ) {
      const savingsService = new SavingsService(this.env, this.d1);
      try {
        await savingsService.deleteTransaction(
          householdId,
          userId,
          row.account_id,
          row.destination_ref_id
        );
      } catch (err) {
        // Account/txn already gone — nothing to reverse; still drop the ledger row.
        if (!(err instanceof NotFoundError)) throw err;
      }
    }

    await this.db
      .delete(budgetTransfers)
      .where(and(eq(budgetTransfers.id, transferId), eq(budgetTransfers.household_id, householdId)));

    return this.getTransferContext(householdId, userId, row.source_year, row.source_month);
  }

  /** Single budget item by id (household-scoped). Powers the edit form's load. */
  async getBudgetItem(householdId: string, itemId: string, userId: string): Promise<BudgetItem> {
    await this.checkHouseholdAccess(householdId, userId);

    const item = await this.db
      .select()
      .from(budgetItems)
      .where(and(eq(budgetItems.id, itemId), eq(budgetItems.household_id, householdId)))
      .get();

    if (!item) {
      throw new NotFoundError('Budget item');
    }

    return item;
  }

  // ============ SYNC FROM TASKS ============

  async syncFromTasks(householdId: string, userId: string): Promise<number> {
    await this.checkHouseholdAccess(householdId, userId);

    const allTasks = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.household_id, householdId), eq(tasks.is_active, true)))
      .limit(SYNC_FROM_TASKS_LIMIT)
      .all();

    const existingLinks = await this.db
      .select({ source_id: budgetItems.source_id })
      .from(budgetItems)
      .where(
        and(eq(budgetItems.household_id, householdId), eq(budgetItems.source_type, 'task'))
      )
      .limit(SYNC_FROM_TASKS_LINKS_LIMIT)
      .all();
    const linkedTaskIds = new Set(
      existingLinks.map((row) => row.source_id).filter((id): id is string => Boolean(id))
    );

    const timestamp = now();
    let created = 0;
    for (const task of allTasks) {
      if (linkedTaskIds.has(task.id)) continue;

      const priority = task.priority_severity ?? 'nice_to_have';
      const budgetPriority = priority === 'nice_to_have' ? 'low' : priority === 'urgent' ? 'high' : priority;
      const timeframe = this.mapPriorityToTimeframe(budgetPriority as string);

      await this.db.insert(budgetItems).values({
        id: crypto.randomUUID(),
        household_id: householdId,
        title: task.title,
        description: task.description,
        timeframe,
        priority: budgetPriority,
        status: 'planned',
        source_type: 'task',
        source_id: task.id,
        target_date: task.next_due_date,
        created_by: userId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      linkedTaskIds.add(task.id);
      created++;
    }

    return created;
  }

  private mapPriorityToTimeframe(priority: string): string {
    switch (priority) {
      case 'critical':
        return 'immediate';
      case 'high':
        return '3_months';
      case 'medium':
        return '1_year';
      case 'low':
        return '2_years';
      default:
        return '1_year';
    }
  }

  // ============ EXPENSES ============

  async addExpense(
    householdId: string,
    userId: string,
    input: {
      title: string;
      description?: string;
      amount: number;
      expenseDate: string;
      categoryId?: string;
      budgetItemId?: string;
      vendor?: string;
      savedAmount?: number;
      taxAmount?: number;
      depositAmount?: number;
    }
  ): Promise<Expense> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = crypto.randomUUID();
    const timestamp = now();

    const expense: Expense = {
      id,
      household_id: householdId,
      budget_item_id: input.budgetItemId || null,
      category_id: input.categoryId || null,
      title: input.title,
      description: input.description || null,
      amount: input.amount,
      saved_amount: input.savedAmount ?? 0,
      tax_amount: input.taxAmount ?? 0,
      deposit_amount: input.depositAmount ?? 0,
      expense_date: input.expenseDate,
      vendor: input.vendor || null,
      receipt_key: null,
      source: 'manual',
      import_batch_id: null,
      created_by: userId,
      created_at: timestamp,
    };

    await this.db.insert(expenses).values(expense);

    // If linked to a budget item, update actual cost. Both the aggregation and
    // the item UPDATE are scoped to this household so a caller-supplied
    // budget_item_id can never read or overwrite another household's item.
    if (input.budgetItemId) {
      const itemExpenses = await this.db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.budget_item_id, input.budgetItemId),
            eq(expenses.household_id, householdId)
          )
        )
        .all();

      const totalActual = itemExpenses.reduce((sum, exp) => sum + exp.amount, 0);

      await this.db
        .update(budgetItems)
        .set({
          actual_cost: totalActual,
          status: 'completed',
          completed_at: timestamp,
          updated_at: timestamp,
        })
        .where(
          and(
            eq(budgetItems.id, input.budgetItemId),
            eq(budgetItems.household_id, householdId)
          )
        );
    }

    return expense;
  }

  /**
   * Add multiple expenses in a single insert. Used by grocery receipt scanning
   * where the user confirms a batch of items at once — inserting them together
   * keeps the save atomic (all-or-nothing) so a mid-way failure can't leave a
   * half-imported receipt that would duplicate on retry.
   */
  async addExpensesBulk(
    householdId: string,
    userId: string,
    items: Array<{
      title: string;
      description?: string;
      amount: number;
      expenseDate: string;
      categoryId?: string;
      vendor?: string;
      savedAmount?: number;
      taxAmount?: number;
      depositAmount?: number;
    }>
  ): Promise<Expense[]> {
    await this.checkHouseholdAccess(householdId, userId);

    if (items.length === 0) {
      return [];
    }

    const timestamp = now();
    const rows: Expense[] = items.map((input) => ({
      id: crypto.randomUUID(),
      household_id: householdId,
      budget_item_id: null,
      category_id: input.categoryId || null,
      title: input.title,
      description: input.description || null,
      amount: input.amount,
      saved_amount: input.savedAmount ?? 0,
      tax_amount: input.taxAmount ?? 0,
      deposit_amount: input.depositAmount ?? 0,
      expense_date: input.expenseDate,
      vendor: input.vendor || null,
      receipt_key: null,
      source: 'manual',
      import_batch_id: null,
      created_by: userId,
      created_at: timestamp,
    }));

    // D1 caps a single query at 100 bound parameters. Each expense row binds 17
    // columns, so a multi-row INSERT must be chunked. floor(100 / 17) = 5 rows/query.
    const COLUMNS_PER_ROW = EXPENSE_INSERT_COLUMNS;
    const maxRowsPerInsert = Math.floor(100 / COLUMNS_PER_ROW);
    for (let i = 0; i < rows.length; i += maxRowsPerInsert) {
      await this.db.insert(expenses).values(rows.slice(i, i + maxRowsPerInsert));
    }

    return rows;
  }

  /** Turn a planned spending into a recorded expense (mark as spent). */
  async recordPlannedSpending(
    householdId: string,
    itemId: string,
    userId: string,
    input?: { amount?: number; expenseDate?: string }
  ): Promise<{ expense: Expense; item: BudgetItem }> {
    const item = await this.getBudgetItem(householdId, itemId, userId);

    const min = item.estimated_cost_min ?? 0;
    const max = item.estimated_cost_max ?? min;
    const defaultAmount = Math.round((min + max) / 2) || min || max;
    const amount = input?.amount ?? defaultAmount;
    if (amount <= 0) {
      throw new ValidationError({ amount: ['Amount must be greater than zero'] });
    }

    const expenseDate =
      input?.expenseDate?.slice(0, 10) ??
      item.target_date?.slice(0, 10) ??
      now().slice(0, 10);

    const expense = await this.addExpense(householdId, userId, {
      title: item.title,
      description: item.description ?? undefined,
      amount,
      expenseDate,
      categoryId: item.category_id ?? undefined,
      budgetItemId: item.id,
    });

    const updated = await this.getBudgetItem(householdId, itemId, userId);
    return { expense, item: updated };
  }

  async getExpenses(
    householdId: string,
    userId: string,
    filters: { startDate?: string; endDate?: string; categoryId?: string; limit?: number }
  ): Promise<Expense[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const conditions = [eq(expenses.household_id, householdId)];
    if (filters.startDate) conditions.push(gte(expenses.expense_date, filters.startDate));
    if (filters.endDate) conditions.push(lt(expenses.expense_date, filters.endDate));
    if (filters.categoryId === 'uncategorized') {
      conditions.push(isNull(expenses.category_id));
    } else if (filters.categoryId) {
      conditions.push(eq(expenses.category_id, filters.categoryId));
    }

    return this.db
      .select()
      .from(expenses)
      .where(and(...conditions))
      .orderBy(desc(expenses.expense_date))
      .limit(filters.limit || 100)
      .all();
  }

  /**
   * Product-level spending breakdown + trends for a single category, grouped by
   * normalized product title over a rolling window of `months` calendar months
   * ending at (year, month). Powers the category drill-down that lets users see
   * what they bought (e.g. milk, greek yogurt) and how it trends month to month.
   *
   * `categoryId` of 'uncategorized' aggregates expenses that have no category.
   */
  async getCategoryProductTrends(
    householdId: string,
    userId: string,
    categoryId: string,
    year: number,
    month: number,
    monthsBack: number
  ): Promise<CategoryProductTrends> {
    await this.checkHouseholdAccess(householdId, userId);

    const windowSize = Math.max(1, Math.min(24, monthsBack));

    // Build the chronological list of covered months (oldest first) and the
    // inclusive date bounds for the SQL filter.
    const months: string[] = [];
    for (let i = windowSize - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(year, month - 1 - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const startMonth = new Date(Date.UTC(year, month - 1 - (windowSize - 1), 1));
    const startDate = startMonth.toISOString().slice(0, 10);
    // Exclusive upper bound: first day of the month after the anchor.
    const endExclusive = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

    const isUncategorized = categoryId === 'uncategorized';

    const category = isUncategorized
      ? null
      : await this.db
          .select()
          .from(budgetCategories)
          .where(
            and(
              eq(budgetCategories.id, categoryId),
              eq(budgetCategories.household_id, householdId)
            )
          )
          .get();

    const categoryCondition = isUncategorized
      ? isNull(expenses.category_id)
      : eq(expenses.category_id, categoryId);

    const rows = await this.db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.household_id, householdId),
          categoryCondition,
          gte(expenses.expense_date, startDate),
          lt(expenses.expense_date, endExclusive)
        )
      )
      .orderBy(desc(expenses.expense_date))
      .all();

    const monthIndex = new Map(months.map((m, i) => [m, i]));
    const currentMonthKey = months[months.length - 1];
    const previousMonthKey = windowSize > 1 ? months[months.length - 2] : null;

    const monthlyTotals = new Array(windowSize).fill(0);

    interface Accumulator {
      name: string;
      latestDate: string;
      total: number;
      count: number;
      byMonth: CategoryProductMonth[];
    }
    const groups = new Map<string, Accumulator>();

    for (const row of rows) {
      const monthKey = row.expense_date.slice(0, 7);
      const idx = monthIndex.get(monthKey);
      if (idx === undefined) continue;
      monthlyTotals[idx] += row.amount;

      const title = row.title.trim();
      if (!title) continue;
      const key = title.toLowerCase();

      let group = groups.get(key);
      if (!group) {
        group = {
          name: title,
          latestDate: row.expense_date,
          total: 0,
          count: 0,
          byMonth: months.map((m) => ({ month: m, amount: 0, count: 0 })),
        };
        groups.set(key, group);
      }

      group.total += row.amount;
      group.count += 1;
      group.byMonth[idx].amount += row.amount;
      group.byMonth[idx].count += 1;
      // Rows are ordered newest-first, so the first sighting is the latest.
      if (row.expense_date > group.latestDate) {
        group.latestDate = row.expense_date;
        group.name = title;
      }
    }

    const products: CategoryProductTrend[] = [...groups.values()].map((group) => {
      const currentIdx = currentMonthKey ? monthIndex.get(currentMonthKey)! : windowSize - 1;
      const currentAmount = group.byMonth[currentIdx].amount;
      const currentCount = group.byMonth[currentIdx].count;
      const previousAmount =
        previousMonthKey != null ? group.byMonth[monthIndex.get(previousMonthKey)!].amount : 0;
      const averageAmount = Math.round(group.total / windowSize);

      let trend: CategoryProductTrend['trend'];
      if (previousAmount === 0 && currentAmount > 0) {
        trend = 'new';
      } else if (currentAmount > previousAmount * 1.1) {
        trend = 'up';
      } else if (currentAmount < previousAmount * 0.9) {
        trend = 'down';
      } else {
        trend = 'flat';
      }

      return {
        name: group.name,
        total: group.total,
        count: group.count,
        currentAmount,
        currentCount,
        previousAmount,
        averageAmount,
        trend,
        byMonth: group.byMonth,
      };
    });

    products.sort(
      (a, b) => b.currentAmount - a.currentAmount || b.total - a.total || a.name.localeCompare(b.name)
    );

    const currentMonthTotal = monthlyTotals[monthlyTotals.length - 1] ?? 0;
    const previousMonthTotal = windowSize > 1 ? monthlyTotals[monthlyTotals.length - 2] : 0;

    return {
      categoryId,
      categoryName: isUncategorized ? null : category?.name ?? null,
      months,
      monthlyTotals,
      currentMonthTotal,
      previousMonthTotal,
      products,
    };
  }

  async getExpense(householdId: string, expenseId: string, userId: string): Promise<Expense> {
    await this.checkHouseholdAccess(householdId, userId);

    const expense = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.household_id, householdId)))
      .get();

    if (!expense) {
      throw new NotFoundError('Expense');
    }

    return expense;
  }

  async updateExpense(
    householdId: string,
    expenseId: string,
    userId: string,
    input: {
      title?: string;
      description?: string | null;
      amount?: number;
      expenseDate?: string;
      categoryId?: string | null;
      savedAmount?: number;
      taxAmount?: number;
      depositAmount?: number;
      vendor?: string | null;
    }
  ): Promise<Expense> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getExpense(householdId, expenseId, userId);
    const timestamp = now();

    const updateData: Partial<Expense> = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.amount !== undefined) updateData.amount = input.amount;
    if (input.expenseDate !== undefined) updateData.expense_date = input.expenseDate;
    if (input.categoryId !== undefined) updateData.category_id = input.categoryId;
    if (input.savedAmount !== undefined) updateData.saved_amount = input.savedAmount;
    if (input.taxAmount !== undefined) updateData.tax_amount = input.taxAmount;
    if (input.depositAmount !== undefined) updateData.deposit_amount = input.depositAmount;
    if (input.vendor !== undefined) updateData.vendor = input.vendor;

    await this.db
      .update(expenses)
      .set(updateData)
      .where(and(eq(expenses.id, expenseId), eq(expenses.household_id, householdId)));

    if (existing.budget_item_id) {
      await this.syncLinkedBudgetItemActualCost(householdId, existing.budget_item_id, timestamp);
    }

    return this.getExpense(householdId, expenseId, userId);
  }

  async deleteExpense(householdId: string, expenseId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getExpense(householdId, expenseId, userId);
    const timestamp = now();
    const linkedItemId = existing.budget_item_id;

    await this.db
      .delete(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.household_id, householdId)));

    if (linkedItemId) {
      await this.syncLinkedBudgetItemActualCost(householdId, linkedItemId, timestamp);
    }
  }

  private async syncLinkedBudgetItemActualCost(
    householdId: string,
    budgetItemId: string,
    now: string
  ): Promise<void> {
    const itemExpenses = await this.db
      .select()
      .from(expenses)
      .where(
        and(eq(expenses.budget_item_id, budgetItemId), eq(expenses.household_id, householdId))
      )
      .all();

    const totalActual = itemExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    if (itemExpenses.length === 0) {
      await this.db
        .update(budgetItems)
        .set({
          actual_cost: null,
          status: 'planned',
          completed_at: null,
          updated_at: now,
        })
        .where(and(eq(budgetItems.id, budgetItemId), eq(budgetItems.household_id, householdId)));
      return;
    }

    await this.db
      .update(budgetItems)
      .set({
        actual_cost: totalActual,
        status: 'completed',
        completed_at: now,
        updated_at: now,
      })
      .where(and(eq(budgetItems.id, budgetItemId), eq(budgetItems.household_id, householdId)));
  }

  async getQuickAddSuggestions(
    householdId: string,
    userId: string,
    kind: 'planned' | 'spent'
  ): Promise<{ recent: BudgetQuickAddSuggestion[]; popular: BudgetQuickAddSuggestion[] }> {
    await this.checkHouseholdAccess(householdId, userId);

    if (kind === 'spent') {
      const rows = await this.db
        .select()
        .from(expenses)
        .where(eq(expenses.household_id, householdId))
        .orderBy(desc(expenses.created_at))
        .limit(200)
        .all();
      return buildQuickAddSuggestionsFromExpenses(rows);
    }

    const rows = await this.db
      .select()
      .from(budgetItems)
      .where(and(eq(budgetItems.household_id, householdId), ne(budgetItems.status, 'cancelled')))
      .orderBy(desc(budgetItems.created_at))
      .limit(200)
      .all();
    return buildQuickAddSuggestionsFromPlanned(rows);
  }
}

// ============ SYSTEM-PATH AGGREGATES (no user auth — called from triggers) ============

/**
 * Total spend (in the smallest currency unit — cents) for a household over
 * `[startIso, endExclusiveIso)`. Used by Aihousekeeper's `cost_anomaly` trigger
 * (plan §D11) which runs in the Worker's scheduled context without a user
 * identity, so no `checkHouseholdAccess` is applied. Household scoping comes
 * from the required `householdId` filter in the WHERE clause.
 *
 * Exported as a standalone function rather than a `BudgetService` method so
 * trigger callers don't have to instantiate a service they otherwise don't
 * need.
 */
export async function totalSpendBetween(
  d1: D1Database,
  householdId: string,
  startIso: string,
  endExclusiveIso: string
): Promise<number> {
  const db = drizzle(d1);
  const row = await db
    .select({
      total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.household_id, householdId),
        gte(expenses.expense_date, startIso),
        lt(expenses.expense_date, endExclusiveIso)
      )
    )
    .get();
  return Number(row?.total ?? 0);
}
