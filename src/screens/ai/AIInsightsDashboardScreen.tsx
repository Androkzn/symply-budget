import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';

import {
  aiHousekeeperApi,
  type AIHousekeeperSuggestion,
  type AIMaintenancePrediction,
  type AISeasonalChecklist,
  type AIInsight,
} from '@api/ai-housekeeper';
import { AppBackground, HeaderActionButton, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { formatMoneyRange, useDisplayCurrency } from '@utils/money';

// Suggestion Card Component
function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  onSnooze,
}: {
  suggestion: AIHousekeeperSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
}) {  const colors = useAppColors();

  const getTypeIcon = (type: string): IoniconName => {
    const icons: { [key: string]: IoniconName } = {
      prediction: 'telescope',
      seasonal_reminder: 'leaf',
      cost_optimization: 'cash',
      procrastination_nudge: 'eye',
      celebration: 'trophy',
      batching_opportunity: 'cube',
    };
    return icons[type] || 'bulb';
  };

  const getPriorityColor = (score: number | null) => {
    if (!score) return colors.textSecondary;
    if (score >= 8) return colors.error; // Red
    if (score >= 6) return colors.warning; // Orange
    if (score >= 4) return colors.accent; // Blue
    return colors.textSecondary;
  };

  return (
    <Card variant="elevated" style={[styles.suggestionCard, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.suggestionHeader}>
        <Icon
          name={getTypeIcon(suggestion.suggestion_type)}
          size={28}
          color={colors.primary}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
            {suggestion.title}
          </Typography>
          {suggestion.priority_score && (
            <View style={styles.priorityBadge}>
              <Typography variant="caption2" color={getPriorityColor(suggestion.priority_score)} weight="semibold">
                Priority: {suggestion.priority_score}/10
              </Typography>
            </View>
          )}
        </View>
      </View>

      <Typography variant="body" color={colors.textSecondary} style={{ marginTop: 12, lineHeight: 20 }}>
        {suggestion.description}
      </Typography>

      {suggestion.ai_reasoning && (
        <View style={[styles.reasoningBox, { backgroundColor: colors.groupedListBackground }]}>
          <View style={styles.reasoningRow}>
            <Icon
              name="chatbubble-ellipses"
              size={14}
              color={colors.textSecondary}
              style={styles.reasoningIcon}
            />
            <Typography variant="caption1" color={colors.textSecondary} style={{ flex: 1 }}>
              {suggestion.ai_reasoning}
            </Typography>
          </View>
        </View>
      )}

      <View style={styles.suggestionActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonRow, { backgroundColor: colors.primary }]}
          onPress={onAccept}
        >
          <Icon name="checkmark" size={16} color={colors.white} />
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            Accept
          </Typography>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonRow, { backgroundColor: colors.groupedListBackground }]}
          onPress={onSnooze}
        >
          <Icon name="alarm" size={16} color={colors.textPrimary} />
          <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
            Snooze
          </Typography>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonRow, { backgroundColor: colors.groupedListBackground }]}
          onPress={onDismiss}
        >
          <Icon name="close" size={16} color={colors.textSecondary} />
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            Dismiss
          </Typography>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

