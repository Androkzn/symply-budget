import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  type LayoutChangeEvent,
  Modal,
  TouchableOpacity,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Concrete path, not the `@components/common` barrel: that barrel re-exports
// screens' headers which import from `@components/ui` — the barrel this file
// is part of — so going through it would close a ui ⇄ common circular require.
import { SheetHeader } from '@components/common/SheetHeader';
import { useDeviceType } from '@hooks/useDeviceType';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';
import { Elevation, Layout, Opacity, Sheet, Spacing, useAppColors } from '@theme';

/**
 * The one action a sheet header may carry on the right — Save, Done, Add.
 *
 * Deliberately a data prop rather than a node: every sheet in the app then
 * words and styles its commit the same way, and a caller cannot quietly grow a
 * second control into the slot. Use `headerRight` for the rare non-text case.
 */
export interface BottomSheetHeaderAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks presses while a save is in flight. */
  loading?: boolean;
  testID?: string;
}

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * `content` hugs whatever `children` actually measure out to (capped at the
   * `tall` fraction so a surprisingly long body still has a ceiling) instead
   * of committing to one of the fixed fractions up front — for short,
   * variable-length bodies like an info sheet, where a fixed fraction would
   * either clip nothing (too tall, wasted backdrop) or clip everything
   * (too short, unreadable).
   */
  height?: 'short' | 'standard' | 'tall' | 'full' | 'content';
  children: React.ReactNode;
  title?: string;
  showHandle?: boolean;
  noPadding?: boolean;
  /** Scroll a fixed-height body. Leave false when children own a list or navigator. */
  scrollable?: boolean;
  disableSwipe?: boolean;
  /**
   * Show the circular glass close (✕) at the LEFT of the header. ON BY DEFAULT:
   * ✕ left, title centred, commit right is the app-wide standard, and 64 of the
   * 65 call sites were already passing it by hand — making it the default is
   * what stops the 65th from quietly drifting. Pass `false` only for a sheet
   * that genuinely owns its own dismiss chrome (a hosted navigation stack).
   */
  showCloseButton?: boolean;
  /**
   * Overrides the close button's `bottom-sheet-close` testID. Only for sheets
   * whose own id a Maestro flow already drives — a new sheet should take the
   * standard one rather than inventing another.
   */
  closeTestID?: string;
  /**
   * The header's right-hand commit — Save / Done / Add. Left empty on a sheet
   * that only presents (an info sheet, a picker that commits on tap), so the
   * slot reads as "there is nothing to confirm here" rather than being filled
   * with a second way to dismiss.
   */
  headerAction?: BottomSheetHeaderAction;
  /**
   * Escape hatch for a right-hand control that is not a text commit — an icon
   * button, a segmented toggle. Takes the same slot as `headerAction` and wins
   * when both are given.
   */
  headerRight?: React.ReactNode;
  /** Optional background override. Defaults to colors.backgroundMain. */
  backgroundColor?: string;
  /** Override centered iPad sheet max width (defaults to Layout.formSheetWidth). */
  sheetMaxWidth?: number;
  /**
   * iPad sheet vertical placement. `bottom` always anchors to the screen bottom
   * (required for near-full sheets like Task Details — avoids a gray backdrop band).
   */
  presentation?: 'auto' | 'bottom' | 'centered';
}

function heightForKey(key: 'short' | 'standard' | 'tall' | 'full', windowHeight: number) {
  const f = {
    short: Sheet.heightFractionShort,
    standard: Sheet.heightFractionStandard,
    tall: Sheet.heightFractionTall,
    full: Sheet.heightFractionFull,
  }[key];
  return windowHeight * f;
}

