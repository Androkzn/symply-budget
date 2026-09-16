import { useRouter } from 'expo-router';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';

import { quotesApi } from '@api/quotes';
import type { AIQuoteComparison } from '@api/quotes';
import { tasksApi } from '@api/tasks';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AIRecommendationBadge } from '@components/tasks/AIRecommendationBadge';
import { QuoteCard } from '@components/tasks/QuoteCard';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { toMemberFacingError } from '@features/house/local/memberFacingError';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import type { TasksStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { Layout, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

export function QuoteComparisonScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<TasksStackScreenProps<'QuoteComparison'>['navigation']>();
  const route = useRoute<TasksStackScreenProps<'QuoteComparison'>['route']>();
  const router = useRouter();
  const colors = useAppColors();
  // Side-by-side comparison is core and always renders; AI only adds the
  // recommendation layer on top.
  const { canUseAI } = useAIEntitlement();
  const { taskId, quoteIds } = route.params;
  const showError = useMemberFacingAlert();

  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<AIQuoteComparison | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [task, setTask] = useState<any>(null);

  const { currentHousehold } = useHouseholdStore();
  const { setAIComparison } = useTaskStore();

  useEffect(() => {
    loadComparison();
  }, []);

  const loadComparison = async () => {
    if (!currentHousehold) return;

    /**
     * Kept so the catch below can prefer it (DoD H7, positive half).
     *
     * The AI pass failing is normally invisible on purpose — the plain
     * side-by-side comparison is the product and it still renders. But when the
     * AI pass failed because it is *deliberately off* (P4 on a local-first
     * build) AND the plain path then fails too, the honest thing to show is the
     * written explanation, not "We couldn't compare these quotes", which reads
     * as a fault in something that is working as designed.
     */
    let aiError: unknown = null;

    try {
      setLoading(true);

      const taskData = await tasksApi.get(currentHousehold.id, taskId);
      setTask(taskData.task);

      // Side-by-side comparison is rule-based and always available. The AI pass
      // (recommendation, scores, red flags, negotiation tips) is the extra, so
      // it is attempted only when a provider is connected — and a failure there
      // never costs the user the plain comparison.
      if (canUseAI) {
        try {
          const comparisonData = await tasksApi.compareTaskQuotesWithAI(
            currentHousehold.id,
            taskId,
            quoteIds
          );
          setComparison(comparisonData.comparison);
          setAIComparison(taskId, comparisonData.comparison);
          return;
        } catch (err) {
          aiError = err;
          console.warn('AI quote analysis unavailable, falling back:', err);
        }
      }

      const plain = await quotesApi.compare(currentHousehold.id, {
        quote_ids: quoteIds,
      });
      setComparison({ comparison: plain.comparison, aiAnalysis: null });
    } catch (error) {
      console.error('Failed to compare quotes:', error);
      const fallback = 'We couldn’t compare these quotes. Please try again.';
      // `expected` is true only for the deliberate P4/not-ready errors, so this
      // promotes the written copy and never lets a stale AI failure mask a real
      // one from the plain path.
      const fromAi = aiError ? toMemberFacingError(aiError, fallback) : null;
      showError(fromAi?.expected ? aiError : error, fallback);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRecommended = async () => {
    if (!currentHousehold || !comparison?.aiAnalysis?.recommendedQuoteId) return;

    const recommendedQuote = comparison.comparison.quotes.find(
      (q) => q.id === comparison.aiAnalysis!.recommendedQuoteId
    );

    if (!recommendedQuote) return;

    Alert.alert(
      'Accept Recommended Quote',
      `Accept quote from ${recommendedQuote.contractor.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              await quotesApi.accept(currentHousehold.id, recommendedQuote.id);
              await tasksApi.selectTaskQuote(currentHousehold.id, taskId, {
                quote_id: recommendedQuote.id,
              });
              Alert.alert('Success', 'Quote accepted! You can now schedule work.');
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to accept quote');
            }
          },
        },
      ]
    );
  };

  const header = (
    <ScreenHeader
      title="Quote Comparison"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
    />
  );

  if (loading) {
    return (
      <AppBackground>
        {header}
        <View style={styles.loadingContainer} testID="quote-comparison-screen">
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography variant="body" color={colors.textTertiary} style={styles.loadingText}>
            {canUseAI ? 'Analyzing quotes with AI...' : 'Comparing quotes...'}
          </Typography>
        </View>
      </AppBackground>
    );
  }

  if (!comparison) {
    return (
      <AppBackground>
        {header}
        <View style={styles.errorContainer} testID="quote-comparison-screen">
          <Typography variant="body" color={colors.error}>
            Failed to load comparison
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const { aiAnalysis } = comparison;
  const summary = comparison.comparison.summary;
  const contractorName = (quoteId: string | undefined) =>
    comparison.comparison.quotes.find((q) => q.id === quoteId)?.contractor?.name ?? '—';
  const money = (cents: number) => formatMoney(cents);
  const summaryRows = [
    summary.lowestPrice && {
      label: 'Lowest price',
      value: `${contractorName(summary.lowestPrice.quoteId)} · ${money(summary.lowestPrice.amount)}`,
    },
    summary.highestPrice && {
      label: 'Highest price',
      value: `${contractorName(summary.highestPrice.quoteId)} · ${money(summary.highestPrice.amount)}`,
    },
    summary.fastestTimeline && {
      label: 'Fastest',
      value: `${contractorName(summary.fastestTimeline.quoteId)} · ${summary.fastestTimeline.duration}`,
    },
    summary.bestWarranty && {
      label: 'Best warranty',
      value: contractorName(summary.bestWarranty.quoteId),
    },
    summary.highestRatedContractor && {
      label: 'Highest rated',
      value: `${contractorName(summary.highestRatedContractor.quoteId)} · ${summary.highestRatedContractor.rating.toFixed(1)}★`,
    },
  ].filter(Boolean) as { label: string; value: string }[];
  const recommendedQuote = aiAnalysis
    ? comparison.comparison.quotes.find((q) => q.id === aiAnalysis.recommendedQuoteId)
    : null;

  return (
      <AppBackground>
        {header}

        <ScrollView
          style={screenScrollViewStyle.scroll}
          contentContainerStyle={styles.scrollContent}
          testID="quote-comparison-screen"
        >
          {task ? (
            <Typography variant="body" color={colors.textTertiary} style={styles.taskSubtitle}>
              {task.title}
            </Typography>
          ) : null}

          {aiAnalysis ? (
            <>
              <View style={styles.section}>
                <AIRecommendationBadge
                  confidence={aiAnalysis.confidence}
                  reasoning={aiAnalysis.reasoning}
                  onPress={() => setShowDetails(!showDetails)}
                />

                {showDetails && (
                  <View style={[styles.detailsCard, { backgroundColor: colors.card }]}>
                    <Typography
                      variant="titleSmall"
                      weight="semibold"
                      color={colors.textPrimary}
                      style={styles.detailsTitle}
                    >
                      Detailed Analysis
                    </Typography>

                    {aiAnalysis.comparisonMatrix.map((matrix) => (
                      <View
                        key={matrix.quoteId}
                        style={[styles.matrixCard, { backgroundColor: colors.backgroundSecondary }]}
                      >
                        <Typography
                          variant="bodyLarge"
                          weight="semibold"
                          color={colors.textPrimary}
                          style={styles.matrixContractor}
                        >
                          {matrix.contractorName}
                        </Typography>
                        <View style={styles.scoresGrid}>
                          <View style={[styles.scoreItem, { backgroundColor: colors.card }]}>
                            <Typography
                              variant="captionSmall"
                              color={colors.textTertiary}
                              style={styles.scoreLabel}
                            >
                              Price
                            </Typography>
                            <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
                              {matrix.priceScore}/10
                            </Typography>
                          </View>
                          <View style={[styles.scoreItem, { backgroundColor: colors.card }]}>
                            <Typography
                              variant="captionSmall"
                              color={colors.textTertiary}
                              style={styles.scoreLabel}
                            >
                              Quality
                            </Typography>
                            <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
                              {matrix.qualityScore}/10
                            </Typography>
                          </View>
                          <View style={[styles.scoreItem, { backgroundColor: colors.card }]}>
                            <Typography
                              variant="captionSmall"
                              color={colors.textTertiary}
                              style={styles.scoreLabel}
                            >
                              Timeline
                            </Typography>
                            <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
                              {matrix.timelineScore}/10
                            </Typography>
                          </View>
                          <View style={[styles.scoreItem, { backgroundColor: colors.card }]}>
                            <Typography
                              variant="captionSmall"
                              color={colors.textTertiary}
                              style={styles.scoreLabel}
                            >
                              Warranty
                            </Typography>
                            <Typography variant="bodyLarge" weight="semibold" color={colors.primary}>
                              {matrix.warrantyScore}/10
                            </Typography>
                          </View>
                        </View>
                        <View style={[styles.overallScore, { backgroundColor: colors.accent }]}>
                          <Typography variant="body" weight="semibold" color={colors.white}>
                            Overall Score:
                          </Typography>
                          <Typography variant="titleSmall" weight="bold" color={colors.white}>
                            {matrix.overallScore}/10
                          </Typography>
                        </View>

                        {matrix.pros.length > 0 && (
                          <View style={styles.prosConsSection}>
                            <View style={[styles.prosConsTitle, styles.headerRow]}>
                              <Icon name="checkmark-circle" size={16} color={colors.success} />
                              <Typography
                                variant="bodySmall"
                                weight="semibold"
                                color={colors.textPrimary}
                                style={styles.headerRowText}
                              >
                                Pros:
                              </Typography>
                            </View>
                            {matrix.pros.map((pro, i) => (
                              <Typography
                                key={i}
                                variant="bodySmall"
                                color={colors.textSecondary}
                                style={styles.prosConsText}
                              >
                                • {pro}
                              </Typography>
                            ))}
                          </View>
                        )}

                        {matrix.cons.length > 0 && (
                          <View style={styles.prosConsSection}>
                            <View style={[styles.prosConsTitle, styles.headerRow]}>
                              <Icon name="close-circle" size={16} color={colors.error} />
                              <Typography
                                variant="bodySmall"
                                weight="semibold"
                                color={colors.textPrimary}
                                style={styles.headerRowText}
                              >
                                Cons:
                              </Typography>
                            </View>
                            {matrix.cons.map((con, i) => (
                              <Typography
                                key={i}
                                variant="bodySmall"
                                color={colors.textSecondary}
                                style={styles.prosConsText}
                              >
                                • {con}
                              </Typography>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}

                    {aiAnalysis.redFlags.length > 0 && (
                      <View style={[styles.redFlagsSection, { backgroundColor: colors.destructiveSubtle }]}>
                        <View style={[styles.redFlagsTitle, styles.headerRow]}>
                          <Icon name="warning" size={18} color={colors.error} />
                          <Typography
                            variant="body"
                            weight="semibold"
                            color={colors.error}
                            style={styles.headerRowText}
                          >
                            Red Flags:
                          </Typography>
                        </View>
                        {aiAnalysis.redFlags.map((flag, index) => (
                          <View key={index} style={styles.redFlag}>
                            <Typography variant="bodySmall" weight="semibold" color={colors.error}>
                              {flag.contractorName}:
                            </Typography>
                            <Typography
                              variant="bodySmall"
                              color={colors.textSecondary}
                              style={styles.redFlagText}
                            >
                              {flag.flag}
                            </Typography>
                          </View>
                        ))}
                      </View>
                    )}

                    {aiAnalysis.negotiationTips.length > 0 && (
                      <View style={[styles.tipsSection, { backgroundColor: colors.surfaceSelected }]}>
                        <View style={[styles.tipsTitle, styles.headerRow]}>
                          <Icon name="bulb" size={18} color={colors.primary} />
                          <Typography
                            variant="body"
                            weight="semibold"
                            color={colors.primary}
                            style={styles.headerRowText}
                          >
                            Negotiation Tips:
                          </Typography>
                        </View>
                        {aiAnalysis.negotiationTips.map((tip, index) => (
                          <Typography
                            key={index}
                            variant="bodySmall"
                            color={colors.textSecondary}
                            style={styles.tipText}
                          >
                            {index + 1}. {tip}
                          </Typography>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>

              <View style={styles.section}>
                <View style={[styles.sectionTitle, styles.headerRow]}>
                  <Icon name="document-text" size={18} color={colors.textPrimary} />
                  <Typography
                    variant="bodyLarge"
                    weight="semibold"
                    color={colors.textPrimary}
                    style={styles.headerRowText}
                  >
                    All Quotes
                  </Typography>
                </View>
                {comparison.comparison.quotes.map((quote) => (
                  <QuoteCard
                    key={quote.id}
                    quote={quote}
                    isRecommended={quote.id === aiAnalysis.recommendedQuoteId}
                  />
                ))}
              </View>

              {recommendedQuote && (
                <View style={styles.actionSection}>
                  <TouchableOpacity
                    style={[styles.acceptButton, { backgroundColor: colors.success }]}
                    onPress={handleAcceptRecommended}
                  >
                    <Typography variant="bodyLarge" weight="semibold" color={colors.white}>
                      Accept Recommended Quote
                    </Typography>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <View style={styles.noAISection}>
              <TouchableOpacity
                style={[styles.unlockCard, { backgroundColor: colors.card }]}
                onPress={() => router.push('/ai-access')}
                accessibilityRole="button"
                testID="quote-comparison-unlock-ai"
              >
                <Icon name="sparkles-outline" size={20} color={colors.primary} />
                <View style={styles.unlockCardText}>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    Want a recommendation?
                  </Typography>
                  <Typography variant="bodySmall" color={colors.textSecondary}>
                    Add AI assistance to score these quotes, flag risks and suggest
                    negotiation points. Comparing them side by side is always free.
                  </Typography>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              {/* Rule-based summary — computed from the quotes themselves, no AI. */}
              <View style={styles.section}>
                <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
                  {summaryRows.map((row) => (
                    <View key={row.label} style={styles.summaryRow}>
                      <Typography variant="bodySmall" color={colors.textSecondary}>
                        {row.label}
                      </Typography>
                      <Typography variant="bodySmall" weight="semibold" color={colors.textPrimary}>
                        {row.value}
                      </Typography>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <View style={[styles.sectionTitle, styles.headerRow]}>
                  <Icon name="document-text" size={18} color={colors.textPrimary} />
                  <Typography
                    variant="bodyLarge"
                    weight="semibold"
                    color={colors.textPrimary}
                    style={styles.headerRowText}
                  >
                    Quotes
                  </Typography>
                </View>
                {comparison.comparison.quotes.map((quote) => (
                  <QuoteCard key={quote.id} quote={quote} />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: Layout.bottomTabBarClearance,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskSubtitle: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerRowText: {
    flexShrink: 1,
  },
  detailsCard: {
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  detailsTitle: {
    marginBottom: 16,
  },
  matrixCard: {
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  matrixContractor: {
    marginBottom: 12,
  },
  scoresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  scoreItem: {
    flex: 1,
    minWidth: '45%',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  scoreLabel: {
    marginBottom: 4,
  },
  overallScore: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  prosConsSection: {
    marginTop: 12,
  },
  prosConsTitle: {
    marginBottom: 8,
  },
  prosConsText: {
    marginBottom: 4,
    lineHeight: 20,
  },
  redFlagsSection: {
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  redFlagsTitle: {
    marginBottom: 12,
  },
  redFlag: {
    marginBottom: 8,
  },
  redFlagText: {
    marginTop: 2,
  },
  tipsSection: {
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  tipsTitle: {
    marginBottom: 12,
  },
  tipText: {
    marginBottom: 8,
    lineHeight: 20,
  },
  noAISection: {
    padding: 16,
  },
  unlockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  unlockCardText: {
    flex: 1,
    gap: 2,
  },
  summaryCard: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  actionSection: {
    padding: 16,
    paddingBottom: 32,
  },
  acceptButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
});
