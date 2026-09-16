/**
 * SmartNotificationGateway — Phase 1 pass-through behaviour.
 *
 * Covers (SmartNotifications BRD FR-1/FR-7, TRD §6–§8):
 *   - classifyLane: immediate types → A; optimizable → B; producer hint cannot
 *     downgrade a critical type.
 *   - enqueue delegates to the canonical delivery layer once per recipient,
 *     with copy/recipients untouched (pass-through parity).
 *   - immediate vs scheduled requests route to sendNotification vs
 *     scheduleNotification respectively.
 *   - a decision row is logged per recipient with lane + pass-through rule.
 *   - decision-logging failure NEVER blocks delivery (D-02 invariant).
 */

import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Env } from '../../types';
import {
  SmartNotificationGateway,
  classifyLane,
  type NotificationDelivery,
} from '../smart-notification-gateway';

const testEnv = env as unknown as Env;

const DECISION_DDL = `CREATE TABLE IF NOT EXISTS smart_notification_decision (
  id TEXT PRIMARY KEY,
  household_id TEXT,
  recipient_user_id TEXT NOT NULL,
  producer_type TEXT NOT NULL,
  lane TEXT NOT NULL,
  recipient_rule TEXT NOT NULL,
  copy_source TEXT NOT NULL DEFAULT 'template',
  batch_role TEXT NOT NULL DEFAULT 'single',
  reference_type TEXT,
  reference_id TEXT,
  outcome_ref TEXT,
  suppress_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/** Records every delegated call so we can assert pass-through fidelity. */
function makeFakeDelivery() {
  const calls: { method: string; options: Record<string, unknown> }[] = [];
  const delivery: NotificationDelivery = {
    sendNotification: vi.fn(async (options) => {
      calls.push({ method: 'send', options });
    }),
    scheduleNotification: vi.fn(async (options) => {
      calls.push({ method: 'schedule', options });
      return {};
    }),
  };
  return { delivery, calls };
}

async function decisionRows() {
  const res = await testEnv.DB.prepare(
    'SELECT * FROM smart_notification_decision ORDER BY created_at'
  ).all();
  return res.results as Record<string, unknown>[];
}

beforeEach(async () => {
  await testEnv.DB.exec(DECISION_DDL.replace(/\n/g, ' '));
  await testEnv.DB.prepare('DELETE FROM smart_notification_decision').run();
});

describe('classifyLane', () => {
  it('classifies immediate/critical types as Lane A', () => {
    expect(classifyLane('task_overdue')).toBe('A');
    expect(classifyLane('garbage_collection')).toBe('A');
    expect(classifyLane('critical_findings')).toBe('A');
    expect(classifyLane('report_ready')).toBe('A');
  });

  it('classifies timing-flexible types as Lane B', () => {
    expect(classifyLane('task_reminder')).toBe('B');
    expect(classifyLane('weekly_summary')).toBe('B');
    expect(classifyLane('maintenance_suggestions')).toBe('B');
  });

  it('honors a Lane A hint for an unknown type', () => {
    expect(classifyLane('some_new_type', 'A')).toBe('A');
    expect(classifyLane('some_new_type', 'B')).toBe('B');
    expect(classifyLane('some_new_type')).toBe('B');
  });

  it('never downgrades a known critical type even if hinted B', () => {
    expect(classifyLane('task_overdue', 'B')).toBe('A');
  });
});

describe('SmartNotificationGateway.enqueue (pass-through)', () => {
  it('delegates an immediate send once per recipient with copy untouched', async () => {
    const { delivery, calls } = makeFakeDelivery();
    const gateway = new SmartNotificationGateway(testEnv, testEnv.DB, delivery);

    const result = await gateway.enqueue({
      producerType: 'task_reminder',
      householdId: 'hh_1',
      recipients: ['u_a', 'u_b'],
      title: 'Task Due Soon',
      body: '"Clean gutters" is due in 3 days',
      data: { taskId: 't_1', screen: 'TaskDetail' },
      referenceType: 'maintenance_task',
      referenceId: 't_1',
    });

    expect(result.dispatched).toBe(2);
    expect(result.lane).toBe('B');
    expect(result.copySource).toBe('template');

    // One send per recipient, no scheduling.
    expect(delivery.sendNotification).toHaveBeenCalledTimes(2);
    expect(delivery.scheduleNotification).not.toHaveBeenCalled();

    // Copy + type + refs are forwarded verbatim (parity).
    expect(calls[0].options).toMatchObject({
      userId: 'u_a',
      type: 'task_reminder',
      title: 'Task Due Soon',
      body: '"Clean gutters" is due in 3 days',
      referenceId: 't_1',
    });
    expect(calls[1].options).toMatchObject({ userId: 'u_b', type: 'task_reminder' });
  });

  it('routes a scheduled request to scheduleNotification', async () => {
    const { delivery } = makeFakeDelivery();
    const gateway = new SmartNotificationGateway(testEnv, testEnv.DB, delivery);
    const when = new Date('2026-07-01T15:00:00.000Z');

    await gateway.enqueue({
      producerType: 'task_reminder',
      recipients: ['u_a'],
      title: 'T',
      body: 'B',
      scheduledFor: when,
    });

    expect(delivery.scheduleNotification).toHaveBeenCalledTimes(1);
    expect(delivery.sendNotification).not.toHaveBeenCalled();
    const arg = (delivery.scheduleNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.scheduledFor).toBe(when);
  });

  it('logs one decision row per recipient with lane and pass-through rule', async () => {
    const { delivery } = makeFakeDelivery();
    const gateway = new SmartNotificationGateway(testEnv, testEnv.DB, delivery);

    await gateway.enqueue({
      producerType: 'task_overdue',
      householdId: 'hh_1',
      recipients: ['u_a', 'u_b'],
      title: 'Overdue',
      body: 'Task is overdue',
      referenceType: 'maintenance_task',
      referenceId: 't_9',
    });

    const rows = await decisionRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.producer_type).toBe('task_overdue');
      expect(row.lane).toBe('A'); // overdue is immediate
      expect(row.recipient_rule).toBe('passthrough');
      expect(row.copy_source).toBe('template');
      expect(row.batch_role).toBe('single');
      expect(row.reference_id).toBe('t_9');
    }
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual(['u_a', 'u_b']);
  });

  it('still delivers when decision logging fails (delivery is never blocked)', async () => {
    const { delivery } = makeFakeDelivery();
    // Point the gateway at a D1 binding whose insert will fail: drop the table.
    await testEnv.DB.exec('DROP TABLE IF EXISTS smart_notification_decision');

    const gateway = new SmartNotificationGateway(testEnv, testEnv.DB, delivery);
    const result = await gateway.enqueue({
      producerType: 'task_reminder',
      recipients: ['u_a'],
      title: 'T',
      body: 'B',
    });

    // Logging failed, but the send went through.
    expect(result.dispatched).toBe(1);
    expect(delivery.sendNotification).toHaveBeenCalledTimes(1);
  });
});
