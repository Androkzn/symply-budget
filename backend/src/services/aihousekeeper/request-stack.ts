import { createProviderAdapter } from '../../ai/provider-factory';
import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { usageRecorderFor } from '../ai-usage-service';
import { createDb } from '../db';

import { AihousekeeperEventBus } from './event-bus';
import { MemoryService } from './memory-service';
import { TrustLedgerService } from './trust-ledger-service';

export function getAihousekeeperDb(env: Env) {
  return createDb(env.DB);
}

export function buildAihousekeeperStack(
  env: Env,
  anthropicApiKey?: string,
  /**
   * Who this request is for. Every caller sits under a
   * `/households/:householdId/...` route, so passing it costs nothing and is
   * the difference between a usage row that shows up in the household's report
   * and one that is written and never seen.
   */
  usage?: { householdId?: string | null; userId?: string | null }
) {
  const db = getAihousekeeperDb(env);
  const events = new AihousekeeperEventBus();
  const ledger = new TrustLedgerService(db, events);
  const claude = createProviderAdapter({
    provider: 'anthropic',
    apiKey: anthropicApiKey ?? env.ANTHROPIC_API_KEY ?? '',
    options: {
      onUsage: usageRecorderFor(env, {
        feature: 'aihousekeeper',
        householdId: usage?.householdId ?? null,
        userId: usage?.userId ?? null,
      }),
    },
  });
  const memory = new MemoryService({
    db,
    d1: env.DB,
    ai: claude,
    events,
    env,
  });
  return { db, events, ledger, memory };
}

export { schema };
