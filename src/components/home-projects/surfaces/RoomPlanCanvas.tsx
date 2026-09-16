/**
 * The plan view — the room from above, and the only place its shape is edited.
 *
 * Two jobs, deliberately in one component because they are the same picture:
 *
 *  - **Navigation.** Every wall is an edge of this polygon, so tapping an edge
 *    is how a member says "that wall". A list of "Wall 1…Wall 6" cannot be
 *    matched to a real room without counting, and the compass labels alone stop
 *    helping in an L-shaped room with two north walls.
 *  - **Shape editing.** Drag a corner, tap an edge to add one, long-press a
 *    corner to remove it. This is the gesture set every plan tool converged on,
 *    and the research is unanimous that starting from a preset and dragging
 *    beats drawing vertex by vertex on a phone.
 *
 * ## Snapping is not cosmetic
 *
 * A dragged vertex is snapped to a 5 cm grid and the ring is then pulled square
 * (`orthogonalize`) for edges within 7° of an axis. Without it a member cannot
 * produce a rectangle with a finger — they get 3.97 × 2.98 with a 2 mm step at
 * the last corner — and every downstream area, tile count and quantity carries
 * that error. With it, real rooms come out square and a genuinely canted wall
 * still survives, because it is outside the tolerance.
 */

import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import {
  DEFAULT_SNAP_M,
  fitProjection,
  hitTestEdge,
  hitTestVertex,
  insertVertexOnEdge,
  isSimplePolygon,
  orthogonalize,
  polygonArea,
  removeVertex,
  simplifyPolygon,
  snapPoint,
  type Projection,
} from '@features/house/surfaces';
import {
  formatLength,
  formatSurfaceArea,
  type LengthUnit,
} from '@features/house/surfaces/units';
import type { RoomSurfaceModel, Surface, Vec2 } from '@symply/contracts';

export interface RoomPlanCanvasProps {
  model: RoomSurfaceModel;
  width: number;
  height: number;
  /** Off for the read-only plan on the hub; on inside the editor. */
  editable?: boolean;
  /** The wall (or floor) currently open, highlighted on the plan. */
  selectedSurfaceId?: string | null;
  /**
   * Plan-edge indices to call out — the walls a dimension being edited
   * governs.
   *
   * By EDGE rather than by surface id, because the starter's preview is built
   * from a throwaway model whose surface ids change every time a wheel ticks.
   * The edge index is the one thing that is stable across a rebuild, and it is
   * what `RoomShapeParamSpec.edges` already speaks in.
   */
  highlightEdges?: number[];
  onSelectSurface?: (surfaceId: string) => void;
  /** Called on every drag frame — the parent owns the model. */
  onOutlineChange?: (outline: Vec2[]) => void;
  /** Called once at drag end, so a save can be debounced to gestures. */
  onOutlineCommit?: (outline: Vec2[]) => void;
  showAreas?: boolean;
  lengthUnit?: LengthUnit;
  snapM?: number;
  colors?: {
    outline: string;
    fill: string;
    muted: string;
    accent: string;
    background: string;
    text: string;
  };
  testID?: string;
}

const DEFAULT_COLORS = {
  outline: '#2c3338',
  fill: '#f2f4f6',
  muted: '#8a939b',
  accent: '#2f6df6',
  background: '#ffffff',
  text: '#2c3338',
};

const HANDLE_RADIUS_PX = 11;
/** One weight for every wall, highlighted or not. See the render's two passes. */
const EDGE_STROKE_PX = 6;
const EDGE_HIT_PX = 22;

