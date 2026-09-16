import {
  createGardenObject,
  normalizeGardenObject,
  type GardenPlanObject,
  type GardenObjectType,
} from '@models/garden-objects';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import MapView, {
  Polygon as MapPolygon,
  type Camera,
  type LatLng,
  type Region,
} from 'react-native-maps';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  G,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  buildPresetMetadata,
  type GardenObjectPreset,
  type SimpleShape,
} from '@/types/garden-object-presets';
import type { GardenPlanMeasurementUnit } from '@api/garden-plans';
import { MapOverlayControls } from '@components/common/house';
import { Typography } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useSettingsStore } from '@stores/settingsStore';
import {CornerRadius, Spacing, useAppColors } from '@theme';
import { palette } from '@theme/colors';

import {
  GardenObjectLibrarySheet,
  type GardenObjectLibraryResult,
} from './GardenObjectLibrarySheet';
import {
  getGardenObjectDisplayLabel,
  renderGardenObjectBody,
} from './GardenObjectRenderer';

const CANVAS_SIZE = 1000;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.5;
const MIN_OBJECT_SIZE = 0.04;
const MAX_OBJECT_SIZE = 0.55;
const ROTATE_STEP_DEG = 15;
// Match the viewer's altitude floor so the editor's MapView frames the
// boundary the same way when no `initialCamera` is supplied. See
// `GardenPlanUnifiedViewer` for the iOS MKMapView clamp rationale.
const SATELLITE_IOS_STABLE_ALTITUDE_FLOOR = 320;
const IOS_SATELLITE_CAMERA_ZOOM_RANGE =
  Platform.OS === 'ios'
    ? { minCenterCoordinateDistance: 60, maxCenterCoordinateDistance: 8000, animated: false }
    : undefined;
// Presets are designed to look nice in the library cards but are visually
// large when dropped on a real garden plan whose boundary often only fills
// part of the canvas. Scale presets down on insert so they read as a single
// element the user can then resize. They still respect MIN_OBJECT_SIZE.
const PRESET_INSERT_SCALE = 0.5;

// Resize / rotate handles overlaid on the selected object.
const HANDLE_VISUAL_SIZE = 22;
const HANDLE_TOUCH_SIZE = 44;
const HANDLE_HALF_TOUCH = HANDLE_TOUCH_SIZE / 2;
const ROTATION_HANDLE_GAP_PX = 38; // distance above the top edge
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
const RESIZE_CORNERS: readonly ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
const CORNER_SIGNS: Record<ResizeCorner, { x: -1 | 1; y: -1 | 1 }> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  se: { x: 1, y: 1 },
};
const METERS_TO_FEET = 3.28084;
const SIZE_STEP = 0.1;
const SIZE_WHEEL_ROW_HEIGHT = 44;
const DIMENSION_STEP = 0.1;
const SATELLITE_REGION_PADDING = 0.7;
const SATELLITE_MIN_DELTA = 0.00035;
const BOUNDARY_STROKE = '#3F8F54';
const BOUNDARY_FILL_RGB = '63, 143, 84';
const OBJECT_COLOR_SWATCHES = [
  '#2F855A',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#CA8A04',
  '#EF4444',
  '#0EA5A4',
  '#64748B',
] as const;

type ObjectShape = SimpleShape;
type PickerMode = 'size' | 'width' | 'height';

const MAIN_ACTION_COLOR = palette.button.teal;

function shapeFromMetadata(object: GardenPlanObject): ObjectShape | null {
  const shape = object.metadata?.shape;
  if (shape === 'circle' || shape === 'square' || shape === 'rectangle') return shape;
  return null;
}

function defaultShapeForType(type: GardenObjectType): ObjectShape {
  if (type === 'tree' || type === 'shrub' || type === 'flower') return 'circle';
  return 'rectangle';
}

/**
 * Compute new normalized {x, y, width, height} for an object whose `corner`
 * is being dragged by `(dxNorm, dyNorm)` (delta in normalized world units).
 *
 * Anchors the *opposite* corner in place — the canonical Figma/Sketch resize
 * behaviour — and is rotation-aware so dragging works on rotated objects.
 *
 * Math:
 *   - opposite corner stays fixed in world coords
 *   - new width/height computed in the object's *local* frame after rotating
 *     the world delta by `-rotation`
 *   - width/height clamped to [MIN_OBJECT_SIZE, MAX_OBJECT_SIZE]; clamping
 *     past the anchor prevents the object from "flipping"
 *   - new center = anchor + R(rotation) · (xSign·w/2, ySign·h/2)
 */
