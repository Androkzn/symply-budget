/**
 * garden-plan-rate-limit.ts — daily cap on AI garden plan generations.
 *
 * Verifies:
 *   - First call within a day is allowed and increments the counter.
 *   - Once `cap` is reached, subsequent calls are denied without bumping.
 *   - Cap override is honored.
 *   - `refundGardenPlanCount` decrements without going negative.
 *   - Counter is per-household (one household's spend doesn't affect another).
 */

import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

import type { Env } from '../../../types';
import {
  DEFAULT_GARDEN_PLAN_DAILY_CAP,
  checkAndIncrementGardenPlanCount,
  getGardenPlanCount,
  refundGardenPlanCount,
} from '../garden-plan-rate-limit';

const testEnv = env as unknown as Env;

async function clearCounter(householdId: string): Promise<void> {
  const key = `garden_plan_count:${householdId}:${new Date()
    .toISOString()
    .slice(0, 10)}`;
  await testEnv.CONFIG_KV.delete(key);
}

describe('garden-plan-rate-limit', () => {
  const HID_A = 'hh_rate_a';
  const HID_B = 'hh_rate_b';

  beforeEach(async () => {
    await clearCounter(HID_A);
    await clearCounter(HID_B);
  });

  it('allows the first call and bumps used to 1', async () => {
    const r = await checkAndIncrementGardenPlanCount(testEnv, HID_A);
    expect(r.allowed).toBe(true);
    expect(r.used).toBe(1);
    expect(r.cap).toBe(DEFAULT_GARDEN_PLAN_DAILY_CAP);
    expect(r.resetsAt).toMatch(/T00:00:00\.000Z$/);
  });

  it('can read availability without incrementing', async () => {
    const before = await getGardenPlanCount(testEnv, HID_A);
    expect(before.allowed).toBe(true);
    expect(before.used).toBe(0);

    const after = await getGardenPlanCount(testEnv, HID_A);
    expect(after.used).toBe(0);
  });

  it('denies once the cap is reached and does not increment further', async () => {
    const cap = 2;
    const a = await checkAndIncrementGardenPlanCount(testEnv, HID_A, cap);
    const b = await checkAndIncrementGardenPlanCount(testEnv, HID_A, cap);
    const c = await checkAndIncrementGardenPlanCount(testEnv, HID_A, cap);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.used).toBe(2);
    // A 4th call should still be denied (no further bump).
    const d = await checkAndIncrementGardenPlanCount(testEnv, HID_A, cap);
    expect(d.allowed).toBe(false);
    expect(d.used).toBe(2);
  });

  it('refund decrements but never below zero', async () => {
    await checkAndIncrementGardenPlanCount(testEnv, HID_A, 5);
    await checkAndIncrementGardenPlanCount(testEnv, HID_A, 5);
    // used = 2 → refund → used = 1
    await refundGardenPlanCount(testEnv, HID_A);
    const r1 = await checkAndIncrementGardenPlanCount(testEnv, HID_A, 5);
    expect(r1.used).toBe(2);
    // Drain to zero, then refund twice — second refund is a no-op.
    await refundGardenPlanCount(testEnv, HID_A); // 1
    await refundGardenPlanCount(testEnv, HID_A); // 0
    await refundGardenPlanCount(testEnv, HID_A); // still 0
    const r2 = await checkAndIncrementGardenPlanCount(testEnv, HID_A, 5);
    expect(r2.used).toBe(1);
  });

  it('counters are per-household', async () => {
    const cap = 1;
    const a = await checkAndIncrementGardenPlanCount(testEnv, HID_A, cap);
    const b = await checkAndIncrementGardenPlanCount(testEnv, HID_B, cap);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    const aAgain = await checkAndIncrementGardenPlanCount(testEnv, HID_A, cap);
    expect(aAgain.allowed).toBe(false);
  });
});
