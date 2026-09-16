import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isHouseBrand } from '@brand';
import { SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import type { SoftTransferPreset } from './SoftTransferFlowScreen';

type SoftTransferConnectNavigation = NativeStackNavigationProp<{
  SoftTransferFlow: {
    preset: SoftTransferPreset;
    title: string;
    fixedPackageId?: string;
  };
  DataSharing: undefined;
}>;

type ConnectRow = {
  testID: string;
  title: string;
  subtitle: string;
  icon: 'arrow-forward-outline' | 'arrow-back-outline';
  preset: SoftTransferPreset;
  flowTitle: string;
  fixedPackageId?: string;
};

/** House hub — inbound summaries + House→Budget (Budget import RPC). */
const HOUSE_ROWS: ConnectRow[] = [
  {
    testID: 'connect-share-to-budget',
    title: 'Share with Symply Budget',
    subtitle: 'Property summary, profile, or Home Project costs',
    icon: 'arrow-forward-outline',
    preset: 'house-to-budget',
    flowTitle: 'Share with Symply Budget',
  },
  {
    testID: 'connect-share-home-project-costs',
    title: 'Share Home Project costs',
    subtitle: 'Latest project estimate vs actual rollup → Budget',
    icon: 'arrow-forward-outline',
    preset: 'house-to-budget',
    flowTitle: 'Share Home Project costs',
    fixedPackageId: 'home_project_cost_summary.v1',
  },
  {
    testID: 'connect-import-from-budget',
    title: 'Import from Symply Budget',
    subtitle: 'High-level budget year summary',
    icon: 'arrow-back-outline',
    preset: 'budget-to-house',
    flowTitle: 'Import from Symply Budget',
  },
  {
    testID: 'connect-import-from-health',
    title: 'Import from Symply Health',
    subtitle: 'High-level health check-in summary',
    icon: 'arrow-back-outline',
    preset: 'health-to-house',
    flowTitle: 'Import from Symply Health',
  },
  {
    testID: 'connect-import-from-language',
    title: 'Import from Symply Language',
    subtitle: 'High-level learning summary',
    icon: 'arrow-back-outline',
    preset: 'language-to-house',
    flowTitle: 'Import from Symply Language',
  },
];

export function SoftTransferConnectScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<SoftTransferConnectNavigation>();
  const rows = isHouseBrand() ? HOUSE_ROWS : [];

  return (
    <SafeAreaView edges={[]} testID="soft-transfer-connect-screen">
      <ScreenHeader
        title="Connect Symply apps"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Typography variant="body" color={colors.textSecondary} style={styles.intro}>
          Share selected data with sibling Symply apps using explicit Soft Transfer packages. You
          stay in control — review each package before anything moves.
        </Typography>

        {rows.map((row) => (
          <Card
            key={row.testID}
            variant="filled"
            pressable
            onPress={() =>
              navigation.navigate('SoftTransferFlow', {
                preset: row.preset,
                title: row.flowTitle,
                ...(row.fixedPackageId
                  ? { fixedPackageId: row.fixedPackageId as 'home_project_cost_summary.v1' }
                  : {}),
              })
            }
            style={styles.navRow}
            testID={row.testID}
          >
            <IconBackgroundChip name={row.icon} style={styles.navIcon} />
            <View style={styles.navText}>
              <Typography variant="body" weight="medium">
                {row.title}
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                {row.subtitle}
              </Typography>
            </View>
            <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
          </Card>
        ))}

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('DataSharing')}
          style={styles.navRow}
          testID="connect-data-sharing"
        >
          <IconBackgroundChip name="shield-checkmark-outline" style={styles.navIcon} />
          <View style={styles.navText}>
            <Typography variant="body" weight="medium">
              Data sharing
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              View or revoke active permissions
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.sm,
  },
  intro: {
    marginBottom: Spacing.sm,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.lg,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: {
    flex: 1,
    gap: 2,
  },
});
