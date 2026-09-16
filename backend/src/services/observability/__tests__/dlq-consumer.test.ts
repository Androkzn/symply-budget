/**
 * dlq-consumer.ts — Track B / RES-5
 */

import { env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

import type { Env } from '../../../types';
import {
  classifyDlqQueue,
  handleDlqConsumerBatch,
  isDlqQueueName,
  persistDlqMessage,
  summarizeDlqPayload,
} from '../dlq-consumer';

const testEnv = env as unknown as Env;

beforeAll(async () => {
  await testEnv.DB.prepare(
    `CREATE TABLE IF NOT EXISTS queue_dlq_records (
      id TEXT PRIMARY KEY,
      source_queue TEXT NOT NULL,
      dlq_category TEXT NOT NULL,
      message_id TEXT,
      delivery_attempts INTEGER NOT NULL DEFAULT 1,
      payload_summary TEXT NOT NULL,
      payload_preview TEXT,
      household_id TEXT,
      entity_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dlq-consumer helpers', () => {
  it('isDlqQueueName matches *-dlq suffix only', () => {
    expect(isDlqQueueName('task-enrichment-dlq')).toBe(true);
    expect(isDlqQueueName('simple-budget-garden-plan-dlq')).toBe(true);
    expect(isDlqQueueName('task-enrichment')).toBe(false);
    expect(isDlqQueueName('garden-plan-generation-staging')).toBe(false);
  });

  it('classifyDlqQueue maps brand-prefixed queue names', () => {
    expect(classifyDlqQueue('symply-kaizen-task-enrichment-dlq')).toBe('task_enrichment');
    expect(classifyDlqQueue('garden-plan-generation-staging-dlq')).toBe('garden_plan');
    expect(classifyDlqQueue('aihousekeeper-outbound-dlq')).toBe('aihousekeeper_outbound');
    expect(classifyDlqQueue('other-dlq')).toBe('unknown');
  });

  it('summarizeDlqPayload extracts task and household ids', () => {
    const summary = summarizeDlqPayload({
      taskId: 'task-abc',
      householdId: 'hh-123',
      enqueuedAt: 1_700_000_000_000,
      extra: true,
    });
    expect(summary.entityId).toBe('task-abc');
    expect(summary.entityKind).toBe('task');
    expect(summary.householdId).toBe('hh-123');
    expect(summary.keys).toContain('taskId');
  });
});

describe('handleDlqConsumerBatch', () => {
  it('acks messages after persist', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const batch = {
      queue: 'task-enrichment-staging-dlq',
      messages: [
        {
          id: 'msg-1',
          attempts: 4,
          body: { taskId: 't1', householdId: 'h1' },
          ack,
          retry,
        },
      ],
    } as unknown as MessageBatch<unknown>;

    await handleDlqConsumerBatch(testEnv, batch);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('persistDlqMessage', () => {
  it('writes without throwing for a minimal body', async () => {
    await expect(
      persistDlqMessage(testEnv, {
        sourceQueue: 'task-enrichment-dlq',
        messageId: 'mid-1',
        deliveryAttempts: 4,
        body: { taskId: 'abc', householdId: 'def' },
      })
    ).resolves.toBeUndefined();
  });
});
