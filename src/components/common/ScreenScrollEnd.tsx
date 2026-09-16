import { View } from 'react-native';

/** Maestro / Detox anchor at the bottom of scrollable screen content. */
export function ScreenScrollEnd({ testID }: { testID: string }) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${testID}-anchor`}
      collapsable={false}
      // Tall enough for Maestro/Detox to reliably register as visible once
      // scrolled into view (a 1px anchor is too small for visibility sampling).
      style={{ height: 24, width: '100%' }}
    />
  );
}
