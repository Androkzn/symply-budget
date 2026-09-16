/**
 * A4 pilot — thin persistence seam for savings-service.
 *
 * Next extract points (in rough priority order):
 * - categories (+ default seed on first list)
 * - goals get/insert/update/delete (createGoal still on service db)
 * - registered accounts & transactions
 * - recurring payments, income templates
 * - householdMembers access lookup (checkHouseholdAccess)
 * - budget expense aggregates used by overview/trends/history
 */

import { eq, and, gte, lt, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import {
  savingsIncomeEntries,
  savingsSpendingEntries,
  savingsGoals,
  type SavingsIncomeEntry,
  type SavingsSpendingEntry,
  type SavingsGoal,
  type NewSavingsIncomeEntry,
  type NewSavingsSpendingEntry,
} from '../db/schema-savings';
import { nowIso } from '../utils/id';

/** Upper bound on month-scoped income/spending ledger rows per list. */
export const LIST_MONTH_ENTRIES_LIMIT = 500;
/** Upper bound on savings goals returned per household list. */
export const LIST_GOALS_LIMIT = 100;

export type SpendingEntryPatch = Partial<
  Pick<
    SavingsSpendingEntry,
    'category_id' | 'label' | 'amount_cents' | 'spending_date' | 'currency' | 'notes'
  >
> & { updated_at: string };

/** Income + goals reads/writes extracted from savings-service (pilot). */
export interface SavingsRepository {
  listIncomeEntries(
    householdId: string,
    monthStart: string,
    monthEnd: string
  ): Promise<SavingsIncomeEntry[]>;

  getIncomeEntry(householdId: string, id: string): Promise<SavingsIncomeEntry | null>;

  /** Idempotent: duplicate primary key is a no-op (matches onConflictDoNothing). */
  insertIncomeEntry(row: NewSavingsIncomeEntry): Promise<void>;

  listGoals(householdId: string): Promise<SavingsGoal[]>;

  listSpendingEntries(
    householdId: string,
    monthStart: string,
    monthEnd: string
  ): Promise<SavingsSpendingEntry[]>;

  getSpendingEntry(householdId: string, id: string): Promise<SavingsSpendingEntry | null>;

  /** Idempotent: duplicate primary key is a no-op (matches onConflictDoNothing). */
  insertSpendingEntry(row: NewSavingsSpendingEntry): Promise<void>;

  updateSpendingEntry(householdId: string, id: string, patch: SpendingEntryPatch): Promise<void>;

  deleteSpendingEntry(householdId: string, id: string): Promise<void>;
}

export class D1SavingsRepository implements SavingsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async listIncomeEntries(
    householdId: string,
    monthStart: string,
    monthEnd: string
  ): Promise<SavingsIncomeEntry[]> {
    return this.db
      .select()
      .from(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.household_id, householdId),
          gte(savingsIncomeEntries.income_date, monthStart),
          lt(savingsIncomeEntries.income_date, monthEnd)
        )
      )
      .orderBy(desc(savingsIncomeEntries.income_date))
      .limit(LIST_MONTH_ENTRIES_LIMIT)
      .all();
  }

  async getIncomeEntry(householdId: string, id: string): Promise<SavingsIncomeEntry | null> {
    const row = await this.db
      .select()
      .from(savingsIncomeEntries)
      .where(
        and(
          eq(savingsIncomeEntries.id, id),
          eq(savingsIncomeEntries.household_id, householdId)
        )
      )
      .get();
    return row ?? null;
  }

  async insertIncomeEntry(row: NewSavingsIncomeEntry): Promise<void> {
    await this.db.insert(savingsIncomeEntries).values(row).onConflictDoNothing();
  }

  async listGoals(householdId: string): Promise<SavingsGoal[]> {
    return this.db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.household_id, householdId))
      .orderBy(desc(savingsGoals.created_at))
      .limit(LIST_GOALS_LIMIT)
      .all();
  }

  async listSpendingEntries(
    householdId: string,
    monthStart: string,
    monthEnd: string
  ): Promise<SavingsSpendingEntry[]> {
    return this.db
      .select()
      .from(savingsSpendingEntries)
      .where(
        and(
          eq(savingsSpendingEntries.household_id, householdId),
          gte(savingsSpendingEntries.spending_date, monthStart),
          lt(savingsSpendingEntries.spending_date, monthEnd)
        )
      )
      .orderBy(desc(savingsSpendingEntries.spending_date))
      .limit(LIST_MONTH_ENTRIES_LIMIT)
      .all();
  }

  async getSpendingEntry(householdId: string, id: string): Promise<SavingsSpendingEntry | null> {
    const row = await this.db
      .select()
      .from(savingsSpendingEntries)
      .where(
        and(
          eq(savingsSpendingEntries.id, id),
          eq(savingsSpendingEntries.household_id, householdId)
        )
      )
      .get();
    return row ?? null;
  }

  async insertSpendingEntry(row: NewSavingsSpendingEntry): Promise<void> {
    await this.db.insert(savingsSpendingEntries).values(row).onConflictDoNothing();
  }

  async updateSpendingEntry(
    householdId: string,
    id: string,
    patch: SpendingEntryPatch
  ): Promise<void> {
    await this.db
      .update(savingsSpendingEntries)
      .set(patch)
      .where(
        and(
          eq(savingsSpendingEntries.id, id),
          eq(savingsSpendingEntries.household_id, householdId)
        )
      );
  }

  async deleteSpendingEntry(householdId: string, id: string): Promise<void> {
    await this.db
      .delete(savingsSpendingEntries)
      .where(
        and(
          eq(savingsSpendingEntries.id, id),
          eq(savingsSpendingEntries.household_id, householdId)
        )
      );
  }
}

