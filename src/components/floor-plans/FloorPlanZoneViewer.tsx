import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StyleSheet, View, Image, Text, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { SvgUri } from 'react-native-svg';

import type { FloorPlanMarker, BoundingBox } from '@api/floor-plans';
import { MapOverlayControls } from '@components/common/house';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAppColors } from '@theme';
import type { AppColors } from '@theme';

import type { PendingMarker } from './FloorPlanViewer';
import { MarkerPin } from './MarkerPin';

const MIN_SCALE = 1;
const MAX_SCALE = 6.5;
const ZOOM_STEP = 0.5;

interface FloorPlanZoneViewerProps {
  imageUrl: string;
  // Bounding box for the zone to display (normalized 0-1 coordinates)
  boundingBox?: BoundingBox | null;
  // Pre-cropped region raster (skips bbox zoom when set)
  cropImageUrl?: string | null;
  // Visual vector replica (preferred background when set)
  vectorTraceUrl?: string | null;
  // Semantic SVG overlay (rooms/walls/doors)
  vectorSemanticUrl?: string | null;
  // All markers for the floor plan
  markers?: FloorPlanMarker[];
  // Pending marker shown immediately on tap
  pendingMarker?: PendingMarker | null;
  // Map of task ID to system_category for task-specific icons
  taskCategories?: Record<string, string | null>;
  onMarkerPress?: (marker: FloorPlanMarker) => void;
  onPlanPress?: (x: number, y: number, xPercent: number, yPercent: number) => void;
  interactive?: boolean;
  // Whether to show overlay on non-selected areas (when viewing full image with zone selected)
  showZoneOverlay?: boolean;
  // Zone name for display
  zoneName?: string;
}

