import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { TabOverflowSection } from '@components/navigation/TabOverflowSection';
import { Card, Typography } from '@components/ui';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAuthStore } from '@stores/authStore';
import { Layout, Spacing, useAppColors } from '@theme';


import { languageProfileApi } from '../api/languageProfile';

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
  testID?: string;
}

function SettingItem({ icon, title, subtitle, onPress, showChevron = true, destructive, testID }: RowProps) {  const colors = useAppColors();
  const tint = destructive ? colors.error : colors.primary;
  return (
    <Card
      variant="filled"
      pressable={false}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
    >
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={!onPress}
        style={styles.settingRow}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <View style={styles.iconTile}>
          <Icon
            name={icon}
            size={28}
            color={destructive ? colors.error : tint}
            active={!destructive && hasBrandIcon(icon)}
          />
        </View>
        <View style={styles.settingContent}>
          <Typography variant="body" weight="medium" color={destructive ? colors.error : colors.textPrimary}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="footnote" color={colors.textSecondary}>
              {subtitle}
            </Typography>
          )}
        </View>
        {showChevron && <Icon name="chevron-forward" size={20} color={colors.textSecondary} />}
      </Pressable>
    </Card>
  );
}

export function LanguageMoreScreen() {
  const aiEntry = useAIAccessEntry();
  const colors = useAppColors();
  const router = useRouter();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const logout = useAuthStore((state) => state.logout);
  const [resetting, setResetting] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const handleReset = () => {
    Alert.alert(
      'Reset learning data',
      'This permanently deletes your assessment, plan, vocabulary, and tutor history. Your account stays. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await languageProfileApi.resetLearningData();
              Alert.alert('Done', 'Your learning data was reset.');
            } catch {
              Alert.alert('Could not reset', 'Please try again in a moment.');
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-more-screen">
        <ScreenHeader title="More" showNotificationBell={false} showAvatar={false} showPropertySwitcher={false} />

        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView testID="language-more-scroll" style={styles.scrollView} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                ACCOUNT
              </Typography>
              <SettingItem icon="person-outline" title="Profile" subtitle="Name, photo, and account" onPress={() => router.push('/profile')} testID="language-more-profile" />
              <SettingItem icon="notifications-outline" title="Notifications" subtitle="Reminders and alerts" onPress={() => router.push('/notifications')} testID="language-more-notifications" />
              <SettingItem icon="log-out-outline" title="Sign out" onPress={handleSignOut} showChevron={false} testID="language-more-sign-out" />
            </View>

            {aiEntry.show && (
              <View style={styles.section}>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                  AI
                </Typography>
                {/* Shared AI-access entry — identical for every brand.
                    Source of truth: @components/ai/useAIAccessEntry. */}
                <SettingItem
                  icon={aiEntry.icon}
                  title={aiEntry.title}
                  subtitle={aiEntry.subtitle}
                  onPress={() => router.push(aiEntry.route)}
                  testID="language-more-ai-assistance"
                />
              </View>
            )}

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                MORE SYMPLY APPS
              </Typography>
              <SettingItem
                icon="apps-outline"
                title="Symply apps"
                subtitle="Install the rest of the family and share your profile"
                onPress={() => router.push('/symply-apps')}
                testID="language-more-symply-apps"
              />
            </View>

            <View style={styles.section} testID="language-more-data-section">
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                DATA
              </Typography>
              <SettingItem
                icon="trash-outline"
                title={resetting ? 'Resetting…' : 'Reset learning data'}
                subtitle="Delete assessment, plan, and vocabulary"
                onPress={resetting ? undefined : handleReset}
                showChevron={false}
                destructive
                testID="language-more-reset-learning"
              />
            </View>

            {/* Overflow tabs + Customize Tabs — after settings so DATA stays reachable when many tabs are pinned. */}
            <TabOverflowSection />

            <Typography variant="caption1" color={colors.textSecondary} style={styles.version}>
              {ENV.APP_NAME} v{ENV.APP_VERSION}
            </Typography>
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scrollView: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingTop: Spacing.base, paddingBottom: Layout.bottomTabBarClearance },
  section: { marginBottom: Spacing.lg },
  sectionHeader: { marginBottom: Spacing.sm, marginLeft: Spacing.xs, letterSpacing: 0.6 },
  settingItem: { padding: Spacing.md, marginBottom: Spacing.sm },
  settingRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconTile: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  settingContent: { flex: 1 },
  version: { textAlign: 'center', marginTop: Spacing.sm },
});
