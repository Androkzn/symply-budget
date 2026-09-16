import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { TAB_METADATA, TabConfig } from '@stores/navigationCustomizationStore';
import { CornerRadius, Elevation, Opacity, Spacing, TypographyTokens, useAppColors } from '@theme';
import type { AppColors } from '@theme';

interface TabBarPreviewProps {
  tabs: TabConfig[];
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      marginTop: Spacing.xl,
      marginBottom: Spacing.base,
    },
    label: {
      marginBottom: Spacing.md,
      letterSpacing: 0.5,
    },
    phoneMockup: {
      borderRadius: CornerRadius.sheet,
      padding: Spacing.sm,
      ...Platform.select({
        ios: {
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: Opacity.buttonRaised,
          shadowRadius: 12,
        },
        android: {
          elevation: Elevation.cardRaised,
        },
      }),
    },
    screenArea: {
      borderRadius: CornerRadius.lg,
      overflow: 'hidden',
    },
    screenContent: {
      height: 150,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderColor,
      paddingBottom: Spacing.sm,
      paddingTop: Spacing.sm,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.xs,
    },
    tabLabel: {
      marginTop: Spacing.xxs,
      fontSize: TypographyTokens.micro.size,
      lineHeight: TypographyTokens.micro.lineHeight,
    },
  });
}

export function TabBarPreview({ tabs }: TabBarPreviewProps) {  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
        style={styles.label}
      >
        PREVIEW
      </Typography>

      <View style={[styles.phoneMockup, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.screenArea}>
          <View style={[styles.screenContent, { backgroundColor: colors.groupedListBackground }]}>
            <Typography variant="caption1" color={colors.textTertiary} align="center">
              Tab Bar Preview
            </Typography>
          </View>

          <View style={[styles.tabBar, { backgroundColor: colors.bottomNavigationBackground }]}>
            {tabs.map((tab, index) => {
              const metadata = TAB_METADATA[tab.type];
              const inactive = colors.textTertiary;
              const active = colors.primary;
              return (
                <View key={tab.id} style={styles.tabItem}>
                  <Icon
                    name={(index === 0 ? metadata.iconFocused : metadata.icon) as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={index === 0 ? active : inactive}
                  />
                  <Typography
                    variant="caption2"
                    color={index === 0 ? active : inactive}
                    style={styles.tabLabel}
                  >
                    {metadata.displayName}
                  </Typography>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}
