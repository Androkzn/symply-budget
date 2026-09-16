/**
 * The four sources, behind one button.
 *
 * Most surfaces that take an image do not have room for a permanent tile row —
 * an avatar is a circle you tap, a task photo is a "+" in a form, a space cover
 * is a thumbnail. Those all used to open the photo library directly, which is
 * how three of the four sources went missing: there was no list, so there was
 * nothing to add to.
 *
 * This is that list, as a sheet. A surface renders it, points its existing
 * button at `setVisible(true)`, and gets Camera · Gallery · File · Drive
 * without redesigning its own layout.
 *
 * ## Why the sheet hides itself for Drive
 *
 * `CloudFilePicker` is a full-screen `Modal` and so is `BottomSheet`. Nesting
 * one inside the other is the classic iOS double-modal, where the inner one
 * either never appears or cannot be dismissed. So the Drive browse is rendered
 * as a SIBLING here and the sheet steps aside while it is up — the member sees
 * one surface at a time, and dismissing Drive leaves them where they started.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Spacing, useAppColors } from '@theme';

import { ScanImportSources } from './ScanImportSources';
import {
  useAttachmentSources,
  type PickedAttachment,
  type UseAttachmentSourcesOptions,
} from './useAttachmentSources';

export interface AttachmentSourceSheetProps
  extends Omit<UseAttachmentSourcesOptions, 'onPicked'> {
  visible: boolean;
  onClose: () => void;
  /** Files picked from any of the four sources. The sheet closes itself first. */
  onPicked: UseAttachmentSourcesOptions['onPicked'];
  /** Sheet title. Defaults to the generic wording. */
  title?: string;
  /** One line under the title — what this particular surface does with the file. */
  help?: string;
  /**
   * One extra action under the tiles — in practice always "Remove photo".
   *
   * It lives here because the menus this sheet replaces carried it, and a
   * member who opens the photo chooser to CLEAR the photo would otherwise find
   * four ways to add one and no way to take one away. The sheet closes itself
   * before running it, exactly as a pick does.
   */
  extraAction?: {
    label: string;
    onPress: () => void;
    /** Draws it in the error colour. For removals. */
    destructive?: boolean;
    testID?: string;
  };
  /** Per-tile testID = `${testIDPrefix}-${source}`. */
  testIDPrefix?: string;
}

export function AttachmentSourceSheet({
  visible,
  onClose,
  onPicked,
  title = 'Add a photo',
  help,
  extraAction,
  testIDPrefix = 'attachment-source',
  ...options
}: AttachmentSourceSheetProps) {
  const colors = useAppColors();

  const { sourceHandlers, drivePicker, driveOpen } = useAttachmentSources({
    ...options,
    // Close before handing over: the caller may open an editor, push a screen,
    // or show its own progress, and every one of those behind a live sheet is
    // a surface the member cannot reach.
    onPicked: (items: PickedAttachment[], source) => {
      onClose();
      return onPicked(items, source);
    },
  });

  return (
    <>
      <BottomSheet
        visible={visible && !driveOpen}
        onClose={onClose}
        height="content"
        title={title}
        showCloseButton
        closeTestID={`${testIDPrefix}-close`}
      >
        <View style={styles.body} testID={`${testIDPrefix}-sheet`}>
          {help ? (
            <Typography variant="subheadline" color={colors.textSecondary}>
              {help}
            </Typography>
          ) : null}
          <ScanImportSources
            testIDPrefix={testIDPrefix}
            disabled={options.disabled}
            {...sourceHandlers}
          />
          {extraAction ? (
            <Pressable
              onPress={() => {
                onClose();
                extraAction.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={extraAction.label}
              style={styles.extraAction}
              testID={extraAction.testID ?? `${testIDPrefix}-extra`}
            >
              <Typography
                variant="body"
                weight="semibold"
                color={extraAction.destructive ? colors.error : colors.primary}
              >
                {extraAction.label}
              </Typography>
            </Pressable>
          ) : null}
        </View>
      </BottomSheet>
      {drivePicker}
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.base },
  extraAction: { alignItems: 'center', paddingVertical: Spacing.sm },
});