/** In-memory fake for unit tests — not a substitute for D1 integration tests. */
export class InMemorySavingsRepository implements SavingsRepository {
  private income = new Map<string, SavingsIncomeEntry>();
  private spending = new Map<string, SavingsSpendingEntry>();
  private goals = new Map<string, SavingsGoal>();

  async listIncomeEntries(
    householdId: string,
    monthStart: string,
    monthEnd: string
  ): Promise<SavingsIncomeEntry[]> {
    return [...this.income.values()]
      .filter(
        (row) =>
          row.household_id === householdId &&
          row.income_date >= monthStart &&
          row.income_date < monthEnd
      )
      .sort((a, b) => (a.income_date < b.income_date ? 1 : a.income_date > b.income_date ? -1 : 0));
  }

  async getIncomeEntry(householdId: string, id: string): Promise<SavingsIncomeEntry | null> {
    const row = this.income.get(id);
    if (!row || row.household_id !== householdId) return null;
    return row;
  }

  async insertIncomeEntry(row: NewSavingsIncomeEntry): Promise<void> {
    if (this.income.has(row.id)) return;

    const now = nowIso();
    this.income.set(row.id, {
      id: row.id,
      household_id: row.household_id,
      member_id: row.member_id ?? null,
      source_type: row.source_type,
      label: row.label,
      amount_cents: row.amount_cents,
      income_date: row.income_date,
      currency: row.currency ?? 'CAD',
      notes: row.notes ?? null,
      template_id: row.template_id ?? null,
      period: row.period ?? null,
      source: row.source ?? 'manual',
      import_batch_id: row.import_batch_id ?? null,
      status: row.status ?? 'confirmed',
      rolled_over_from_entry_id: row.rolled_over_from_entry_id ?? null,
      created_by: row.created_by ?? null,
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
    });
  }

  async listGoals(householdId: string): Promise<SavingsGoal[]> {
    return [...this.goals.values()]
      .filter((g) => g.household_id === householdId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }

  async listSpendingEntries(
    householdId: string,
    monthStart: string,
    monthEnd: string
  ): Promise<SavingsSpendingEntry[]> {
    return [...this.spending.values()]
      .filter(
        (row) =>
          row.household_id === householdId &&
          row.spending_date >= monthStart &&
          row.spending_date < monthEnd
      )
      .sort((a, b) =>
        a.spending_date < b.spending_date ? 1 : a.spending_date > b.spending_date ? -1 : 0
      );
  }

  async getSpendingEntry(householdId: string, id: string): Promise<SavingsSpendingEntry | null> {
    const row = this.spending.get(id);
    if (!row || row.household_id !== householdId) return null;
    return row;
  }

  async insertSpendingEntry(row: NewSavingsSpendingEntry): Promise<void> {
    if (this.spending.has(row.id)) return;

    const now = nowIso();
    this.spending.set(row.id, {
      id: row.id,
      household_id: row.household_id,
      category_id: row.category_id ?? null,
      label: row.label,
      amount_cents: row.amount_cents,
      spending_date: row.spending_date,
      currency: row.currency ?? 'CAD',
      notes: row.notes ?? null,
      recurring_payment_id: row.recurring_payment_id ?? null,
      period: row.period ?? null,
      created_by: row.created_by ?? null,
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
    });
  }

  async updateSpendingEntry(
    householdId: string,
    id: string,
    patch: SpendingEntryPatch
  ): Promise<void> {
    const row = this.spending.get(id);
    if (!row || row.household_id !== householdId) return;

    this.spending.set(id, {
      ...row,
      ...(patch.category_id !== undefined ? { category_id: patch.category_id } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.amount_cents !== undefined ? { amount_cents: patch.amount_cents } : {}),
      ...(patch.spending_date !== undefined ? { spending_date: patch.spending_date } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updated_at: patch.updated_at,
    });
  }

  async deleteSpendingEntry(householdId: string, id: string): Promise<void> {
    const row = this.spending.get(id);
    if (!row || row.household_id !== householdId) return;
    this.spending.delete(id);
  }

  /** Test helper — seed a goal without going through the service layer. */
  seedGoal(goal: SavingsGoal): void {
    this.goals.set(goal.id, goal);
  }
}

export function createD1SavingsRepository(d1: D1Database): D1SavingsRepository {
  return new D1SavingsRepository(d1);
}
