import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useFocusEffect } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, RefreshControl, FlatList } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, FilterTabs, SearchBar } from '@components/ui';
import type { FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { utilitiesApi, type UtilityBill } from '@features/utilities/api/utilities';
import { ProviderLogo } from '@features/utilities/components/ProviderLogo';
import type { UtilitiesStackParamList } from '@features/utilities/navigation/types';
import { getBillTypeIonicon } from '@features/utilities/providers/bill-providers';
import { hasProviderLogo } from '@features/utilities/providers/provider-logos';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { parseLocalDateOnly } from '@utils/localDate';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type UtilityBillsScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList, 'UtilityBills'>;

// Format currency from cents
function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

// Format date. parseLocalDateOnly keeps date-only strings from rendering one day
// early west of GMT (new Date('2026-07-14') is UTC midnight).
function formatDate(dateString: string): string {
  return parseLocalDateOnly(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface BillCardProps {
  bill: UtilityBill;
  onPress: () => void;
}

function BillCard({ bill, onPress }: BillCardProps) {  const colors = useAppColors();
  const isPaid = bill.paid_date !== null;

  // Brand logos are wordmarks that already name the provider, so the text
  // title is redundant when a real logo renders — only show it when we fall
  // back to a generic bill-type icon.
  const hasLogo = hasProviderLogo(undefined, bill.provider);
  const title = bill.provider || bill.bill_type.charAt(0).toUpperCase() + bill.bill_type.slice(1);

  return (
    <TouchableOpacity
      style={[styles.billCard, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.billCardHeader}>
        <View style={styles.billCardLeft}>
          <ProviderLogo
            providerName={bill.provider}
            fallbackIcon={getBillTypeIonicon(bill.bill_type)}
            size={40}
            logoWidth={84}
          />
          <View style={styles.billCardInfo}>
            {!hasLogo && (
              <Typography variant="body" weight="semibold" numberOfLines={1}>
                {title}
              </Typography>
            )}
            <Typography variant="caption1" color={colors.textSecondary}>
              {formatDate(bill.billing_period_start)} - {formatDate(bill.billing_period_end)}
            </Typography>
          </View>
        </View>
        <View style={styles.billCardRight}>
          <Typography variant="title3" weight="bold" color={colors.success}>
            {formatCurrency(bill.amount)}
          </Typography>
          {isPaid ? (
            <View style={[styles.paidBadge, { backgroundColor: colors.success + '1A' }]}>
              <Typography variant="caption2" color={colors.success}>
                Paid
              </Typography>
            </View>
          ) : (
            <Typography variant="caption1" color={colors.textSecondary}>
              Due: {formatDate(bill.due_date)}
            </Typography>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function UtilityBillsScreen() {
  // Used by the loading spinner and the empty-list caption below. Its absence
  // made the very first render throw (`isLoading` starts true), so this screen
  // crashed on mount — the only `useAppColors()` call in the file was the one
  // inside `BillCard`, which is a different scope.
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes. Passed to the FlatList
  // as `extraData` too — cells are pure and would otherwise keep the old symbol.
  const displayCurrency = useDisplayCurrency();
  const navigation = useNavigation<UtilityBillsScreenNavigationProp>();
  const { currentHousehold } = useHouseholdStore();
  const [bills, setBills] = useState<UtilityBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filterTabs: FilterTab[] = [
    { id: 'all', label: 'All' },
    { id: 'electricity', label: 'Electricity' },
    { id: 'gas', label: 'Gas' },
    { id: 'water', label: 'Water' },
    { id: 'garbage', label: 'Garbage' },
    { id: 'unpaid', label: 'Unpaid' },
  ];

  const loadBills = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      const filters: NonNullable<Parameters<typeof utilitiesApi.getBills>[1]> = {};
      if (activeFilter !== 'all') {
        if (activeFilter === 'unpaid') {
          filters.paid = false;
        } else {
          filters.billType = activeFilter;
        }
      }
      const data = await utilitiesApi.getBills(currentHousehold.id, filters);
      setBills(data);
    } catch (err) {
      console.error('Error loading bills:', err);
    }
  }, [currentHousehold?.id, activeFilter]);

  useEffect(() => {
    setIsLoading(true);
    loadBills().finally(() => setIsLoading(false));
  }, [loadBills]);

  // Refetch when returning to this screen (e.g. after deleting/editing a bill
  // in the detail screen and navigating back) so the list reflects the change.
  // Skip the first focus — the mount effect above already loaded — and refresh
  // quietly in the background afterwards.
  const hasFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      loadBills();
    }, [loadBills])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadBills();
    setIsRefreshing(false);
  };

  const handleBillPress = (bill: UtilityBill) => {
    navigation.navigate('UtilityDetail', { billId: bill.id });
  };

  const filteredBills = bills.filter((bill) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      bill.provider?.toLowerCase().includes(query) ||
      bill.bill_type.toLowerCase().includes(query) ||
      bill.account_number?.toLowerCase().includes(query)
    );
  });

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
      <View style={styles.container}>
        <View style={styles.filterContainer}>
          <FilterTabs
            tabs={filterTabs}
            activeTab={activeFilter}
            onTabChange={(tabId) => setActiveFilter(tabId)}
            scrollable
          />
        </View>
        <View style={styles.searchContainer}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search bills..."
            showMic={false}
          />
        </View>
        <FlatList
          data={filteredBills}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <BillCard bill={item} onPress={() => handleBillPress(item)} />}
          extraData={displayCurrency}
          contentContainerStyle={styles.listContent}
          // The search field above stays visible, but its keypad covered the
          // last results and ate the first tap on any of them.
          {...keyboardDismissScrollProps}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Typography variant="body" color={colors.textSecondary}>
                No bills found
              </Typography>
            </View>
          }
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterContainer: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
  },
  searchContainer: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  listContent: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  billCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.md,
  },
  billCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  billCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  billCardInfo: {
    flex: 1,
  },
  billCardRight: {
    alignItems: 'flex-end',
  },
  paidBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.sm,
    marginTop: Spacing.xs,
  },
  emptyContainer: {
    padding: Spacing.xxl,
    alignItems: 'center',
  },
});
