import { Ionicons } from '@expo/vector-icons';
import type { GardenPlanObject } from '@models/garden-objects';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import MapView, {
  Marker as MapMarker,
  Polygon as MapPolygon,
  Polyline as MapPolyline,
  type Camera,
  type LatLng,
  type Region,
} from 'react-native-maps';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import type { FloorPlanMarker } from '@api/floor-plans';
import { MapOverlayControls } from '@components/common/house';
import { FloorPlanViewer, type PendingMarker } from '@components/floor-plans';
import { MarkerPin } from '@components/floor-plans/MarkerPin';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useTheme } from '@contexts/ThemeContext';
import {
  closedRing,
  isSelectedEdgeEndpoint,
  type UseBoundaryEditorResult,
} from '@hooks/garden/useBoundaryEditor';
import { useAppColors } from '@theme';
import { palette } from '@theme/colors';

import {
  getGardenObjectDisplayLabel,
  renderGardenObjectBody,
} from './GardenObjectRenderer';

type GardenPlanViewMode = 'satellite' | 'plan';

export type GardenPlanEditMode = 'none' | 'boundary' | 'objects';

export interface GardenPlanUnifiedViewerHandle {
  /**
   * Returns the current satellite map camera (if the coordinate map is
   * mounted and ready). Used to hand off the user's framing to the object
   * editor screen so it opens at the same zoom/heading.
   */
  getCamera: () => Promise<Camera | null>;
}

interface GardenPlanUnifiedViewerProps {
  mode: GardenPlanViewMode;
  /**
   * Null for a MAP-DRAWN plan, which has no bytes at all — the satellite tiles
   * behind `boundaryGeoJson` are its picture. Every read of this below already
   * guards on it (the render falls through to the coordinate map first), so
   * widening the type documents what was already true rather than loosening it.
   */
  imageUrl: string | null;
  imageWidth?: number;
  imageHeight?: number;
  markers: FloorPlanMarker[];
  gardenObjects: GardenPlanObject[];
  boundaryGeoJson: string | null;
  showBackgroundImage: boolean;
  pendingMarker: PendingMarker | null;
  taskCategories: Record<string, string | null>;
  onMarkerPress: (marker: FloorPlanMarker) => void;
  onPlanPress: (x: number, y: number, xPercent: number, yPercent: number) => void;
  onBoundaryLongPress: (xPercent: number, yPercent: number) => void;
  controlsTopInset: number;
  bottomInset: number;
  mapOpacity: number;
  polygonOpacity: number;
  showSatelliteSettings: boolean;
  onMapOpacityChange: (value: number) => void;
  onPolygonOpacityChange: (value: number) => void;
  onToggleSatelliteSettings: () => void;
  editMode?: GardenPlanEditMode;
  boundaryEditor?: UseBoundaryEditorResult | null;
}

const MAIN_ACTION_COLOR = palette.button.teal;
const BOUNDARY_STROKE = '#3F8F54';
const BOUNDARY_FILL_RGB = '63, 143, 84';
// Must match `CANVAS_SIZE` in `GardenPlanVectorEditor` so saved object
// positions render identically across viewer and editor.
const VIEWER_OBJECTS_CANVAS_SIZE = 1000;
const BOUNDARY_EDIT_SELECTED_EDGE = '#F97316';
const BOUNDARY_VERTEX_FILL = '#0EA5E9';
const GARDEN_VIEW_INITIAL_ZOOM = 1.0;
const SATELLITE_REGION_PADDING = 1 / GARDEN_VIEW_INITIAL_ZOOM;
const SATELLITE_MIN_DELTA = 0.00018;
const SATELLITE_MAX_ZOOM_LEVEL = 22;
const SATELLITE_MIN_CAMERA_ALTITUDE = Platform.OS === 'ios' ? 60 : 25;
const SATELLITE_IOS_STABLE_ALTITUDE_FLOOR = 320;
const SATELLITE_MAX_CAMERA_ALTITUDE = 8000;
// MKMapView applies a legacy zoom clamp on every region change that snaps the
// camera back toward `maxZoomLevel` (~318m altitude), preventing zoom-in after
// any zoom-out. Providing a `cameraZoomRange` disables that clamp on iOS and
// uses the native MKMapCameraZoomRange instead, so we can reach altitudes
// around the configured `minCenterCoordinateDistance`.
const IOS_SATELLITE_CAMERA_ZOOM_RANGE = Platform.OS === 'ios'
  ? {
      minCenterCoordinateDistance: 60,
      maxCenterCoordinateDistance: 8000,
      animated: false,
    }
  : undefined;
const MAP_CONTROL_BUTTON_SIZE = 40;
const SLIDER_THUMB_SIZE = 20;

type DebugCameraSnapshot = {
  altitude?: number;
  heading?: number;
  pitch?: number;
  center?: LatLng;
};

function roundDebugNumber(value: number | undefined | null, precision = 6): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function debugRegion(region: Region | null | undefined) {
  if (!region) return null;
  return {
    latitude: roundDebugNumber(region.latitude),
    longitude: roundDebugNumber(region.longitude),
    latitudeDelta: roundDebugNumber(region.latitudeDelta, 8),
    longitudeDelta: roundDebugNumber(region.longitudeDelta, 8),
  };
}

function debugCamera(camera: DebugCameraSnapshot | null | undefined) {
  if (!camera) return null;
  return {
    altitude: roundDebugNumber(camera.altitude, 2),
    heading: roundDebugNumber(camera.heading, 2),
    pitch: roundDebugNumber(camera.pitch, 2),
    center: camera.center
      ? {
          latitude: roundDebugNumber(camera.center.latitude),
          longitude: roundDebugNumber(camera.center.longitude),
        }
      : null,
  };
}

function logGardenMapCameraDebug(event: string, payload: Record<string, unknown> = {}) {
  if (!__DEV__) return;
  console.log(`[GardenMapCamera] ${event}`, payload);
}

function headingDistanceFromNorth(heading: number | null | undefined): number {
  if (typeof heading !== 'number' || !Number.isFinite(heading)) return 0;
  const normalized = ((heading % 360) + 360) % 360;
  return Math.min(normalized, 360 - normalized);
}

export function canRenderGardenSatellite(boundaryGeoJson: string | null | undefined): boolean {
  return regionFromBoundaryGeoJson(boundaryGeoJson) !== null;
}

export const GardenPlanUnifiedViewer = forwardRef<
  GardenPlanUnifiedViewerHandle,
  GardenPlanUnifiedViewerProps
