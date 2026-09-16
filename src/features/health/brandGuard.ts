import { brandId } from '@brand';

/**
 * Brand predicate for Symply Health.
 *
 * Lives in its own module rather than in `index.ts` so components inside this
 * feature can import it without pulling in the barrel — `index.ts` re-exports
 * every screen, so `components/* → index.ts` would be a cycle that resolves to
 * `undefined` at module-init time in Metro.
 */
export const HEALTH_FEATURE_ID = 'health' as const;

export function isHealthBrand(id: string = brandId): boolean {
  return id === 'symply-health';
}
