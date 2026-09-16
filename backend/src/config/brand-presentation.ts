/**
 * User-facing brand presentation for web surfaces served by the Worker (invite
 * landing pages, etc). Mirrors the display name + URL scheme + icon in each
 * `brands/<id>/brand.cjs` — the fleet deploys one Worker per brand and stamps
 * `APP_BRAND`, so the landing page must speak the same brand as the app that
 * created the link (not always House).
 *
 * Keep the `scheme` values in sync with `brands/<id>/brand.cjs` `scheme:` and
 * each app's registered URL scheme (app.config.ts) — the app only opens a
 * deep link whose scheme it registered.
 */
import type { Env } from '../types';

import { tryGetAppBrand } from './brand';

export interface BrandPresentation {
  /** User-facing app name, e.g. "Symply Budget". */
  displayName: string;
  /** Custom URL scheme (no `://`), e.g. "simplebudget". */
  scheme: string;
  /** Emoji used as the landing-page hero icon. */
  icon: string;
}

/**
 * Presentation for every fleet brand. Language is included even though it runs a
 * separate backend, so a shared helper never falls back to House for it.
 */
const BRAND_PRESENTATION: Record<string, BrandPresentation> = {
  'symply-house': { displayName: 'Symply House', scheme: 'simplehouse', icon: '🏠' },
  'symply-budget': { displayName: 'Symply Budget', scheme: 'simplebudget', icon: '💰' },
  'symply-kaizen': { displayName: 'Symply Kaizen', scheme: 'kaizen', icon: '🌱' },
  'symply-health': { displayName: 'Symply Health', scheme: 'simplehealth', icon: '❤️' },
  'symply-language': { displayName: 'Symply Language', scheme: 'simplelanguage', icon: '🗣️' },
};

/**
 * House is the template brand and the only safe generic fallback for a shared
 * web surface — an unknown `APP_BRAND` should still render a usable page rather
 * than crash the public landing route.
 */
export const DEFAULT_BRAND_PRESENTATION: BrandPresentation = BRAND_PRESENTATION['symply-house'];

export function getBrandPresentation(env: Env): BrandPresentation {
  const brand = tryGetAppBrand(env);
  if (brand && BRAND_PRESENTATION[brand]) return BRAND_PRESENTATION[brand];
  // `tryGetAppBrand` only knows the joined app brands; Language resolves here.
  const raw = env.APP_BRAND?.trim();
  if (raw && BRAND_PRESENTATION[raw]) return BRAND_PRESENTATION[raw];
  return DEFAULT_BRAND_PRESENTATION;
}
