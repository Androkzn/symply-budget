import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';

import { Typography, Card } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  ButtonMetrics,
  Chat,
  CornerRadius,
  Elevation,
  IconSize,
  Opacity,
  Spacing,
  useAppColors,
} from '@theme';

interface CitationCardProps {
  quotes: string[];
  pageNumbers: number[];
  onPagePress: (pageNumber: number) => void;
  onViewReport: () => void;
  loading?: boolean;
  reportTitle?: string;
}

function hex8(primary: string, alpha: '08' | '12' | '15') {
  if (primary.startsWith('#') && primary.length === 7) return `${primary}${alpha}`;
  return primary;
}

export function CitationCard({
  quotes,
  pageNumbers,
  onPagePress,
  onViewReport,
  loading = false,
  reportTitle,
}: CitationCardProps) {  const colors = useAppColors();
  const primary = colors.primary;

  const pageChipFrame = useMemo(
    () =>
      Platform.select({
        ios: {
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: Opacity.textFieldSubtle,
          shadowRadius: 2,
        },
        android: {
          elevation: Elevation.input,
        },
        default: {},
      }),
    [colors.black]
  );

  if (quotes.length === 0 && pageNumbers.length === 0) {
    return null;
  }

  return (
    <Card style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.header}>
        <Icon name="document-text" size={IconSize.md} color={primary} />
        <Typography variant="headline" weight="semibold" style={styles.headerText}>
          From the Report
        </Typography>
      </View>

      {reportTitle && (
        <Typography variant="caption1" color="secondary" style={styles.reportTitle}>
          {reportTitle}
        </Typography>
      )}

      {quotes.length > 0 && (
        <View style={styles.quotesContainer}>
          {quotes.map((quote, index) => (
            <View
              key={index}
              style={[
                styles.quoteBox,
                {
                  borderLeftColor: primary,
                  backgroundColor: hex8(primary, '08'),
                },
              ]}
            >
              <Icon
                name="chatbox-outline"
                size={IconSize.sm}
                color={primary}
                style={styles.quoteIcon}
              />
              <Typography variant="body" style={styles.quoteText}>
                {quote}
              </Typography>
            </View>
          ))}
        </View>
      )}

      {pageNumbers.length > 0 && (
        <View style={styles.pageSection}>
          <View style={styles.pageHeader}>
            <Icon
              name="document-text-outline"
              size={IconSize.sm}
              color={colors.textSecondary}
            />
            <Typography variant="footnote" color="secondary" style={styles.pageLabel}>
              Referenced on {pageNumbers.length === 1 ? 'page' : 'pages'}:
            </Typography>
          </View>
          <View style={styles.pageChipsContainer}>
            {pageNumbers.map((page) => (
              <TouchableOpacity
                key={page}
                onPress={() => onPagePress(page)}
                disabled={loading}
                style={[
                  styles.pageChip,
                  {
                    backgroundColor: hex8(primary, '15'),
                    borderColor: primary,
                  },
                  pageChipFrame,
                  loading && styles.pageChipDisabled,
                ]}
                activeOpacity={0.7}
              >
                <Typography variant="footnote" color="primary" weight="semibold">
                  {page}
                </Typography>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.viewReportButton,
          { backgroundColor: hex8(primary, '12') },
          loading && styles.buttonDisabled,
        ]}
        onPress={onViewReport}
        disabled={loading}
        activeOpacity={0.7}
      >
        <Icon name="eye-outline" size={IconSize.md} color={primary} />
        <Typography
          variant="subheadline"
          weight="medium"
          style={[styles.buttonText, { color: primary }]}
        >
          {pageNumbers.length > 0 ? `View Page ${pageNumbers[0]}` : 'View in Report'}
        </Typography>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  headerText: {
    marginLeft: Spacing.sm,
  },
  reportTitle: {
    marginBottom: Spacing.md,
    marginLeft: Spacing.xl + Spacing.xs,
  },
  quotesContainer: {
    marginBottom: Spacing.base,
    gap: Spacing.md,
  },
  quoteBox: {
    borderLeftWidth: Spacing.inset3,
    borderRadius: Spacing.xs + Spacing.xxs,
    padding: Spacing.md,
    paddingLeft: Spacing.base,
    position: 'relative',
  },
  quoteIcon: {
    position: 'absolute',
    top: Spacing.sm,
    left: -Spacing.smd,
    opacity: Opacity.tabIconInactive,
  },
  quoteText: {
    lineHeight: 22,
    fontStyle: 'italic',
  },
  pageSection: {
    marginBottom: Spacing.base,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  pageLabel: {
    marginLeft: Chat.compactGap,
  },
  pageChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginLeft: Spacing.lg + Spacing.xxs,
  },
  pageChip: {
    paddingHorizontal: Spacing.smd + Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: Spacing.lg,
    borderWidth: 1.5,
    minWidth: ButtonMetrics.minTapTarget,
    minHeight: ButtonMetrics.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageChipDisabled: {
    opacity: ButtonMetrics.pressOpacityDisabled,
  },
  viewReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    borderRadius: Spacing.smd,
    gap: Spacing.sm,
  },
  buttonText: {
    marginLeft: Spacing.xs,
  },
  buttonDisabled: {
    opacity: ButtonMetrics.pressOpacityDisabled,
  },
});
