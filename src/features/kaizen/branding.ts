/**
 * Kaizen brand primitives — deliberately screen-free so shared chrome
 * (`HeaderLogo`, auth screens) can import the brand check and wordmark gradient
 * without pulling the Kaizen screen graph, which would create an import cycle
 * (screens → ScreenHeader → HeaderLogo → here).
 */
import { brandId, hasBrandCapability } from '@brand';

export function isKaizenBrand(id: string = brandId): boolean {
  return hasBrandCapability('kaizenApi', id);
}

/**
 * Kaizen wordmark gradient — the brand wave family (mint → teal → blue →
 * violet), theme-aware so the app name keeps contrast on both the navy (dark)
 * and lavender/white (light) surfaces. Bespoke decorative colours, hence the
 * raw hex literals. Shared by the login screen and `HeaderLogo` so the gradient
 * app name renders identically everywhere it appears beside the logo.
 */
export const KAIZEN_WORDMARK_GRADIENT_DARK = ['#EAF2FF', '#DDE8FF', '#CFE0FF'];
export const KAIZEN_WORDMARK_GRADIENT_LIGHT = ['#123F57', '#16345A', '#1B356A'];