function applyCornerResize(
  start: GardenPlanObject,
  corner: ResizeCorner,
  dxNorm: number,
  dyNorm: number,
): { x: number; y: number; width: number; height: number } {
  const { x: xSign, y: ySign } = CORNER_SIGNS[corner];
  const theta = (start.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfW = start.width / 2;
  const halfH = start.height / 2;

  const anchorX = start.x + cos * (-xSign * halfW) - sin * (-ySign * halfH);
  const anchorY = start.y + sin * (-xSign * halfW) + cos * (-ySign * halfH);

  const startCornerX = start.x + cos * (xSign * halfW) - sin * (ySign * halfH);
  const startCornerY = start.y + sin * (xSign * halfW) + cos * (ySign * halfH);

  const newCornerX = startCornerX + dxNorm;
  const newCornerY = startCornerY + dyNorm;

  const dx = newCornerX - anchorX;
  const dy = newCornerY - anchorY;

  const rawW = xSign * (cos * dx + sin * dy);
  const rawH = ySign * (-sin * dx + cos * dy);

  const newW = Math.max(MIN_OBJECT_SIZE, Math.min(MAX_OBJECT_SIZE, rawW));
  const newH = Math.max(MIN_OBJECT_SIZE, Math.min(MAX_OBJECT_SIZE, rawH));

  const lox = xSign * newW / 2;
  const loy = ySign * newH / 2;
  const newCx = anchorX + cos * lox - sin * loy;
  const newCy = anchorY + sin * lox + cos * loy;

  return { x: newCx, y: newCy, width: newW, height: newH };
}

interface GardenPlanVectorEditorProps {
  backgroundImageUrl?: string | null;
  boundaryGeoJson?: string | null;
  backgroundMode?: 'satellite' | 'plan';
  mapOpacity?: number;
  polygonOpacity?: number;
  /**
   * Optional starting camera (latitude/longitude/altitude/heading) used to
   * frame the satellite background at the same zoom/heading the user had
   * before navigating into the editor. Falls back to fitting the boundary
   * region when omitted.
   */
  initialCamera?: {
    center: { latitude: number; longitude: number };
    altitude?: number;
    heading?: number;
    pitch?: number;
  };
  objects: GardenPlanObject[];
  onChange: (objects: GardenPlanObject[]) => void;
  height?: number;
  showHeader?: boolean;
  fullScreen?: boolean;
  /**
   * Extra space reserved below the editor's own bottom panel. Used when the
   * editor is mounted inside another screen that owns its own bottom UI
   * (e.g. the unified viewer's save bar) so the editor's controls don't sit
   * underneath those controls.
   */
  bottomInset?: number;
  /**
   * When true the editor renders only its editing overlay (objects, handles,
   * bottom panel, top controls) with a transparent canvas. The host is
   * expected to render the satellite map / boundary underneath. Canvas
   * pan/pinch/rotate gestures are disabled in this mode so map gestures on
   * the host pass through.
   */
  transparent?: boolean;
}

export function GardenPlanVectorEditor({
  backgroundImageUrl,
  boundaryGeoJson = null,
  backgroundMode = 'plan',
  mapOpacity = 1,
  polygonOpacity = 0.45,
  initialCamera,
  objects,
  onChange,
  height,
  showHeader = true,
  fullScreen = false,
  bottomInset = 0,
  transparent = false,
}: GardenPlanVectorEditorProps) {
  const colors = useAppColors();  const measurementUnit = useSettingsStore(
    state =>
      (state.settings['garden.measurementUnit'] as GardenPlanMeasurementUnit | undefined) ??
      'meters',
  );
  // "Object name" is the last row of a bottom-anchored panel, so the keypad it
  // summons opens right on top of it. The panel does not scroll, so there is no
  // `automaticallyAdjustKeyboardInsets` to lean on — measure the keyboard and
  // lift the whole panel clear of it instead (see `@hooks/useKeyboardInset`).
  const keyboardInset = useKeyboardInset();
  const [showLabels, setShowLabels] = useState(true);
  const [showObjectActionsSheet, setShowObjectActionsSheet] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showLibrarySheet, setShowLibrarySheet] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [sizePickerValue, setSizePickerValue] = useState<number>(1);
  const [pickerMode, setPickerMode] = useState<PickerMode>('size');
  const [labelDraft, setLabelDraft] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    objects[0]?.id ?? null,
  );
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: height ?? 1 });
  const [history, setHistory] = useState<GardenPlanObject[][]>([]);
  const [redoHistory, setRedoHistory] = useState<GardenPlanObject[][]>([]);
  const dragStartObjects = useRef<GardenPlanObject[] | null>(null);
  const resizeStartObject = useRef<GardenPlanObject | null>(null);
  const sizePickerListRef = useRef<FlatList<number> | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const rotationDeg = useSharedValue(0);
  const savedRotationDeg = useSharedValue(0);
  // JS mirror of the canvas rotation so the compass widget can render its
  // arrow at the right heading (compass `headingDegrees` is JS-side state).
  const [headingDeg, setHeadingDeg] = useState(0);
  useAnimatedReaction(
    () => rotationDeg.value,
    (current, previous) => {
      if (previous == null || Math.abs(current - (previous as number)) > 0.5) {
        runOnJS(setHeadingDeg)(current);
      }
    },
    [],
  );

  const selectedObject = useMemo(
    () => objects.find(object => object.id === selectedObjectId) ?? null,
    [objects, selectedObjectId],
  );
  const boundaryCoordinates = useMemo(
    () => parseBoundaryCoordinates(boundaryGeoJson),
    [boundaryGeoJson],
  );
  const satelliteRegion = useMemo(
    () => regionFromCoordinates(boundaryCoordinates),
    [boundaryCoordinates],
  );
  const usesCoordinateBackground = boundaryCoordinates.length >= 3 && satelliteRegion !== null;
  const selectedShape = useMemo<ObjectShape>(
    () =>
      selectedObject
        ? shapeFromMetadata(selectedObject) ?? defaultShapeForType(selectedObject.type)
        : 'rectangle',
    [selectedObject],
  );
  const boundaryDimensionsMeters = useMemo(() => {
    if (!boundaryGeoJson) return null;
    try {
      const parsed = JSON.parse(boundaryGeoJson) as {
        type?: string;
        coordinates?: unknown;
      };
      if (!parsed?.type || !Array.isArray(parsed.coordinates)) return null;
      const polygon =
        parsed.type === 'Polygon'
          ? (parsed.coordinates as unknown[])
          : parsed.type === 'MultiPolygon'
            ? ((parsed.coordinates as unknown[])[0] as unknown[])
            : null;
      if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return null;
      const ring = polygon[0] as unknown[];
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const points = ring
        .map(coord => {
          if (!Array.isArray(coord) || coord.length < 2) return null;
          const lon = Number(coord[0]);
          const lat = Number(coord[1]);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
          return { lat, lon };
        })
        .filter((point): point is { lat: number; lon: number } => point !== null);
      if (points.length < 4) return null;

      const lons = points.map(p => p.lon);
      const lats = points.map(p => p.lat);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      const centerLatitude = (minLat + maxLat) / 2;
      const centerLongitude = (minLon + maxLon) / 2;

      const widthMeters = distanceMeters(
        { latitude: centerLatitude, longitude: minLon },
        { latitude: centerLatitude, longitude: maxLon },
      );
      const depthMeters = distanceMeters(
        { latitude: minLat, longitude: centerLongitude },
        { latitude: maxLat, longitude: centerLongitude },
      );
      return { widthMeters, depthMeters };
    } catch {
      return null;
    }
  }, [boundaryGeoJson]);
  const selectedObjectSizeDisplay = useMemo(() => {
    if (!selectedObject) return 'No selection';

    if (!boundaryDimensionsMeters) {
      const percent = ((selectedObject.width + selectedObject.height) / 2) * 100;
      return `${percent.toFixed(1)}%`;
    }

    const sizeMeters =
      ((selectedObject.width * boundaryDimensionsMeters.widthMeters) +
        (selectedObject.height * boundaryDimensionsMeters.depthMeters)) /
      2;
    if (measurementUnit === 'feet') {
      const sizeFeet = sizeMeters * METERS_TO_FEET;
      return `${sizeFeet.toFixed(1)} ft`;
    }
    return `${sizeMeters.toFixed(1)} m`;
  }, [boundaryDimensionsMeters, measurementUnit, selectedObject]);
  const selectedObjectSizeValue = useMemo(() => {
    if (!selectedObject) return null;
    if (!boundaryDimensionsMeters) {
      return ((selectedObject.width + selectedObject.height) / 2) * 100;
    }
    const sizeMeters =
      ((selectedObject.width * boundaryDimensionsMeters.widthMeters) +
        (selectedObject.height * boundaryDimensionsMeters.depthMeters)) /
      2;
    return measurementUnit === 'feet' ? sizeMeters * METERS_TO_FEET : sizeMeters;
  }, [boundaryDimensionsMeters, measurementUnit, selectedObject]);
  const sizeDisplayUnit = useMemo(() => {
    if (!boundaryDimensionsMeters) return '%';
    return measurementUnit === 'feet' ? 'ft' : 'm';
  }, [boundaryDimensionsMeters, measurementUnit]);
  const toDisplayLength = useCallback(
    (normalizedLength: number, axis: 'width' | 'height') => {
      if (!boundaryDimensionsMeters) return normalizedLength * 100;
      const axisMeters =
        axis === 'width' ? boundaryDimensionsMeters.widthMeters : boundaryDimensionsMeters.depthMeters;
      const lengthMeters = normalizedLength * axisMeters;
      return measurementUnit === 'feet' ? lengthMeters * METERS_TO_FEET : lengthMeters;
    },
    [boundaryDimensionsMeters, measurementUnit],
  );
  const toNormalizedLength = useCallback(
    (displayLength: number, axis: 'width' | 'height') => {
      if (!boundaryDimensionsMeters) return displayLength / 100;
      const axisMeters =
        axis === 'width' ? boundaryDimensionsMeters.widthMeters : boundaryDimensionsMeters.depthMeters;
      const lengthMeters = measurementUnit === 'feet' ? displayLength / METERS_TO_FEET : displayLength;
      return axisMeters > 0 ? lengthMeters / axisMeters : 0;
    },
    [boundaryDimensionsMeters, measurementUnit],
  );
  const selectedWidthDisplay = useMemo(
    () => (selectedObject ? toDisplayLength(selectedObject.width, 'width') : null),
    [selectedObject, toDisplayLength],
  );
  const selectedHeightDisplay = useMemo(
    () => (selectedObject ? toDisplayLength(selectedObject.height, 'height') : null),
    [selectedObject, toDisplayLength],
  );
  const sizePickerOptions = useMemo(() => {
    const maxValue = sizeDisplayUnit === '%' ? 80 : sizeDisplayUnit === 'ft' ? 200 : 60;
    const values: number[] = [];
    for (let value = SIZE_STEP; value <= maxValue + 0.0001; value += SIZE_STEP) {
      values.push(Number(value.toFixed(1)));
    }
    return values;
  }, [sizeDisplayUnit]);
  const pickerCurrentValue = useMemo(() => {
    if (pickerMode === 'width') return selectedWidthDisplay;
    if (pickerMode === 'height') return selectedHeightDisplay;
    return selectedObjectSizeValue;
  }, [pickerMode, selectedHeightDisplay, selectedObjectSizeValue, selectedWidthDisplay]);
  const nearestSizeOptionIndex = useMemo(() => {
    if (!sizePickerOptions.length) return 0;
    const current = pickerCurrentValue ?? sizePickerOptions[0];
    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    sizePickerOptions.forEach((option, index) => {
      const diff = Math.abs(option - current);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [pickerCurrentValue, sizePickerOptions]);
  const boundaryPath = useMemo(() => {
    if (!boundaryGeoJson) return null;
    try {
      const parsed = JSON.parse(boundaryGeoJson) as {
        type?: string;
        coordinates?: unknown;
      };
      if (!parsed?.type || !Array.isArray(parsed.coordinates)) return null;

      const polygon =
        parsed.type === 'Polygon'
          ? (parsed.coordinates as unknown[])
          : parsed.type === 'MultiPolygon'
            ? ((parsed.coordinates as unknown[])[0] as unknown[])
            : null;
      if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return null;

      const ring = polygon[0] as unknown[];
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const points = ring
        .map(coord => {
          if (!Array.isArray(coord) || coord.length < 2) return null;
          const lon = Number(coord[0]);
          const lat = Number(coord[1]);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
          return { lon, lat };
        })
        .filter((point): point is { lon: number; lat: number } => point !== null);
      if (points.length < 4) return null;

      // Match FloorPlanViewer: equirectangular projection + uniform letterbox so the
      // lot keeps true proportions (naive lon/lat stretch looks like a 3D tilt).
      const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
      const metresPerDegLat = 111_320;
      const metresPerDegLon = 111_320 * Math.cos((meanLat * Math.PI) / 180);

      const metric = points.map(point => ({
        x: point.lon * metresPerDegLon,
        y: -point.lat * metresPerDegLat,
      }));

      const xs = metric.map(p => p.x);
      const ys = metric.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const widthM = Math.max(maxX - minX, 0.000001);
      const heightM = Math.max(maxY - minY, 0.000001);

      const PADDING = 40;
      const usable = CANVAS_SIZE - PADDING * 2;
      const fitScale = Math.min(usable / widthM, usable / heightM);
      const offsetX = (CANVAS_SIZE - widthM * fitScale) / 2;
      const offsetY = (CANVAS_SIZE - heightM * fitScale) / 2;

      const scaledPoints = metric.map(point => ({
        x: (point.x - minX) * fitScale + offsetX,
        y: (point.y - minY) * fitScale + offsetY,
      }));
      const [first, ...rest] = scaledPoints;
      return `M ${first.x} ${first.y} ${rest.map(p => `L ${p.x} ${p.y}`).join(' ')} Z`;
    } catch {
      return null;
    }
  }, [boundaryGeoJson]);

  const pushHistory = useCallback(() => {
    setHistory(prev => [...prev.slice(-12), objects.map(object => ({ ...object }))]);
    setRedoHistory([]);
  }, [objects]);

  const commitObjects = useCallback(
    (nextObjects: GardenPlanObject[], shouldPushHistory = true) => {
      if (shouldPushHistory) {
        setHistory(prev => [...prev.slice(-12), objects.map(object => ({ ...object }))]);
        setRedoHistory([]);
      }
      onChange(nextObjects.map(normalizeGardenObject));
    },
    [objects, onChange],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height: measuredHeight } = event.nativeEvent.layout;
    setCanvasSize({ width: Math.max(width, 1), height: Math.max(measuredHeight, 1) });
  };

  const selectObject = useCallback((id: string) => {
    setSelectedObjectId(id);
  }, []);
  const openObjectActions = useCallback((id: string) => {
    setSelectedObjectId(id);
    setShowObjectActionsSheet(true);
  }, []);

  React.useEffect(() => {
    if (!selectedObject) {
      setLabelDraft('');
      return;
    }
    setLabelDraft(getGardenObjectDisplayLabel(selectedObject));
  }, [selectedObject]);

  const beginObjectDrag = useCallback(() => {
    dragStartObjects.current = objects.map(object => ({ ...object }));
    pushHistory();
  }, [objects, pushHistory]);

  const endObjectDrag = useCallback(() => {
    dragStartObjects.current = null;
  }, []);

  const beginObjectResize = useCallback(() => {
    if (!selectedObjectId) return;
    const selected = objects.find(object => object.id === selectedObjectId) ?? null;
    if (!selected) return;
    resizeStartObject.current = { ...selected };
    pushHistory();
  }, [objects, pushHistory, selectedObjectId]);

  const resizeSelectedObject = useCallback(
    (scaleFactor: number) => {
      if (!selectedObjectId) return;
      const start = resizeStartObject.current;
      if (!start) return;
      const nextWidth = Math.max(
        MIN_OBJECT_SIZE,
        Math.min(MAX_OBJECT_SIZE, start.width * scaleFactor),
      );
      const nextHeight = Math.max(
        MIN_OBJECT_SIZE,
        Math.min(MAX_OBJECT_SIZE, start.height * scaleFactor),
      );

      const nextObjects = objects.map(object =>
        object.id === selectedObjectId
          ? normalizeGardenObject({
              ...object,
              width: nextWidth,
              height: nextHeight,
            })
          : object,
      );
      onChange(nextObjects);
    },
    [objects, onChange, selectedObjectId],
  );

  const endObjectResize = useCallback(() => {
    resizeStartObject.current = null;
  }, []);

  const moveSelectedObject = useCallback(
    (
      translationX: number,
      translationY: number,
      currentScale: number,
      currentRotationDeg: number,
    ) => {
      if (!selectedObjectId) return;
      const startObjects = dragStartObjects.current ?? objects;
      const selected = startObjects.find(object => object.id === selectedObjectId);
      if (!selected) return;

      // Counter-rotate the screen-px translation by `-canvasRotation` so the
      // object follows the user's finger when the canvas itself is rotated.
      const rad = (-currentRotationDeg * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const localTx = translationX * cosR - translationY * sinR;
      const localTy = translationX * sinR + translationY * cosR;

      const nextObjects = startObjects.map(object =>
        object.id === selectedObjectId
          ? normalizeGardenObject({
              ...object,
              x: selected.x + localTx / (canvasSize.width * currentScale),
              y: selected.y + localTy / (canvasSize.height * currentScale),
            })
          : object,
      );
      onChange(nextObjects);
    },
    [canvasSize.height, canvasSize.width, objects, onChange, selectedObjectId],
  );

  const addPresetObject = useCallback(
    (preset: GardenObjectPreset) => {
      pushHistory();
      const base = createGardenObject(preset.type);
      const object = normalizeGardenObject({
        ...base,
        width: Math.max(preset.defaultWidth * PRESET_INSERT_SCALE, MIN_OBJECT_SIZE),
        height: Math.max(preset.defaultHeight * PRESET_INSERT_SCALE, MIN_OBJECT_SIZE),
        color: preset.defaultColor,
        label: preset.defaultLabel,
        metadata: buildPresetMetadata(preset),
      });
      setSelectedObjectId(object.id);
      onChange([...objects, object]);
    },
    [objects, onChange, pushHistory],
  );

  const addCustomObject = useCallback(
    (shape: SimpleShape, color: string, label: string) => {
      pushHistory();
      // 'patio' acts as the neutral backend type for custom shapes; rendering
      // is fully driven by metadata.shape (no preset iconKey).
      const base = createGardenObject('patio');
      const isWideShape = shape === 'rectangle';
      const object = normalizeGardenObject({
        ...base,
        width: isWideShape ? 0.1 : 0.07,
        height: isWideShape ? 0.06 : 0.07,
        color,
        label,
        metadata: { presetId: 'custom', shape, custom: true },
      });
      setSelectedObjectId(object.id);
      onChange([...objects, object]);
    },
    [objects, onChange, pushHistory],
  );

  const handleLibrarySelection = useCallback(
    (result: GardenObjectLibraryResult) => {
      if (result.kind === 'preset') {
        addPresetObject(result.preset);
      } else {
        addCustomObject(result.shape, result.color, result.label);
      }
    },
    [addCustomObject, addPresetObject],
  );

  const removeSelectedObject = () => {
    if (!selectedObjectId) return;
    commitObjects(objects.filter(object => object.id !== selectedObjectId));
    setSelectedObjectId(null);
  };

  const duplicateSelectedObject = () => {
    if (!selectedObject) return;
    const duplicate = normalizeGardenObject({
      ...selectedObject,
      id: `garden-object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      x: selectedObject.x + 0.04,
      y: selectedObject.y + 0.04,
    });
    commitObjects([...objects, duplicate]);
    setSelectedObjectId(duplicate.id);
  };

  const transformSelectedObject = (changes: Partial<GardenPlanObject>) => {
    if (!selectedObjectId) return;
    commitObjects(
      objects.map(object =>
        object.id === selectedObjectId
          ? normalizeGardenObject({ ...object, ...changes })
          : object,
      ),
    );
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    const current = objects.map(object => ({ ...object }));
    setHistory(prev => prev.slice(0, -1));
    setRedoHistory(prev => [...prev.slice(-12), current]);
    onChange(previous);
  };
  const redo = () => {
    const next = redoHistory[redoHistory.length - 1];
    if (!next) return;
    const current = objects.map(object => ({ ...object }));
    setRedoHistory(prev => prev.slice(0, -1));
    setHistory(prev => [...prev.slice(-12), current]);
    onChange(next);
  };

  const clampTranslation = (translation: number, dimension: number, currentScale: number) => {
    'worklet';
    const maxTranslation = (dimension * (currentScale - 1)) / 2;
    return Math.max(-maxTranslation, Math.min(maxTranslation, translation));
  };

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      if (selectedObjectId) {
        runOnJS(beginObjectResize)();
      }
    })
    .onUpdate(event => {
      if (selectedObjectId) {
        runOnJS(resizeSelectedObject)(event.scale);
        return;
      }
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * event.scale));
      scale.value = nextScale;
      translateX.value = clampTranslation(translateX.value, canvasSize.width, nextScale);
      translateY.value = clampTranslation(translateY.value, canvasSize.height, nextScale);
    })
    .onEnd(() => {
      if (selectedObjectId) {
        runOnJS(endObjectResize)();
        return;
      }
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      if (selectedObjectId) {
        runOnJS(beginObjectDrag)();
      }
    })
    .onUpdate(event => {
      if (selectedObjectId) {
        runOnJS(moveSelectedObject)(
          event.translationX,
          event.translationY,
          scale.value,
          rotationDeg.value,
        );
        return;
      }
      translateX.value = clampTranslation(
        savedTranslateX.value + event.translationX,
        canvasSize.width,
        scale.value,
      );
      translateY.value = clampTranslation(
        savedTranslateY.value + event.translationY,
        canvasSize.height,
        scale.value,
      );
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      if (selectedObjectId) {
        runOnJS(endObjectDrag)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotationDeg.value}deg` },
      { scale: scale.value },
    ],
  }));

  // Two-finger rotation rotates the entire canvas (satellite + objects)
  // together so they stay aligned, matching the viewer's UX of a rotatable
  // satellite backdrop.
  const rotationGesture = Gesture.Rotation()
    .onUpdate(event => {
      if (selectedObjectId) return;
      rotationDeg.value = savedRotationDeg.value + (event.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      if (selectedObjectId) return;
      savedRotationDeg.value = rotationDeg.value;
    });

  const rotateMap = (direction: -1 | 1) => {
    const next = savedRotationDeg.value + direction * ROTATE_STEP_DEG;
    rotationDeg.value = withTiming(next, { duration: 180 });
    savedRotationDeg.value = next;
  };

  const resetMapRotation = () => {
    rotationDeg.value = withTiming(0, { duration: 200 });
    savedRotationDeg.value = 0;
  };

  const zoomBy = (delta: number) => {
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value + delta));
    scale.value = withTiming(nextScale, { duration: 160 });
    savedScale.value = nextScale;
    if (nextScale === MIN_SCALE) {
      translateX.value = withTiming(0, { duration: 160 });
      translateY.value = withTiming(0, { duration: 160 });
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  };

  const rotateSelected = () => {
    if (!selectedObject) return;
    transformSelectedObject({ rotation: selectedObject.rotation + 15 });
  };

  const scaleSelected = (factor: number) => {
    if (!selectedObject) return;
    transformSelectedObject({
      width: selectedObject.width * factor,
      height: selectedObject.height * factor,
    });
  };
  const applyAbsoluteSize = useCallback(
    (nextValue: number) => {
      if (!selectedObject || !selectedObjectSizeValue) return;
      const safeValue = Math.max(SIZE_STEP, Number(nextValue.toFixed(1)));
      const scaleFactor = safeValue / selectedObjectSizeValue;
      transformSelectedObject({
        width: selectedObject.width * scaleFactor,
        height: selectedObject.height * scaleFactor,
      });
    },
    [selectedObject, selectedObjectSizeValue],
  );
  const adjustSizeByStep = useCallback(
    (delta: number) => {
      if (!selectedObjectSizeValue) return;
      applyAbsoluteSize(selectedObjectSizeValue + delta);
    },
    [applyAbsoluteSize, selectedObjectSizeValue],
  );
  const setSelectedShape = useCallback(
    (shape: ObjectShape) => {
      if (!selectedObject) return;
      const nextMetadata = { ...(selectedObject.metadata ?? {}), shape };
      const currentShape =
        shapeFromMetadata(selectedObject) ?? defaultShapeForType(selectedObject.type);
      if (shape === 'square' || shape === 'circle') {
        const side = (selectedObject.width + selectedObject.height) / 2;
        transformSelectedObject({
          metadata: nextMetadata,
          width: side,
          height: side,
        });
        return;
      }
      if (
        shape === 'rectangle' &&
        (currentShape === 'square' || currentShape === 'circle')
      ) {
        const displaySize = selectedObjectSizeValue;
        if (displaySize) {
          const nextWidth = Math.max(
            MIN_OBJECT_SIZE,
            Math.min(MAX_OBJECT_SIZE, toNormalizedLength(displaySize, 'width')),
          );
          const nextHeight = Math.max(
            MIN_OBJECT_SIZE,
            Math.min(MAX_OBJECT_SIZE, toNormalizedLength(displaySize, 'height')),
          );
          transformSelectedObject({
            metadata: nextMetadata,
            width: nextWidth,
            height: nextHeight,
          });
          return;
        }
      }
      transformSelectedObject({ metadata: nextMetadata });
    },
    [selectedObject, selectedObjectSizeValue, toNormalizedLength],
  );
  const adjustDimensionByStep = useCallback(
    (axis: 'width' | 'height', delta: number) => {
      if (!selectedObject) return;
      const currentDisplay = axis === 'width' ? selectedWidthDisplay : selectedHeightDisplay;
      if (!currentDisplay) return;
      const nextDisplay = Math.max(DIMENSION_STEP, currentDisplay + delta);
      const nextNormalized = toNormalizedLength(nextDisplay, axis);
      transformSelectedObject({
        [axis]: Math.max(MIN_OBJECT_SIZE, Math.min(MAX_OBJECT_SIZE, nextNormalized)),
      });
    },
    [selectedHeightDisplay, selectedObject, selectedWidthDisplay, toNormalizedLength],
  );
  const openSizePicker = useCallback(() => {
    if (!selectedObjectSizeValue) return;
    setPickerMode('size');
    setSizePickerValue(Number(selectedObjectSizeValue.toFixed(1)));
    setShowSizePicker(true);
  }, [selectedObjectSizeValue]);
  const openDimensionPicker = useCallback(
    (axis: 'width' | 'height') => {
      const currentValue = axis === 'width' ? selectedWidthDisplay : selectedHeightDisplay;
      if (!currentValue) return;
      setPickerMode(axis);
      setSizePickerValue(Number(currentValue.toFixed(1)));
      setShowSizePicker(true);
    },
    [selectedHeightDisplay, selectedWidthDisplay],
  );
  const applyDimensionFromPicker = useCallback(
    (axis: 'width' | 'height') => {
      if (!selectedObject) return;
      const nextNormalized = toNormalizedLength(sizePickerValue, axis);
      transformSelectedObject({
        [axis]: Math.max(MIN_OBJECT_SIZE, Math.min(MAX_OBJECT_SIZE, nextNormalized)),
      });
    },
    [selectedObject, sizePickerValue, toNormalizedLength],
  );
  const applySizeFromPicker = useCallback(() => {
    if (pickerMode === 'width' || pickerMode === 'height') {
      applyDimensionFromPicker(pickerMode);
    } else {
      applyAbsoluteSize(sizePickerValue);
    }
    setShowSizePicker(false);
  }, [applyAbsoluteSize, applyDimensionFromPicker, pickerMode, sizePickerValue]);

  React.useEffect(() => {
    if (!showSizePicker || !sizePickerListRef.current) return;
    const index = nearestSizeOptionIndex;
    requestAnimationFrame(() => {
      sizePickerListRef.current?.scrollToIndex({
        index,
        animated: false,
      });
    });
  }, [nearestSizeOptionIndex, showSizePicker]);

  const handleSizeWheelMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const index = Math.round(offsetY / SIZE_WHEEL_ROW_HEIGHT);
      const safeIndex = Math.max(0, Math.min(sizePickerOptions.length - 1, index));
      setSizePickerValue(sizePickerOptions[safeIndex]);
    },
    [sizePickerOptions],
  );
  const handleLabelDraftChange = useCallback(
    (nextValue: string) => {
      setLabelDraft(nextValue);
      if (!selectedObject) return;
      transformSelectedObject({ label: nextValue });
    },
    [selectedObject],
  );
  const setSelectedColor = useCallback(
    (color: string) => {
      if (!selectedObject) return;
      transformSelectedObject({ color });
    },
    [selectedObject],
  );
  const containerStyle = [
    styles.container,
    fullScreen ? styles.fullScreenContainer : null,
    {
      backgroundColor: transparent
        ? 'transparent'
        : fullScreen
          ? '#FFFFFF'
          : colors.backgroundMain,
    },
    typeof height === 'number' ? { height } : null,
  ];
  const overlayActions = [
    { id: 'zoom-in', label: 'Zoom in', icon: 'add' as const, onPress: () => zoomBy(ZOOM_STEP) },
    { id: 'zoom-out', label: 'Zoom out', icon: 'remove' as const, onPress: () => zoomBy(-ZOOM_STEP) },
    { id: 'undo', label: 'Undo', icon: 'arrow-undo' as const, onPress: undo, disabled: !history.length },
    { id: 'redo', label: 'Redo', icon: 'arrow-redo' as const, onPress: redo, disabled: !redoHistory.length },
  ];

  return (
    <View style={containerStyle}>
      {showHeader && (
        <View style={styles.header}>
          <Typography variant="headline" color={colors.textPrimary}>
            Edit garden objects
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Add simple vector objects, then drag, resize, rotate, or delete.
          </Typography>
        </View>
      )}

      <View
        style={[
          styles.canvas,
          fullScreen ? styles.fullScreenCanvas : null,
          transparent
            ? { backgroundColor: 'transparent', borderWidth: 0 }
            : {
                backgroundColor: fullScreen ? '#FFFFFF' : colors.backgroundSecondary,
                borderColor: colors.borderColor,
              },
        ]}
        onLayout={handleLayout}
        pointerEvents="box-none"
      >
        {/* When the host renders the satellite map underneath, the editor
            keeps its SVG positioned without any pan/pinch/rotate gesture
            wrapper so map gestures pass through to the host. Otherwise we
            wrap with the full canvas-level gesture handler. */}
        {transparent ? (
          <View style={[StyleSheet.absoluteFill]} pointerEvents="box-none">
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
            >
              {objects.map(object => (
                <GardenSvgObject
                  key={object.id}
                  object={object}
                  showLabels={showLabels}
                  selected={object.id === selectedObjectId}
                  onSelect={selectObject}
                  onLongPress={openObjectActions}
                />
              ))}
            </Svg>
          </View>
        ) : (
        <GestureDetector gesture={Gesture.Simultaneous(pinchGesture, panGesture, rotationGesture)}>
          <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
            {usesCoordinateBackground && satelliteRegion ? (
              <>
                <View style={[StyleSheet.absoluteFill, styles.coordinateBackground]} />
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <MapView
                    key={`${backgroundMode}:${boundaryGeoJson ?? 'empty'}`}
                    style={[StyleSheet.absoluteFill, { opacity: mapOpacity }]}
                    mapType={backgroundMode === 'satellite' ? 'satellite' : 'none'}
                    initialRegion={initialCamera ? undefined : satelliteRegion}
                    initialCamera={
                      initialCamera
                        ? ({
                            center: initialCamera.center,
                            // Pass the viewer's camera through verbatim (no
                            // `zoom` override — that conflicts with `altitude`
                            // on iOS MKMapView and was producing a different
                            // initial framing than the viewer).
                            altitude:
                              typeof initialCamera.altitude === 'number'
                                ? Math.max(
                                    initialCamera.altitude,
                                    SATELLITE_IOS_STABLE_ALTITUDE_FLOOR,
                                  )
                                : SATELLITE_IOS_STABLE_ALTITUDE_FLOOR,
                            heading: initialCamera.heading ?? 0,
                            pitch: initialCamera.pitch ?? 0,
                          } as Camera)
                        : undefined
                    }
                    cameraZoomRange={IOS_SATELLITE_CAMERA_ZOOM_RANGE}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    showsCompass={false}
                    showsScale={false}
                    toolbarEnabled={false}
                  >
                    <MapPolygon
                      coordinates={boundaryCoordinates}
                      fillColor={`rgba(${BOUNDARY_FILL_RGB}, ${polygonOpacity})`}
                      strokeColor={BOUNDARY_STROKE}
                      strokeWidth={2}
                    />
                  </MapView>
                </View>
              </>
            ) : backgroundImageUrl ? (
              <Image
                source={{ uri: backgroundImageUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
            ) : (
              <View
                style={[
                  styles.blankCanvas,
                  { backgroundColor: fullScreen ? '#FFFFFF' : colors.primaryLight },
                ]}
              />
            )}
            <Svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}>
              {boundaryPath && !usesCoordinateBackground ? (
                <Path
                  d={boundaryPath}
                  fill={`${colors.primary}33`}
                  stroke={colors.primary}
                  strokeWidth={10}
                />
              ) : null}
              {objects.map(object => (
                <GardenSvgObject
                  key={object.id}
                  object={object}
                  showLabels={showLabels}
                  selected={object.id === selectedObjectId}
                  onSelect={selectObject}
                  onLongPress={openObjectActions}
                />
              ))}
            </Svg>
          </Animated.View>
        </GestureDetector>
        )}

        {selectedObject && canvasSize.width > 1 && canvasSize.height > 1 ? (
          <ResizeHandlesOverlay
            selected={selectedObject}
            canvasWidth={canvasSize.width}
            canvasHeight={canvasSize.height}
            scale={scale}
            translateX={translateX}
            translateY={translateY}
            canvasRotationDeg={rotationDeg}
            onResizeStart={pushHistory}
            onResizeUpdate={changes => {
              // History was already captured in `onResizeStart`; live updates
              // skip it so a single drag produces a single undo entry.
              commitObjects(
                objects.map(object =>
                  object.id === selectedObjectId
                    ? normalizeGardenObject({ ...object, ...changes })
                    : object,
                ),
                false,
              );
            }}
          />
        ) : null}

        {!transparent && (
          <MapOverlayControls
            rightActions={overlayActions}
            showCompass={usesCoordinateBackground}
            compassRotationDegrees={headingDeg}
            onRotateLeft={() => rotateMap(-1)}
            onRotateRight={() => rotateMap(1)}
            onCompassPress={resetMapRotation}
          />
        )}
      </View>

      <View
        style={[
          styles.bottomPanel,
          {
            borderTopColor: colors.borderColor,
            backgroundColor: fullScreen ? '#FFFFFF' : colors.backgroundMain,
          },
          bottomInset > 0 ? { paddingBottom: bottomInset } : null,
          // The home indicator sits under the panel only while the keyboard is
          // down; once it is up the keypad owns that strip, so the lift replaces
          // the safe-area padding rather than stacking on top of it.
          keyboardInset > 0 ? { marginBottom: keyboardInset, paddingBottom: 0 } : null,
        ]}
      >
        <View style={styles.bottomPanelHeader}>
          <View style={styles.bottomPanelHeaderTopRow}>
            <Typography
              variant="body"
              weight="semibold"
              color={colors.textPrimary}
              style={styles.bottomPanelTitle}
            >
              Add objects
            </Typography>
            <TouchableOpacity
              style={[
                styles.moreToggleButton,
                {
                  borderColor: MAIN_ACTION_COLOR,
                  backgroundColor: MAIN_ACTION_COLOR,
                },
              ]}
              onPress={() => setShowAdvancedControls(prev => !prev)}
              activeOpacity={0.75}
            >
              <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                {showAdvancedControls ? 'Less' : 'More'}
              </Typography>
              <Icon
                name={showAdvancedControls ? 'chevron-up' : 'chevron-down'}
                size={12}
                color="#FFFFFF"
                style={styles.moreToggleChevron}
              />
            </TouchableOpacity>
          </View>
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            style={styles.bottomPanelSubtitle}
          >
            Tap object to select, then drag to move it.
          </Typography>
        </View>
        <View style={[styles.bottomPanelHeaderDivider, { backgroundColor: colors.borderColor }]} />

        <View style={styles.libraryCtaRow}>
          <TouchableOpacity
            style={[
              styles.libraryCtaButton,
              {
                backgroundColor: MAIN_ACTION_COLOR,
                borderColor: MAIN_ACTION_COLOR,
              },
            ]}
            onPress={() => setShowLibrarySheet(true)}
            activeOpacity={0.85}
          >
            <View style={styles.libraryCtaIconWrap}>
              <Typography variant="body" color="#FFFFFF" weight="semibold">
                +
              </Typography>
            </View>
            <View style={styles.libraryCtaText}>
              <Typography variant="body" color="#FFFFFF" weight="semibold">
                Browse object library
              </Typography>
              <Typography variant="caption2" color="#FFFFFF" style={styles.libraryCtaSubtitle}>
                Pool, fountain, hedge, bench…
              </Typography>
            </View>
            <Typography variant="body" color="#FFFFFF" weight="semibold">
              ›
            </Typography>
          </TouchableOpacity>
        </View>

        <View style={styles.actionRow} />
        {showAdvancedControls && (
          <>
            <View style={styles.secondaryActionRow}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                disabled={!selectedObject}
                onPress={() => scaleSelected(0.86)}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  Smaller
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                disabled={!selectedObject}
                onPress={() => scaleSelected(1.16)}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  Bigger
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                disabled={!selectedObject}
                onPress={rotateSelected}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  Rotate
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                disabled={!selectedObject}
                onPress={duplicateSelectedObject}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  Copy
                </Typography>
              </TouchableOpacity>
            </View>
            <View style={styles.colorEditor}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Object color
          </Typography>
          {/* No `automaticallyAdjustKeyboardInsets` (i.e. not `keyboardDismissScrollProps`):
              horizontal swatch strip with no fields in it — a bottom keyboard inset
              would only add dead space under the row. */}
          <ScrollView keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.colorRow}
          >
            {OBJECT_COLOR_SWATCHES.map(color => {
              const isSelectedColor =
                (selectedObject?.color ?? '#2F855A').toLowerCase() === color.toLowerCase();
              return (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorSwatchButton,
                    {
                      borderColor: isSelectedColor ? MAIN_ACTION_COLOR : colors.borderColor,
                      opacity: selectedObject ? 1 : 0.45,
                    },
                  ]}
                  onPress={() => setSelectedColor(color)}
                  disabled={!selectedObject}
                  activeOpacity={0.75}
                >
                  <View style={[styles.colorSwatchInner, { backgroundColor: color }]} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
        <View style={styles.shapeEditor}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Object shape
          </Typography>
          <View style={styles.shapeRow}>
            {(['circle', 'square', 'rectangle'] as ObjectShape[]).map(shape => {
              const isSelectedShape = selectedShape === shape;
              return (
                <TouchableOpacity
                  key={shape}
                  style={[
                    styles.shapeButton,
                    {
                      borderColor: isSelectedShape ? MAIN_ACTION_COLOR : colors.borderColor,
                      backgroundColor: isSelectedShape ? MAIN_ACTION_COLOR : colors.groupedListBackground,
                      opacity: selectedObject ? 1 : 0.45,
                    },
                  ]}
                  onPress={() => setSelectedShape(shape)}
                  disabled={!selectedObject}
                  activeOpacity={0.75}
                >
                  <Typography
                    variant="caption1"
                    weight={isSelectedShape ? 'semibold' : 'regular'}
                    color={isSelectedShape ? '#FFFFFF' : colors.textPrimary}
                  >
                    {shape.charAt(0).toUpperCase() + shape.slice(1)}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        {selectedShape !== 'rectangle' && (
          <View style={styles.sizeEditor}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Object size
            </Typography>
            <View style={styles.sizeEditorRow}>
              <TouchableOpacity
                style={[
                  styles.sizeButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                onPress={() => adjustSizeByStep(-SIZE_STEP)}
                disabled={!selectedObject}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  -
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sizeValue,
                  {
                    borderColor: colors.borderColor,
                    backgroundColor: colors.groupedListBackground,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                activeOpacity={0.75}
                onPress={openSizePicker}
                disabled={!selectedObject}
              >
                <Typography variant="caption1" color={colors.textPrimary} weight="semibold">
                  {selectedObjectSizeDisplay}
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sizeButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                    opacity: selectedObject ? 1 : 0.45,
                  },
                ]}
                onPress={() => adjustSizeByStep(SIZE_STEP)}
                disabled={!selectedObject}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  +
                </Typography>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {selectedShape === 'rectangle' && selectedObject && (
          <View style={styles.dimensionEditor}>
            <Typography variant="caption2" color={colors.textTertiary}>
              Long tap value to edit in wheel picker
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Width
            </Typography>
            <View style={styles.dimensionRow}>
              <TouchableOpacity
                style={[
                  styles.dimensionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                  },
                ]}
                onPress={() => adjustDimensionByStep('width', -DIMENSION_STEP)}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  -
                </Typography>
              </TouchableOpacity>
              <View
                style={[
                  styles.dimensionValue,
                  {
                    borderColor: colors.borderColor,
                    backgroundColor: colors.groupedListBackground,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.dimensionValueTap}
                  onLongPress={() => openDimensionPicker('width')}
                  delayLongPress={250}
                  activeOpacity={0.75}
                >
                  <Typography variant="caption1" color={colors.textPrimary} weight="semibold">
                    {selectedWidthDisplay?.toFixed(1)} {sizeDisplayUnit}
                  </Typography>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[
                  styles.dimensionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                  },
                ]}
                onPress={() => adjustDimensionByStep('width', DIMENSION_STEP)}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  +
                </Typography>
              </TouchableOpacity>
            </View>
            <Typography variant="caption1" color={colors.textSecondary}>
              Height
            </Typography>
            <View style={styles.dimensionRow}>
              <TouchableOpacity
                style={[
                  styles.dimensionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                  },
                ]}
                onPress={() => adjustDimensionByStep('height', -DIMENSION_STEP)}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  -
                </Typography>
              </TouchableOpacity>
              <View
                style={[
                  styles.dimensionValue,
                  {
                    borderColor: colors.borderColor,
                    backgroundColor: colors.groupedListBackground,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.dimensionValueTap}
                  onLongPress={() => openDimensionPicker('height')}
                  delayLongPress={250}
                  activeOpacity={0.75}
                >
                  <Typography variant="caption1" color={colors.textPrimary} weight="semibold">
                    {selectedHeightDisplay?.toFixed(1)} {sizeDisplayUnit}
                  </Typography>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[
                  styles.dimensionButton,
                  {
                    borderColor: MAIN_ACTION_COLOR,
                    backgroundColor: MAIN_ACTION_COLOR,
                  },
                ]}
                onPress={() => adjustDimensionByStep('height', DIMENSION_STEP)}
                activeOpacity={0.75}
              >
                <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                  +
                </Typography>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={styles.labelEditor}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Object name
          </Typography>
          <View style={styles.labelEditorRow}>
            <TextInput
              value={labelDraft}
              onChangeText={handleLabelDraftChange}
              placeholder="Enter object label"
              placeholderTextColor={colors.textTertiary}
              editable={Boolean(selectedObject)}
              style={[
                styles.labelInput,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.backgroundSecondary,
                  opacity: selectedObject ? 1 : 0.55,
                },
              ]}
              returnKeyType="done"
            />
          </View>
        </View>
          </>
        )}
      </View>
      <BottomSheet
        visible={showSizePicker}
        onClose={() => setShowSizePicker(false)}
        height="short"
        title={
          pickerMode === 'width'
            ? 'Select width'
            : pickerMode === 'height'
              ? 'Select height'
              : 'Select object size'
        }
        showCloseButton
      >
        <View style={styles.sizePickerContainer}>
          <FlatList
            ref={sizePickerListRef}
            data={sizePickerOptions}
            keyExtractor={item => item.toFixed(1)}
            showsVerticalScrollIndicator={false}
            snapToInterval={SIZE_WHEEL_ROW_HEIGHT}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              length: SIZE_WHEEL_ROW_HEIGHT,
              offset: SIZE_WHEEL_ROW_HEIGHT * index,
              index,
            })}
            onMomentumScrollEnd={handleSizeWheelMomentumEnd}
            initialScrollIndex={nearestSizeOptionIndex}
            renderItem={({ item }) => (
              <View style={styles.sizeWheelItem}>
                <Typography
                  variant="body"
                  weight={Math.abs(item - sizePickerValue) < 0.001 ? 'semibold' : 'regular'}
                  color={Math.abs(item - sizePickerValue) < 0.001 ? colors.primary : colors.textPrimary}
                >
                  {item.toFixed(1)} {sizeDisplayUnit}
                </Typography>
              </View>
            )}
          />
          <View style={styles.sizePickerActions}>
            <TouchableOpacity
              style={[
                styles.sizePickerActionButton,
                {
                  borderColor: MAIN_ACTION_COLOR,
                  backgroundColor: MAIN_ACTION_COLOR,
                },
              ]}
              onPress={() => setShowSizePicker(false)}
              activeOpacity={0.75}
            >
              <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                Cancel
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sizePickerActionButton, { backgroundColor: MAIN_ACTION_COLOR }]}
              onPress={applySizeFromPicker}
              activeOpacity={0.8}
            >
              <Typography variant="caption1" color="#FFFFFF" weight="semibold">
                Apply
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>
      <BottomSheet
        visible={showObjectActionsSheet}
        onClose={() => setShowObjectActionsSheet(false)}
        height="short"
        title="Object actions"
        showCloseButton
      >
        <View style={styles.objectActionsSheet}>
          <TouchableOpacity
            style={[
              styles.objectActionButton,
              {
                borderColor: MAIN_ACTION_COLOR,
                backgroundColor: MAIN_ACTION_COLOR,
              },
            ]}
            onPress={() => {
              setShowAdvancedControls(prev => !prev);
              setShowObjectActionsSheet(false);
            }}
            activeOpacity={0.8}
          >
            <Typography variant="body" color="#FFFFFF" weight="semibold">
              {showAdvancedControls ? 'Collapse bottom controls' : 'Expand bottom controls'}
            </Typography>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.objectActionButton,
              {
                borderColor: colors.error,
                backgroundColor: `${colors.error}10`,
                opacity: selectedObject ? 1 : 0.45,
              },
            ]}
            disabled={!selectedObject}
            onPress={() => {
              removeSelectedObject();
              setShowObjectActionsSheet(false);
            }}
            activeOpacity={0.8}
          >
            <Typography variant="body" color={colors.error} weight="semibold">
              Delete object
            </Typography>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.objectActionButton,
              {
                borderColor: MAIN_ACTION_COLOR,
                backgroundColor: MAIN_ACTION_COLOR,
              },
            ]}
            onPress={() => {
              setShowLabels(prev => !prev);
              setShowObjectActionsSheet(false);
            }}
            activeOpacity={0.8}
          >
            <Typography variant="body" color="#FFFFFF" weight="semibold">
              {showLabels ? 'Hide labels' : 'Show labels'}
            </Typography>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      <GardenObjectLibrarySheet
        visible={showLibrarySheet}
        onClose={() => setShowLibrarySheet(false)}
        onSelect={handleLibrarySelection}
      />
    </View>
  );
}

