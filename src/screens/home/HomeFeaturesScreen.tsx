import { useRouter } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Alert } from 'react-native';

import {
  homeFeaturesApi,
  FEATURE_TYPES,
  CONDITION_OPTIONS,
  type HomeFeature,
} from '@api/home-features';
import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, Card, GradientButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useHomeFeaturesStore } from '@stores/homeFeaturesStore';
import { useHouseholdStore } from '@stores/householdStore';
import {CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

// Get feature type info
function getFeatureTypeInfo(featureType: string): { label: string; icon: IoniconName } {
  const typeInfo = FEATURE_TYPES.find((t) => t.value === featureType);
  const icons: Record<string, IoniconName> = {
    hvac: 'snow',
    central_ac: 'snow',
    furnace: 'flame',
    heat_pump: 'thermometer',
    boiler: 'flame',
    water_heater: 'water',
    tankless_water_heater: 'water',
    fireplace: 'flame',
    wood_stove: 'bonfire',
    pool: 'water',
    hot_tub: 'water',
    septic: 'water',
    well: 'water',
    water_softener: 'water',
    sump_pump: 'water',
    solar_panels: 'sunny',
    generator: 'flash',
    security_system: 'lock-closed',
    garage_door: 'car',
    irrigation_system: 'rainy',
    radon_mitigation: 'shield-checkmark',
    central_vacuum: 'sparkles',
    other: 'home',
  };

  return {
    label: typeInfo?.label || featureType,
    icon: icons[featureType] || 'home',
  };
}

// Get condition badge color
function getConditionColor(condition: string, theme: any): string {
  const colors = useAppColors();
  switch (condition) {
    case 'excellent':
      return colors.success;
    case 'good':
      return theme.pastel.teal;
    case 'fair':
      return colors.warning;
    case 'poor':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

// Format condition label
function getConditionLabel(condition: string): string {
  const option = CONDITION_OPTIONS.find((c) => c.value === condition);
  return option?.label || condition;
}

interface FeatureCardProps {
  feature: HomeFeature;
  onPress: () => void;
}

function FeatureCard({ feature, onPress }: FeatureCardProps) {
  const colors = useAppColors();
  const { theme } = useTheme();
  const typeInfo = getFeatureTypeInfo(feature.feature_type);
  const conditionColor = getConditionColor(feature.condition, theme);

  return (
    <TouchableOpacity
      style={[styles.featureCard, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.featureCardHeader}>
        <View style={styles.featureCardLeft}>
          <Icon
            name={typeInfo.icon}
            size={28}
            color={colors.primary}
            style={styles.featureIcon}
          />
          <View style={styles.featureInfo}>
            <Typography variant="body" weight="semibold" numberOfLines={1}>
              {typeInfo.label}
            </Typography>
            {feature.brand && (
              <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
                {feature.brand}
                {feature.model ? ` - ${feature.model}` : ''}
              </Typography>
            )}
            {feature.location && (
              <View style={styles.metaRow}>
                <Icon name="location" size={12} color={colors.textSecondary} />
                <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                  {feature.location}
                </Typography>
              </View>
            )}
          </View>
        </View>
        <View style={styles.featureCardRight}>
          <View style={[styles.conditionBadge, { backgroundColor: conditionColor + '20' }]}>
            <Typography variant="caption2" color={conditionColor} weight="semibold">
              {getConditionLabel(feature.condition)}
            </Typography>
          </View>
          {feature.age_years !== null && (
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              style={styles.ageText}
            >
              {feature.age_years} yr{feature.age_years !== 1 ? 's' : ''} old
            </Typography>
          )}
        </View>
      </View>
      {feature.quantity > 1 && (
        <View style={[styles.quantityBadge, { backgroundColor: colors.primary + '20' }]}>
          <Typography variant="caption2" color={colors.primary} weight="semibold">
            ×{feature.quantity}
          </Typography>
        </View>
      )}
      {feature.notes && (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          numberOfLines={2}
          style={styles.notesText}
        >
          {feature.notes}
        </Typography>
      )}
      {feature.source === 'report_extraction' && feature.extraction_confidence !== null && (
        <View style={[styles.extractedBadge, styles.metaRow]}>
          <Icon name="document-text" size={12} color={colors.textSecondary} />
          <Typography variant="caption2" color={colors.textSecondary}>
            From inspection report ({Math.round(feature.extraction_confidence * 100)}% confidence)
          </Typography>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Group features by type
function groupFeaturesByType(features: HomeFeature[]): Record<string, HomeFeature[]> {
  return features.reduce(
    (groups, feature) => {
      const type = feature.feature_type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(feature);
      return groups;
    },
    {} as Record<string, HomeFeature[]>
  );
}

export function HomeFeaturesScreen() {
  const colors = useAppColors();
  const { theme } = useTheme();
  const router = useRouter();
  const { currentHousehold } = useHouseholdStore();
  const { features, setFeatures, removeFeature, isLoading, setLoading, setError } =
    useHomeFeaturesStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      setLocalError(null);
      setLoading(true);
      const data = await homeFeaturesApi.getFeatures(currentHousehold.id);
      setFeatures(data);
    } catch (err) {
      console.error('Error loading home features:', err);
      setLocalError('Failed to load home features');
      setError('Failed to load home features');
    } finally {
      setLoading(false);
    }
  }, [currentHousehold?.id, setFeatures, setLoading, setError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleFeaturePress = (feature: HomeFeature) => {
    const typeInfo = getFeatureTypeInfo(feature.feature_type);
    const conditionInfo = CONDITION_OPTIONS.find((c) => c.value === feature.condition);

    const details = [
      `Type: ${typeInfo.label}`,
      feature.feature_subtype ? `Subtype: ${feature.feature_subtype}` : null,
      feature.location ? `Location: ${feature.location}` : null,
      feature.brand ? `Brand: ${feature.brand}` : null,
      feature.model ? `Model: ${feature.model}` : null,
      feature.install_date ? `Installed: ${new Date(feature.install_date).getFullYear()}` : null,
      `Condition: ${conditionInfo?.label || feature.condition}`,
      feature.quantity > 1 ? `Quantity: ${feature.quantity}` : null,
      feature.notes ? `\nNotes: ${feature.notes}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    Alert.alert(feature.feature_type.replace(/_/g, ' ').toUpperCase(), details, [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => handleDeleteFeature(feature),
      },
      { text: 'Close', style: 'cancel' },
    ]);
  };

  const handleDeleteFeature = async (feature: HomeFeature) => {
    Alert.alert(
      'Delete Feature',
      `Are you sure you want to delete this ${feature.feature_type.replace(/_/g, ' ')}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!currentHousehold?.id) return;
              await homeFeaturesApi.deleteFeature(currentHousehold.id, feature.id);
              removeFeature(feature.id);
            } catch (err) {
              Alert.alert('Error', 'Failed to delete feature. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleAddFeature = () => {
    Alert.alert(
      'Add Home Feature',
      'Manual feature entry allows you to add features that were not automatically detected from your inspection reports.\n\nThis feature is coming soon!',
      [{ text: 'OK', style: 'default' }]
    );
  };

  if (isLoading && features.length === 0) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader
          title="Home Features"
          showBackButton
          onBackPress={() => router.back()}
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (localError) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader
          title="Home Features"
          showBackButton
          onBackPress={() => router.back()}
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />
        <View style={styles.errorContainer}>
          <Typography variant="body" color={colors.error}>
            {localError}
          </Typography>
          <GradientButton onPress={loadData} style={styles.retryButton} title="Retry" />
        </View>
      </AppBackground>
    );
  }

  if (features.length === 0) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader
          title="Home Features"
          showBackButton
          onBackPress={() => router.back()}
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />
        <View style={styles.emptyContainer}>
          <Icon
            name="home"
            size={48}
            color={colors.textSecondary}
            style={styles.emptyIcon}
          />
          <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
            No Home Features Yet
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
            Track your home's major systems and appliances. Features are automatically extracted
            from inspection reports or you can add them manually.
          </Typography>
          <GradientButton
            onPress={handleAddFeature}
            style={styles.emptyButton}
            title="Add Feature"
            fullWidth
          />
        </View>
      </AppBackground>
    );
  }

  const groupedFeatures = groupFeaturesByType(features);
  const featureTypes = Object.keys(groupedFeatures).sort();

  // Summary stats
  const totalFeatures = features.length;
  const featuresNeedingAttention = features.filter(
    (f) => f.condition === 'poor' || f.condition === 'fair'
  ).length;
  const extractedFeatures = features.filter((f) => f.source === 'report_extraction').length;

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Home Features"
        showBackButton
        onBackPress={() => router.back()}
        onNotificationPress={() => router.push('/notifications')}
        onProfilePress={() => router.push('/profile')}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        {/* Summary Card */}
        <Card variant="filled" style={styles.summaryCard}>
          <Typography variant="title3" weight="semibold" style={styles.summaryTitle}>
            Home Features Overview
          </Typography>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Typography variant="headline" weight="bold" color={colors.primary}>
                {totalFeatures}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Total Features
              </Typography>
            </View>
            <View style={styles.summaryItem}>
              <Typography
                variant="headline"
                weight="bold"
                color={featuresNeedingAttention > 0 ? colors.warning : colors.success}
              >
                {featuresNeedingAttention}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Need Attention
              </Typography>
            </View>
            <View style={styles.summaryItem}>
              <Typography variant="headline" weight="bold" color={theme.pastel.teal}>
                {extractedFeatures}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                From Reports
              </Typography>
            </View>
          </View>
        </Card>

        {/* Add Feature Button */}
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={handleAddFeature}
          activeOpacity={0.7}
        >
          <Icon
            name="add"
            size={24}
            color={colors.primary}
            style={styles.addIcon}
          />
          <Typography variant="body" weight="semibold" color={colors.primary}>
            Add Home Feature
          </Typography>
        </TouchableOpacity>

        {/* Features by Type */}
        {featureTypes.map((type) => {
          const typeInfo = getFeatureTypeInfo(type);
          const typeFeatures = groupedFeatures[type];

          return (
            <View key={type} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Icon name={typeInfo.icon} size={20} color={colors.primary} />
                  <Typography variant="title3" weight="semibold">
                    {typeInfo.label}
                  </Typography>
                </View>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {typeFeatures.length} item{typeFeatures.length !== 1 ? 's' : ''}
                </Typography>
              </View>
              {typeFeatures.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  onPress={() => handleFeaturePress(feature)}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
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
    padding: Spacing.xxl,
  },
  retryButton: {
    marginTop: Spacing.base,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  emptyIcon: {
    marginBottom: Spacing.base,
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
  },
  emptyText: {
    marginBottom: Spacing.xl,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: Spacing.sm,
  },
  summaryCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  summaryTitle: {
    marginBottom: Spacing.base,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.xl,
  },
  addIcon: {
    marginRight: Spacing.sm,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  featureCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.md,
  },
  featureCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  featureCardLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  featureIcon: {
    marginRight: Spacing.md,
  },
  featureInfo: {
    flex: 1,
  },
  featureCardRight: {
    alignItems: 'flex-end',
    marginLeft: Spacing.md,
  },
  conditionBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.sm,
  },
  ageText: {
    marginTop: Spacing.xs,
  },
  quantityBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    paddingHorizontal: Spacing.xs + Spacing.xxs,
    paddingVertical: Spacing.xxs,
    borderRadius: Spacing.xs + Spacing.xxs,
  },
  notesText: {
    marginTop: Spacing.md,
  },
  extractedBadge: {
    marginTop: Spacing.sm,
  },
});
