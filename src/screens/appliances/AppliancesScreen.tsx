import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { router } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';

import { appliancesApi, Appliance, APPLIANCE_CATEGORIES } from '@api/appliances';
import { SafeAreaView, AppBackground, ScreenHeader } from '@components/common';
import { FloatingActionButton, Typography, Card, SearchBar, Chip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import type { RootStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

type AppliancesNavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface AppliancesScreenProps {
  onClose?: () => void;
}

/**
 * How this list reaches `ApplianceDetail`, and why it is not a `navigate()`.
 *
 * This screen has exactly one host: an `AdaptiveModal` on the HOME tab
 * (`HomeScreen.tsx`). `ApplianceDetail` is registered on the Settings stack,
 * which `app/(tabs)/settings.tsx` mounts inside a `NavigationIndependentTree` —
 * so nothing on another tab can navigate into it, by construction and on
 * purpose. The sanctioned bridge is the one `src/services/navigation.ts`
 * documents for every cross-tab hop: push the tab's path with `screen` plus the
 * extra params, which `settings.tsx` forwards verbatim as `initialParams` and
 * `SettingsNavigator`'s `NavigationHandler` turns into a real navigation.
 *
 * `navNonce` makes each tap a distinct request. Without it, tapping the same
 * appliance twice (open, back, open) is one URL and the handler's dedupe ref
 * swallows the second — which reads to a member as a dead row.
 *
 * `applianceId` is omitted for "Add appliance", and the detail screen treats an
 * absent id as ADD mode rather than as an error.
 */
function openApplianceDetail(householdId: string, applianceId?: string) {
  router.push({
    pathname: '/settings',
    params: {
      screen: 'ApplianceDetail',
      householdId,
      navNonce: String(Date.now()),
      ...(applianceId ? { applianceId } : {}),
    },
  });
}

export function AppliancesScreen({ onClose }: AppliancesScreenProps) {
  const colors = useAppColors();
  const navigation = useNavigation<AppliancesNavigationProp>();
  const { isLoading: isDataLoading } = useData();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [appliances, setAppliances] = useState<Appliance[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentHousehold) return;

    try {
      setIsLoading(true);
      const result = await appliancesApi.list(currentHousehold.id, {
        category: selectedCategory || undefined,
      });
      setAppliances(result.appliances);
    } catch (error) {
      showToast('error', 'Failed to load appliances');
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold, selectedCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const filteredAppliances = appliances.filter((appliance) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      appliance.name.toLowerCase().includes(query) ||
      appliance.brand?.toLowerCase().includes(query) ||
      appliance.model?.toLowerCase().includes(query) ||
      appliance.type.toLowerCase().includes(query)
    );
  });

  const getCategoryIcon = (category: string): IoniconName => {
    return APPLIANCE_CATEGORIES.find((c) => c.id === category)?.icon || 'cube';
  };

  const getWarrantyStatus = (appliance: Appliance): { label: string; color: string } | null => {
    if (!appliance.warranty?.manufacturer?.expiration) return null;

    const expDate = new Date(appliance.warranty.manufacturer.expiration);
    const now = new Date();
    const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
      return { label: 'Warranty Expired', color: colors.error };
    }
    if (daysLeft <= 90) {
      return { label: `${daysLeft} days left`, color: colors.warning };
    }
    const monthsLeft = Math.ceil(daysLeft / 30);
    if (monthsLeft <= 12) {
      return { label: `${monthsLeft} months left`, color: colors.success };
    }
    const yearsLeft = Math.floor(monthsLeft / 12);
    return { label: `${yearsLeft}+ years left`, color: colors.success };
  };

  // Show loading state while data is being fetched
  if (isDataLoading) {
    return (
      <AppBackground opacity={0.5}>
        {/* ScreenHeader owns the top inset; keep edges empty so it isn't doubled. */}
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <ScreenHeader
              title="My Appliances"
              showBackButton
              onBackPress={() => (onClose ? onClose() : navigation.goBack())}
              backIcon={onClose ? 'close' : 'chevron-back'}
              showNotificationBell={false}
              showAvatar={false}
              showPropertySwitcher={false}
            />
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color={colors.textSecondary} style={{ marginTop: 12 }}>
                Loading...
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!currentHousehold) {
    return (
      <AppBackground opacity={0.5}>
        {/* ScreenHeader owns the top inset; keep edges empty so it isn't doubled. */}
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <ScreenHeader
              title="My Appliances"
              showBackButton
              onBackPress={() => (onClose ? onClose() : navigation.goBack())}
              backIcon={onClose ? 'close' : 'chevron-back'}
              showNotificationBell={false}
              showAvatar={false}
              showPropertySwitcher={false}
            />
            <View style={styles.emptyState}>
              <Typography variant="title3" weight="semibold" align="center">
                No Home Selected
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={['top']}>
        <View style={styles.container}>
          <ScreenHeader
            title="My Appliances"
            showBackButton
            onBackPress={() => (onClose ? onClose() : navigation.goBack())}
            backIcon={onClose ? 'close' : 'chevron-back'}
            showNotificationBell={false}
            showAvatar={false}
            showPropertySwitcher={false}
          />

          {/* Search */}
          <View style={styles.searchContainer}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search appliances..."
            />
          </View>

          {/* Category Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroll}
            contentContainerStyle={styles.categoryContent}
          >
            <Chip
              label="All"
              variant={selectedCategory === null ? 'primary' : 'secondary'}
              onPress={() => setSelectedCategory(null)}
            />
            {APPLIANCE_CATEGORIES.map((cat) => (
              <Chip
                key={cat.id}
                label={cat.label}
                variant={selectedCategory === cat.id ? 'primary' : 'secondary'}
                onPress={() => setSelectedCategory(cat.id)}
              />
            ))}
          </ScrollView>

          {/* Appliances List */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : filteredAppliances.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon
                  name="hardware-chip"
                  size={48}
                  color={colors.textSecondary}
                  style={styles.emptyIcon}
                />
                <Typography variant="headline" weight="semibold" align="center">
                  No Appliances Yet
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  align="center"
                  style={styles.emptyText}
                >
                  Track your appliances, warranties, and maintenance schedules.
                </Typography>
              </View>
            ) : (
              filteredAppliances.map((appliance) => {
                const warrantyStatus = getWarrantyStatus(appliance);
                return (
                  <TouchableOpacity
                    key={appliance.id}
                    onPress={() => {
                      // Close the modal first: leaving it open over another tab
                      // strands the member behind a sheet whose Back goes
                      // nowhere useful.
                      onClose?.();
                      openApplianceDetail(currentHousehold.id, appliance.id);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${appliance.name}`}
                    testID={`appliance-row-${appliance.id}`}
                  >
                    <Card
                      variant="filled"
                      style={[styles.applianceCard, { backgroundColor: colors.backgroundSecondary }]}
                    >
                      <View style={styles.applianceHeader}>
                        <View style={[styles.iconContainer, { backgroundColor: colors.backgroundMain }]}>
                          <Icon
                            name={getCategoryIcon(appliance.category)}
                            size={24}
                            color={colors.textPrimary}
                          />
                        </View>
                        <View style={styles.applianceInfo}>
                          <Typography variant="headline" weight="semibold" numberOfLines={1}>
                            {appliance.name}
                          </Typography>
                          <Typography variant="footnote" color={colors.textSecondary}>
                            {appliance.brand} {appliance.model}
                          </Typography>
                        </View>
                      </View>

                      <View style={styles.applianceMeta}>
                        <View style={[styles.badge, { backgroundColor: colors.backgroundMain }]}>
                          <Typography variant="caption2" color={colors.textSecondary}>
                            {appliance.type}
                          </Typography>
                        </View>
                        {warrantyStatus && (
                          <View style={[styles.badge, { backgroundColor: `${warrantyStatus.color}15` }]}>
                            <Typography variant="caption2" color={warrantyStatus.color}>
                              {warrantyStatus.label}
                            </Typography>
                          </View>
                        )}
                        {appliance.location && (
                          <View style={[styles.badge, styles.locationBadge, { backgroundColor: colors.backgroundMain }]}>
                            <Icon name="location" size={12} color={colors.textSecondary} />
                            <Typography variant="caption2" color={colors.textSecondary}>
                              {appliance.location}
                            </Typography>
                          </View>
                        )}
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <FloatingActionButton
            title="Add Appliance"
            icon="+"
            onPress={() => {
              onClose?.();
              // No `applianceId` — the detail screen reads that as ADD mode.
              openApplianceDetail(currentHousehold.id);
            }}
            testID="appliances-add-fab"
          />
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  categoryScroll: {
    maxHeight: 44,
    marginBottom: 12,
  },
  categoryContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    marginTop: 8,
  },
  applianceCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0,0,0,1)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  applianceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  applianceInfo: {
    flex: 1,
  },
  applianceMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});

export default AppliancesScreen;
