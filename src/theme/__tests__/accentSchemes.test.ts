/**
 * Accent color schemes — the user-selectable Settings → Appearance → Color
 * Scheme picker (Budget only). `classic` must stay byte-identical to the app
 * before accent schemes existed (see accentSchemes.ts / appColors.ts); the
 * alternate schemes (tealCoral, sageTerracotta) must derive a full, distinct
 * color set from just their `primary`/`secondaryAccent` seed.
 *
 * Brand-agnostic by design: runs under whichever brand jest defaults to
 * (symply-house — see jest.setup.js), so assertions compare against
 * `ACCENT_SCHEMES`/`brand.colors` directly rather than hardcoded hex.
 */
import { brand } from '@brand';
import {
  ACCENT_SCHEME_ORDER,
  ACCENT_SCHEMES,
  getDefaultAccentScheme,
  hasMultipleAccentSchemes,
} from '@theme/accentSchemes';
import { getAppColors } from '@theme/appColors';
import { getButtonGradientColors } from '@theme/buttonGradients';
import { getTheme } from '@theme/index';

describe('ACCENT_SCHEMES', () => {
  it('classic mirrors the active brand pack exactly', () => {
    expect(ACCENT_SCHEMES.classic.primary).toBe(brand.colors.primary);
    expect(ACCENT_SCHEMES.classic.primaryDark).toBe(brand.colors.primaryDark);
    expect(ACCENT_SCHEMES.classic.primaryLight).toBe(brand.colors.primaryLight);
  });

  it('every scheme has a primary distinct from its secondaryAccent', () => {
    for (const id of ACCENT_SCHEME_ORDER) {
      const seed = ACCENT_SCHEMES[id];
      expect(seed.primary).not.toBe(seed.secondaryAccent);
    }
  });

  it('tealCoral and sageTerracotta are distinct from classic and each other', () => {
    const { classic, tealCoral, sageTerracotta } = ACCENT_SCHEMES;
    expect(tealCoral.primary).not.toBe(classic.primary);
    expect(sageTerracotta.primary).not.toBe(classic.primary);
    expect(tealCoral.primary).not.toBe(sageTerracotta.primary);
  });
});

describe('getDefaultAccentScheme / hasMultipleAccentSchemes', () => {
  it('defaults Budget to tealCoral and every other brand to classic', () => {
    expect(getDefaultAccentScheme('symply-budget')).toBe('tealCoral');
    expect(getDefaultAccentScheme('symply-house')).toBe('classic');
    expect(getDefaultAccentScheme('symply-kaizen')).toBe('classic');
    expect(getDefaultAccentScheme('symply-language')).toBe('classic');
    expect(getDefaultAccentScheme('symply-health')).toBe('classic');
  });

  it('gates the Settings picker to Budget only', () => {
    expect(hasMultipleAccentSchemes('symply-budget')).toBe(true);
    expect(hasMultipleAccentSchemes('symply-house')).toBe(false);
  });
});

describe('getAppColors — classic is unchanged', () => {
  it('resolves the same primary/chartNegative as before accent schemes existed', () => {
    const light = getAppColors('light', 'classic');
    expect(light.primary).toBe(brand.colors.primary);
    // classic's chart-negative bar must stay pixel-identical to `error`.
    expect(light.chartNegative).toBe(light.error);

    const dark = getAppColors('dark', 'classic');
    expect(dark.chartNegative).toBe(dark.error);
  });

  it('is the default resolution when no scheme is passed, for a non-Budget brand', () => {
    // jest defaults to symply-house (jest.setup.js), whose default scheme is classic.
    expect(getAppColors('light')).toEqual(getAppColors('light', 'classic'));
  });
});

describe('getAppColors — alternate schemes derive a distinct, self-consistent set', () => {
  it.each(['tealCoral', 'sageTerracotta'] as const)('%s', (schemeId) => {
    const seed = ACCENT_SCHEMES[schemeId];
    const light = getAppColors('light', schemeId);
    const dark = getAppColors('dark', schemeId);
    const clean = getAppColors('clean', schemeId);

    expect(light.primary).toBe(seed.primary);
    expect(light.chartNegative).toBe(seed.secondaryAccent);
    expect(dark.chartNegative).toBe(seed.secondaryAccent);
    expect(clean.chartNegative).toBe(seed.secondaryAccent);

    // Never accidentally falls back to the fixed semantic error red.
    expect(light.chartNegative).not.toBe(light.error);

    // Distinct from classic's resolution.
    expect(light.primary).not.toBe(getAppColors('light', 'classic').primary);
  });

  it('tealCoral and sageTerracotta resolve to different color sets', () => {
    const teal = getAppColors('light', 'tealCoral');
    const sage = getAppColors('light', 'sageTerracotta');
    expect(teal.primary).not.toBe(sage.primary);
    expect(teal.chartNegative).not.toBe(sage.chartNegative);
  });
});

describe('getTheme — legacy theme.colors/theme.pastel track the same schemes', () => {
  it('classic matches the brand primary', () => {
    const theme = getTheme('classic', 'light');
    expect(theme.pastel.teal).toBe(brand.colors.primary);
  });

  it('alternate schemes move theme.pastel.teal off the brand primary', () => {
    const theme = getTheme('tealCoral', 'light');
    expect(theme.pastel.teal).toBe(ACCENT_SCHEMES.tealCoral.primary);
    expect(theme.pastel.teal).not.toBe(brand.colors.primary);
  });
});

describe('getButtonGradientColors — CTA ramp follows the scheme', () => {
  it('alternate schemes ramp from primary to primaryDark', () => {
    const seed = ACCENT_SCHEMES.tealCoral;
    const stops = getButtonGradientColors('primary', { schemeId: 'tealCoral' });
    expect(stops[0]).toBe(seed.primary);
    expect(stops[stops.length - 1]).toBe(seed.primaryDark);
  });

  it('classic keeps the brand-generated CTA ramp untouched', () => {
    const classicStops = getButtonGradientColors('primary', { schemeId: 'classic' });
    const defaultStops = getButtonGradientColors('primary');
    expect(classicStops).toEqual(defaultStops);
  });
});
