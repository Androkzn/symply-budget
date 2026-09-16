/**
 * BUDGET-CORNER-025 — the two brand gates return DIFFERENT 404 envelopes.
 *
 * `requireBrandCapability()` (and therefore `requireHomeApi()` /
 * `gateHomeApiPaths()`) returns `{ error: { code: 'not_found', message } }` —
 * an object. `requireBudgetApi()` returns `{ error: 'Not found' }` — a bare
 * string. Both are 404s from the same Worker, so the client must survive both
 * shapes. This file pins the server halves; the client half lives in
 * `src/api/__tests__/brandGate404.contract.test.ts`.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  gateHomeApiPaths,
  requireBrandCapability,
  requireBudgetApi,
  requireLocalFirstApi,
  requireHomeApi,
} from '../brand-gate';

function mkEnv(brand: string, extra: Partial<Env> = {}): Env {
  return { APP_BRAND: brand, ...extra } as unknown as Env;
}

// Deliberately widened: the two gates' return types are structurally different
// (object vs string error body) — which is BUDGET-CORNER-025 showing up in the
// type system as well as at runtime.
function mkApp(mw: MiddlewareHandler<{ Bindings: Env }>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/x', mw);
  app.get('/x', c => c.json({ ok: true }));
  return app;
}

describe('requireBrandCapability — object error envelope', () => {
  it('BUDGET-CORNER-025: 404s with a nested { code, message } object when the capability is off', async () => {
    const res = await mkApp(requireBrandCapability('homeApi')).request(
      'http://x/x',
      {},
      mkEnv('symply-budget')
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: unknown };
    expect(typeof body.error).toBe('object');
    expect(body.error).toEqual({ code: 'not_found', message: 'Not found' });
  });

  it('BUDGET-CORNER-025: passes through when the capability is on', async () => {
    const res = await mkApp(requireBrandCapability('homeApi')).request(
      'http://x/x',
      {},
      mkEnv('symply-house')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('BUDGET-CORNER-025: requireHomeApi and gateHomeApiPaths reuse the same object envelope', async () => {
    const direct = await mkApp(requireHomeApi()).request('http://x/x', {}, mkEnv('symply-budget'));
    const gated = new Hono<{ Bindings: Env }>();
    gateHomeApiPaths(gated, ['/x']);
    gated.get('/x', c => c.json({ ok: true }));
    const viaGate = await gated.request('http://x/x', {}, mkEnv('symply-budget'));

    expect(direct.status).toBe(404);
    expect(viaGate.status).toBe(404);
    expect(await direct.json()).toEqual(await viaGate.json());
  });
});

describe('requireBudgetApi — string error envelope', () => {
  it('BUDGET-CORNER-025: 404s with a bare string error when budget mode is not full', async () => {
    const res = await mkApp(requireBudgetApi()).request('http://x/x', {}, mkEnv('symply-kaizen'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: unknown };
    expect(typeof body.error).toBe('string');
    expect(body).toEqual({ error: 'Not found' });
  });

  it('BUDGET-CORNER-025: 404s with the same string envelope when BUDGET_API_ENABLED is "false"', async () => {
    const res = await mkApp(requireBudgetApi()).request(
      'http://x/x',
      {},
      mkEnv('symply-budget', { BUDGET_API_ENABLED: 'false' } as Partial<Env>)
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('BUDGET-CORNER-025: passes through on the full-budget Worker', async () => {
    const res = await mkApp(requireBudgetApi()).request('http://x/x', {}, mkEnv('symply-budget'));
    expect(res.status).toBe(200);
  });
});

describe('requireLocalFirstApi — string error envelope', () => {
  it('404s with the same string envelope as requireBudgetApi on Kaizen', async () => {
    const res = await mkApp(requireLocalFirstApi()).request('http://x/x', {}, mkEnv('symply-kaizen'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('404s when LOCAL_FIRST_API_ENABLED is "false" on House', async () => {
    const res = await mkApp(requireLocalFirstApi()).request(
      'http://x/x',
      {},
      mkEnv('symply-house', { LOCAL_FIRST_API_ENABLED: 'false' } as Partial<Env>),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('passes through on House when capability and flag allow /v2', async () => {
    const res = await mkApp(requireLocalFirstApi()).request(
      'http://x/x',
      {},
      mkEnv('symply-house', { LOCAL_FIRST_API_ENABLED: 'true' } as Partial<Env>),
    );
    expect(res.status).toBe(200);
  });

  // The env literal is required now: the gate is fail-CLOSED per Health V2 plan
  // §1.7a, so an unset `LOCAL_FIRST_API_ENABLED` 404s even on a local-first
  // brand. `wrangler.budget.toml` declares it in all three var blocks.
  it('passes through on Budget Worker', async () => {
    const res = await mkApp(requireLocalFirstApi()).request(
      'http://x/x',
      {},
      mkEnv('symply-budget', { LOCAL_FIRST_API_ENABLED: 'true' } as Partial<Env>),
    );
    expect(res.status).toBe(200);
  });

  it('404s when LOCAL_FIRST_API_ENABLED is unset on Budget Worker (§1.7a)', async () => {
    const res = await mkApp(requireLocalFirstApi()).request('http://x/x', {}, mkEnv('symply-budget'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('the two envelopes diverge (the corner itself)', () => {
  it('BUDGET-CORNER-025: same status, incompatible bodies — a client reading error.code off the budget shape gets undefined', async () => {
    const capability = await mkApp(requireBrandCapability('homeApi')).request(
      'http://x/x',
      {},
      mkEnv('symply-budget')
    );
    const budget = await mkApp(requireBudgetApi()).request(
      'http://x/x',
      {},
      mkEnv('symply-kaizen')
    );

    expect(capability.status).toBe(budget.status);
    const a = (await capability.json()) as { error: { code?: string } };
    const b = (await budget.json()) as { error: unknown };
    expect(a.error.code).toBe('not_found');
    // The string shape has no `.code` — reading it must be undefined, not a throw.
    expect((b.error as { code?: string }).code).toBeUndefined();
    expect(a).not.toEqual(b);
  });
});
