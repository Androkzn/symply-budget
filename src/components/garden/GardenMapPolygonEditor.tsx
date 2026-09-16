/**
 * The tracing surface — a satellite map you can draw polygons on with a finger.
 *
 * Steps one and two of the map wizard are the same interaction twice over
 * ("put a closed shape over that part of the picture"), differing only in how
 * many shapes are in play and what they are called, so they share this
 * component rather than each growing their own copy of the vertex maths.
 *
 * ## Why the geometry stays geographic while a member is dragging
 *
 * It would be simpler to freeze the map, overlay an SVG canvas, and do all the
 * editing in flat pixels — that is what `GardenPlanVectorEditor` does for
 * OBJECTS, and it is right for objects. It is wrong for boundaries, because a
 * boundary is traced AGAINST the imagery: the member is looking at their actual
 * fence and putting a corner on it. That demands panning and zooming mid-trace,
 * and the moment the map moves under a frozen overlay every placed corner slides
 * off the fence it was placed on.
 *
 * So vertices are `LatLng` and live as `MapMarker`s, which `MKMapView` re-projects
 * itself on every camera change. A corner dropped on the corner of a shed stays
 * on the corner of that shed through any amount of panning, which is the whole
 * requirement. Conversion to the normalized space everything is STORED in
 * happens once, at save, in `@utils/gardenGeo`.
 *
 * ## Midpoint handles rather than tap-to-add
 *
 * The retired flow added a vertex by tapping the map and inserting it into
 * whichever edge was nearest. That is undiscoverable (nothing says taps do
 * anything) and ambiguous (a tap meant to pan, or to deselect, silently adds a
 * corner). Instead every edge carries a faint handle at its midpoint: tapping it
 * splits that edge. It is the interaction Figma, Google's own map tools and every
 * vector editor use, it is visible before it is used, and it makes a stray tap on
 * the map mean nothing at all — which is what a member expects a stray tap to
 * mean.
 *
 * Deletion is deliberately NOT tap-a-vertex. Tapping a corner selects it and the
 * host screen offers "Remove corner"; making a tap destructive on a surface
 * where the member is constantly tapping corners to drag them is how a traced
 * lot loses a corner nobody meant to remove.
 */
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, {
  Marker as MapMarker,
  Polygon as MapPolygon,
  Polyline as MapPolyline,
  type LatLng,
  type MapPressEvent,
  type Region,
} from 'react-native-maps';

import { Typography } from '@components/ui';
import { useAppColors } from '@theme';
import { ringCentroid } from '@utils/gardenGeo';

/**
 * `MKMapView` re-applies a legacy zoom clamp on every region change unless a
 * camera zoom range is supplied, which makes it impossible to stay zoomed in
 * far enough to see a fence line. Copied from `GardenPlanBoundaryConfirmScreen`,
 * where it was worked out the hard way; the user asked for maximum usable scale
 * and this is the setting that actually delivers it.
 */
const MAP_MAX_ZOOM_LEVEL = 22;
const MIN_CAMERA_ALTITUDE = Platform.OS === 'ios' ? 60 : 25;
const MAX_CAMERA_ALTITUDE = 8000;
export const IOS_CAMERA_ZOOM_RANGE =
  Platform.OS === 'ios'
    ? {
        minCenterCoordinateDistance: MIN_CAMERA_ALTITUDE,
        maxCenterCoordinateDistance: MAX_CAMERA_ALTITUDE,
        animated: false,
      }
    : undefined;

/**
 * A polygon on the map.
 *
 * Whether a ring grows drag handles is decided by `activeRingId` alone, not by
 * anything on the ring itself — exactly one ring is editable at a time, and
 * making that a property of each ring would allow the contradictory state where
 * two claim to be.
 */
export interface EditableRing {
  id: string;
  ring: LatLng[];
  color: string;
  label?: string | null;
  /** Shown under the label — an area, normally. */
  sublabel?: string | null;
  /** Drawn as an open path rather than a closed shape (a trace in progress). */
  open?: boolean;
}

export interface GardenMapPolygonEditorProps {
  initialRegion: Region;
  mapRef?: React.RefObject<MapView | null>;
  mapType?: 'satellite' | 'hybrid' | 'standard';
  rings: EditableRing[];
  /** Which ring's vertices are draggable. `null` shows every ring read-only. */
  activeRingId: string | null;
  selectedVertex: number | null;
  onSelectVertex: (index: number | null) => void;
  onMoveVertex: (index: number, coordinate: LatLng) => void;
  /** Fired at drag START so the host can push one undo entry per drag. */
  onBeginVertexDrag?: (index: number) => void;
  onInsertVertex: (index: number, coordinate: LatLng) => void;
  /** Tapping bare map. In draw mode this appends a corner. */
  onMapPress?: (coordinate: LatLng) => void;
  /** Suppresses midpoint handles while the member is laying down a new shape. */
  drawing?: boolean;
  onRegionChangeComplete?: (region: Region) => void;
  children?: React.ReactNode;
}

