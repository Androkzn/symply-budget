/**
 * BudgetAlertWorker — the (currently dormant) Smart Budget background worker.
 * Exercised against a real D1 so the branch logic is verified before cron is
 * re-enabled:
 *   - checkOverBudgetAlerts: no-cap skip, healthy skip, "approaching" vs "over"
 *     copy, per-month dedup
 *   - sendWeeklyDigests: AI summary fan-out, no-cap skip
 *   - sendWeeklyEncouragements: only genuine wins (isPositive) get pushed
 *
 * NotificationService.sendNotification is spied (no push/network), and the two
 * AI-backed services are stubbed where used so the tests stay deterministic.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import { budgetGoals, expenses } from '../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import { BudgetEncouragementService } from '../../services/budget-encouragement';
import { BudgetInsightsService } from '../../services/budget-insights-service';
import { NotificationService } from '../../services/notification-service';
import type { Env } from '../../types';
import { BudgetAlertWorker } from '../budget-alert-worker';

const testEnv = env as unknown as Env;

const HID = 'hh_budget_alert_01';
const UID = 'u_budget_alert_owner';
const MID = 'm_budget_alert_owner';

const NOW = new Date('2026-06-15T12:00:00Z'); // year 2026, month 6

let sendSpy: ReturnType<typeof vi.spyOn>;

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await testEnv.DB.exec(
    "CREATE TABLE IF NOT EXISTS notification_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data TEXT, sent_at TEXT NOT NULL, read_at TEXT, clicked_at TEXT, reference_type TEXT, reference_id TEXT)",
  );
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);
  await testEnv.DB.exec('DELETE FROM notification_history');

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'budget-alert@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'BudgetAlertTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

async function setGoal(planned: number | null): Promise<void> {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(budgetGoals).values({
    id: `g_${HID}`,
    household_id: HID,
    year: 2026,
    month: 6,
    planned_budget: planned,
  });
}

async function addExpense(amount: number): Promise<void> {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(expenses).values({
    id: `e_${amount}`,
    household_id: HID,
    title: 'Groceries',
    amount,
    expense_date: '2026-06-12',
    created_by: UID,
  });
}

function mkWorker() {
  return new BudgetAlertWorker(testEnv, testEnv.DB);
}

beforeEach(async () => {
  await seed();
  sendSpy = vi.spyOn(NotificationService.prototype, 'sendNotification').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkOverBudgetAlerts', () => {
  it('sends an "approaching" alert when remaining is under 10% of the cap', async () => {
    await setGoal(100000);
    await addExpense(95000); // remaining 5000 (< 10% of 100000), still >= 0

    const result = await mkWorker().checkOverBudgetAlerts(NOW);

    expect(result).toEqual({ checked: 1, alertsSent: 1 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0][0] as { type: string; userId: string; title: string };
    expect(arg.type).toBe('budget_alert');
    expect(arg.userId).toBe(UID);
    expect(arg.title).toContain('Approaching');
  });

  it('sends an "over budget" alert when the balance goes negative', async () => {
    await setGoal(100000);
    await addExpense(120000); // remaining -20000

    const result = await mkWorker().checkOverBudgetAlerts(NOW);

    expect(result.alertsSent).toBe(1);
    const arg = sendSpy.mock.calls[0][0] as { title: string };
    expect(arg.title).toContain('Over');
  });

  it('skips households with no budget cap set', async () => {
    await setGoal(null);

    const result = await mkWorker().checkOverBudgetAlerts(NOW);

    expect(result).toEqual({ checked: 0, alertsSent: 0 });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('checks but does not alert a healthy household', async () => {
    await setGoal(100000); // no expenses → remaining 100000, well above 10%

    const result = await mkWorker().checkOverBudgetAlerts(NOW);

    expect(result).toEqual({ checked: 1, alertsSent: 0 });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('dedupes: no second alert once one was sent this month', async () => {
    await setGoal(100000);
    await addExpense(95000);
    await testEnv.DB.prepare(
      'INSERT INTO notification_history (id, user_id, type, title, body, data, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind('nh_1', UID, 'budget_alert', 'x', 'y', `{"householdId":"${HID}"}`, '2026-06-10T00:00:00Z')
      .run();

    const result = await mkWorker().checkOverBudgetAlerts(NOW);

    expect(result.alertsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('sendWeeklyDigests', () => {
  it('fans an AI summary out to every member when a cap is set', async () => {
    await setGoal(100000);
    vi.spyOn(BudgetInsightsService.prototype, 'getInsights').mockResolvedValue({
      summary: 'You saved $50 this week.',
      alerts: [],
      recommendations: [],
      projected_month_end_balance: 5000,
      generatedAt: NOW.toISOString(),
      cached: false,
    } as unknown as Awaited<ReturnType<BudgetInsightsService['getInsights']>>);

    const sent = await mkWorker().sendWeeklyDigests(NOW);

    expect(sent).toBe(1);
    const arg = sendSpy.mock.calls[0][0] as { type: string; body: string };
    expect(arg.type).toBe('budget_digest');
    expect(arg.body).toBe('You saved $50 this week.');
  });

  it('skips households with no cap set', async () => {
    await setGoal(null);
    const insightsSpy = vi.spyOn(BudgetInsightsService.prototype, 'getInsights');

    const sent = await mkWorker().sendWeeklyDigests(NOW);

    expect(sent).toBe(0);
    expect(insightsSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('sendWeeklyEncouragements', () => {
  it('pushes only genuine wins (isPositive) with the highlight appended', async () => {
    vi.spyOn(BudgetEncouragementService.prototype, 'getEncouragement').mockResolvedValue({
      isPositive: true,
      emoji: '🎉',
      headline: 'Nice work!',
      message: 'Under budget again',
      highlight: '3-week streak',
    } as unknown as Awaited<ReturnType<BudgetEncouragementService['getEncouragement']>>);

    const sent = await mkWorker().sendWeeklyEncouragements(NOW);

    expect(sent).toBe(1);
    const arg = sendSpy.mock.calls[0][0] as { type: string; title: string; body: string };
    expect(arg.type).toBe('budget_encouragement');
    expect(arg.title).toContain('Nice work!');
    expect(arg.body).toBe('Under budget again (3-week streak)');
  });

  it('stays silent when the week is not a genuine win', async () => {
    vi.spyOn(BudgetEncouragementService.prototype, 'getEncouragement').mockResolvedValue({
      isPositive: false,
      emoji: '📊',
      headline: 'On track',
      message: 'Steady as she goes',
      highlight: null,
    } as unknown as Awaited<ReturnType<BudgetEncouragementService['getEncouragement']>>);

    const sent = await mkWorker().sendWeeklyEncouragements(NOW);

    expect(sent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
