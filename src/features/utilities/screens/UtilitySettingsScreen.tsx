import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Alert } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { utilitiesApi, type UtilityAccount } from '@features/utilities/api/utilities';
import type { UtilitiesStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { Layout, Spacing, useAppColors } from '@theme';

type UtilitySettingsScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList>;

export function UtilitySettingsScreen() {  const colors = useAppColors();
  const navigation = useNavigation<UtilitySettingsScreenNavigationProp>();
  const { currentHousehold } = useHouseholdStore();
  const [accounts, setAccounts] = useState<UtilityAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadAccounts = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      const data = await utilitiesApi.getAccounts(currentHousehold.id);
      setAccounts(data);
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    setIsLoading(true);
    loadAccounts().finally(() => setIsLoading(false));
  }, [loadAccounts]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAccounts();
    setIsRefreshing(false);
  };

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        <Card variant="filled" style={styles.sectionCard}>
          <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
            Utility Accounts
          </Typography>
          {accounts.length === 0 ? (
            <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
              No utility accounts added yet
            </Typography>
          ) : (
            accounts.map((account) => (
              <View key={account.id} style={[styles.accountRow, { borderBottomColor: colors.divider }]}>
                <View style={styles.accountInfo}>
                  <Typography variant="body" weight="semibold">
                    {account.service_type.charAt(0).toUpperCase() + account.service_type.slice(1)}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Account: {account.account_number}
                  </Typography>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert('Coming Soon', 'Account editing coming soon');
                  }}
                >
                  <Typography variant="body" color={colors.primary}>
                    Edit
                  </Typography>
                </TouchableOpacity>
              </View>
            ))
          )}
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => {
              Alert.alert('Coming Soon', 'Add account form coming soon');
            }}
          >
            <Typography variant="body" color={colors.primary} weight="semibold">
              + Add Account
            </Typography>
          </TouchableOpacity>
        </Card>

        <Card variant="filled" style={styles.sectionCard}>
          <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
            Reminder Settings
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.settingText}>
            Reminder settings coming soon. Configure when you want to be notified about upcoming bills.
          </Typography>
        </Card>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.base,
  },
  emptyText: {
    padding: Spacing.base,
    textAlign: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accountInfo: {
    flex: 1,
  },
  addButton: {
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  settingText: {
    padding: Spacing.sm,
  },
});
