/**
 * Per-brand login identity — the gradient wordmark, slogan, and subtitle shown
 * on the auth screens, so every app gets the same treatment in its own colours.
 *
 * Colours are tuned to stay readable in BOTH modes: `wordmark` gradients are
 * dark on the light (white) surface and light on the dark (navy) surface;
 * `sloganGradient` sits in the brand accent at a mid-tone that reads on both.
 * `slogan` / `subtitle` are brand copy — edit freely.
 */
import type { AccentSchemeId } from '@theme/accentSchemes';

export type BrandLoginTheme = {
  slogan: string;
  subtitle: string;
  wordmark: { light: string[]; dark: string[] };
  sloganGradient: { light: string[]; dark: string[] };
};

const THEMES: Record<string, BrandLoginTheme> = {
  'symply-kaizen': {
    slogan: '', // intentionally hidden on the Kaizen login (see LoginScreen tagline guard)
    subtitle: 'Focus. Practice. Progress.',
    wordmark: { light: ['#123F57', '#16345A', '#1B356A'], dark: ['#EAF2FF', '#DDE8FF', '#CFE0FF'] },
    sloganGradient: { light: ['#1FB89C', '#2AA8C6'], dark: ['#5FE6C6', '#49D6E6'] },
  },
  'symply-house': {
    slogan: 'Home, Handled',
    subtitle: 'Inspect. Maintain. Relax.',
    wordmark: { light: ['#0E6E72', '#12667E', '#175E86'], dark: ['#B6F0EA', '#A6E8F2', '#C6E4FF'] },
    sloganGradient: { light: ['#1FA89C', '#2AA0B8'], dark: ['#5FE0C6', '#49D2E8'] },
  },
  'symply-budget': {
    slogan: 'Money, Mastered',
    subtitle: 'Plan. Spend. Save.',
    wordmark: { light: ['#146A44', '#12785C', '#12787E'], dark: ['#B6F0C6', '#A6EEC8', '#B0EAD8'] },
    sloganGradient: { light: ['#1F9A6C', '#26A890'], dark: ['#5FE0A0', '#49D6C2'] },
  },
  'symply-language': {
    slogan: 'Fluency, Faster',
    subtitle: 'Learn. Speak. Master.',
    wordmark: { light: ['#A8501E', '#B85E2A', '#BE6A42'], dark: ['#FFE2BA', '#FFD2A0', '#FFC2AE'] },
    sloganGradient: { light: ['#C2662E', '#CE7A44'], dark: ['#FFC48A', '#FFA870'] },
  },
  'symply-health': {
    slogan: 'Health, Simplified',
    subtitle: 'Track. Move. Thrive.',
    wordmark: { light: ['#A02830', '#BA3444', '#B03460'], dark: ['#FFD0C6', '#FFB6B2', '#FFB8CE'] },
    sloganGradient: { light: ['#C1383C', '#CE4A62'], dark: ['#FF9A8A', '#FF8AA8'] },
  },
};

/**
 * Budget-only alternates for non-`classic` accent schemes (see
 * `@theme/accentSchemes`) — sweeps the wordmark/slogan through the scheme's
 * own primary → secondaryAccent pair instead of the classic green wordmark.
 * `classic` (and every other brand) uses the base `THEMES` entry above.
 */
const BUDGET_SCHEME_THEMES: Partial<
  Record<AccentSchemeId, Pick<BrandLoginTheme, 'wordmark' | 'sloganGradient'>>
> = {
  tealCoral: {
    wordmark: { light: ['#0A756C', '#14B8A6', '#F97316'], dark: ['#B6D6D3', '#85DAD1', '#FDCAA6'] },
    sloganGradient: { light: ['#14B8A6', '#F97316'], dark: ['#93DED6', '#FDC69F'] },
  },
  sageTerracotta: {
    wordmark: { light: ['#55715A', '#84A98C', '#D85D3D'], dark: ['#CCD4CE', '#BFD2C3', '#F0C1B5'] },
    sloganGradient: { light: ['#84A98C', '#D85D3D'], dark: ['#C6D7CA', '#EFBDAF'] },
  },
};

export function getBrandLoginTheme(id: string, accentScheme?: AccentSchemeId): BrandLoginTheme {
  const base = THEMES[id] ?? THEMES['symply-kaizen'];
  if (id === 'symply-budget' && accentScheme) {
    const override = BUDGET_SCHEME_THEMES[accentScheme];
    if (override) return { ...base, ...override };
  }
  return base;
}

/**
 * The app-name wordmark gradient — a clear colour transition, not the
 * near-monochrome `wordmark` stops on their own. Anchors the brand's deep,
 * legible wordmark tone and sweeps into its vibrant accent (the same accent as
 * the login slogan), theme-aware so it reads on both the navy (dark) and
 * lavender/white (light) surfaces. Shared by the login screen and `HeaderLogo`
 * so the app name renders identically everywhere it appears beside the logo.
 */
export function getBrandWordmarkGradient(
  id: string,
  isDark: boolean,
  accentScheme?: AccentSchemeId
): string[] {
  const theme = getBrandLoginTheme(id, accentScheme);
  const wordmark = isDark ? theme.wordmark.dark : theme.wordmark.light;
  const accent = isDark ? theme.sloganGradient.dark : theme.sloganGradient.light;
  return [wordmark[0], ...accent];
}
