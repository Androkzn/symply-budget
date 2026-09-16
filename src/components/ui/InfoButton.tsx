import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useAppColors } from '@theme';

import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { Typography } from './Typography';

export interface InfoSource {
  /** Short citation, e.g. "Feinman et al., Nutrition (2015)". */
  label: string;
  /** Opened in the system browser on tap. */
  url: string;
}

interface InfoButtonProps {
  /** Rich visual explanations can request a larger, scrollable sheet. */
  sheetHeight?: React.ComponentProps<typeof BottomSheet>['height'];
  /** Sheet header title. Omit for a plain, untitled explanation. */
  title?: string;
  /** Plain-text explanation. Ignored when `children` is given. */
  info?: string;
  /**
   * Rich explanation body (charts, per-item breakdowns, …) for anything a
   * single paragraph can't compare cleanly — takes precedence over `info`.
   */
  children?: React.ReactNode;
  /**
   * Real-world references backing this explanation, rendered as tappable
   * links under the body. Omit when there's nothing to cite — an explanation
   * of the app's own behavior (e.g. "what this field feeds into") isn't
   * citing outside research and shouldn't pretend to.
   */
  sources?: InfoSource[];
  /** Toggle testID gets `-toggle`; the sheet body gets `-content` — never the
   * bare id, which would also match this element's own `testID` prop. */
  testID: string;
  accessibilityLabel?: string;
}

/**
 * The app's one "why is this number what it is" affordance — a themed `i` that
 * opens a bottom sheet sized to its own content rather than a fixed fraction
 * of the screen (`height="content"`), since an explanation can be one
 * sentence, several, or a small chart depending on what it's explaining. Uses
 * the chart secondary accent (terracotta in Budget), keeping explanations
 * visually distinct from the primary action color.
 */
export function InfoButton({
  title,
  info,
  children,
  sources,
  testID,
  accessibilityLabel,
  sheetHeight = 'content',
}: InfoButtonProps) {
  const colors = useAppColors();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (title ? `About ${title}` : 'More info')}
        testID={`${testID}-toggle`}
        hitSlop={8}
      >
        <Icon name="information-circle" size={16} color={colors.chartNegative} />
      </Pressable>

      <BottomSheet visible={visible} onClose={() => setVisible(false)} height={sheetHeight} title={title} showCloseButton scrollable>
        <View testID={`${testID}-content`}>
          {children ?? (
            <Typography variant="caption2" color={colors.textSecondary}>
              {info}
            </Typography>
          )}

          {sources && sources.length > 0 && (
            <View style={styles.sources} testID={`${testID}-sources`}>
              <Typography variant="caption2" color={colors.textSecondary}>
                Sources
              </Typography>
              {sources.map((source) => (
                <Pressable
                  key={source.url}
                  onPress={() => void Linking.openURL(source.url).catch(() => {})}
                  accessibilityRole="link"
                  accessibilityLabel={source.label}
                  hitSlop={4}
                  testID={`${testID}-source-${source.url}`}
                >
                  <Typography
                    variant="caption2"
                    color={colors.primary}
                    style={styles.sourceLink}
                  >
                    {source.label}
                  </Typography>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  sources: {
    marginTop: 12,
    gap: 6,
  },
  sourceLink: {
    textDecorationLine: 'underline',
  },
});
