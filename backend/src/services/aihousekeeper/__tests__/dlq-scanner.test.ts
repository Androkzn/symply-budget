/**
 * dlq-scanner.ts — plan §F1 / §B15, Track B / RES-5
 */

import { env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Env } from '../../../types';
import { scanAndAlert, dlqScanner, _testing } from '../dlq-scanner';

const testEnv = env as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dlq-scanner', () => {
  it('scanAndAlert runs without throwing', async () => {
    await expect(scanAndAlert(testEnv)).resolves.toBeUndefined();
  });

  it('probes all three DLQ bindings including TASK_ENRICHMENT_DLQ', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await scanAndAlert(testEnv);

    const flat = JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(flat).toContain('AIHOUSEKEEPER_OUTBOUND_DLQ');
    expect(flat).toContain('GARDEN_PLAN_DLQ');
    expect(flat).toContain('TASK_ENRICHMENT_DLQ');
    expect(_testing.DLQ_PROBES).toHaveLength(3);
  });

  it('exposes dlqScanner.scanAndAlert as an object API', () => {
    expect(typeof dlqScanner.scanAndAlert).toBe('function');
  });
});
