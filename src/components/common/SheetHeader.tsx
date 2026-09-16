import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Concrete path, not the `@components/ui` barrel: `BottomSheet` lives in that
// barrel and renders this header, so going through it would close a
// ui ⇄ common circular require — the same trap `FloatingActionButton`
// documents, where a partially-initialised export crashes any test that mocks
// one side with `jest.requireActual` on the other.
import { Typography } from '@components/ui/Typography';
import { Header, Layout, Spacing, useAppColors, type AppColors } from '@theme';

import { BackButton } from './BackButton';

type LeftVariant = 'back' | 'close' | 'none';

interface SheetHeaderProps {
  /** Centered title — always rendered with the app's canonical header type ramp. */
  title: string;
  /**
   * How many lines the title may take before it ellipsizes. One by default,
   * which is right for a screen's top bar; a bottom sheet passes 2, because
   * its titles are sentences ("The Science Behind Your Numbers") and it has the
   * vertical room a navigation bar does not.
   */
  titleLines?: number;
  /** Leading control: back chevron, close X, or an empty spacer. */
  leftVariant?: LeftVariant;
  onLeftPress?: () => void;
  leftColor?: string;
  leftTestID?: string;
  leftAccessibilityLabel?: string;
  /** Trailing text action (e.g. "Save", "Edit", "Done"). Ignored if `rightElement` is set. */
  rightLabel?: string;
  onRightPress?: () => void;
  rightDisabled?: boolean;
  /**
   * A save is in flight: the label becomes a spinner and the action stops
   * accepting presses. Kept inside the same button rather than swapped in via
   * `rightElement` so the control keeps its testID and its place — screens used
   * to hand-roll this and each lost one of the two.
   */
  rightLoading?: boolean;
  rightTestID?: string;
  /** Custom trailing element — overrides `rightLabel`. */
  rightElement?: React.ReactNode;
  /**
   * Sheet/modal screens that live under a gesture root need RNGH's
   * `TouchableOpacity` or their header controls go dead. Pass it here; it is
   * threaded to both the leading and trailing buttons.
   */
  TouchableComponent?: React.ElementType;
  /** Cap the header to reading width and center it (iPad detail screens). */
  constrainWidth?: boolean;
  /**
   * Hairline rule under the header, separating it from the body.
   *
   * On by default for `BottomSheet`, which passes it explicitly: a sheet's
   * header floats over scrolling content, and without the rule the title runs
   * visually into the first row. A full screen's own top bar usually draws its
   * own border (`ScreenHeader`) or deliberately has none, so this stays opt-in
   * rather than becoming a second, competing divider.
   */
  showDivider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Canonical header for modal / bottom-sheet / detail screens that render their
 * own top bar (i.e. everything with `headerShown: false` that isn't a
 * `ScreenHeader`). One title ramp, one leading-control family, one trailing
 * action treatment — fully tokenized — so every screen reads the same.
 */
export function SheetHeader({
  title,
  titleLines = 1,
  leftVariant = 'back',
  onLeftPress,
  leftColor,
  leftTestID,
  leftAccessibilityLabel,
  rightLabel,
  onRightPress,
  rightDisabled = false,
  rightLoading = false,
  rightTestID,
  rightElement,
  TouchableComponent = TouchableOpacity,
  constrainWidth = false,
  showDivider = false,
  style,
  testID,
}: SheetHeaderProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const leftSlot =
    leftVariant === 'none' || !onLeftPress ? (
      <View style={styles.sideSpacer} />
    ) : (
      <View style={styles.sideStart}>
        <BackButton
          icon={leftVariant === 'close' ? 'close' : 'chevron-back'}
          onPress={onLeftPress}
          size="md"
          color={leftColor}
          TouchableComponent={TouchableComponent}
          testID={leftTestID}
          accessibilityLabel={leftAccessibilityLabel}
        />
      </View>
    );

  const rightBlocked = rightDisabled || rightLoading;
  const rightSlot = (
    <View style={styles.sideEnd}>
      {rightElement ??
        (rightLabel ? (
          <TouchableComponent
            onPress={onRightPress}
            disabled={rightBlocked}
            activeOpacity={Header.actionActiveOpacity}
            testID={rightTestID}
            accessibilityRole="button"
            accessibilityLabel={rightLabel}
            accessibilityState={{ disabled: rightBlocked, busy: rightLoading }}
            style={styles.action}
          >
            {rightLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Typography
                variant="body"
                weight="semibold"
                color={rightDisabled ? colors.textSecondary : colors.primary}
              >
                {rightLabel}
              </Typography>
            )}
          </TouchableComponent>
        ) : null)}
    </View>
  );

  return (
    <View
      style={[
        styles.header,
        constrainWidth && styles.constrained,
        showDivider && [styles.divided, { borderBottomColor: colors.divider }],
        style,
      ]}
      testID={testID}
    >
      {leftSlot}
      <Typography
        variant="headline"
        weight="semibold"
        numberOfLines={titleLines}
        align="center"
        style={styles.title}
      >
        {title}
      </Typography>
      {rightSlot}
    </View>
  );
}

const makeStyles = (_colors: AppColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Header.paddingHorizontal,
      paddingVertical: Spacing.sm,
      flexShrink: 0,
    },
    divided: {
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    constrained: {
      maxWidth: Layout.readingMaxWidth,
      width: '100%',
      alignSelf: 'center',
    },
    // Both side slots share a min width so the title stays optically centered
    // regardless of the trailing label's length.
    sideStart: {
      minWidth: Header.sideColumnWidth,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    sideEnd: {
      minWidth: Header.sideColumnWidth,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    sideSpacer: {
      minWidth: Header.sideColumnWidth,
    },
    title: {
      flex: 1,
    },
    action: {
      minHeight: Header.actionHeight,
      justifyContent: 'center',
      paddingHorizontal: Spacing.xxs,
    },
  });
