/**
 * `requireLocalFirstApi()` — the gate on the three `/v2` mount points
 * (House V2 plan §2.1, DoD H0).
 *
 * Two things are pinned here, and both are contracts a client can observe:
 *
 *  1. **Brand isolation.** `/v2` must exist on the House, Budget and Health
 *     Workers and 404 on Kaizen. `deploy:fleet` ships ONE codebase to all four,
 *     so this test is what keeps a shared-plumbing change from quietly opening
 *     a control plane on a brand that has no local-first client.
 *     (Health joined the local-first brands in `fd3a5b78`.)
 *  2. **The 404 body shape.** It must stay Budget's flat `{ error: 'Not found' }`
 *     envelope, NOT the `{ error: { code, message } }` shape
 *     `requireBrandCapability` uses. `classifySyncError` keys on HTTP status, but
 *     other callers may string-match the body, and Budget clients are already in
 *     the field.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { requireBudgetApi, requireLocalFirstApi } from '../brand-gate';

function mkEnv(brand: string, flag?: string): Env {
  return { APP_BRAND: brand, LOCAL_FIRST_API_ENABLED: flag } as unknown as Env;
}

function gatedApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/v2', requireLocalFirstApi());
  app.use('/v2/*', requireLocalFirstApi());
  app.get('/v2/households', (c) => c.json({ households: [] }));
  return app;
}

describe('requireLocalFirstApi — brand isolation', () => {
  it.each([
    ['symply-house', 'true'],
    ['symply-budget', 'true'],
    ['symply-health', 'true'],
  ])('serves /v2 on %s (LOCAL_FIRST_API_ENABLED=%s)', async (brand, flag) => {
    const res = await gatedApp().request(
      'http://x/v2/households',
      {},
      mkEnv(brand, flag as string | undefined),
    );
    expect(res.status).toBe(200);
  });

  // INVERTED per Health V2 plan §1.7a. These three rows used to assert 200 for
  // an UNSET var — the fail-OPEN default that `isLocalFirstApiEnabled` no
  // longer has. `/v2` is now unreachable unless the brand's wrangler config
  // declares `LOCAL_FIRST_API_ENABLED = "true"`; all three brands do.
  it.each(['symply-house', 'symply-budget', 'symply-health'])(
    '404s /v2 on %s when LOCAL_FIRST_API_ENABLED is unset (fail-closed)',
    async (brand) => {
      const res = await gatedApp().request('http://x/v2/households', {}, mkEnv(brand));
      expect(res.status).toBe(404);
    },
  );

  it.each(['symply-kaizen'])('404s /v2 on %s', async (brand) => {
    const res = await gatedApp().request('http://x/v2/households', {}, mkEnv(brand, 'true'));
    expect(res.status).toBe(404);
  });

  it('404s when the Worker var is explicitly false, even on House', async () => {
    const res = await gatedApp().request(
      'http://x/v2/households',
      {},
      mkEnv('symply-house', 'false'),
    );
    expect(res.status).toBe(404);
  });
});

describe('requireLocalFirstApi — 404 body shape', () => {
  it("returns Budget's flat { error: 'Not found' } envelope", async () => {
    const res = await gatedApp().request('http://x/v2/households', {}, mkEnv('symply-kaizen'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('matches requireBudgetApi byte for byte', async () => {
    const budgetApp = new Hono<{ Bindings: Env }>();
    budgetApp.use('/budget/*', requireBudgetApi());
    budgetApp.get('/budget/x', (c) => c.json({ ok: true }));

    const [localFirst, budget] = await Promise.all([
      gatedApp().request('http://x/v2/households', {}, mkEnv('symply-kaizen')),
      budgetApp.request('http://x/budget/x', {}, mkEnv('symply-kaizen')),
    ]);

    expect(localFirst.status).toBe(budget.status);
    expect(await localFirst.text()).toBe(await budget.text());
  });

  it('does not use the requireBrandCapability nested envelope', async () => {
    const res = await gatedApp().request('http://x/v2/households', {}, mkEnv('symply-kaizen'));
    const body = (await res.json()) as { error: unknown };
    expect(typeof body.error).toBe('string');
  });
});