export function BottomSheet({
  visible,
  onClose,
  height = 'standard',
  children,
  title,
  showHandle = true,
  noPadding = false,
  scrollable = false,
  disableSwipe = false,
  showCloseButton = true,
  closeTestID = 'bottom-sheet-close',
  headerAction,
  headerRight,
  backgroundColor,
  sheetMaxWidth,
  presentation = 'auto',
}: BottomSheetProps) {  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width } = useWindowDimensions();
  const { isIPad } = useDeviceType();
  const isSidebarVisible = useTabBarVisibilityStore(store => store.isSidebarVisible);
  const useCenteredSheet =
    presentation === 'centered'
      ? isIPad && width >= Layout.sidebarBreakpoint
      : presentation === 'bottom'
        ? false
        : isIPad && width >= Layout.sidebarBreakpoint && height !== 'full';
  const useBottomAnchoredFull = !useCenteredSheet && height === 'full' && isIPad;
  const useFormSheetWidth =
    isIPad && width >= Layout.sidebarBreakpoint && !useBottomAnchoredFull;
  // When the sidebar is rendered, offset the modal so it only covers the content
  // area — not the sidebar. Sidebar is 320pt (full, width >= 1180) or 92pt (compact).
  const sidebarInset = isSidebarVisible
    ? (width >= 1180 ? Layout.sidebarWidth : Layout.sidebarCompactWidth)
    : 0;
  const isContentHeight = height === 'content';
  // A keyboard steals room from the bottom, so every height below is computed
  // against what's LEFT above it. Without this the sheet keeps its full-screen
  // ceiling, gets lifted clear of the keyboard, and runs off the top edge.
  // A bottom-anchored full-bleed iPad sheet is the one exception: it is meant to
  // reach the top, and `sheetInnerFullBleed` already pads for the status bar.
  const keyboardInset = useKeyboardInset();
  const availableHeight = windowHeight - keyboardInset;
  // Used as BOTH the ceiling `maxHeight` or a content-sized sheet is allowed to
  // grow to, and the distance it slides in from — never the literal rendered
  // height (that comes from `children` instead, via `flex: 0` below).
  const contentCapHeight = Math.min(
    heightForKey('tall', windowHeight),
    availableHeight - insets.top - Spacing.xxl,
  );
  const sheetHeight = isContentHeight
    ? contentCapHeight
    : useCenteredSheet
      ? Math.min(heightForKey(height, windowHeight), availableHeight - Spacing.xxl * 2)
      : useBottomAnchoredFull
        ? windowHeight
        : Math.min(heightForKey(height, windowHeight), availableHeight - insets.top);
  const hasHeaderControls = showCloseButton || headerAction != null || headerRight != null;
  const hasHeader = Boolean(title) || hasHeaderControls;
  // An iPad sheet floating in the middle of the screen has nothing beneath it —
  // the home indicator sits under the backdrop, not under the sheet — so it is
  // the one placement that must not reserve room for it.
  const bottomInset = useCenteredSheet ? 0 : insets.bottom;
  // Natural height of a content sheet's children, measured rather than inferred
  // — see the note at the render site. `null` until the first layout, which is
  // deliberately the hugging case: a body that fits must never flash a scroller.
  const [measuredBody, setMeasuredBody] = useState<number | null>(null);
  const handleBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    // Ignore sub-pixel jitter, which would otherwise re-render on every layout.
    setMeasuredBody(prev => (prev !== null && Math.abs(prev - next) < 1 ? prev : next));
  }, []);
  /**
   * Height of everything above the body — the drag handle and the header row.
   *
   * Measured for the same reason the body is: it is a sum of a handle, two
   * paddings, a header min-height and whatever a wrapped two-line title adds,
   * and a hardcoded guess at it is wrong on exactly the sheets that matter.
   */
  const [measuredChrome, setMeasuredChrome] = useState(0);
  const handleChromeLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setMeasuredChrome(prev => (Math.abs(prev - next) < 1 ? prev : next));
  }, []);
  /** What is left of the cap for the body once the chrome has taken its share. */
  const bodyViewportHeight = Math.max(contentCapHeight - measuredChrome, 0);
  const bodyPaddingBottom = Spacing.xl + bottomInset;
  /**
   * Scroll when the body plus its own bottom padding no longer fits the room
   * left under the chrome — NOT when the body alone exceeds the whole cap.
   *
   * The difference is the bug this comparison used to have. The frame's ceiling
   * is `contentCapHeight`, but the body only ever gets `cap − handle − header`,
   * and its padding eats more still — around 140pt on an iPhone. So every body
   * measuring between `cap − 140` and `cap` passed the "fits" test, rendered in
   * a plain hugging View, and had its last 140pt cut off by `sheetInner`'s
   * `overflow: hidden` with no scroller to reach them. Reported on Budget's
   * recovery-phrase sheet (2026-09-02): the twelve words showed, the Drive /
   * Device / Share row was sliced in half, and Done was gone entirely.
   */
  const needsBodyScroll =
    measuredBody !== null && measuredBody + bodyPaddingBottom > bodyViewportHeight;

  const slideAnim = useRef(new Animated.Value(sheetHeight)).current;
  const disableSwipeRef = useRef(disableSwipe);
  disableSwipeRef.current = disableSwipe;

  const resolvedBg = backgroundColor ?? colors.backgroundMain;

  // Shadow lives on a wrapper that has NO radius and NO background. The
  // rounded, clipped child below casts the shadow — iOS uses the child's
  // shape to compute the shadow path, so we keep the soft drop shadow
  // without doubling up rounded-corner layers (which causes visible
  // sub-pixel "horns" at the top corners).
  const shadowStyle = useMemo(
    () =>
      Platform.select({
        ios: {
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: Opacity.sheetRaised,
          shadowRadius: 10,
        },
        android: {
          elevation: Elevation.overlay,
        },
      }),
    [colors.black]
  );

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        ...Sheet.spring,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: sheetHeight,
        duration: Sheet.dismissAnimDurationMs,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, sheetHeight, slideAnim]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        !disableSwipeRef.current &&
        gestureState.dy > Sheet.panMoveMinY &&
        gestureState.vy > Sheet.panVelocityMin,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          slideAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > Sheet.panDismissDistance || gestureState.vy > Sheet.panDismissVelocity) {
          onClose();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            ...Sheet.spring,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      {visible ? (
      <View
        testID="bottom-sheet-overlay"
        style={[
          styles.overlay,
          useCenteredSheet && styles.overlayCentered,
          // Push the backdrop and sheet to start after the sidebar so the sidebar
          // is never dimmed or obscured by the modal. The paddingLeft on top of
          // overlayCentered's paddingHorizontal overrides just the left side.
          sidebarInset > 0 && { paddingLeft: sidebarInset + (useCenteredSheet ? Spacing.xl : 0) },
          // Lift the sheet off the keyboard. On a centered (iPad) sheet the
          // overlay centres its child, so the same inset re-centres it in the
          // space that's left rather than pushing it up by the full amount.
          // Full-bleed sheets own the whole screen and stay put.
          keyboardInset > 0 && !useBottomAnchoredFull && { paddingBottom: keyboardInset },
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.modalBackdrop },
            { pointerEvents: useBottomAnchoredFull ? ('none' as const) : ('auto' as const) },
          ]}
          activeOpacity={1}
          onPress={onClose}
        />

        <Animated.View
          testID="bottom-sheet-frame"
          style={[
            styles.sheet,
            shadowStyle,
            {
              height: isContentHeight ? undefined : sheetHeight,
              maxHeight: isContentHeight ? sheetHeight : undefined,
              width: useFormSheetWidth ? '100%' : undefined,
              maxWidth: useFormSheetWidth ? (sheetMaxWidth ?? Layout.formSheetWidth) : undefined,
              alignSelf: useFormSheetWidth ? 'center' : undefined,
              transform: [{ translateY: slideAnim }],
            },
          ]}
          pointerEvents="auto"
        >
          <View
            style={[
              styles.sheetInner,
              useCenteredSheet && styles.sheetInnerCentered,
              useBottomAnchoredFull && styles.sheetInnerFullBleed,
              useBottomAnchoredFull && { paddingTop: insets.top },
              isContentHeight && styles.sheetInnerContent,
              { backgroundColor: resolvedBg },
            ]}
          >
          {/* Handle + header are measured as one block: what is left of the
              height cap after them is all the body can have, and the content
              sheet below has to know that number before it can decide whether
              the body fits or has to scroll. */}
          <View testID="bottom-sheet-chrome" onLayout={handleChromeLayout}>
          {showHandle && (
            <View
              style={styles.handleContainer}
              {...(!disableSwipe && panResponder.panHandlers)}
            >
              <View
                style={[
                  styles.handle,
                  { backgroundColor: colors.textTertiary, width: Sheet.handleWidth },
                ]}
              />
            </View>
          )}

          {hasHeader && (
            // `SheetHeader` — the app's canonical modal header — rather than a
            // second implementation of the same row. Every sheet then gets the
            // one pattern for free: ✕ on the left, title centred by equal side
            // columns, and the single commit (Save / Done / Add) on the right.
            //
            // panHandlers are omitted whenever that header carries a control:
            // the dedicated handle above already gives a full swipe-to-dismiss
            // affordance, and a PanResponder sibling on the SAME view as the
            // close TouchableOpacity can steal an in-progress touch the instant
            // it reads any movement (React Native's default responder
            // negotiation isn't capture-first) — the button's onPress never
            // fires, the low-movement "swipe" just springs back to closed, and
            // from the outside it looks like the tap silently did nothing.
            // Reproduced 2026-08-05 on PensionEntrySheet's Annual Goal sheet:
            // tapping bottom-sheet-close reported a completed tap every time
            // but the sheet never closed. Title-only headers (no buttons,
            // nothing to compete with) keep the swipe area.
            <View
              style={styles.headerRow}
              {...(!disableSwipe && !hasHeaderControls && panResponder.panHandlers)}
            >
              <SheetHeader
                title={title ?? ''}
                // Sheet titles are sentences, not nav-bar labels, and a sheet
                // has the room — one line would ellipsize "The Science Behind
                // Your Numbers" between the two side columns.
                titleLines={2}
                leftVariant={showCloseButton ? 'close' : 'none'}
                {...(showCloseButton ? { onLeftPress: onClose } : {})}
                leftTestID={closeTestID}
                leftAccessibilityLabel="Close"
                {...(headerAction
                  ? {
                      rightLabel: headerAction.label,
                      onRightPress: headerAction.onPress,
                      rightDisabled: Boolean(headerAction.disabled),
                      rightLoading: Boolean(headerAction.loading),
                      rightTestID: headerAction.testID ?? 'bottom-sheet-action',
                    }
                  : {})}
                {...(headerRight ? { rightElement: headerRight } : {})}
                // A sheet header floats directly over scrolling content, so
                // without a rule the title runs into the first row.
                showDivider
              />
            </View>
          )}
          </View>

          {isContentHeight ? (
            // A content-sized sheet hugs its children up to the `tall` cap, then
            // scrolls. Both halves have to be true at once, and a ScrollView
            // alone cannot do it: a ScrollView has no intrinsic height — its
            // *contentContainer* sizes to the children, the scroll box does not.
            // Nested in auto-sized parents it therefore resolved to 0, the frame
            // hugged 0, and the body laid out below the screen edge where
            // `overflow: hidden` clipped it. That is the "sheet open, contents
            // blank" failure: backdrop dimmed, buttons in the a11y tree at
            // y≈901 against an 874pt window, nothing reachable and no way out.
            //
            // So measure instead of hoping flex resolves it. `measuredBody` is
            // the children's NATURAL height, reported by `onLayout` from a
            // wrapper that is never itself height-constrained. Under the cap we
            // render a plain View, which hugs correctly. Over it we render a
            // ScrollView given a DEFINITE height, which is the one thing that
            // makes it scrollable.
            //
            // This cannot oscillate: the measuring wrapper sits INSIDE the
            // scroller and a ScrollView does not constrain its children
            // vertically, so the natural height it reports stays the same on
            // both sides of the switch.
            <View
              testID="bottom-sheet-body-viewport"
              style={needsBodyScroll ? { height: bodyViewportHeight } : undefined}
            >
              {needsBodyScroll ? (
                // No `automaticallyAdjustKeyboardInsets` here, and that is
                // deliberate: the whole sheet is ALREADY lifted by
                // `useKeyboardInset` above. Asking the scroller to offset by the
                // keyboard height as well would count it twice and drive the
                // focused field up past the sheet's own top edge.
                <ScrollView
                  style={styles.contentScroll}
                  contentContainerStyle={[
                    styles.contentPadding,
                    noPadding && styles.contentNoPadding,
                    { paddingBottom: bodyPaddingBottom },
                  ]}
                  alwaysBounceVertical={false}
                  // Sheets built around a text field (Rename, Device name) must
                  // let a tap on Save through on the first press, not spend it
                  // dismissing the keyboard.
                  keyboardShouldPersistTaps="handled"
                  pointerEvents="auto"
                >
                  <View testID="bottom-sheet-body" onLayout={handleBodyLayout}>
                    {children}
                  </View>
                </ScrollView>
              ) : (
                <View
                  style={[
                    styles.contentPadding,
                    noPadding && styles.contentNoPadding,
                    { paddingBottom: bodyPaddingBottom },
                  ]}
                  pointerEvents="auto"
                >
                  <View testID="bottom-sheet-body" onLayout={handleBodyLayout}>
                    {children}
                  </View>
                </View>
              )}
            </View>
          ) : scrollable ? (
            <ScrollView
              testID="bottom-sheet-scroll"
              style={styles.contentScroll}
              contentContainerStyle={[
                styles.contentPadding,
                noPadding && styles.contentNoPadding,
                { paddingBottom: bodyPaddingBottom },
              ]}
              keyboardShouldPersistTaps="handled"
              alwaysBounceVertical={false}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              {children}
            </ScrollView>
          ) : (
            // A fixed-fraction sheet sits flush on the screen edge, so its last
            // row lands under the home indicator unless the safe area is
            // reserved here. `noPadding` opts out of every edge, bottom
            // included — those callers draw their own footers (and a couple
            // host a whole navigation stack), so padding added underneath them
            // would show as a band of sheet background.
            <View
              style={[
                styles.content,
                noPadding ? styles.contentNoPadding : { paddingBottom: bottomInset },
              ]}
              pointerEvents="auto"
            >
              {children}
            </View>
          )}
          </View>
        </Animated.View>
      </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayCentered: {
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  sheet: {
    // radius + shadow mostly from `sheetFrameStyle` (useMemo) for color tokens
  },
  sheetInner: {
    flex: 1,
    borderTopLeftRadius: Sheet.topCornerRadius,
    borderTopRightRadius: Sheet.topCornerRadius,
    overflow: 'hidden',
  },
  sheetInnerCentered: {
    borderBottomLeftRadius: Sheet.topCornerRadius,
    borderBottomRightRadius: Sheet.topCornerRadius,
  },
  /** Full-bleed bottom sheet on iPad — flush to top edge, no rounded top corners. */
  sheetInnerFullBleed: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  /**
   * `content` height: hug `children` instead of stretching to fill the frame —
   * but stay shrinkable, so when the body outgrows the `tall` cap the scroll
   * view below can give up the difference instead of the sheet clipping it.
   *
   * `flex: 0` — NOT `flexGrow: 0` — is what resets the basis. `sheetInner`
   * above sets `flex: 1`, and Yoga reads the flex basis off `flex` whenever no
   * basis is set: `flex > 0` means basis 0. Overriding only `flexGrow` leaves
   * that `flex: 1` in place, so the column resolves to basis 0 with nothing
   * growing it back. `flex: 0` resets the basis to auto; `flexShrink: 1` after
   * it restores the give the cap needs, since a bare `flex: 0` shrinks by 0.
   *
   * This was originally believed to be the fix for the blank `height="content"`
   * sheet (reported on Backup & Restore → Recovery phrase → Show). It is not —
   * see the device measurement below.
   */
  /**
   * Undo `sheetInner`'s `flex: 1` for a content-sized sheet — all three parts.
   *
   * `flex: 1` is not one property: Yoga reads it as `grow 1, shrink 1,
   * basis 0`. Overriding only grow and shrink leaves the basis at 0, which is
   * wrong for a box that is supposed to hug its content, so the basis is reset
   * here too.
   *
   * **This is hygiene, NOT the fix for the collapse below.** Measured on device
   * (House-C, 2026-08-26): with `flexBasis: 'auto'` in the served bundle,
   * `bottom-sheet-frame` still reported `[0,874][402,874]` — zero height at the
   * screen edge — with the handle and body laid out below it. Byte-identical to
   * the run before the change. See the note on `contentAuto`.
   */
  sheetInnerContent: {
    flex: 0,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  handle: {
    height: Sheet.handleHeight,
    borderRadius: Sheet.handleRadius,
  },
  /**
   * Wrapper around `SheetHeader` — it owns the row itself (✕ left · title
   * centred · commit right); all that is left here is the gap between the
   * header and the body.
   */
  headerRow: {
    paddingBottom: Spacing.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
  },
  contentPadding: {
    paddingHorizontal: Spacing.xl,
  },
  contentNoPadding: {
    paddingHorizontal: 0,
  },
  /**
   * The scroller for a content sheet whose body exceeds the cap.
   *
   * `flex: 1` is safe here — and only here — because the parent View is given a
   * DEFINITE height (`contentCapHeight`) at the render site. That definite
   * height is the whole fix: a ScrollView has no intrinsic height of its own,
   * so nested in auto-sized parents it resolved to 0 and the sheet rendered
   * blank. Under the cap this style is not used at all; the body is a plain
   * View that hugs its children.
   *
   * Do not "simplify" this back to flexGrow/flexShrink on a ScrollView — that
   * is exactly the arrangement that produced the blank sheet, because no
   * combination of flex properties makes a ScrollView hug its content.
   */
  contentScroll: {
    flex: 1,
  },
});
