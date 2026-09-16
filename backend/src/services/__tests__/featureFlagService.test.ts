/**
 * featureFlagService — KV-backed global feature flags.
 *
 * Covers:
 *   - getFlags returns build-time defaults when KV is empty (safe fallback).
 *   - getFlags merges KV overrides over the defaults.
 *   - setFlags round-trips, bumps the version, and stamps updatedAt.
 *   - setFlags merges partials and ignores unknown / non-boolean keys.
 */

import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

import type { Env } from '../../types';
import {
  DEFAULT_FLAGS,
  getFlags,
  setFlags,
} from '../featureFlagService';

const testEnv = env as unknown as Env;
const KV_KEY = 'feature-flags:v1';

beforeEach(async () => {
  await testEnv.CONFIG_KV.delete(KV_KEY);
});

describe('featureFlagService', () => {
  it('returns defaults when KV is empty', async () => {
    const payload = await getFlags(testEnv.CONFIG_KV);
    expect(payload.flags).toEqual(DEFAULT_FLAGS);
    expect(payload.version).toBe(0);
    expect(payload.updatedAt).toBeNull();
  });

  it('merges KV overrides over defaults', async () => {
    await setFlags(testEnv.CONFIG_KV, { gardening: false }, '2026-06-11T00:00:00.000Z');
    const payload = await getFlags(testEnv.CONFIG_KV);
    expect(payload.flags.gardening).toBe(false);
    // Untouched keys still fall through to their defaults.
    expect(payload.flags.reports).toBe(DEFAULT_FLAGS.reports);
  });

  it('setFlags round-trips, bumps version, and stamps updatedAt', async () => {
    const first = await setFlags(
      testEnv.CONFIG_KV,
      { reports: false },
      '2026-06-11T00:00:00.000Z'
    );
    expect(first.version).toBe(1);
    expect(first.updatedAt).toBe('2026-06-11T00:00:00.000Z');

    const second = await setFlags(
      testEnv.CONFIG_KV,
      { utilities: false },
      '2026-06-11T01:00:00.000Z'
    );
    // Partial merge: the earlier override persists.
    expect(second.flags.reports).toBe(false);
    expect(second.flags.utilities).toBe(false);
    expect(second.version).toBe(2);
  });

  it('ignores unknown and non-boolean keys', async () => {
    await setFlags(
      testEnv.CONFIG_KV,
      { nope: true, gardening: 'yes' as unknown as boolean },
      '2026-06-11T00:00:00.000Z'
    );
    const payload = await getFlags(testEnv.CONFIG_KV);
    expect((payload.flags as Record<string, unknown>).nope).toBeUndefined();
    // Non-boolean value rejected → gardening stays at its default.
    expect(payload.flags.gardening).toBe(DEFAULT_FLAGS.gardening);
  });
});