export function FloorPlanZoneViewer({
  imageUrl,
  boundingBox,
  cropImageUrl,
  vectorTraceUrl,
  vectorSemanticUrl,
  markers = [],
  pendingMarker,
  taskCategories = {},
  onMarkerPress,
  onPlanPress,
  interactive = true,
  showZoneOverlay = false,
  zoneName,
}: FloorPlanZoneViewerProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: windowWidth } = useWindowDimensions();
  const [isLoading, setIsLoading] = useState(true);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: windowWidth, height: 0 });
  
  // Track current scale for marker sizing (React state for re-renders)
  const [currentScale, setCurrentScale] = useState(1);

  // Animation values
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Calculate display dimensions - always use full image aspect ratio since we zoom to show bounding box
  const displayDimensions = useMemo(() => {
    if (!imageDimensions.width || !imageDimensions.height || containerSize.height === 0) {
      return { width: containerSize.width, height: containerSize.height || 300 };
    }
    
    // Always use the full image aspect ratio
    const aspectRatio = imageDimensions.width / imageDimensions.height;
    let width = containerSize.width;
    let height = width / aspectRatio;
    
    if (height > containerSize.height) {
      height = containerSize.height;
      width = height * aspectRatio;
    }
    
    return { width, height };
  }, [containerSize, imageDimensions]);

  // When we have a pre-cropped region (or vector layers), skip full-page bbox zoom
  const usePreCroppedRegion = Boolean(cropImageUrl || vectorTraceUrl);
  const baseImageUrl = vectorTraceUrl || cropImageUrl || imageUrl;
  const effectiveBoundingBox = usePreCroppedRegion ? null : boundingBox;

  // Calculate the scale factor needed to show the cropped region
  const zoomConfig = useMemo(() => {
    if (!effectiveBoundingBox || !imageDimensions.width || !imageDimensions.height) {
      return {
        initialScale: 1,
        translateX: 0,
        translateY: 0,
        useNativeCrop: false,
      };
    }

    // Calculate how much to zoom to fill the container with the cropped region
    const bboxWidth = (effectiveBoundingBox.x2 - effectiveBoundingBox.x1);
    const bboxHeight = (effectiveBoundingBox.y2 - effectiveBoundingBox.y1);
    
    // We'll zoom in on the full image to show only the bounding box region
    const scaleX = 1 / bboxWidth;
    const scaleY = 1 / bboxHeight;
    const zoomScale = Math.min(scaleX, scaleY);
    
    // Calculate center of bounding box
    const centerX = (effectiveBoundingBox.x1 + effectiveBoundingBox.x2) / 2;
    const centerY = (effectiveBoundingBox.y1 + effectiveBoundingBox.y2) / 2;
    
    // Offset from center (0.5, 0.5)
    const offsetX = (0.5 - centerX) * displayDimensions.width * zoomScale;
    const offsetY = (0.5 - centerY) * displayDimensions.height * zoomScale;

    return {
      initialScale: zoomScale,
      translateX: offsetX,
      translateY: offsetY,
      useNativeCrop: false,
    };
  }, [effectiveBoundingBox, imageDimensions, displayDimensions]);

  // Apply initial zoom when zone changes
  useEffect(() => {
    if (zoomConfig.useNativeCrop) return;
    
    const timingConfig = { duration: 300, easing: Easing.out(Easing.cubic) };
    scale.value = withTiming(zoomConfig.initialScale, timingConfig);
    translateX.value = withTiming(zoomConfig.translateX, timingConfig);
    translateY.value = withTiming(zoomConfig.translateY, timingConfig);
    
    savedScale.value = zoomConfig.initialScale;
    savedTranslateX.value = zoomConfig.translateX;
    savedTranslateY.value = zoomConfig.translateY;
    setCurrentScale(zoomConfig.initialScale);
  }, [zoomConfig]);

  // Handle image load
  const handleImageLoad = (event: any) => {
    const { width, height } = event.nativeEvent.source;
    setImageDimensions({ width, height });
    setIsLoading(false);
  };

  // Update React state for marker sizing
  const updateCurrentScale = useCallback((newScale: number) => {
    setCurrentScale(newScale);
  }, []);

  // Pinch gesture
  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      const newScale = savedScale.value * event.scale;
      const minAllowedScale = boundingBox ? zoomConfig.initialScale : MIN_SCALE;
      scale.value = Math.max(minAllowedScale, Math.min(MAX_SCALE, newScale));

      // Use displayDimensions center for consistency with tap gesture
      const scaleDiff = scale.value - savedScale.value;
      const focalX = event.focalX - displayDimensions.width / 2;
      const focalY = event.focalY - displayDimensions.height / 2;
      translateX.value = savedTranslateX.value - focalX * scaleDiff;
      translateY.value = savedTranslateY.value - focalY * scaleDiff;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(updateCurrentScale)(scale.value);
    });

  // Pan gesture - allow panning when zoomed
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      const minAllowedScale = boundingBox ? zoomConfig.initialScale : 1;
      if (scale.value >= minAllowedScale) {
        translateX.value = savedTranslateX.value + event.translationX;
        translateY.value = savedTranslateY.value + event.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Minimum allowed scale based on whether we have a bounding box
  const minAllowedScale = boundingBox ? zoomConfig.initialScale : MIN_SCALE;

  // Smooth zoom animation config (no bounce)
  const zoomTimingConfig = { duration: 200, easing: Easing.out(Easing.ease) };

  // Zoom in button handler
  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(MAX_SCALE, savedScale.value + ZOOM_STEP);
    scale.value = withTiming(newScale, zoomTimingConfig);
    savedScale.value = newScale;
    setCurrentScale(newScale);
  }, []);

  // Zoom out button handler
  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(minAllowedScale, savedScale.value - ZOOM_STEP);
    scale.value = withTiming(newScale, zoomTimingConfig);
    savedScale.value = newScale;
    setCurrentScale(newScale);
    // Reset to initial position when zooming out to minimum
    if (newScale <= minAllowedScale) {
      translateX.value = withTiming(zoomConfig.translateX, zoomTimingConfig);
      translateY.value = withTiming(zoomConfig.translateY, zoomTimingConfig);
      savedTranslateX.value = zoomConfig.translateX;
      savedTranslateY.value = zoomConfig.translateY;
    }
  }, [minAllowedScale, zoomConfig]);

  // Reset to initial position handler
  const handleReset = useCallback(() => {
    scale.value = withTiming(zoomConfig.initialScale, zoomTimingConfig);
    translateX.value = withTiming(zoomConfig.translateX, zoomTimingConfig);
    translateY.value = withTiming(zoomConfig.translateY, zoomTimingConfig);
    savedScale.value = zoomConfig.initialScale;
    savedTranslateX.value = zoomConfig.translateX;
    savedTranslateY.value = zoomConfig.translateY;
    setCurrentScale(zoomConfig.initialScale);
  }, [zoomConfig]);

  const overlayActions = useMemo(
    () => [
      { id: 'zoom-in', label: '+', onPress: handleZoomIn },
      { id: 'reset-view', label: 'Home', icon: 'home' as const, onPress: handleReset },
      { id: 'zoom-out', label: '−', onPress: handleZoomOut },
    ],
    [handleReset, handleZoomIn, handleZoomOut],
  );

  // Double tap to zoom
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      const minAllowedScale = boundingBox ? zoomConfig.initialScale : 1;
      
      if (scale.value > minAllowedScale * 1.5) {
        // Zoom out to initial view
        scale.value = withSpring(zoomConfig.initialScale);
        translateX.value = withSpring(zoomConfig.translateX);
        translateY.value = withSpring(zoomConfig.translateY);
        savedScale.value = zoomConfig.initialScale;
        savedTranslateX.value = zoomConfig.translateX;
        savedTranslateY.value = zoomConfig.translateY;
        runOnJS(updateCurrentScale)(zoomConfig.initialScale);
      } else {
        // Zoom in to 2x at tap location
        const newScale = zoomConfig.initialScale * 2;
        const focalX = event.x - displayDimensions.width / 2;
        const focalY = event.y - displayDimensions.height / 2;

        scale.value = withSpring(newScale);
        translateX.value = withSpring(zoomConfig.translateX - focalX);
        translateY.value = withSpring(zoomConfig.translateY - focalY);
        savedScale.value = newScale;
        savedTranslateX.value = zoomConfig.translateX - focalX;
        runOnJS(updateCurrentScale)(newScale);
        savedTranslateY.value = zoomConfig.translateY - focalY;
      }
    });

  // Single tap for placing markers
  const tapGesture = Gesture.Tap()
    .onEnd((event) => {
      if (!onPlanPress) return;
      
      // Use saved (target) values, not animated values that might be mid-spring
      const s = savedScale.value;
      const tx = savedTranslateX.value;
      const ty = savedTranslateY.value;
      
      // The transform origin is the center of the element
      const cx = displayDimensions.width / 2;
      const cy = displayDimensions.height / 2;
      
      const imageX = (event.x - tx - cx) / s + cx;
      const imageY = (event.y - ty - cy) / s + cy;
      
      // Convert to percentage of displayed image (0-1)
      let xPercent = imageX / displayDimensions.width;
      let yPercent = imageY / displayDimensions.height;
      
      // Clamp to valid range (0-1)
      if (xPercent < 0 || xPercent > 1 || yPercent < 0 || yPercent > 1) {
        return;
      }

      // Remap crop-local coords back to full-page percent when using a pre-cropped region
      if (usePreCroppedRegion && boundingBox) {
        const bw = boundingBox.x2 - boundingBox.x1;
        const bh = boundingBox.y2 - boundingBox.y1;
        xPercent = boundingBox.x1 + xPercent * bw;
        yPercent = boundingBox.y1 + yPercent * bh;
      }

      runOnJS(onPlanPress)(imageX, imageY, xPercent, yPercent);
    });

  // Compose gestures
  const composed = interactive
    ? Gesture.Simultaneous(
        Gesture.Exclusive(doubleTapGesture, tapGesture),
        Gesture.Simultaneous(pinchGesture, panGesture)
      )
    : Gesture.Tap().onEnd(() => {});

  // Animated style
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Filter markers that are within the current zone's bounding box
  const visibleMarkers = useMemo(() => {
    // Pre-cropped region: show all markers remapped into crop space if bbox known
    if (usePreCroppedRegion && boundingBox) {
      return markers
        .filter((marker) => {
          const markerX = marker.x_percent / 100;
          const markerY = marker.y_percent / 100;
          return (
            markerX >= boundingBox.x1 &&
            markerX <= boundingBox.x2 &&
            markerY >= boundingBox.y1 &&
            markerY <= boundingBox.y2
          );
        })
        .map((marker) => {
          const bw = boundingBox.x2 - boundingBox.x1 || 1;
          const bh = boundingBox.y2 - boundingBox.y1 || 1;
          return {
            ...marker,
            x_percent: ((marker.x_percent / 100 - boundingBox.x1) / bw) * 100,
            y_percent: ((marker.y_percent / 100 - boundingBox.y1) / bh) * 100,
          };
        });
    }

    if (!boundingBox) return markers;
    
    return markers.filter(marker => {
      const markerX = marker.x_percent / 100;
      const markerY = marker.y_percent / 100;
      return (
        markerX >= boundingBox.x1 &&
        markerX <= boundingBox.x2 &&
        markerY >= boundingBox.y1 &&
        markerY <= boundingBox.y2
      );
    });
  }, [markers, boundingBox, usePreCroppedRegion]);

  const isSvgBase = baseImageUrl.toLowerCase().includes('.svg');

  return (
    <View 
      style={styles.container}
      onLayout={(e) => {
        setContainerSize({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        });
      }}
    >
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      
      <GestureDetector gesture={composed}>
        <Animated.View 
          style={[
            styles.imageContainer, 
            { 
              width: displayDimensions.width, 
              height: displayDimensions.height 
            }
          ]}
        >
          <Animated.View style={animatedStyle}>
            {isSvgBase ? (
              <SvgUri
                uri={baseImageUrl}
                width={displayDimensions.width}
                height={displayDimensions.height}
                onLoad={() => {
                  setImageDimensions({
                    width: displayDimensions.width || 1000,
                    height: displayDimensions.height || 1000,
                  });
                  setIsLoading(false);
                }}
              />
            ) : (
              <Image
                source={{ uri: baseImageUrl }}
                style={{ 
                  width: displayDimensions.width, 
                  height: displayDimensions.height 
                }}
                resizeMode="contain"
                onLoad={handleImageLoad}
              />
            )}

            {vectorSemanticUrl ? (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { opacity: 0.85 },
                ]}
                pointerEvents="none"
              >
                <SvgUri
                  uri={vectorSemanticUrl}
                  width={displayDimensions.width}
                  height={displayDimensions.height}
                />
              </View>
            ) : null}

            {/* Zone overlay (dims non-selected areas) — only for full-page zoom mode */}
            {showZoneOverlay && effectiveBoundingBox && (
              <View style={styles.overlayContainer} pointerEvents="none">
                {/* Top overlay */}
                <View 
                  style={[
                    styles.dimOverlay,
                    {
                      top: 0,
                      left: 0,
                      right: 0,
                      height: `${effectiveBoundingBox.y1 * 100}%`,
                    }
                  ]} 
                />
                {/* Bottom overlay */}
                <View 
                  style={[
                    styles.dimOverlay,
                    {
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: `${(1 - effectiveBoundingBox.y2) * 100}%`,
                    }
                  ]} 
                />
                {/* Left overlay */}
                <View 
                  style={[
                    styles.dimOverlay,
                    {
                      top: `${effectiveBoundingBox.y1 * 100}%`,
                      left: 0,
                      width: `${effectiveBoundingBox.x1 * 100}%`,
                      height: `${(effectiveBoundingBox.y2 - effectiveBoundingBox.y1) * 100}%`,
                    }
                  ]} 
                />
                {/* Right overlay */}
                <View 
                  style={[
                    styles.dimOverlay,
                    {
                      top: `${effectiveBoundingBox.y1 * 100}%`,
                      right: 0,
                      width: `${(1 - effectiveBoundingBox.x2) * 100}%`,
                      height: `${(effectiveBoundingBox.y2 - effectiveBoundingBox.y1) * 100}%`,
                    }
                  ]} 
                />
                {/* Highlight border */}
                <View 
                  style={[
                    styles.highlightBorder,
                    {
                      top: `${effectiveBoundingBox.y1 * 100}%`,
                      left: `${effectiveBoundingBox.x1 * 100}%`,
                      width: `${(effectiveBoundingBox.x2 - effectiveBoundingBox.x1) * 100}%`,
                      height: `${(effectiveBoundingBox.y2 - effectiveBoundingBox.y1) * 100}%`,
                    }
                  ]} 
                />
              </View>
            )}

            {/* Markers - positioned on full image, zoom transformation handles visibility */}
            {visibleMarkers.map((marker) => {
              // Backend stores x_percent/y_percent as 0-100, convert to 0-1 for positioning
              // The zoom/pan transformation will position them correctly on screen
              const x = (marker.x_percent / 100) * displayDimensions.width;
              const y = (marker.y_percent / 100) * displayDimensions.height;
              
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
                      console.log('[FloorPlanZoneViewer] Marker pressed:', marker.id);
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
                      left: pendingMarker.xPercent * displayDimensions.width,
                      top: pendingMarker.yPercent * displayDimensions.height,
                      zIndex: 1001,
                      transform: [{ translateX: pendingOffset }, { translateY: pendingOffset }],
                    },
                  ]}
                  pointerEvents="none"
                >
                  <View style={[
                    styles.pendingMarker,
                    {
                      width: pendingSize,
                      height: pendingSize,
                      borderRadius: pendingSize / 2,
                      borderWidth: borderWidth,
                    }
                  ]}>
                    <View style={[
                      styles.pendingMarkerInner,
                      {
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
      
      {/* Zone name badge */}
      {zoneName && (
        <View style={styles.zoneNameBadge}>
          <Text style={styles.zoneNameText}>{zoneName}</Text>
        </View>
      )}

      <MapOverlayControls rightActions={overlayActions} showCompass={false} />
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'flex-start',
      alignItems: 'center',
      backgroundColor: colors.backgroundMain,
    },
    imageContainer: {
      overflow: 'hidden',
    },
    markerContainer: {
      position: 'absolute',
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFill,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(245, 245, 245, 0.8)',
      zIndex: 10,
    },
    overlayContainer: {
      ...StyleSheet.absoluteFill,
    },
    dimOverlay: {
      position: 'absolute',
      backgroundColor: colors.overlayDim,
    },
    highlightBorder: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 4,
    },
    zoneNameBadge: {
      position: 'absolute',
      top: 12,
      left: 12,
      backgroundColor: colors.mediaOverlayScrim,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    zoneNameText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
    },
    pendingMarker: {
      backgroundColor: colors.primary + '4D',
      justifyContent: 'center',
      alignItems: 'center',
      borderColor: colors.primary,
      borderStyle: 'dashed',
    },
    pendingMarkerInner: {
      backgroundColor: colors.primary,
    },
  });
