/**
 * SpendTopicAnalysis — classifies expense titles into a topic (e.g. "vegetables")
 * over a month window and produces the numbers + chat UI blocks the assistant
 * relays. This guards the *content* of that response: which expenses match,
 * how products rank, the shares, and the chart/table/stats/insight it attaches.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../db/schema';
import { budgetCategories } from '../../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../../types';
import { createCoreTables, resetAllTables } from '../../aihousekeeper/__tests__/test-helpers';
import { BudgetService } from '../../budget-service';
import {
  SpendTopicAnalysis,
  lexiconForTopic,
  titleMatchesTopic,
  type SpendTopicAnalysisResult,
} from '../spend/spend-topic-analysis';

const testEnv = env as unknown as Env;
const HID = 'hh_topic_an';
const UID = 'u_topic_an';
const MID = 'm_topic_an';
const CAT = 'cat_topic_groceries';
const NOW = '2026-07-22T12:00:00Z';

async function seedExpense(
  budget: BudgetService,
  title: string,
  amount: number,
  expenseDate: string
) {
  await budget.addExpense(HID, UID, { title, amount, expenseDate, categoryId: CAT });
}

beforeEach(async () => {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'topic@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'Topic House' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
  await db.insert(budgetCategories).values([{ id: CAT, household_id: HID, name: 'Groceries' }]);
});

describe('lexiconForTopic', () => {
  it('expands known topics to their curated token list', () => {
    expect(lexiconForTopic('vegetables')).toContain('tomato');
    expect(lexiconForTopic('Vegetables')).toContain('cucumber'); // case-insensitive
    expect(lexiconForTopic('coffee')).toContain('starbucks');
    expect(lexiconForTopic('gas')).toContain('fuel');
  });

  it('falls back to splitting an unknown phrase into ≥3-char tokens', () => {
    expect(lexiconForTopic('electric bike')).toEqual(['electric', 'bike']);
    expect(lexiconForTopic('toy car go')).toEqual(['toy', 'car']); // 'go' (<3 chars) dropped
    expect(lexiconForTopic('a to it')).toEqual([]); // all tokens <3 chars
  });
});

describe('titleMatchesTopic', () => {
  it('returns the capitalized matched token, or null', () => {
    expect(titleMatchesTopic('Roma Tomatoes', ['tomato'])).toBe('Tomato');
    expect(titleMatchesTopic('Organic Cucumber', ['cucumber'])).toBe('Cucumber');
    expect(titleMatchesTopic('Ribeye Steak', ['tomato', 'cucumber'])).toBeNull();
  });

  it('returns the first token that matches, in lexicon order', () => {
    // 'cucumber' precedes 'salad' in the vegetables lexicon.
    expect(titleMatchesTopic('Cucumber Salad', lexiconForTopic('vegetables'))).toBe('Cucumber');
  });
});

describe('SpendTopicAnalysis.analyze', () => {
  it('classifies, merges by product, ranks by total, and reports shares', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    // Two tomato lines (merge into one product), one cucumber, one non-veg (ignored).
    await seedExpense(budget, 'Roma Tomatoes', 500, '2026-06-05');
    await seedExpense(budget, 'Tomatoes', 300, '2026-07-10');
    await seedExpense(budget, 'Cucumber Salad', 400, '2026-07-11');
    await seedExpense(budget, 'Ribeye Steak', 2500, '2026-07-12');

    const analysis = new SpendTopicAnalysis(testEnv, testEnv.DB);
    const result = (await analysis.analyze(HID, UID, {
      topic: 'vegetables',
      month: '2026-07',
      months: 12,
      nowIso: NOW,
    })) as SpendTopicAnalysisResult;

    expect('empty' in result).toBe(false);
    expect(result.matchedCount).toBe(3); // steak excluded
    expect(result.totalCents).toBe(1200);
    // Ranked by total desc: Tomato (500+300) then Cucumber (400).
    expect(result.ranked.map((p) => p.name)).toEqual(['Tomato', 'Cucumber']);
    expect(result.ranked[0].totalCents).toBe(800);

    // Stats block carries the topic total and matching-expense count.
    const stats = result.ui.find((b) => b.kind === 'stats');
    expect(stats).toBeTruthy();
    if (stats?.kind === 'stats') {
      const total = stats.stats.find((s) => s.label === 'Topic total');
      expect(total?.value).toBe('$12.00');
      const products = stats.stats.find((s) => s.label === 'Products');
      expect(products?.value).toBe('2');
      expect(products?.caption).toContain('3 matching');
    }

    // Table shares must sum sensibly (Tomato 67%, Cucumber 33%).
    const table = result.ui.find((b) => b.kind === 'table');
    if (table?.kind === 'table') {
      const tomatoRow = table.table.rows.find((r) => r[0] === 'Tomato');
      expect(tomatoRow?.[1]).toBe('$8.00');
      expect(tomatoRow?.[2]).toBe('67%');
    }

    // A >6-month window renders a line chart (bar only for short windows).
    const chart = result.ui.find((b) => b.kind === 'chart');
    if (chart?.kind === 'chart') {
      expect(chart.chart.type).toBe('line');
      expect(chart.chart.valueFormat).toBe('currency');
    }

    // Insight names the top item.
    const insight = result.ui.find((b) => b.kind === 'insight');
    if (insight?.kind === 'insight') {
      expect(insight.insight.body).toContain('Tomato');
    }
  });

  it('renders a bar chart for a short (≤6 month) window', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    await seedExpense(budget, 'Tomatoes', 500, '2026-07-10');
    const analysis = new SpendTopicAnalysis(testEnv, testEnv.DB);
    const result = (await analysis.analyze(HID, UID, {
      topic: 'vegetables',
      month: '2026-07',
      months: 3,
      nowIso: NOW,
    })) as SpendTopicAnalysisResult;
    const chart = result.ui.find((b) => b.kind === 'chart');
    if (chart?.kind === 'chart') expect(chart.chart.type).toBe('bar');
  });

  it('excludes expenses outside the month window', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    await seedExpense(budget, 'Tomatoes', 500, '2026-07-10'); // in window
    await seedExpense(budget, 'Tomatoes', 900, '2024-01-10'); // far outside 12-mo window
    const analysis = new SpendTopicAnalysis(testEnv, testEnv.DB);
    const result = (await analysis.analyze(HID, UID, {
      topic: 'vegetables',
      month: '2026-07',
      months: 12,
      nowIso: NOW,
    })) as SpendTopicAnalysisResult;
    expect(result.matchedCount).toBe(1);
    expect(result.totalCents).toBe(500);
  });

  it('returns a helpful empty result when nothing matches the topic', async () => {
    const budget = new BudgetService(testEnv, testEnv.DB);
    await seedExpense(budget, 'Ribeye Steak', 2500, '2026-07-12');
    const analysis = new SpendTopicAnalysis(testEnv, testEnv.DB);
    const result = await analysis.analyze(HID, UID, {
      topic: 'electronics',
      month: '2026-07',
      nowIso: NOW,
    });
    expect('empty' in result).toBe(true);
    if ('empty' in result) {
      expect(result.message).toContain('electronics');
      expect(result.message.toLowerCase()).toContain('no expenses matched');
    }
  });

  it('rejects a blank topic', async () => {
    const analysis = new SpendTopicAnalysis(testEnv, testEnv.DB);
    const result = await analysis.analyze(HID, UID, { topic: '   ', nowIso: NOW });
    expect('empty' in result).toBe(true);
    if ('empty' in result) expect(result.message).toContain('needs a topic');
  });
});
