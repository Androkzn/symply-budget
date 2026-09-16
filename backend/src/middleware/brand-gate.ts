/**
 * Brand capability route gates — replace inline if-ladders in index.ts (Track A A6).
 */
import type { Context, Next } from 'hono';
import type { Hono } from 'hono';

import {
  hasBrandCapability,
  type BrandCapabilityKey,
} from '../config/brand-capabilities';
import { isBudgetApiEnabled } from '../config/budget-api';
import { isLocalFirstApiEnabled } from '../config/local-first-api';
import type { Env } from '../types';

export function requireBrandCapability(key: BrandCapabilityKey) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!hasBrandCapability(c.env, key)) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    return next();
  };
}

/** House-domain API surface — tasks, floor plans, AI Housekeeper, etc. */
export function requireHomeApi() {
  return requireBrandCapability('homeApi');
}

/** Symply Health tracking surface — 404s on House/Budget/Kaizen Workers. */
export function requireHealthApi() {
  return requireBrandCapability('healthApi');
}

export function requireBudgetApi() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!isBudgetApiEnabled(c.env)) {
      return c.json({ error: 'Not found' }, 404);
    }
    await next();
  };
}

/**
 * Local-first `/v2` control plane — House, Budget **and Health** Workers.
 *
 * Health joined at He0 (`localFirstApi: true`, `src/config/brand-capabilities.ts`).
 * Kaizen is the only brand still gated out, and its 404 body
 * (`{ error: 'Not found' }`) is the literal the He0 contract test pins.
 */
export function requireLocalFirstApi() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!isLocalFirstApiEnabled(c.env)) {
      return c.json({ error: 'Not found' }, 404);
    }
    await next();
  };
}

/** Register homeApi 404 gates for mount paths (path + `/*` subpaths). */
export function gateHomeApiPaths(app: Hono<{ Bindings: Env }>, paths: string[]): void {
  const gate = requireHomeApi();
  for (const path of paths) {
    app.use(path, gate);
    app.use(`${path}/*`, gate);
  }
}
