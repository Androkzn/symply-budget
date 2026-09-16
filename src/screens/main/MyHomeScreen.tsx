import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  floorPlansApi,
  type FloorPlanAnalysis,
  type FloorPlan,
  type FloorPlanMarker,
  type FloorPlanRegion,
  type BoundingBox,
} from '@api/floor-plans';
import type { TaskPrioritySeverity } from '@api/tasks';
import { isHouseBrand } from '@brand';
import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer, AdaptiveGrid } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useDeviceType } from '@hooks/useDeviceType';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { areaUnitFor, formatArea } from '@utils/areaUnits';
import { floorPlanDisplayLabel } from '@utils/floorPlanLabel';

type SeverityCounts = Record<TaskPrioritySeverity, number>;
const CARD_PREVIEW_WIDTH = 140;
const CARD_HEIGHT = 190;
const CARD_CROP_HEIGHT = 250;

type PlanPartCard = {
  id: string;
  floorPlanId: string;
  title: string;
  areaSqFt: number | null;
  spacesCount: number;
  boundingBox: BoundingBox | null;
  markers: FloorPlanMarker[];
  thumbnailKey: string | null;
  displayImageKey: string | null;
  /** Prefer region crop when available (per-region pipeline). */
  cropImageKey: string | null;
  spaces: string[];
  icon: string;
  type: 'floor' | 'detached';
  // Index of this zone within its source list in the analysis payload
  // (analysis.floors for 'floor', analysis.detached_areas for 'detached').
  // Null when the card represents the entire (unanalyzed) plan.
  sourceIndex: number | null;
};

const ZERO_COUNTS: SeverityCounts = {
  critical: 0,
  urgent: 0,
  high: 0,
  medium: 0,
  low: 0,
  nice_to_have: 0,
};

