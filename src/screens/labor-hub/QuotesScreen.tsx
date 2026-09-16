import { useNavigation } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  quotesApi,
  type QuoteWithDetails,
  type QuoteStatus,
  QUOTE_STATUSES,
  QUOTE_STATUS_INFO,
} from '@api/quotes';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { useQuoteStore } from '@stores/quoteStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

// Format currency from cents, compactly ("CA$1.2k") in the display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents, { abbreviate: true });
}

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const diffTime = date.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `Expired ${Math.abs(diffDays)} days ago`;
  }
  if (diffDays === 0) {
    return 'Expires today';
  }
  if (diffDays === 1) {
    return 'Expires tomorrow';
  }
  if (diffDays <= 7) {
    return `Expires in ${diffDays} days`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type FilterStatus = 'all' | QuoteStatus;

// Quote Card Component
interface QuoteCardProps {
  quote: QuoteWithDetails;
  onPress: () => void;
  isSelected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: () => void;
}

function QuoteCard({ quote, onPress, isSelected, selectionMode, onToggleSelect }: QuoteCardProps) {  const colors = useAppColors();
  const statusInfo = QUOTE_STATUS_INFO[quote.status] || QUOTE_STATUS_INFO.requested;

  const getAmountDisplay = () => {
    if (quote.amount_cents) {
      return formatCurrency(quote.amount_cents);
    }
    if (quote.amount_range_low_cents && quote.amount_range_high_cents) {
      return `${formatCurrency(quote.amount_range_low_cents)} - ${formatCurrency(quote.amount_range_high_cents)}`;
    }
    return 'Pending';
  };

  const handlePress = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect();
    } else {
      onPress();
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: colors.backgroundSecondary },
        isSelected && { borderColor: colors.primary, borderWidth: 2 },
      ]}
      onPress={handlePress}
      onLongPress={onToggleSelect}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        {selectionMode && (
          <View style={styles.checkboxContainer}>
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: isSelected ? colors.primary : 'transparent',
                  borderColor: isSelected ? colors.primary : colors.borderColor,
                },
              ]}
            >
              {isSelected && <Icon name="checkmark" size={16} color={colors.white} />}
            </View>
          </View>
        )}
        <View style={[styles.iconCircle, { backgroundColor: colors.warning + '20' }]}>
          <Icon name="document-text" size={22} color={colors.warning} />
        </View>
        <View style={styles.cardContent}>
          <Typography variant="subheadline" weight="semibold" numberOfLines={1}>
            {quote.title}
          </Typography>
          <Typography variant="caption1" color="secondary">
            {quote.contractor.name}
            {quote.contractor.company_name && ` - ${quote.contractor.company_name}`}
          </Typography>
          <View style={styles.amountRow}>
            <Typography
              variant="headline"
              weight="bold"
              style={{ color: colors.primary }}
            >
              {getAmountDisplay()}
            </Typography>
            {quote.estimated_duration && (
              <Typography variant="caption2" color="secondary" style={{ marginLeft: 8 }}>
                {quote.estimated_duration}
              </Typography>
            )}
          </View>
        </View>
        <View>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
            <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
              {statusInfo.label}
            </Typography>
          </View>
          {quote.valid_until && (
            <View style={styles.validUntilRow}>
              {quote.isExpiringSoon && (
                <Icon
                  name="warning"
                  size={12}
                  color={colors.error}
                  style={{ marginRight: 3 }}
                />
              )}
              <Typography
                variant="caption2"
                color={quote.isExpiringSoon ? 'error' : 'secondary'}
                style={{ textAlign: 'right' }}
              >
                {formatDate(quote.valid_until)}
              </Typography>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Filter Chip Component
interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  color?: string;
  count?: number;
}

function FilterChip({ label, isActive, onPress, color, count }: FilterChipProps) {
  const colors = useAppColors();

  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        {
          backgroundColor: isActive
            ? color || colors.primary
            : colors.groupedListBackground,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Typography
        variant="caption1"
        weight="medium"
        color={isActive ? 'onPrimary' : 'secondary'}
      >
        {label}
      </Typography>
      {count !== undefined && count > 0 && (
        <View
          style={[
            styles.countBadge,
            { backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : colors.borderColor },
          ]}
        >
          <Typography
            variant="caption2"
            weight="semibold"
            color={isActive ? 'onPrimary' : 'secondary'}
          >
            {count}
          </Typography>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Empty State Component
function EmptyState({ message, icon }: { message: string; icon: IoniconName }) {
  const colors = useAppColors();
  return (
    <View style={styles.emptyState}>
      <Icon name={icon} size={40} color={colors.textSecondary} style={{ opacity: 0.5 }} />
      <Typography variant="subheadline" color="secondary" style={{ marginTop: 8 }}>
        {message}
      </Typography>
    </View>
  );
}

// Main Screen Component
export function QuotesScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();

  const {
    quotes,
    setQuotes,
    isLoading,
    setLoading,
  } = useQuoteStore();

  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<Set<string>>(new Set());

  const householdId = currentHousehold?.id;

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    try {
      const response = await quotesApi.getAll(householdId);
      setQuotes(response.quotes);
    } catch (error) {
      console.error('Error fetching quotes:', error);
    } finally {
      setLoading(false);
    }
  }, [householdId, setQuotes, setLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Filter quotes
  const filteredQuotes = useMemo(() => {
    let filtered = quotes;

    if (filterStatus !== 'all') {
      filtered = filtered.filter((q) => q.status === filterStatus);
    }

    // Sort by created date, newest first
    return [...filtered].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [quotes, filterStatus]);

  // Count by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: quotes.length };
    QUOTE_STATUSES.forEach((status) => {
      counts[status] = quotes.filter((q) => q.status === status).length;
    });
    return counts;
  }, [quotes]);

  const handleQuotePress = (quote: QuoteWithDetails) => {
    navigation.navigate('QuoteDetail', { quoteId: quote.id });
  };

  const handleRequestQuote = () => {
    navigation.navigate('RequestQuote', {});
  };

  const handleCompareQuotes = () => {
    if (selectedQuotes.size < 2) {
      return;
    }
    navigation.navigate('QuoteComparison', { quoteIds: Array.from(selectedQuotes) });
    setSelectionMode(false);
    setSelectedQuotes(new Set());
  };

  const toggleQuoteSelection = (quoteId: string) => {
    const newSelected = new Set(selectedQuotes);
    if (newSelected.has(quoteId)) {
      newSelected.delete(quoteId);
    } else {
      newSelected.add(quoteId);
    }
    setSelectedQuotes(newSelected);
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedQuotes(new Set());
  };

  return (
    <AppBackground>
      <ScreenHeader
        title="Quotes"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          selectionMode ? (
            <TouchableOpacity onPress={cancelSelection} style={styles.headerButton}>
              <Typography variant="subheadline" color="primary">
                Cancel
              </Typography>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleRequestQuote} style={styles.headerButton}>
              <Icon name="add-circle" size={28} color={colors.primary} />
            </TouchableOpacity>
          )
        }
      />

      <View style={styles.container}>
        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[screenScrollViewStyle.scroll, styles.filterContainer]}
          contentContainerStyle={styles.filterContent}
        >
          <FilterChip
            label="All"
            isActive={filterStatus === 'all'}
            onPress={() => setFilterStatus('all')}
            count={statusCounts.all}
          />
          {QUOTE_STATUSES.map((status) => {
            const info = QUOTE_STATUS_INFO[status];
            return (
              <FilterChip
                key={status}
                label={info.label}
                isActive={filterStatus === status}
                onPress={() => setFilterStatus(status)}
                color={info.color}
                count={statusCounts[status]}
              />
            );
          })}
        </ScrollView>

        {/* Selection Mode Actions */}
        {selectionMode && (
          <View style={[styles.selectionBar, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="subheadline" weight="medium">
              {selectedQuotes.size} selected
            </Typography>
            <TouchableOpacity
              style={[
                styles.compareButton,
                {
                  backgroundColor:
                    selectedQuotes.size >= 2 ? colors.primary : colors.groupedListBackground,
                },
              ]}
              onPress={handleCompareQuotes}
              disabled={selectedQuotes.size < 2}
            >
              <Icon
                name="git-compare"
                size={18}
                color={selectedQuotes.size >= 2 ? colors.white : colors.textSecondary}
              />
              <Typography
                variant="caption1"
                weight="semibold"
                color={selectedQuotes.size >= 2 ? 'onPrimary' : 'secondary'}
                style={{ marginLeft: 6 }}
              >
                Compare
              </Typography>
            </TouchableOpacity>
          </View>
        )}

        {/* Compare Button (when not in selection mode) */}
        {!selectionMode && filteredQuotes.length > 1 && (
          <TouchableOpacity
            style={[styles.comparePrompt, { backgroundColor: colors.groupedListBackground }]}
            onPress={() => setSelectionMode(true)}
          >
            <Icon name="git-compare" size={20} color={colors.primary} />
            <Typography variant="caption1" weight="medium" color="primary" style={{ marginLeft: 8 }}>
              Select quotes to compare
            </Typography>
          </TouchableOpacity>
        )}

        {isLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <AdaptiveContainer style={styles.stack}>
              {filteredQuotes.length > 0 ? (
                filteredQuotes.map((quote) => (
                  <QuoteCard
                    key={quote.id}
                    quote={quote}
                    onPress={() => handleQuotePress(quote)}
                    isSelected={selectedQuotes.has(quote.id)}
                    selectionMode={selectionMode}
                    onToggleSelect={() => {
                      if (!selectionMode) {
                        setSelectionMode(true);
                      }
                      toggleQuoteSelection(quote.id);
                    }}
                  />
                ))
              ) : (
                <EmptyState message="No quotes found" icon="document-text" />
              )}
            </AdaptiveContainer>
          </ScrollView>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButton: {
    padding: 4,
    minWidth: 40,
    alignItems: 'center',
  },
  // Filter
  filterContainer: {
    maxHeight: 50,
    marginTop: 8,
  },
  filterContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  // Card
  card: {
    borderRadius: 16,
    padding: 16,
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  validUntilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  // Selection
  checkboxContainer: {
    marginRight: 12,
    justifyContent: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  compareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  comparePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
});

export default QuotesScreen;
