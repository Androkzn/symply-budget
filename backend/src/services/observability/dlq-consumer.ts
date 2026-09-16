/**
 * DLQ consumer — Track B / RES-5.
 *
 * Drains `*-dlq` queues: persist a payload summary to D1, alert via
 * Sentry + console, then ack so Cloudflare does not delete the message
 * after the 4-day undrained retention window.
 */

import * as Sentry from '@sentry/cloudflare';
import { drizzle } from 'drizzle-orm/d1';

import { queueDlqRecords } from '../../db/schema-queue-ops';
import type { Env } from '../../types';
import { generateId } from '../../utils/id';

import { aihousekeeperMetric } from './aihousekeeper-metrics';

/** Max chars stored in payload_preview (full body may be large). */
const PREVIEW_MAX_CHARS = 2048;

/** Max chars in the one-line payload_summary JSON. */
const SUMMARY_MAX_CHARS = 512;

export type DlqCategory =
  | 'aihousekeeper_outbound'
  | 'garden_plan'
  | 'task_enrichment'
  | 'unknown';

export interface DlqPayloadSummary {
  keys: string[];
  householdId?: string;
  entityId?: string;
  entityKind?: string;
  enqueuedAt?: number;
}

/** True when the queue name is a dead-letter sink (ends with `-dlq`). */
export function isDlqQueueName(queueName: string): boolean {
  return queueName.endsWith('-dlq');
}

/** Map a concrete DLQ queue name to a stable category for metrics + scanner. */
export function classifyDlqQueue(queueName: string): DlqCategory {
  if (queueName.includes('task-enrichment')) return 'task_enrichment';
  if (queueName.includes('garden-plan')) return 'garden_plan';
  if (queueName.includes('aihousekeeper-outbound')) return 'aihousekeeper_outbound';
  return 'unknown';
}

/** Extract a compact summary from an arbitrary queue message body. */
export function summarizeDlqPayload(body: unknown): DlqPayloadSummary {
  if (body === null || body === undefined) {
    return { keys: [] };
  }
  if (typeof body !== 'object') {
    return { keys: [], entityKind: typeof body };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();

  const householdId =
    typeof record.householdId === 'string'
      ? record.householdId
      : typeof record.household_id === 'string'
        ? record.household_id
        : undefined;

  let entityId: string | undefined;
  let entityKind: string | undefined;
  for (const [field, kind] of [
    ['taskId', 'task'],
    ['gardenPlanId', 'garden_plan'],
    ['followupId', 'followup'],
    ['briefingId', 'briefing'],
    ['id', 'id'],
  ] as const) {
    const value = record[field];
    if (typeof value === 'string') {
      entityId = value;
      entityKind = kind;
      break;
    }
  }

  const enqueuedAt =
    typeof record.enqueuedAt === 'number' ? record.enqueuedAt : undefined;

  return { keys, householdId, entityId, entityKind, enqueuedAt };
}

function previewBody(body: unknown): string | undefined {
  try {
    const raw = JSON.stringify(body);
    if (raw.length <= PREVIEW_MAX_CHARS) return raw;
    return `${raw.slice(0, PREVIEW_MAX_CHARS)}…`;
  } catch {
    return String(body).slice(0, PREVIEW_MAX_CHARS);
  }
}

function summaryJson(summary: DlqPayloadSummary): string {
  const raw = JSON.stringify(summary);
  if (raw.length <= SUMMARY_MAX_CHARS) return raw;
  return `${raw.slice(0, SUMMARY_MAX_CHARS)}…`;
}

/**
 * Persist one drained DLQ message and emit observability signals.
 * Returns without throwing on persist failure — caller decides ack vs retry.
 */
export async function persistDlqMessage(
  env: Env,
  input: {
    sourceQueue: string;
    messageId: string | undefined;
    deliveryAttempts: number;
    body: unknown;
  }
): Promise<void> {
  const category = classifyDlqQueue(input.sourceQueue);
  const summary = summarizeDlqPayload(input.body);
  const id = generateId();

  const db = drizzle(env.DB);
  await db.insert(queueDlqRecords).values({
    id,
    source_queue: input.sourceQueue,
    dlq_category: category,
    message_id: input.messageId ?? null,
    delivery_attempts: input.deliveryAttempts,
    payload_summary: summaryJson(summary),
    payload_preview: previewBody(input.body) ?? null,
    household_id: summary.householdId ?? null,
    entity_id: summary.entityId ?? null,
  });

  console.error('[dlq-consumer] message drained', {
    id,
    sourceQueue: input.sourceQueue,
    category,
    deliveryAttempts: input.deliveryAttempts,
    householdId: summary.householdId?.slice(0, 8),
    entityId: summary.entityId?.slice(0, 8),
    entityKind: summary.entityKind,
    keys: summary.keys,
  });

  aihousekeeperMetric(env, 'aihousekeeper_dlq_length', 1, {
    source_queue: input.sourceQueue,
    category,
  });

  Sentry.captureMessage('Queue DLQ message drained', {
    level: 'warning',
    tags: {
      dlq_category: category,
      source_queue: input.sourceQueue,
    },
    extra: {
      recordId: id,
      deliveryAttempts: input.deliveryAttempts,
      summary,
    },
  });
}

/**
 * Process a batch from any `*-dlq` queue. Always acks after persist (or after
 * logging on terminal persist failure) so messages do not linger undrained.
 */
export async function handleDlqConsumerBatch(
  env: Env,
  batch: MessageBatch<unknown>
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await persistDlqMessage(env, {
        sourceQueue: batch.queue,
        messageId: msg.id,
        deliveryAttempts: msg.attempts,
        body: msg.body,
      });
      msg.ack();
    } catch (err) {
      console.error('[dlq-consumer] persist failed', {
        sourceQueue: batch.queue,
        messageId: msg.id,
        attempt: msg.attempts,
        error: (err as Error).message,
      });
      Sentry.captureException(err, {
        tags: { source_queue: batch.queue },
        extra: { messageId: msg.id, deliveryAttempts: msg.attempts },
      });
      // Terminal attempt: ack anyway — we logged + Sentry'd; don't block the DLQ.
      if (msg.attempts >= 3) {
        msg.ack();
        continue;
      }
      msg.retry({ delaySeconds: 30 });
    }
  }
}
