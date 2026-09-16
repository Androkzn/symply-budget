import { eq, and, lt } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { cronLeases } from '../db/schema-notifications';

/** Shorter than the 5-minute cron interval so overlapping ticks skip, not stack. */
export const CRON_LEASE_TTL_MS = 4 * 60 * 1000;

export function d1Changes(result: unknown): number {
  return (result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
}

/**
 * Acquire a singleton cron run lease in D1. Returns false when another holder
 * still holds a non-expired lease (preferred over KV — see clean-architecture B1).
 */
export async function tryAcquireCronLease(
  db: DrizzleD1Database,
  jobName: string,
  holder: string,
  ttlMs: number = CRON_LEASE_TTL_MS
): Promise<boolean> {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  const renewed = await db
    .update(cronLeases)
    .set({ holder, acquired_at: nowIso, expires_at: expiresAt })
    .where(and(eq(cronLeases.job_name, jobName), lt(cronLeases.expires_at, nowIso)))
    .run();
  if (d1Changes(renewed) === 1) return true;

  try {
    await db
      .insert(cronLeases)
      .values({
        job_name: jobName,
        holder,
        acquired_at: nowIso,
        expires_at: expiresAt,
      })
      .run();
    return true;
  } catch {
    const retry = await db
      .update(cronLeases)
      .set({ holder, acquired_at: nowIso, expires_at: expiresAt })
      .where(and(eq(cronLeases.job_name, jobName), lt(cronLeases.expires_at, nowIso)))
      .run();
    return d1Changes(retry) === 1;
  }
}

/** Best-effort early release so the next cron tick can run sooner. */
export async function releaseCronLease(
  db: DrizzleD1Database,
  jobName: string,
  holder: string
): Promise<void> {
  const expired = new Date(0).toISOString();
  await db
    .update(cronLeases)
    .set({ expires_at: expired })
    .where(and(eq(cronLeases.job_name, jobName), eq(cronLeases.holder, holder)))
    .run();
}
