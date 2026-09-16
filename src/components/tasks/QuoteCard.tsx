import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import type { QuoteWithDetails } from '@api/quotes';
import { Icon } from '@components/ui/Icon';
import { useAppColors, type AppColors } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

interface QuoteCardProps {
  quote: QuoteWithDetails;
  isRecommended?: boolean;
  isSelected?: boolean;
  onPress?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  showActions?: boolean;
}

export function QuoteCard({
  quote,
  isRecommended,
  isSelected,
  onPress,
  onAccept,
  onDecline,
  showActions = false,
}: QuoteCardProps) {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const formatCurrency = (cents: number | null) => {
    if (!cents) return 'Not specified';
    return formatMoney(cents, { decimals: 2 });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'requested':
        return colors.warning;
      case 'received':
        return colors.accent;
      case 'reviewing':
        return colors.info;
      case 'accepted':
        return colors.success;
      case 'declined':
        return colors.textSecondary;
      case 'expired':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const handleCall = () => {
    if (quote.contractor.phone) {
      Linking.openURL(`tel:${quote.contractor.phone}`);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.container,
        isSelected && styles.containerSelected,
        isRecommended && styles.containerRecommended,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      {isRecommended && (
        <View style={styles.recommendedBadge}>
          <Icon name="sparkles" size={12} color={colors.white} />
          <Text style={styles.recommendedText}>AI Recommended</Text>
        </View>
      )}

      <View style={styles.header}>
        <View style={styles.contractorInfo}>
          <Text style={styles.contractorName}>{quote.contractor.name}</Text>
          {quote.contractor.company_name && (
            <Text style={styles.companyName}>{quote.contractor.company_name}</Text>
          )}
          <View style={styles.specialtyRow}>
            <Icon
              name={getContractorCategoryIcon(quote.contractor.specialty)}
              size={16}
              color={colors.textSecondary}
              style={styles.specialtyIcon}
            />
            <Text style={styles.specialtyLabel}>{quote.contractor.specialtyInfo.label}</Text>
          </View>
        </View>

        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(quote.status) }]} />
          <Text style={styles.statusText}>{quote.status}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.detailsContainer}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Price:</Text>
          <Text style={styles.detailValue}>
            {quote.amount_cents
              ? formatCurrency(quote.amount_cents)
              : quote.amount_range_low_cents && quote.amount_range_high_cents
              ? `${formatCurrency(quote.amount_range_low_cents)} - ${formatCurrency(quote.amount_range_high_cents)}`
              : 'TBD'}
          </Text>
        </View>

        {quote.estimated_duration && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Timeline:</Text>
            <Text style={styles.detailValue}>{quote.estimated_duration}</Text>
          </View>
        )}

        {quote.warranty_terms && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Warranty:</Text>
            <Text style={styles.detailValue}>{quote.warranty_terms}</Text>
          </View>
        )}

        {quote.contractor.rating && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Rating:</Text>
            <View style={styles.ratingValue}>
              {Array.from({ length: Math.round(quote.contractor.rating) }).map((_, i) => (
                <Icon key={i} name="star" size={14} color={colors.warning} />
              ))}
              <Text style={styles.detailValue}> ({quote.contractor.rating}/5)</Text>
            </View>
          </View>
        )}

        {(quote.isExpiringSoon || quote.isExpired) && (
          <View style={[styles.warningBox, quote.isExpired && styles.errorBox]}>
            <Icon
              name="warning"
              size={13}
              color={quote.isExpired ? colors.error : colors.warning}
              style={styles.warningIcon}
            />
            <Text style={[styles.warningText, quote.isExpired && styles.errorText]}>
              {quote.isExpired ? 'Quote has expired' : 'Quote expiring soon'}
            </Text>
          </View>
        )}
      </View>

      {showActions && (
        <View style={styles.actionsContainer}>
          {quote.contractor.phone && (
            <TouchableOpacity style={styles.actionButton} onPress={handleCall}>
              <Icon name="call" size={14} color={colors.textPrimary} />
              <Text style={styles.actionButtonText}>Call</Text>
            </TouchableOpacity>
          )}

          {quote.status === 'received' && onAccept && (
            <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={onAccept}>
              <Text style={styles.primaryButtonText}>Accept</Text>
            </TouchableOpacity>
          )}

          {quote.status !== 'declined' && onDecline && (
            <TouchableOpacity style={[styles.actionButton, styles.secondaryButton]} onPress={onDecline}>
              <Text style={styles.secondaryButtonText}>Decline</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  containerSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  containerRecommended: {
    borderColor: colors.warning,
    borderWidth: 2,
    backgroundColor: colors.warning + '1A',
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  recommendedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  contractorInfo: {
    flex: 1,
  },
  contractorName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  companyName: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  specialtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  specialtyIcon: {
    marginRight: 6,
  },
  specialtyLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.pillBackground,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 12,
  },
  detailsContainer: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  ratingValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.warning + '1A',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  warningIcon: {
    marginTop: 1,
  },
  errorBox: {
    backgroundColor: colors.error + '1A',
  },
  warningText: {
    fontSize: 13,
    color: colors.warning,
    textAlign: 'center',
  },
  errorText: {
    color: colors.error,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.pillBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.white,
  },
  secondaryButton: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.error,
  },
  secondaryButtonText: {
    color: colors.error,
  },
});
