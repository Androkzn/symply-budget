import type { Context, Next } from 'hono';

import type { Env } from '../types';

/**
 * When a House V2 local-first client identifies itself, reject Tier-A home-domain
 * CRUD so D1 cannot become a second system of record.
 *
 * Signal (either):
 * - Header: `X-House-Local-First: 1`
 * - Query: `house_local_first=1` (fallback if intermediaries strip custom headers)
 */
export function isHouseLocalFirstClient(c: Context): boolean {
  const flag = c.req.header('X-House-Local-First') ?? c.req.header('x-house-local-first');
  if (flag === '1' || flag === 'true') return true;
  const q = c.req.query('house_local_first');
  return q === '1' || q === 'true';
}

/** Tier-A home paths that local-first clients must not write via legacy REST. */
const HOME_LOCAL_FIRST_REJECT_SUFFIXES = [
  '/tasks',
  '/garbage-collection',
  '/appliances',
  '/seasonal-checklists',
  '/checklists',
  '/contractors',
  '/appointments',
  '/quotes',
  '/projects',
  '/visit-checklists',
  '/visits',
  '/notes',
  '/messages',
  '/utilities',
  '/task-drafts',
  '/home-features',
  '/maintenance-suggestions',
  '/floor-plans',
  '/garden-plans',
  '/home-projects',
] as const;

/** Paths excluded from the reject gate — server-authoritative Tier B/C surfaces. */
export function isHomeDomainLocalFirstPath(pathname: string): boolean {
  return HOME_LOCAL_FIRST_REJECT_SUFFIXES.some((suffix) => {
    const escaped = suffix.replace(/\//g, '\\/');
    return new RegExp(`/households/[^/]+${escaped}(\\/|$)`).test(pathname);
  });
}

const LOCAL_FIRST_ENABLED_BODY = {
  error: {
    code: 'local_first_enabled',
    message:
      'House domain API is disabled for local-first clients. Use the on-device ledger and /v2 control-plane routes.',
  },
} as const;

export function rejectHomeWritesForLocalFirst() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (isHouseLocalFirstClient(c)) {
      return c.json(LOCAL_FIRST_ENABLED_BODY, 410);
    }
    return next();
  };
}

/** Run before `/households` auth so unauthenticated local-first probes get 410, not 401. */
export function rejectHomeWritesForLocalFirstEarly() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const pathname = new URL(c.req.url).pathname;
    if (isHomeDomainLocalFirstPath(pathname) && isHouseLocalFirstClient(c)) {
      return c.json(LOCAL_FIRST_ENABLED_BODY, 410);
    }
    return next();
  };
}
