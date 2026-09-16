/**
 * CONFIG_KV operational flags (not product feature flags in D1).
 */

import * as Sentry from '@sentry/cloudflare';

import type { Env } from '../types';

export const AI_RATE_LIMIT_DENY_KEY = 'ai_rate_limit_deny';
/** @deprecated B3: AI rate limits always use DO; flag ignored at runtime. */
export const AI_RATE_LIMIT_USE_DO_KEY = 'ai_rate_limit_use_do';
export const NOTIFICATIONS_DELIVERY_PAUSED_KEY = 'notifications_delivery_paused';
export const REPORT_PIPELINE_PAUSED_KEY = 'report_pipeline_paused';
/** B10: opt-in chunked ISO timestamp backfill (stub until table list approved).
 *
 * **Default: off** — cron never mutates rows unless this flag is explicitly set.
 *
 * Enable per environment (staging first, then production) — must use `--remote`:
 * ```bash
 * wrangler kv key put --binding CONFIG_KV --env staging --remote timestamp_backfill_enabled true
 * wrangler kv key put --binding CONFIG_KV --env production --remote timestamp_backfill_enabled true
 * ```
 *
 * When enabled, scheduled() runs one 100-row chunk every cron tick (every 5 min)
 * until approved tables complete (gated by the flag — default off).
 * Progress is tracked in D1 timestamp_backfill_checkpoints (migration 0101).
 * Approved tables: household_spaces, budget_items — see APPROVED_BACKFILL_TABLES.
 *
 * Disable: wrangler kv key delete --binding CONFIG_KV --env <env> --remote timestamp_backfill_enabled
 */
export const TIMESTAMP_BACKFILL_ENABLED_KEY = 'timestamp_backfill_enabled';

/** Truthy when KV value is 'true', '1', or 'yes' (case-sensitive). */
export function isTruthyKvFlag(value: string | null | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

/** Alias used by B0 kill-switch helpers and tests. */
export const isKvFlagTruthy = isTruthyKvFlag;

/**
 * @deprecated B3 cutover complete — AI routes always use RATE_LIMITER DO.
 * Kept for CONFIG_KV cleanup / tests; always returns true.
 */
export function shouldUseDoForAiRateLimit(_value: string | null | undefined): boolean {
  return true;
}

const notifiedKillSwitches = new Set<string>();

/** Test helper — reset once-per-isolate kill-switch Sentry latch. */
export function resetKillSwitchNotifyLatchForTests(): void {
  notifiedKillSwitches.clear();
}

/**
 * B0: emit one Sentry warning + console warn per isolate when a kill switch is active.
 */
export function notifyKillSwitchActive(env: Env, key: string): void {
  if (notifiedKillSwitches.has(key)) return;
  notifiedKillSwitches.add(key);
  console.warn(`[B0] CONFIG_KV kill switch active: ${key}`);
  try {
    Sentry.captureMessage('CONFIG_KV kill switch active', {
      level: 'warning',
      tags: {
        kill_switch: key,
        brand: env.JWT_ISSUER ?? 'unknown',
      },
    });
  } catch {
    // Sentry may be unset outside withSentry — console warn above is enough.
  }
}

async function readKvFlag(env: Env, key: string): Promise<boolean> {
  const value = await env.CONFIG_KV.get(key);
  return isKvFlagTruthy(value);
}

/** B0: skip scheduled notification delivery when CONFIG_KV flag is set. */
export async function isNotificationsDeliveryPaused(env: Env): Promise<boolean> {
  const paused = await readKvFlag(env, NOTIFICATIONS_DELIVERY_PAUSED_KEY);
  if (paused) notifyKillSwitchActive(env, NOTIFICATIONS_DELIVERY_PAUSED_KEY);
  return paused;
}

/** B0: pause report pipeline when CONFIG_KV flag is set. */
export async function isReportPipelinePaused(env: Env): Promise<boolean> {
  const paused = await readKvFlag(env, REPORT_PIPELINE_PAUSED_KEY);
  if (paused) notifyKillSwitchActive(env, REPORT_PIPELINE_PAUSED_KEY);
  return paused;
}

/** B0: deny AI when CONFIG_KV flag is set (fail-closed at rate-limit middleware). */
export async function isAiRateLimitDeny(env: Env): Promise<boolean> {
  const denied = await readKvFlag(env, AI_RATE_LIMIT_DENY_KEY);
  if (denied) notifyKillSwitchActive(env, AI_RATE_LIMIT_DENY_KEY);
  return denied;
}

/** B10: run timestamp backfill cron chunk when explicitly enabled in CONFIG_KV (default off). */
export async function isTimestampBackfillEnabled(env: Env): Promise<boolean> {
  return readKvFlag(env, TIMESTAMP_BACKFILL_ENABLED_KEY);
}
