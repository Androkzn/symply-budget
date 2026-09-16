/**
 * Framework-free env constants + brand API URL resolution (CA-8).
 * Safe to import from tests/scripts without React Native.
 */

// NOTE: `brand` is required lazily (see resolveBrandApiUrls) rather than imported
// at module scope. A top-level `import { brand }` pulls the brand dependency graph
// (aihousekeeper -> tasks -> api/client -> config/env) back into this module,
// forming a circular import that leaves ENV `undefined` and crashes the app on launch.

export const BUDGET_STAGING_API_URL =
  'https://simple-budget-api-staging.a-tekhtelev.workers.dev';
export const BUDGET_PRODUCTION_API_URL =
  'https://simple-budget-api.a-tekhtelev.workers.dev';

/** Per-brand Worker hosts — pure data, no RN. */
export function resolveBrandApiUrls(
  brandId?: string
): { staging: string; production: string } {
  const id = brandId ?? (require('../brand') as typeof import('../brand')).brand?.id;
  if (id !== 'symply-budget') throw new Error(`Unsupported standalone brand: ${id ?? '(unset)'}`);
  return { staging: BUDGET_STAGING_API_URL, production: BUDGET_PRODUCTION_API_URL };
}

export function resolveBuildEnvOverride(): 'staging' | 'production' | null {
  const raw = process.env.EXPO_PUBLIC_API_ENV;
  return raw === 'staging' || raw === 'production' ? raw : null;
}