function GardenSvgObject({
  object,
  showLabels,
  selected,
  onSelect,
  onLongPress,
}: {
  object: GardenPlanObject;
  showLabels: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onLongPress: (id: string) => void;
}) {
  const x = object.x * CANVAS_SIZE;
  const y = object.y * CANVAS_SIZE;
  const width = object.width * CANVAS_SIZE;
  const height = object.height * CANVAS_SIZE;
  const color = object.color ?? '#2F855A';
  const transform = `translate(${x} ${y}) rotate(${object.rotation})`;
  const objectLabel = getGardenObjectDisplayLabel(object);
  const stroke = selected ? '#0EA5E9' : '#1F2937';
  const strokeWidth = selected ? 8 : 4;

  return (
    <G
      transform={transform}
      onPress={() => onSelect(object.id)}
      onLongPress={() => onLongPress(object.id)}
    >
      {renderGardenObjectBody({ object, width, height, color, stroke, strokeWidth })}
      {showLabels && object.type !== 'label' && (
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
            {objectLabel}
          </SvgText>
        </G>
      )}
      {selected && (
        <Rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          rx={18}
          fill="none"
          stroke="#0EA5E9"
          strokeWidth={6}
          strokeDasharray="14 12"
        />
      )}
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Resize handles overlay
// ────────────────────────────────────────────────────────────────────

interface ResizeHandlesOverlayProps {
  selected: GardenPlanObject;
  canvasWidth: number;
  canvasHeight: number;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  canvasRotationDeg: SharedValue<number>;
  onResizeStart: () => void;
  onResizeUpdate: (changes: Partial<GardenPlanObject>) => void;
}

function ResizeHandlesOverlay({
  selected,
  canvasWidth,
  canvasHeight,
  scale,
  translateX,
  translateY,
  canvasRotationDeg,
  onResizeStart,
  onResizeUpdate,
}: ResizeHandlesOverlayProps) {
  // Keep the *latest* `selected` and prop callbacks in refs so the gesture
  // handlers we hand to GH stay referentially stable across re-renders. This
  // matters because every `onUpdate` triggers a state change → re-render of
  // this component, and recreating Gesture.Pan() mid-drag breaks the gesture.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onResizeStartRef = useRef(onResizeStart);
  onResizeStartRef.current = onResizeStart;
  const onResizeUpdateRef = useRef(onResizeUpdate);
  onResizeUpdateRef.current = onResizeUpdate;
  const startSnapshot = useRef<GardenPlanObject | null>(null);
  const rotationStart = useRef<{
    startRotation: number;
    objCenterX: number;
    objCenterY: number;
    startHandleX: number;
    startHandleY: number;
    /**
     * Accumulated rotation delta (degrees) since gesture start. Tracked
     * incrementally to support unbounded rotation and to avoid the ±π jump
     * in atan2 when the handle crosses the negative-x axis.
     */
    accumulatedDeltaDeg: number;
    lastAngleRad: number;
  } | null>(null);

  // SVG renders with `preserveAspectRatio="xMidYMid meet"` so the 1000×1000
  // viewBox is centered into the largest square that fits the canvas.
  const svgSize = Math.max(1, Math.min(canvasWidth, canvasHeight));
  const svgOffsetX = (canvasWidth - svgSize) / 2;
  const svgOffsetY = (canvasHeight - svgSize) / 2;

  const beginResize = useCallback(() => {
    startSnapshot.current = { ...selectedRef.current };
    onResizeStartRef.current();
  }, []);

  const updateResize = useCallback(
    (corner: ResizeCorner, dxNorm: number, dyNorm: number) => {
      const start = startSnapshot.current;
      if (!start) return;
      onResizeUpdateRef.current(applyCornerResize(start, corner, dxNorm, dyNorm));
    },
    [],
  );

  const endResize = useCallback(() => {
    startSnapshot.current = null;
  }, []);

  const beginRotation = useCallback(
    (objCenterX: number, objCenterY: number, startHandleX: number, startHandleY: number) => {
      const startAngleRad = Math.atan2(startHandleY - objCenterY, startHandleX - objCenterX);
      rotationStart.current = {
        startRotation: selectedRef.current.rotation,
        objCenterX,
        objCenterY,
        startHandleX,
        startHandleY,
        accumulatedDeltaDeg: 0,
        lastAngleRad: startAngleRad,
      };
      onResizeStartRef.current();
    },
    [],
  );

  const updateRotation = useCallback((tx: number, ty: number) => {
    const start = rotationStart.current;
    if (!start) return;
    const cx = start.startHandleX + tx;
    const cy = start.startHandleY + ty;
    const currentAngleRad = Math.atan2(cy - start.objCenterY, cx - start.objCenterX);
    // Shortest-arc delta in [-π, π]; accumulating these handles the atan2
    // wrap so the user can spin past 180° without a visible jump.
    let stepRad = currentAngleRad - start.lastAngleRad;
    if (stepRad > Math.PI) stepRad -= 2 * Math.PI;
    else if (stepRad < -Math.PI) stepRad += 2 * Math.PI;
    start.accumulatedDeltaDeg += (stepRad * 180) / Math.PI;
    start.lastAngleRad = currentAngleRad;
    onResizeUpdateRef.current({ rotation: start.startRotation + start.accumulatedDeltaDeg });
  }, []);

  const endRotation = useCallback(() => {
    rotationStart.current = null;
  }, []);

  return (
    <>
      {RESIZE_CORNERS.map(corner => (
        <ResizeHandle
          key={corner}
          corner={corner}
          selected={selected}
          svgSize={svgSize}
          svgOffsetX={svgOffsetX}
          svgOffsetY={svgOffsetY}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          scale={scale}
          translateX={translateX}
          translateY={translateY}
          canvasRotationDeg={canvasRotationDeg}
          onBegin={beginResize}
          onUpdate={updateResize}
          onEnd={endResize}
        />
      ))}
      <RotationHandle
        selected={selected}
        svgSize={svgSize}
        svgOffsetX={svgOffsetX}
        svgOffsetY={svgOffsetY}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        scale={scale}
        translateX={translateX}
        translateY={translateY}
        canvasRotationDeg={canvasRotationDeg}
        onBegin={beginRotation}
        onUpdate={updateRotation}
        onEnd={endRotation}
      />
    </>
  );
}

interface ResizeHandleProps {
  corner: ResizeCorner;
  selected: GardenPlanObject;
  svgSize: number;
  svgOffsetX: number;
  svgOffsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  canvasRotationDeg: SharedValue<number>;
  onBegin: () => void;
  onUpdate: (corner: ResizeCorner, dxNorm: number, dyNorm: number) => void;
  onEnd: () => void;
}

function ResizeHandle({
  corner,
  selected,
  svgSize,
  svgOffsetX,
  svgOffsetY,
  canvasWidth,
  canvasHeight,
  scale,
  translateX,
  translateY,
  canvasRotationDeg,
  onBegin,
  onUpdate,
  onEnd,
}: ResizeHandleProps) {
  const { x: xSign, y: ySign } = CORNER_SIGNS[corner];
  const thetaRad = (selected.rotation * Math.PI) / 180;
  const cosT = Math.cos(thetaRad);
  const sinT = Math.sin(thetaRad);

  const centerXpx = svgOffsetX + selected.x * svgSize;
  const centerYpx = svgOffsetY + selected.y * svgSize;
  const localX = (xSign * selected.width * svgSize) / 2;
  const localY = (ySign * selected.height * svgSize) / 2;
  // Corner position in canvas-frame px (object's own rotation only).
  const cornerXpx = centerXpx + cosT * localX - sinT * localY;
  const cornerYpx = centerYpx + sinT * localX + cosT * localY;

  const animatedStyle = useAnimatedStyle(() => {
    // Apply canvas rotation around the canvas center, then pan/zoom.
    const phi = (canvasRotationDeg.value * Math.PI) / 180;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const dx = cornerXpx - cx;
    const dy = cornerYpx - cy;
    const rotatedX = cx + dx * cosP - dy * sinP;
    const rotatedY = cy + dx * sinP + dy * cosP;
    const sx = cx + (rotatedX - cx) * scale.value + translateX.value;
    const sy = cy + (rotatedY - cy) * scale.value + translateY.value;
    return {
      transform: [
        { translateX: sx - HANDLE_HALF_TOUCH },
        { translateY: sy - HANDLE_HALF_TOUCH },
      ],
    };
  });

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          runOnJS(onBegin)();
        })
        .onUpdate(event => {
          const denom = svgSize * scale.value;
          if (denom <= 0) return;
          // Counter-rotate screen-px delta into canvas frame so resize math
          // stays correct when the canvas itself is rotated.
          const phi = (-canvasRotationDeg.value * Math.PI) / 180;
          const cosP = Math.cos(phi);
          const sinP = Math.sin(phi);
          const localTx = event.translationX * cosP - event.translationY * sinP;
          const localTy = event.translationX * sinP + event.translationY * cosP;
          const dxNorm = localTx / denom;
          const dyNorm = localTy / denom;
          runOnJS(onUpdate)(corner, dxNorm, dyNorm);
        })
        .onFinalize(() => {
          runOnJS(onEnd)();
        }),
    [corner, svgSize, scale, canvasRotationDeg, onBegin, onUpdate, onEnd],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.resizeHandleHit, animatedStyle]}>
        <View
          style={[
            styles.resizeHandleVisual,
            { transform: [{ rotate: `${selected.rotation}deg` }] },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

interface RotationHandleProps {
  selected: GardenPlanObject;
  svgSize: number;
  svgOffsetX: number;
  svgOffsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  canvasRotationDeg: SharedValue<number>;
  /** All position arguments are in canvas-container layout pixels. */
  onBegin: (
    objCenterX: number,
    objCenterY: number,
    startHandleX: number,
    startHandleY: number,
  ) => void;
  onUpdate: (translationX: number, translationY: number) => void;
  onEnd: () => void;
}

function RotationHandle({
  selected,
  svgSize,
  svgOffsetX,
  svgOffsetY,
  canvasWidth,
  canvasHeight,
  scale,
  translateX,
  translateY,
  canvasRotationDeg,
  onBegin,
  onUpdate,
  onEnd,
}: RotationHandleProps) {
  const thetaRad = (selected.rotation * Math.PI) / 180;
  const cosT = Math.cos(thetaRad);
  const sinT = Math.sin(thetaRad);

  const centerXpx = svgOffsetX + selected.x * svgSize;
  const centerYpx = svgOffsetY + selected.y * svgSize;

  // Handle sits directly above the top-center of the bbox, in the object's
  // local frame (so it rotates with the object).
  const handleLocalX = 0;
  const handleLocalY = -(selected.height * svgSize) / 2 - ROTATION_HANDLE_GAP_PX;
  const handleXpx = centerXpx + cosT * handleLocalX - sinT * handleLocalY;
  const handleYpx = centerYpx + sinT * handleLocalX + cosT * handleLocalY;

  // Apply canvas rotation around the canvas center, then pan/zoom.
  const projectScreen = (xpx: number, ypx: number) => {
    'worklet';
    const phi = (canvasRotationDeg.value * Math.PI) / 180;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const dx = xpx - cx;
    const dy = ypx - cy;
    const rotatedX = cx + dx * cosP - dy * sinP;
    const rotatedY = cy + dx * sinP + dy * cosP;
    const sx = cx + (rotatedX - cx) * scale.value + translateX.value;
    const sy = cy + (rotatedY - cy) * scale.value + translateY.value;
    return { sx, sy };
  };

  const animatedStyle = useAnimatedStyle(() => {
    const { sx, sy } = projectScreen(handleXpx, handleYpx);
    return {
      transform: [
        { translateX: sx - HANDLE_HALF_TOUCH },
        { translateY: sy - HANDLE_HALF_TOUCH },
      ],
    };
  });

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          // Both points are computed in canvas-container layout px, the same
          // frame that gesture `translationX/Y` deltas use, so JS-side angle
          // math just works without measuring the canvas in screen coords.
          const center = projectScreen(centerXpx, centerYpx);
          const start = projectScreen(handleXpx, handleYpx);
          runOnJS(onBegin)(center.sx, center.sy, start.sx, start.sy);
        })
        .onUpdate(event => {
          runOnJS(onUpdate)(event.translationX, event.translationY);
        })
        .onFinalize(() => {
          runOnJS(onEnd)();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      centerXpx,
      centerYpx,
      handleXpx,
      handleYpx,
      canvasWidth,
      canvasHeight,
      scale,
      translateX,
      translateY,
      canvasRotationDeg,
      onBegin,
      onUpdate,
      onEnd,
    ],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.resizeHandleHit, animatedStyle]}>
        <View style={styles.rotationHandleVisual} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fullScreenContainer: {
    backgroundColor: '#FFFFFF',
  },
  header: {
    gap: Spacing.xs,
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
  },
  resizeHandleHit: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: HANDLE_TOUCH_SIZE,
    height: HANDLE_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resizeHandleVisual: {
    width: HANDLE_VISUAL_SIZE,
    height: HANDLE_VISUAL_SIZE,
    borderRadius: HANDLE_VISUAL_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#0EA5E9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  rotationHandleVisual: {
    width: HANDLE_VISUAL_SIZE,
    height: HANDLE_VISUAL_SIZE,
    borderRadius: HANDLE_VISUAL_SIZE / 2,
    backgroundColor: '#0EA5E9',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
  },
  coordinateBackground: {
    backgroundColor: '#FFFFFF',
  },
  fullScreenCanvas: {
    borderRadius: 0,
    borderWidth: 0,
  },
  blankCanvas: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ECFDF5',
  },
  libraryCtaRow: {
    paddingTop: 12,
    paddingBottom: 2,
  },
  libraryCtaButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  libraryCtaIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  libraryCtaText: {
    flex: 1,
    gap: 1,
  },
  libraryCtaSubtitle: {
    opacity: 0.85,
  },
  bottomPanel: {
    borderTopWidth: 1,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.lg + 25,
    paddingHorizontal: Spacing.md,
    gap: Spacing.xs,
  },
  bottomPanelHeader: {
    gap: 2,
  },
  bottomPanelHeaderTopRow: {
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  bottomPanelTitle: {
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 20,
  },
  bottomPanelSubtitle: {
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 13,
  },
  bottomPanelHeaderDivider: {
    height: 1,
    width: '100%',
  },
  moreToggleButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xxs,
  },
  moreToggleChevron: {
    marginTop: -1,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingBottom: 1,
  },
  secondaryActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  actionButton: {
    minHeight: 32,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.sm + 2,
  },
  colorEditor: {
    gap: Spacing.xs,
  },
  colorRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  colorSwatchButton: {
    width: 34,
    height: 34,
    borderWidth: 2,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  colorSwatchInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  shapeEditor: {
    gap: Spacing.xs,
  },
  shapeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  shapeButton: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  labelEditor: {
    gap: Spacing.xs,
  },
  sizeEditor: {
    gap: Spacing.xs,
  },
  sizeEditorRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  sizeButton: {
    minHeight: 40,
    minWidth: 72,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sizeValue: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  sizePickerContainer: {
    flex: 1,
    gap: Spacing.sm,
  },
  sizeWheelItem: {
    height: SIZE_WHEEL_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizePickerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  sizePickerActionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  objectActionsSheet: {
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  objectActionButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  dimensionEditor: {
    gap: Spacing.xs,
  },
  dimensionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dimensionButton: {
    minHeight: 40,
    minWidth: 72,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  dimensionValue: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  dimensionValueTap: {
    minHeight: 38,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.sm,
    fontSize: 15,
  },
});

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
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

    const coordinates: LatLng[] = [];
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      coordinates.push({ latitude: lat, longitude: lon });
    }
    return coordinates;
  } catch {
    return [];
  }
}

function regionFromCoordinates(coordinates: LatLng[]): Region | null {
  if (coordinates.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const coordinate of coordinates) {
    minLat = Math.min(minLat, coordinate.latitude);
    maxLat = Math.max(maxLat, coordinate.latitude);
    minLon = Math.min(minLon, coordinate.longitude);
    maxLon = Math.max(maxLon, coordinate.longitude);
  }

  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return null;

  const latitudeDelta = Math.max((maxLat - minLat) / SATELLITE_REGION_PADDING, SATELLITE_MIN_DELTA);
  const longitudeDelta = Math.max((maxLon - minLon) / SATELLITE_REGION_PADDING, SATELLITE_MIN_DELTA);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}
