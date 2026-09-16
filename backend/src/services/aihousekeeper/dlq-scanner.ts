/**
 * DLQ scanner — plan §F1 / §B15, Track B / RES-5.
 *
 * Runs at minute-30 of every hour from the scheduled handler. Probes every
 * DLQ binding (including TASK_ENRICHMENT_DLQ), then reads recent drain
 * counts from `queue_dlq_records` as a depth proxy — Cloudflare Queues does
 * not expose binding-level depth to Workers yet.
 *
 * Emits `aihousekeeper_dlq_length` and logs a warning when any category
 * exceeds DLQ_DEPTH_FLOOR in the lookback window.
 */

import { count, gte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { queueDlqRecords } from '../../db/schema-queue-ops';
import type { Env } from '../../types';
import { nowIso } from '../../utils/id';
import { aihousekeeperMetric } from '../observability/aihousekeeper-metrics';
import { classifyDlqQueue, type DlqCategory } from '../observability/dlq-consumer';

/**
 * Floor above which we consider a DLQ "concerning" in the lookback window.
 */
const DLQ_DEPTH_FLOOR = 10;

/** How far back to count drained records when estimating DLQ pressure. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface DlqProbe {
  /** Human-readable binding name used in logs. */
  binding: string;
  /** Stable category aligned with dlq-consumer.classifyDlqQueue. */
  category: DlqCategory;
  /** Resolves the binding so a missing binding shows up as a scanner error. */
  resolve: (env: Env) => unknown;
}

const DLQ_PROBES: ReadonlyArray<DlqProbe> = [
  {
    binding: 'AIHOUSEKEEPER_OUTBOUND_DLQ',
    category: 'aihousekeeper_outbound',
    resolve: (env) => env.AIHOUSEKEEPER_OUTBOUND_DLQ,
  },
  {
    binding: 'GARDEN_PLAN_DLQ',
    category: 'garden_plan',
    resolve: (env) => env.GARDEN_PLAN_DLQ,
  },
  {
    binding: 'TASK_ENRICHMENT_DLQ',
    category: 'task_enrichment',
    resolve: (env) => env.TASK_ENRICHMENT_DLQ,
  },
];

async function recentDrainCountByCategory(
  env: Env,
  sinceIso: string
): Promise<Map<DlqCategory, number>> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({
      category: queueDlqRecords.dlq_category,
      total: count(),
    })
    .from(queueDlqRecords)
    .where(gte(queueDlqRecords.created_at, sinceIso))
    .groupBy(queueDlqRecords.dlq_category);

  const map = new Map<DlqCategory, number>();
  for (const row of rows) {
    map.set(row.category as DlqCategory, row.total);
  }
  return map;
}

export async function scanAndAlert(env: Env): Promise<void> {
  const ts = nowIso();
  const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();

  let drainCounts: Map<DlqCategory, number>;
  try {
    drainCounts = await recentDrainCountByCategory(env, sinceIso);
  } catch (err) {
    console.error('[dlq-scanner] drain count query failed', {
      error: (err as Error).message,
      ts,
    });
    drainCounts = new Map();
  }

  for (const probe of DLQ_PROBES) {
    try {
      const binding = probe.resolve(env);
      if (binding === undefined) {
        console.warn('[dlq-scanner] missing binding', {
          binding: probe.binding,
          ts,
        });
        continue;
      }

      const recentDrains = drainCounts.get(probe.category) ?? 0;
      aihousekeeperMetric(env, 'aihousekeeper_dlq_length', recentDrains, {
        binding: probe.binding,
        category: probe.category,
        window: '24h',
      });

      if (recentDrains >= DLQ_DEPTH_FLOOR) {
        console.warn('[dlq-scanner] DLQ pressure above floor', {
          binding: probe.binding,
          category: probe.category,
          recentDrains,
          floor: DLQ_DEPTH_FLOOR,
          window: '24h',
          ts,
        });
        continue;
      }

      console.log('[dlq-scanner] probe ok', {
        binding: probe.binding,
        category: probe.category,
        recentDrains,
        floor: DLQ_DEPTH_FLOOR,
        ts,
      });
    } catch (err) {
      console.error('[dlq-scanner] probe failed', {
        binding: probe.binding,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Exported as an object to match the plan's `dlqScanner.scanAndAlert(env)`
 * call shape in the scheduled handler.
 */
export const dlqScanner = {
  scanAndAlert,
};

/** @internal test hook */
export const _testing = {
  DLQ_DEPTH_FLOOR,
  DLQ_PROBES,
  classifyDlqQueue,
};
