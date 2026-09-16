import { BlurView } from 'expo-blur';
import React, { useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@contexts/ThemeContext';
import {
  Avatar,
  Blur,
  CornerRadius,
  Opacity,
  Spacing,
  useAppColors,
} from '@theme';

import { Typography } from './Typography';

interface TabItem {
  name: string;
  label: string;
  icon: string;
}

interface BlurTabBarProps {
  state: {
    index: number;
    routeNames: string[];
  };
  navigation: {
    navigate: (name: string) => void;
  };
  tabs: TabItem[];
}

function primaryFill20(hex: string) {
  if (hex.startsWith('#') && hex.length === 7) return `${hex}20`;
  return hex;
}

export function BlurTabBar({ state, navigation, tabs }: BlurTabBarProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          overflow: 'hidden',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.borderColor,
        },
        overlay: {
          ...StyleSheet.absoluteFill,
        },
        tabsContainer: {
          flexDirection: 'row',
          paddingTop: Spacing.sm,
          paddingHorizontal: Spacing.sm,
        },
        tab: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: Spacing.xs,
        },
        iconContainer: {
          width: Avatar.memberListSize,
          height: Spacing.xxl,
          borderRadius: CornerRadius.lg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        label: {
          marginTop: Spacing.xxs,
        },
      }),
    [colors.borderColor]
  );

  const bottomPadding = Math.max(insets.bottom, Spacing.sm);

  return (
    <View style={[styles.container, { paddingBottom: bottomPadding }]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={Blur.tabBarMaterialIntensity}
        tint={theme.dark ? 'dark' : 'light'}
      />
      <View
        style={[styles.overlay, { backgroundColor: colors.tabBarBlurScrim }]}
        pointerEvents="none"
      />
      <View style={styles.tabsContainer}>
        {tabs.map((tab, index) => {
          const isActive = state.index === index;
          return (
            <TouchableOpacity
              key={tab.name}
              style={styles.tab}
              onPress={() => navigation.navigate(tab.name)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconContainer,
                  isActive && { backgroundColor: primaryFill20(theme.pastel.teal) },
                ]}
              >
                <Typography
                  variant="title3"
                  style={{ opacity: isActive ? 1 : Opacity.tabIconInactive }}
                >
                  {tab.icon}
                </Typography>
              </View>
              <Typography
                variant="caption2"
                weight={isActive ? 'semibold' : 'regular'}
                color={isActive ? theme.pastel.teal : colors.textSecondary}
                style={styles.label}
              >
                {tab.label}
              </Typography>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
