import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  homeFeaturesApi,
  maintenanceSuggestionsApi,
  FREQUENCY_LABELS,
  type HomeFeature,
  type SuggestionWithTemplate,
} from '@api';
import { AppBackground, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useIsScrollableFormSheet } from '@navigation/presentation';
import type { TasksStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { GradientButton as GradientButtonSizes, useAppColors } from '@theme';

type MaintenanceSetupNavigationProp = NativeStackNavigationProp<TasksStackParamList, 'MaintenanceSetup'>;

// Feature type icons
const FEATURE_ICONS: Record<string, string> = {
  hvac: 'thermometer-outline',
  central_ac: 'snow-outline',
  furnace: 'flame-outline',
  heat_pump: 'swap-horizontal-outline',
  water_heater: 'water-outline',
  tankless_water_heater: 'water-outline',
  fireplace: 'bonfire-outline',
  wood_stove: 'bonfire-outline',
  pool: 'water-outline',
  hot_tub: 'water-outline',
  septic: 'construct-outline',
  well: 'water-outline',
  roof: 'home-outline',
  sump_pump: 'arrow-down-circle-outline',
  garage_door: 'car-outline',
  smoke_detector: 'alert-circle-outline',
  co_detector: 'alert-circle-outline',
  solar_panels: 'sunny-outline',
  irrigation_system: 'rainy-outline',
  dishwasher: 'cube-outline',
  washing_machine: 'cube-outline',
  dryer: 'cube-outline',
  refrigerator: 'cube-outline',
  default: 'construct-outline',
};

// Feature type display names
const FEATURE_NAMES: Record<string, string> = {
  hvac: 'HVAC System',
  central_ac: 'Central Air Conditioning',
  furnace: 'Furnace',
  heat_pump: 'Heat Pump',
  water_heater: 'Water Heater',
  tankless_water_heater: 'Tankless Water Heater',
  fireplace: 'Fireplace',
  wood_stove: 'Wood Stove',
  pool: 'Swimming Pool',
  hot_tub: 'Hot Tub / Spa',
  septic: 'Septic System',
  well: 'Well Water System',
  roof: 'Roof',
  sump_pump: 'Sump Pump',
  garage_door: 'Garage Door',
  smoke_detector: 'Smoke Detectors',
  co_detector: 'CO Detectors',
  solar_panels: 'Solar Panels',
  irrigation_system: 'Irrigation System',
  dishwasher: 'Dishwasher',
  washing_machine: 'Washing Machine',
  dryer: 'Dryer',
  refrigerator: 'Refrigerator',
};

interface FeatureWithSuggestions {
  feature: HomeFeature;
  suggestions: SuggestionWithTemplate[];
}

export function MaintenanceSetupScreen() {  const colors = useAppColors();
  const navigation = useNavigation<MaintenanceSetupNavigationProp>();
  const insets = useSafeAreaInsets();
  // Page sheet on iPhone, full-screen modal on iPad — the header takes the
  // status-bar inset only in the second case. Derived, never hardcoded.
  const insideSheet = useIsScrollableFormSheet();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  // Consistent layout padding
  const { content: containerPadding } = useLayoutPadding();

  const [featuresWithSuggestions, setFeaturesWithSuggestions] = useState<FeatureWithSuggestions[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());

  // Fetch home features and suggestions
  const fetchData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    setIsLoading(true);
    try {
      // Fetch home features using typed API
      const features = await homeFeaturesApi.getFeatures(currentHousehold.id);

      // Fetch maintenance suggestions using typed API
      const suggestions = await maintenanceSuggestionsApi.getPendingSuggestions(currentHousehold.id);

      // Group suggestions by feature
      const grouped: FeatureWithSuggestions[] = features.map((feature) => ({
        feature,
        suggestions: suggestions.filter((s) => s.feature_id === feature.id),
      }));

      setFeaturesWithSuggestions(grouped);

      // Select all suggestions by default
      const allIds = new Set<string>(suggestions.map((s) => s.id));
      setSelectedSuggestionIds(allIds);
    } catch (error) {
      console.error('Failed to fetch maintenance setup data:', error);
      setFeaturesWithSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Toggle suggestion selection
  const toggleSuggestion = useCallback((suggestionId: string) => {
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(suggestionId)) {
        next.delete(suggestionId);
      } else {
        next.add(suggestionId);
      }
      return next;
    });
  }, []);

  // Toggle all suggestions for a feature
  const toggleFeatureSuggestions = useCallback(
    (featureIndex: number, selected: boolean) => {
      const suggestions = featuresWithSuggestions[featureIndex].suggestions;
      setSelectedSuggestionIds((prev) => {
        const next = new Set(prev);
        for (const suggestion of suggestions) {
          if (selected) {
            next.add(suggestion.id);
          } else {
            next.delete(suggestion.id);
          }
        }
        return next;
      });
    },
    [featuresWithSuggestions]
  );

  // Save selected suggestions as maintenance tasks
  const handleSave = useCallback(async () => {
    if (!currentHousehold?.id) return;

    const selectedIds = Array.from(selectedSuggestionIds);
    if (selectedIds.length === 0) {
      showToast('info', 'Please select at least one maintenance task');
      return;
    }

    setIsSaving(true);
    try {
      const result = await maintenanceSuggestionsApi.applySuggestions(currentHousehold.id, {
        suggestion_ids: selectedIds,
      });

      showToast('success', `Added ${result.applied} maintenance task${result.applied > 1 ? 's' : ''}`);
      navigation.goBack();
    } catch (error) {
      console.error('Failed to apply maintenance suggestions:', error);
      showToast('error', 'Failed to set up maintenance tasks');
    } finally {
      setIsSaving(false);
    }
  }, [currentHousehold?.id, selectedSuggestionIds, navigation]);

  // Skip setup
  const handleSkip = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Format frequency for display
  const formatFrequency = (frequency: string): string => {
    return FREQUENCY_LABELS[frequency] || frequency;
  };

  // Get feature icon
  const getFeatureIcon = (featureType: string): string => {
    return FEATURE_ICONS[featureType] || FEATURE_ICONS.default;
  };

  // Get feature display name
  const getFeatureName = (feature: HomeFeature): string => {
    let name = FEATURE_NAMES[feature.feature_type] || feature.feature_type.replace(/_/g, ' ');

    if (feature.feature_subtype) {
      const subtypeName = feature.feature_subtype.replace(/_/g, ' ');
      name = `${name} (${subtypeName})`;
    }

    if (feature.quantity > 1) {
      name = `${feature.quantity}x ${name}`;
    }

    return name;
  };

  // Calculate total selected count
  const totalSelected = selectedSuggestionIds.size;
  const totalAvailable = featuresWithSuggestions.reduce((acc, f) => acc + f.suggestions.length, 0);

  if (isLoading) {
    return (
      <AppBackground>
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography variant="body" color="secondary" style={styles.loadingText}>
            Loading home features...
          </Typography>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <View style={styles.container} testID="maintenance-setup-screen">
        {/* Header */}
        <ScreenHeader
        title="Set Up Maintenance"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        insideSheet={insideSheet}
      />

        {/* Intro Section */}
        <View style={[styles.introSection, { paddingHorizontal: containerPadding }]}>
          <Typography variant="body" color="secondary">
            Based on your home inspection, we found these features that need regular maintenance.
            Select the tasks you'd like to track.
          </Typography>
        </View>

        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.scrollView]}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 120 },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        >
          {featuresWithSuggestions.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon name="home-outline" size={64} color={colors.textSecondary} />
              <Typography variant="headline" color="secondary" style={styles.emptyText}>
                No home features detected
              </Typography>
              <Typography variant="body" color="secondary" style={styles.emptySubtext}>
                Upload an inspection report to automatically detect your home's features and get
                personalized maintenance suggestions.
              </Typography>
            </View>
          ) : (
            featuresWithSuggestions.map((item, featureIndex) => {
              const { feature, suggestions } = item;
              const featureSelected = suggestions.every((s) => selectedSuggestionIds.has(s.id));
              const featurePartiallySelected =
                suggestions.some((s) => selectedSuggestionIds.has(s.id)) && !featureSelected;

              return (
                <Card
                  key={feature.id}
                  style={[styles.featureCard, { backgroundColor: colors.backgroundSecondary }]}
                >
                  {/* Feature Header */}
                  <TouchableOpacity
                    style={styles.featureHeader}
                    onPress={() => toggleFeatureSuggestions(featureIndex, !featureSelected)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.featureIconContainer, { backgroundColor: colors.primary + '20' }]}>
                      <Icon
                        name={getFeatureIcon(feature.feature_type)}
                        size={24}
                        color={colors.primary}
                      />
                    </View>
                    <View style={styles.featureInfo}>
                      <Typography variant="headline" weight="semibold">
                        {getFeatureName(feature)}
                      </Typography>
                      {feature.location && (
                        <Typography variant="caption1" color="secondary">
                          {feature.location}
                        </Typography>
                      )}
                      <Typography variant="caption1" color="secondary">
                        {suggestions.length} maintenance task{suggestions.length !== 1 ? 's' : ''}
                      </Typography>
                    </View>
                    <View style={styles.featureToggle}>
                      <View
                        style={[
                          styles.checkbox,
                          featureSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                          featurePartiallySelected && { backgroundColor: colors.primary + '50', borderColor: colors.primary },
                        ]}
                      >
                        {(featureSelected || featurePartiallySelected) && (
                          <Icon name="checkmark" size={16} color={colors.white} />
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Suggestions List */}
                  <View style={styles.suggestionsList}>
                    {suggestions.map((suggestion) => {
                      const isSelected = selectedSuggestionIds.has(suggestion.id);

                      return (
                        <TouchableOpacity
                          key={suggestion.id}
                          style={[
                            styles.suggestionItem,
                            isSelected && { backgroundColor: colors.primary + '10' },
                          ]}
                          onPress={() => toggleSuggestion(suggestion.id)}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.suggestionCheckbox,
                              isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                            ]}
                          >
                            {isSelected && <Icon name="checkmark" size={14} color={colors.white} />}
                          </View>
                          <View style={styles.suggestionContent}>
                            <Typography variant="subheadline" weight="medium">
                              {suggestion.template.title}
                            </Typography>
                            <View style={styles.suggestionMeta}>
                              <Typography variant="caption1" color="secondary">
                                {suggestion.template.frequency ? formatFrequency(suggestion.template.frequency) : 'N/A'}
                              </Typography>
                              {suggestion.template.professional_recommended && (
                                <View style={[styles.proBadge, { backgroundColor: colors.purple + '20' }]}>
                                  <Typography variant="caption2" color={colors.purple}>
                                    Pro
                                  </Typography>
                                </View>
                              )}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Card>
              );
            })
          )}
        </ScrollView>

        {/* Action Buttons */}
        {featuresWithSuggestions.length > 0 && (
          <View
            style={[
              styles.actionsContainer,
              { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <ScreenFooterGlass />
            <View style={styles.selectionInfo}>
              <Typography variant="subheadline" color="secondary">
                {totalSelected} of {totalAvailable} tasks selected
              </Typography>
            </View>

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                style={[styles.skipButton, { borderColor: colors.borderColor }]}
                onPress={handleSkip}
              >
                <Typography variant="body" color="secondary">
                  Skip for Now
                </Typography>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.saveButton,
                  { backgroundColor: colors.primary },
                  totalSelected === 0 && { opacity: 0.5 },
                ]}
                onPress={handleSave}
                disabled={isSaving || totalSelected === 0}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Set Up Maintenance
                  </Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
  },
  introSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    marginTop: 8,
    textAlign: 'center',
  },
  featureCard: {
    padding: 0,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  featureIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureInfo: {
    flex: 1,
  },
  featureToggle: {
    marginLeft: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionsList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  suggestionCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  proBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  actionsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Tall enough that the glass fade begins well above the buttons, so its
    // top edge reads as transparent rather than a hard line over the content.
    paddingTop: 32,
    overflow: 'hidden',
  },
  selectionInfo: {
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  skipButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
    borderWidth: 1,
  },
  saveButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
  },
});

export default MaintenanceSetupScreen;
