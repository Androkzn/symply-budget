/**
 * BUDGET-CORNER-021 — Utilities is reachable on the Budget client but 404s on
 * the Budget Worker. **CONFIRMED OPEN DEFECT** (Flagged item 28).
 *
 * The client gate `app/(tabs)/utilities.tsx` only redirects when
 * `isBudgetOff() || isMinimalBudget()`, so full-budget Budget renders the
 * Utilities tab, and `src/features/budget/mode.ts` lists every `Utility*`
 * screen in `FULL_BUDGET_STACK_ROUTES`. But `/households/:householdId/utilities`
 * sits in `gateHomeApiPaths` in `backend/src/index.ts`, and Budget has
 * `homeApi: false` — so every utilities call 404s.
 *
 * These tests deliberately assert the CURRENT INCOHERENT PAIR rather than the
 * behaviour either side "should" have. Product must decide whether Budget owns
 * utilities; when it does, exactly one of these two expectations flips and this
 * file is the reminder. See the mobile half:
 * `src/features/budget/__tests__/utilitiesGate.contract.test.ts`.
 */
import { Hono } from 'hono';

// Raw source of the Worker entry — asserted as TEXT so the gate registration is
// pinned without booting the whole Worker (importing index.ts would).
import { describe, expect, it } from 'vitest';

import { hasBrandCapability } from '../../config/brand-capabilities';
import { isBudgetApiEnabled } from '../../config/budget-api';
import indexSrc from '../../index.ts?raw';
import type { Env } from '../../types';
import { gateHomeApiPaths, requireBudgetApi } from '../brand-gate';

function mkEnv(brand: string): Env {
  return { APP_BRAND: brand } as unknown as Env;
}

const UTILITIES_PATH = '/households/:householdId/utilities';
const UTILITIES_URL = 'http://x/households/hh_1/utilities';

/** Worker shaped like index.ts: home-API gate on utilities, then the route. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  gateHomeApiPaths(app, [UTILITIES_PATH]);
  app.get(UTILITIES_PATH, c => c.json({ bills: [] }));
  app.get(`${UTILITIES_PATH}/property-taxes`, c => c.json({ taxes: [] }));
  return app;
}

describe('BUDGET-CORNER-021 — utilities is home-API gated on the Worker', () => {
  it('BUDGET-CORNER-021: Budget has full budget mode but NOT the homeApi capability', () => {
    const env = mkEnv('symply-budget');
    expect(isBudgetApiEnabled(env)).toBe(true);
    expect(hasBrandCapability(env, 'homeApi')).toBe(false);
  });

  it('BUDGET-CORNER-021: GET /households/:householdId/utilities 404s on the Budget Worker', async () => {
    const res = await mkApp().request(UTILITIES_URL, {}, mkEnv('symply-budget'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('BUDGET-CORNER-021: every utilities SUBPATH 404s too (the `/*` gate)', async () => {
    const app = mkApp();
    for (const url of [
      `${UTILITIES_URL}/property-taxes`,
      `${UTILITIES_URL}/bills`,
      `${UTILITIES_URL}/providers/p_1`,
    ]) {
      const res = await app.request(url, {}, mkEnv('symply-budget'));
      expect(res.status).toBe(404);
    }
  });

  it('BUDGET-CORNER-021: the same route serves 200 on the House Worker', async () => {
    const res = await mkApp().request(UTILITIES_URL, {}, mkEnv('symply-house'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bills: [] });
  });

  it('BUDGET-CORNER-021: the budget-API gate would have ALLOWED utilities — only homeApi blocks it', async () => {
    // Proves the 404 is not a budget-product decision: were utilities gated by
    // `requireBudgetApi()` (as the client's full-budget stack implies), Budget
    // would pass. The two gates disagree about who owns utilities.
    const app = new Hono<{ Bindings: Env }>();
    app.use(UTILITIES_PATH, requireBudgetApi());
    app.get(UTILITIES_PATH, c => c.json({ bills: [] }));
    const res = await app.request(UTILITIES_URL, {}, mkEnv('symply-budget'));
    expect(res.status).toBe(200);
  });
});

describe('BUDGET-CORNER-021 — the gate list itself', () => {
  const gateBlock = (indexSrc as string).slice(
    indexSrc.indexOf('gateHomeApiPaths(app, ['),
    indexSrc.indexOf(']);', indexSrc.indexOf('gateHomeApiPaths(app, ['))
  );

  it('BUDGET-CORNER-021: /households/:householdId/utilities is still registered in gateHomeApiPaths', () => {
    expect(gateBlock).toContain(`'${UTILITIES_PATH}'`);
  });

  it('BUDGET-CORNER-021: utilities is NOT additionally protected by requireBudgetApi in index.ts', () => {
    // If a future fix moves utilities out of the home gate, it should land under
    // the budget gate — at which point this expectation flips too.
    const utilitiesRouteLine = (indexSrc as string)
      .split('\n')
      .find(l => l.includes(`app.route('${UTILITIES_PATH}'`));
    expect(utilitiesRouteLine ?? '').not.toContain('requireBudgetApi');
  });
});
