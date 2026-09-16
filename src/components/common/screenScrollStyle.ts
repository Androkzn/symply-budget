import { StyleSheet } from 'react-native';

/** Primary vertical ScrollView must flex within header + tab bar columns or content won't scroll. */
export const screenScrollViewStyle = StyleSheet.create({
  scroll: { flex: 1 },
  contentGrow: { flexGrow: 1 },
});

export const SCREEN_SCROLL_TEST_ID = 'screen-scroll';

/** Bottom-of-content sentinel for scroll E2E: `{screenRootTestId}-scroll-end`. */
export function screenScrollEndTestId(screenRootTestId: string): string {
  return `${screenRootTestId}-scroll-end`;
}
