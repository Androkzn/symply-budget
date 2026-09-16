import React from 'react';

import { BrandBackground } from './BrandBackground';

/**
 * Auth-screen backdrop for every brand — the shared `BrandBackground`
 * atmosphere (a low-saturation base gradient + two faint corner glows + a
 * glowing wave ribbon rendered in the active brand's own colour family, per the
 * Simple Kaizen Gradient & Glass guide §3). Purely cosmetic and
 * non-interactive; render it as the first child of the auth screen's background
 * View so the form draws on top. Login / Register / forgot-password /
 * accept-invite share it — do not fork per brand (colours come from the brand).
 */
export function AuthWave() {
  return <BrandBackground />;
}
