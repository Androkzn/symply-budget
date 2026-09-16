import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { brand } from '@brand';
// Deep import, NOT the `@components/aihousekeeper` barrel. This component
// renders on every customizable-tabs brand, Health included, and the barrel
// also re-exports `AssistantUIBlock` → `@components/tasks` → `AddTaskSheet` →
// `@hooks/useQuickSpeech` → `expo-speech-recognition`. Metro does not
// tree-shake, so the barrel form put a working microphone in the Health bundle
// (see `src/features/health/__tests__/areas/voice.posture.test.ts`).
import { BrandSymbol } from '@components/common';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useFeature } from '@hooks/useFeature';
import { getTabScreenBrandIcon, type TabConfigEntry } from '@navigation/tabRegistry';
import { useEffectiveTabs } from '@navigation/useEffectiveTabs';
import { Spacing, useAppColors } from '@theme';

interface TabOverflowSectionProps {
  /**
   * Extra rows for the CUSTOMIZATION group, rendered under the same header and
   * directly below "Customize Tabs".
   *
   * House passes its "Customization" row (home-screen widgets + navigation
   * layout) here rather than drawing its own group: the two rows are the same
   * subject, and a caller-drawn group after this component would either repeat
   * the header or float the row under no header at all.
   */
  extraCustomizationRows?: React.ReactNode;
}

/**
 * The overflow portion of the "More" hub: the tabs that aren't pinned to the
 * bottom bar, plus a "Customize Tabs" entry. Rendered at the TOP of the More /
 * Settings screen for brands with `customizableTabs`. A no-op for other brands.
 */
export function TabOverflowSection({ extraCustomizationRows }: TabOverflowSectionProps = {}) {
  const router = useRouter();  const colors = useAppColors();
  const showTasks = useFeature('smartTaskAssistant');
  const { overflow } = useEffectiveTabs({ showTasks });
  // Only the NAME now: the persona avatar no longer renders as a tab icon, but
  // the housekeeper's name still labels its row.
  const { name: housekeeperName } = useAihousekeeperPersona();

  if (!brand.customizableTabs) {
    return null;
  }

  const go = (route: string) => {
    router.push(route === 'index' ? '/' : (`/${route}` as never));
  };

  // A pool entry with `labelKey: 'housekeeper'` carries no static label — its
  // name is the member's persona. The bar resolves that through
  // `getTabScreenTitle`; falling back to `t.route` here printed the raw route
  // ("mira") the moment the housekeeper stopped being pinned by default.
  const rowLabel = (t: TabConfigEntry) => {
    if (t.labelKey === 'housekeeper' && housekeeperName) return housekeeperName;
    return t.label ?? t.route;
  };

  return (
    <View style={styles.container}>
      {overflow.length > 0 && (
        <>
          <Typography
            variant="footnote"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.header}
          >
            MORE TABS
          </Typography>
          {overflow.map((tab) => (
            <Card
              key={tab.route}
              variant="filled"
              pressable
              onPress={() => go(tab.route)}
              testID={`more-tab-${tab.route}`}
              style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
            >
              <View style={styles.iconTile}>
                {/* Same symbol pipeline as every other row — see SidebarTabBar. */}
                <BrandSymbol
                  ionicon={tab.icon}
                  brandIcon={tab.brandIcon ?? getTabScreenBrandIcon(tab.route)}
                  sfSymbol={tab.sfSymbol}
                  size={28}
                  color={colors.primary}
                />
              </View>
              <Typography variant="body" weight="medium" color={colors.textPrimary} style={styles.label}>
                {rowLabel(tab)}
              </Typography>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </Card>
          ))}
        </>
      )}

      {/* Its own section name, in the same uppercase style as MORE TABS and the
          ACCOUNT / PREFERENCES headers below it. Without one the row read as a
          stray last item of the tab list rather than the entry point that
          changes it. */}
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
        style={[styles.header, overflow.length > 0 && styles.headerAfterList]}
      >
        CUSTOMIZATION
      </Typography>

      <Card
        variant="filled"
        pressable
        onPress={() => router.push('/customize-tabs')}
        testID="more-customize-tabs"
        style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
      >
        <View style={styles.iconTile}>
          <Icon name="options-outline" size={28} color={colors.primary} />
        </View>
        <Typography variant="body" weight="medium" color={colors.textPrimary} style={styles.label}>
          Customize Tabs
        </Typography>
        <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
      </Card>

      {extraCustomizationRows}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.base },
  header: { marginBottom: Spacing.md, marginLeft: 4, letterSpacing: 0.5 },
  // Breathing room when a MORE TABS list sits directly above, so the two
  // sections read apart instead of as one run of rows.
  headerAfterList: { marginTop: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    backgroundColor: 'transparent',
  },
  label: { flex: 1 },
});
