/**
 * ScreenFooterGlass — the single source of truth for the app's "bottom glass"
 * so every sticky footer / pinned-CTA reads identically to the floating bottom
 * tab bar. Locks the recipe: an expo-blur BlurView + a LinearGradient on the
 * theme `surface` token that fades transparent-top → fully-opaque-bottom.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { ScreenFooterGlass } from '../ScreenFooterGlass';

const alphaOf = (rgba: string): number =>
  Number(rgba.replace(/\s/g, '').replace(/^rgba?\(.*,(.*)\)$/, '$1'));
const rgbOf = (rgba: string): string =>
  rgba.replace(/\s/g, '').replace(/^rgba?\((\d+,\d+,\d+),.*\)$/, '$1');

describe('ScreenFooterGlass', () => {
  it('layers a BlurView + a surface-token gradient fading transparent → opaque', () => {
    const renderer = renderOnDevice('iPhone 14 Pro', <ScreenFooterGlass />);

    // The frosted glass.
    expect(renderer.root.findAllByType(BlurView).length).toBeGreaterThan(0);

    const gradient = renderer.root.findByType(LinearGradient);
    const colors: string[] = gradient.props.colors;

    // Built with hexToRgba → rgba() strings (matching the tab bar), NOT the old
    // 8-digit-hex scrim.
    expect(colors.every((c) => c.startsWith('rgba('))).toBe(true);

    // Transparent at the top edge, fully opaque at the bottom where the CTA sits.
    expect(alphaOf(colors[0])).toBe(0);
    expect(alphaOf(colors[colors.length - 1])).toBe(1);

    // Every stop is the SAME colour (one token) — only the alpha ramps.
    const uniqueRgb = new Set(colors.map(rgbOf));
    expect(uniqueRgb.size).toBe(1);

    // Painted top→bottom.
    expect(gradient.props.start).toEqual({ x: 0, y: 0 });
    expect(gradient.props.end).toEqual({ x: 0, y: 1 });
  });

  /**
   * A three-stop version of this gradient (0 → 0.85 by the HALFWAY point,
   * then barely moving) used to sit here — reaching "basically opaque" that
   * early reads as a hard edge, not a fade, and does NOT match the tab bar's
   * own plain two-stop linear ramp (`backdropColors` in `app/(tabs)/_layout.tsx`).
   * A caller with a short fade zone (a few points of `paddingTop` above the
   * button) made the edge especially visible, but the wrong CURVE was the
   * actual bug — this locks in the fix so it cannot silently regress.
   */
  it('is a plain two-stop linear fade, not a front-loaded curve', () => {
    const renderer = renderOnDevice('iPhone 14 Pro', <ScreenFooterGlass />);
    const gradient = renderer.root.findByType(LinearGradient);
    expect(gradient.props.colors.length).toBe(2);
    expect(gradient.props.locations).toBeUndefined();
  });

  it('forwards a custom blur intensity to the BlurView', () => {
    const renderer = renderOnDevice('iPhone 14 Pro', <ScreenFooterGlass intensity={60} />);
    const blur = renderer.root.findByType(BlurView);
    expect(blur.props.intensity).toBe(60);
  });

  it('defaults the blur intensity when none is provided', () => {
    const renderer = renderOnDevice('iPhone 14 Pro', <ScreenFooterGlass />);
    const blur = renderer.root.findByType(BlurView);
    expect(blur.props.intensity).toBe(24);
  });

  /**
   * The gradient alone used to be paired with a blur that filled the SAME
   * `StyleSheet.absoluteFill` area — full blur strength starting right at the
   * top edge of the fade zone, independent of the gradient's own transparency
   * ramp. That reads as a hard "blur starts here" seam exactly where the
   * transition is supposed to be smooth. The fix (matching the tab bar's own
   * `blurBackdrop`/`gradientBackdrop` split) is a SHORT blur band anchored to
   * the bottom, leaving the top of the fade to the gradient alone.
   */
  it('anchors the blur to the bottom in a short band, not the full fade zone', () => {
    const renderer = renderOnDevice('iPhone 14 Pro', <ScreenFooterGlass />);
    const blur = renderer.root.findByType(BlurView);
    const style = Array.isArray(blur.props.style) ? Object.assign({}, ...blur.props.style) : blur.props.style;
    expect(style.bottom).toBe(0);
    expect(typeof style.height).toBe('number');
    expect(style.height).toBeLessThan(100);
  });

  it('lets a caller widen the blur band via blurHeight', () => {
    const renderer = renderOnDevice('iPhone 14 Pro', <ScreenFooterGlass blurHeight={90} />);
    const blur = renderer.root.findByType(BlurView);
    const style = Array.isArray(blur.props.style) ? Object.assign({}, ...blur.props.style) : blur.props.style;
    expect(style.height).toBe(90);
  });
});
