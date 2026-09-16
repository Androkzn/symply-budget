import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { gradients } from '@brand/tokens.generated';
import { useTheme } from '@contexts/ThemeContext';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppColors } from '@theme/appColors';

interface AppBackgroundProps {
  children: React.ReactNode;
  /**
   * @deprecated Retained for API compatibility with call sites that used to
   * dim the splash image. The brand gradient ignores it.
   */
  opacity?: number;
  /** Optional solid tint drawn over the brand gradient (rarely needed). */
  overlayColor?: string;
  /**
   * Reserve leading space for the iPad sidebar tab bar. Default true.
   * Disable for screens that opt out of sidebar layout (e.g. fullscreen
   * editors that draw their own chrome).
   */
  reserveSidebarInset?: boolean;
  /**
   * Identifier for the screen this background wraps.
   *
   * Screens pass one so Maestro can wait on "the screen is up" without picking
   * an inner element that only exists in one of the branches. It was being
   * passed already — `BriefingHistoryScreen` set it on its populated branch —
   * and silently dropped, because the prop did not exist here: `tsc` flagged
   * it, the value never reached a rendered node, and the E2E flow waited for a
   * testID that was not in the hierarchy on ANY branch.
   */
  testID?: string;
}

/**
 * Theme-aware app background with a very light brand gradient.
 *
 * Light mode uses `gradients.lightBackground` from the active brand's DTCG
 * tokens (white → faint primary tint). Dark mode uses `gradients.darkBackground`.
 * A solid `backgroundMain` fill sits underneath so content never flashes through
 * before the gradient paints.
 */
export function AppBackground({
  children,
  overlayColor,
  reserveSidebarInset = true,
  testID,
}: AppBackgroundProps) {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const { sidebarInset } = useLayoutPadding();
  const leadingInset = reserveSidebarInset ? sidebarInset : 0;

  const bg = isDark ? gradients.darkBackground : gradients.lightBackground;

  return (
    <View
      style={[styles.container, { backgroundColor: colors.backgroundMain }]}
      testID={testID}
    >
      <LinearGradient
        colors={[...bg.colors]}
        locations={[...bg.locations]}
        start={bg.start}
        end={bg.end}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {overlayColor ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]}
          pointerEvents="none"
        />
      ) : null}
      <View style={[styles.content, { paddingLeft: leadingInset }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
