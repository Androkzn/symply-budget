import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Image } from 'react-native';

import { floorPlansApi, FloorPlan } from '@api/floor-plans';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { isSheetPresentation } from '@navigation/presentation';
import type { FloorPlansSharedStack } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<FloorPlansSharedStack, 'FloorPlanPicker'>;
type FloorPlanPickerRouteProp = RouteProp<FloorPlansSharedStack, 'FloorPlanPicker'>;

export function FloorPlanPickerScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<FloorPlanPickerRouteProp>();
  const linkedEntityType = route.params?.linkedEntityType;
  const linkedEntityId = route.params?.linkedEntityId;  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const { floorPlans, setFloorPlans, isLoading, setLoading } = useFloorPlanStore();

  // Load floor plans
  const loadFloorPlans = useCallback(async () => {
    if (!currentHousehold) return;

    try {
      setLoading(true);
      const response = await floorPlansApi.list(currentHousehold.id);
      setFloorPlans(response.floor_plans.filter((fp) => fp.status === 'completed'));
    } catch (error) {
      console.error('Failed to load floor plans:', error);
      showToast('error', 'Failed to load floor plans');
    } finally {
      setLoading(false);
    }
  }, [currentHousehold, setFloorPlans, setLoading]);

  useEffect(() => {
    loadFloorPlans();
  }, [loadFloorPlans]);

  // Handle floor plan selection
  const handleSelectFloorPlan = useCallback((floorPlan: FloorPlan) => {
    navigation.navigate('FloorPlanMarkerPlacement', {
      floorPlanId: floorPlan.id,
      linkedEntityType,
      linkedEntityId,
    });
  }, [navigation, linkedEntityType, linkedEntityId]);

  // Render floor plan option
  const renderFloorPlanOption = (floorPlan: FloorPlan) => {
    const label = floorPlan.floor_label ||
      (floorPlan.floor_number !== null ? `Floor ${floorPlan.floor_number}` : 'Floor Plan');

    return (
      <TouchableOpacity
        key={floorPlan.id}
        onPress={() => handleSelectFloorPlan(floorPlan)}
        style={styles.optionCard}
      >
        <Card variant="elevated" style={styles.card}>
          {/* Thumbnail */}
          {floorPlan.thumbnail_key ? (
            <Image
              source={{ uri: `${ENV.API_BASE_URL}/files/${floorPlan.thumbnail_key}` }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.thumbnail,
                styles.placeholderThumbnail,
                { backgroundColor: colors.backgroundSecondary },
              ]}
            >
              <Icon name="grid-outline" size={34} color={colors.textSecondary} />
            </View>
          )}

          {/* Details */}
          <View style={styles.details}>
            <Typography variant="body" weight="semibold">
              {floorPlan.building_name}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {label}
            </Typography>
          </View>

          {/* Arrow */}
          <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="Select Floor Plan"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          // Registered `presentation: 'modal'`: on iOS that is a page sheet whose
          // card already starts below the status bar, so the header must not
          // reserve the window inset a second time inside it.
          insideSheet={isSheetPresentation('modal')}
        />

        <AdaptiveContainer>
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : floorPlans.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Icon name="grid-outline" size={40} color={colors.textSecondary} />
                <Typography variant="title1" weight="semibold" style={styles.emptyTitle}>
                  No Floor Plans Available
                </Typography>
                <Typography variant="body" color={colors.textSecondary}>
                  Add floor plans to link tasks to specific locations
                </Typography>
              </View>
            ) : (
              <View style={styles.listContainer}>
                {floorPlans.map(renderFloorPlanOption)}
              </View>
            )}
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
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  listContainer: {
    gap: 12,
  },
  optionCard: {
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  placeholderThumbnail: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  details: {
    flex: 1,
  },
});