export function RoomPlanCanvas({
  model,
  width,
  height,
  editable = false,
  selectedSurfaceId,
  highlightEdges,
  onSelectSurface,
  onOutlineChange,
  onOutlineCommit,
  showAreas = true,
  lengthUnit = 'm',
  snapM = DEFAULT_SNAP_M,
  colors = DEFAULT_COLORS,
  testID,
}: RoomPlanCanvasProps) {
  const outline = model.room.outline;
  const projection = useMemo(
    () => fitProjection(outline, width, height, { padding: 34 }),
    [outline, width, height],
  );

  const walls = useMemo(
    () => model.surfaces.filter(surface => surface.kind === 'wall'),
    [model.surfaces],
  );
  const wallByEdge = useMemo(() => {
    const map = new Map<number, Surface>();
    for (const wall of walls) {
      if (typeof wall.planEdge === 'number' && wall.planEdge !== null)
        map.set(wall.planEdge, wall);
    }
    return map;
  }, [walls]);
  const materialsById = useMemo(
    () => new Map(model.materials.map(material => [material.id, material])),
    [model.materials],
  );

  const floor = model.surfaces.find(surface => surface.kind === 'floor');
  const floorMaterial = floor?.materialId
    ? materialsById.get(floor.materialId)
    : undefined;

  /**
   * Drag state lives in a ref, not in state.
   *
   * A pan updates on every frame; putting the grabbed index in React state
   * would re-render the whole plan sixty times a second and lose the gesture on
   * a slow frame. The *outline* is still lifted to the parent on every frame —
   * that is the visible feedback — but which handle is held is view-local.
   */
  const drag = useRef<{ vertex: number; latest: Vec2[] } | null>(null);
  // The projection changes as the outline does, and a PanResponder created once
  // would keep projecting through the box the drag started with — so the ref
  // holds the current one and the responder reads it.
  const projectionRef = useRef<Projection>(projection);
  projectionRef.current = projection;
  const outlineRef = useRef<readonly Vec2[]>(outline);
  outlineRef.current = outline;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editable,
        onMoveShouldSetPanResponder: () => editable,
        onPanResponderGrant: event => {
          const { locationX, locationY } = event.nativeEvent;
          const model_ = projectionRef.current.toModel([locationX, locationY]);
          const radiusM = HANDLE_RADIUS_PX / projectionRef.current.scale;
          const vertex = hitTestVertex(outlineRef.current, model_, radiusM);
          if (vertex >= 0) {
            drag.current = { vertex, latest: [...outlineRef.current] };
            return;
          }
          // Not on a handle: an edge tap either selects that wall or, in edit
          // mode with nothing else to do, adds a corner. Selection wins —
          // adding a vertex by accident is far more annoying than not adding
          // one, and there is an explicit affordance for it.
          const edge = hitTestEdge(
            outlineRef.current,
            model_,
            EDGE_HIT_PX / projectionRef.current.scale,
          );
          if (edge >= 0) {
            const wall = wallByEdge.get(edge);
            if (wall && onSelectSurface) onSelectSurface(wall.id);
          }
        },
        onPanResponderMove: event => {
          const held = drag.current;
          if (!held) return;
          const { locationX, locationY } = event.nativeEvent;
          const point = projectionRef.current.toModel([locationX, locationY]);
          const next = [...outlineRef.current];
          next[held.vertex] = snapPoint(point, snapM);
          const squared = orthogonalize(next);
          // A drag that would cross the shape over itself is dropped rather
          // than applied — the member sees the vertex stop at the last legal
          // position instead of watching the room turn into a bowtie and then
          // being told about it.
          if (!isSimplePolygon(squared) || polygonArea(squared) < 0.05) return;
          held.latest = squared;
          onOutlineChange?.(squared);
        },
        onPanResponderRelease: () => {
          const held = drag.current;
          drag.current = null;
          if (!held) return;
          const cleaned = simplifyPolygon(held.latest);
          if (cleaned.length >= 3) onOutlineCommit?.(cleaned);
        },
        onPanResponderTerminate: () => {
          drag.current = null;
        },
      }),
    [
      editable,
      snapM,
      wallByEdge,
      onSelectSurface,
      onOutlineChange,
      onOutlineCommit,
    ],
  );

  const path = projection.pathOf(outline);
  const floorArea = polygonArea(outline);

  /**
   * A floor or ceiling is highlighted by its AREA; a wall by its LINE.
   *
   * On a plan a wall *is* an edge and a floor *is* the enclosed region, so
   * those are the only marks that mean anything. Outlining the perimeter to
   * show "the floor is selected" would be indistinguishable from selecting all
   * four walls, and tinting the room to show one wall would say nothing about
   * which. Derived here from the model rather than passed in, so no caller has
   * to know the rule.
   */
  const selectedKind = model.surfaces.find(
    surface => surface.id === selectedSurfaceId,
  )?.kind;
  const faceHighlighted =
    selectedKind === 'floor' || selectedKind === 'ceiling';

  return (
    <View
      style={[
        styles.wrap,
        { width, height, backgroundColor: colors.background },
      ]}
      testID={testID}
      {...(editable ? panResponder.panHandlers : {})}
    >
      <Svg width={width} height={height}>
        <Path
          d={path}
          fill={floorMaterial?.colorHex ?? colors.fill}
          stroke="none"
        />

        {/* Over the material rather than instead of it — a member picking a
            finish for the floor should still see the finish while the plan
            tells them it is the floor they are looking at. */}
        {faceHighlighted ? (
          <Path
            d={path}
            fill={colors.accent}
            fillOpacity={0.18}
            stroke={colors.accent}
            strokeWidth={2}
            strokeDasharray="6 4"
            testID="plan-face-highlight"
          />
        ) : null}

        {/*
          Two passes, quiet edges then called-out ones.
          
          Every wall is drawn at the SAME weight — a highlight that is also
          thicker reads as a different kind of line rather than the same wall
          picked out, and a short edge drawn thicker than its neighbours gets
          visually pinched by their round caps at both ends. Colour alone is the
          signal; the second pass exists only so a highlighted edge sits above
          the caps of the edges either side of it instead of under them.
        */}
        {[false, true].map(pass =>
          outline.map((point, index) => {
            const wall = wallByEdge.get(index);
            const selected = !faceHighlighted && wall?.id === selectedSurfaceId;
            const highlighted = highlightEdges?.includes(index) ?? false;
            const calledOut = selected || highlighted;
            if (calledOut !== pass) return null;

            const next = outline[(index + 1) % outline.length];
            const a = projection.toScreen(point);
            const b = projection.toScreen(next);
            const material = wall?.materialId
              ? materialsById.get(wall.materialId)
              : undefined;

            return (
              <G key={`edge-${index}`}>
                <Line
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke={
                    calledOut
                      ? colors.accent
                      : material?.colorHex ?? colors.outline
                  }
                  strokeWidth={EDGE_STROKE_PX}
                  strokeLinecap="round"
                  onPress={
                    wall && onSelectSurface
                      ? () => onSelectSurface(wall.id)
                      : undefined
                  }
                />
                <EdgeLabel
                  a={a}
                  b={b}
                  label={wall?.label ?? ''}
                  lengthM={Math.hypot(next[0] - point[0], next[1] - point[1])}
                  colors={colors}
                  selected={calledOut}
                  lengthUnit={lengthUnit}
                />
              </G>
            );
          }),
        )}

        {/* Top-left, not bottom-centre. The bottom edge of the plan is where
            the widest wall's dimension label lands, and a centred readout sat
            directly on top of it. The top-left corner is the one region of the
            canvas nothing else can occupy. */}
        {showAreas ? (
          <SvgText
            x={6}
            y={16}
            fill={colors.muted}
            fontSize={12}
            textAnchor="start"
          >
            {`Floor ${formatSurfaceArea(floorArea, lengthUnit)}`}
          </SvgText>
        ) : null}

        {editable
          ? outline.map((point, index) => {
              const [x, y] = projection.toScreen(point);
              return (
                <Circle
                  key={`handle-${index}`}
                  cx={x}
                  cy={y}
                  r={HANDLE_RADIUS_PX}
                  fill={colors.background}
                  stroke={colors.accent}
                  strokeWidth={2.5}
                  testID={`room-vertex-${index}`}
                />
              );
            })
          : null}
      </Svg>
    </View>
  );
}

