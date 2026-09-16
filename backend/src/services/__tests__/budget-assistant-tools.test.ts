/**
 * Budget chat assistant tooling — the "smart budget adviser".
 *
 * Exercises BUDGET_CHAT_ASSISTANT.runTool / buildContext against a miniflare D1
 * so the read tools (overview, breakdown, list), the write tools (add / edit /
 * delete expense, set budget, create category / planned spending), and the UI
 * tools (charts, stats) all go through the real BudgetService and produce the
 * expected data effects + result strings.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { budgetCategories } from '../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetService } from '../budget-service';
import { BUDGET_CHAT_ASSISTANT } from '../chat/budget-assistant-tools';
import type { ChatAssistantToolContext } from '../chat/chat-room-service-core';

const testEnv = env as unknown as Env;

const HID = 'hh_adviser';
const UID = 'u_adviser';
const MID = 'm_adviser';
const CAT_GROCERIES = 'cat_groceries';
const CAT_DINING = 'cat_dining';

function ctx(): ChatAssistantToolContext {
  // Budget rooms carry no subject — only House has project/material chats.
  return {
    env: testEnv,
    householdId: HID,
    roomId: 'room_1',
    userId: UID,
    imageAttachments: [],
    subject: null,
  };
}

function run(name: string, input: Record<string, unknown> = {}) {
  return BUDGET_CHAT_ASSISTANT.runTool!(ctx(), { name, input });
}

/** Normalize a tool return to its text (string) part. */
async function runText(name: string, input: Record<string, unknown> = {}): Promise<string> {
  const ret = await run(name, input);
  return typeof ret === 'string' ? ret : ret.result;
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'adviser@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'Adviser House' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
  await db.insert(budgetCategories).values([
    { id: CAT_GROCERIES, household_id: HID, name: 'Groceries' },
    { id: CAT_DINING, household_id: HID, name: 'Dining' },
  ]);
}

beforeEach(seed);

describe('budget adviser — UI tools (no DB)', () => {
  it('show_chart returns a validated chart UI block', async () => {
    const ret = await run('show_chart', {
      type: 'pie',
      title: 'Spending',
      value_format: 'currency',
      data: [
        { label: 'Groceries', value: 210 },
        { label: 'Dining', value: 90 },
        { label: 'bad', value: 'NaN' }, // dropped
      ],
    });
    expect(typeof ret).not.toBe('string');
    if (typeof ret === 'string') return;
    expect(ret.ui).toHaveLength(1);
    const block = ret.ui![0];
    expect(block.kind).toBe('chart');
    if (block.kind !== 'chart') return;
    expect(block.chart.type).toBe('pie');
    expect(block.chart.data).toHaveLength(2); // invalid point filtered out
    expect(block.chart.data[0]).toMatchObject({ label: 'Groceries', value: 210 });
  });

  it('show_chart with no valid data returns a plain error string', async () => {
    const ret = await run('show_chart', { type: 'bar', data: [] });
    expect(typeof ret).toBe('string');
  });

  it('show_stats returns a validated stats UI block', async () => {
    const ret = await run('show_stats', {
      stats: [
        { label: 'Spent', value: '$412', tone: 'warning' },
        { label: 'Remaining', value: '$188', tone: 'positive', caption: '31% left' },
      ],
    });
    if (typeof ret === 'string') throw new Error('expected UI block');
    expect(ret.ui![0]).toMatchObject({ kind: 'stats' });
    const block = ret.ui![0];
    if (block.kind !== 'stats') return;
    expect(block.stats).toHaveLength(2);
    expect(block.stats[1]).toMatchObject({ label: 'Remaining', tone: 'positive', caption: '31% left' });
  });

  it('show_chart strips model-supplied color and accepts line type', async () => {
    const ret = await run('show_chart', {
      type: 'line',
      data: [{ label: 'Jan', value: 10, color: '#FF0000' }],
    });
    if (typeof ret === 'string') throw new Error('expected UI block');
    const block = ret.ui![0];
    expect(block.kind).toBe('chart');
    if (block.kind !== 'chart') return;
    expect(block.chart.type).toBe('line');
    expect(block.chart.data[0]).toEqual({ label: 'Jan', value: 10 });
    expect((block.chart.data[0] as { color?: string }).color).toBeUndefined();
  });

  it('show_table / show_insight / show_diagram attach UI blocks', async () => {
    const table = await run('show_table', {
      title: 'Top',
      columns: ['Name', 'Amt'],
      rows: [['Tomatoes', '$12']],
    });
    if (typeof table === 'string') throw new Error('expected table UI');
    expect(table.ui![0]).toMatchObject({ kind: 'table' });

    const insight = await run('show_insight', {
      title: 'Note',
      body: 'Spend is up.',
      tone: 'warning',
    });
    if (typeof insight === 'string') throw new Error('expected insight UI');
    expect(insight.ui![0]).toMatchObject({ kind: 'insight' });

    const diagram = await run('show_diagram', {
      nodes: [
        { id: 'a', label: 'Income', value: '$5k' },
        { id: 'b', label: 'Bills' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'pay' }],
    });
    if (typeof diagram === 'string') throw new Error('expected diagram UI');
    expect(diagram.ui![0]).toMatchObject({ kind: 'diagram' });
  });
});

