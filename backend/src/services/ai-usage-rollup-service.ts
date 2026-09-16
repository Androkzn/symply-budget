/**
 * Nightly rollup + retention sweep for AI usage telemetry.
 *
 * `ai_usage_events` gains a row per AI call and nothing ever removed them, so
 * the table grows without bound — on a D1 database shared by the whole fleet.
 * The rollup collapses each completed day into `ai_usage_daily` buckets, and the
 * sweep then deletes raw rows past the retention window.
 *
 * The sweep is deliberately conservative: it refuses to delete a day that has
 * not been rolled up, so a cron that has been failing for a week cannot destroy
 * the only copy of the data.
 */
import type { Env } from '../types';

/**
 * How long raw per-request rows are kept. Must stay >= `RAW_WINDOW_DAYS` in
 * routes/ai-usage.ts, which reads raw rows for recent days — if retention drops
 * below the read window, the gap silently reports as zero spend.
 */
export const RAW_RETENTION_DAYS = 120;

/** Days rolled up per run. Bounds D1 statement count on a backlog. */
const MAX_ROLLUP_DAYS_PER_RUN = 7;
/** Days swept per run, for the same reason. */
const MAX_SWEEP_DAYS_PER_RUN = 7;

export interface RollupResult {
  daysRolled: string[];
  daysSwept: string[];
  rowsDeleted: number;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDay(day: string, deltaDays: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return utcDay(d);
}

/**
 * Aggregate one completed UTC day of raw events into `ai_usage_daily`.
 *
 * Idempotent: re-running a day overwrites its buckets rather than adding to
 * them, so a retried cron tick cannot double the history.
 *
 * `household_id` is stored as '' rather than NULL for background rows, because
 * SQLite treats NULLs as distinct in a UNIQUE index — with NULL the conflict
 * target never matches and every run inserts duplicates instead of updating.
 */
export async function rollUpDay(env: Env, day: string): Promise<void> {
  const start = `${day} 00:00:00`;
  const end = `${shiftDay(day, 1)} 00:00:00`;

  await env.DB.prepare(
    `INSERT INTO ai_usage_daily (
       id, day, household_id, feature, provider, model,
       requests, error_requests,
       input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_tokens, total_tokens, cost_micro_usd
     )
     SELECT
       ? || '|' || COALESCE(household_id, '') || '|' || feature || '|' || provider || '|' || model,
       ?,
       COALESCE(household_id, ''),
       feature, provider, model,
       COUNT(*),
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),
       COALESCE(SUM(input_tokens), 0),
       COALESCE(SUM(output_tokens), 0),
       COALESCE(SUM(reasoning_tokens), 0),
       COALESCE(SUM(cache_read_tokens), 0),
       COALESCE(SUM(cache_write_tokens), 0),
       COALESCE(SUM(total_tokens), 0),
       COALESCE(SUM(cost_micro_usd), 0)
     FROM ai_usage_events
     WHERE created_at >= ? AND created_at < ?
     GROUP BY COALESCE(household_id, ''), feature, provider, model
     ON CONFLICT(day, household_id, feature, provider, model) DO UPDATE SET
       requests = excluded.requests,
       error_requests = excluded.error_requests,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       reasoning_tokens = excluded.reasoning_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       total_tokens = excluded.total_tokens,
       cost_micro_usd = excluded.cost_micro_usd`
  )
    .bind(day, day, start, end)
    .run();
}

/**
 * Roll up any completed day that has raw rows but no rollup buckets yet, newest
 * first, bounded per run. Catches up a backlog over several nights rather than
 * trying to do it in one tick.
 */
async function rollUpPendingDays(env: Env, today: string): Promise<string[]> {
  const pending = await env.DB.prepare(
    `SELECT DISTINCT date(e.created_at) AS day
     FROM ai_usage_events e
     WHERE date(e.created_at) < ?
       AND NOT EXISTS (SELECT 1 FROM ai_usage_daily d WHERE d.day = date(e.created_at))
     ORDER BY day DESC
     LIMIT ?`
  )
    .bind(today, MAX_ROLLUP_DAYS_PER_RUN)
    .all<{ day: string }>();

  const days = (pending.results ?? []).map((r) => r.day);
  for (const day of days) await rollUpDay(env, day);
  return days;
}

/**
 * Delete raw rows for days older than the retention window — but only days that
 * are present in `ai_usage_daily`. Without that guard, a rollup that has been
 * failing silently would let the sweep delete the only copy.
 */
async function sweepRolledUpDays(
  env: Env,
  cutoffDay: string
): Promise<{ daysSwept: string[]; rowsDeleted: number }> {
  const candidates = await env.DB.prepare(
    `SELECT DISTINCT date(e.created_at) AS day
     FROM ai_usage_events e
     WHERE date(e.created_at) < ?
       AND EXISTS (SELECT 1 FROM ai_usage_daily d WHERE d.day = date(e.created_at))
     ORDER BY day ASC
     LIMIT ?`
  )
    .bind(cutoffDay, MAX_SWEEP_DAYS_PER_RUN)
    .all<{ day: string }>();

  const daysSwept: string[] = [];
  let rowsDeleted = 0;
  for (const { day } of candidates.results ?? []) {
    const res = await env.DB.prepare(
      `DELETE FROM ai_usage_events WHERE created_at >= ? AND created_at < ?`
    )
      .bind(`${day} 00:00:00`, `${shiftDay(day, 1)} 00:00:00`)
      .run();
    rowsDeleted += res.meta?.changes ?? 0;
    daysSwept.push(day);
  }
  return { daysSwept, rowsDeleted };
}

/**
 * One nightly maintenance pass. Never throws — telemetry housekeeping must not
 * take down the cron tick that also delivers notifications.
 */
export async function runAiUsageRollup(env: Env, now: Date): Promise<RollupResult> {
  const today = utcDay(now);
  const cutoffDay = shiftDay(today, -RAW_RETENTION_DAYS);

  try {
    const daysRolled = await rollUpPendingDays(env, today);
    const { daysSwept, rowsDeleted } = await sweepRolledUpDays(env, cutoffDay);

    if (daysRolled.length || daysSwept.length) {
      console.log(
        `[ai-usage-rollup] rolled ${daysRolled.length} day(s), ` +
          `swept ${daysSwept.length} day(s) / ${rowsDeleted} raw row(s) older than ${cutoffDay}`
      );
    }
    return { daysRolled, daysSwept, rowsDeleted };
  } catch (err) {
    console.error('[ai-usage-rollup] failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { daysRolled: [], daysSwept: [], rowsDeleted: 0 };
  }
}