function EdgeLabel({
  a,
  b,
  label,
  lengthM,
  colors,
  selected,
  lengthUnit,
}: {
  a: Vec2;
  b: Vec2;
  label: string;
  lengthM: number;
  colors: NonNullable<RoomPlanCanvasProps['colors']>;
  selected: boolean;
  lengthUnit: LengthUnit;
}) {
  const pixelLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (pixelLength < 40) return null;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const nx = -(b[1] - a[1]) / pixelLength;
  const ny = (b[0] - a[0]) / pixelLength;

  /**
   * Labels run ALONG their edge, never across it.
   *
   * Horizontal text beside a vertical wall is the single worst thing on a
   * small plan: the label is as wide as the room is tall, so on a U-shape the
   * two sides of the notch print into each other and into the wall names
   * beside them. Rotating to the edge makes each label as long as the wall it
   * describes, which is the space that is actually free.
   *
   * `+180` when the edge points leftwards keeps text from reading upside down
   * — the drafting convention that a dimension is read from the bottom or from
   * the right of the sheet.
   */
  const edgeAngle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  // Folded into (-90, 90] rather than simply adding 180: an edge pointing due
  // left is `atan2 === 180`, and `+180` made that `rotate(360)` — visually
  // identical to 0 and a needless full turn in the transform.
  const angle =
    edgeAngle > 90
      ? edgeAngle - 180
      : edgeAngle <= -90
      ? edgeAngle + 180
      : edgeAngle;

  const dimension: Vec2 = [mid[0] + nx * 14, mid[1] + ny * 14];
  const name: Vec2 = [mid[0] - nx * 12, mid[1] - ny * 12];

  return (
    <G>
      {/* Outside the shape. `dy` rather than a baked-in `+4` because the text
          is rotated: a y-offset added to the coordinate would push the label
          sideways on a vertical wall instead of away from it. */}
      <SvgText
        x={dimension[0]}
        y={dimension[1]}
        dy={4}
        fill={selected ? colors.accent : colors.text}
        fontSize={11}
        fontWeight={selected ? '700' : '500'}
        textAnchor="middle"
        transform={`rotate(${angle}, ${dimension[0]}, ${dimension[1]})`}
      >
        {formatLength(lengthM, lengthUnit)}
      </SvgText>
      {/* Inside, and only when the wall is long enough that a name will not
          crowd the dimension of the wall around the corner from it. */}
      {label && pixelLength > 96 ? (
        <SvgText
          x={name[0]}
          y={name[1]}
          dy={4}
          fill={colors.muted}
          fontSize={10}
          textAnchor="middle"
          transform={`rotate(${angle}, ${name[0]}, ${name[1]})`}
        >
          {label}
        </SvgText>
      ) : null}
    </G>
  );
}

/**
 * Add a corner to the middle of an edge.
 *
 * Exported rather than wired to a gesture: "tap an edge to add a corner"
 * competes with "tap an edge to open that wall", and the wall is what members
 * want nine times out of ten. The editor puts this behind an explicit button
 * with the edge already selected.
 */
export function addCornerToEdge(
  outline: readonly Vec2[],
  edgeIndex: number,
): Vec2[] {
  return insertVertexOnEdge(outline, edgeIndex);
}

/** Remove a corner, refusing to go below a triangle. */
export function removeCorner(
  outline: readonly Vec2[],
  vertexIndex: number,
): Vec2[] {
  return removeVertex(outline, vertexIndex);
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, overflow: 'hidden' },
});