export function GardenMapPolygonEditor({
  initialRegion,
  mapRef,
  mapType = 'satellite',
  rings,
  activeRingId,
  selectedVertex,
  onSelectVertex,
  onMoveVertex,
  onBeginVertexDrag,
  onInsertVertex,
  onMapPress,
  drawing = false,
  onRegionChangeComplete,
  children,
}: GardenMapPolygonEditorProps) {
  const colors = useAppColors();

  const activeRing = useMemo(
    () => rings.find((entry) => entry.id === activeRingId) ?? null,
    [activeRingId, rings],
  );

  /**
   * Edge midpoints for the active ring.
   *
   * A ring of two points has ONE edge, not two: closing a two-point ring would
   * put a second handle exactly on top of the first, and tapping the stack
   * inserts an invisible duplicate corner. Below three points the shape is a
   * line and is treated as one.
   */
  const midpoints = useMemo(() => {
    if (!activeRing || drawing) return [];
    const ring = activeRing.ring;
    if (ring.length < 2) return [];
    const edgeCount = ring.length === 2 ? 1 : ring.length;
    const out: Array<{ index: number; coordinate: LatLng }> = [];
    for (let i = 0; i < edgeCount; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      out.push({
        index: i,
        coordinate: {
          latitude: (a.latitude + b.latitude) / 2,
          longitude: (a.longitude + b.longitude) / 2,
        },
      });
    }
    return out;
  }, [activeRing, drawing]);

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      if (!onMapPress) {
        onSelectVertex(null);
        return;
      }
      onMapPress(event.nativeEvent.coordinate);
    },
    [onMapPress, onSelectVertex],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        testID="garden-map-canvas"
        style={StyleSheet.absoluteFill}
        mapType={mapType}
        initialRegion={initialRegion}
        maxZoomLevel={MAP_MAX_ZOOM_LEVEL}
        cameraZoomRange={IOS_CAMERA_ZOOM_RANGE}
        onPress={handleMapPress}
        onRegionChangeComplete={onRegionChangeComplete}
        rotateEnabled
        pitchEnabled={false}
        showsCompass={false}
        showsScale={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
      >
        {rings.map((entry) => {
          if (entry.ring.length < 2) return null;
          // An in-progress trace is a PATH, not a shape. Drawing it closed would
          // show a phantom edge back to the first corner that the member has not
          // drawn yet and cannot see the length of.
          if (entry.open || entry.ring.length === 2) {
            return (
              <MapPolyline
                key={`path-${entry.id}`}
                coordinates={entry.ring}
                strokeColor={entry.color}
                strokeWidth={3}
              />
            );
          }
          return (
            <MapPolygon
              key={`ring-${entry.id}`}
              coordinates={entry.ring}
              fillColor={withAlpha(entry.color, entry.id === activeRingId ? 0.28 : 0.16)}
              strokeColor={entry.color}
              strokeWidth={entry.id === activeRingId ? 3 : 2}
            />
          );
        })}

        {/* Zone name plates. Non-interactive so they never eat a tap meant for
            a corner underneath them. */}
        {rings.map((entry) => {
          if (!entry.label || entry.ring.length < 3) return null;
          const centre = ringCentroid(entry.ring);
          if (!centre) return null;
          return (
            <MapMarker
              key={`label-${entry.id}`}
              coordinate={centre}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              pointerEvents="none"
              zIndex={2}
            >
              <View style={[styles.namePlate, { backgroundColor: withAlpha(entry.color, 0.92) }]}>
                <Typography variant="caption2" weight="semibold" color={colors.white}>
                  {entry.label}
                </Typography>
                {entry.sublabel ? (
                  <Typography variant="caption2" color={colors.white}>
                    {entry.sublabel}
                  </Typography>
                ) : null}
              </View>
            </MapMarker>
          );
        })}

        {/* Midpoint handles — the "add a corner" affordance. Rendered UNDER the
            vertex handles so a midpoint that drifts near a corner never steals
            its touch. */}
        {midpoints.map((midpoint) => (
          <MapMarker
            key={`mid-${activeRingId}-${midpoint.index}`}
            coordinate={midpoint.coordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={5}
            testID={`garden-map-midpoint-${midpoint.index}`}
            accessibilityLabel={`Add corner on edge ${midpoint.index + 1}`}
            onPress={(event) => {
              event.stopPropagation?.();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onInsertVertex(midpoint.index, midpoint.coordinate);
            }}
          >
            <View style={styles.midpointTouchTarget}>
              <View style={[styles.midpointDot, { borderColor: colors.white }]} />
            </View>
          </MapMarker>
        ))}

        {activeRing?.ring.map((coordinate, index) => {
          const isSelected = selectedVertex === index;
          return (
            <MapMarker
              key={`vertex-${activeRingId}-${index}`}
              coordinate={coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              draggable
              zIndex={10}
              testID={`garden-map-vertex-${index}`}
              accessibilityLabel={`Corner ${index + 1}`}
              onPress={(event) => {
                event.stopPropagation?.();
                Haptics.selectionAsync();
                onSelectVertex(isSelected ? null : index);
              }}
              onDragStart={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelectVertex(index);
                onBeginVertexDrag?.(index);
              }}
              onDrag={(event) => onMoveVertex(index, event.nativeEvent.coordinate)}
              onDragEnd={(event) => {
                Haptics.selectionAsync();
                onMoveVertex(index, event.nativeEvent.coordinate);
              }}
            >
              <View style={styles.vertexTouchTarget}>
                <View
                  style={[
                    styles.vertexDot,
                    {
                      backgroundColor: isSelected ? colors.warning : colors.white,
                      borderColor: activeRing.color,
                    },
                    isSelected && styles.vertexDotSelected,
                  ]}
                />
              </View>
            </MapMarker>
          );
        })}
      </MapView>
      {children}
    </View>
  );
}

/**
 * `#RRGGBB` + alpha → `rgba()`.
 *
 * Zone colours are authored as hex in `@models/garden-zones` because that is
 * what a designer hands over and what every other palette in the app uses, but
 * `MapPolygon.fillColor` needs the alpha applied. A value that is not a six-digit
 * hex is passed through untouched so a caller can hand in `rgba(...)` directly.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  // The dot is 16pt but the touch target is 44 — Apple's minimum, and the
  // difference between "drag the corner" and "drag the map by accident".
  vertexTouchTarget: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vertexDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 3,
  },
  vertexDotSelected: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  midpointTouchTarget: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  midpointDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  namePlate: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
});