describe('budget adviser — regular monthly spending', () => {
  it('analyze_regular_monthly_spending summarizes detected patterns', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    const now = new Date();
    for (let i = 0; i < 3; i += 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 8));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      await budget.addExpense(HID, UID, {
        title: 'Internet Bill',
        amount: 8000,
        expenseDate: `${ym}-08`,
        categoryId: CAT_DINING,
        vendor: 'ISP Co',
      });
    }
    const msg = await runText('analyze_regular_monthly_spending', { months: 6 });
    expect(msg).toContain('Regular monthly spending');
    expect(msg.toLowerCase()).toMatch(/isp|internet/);
  });
});

describe('budget adviser — topic analysis', () => {
  it('analyze_spend_topic classifies vegetables and attaches chart/table', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    const month = new Date().toISOString().slice(0, 7);
    const day = `${month}-10`;
    await budget.addExpense(HID, UID, {
      title: 'Roma Tomatoes',
      amount: 500,
      expenseDate: day,
      categoryId: CAT_GROCERIES,
    });
    await budget.addExpense(HID, UID, {
      title: 'Cucumbers',
      amount: 300,
      expenseDate: day,
      categoryId: CAT_GROCERIES,
    });
    await budget.addExpense(HID, UID, {
      title: 'Gas fill-up',
      amount: 6000,
      expenseDate: day,
      categoryId: CAT_DINING,
    });

    const ret = await run('analyze_spend_topic', { topic: 'vegetables', months: 3 });
    if (typeof ret === 'string') throw new Error(ret);
    expect(ret.result).toContain('Tomato');
    expect(ret.result).toContain('Cucumber');
    expect(ret.result).not.toContain('Gas');
    expect(ret.ui?.some((b) => b.kind === 'chart')).toBe(true);
    expect(ret.ui?.some((b) => b.kind === 'table')).toBe(true);
  });

  it('list_household_members returns the seeded owner', async () => {
    const msg = await runText('list_household_members');
    expect(msg).toContain(MID);
    expect(msg).toContain('owner');
  });
});

