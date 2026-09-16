import { useRoute, useNavigation, RouteProp } from "expo-router/react-navigation";
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import { garbageCollectionApi, WasteRegulations } from '@api/garbage-collection';
import { SafeAreaView, AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, Card, Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { GarbageStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Opacity, Spacing, useAppColors, type AppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type CategoryDetailScreenRouteProp = RouteProp<GarbageStackParamList, 'CategoryDetail'>;

const getCategoryInfo = (
  colors: AppColors
): Record<string, { title: string; icon: IoniconName; color: string; description: string }> => ({
  garbage: {
    title: 'Garbage Collection',
    icon: 'trash',
    color: colors.textSecondary,
    description: 'General waste collection guidelines and regulations',
  },
  recycling: {
    title: 'Recycling',
    icon: 'refresh-circle',
    color: colors.accent,
    description: 'Recyclable materials and sorting guidelines',
  },
  organics: {
    title: 'Organics & Compost',
    icon: 'leaf',
    color: colors.success,
    description: 'Food waste and compostable materials',
  },
});

export function CategoryDetailScreen() {  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<CategoryDetailScreenRouteProp>();
  const { category } = route.params;
  const { currentHousehold } = useHouseholdStore();

  const [regulations, setRegulations] = useState<WasteRegulations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categoryInfo = getCategoryInfo(colors)[category];

  useEffect(() => {
    loadRegulations();
  }, []);

  const loadRegulations = async () => {
    if (!currentHousehold?.city) {
      setError('No city information available');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const { regulations: regs } = await garbageCollectionApi.getWasteRegulations(
        currentHousehold.city
      );
      setRegulations(regs);
    } catch (err) {
      console.error('Failed to load waste regulations:', err);
      setError('Failed to load regulations');
    } finally {
      setIsLoading(false);
    }
  };

  const openLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (err) {
      // Fallback to system browser
      Linking.openURL(url);
    }
  };

  const getCategoryRegulations = () => {
    if (!regulations) return [];
    return regulations[category] || [];
  };

  const categoryRegulations = getCategoryRegulations();

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView style={styles.container}>
        <ScreenHeader
          title={categoryInfo.title}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.scrollView]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Category Header */}
          <Card variant="elevated" style={[styles.headerCard, { backgroundColor: categoryInfo.color }]}>
            <Icon name={categoryInfo.icon} size={64} color={colors.white} style={styles.categoryIcon} />
            {/* The category name is shown in the centered header; the card keeps
                the icon + description without repeating it. */}
            <Typography
              variant="body"
              color={withAlpha(colors.white, Opacity.onColorLabel)}
              style={styles.categoryDescription}
            >
              {categoryInfo.description}
            </Typography>
          </Card>

          {/* Loading State */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color={colors.textSecondary} style={styles.loadingText}>
                Loading regulations...
              </Typography>
            </View>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <Card variant="outlined" style={styles.errorCard}>
              <Typography variant="title3" weight="semibold" color={colors.error} style={styles.errorTitle}>
                {error}
              </Typography>
              <Typography variant="body" color={colors.textSecondary} style={styles.errorMessage}>
                Unable to load waste regulations. Please try again.
              </Typography>
              <Button title="Retry" onPress={loadRegulations} variant="secondary" size="sm" />
            </Card>
          )}

          {/* Regulations List */}
          {!isLoading && !error && (
            <>
              {categoryRegulations.length > 0 ? (
                <>
                  <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
                    REGULATIONS & GUIDELINES
                  </Typography>
                  {categoryRegulations.map((regulation, index) => (
                    <Card key={index} variant="outlined" style={styles.regulationCard}>
                      <View style={styles.regulationContent}>
                        <Typography variant="body" weight="semibold" color={colors.textPrimary} style={styles.regulationTitle}>
                          {regulation.title}
                        </Typography>
                        <TouchableOpacity
                          onPress={() => openLink(regulation.url)}
                          style={[styles.linkButton, { backgroundColor: categoryInfo.color }]}
                        >
                          <Typography variant="subheadline" weight="semibold" color={colors.white}>
                            View Details
                          </Typography>
                          <Icon name="chevron-forward" size={16} color={colors.white} />
                        </TouchableOpacity>
                      </View>
                    </Card>
                  ))}
                </>
              ) : (
                <Card variant="outlined" style={styles.emptyCard}>
                  <Typography variant="title3" color={colors.textPrimary} style={styles.emptyTitle}>
                    No Regulations Available
                  </Typography>
                  <Typography variant="body" color={colors.textSecondary}>
                    No waste regulations found for {currentHousehold?.city || 'your city'}.
                  </Typography>
                </Card>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
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
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxl,
  },
  headerCard: {
    padding: Spacing.xl,
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  categoryIcon: {
    marginBottom: Spacing.md,
  },
  categoryTitle: {
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  categoryDescription: {
    textAlign: 'center',
  },
  loadingContainer: {
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.base,
  },
  errorCard: {
    padding: Spacing.lg,
  },
  errorTitle: {
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    marginBottom: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.base,
    letterSpacing: 0.5,
  },
  regulationCard: {
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  regulationContent: {
    gap: Spacing.md,
  },
  regulationTitle: {
    marginBottom: Spacing.xs,
  },
  linkButton: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  emptyCard: {
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
  },
});
