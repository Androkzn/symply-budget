import type { GardenPlanObject } from '@models/garden-objects';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  gardenPlanDisplayLabel,
  gardenPlansApi,
  type GardenPlan,
} from '@api/garden-plans';
import { HeaderActionButton, ScreenHeader } from '@components/common';
import {
  canRenderGardenSatellite,
  GardenPlanVectorEditor,
} from '@components/garden';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { GardeningStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { Header, useAppColors } from '@theme';

type Nav = NativeStackNavigationProp<GardeningStackParamList, 'GardenPlanObjectEditor'>;
type RouteT = RouteProp<GardeningStackParamList, 'GardenPlanObjectEditor'>;

export function GardenPlanObjectEditorScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const { gardenPlanId, preferSatellite, initialCamera } = route.params;  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();

  const [plan, setPlan] = useState<GardenPlan | null>(null);
  const [objects, setObjects] = useState<GardenPlanObject[]>([]);
  // Last-saved snapshot of the objects; the editor mutates `objects` (including
  // geometry) so moving/resizing/adding an object makes the form dirty.
  const [baselineObjects, setBaselineObjects] = useState<GardenPlanObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSatellite, setShowSatellite] = useState(preferSatellite ?? true);

  const canShowSatellite = useMemo(
    () => canRenderGardenSatellite(plan?.boundary_geojson ?? null),
    [plan?.boundary_geojson],
  );
  const imageUrl = plan?.display_image_key
    ? `${ENV.API_BASE_URL}/files/${plan.display_image_key}`
    : null;

  useEffect(() => {
    if (plan && !canShowSatellite && showSatellite) setShowSatellite(false);
  }, [canShowSatellite, plan, showSatellite]);

  const loadData = useCallback(async () => {
    if (!currentHousehold) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [planResponse, objectsResponse] = await Promise.all([
        gardenPlansApi.get(currentHousehold.id, gardenPlanId),
        gardenPlansApi.listObjects(currentHousehold.id, gardenPlanId),
      ]);
      setPlan(planResponse.garden_plan);
      setObjects(objectsResponse.objects);
      setBaselineObjects(objectsResponse.objects);
    } catch (error) {
      console.error('Failed to load garden plan objects:', error);
      showToast('error', 'Failed to load garden objects');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [currentHousehold, gardenPlanId, navigation]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: { objects },
    baseline: { objects: baselineObjects },
    successMessage: 'Garden plan objects saved',
    errorMessage: 'Failed to save garden objects',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!currentHousehold) return false;
      await gardenPlansApi.replaceObjects(currentHousehold.id, gardenPlanId, objects);
      return;
    },
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.backgroundMain }]} testID="garden-plan-object-editor-screen">
      <ScreenHeader
        title={plan ? gardenPlanDisplayLabel(plan) : 'Edit objects'}
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightElement={
          <View style={styles.headerActions}>
            {canShowSatellite && (
              <HeaderActionButton
                iconOnly
                onPress={() => setShowSatellite((value) => !value)}
                accessibilityLabel={
                  showSatellite ? 'Hide satellite background' : 'Show satellite background'
                }
              >
                <Icon
                  name={showSatellite ? 'map' : 'globe-outline'}
                  size={Header.actionIconSize}
                  color={colors.primary}
                />
              </HeaderActionButton>
            )}
            <HeaderActionButton
              label={isSaving ? 'Saving...' : 'Save'}
              onPress={save}
              disabled={isSaving || loading || !isDirty}
              testID="garden-plan-object-editor-save"
            />
          </View>
        }
        showNotificationBell={false}
        showAvatar={false}
      />

      {loading || !plan ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <GardenPlanVectorEditor
          backgroundImageUrl={imageUrl}
          backgroundMode={showSatellite ? 'satellite' : 'plan'}
          boundaryGeoJson={plan.boundary_geojson ?? null}
          initialCamera={initialCamera}
          objects={objects}
          onChange={setObjects}
          showHeader={false}
          fullScreen
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Header.actionGap,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