>(function GardenPlanUnifiedViewer(
  {
    mode,
    imageUrl,
    imageWidth,
    imageHeight,
    markers,
    gardenObjects,
    boundaryGeoJson,
    showBackgroundImage,
    pendingMarker,
    taskCategories,
    onMarkerPress,
    onPlanPress,
    onBoundaryLongPress,
    controlsTopInset,
    bottomInset,
    mapOpacity,
    polygonOpacity,
    showSatelliteSettings,
    onMapOpacityChange,
    onPolygonOpacityChange,
    onToggleSatelliteSettings,
    editMode = 'none',
    boundaryEditor = null,
  },
  ref,
) {
  const { isDark } = useTheme();
  // `backgroundMain` lives on AppColors, not ThemeColors — the two palettes
  // are different shapes, and the body below reads the AppColors one.
  const colors = useAppColors();
  const satelliteMapRef = useRef<MapView | null>(null);
  const satelliteRegionRef = useRef<Region | null>(null);
  const isSatellitePanGesture = useRef(false);
  const panStartCameraAltitude = useRef<number | null>(null);
  const [readyMapKey, setReadyMapKey] = useState<string | null>(null);
  const [mapHeading, setMapHeading] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      getCamera: async () => {
        const map = satelliteMapRef.current;
        if (!map) return null;
        try {
          return await map.getCamera();
        } catch {
          return null;
        }
      },
    }),
    [],
  );
  const [mapCameraAltitude, setMapCameraAltitude] = useState<number | null>(null);
  const [satelliteVisibleRegion, setSatelliteVisibleRegion] = useState<Region | null>(null);
  const [lowestReachableAltitude, setLowestReachableAltitude] = useState<number | null>(null);
  const [minDiscoveredAltitude, setMinDiscoveredAltitude] = useState<number | null>(null);
  const [maxDiscoveredAltitude, setMaxDiscoveredAltitude] = useState<number | null>(null);
  const settingsButtonRotation = useRef(new Animated.Value(0)).current;

  const satelliteCoordinates = useMemo(
    () => parseBoundaryCoordinates(boundaryGeoJson),
    [boundaryGeoJson],
  );
  const satelliteRegion = useMemo(
    () => regionFromCoordinates(satelliteCoordinates),
    [satelliteCoordinates],
  );
  const boundaryBounds = useMemo(
    () => boundsFromCoordinates(satelliteCoordinates),
    [satelliteCoordinates],
  );
  const usesCoordinateMap = satelliteRegion !== null;
  const isSatelliteMode = mode === 'satellite' && usesCoordinateMap;
  const isIosSatelliteMode = Platform.OS === 'ios' && isSatelliteMode;
  const coordinateMapKey = boundaryGeoJson ?? 'empty';
  const isCoordinateMapReady = readyMapKey === coordinateMapKey;
  const isEditingBoundary = editMode === 'boundary' && boundaryEditor != null;
  const editableCorners = isEditingBoundary ? boundaryEditor.corners : null;
  const editablePolygonCoords = useMemo(
    () => (editableCorners ? closedRing(editableCorners) : null),
    [editableCorners],
  );

  useEffect(() => {
    if (!usesCoordinateMap || isCoordinateMapReady) return;
    const timeout = setTimeout(() => {
      setReadyMapKey(coordinateMapKey);
    }, 900);
    return () => clearTimeout(timeout);
  }, [coordinateMapKey, isCoordinateMapReady, usesCoordinateMap]);

  useEffect(() => {
    setMapCameraAltitude(null);
    setSatelliteVisibleRegion(null);
    setLowestReachableAltitude(null);
    setMinDiscoveredAltitude(null);
    setMaxDiscoveredAltitude(null);
    logGardenMapCameraDebug('coordinate_map_key_changed', {
      coordinateMapKey,
      mode,
      region: debugRegion(satelliteRegion),
    });
  }, [coordinateMapKey, satelliteRegion]);

  const syncSatelliteCameraAltitude = useCallback(async () => {
    const map = satelliteMapRef.current;
    if (!map) {
      logGardenMapCameraDebug('sync_altitude_skipped_no_map');
      return null;
    }

    try {
      const camera = await map.getCamera();
      logGardenMapCameraDebug('sync_altitude_camera_read', {
        camera: debugCamera(camera),
        previousAltitude: roundDebugNumber(mapCameraAltitude, 2),
        lowestReachableAltitude: roundDebugNumber(lowestReachableAltitude, 2),
        minDiscoveredAltitude: roundDebugNumber(minDiscoveredAltitude, 2),
        maxDiscoveredAltitude: roundDebugNumber(maxDiscoveredAltitude, 2),
      });
      if (typeof camera.altitude === 'number') {
        const altitude = camera.altitude;
        setMapCameraAltitude(prev =>
          prev != null && Math.abs(prev - altitude) < 0.5 ? prev : altitude,
        );
        if (typeof camera.heading === 'number') {
          setMapHeading(prev =>
            Math.abs(prev - camera.heading) < 0.5 ? prev : camera.heading,
          );
        }
        setLowestReachableAltitude(prev =>
          prev == null || altitude < prev ? altitude : prev,
        );
        setMinDiscoveredAltitude(prev =>
          prev != null && altitude < prev * 0.98 ? (logGardenMapCameraDebug('min_floor_cleared', {
            previousMin: roundDebugNumber(prev, 2),
            altitude: roundDebugNumber(altitude, 2),
          }), null) : prev,
        );
        setMaxDiscoveredAltitude(prev =>
          prev != null && altitude > prev * 1.02 ? (logGardenMapCameraDebug('max_ceiling_cleared', {
            previousMax: roundDebugNumber(prev, 2),
            altitude: roundDebugNumber(altitude, 2),
          }), null) : prev,
        );
        return altitude;
      }
      logGardenMapCameraDebug('sync_altitude_missing_altitude', {
        camera: debugCamera(camera),
      });
    } catch (error) {
      logGardenMapCameraDebug('sync_altitude_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      // Camera altitude is best-effort; the region fallback still handles zoom.
    }

    return null;
  }, [
    lowestReachableAltitude,
    mapCameraAltitude,
    maxDiscoveredAltitude,
    minDiscoveredAltitude,
  ]);

  const minCameraAltitudeLimit = useMemo(
    () =>
      Math.min(
        SATELLITE_MIN_CAMERA_ALTITUDE,
        lowestReachableAltitude ?? SATELLITE_MIN_CAMERA_ALTITUDE,
      ),
    [lowestReachableAltitude],
  );

  const canZoomIn = useMemo(() => {
    if (Platform.OS === 'ios') {
      const region = satelliteVisibleRegion ?? satelliteRegion;
      if (!region) return true;
      return (
        region.latitudeDelta > SATELLITE_MIN_DELTA * 1.02 ||
        region.longitudeDelta > SATELLITE_MIN_DELTA * 1.02
      );
    }

    if (mapCameraAltitude == null) return true;
    const minLimit = Math.max(
      minCameraAltitudeLimit,
      minDiscoveredAltitude ?? 0,
    );
    if (
      isIosSatelliteMode &&
      mapCameraAltitude <= minLimit * 1.02 &&
      headingDistanceFromNorth(mapHeading) > 1
    ) {
      // Keep "+" available so users can reset heading first.
      return true;
    }
    return mapCameraAltitude > minLimit * 1.02;
  }, [
    isIosSatelliteMode,
    mapHeading,
    mapCameraAltitude,
    minCameraAltitudeLimit,
    minDiscoveredAltitude,
    mode,
    satelliteRegion,
    satelliteVisibleRegion,
  ]);

  const canZoomOut = useMemo(() => {
    if (mapCameraAltitude == null) return true;
    const maxLimit = Math.min(
      SATELLITE_MAX_CAMERA_ALTITUDE,
      maxDiscoveredAltitude ?? SATELLITE_MAX_CAMERA_ALTITUDE,
    );
    return mapCameraAltitude < maxLimit * 0.98;
  }, [mapCameraAltitude, maxDiscoveredAltitude]);
  const canRotateMap = useMemo(() => {
    if (!isIosSatelliteMode) return true;
    if (mapCameraAltitude == null) return true;
    return mapCameraAltitude >= SATELLITE_IOS_STABLE_ALTITUDE_FLOOR * 0.98;
  }, [isIosSatelliteMode, mapCameraAltitude]);

  const zoomSatelliteMap = useCallback(async (direction: 'in' | 'out') => {
    const region = satelliteRegionRef.current ?? satelliteRegion;
    if (!region) {
      logGardenMapCameraDebug('zoom_skipped_no_region', { direction });
      return;
    }

    const map = satelliteMapRef.current;
    if (!map) {
      logGardenMapCameraDebug('zoom_skipped_no_map', { direction });
      return;
    }

    try {
      const camera = await map.getCamera();
      const prevAltitude = camera.altitude;
      logGardenMapCameraDebug('zoom_pressed_before', {
        direction,
        camera: debugCamera(camera),
        region: debugRegion(region),
        stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
        lowestReachableAltitude: roundDebugNumber(lowestReachableAltitude, 2),
        minDiscoveredAltitude: roundDebugNumber(minDiscoveredAltitude, 2),
        maxDiscoveredAltitude: roundDebugNumber(maxDiscoveredAltitude, 2),
        canZoomIn,
        canZoomOut,
      });

      if (Platform.OS === 'ios') {
        const factor = direction === 'in' ? 0.55 : 1.8;
        const nextRegion = {
          ...region,
          latitudeDelta: Math.max(SATELLITE_MIN_DELTA, region.latitudeDelta * factor),
          longitudeDelta: Math.max(SATELLITE_MIN_DELTA, region.longitudeDelta * factor),
        };
        logGardenMapCameraDebug('zoom_region_animation_ios', {
          direction,
          mode,
          currentRegion: debugRegion(region),
          nextRegion: debugRegion(nextRegion),
          camera: debugCamera(camera),
          stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
          stateHeading: roundDebugNumber(mapHeading, 2),
        });
        if (
          Math.abs(nextRegion.latitudeDelta - region.latitudeDelta) < 0.00000001 &&
          Math.abs(nextRegion.longitudeDelta - region.longitudeDelta) < 0.00000001
        ) {
          logGardenMapCameraDebug('zoom_region_animation_ios_noop_at_min_delta', {
            direction,
            mode,
            currentRegion: debugRegion(region),
            minDelta: SATELLITE_MIN_DELTA,
          });
        }
        satelliteRegionRef.current = nextRegion;
        setSatelliteVisibleRegion(nextRegion);
        map.animateToRegion(nextRegion, 180);

        setTimeout(async () => {
          try {
            const after = await map.getCamera();
            logGardenMapCameraDebug('zoom_after_region_animation_camera_read', {
              direction,
              mode,
              beforeCamera: debugCamera(camera),
              afterCamera: debugCamera(after),
              regionRefAfter: debugRegion(satelliteRegionRef.current),
            });
            const actualAltitude = after.altitude;
            if (typeof actualAltitude === 'number') {
              setMapCameraAltitude(actualAltitude);
              setLowestReachableAltitude(prev =>
                prev == null || actualAltitude < prev ? actualAltitude : prev,
              );
            }
          } catch (error) {
            logGardenMapCameraDebug('zoom_after_region_animation_camera_failed', {
              direction,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }, 280);
        return;
      }

      if (typeof prevAltitude !== 'number') {
        const factor = direction === 'in' ? 0.55 : 1.8;
        const nextRegion = {
          ...region,
          latitudeDelta: Math.max(SATELLITE_MIN_DELTA, region.latitudeDelta * factor),
          longitudeDelta: Math.max(SATELLITE_MIN_DELTA, region.longitudeDelta * factor),
        };
        logGardenMapCameraDebug('zoom_fallback_region_animation', {
          direction,
          currentRegion: debugRegion(region),
          nextRegion: debugRegion(nextRegion),
        });
        map.animateToRegion(
          nextRegion,
          180,
        );
        return;
      }

      const minDiscovered = minDiscoveredAltitude;
      const maxDiscovered = maxDiscoveredAltitude;
      const minLimit = Math.max(minCameraAltitudeLimit, minDiscovered ?? 0);
      const maxLimit = Math.min(
        SATELLITE_MAX_CAMERA_ALTITUDE,
        maxDiscovered ?? SATELLITE_MAX_CAMERA_ALTITUDE,
      );

      if (direction === 'in' && prevAltitude <= minLimit * 1.02) {
        if (isIosSatelliteMode && headingDistanceFromNorth(mapHeading) > 1) {
          logGardenMapCameraDebug('zoom_in_requires_heading_reset', {
            prevAltitude: roundDebugNumber(prevAltitude, 2),
            minLimit: roundDebugNumber(minLimit, 2),
            heading: roundDebugNumber(mapHeading, 2),
          });
          setMapHeading(0);
          map.animateCamera(
            {
              ...camera,
              heading: 0,
              pitch: 0,
              center: {
                latitude: region.latitude,
                longitude: region.longitude,
              },
            },
            { duration: 180 },
          );
          setTimeout(() => {
            void syncSatelliteCameraAltitude();
          }, 220);
          return;
        }
        setMapCameraAltitude(prevAltitude);
        logGardenMapCameraDebug('zoom_in_blocked_by_min_limit', {
          prevAltitude: roundDebugNumber(prevAltitude, 2),
          minLimit: roundDebugNumber(minLimit, 2),
          minDiscoveredAltitude: roundDebugNumber(minDiscoveredAltitude, 2),
        });
        return;
      }
      if (direction === 'out' && prevAltitude >= maxLimit * 0.98) {
        setMapCameraAltitude(prevAltitude);
        logGardenMapCameraDebug('zoom_out_blocked_by_max_limit', {
          prevAltitude: roundDebugNumber(prevAltitude, 2),
          maxLimit: roundDebugNumber(maxLimit, 2),
          maxDiscoveredAltitude: roundDebugNumber(maxDiscoveredAltitude, 2),
        });
        return;
      }

      const requestedAltitude =
        direction === 'in' ? prevAltitude * 0.5 : prevAltitude * 1.8;
      const nextAltitude = Math.max(minLimit, Math.min(maxLimit, requestedAltitude));

      logGardenMapCameraDebug('zoom_animate_camera_request', {
        direction,
        previousAltitude: roundDebugNumber(prevAltitude, 2),
        requestedAltitude: roundDebugNumber(requestedAltitude, 2),
        nextAltitude: roundDebugNumber(nextAltitude, 2),
        minLimit: roundDebugNumber(minLimit, 2),
        maxLimit: roundDebugNumber(maxLimit, 2),
        center: debugRegion(region),
      });

      map.animateCamera(
        {
          ...camera,
          altitude: nextAltitude,
          center: {
            latitude: region.latitude,
            longitude: region.longitude,
          },
        },
        { duration: 180 },
      );

      setTimeout(async () => {
        try {
          const after = await map.getCamera();
          const actualAltitude = after.altitude;
          logGardenMapCameraDebug('zoom_after_animation_camera_read', {
            direction,
            beforeCamera: debugCamera(camera),
            afterCamera: debugCamera(after),
          });
          if (typeof actualAltitude !== 'number') return;
          setLowestReachableAltitude(prev =>
            prev == null || actualAltitude < prev ? actualAltitude : prev,
          );

          if (direction === 'in') {
            if (actualAltitude >= prevAltitude * 0.92) {
              const observedFloor = Math.max(prevAltitude, actualAltitude);
              logGardenMapCameraDebug('zoom_in_floor_discovered', {
                previousAltitude: roundDebugNumber(prevAltitude, 2),
                actualAltitude: roundDebugNumber(actualAltitude, 2),
                observedFloor: roundDebugNumber(observedFloor, 2),
              });
              setMinDiscoveredAltitude(prev =>
                prev == null ? observedFloor : Math.max(prev, observedFloor),
              );
            }
            setMapCameraAltitude(actualAltitude);
            return;
          }

          if (actualAltitude <= prevAltitude * 1.08) {
            const observedCeiling = Math.min(prevAltitude, actualAltitude);
            logGardenMapCameraDebug('zoom_out_ceiling_discovered', {
              previousAltitude: roundDebugNumber(prevAltitude, 2),
              actualAltitude: roundDebugNumber(actualAltitude, 2),
              observedCeiling: roundDebugNumber(observedCeiling, 2),
            });
            setMaxDiscoveredAltitude(prev =>
              prev == null ? observedCeiling : Math.min(prev, observedCeiling),
            );
          }
          setMapCameraAltitude(actualAltitude);
        } catch (error) {
          logGardenMapCameraDebug('zoom_after_animation_camera_failed', {
            direction,
            message: error instanceof Error ? error.message : String(error),
          });
          // Ignore; the next region change or button press will resync.
        }
      }, 280);
    } catch (error) {
      const factor = direction === 'in' ? 0.55 : 1.8;
      const nextRegion = {
        ...region,
        latitudeDelta: Math.max(SATELLITE_MIN_DELTA, region.latitudeDelta * factor),
        longitudeDelta: Math.max(SATELLITE_MIN_DELTA, region.longitudeDelta * factor),
      };
      logGardenMapCameraDebug('zoom_get_camera_failed_using_region_fallback', {
        direction,
        message: error instanceof Error ? error.message : String(error),
        currentRegion: debugRegion(region),
        nextRegion: debugRegion(nextRegion),
      });
      map.animateToRegion(
        nextRegion,
        180,
      );
    }
  }, [
    canZoomIn,
    canZoomOut,
    isIosSatelliteMode,
    lowestReachableAltitude,
    mapCameraAltitude,
    mapHeading,
    maxDiscoveredAltitude,
    minCameraAltitudeLimit,
    mode,
    minDiscoveredAltitude,
    satelliteRegion,
    satelliteVisibleRegion,
    syncSatelliteCameraAltitude,
  ]);

  const resetSatelliteMap = useCallback(() => {
    if (!satelliteRegion) return;
    satelliteRegionRef.current = satelliteRegion;
    setSatelliteVisibleRegion(satelliteRegion);
    setMapHeading(0);
    logGardenMapCameraDebug('reset_view_pressed', {
      targetRegion: debugRegion(satelliteRegion),
      currentRegion: debugRegion(satelliteRegionRef.current),
      stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
    });
    satelliteMapRef.current?.animateCamera(
      { center: satelliteRegion, heading: 0, pitch: 0 },
      { duration: 180 },
    );
    setTimeout(() => {
      void syncSatelliteCameraAltitude();
    }, 220);
  }, [mapCameraAltitude, satelliteRegion, syncSatelliteCameraAltitude]);

  const rotateMap = useCallback(async (direction: -1 | 1) => {
    const nextHeading = (mapHeading + direction * 18 + 360) % 360;
    const map = satelliteMapRef.current;
    const regionBeforeRotation =
      satelliteRegionRef.current ?? satelliteVisibleRegion ?? satelliteRegion;
    logGardenMapCameraDebug('rotate_pressed', {
      direction,
      previousHeading: roundDebugNumber(mapHeading, 2),
      nextHeading: roundDebugNumber(nextHeading, 2),
      regionRef: debugRegion(regionBeforeRotation),
      stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
    });
    setMapHeading(nextHeading);
    if (!map) {
      logGardenMapCameraDebug('rotate_skipped_no_map', { direction, nextHeading });
      return;
    }

    try {
      const camera = await map.getCamera();
      logGardenMapCameraDebug('rotate_before_camera', {
        direction,
        nextHeading,
        camera: debugCamera(camera),
      });
      map.animateCamera(
        Platform.OS === 'ios'
          ? {
              heading: nextHeading,
              pitch: 0,
              altitude:
                typeof camera.altitude === 'number'
                  ? Math.max(camera.altitude, SATELLITE_IOS_STABLE_ALTITUDE_FLOOR)
                  : SATELLITE_IOS_STABLE_ALTITUDE_FLOOR,
              center: camera.center,
            }
          : { ...camera, heading: nextHeading, pitch: 0 },
        { duration: 180 },
      );
      if (typeof camera.altitude === 'number') {
        setMapCameraAltitude(camera.altitude);
      }
      setTimeout(() => {
        map.getCamera()
          .then(after => {
            logGardenMapCameraDebug('rotate_after_camera', {
              direction,
              requestedHeading: roundDebugNumber(nextHeading, 2),
              beforeCamera: debugCamera(camera),
              afterCamera: debugCamera(after),
              altitudeDelta:
                typeof camera.altitude === 'number' && typeof after.altitude === 'number'
                  ? roundDebugNumber(after.altitude - camera.altitude, 2)
                  : null,
            });
          })
          .catch(error => {
            logGardenMapCameraDebug('rotate_after_camera_failed', {
              direction,
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }, 260);
      return;
    } catch (error) {
      logGardenMapCameraDebug('rotate_get_camera_failed_using_partial_camera', {
        direction,
        nextHeading,
        message: error instanceof Error ? error.message : String(error),
      });
      map.animateCamera({ heading: nextHeading, pitch: 0 }, { duration: 180 });
    }
  }, [mapCameraAltitude, mapHeading, satelliteRegion, satelliteVisibleRegion]);

  const resetMapRotation = useCallback(async () => {
    const map = satelliteMapRef.current;
    const regionBeforeRotationReset =
      satelliteRegionRef.current ?? satelliteVisibleRegion ?? satelliteRegion;
    logGardenMapCameraDebug('rotation_reset_pressed', {
      previousHeading: roundDebugNumber(mapHeading, 2),
      regionRef: debugRegion(regionBeforeRotationReset),
      stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
    });
    setMapHeading(0);
    if (!map) {
      logGardenMapCameraDebug('rotation_reset_skipped_no_map');
      return;
    }

    try {
      const camera = await map.getCamera();
      logGardenMapCameraDebug('rotation_reset_before_camera', {
        camera: debugCamera(camera),
      });
      map.animateCamera(
        Platform.OS === 'ios'
          ? {
              heading: 0,
              pitch: 0,
              altitude:
                typeof camera.altitude === 'number'
                  ? Math.max(camera.altitude, SATELLITE_IOS_STABLE_ALTITUDE_FLOOR)
                  : SATELLITE_IOS_STABLE_ALTITUDE_FLOOR,
              center: camera.center,
            }
          : { ...camera, heading: 0, pitch: 0 },
        { duration: 180 },
      );
      if (typeof camera.altitude === 'number') {
        setMapCameraAltitude(camera.altitude);
      }
      setTimeout(() => {
        map.getCamera()
          .then(after => {
            logGardenMapCameraDebug('rotation_reset_after_camera', {
              beforeCamera: debugCamera(camera),
              afterCamera: debugCamera(after),
              altitudeDelta:
                typeof camera.altitude === 'number' && typeof after.altitude === 'number'
                  ? roundDebugNumber(after.altitude - camera.altitude, 2)
                  : null,
            });
          })
          .catch(error => {
            logGardenMapCameraDebug('rotation_reset_after_camera_failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }, 260);
      return;
    } catch (error) {
      logGardenMapCameraDebug('rotation_reset_get_camera_failed_using_partial_camera', {
        message: error instanceof Error ? error.message : String(error),
      });
      map.animateCamera({ heading: 0, pitch: 0 }, { duration: 180 });
    }
  }, [mapCameraAltitude, mapHeading, satelliteRegion, satelliteVisibleRegion]);

  const handleSatellitePanDrag = useCallback(() => {
    if (isSatellitePanGesture.current) return;

    isSatellitePanGesture.current = true;
    panStartCameraAltitude.current = mapCameraAltitude;
    logGardenMapCameraDebug('pan_drag_start', {
      stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
      regionRef: debugRegion(satelliteRegionRef.current),
    });

    const map = satelliteMapRef.current;
    if (!map) {
      logGardenMapCameraDebug('pan_drag_start_no_map');
      return;
    }

    map.getCamera()
      .then(camera => {
        logGardenMapCameraDebug('pan_drag_start_camera_read', {
          camera: debugCamera(camera),
        });
        if (typeof camera.altitude === 'number') {
          panStartCameraAltitude.current = camera.altitude;
        }
      })
      .catch(error => {
        logGardenMapCameraDebug('pan_drag_start_camera_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        panStartCameraAltitude.current = null;
      });
  }, [mapCameraAltitude]);

  const handleSatelliteRegionChangeComplete = useCallback(
    (region: Region) => {
      satelliteRegionRef.current = region;
      setSatelliteVisibleRegion(region);
      logGardenMapCameraDebug('region_change_complete', {
        region: debugRegion(region),
        wasPanGesture: isSatellitePanGesture.current,
        panStartAltitude: roundDebugNumber(panStartCameraAltitude.current, 2),
        stateAltitude: roundDebugNumber(mapCameraAltitude, 2),
      });

      if (Platform.OS === 'ios' && isSatellitePanGesture.current) {
        const startAltitude = panStartCameraAltitude.current;
        const map = satelliteMapRef.current;
        if (map && startAltitude != null) {
          setTimeout(() => {
            map.getCamera()
              .then(camera => {
                logGardenMapCameraDebug('pan_complete_camera_read', {
                  startAltitude: roundDebugNumber(startAltitude, 2),
                  camera: debugCamera(camera),
                });
                if (typeof camera.altitude !== 'number') {
                  void syncSatelliteCameraAltitude();
                  return;
                }

                const zoomedOutDuringPan = camera.altitude > startAltitude * 1.08;
                logGardenMapCameraDebug('pan_complete_zoom_check', {
                  startAltitude: roundDebugNumber(startAltitude, 2),
                  actualAltitude: roundDebugNumber(camera.altitude, 2),
                  zoomedOutDuringPan,
                  restoreThreshold: roundDebugNumber(startAltitude * 1.08, 2),
                });
                if (!zoomedOutDuringPan) {
                  void syncSatelliteCameraAltitude();
                  return;
                }

                logGardenMapCameraDebug('pan_altitude_restore_request', {
                  fromCamera: debugCamera(camera),
                  toAltitude: roundDebugNumber(startAltitude, 2),
                  center: debugRegion(region),
                });
                map.animateCamera(
                  {
                    ...camera,
                    altitude: startAltitude,
                    center: {
                      latitude: region.latitude,
                      longitude: region.longitude,
                    },
                  },
                  { duration: 80 },
                );
                setMapCameraAltitude(startAltitude);
                setMinDiscoveredAltitude(prev =>
                  prev != null && startAltitude < prev * 0.98 ? (logGardenMapCameraDebug('min_floor_cleared_after_pan_restore', {
                    previousMin: roundDebugNumber(prev, 2),
                    restoredAltitude: roundDebugNumber(startAltitude, 2),
                  }), null) : prev,
                );
              })
              .catch(error => {
                logGardenMapCameraDebug('pan_complete_camera_failed', {
                  message: error instanceof Error ? error.message : String(error),
                });
                void syncSatelliteCameraAltitude();
              });
          }, 0);
        } else {
          logGardenMapCameraDebug('pan_restore_skipped_missing_map_or_start_altitude', {
            hasMap: Boolean(map),
            startAltitude: roundDebugNumber(startAltitude, 2),
          });
          void syncSatelliteCameraAltitude();
        }
      } else {
        void syncSatelliteCameraAltitude();
      }

      isSatellitePanGesture.current = false;
      panStartCameraAltitude.current = null;
    },
    [mapCameraAltitude, syncSatelliteCameraAltitude],
  );

  const satelliteOverlayActions = useMemo(() => {
    const actions: Array<{
      id: string;
      label: string;
      icon?: keyof typeof Ionicons.glyphMap;
      onPress: () => void;
      disabled?: boolean;
    }> = [
      {
        id: 'zoom-in',
        label: 'Zoom in',
        icon: 'add' as const,
        onPress: () => {
          void zoomSatelliteMap('in');
        },
        disabled: !canZoomIn,
      },
      { id: 'reset-view', label: 'Home', icon: 'home' as const, onPress: resetSatelliteMap },
      {
        id: 'zoom-out',
        label: 'Zoom out',
        icon: 'remove' as const,
        onPress: () => {
          void zoomSatelliteMap('out');
        },
        disabled: !canZoomOut,
      },
    ];

    if (isEditingBoundary && boundaryEditor) {
      actions.push(
        {
          id: 'boundary-undo',
          label: 'Undo',
          icon: 'arrow-undo' as const,
          onPress: boundaryEditor.undo,
          disabled: !boundaryEditor.canUndo,
        },
        {
          id: 'boundary-redo',
          label: 'Redo',
          icon: 'arrow-redo' as const,
          onPress: boundaryEditor.redo,
          disabled: !boundaryEditor.canRedo,
        },
      );
    }

    return actions;
  }, [
    boundaryEditor,
    canZoomIn,
    canZoomOut,
    isEditingBoundary,
    resetSatelliteMap,
    zoomSatelliteMap,
  ]);

  const settingsIconRotation = settingsButtonRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handleSatelliteSettingsPress = useCallback(() => {
    settingsButtonRotation.setValue(0);
    Animated.timing(settingsButtonRotation, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    onToggleSatelliteSettings();
  }, [onToggleSatelliteSettings, settingsButtonRotation]);

  const handleCoordinateMapPress = useCallback(
    (coordinate: LatLng) => {
      if (mode !== 'plan' || !boundaryBounds) return;
      const xPercent =
        ((coordinate.longitude - boundaryBounds.minLon) /
          Math.max(boundaryBounds.maxLon - boundaryBounds.minLon, 0.0000001)) *
        100;
      const yPercent =
        ((boundaryBounds.maxLat - coordinate.latitude) /
          Math.max(boundaryBounds.maxLat - boundaryBounds.minLat, 0.0000001)) *
        100;
      onPlanPress(0, 0, xPercent / 100, yPercent / 100);
    },
    [boundaryBounds, mode, onPlanPress],
  );

  const markerCoordinateFromPercent = useCallback(
    (marker: FloorPlanMarker): LatLng | null => {
      if (!boundaryBounds) return null;
      const x = marker.x_percent / 100;
      const y = marker.y_percent / 100;
      return {
        latitude: boundaryBounds.maxLat - y * (boundaryBounds.maxLat - boundaryBounds.minLat),
        longitude: boundaryBounds.minLon + x * (boundaryBounds.maxLon - boundaryBounds.minLon),
      };
    },
    [boundaryBounds],
  );

  return (
    <View style={styles.viewerContainer}>
      {usesCoordinateMap && satelliteRegion ? (
        <>
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor:
                  mode === 'plan'
                    ? '#FFFFFF'
                    : isDark
                      ? colors.backgroundMain
                      : '#FFFFFF',
              },
            ]}
          />
          <MapView
            key={coordinateMapKey}
            ref={satelliteMapRef}
            style={[
              StyleSheet.absoluteFill,
              { opacity: isCoordinateMapReady ? mapOpacity : 0 },
            ]}
            mapType={mode === 'satellite' ? 'satellite' : 'none'}
            initialRegion={satelliteRegion}
            maxZoomLevel={SATELLITE_MAX_ZOOM_LEVEL}
            cameraZoomRange={IOS_SATELLITE_CAMERA_ZOOM_RANGE}
            showsCompass={false}
            showsScale={false}
            rotateEnabled
            pitchEnabled={false}
            toolbarEnabled={false}
            onMapReady={() => {
              satelliteRegionRef.current = satelliteRegion;
              setSatelliteVisibleRegion(satelliteRegion);
              setReadyMapKey(coordinateMapKey);
              logGardenMapCameraDebug('map_ready', {
                coordinateMapKey,
                mode,
                initialRegion: debugRegion(satelliteRegion),
                maxZoomLevel: SATELLITE_MAX_ZOOM_LEVEL,
                cameraZoomRange: IOS_SATELLITE_CAMERA_ZOOM_RANGE ?? null,
              });
              void syncSatelliteCameraAltitude();
            }}
            onRegionChangeComplete={handleSatelliteRegionChangeComplete}
            onPanDrag={handleSatellitePanDrag}
            onPress={
              isEditingBoundary
                ? undefined
                : (event) => handleCoordinateMapPress(event.nativeEvent.coordinate)
            }
          >
            <MapPolygon
              coordinates={editablePolygonCoords ?? satelliteCoordinates}
              fillColor={`rgba(${BOUNDARY_FILL_RGB}, ${polygonOpacity})`}
              strokeColor={BOUNDARY_STROKE}
              strokeWidth={2}
            />
            {isEditingBoundary && boundaryEditor.selectedEdgeCoordinates && (
              <MapPolyline
                coordinates={boundaryEditor.selectedEdgeCoordinates}
                strokeColor={BOUNDARY_EDIT_SELECTED_EDGE}
                strokeWidth={5}
              />
            )}
            {isEditingBoundary &&
              boundaryEditor.corners.map((corner, index) => (
                <MapMarker
                  key={`boundary-vertex-${index}`}
                  coordinate={corner}
                  draggable
                  anchor={{ x: 0.5, y: 0.5 }}
                  onPress={() => boundaryEditor.setSelectedVertex(index)}
                  onDragStart={boundaryEditor.pushHistory}
                  onDrag={(e) => boundaryEditor.onVertexDrag(index, e.nativeEvent.coordinate)}
                  onDragEnd={(e) =>
                    boundaryEditor.onVertexDragEnd(index, e.nativeEvent.coordinate)
                  }
                >
                  <View
                    style={[
                      styles.vertexMarker,
                      isSelectedEdgeEndpoint(
                        index,
                        boundaryEditor.selectedVertex,
                        boundaryEditor.corners.length,
                      ) && styles.vertexMarkerSelected,
                    ]}
                  >
                    <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                      {index + 1}
                    </Typography>
                  </View>
                </MapMarker>
              ))}
            {!isEditingBoundary &&
              mode === 'plan' &&
              markers.map((marker) => {
                const coordinate = markerCoordinateFromPercent(marker);
                if (!coordinate) return null;
                return (
                  <MapMarker key={marker.id} coordinate={coordinate} anchor={{ x: 0.5, y: 1 }}>
                    <MarkerPin
                      marker={marker}
                      scale={1}
                      taskCategory={taskCategories[marker.linked_entity_id]}
                      onPress={() => onMarkerPress(marker)}
                    />
                  </MapMarker>
                );
              })}
          </MapView>
          {/* Garden objects overlay — shared with the editor (same renderer
              and same canvas-coord layout) so objects look identical in both
              modes. Hidden while editing the boundary (vertex handles need
              clearance) and while editing objects (the inline editor mounts
              its own interactive layer above this view). */}
          {editMode === 'none' && gardenObjects.length > 0 ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${VIEWER_OBJECTS_CANVAS_SIZE} ${VIEWER_OBJECTS_CANVAS_SIZE}`}
              >
                {gardenObjects.map(object => (
                  <ViewerGardenObject key={object.id} object={object} />
                ))}
              </Svg>
            </View>
          ) : null}
          {!isCoordinateMapReady && (
            <View
              style={[
                styles.loadingOverlay,
                {
                  backgroundColor:
                    mode === 'plan'
                      ? '#FFFFFF'
                      : isDark
                        ? colors.backgroundMain
                        : '#FFFFFF',
                },
              ]}
            >
              <ActivityIndicator size="large" color={MAIN_ACTION_COLOR} />
            </View>
          )}
          {isCoordinateMapReady && (
            <MapOverlayControls
              rightActions={satelliteOverlayActions}
              topInset={controlsTopInset}
              showCompass
              compassRotationDegrees={mapHeading}
              onRotateLeft={
                canRotateMap
                  ? () => {
                      void rotateMap(-1);
                    }
                  : undefined
              }
              onRotateRight={
                canRotateMap
                  ? () => {
                      void rotateMap(1);
                    }
                  : undefined
              }
              onCompassPress={() => {
                void resetMapRotation();
              }}
            />
          )}
          {isCoordinateMapReady && showSatelliteSettings && (
            <View style={[styles.opacityPanel, { bottom: bottomInset + 80 }]}>
              {isSatelliteMode && (
                <View style={styles.opacityRow}>
                  <View style={styles.opacityHeader}>
                    <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                      Map opacity
                    </Typography>
                    <Typography variant="caption1" color="#FFFFFF">
                      {Math.round(mapOpacity * 100)}%
                    </Typography>
                  </View>
                  <OpacitySlider
                    value={mapOpacity}
                    onChange={onMapOpacityChange}
                    trackColor="rgba(255,255,255,0.25)"
                    fillColor="#FFFFFF"
                    thumbColor="#FFFFFF"
                  />
                </View>
              )}
              <View style={styles.opacityRow}>
                <View style={styles.opacityHeader}>
                  <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                    Plan opacity
                  </Typography>
                  <Typography variant="caption1" color="#FFFFFF">
                    {Math.round(polygonOpacity * 100)}%
                  </Typography>
                </View>
                <OpacitySlider
                  value={polygonOpacity}
                  onChange={onPolygonOpacityChange}
                  trackColor="rgba(255,255,255,0.25)"
                  fillColor={BOUNDARY_STROKE}
                  thumbColor={BOUNDARY_STROKE}
                />
              </View>
            </View>
          )}
          {isCoordinateMapReady && (
            <TouchableOpacity
              style={[styles.satelliteSettingsButton, { bottom: bottomInset + 24 }]}
              onPress={handleSatelliteSettingsPress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={
                showSatelliteSettings ? 'Hide map settings' : 'Show map settings'
              }
            >
              <Animated.View style={{ transform: [{ rotate: settingsIconRotation }] }}>
                <Icon
                  name={showSatelliteSettings ? 'close' : 'settings-sharp'}
                  size={22}
                  color="#FFFFFF"
                />
              </Animated.View>
            </TouchableOpacity>
          )}
          {isCoordinateMapReady && mode === 'plan' && !isEditingBoundary && (
            <View style={[styles.hint, { bottom: bottomInset + 96 }]} pointerEvents="none">
              <Typography variant="caption1" color="textSecondary">
                Tap to place a task • Pinch to zoom
              </Typography>
            </View>
          )}
          {isCoordinateMapReady && isEditingBoundary && (
            <View style={[styles.hint, { bottom: bottomInset + 96 }]} pointerEvents="none">
              <Typography variant="caption1" color="textSecondary">
                Drag corners to reshape • Pinch to zoom
              </Typography>
            </View>
          )}
          {isCoordinateMapReady && isIosSatelliteMode && !canRotateMap && !isEditingBoundary && (
            <View style={[styles.hint, { bottom: bottomInset + 96 }]} pointerEvents="none">
              <Typography variant="caption1" color="textSecondary">
                Zoom out to rotate map
              </Typography>
            </View>
          )}
        </>
      ) : imageUrl ? (
        // Reached only when there is no boundary to put a map behind, which
        // means the plan is an uploaded picture and `imageUrl` is present. Said
        // as a condition rather than a non-null assertion so that a plan with
        // NEITHER renders nothing instead of a broken image — the caller
        // (`GardenPlanViewerScreen`) keeps its spinner up for exactly that case.
        <>
          <FloorPlanViewer
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            markers={markers}
            gardenObjects={gardenObjects}
            boundaryGeoJson={boundaryGeoJson}
            showBackgroundImage={showBackgroundImage}
            pendingMarker={pendingMarker}
            taskCategories={taskCategories}
            onMarkerPress={onMarkerPress}
            onPlanPress={onPlanPress}
            onBoundaryLongPress={onBoundaryLongPress}
            interactive
            controlsTopInset={controlsTopInset}
            initialZoomMultiplier={GARDEN_VIEW_INITIAL_ZOOM}
            flatCanvas
          />
          <View style={[styles.hint, { bottom: bottomInset + 96 }]} pointerEvents="none">
            <Typography variant="caption1" color="textSecondary">
              Tap to place a task • Pinch to zoom
            </Typography>
          </View>
        </>
      ) : null}
    </View>
  );
});

function ViewerGardenObject({ object }: { object: GardenPlanObject }) {
  const x = object.x * VIEWER_OBJECTS_CANVAS_SIZE;
  const y = object.y * VIEWER_OBJECTS_CANVAS_SIZE;
  const width = object.width * VIEWER_OBJECTS_CANVAS_SIZE;
  const height = object.height * VIEWER_OBJECTS_CANVAS_SIZE;
  const color = object.color ?? '#2F855A';
  const transform = `translate(${x} ${y}) rotate(${object.rotation})`;
  const label = getGardenObjectDisplayLabel(object);
  return (
    <G transform={transform}>
      {renderGardenObjectBody({ object, width, height, color, stroke: '#1F2937', strokeWidth: 4 })}
      {object.type !== 'label' && label ? (
        <G transform={`rotate(${-object.rotation})`}>
          <Rect
            x={-Math.max(width * 0.7, 90)}
            y={height / 2 + 14}
            width={Math.max(width * 1.4, 180)}
            height={44}
            rx={20}
            fill="rgba(255,255,255,0.86)"
            stroke="#CBD5E1"
            strokeWidth={2}
          />
          <SvgText
            x={0}
            y={height / 2 + 41}
            fill="#0F172A"
            fontSize={30}
            fontWeight="700"
            textAnchor="middle"
          >
            {label}
          </SvgText>
        </G>
      ) : null}
    </G>
  );
}

function parseBoundaryCoordinates(boundaryGeoJson: string | null | undefined): LatLng[] {
  if (!boundaryGeoJson) return [];
  try {
    const parsed = JSON.parse(boundaryGeoJson) as {
      type?: string;
      coordinates?: unknown;
    };
    if (!parsed?.type || !Array.isArray(parsed.coordinates)) return [];
    const polygon =
      parsed.type === 'Polygon'
        ? (parsed.coordinates as unknown[])
        : parsed.type === 'MultiPolygon'
          ? ((parsed.coordinates as unknown[])[0] as unknown[])
          : null;
    if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return [];
    const ring = polygon[0] as unknown[];
    if (!Array.isArray(ring)) return [];
    const coords: LatLng[] = [];
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      coords.push({ latitude: lat, longitude: lon });
    }
    return coords;
  } catch {
    return [];
  }
}

function regionFromBoundaryGeoJson(boundaryGeoJson: string | null | undefined): Region | null {
  return regionFromCoordinates(parseBoundaryCoordinates(boundaryGeoJson));
}

function boundsFromCoordinates(coords: LatLng[]) {
  if (coords.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLon) minLon = c.longitude;
    if (c.longitude > maxLon) maxLon = c.longitude;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function regionFromCoordinates(coords: LatLng[]): Region | null {
  const bounds = boundsFromCoordinates(coords);
  if (!bounds) return null;
  const { minLat, maxLat, minLon, maxLon } = bounds;
  const latitudeDelta = Math.max((maxLat - minLat) * SATELLITE_REGION_PADDING, SATELLITE_MIN_DELTA);
  const longitudeDelta = Math.max((maxLon - minLon) * SATELLITE_REGION_PADDING, SATELLITE_MIN_DELTA);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

interface OpacitySliderProps {
  value: number;
  onChange: (value: number) => void;
  trackColor: string;
  fillColor: string;
  thumbColor: string;
}

function OpacitySlider({ value, onChange, trackColor, fillColor, thumbColor }: OpacitySliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const lastReportedRef = useRef(value);

  const update = useCallback(
    (x: number) => {
      if (trackWidth <= 0) return;
      const clamped = Math.max(0, Math.min(1, x / trackWidth));
      const rounded = Math.round(clamped * 100) / 100;
      if (rounded === lastReportedRef.current) return;
      lastReportedRef.current = rounded;
      onChange(rounded);
    },
    [onChange, trackWidth],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin((e) => {
          update(e.x);
        })
        .onUpdate((e) => {
          update(e.x);
        }),
    [update],
  );

  const sliderValue = Math.max(0, Math.min(1, value));
  const fillWidth = trackWidth > 0 ? sliderValue * trackWidth : 0;
  const thumbLeft =
    trackWidth > 0
      ? sliderValue * Math.max(0, trackWidth - SLIDER_THUMB_SIZE)
      : 0;

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[opacitySliderStyles.track, { backgroundColor: trackColor }]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        <View style={[opacitySliderStyles.fill, { backgroundColor: fillColor, width: fillWidth }]} />
        <View
          style={[
            opacitySliderStyles.thumb,
            { backgroundColor: thumbColor, left: thumbLeft },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  viewerContainer: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  opacityPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 14,
    zIndex: 30,
  },
  opacityRow: {
    gap: 6,
  },
  opacityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  satelliteSettingsButton: {
    position: 'absolute',
    right: 16,
    width: MAP_CONTROL_BUTTON_SIZE,
    height: MAP_CONTROL_BUTTON_SIZE,
    borderRadius: MAP_CONTROL_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MAIN_ACTION_COLOR,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 31,
  },
  vertexMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: BOUNDARY_VERTEX_FILL,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vertexMarkerSelected: {
    transform: [{ scale: 1.08 }],
    backgroundColor: BOUNDARY_EDIT_SELECTED_EDGE,
  },
});

const opacitySliderStyles = StyleSheet.create({
  track: {
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    overflow: 'visible',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 12,
  },
  thumb: {
    position: 'absolute',
    width: SLIDER_THUMB_SIZE,
    height: SLIDER_THUMB_SIZE,
    borderRadius: SLIDER_THUMB_SIZE / 2,
    top: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
