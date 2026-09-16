/**
 * Color schema tokens — verifies the "clean" skin resolves to the off-white
 * surface set (so cards don't sit as pure white on the white app background,
 * next to the #4ECDC4 mint accent) while "light"/"dark" keep their originals.
 *
 * Pure token assertions — no rendering. Guards the exact hex values from the
 * design table so an accidental palette edit fails loudly.
 */

import { getAppColors } from '@theme/appColors';
import { cleanTheme, darkTheme, lightTheme, palette } from '@theme/index';

describe('palette.clean tokens', () => {
  it('matches the design-table off-white surface values', () => {
    expect(palette.clean).toEqual({
      background: '#FFFFFF',
      surface: '#F7FAFA',
      surfaceSecondary: '#F2F8F7',
      highlight: '#EAF7F5',
      subtle: '#F5F5F2',
      border: '#DDEBE9',
    });
  });
});

describe('getAppColors("clean")', () => {
  const clean = getAppColors('clean');

  it('uses a solid white app background', () => {
    expect(clean.backgroundMain).toBe('#FFFFFF');
  });

  it('uses off-white (not pure white) card/section surfaces', () => {
    expect(clean.card).toBe('#F7FAFA');
    expect(clean.cardBackground).toBe('#F7FAFA');
    expect(clean.backgroundSecondary).toBe('#F7FAFA');
    // The whole point: cards must NOT be pure white on the white background.
    expect(clean.card).not.toBe('#FFFFFF');
  });

  it('uses the soft mint-gray border and mint highlight tint', () => {
    expect(clean.borderColor).toBe('#DDEBE9');
    expect(clean.divider).toBe('#DDEBE9');
    expect(clean.surfaceSelected).toBe('#EAF7F5');
    expect(clean.cardSubtle).toBe('#F5F5F2');
  });

  it('keeps the #4ECDC4 mint as the primary accent', () => {
    expect(clean.primary).toBe('#4ECDC4');
  });
});

describe('getAppColors — light/dark are unchanged by the clean skin', () => {
  it('light keeps pure-white cards', () => {
    expect(getAppColors('light').card).toBe('#FFFFFF');
  });

  it('defaults to light when no mode is given', () => {
    expect(getAppColors()).toBe(getAppColors('light'));
  });

  it('dark stays a distinct surface set', () => {
    expect(getAppColors('dark').backgroundMain).toBe(darkTheme.colors.background);
    expect(getAppColors('dark').card).not.toBe('#F7FAFA');
  });
});

describe('cleanTheme (legacy theme.colors surface)', () => {
  it('is always-light with off-white surfaces', () => {
    expect(cleanTheme.dark).toBe(false);
    expect(cleanTheme.colors.background).toBe('#FFFFFF');
    expect(cleanTheme.colors.surface).toBe('#F7FAFA');
    expect(cleanTheme.colors.surfaceSecondary).toBe('#F2F8F7');
    expect(cleanTheme.colors.border).toBe('#DDEBE9');
  });

  it('differs from lightTheme only in the surface tints', () => {
    expect(cleanTheme.colors.primary).toBe(lightTheme.colors.primary);
    expect(cleanTheme.colors.text).toBe(lightTheme.colors.text);
    expect(cleanTheme.colors.surface).not.toBe(lightTheme.colors.surface);
  });
});
