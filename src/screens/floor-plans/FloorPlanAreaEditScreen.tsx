import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, KeyboardAvoidingView, LayoutChangeEvent, Platform, Pressable, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  floorPlansApi,
  type BoundingBox,
  type FloorPlan,
  type FloorPlanAnalysis,
  type UpdateAnalysisAreaInput,
} from '@api/floor-plans';
import { AppBackground, ScreenHeader } from '@components/common';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { ENV } from '@config/env';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { FloorPlansSharedStack } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors, scaledFont } from '@theme';

type Nav = NativeStackNavigationProp<FloorPlansSharedStack, 'FloorPlanAreaEdit'>;
type RouteProps = RouteProp<FloorPlansSharedStack, 'FloorPlanAreaEdit'>;

const HANDLE_SIZE = 28;
const MIN_BOX_FRACTION = 0.05;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function fallbackBoundingBox(): BoundingBox {
  return { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 };
}

export function FloorPlanAreaEditScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const { updateFloorPlan: updateStoreFloorPlan } = useFloorPlanStore();

  const { floorPlanId, areaKind, areaIndex } = route.params;
  const isAddMode = areaKind === undefined || areaIndex === undefined;

  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [analysis, setAnalysis] = useState<FloorPlanAnalysis | null>(null);
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Bounding box stored in normalized 0-1 coordinates. The shared values mirror
  // the same data so gestures can update the rectangle on the UI thread.
  const [bbox, setBbox] = useState<BoundingBox>(fallbackBoundingBox());
  // Last-saved snapshot the form diffs against. Captured after load so both the
  // name and the (normalized) bounding box count toward "dirty"; editing the
  // name or moving/resizing the rectangle makes Save available.
  const [baselineName, setBaselineName] = useState('');
  const [baselineBbox, setBaselineBbox] = useState<BoundingBox>(fallbackBoundingBox());
  const x1 = useSharedValue(0.25);
  const y1 = useSharedValue(0.25);
  const x2 = useSharedValue(0.75);
  const y2 = useSharedValue(0.75);

  const setBboxFromShared = useCallback((nx1: number, ny1: number, nx2: number, ny2: number) => {
    setBbox({ x1: nx1, y1: ny1, x2: nx2, y2: ny2 });
  }, []);

  const initBoundingBox = useCallback((next: BoundingBox): BoundingBox => {
    const safe: BoundingBox = {
      x1: clamp01(Math.min(next.x1, next.x2)),
      y1: clamp01(Math.min(next.y1, next.y2)),
      x2: clamp01(Math.max(next.x1, next.x2)),
      y2: clamp01(Math.max(next.y1, next.y2)),
    };
    if (safe.x2 - safe.x1 < MIN_BOX_FRACTION) {
      const center = (safe.x1 + safe.x2) / 2;
      safe.x1 = clamp01(center - MIN_BOX_FRACTION / 2);
      safe.x2 = clamp01(center + MIN_BOX_FRACTION / 2);
    }
    if (safe.y2 - safe.y1 < MIN_BOX_FRACTION) {
      const center = (safe.y1 + safe.y2) / 2;
      safe.y1 = clamp01(center - MIN_BOX_FRACTION / 2);
      safe.y2 = clamp01(center + MIN_BOX_FRACTION / 2);
    }
    x1.value = safe.x1;
    y1.value = safe.y1;
    x2.value = safe.x2;
    y2.value = safe.y2;
    setBbox(safe);
    return safe;
  }, [x1, x2, y1, y2]);

  const load = useCallback(async () => {
    if (!currentHousehold) return;
    try {
      setIsLoading(true);
      const fpResponse = await floorPlansApi.get(currentHousehold.id, floorPlanId);
      setFloorPlan(fpResponse.floor_plan);

      if (fpResponse.floor_plan.display_image_key) {
        setImageUrl(`${ENV.API_BASE_URL}/files/${fpResponse.floor_plan.display_image_key}`);
      }

      const rawAnalysis = fpResponse.floor_plan.ai_analysis_data;
      const parsedAnalysis = typeof rawAnalysis === 'string'
        ? (JSON.parse(rawAnalysis) as FloorPlanAnalysis)
        : rawAnalysis ?? null;
      setAnalysis(parsedAnalysis);

      if (!isAddMode && parsedAnalysis) {
        const list = areaKind === 'detached' ? parsedAnalysis.detached_areas : parsedAnalysis.floors;
        const target = list?.[areaIndex!];
        if (target) {
          const loadedName = target.name ?? '';
          const loadedBox = initBoundingBox(target.bounding_box ?? fallbackBoundingBox());
          setName(loadedName);
          // Edit baseline: the loaded area, so only real edits enable Save.
          setBaselineName(loadedName);
          setBaselineBbox(loadedBox);
        } else {
          const loadedBox = initBoundingBox(fallbackBoundingBox());
          setBaselineName('');
          setBaselineBbox(loadedBox);
        }
      } else {
        // Add mode: default name + centered rectangle. Baseline mirrors these
        // initial values, so typing a name or moving the box makes it dirty.
        setName('');
        const loadedBox = initBoundingBox(fallbackBoundingBox());
        setBaselineName('');
        setBaselineBbox(loadedBox);
      }
    } catch (error) {
      console.error('Failed to load floor plan for editing:', error);
      showToast('error', 'Could not load floor plan');
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  }, [areaIndex, areaKind, currentHousehold, floorPlanId, initBoundingBox, isAddMode, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  // Compute the rendered image rect within the container while preserving aspect ratio.
  const imageRect = useMemo(() => {
    if (!imageNaturalSize || containerSize.width === 0 || containerSize.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const aspect = imageNaturalSize.width / imageNaturalSize.height;
    const containerAspect = containerSize.width / containerSize.height;
    let width: number;
    let height: number;
    if (aspect > containerAspect) {
      width = containerSize.width;
      height = width / aspect;
    } else {
      height = containerSize.height;
      width = height * aspect;
    }
    return {
      x: (containerSize.width - width) / 2,
      y: (containerSize.height - height) / 2,
      width,
      height,
    };
  }, [containerSize, imageNaturalSize]);

  // Shared values for gesture start positions — created once at the top level.
  const startCornerX = useSharedValue(0);
  const startCornerY = useSharedValue(0);

  // Pixel-space bounding box used for rendering / hit-testing.
  const animatedBoxStyle = useAnimatedStyle(() => {
    return {
      left: imageRect.x + x1.value * imageRect.width,
      top: imageRect.y + y1.value * imageRect.height,
      width: (x2.value - x1.value) * imageRect.width,
      height: (y2.value - y1.value) * imageRect.height,
    };
  });

  const cornerStyleTL = useAnimatedStyle(() => ({
    left: imageRect.x + x1.value * imageRect.width - HANDLE_SIZE / 2,
    top: imageRect.y + y1.value * imageRect.height - HANDLE_SIZE / 2,
  }));
  const cornerStyleTR = useAnimatedStyle(() => ({
    left: imageRect.x + x2.value * imageRect.width - HANDLE_SIZE / 2,
    top: imageRect.y + y1.value * imageRect.height - HANDLE_SIZE / 2,
  }));
  const cornerStyleBL = useAnimatedStyle(() => ({
    left: imageRect.x + x1.value * imageRect.width - HANDLE_SIZE / 2,
    top: imageRect.y + y2.value * imageRect.height - HANDLE_SIZE / 2,
  }));
  const cornerStyleBR = useAnimatedStyle(() => ({
    left: imageRect.x + x2.value * imageRect.width - HANDLE_SIZE / 2,
    top: imageRect.y + y2.value * imageRect.height - HANDLE_SIZE / 2,
  }));

  // Gestures are recomputed each render to capture the latest imageRect, but
  // the underlying shared values are stable so they don't allocate state.
  const moveGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          'worklet';
          if (imageRect.width === 0 || imageRect.height === 0) return;
          const dx = event.translationX / imageRect.width;
          const dy = event.translationY / imageRect.height;
          const w = x2.value - x1.value;
          const h = y2.value - y1.value;
          let nx1 = x1.value + dx;
          let ny1 = y1.value + dy;
          nx1 = Math.max(0, Math.min(1 - w, nx1));
          ny1 = Math.max(0, Math.min(1 - h, ny1));
          x1.value = nx1;
          y1.value = ny1;
          x2.value = nx1 + w;
          y2.value = ny1 + h;
        })
        .onEnd(() => {
          'worklet';
          runOnJS(setBboxFromShared)(x1.value, y1.value, x2.value, y2.value);
        }),
    [imageRect.width, imageRect.height, setBboxFromShared, x1, x2, y1, y2],
  );

  const buildCornerGesture = useCallback(
    (cornerX: 'x1' | 'x2', cornerY: 'y1' | 'y2') =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          startCornerX.value = cornerX === 'x1' ? x1.value : x2.value;
          startCornerY.value = cornerY === 'y1' ? y1.value : y2.value;
        })
        .onUpdate((event) => {
          'worklet';
          if (imageRect.width === 0 || imageRect.height === 0) return;
          const dx = event.translationX / imageRect.width;
          const dy = event.translationY / imageRect.height;
          const candidateX = Math.max(0, Math.min(1, startCornerX.value + dx));
          const candidateY = Math.max(0, Math.min(1, startCornerY.value + dy));

          if (cornerX === 'x1') {
            x1.value = Math.min(candidateX, x2.value - MIN_BOX_FRACTION);
          } else {
            x2.value = Math.max(candidateX, x1.value + MIN_BOX_FRACTION);
          }
          if (cornerY === 'y1') {
            y1.value = Math.min(candidateY, y2.value - MIN_BOX_FRACTION);
          } else {
            y2.value = Math.max(candidateY, y1.value + MIN_BOX_FRACTION);
          }
        })
        .onEnd(() => {
          'worklet';
          runOnJS(setBboxFromShared)(x1.value, y1.value, x2.value, y2.value);
        }),
    [imageRect.width, imageRect.height, setBboxFromShared, startCornerX, startCornerY, x1, x2, y1, y2],
  );

  const cornerTL = useMemo(() => buildCornerGesture('x1', 'y1'), [buildCornerGesture]);
  const cornerTR = useMemo(() => buildCornerGesture('x2', 'y1'), [buildCornerGesture]);
  const cornerBL = useMemo(() => buildCornerGesture('x1', 'y2'), [buildCornerGesture]);
  const cornerBR = useMemo(() => buildCornerGesture('x2', 'y2'), [buildCornerGesture]);

  const onContainerLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize({ width, height });
  };

  const handleImageLoad = (event: any) => {
    const { width, height } = event.nativeEvent.source;
    setImageNaturalSize({ width, height });
  };

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: { name, bbox },
    baseline: { name: baselineName, bbox: baselineBbox },
    successMessage: isAddMode ? 'Area added' : 'Area updated',
    errorMessage: 'Could not save area',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!currentHousehold || !floorPlan) return false;
      const trimmed = name.trim();
      if (!trimmed) {
        showToast('error', 'Please enter a name');
        return false;
      }

      const currentFloors = analysis?.floors ?? [];
      const currentDetached = analysis?.detached_areas ?? [];

      const targetKind: 'floor' | 'detached' = areaKind ?? 'floor';
      const next: { floors: UpdateAnalysisAreaInput[]; detached_areas: UpdateAnalysisAreaInput[] } = {
        floors: currentFloors.map(f => ({
          name: f.name,
          bounding_box: f.bounding_box ?? fallbackBoundingBox(),
        })),
        detached_areas: currentDetached.map(a => ({
          name: a.name,
          bounding_box: a.bounding_box ?? fallbackBoundingBox(),
        })),
      };

      const entry: UpdateAnalysisAreaInput = { name: trimmed, bounding_box: bbox };
      if (isAddMode) {
        if (targetKind === 'detached') {
          next.detached_areas.push(entry);
        } else {
          next.floors.push(entry);
        }
      } else {
        const list = targetKind === 'detached' ? next.detached_areas : next.floors;
        if (areaIndex! < list.length) {
          list[areaIndex!] = entry;
        } else {
          list.push(entry);
        }
      }

      const response = await floorPlansApi.updateAnalysis(
        currentHousehold.id,
        floorPlanId,
        {
          floors: next.floors,
          detached_areas: next.detached_areas,
        },
      );

      // Sync the store so the viewer reflects the new analysis without a full reload.
      if (response.analysis) {
        updateStoreFloorPlan(floorPlanId, {
          ai_analysis_data: response.analysis as unknown as FloorPlanAnalysis,
          ai_floor_count: response.analysis.metadata?.floor_count ?? floorPlan.ai_floor_count,
        });
      }
      return;
    },
  });

  const handleDelete = useCallback(async () => {
    if (!currentHousehold || !floorPlan || isAddMode) return;
    try {
      setIsDeleting(true);
      const targetKind: 'floor' | 'detached' = areaKind ?? 'floor';
      const next: { floors: UpdateAnalysisAreaInput[]; detached_areas: UpdateAnalysisAreaInput[] } = {
        floors: (analysis?.floors ?? []).map(f => ({
          name: f.name,
          bounding_box: f.bounding_box ?? fallbackBoundingBox(),
        })),
        detached_areas: (analysis?.detached_areas ?? []).map(a => ({
          name: a.name,
          bounding_box: a.bounding_box ?? fallbackBoundingBox(),
        })),
      };

      const list = targetKind === 'detached' ? next.detached_areas : next.floors;
      if (areaIndex! < list.length) {
        list.splice(areaIndex!, 1);
      }

      const response = await floorPlansApi.updateAnalysis(
        currentHousehold.id,
        floorPlanId,
        {
          floors: next.floors,
          detached_areas: next.detached_areas,
        },
      );

      if (response.analysis) {
        updateStoreFloorPlan(floorPlanId, {
          ai_analysis_data: response.analysis as unknown as FloorPlanAnalysis,
          ai_floor_count: response.analysis.metadata?.floor_count ?? floorPlan.ai_floor_count,
        });
      }

      showToast('success', 'Area removed');
      navigation.goBack();
    } catch (error) {
      console.error('Failed to delete area:', error);
      showToast('error', 'Could not remove area');
    } finally {
      setIsDeleting(false);
    }
  }, [
    analysis,
    areaIndex,
    areaKind,
    currentHousehold,
    floorPlan,
    floorPlanId,
    isAddMode,
    navigation,
    updateStoreFloorPlan,
  ]);

  const widthPct = Math.round((bbox.x2 - bbox.x1) * 100);
  const heightPct = Math.round((bbox.y2 - bbox.y1) * 100);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="floor-plan-area-edit-screen">
        <ScreenHeader
          title={isAddMode ? 'New Area' : 'Edit Area'}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 64}
        >
          {/* Name input */}
          <View style={[styles.nameRow, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}>
            <Icon name="text" size={18} color={colors.textSecondary} />
            <TextInput
              style={[styles.nameInput, { color: colors.textPrimary }]}
              placeholder="Area name (e.g. Main Floor)"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={120}
              autoCorrect={false}
              testID="floor-plan-area-name-input"
            />
          </View>

          {/* Floor plan + draggable rectangle */}
          <View style={[styles.canvasWrap, { backgroundColor: colors.card }]} onLayout={onContainerLayout}>
            {isLoading || !imageUrl ? (
              <View style={styles.loadingFill}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <>
                <Image
                  source={{ uri: imageUrl }}
                  style={[
                    styles.image,
                    {
                      left: imageRect.x,
                      top: imageRect.y,
                      width: imageRect.width,
                      height: imageRect.height,
                    },
                  ]}
                  resizeMode="contain"
                  onLoad={handleImageLoad}
                />

                {imageRect.width > 0 && (
                  <>
                    <GestureDetector gesture={moveGesture}>
                      <Animated.View
                        style={[styles.bbox, { borderColor: colors.primary }, animatedBoxStyle]}
                      >
                        <View style={[styles.bboxFill, { backgroundColor: colors.primary }]} />
                      </Animated.View>
                    </GestureDetector>

                    <CornerHandle gesture={cornerTL} style={cornerStyleTL} color={colors.primary} />
                    <CornerHandle gesture={cornerTR} style={cornerStyleTR} color={colors.primary} />
                    <CornerHandle gesture={cornerBL} style={cornerStyleBL} color={colors.primary} />
                    <CornerHandle gesture={cornerBR} style={cornerStyleBR} color={colors.primary} />
                  </>
                )}
              </>
            )}
          </View>

          {/* Read-out + actions */}
          <View
            style={[
              styles.footer,
              {
                paddingBottom: insets.bottom + 16,
                backgroundColor: colors.backgroundMain,
                borderTopColor: colors.borderColor,
              },
            ]}
          >
            <View style={styles.metaRow}>
              <Typography variant="caption1" color="textSecondary">
                Drag the rectangle to move it. Drag the corners to resize.
              </Typography>
              <Typography variant="caption1" color="textSecondary">
                {widthPct}% x {heightPct}% of plan
              </Typography>
            </View>

            <View style={styles.actionsRow}>
              {!isAddMode && (
                <TouchableOpacity
                  style={[styles.deleteButton, { borderColor: colors.error }]}
                  onPress={handleDelete}
                  disabled={isSaving || isDeleting}
                  activeOpacity={0.8}
                  testID="floor-plan-area-delete"
                >
                  <Icon name="trash-outline" size={18} color={colors.error} />
                  <Typography variant="body" weight="semibold" color={colors.error}>
                    Delete
                  </Typography>
                </TouchableOpacity>
              )}

              <Pressable
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: isSaving || isDeleting || !isDirty || !name.trim() ? 0.6 : 1,
                  },
                ]}
                onPress={save}
                disabled={isSaving || isDeleting || !isDirty || !name.trim()}
                testID="floor-plan-area-save"
              >
                {isSaving ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <>
                    <Icon name="checkmark" size={18} color={colors.white} />
                    <Typography variant="body" weight="semibold" color={colors.white}>
                      {isAddMode ? 'Add area' : 'Save'}
                    </Typography>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </AppBackground>
  );
}

function CornerHandle({
  gesture,
  style,
  color,
}: {
  gesture: ReturnType<typeof Gesture.Pan>;
  style: ReturnType<typeof useAnimatedStyle>;
  color: string;
}) {
  const colors = useAppColors();
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.handle, { borderColor: color, backgroundColor: colors.white }, style]}>
        <View style={[styles.handleInner, { backgroundColor: color }]} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nameInput: {
    flex: 1,
    ...scaledFont('body'),
    paddingVertical: 4,
  },
  canvasWrap: {
    flex: 1,
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  loadingFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    position: 'absolute',
  },
  bbox: {
    position: 'absolute',
    borderWidth: 2,
  },
  bboxFill: {
    ...StyleSheet.absoluteFill,
    opacity: 0.18,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
});
