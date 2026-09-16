import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { floorPlansApi } from '@api/floor-plans';
import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import { tasksApi } from '@api/tasks';
import { AppBackground, ScreenFooterGlass, ScreenHeader } from '@components/common';
import { FloorPlanViewer } from '@components/floor-plans';
import { Typography, GradientButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ENV } from '@config/env';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { isSheetPresentation } from '@navigation/presentation';
import type { FloorPlansSharedStack } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { detectSpaceAtPoint } from '@utils/spaceHitTest';

type NavigationProp = NativeStackNavigationProp<FloorPlansSharedStack, 'FloorPlanMarkerPlacement'>;
type FloorPlanMarkerPlacementRouteProp = RouteProp<FloorPlansSharedStack, 'FloorPlanMarkerPlacement'>;

export function FloorPlanMarkerPlacementScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<FloorPlanMarkerPlacementRouteProp>();
  const floorPlanId = route.params?.floorPlanId;
  const linkedEntityId = route.params?.linkedEntityId;
  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();
  const {
    setCurrentFloorPlan,
    markers,
    setMarkers,
    isLoading,
    setLoading,
  } = useFloorPlanStore();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<{
    x: number;
    y: number;
    x_percent: number;
    y_percent: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [householdSpaces, setHouseholdSpaces] = useState<HouseholdSpace[]>([]);
  const [detectedSpace, setDetectedSpace] = useState<HouseholdSpace | null>(null);

  // Load floor plan
  const loadData = useCallback(async () => {
    if (!currentHousehold || !floorPlanId) return;

    try {
      setLoading(true);

      // Load floor plan
      const fpResponse = await floorPlansApi.get(currentHousehold.id, floorPlanId);
      setCurrentFloorPlan(fpResponse.floor_plan);

      // Load existing markers
      const markersResponse = await floorPlansApi.listMarkers(
        currentHousehold.id,
        floorPlanId
      );
      setMarkers(markersResponse.markers);

      // Set image URL
      if (fpResponse.floor_plan.display_image_key) {
        setImageUrl(`${ENV.API_BASE_URL}/files/${fpResponse.floor_plan.display_image_key}`);
      }

      const spacesResponse = await householdSpacesApi.list(currentHousehold.id);
      setHouseholdSpaces(spacesResponse.spaces ?? []);
    } catch (error) {
      console.error('Failed to load floor plan:', error);
      showToast('error', 'Failed to load floor plan');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [currentHousehold, floorPlanId, setCurrentFloorPlan, setMarkers, setLoading, navigation]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handlePlanPress = useCallback((x: number, y: number, xPercent: number, yPercent: number) => {
    setSelectedPosition({ x, y, x_percent: xPercent, y_percent: yPercent });
    if (floorPlanId) {
      const hit = detectSpaceAtPoint(householdSpaces, xPercent, yPercent, floorPlanId);
      setDetectedSpace(hit);
    }
  }, [floorPlanId, householdSpaces]);

  const handleSaveMarker = useCallback(async () => {
    if (!currentHousehold || !selectedPosition) return;

    try {
      setIsSaving(true);

      const markerData = {
        x_percent: selectedPosition.x_percent * 100,
        y_percent: selectedPosition.y_percent * 100,
        linked_entity_type: 'task' as const,
        linked_entity_id: linkedEntityId,
        marker_type: 'pin' as const,
        marker_color: colors.accent,
        marker_icon: '📍',
        show_label: true,
        space_id: detectedSpace?.id,
      };

      await floorPlansApi.createMarker(currentHousehold.id, floorPlanId, markerData);

      if (detectedSpace?.id) {
        await tasksApi.update(currentHousehold.id, linkedEntityId, {
          space_id: detectedSpace.id,
        }).catch(() => {});
      }

      showToast('success', 'Marker placed successfully');

      navigation.goBack();
    } catch (error) {
      console.error('Failed to save marker:', error);
      showToast('error', 'Failed to save marker');
    } finally {
      setIsSaving(false);
    }
  }, [currentHousehold, floorPlanId, selectedPosition, linkedEntityId, detectedSpace, colors.accent, navigation]);

  if (isLoading || !imageUrl) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Place Marker"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
            insideSheet={isSheetPresentation('modal')}
          />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="floor-plan-marker-placement-screen">
        <ScreenHeader
          title="Place Marker"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          // `presentation: 'modal'` → an iOS page sheet; its card starts below
          // the status bar, so the window inset must not be applied inside it.
          insideSheet={isSheetPresentation('modal')}
        />

        <View style={[styles.instructionsBanner, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="body" color={colors.textSecondary} style={styles.instructions}>
            Tap on the floor plan to place a marker
            {detectedSpace ? ` · ${detectedSpace.name}` : ''}
          </Typography>
        </View>

        <FloorPlanViewer
          imageUrl={imageUrl}
          markers={markers}
          onPlanPress={handlePlanPress}
          interactive
        />

        {selectedPosition && (
          <View style={[styles.actionBar, { left: containerPadding, right: containerPadding }]}>
            <ScreenFooterGlass />
            <GradientButton
              title="Cancel"
              size="lg"
              onPress={() => setSelectedPosition(null)}
              style={styles.actionButton}
              testID="floor-plan-marker-placement-cancel"
            />
            <GradientButton
              title={isSaving ? 'Saving...' : 'Save Marker'}
              size="lg"
              onPress={handleSaveMarker}
              disabled={isSaving}
              style={styles.actionButton}
              testID="floor-plan-marker-placement-save"
            />
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  instructionsBanner: {
    padding: 12,
    alignItems: 'center',
  },
  instructions: {
    textAlign: 'center',
  },
  actionBar: {
    position: 'absolute',
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    // Tall enough that the glass fade begins well above the buttons, so its
    // top edge reads as transparent rather than a hard line over the plan.
    paddingTop: 32,
    overflow: 'hidden',
  },
  actionButton: {
    flex: 1,
  },
});
