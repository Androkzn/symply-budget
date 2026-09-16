/**
 * BUDGET-CORNER-012 / 013 — client money fields round via toCents; only wishes
 * carry a documented server-side max (1B cents) — no shared FE MAX elsewhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toCents } from '../budgetItemFormUtils';

const repoRoot = join(__dirname, '../../../..');
const wishesRouteSource = readFileSync(join(repoRoot, 'backend/src/routes/wishes.ts'), 'utf8');

describe('money field caps contract (BUDGET-CORNER-012/013)', () => {
  it('toCents rounds long decimal strings to integer cents (no NaN)', () => {
    expect(toCents('123456789.98765')).toBe(12345678999);
    expect(Number.isNaN(toCents('123456789.98765') as number)).toBe(false);
  });

  it('toCents rejects empty and non-numeric junk instead of producing NaN cents', () => {
    expect(toCents('abc')).toBeUndefined();
    expect(toCents('')).toBeUndefined();
  });

  it('documents the wishes API server max (1_000_000_000 cents) without a shared FE cap', () => {
    expect(wishesRouteSource).toContain('.max(1_000_000_000)');
    expect(wishesRouteSource).toContain('estimated_cost_cents');
    expect(wishesRouteSource).not.toMatch(/MAX_MONEY|MAX_CENTS|moneyFieldMax/i);
  });
});
