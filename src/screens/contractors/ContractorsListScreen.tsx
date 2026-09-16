import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useFocusEffect } from 'expo-router/react-navigation';
import React, { useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, TextInput, Linking } from 'react-native';

import {
  contractorsApi,
  type ContractorWithStats,
  type ContractorSpecialty,
  SPECIALTY_INFO,
  CONTRACTOR_SPECIALTIES,
} from '@api/contractors';
import { AppBackground, ScreenHeader } from '@components/common';
import { PropertyBadge } from '@components/common/house';
import { AdaptiveContainer, AdaptiveGrid } from '@components/layout';
import { FloatingActionButton, Typography, FilterTabs, type FilterTab, StarRating, FavoriteStar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';

// Format currency from cents, compactly ("CA$1.2k") in the display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents, { abbreviate: true });
}

type FilterTabId = 'all' | 'favorites' | ContractorSpecialty;

interface ContractorCardProps {
  contractor: ContractorWithStats;
  onPress: () => void;
  onFavoriteToggle: () => void;
}

function ContractorCard({ contractor, onPress, onFavoriteToggle }: ContractorCardProps) {
  const colors = useAppColors();
  const { theme } = useTheme();

  const handleCall = () => {
    if (contractor.phone) {
      Linking.openURL(`tel:${contractor.phone}`);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.contractorCard, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View
            style={[
              styles.specialtyBadge,
              { backgroundColor: contractor.specialtyInfo.color + '20' },
            ]}
          >
            <Icon
              name={getContractorCategoryIcon(contractor.specialty)}
              size={14}
              color={contractor.specialtyInfo.color}
            />
            <Typography
              variant="caption2"
              weight="medium"
              style={{ color: contractor.specialtyInfo.color, marginLeft: 4 }}
            >
              {contractor.specialtyInfo.label}
            </Typography>
          </View>
          <PropertyBadge 
            householdId={(contractor as any)._householdId} 
            householdName={(contractor as any)._householdName} 
            size="sm" 
          />
        </View>
        <View style={styles.favoriteButton}>
          <FavoriteStar isFavorite={contractor.is_favorite} onToggle={onFavoriteToggle} />
        </View>
      </View>

      <View style={styles.cardBody}>
        <Typography variant="headline" weight="semibold" numberOfLines={1}>
          {contractor.name}
        </Typography>
        {contractor.company_name && (
          <Typography variant="subheadline" color={colors.textSecondary} numberOfLines={1}>
            {contractor.company_name}
          </Typography>
        )}
        <StarRating rating={contractor.rating} />
      </View>

      <View style={styles.cardStats}>
        <View style={styles.statItem}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Visits
          </Typography>
          <Typography variant="subheadline" weight="semibold">
            {contractor.totalVisits}
          </Typography>
        </View>
        <View style={styles.statItem}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Total Spent
          </Typography>
          <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
            {formatCurrency(contractor.totalSpent)}
          </Typography>
        </View>
        {contractor.lastVisitDate && (
          <View style={styles.statItem}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Last Visit
            </Typography>
            <Typography variant="subheadline" weight="medium">
              {new Date(contractor.lastVisitDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </Typography>
          </View>
        )}
      </View>

      {contractor.phone && (
        <TouchableOpacity
          style={[styles.callButton, { borderColor: colors.borderColor }]}
          onPress={handleCall}
        >
          <Icon name="call" size={16} color={theme.pastel.teal} />
          <Typography variant="subheadline" color={theme.pastel.teal}>
            Call
          </Typography>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

export function ContractorsListScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<ContractorsStackParamList>>();
  const { isTablet, isLandscape, columns } = useDeviceType();
  const { currentHousehold, households, propertyMode } = useHouseholdStore();
  const [contractors, setContractors] = useState<ContractorWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTabId>('all');
  const [error, setError] = useState<string | null>(null);
  
  // Determine which households to fetch from based on property mode
  const householdsToFetch = propertyMode === 'all' ? households : (currentHousehold ? [currentHousehold] : []);

  const handleGoBack = () => {
    navigation.goBack();
  };

  // Consistent layout padding
  const { content: containerPadding, cardGap } = useLayoutPadding();

  const loadData = useCallback(async (showLoading = false) => {
    if (householdsToFetch.length === 0) return;

    try {
      if (showLoading) setIsLoading(true);
      setError(null);
      const filters: { specialty?: ContractorSpecialty; is_favorite?: boolean; search?: string } = {};

      if (activeFilter === 'favorites') {
        filters.is_favorite = true;
      } else if (activeFilter !== 'all') {
        filters.specialty = activeFilter as ContractorSpecialty;
      }

      if (searchQuery) {
        filters.search = searchQuery;
      }

      // Fetch contractors from all active households
      const allContractors: ContractorWithStats[] = [];
      await Promise.all(
        householdsToFetch.map(async (household) => {
          try {
            const data = await contractorsApi.getAll(household.id, filters);
            // Add household info for multi-property display
            const contractorsWithHousehold = data.contractors.map((c: ContractorWithStats) => ({
              ...c,
              _householdId: household.id,
              _householdName: household.name,
            }));
            allContractors.push(...contractorsWithHousehold);
          } catch (err) {
            console.error(`Error loading contractors for ${household.name}:`, err);
          }
        })
      );
      
      // Remove duplicates (same contractor might be added to multiple properties)
      const uniqueContractors = allContractors.filter(
        (contractor, index, self) =>
          index === self.findIndex((c) => c.id === contractor.id)
      );
      
      setContractors(uniqueContractors);
    } catch (err) {
      console.error('Error loading contractors:', err);
      setError('Failed to load contractors');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [householdsToFetch, activeFilter, searchQuery]);

  // Refresh data when screen comes into focus (e.g., after adding/editing a contractor)
  useFocusEffect(
    useCallback(() => {
      loadData(contractors.length === 0);
    }, [loadData, contractors.length])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleToggleFavorite = async (contractor: ContractorWithStats) => {
    if (!currentHousehold?.id) return;

    try {
      await contractorsApi.toggleFavorite(
        currentHousehold.id,
        contractor.id,
        !contractor.is_favorite
      );
      await loadData();
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  const handleContractorPress = (contractor: ContractorWithStats) => {
    navigation.navigate('ContractorDetail', { contractorId: contractor.id });
  };

  const handleAddContractor = () => {
    navigation.navigate('AddEditContractor', {});
  };

  const filterTabs: FilterTab[] = [
    { id: 'all', label: 'All' },
    { id: 'favorites', label: 'Favorites' },
    ...CONTRACTOR_SPECIALTIES.slice(0, 4).map((specialty) => ({
      id: specialty,
      label: SPECIALTY_INFO[specialty].label,
    })),
  ];

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="My Contractors"
            showBackButton
            onBackPress={handleGoBack}
            showNotificationBell={false}
            showAvatar={false}
          />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="My Contractors"
          showBackButton
          onBackPress={handleGoBack}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer maxWidth={isTablet ? 1400 : undefined} padding={containerPadding}>
          <ScrollView {...keyboardDismissScrollProps}
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={theme.pastel.teal}
              />
            }
          >
            {/* Search Bar */}
            <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
              <Icon
                name="search"
                size={18}
                color={colors.textSecondary}
                style={styles.searchIcon}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search contractors..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Icon name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Filter Tabs */}
            <View style={styles.filterWrapper}>
              <FilterTabs
                tabs={filterTabs}
                activeTab={activeFilter}
                onTabChange={(tabId) => setActiveFilter(tabId as FilterTabId)}
              />
            </View>

            {/* Contractors List - Use grid on iPad landscape */}
            {isTablet && isLandscape ? (
              <AdaptiveGrid gap={cardGap} columns={Math.min(columns, 2)}>
                {contractors.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Icon
                      name="construct"
                      size={40}
                      color={colors.textSecondary}
                      style={{ marginBottom: 8 }}
                    />
                    <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                      No contractors yet
                    </Typography>
                    <Typography variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                      Add your trusted contractors to keep track of their visits and expenses.
                    </Typography>
                  </View>
                ) : (
                  contractors.map((contractor) => (
                    <ContractorCard
                      key={contractor.id}
                      contractor={contractor}
                      onPress={() => handleContractorPress(contractor)}
                      onFavoriteToggle={() => handleToggleFavorite(contractor)}
                    />
                  ))
                )}
              </AdaptiveGrid>
            ) : (
              <>
                {contractors.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Icon
                      name="construct"
                      size={40}
                      color={colors.textSecondary}
                      style={{ marginBottom: 8 }}
                    />
                    <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                      No contractors yet
                    </Typography>
                    <Typography variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                      Add your trusted contractors to keep track of their visits and expenses.
                    </Typography>
                  </View>
                ) : (
                  contractors.map((contractor) => (
                    <ContractorCard
                      key={contractor.id}
                      contractor={contractor}
                      onPress={() => handleContractorPress(contractor)}
                      onFavoriteToggle={() => handleToggleFavorite(contractor)}
                    />
                  ))
                )}
              </>
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Typography variant="body" color={colors.error}>
                  {error}
                </Typography>
              </View>
            )}
          </ScrollView>
        </AdaptiveContainer>

        <FloatingActionButton
          title="Add Contractor"
          icon="+"
          onPress={handleAddContractor}
          testID="contractors-add-fab"
        />
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
    padding: 16,
    paddingBottom: 100,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    ...scaledFont('body'),
    padding: 0,
  },
  filterWrapper: {
    marginBottom: 16,
  },
  contractorCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexWrap: 'wrap',
  },
  specialtyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  favoriteButton: {
    padding: 4,
  },
  cardBody: {
    marginBottom: 12,
  },
  starContainer: {
    flexDirection: 'row',
    marginTop: 4,
  },
  cardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  statItem: {
    alignItems: 'center',
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  errorContainer: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
  },
});
