/**
 * FTS5 memory-recall perf benchmark — plan §15 Definition of Done:
 *   "FTS5 memory recall p95 < 200ms at 500 memories."
 *
 * Seeds 500 memories with varied content, runs `recall()` 50 times over a
 * mix of queries, and asserts p95 under the plan's 200ms target. Tagged
 * with the .perf.test.ts suffix so CI can opt to skip if runtime-gated.
 *
 * NOTE: miniflare runs D1 against a local sqlite file; production D1 is a
 * distributed service with different latency characteristics. This bench
 * catches catastrophic query regressions (indexes dropped, scoring pass
 * going O(n²), etc.) but is not a substitute for production profiling.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeAll } from 'vitest';

import { ClaudeProvider } from '../../../ai/claude-provider';
import * as schema from '../../../db/schema';
import type { Env } from '../../../types';
import { AihousekeeperEventBus } from '../event-bus';
import { MemoryService } from '../memory-service';

import {
  createAihousekeeperTables,
  createCoreTables,
  createMemoryFtsTable,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_perf_01';
const N_MEMORIES = 500;
const N_QUERIES = 50;
const P95_TARGET_MS = 200;

const SAMPLE_PHRASES = [
  'changed HVAC filter every quarter',
  'water leak under kitchen sink Fall 2025',
  'roof inspection due Fall 2026',
  'property tax increase',
  'contractor Jake handles electrical',
  'smoke detector batteries replaced',
  'snow shoveling vendor',
  'dishwasher needs repair',
  'garage door spring replaced',
  'gutter cleaning schedule',
  'window seal issue master bedroom',
  'lawn care contract renewal',
  'septic pump scheduled',
  'air quality filter replaced',
  'boiler maintenance appointment',
];

function buildBody(i: number): string {
  const phrase = SAMPLE_PHRASES[i % SAMPLE_PHRASES.length];
  return `${phrase}; seeded fact #${i} for household ${HID}.`;
}

async function seedMemories(
  memory: MemoryService,
  n: number
): Promise<void> {
  // Write() is idempotent-ish; serialize to keep miniflare happy. Eviction
  // only kicks in past 500 so at exactly N_MEMORIES we expect count == 500.
  for (let i = 0; i < n; i++) {
    await memory.write({
      householdId: HID,
      type: i % 5 === 0 ? 'fact' : 'preference',
      body: buildBody(i),
      confidence: 0.6 + (i % 4) * 0.1,
      source: 'inferred',
    });
  }
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

describe('MemoryService.recall FTS5 perf @500', () => {
  /* Skipped by default — this bench seeds 500 rows and is slower than a unit
   * test. Run manually with:
   *   npx vitest run --no-file-parallelism src/services/aihousekeeper/__tests__/memory-service.perf.test.ts -t '@500'
   * Remove the .skip on the describe when profiling.
   */

  beforeAll(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await createMemoryFtsTable(testEnv.DB);
    await resetAllTables(testEnv.DB);
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.households).values({ id: HID, name: 'Perf' });
    await db.insert(schema.assistantIdentity).values({ household_id: HID });
    await testEnv.CONFIG_KV.put(
      'aihousekeeper_memory_ai_redaction_enabled',
      'false'
    );

    const provider = new ClaudeProvider(testEnv.ANTHROPIC_API_KEY ?? '');
    const bus = new AihousekeeperEventBus();
    const memory = new MemoryService({
      db: drizzle(testEnv.DB, { schema }) as unknown as ConstructorParameters<
        typeof MemoryService
      >[0]['db'],
      d1: testEnv.DB,
      ai: provider,
      events: bus,
      env: testEnv,
    });
    await seedMemories(memory, N_MEMORIES);
  }, 120_000);

  it(`recall() p95 < ${P95_TARGET_MS}ms at ${N_MEMORIES} memories (sampling ${N_QUERIES})`, async () => {
    const provider = new ClaudeProvider(testEnv.ANTHROPIC_API_KEY ?? '');
    const bus = new AihousekeeperEventBus();
    const memory = new MemoryService({
      db: drizzle(testEnv.DB, { schema }) as unknown as ConstructorParameters<
        typeof MemoryService
      >[0]['db'],
      d1: testEnv.DB,
      ai: provider,
      events: bus,
      env: testEnv,
    });

    const samples: number[] = [];
    for (let i = 0; i < N_QUERIES; i++) {
      const q = SAMPLE_PHRASES[i % SAMPLE_PHRASES.length]
        .split(' ')
        .slice(0, 2)
        .join(' ');
      const started = performance.now();
      await memory.recall(HID, q, 8);
      const elapsed = performance.now() - started;
      samples.push(elapsed);
    }

    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    const max = Math.max(...samples);

    // Emit a structured line ops can tail; keep a small float format.
    console.log(
      `[AIHOUSEKEEPER_METRIC aihousekeeper_memory_recall_p95_latency_ms] ${JSON.stringify({
        n_memories: N_MEMORIES,
        n_queries: N_QUERIES,
        p50_ms: Number(p50.toFixed(1)),
        p95_ms: Number(p95.toFixed(1)),
        p99_ms: Number(p99.toFixed(1)),
        max_ms: Number(max.toFixed(1)),
      })}`
    );

    expect(p95).toBeLessThan(P95_TARGET_MS);
  }, 120_000);
});
