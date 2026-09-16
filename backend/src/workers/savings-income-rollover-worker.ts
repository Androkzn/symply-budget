import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { REGULAR_INCOME_SOURCE_TYPES } from '../constants/income-sources';
import { households } from '../db/schema';
import { savingsIncomeEntries } from '../db/schema-savings';
import { scheduleIncomeRolloverReminder } from '../services/budget/income-rollover-reminder';
import { monthWindow, pad2 } from '../services/savings-service';
import type { Env } from '../types';

/**
 * Monthly income rollover — mirrors SavingsAlertWorker's shape (direct
 * drizzle queries against this household's D1, own kill-switch check).
 *
 * Copies each household's *confirmed* regular/recurring income (payroll,
 * rental, RRSP matching, insurance, "other" — REGULAR_INCOME_SOURCE_TYPES)
 * from last month forward into this month as 'draft' rows the member must
 * review. One-off income (gifts, bonuses, tax refunds, …) never rolls over.
 * Only *confirmed* source rows roll forward — an unconfirmed draft from last
 * month is left to its own still-pending reminder rather than compounding
 * into a second draft.
 *
 * Idempotent: each source entry can only ever produce one rollover draft
 * (enforced by the partial unique index on rolled_over_from_entry_id,
 * migration 0149), so re-running within the cron's multi-day safety window
 * is a no-op after the first success.
 */
export class SavingsIncomeRolloverWorker {
  private env: Env;
  private d1: D1Database;
  private db: DrizzleD1Database;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.d1 = d1;
    this.db = drizzle(d1);
  }

  private async getActiveHouseholdIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: households.id })
      .from(households)
      .where(isNull(households.deleted_at))
      .all();
    return rows.map((r) => r.id);
  }

  async rolloverRegularIncomeForAllHouseholds(
    now: Date = new Date()
  ): Promise<{ households: number; created: number }> {
    // IP4c kill-switch: absent key = enabled; only the literal 'false' disables.
    const flag = await this.env.CONFIG_KV.get('savings_enabled');
    if (flag === 'false') return { households: 0, created: 0 };

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prev = monthWindow(prevYear, prevMonth);
    const daysInTargetMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const householdIds = await this.getActiveHouseholdIds();
    let householdsWithDrafts = 0;
    let totalCreated = 0;

    for (const householdId of householdIds) {
      try {
        const sourceEntries = await this.db
          .select()
          .from(savingsIncomeEntries)
          .where(
            and(
              eq(savingsIncomeEntries.household_id, householdId),
              eq(savingsIncomeEntries.status, 'confirmed'),
              inArray(savingsIncomeEntries.source_type, [...REGULAR_INCOME_SOURCE_TYPES]),
              gte(savingsIncomeEntries.income_date, prev.monthStart),
              lt(savingsIncomeEntries.income_date, prev.monthEnd)
            )
          )
          .all();

        for (const source of sourceEntries) {
          const sourceDay = Number(source.income_date.slice(8, 10)) || 1;
          const day = Math.min(sourceDay, daysInTargetMonth);
          const income_date = `${year}-${pad2(month)}-${pad2(day)}`;

          const inserted = await this.db
            .insert(savingsIncomeEntries)
            .values({
              id: crypto.randomUUID(),
              household_id: householdId,
              member_id: source.member_id,
              source_type: source.source_type,
              label: source.label,
              amount_cents: source.amount_cents,
              income_date,
              currency: source.currency,
              notes: source.notes,
              source: 'rollover',
              status: 'draft',
              rolled_over_from_entry_id: source.id,
              created_by: null,
            })
            .onConflictDoNothing()
            .returning();

          if (inserted.length > 0) totalCreated++;
        }

        const draftCount = await this.db
          .select({ id: savingsIncomeEntries.id })
          .from(savingsIncomeEntries)
          .where(
            and(
              eq(savingsIncomeEntries.household_id, householdId),
              eq(savingsIncomeEntries.status, 'draft'),
              eq(savingsIncomeEntries.source, 'rollover'),
              gte(savingsIncomeEntries.income_date, `${year}-${pad2(month)}-01`),
              lt(
                savingsIncomeEntries.income_date,
                `${month === 12 ? year + 1 : year}-${pad2(month === 12 ? 1 : month + 1)}-01`
              )
            )
          )
          .all();

        if (draftCount.length > 0) {
          householdsWithDrafts++;
          await scheduleIncomeRolloverReminder(this.env, this.d1, {
            householdId,
            year,
            month,
            draftCount: draftCount.length,
          });
        }
      } catch (error) {
        console.error('[savings-income-rollover-worker] failed for household', {
          householdId,
          error: (error as Error).message,
        });
      }
    }

    return { households: householdsWithDrafts, created: totalCreated };
  }
}
