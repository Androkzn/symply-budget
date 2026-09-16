/**
 * Per-household daily cap on AI garden site plan generations.
 *
 * Each approved generation bumps a daily counter in CONFIG_KV. When
 * the cap is reached we refuse new requests so a single household can't
 * spike OpenAI image-generation spend (~$0.04 per image at standard quality).
 *
 * The TTL is set to ~36h so the counter naturally clears the day after the
 * last bump without needing an external sweeper.
 *
 * Concurrency model:
 *   - KV is eventually consistent and there is no atomic CAS, so two
 *     near-simultaneous `checkAndIncrement` calls can both pass the cap
 *     check by ±1. Acceptable cost overrun.
 *   - Refunds are best-effort and gated by the caller (the queue handler
 *     only refunds if the approval row was still in `'approved'`) so a
 *     re-delivery of a terminal-failure path can't double-refund a slot
 *     and pad the cap with phantom usage.
 *   - The async queue handler runs in a different invocation than the
 *     producer; if a refund races a new increment from another approval,
 *     the refund may briefly under-count. That self-corrects on the next
 *     midnight TTL clear.
 */
import type { Env } from '../../types';

/** Daily cap per household. Tune via the GARDEN_PLAN_DAILY_CAP env override if needed. */
export const DEFAULT_GARDEN_PLAN_DAILY_CAP = 5;

/** TTL: long enough to span any user's local "day" boundary. */
const COUNTER_TTL_SECONDS = 36 * 60 * 60;

/** Today's UTC date (YYYY-MM-DD). Tests can pass a fixed Date. */
function utcDateString(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function counterKey(householdId: string, date = utcDateString()): string {
  return `garden_plan_count:${householdId}:${date}`;
}

export interface GardenPlanRateLimitResult {
  allowed: boolean;
  used: number;
  cap: number;
  /** When the counter resets (start of next UTC day). */
  resetsAt: string;
}

function nextUtcReset(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Read the current counter without consuming a slot. Use this before parking
 * an approval so abandoned/cancelled approvals do not count as paid usage.
 */
export async function getGardenPlanCount(
  env: Pick<Env, 'CONFIG_KV'>,
  householdId: string,
  capOverride?: number
): Promise<GardenPlanRateLimitResult> {
  const cap = Math.max(1, capOverride ?? DEFAULT_GARDEN_PLAN_DAILY_CAP);
  const key = counterKey(householdId);
  const raw = await env.CONFIG_KV.get(key);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  return {
    allowed: current < cap,
    used: current,
    cap,
    resetsAt: nextUtcReset(),
  };
}

/**
 * Returns whether another generation is allowed for `householdId` today and,
 * if so, atomically(-ish) increments the counter so the next caller sees it.
 *
 * Note: KV is eventually consistent, so two near-simultaneous calls can both
 * see the same `current` value and both succeed. That's acceptable for a
 * cost-cap — at worst we let one extra image through per household per day.
 */
export async function checkAndIncrementGardenPlanCount(
  env: Pick<Env, 'CONFIG_KV'>,
  householdId: string,
  capOverride?: number
): Promise<GardenPlanRateLimitResult> {
  const cap = Math.max(1, capOverride ?? DEFAULT_GARDEN_PLAN_DAILY_CAP);
  const key = counterKey(householdId);
  const raw = await env.CONFIG_KV.get(key);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const resetsAt = nextUtcReset();

  if (current >= cap) {
    return { allowed: false, used: current, cap, resetsAt };
  }
  await env.CONFIG_KV.put(key, String(current + 1), {
    expirationTtl: COUNTER_TTL_SECONDS,
  });
  return { allowed: true, used: current + 1, cap, resetsAt };
}

/**
 * Best-effort refund — used when execution fails after we've already
 * incremented (e.g. OpenAI returned 5xx). Never throws.
 */
export async function refundGardenPlanCount(
  env: Pick<Env, 'CONFIG_KV'>,
  householdId: string
): Promise<void> {
  try {
    const key = counterKey(householdId);
    const raw = await env.CONFIG_KV.get(key);
    const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
    if (current <= 0) return;
    await env.CONFIG_KV.put(key, String(current - 1), {
      expirationTtl: COUNTER_TTL_SECONDS,
    });
  } catch {
    // refund is best-effort; do not surface KV errors
  }
}
