import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

import { quotesApi } from '@api/quotes';
import { useHouseholdStore } from '@stores/householdStore';
import { useQuoteStore } from '@stores/quoteStore';
import { useAppColors } from '@theme';

import { EmptyState } from './EmptyState';
import { HomeQuoteCard } from './HomeQuoteCard';
import { SectionHeader } from './SectionHeader';


interface HomePendingQuotesSectionProps {
  onSeeAllPress?: () => void;
}

export function HomePendingQuotesSection({ onSeeAllPress }: HomePendingQuotesSectionProps) {
  const colors = useAppColors();  const router = useRouter();
  const selectedHousehold = useHouseholdStore((s) => s.households[0]);
  const { pendingQuotes, setPendingQuotes, setLoading, setError } = useQuoteStore();

  // Fetch pending quotes on mount
  useEffect(() => {
    if (!selectedHousehold) return;

    const fetchQuotes = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await quotesApi.getPending(selectedHousehold.id);
        setPendingQuotes(data.quotes);
      } catch (error) {
        console.error('Failed to fetch pending quotes:', error);
        setError('Failed to load pending quotes');
      } finally {
        setLoading(false);
      }
    };

    fetchQuotes();
  }, [selectedHousehold?.id, setPendingQuotes, setLoading, setError]);

  // Display first 3 quotes
  const displayQuotes = useMemo(() => pendingQuotes.slice(0, 3), [pendingQuotes]);

  const handleSeeAll = () => {
    if (onSeeAllPress) {
      onSeeAllPress();
    } else {
      router.push({ pathname: '/contractors', params: { screen: 'Quotes' } });
    }
  };

  const handleQuotePress = (quoteId: string) => {
    router.push({
      pathname: '/contractors',
      params: { screen: 'QuoteDetail', quoteId },
    });
  };

  const content = (
    <>
      <SectionHeader
        title="Pending Quotes"
        count={pendingQuotes.length}
        onSeeAll={pendingQuotes.length > 0 ? handleSeeAll : undefined}
      />
      {displayQuotes.length > 0 ? (
        <>
          {displayQuotes.map((quote) => (
            <HomeQuoteCard key={quote.id} quote={quote} onPress={() => handleQuotePress(quote.id)} />
          ))}
        </>
      ) : (
        <EmptyState
          icon="document-text"
          title="No Pending Quotes"
          message="When contractors send you quotes, they'll appear here."
        />
      )}
    </>
  );

  // Use Liquid Glass on iOS 26+
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={styles.sectionGlass} glassEffectStyle="regular" isInteractive>
        {content}
      </GlassView>
    );
  }

  // Fallback for older iOS
  return (
    <View style={[styles.section, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionGlass: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    ...Platform.select({
      ios: {
        shadowColor: '#FFF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
      },
    }),
  },
  section: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
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
});
