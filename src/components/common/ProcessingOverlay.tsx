import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ProgressBar } from '@components/ui/ProgressBar';
import { Spacing, useAppColors } from '@theme';

export interface ProcessingOverlayProps {
  /** Show the blocking overlay. */
  visible: boolean;
  /**
   * Primary line under the spinner — e.g. `Reading your statement…`.
   * Defaults to a neutral `Working…`.
   */
  message?: string;
  /** Optional secondary caption, e.g. `Extracting details with AI`. */
  caption?: string;
  /**
   * Determinate progress in [0, 1] — renders a bar under the caption. Pass it
   * ONLY for a stage whose end is genuinely known (bytes uploaded, files
   * prepared). A bar that creeps on a timer reads as truth and then stalls,
   * which is worse than the spinner alone; leave this undefined and let the
   * spinner carry an open-ended wait.
   */
  progress?: number;
  /**
   * Optional third line for live detail under the caption, e.g. `12 items read`
   * while an AI extraction streams. Use it when work is verifiably advancing
   * but the remaining amount is unknowable.
   */
  detail?: string;
  /**
   * Render only the scrim + card (no `Modal` wrapper), for placing INSIDE a
   * component that is already a `Modal` (e.g. a file picker). The default
   * `false` renders the self-contained full-screen blocking modal.
   */
  embedded?: boolean;
  testID?: string;
}

/**
 * Full-screen blocking loading overlay — one scrim + a centred card with the
 * branded [ActivityIndicator] brush spinner and a message. Lifted from the
 * inline `Downloading file…` / `Reading your bill…` overlays that were copied
 * across CloudFilePicker, AddUtilityBillScreen and AddPropertyTaxScreen.
 *
 * Rendered inside a transparent `Modal` (`statusBarTranslucent`), so it sits
 * ABOVE the screen header and tab bar, **blocks every touch**, and swallows the
 * Android hardware back button (`onRequestClose` is a no-op). Use it to gate any
 * screen while an unskippable async job runs — AI scan/import, a file download,
 * a save the user must not interrupt. Pair it with a `beforeRemove` /
 * `gestureEnabled={!busy}` guard if you also need to block the iOS swipe-back.
 */
export function ProcessingOverlay({
  visible,
  message = 'Working…',
  caption,
  progress,
  detail,
  embedded = false,
  testID = 'processing-overlay',
}: ProcessingOverlayProps) {
  const colors = useAppColors();

  const body = (
    <View style={styles.overlay} testID={testID} accessibilityViewIsModal>
      <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Typography variant="body" color={colors.textPrimary} style={styles.message}>
          {message}
        </Typography>
        {caption ? (
          <Typography variant="caption1" color={colors.textSecondary} style={styles.caption}>
            {caption}
          </Typography>
        ) : null}
        {progress != null ? (
          <View style={styles.progress}>
            <ProgressBar progress={progress} height={6} testID={`${testID}-bar`} />
          </View>
        ) : null}
        {detail ? (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            style={styles.caption}
            testID={`${testID}-detail`}
          >
            {detail}
          </Typography>
        ) : null}
      </View>
    </View>
  );

  if (embedded) return visible ? body : null;

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={() => {}}>
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: Spacing.xxl,
    borderRadius: 16,
    alignItems: 'center',
    maxWidth: '80%',
  },
  message: { marginTop: Spacing.base, textAlign: 'center' },
  caption: { marginTop: Spacing.xxs, textAlign: 'center' },
  // Narrower than the card so the bar reads as a detail of the message rather
  // than a second element competing with the spinner.
  progress: { marginTop: Spacing.sm, width: 160 },
});
