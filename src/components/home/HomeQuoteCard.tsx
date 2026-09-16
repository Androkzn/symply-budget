import React, { useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Animated, Platform } from 'react-native';

import type { QuoteWithDetails } from '@api/quotes';
import { QUOTE_STATUS_INFO } from '@api/quotes';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useAppColors } from '@theme';
import { formatMoney, formatMoneyRange, useDisplayCurrency } from '@utils/money';

interface HomeQuoteCardProps {
  quote: QuoteWithDetails;
  onPress: () => void;
}

export function HomeQuoteCard({ quote, onPress }: HomeQuoteCardProps) {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusInfo = QUOTE_STATUS_INFO[quote.status];

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  // Format amount display
  const getAmountDisplay = () => {
    if (quote.amount_cents) {
      return formatMoney(quote.amount_cents);
    } else if (quote.amount_range_low_cents && quote.amount_range_high_cents) {
      return formatMoneyRange(quote.amount_range_low_cents, quote.amount_range_high_cents);
    }
    return 'Pending Estimate';
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Quote for ${quote.title} from ${quote.contractor.name}`}
      accessibilityHint="Tap to view quote details"
    >
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.borderColor,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Left: Icon */}
        <View style={[styles.iconContainer, { backgroundColor: `${statusInfo.color}15` }]}>
          <View style={[styles.iconInner, { backgroundColor: statusInfo.color }]}>
            <Icon name="document-text" size={20} color={colors.white} />
          </View>
        </View>

        {/* Center: Content */}
        <View style={styles.content}>
          <Typography
            variant="headline"
            weight="semibold"
            numberOfLines={1}
            color={colors.textPrimary}
            style={styles.title}
          >
            {quote.title}
          </Typography>
          <Typography variant="subheadline" color={colors.textSecondary} numberOfLines={1}>
            {quote.contractor.name}
          </Typography>
          {quote.estimated_duration && (
            <Typography variant="footnote" color={colors.textSecondary}>
              {quote.estimated_duration}
            </Typography>
          )}
        </View>

        {/* Right: Amount + Status */}
        <View style={styles.rightSection}>
          <Typography variant="callout" weight="semibold" color={colors.textPrimary} align="right">
            {getAmountDisplay()}
          </Typography>
          <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}20` }]}>
            <Typography variant="caption2" weight="semibold" color={statusInfo.color}>
              {statusInfo.label}
            </Typography>
          </View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  iconInner: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 16,
    letterSpacing: -0.3,
  },
  rightSection: {
    alignItems: 'flex-end',
    gap: 6,
    marginLeft: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
});
