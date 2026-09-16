import React from 'react';
import { StyleSheet, View } from 'react-native';

// Concrete path, not the `@components/common` barrel this file is part of.
import { Sheet, Spacing, useAppColors } from '@theme';

import { SheetHeader } from './SheetHeader';

interface OverlaySheetHeaderProps {
  title: string;
  /** Dismiss — wired to the standard glass ✕ on the left. */
  onClose: () => void;
  /** Overrides the ✕'s test id, for a flow that already drives a screen-specific one. */
  closeTestID?: string;
  /**
   * Trailing commit (Save / Add). Left off for a picker that commits on tap,
   * so the slot reads as "there is nothing to confirm here" rather than
   * carrying a second way to dismiss — which is what the hand-rolled "Done"
   * these headers used to end in actually was.
   */
  action?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    testID?: string;
  };
}

/**
 * Grabber + standard header for a sheet that CANNOT be a `BottomSheet`.
 *
 * iOS presents one modal per view controller, so a sheet opened while another
 * modal is already up (a category / member picker inside a form modal) has to
 * be an absolutely positioned overlay inside that same modal — a sibling
 * `<Modal>` silently never appears. Those overlays each grew their own header,
 * and they drifted: a bare title beside a teal "Done", no grabber, no rule,
 * and in one case (Savings → recurring payments) a header style carrying only
 * `paddingVertical`, so the title sat flush at x=0 and "Done" wrapped below it.
 *
 * This is the one place that chrome is defined, so an overlay sheet is
 * indistinguishable from a real `BottomSheet`: same grabber, same glass ✕ on
 * the left, same centred title, same hairline rule under it.
 */
export function OverlaySheetHeader({
  title,
  onClose,
  closeTestID,
  action,
}: OverlaySheetHeaderProps) {
  const colors = useAppColors();

  return (
    <>
      <View style={styles.grabberWrap}>
        <View style={[styles.grabber, { backgroundColor: colors.textTertiary }]} />
      </View>
      <SheetHeader
        title={title}
        titleLines={2}
        leftVariant="close"
        onLeftPress={onClose}
        {...(closeTestID ? { leftTestID: closeTestID } : {})}
        leftAccessibilityLabel="Close"
        {...(action
          ? {
              rightLabel: action.label,
              onRightPress: action.onPress,
              rightDisabled: Boolean(action.disabled),
              ...(action.testID ? { rightTestID: action.testID } : {}),
            }
          : {})}
        showDivider
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Same metrics as `BottomSheet`'s own handle, so the two are indistinguishable.
  grabberWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  grabber: {
    width: Sheet.handleWidth,
    height: Sheet.handleHeight,
    borderRadius: Sheet.handleRadius,
  },
});
