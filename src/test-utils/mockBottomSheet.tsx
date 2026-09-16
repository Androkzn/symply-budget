/**
 * A `BottomSheet` test double that keeps the sheet's HEADER.
 *
 * Tests that only need "does the body render" used to stub the sheet as
 * `visible ? children : null`. That was fine while every sheet drew its own
 * Cancel / Save row inside `children` — it stopped being fine when the header
 * moved into the component, because the sheet's single commit (Save, Done,
 * Create) is now a prop rather than a child. Under the old stub those controls
 * simply vanish, and a test asserting on one fails for a reason that has
 * nothing to do with the screen it is testing.
 *
 * So this double renders what the real header renders: the ✕ on the left and
 * the commit on the right, each carrying the same testID the real sheet gives
 * it. It stays a stub in every other respect — no modal, no animation, no
 * measurement — since those are `BottomSheet`'s own tests' job.
 *
 * Usage, inside a test file:
 *
 *   jest.mock('@components/ui/BottomSheet', () =>
 *     require('../../test-utils/mockBottomSheet').createBottomSheetMock()
 *   );
 */

interface HeaderAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

interface MockSheetProps {
  visible?: boolean;
  children?: React.ReactNode;
  title?: string;
  showCloseButton?: boolean;
  closeTestID?: string;
  onClose?: () => void;
  headerAction?: HeaderAction;
  headerRight?: React.ReactNode;
}

/**
 * @param wrapInView Render the body inside a `View` tagged `bottom-sheet`.
 *   Off by default so the double matches the most common existing stub
 *   (children rendered inline), which some tests' queries depend on.
 */
export function createBottomSheetMock({ wrapInView = false } = {}) {
  // Required lazily: this module is loaded from inside a `jest.mock` factory,
  // which runs before the test file's own imports are evaluated.
  const React = require('react');
  const { Text, View, TouchableOpacity } = require('react-native');

  const BottomSheet = ({
    visible,
    children,
    title,
    showCloseButton,
    closeTestID,
    onClose,
    headerAction,
    headerRight,
  }: MockSheetProps) => {
    if (!visible) return null;
    const header = [
      // The title is a prop now, not a child — a screen asserting "the sheet
      // says Update 2024 assessment" still has to find it somewhere.
      title ? React.createElement(Text, { key: 'title' }, title) : null,
      showCloseButton
        ? React.createElement(TouchableOpacity, {
            key: 'close',
            testID: closeTestID ?? 'bottom-sheet-close',
            accessibilityRole: 'button',
            accessibilityLabel: 'Close',
            onPress: onClose,
          })
        : null,
      headerRight ?? null,
      headerAction
        ? React.createElement(
            TouchableOpacity,
            {
              key: 'action',
              testID: headerAction.testID ?? 'bottom-sheet-action',
              accessibilityRole: 'button',
              accessibilityLabel: headerAction.label,
              disabled: Boolean(headerAction.disabled || headerAction.loading),
              onPress: headerAction.onPress,
            },
            null
          )
        : null,
    ];
    return React.createElement(
      View,
      { testID: 'bottom-sheet-header' },
      ...header,
      wrapInView ? React.createElement(View, { testID: 'bottom-sheet' }, children) : children
    );
  };

  return { __esModule: true, BottomSheet };
}
