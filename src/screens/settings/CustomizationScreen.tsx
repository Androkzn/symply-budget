import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { SettingsStackScreenProps } from '@navigation/types';
import { useAppColors } from '@theme';

interface SettingItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
}

function SettingItem({ icon, title, subtitle, onPress, showChevron = true }: SettingItemProps) {
  const colors = useAppColors();
  return (
    <Card
      variant="filled"
      pressable={!!onPress}
      onPress={onPress}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
    >
      <View style={styles.settingIcon}>
        <Icon name={icon} size={20} color={colors.textPrimary} />
      </View>
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="footnote" color={colors.textSecondary}>
            {subtitle}
          </Typography>
        )}
      </View>
      {showChevron && (
        <View style={styles.chevronContainer}>
          <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>
      )}
    </Card>
  );
}

export function CustomizationScreen({ navigation }: SettingsStackScreenProps<'Customization'>) {
  const colors = useAppColors();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Customization"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <View style={styles.container}>
        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                LAYOUT
              </Typography>

              <SettingItem
                icon="color-palette"
                title="Home Screen"
                subtitle="Arrange widgets and sections"
                onPress={() => navigation.navigate('WidgetCustomization')}
              />

              <SettingItem
                icon="phone-portrait"
                title="Navigation"
                subtitle="Reorder or hide tabs"
                onPress={() => navigation.navigate('NavigationCustomization')}
              />
            </View>
          </ScrollView>
        </AdaptiveContainer>
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
    paddingTop: 16,
    paddingBottom: 100,
    backgroundColor: 'transparent',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  settingIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
  },
  chevronContainer: {
    marginLeft: 8,
  },
});
