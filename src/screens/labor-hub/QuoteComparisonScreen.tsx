import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  quotesApi,
  type QuoteWithDetails,
  type QuoteComparison,
  QUOTE_STATUS_INFO,
} from '@api/quotes';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useQuoteStore } from '@stores/quoteStore';
import { useAppColors } from '@theme';
import { getContractorCategoryIcon, type IoniconName } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type QuoteComparisonRoute = RouteProp<ContractorsStackParamList, 'QuoteComparison'>;

const CARD_MARGIN = 12;

// Format currency from cents in the user's display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents);
}

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Comparison Row Component
interface ComparisonRowProps {
  label: string;
  values: (string | null)[];
  highlight?: 'lowest' | 'highest' | number;
  icon: IoniconName;
  cardWidth: number;
}

function ComparisonRow({ label, values, highlight, icon, cardWidth }: ComparisonRowProps) {
  const colors = useAppColors();
  return (
    <View style={styles.comparisonRow}>
      <View style={[styles.rowLabel, { backgroundColor: colors.groupedListBackground }]}>
        <Icon
          name={icon}
          size={16}
          color={colors.textSecondary}
          style={{ marginRight: 6 }}
        />
        <Typography variant="caption1" weight="medium">
          {label}
        </Typography>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowValues}
      >
        {values.map((value, index) => {
          const isHighlighted =
            highlight === 'lowest'
              ? index === values.indexOf(values.filter(Boolean).sort()[0])
              : highlight === 'highest'
              ? index === values.indexOf(values.filter(Boolean).sort().reverse()[0])
              : highlight === index;

          return (
            <View
              key={index}
              style={[
                styles.valueCell,
                { width: cardWidth },
                isHighlighted && { backgroundColor: colors.success + '15' },
              ]}
            >
              <Typography
                variant="subheadline"
                weight={isHighlighted ? 'bold' : 'medium'}
                style={isHighlighted ? { color: colors.success } : undefined}
              >
                {value || '-'}
              </Typography>
              {isHighlighted && (
                <Icon
                  name="checkmark-circle"
                  size={16}
                  color={colors.success}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Quote Card Header Component
interface QuoteCardHeaderProps {
  quote: QuoteWithDetails;
  onViewDetails: () => void;
  onAccept: () => void;
  isLowestPrice?: boolean;
  cardWidth: number;
}

function QuoteCardHeader({ quote, onViewDetails, onAccept, isLowestPrice, cardWidth }: QuoteCardHeaderProps) {
  const colors = useAppColors();
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

  return (
    <View
      style={[
        styles.quoteHeader,
        { width: cardWidth, backgroundColor: colors.backgroundSecondary },
        isLowestPrice && { borderColor: colors.success, borderWidth: 2 },
      ]}
    >
      {isLowestPrice && (
        <View style={[styles.bestValueBadge, { backgroundColor: colors.success }]}>
          <Typography variant="caption2" weight="bold" color="onPrimary">
            BEST VALUE
          </Typography>
        </View>
      )}

      <View style={styles.headerContent}>
        <View
          style={[
            styles.contractorIcon,
            { backgroundColor: quote.contractor.specialtyInfo.color + '20' },
          ]}
        >
          <Icon
            name={getContractorCategoryIcon(quote.contractor.specialty)}
            size={22}
            color={quote.contractor.specialtyInfo.color}
          />
        </View>

        <Typography variant="headline" weight="bold" numberOfLines={1}>
          {quote.contractor.name}
        </Typography>

        {quote.contractor.company_name && (
          <Typography variant="caption1" color="secondary" numberOfLines={1}>
            {quote.contractor.company_name}
          </Typography>
        )}

        {quote.contractor.rating && (
          <View style={styles.ratingRow}>
            <Icon name="star" size={13} color={colors.warning} style={{ marginRight: 4 }} />
            <Typography variant="caption1" weight="medium">
              {quote.contractor.rating.toFixed(1)}
            </Typography>
          </View>
        )}

        <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
          <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
            {statusInfo.label}
          </Typography>
        </View>

        <View style={styles.priceContainer}>
          <Typography variant="caption2" color="secondary">
            Quote Amount
          </Typography>
          <Typography
            variant="title2"
            weight="bold"
            style={{ color: isLowestPrice ? colors.success : colors.primary }}
          >
            {getAmountDisplay()}
          </Typography>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.groupedListBackground }]}
            onPress={onViewDetails}
          >
            <Typography variant="caption1" weight="medium" color="primary">
              Details
            </Typography>
          </TouchableOpacity>
          {['received', 'reviewing'].includes(quote.status) && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.success }]}
              onPress={onAccept}
            >
              <Typography variant="caption1" weight="semibold" color="onPrimary">
                Accept
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// Main Screen Component
export function QuoteComparisonScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const route = useRoute<QuoteComparisonRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { updateQuote } = useQuoteStore();
  const cardWidth = Math.min(width * 0.75, 560);

  const [comparison, setComparison] = useState<QuoteComparison | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [_isUpdating, setIsUpdating] = useState(false);

  const { quoteIds } = route.params;
  const householdId = currentHousehold?.id;

  const fetchComparison = useCallback(async () => {
    if (!householdId || quoteIds.length < 2) return;

    setIsLoading(true);
    try {
      const response = await quotesApi.compare(householdId, { quote_ids: quoteIds });
      setComparison(response.comparison);
    } catch (error) {
      console.error('Error fetching comparison:', error);
      Alert.alert('Error', 'Failed to load quote comparison');
    } finally {
      setIsLoading(false);
    }
  }, [householdId, quoteIds]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  const handleViewDetails = (quoteId: string) => {
    navigation.navigate('QuoteDetail', { quoteId });
  };

  const handleAcceptQuote = async (quote: QuoteWithDetails) => {
    if (!householdId) return;

    Alert.alert(
      'Accept Quote',
      `Accept this quote from ${quote.contractor.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setIsUpdating(true);
            try {
              const response = await quotesApi.accept(householdId, quote.id);
              updateQuote(quote.id, response.quote);

              Alert.alert(
                'Quote Accepted',
                'Would you like to create a project from this quote?',
                [
                  { text: 'Not Now', onPress: () => navigation.goBack() },
                  {
                    text: 'Create Project',
                    onPress: () => {
                      navigation.navigate('AddEditProject', {
                        contractorId: quote.contractor_id,
                        quoteId: quote.id,
                      });
                    },
                  },
                ]
              );
            } catch (error) {
              console.error('Error accepting quote:', error);
              Alert.alert('Error', 'Failed to accept quote');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
        title="Compare Quotes"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (!comparison || comparison.quotes.length === 0) {
    return (
      <AppBackground>
        <ScreenHeader
        title="Compare Quotes"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
        <View style={styles.errorContainer}>
          <Typography variant="headline" color="secondary">
            Unable to compare quotes
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const { quotes, summary } = comparison;

  // The server summary carries {quoteId, amount}; the average is a plain mean of
  // whatever quotes have a fixed amount, computed here so the card never shows
  // an empty stat when the backend omits one.
  const quotedAmounts = quotes
    .map((q) => q.amount_cents)
    .filter((cents): cents is number => typeof cents === 'number');
  const averageAmount = quotedAmounts.length
    ? Math.round(quotedAmounts.reduce((sum, cents) => sum + cents, 0) / quotedAmounts.length)
    : null;

  // Find lowest price quote
  const lowestPriceIndex = quotes.reduce((minIndex, quote, index) => {
    const currentAmount = quote.amount_cents || quote.amount_range_low_cents || Infinity;
    const minAmount =
      quotes[minIndex].amount_cents || quotes[minIndex].amount_range_low_cents || Infinity;
    return currentAmount < minAmount ? index : minIndex;
  }, 0);

  return (
    <AppBackground>
      <ScreenHeader
        title="Compare Quotes"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* Summary Card */}
        {summary && (
          <View style={[styles.summaryCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Summary
            </Typography>
            <View style={styles.summaryStats}>
              <View style={styles.summaryStat}>
                <Typography variant="caption1" color="secondary">
                  Price Range
                </Typography>
                <Typography variant="subheadline" weight="bold" color="primary">
                  {summary.lowestPrice ? formatCurrency(summary.lowestPrice.amount) : '-'} -{' '}
                  {summary.highestPrice ? formatCurrency(summary.highestPrice.amount) : '-'}
                </Typography>
              </View>
              <View style={styles.summaryStat}>
                <Typography variant="caption1" color="secondary">
                  Average
                </Typography>
                <Typography variant="subheadline" weight="bold">
                  {averageAmount != null ? formatCurrency(averageAmount) : '-'}
                </Typography>
              </View>
              <View style={styles.summaryStat}>
                <Typography variant="caption1" color="secondary">
                  Comparing
                </Typography>
                <Typography variant="subheadline" weight="bold">
                  {quotes.length} quotes
                </Typography>
              </View>
            </View>
          </View>
        )}

        {/* Quote Headers (horizontal scroll) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quotesRow}
          decelerationRate="fast"
          snapToInterval={cardWidth + CARD_MARGIN}
        >
          {quotes.map((quote, index) => (
            <QuoteCardHeader
              key={quote.id}
              quote={quote}
              onViewDetails={() => handleViewDetails(quote.id)}
              onAccept={() => handleAcceptQuote(quote)}
              isLowestPrice={index === lowestPriceIndex}
              cardWidth={cardWidth}
            />
          ))}
        </ScrollView>

        {/* Comparison Table */}
        <View style={[styles.comparisonTable, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="headline" weight="semibold" style={{ marginBottom: 12, paddingHorizontal: 16 }}>
            Compare Details
          </Typography>

          <ComparisonRow
            label="Price"
            icon="cash"
            values={quotes.map((q) => {
              if (q.amount_cents) return formatCurrency(q.amount_cents);
              if (q.amount_range_low_cents && q.amount_range_high_cents) {
                return `${formatCurrency(q.amount_range_low_cents)} - ${formatCurrency(q.amount_range_high_cents)}`;
              }
              return 'Pending';
            })}
            highlight="lowest"
            cardWidth={cardWidth}
          />

          <ComparisonRow
            label="Duration"
            icon="hourglass"
            values={quotes.map((q) => q.estimated_duration || null)}
            cardWidth={cardWidth}
          />

          <ComparisonRow
            label="Warranty"
            icon="shield-checkmark"
            values={quotes.map((q) => q.warranty_terms || null)}
            cardWidth={cardWidth}
          />

          <ComparisonRow
            label="Valid Until"
            icon="calendar"
            values={quotes.map((q) => (q.valid_until ? formatDate(q.valid_until) : null))}
            cardWidth={cardWidth}
          />

          <ComparisonRow
            label="Rating"
            icon="star"
            values={quotes.map((q) =>
              q.contractor.rating ? `★ ${q.contractor.rating.toFixed(1)}` : null
            )}
            highlight="highest"
            cardWidth={cardWidth}
          />
        </View>

        {/* Decision Tip */}
        <View style={[styles.tipCard, { backgroundColor: colors.primary + '10' }]}>
          <Icon name="bulb" size={24} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Typography variant="subheadline" weight="semibold" color="primary">
              Tip
            </Typography>
            <Typography variant="caption1" color="secondary">
              Consider warranty terms and contractor rating alongside price. The cheapest
              option isn't always the best value.
            </Typography>
          </View>
        </View>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Summary Card
  summaryCard: {
    borderRadius: 16,
    padding: 16,
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryStat: {
    alignItems: 'center',
    gap: 4,
  },
  // Quote Headers
  quotesRow: {
    paddingHorizontal: 8,
    gap: CARD_MARGIN,
  },
  quoteHeader: {
    borderRadius: 16,
    padding: 16,
    marginHorizontal: CARD_MARGIN / 2,
    position: 'relative',
    overflow: 'hidden',
  },
  bestValueBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
  },
  headerContent: {
    alignItems: 'center',
    gap: 4,
  },
  contractorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  priceContainer: {
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
    width: '100%',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  // Comparison Table
  comparisonTable: {
    borderRadius: 16,
    paddingVertical: 16,
  },
  comparisonRow: {
    marginBottom: 1,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowValues: {
    paddingHorizontal: 8,
  },
  valueCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: CARD_MARGIN / 2,
    borderRadius: 8,
  },
  // Tip Card
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 16,
  },
});

export default QuoteComparisonScreen;
