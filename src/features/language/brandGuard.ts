import { brandId } from '@brand';

/**
 * Brand predicate for Symply Language.
 *
 * Lives in its own module rather than in `index.ts` so callers can import it
 * without pulling in the barrel — `index.ts` re-exports every screen, so
 * importing the predicate from there drags the whole Language feature into the
 * root bundle (`app/_layout.tsx`) and risks an init-time cycle inside the
 * feature. Mirrors `@features/health/brandGuard`.
 *
 * `index.ts` re-exports both names, so existing `@features/language` importers
 * are unaffected.
 */
export const LANGUAGE_FEATURE_ID = 'language' as const;

export function isLanguageBrand(id: string = brandId): boolean {
  return id === 'symply-language';
}
