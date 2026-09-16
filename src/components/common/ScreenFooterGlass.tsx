import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { hexToRgba } from '@theme';

interface ScreenFooterGlassProps {
  /**
   * Blur strength for the frosted band near the button. Defaults to 24 — a
   * middle ground between the floating tab bar's own backdrop band (10) and
   * its opaque capsule (100) that reads as frosted glass without
   * over-blurring the content that scrolls beneath it.
   */
  intensity?: number;
  /**
   * Height of the blur band, bottom-anchored. Defaults to 56 — roughly one
   * button's worth of height, the same proportion the tab bar gives its own
   * blur band relative to its gradient (`insets.bottom + 18` against a
   * `insets.bottom + 120` gradient — the blur covers under a third of the
   * fade, never all of it). Only widen this for a footer with more than one
   * row of content to keep frosted.
   */
  blurHeight?: number;
}

/**
 * Shared "bottom glass" scrim so every sticky footer / pinned-CTA area reads
 * identically to the floating bottom tab bar (see `FloatingTabBar` in
 * `app/(tabs)/_layout.tsx`: `blurBackdrop` + `gradientBackdrop`).
 *
 * Same recipe, in TWO ways it is easy to only half-copy:
 *
 * 1. **The gradient is a plain TWO-stop linear fade** (opaque at the bottom,
 *    transparent at the top) on the theme **`surface`** token, matching the
 *    tab bar's own `[hexToRgba(surface, 1), hexToRgba(surface, 0)]` exactly.
 *    A three-stop version of this used to sit here (0 → 0.85 by the HALFWAY
 *    point, then barely moving) — that front-loaded curve reached "basically
 *    opaque" so early it read as a hard edge, not a fade.
 * 2. **The blur is a SHORT band anchored to the bottom, not the whole fade
 *    zone.** The tab bar's own blur (`blurBackdrop`) is only `insets.bottom +
 *    18` tall against a `insets.bottom + 120` gradient — it covers the
 *    button's immediate surroundings, where the gradient is already mostly
 *    opaque anyway, and leaves the WHOLE upper part of the fade to the
 *    gradient alone. A blur that spans the entire zone (this component's own
 *    earlier version) has a hard "blur starts here" seam at ITS top edge,
 *    laid on top of whatever the gradient is doing — visible exactly where
 *    the transition is supposed to read as smooth. More blur near the
 *    button, ~none at the top, is the whole point.
 *
 * This is the single source of truth for the recipe; before it existed,
 * footers each hardcoded their own scrim on a different token
 * (`backgroundMain`, `backgroundSecondary`), so nothing matched the tab bar.
 *
 * Render it as the FIRST child of an absolutely-positioned, `overflow: 'hidden'`
 * footer container — the gradient fills the parent (`StyleSheet.absoluteFill`)
 * and paints behind whatever content the container lays out on top of it.
 * Give that container enough height ABOVE the button (`paddingTop`) for the
 * fade to read as gradual — the tab bar gives its own equivalent band ~120pt,
 * not a few points, precisely so the ramp has room to be soft.
 */
export function ScreenFooterGlass({ intensity = 24, blurHeight = 56 }: ScreenFooterGlassProps) {
  const { theme } = useTheme();
  const surface = theme.colors.surface;
  const blurTint = theme.dark ? 'dark' : 'light';

  return (
    <>
      {/* Transparent at the top so scrolling content melts into the bar, ramping
          LINEARLY to fully-opaque `surface` at the bottom where the CTA reads
          crisply — the exact same two-stop shape as the tab bar's backdrop
          scrim, on the same `surface` token, not an approximation of it. */}
      <LinearGradient
        colors={[hexToRgba(surface, 0), hexToRgba(surface, 1)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Blur concentrated near the button ONLY — see the class doc above for
          why this is short and bottom-anchored rather than filling the same
          area as the gradient. */}
      <BlurView
        intensity={intensity}
        tint={blurTint}
        style={[styles.blurBand, { height: blurHeight }]}
        pointerEvents="none"
      />
    </>
  );
}

const styles = StyleSheet.create({
  blurBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
