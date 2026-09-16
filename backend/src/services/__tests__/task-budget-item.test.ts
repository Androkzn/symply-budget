/**
 * BudgetService — "add to planned spending" from a purchase task.
 * Covers createBudgetItemFromTask (create + link + idempotency), the
 * deleteBudgetItem reverse-clear, and the task→budget mapping helpers.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetItems } from '../../db/schema-budget';
import type { Database, Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import {
  BudgetService,
  budgetPriorityFromTaskSeverity,
  budgetTimeframeFromDate,
} from '../budget-service';

const testEnv = env as unknown as Env;
const HID = 'hh_pbud_01';
const UID = 'u_pbud_01';
const TID = 't_pbud_01';

const BUDGET_ITEMS_DDL = `CREATE TABLE IF NOT EXISTS budget_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  category_id TEXT,
  horizon TEXT NOT NULL DEFAULT 'short_term',
  timeframe TEXT NOT NULL,
  year INTEGER,
  quarter INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  actual_cost INTEGER,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  is_recurring INTEGER DEFAULT 0,
  recurrence_frequency TEXT,
  source_type TEXT,
  source_id TEXT,
  target_date TEXT,
  completed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

function db(): Database {
  return drizzle(testEnv.DB, { schema }) as unknown as Database;
}

async function seedHouseholdAndMember(): Promise<void> {
  const now = new Date().toISOString();
  await db().insert(schema.households).values({ id: HID, name: 'Test HH' });
  await db().insert(schema.householdMembers).values({
    id: 'm_pbud_01',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: now,
  });
}

async function seedPurchaseTask(over: Partial<schema.Task> = {}): Promise<void> {
  await db()
    .insert(schema.tasks)
    .values({
      id: TID,
      household_id: HID,
      title: 'Replace the dishwasher',
      description: 'It broke',
      frequency: 'one_time',
      priority_severity: 'medium',
      is_purchase: true,
      purchase_estimated_cost_min: 45000,
      purchase_estimated_cost_max: 90000,
      ...over,
    });
}

beforeEach(async () => {
  await createCoreTables(testEnv.DB);
  await testEnv.DB.exec(BUDGET_ITEMS_DDL.replace(/\s+/g, ' ').trim());
  await resetAllTables(testEnv.DB);
  await testEnv.DB.exec('DELETE FROM budget_items');
  await seedHouseholdAndMember();
});

describe('BudgetService.createBudgetItemFromTask', () => {
  it('creates a planned budget item linked back to the task', async () => {
    await seedPurchaseTask();
    const svc = new BudgetService(testEnv, testEnv.DB);

    const item = await svc.createBudgetItemFromTask(HID, UID, TID);

    expect(item.title).toBe('Replace the dishwasher');
    expect(item.status).toBe('planned');
    expect(item.source_type).toBe('task');
    expect(item.source_id).toBe(TID);
    expect(item.estimated_cost_min).toBe(45000);
    expect(item.estimated_cost_max).toBe(90000);
    expect(item.priority).toBe('medium');

    // The task now points at the created item (chip "added" state).
    const task = await db().select().from(schema.tasks).where(eq(schema.tasks.id, TID)).get();
    expect(task?.budget_item_id).toBe(item.id);
  });

  it('is idempotent — a second call returns the same linked item, not a duplicate', async () => {
    await seedPurchaseTask();
    const svc = new BudgetService(testEnv, testEnv.DB);

    const first = await svc.createBudgetItemFromTask(HID, UID, TID);
    const second = await svc.createBudgetItemFromTask(HID, UID, TID);

    expect(second.id).toBe(first.id);
    const rows = await db()
      .select()
      .from(budgetItems)
      .where(eq(budgetItems.source_id, TID))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('maps a near-term due date to a target_date + timeframe', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString(); // 5 days out
    await seedPurchaseTask({ next_due_date: soon });
    const svc = new BudgetService(testEnv, testEnv.DB);

    const item = await svc.createBudgetItemFromTask(HID, UID, TID);
    expect(item.target_date).toBe(soon.slice(0, 10));
    expect(item.timeframe).toBe('immediate');
  });

  it('throws for a missing task', async () => {
    const svc = new BudgetService(testEnv, testEnv.DB);
    await expect(svc.createBudgetItemFromTask(HID, UID, 'nope')).rejects.toThrow();
  });
});

describe('BudgetService.deleteBudgetItem reverse-clear', () => {
  it('clears tasks.budget_item_id when the linked item is deleted', async () => {
    await seedPurchaseTask();
    const svc = new BudgetService(testEnv, testEnv.DB);
    const item = await svc.createBudgetItemFromTask(HID, UID, TID);

    await svc.deleteBudgetItem(HID, item.id, UID);

    const task = await db().select().from(schema.tasks).where(eq(schema.tasks.id, TID)).get();
    expect(task?.budget_item_id).toBeNull();
  });
});

describe('task → budget mapping helpers', () => {
  it('maps priority_severity onto the budget priority enum', () => {
    expect(budgetPriorityFromTaskSeverity('urgent')).toBe('critical');
    expect(budgetPriorityFromTaskSeverity('critical')).toBe('critical');
    expect(budgetPriorityFromTaskSeverity('high')).toBe('high');
    expect(budgetPriorityFromTaskSeverity('medium')).toBe('medium');
    expect(budgetPriorityFromTaskSeverity('nice_to_have')).toBe('low');
    expect(budgetPriorityFromTaskSeverity(null)).toBe('low');
  });

  it('buckets a target date into the timeframe enum by distance', () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    expect(budgetTimeframeFromDate(undefined)).toBe('immediate');
    expect(budgetTimeframeFromDate(inDays(10))).toBe('immediate');
    expect(budgetTimeframeFromDate(inDays(40))).toBe('1_month');
    expect(budgetTimeframeFromDate(inDays(120))).toBe('3_months');
    expect(budgetTimeframeFromDate(inDays(400))).toBe('1_year');
    expect(budgetTimeframeFromDate(inDays(4000))).toBe('10_years');
  });
});
