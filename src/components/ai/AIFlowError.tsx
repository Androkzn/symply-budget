/**
 * AIFlowError — the inline failure card for the BYOK flow's sticky footers.
 *
 * Why a card and not just red `Typography`: `AIFlowScaffold`'s footer is an
 * absolutely-positioned overlay, and its `ScreenFooterGlass` scrim ramps from
 * FULLY TRANSPARENT at the top to opaque only down at the button. Anything laid
 * out above the CTA therefore floats over the still-scrolling body — bare red
 * text landed on top of the disclosure bullets and read as a rendering glitch
 * rather than as an error. This paints its own solid fill, so it always has a
 * floor, and the icon + hairline border make it look deliberate.
 *
 * Theme-aware and brand-neutral: the fill is the error token mixed almost all
 * the way to the card surface, so it stays a soft blush in light mode and a
 * deep maroon in dark, never a shouty block of red.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Typography } from '@components/ui';
import { hexToRgba, mixHex, useAppColors } from '@theme';

interface AIFlowErrorProps {
  /** Already user-facing copy — never a raw axios/system message. */
  message: string;
  testID?: string;
}

export function AIFlowError({ message, testID }: AIFlowErrorProps) {
  const colors = useAppColors();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: mixHex(colors.error, colors.cardBackground, 0.88),
          borderColor: hexToRgba(colors.error, 0.45),
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Icon name="alert-circle" size={18} color={colors.error} style={styles.icon} />
      <Typography variant="footnote" color={colors.textPrimary} style={styles.text}>
        {message}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  icon: { marginTop: 1 },
  text: { flex: 1, lineHeight: 18 },
});
