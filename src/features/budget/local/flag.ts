/**
 * Budget V2 local-first gate.
 *
 * - EXPO_PUBLIC_BUDGET_LOCAL_FIRST=1 → on
 * - EXPO_PUBLIC_BUDGET_LOCAL_FIRST=0 → off
 * - unset → on for symply-budget (V2 default on this branch, including release)
 */
export function isBudgetLocalFirst(): boolean {
  const env = process.env.EXPO_PUBLIC_BUDGET_LOCAL_FIRST;
  if (env === '1') return true;
  if (env === '0') return false;

  try {
    // Lazy require avoids env/brand circular init.
    const { brand } = require('../../../brand') as typeof import('../../../brand');
    return brand?.id === 'symply-budget';
  } catch {
    return false;
  }
}