export function MyHomeScreen() {
  const colors = useAppColors();
  const { isTablet, isLandscape, columns } = useDeviceType();
  const { currentHousehold } = useHouseholdStore();
  const areaUnit = areaUnitFor(currentHousehold?.unit_system ?? 'imperial');
  const { upcomingTasks, maintenanceTasks } = useTaskStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [markersByPlan, setMarkersByPlan] = useState<Record<string, FloorPlanMarker[]>>({});
  const [regionsByPlan, setRegionsByPlan] = useState<Record<string, FloorPlanRegion[]>>({});

  const activeTasksById = useMemo(() => {
    const unique = [...(upcomingTasks ?? []), ...(maintenanceTasks ?? [])].reduce<
      Record<string, (typeof maintenanceTasks)[number]>
    >((acc, task) => {
      acc[task.id] = task;
      return acc;
    }, {});
    Object.keys(unique).forEach((taskId) => {
      const task = unique[taskId];
      const isInactive = !task.is_active;
      const isCompletedOneTime = task.frequency === 'one_time' && Boolean(task.last_completed_at);
      if (isInactive || isCompletedOneTime) {
        delete unique[taskId];
      }
    });
    return unique;
  }, [maintenanceTasks, upcomingTasks]);

  const partCards = useMemo<PlanPartCard[]>(() => {
    const cards: PlanPartCard[] = [];
    const findCropKey = (
      planId: string,
      kind: 'floor' | 'detached',
      name: string,
      sortOrder: number
    ): string | null => {
      const regions = regionsByPlan[planId] ?? [];
      const match =
        regions.find((r) => r.kind === kind && r.name === name) ||
        regions.find((r) => r.kind === kind && r.sort_order === sortOrder);
      return match?.crop_image_key ?? null;
    };

    floorPlans.forEach((plan) => {
      const markers = markersByPlan[plan.id] ?? [];
      const analysis = normalizeAnalysis(plan.ai_analysis_data);
      const floors = analysis?.floors ?? [];
      const detachedAreas = analysis?.detached_areas ?? [];
      if (!floors.length && !detachedAreas.length) {
        cards.push({
          id: `${plan.id}-all`,
          floorPlanId: plan.id,
          title: floorPlanDisplayLabel(plan),
          areaSqFt: plan.ai_total_area_sqft ?? null,
          spacesCount: 0,
          boundingBox: null,
          markers,
          thumbnailKey: plan.thumbnail_key,
          displayImageKey: plan.display_image_key,
          cropImageKey: null,
          spaces: [],
          icon: 'ground',
          type: 'floor',
          sourceIndex: null,
        });
        return;
      }
      const orderedFloors = floors
        .map((floor, sourceIndex) => ({ floor, sourceIndex }))
        .sort((a, b) => getFloorSortRank(a.floor.level) - getFloorSortRank(b.floor.level));
      orderedFloors.forEach(({ floor, sourceIndex }) => {
        const spaces = floor.spaces?.map((space) => space.name).filter(Boolean) ?? [];
        cards.push({
          id: `${plan.id}-floor-${sourceIndex}`,
          floorPlanId: plan.id,
          title: floor.name,
          areaSqFt: toSqFt(floor.area.value, floor.area.unit),
          spacesCount: floor.spaces.length,
          boundingBox: floor.bounding_box,
          markers: filterMarkersByBoundingBox(markers, floor.bounding_box),
          thumbnailKey: plan.thumbnail_key,
          displayImageKey: plan.display_image_key,
          cropImageKey: findCropKey(plan.id, 'floor', floor.name, sourceIndex),
          spaces,
          icon: getFloorIcon(floor.level),
          type: 'floor',
          sourceIndex,
        });
      });
      detachedAreas.forEach((area, index) => {
        const spaces = area.spaces?.map((space) => space.name).filter(Boolean) ?? [];
        cards.push({
          id: `${plan.id}-detached-${index}`,
          floorPlanId: plan.id,
          title: area.name,
          areaSqFt: toSqFt(area.area.value, area.area.unit),
          spacesCount: area.spaces.length,
          boundingBox: area.bounding_box,
          markers: filterMarkersByBoundingBox(markers, area.bounding_box),
          thumbnailKey: plan.thumbnail_key,
          displayImageKey: plan.display_image_key,
          cropImageKey: findCropKey(
            plan.id,
            'detached',
            area.name,
            floors.length + index
          ),
          spaces,
          icon: getDetachedIcon(),
          type: 'detached',
          sourceIndex: index,
        });
      });
    });
    return cards;
  }, [floorPlans, markersByPlan, regionsByPlan]);

  const countsByPart = useMemo(() => {
    const result: Record<string, SeverityCounts> = {};
    partCards.forEach((part) => {
      const counts: SeverityCounts = { ...ZERO_COUNTS };
      part.markers.forEach((marker) => {
        if (marker.linked_entity_type !== 'task') return;
        const task = activeTasksById[marker.linked_entity_id];
        if (!task) return;
        const severity = task.priority_severity ?? 'nice_to_have';
        counts[severity] += 1;
      });
      result[part.id] = counts;
    });
    return result;
  }, [activeTasksById, partCards]);
  const floorCardColumns = isTablet ? (isLandscape ? Math.min(columns, 3) : 2) : 1;

  const loadData = useCallback(
    async (refresh = false) => {
      if (!currentHousehold) return;
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const response = await floorPlansApi.list(currentHousehold.id);
        const nextFloorPlans = await Promise.all(
          response.floor_plans.map(async (plan) => {
            let nextPlan: FloorPlan = plan;
            try {
              const detail = await floorPlansApi.get(currentHousehold.id, plan.id);
              nextPlan = detail.floor_plan ?? plan;
            } catch {
              nextPlan = plan;
            }
            if (!nextPlan.ai_analysis_data) {
              try {
                const analysisResponse = await floorPlansApi.getAnalysis(currentHousehold.id, plan.id);
                if (analysisResponse.analysis) {
                  const totalSqFt = toSqFt(
                    analysisResponse.analysis.total_area.value,
                    analysisResponse.analysis.total_area.unit,
                  );
                  nextPlan = {
                    ...nextPlan,
                    ai_analysis_data: analysisResponse.analysis,
                    ai_analysis_status: analysisResponse.status,
                    ai_total_area_sqft: nextPlan.ai_total_area_sqft ?? totalSqFt,
                  };
                }
              } catch {
                // Ignore analysis fetch failures and keep the base floor plan payload.
              }
            }
            const normalized = normalizeAnalysis(nextPlan.ai_analysis_data);
            if (normalized) {
              nextPlan = {
                ...nextPlan,
                ai_analysis_data: normalized,
              };
            }
            return nextPlan;
          }),
        );
        setFloorPlans(nextFloorPlans);
        const markerResults = await Promise.all(
          nextFloorPlans.map((plan) =>
            floorPlansApi
              .listMarkers(currentHousehold.id, plan.id)
              .then((res) => ({ planId: plan.id, markers: res.markers }))
              .catch(() => ({ planId: plan.id, markers: [] as FloorPlanMarker[] })),
          ),
        );
        setMarkersByPlan(
          markerResults.reduce<Record<string, FloorPlanMarker[]>>((acc, item) => {
            acc[item.planId] = item.markers;
            return acc;
          }, {}),
        );

        const regionResults = await Promise.all(
          nextFloorPlans.map((plan) =>
            floorPlansApi
              .listRegions(currentHousehold.id, plan.id)
              .then((res) => ({ planId: plan.id, regions: res.regions }))
              .catch(() => ({ planId: plan.id, regions: [] as FloorPlanRegion[] })),
          ),
        );
        setRegionsByPlan(
          regionResults.reduce<Record<string, FloorPlanRegion[]>>((acc, item) => {
            acc[item.planId] = item.regions;
            return acc;
          }, {}),
        );
      } catch (error) {
        // `try/finally` with no `catch` meant every failure here escaped as an
        // unhandled rejection: `useFocusEffect` below calls `loadData` without
        // awaiting it, so nothing downstream could catch it either.
        //
        // The reliable trigger is cold start. `currentHousehold` rehydrates
        // from MMKV synchronously, so the `!currentHousehold` guard above
        // passes while `ensureHouseLocalSession()` is still in flight, and the
        // local floor-plans read throws `HouseLocalNotReadyError`. The guard
        // was checking that a household is selected, not that its ledger is
        // open. Leaving the existing state untouched is correct for both that
        // race (the next focus reloads once the session is up) and for an
        // ordinary read failure — better a stale list than an empty one.
        console.warn('[MyHome] loadData failed', error);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [currentHousehold],
  );

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData]),
  );

  const renderUrgencyLine = (partId: string) => {
    const counts = countsByPart[partId] ?? ZERO_COUNTS;
    const totalActive = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return (
      <View style={styles.urgencyWrap}>
        <View style={styles.activeTasksPill}>
          <Typography variant="caption1" weight="bold" color={colors.white} style={styles.urgencyTitle}>
            {totalActive} active
          </Typography>
        </View>
        <View style={styles.tasksPillsContainer}>
          <UrgencyBadge label="Critical" value={counts.critical} tone={colors.error} />
          <UrgencyBadge label="Urgent" value={counts.urgent} tone={colors.warning} />
          <UrgencyBadge label="High" value={counts.high} tone={colors.accent} />
        </View>
      </View>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="my-home-screen">
        <ScreenHeader
          title={currentHousehold?.name?.trim() || 'My Home'}
        />
        <AdaptiveContainer width="wide">
          <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => loadData(true)}
                tintColor={colors.primary}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {isHouseBrand() && (
              <Pressable
                style={[
                  styles.projectsEntry,
                  { backgroundColor: colors.card, borderColor: colors.borderColor },
                ]}
                /**
                 * `navigate`, not `push`. `/projects` became a bottom-tab route
                 * (`app/(tabs)/projects.tsx`); pushing a sibling tab from inside
                 * another tab stacks a second copy instead of switching to it,
                 * and the app ends up on an arbitrary tab. `/neighbours` below
                 * is still a standalone route, so `push` stays correct there.
                 */
                onPress={() => router.navigate('/projects')}
                testID="my-home-home-projects"
              >
                <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                  Projects
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  Plan renovations, materials, and budgets
                </Typography>
              </Pressable>
            )}
            {isHouseBrand() && (
              <Pressable
                style={[
                  styles.projectsEntry,
                  { backgroundColor: colors.card, borderColor: colors.borderColor },
                ]}
                onPress={() => router.push('/neighbours')}
                testID="my-home-neighbours"
              >
                <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                  Neighbours
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  Map the homes around you and who to call
                </Typography>
              </Pressable>
            )}
            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : partCards.length === 0 ? (
              <View style={styles.empty}>
                <Typography variant="title2" weight="semibold" color={colors.textPrimary}>
                  No floor plans yet
                </Typography>
                <Typography variant="body" color={colors.textSecondary} style={styles.emptySubtext}>
                  Add floor plans from More{'>'} Floor Plans.
                </Typography>
              </View>
            ) : (
              <AdaptiveGrid
                gap={isTablet ? 18 : 14}
                columns={floorCardColumns}
                minItemWidth={320}
                style={styles.cardGrid}
              >
                {partCards.map((part) => {
                const spacesPreview = part.spaces.slice(0, 3).join(', ');
                const hasMoreSpaces = part.spaces.length > 3;
                return (
                  <View key={part.id} style={styles.cardWrap}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.floorCardRow,
                        { shadowColor: colors.black },
                        pressed && styles.floorCardRowPressed,
                      ]}
                      onPress={() => {
                        const params: Record<string, string> = {
                          screen: 'FloorPlanViewer',
                          floorPlanId: part.floorPlanId,
                          // Per-tap nonce so SettingsNavigator's deep-link
                          // dedupe cache doesn't swallow repeated taps on the
                          // same card (or on a card with the same zone keys).
                          navNonce: `${Date.now()}`,
                        };
                        if (part.sourceIndex != null) {
                          params.initialZoneType = part.type;
                          params.initialZoneIndex = String(part.sourceIndex);
                        } else {
                          params.initialZoneType = 'full';
                        }
                        router.push({
                          pathname: '/settings',
                          params,
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${part.title}`}
                    >
                      {part.cropImageKey ? (
                        <Image
                          source={{ uri: `${ENV.API_BASE_URL}/files/${part.cropImageKey}` }}
                          style={styles.floorCardPreviewFallback}
                          resizeMode="cover"
                        />
                      ) : part.displayImageKey && part.boundingBox ? (
                        <View
                          style={[
                            styles.floorCardPreview,
                            { backgroundColor: colors.backgroundSecondary },
                          ]}
                        >
                          <Image
                            source={{ uri: `${ENV.API_BASE_URL}/files/${part.displayImageKey}` }}
                            style={[
                              styles.floorCardPreviewImage,
                              {
                                width:
                                  CARD_PREVIEW_WIDTH /
                                  Math.max(part.boundingBox.x2 - part.boundingBox.x1, 0.001),
                                height:
                                  CARD_CROP_HEIGHT /
                                  Math.max(part.boundingBox.y2 - part.boundingBox.y1, 0.001),
                                left:
                                  (-CARD_PREVIEW_WIDTH * part.boundingBox.x1) /
                                  Math.max(part.boundingBox.x2 - part.boundingBox.x1, 0.001),
                                top:
                                  (-CARD_CROP_HEIGHT * part.boundingBox.y1) /
                                  Math.max(part.boundingBox.y2 - part.boundingBox.y1, 0.001),
                              },
                            ]}
                            resizeMode="cover"
                          />
                        </View>
                      ) : part.thumbnailKey ? (
                        <Image
                          source={{ uri: `${ENV.API_BASE_URL}/files/${part.thumbnailKey}` }}
                          style={styles.floorCardPreviewFallback}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          style={[
                            styles.floorCardPreviewFallback,
                            styles.thumbnailFallback,
                            { backgroundColor: colors.backgroundSecondary },
                          ]}
                        >
                          <Icon name="grid-outline" size={28} color={colors.textSecondary} />
                        </View>
                      )}

                      <LinearGradient
                        colors={getFloorGradient(part.icon, part.type)}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.floorCardGradient}
                      >
                        <View style={styles.floorCardContent}>
                          <Typography
                            variant="labelRegular"
                            weight="bold"
                            color={colors.white}
                            style={styles.floorCardName}
                          >
                            {part.title}
                          </Typography>
                          <View style={styles.floorCardStats}>
                            {!!part.areaSqFt && (
                              <Typography
                                variant="caption"
                                weight="semibold"
                                style={styles.floorCardStatValue}
                              >
                                {formatArea(part.areaSqFt, areaUnit)}
                              </Typography>
                            )}
                            {!!part.areaSqFt && part.spacesCount > 0 && (
                              <Typography variant="caption1" style={styles.floorCardStatLabel}>
                                {' '}•{' '}
                              </Typography>
                            )}
                            {part.spacesCount > 0 && (
                              <Typography
                                variant="caption"
                                weight="semibold"
                                style={styles.floorCardStatValue}
                              >
                                {part.spacesCount} {part.spacesCount === 1 ? 'space' : 'spaces'}
                              </Typography>
                            )}
                          </View>
                          {spacesPreview ? (
                            <Typography variant="caption1" style={styles.floorCardSpacesList} numberOfLines={1}>
                              {spacesPreview}
                              {hasMoreSpaces ? ` +${part.spaces.length - 3} more` : ''}
                            </Typography>
                          ) : null}
                          {renderUrgencyLine(part.id)}
                        </View>
                        <Icon
                          name="chevron-forward"
                          size={30}
                          color={colors.white}
                          style={styles.floorCardArrow}
                        />
                      </LinearGradient>
                    </Pressable>
                  </View>
                );
                })}
              </AdaptiveGrid>
            )}
            <ScreenScrollEnd testID={screenScrollEndTestId('my-home-screen')} />
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

function UrgencyBadge({ label, value, tone }: { label: string; value: number; tone: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.badgeWrap}>
      <View style={styles.badge}>
        <View style={[styles.badgeDot, { backgroundColor: tone }]} />
        <Typography variant="caption2" weight="semibold" color={colors.white} style={styles.badgeLabel}>
          {label}
        </Typography>
      </View>
      <Typography variant="caption2" weight="bold" color={colors.white} style={styles.badgeValue}>
        {value}
      </Typography>
    </View>
  );
}

function toSqFt(value: number | null, unit: 'sq_ft' | 'sq_m' | null): number | null {
  if (value == null) return null;
  if (unit === 'sq_m') return Math.round(value * 10.7639);
  return Math.round(value);
}

function filterMarkersByBoundingBox(markers: FloorPlanMarker[], box: BoundingBox | null) {
  if (!box) return markers;
  return markers.filter((marker) => {
    const x = marker.x_percent / 100;
    const y = marker.y_percent / 100;
    return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
  });
}

function normalizeAnalysis(value: unknown): FloorPlanAnalysis | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as FloorPlanAnalysis;
    } catch {
      return null;
    }
  }
  return value as FloorPlanAnalysis;
}

// Semantic level key used only to pick a card gradient (see getFloorGradient).
// Not rendered — the card shows a floor-plan thumbnail, not this key.
type FloorLevelKey = 'below' | 'ground' | 'upper' | 'high';

function getFloorIcon(level: number): FloorLevelKey {
  if (level < 0) return 'below';
  if (level === 0 || level === 1) return 'ground';
  if (level === 2) return 'upper';
  return 'high';
}

function getDetachedIcon(): FloorLevelKey {
  // Detached structures all share the detached gradient (keyed by `type` in
  // getFloorGradient), so the level key is irrelevant for them.
  return 'ground';
}

function getFloorGradient(icon: string, type?: 'floor' | 'detached'): [string, string] {
  if (type === 'detached') return ['rgba(249, 168, 37, 0.78)', 'rgba(234, 88, 12, 0.9)'];
  if (icon === 'below') return ['rgba(168, 85, 247, 0.78)', 'rgba(126, 34, 206, 0.9)'];
  if (icon === 'ground') return ['rgba(96, 165, 250, 0.78)', 'rgba(37, 99, 235, 0.9)'];
  if (icon === 'upper') return ['rgba(52, 211, 153, 0.78)', 'rgba(5, 150, 105, 0.9)'];
  return ['rgba(148, 163, 184, 0.78)', 'rgba(71, 85, 105, 0.9)'];
}

function getFloorSortRank(level: number): number {
  if (level < 0) return 100 + Math.abs(level);
  return level;
}

const styles = StyleSheet.create({
  projectsEntry: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: 4,
  },
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: 14,
  },
  loading: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  emptySubtext: {
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  cardGrid: {
    marginHorizontal: -9,
  },
  cardWrap: {
    width: '100%',
  },
  floorCardRow: {
    flexDirection: 'row',
    width: '100%',
    height: CARD_HEIGHT,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  floorCardRowPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  floorCardPreview: {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_HEIGHT,
    overflow: 'hidden',
  },
  floorCardPreviewImage: {
    position: 'absolute',
  },
  floorCardPreviewFallback: {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_HEIGHT,
  },
  thumbnailFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  floorCardGradient: {
    flex: 1,
    justifyContent: 'center',
    paddingLeft: 14,
    paddingRight: 52,
    paddingVertical: 12,
  },
  floorCardContent: {
    flex: 1,
    gap: 2,
  },
  floorCardName: {
    lineHeight: 18,
  },
  floorCardStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  floorCardStatValue: {
    color: 'rgba(255,255,255,0.96)',
    lineHeight: 16,
  },
  floorCardStatLabel: {
    color: 'rgba(255,255,255,0.96)',
  },
  floorCardSpacesList: {
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 14,
    marginTop: 0,
  },
  floorCardArrow: {
    position: 'absolute',
    right: 14,
    top: CARD_HEIGHT / 2 - 16,
    opacity: 0.95,
  },
  urgencyWrap: {
    marginTop: 6,
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.26)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  activeTasksPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: CornerRadius.full,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  urgencyTitle: {
    lineHeight: 12,
  },
  tasksPillsContainer: {
    flexDirection: 'column',
    gap: 5,
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.30)',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: CornerRadius.full,
  },
  badgeLabel: {
    lineHeight: 12,
  },
  badgeValue: {
    marginLeft: 4,
    lineHeight: 12,
  },
});
