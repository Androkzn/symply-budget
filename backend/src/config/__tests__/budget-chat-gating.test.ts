/**
 * BUDGET-BCHAT-045 — budget-chat-rooms must stay mounted outside the
 * BUDGET_API_ENABLED gate so House Worker can still reach group chat.
 */
import { describe, expect, it } from 'vitest';

// Bundled at test compile time — avoids Cloudflare worker FS path encoding issues.
import indexSource from '../../index.ts?raw';

describe('budget chat route gating (BUDGET-BCHAT-045)', () => {
  it('mounts budget-chat-rooms before the requireBudgetApi gate block', () => {
    const chatMount = indexSource.indexOf("app.route('/households/:householdId/budget-chat-rooms'");
    const budgetGate = indexSource.indexOf("app.use('/households/:householdId/budget', requireBudgetApi())");

    expect(chatMount).toBeGreaterThan(-1);
    expect(budgetGate).toBeGreaterThan(-1);
    expect(chatMount).toBeLessThan(budgetGate);
  });

  it('does not wrap budget-chat-rooms in requireBudgetApi()', () => {
    expect(indexSource).not.toMatch(
      /requireBudgetApi\(\)[\s\S]{0,120}budget-chat-rooms|budget-chat-rooms[\s\S]{0,120}requireBudgetApi\(\)/
    );
  });
});