// Prediction Card Component
function PredictionCard({ prediction }: { prediction: AIMaintenancePrediction }) {
  const colors = useAppColors();

  const getTypeIcon = (type: string): IoniconName => {
    const icons: { [key: string]: IoniconName } = {
      failure: 'warning',
      service_needed: 'construct',
      replacement_recommended: 'refresh',
      inspection_due: 'search',
    };
    return icons[type] || 'document-text';
  };

  const getConfidenceColor = (level: string) => {
    if (level === 'high') return colors.error;
    if (level === 'medium') return colors.warning;
    return colors.accent;
  };

  const formatCost = (min: number | null, max: number | null) => {
    if (!min || !max) return 'Cost TBD';
    return formatMoneyRange(min, max, { empty: 'Cost TBD' });
  };

  return (
    <Card variant="filled" style={[styles.predictionCard, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.predictionHeader}>
        <Icon
          name={getTypeIcon(prediction.prediction_type)}
          size={24}
          color={getConfidenceColor(prediction.confidence_level)}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View
            style={[
              styles.confidenceBadge,
              { backgroundColor: getConfidenceColor(prediction.confidence_level) + '20' },
            ]}
          >
            <Typography
              variant="caption2"
              weight="semibold"
              color={getConfidenceColor(prediction.confidence_level)}
            >
              {prediction.confidence_level.toUpperCase()} CONFIDENCE
            </Typography>
          </View>
        </View>
      </View>

      <Typography variant="body" weight="medium" color={colors.textPrimary} style={{ marginTop: 8 }}>
        {prediction.reasoning}
      </Typography>

      <View style={[styles.predictionDetails, { backgroundColor: colors.groupedListBackground, marginTop: 12 }]}>
        <View style={styles.predictionDetailRow}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Timeline:
          </Typography>
          <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
            {prediction.predicted_date_min && new Date(prediction.predicted_date_min).toLocaleDateString()} -{' '}
            {prediction.predicted_date_max && new Date(prediction.predicted_date_max).toLocaleDateString()}
          </Typography>
        </View>
        <View style={styles.predictionDetailRow}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Est. Cost:
          </Typography>
          <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
            {formatCost(prediction.estimated_cost_min, prediction.estimated_cost_max)}
          </Typography>
        </View>
      </View>

      <View style={styles.recommendedActionRow}>
        <Icon name="checkmark" size={16} color={colors.primary} />
        <Typography variant="caption1" color={colors.primary} weight="medium" style={{ flex: 1 }}>
          {prediction.recommended_action}
        </Typography>
      </View>
    </Card>
  );
}

export function AIInsightsDashboardScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  /**
   * `navigation`, never expo-router's `router`. This screen is registered in
   * `SettingsNavigator`, which the More tab mounts inside a
   * `NavigationIndependentTree` — `router` addresses the ROOT stack, so
   * `router.back()` left the More tab instead of popping this screen, and
   * `router.push('/aihousekeeper-settings')` opened a second copy of the
   * persona screen over the tab bar rather than the one this stack registers.
   */
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [suggestions, setSuggestions] = useState<AIHousekeeperSuggestion[]>([]);
  const [predictions, setPredictions] = useState<AIMaintenancePrediction[]>([]);
  const [checklist, setChecklist] = useState<AISeasonalChecklist | null>(null);
  const [_insights, setInsights] = useState<AIInsight[]>([]);

  useEffect(() => {
    loadData();
  }, [currentHousehold?.id]);

  const loadData = async () => {
    if (!currentHousehold?.id) return;

    try {
      const [suggestionsData, predictionsData, checklistData, insightsData] = await Promise.all([
        aiHousekeeperApi.getSuggestions(currentHousehold.id, 'pending'),
        aiHousekeeperApi.getPredictions(currentHousehold.id, 'pending'),
        aiHousekeeperApi.getSeasonalChecklist(currentHousehold.id),
        aiHousekeeperApi.getInsights(currentHousehold.id, 'active'),
      ]);

      setSuggestions(suggestionsData.slice(0, 3)); // Top 3
      setPredictions(predictionsData.slice(0, 3)); // Top 3
      setChecklist(checklistData);
      setInsights(insightsData);
    } catch (error) {
      console.error('Failed to load AI insights:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [currentHousehold?.id]);

  const handleAcceptSuggestion = async (suggestionId: string) => {
    try {
      await aiHousekeeperApi.acceptSuggestion(suggestionId);
      // Remove from list
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
      // TODO: Navigate to newly created task
    } catch (error) {
      console.error('Failed to accept suggestion:', error);
    }
  };

  const handleDismissSuggestion = async (suggestionId: string) => {
    try {
      await aiHousekeeperApi.dismissSuggestion(suggestionId);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    } catch (error) {
      console.error('Failed to dismiss suggestion:', error);
    }
  };

  const handleSnoozeSuggestion = async (suggestionId: string) => {
    try {
      await aiHousekeeperApi.snoozeSuggestion(suggestionId, 7); // 7 days
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    } catch (error) {
      console.error('Failed to snooze suggestion:', error);
    }
  };

  const parseChecklistItems = (items: string) => {
    try {
      return JSON.parse(items);
    } catch {
      return [];
    }
  };

  const parseCompletedItems = (items: string | null) => {
    if (!items) return [];
    try {
      return JSON.parse(items);
    } catch {
      return [];
    }
  };

  if (loading) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="AI Insights"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
            showPropertySwitcher={false}
          />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography variant="body" color={colors.textSecondary} style={{ marginTop: 16 }}>
              Loading insights...
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="AI Insights"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
          rightElement={
            <HeaderActionButton
              label="Settings"
              onPress={() => navigation.navigate('AihousekeeperSettings')}
            />
          }
        />

        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {/* Hero Card */}
            <Card variant="elevated" style={[styles.heroCard, { backgroundColor: colors.primary }]}>
              <Icon name="home" size={32} color={colors.white} />
              <View style={styles.heroText}>
                <Typography variant="title3" weight="bold" color={colors.white}>
                  Your AI Home Assistant
                </Typography>
                <Typography variant="body" color="rgba(255,255,255,0.9)" style={{ marginTop: 4 }}>
                  Proactive insights to keep your property in top shape
                </Typography>
              </View>
            </Card>

            {/* Top Priorities */}
            {suggestions.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Icon name="flag" size={20} color={colors.textPrimary} />
                  <Typography variant="title3" weight="bold" color={colors.textPrimary}>
                    Top Priorities
                  </Typography>
                </View>

                {suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onAccept={() => handleAcceptSuggestion(suggestion.id)}
                    onDismiss={() => handleDismissSuggestion(suggestion.id)}
                    onSnooze={() => handleSnoozeSuggestion(suggestion.id)}
                  />
                ))}
              </View>
            )}

            {/* Predictions */}
            {predictions.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Icon name="telescope" size={20} color={colors.textPrimary} />
                  <Typography variant="title3" weight="bold" color={colors.textPrimary}>
                    Maintenance Predictions
                  </Typography>
                </View>

                {predictions.map((prediction) => (
                  <PredictionCard key={prediction.id} prediction={prediction} />
                ))}
              </View>
            )}

            {/* Seasonal Checklist */}
            {checklist && (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Icon name="leaf" size={20} color={colors.textPrimary} />
                  <Typography variant="title3" weight="bold" color={colors.textPrimary}>
                    {checklist.season.charAt(0).toUpperCase() + checklist.season.slice(1)} Checklist
                  </Typography>
                </View>

                <Card variant="filled" style={{ backgroundColor: colors.backgroundSecondary }}>
                  {/* Progress Bar */}
                  <View style={styles.progressHeader}>
                    <Typography variant="body" weight="medium" color={colors.textPrimary}>
                      {Math.round((checklist.completion_rate || 0) * 100)}% Complete
                    </Typography>
                  </View>
                  <View style={[styles.progressBar, { backgroundColor: colors.groupedListBackground }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${(checklist.completion_rate || 0) * 100}%`, backgroundColor: colors.primary },
                      ]}
                    />
                  </View>

                  {/* Checklist Items */}
                  <View style={{ marginTop: 16 }}>
                    {parseChecklistItems(checklist.checklist_items)
                      .slice(0, 5)
                      .map((item: any, _index: number) => {
                        const isCompleted = parseCompletedItems(checklist.completed_items).includes(item.id);
                        return (
                          <View key={item.id} style={styles.checklistItem}>
                            <Icon
                              name={isCompleted ? 'checkmark-circle' : 'square-outline'}
                              size={20}
                              color={isCompleted ? colors.primary : colors.textSecondary}
                            />
                            <Typography
                              variant="body"
                              color={isCompleted ? colors.textSecondary : colors.textPrimary}
                              style={{
                                flex: 1,
                                marginLeft: 12,
                                textDecorationLine: isCompleted ? 'line-through' : 'none',
                              }}
                            >
                              {item.title}
                            </Typography>
                          </View>
                        );
                      })}
                  </View>
                </Card>
              </View>
            )}

            {/* Empty State */}
            {suggestions.length === 0 && predictions.length === 0 && !checklist && (
              <Card variant="filled" style={{ backgroundColor: colors.backgroundSecondary, padding: 32, marginTop: 24 }}>
                <View style={{ alignItems: 'center' }}>
                  <Icon
                    name="trophy"
                    size={48}
                    color={colors.primary}
                    style={{ marginBottom: 16 }}
                  />
                  <Typography variant="title3" weight="bold" color={colors.textPrimary} style={{ textAlign: 'center' }}>
                    All Caught Up!
                  </Typography>
                  <Typography
                    variant="body"
                    color={colors.textSecondary}
                    style={{ textAlign: 'center', marginTop: 8 }}
                  >
                    No new insights right now. Check back later for proactive suggestions.
                  </Typography>
                </View>
              </Card>
            )}

            {/* Bottom Spacing */}
            <View style={{ height: 32 }} />
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    marginBottom: 24,
    gap: 16,
  },
  heroText: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  suggestionCard: {
    padding: 16,
    marginBottom: 12,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  priorityBadge: {
    marginTop: 4,
  },
  reasoningBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  reasoningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  reasoningIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  recommendedActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  predictionCard: {
    padding: 16,
    marginBottom: 12,
  },
  predictionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  predictionDetails: {
    padding: 12,
    borderRadius: 8,
  },
  predictionDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
});
