import { useRouter } from 'expo-router';
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
import { keyboardDismissScrollProps } from '@utils/keyboard';

/**
 * Shared chrome for the Symply Health SETTINGS sub-screens reached from "More"
 * (Notifications, Widget).
 *
 * The section tabs have `HealthSectionScreen`; these are pushed rather than
 * switched to, so they need the one thing it deliberately does not render — a
 * back button. Everything else (background, header, scroll container, loading
 * state) is the same shared header system, never a fork of it.
 */
interface HealthSettingsShellProps {
  title: string;
  /** Root testID; the scroll view and scroll-end marker derive from it. */
  testID: string;
  loading?: boolean;
  children: React.ReactNode;
}

export function HealthSettingsShell({
  title,
  testID,
  loading = false,
  children,
}: HealthSettingsShellProps) {
  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID={testID}>
        <ScreenHeader
          title={title}
          showBackButton
          // `back()` rather than a hard-coded route: these screens are pushed
          // from "More", but a deep link can land on one directly and
          // `canGoBack()` is what tells the two apart.
          onBackPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          backButtonTestID={`${testID}-back`}
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
            // The third outing of the same defect `HealthHomeScreen` and
            // `HealthSectionScreen` already carry: `keyboardShouldPersistTaps`
            // alone dismisses but never REVEALS, so the keyboard is drawn over
            // whatever summoned it. "Or paste the link from your other device"
            // sits ~950 lines into `HealthOtherDeviceScreen`, i.e. at the bottom
            // of a long scroll — exactly where the keypad lands on top of it.
            {...keyboardDismissScrollProps}
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
  stack: {
    gap: Spacing.base,
  },
});
