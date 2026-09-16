import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

import type { Env } from '../../types';
import {
  isAiRateLimitDeny,
  isKvFlagTruthy,
  isNotificationsDeliveryPaused,
  isReportPipelinePaused,
  isTimestampBackfillEnabled,
  resetKillSwitchNotifyLatchForTests,
  shouldUseDoForAiRateLimit,
  TIMESTAMP_BACKFILL_ENABLED_KEY,
} from '../config-flags';

const testEnv = env as unknown as Env;

beforeEach(async () => {
  resetKillSwitchNotifyLatchForTests();
  await testEnv.CONFIG_KV.delete('notifications_delivery_paused');
  await testEnv.CONFIG_KV.delete('report_pipeline_paused');
  await testEnv.CONFIG_KV.delete('ai_rate_limit_deny');
  await testEnv.CONFIG_KV.delete(TIMESTAMP_BACKFILL_ENABLED_KEY);
});

describe('isKvFlagTruthy', () => {
  it('treats true and 1 as truthy', () => {
    expect(isKvFlagTruthy('true')).toBe(true);
    expect(isKvFlagTruthy('1')).toBe(true);
  });

  it('treats absent/false/other as not truthy', () => {
    expect(isKvFlagTruthy(null)).toBe(false);
    expect(isKvFlagTruthy('false')).toBe(false);
    expect(isKvFlagTruthy('0')).toBe(false);
    expect(isKvFlagTruthy('TRUE')).toBe(false);
    expect(isKvFlagTruthy('yes')).toBe(true);
  });
});

describe('B0 CONFIG_KV kill switches', () => {
  it('isNotificationsDeliveryPaused reads notifications_delivery_paused', async () => {
    expect(await isNotificationsDeliveryPaused(testEnv)).toBe(false);
    await testEnv.CONFIG_KV.put('notifications_delivery_paused', 'true');
    expect(await isNotificationsDeliveryPaused(testEnv)).toBe(true);
    await testEnv.CONFIG_KV.put('notifications_delivery_paused', '1');
    expect(await isNotificationsDeliveryPaused(testEnv)).toBe(true);
  });

  it('isReportPipelinePaused reads report_pipeline_paused', async () => {
    expect(await isReportPipelinePaused(testEnv)).toBe(false);
    await testEnv.CONFIG_KV.put('report_pipeline_paused', 'true');
    expect(await isReportPipelinePaused(testEnv)).toBe(true);
  });

  it('isAiRateLimitDeny reads ai_rate_limit_deny', async () => {
    expect(await isAiRateLimitDeny(testEnv)).toBe(false);
    await testEnv.CONFIG_KV.put('ai_rate_limit_deny', '1');
    expect(await isAiRateLimitDeny(testEnv)).toBe(true);
  });

  it('shouldUseDoForAiRateLimit always returns true after B3 cutover', () => {
    expect(shouldUseDoForAiRateLimit('false')).toBe(true);
    expect(shouldUseDoForAiRateLimit(null)).toBe(true);
  });
});

describe('B10 timestamp backfill CONFIG_KV gate', () => {
  it('isTimestampBackfillEnabled is false by default', async () => {
    expect(await isTimestampBackfillEnabled(testEnv)).toBe(false);
  });

  it('isTimestampBackfillEnabled reads timestamp_backfill_enabled', async () => {
    await testEnv.CONFIG_KV.put(TIMESTAMP_BACKFILL_ENABLED_KEY, 'true');
    expect(await isTimestampBackfillEnabled(testEnv)).toBe(true);
    await testEnv.CONFIG_KV.put(TIMESTAMP_BACKFILL_ENABLED_KEY, '1');
    expect(await isTimestampBackfillEnabled(testEnv)).toBe(true);
  });
});