describe('budget adviser — write + read tools', () => {
  it('add_expense records a real expense under the named category', async () => {
    const msg = await runText('add_expense', { title: 'Coffee', amount: 4.5, category: 'Dining' });
    expect(msg).toContain('Coffee');
    expect(msg).toContain('$4.50');

    const budget = new BudgetService(testEnv, testEnv.DB);
    const list = await budget.getExpenses(HID, UID, {});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Coffee', amount: 450, category_id: CAT_DINING });
  });

  it('add_expense rejects a missing/invalid amount without writing', async () => {
    const msg = await runText('add_expense', { title: 'Mystery' });
    expect(msg.toLowerCase()).toContain('amount');
    const budget = new BudgetService(testEnv, testEnv.DB);
    expect(await budget.getExpenses(HID, UID, {})).toHaveLength(0);
  });

  it('list_expenses returns rows with ids that edit/delete can use', async () => {
    await run('add_expense', { title: 'Milk', amount: 3, category: 'Groceries' });
    const listed = await runText('list_expenses', {});
    expect(listed).toContain('Milk');

    const budget = new BudgetService(testEnv, testEnv.DB);
    const [expense] = await budget.getExpenses(HID, UID, {});
    expect(listed).toContain(expense.id);

    const edited = await runText('edit_expense', { expense_id: expense.id, amount: 5.25 });
    expect(edited).toContain('$5.25');
    expect((await budget.getExpense(HID, expense.id, UID)).amount).toBe(525);

    const deleted = await runText('delete_expense', { expense_id: expense.id });
    expect(deleted).toContain('Milk');
    expect(await budget.getExpenses(HID, UID, {})).toHaveLength(0);
  });

  it('get_spending_breakdown groups the month by category with shares', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    const month = new Date().toISOString().slice(0, 7);
    const day = `${month}-15`;
    await budget.addExpense(HID, UID, { title: 'Veg', amount: 3000, expenseDate: day, categoryId: CAT_GROCERIES });
    await budget.addExpense(HID, UID, { title: 'Sushi', amount: 1000, expenseDate: day, categoryId: CAT_DINING });

    const breakdown = await runText('get_spending_breakdown', { month });
    expect(breakdown).toContain('Groceries');
    expect(breakdown).toContain('Dining');
    expect(breakdown).toContain('$40.00'); // total 30 + 10
    expect(breakdown).toContain('75%'); // groceries share
  });

  it('set_monthly_budget persists the planned budget for the month', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const [year, mo] = month.split('-').map((s) => parseInt(s, 10));
    const msg = await runText('set_monthly_budget', { amount: 600, month });
    expect(msg).toContain('$600.00');

    const budget = new BudgetService(testEnv, testEnv.DB);
    const overview = await budget.getMonthlyOverview(HID, UID, year, mo);
    expect(overview.plannedBudget).toBe(60000);
  });

  it('create_category adds a new category (and dedupes existing)', async () => {
    const created = await runText('create_category', { name: 'Travel' });
    expect(created).toContain('Travel');
    const dupe = await runText('create_category', { name: 'groceries' });
    expect(dupe.toLowerCase()).toContain('already');

    const budget = new BudgetService(testEnv, testEnv.DB);
    const cats = await budget.getCategories(HID, UID);
    expect(cats.some((c) => c.name === 'Travel')).toBe(true);
  });

  it('create_planned_spending adds a planned budget item', async () => {
    const msg = await runText('create_planned_spending', {
      title: 'New laptop',
      amount: 1200,
      category: 'Groceries',
      target_date: '2026-12-01',
    });
    expect(msg).toContain('New laptop');
    expect(msg).toContain('$1200.00');
  });

  it('buildContext yields household members plus current-month budget snapshot', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    const month = new Date().toISOString().slice(0, 7);
    await budget.addExpense(HID, UID, {
      title: 'Bread',
      amount: 500,
      expenseDate: `${month}-02`,
      categoryId: CAT_GROCERIES,
    });
    const snapshot = await BUDGET_CHAT_ASSISTANT.buildContext!(ctx());
    expect(snapshot).toBeTruthy();
    expect(snapshot).toContain('HOUSEHOLD MEMBERS');
    expect(snapshot).toContain('CURRENT BUDGET');
    expect(snapshot).toContain('Groceries');
  });
});
