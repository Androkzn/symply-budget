import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {IconSize, useAppColors } from '@theme';

interface EvidenceLinksProps {
  pageNumbers: number[];
  onPagePress?: (pageNumber: number) => void;
  compact?: boolean;
}

export function EvidenceLinks({
  pageNumbers,
  onPagePress,
  compact = false,
}: EvidenceLinksProps) {
  const colors = useAppColors();
  if (!pageNumbers || pageNumbers.length === 0) {
    return null;
  }

  // Sort and deduplicate page numbers
  const uniquePages = [...new Set(pageNumbers)].sort((a, b) => a - b);

  if (compact) {
    // Compact mode: show as inline text
    return (
      <View style={styles.compactContainer}>
        <Typography variant="caption2" color={colors.textSecondary}>
          See pages:{' '}
        </Typography>
        {uniquePages.map((page, index) => (
          <React.Fragment key={page}>
            <TouchableOpacity
              onPress={() => onPagePress?.(page)}
              disabled={!onPagePress}
            >
              <Typography
                variant="caption2"
                color={colors.primary}
                weight="medium"
              >
                {page}
              </Typography>
            </TouchableOpacity>
            {index < uniquePages.length - 1 && (
              <Typography variant="caption2" color={colors.textSecondary}>
                ,{' '}
              </Typography>
            )}
          </React.Fragment>
        ))}
      </View>
    );
  }

  // Full mode: show as clickable chips
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Typography variant="caption1" color={colors.textSecondary}>
          Evidence from report
        </Typography>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContainer}
      >
        {uniquePages.map((page) => (
          <TouchableOpacity
            key={page}
            style={[
              styles.chip,
              {
                backgroundColor: colors.primary + '15',
                borderColor: colors.primary + '30',
              },
            ]}
            onPress={() => onPagePress?.(page)}
            disabled={!onPagePress}
          >
            <Typography variant="caption1" color={colors.primary}>
              Page {page}
            </Typography>
            {onPagePress && (
              <Icon
                name="arrow-forward"
                size={IconSize.sm}
                color={colors.primary}
                style={styles.linkIcon}
              />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
      {onPagePress && (
        <Typography
          variant="caption2"
          color={colors.textTertiary}
          style={styles.hint}
        >
          Tap to view in original report
        </Typography>
      )}
    </View>
  );
}

// Component for displaying evidence quotes
interface EvidenceQuoteProps {
  quote: string;
  pageNumber?: number;
  onPress?: () => void;
}

export function EvidenceQuote({ quote, pageNumber, onPress }: EvidenceQuoteProps) {
  // Reads `colors.*` but never called the hook — the same omission
  // `EvidenceLinks` above avoids. Every render threw
  // `ReferenceError: Property 'colors' doesn't exist`.
  const colors = useAppColors();

  return (
    <TouchableOpacity
      style={[
        styles.quoteContainer,
        { backgroundColor: colors.groupedListBackground },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.quoteMark}>
        <Typography variant="title2" color={colors.textTertiary}>
          "
        </Typography>
      </View>
      <Typography
        variant="footnote"
        color={colors.textSecondary}
        style={styles.quoteText}
      >
        {quote}
      </Typography>
      {pageNumber && (
        <Typography
          variant="caption2"
          color={colors.primary}
          style={styles.quoteSource}
        >
          — Page {pageNumber}
        </Typography>
      )}
    </TouchableOpacity>
  );
}

// Combined evidence section component
interface EvidenceSectionProps {
  pageNumbers: number[];
  quotes?: Array<{ text: string; pageNumber?: number }>;
  onPagePress?: (pageNumber: number) => void;
}

export function EvidenceSection({
  pageNumbers,
  quotes,
  onPagePress,
}: EvidenceSectionProps) {
  // Reads `colors.*` but never called the hook — the same omission
  // `EvidenceLinks` above avoids. Every render threw
  // `ReferenceError: Property 'colors' doesn't exist`.
  const colors = useAppColors();

  const hasEvidence = pageNumbers.length > 0 || (quotes && quotes.length > 0);

  if (!hasEvidence) {
    return null;
  }

  return (
    <View style={styles.sectionContainer}>
      <View
        style={[styles.sectionDivider, { backgroundColor: colors.borderColor }]}
      />

      <Typography
        variant="subheadline"
        weight="medium"
        style={styles.sectionTitle}
      >
        Supporting Evidence
      </Typography>

      {/* Page Links */}
      {pageNumbers.length > 0 && (
        <EvidenceLinks pageNumbers={pageNumbers} onPagePress={onPagePress} />
      )}

      {/* Quotes */}
      {quotes && quotes.length > 0 && (
        <View style={styles.quotesContainer}>
          {quotes.map((quote, index) => (
            <EvidenceQuote
              key={index}
              quote={quote.text}
              pageNumber={quote.pageNumber}
              onPress={
                quote.pageNumber
                  ? () => onPagePress?.(quote.pageNumber!)
                  : undefined
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
  },
  header: {
    marginBottom: 8,
  },
  chipsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  linkIcon: {
    marginLeft: 4,
  },
  hint: {
    marginTop: 6,
  },
  compactContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  quoteContainer: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  quoteMark: {
    position: 'absolute',
    top: 4,
    left: 8,
    opacity: 0.5,
  },
  quoteText: {
    paddingLeft: 16,
    fontStyle: 'italic',
  },
  quoteSource: {
    marginTop: 6,
    textAlign: 'right',
  },
  sectionContainer: {
    marginTop: 16,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  quotesContainer: {
    marginTop: 8,
  },
});

export default EvidenceLinks;
