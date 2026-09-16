import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import type { RouteProp } from 'expo-router/react-navigation';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, LayoutChangeEvent, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import MapView, {
  Marker as MapMarker,
  Polygon as MapPolygon,
  type LatLng,
  type MapPressEvent,
  type PolygonPressEvent,
  type Region,
} from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  gardenPlansApi,
  type GardenPlanBoundaryDraft,
  type GardenPlanBoundaryMeasurements,
  type GardenPlanBoundarySource,
  type GardenPlanMeasurementUnit,
  type GardenPlanType,
  type GeoJsonPolygonGeometry,
} from '@api/garden-plans';
import { AppBackground, HeaderActionButton, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { MapCompassControl } from '@components/common/house';
import { AdaptiveContainer } from '@components/layout';
import { Typography, GradientButton, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { GardeningStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import {
  ButtonMetrics,
  CornerRadius,
  Header,
  Spacing,
  Layout,
  scaledFont,
  useAppColors,
} from '@theme';
import { palette } from '@theme/colors';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type Route = RouteProp<GardeningStackParamList, 'GardenPlanBoundaryConfirm'>;
type Nav = NativeStackNavigationProp<
  GardeningStackParamList,
  'GardenPlanBoundaryConfirm'
>;

type Point = { x: number; y: number };
type MapSize = { width: number; height: number };
type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };
type BoundaryPointInsertResult = { points: Point[]; insertedIndex: number | null };
type BoundaryPointHistoryEntry = { index: number; point: Point };
type EditorSnapshot = {
  points: Point[];
  baseBBox: BBox | null;
  source: GardenPlanBoundarySource;
};
type PendingRegionRestore = {
  region: Region;
  until: number;
};
type PendingZoomLock = {
  latitudeDelta: number;
  longitudeDelta: number;
  until: number;
  trigger: string;
};
type BoundaryPointSource = 'map_press' | 'polygon_press';
type LastBoundaryPress = {
  coordinate: LatLng;
  sourceType: BoundaryPointSource;
  timestamp: number;
};
type PlanTypePreset = {
  label: string;
  areaLabel: string;
  vibe: string;
  mustHaves: string[];
};
type BoundaryMeasurementSummary = GardenPlanBoundaryMeasurements & {
  displayDimensions: string;
  displayArea: string;
};

const PLAN_TYPE_PRESETS: Record<GardenPlanType, PlanTypePreset> = {
  front_yard: {
    label: 'Front',
    areaLabel: 'Front yard',
    vibe: 'welcoming curb appeal',
    mustHaves: ['path', 'foundation planting', 'seasonal color'],
  },
  back_yard: {
    label: 'Back',
    areaLabel: 'Back yard',
    vibe: 'low-maintenance native',
    mustHaves: ['patio', 'planting beds', 'paths'],
  },
  garden: {
    label: 'Garden',
    areaLabel: 'Garden',
    vibe: 'productive pollinator garden',
    mustHaves: ['raised beds', 'pollinator plants', 'irrigation'],
  },
  bed: {
    label: 'Bed',
    areaLabel: 'Garden bed',
    vibe: 'layered low-maintenance planting',
    mustHaves: ['native perennials', 'mulch', 'edging'],
  },
  other_outdoor: {
    label: 'Custom',
    areaLabel: '',
    vibe: 'functional outdoor living',
    mustHaves: ['privacy', 'paths', 'lighting'],
  },
};
const PLAN_TYPES: Array<{ value: GardenPlanType; label: string }> = [
  { value: 'front_yard', label: PLAN_TYPE_PRESETS.front_yard.label },
  { value: 'back_yard', label: PLAN_TYPE_PRESETS.back_yard.label },
  { value: 'other_outdoor', label: PLAN_TYPE_PRESETS.other_outdoor.label },
];
const DEFAULT_PLAN_TYPE: GardenPlanType = 'back_yard';
const DEFAULT_PLAN_DETAILS = PLAN_TYPE_PRESETS[DEFAULT_PLAN_TYPE];
const MAP_MIN_DELTA = 0.000001;
const MAP_MAX_DELTA = 0.02;
const MAP_INITIAL_PADDING = 1.05;
const MAP_MAX_ZOOM_LEVEL = 22;
const MAP_MIN_CAMERA_ALTITUDE = Platform.OS === 'ios' ? 60 : 25;
const MAP_MAX_CAMERA_ALTITUDE = 8000;
// MKMapView snaps back toward its legacy zoom clamp on every region change
// when `cameraZoomRange` is unset. Providing one lets us zoom to
// `minCenterCoordinateDistance` without the camera bouncing out mid-gesture.
const IOS_SATELLITE_CAMERA_ZOOM_RANGE = Platform.OS === 'ios'
  ? {
      minCenterCoordinateDistance: MAP_MIN_CAMERA_ALTITUDE,
      maxCenterCoordinateDistance: MAP_MAX_CAMERA_ALTITUDE,
      animated: false,
    }
  : undefined;
const MAX_BOUNDARY_POINTS = 12;
const BOUNDARY_COLOR = palette.semantic.warning;
const BOUNDARY_FILL_COLOR = 'rgba(255,149,0,0.18)';
const CTA_TEAL = palette.button.teal;
const SQ_METERS_TO_SQ_FEET = 10.7639104167;
const METERS_TO_FEET = 3.280839895;
const MAP_ROTATION_STEP = 15;

export function GardenPlanBoundaryConfirmScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { content: containerPadding } = useLayoutPadding();
  const { width: editorSlideWidth } = useWindowDimensions();
  const { currentHousehold } = useHouseholdStore();
  const [draft, setDraft] = useState<GardenPlanBoundaryDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingBoundary, setIsSavingBoundary] = useState(false);
  const [previewMapSize, setPreviewMapSize] = useState<MapSize>({
    width: 1,
    height: 1,
  });
  const [points, setPoints] = useState<Point[]>([]);
  const [baseBBox, setBaseBBox] = useState<BBox | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [initialMapRegionForView, setInitialMapRegionForView] = useState<Region | null>(null);
  const [mapHeading, setMapHeading] = useState(0);
  const [source, setSource] = useState<GardenPlanBoundarySource>('user_drawn');
  const [boundaryUndoHistory, setBoundaryUndoHistory] = useState<BoundaryPointHistoryEntry[]>([]);
  const [boundaryRedoHistory, setBoundaryRedoHistory] = useState<BoundaryPointHistoryEntry[]>([]);
  const [draggingBoundaryPointIndex, setDraggingBoundaryPointIndex] = useState<number | null>(null);
  const [boundaryDragPreview, setBoundaryDragPreview] = useState<{
    index: number;
    coordinate: LatLng;
  } | null>(null);
  const [editorMapType, setEditorMapType] = useState<'satellite' | 'standard'>(
    'satellite',
  );
  const [mapCameraAltitude, setMapCameraAltitude] = useState<number | null>(null);
  const [minDiscoveredAltitude, setMinDiscoveredAltitude] = useState<number | null>(null);
  const [maxDiscoveredAltitude, setMaxDiscoveredAltitude] = useState<number | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const editorSlideX = useRef(new Animated.Value(0)).current;
  const mapRegionRef = useRef<Region | null>(null);
  const pendingRegionRestore = useRef<PendingRegionRestore | null>(null);
  const pendingZoomLock = useRef<PendingZoomLock | null>(null);
  const regionBeforeBoundaryDrag = useRef<Region | null>(null);
  const isMapPanGesture = useRef(false);
  const panStartCameraAltitude = useRef<number | null>(null);
  const panStartRegion = useRef<Region | null>(null);
  const lastRegionChangeLogAt = useRef(0);
  const lastRegionChangeRegion = useRef<Region | null>(null);
  const lastZoomClampLogAt = useRef(0);
  const lastBoundaryPress = useRef<LastBoundaryPress | null>(null);
  const editorSnapshot = useRef<EditorSnapshot | null>(null);

  const [planType, setPlanType] = useState<GardenPlanType>(DEFAULT_PLAN_TYPE);
  const [areaLabel, setAreaLabel] = useState(DEFAULT_PLAN_DETAILS.areaLabel);
  const [vibe, setVibe] = useState(DEFAULT_PLAN_DETAILS.vibe);
  const [mustHaves, setMustHaves] = useState<string[]>(
    DEFAULT_PLAN_DETAILS.mustHaves,
  );
  const [notes, setNotes] = useState('');
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [measurementUnit, setMeasurementUnit] = useState<GardenPlanMeasurementUnit>('feet');

  const setEditorMapRegion = useCallback((region: Region) => {
    const normalized = clampRegionDeltas(region);
    mapRegionRef.current = normalized;
    setMapRegion(normalized);
    setInitialMapRegionForView(prev => prev ?? normalized);
  }, []);

  const syncCameraAltitude = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return null;
    try {
      const camera = await map.getCamera();
      if (typeof camera.altitude === 'number') {
        const altitude = camera.altitude;
        setMapCameraAltitude(prev =>
          prev != null && Math.abs(prev - altitude) < 0.5 ? prev : altitude,
        );
        return altitude;
      }
    } catch {
      // Ignore — we'll try again on the next interaction.
    }
    return null;
  }, []);

  useEffect(() => {
    setMeasurementUnit(defaultMeasurementUnit(currentHousehold?.country));
  }, [currentHousehold?.country]);

  useEffect(() => {
    if (!isEditorOpen) return;

    Animated.timing(editorSlideX, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [editorSlideX, isEditorOpen]);

  const load = useCallback(async () => {
    if (!currentHousehold) return;
    try {
      setIsLoading(true);
      const response = await gardenPlansApi.getBoundaryDraft(
        currentHousehold.id,
        route.params.draftId,
      );
      setDraft(response.boundary_draft);
      const geometry =
        response.boundary_draft.confirmed_boundary ??
        rectangleAroundGeocode(response.boundary_draft);
      const bbox = geometryBBox(geometry);
      const loadedPoints = pointsFromGeometry(geometry, bbox);
      const initialSource = response.boundary_draft.boundary_source ?? 'user_drawn';
      logBoundaryDebug('draft_loaded', {
        draftId: response.boundary_draft.id,
        status: response.boundary_draft.status,
        source: initialSource,
        hasConfirmedBoundary: Boolean(response.boundary_draft.confirmed_boundary),
        previewImageKey: response.boundary_draft.preview_image_key,
        geometry: summarizeGeometry(geometry),
        points: summarizePoints(loadedPoints, bbox),
      });
      setBaseBBox(bbox);
      setPoints(loadedPoints);
      setEditorMapRegion(regionFromBBox(bbox));
      setSource(initialSource);
      setBoundaryUndoHistory([]);
      setBoundaryRedoHistory([]);
    } catch (error) {
      console.error('Failed to load boundary draft:', error);
      showToast('error', 'Could not load boundary preview');
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold, navigation, route.params.draftId, setEditorMapRegion]);

  useEffect(() => {
    load();
  }, [load]);

  const onPreviewMapLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewMapSize({ width, height });
  };

  const onMapPress = (event: MapPressEvent) => {
    logBoundaryDebug('map_press', {
      draftId: draft?.id,
      coordinate: summarizeCoordinate(event.nativeEvent.coordinate),
      currentRegion: mapRegionRef.current
        ? summarizeRegion(mapRegionRef.current)
        : null,
      stateRegion: mapRegion ? summarizeRegion(mapRegion) : null,
      pointCount: points.length,
      isEditorOpen,
      isDrawing,
    });
    addBoundaryPoint(event.nativeEvent.coordinate, 'map_press');
  };

  const onPolygonPress = (event: PolygonPressEvent) => {
    event.stopPropagation?.();
    if (!event.nativeEvent.coordinate) return;
    logBoundaryDebug('polygon_press', {
      draftId: draft?.id,
      coordinate: summarizeCoordinate(event.nativeEvent.coordinate),
      currentRegion: mapRegionRef.current
        ? summarizeRegion(mapRegionRef.current)
        : null,
      stateRegion: mapRegion ? summarizeRegion(mapRegion) : null,
      pointCount: points.length,
      isEditorOpen,
      isDrawing,
    });
    addBoundaryPoint(event.nativeEvent.coordinate, 'polygon_press');
  };

  const onEditorPanDrag = () => {
    if (isMapPanGesture.current) return;

    isMapPanGesture.current = true;
    panStartRegion.current = mapRegionRef.current;
    panStartCameraAltitude.current = mapCameraAltitude;
    const map = mapRef.current;
    if (!map) return;

    map.getCamera()
      .then(camera => {
        if (typeof camera.altitude === 'number') {
          panStartCameraAltitude.current = camera.altitude;
        }
      })
      .catch(() => {
        panStartCameraAltitude.current = null;
      });
  };

  const onEditorRegionChange = (region: Region) => {
    const clampedRegion = clampRegionDeltas(region);
    const wasClamped =
      Math.abs(clampedRegion.latitudeDelta - region.latitudeDelta) > 0.0000001 ||
      Math.abs(clampedRegion.longitudeDelta - region.longitudeDelta) > 0.0000001;
    if (wasClamped && Date.now() - lastZoomClampLogAt.current > 220) {
      lastZoomClampLogAt.current = Date.now();
      logBoundaryDebug('editor_region_clamped', {
        draftId: draft?.id,
        incoming: summarizeRegion(region),
        clamped: summarizeRegion(clampedRegion),
        limits: {
          minDelta: MAP_MIN_DELTA,
          maxDelta: MAP_MAX_DELTA,
        },
        hitMinLatitudeDelta: Math.abs(clampedRegion.latitudeDelta - MAP_MIN_DELTA) < 0.0000000001,
        hitMinLongitudeDelta: Math.abs(clampedRegion.longitudeDelta - MAP_MIN_DELTA) < 0.0000000001,
        hitMaxLatitudeDelta: Math.abs(clampedRegion.latitudeDelta - MAP_MAX_DELTA) < 0.0000001,
        hitMaxLongitudeDelta: Math.abs(clampedRegion.longitudeDelta - MAP_MAX_DELTA) < 0.0000001,
      });
    }
    const normalizedRegion = applyZoomLock(clampedRegion, pendingZoomLock.current);
    const zoomLock = pendingZoomLock.current;
    if (
      zoomLock &&
      Date.now() < zoomLock.until &&
      (Math.abs(clampedRegion.latitudeDelta - normalizedRegion.latitudeDelta) > 0.0000001 ||
        Math.abs(clampedRegion.longitudeDelta - normalizedRegion.longitudeDelta) > 0.0000001)
    ) {
      logBoundaryDebug('editor_zoom_lock_applied', {
        draftId: draft?.id,
        trigger: zoomLock.trigger,
        incoming: summarizeRegion(clampedRegion),
        locked: summarizeRegion(normalizedRegion),
        msRemaining: zoomLock.until - Date.now(),
      });
    }
    // Only update the ref during gestures. Triggering a React re-render here
    // (via setMapRegion) causes the MapView to reconcile under the new
    // architecture, which can fight the native pinch and produce a snap-back
    // / auto zoom-out feel. The state is refreshed in onRegionChangeComplete.
    mapRegionRef.current = normalizedRegion;

    const now = Date.now();
    const lastLoggedRegion = lastRegionChangeRegion.current;
    const shouldLog =
      now - lastRegionChangeLogAt.current > 180 &&
      (!lastLoggedRegion || !regionsAreClose(normalizedRegion, lastLoggedRegion));
    if (!shouldLog) return;

    lastRegionChangeLogAt.current = now;
    lastRegionChangeRegion.current = normalizedRegion;
    logBoundaryDebug('editor_region_change', {
      draftId: draft?.id,
      incoming: summarizeRegion(normalizedRegion),
      previous: mapRegionRef.current ? summarizeRegion(mapRegionRef.current) : null,
      pendingRestore: null,
      pointCount: points.length,
      isDrawing,
      isEditorOpen,
    });
  };

  const onEditorRegionChangeComplete = (region: Region) => {
    const clampedRegion = clampRegionDeltas(region);
    const normalizedRegion = applyZoomLock(clampedRegion, pendingZoomLock.current);
    const wasClamped =
      Math.abs(clampedRegion.latitudeDelta - region.latitudeDelta) > 0.0000001 ||
      Math.abs(clampedRegion.longitudeDelta - region.longitudeDelta) > 0.0000001;
    logBoundaryDebug('editor_region_change_complete', {
      draftId: draft?.id,
      incoming: summarizeRegion(region),
      clamped: summarizeRegion(clampedRegion),
      normalized: summarizeRegion(normalizedRegion),
      wasClamped,
      hitMinLatitudeDelta: Math.abs(clampedRegion.latitudeDelta - MAP_MIN_DELTA) < 0.0000000001,
      hitMinLongitudeDelta: Math.abs(clampedRegion.longitudeDelta - MAP_MIN_DELTA) < 0.0000000001,
      hitMaxLatitudeDelta: Math.abs(clampedRegion.latitudeDelta - MAP_MAX_DELTA) < 0.0000001,
      hitMaxLongitudeDelta: Math.abs(clampedRegion.longitudeDelta - MAP_MAX_DELTA) < 0.0000001,
      previous: mapRegionRef.current
        ? summarizeRegion(mapRegionRef.current)
        : null,
      pendingRestore: null,
      pointCount: points.length,
    });
    mapRegionRef.current = normalizedRegion;
    setMapRegion(normalizedRegion);
    if (Platform.OS === 'ios' && isMapPanGesture.current) {
      const startAltitude = panStartCameraAltitude.current;
      const startRegion = panStartRegion.current;
      const map = mapRef.current;
      if (map && startAltitude != null && startRegion) {
        setTimeout(() => {
          map.getCamera()
            .then(camera => {
              if (typeof camera.altitude !== 'number') return;
              const zoomedOutDuringPan = camera.altitude > startAltitude * 1.08;
              if (!zoomedOutDuringPan) return;

              map.animateCamera(
                {
                  ...camera,
                  altitude: startAltitude,
                  center: {
                    latitude: normalizedRegion.latitude,
                    longitude: normalizedRegion.longitude,
                  },
                },
                { duration: 80 },
              );
              setMapCameraAltitude(startAltitude);
              logBoundaryDebug('editor_pan_altitude_restored', {
                draftId: draft?.id,
                fromAltitude: roundNumber(camera.altitude, 2),
                toAltitude: roundNumber(startAltitude, 2),
                region: summarizeRegion(normalizedRegion),
              });
            })
            .catch(() => {
              // Ignore; the next pan/zoom will resync the camera.
            });
        }, 0);
      }
    }
    isMapPanGesture.current = false;
    panStartCameraAltitude.current = null;
    panStartRegion.current = null;
    void syncCameraAltitude();
  };

  const restoreEditorMapRegion = (region: Region | null, reason: string) => {
    if (!region) {
      logBoundaryDebug('editor_region_restore_skipped', {
        draftId: draft?.id,
        reason: 'missing_region',
        trigger: reason,
      });
      return;
    }

    const normalizedRegion = clampRegionDeltas(region);
    pendingZoomLock.current = null;
    pendingRegionRestore.current = null;
    mapRegionRef.current = normalizedRegion;
    setMapRegion(normalizedRegion);
    logBoundaryDebug('editor_region_restore_scheduled', {
      draftId: draft?.id,
      region: summarizeRegion(normalizedRegion),
      currentStateRegion: mapRegion ? summarizeRegion(mapRegion) : null,
      trigger: reason,
      zoomLock: {
        enabled: false,
        latDelta: roundNumber(normalizedRegion.latitudeDelta, 7),
        lonDelta: roundNumber(normalizedRegion.longitudeDelta, 7),
        msRemaining: 0,
      },
    });
    logBoundaryDebug('editor_region_restore_apply_state', {
      draftId: draft?.id,
      region: summarizeRegion(normalizedRegion),
      trigger: reason,
    });
  };

  const addBoundaryPoint = (
    coordinate: LatLng,
    sourceType: BoundaryPointSource,
  ) => {
    if (!baseBBox) return;
    if (!isEditorOpen) return;
    const previousPress = lastBoundaryPress.current;
    const now = Date.now();
    const duplicatePress =
      previousPress &&
      now - previousPress.timestamp < 350 &&
      distanceMeters(previousPress.coordinate, coordinate) < 1.5;
    if (duplicatePress) {
      logBoundaryDebug('point_add_ignored_duplicate_press', {
        draftId: draft?.id,
        sourceType,
        previousSourceType: previousPress.sourceType,
        coordinate: summarizeCoordinate(coordinate),
        previousCoordinate: summarizeCoordinate(previousPress.coordinate),
        msSincePrevious: now - previousPress.timestamp,
      });
      return;
    }
    lastBoundaryPress.current = { coordinate, sourceType, timestamp: now };
    const editorRegion = mapRegionRef.current ?? mapRegion;
    const nextPoint = pointFromCoordinate(coordinate, baseBBox);
    const result =
      isDrawing || points.length < 3
        ? appendBoundaryPoint(points, nextPoint, MAX_BOUNDARY_POINTS)
        : insertPointNearBoundary(points, nextPoint, MAX_BOUNDARY_POINTS);
    const nextPoints = result.points;
    if (result.insertedIndex !== null) {
      const insertedIndex = result.insertedIndex;
      setBoundaryUndoHistory(prev => prev
        .map(entry => ({
          ...entry,
          index: entry.index >= insertedIndex ? entry.index + 1 : entry.index,
        }))
        .concat({ index: insertedIndex, point: nextPoint }));
      setBoundaryRedoHistory([]);
    }
    setPoints(nextPoints);
    logBoundaryDebug('point_added', {
      draftId: draft?.id,
      sourceType,
      mode: isDrawing || points.length < 3 ? 'append' : 'insert_nearest_segment',
      coordinate: summarizeCoordinate(coordinate),
      point: summarizePoint(nextPoint),
      beforeCount: points.length,
      insertedIndex: result.insertedIndex,
      preservedRegion: editorRegion ? summarizeRegion(editorRegion) : null,
      after: summarizePoints(nextPoints, baseBBox),
    });
    setSource('user_drawn');
    restoreEditorMapRegion(editorRegion, 'point_added');
  };

  const removeBoundaryPoint = (index: number) => {
    Haptics.selectionAsync();
    const editorRegion = mapRegionRef.current ?? mapRegion;
    const removedPoint = points[index];
    const nextPoints = points.filter((_, pointIndex) => pointIndex !== index);
    setBoundaryUndoHistory(prev => prev
      .filter(entry => entry.index !== index)
      .map(entry => ({
        ...entry,
        index: entry.index > index ? entry.index - 1 : entry.index,
      })));
    setBoundaryRedoHistory([]);
    setPoints(nextPoints);
    logBoundaryDebug('point_removed', {
      draftId: draft?.id,
      index,
      removedPoint: removedPoint ? summarizePoint(removedPoint) : null,
      beforeCount: points.length,
      after: baseBBox ? summarizePoints(nextPoints, baseBBox) : { count: nextPoints.length },
    });
    setSource('user_drawn');
    restoreEditorMapRegion(editorRegion, 'point_removed');
  };

  const moveBoundaryPoint = (index: number, coordinate: LatLng) => {
    if (!baseBBox) return;
    const editorRegion =
      regionBeforeBoundaryDrag.current ?? mapRegionRef.current ?? mapRegion;
    const nextPoint = pointFromCoordinate(coordinate, baseBBox);
    const previousPoint = points[index];
    const nextPoints = points.map((point, pointIndex) =>
      pointIndex === index ? nextPoint : point,
    );
    setBoundaryRedoHistory([]);
    setPoints(nextPoints);
    logBoundaryDebug('point_moved', {
      draftId: draft?.id,
      index,
      from: previousPoint ? summarizePoint(previousPoint) : null,
      to: summarizePoint(nextPoint),
      coordinate: summarizeCoordinate(coordinate),
      after: summarizePoints(nextPoints, baseBBox),
    });
    setSource('user_drawn');
    restoreEditorMapRegion(editorRegion, 'point_moved');
    regionBeforeBoundaryDrag.current = null;
  };

  const canUndoBoundaryPoint = boundaryUndoHistory.some(
    entry => entry.index >= 0 && entry.index < points.length,
  );
  const canRedoBoundaryPoint =
    points.length < MAX_BOUNDARY_POINTS &&
    boundaryRedoHistory.some(entry => entry.index >= 0);

  const undoBoundaryPoint = () => {
    if (!canUndoBoundaryPoint) return;
    Haptics.selectionAsync();
    const editorRegion = mapRegionRef.current ?? mapRegion;
    const history = boundaryUndoHistory;
    let historyIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].index >= 0 && history[index].index < points.length) {
        historyIndex = index;
        break;
      }
    }
    if (historyIndex < 0) return;
    const removedIndex = history[historyIndex].index;
    const removedPoint = points[removedIndex];
    if (!removedPoint) return;
    const nextPoints = points.filter((_, pointIndex) => pointIndex !== removedIndex);

    setBoundaryUndoHistory(history
      .slice(0, historyIndex)
      .filter(entry => entry.index !== removedIndex)
      .map(entry => ({
        ...entry,
        index: entry.index > removedIndex ? entry.index - 1 : entry.index,
      })));
    setBoundaryRedoHistory(prev => [...prev, { index: removedIndex, point: removedPoint }]);
    setPoints(nextPoints);
    logBoundaryDebug('point_undone', {
      draftId: draft?.id,
      index: removedIndex,
      removedPoint: removedPoint ? summarizePoint(removedPoint) : null,
      beforeCount: points.length,
      after: baseBBox ? summarizePoints(nextPoints, baseBBox) : { count: nextPoints.length },
    });
    setSource('user_drawn');
    restoreEditorMapRegion(editorRegion, 'point_undone');
  };

  const redoBoundaryPoint = () => {
    if (!canRedoBoundaryPoint) return;
    Haptics.selectionAsync();
    const editorRegion = mapRegionRef.current ?? mapRegion;
    const redoEntry = boundaryRedoHistory[boundaryRedoHistory.length - 1];
    if (!redoEntry) return;

    const insertIndex = clamp(redoEntry.index, 0, points.length);
    const nextPoints = [
      ...points.slice(0, insertIndex),
      redoEntry.point,
      ...points.slice(insertIndex),
    ];

    setBoundaryRedoHistory(prev => prev.slice(0, -1));
    setBoundaryUndoHistory(prev => prev
      .map(entry => ({
        ...entry,
        index: entry.index >= insertIndex ? entry.index + 1 : entry.index,
      }))
      .concat({ index: insertIndex, point: redoEntry.point }));
    setPoints(nextPoints);
    logBoundaryDebug('point_redone', {
      draftId: draft?.id,
      index: insertIndex,
      restoredPoint: summarizePoint(redoEntry.point),
      beforeCount: points.length,
      after: baseBBox ? summarizePoints(nextPoints, baseBBox) : { count: nextPoints.length },
    });
    setSource('user_drawn');
    restoreEditorMapRegion(editorRegion, 'point_redone');
  };

  const startDrawing = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    logBoundaryDebug('draw_started', {
      draftId: draft?.id,
      previous: baseBBox ? summarizePoints(points, baseBBox) : { count: points.length },
    });
    setIsDrawing(true);
    setPoints([]);
    setBoundaryUndoHistory([]);
    setBoundaryRedoHistory([]);
    setDraggingBoundaryPointIndex(null);
    setSource('user_drawn');
  };

  const zoomMap = async (direction: 'in' | 'out') => {
    const currentRegion = mapRegionRef.current ?? mapRegion;
    if (!currentRegion) return;

    const map = mapRef.current;
    if (!map) return;

    let camera;
    try {
      camera = await map.getCamera();
    } catch (error) {
      logBoundaryDebug('editor_zoom_camera_altitude_failed', {
        draftId: draft?.id,
        direction,
        stage: 'pre',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const prevAltitude = camera.altitude;
    if (typeof prevAltitude !== 'number') return;

    const minDiscovered = minDiscoveredAltitude;
    const maxDiscovered = maxDiscoveredAltitude;
    const minLimit = Math.max(MAP_MIN_CAMERA_ALTITUDE, minDiscovered ?? 0);
    const maxLimit = Math.min(
      MAP_MAX_CAMERA_ALTITUDE,
      maxDiscovered ?? MAP_MAX_CAMERA_ALTITUDE,
    );

    if (direction === 'in' && prevAltitude <= minLimit * 1.02) {
      setMapCameraAltitude(prevAltitude);
      logBoundaryDebug('editor_zoom_in_blocked', {
        draftId: draft?.id,
        prevAltitude: roundNumber(prevAltitude, 2),
        minLimit: roundNumber(minLimit, 2),
        minDiscovered: minDiscovered != null ? roundNumber(minDiscovered, 2) : null,
      });
      return;
    }
    if (direction === 'out' && prevAltitude >= maxLimit * 0.98) {
      setMapCameraAltitude(prevAltitude);
      logBoundaryDebug('editor_zoom_out_blocked', {
        draftId: draft?.id,
        prevAltitude: roundNumber(prevAltitude, 2),
        maxLimit: roundNumber(maxLimit, 2),
        maxDiscovered: maxDiscovered != null ? roundNumber(maxDiscovered, 2) : null,
      });
      return;
    }

    Haptics.selectionAsync();

    const requestedAltitude =
      direction === 'in' ? prevAltitude * 0.5 : prevAltitude * 1.8;
    const nextAltitude = clamp(requestedAltitude, minLimit, maxLimit);

    pendingZoomLock.current = null;
    pendingRegionRestore.current = null;
    map.animateCamera(
      {
        ...camera,
        altitude: nextAltitude,
        center: {
          latitude: currentRegion.latitude,
          longitude: currentRegion.longitude,
        },
      },
      { duration: 180 },
    );
    logBoundaryDebug('editor_zoom_pressed_camera_altitude', {
      draftId: draft?.id,
      direction,
      previousAltitude: roundNumber(prevAltitude, 2),
      requestedAltitude: roundNumber(requestedAltitude, 2),
      nextAltitude: roundNumber(nextAltitude, 2),
      limits: {
        minAltitude: minLimit,
        maxAltitude: maxLimit,
      },
      discoveredMin: minDiscovered != null ? roundNumber(minDiscovered, 2) : null,
      discoveredMax: maxDiscovered != null ? roundNumber(maxDiscovered, 2) : null,
    });

    setTimeout(async () => {
      try {
        const after = await map.getCamera();
        const actualAltitude = after.altitude;
        if (typeof actualAltitude !== 'number') return;

        if (direction === 'in') {
          // We expected the camera to come down. If it didn't (or went up),
          // the platform refused to zoom in. The TRUE floor is the highest
          // altitude we observed in this exchange — anything lower was rejected.
          if (actualAltitude >= prevAltitude * 0.92) {
            const observedFloor = Math.max(prevAltitude, actualAltitude);
            setMinDiscoveredAltitude(prev =>
              prev == null ? observedFloor : Math.max(prev, observedFloor),
            );
            // Reflect where the camera actually ended up — restoring is
            // pointless because the platform will reject any value below the
            // floor it just enforced.
            setMapCameraAltitude(actualAltitude);
            logBoundaryDebug('editor_zoom_in_floor_locked', {
              draftId: draft?.id,
              prevAltitude: roundNumber(prevAltitude, 2),
              actualAltitude: roundNumber(actualAltitude, 2),
              observedFloor: roundNumber(observedFloor, 2),
            });
            return;
          }
          setMapCameraAltitude(actualAltitude);
          return;
        }

        // direction === 'out'
        if (actualAltitude <= prevAltitude * 1.08) {
          const observedCeiling = Math.min(prevAltitude, actualAltitude);
          setMaxDiscoveredAltitude(prev =>
            prev == null ? observedCeiling : Math.min(prev, observedCeiling),
          );
          setMapCameraAltitude(actualAltitude);
          logBoundaryDebug('editor_zoom_out_ceiling_locked', {
            draftId: draft?.id,
            prevAltitude: roundNumber(prevAltitude, 2),
            actualAltitude: roundNumber(actualAltitude, 2),
            observedCeiling: roundNumber(observedCeiling, 2),
          });
          return;
        }
        setMapCameraAltitude(actualAltitude);
      } catch (error) {
        logBoundaryDebug('editor_zoom_camera_altitude_failed', {
          draftId: draft?.id,
          direction,
          stage: 'post',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, 280);
  };

  const recenterMap = () => {
    if (!baseBBox) return;

    Haptics.selectionAsync();
    const targetRegion =
      mapBoundaryCoordinates.length > 0
        ? regionFromCoordinateBBox(summarizeCoordinateBBox(mapBoundaryCoordinates))
        : regionFromBBox(baseBBox);
    setEditorMapRegion(targetRegion);
    mapRef.current?.animateToRegion(targetRegion, 220);
  };

  const rotateMap = (direction: -1 | 1) => {
    if (!mapRegion) {
      logBoundaryDebug('editor_rotate_skipped_no_region', {
        draftId: draft?.id,
        direction,
      });
      return;
    }
    Haptics.selectionAsync();
    setMapHeading((previous) => {
      const nextHeading = (previous + MAP_ROTATION_STEP * direction + 360) % 360;
      const map = mapRef.current;
      logBoundaryDebug('editor_rotate_pressed', {
        draftId: draft?.id,
        direction,
        previousHeading: roundNumber(previous, 2),
        nextHeading: roundNumber(nextHeading, 2),
        mapRegion: summarizeRegion(mapRegion),
        refRegion: mapRegionRef.current ? summarizeRegion(mapRegionRef.current) : null,
        stateAltitude: mapCameraAltitude != null ? roundNumber(mapCameraAltitude, 2) : null,
        minDiscoveredAltitude:
          minDiscoveredAltitude != null ? roundNumber(minDiscoveredAltitude, 2) : null,
        maxDiscoveredAltitude:
          maxDiscoveredAltitude != null ? roundNumber(maxDiscoveredAltitude, 2) : null,
      });
      if (map) {
        map.getCamera()
          .then(camera => {
            logBoundaryDebug('editor_rotate_before_camera', {
              draftId: draft?.id,
              direction,
              nextHeading: roundNumber(nextHeading, 2),
              camera: summarizeCamera(camera),
            });
            map.animateCamera(
              {
                ...camera,
                heading: nextHeading,
                pitch: 0,
              },
              { duration: 220 },
            );
            if (typeof camera.altitude === 'number') {
              setMapCameraAltitude(camera.altitude);
            }
            setTimeout(() => {
              map.getCamera()
                .then(after => {
                  logBoundaryDebug('editor_rotate_after_camera', {
                    draftId: draft?.id,
                    direction,
                    requestedHeading: roundNumber(nextHeading, 2),
                    beforeCamera: summarizeCamera(camera),
                    afterCamera: summarizeCamera(after),
                    altitudeDelta:
                      typeof camera.altitude === 'number' && typeof after.altitude === 'number'
                        ? roundNumber(after.altitude - camera.altitude, 2)
                        : null,
                  });
                })
                .catch(error => {
                  logBoundaryDebug('editor_rotate_after_camera_failed', {
                    draftId: draft?.id,
                    direction,
                    message: error instanceof Error ? error.message : String(error),
                  });
                });
            }, 300);
          })
          .catch(error => {
            logBoundaryDebug('editor_rotate_get_camera_failed_using_partial_camera', {
              draftId: draft?.id,
              direction,
              nextHeading: roundNumber(nextHeading, 2),
              message: error instanceof Error ? error.message : String(error),
            });
            map.animateCamera(
              {
                center: {
                  latitude: mapRegion.latitude,
                  longitude: mapRegion.longitude,
                },
                heading: nextHeading,
                pitch: 0,
              },
              { duration: 220 },
            );
          });
      } else {
        logBoundaryDebug('editor_rotate_skipped_no_map', {
          draftId: draft?.id,
          direction,
          nextHeading: roundNumber(nextHeading, 2),
        });
      }
      return nextHeading;
    });
  };

  const resetMapRotation = () => {
    if (!mapRegion) {
      logBoundaryDebug('editor_rotation_reset_skipped_no_region', {
        draftId: draft?.id,
      });
      return;
    }
    Haptics.selectionAsync();
    setMapHeading(0);
    const map = mapRef.current;
    logBoundaryDebug('editor_rotation_reset_pressed', {
      draftId: draft?.id,
      previousHeading: roundNumber(mapHeading, 2),
      mapRegion: summarizeRegion(mapRegion),
      refRegion: mapRegionRef.current ? summarizeRegion(mapRegionRef.current) : null,
      stateAltitude: mapCameraAltitude != null ? roundNumber(mapCameraAltitude, 2) : null,
      minDiscoveredAltitude:
        minDiscoveredAltitude != null ? roundNumber(minDiscoveredAltitude, 2) : null,
      maxDiscoveredAltitude:
        maxDiscoveredAltitude != null ? roundNumber(maxDiscoveredAltitude, 2) : null,
    });
    if (!map) {
      logBoundaryDebug('editor_rotation_reset_skipped_no_map', {
        draftId: draft?.id,
      });
      return;
    }

    map.getCamera()
      .then(camera => {
        logBoundaryDebug('editor_rotation_reset_before_camera', {
          draftId: draft?.id,
          camera: summarizeCamera(camera),
        });
        map.animateCamera(
          {
            ...camera,
            heading: 0,
            pitch: 0,
          },
          { duration: 220 },
        );
        if (typeof camera.altitude === 'number') {
          setMapCameraAltitude(camera.altitude);
        }
        setTimeout(() => {
          map.getCamera()
            .then(after => {
              logBoundaryDebug('editor_rotation_reset_after_camera', {
                draftId: draft?.id,
                beforeCamera: summarizeCamera(camera),
                afterCamera: summarizeCamera(after),
                altitudeDelta:
                  typeof camera.altitude === 'number' && typeof after.altitude === 'number'
                    ? roundNumber(after.altitude - camera.altitude, 2)
                    : null,
              });
            })
            .catch(error => {
              logBoundaryDebug('editor_rotation_reset_after_camera_failed', {
                draftId: draft?.id,
                message: error instanceof Error ? error.message : String(error),
              });
            });
        }, 300);
      })
      .catch(error => {
        logBoundaryDebug('editor_rotation_reset_get_camera_failed_using_partial_camera', {
          draftId: draft?.id,
          message: error instanceof Error ? error.message : String(error),
        });
        map.animateCamera(
          {
            center: {
              latitude: mapRegion.latitude,
              longitude: mapRegion.longitude,
            },
            heading: 0,
            pitch: 0,
          },
          { duration: 220 },
        );
      });
  };

  const openEditor = () => {
    Haptics.selectionAsync();
    editorSlideX.setValue(editorSlideWidth);
    setMapHeading(0);
    editorSnapshot.current = {
      points: [...points],
      baseBBox: baseBBox ? { ...baseBBox } : null,
      source,
    };
    logBoundaryDebug('editor_opened', {
      draftId: draft?.id,
      source,
      snapshot: baseBBox ? summarizePoints(points, baseBBox) : { count: points.length },
    });
    setIsEditorOpen(true);
  };

  const closeEditor = (applyChanges = false) => {
    logBoundaryDebug('editor_closed', {
      draftId: draft?.id,
      applyChanges,
      restoredSnapshot: !applyChanges && Boolean(editorSnapshot.current),
      current: baseBBox ? summarizePoints(points, baseBBox) : { count: points.length },
    });
    if (!applyChanges && editorSnapshot.current) {
      setPoints(editorSnapshot.current.points);
      setBaseBBox(editorSnapshot.current.baseBBox);
      setSource(editorSnapshot.current.source);
    }
    editorSnapshot.current = null;
    setBoundaryUndoHistory([]);
    setBoundaryRedoHistory([]);
    setIsDrawing(false);
    setDraggingBoundaryPointIndex(null);
    setMapHeading(0);
    setIsEditorOpen(false);
  };

  const saveBoundary = async () => {
    if (
      !currentHousehold ||
      !draft ||
      !baseBBox ||
      points.length < 3
    ) {
      return null;
    }

    const boundary = geometryFromPoints(points, baseBBox);
    logBoundaryDebug('save_boundary_request', {
      householdId: currentHousehold.id,
      draftId: draft.id,
      source,
      points: summarizePoints(points, baseBBox),
      geometry: summarizeGeometry(boundary),
    });
    const response = await gardenPlansApi.confirmBoundaryDraft(
      currentHousehold.id,
      draft.id,
      {
        boundary_geojson: boundary,
        boundary_source: source,
      },
    );
    logBoundaryDebug('save_boundary_response', {
      draftId: response.boundary_draft.id,
      status: response.boundary_draft.status,
      source: response.boundary_draft.boundary_source,
      previewImageKey: response.boundary_draft.preview_image_key,
      referenceImageKey: response.boundary_draft.reference_image_key,
      confirmedBoundary: response.boundary_draft.confirmed_boundary
        ? summarizeGeometry(response.boundary_draft.confirmed_boundary)
        : null,
    });
    setDraft(response.boundary_draft);
    if (response.boundary_draft.confirmed_boundary) {
      const savedBBox = geometryBBox(response.boundary_draft.confirmed_boundary);
      const savedPoints = pointsFromGeometry(
        response.boundary_draft.confirmed_boundary,
        savedBBox,
      );
      const savedRegion = regionFromBBox(savedBBox);
      setBaseBBox(savedBBox);
      setPoints(savedPoints);
      setEditorMapRegion(savedRegion);
      setSource(response.boundary_draft.boundary_source ?? source);
      setBoundaryUndoHistory([]);
      setBoundaryRedoHistory([]);
    }
    return response.boundary_draft;
  };

  const applyBoundaryChanges = async () => {
    try {
      setIsSavingBoundary(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const savedDraft = await saveBoundary();
      if (!savedDraft) return;

      editorSnapshot.current = null;
      setIsDrawing(false);
      setIsEditorOpen(false);
      showToast('success', 'Boundary saved');
    } catch (error) {
      console.error('Failed to save boundary:', error);
      showToast('error', 'Could not save boundary');
    } finally {
      setIsSavingBoundary(false);
    }
  };

  const editorPointsAreDirty = (() => {
    const initial = editorSnapshot.current?.points;
    if (!initial) return false;
    if (initial.length !== points.length) return true;
    return points.some(
      (point, index) =>
        point.x !== initial[index].x || point.y !== initial[index].y,
    );
  })();

  const handleEditorBackPress = () => {
    if (!editorPointsAreDirty) {
      closeEditor();
      return;
    }
    Alert.alert(
      'Unsaved changes',
      'Your boundary changes have not been applied.',
      [
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () => closeEditor(),
        },
        {
          text: 'Apply changes',
          onPress: () => {
            void applyBoundaryChanges();
          },
        },
      ],
    );
  };

  const mapBoundaryCoordinates = useMemo(
    () => (baseBBox ? coordinatesFromPoints(points, baseBBox) : []),
    [baseBBox, points],
  );

  const displayedBoundaryCoordinates = useMemo(() => {
    if (
      !boundaryDragPreview ||
      boundaryDragPreview.index < 0 ||
      boundaryDragPreview.index >= mapBoundaryCoordinates.length
    ) {
      return mapBoundaryCoordinates;
    }
    return mapBoundaryCoordinates.map((coordinate, index) =>
      index === boundaryDragPreview.index
        ? boundaryDragPreview.coordinate
        : coordinate,
    );
  }, [boundaryDragPreview, mapBoundaryCoordinates]);

  const boundaryMeasurements = useMemo(
    () =>
      mapBoundaryCoordinates.length >= 3
        ? buildBoundaryMeasurementSummary(mapBoundaryCoordinates, measurementUnit)
        : null,
    [mapBoundaryCoordinates, measurementUnit],
  );

  const canZoomIn = useMemo(() => {
    if (mapCameraAltitude == null) return true;
    const minLimit = Math.max(
      MAP_MIN_CAMERA_ALTITUDE,
      minDiscoveredAltitude ?? 0,
    );
    return mapCameraAltitude > minLimit * 1.02;
  }, [mapCameraAltitude, minDiscoveredAltitude]);

  const canZoomOut = useMemo(() => {
    if (mapCameraAltitude == null) return true;
    const maxLimit = Math.min(
      MAP_MAX_CAMERA_ALTITUDE,
      maxDiscoveredAltitude ?? MAP_MAX_CAMERA_ALTITUDE,
    );
    return mapCameraAltitude < maxLimit * 0.98;
  }, [mapCameraAltitude, maxDiscoveredAltitude]);

  const openFinalApproval = () => {
    if (!boundaryMeasurements) return;
    Haptics.selectionAsync();
    setIsApprovalOpen(true);
  };

  const generate = async () => {
    if (
      !currentHousehold ||
      !draft ||
      !baseBBox ||
      !boundaryMeasurements ||
      points.length < 3 ||
      isGenerating
    )
      return;
    try {
      setIsGenerating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const savedDraft = await saveBoundary();
      const boundaryMeasurementPayload: GardenPlanBoundaryMeasurements = {
        unit: boundaryMeasurements.unit,
        width: boundaryMeasurements.width,
        depth: boundaryMeasurements.depth,
        area: boundaryMeasurements.area,
      };
      const generationPayload = {
        plan_type: planType,
        area_label: areaLabel.trim() || 'Garden plan',
        vibe: vibe.trim() || 'low-maintenance',
        must_haves: mustHaves,
        notes: notes.trim() || null,
        boundary_measurements: boundaryMeasurementPayload,
      };
      logBoundaryDebug('generate_request', {
        householdId: currentHousehold.id,
        draftId: draft.id,
        savedDraftStatus: savedDraft?.status,
        referenceImageKey: savedDraft?.reference_image_key,
        payload: {
          ...generationPayload,
          notes: generationPayload.notes ? '[present]' : null,
        },
        boundary: summarizeGeometry(geometryFromPoints(points, baseBBox)),
      });
      const result = await gardenPlansApi.generateFromBoundaryDraft(
        currentHousehold.id,
        draft.id,
        generationPayload,
      );
      logBoundaryDebug('generate_response', {
        draftId: draft.id,
        gardenPlanId: result.garden_plan_id,
        queued: result.queued,
      });
      showToast('success', 'Editable garden plan created');
      setIsApprovalOpen(false);
      navigation.navigate('GardenPlanViewer', { gardenPlanId: result.garden_plan_id });
    } catch (error) {
      console.error('Failed to generate from boundary:', error);
      showToast('error', 'Could not start garden plan generation');
    } finally {
      setIsGenerating(false);
    }
  };

  const selectPlanType = (nextPlanType: GardenPlanType) => {
    const preset = PLAN_TYPE_PRESETS[nextPlanType];
    setPlanType(nextPlanType);
    setAreaLabel(preset.areaLabel);
    setVibe(preset.vibe);
    setMustHaves(preset.mustHaves);
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="Confirm Plot Boundary"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer>
          <ScrollView
        style={screenScrollViewStyle.scroll}
        {...keyboardDismissScrollProps}
            contentContainerStyle={[
              styles.content,
              {
                paddingBottom:
                  insets.bottom + Layout.bottomTabBarClearance + Spacing.xl,
              },
            ]}>
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.headerCopy}
            >
              Your editable vector plan will use the boundary you confirm here.
              Adjust or draw the property line on top of the satellite preview.
            </Typography>

            {isLoading || !draft ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Card style={styles.card}>
                  <Typography variant="headline" color={colors.textPrimary}>
                    {draft.formatted_address}
                  </Typography>
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    style={styles.suggestionCopy}
                  >
                    Suggested boundary shown. Tap the map to edit it full
                    screen before generating.
                  </Typography>
                  <TouchableOpacity
                    style={[styles.mapWrap, { backgroundColor: colors.black }]}
                    onLayout={onPreviewMapLayout}
                    onPress={openEditor}
                    activeOpacity={0.9}
                  >
                    {draft.preview_image_url ? (
                      <Image
                        source={{ uri: draft.preview_image_url }}
                        style={styles.mapImage}
                      />
                    ) : (
                      <>
                        <View
                          style={[
                            styles.mapImage,
                            styles.mapFallback,
                            { backgroundColor: colors.black },
                          ]}
                        />
                        <BoundaryOverlay
                          points={points}
                          width={previewMapSize.width}
                          height={previewMapSize.height}
                        />
                      </>
                    )}
                    <View style={styles.mapEditHint}>
                      <Typography variant="caption1" color={colors.white}>
                        Tap map to edit boundary
                      </Typography>
                    </View>
                  </TouchableOpacity>
                  {boundaryMeasurements && (
                    <View
                      style={[
                        styles.inlineMeasurement,
                        {
                          backgroundColor: colors.backgroundSecondary,
                          borderColor: colors.borderColor,
                        },
                      ]}
                    >
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Size extracted from map
                      </Typography>
                      <Typography variant="body" color={colors.textPrimary}>
                        {boundaryMeasurements.displayDimensions} - {boundaryMeasurements.displayArea}
                      </Typography>
                    </View>
                  )}
                  {isDrawing && (
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                    >
                      Finish editing in the full-screen map before generating.
                    </Typography>
                  )}
                </Card>

                <Card style={styles.card}>
                  <Typography variant="headline" color={colors.textPrimary}>
                    Plan details
                  </Typography>
                  <View style={styles.segmentWrap}>
                    {PLAN_TYPES.map(type => (
                      <TouchableOpacity
                        key={type.value}
                        style={[
                          styles.segment,
                          {
                            borderColor:
                              planType === type.value
                                ? colors.primary
                                : colors.borderColor,
                            backgroundColor:
                              planType === type.value
                                ? colors.primaryLight
                                : colors.backgroundSecondary,
                          },
                        ]}
                        onPress={() => selectPlanType(type.value)}
                      >
                        <Typography
                          variant="caption1"
                          color={
                            planType === type.value
                              ? colors.primary
                              : colors.textPrimary
                          }
                        >
                          {type.label}
                        </Typography>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Field
                    label="Plan name"
                    value={areaLabel}
                    onChangeText={setAreaLabel}
                    placeholder={
                      planType === 'other_outdoor'
                        ? 'Name your custom space'
                        : 'Name your plan'
                    }
                  />
                  <Field
                    label="Notes"
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    placeholder="Optional sun, privacy, kid/pet, or maintenance notes"
                  />
                </Card>

                <GradientButton
                  title={
                    isGenerating
                      ? 'Creating vector plan...'
                      : 'Review dimensions and create plan'
                  }
                  onPress={openFinalApproval}
                  disabled={isGenerating || !boundaryMeasurements}
                  fullWidth
                />
              </>
            )}
          </ScrollView>
        </AdaptiveContainer>
        {draft && (
          <Modal
            visible={isEditorOpen}
            transparent
            animationType="none"
            presentationStyle="overFullScreen"
            onRequestClose={handleEditorBackPress}
          >
            <Animated.View
              style={[
                styles.editorScreen,
                { backgroundColor: colors.backgroundMain },
                { transform: [{ translateX: editorSlideX }] },
              ]}
            >
              <View style={styles.editorHeader}>
                <ScreenHeader
                  title="Edit Boundary"
                  showBackButton
                  onBackPress={handleEditorBackPress}
                  rightElement={
                    <View style={styles.editorHeaderActions}>
                      <HeaderActionButton
                        iconOnly
                        onPress={() => {
                          Haptics.selectionAsync();
                          setEditorMapType(current =>
                            current === 'satellite' ? 'standard' : 'satellite',
                          );
                        }}
                        accessibilityLabel={
                          editorMapType === 'satellite'
                            ? 'Switch to map view'
                            : 'Switch to satellite view'
                        }
                      >
                        <Icon
                          name={editorMapType === 'satellite' ? 'map' : 'globe-outline'}
                          size={Header.actionIconSize}
                          color={colors.primary}
                        />
                      </HeaderActionButton>
                      <HeaderActionButton
                        label={isSavingBoundary ? 'Saving...' : 'Apply'}
                        onPress={applyBoundaryChanges}
                        disabled={
                          points.length < 3 ||
                          isSavingBoundary ||
                          !editorPointsAreDirty
                        }
                      />
                    </View>
                  }
                  showNotificationBell={false}
                  showAvatar={false}
                />
              </View>

              <View style={styles.editorBody}>
                {initialMapRegionForView && (
                  <MapView
                    ref={mapRef}
                    style={styles.editorMap}
                    mapType={editorMapType}
                    initialRegion={initialMapRegionForView}
                    maxZoomLevel={MAP_MAX_ZOOM_LEVEL}
                    cameraZoomRange={IOS_SATELLITE_CAMERA_ZOOM_RANGE}
                    onPress={onMapPress}
                    onMapReady={() => {
                      logBoundaryDebug('editor_map_ready', {
                        draftId: draft?.id,
                        region: mapRegionRef.current
                          ? summarizeRegion(mapRegionRef.current)
                          : null,
                        pointCount: mapBoundaryCoordinates.length,
                      });
                      void syncCameraAltitude();
                    }}
                    onRegionChange={onEditorRegionChange}
                    onRegionChangeComplete={onEditorRegionChangeComplete}
                    onPanDrag={onEditorPanDrag}
                    rotateEnabled
                    showsCompass={false}
                    showsScale={false}
                  >
                    {displayedBoundaryCoordinates.length >= 3 && (
                      <MapPolygon
                        coordinates={displayedBoundaryCoordinates}
                        fillColor={BOUNDARY_FILL_COLOR}
                        strokeColor={BOUNDARY_COLOR}
                        strokeWidth={2}
                        tappable
                        onPress={onPolygonPress}
                      />
                    )}
                    {mapBoundaryCoordinates.map((coordinate, index) => (
                      <MapMarker
                        key={`boundary-point-${index}`}
                        coordinate={coordinate}
                        anchor={{ x: 0.5, y: 0.5 }}
                        draggable
                        onPress={event => {
                          event.stopPropagation?.();
                          removeBoundaryPoint(index);
                        }}
                        onDragStart={event => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          regionBeforeBoundaryDrag.current =
                            mapRegionRef.current ?? mapRegion;
                          logBoundaryDebug('point_drag_start', {
                            draftId: draft?.id,
                            index,
                            preservedRegion: regionBeforeBoundaryDrag.current
                              ? summarizeRegion(regionBeforeBoundaryDrag.current)
                              : null,
                          });
                          setDraggingBoundaryPointIndex(index);
                          setBoundaryDragPreview({
                            index,
                            coordinate: event.nativeEvent.coordinate,
                          });
                        }}
                        onDrag={event => {
                          setBoundaryDragPreview({
                            index,
                            coordinate: event.nativeEvent.coordinate,
                          });
                        }}
                        onDragEnd={event => {
                          Haptics.selectionAsync();
                          logBoundaryDebug('point_drag_end', {
                            draftId: draft?.id,
                            index,
                            coordinate: summarizeCoordinate(event.nativeEvent.coordinate),
                            regionAtDrop: mapRegionRef.current
                              ? summarizeRegion(mapRegionRef.current)
                              : null,
                          });
                          moveBoundaryPoint(index, event.nativeEvent.coordinate);
                          setDraggingBoundaryPointIndex(null);
                          setBoundaryDragPreview(null);
                        }}
                        tracksViewChanges
                        zIndex={10}
                      >
                        <View style={styles.editorBoundaryTouchTarget}>
                          <View
                            style={[
                              styles.editorBoundaryPoint,
                              { borderColor: colors.white },
                              draggingBoundaryPointIndex === index && {
                                backgroundColor: colors.warning,
                              },
                            ]}
                          />
                        </View>
                      </MapMarker>
                    ))}
                  </MapView>
                )}
                <View
                  style={[
                    styles.editorZoomControls,
                    { top: insets.top + 76 },
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.editorZoomButton,
                      !canZoomIn && styles.editorZoomButtonDisabled,
                    ]}
                    onPress={() => {
                      void zoomMap('in');
                    }}
                    activeOpacity={0.75}
                    disabled={!canZoomIn}
                  >
                    <Typography
                      variant="title3"
                      color={colors.white}
                      weight="bold"
                      style={styles.editorZoomButtonText}
                    >
                      +
                    </Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editorZoomButton}
                    onPress={recenterMap}
                    activeOpacity={0.75}
                  >
                    <Icon name="home" size={18} color={colors.white} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.editorZoomButton,
                      !canZoomOut && styles.editorZoomButtonDisabled,
                    ]}
                    onPress={() => {
                      void zoomMap('out');
                    }}
                    activeOpacity={0.75}
                    disabled={!canZoomOut}
                  >
                    <Typography
                      variant="title3"
                      color={colors.white}
                      weight="bold"
                      style={styles.editorZoomButtonText}
                    >
                      -
                    </Typography>
                  </TouchableOpacity>
                </View>
                <MapCompassControl
                  headingDegrees={mapHeading}
                  onRotateLeft={() => rotateMap(-1)}
                  onRotateRight={() => rotateMap(1)}
                  onResetRotation={resetMapRotation}
                  style={[styles.editorCompassControl, { top: insets.top + 76 }]}
                />
              </View>

              <View
                style={[
                  styles.editorControls,
                  {
                    left: containerPadding,
                    right: containerPadding,
                    paddingBottom: insets.bottom + Spacing.lg,
                  },
                ]}
              >
                <ScreenFooterGlass />
                <View
                  style={[
                    styles.editorHelpPill,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                >
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    style={styles.editorHelp}
                  >
                    {isDrawing
                      ? 'Tap map or line to add dots. Drag dots to move them. Tap a dot to remove it.'
                      : 'Tap map or line to add dots. Drag dots to move them. Tap a dot to remove it.'}
                  </Typography>
                </View>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[
                      styles.editorFloatingAction,
                      {
                        backgroundColor: CTA_TEAL,
                        borderColor: CTA_TEAL,
                      },
                    ]}
                    onPress={startDrawing}
                    activeOpacity={0.75}
                  >
                    <Typography
                      variant="caption1"
                      color={colors.white}
                      weight="semibold"
                      style={styles.buttonLabel}
                    >
                      Draw
                    </Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.editorFloatingAction,
                      {
                        backgroundColor: CTA_TEAL,
                        borderColor: CTA_TEAL,
                        opacity: canUndoBoundaryPoint ? 1 : 0.45,
                      },
                    ]}
                    onPress={undoBoundaryPoint}
                    disabled={!canUndoBoundaryPoint}
                    activeOpacity={0.75}
                  >
                    <Typography
                      variant="caption1"
                      color={colors.white}
                      weight="semibold"
                      style={styles.buttonLabel}
                    >
                      Undo
                    </Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.editorFloatingAction,
                      {
                        backgroundColor: CTA_TEAL,
                        borderColor: CTA_TEAL,
                        opacity: canRedoBoundaryPoint ? 1 : 0.45,
                      },
                    ]}
                    onPress={redoBoundaryPoint}
                    disabled={!canRedoBoundaryPoint}
                    activeOpacity={0.75}
                  >
                    <Typography
                      variant="caption1"
                      color={colors.white}
                      weight="semibold"
                      style={styles.buttonLabel}
                    >
                      Redo
                    </Typography>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>
          </Modal>
        )}
        <Modal
          visible={isApprovalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsApprovalOpen(false)}
        >
          <View style={styles.pickerOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setIsApprovalOpen(false)}
            />
            <View
              style={[
                styles.approvalSheet,
                {
                  backgroundColor: colors.backgroundMain,
                  paddingBottom: insets.bottom + Spacing.lg,
                },
              ]}
            >
              <Typography variant="headline" color={colors.textPrimary}>
                Confirm garden plan size
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.headerCopy}
              >
                This size is extracted from the map boundary you drew. Confirm
                it before creating the editable vector plan.
              </Typography>

              <View style={styles.unitToggle}>
                {(['feet', 'meters'] as GardenPlanMeasurementUnit[]).map(unit => {
                  const isSelected = measurementUnit === unit;
                  return (
                    <TouchableOpacity
                      key={unit}
                      style={[
                        styles.unitOption,
                        {
                          borderColor: isSelected
                            ? colors.primary
                            : colors.borderColor,
                          backgroundColor: isSelected
                            ? colors.primaryLight
                            : colors.backgroundSecondary,
                        },
                      ]}
                      onPress={() => setMeasurementUnit(unit)}
                      activeOpacity={0.75}
                    >
                      <Typography
                        variant="caption1"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={isSelected ? colors.primary : colors.textPrimary}
                      >
                        {unit === 'feet' ? 'Feet' : 'Meters'}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {boundaryMeasurements && (
                <View
                  style={[
                    styles.measurementCard,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                >
                  <View>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      Boundary dimensions
                    </Typography>
                    <Typography variant="title3" color={colors.textPrimary}>
                      {boundaryMeasurements.displayDimensions}
                    </Typography>
                  </View>
                  <View>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      Approximate area
                    </Typography>
                    <Typography variant="title3" color={colors.textPrimary}>
                      {boundaryMeasurements.displayArea}
                    </Typography>
                  </View>
                </View>
              )}

              <GradientButton
                title={isGenerating ? 'Creating vector plan...' : 'Confirm and create plan'}
                onPress={generate}
                disabled={isGenerating || !boundaryMeasurements}
                fullWidth
              />
              <TouchableOpacity
                style={styles.approvalSecondaryAction}
                onPress={() => setIsApprovalOpen(false)}
                activeOpacity={0.75}
              >
                <Typography variant="body" color={colors.textSecondary}>
                  Keep editing
                </Typography>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </AppBackground>
  );
}

function BoundaryOverlay({
  points,
  width,
  height,
}: {
  points: Point[];
  width: number;
  height: number;
}) {
  const colors = useAppColors();
  const scaledPoints = useMemo(
    () => points.map(p => ({ x: p.x * width, y: p.y * height })),
    [height, points, width],
  );
  const segments = useMemo(() => {
    if (scaledPoints.length < 2) return [];
    const openSegments = scaledPoints.slice(0, -1).map((point, index) => ({
      start: point,
      end: scaledPoints[index + 1],
    }));

    if (scaledPoints.length >= 3) {
      openSegments.push({
        start: scaledPoints[scaledPoints.length - 1],
        end: scaledPoints[0],
      });
    }

    return openSegments;
  }, [scaledPoints]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {segments.map((segment, index) => (
        <BoundaryLine
          key={`${segment.start.x}-${segment.start.y}-${index}`}
          start={segment.start}
          end={segment.end}
        />
      ))}
      {scaledPoints.map((point, index) => (
        <View
          key={`${point.x}-${point.y}-${index}`}
          style={[
            styles.boundaryPoint,
            {
              left: point.x - 4,
              top: point.y - 4,
              borderColor: colors.white,
            },
          ]}
        />
      ))}
    </View>
  );
}

function BoundaryLine({ start, end }: { start: Point; end: Point }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const angle = `${Math.atan2(dy, dx)}rad`;

  return (
    <View
      style={[
        styles.boundaryLine,
        {
          left: start.x + dx / 2 - length / 2,
          top: start.y + dy / 2 - 1,
          width: length,
          transform: [{ rotateZ: angle }],
        },
      ]}
    />
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        {...props}
        style={[
          styles.input,
          props.multiline && styles.multiline,
          {
            borderColor: colors.borderColor,
            color: colors.textPrimary,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  );
}

function logBoundaryDebug(event: string, payload: Record<string, unknown>) {
  console.log(`[GardenPlanBoundary] ${event}`, payload);
}

function defaultMeasurementUnit(country?: string | null): GardenPlanMeasurementUnit {
  return country === 'US' ? 'feet' : 'meters';
}

function buildBoundaryMeasurementSummary(
  coordinates: LatLng[],
  unit: GardenPlanMeasurementUnit,
): BoundaryMeasurementSummary {
  const bbox = summarizeCoordinateBBox(coordinates);
  const centerLatitude = (bbox.minLat + bbox.maxLat) / 2;
  const centerLongitude = (bbox.minLon + bbox.maxLon) / 2;
  const widthMeters = distanceMeters(
    { latitude: centerLatitude, longitude: bbox.minLon },
    { latitude: centerLatitude, longitude: bbox.maxLon },
  );
  const depthMeters = distanceMeters(
    { latitude: bbox.minLat, longitude: centerLongitude },
    { latitude: bbox.maxLat, longitude: centerLongitude },
  );
  const areaSqMeters = areaSquareMeters(coordinates);
  const factor = unit === 'feet' ? METERS_TO_FEET : 1;
  const areaFactor = unit === 'feet' ? SQ_METERS_TO_SQ_FEET : 1;
  const width = Math.round(widthMeters * factor);
  const depth = Math.round(depthMeters * factor);
  const area = Math.round(areaSqMeters * areaFactor);
  const lengthUnit = unit === 'feet' ? 'ft' : 'm';
  const areaUnit = unit === 'feet' ? 'sq ft' : 'sq m';

  return {
    unit,
    width,
    depth,
    area,
    displayDimensions: `${formatMeasurementNumber(width)} ${lengthUnit} x ${formatMeasurementNumber(depth)} ${lengthUnit}`,
    displayArea: `${formatMeasurementNumber(area)} ${areaUnit}`,
  };
}

function formatMeasurementNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function distanceMeters(a: LatLng, b: LatLng): number {
  const earthRadiusMeters = 6371008.8;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function summarizePoints(points: Point[], bbox: BBox) {
  const coordinates = coordinatesFromPoints(points, bbox);
  return {
    count: points.length,
    bbox: summarizeBBox(bbox),
    approxAreaSqM: points.length >= 3 ? roundNumber(areaSquareMeters(coordinates), 2) : 0,
    normalizedPoints: points.map(summarizePoint),
    coordinates: coordinates.map(summarizeCoordinate),
  };
}

function summarizeGeometry(geometry: GeoJsonPolygonGeometry) {
  const rings = ringsFromGeometry(geometry);
  const coordinates = rings.flat();
  return {
    type: geometry.type,
    ringCount: rings.length,
    coordinateCount: coordinates.length,
    closed: rings.every(isClosedRing),
    bbox: coordinates.length > 0 ? summarizeCoordinateBBox(coordinates) : null,
    approxAreaSqM: roundNumber(
      rings.reduce((sum, ring) => sum + areaSquareMeters(ring), 0),
      2,
    ),
    firstRing: rings[0]?.map(summarizeCoordinate) ?? [],
  };
}

function summarizePoint(point: Point) {
  return {
    x: roundNumber(point.x, 4),
    y: roundNumber(point.y, 4),
  };
}

function summarizeCoordinate(coordinate: LatLng) {
  return {
    lat: roundNumber(coordinate.latitude, 6),
    lon: roundNumber(coordinate.longitude, 6),
  };
}

function summarizeRegion(region: Region) {
  return {
    lat: roundNumber(region.latitude, 6),
    lon: roundNumber(region.longitude, 6),
    latDelta: roundNumber(region.latitudeDelta, 7),
    lonDelta: roundNumber(region.longitudeDelta, 7),
  };
}

function summarizeCamera(camera: {
  altitude?: number;
  heading?: number;
  pitch?: number;
  center?: LatLng;
}) {
  return {
    altitude: typeof camera.altitude === 'number' ? roundNumber(camera.altitude, 2) : null,
    heading: typeof camera.heading === 'number' ? roundNumber(camera.heading, 2) : null,
    pitch: typeof camera.pitch === 'number' ? roundNumber(camera.pitch, 2) : null,
    center: camera.center ? summarizeCoordinate(camera.center) : null,
  };
}

function clampRegionDeltas(region: Region): Region {
  return {
    ...region,
    latitudeDelta: clamp(region.latitudeDelta, MAP_MIN_DELTA, MAP_MAX_DELTA),
    longitudeDelta: clamp(region.longitudeDelta, MAP_MIN_DELTA, MAP_MAX_DELTA),
  };
}

function applyZoomLock(
  region: Region,
  zoomLock: PendingZoomLock | null,
): Region {
  if (!zoomLock || Date.now() >= zoomLock.until) return region;
  return {
    ...region,
    latitudeDelta: zoomLock.latitudeDelta,
    longitudeDelta: zoomLock.longitudeDelta,
  };
}

function regionsAreClose(a: Region, b: Region) {
  const coordinateTolerance = 0.000001;
  const deltaTolerance = 0.000005;
  return (
    Math.abs(a.latitude - b.latitude) <= coordinateTolerance &&
    Math.abs(a.longitude - b.longitude) <= coordinateTolerance &&
    Math.abs(a.latitudeDelta - b.latitudeDelta) <= deltaTolerance &&
    Math.abs(a.longitudeDelta - b.longitudeDelta) <= deltaTolerance
  );
}

function summarizeBBox(bbox: BBox) {
  return {
    minLon: roundNumber(bbox.minLon, 6),
    minLat: roundNumber(bbox.minLat, 6),
    maxLon: roundNumber(bbox.maxLon, 6),
    maxLat: roundNumber(bbox.maxLat, 6),
  };
}

function summarizeCoordinateBBox(coordinates: LatLng[]) {
  const lats = coordinates.map(coord => coord.latitude);
  const lons = coordinates.map(coord => coord.longitude);
  return {
    minLon: roundNumber(Math.min(...lons), 6),
    minLat: roundNumber(Math.min(...lats), 6),
    maxLon: roundNumber(Math.max(...lons), 6),
    maxLat: roundNumber(Math.max(...lats), 6),
  };
}

function ringsFromGeometry(geometry: GeoJsonPolygonGeometry): LatLng[][] {
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as unknown[];
    return rings.map(ringFromUnknown).filter(ring => ring.length > 0);
  }

  const polygons = geometry.coordinates as unknown[];
  return polygons.flatMap(polygon =>
    Array.isArray(polygon)
      ? polygon.map(ringFromUnknown).filter(ring => ring.length > 0)
      : [],
  );
}

function ringFromUnknown(value: unknown): LatLng[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(coord => {
      if (!Array.isArray(coord)) return null;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon };
    })
    .filter((coord): coord is LatLng => coord !== null);
}

function isClosedRing(ring: LatLng[]) {
  if (ring.length < 2) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.latitude === last.latitude && first.longitude === last.longitude;
}

function areaSquareMeters(coordinates: LatLng[]): number {
  if (coordinates.length < 3) return 0;
  const averageLatitude =
    coordinates.reduce((sum, coord) => sum + coord.latitude, 0) / coordinates.length;
  const metersPerDegree = 111320;
  const xScale = metersPerDegree * Math.cos((averageLatitude * Math.PI) / 180);
  const projected = coordinates.map(coord => ({
    x: coord.longitude * xScale,
    y: coord.latitude * metersPerDegree,
  }));
  const area = projected.reduce((sum, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(area) / 2;
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pointsFromGeometry(
  geometry: GeoJsonPolygonGeometry,
  bbox: BBox,
): Point[] {
  const ring =
    geometry.type === 'Polygon'
      ? (geometry.coordinates as unknown[][])[0]
      : (((geometry.coordinates as unknown[][][])[0] ?? [])[0] as unknown[]);
  if (!Array.isArray(ring)) return [];
  return ring
    .slice(0, -1)
    .map(coord => {
      const c = coord as [number, number];
      return {
        x: clamp(
          (Number(c[0]) - bbox.minLon) / (bbox.maxLon - bbox.minLon || 1),
          0,
          1,
        ),
        y: clamp(
          1 - (Number(c[1]) - bbox.minLat) / (bbox.maxLat - bbox.minLat || 1),
          0,
          1,
        ),
      };
    })
    .slice(0, 12);
}

function geometryFromPoints(
  points: Point[],
  bbox: BBox,
): GeoJsonPolygonGeometry {
  const ring = coordinatesFromPoints(points, bbox).map(coord => [
    coord.longitude,
    coord.latitude,
  ]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function coordinatesFromPoints(points: Point[], bbox: BBox): LatLng[] {
  return points.map(p => ({
    latitude: bbox.minLat + (1 - p.y) * (bbox.maxLat - bbox.minLat),
    longitude: bbox.minLon + p.x * (bbox.maxLon - bbox.minLon),
  }));
}

function pointFromCoordinate(coordinate: LatLng, bbox: BBox): Point {
  return {
    x: clamp(
      (coordinate.longitude - bbox.minLon) / (bbox.maxLon - bbox.minLon || 1),
      0,
      1,
    ),
    y: clamp(
      1 - (coordinate.latitude - bbox.minLat) / (bbox.maxLat - bbox.minLat || 1),
      0,
      1,
    ),
  };
}

function appendBoundaryPoint(
  points: Point[],
  point: Point,
  maxPoints: number,
): BoundaryPointInsertResult {
  if (points.length >= maxPoints) {
    return { points, insertedIndex: null };
  }
  return { points: [...points, point], insertedIndex: points.length };
}

function insertPointNearBoundary(
  points: Point[],
  point: Point,
  maxPoints: number,
): BoundaryPointInsertResult {
  if (points.length >= maxPoints) {
    return { points, insertedIndex: null };
  }
  if (points.length < 2) {
    return { points: [...points, point], insertedIndex: points.length };
  }

  const segmentCount = points.length >= 3 ? points.length : points.length - 1;
  let nearestSegmentIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const distance = distanceToSegmentSquared(point, start, end);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestSegmentIndex = index;
    }
  }

  const insertIndex = nearestSegmentIndex + 1;
  return {
    points: [
      ...points.slice(0, insertIndex),
      point,
      ...points.slice(insertIndex),
    ],
    insertedIndex: insertIndex,
  };
}

function distanceToSegmentSquared(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return squaredDistance(point, start);
  }

  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  return squaredDistance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy,
  });
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function regionFromBBox(bbox: BBox): Region {
  const latitudeDelta = clamp(
    (bbox.maxLat - bbox.minLat) * MAP_INITIAL_PADDING,
    0.00025,
    MAP_MAX_DELTA,
  );
  const longitudeDelta = clamp(
    (bbox.maxLon - bbox.minLon) * MAP_INITIAL_PADDING,
    0.00025,
    MAP_MAX_DELTA,
  );

  return {
    latitude: (bbox.minLat + bbox.maxLat) / 2,
    longitude: (bbox.minLon + bbox.maxLon) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

function regionFromCoordinateBBox(
  bbox: Pick<BBox, 'minLon' | 'minLat' | 'maxLon' | 'maxLat'>,
): Region {
  const latitudeDelta = clamp(
    (bbox.maxLat - bbox.minLat) * MAP_INITIAL_PADDING,
    0.00025,
    MAP_MAX_DELTA,
  );
  const longitudeDelta = clamp(
    (bbox.maxLon - bbox.minLon) * MAP_INITIAL_PADDING,
    0.00025,
    MAP_MAX_DELTA,
  );

  return {
    latitude: (bbox.minLat + bbox.maxLat) / 2,
    longitude: (bbox.minLon + bbox.maxLon) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

function geometryBBox(geometry: GeoJsonPolygonGeometry): BBox {
  const coords: Array<[number, number]> = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      coords.push([value[0], value[1]]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return {
    minLon: Math.min(...lons),
    minLat: Math.min(...lats),
    maxLon: Math.max(...lons),
    maxLat: Math.max(...lats),
  };
}

function rectangleAroundGeocode(
  draft: GardenPlanBoundaryDraft,
): GeoJsonPolygonGeometry {
  const lon = draft.geocode?.lon ?? -122;
  const lat = draft.geocode?.lat ?? 37;
  const dLon = 0.00045;
  const dLat = 0.00036;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Layout.headerBottom,
    gap: Spacing.md,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: CornerRadius.xl,
    gap: Spacing.md,
  },
  headerCopy: {
    lineHeight: 20,
  },
  suggestionCopy: {
    lineHeight: 18,
  },
  mapWrap: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: CornerRadius.lg,
  },
  mapEditHint: {
    position: 'absolute',
    left: Spacing.sm,
    right: Spacing.sm,
    bottom: Spacing.sm,
    alignItems: 'center',
    borderRadius: CornerRadius.full,
    paddingVertical: Spacing.xs,
    backgroundColor: 'rgba(17,24,39,0.72)',
  },
  mapImage: {
    width: '100%',
    height: '100%',
  },
  mapFallback: {},
  inlineMeasurement: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  boundaryActionButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  boundaryActionButtonPrimary: {
    borderWidth: 1.5,
  },
  buttonLabel: {
    textAlign: 'center',
  },
  secondaryAction: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  approvalSecondaryAction: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  approvalSheet: {
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  unitToggle: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  unitOption: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  measurementCard: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  editorScreen: {
    flex: 1,
  },
  editorHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: Header.overlayZIndex,
  },
  editorHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  editorBody: {
    ...StyleSheet.absoluteFill,
  },
  editorMap: {
    width: '100%',
    height: '100%',
  },
  editorZoomControls: {
    position: 'absolute',
    right: Spacing.md,
    zIndex: 5,
    gap: Spacing.sm,
  },
  editorZoomButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: CTA_TEAL,
    borderWidth: 1,
    borderColor: CTA_TEAL,
  },
  editorZoomButtonDisabled: {
    backgroundColor: 'rgba(120,120,120,0.6)',
    borderColor: 'rgba(120,120,120,0.65)',
    opacity: 0.55,
  },
  editorZoomButtonText: {
    lineHeight: 24,
    textAlign: 'center',
  },
  editorCompassControl: {
    position: 'absolute',
    left: Spacing.md,
    zIndex: 5,
  },
  editorControls: {
    position: 'absolute',
    bottom: 0,
    zIndex: 4,
    // Tall enough that the glass fade begins well above the controls, so its
    // top edge reads as transparent rather than a hard line over the map.
    paddingTop: 32,
    gap: Spacing.sm,
    overflow: 'hidden',
  },
  editorHelpPill: {
    borderWidth: 1,
    borderRadius: CornerRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  editorHelp: {
    textAlign: 'center',
    lineHeight: 18,
  },
  editorFloatingAction: {
    flex: 1,
    minHeight: ButtonMetrics.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  boundaryLine: {
    position: 'absolute',
    height: 2,
    borderRadius: 2,
    backgroundColor: BOUNDARY_COLOR,
  },
  boundaryPoint: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    backgroundColor: BOUNDARY_COLOR,
  },
  editorBoundaryTouchTarget: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorBoundaryPoint: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 4,
    backgroundColor: BOUNDARY_COLOR,
  },
  segmentWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  segment: {
    borderWidth: 1,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  field: {
    gap: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...scaledFont('body'),
  },
  multiline: {
    minHeight: 82,
    textAlignVertical: 'top',
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17,24,39,0.42)',
  },
});
