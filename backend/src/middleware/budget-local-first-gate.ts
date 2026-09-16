import type { Context, Next } from 'hono';

import type { Env } from '../types';

/**
 * When a Budget V2 local-first client identifies itself, reject financial
 * ledger CRUD so D1 cannot become a second system of record.
 *
 * Signal (either):
 * - Header: `X-Budget-Local-First: 1`
 * - Query: `local_first=1` (fallback if intermediaries strip custom headers)
 */
export function isLocalFirstClient(c: Context): boolean {
  const flag = c.req.header('X-Budget-Local-First') ?? c.req.header('x-budget-local-first');
  if (flag === '1' || flag === 'true') return true;
  const q = c.req.query('local_first');
  return q === '1' || q === 'true';
}

/** Paths that hold financial ledger data (Budget Worker). */
export function isFinancialBudgetPath(pathname: string): boolean {
  return /\/households\/[^/]+\/(budget|savings|mortgage|wishes)(\/|$)/.test(pathname);
}

export function rejectFinancialWritesForLocalFirst() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (isLocalFirstClient(c)) {
      return c.json(
        {
          error: {
            code: 'local_first_enabled',
            message:
              'Financial budget API is disabled for local-first clients. Use the on-device ledger and /v2 control-plane routes.',
          },
        },
        410,
      );
    }
    return next();
  };
}

/**
 * App-level gate: run early (before `/households` auth) so unauthenticated
 * local-first probes still get 410 instead of 401.
 */
export function rejectFinancialWritesForLocalFirstEarly() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const pathname = new URL(c.req.url).pathname;
    if (isFinancialBudgetPath(pathname) && isLocalFirstClient(c)) {
      return c.json(
        {
          error: {
            code: 'local_first_enabled',
            message:
              'Financial budget API is disabled for local-first clients. Use the on-device ledger and /v2 control-plane routes.',
          },
        },
        410,
      );
    }
    return next();
  };
}
