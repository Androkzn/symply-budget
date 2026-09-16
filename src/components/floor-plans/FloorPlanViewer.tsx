import type { GardenPlanObject } from '@models/garden-objects';
import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Image, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import Svg, { G, Path, Rect, SvgUri, Text as SvgText } from 'react-native-svg';

import type { FloorPlanMarker } from '@api/floor-plans';
import { MapOverlayControls } from '@components/common/house';
import {
  getGardenObjectDisplayLabel,
  renderGardenObjectBody,
} from '@components/garden/GardenObjectRenderer';
import { useAppColors } from '@theme';

import { MarkerPin } from './MarkerPin';

const MAX_SCALE = 6.5;
const ZOOM_STEP = 0.5;
const ROTATION_STEP = 15;

// Pending marker shown immediately on tap before task is linked
export interface PendingMarker {
  x: number;
  y: number;
  xPercent: number;
  yPercent: number;
}

interface FloorPlanViewerProps {
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  markers?: FloorPlanMarker[];
  gardenObjects?: GardenPlanObject[];
  showBackgroundImage?: boolean;
  boundaryGeoJson?: string | null;
  pendingMarker?: PendingMarker | null;
  taskCategories?: Record<string, string | null>; // Map of task ID to system_category
  onMarkerPress?: (marker: FloorPlanMarker) => void;
  onPlanPress?: (x: number, y: number, xPercent: number, yPercent: number) => void;
  onBoundaryLongPress?: (xPercent: number, yPercent: number) => void;
  interactive?: boolean;
  controlsTopInset?: number;
  initialZoomMultiplier?: number;
  /** When true, no canvas rotation or compass (top-down 2D) — e.g. yard plans */
  flatCanvas?: boolean;
}

