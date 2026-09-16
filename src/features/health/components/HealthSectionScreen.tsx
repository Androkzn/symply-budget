import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBackground,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { Layout, Spacing, useAppColors } from '@theme';

/**
 * Shared chrome for every Symply Health section tab (Nutrition / Activity /
 * Trends / Body / Habits).
 *
 * The tabs differ only in their content, so the header + scroll container +
 * loading state live here once — forking this per section is exactly the kind
 * of drift the shared-header rule forbids.
 */
interface HealthSectionScreenProps {
  title: string;
  /** Root testID; the scroll view and scroll-end marker derive from it. */
  testID: string;
  loading?: boolean;
  children: React.ReactNode;
}

export function HealthSectionScreen({
  title,
  testID,
  loading = false,
  children,
}: HealthSectionScreenProps) {
  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID={testID}>
        <ScreenHeader
          title={title}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            // Same defect, and the same fix, as `HealthHomeScreen`: without
            // this the decimal pad is drawn OVER the field that summoned it.
            // Measured on Nutrition — tapping the "kcal" box in "Or log
            // calories only" put the keypad's top edge above the row, so the
            // member could not see the number they were typing, and the Add
            // button below it was unreachable. Every section tab collects
            // numbers this way (Nutrition, Activity, Body, Habits, Cycle,
            // Vitality, Foods, Recipes, Fridge, Injuries, Weight), so it
            // belongs on the shared container rather than on one screen.
            automaticallyAdjustKeyboardInsets
            testID={`${testID}-scroll`}
          >
            <AdaptiveContainer width="reading" style={styles.stack}>
              {children}
              <ScreenScrollEnd testID={screenScrollEndTestId(testID)} />
            </AdaptiveContainer>
          </ScrollView>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm lives here — otherwise every card stacks flush.
  stack: {
    gap: Spacing.base,
  },
});
