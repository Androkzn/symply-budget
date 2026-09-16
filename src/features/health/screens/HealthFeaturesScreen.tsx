import { Redirect, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBackground,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { HEALTH_FEATURES, type HealthFeatureDefinition } from '@config/healthFeatures';
import { useHealthFeatures } from '@hooks/useHealthFeature';
import { useIsAdmin } from '@hooks/useIsAdmin';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useHealthFeatureStore } from '@stores/healthFeatureStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { isHealthBrand } from '../brandGuard';

/**
 * More → Health features — the ADMIN-ONLY switchboard.
 *
 * A common user never reaches this screen and never needs to: they get the
 * default-on trackers (Calories, Weight, Workouts, Water, Foods, Recipes) and
 * nothing else, resolved from `HEALTH_FEATURE_DEFAULTS` with any stored
 * override ignored. Everything optional — Sleep, Trends, Body, Habits, Cycle,
 * Vitality, Fridge, Injuries, Coach, Scan, Files — is switched on from here.
 *
 * Three gates protect it, and all three matter:
 *
 *  1. This screen redirects Home for a non-admin, so a deep link, a restored
 *     navigation state or a stale in-app link cannot open the editor.
 *  2. `resolveHealthFeature` ignores overrides for a non-admin, so even a
 *     hand-edited AsyncStorage blob cannot widen what they see.
 *  3. `HealthFeatureRoute` redirects each optional tab, so a route reached by
 *     any other path still refuses to mount.
 *
 * Gate 1 alone would be cosmetic; gate 2 is the one that actually decides.
 *
 * Turning a feature OFF hides its tab, its Home surfaces and its More row. It
 * never deletes logged data — every `health*Storage` module keeps its rows, so
 * switching it back on restores the history intact. The screen says so, because
 * a destructive-looking switch that isn't destructive still stops people using
 * it.
 */
export function HealthFeaturesScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();

  // Hooks run unconditionally — the brand/role checks below must not
  // short-circuit them.
  const isAdmin = useIsAdmin();
  const features = useHealthFeatures();
  const setFeature = useHealthFeatureStore((state) => state.setFeature);
  const resetAll = useHealthFeatureStore((state) => state.resetAll);

  const { core, optional } = useMemo(
    () => ({
      core: HEALTH_FEATURES.filter((f) => f.enabledByDefault),
      optional: HEALTH_FEATURES.filter((f) => !f.enabledByDefault),
    }),
    [],
  );

  const optionalOnCount = optional.filter((f) => features[f.key]).length;

  if (!isHealthBrand() || !isAdmin) {
    return <Redirect href="/" />;
  }

  const renderRow = (feature: HealthFeatureDefinition) => {
    const enabled = features[feature.key];
    return (
      <Card
        key={feature.key}
        variant="filled"
        style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
        testID={`health-feature-row-${feature.key}`}
      >
        <View style={[styles.iconTile, { backgroundColor: colors.primary + '1F' }]}>
          <Icon
            name={feature.icon}
            size={18}
            color={enabled ? colors.textPrimary : colors.textSecondary}
          />
        </View>
        <View style={styles.rowText}>
          <Typography variant="body" weight="medium" color={colors.textPrimary}>
            {feature.label}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {feature.description}
          </Typography>
        </View>
        {/*
          Every row is editable, including the default-on ones. A row rendered
          `disabled` would be a lie about the store underneath it — `setFeature`
          accepts the write for any key — and an admin who wants a
          water-only install should get one.
        */}
        <Toggle
          value={enabled}
          onValueChange={(next: boolean) => setFeature(feature.key, next)}
          accessibilityLabel={feature.label}
          testID={`health-feature-toggle-${feature.key}`}
        />
      </Card>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="health-features-screen">
        <ScreenHeader
          title="Health features"
          showBackButton
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
          showsVerticalScrollIndicator={false}
          testID="health-features-scroll"
        >
          <AdaptiveContainer width="reading" style={styles.stack}>
            <Card
              variant="filled"
              style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
            >
              <Typography variant="body" color={colors.textSecondary}>
                Pick which trackers this app shows. Switching one off hides its tab, its
                cards on Home and its row here — it never deletes anything you have
                logged, so switching it back on brings the history with it.
              </Typography>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-features-admin-note"
              >
                Only admins see this screen. Everyone else gets the default trackers.
              </Typography>
            </Card>

            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                DEFAULT TRACKERS
              </Typography>
              {core.map((feature) => renderRow(feature))}
            </View>

            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
                testID="health-features-optional-header"
              >
                {`OPTIONAL — ${optionalOnCount} OF ${optional.length} ON`}
              </Typography>
              {optional.map((feature) => renderRow(feature))}
            </View>

            <Pressable
              onPress={resetAll}
              accessibilityRole="button"
              testID="health-features-reset"
              style={[styles.resetButton, { borderColor: colors.borderColor }]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                Reset to the defaults
              </Typography>
            </Pressable>

            <ScreenScrollEnd testID={screenScrollEndTestId('health-features-screen')} />
          </AdaptiveContainer>
        </ScrollView>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionHeader: {
    marginLeft: Spacing.xs,
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  resetButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
});