export function FloorPlanViewer({
  imageUrl,
  imageWidth,
  imageHeight = 300,
  markers = [],
  gardenObjects = [],
  showBackgroundImage = true,
  boundaryGeoJson = null,
  pendingMarker,
  taskCategories = {},
  onMarkerPress,
  onPlanPress,
  onBoundaryLongPress,
  interactive = true,
  controlsTopInset = 0,
  initialZoomMultiplier = 1,
  flatCanvas = false,
}: FloorPlanViewerProps) {
  const colors = useAppColors();  const { width: windowWidth } = useWindowDimensions();
  const initialImageWidth = imageWidth ?? windowWidth;
  const [dimensions, setDimensions] = useState({ width: initialImageWidth, height: imageHeight });
  const [containerSize, setContainerSize] = useState({ width: windowWidth, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const isSvg = imageUrl.toLowerCase().includes('.svg');
  const fallbackBoundary = useMemo(() => {
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
        .map((coord) => {
          if (!Array.isArray(coord) || coord.length < 2) return null;
          const lon = Number(coord[0]);
          const lat = Number(coord[1]);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
          return { lon, lat };
        })
        .filter((point): point is { lon: number; lat: number } => point !== null);

      if (points.length < 4) return null;

      // Project lon/lat to metres using an equirectangular projection
      // anchored at the polygon's mean latitude. This preserves the real
      // aspect ratio of the parcel (1 unit X = 1 unit Y in metres), so the
      // shape doesn't get stretched independently on each axis.
      const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
      const metresPerDegLat = 111_320;
      const metresPerDegLon = 111_320 * Math.cos((meanLat * Math.PI) / 180);

      const metric = points.map((point) => ({
        x: point.lon * metresPerDegLon,
        // Flip Y so that increasing latitude (north) renders upward.
        y: -point.lat * metresPerDegLat,
      }));

      const xs = metric.map((p) => p.x);
      const ys = metric.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const widthM = Math.max(maxX - minX, 0.000001);
      const heightM = Math.max(maxY - minY, 0.000001);

      // Uniform fit (letterbox) into the 1000x1000 viewBox so we keep the
      // true aspect ratio instead of stretching to fill both axes.
      const VIEWBOX = 1000;
      const PADDING = 0; // leave a small margin around the polygon
      const usable = VIEWBOX - PADDING * 2;
      const scale = Math.min(usable / widthM, usable / heightM);
      const offsetX = (VIEWBOX - widthM * scale) / 2;
      const offsetY = (VIEWBOX - heightM * scale) / 2;

      const scaledPoints = metric.map((point) => ({
        x: (point.x - minX) * scale + offsetX,
        y: (point.y - minY) * scale + offsetY,
      }));

      if (scaledPoints.length < 3) return null;
      const [first, ...rest] = scaledPoints;
      return {
        path: `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z`,
        points: scaledPoints,
      };
    } catch {
      return null;
    }
  }, [boundaryGeoJson]);
  const toImageCoordinates = useCallback(
    (eventX: number, eventY: number) => {
      const s = savedScale.value;
      const tx = savedTranslateX.value;
      const ty = savedTranslateY.value;
      const rotationRadians = ((flatCanvas ? 0 : savedRotation.value) * Math.PI) / 180;
      const containerCenterX = containerSize.width / 2;
      const containerCenterY = containerSize.height / 2;
      const translatedX = eventX - containerCenterX - tx;
      const translatedY = eventY - containerCenterY - ty;
      const scaledX = translatedX / s;
      const scaledY = translatedY / s;
      const cosTheta = Math.cos(-rotationRadians);
      const sinTheta = Math.sin(-rotationRadians);
      const unrotatedX = scaledX * cosTheta - scaledY * sinTheta;
      const unrotatedY = scaledX * sinTheta + scaledY * cosTheta;
      const imageX = unrotatedX + dimensions.width / 2;
      const imageY = unrotatedY + dimensions.height / 2;
      const xPercent = imageX / dimensions.width;
      const yPercent = imageY / dimensions.height;
      return { imageX, imageY, xPercent, yPercent, scale: s, tx, ty };
    },
    [containerSize.height, containerSize.width, dimensions.height, dimensions.width, flatCanvas],
  );

  
  // Track current scale for marker sizing (React state for re-renders)
  const [currentScale, setCurrentScale] = useState(1);
  const [rotationDegrees, setRotationDegrees] = useState(0);
  const minScale = React.useMemo(() => {
    if (
      containerSize.width <= 0 ||
      containerSize.height <= 0 ||
      dimensions.width <= 0 ||
      dimensions.height <= 0
    ) {
      return 1;
    }
    const fitWidth = containerSize.width / dimensions.width;
    const fitHeight = containerSize.height / dimensions.height;
    return Math.min(1, Math.min(fitWidth, fitHeight));
  }, [containerSize.height, containerSize.width, dimensions.height, dimensions.width]);
  const initialScale = React.useMemo(
    () => Math.min(MAX_SCALE, Math.max(minScale, minScale * initialZoomMultiplier)),
    [initialZoomMultiplier, minScale],
  );

  React.useEffect(() => {
    if (initialScale <= 0 || !Number.isFinite(initialScale)) return;
    scale.value = initialScale;
    savedScale.value = initialScale;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setCurrentScale(initialScale);
  }, [initialScale]);

  // Animation values
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const rotation = useSharedValue(0);
  const savedRotation = useSharedValue(0);

  // Handle image load to get actual dimensions
  const handleImageLoad = (event: any) => {
    const { width, height } = event.nativeEvent.source;
    setImageNaturalSize({ width, height });
  };

  // Recalculate dimensions when container size or image natural size changes
  React.useEffect(() => {
    if (containerSize.height === 0) return;

    const sourceWidth = imageNaturalSize?.width ?? initialImageWidth;
    const sourceHeight = imageNaturalSize?.height ?? imageHeight;
    const aspectRatio = sourceWidth / sourceHeight;
    const maxWidth = containerSize.width;
    const maxHeight = containerSize.height;

    // Use "cover" behavior so the plan fills the full viewer area.
    let newWidth = maxWidth;
    let newHeight = maxWidth / aspectRatio;

    if (newHeight < maxHeight) {
      newHeight = maxHeight;
      newWidth = maxHeight * aspectRatio;
    }

    setDimensions({ width: newWidth, height: newHeight });
  }, [imageHeight, imageNaturalSize, initialImageWidth, containerSize]);

  // Clamp translation to prevent over-panning while allowing movement
  // when the base image already overflows due to cover sizing.
  const clampTranslation = (
    translation: number,
    contentDimension: number,
    viewportDimension: number,
    currentScaleValue: number
  ) => {
    'worklet';
    const scaledContent = contentDimension * currentScaleValue;
    const maxTranslation = Math.max(0, (scaledContent - viewportDimension) / 2);
    return Math.max(-maxTranslation, Math.min(maxTranslation, translation));
  };

  // Update React state for marker sizing
  const updateCurrentScale = useCallback((newScale: number) => {
    setCurrentScale(newScale);
  }, []);

  // Pinch gesture
  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      const newScale = savedScale.value * event.scale;
      scale.value = Math.max(minScale, Math.min(MAX_SCALE, newScale));

      // Adjust translation to keep the pinch centered
      // Use image dimensions center, not screen center, for consistency
      const scaleDiff = scale.value - savedScale.value;
      const focalX = event.focalX - dimensions.width / 2;
      const focalY = event.focalY - dimensions.height / 2;
      translateX.value = savedTranslateX.value - focalX * scaleDiff;
      translateY.value = savedTranslateY.value - focalY * scaleDiff;

      // Clamp translation
      translateX.value = clampTranslation(
        translateX.value,
        dimensions.width,
        containerSize.width,
        scale.value
      );
      translateY.value = clampTranslation(
        translateY.value,
        dimensions.height,
        containerSize.height,
        scale.value
      );
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(updateCurrentScale)(scale.value);
    });

  // Pan gesture - allow panning when zoomed in
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value > minScale + 0.0001) {
        translateX.value = clampTranslation(
          savedTranslateX.value + event.translationX,
          dimensions.width,
          containerSize.width,
          scale.value
        );
        translateY.value = clampTranslation(
          savedTranslateY.value + event.translationY,
          dimensions.height,
          containerSize.height,
          scale.value
        );
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Smooth zoom animation config (no bounce)
  const zoomTimingConfig = { duration: 200, easing: Easing.out(Easing.ease) };

  // Zoom in button handler
  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(MAX_SCALE, savedScale.value + ZOOM_STEP);
    scale.value = withTiming(newScale, zoomTimingConfig);
    savedScale.value = newScale;
    setCurrentScale(newScale);
    // Clamp translations for new scale
    const newTx = clampTranslation(
      savedTranslateX.value,
      dimensions.width,
      containerSize.width,
      newScale
    );
    const newTy = clampTranslation(
      savedTranslateY.value,
      dimensions.height,
      containerSize.height,
      newScale
    );
    translateX.value = withTiming(newTx, zoomTimingConfig);
    translateY.value = withTiming(newTy, zoomTimingConfig);
    savedTranslateX.value = newTx;
    savedTranslateY.value = newTy;
  }, [dimensions]);

  // Zoom out button handler
  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(minScale, savedScale.value - ZOOM_STEP);
    scale.value = withTiming(newScale, zoomTimingConfig);
    savedScale.value = newScale;
    setCurrentScale(newScale);
    // Reset position when zooming out to minimum
    if (Math.abs(newScale - minScale) < 0.0001) {
      translateX.value = withTiming(0, zoomTimingConfig);
      translateY.value = withTiming(0, zoomTimingConfig);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    } else {
      // Clamp translations for new scale
      const newTx = clampTranslation(
        savedTranslateX.value,
        dimensions.width,
        containerSize.width,
        newScale
      );
      const newTy = clampTranslation(
        savedTranslateY.value,
        dimensions.height,
        containerSize.height,
        newScale
      );
      translateX.value = withTiming(newTx, zoomTimingConfig);
      translateY.value = withTiming(newTy, zoomTimingConfig);
      savedTranslateX.value = newTx;
      savedTranslateY.value = newTy;
    }
  }, [containerSize.height, containerSize.width, dimensions, minScale]);

  // Reset to initial position handler
  const handleReset = useCallback(() => {
    scale.value = withTiming(initialScale, zoomTimingConfig);
    translateX.value = withTiming(0, zoomTimingConfig);
    translateY.value = withTiming(0, zoomTimingConfig);
    rotation.value = withTiming(0, zoomTimingConfig);
    savedScale.value = initialScale;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    savedRotation.value = 0;
    setCurrentScale(initialScale);
    setRotationDegrees(0);
  }, [initialScale]);

  const handleRotate = useCallback((direction: -1 | 1) => {
    const nextRotation = (savedRotation.value + ROTATION_STEP * direction + 360) % 360;
    rotation.value = withTiming(nextRotation, zoomTimingConfig);
    savedRotation.value = nextRotation;
    setRotationDegrees(nextRotation);
  }, []);

  const handleResetRotation = useCallback(() => {
    rotation.value = withTiming(0, zoomTimingConfig);
    savedRotation.value = 0;
    setRotationDegrees(0);
  }, []);

  const overlayActions = useMemo(
    () => [
      { id: 'zoom-in', label: '+', onPress: handleZoomIn },
      { id: 'reset-view', label: 'Home', icon: 'home' as const, onPress: handleReset },
      { id: 'zoom-out', label: '−', onPress: handleZoomOut },
    ],
    [handleZoomIn, handleReset, handleZoomOut]
  );

  // Double tap to zoom
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      if (scale.value > minScale + 0.0001) {
        // Zoom out
        scale.value = withSpring(minScale);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedScale.value = minScale;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(updateCurrentScale)(minScale);
      } else {
        // Zoom in to 2x at tap location
        const newScale = 2;
        const focalX = event.x - dimensions.width / 2;
        const focalY = event.y - dimensions.height / 2;

        scale.value = withSpring(newScale);
        translateX.value = withSpring(-focalX * (newScale - 1));
        translateY.value = withSpring(-focalY * (newScale - 1));
        savedScale.value = newScale;
        runOnJS(updateCurrentScale)(newScale);
        savedTranslateX.value = -focalX * (newScale - 1);
        savedTranslateY.value = -focalY * (newScale - 1);
      }
    });

  // Single tap for placing markers - works at any zoom level
  const tapGesture = Gesture.Tap()
    .onEnd((event) => {
      if (!onPlanPress) return;
      const { imageX, imageY, xPercent, yPercent, scale: s, tx, ty } = toImageCoordinates(
        event.x,
        event.y,
      );
      
      console.log('[FloorPlanViewer] Tap debug:', {
        eventXY: { x: event.x, y: event.y },
        dimensions,
        scale: s,
        translate: { x: tx, y: ty },
        rotationDegrees: savedRotation.value,
        imageXY: { x: imageX, y: imageY },
        percent: { x: xPercent, y: yPercent },
      });
      
      // Clamp to valid range (0-1)
      if (xPercent < 0 || xPercent > 1 || yPercent < 0 || yPercent > 1) {
        console.log('[FloorPlanViewer] Tap outside image bounds');
        return;
      }

      runOnJS(onPlanPress)(imageX, imageY, xPercent, yPercent);
    });

  const boundaryLongPressGesture = Gesture.LongPress()
    .minDuration(320)
    .maxDistance(24)
    .onEnd((event, success) => {
      if (!success || !onBoundaryLongPress || !fallbackBoundary?.points?.length) return;
      const { xPercent, yPercent } = toImageCoordinates(event.x, event.y);
      if (xPercent < 0 || xPercent > 1 || yPercent < 0 || yPercent > 1) return;
      const hitPoint = { x: xPercent * 1000, y: yPercent * 1000 };
      if (!isPointInPolygon(hitPoint, fallbackBoundary.points)) return;
      runOnJS(onBoundaryLongPress)(xPercent, yPercent);
    });

  // Compose gestures
  const composed = interactive
    ? Gesture.Simultaneous(
        Gesture.Exclusive(doubleTapGesture, boundaryLongPressGesture, tapGesture),
        Gesture.Simultaneous(pinchGesture, panGesture)
      )
    : Gesture.Tap().onEnd(() => {});

  // Animated style — garden / yard plans use flatCanvas (no rotateZ) for a true top-down 2D view
  const animatedStyle = useAnimatedStyle(() => ({
    transform: flatCanvas
      ? [
          { scale: scale.value },
          { translateX: translateX.value },
          { translateY: translateY.value },
        ]
      : [
          { rotateZ: `${rotation.value}deg` },
          { scale: scale.value },
          { translateX: translateX.value },
          { translateY: translateY.value },
        ],
  }));

  return (
    <View 
      style={[styles.container, { backgroundColor: colors.backgroundMain }]}
      onLayout={(e) => {
        setContainerSize({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        });
      }}
    >
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.imageContainer, { width: dimensions.width, height: dimensions.height }]}>
          <Animated.View style={animatedStyle}>
            {showBackgroundImage ? (
              isSvg ? (
                <SvgUri
                  uri={imageUrl}
                  width={dimensions.width}
                  height={dimensions.height}
                />
              ) : (
                <Image
                  source={{ uri: imageUrl }}
                  style={{ width: dimensions.width, height: dimensions.height }}
                  resizeMode="contain"
                  onLoad={handleImageLoad}
                />
              )
            ) : (
              <View style={{ width: dimensions.width, height: dimensions.height }} />
            )}

            {!showBackgroundImage && fallbackBoundary?.path && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Svg width={dimensions.width} height={dimensions.height} viewBox="0 0 1000 1000">
                  <Path
                    d={fallbackBoundary.path}
                    fill="#DBEFD3"
                    stroke="#3F8F54"
                    strokeWidth={8}
                  />
                </Svg>
              </View>
            )}

            {gardenObjects.length > 0 && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Svg width={dimensions.width} height={dimensions.height} viewBox="0 0 1000 1000">
                  {gardenObjects.map(object => (
                    <GardenObjectOverlay key={object.id} object={object} />
                  ))}
                </Svg>
              </View>
            )}

            {/* Markers */}
            {markers.map((marker) => {
              // Backend stores 0-100, convert to 0-1 for positioning
              const x = (marker.x_percent / 100) * dimensions.width;
              const y = (marker.y_percent / 100) * dimensions.height;

              // Pin markers have offset for the pointer, other markers are centered
              // Offsets scale with zoom for precise placement
              const isPinMarker = marker.marker_type === 'pin';
              const markerSize = Math.max(isPinMarker ? 16 : 10, (isPinMarker ? 32 : 28) / currentScale);
              const offsetX = -markerSize / 2;
              const offsetY = isPinMarker ? -markerSize * 1.2 : -markerSize / 2;

              return (
                <View
                  key={marker.id}
                  style={[
                    styles.markerContainer,
                    {
                      left: x,
                      top: y,
                      zIndex: 1000,
                      transform: [{ translateX: offsetX }, { translateY: offsetY }],
                    },
                  ]}
                >
                  <MarkerPin
                    marker={marker}
                    scale={currentScale}
                    taskCategory={taskCategories[marker.linked_entity_id]}
                    onPress={() => {
                      console.log('[FloorPlanViewer] Marker pressed:', marker.id);
                      onMarkerPress?.(marker);
                    }}
                  />
                </View>
              );
            })}

            {/* Pending marker - shows immediately on tap before task is linked */}
            {pendingMarker && (() => {
              // Scale pending marker with zoom for precise placement
              const pendingSize = Math.max(10, 28 / currentScale);
              const pendingOffset = -pendingSize / 2;
              const innerSize = Math.max(4, 8 / currentScale);
              const borderWidth = Math.max(1, 2 / currentScale);
              
              return (
                <View
                  style={[
                    styles.markerContainer,
                    {
                      left: pendingMarker.xPercent * dimensions.width,
                      top: pendingMarker.yPercent * dimensions.height,
                      zIndex: 1001,
                      transform: [{ translateX: pendingOffset }, { translateY: pendingOffset }],
                    },
                  ]}
                  pointerEvents="none"
                >
                  <View style={[
                    styles.pendingMarker,
                    {
                      backgroundColor: `${colors.primary}33`,
                      borderColor: colors.primary,
                      width: pendingSize,
                      height: pendingSize,
                      borderRadius: pendingSize / 2,
                      borderWidth: borderWidth,
                    }
                  ]}>
                    <View style={[
                      styles.pendingMarkerInner,
                      {
                        backgroundColor: colors.primary,
                        width: innerSize,
                        height: innerSize,
                        borderRadius: innerSize / 2,
                      }
                    ]} />
                  </View>
                </View>
              );
            })()}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      {interactive && (
        <MapOverlayControls
          rightActions={overlayActions}
          topInset={controlsTopInset}
          showCompass={!flatCanvas}
          compassRotationDegrees={rotationDegrees}
          onRotateLeft={flatCanvas ? undefined : () => handleRotate(-1)}
          onRotateRight={flatCanvas ? undefined : () => handleRotate(1)}
          onCompassPress={flatCanvas ? undefined : handleResetRotation}
        />
      )}
    </View>
  );
}

function GardenObjectOverlay({ object }: { object: GardenPlanObject }) {
  const x = object.x * 1000;
  const y = object.y * 1000;
  const width = object.width * 1000;
  const height = object.height * 1000;
  const color = object.color ?? '#2F855A';
  const objectLabel = getGardenObjectDisplayLabel(object);

  return (
    <G transform={`translate(${x} ${y}) rotate(${object.rotation})`}>
      {renderGardenObjectBody({ object, width, height, color })}
      {object.type !== 'label' && (
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
    </G>
  );
}

function isPointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 0.0000001) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  imageContainer: {
    overflow: 'hidden',
  },
  markerContainer: {
    position: 'absolute',
  },
  pendingMarker: {
    justifyContent: 'center',
    alignItems: 'center',
    borderStyle: 'dashed',
  },
  pendingMarkerInner: {},
});
