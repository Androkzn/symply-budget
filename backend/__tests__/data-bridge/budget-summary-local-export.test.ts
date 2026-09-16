/**
 * Local-first budget.summary.v1 export — client_payload path (no D1 spend query).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  assertClientPayloadAllowed,
  normalizeBudgetSummaryClientPayload,
  shouldUseClientBudgetSummaryPayload,
} from '../../src/services/soft-transfer/adapters';
import { resolveExportEnvelopePayload } from '../../src/services/soft-transfer/export-import';
import type { Env } from '../../src/types';

import { baseEnv } from './helpers';

describe('normalizeBudgetSummaryClientPayload', () => {
  it('accepts manifest-only payload', () => {
    const payload = normalizeBudgetSummaryClientPayload({
      currency: 'CAD',
      monthTotal: 1200,
      ytdTotal: 8400,
      remaining: 800,
      topCategories: [{ name: 'Groceries', total: 400 }],
    });
    expect(payload).toEqual({
      currency: 'CAD',
      monthTotal: 1200,
      ytdTotal: 8400,
      remaining: 800,
      topCategories: [{ name: 'Groceries', total: 400 }],
    });
  });

  it('strips extra local export document fields', () => {
    const payload = normalizeBudgetSummaryClientPayload({
      format: 'budget.summary.v1',
      version: 1,
      householdId: 'hh-1',
      householdName: 'Home',
      currency: 'CAD',
      year: 2026,
      month: 8,
      monthTotal: 500,
      ytdTotal: 5000,
      remaining: null,
      plannedBudget: null,
      topCategories: [],
      exportedAt: '2026-08-10T00:00:00.000Z',
    });
    expect(payload.currency).toBe('CAD');
    expect(payload.monthTotal).toBe(500);
    expect(payload.ytdTotal).toBe(5000);
    expect(Object.keys(payload).sort()).toEqual([
      'currency',
      'monthTotal',
      'remaining',
      'topCategories',
      'ytdTotal',
    ]);
  });

  it('rejects invalid shapes', () => {
    expect(() =>
      normalizeBudgetSummaryClientPayload({ currency: 'CAD', monthTotal: 'bad' })
    ).toThrow(/Validation failed/);
  });
});

describe('client payload gate helpers', () => {
  it('requires local-first header semantics for client_payload', () => {
    expect(() =>
      assertClientPayloadAllowed({
        packageId: 'budget.summary.v1',
        sourceBrandId: 'symply-budget',
        localFirstClient: false,
        clientPayload: { currency: 'CAD', monthTotal: 1, ytdTotal: 2 },
      })
    ).toThrow(/Validation failed/);
  });

  it('selects client path only for budget.summary on Budget brand', () => {
    expect(
      shouldUseClientBudgetSummaryPayload({
        packageId: 'budget.summary.v1',
        sourceBrandId: 'symply-budget',
        localFirstClient: true,
        clientPayload: { currency: 'CAD', monthTotal: 1, ytdTotal: 2 },
      })
    ).toBe(true);
    expect(
      shouldUseClientBudgetSummaryPayload({
        packageId: 'house.property.v1',
        sourceBrandId: 'symply-house',
        localFirstClient: true,
        clientPayload: { cityRegion: 'x' },
      })
    ).toBe(false);
  });
});

describe('resolveExportEnvelopePayload', () => {
  const env: Env = baseEnv({ APP_BRAND: 'symply-budget' });

  it('uses client payload without querying D1', async () => {
    const buildSpy = vi.spyOn(
      await import('../../src/services/soft-transfer/adapters'),
      'buildPackagePayload'
    );

    const clientPayload = {
      currency: 'CAD',
      monthTotal: 900,
      ytdTotal: 7200,
      remaining: 100,
      topCategories: [{ name: 'Food', total: 300 }],
    };

    const payload = await resolveExportEnvelopePayload(env, {
      packageId: 'budget.summary.v1',
      userId: 'user-lf',
      sourceHouseholdId: 'hh-budget',
      sourceBrandId: 'symply-budget',
      clientPayload,
      localFirstClient: true,
    });

    expect(payload).toEqual(clientPayload);
    expect(buildSpy).not.toHaveBeenCalled();
    buildSpy.mockRestore();
  });

  it('falls back to buildPackagePayload when no client payload', async () => {
    const buildSpy = vi
      .spyOn(
        await import('../../src/services/soft-transfer/adapters'),
        'buildPackagePayload'
      )
      .mockResolvedValue({
        currency: 'USD',
        monthTotal: 0,
        ytdTotal: 0,
        remaining: null,
        topCategories: [],
      });

    const payload = await resolveExportEnvelopePayload(env, {
      packageId: 'budget.summary.v1',
      userId: 'user-d1',
      sourceHouseholdId: 'hh-budget',
      sourceBrandId: 'symply-budget',
      localFirstClient: false,
    });

    expect(buildSpy).toHaveBeenCalledOnce();
    expect(payload.currency).toBe('USD');
    buildSpy.mockRestore();
  });
});
