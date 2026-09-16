/**
 * The scale-true surface renderer.
 *
 * One surface — a wall as an unfolded elevation, a floor or ceiling as a plan —
 * drawn at a real pixels-per-metre ratio, with every material laid out at its
 * actual repeat size. This is the component the whole feature is built to make
 * possible, and its contract is exactly one sentence: **nothing is ever scaled
 * to fit.**
 *
 * ## Why the tiling is drawn rather than generated
 *
 * The obvious way to show a tile on a wall is to hand a picture of the tile and
 * a picture of the wall to an image model. Every consumer visualiser on the
 * market does a version of that, and the research is consistent about what you
 * get: something that looks right and is not to scale, because the model has no
 * idea the tile is 300 mm and the wall is 3.4 m. A member cannot count courses
 * on it, cannot see where the cut lands at the ceiling, and cannot order from
 * it.
 *
 * An SVG `<Pattern>` whose cell is `(face + joint) × pxPerMetre` is exact,
 * costs nothing, works with no signal, and is the same arithmetic the takeoff
 * divides by — so what the member counts on the screen is what the quantity
 * says. The AI preview (`SurfacePreview`) is a separate, optional layer that is
 * *seeded* by this render rather than replacing it.
 *
 * ## Draw order
 *
 * Base fill → sub-areas in `sortOrder` → openings → outlines → selection →
 * dimensions. The base is painted across the whole surface and the sub-areas
 * cover it, which is why `regionsOf` reports a base outline that is the whole
 * surface while its *area* has the sub-areas subtracted: the renderer wants the
 * simple thing and the takeoff wants the exact one, and neither has to
 * compromise.
 */

import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Line,
  Path,
  Pattern,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  cellPixelSize,
  fitProjection,
  patternCell,
  projectRect,
  regionsOf,
  tileTopLeft,
  type PatternCell,
  type Projection,
  type Region,
} from '@features/house/surfaces';
import { formatLength, type LengthUnit } from '@features/house/surfaces/units';
import type { Material, Opening, Surface } from '@symply/contracts';

/**
 * What the parent can ask a canvas to do.
 *
 * One method, and it exists for the AI preview: the render is only a picture of
 * *this* wall because the scale-true drawing goes to the model as a reference,
 * and the most faithful drawing available is the one the member is looking at.
 * Re-deriving it server-side would mean a second renderer that has to agree
 * with this one pixel for pixel.
 */
export interface SurfaceCanvasHandle {
  /** Base64 PNG of the current drawing, or null if the capture failed. */
  capturePng: () => Promise<string | null>;
}

export interface SurfaceCanvasProps {
  surface: Surface;
  materials: Material[];
  /**
   * `home_project_attachments.id` → a URI an `<Image>` can render.
   *
   * Resolved by the caller because the two backends address bytes completely
   * differently — a sealed H6 blob decrypted to `cacheDirectory` on a
   * local-first household, an R2 url otherwise — and a renderer that knew the
   * difference would drag the ledger into every swatch. A missing entry is not
   * an error: the material's `colorHex` is drawn instead, which is why the
   * contract makes that field required.
   */
  textureUris?: Record<string, string | undefined>;
  width: number;
  height: number;
  /** `null` selects the base region; `undefined` selects nothing. */
  selectedRegionId?: string | null;
  onSelectRegion?: (subAreaId: string | null) => void;
  showDimensions?: boolean;
  showRegionLabels?: boolean;
  showOpenings?: boolean;
  lengthUnit?: LengthUnit;
  padding?: number;
  /** Caps px/m so a small surface is drawn small. See `fitProjection`. */
  maxPxPerMetre?: number;
  outlineColor?: string;
  mutedColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  testID?: string;
}

/** Empty surfaces get a light neutral so the outline is still legible. */
const UNASSIGNED_FILL = '#e9edf0';

export const SurfaceCanvas = forwardRef<
  SurfaceCanvasHandle,
  SurfaceCanvasProps
>(function SurfaceCanvas(
  {
    surface,
    materials,
    textureUris,
    width,
    height,
    selectedRegionId,
    onSelectRegion,
    showDimensions = false,
    showRegionLabels = false,
    showOpenings = true,
    lengthUnit = 'm',
    padding = 16,
    maxPxPerMetre,
    outlineColor = '#2c3338',
    mutedColor = '#8a939b',
    accentColor = '#2f6df6',
    backgroundColor = '#ffffff',
    testID,
  },
  ref,
) {
  const projection = useMemo(
    () =>
      fitProjection(surface.outline, width, height, { padding, maxPxPerMetre }),
    [surface.outline, width, height, padding, maxPxPerMetre],
  );

  const regions = useMemo(() => regionsOf(surface), [surface]);
  const materialsById = useMemo(
    () => new Map(materials.map(material => [material.id, material])),
    [materials],
  );

  /**
   * One pattern def per (material, surface) — not per region.
   *
   * Sharing the def across regions is what makes the courses line up across a
   * sub-area boundary: two regions of the same tile separated by a chair rail
   * are one continuous field of tile with a rail drawn over it, which is what
   * the room looks like. A per-region pattern would restart the grid at each
   * boundary and produce a seam no tiler would cut.
   */
  const patternDefs = useMemo(() => {
    const used = new Set<string>();
    for (const region of regions) {
      if (region.materialId) used.add(region.materialId);
    }
    return [...used]
      .map(id => materialsById.get(id))
      .filter((material): material is Material => Boolean(material))
      .map(material => ({
        material,
        cell: patternCell(material),
        uri: material.textureAttachmentId
          ? textureUris?.[material.textureAttachmentId]
          : undefined,
      }))
      .filter(entry => entry.cell !== null);
  }, [regions, materialsById, textureUris]);

  const fillFor = (region: Region): string => {
    if (!region.materialId) return UNASSIGNED_FILL;
    const material = materialsById.get(region.materialId);
    if (!material) return UNASSIGNED_FILL;
    const hasPattern = patternDefs.some(
      entry => entry.material.id === material.id,
    );
    return hasPattern
      ? `url(#${patternId(surface.id, material.id)})`
      : material.colorHex;
  };

  // The bottom-left corner of the surface, in screen pixels. Patterns are
  // anchored here so a wall's courses start full at the floor and the cut lands
  // at the ceiling — which is how tile is actually set, and the opposite of
  // what an unanchored pattern does.
  const anchor = projection.toScreen([
    projection.bounds.minX,
    projection.bounds.minY,
  ]);

  const svgRef = useRef<Svg>(null);
  useImperativeHandle(
    ref,
    () => ({
      capturePng: () =>
        new Promise<string | null>(resolve => {
          const node = svgRef.current as unknown as {
            toDataURL?: (cb: (data: string) => void) => void;
          } | null;
          // `toDataURL` is native and absent under Jest's mock and on any
          // renderer that has not mounted yet. Resolving null rather than
          // rejecting is deliberate: the preview then goes out prompt-only,
          // which is a weaker picture and not a failed request.
          if (!node || typeof node.toDataURL !== 'function') {
            resolve(null);
            return;
          }
          try {
            node.toDataURL(data => resolve(data ?? null));
          } catch {
            resolve(null);
          }
        }),
    }),
    [],
  );

  return (
    <View
      style={[styles.wrap, { width, height, backgroundColor }]}
      testID={testID}
    >
      <Svg ref={svgRef} width={width} height={height}>
        <Defs>
          {patternDefs.map(({ material, cell, uri }) => (
            <MaterialPattern
              key={material.id}
              id={patternId(surface.id, material.id)}
              material={material}
              cell={cell as PatternCell}
              uri={uri}
              scale={projection.scale}
              anchorX={anchor[0]}
              anchorY={anchor[1]}
            />
          ))}
          {regions.map(region => (
            <ClipPath
              key={`clip-${region.subAreaId ?? 'base'}`}
              id={clipId(surface.id, region)}
            >
              <Path d={projection.pathOf(region.outline)} />
            </ClipPath>
          ))}
        </Defs>

        {regions.map(region => (
          <Path
            key={`fill-${region.subAreaId ?? 'base'}`}
            d={projection.pathOf(region.outline)}
            fill={fillFor(region)}
            onPress={
              onSelectRegion
                ? () => onSelectRegion(region.subAreaId)
                : undefined
            }
            testID={`surface-region-${region.subAreaId ?? 'base'}`}
          />
        ))}

        {showOpenings
          ? surface.openings.map(opening => (
              <OpeningMark
                key={opening.id}
                opening={opening}
                projection={projection}
                backgroundColor={backgroundColor}
                mutedColor={mutedColor}
              />
            ))
          : null}

        {/* Region edges, then the surface edge, so a sub-area boundary reads as
            a joint and the perimeter reads as the wall. */}
        {regions
          .filter(region => region.subAreaId !== null)
          .map(region => (
            <Path
              key={`edge-${region.subAreaId}`}
              d={projection.pathOf(region.outline)}
              fill="none"
              stroke={mutedColor}
              strokeWidth={1}
            />
          ))}
        <Path
          d={projection.pathOf(surface.outline)}
          fill="none"
          stroke={outlineColor}
          strokeWidth={2}
        />

        {selectedRegionId !== undefined
          ? regions
              .filter(region => region.subAreaId === selectedRegionId)
              .map(region => (
                <Path
                  key={`sel-${region.subAreaId ?? 'base'}`}
                  d={projection.pathOf(region.outline)}
                  fill="none"
                  stroke={accentColor}
                  strokeWidth={3}
                  strokeDasharray="6 4"
                />
              ))
          : null}

        {showRegionLabels ? (
          <RegionLabels
            regions={regions}
            projection={projection}
            color={outlineColor}
          />
        ) : null}

        {showDimensions ? (
          <Dimensions
            surface={surface}
            projection={projection}
            color={mutedColor}
            unit={lengthUnit}
          />
        ) : null}
      </Svg>
    </View>
  );
});

function patternId(surfaceId: string, materialId: string): string {
  // Ids are document-scoped and can contain characters SVG would rather not see
  // in a `url(#…)`, so they are reduced to a safe alphabet. Collisions inside
  // one canvas are impossible: both halves are already unique per document.
  return `pat-${sanitize(surfaceId)}-${sanitize(materialId)}`;
}

function clipId(surfaceId: string, region: Region): string {
  return `clip-${sanitize(surfaceId)}-${sanitize(region.subAreaId ?? 'base')}`;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

function MaterialPattern({
  id,
  material,
  cell,
  uri,
  scale,
  anchorX,
  anchorY,
}: {
  id: string;
  material: Material;
  cell: PatternCell;
  uri: string | undefined;
  scale: number;
  anchorX: number;
  anchorY: number;
}) {
  const { w, h } = cellPixelSize(cell, scale);
  const grout = material.groutColorHex ?? '#cfcac2';

  // A cell smaller than about two pixels is a shimmering moiré rather than a
  // material, and on a floor plan of a whole room that is exactly what a mosaic
  // would be. Below the threshold the pattern collapses to its colour, which is
  // the honest picture at that zoom.
  if (w < 2 || h < 2) {
    return (
      <Pattern
        id={id}
        patternUnits="userSpaceOnUse"
        x={0}
        y={0}
        width={4}
        height={4}
      >
        <Rect x={0} y={0} width={4} height={4} fill={material.colorHex} />
      </Pattern>
    );
  }

  return (
    <Pattern
      id={id}
      patternUnits="userSpaceOnUse"
      x={anchorX}
      y={anchorY}
      width={w}
      height={h}
      patternTransform={
        cell.rotationDeg ? `rotate(${cell.rotationDeg})` : undefined
      }
    >
      {/* The joint colour, showing through the gaps between faces. Drawing the
          joint as a background rather than as strokes is what keeps a 3 mm
          joint 3 mm wide at every zoom instead of snapping to a 1 px line. */}
      <Rect x={0} y={0} width={w} height={h} fill={grout} />
      {cell.tiles.map((tile, index) => {
        const [tx, ty] = tileTopLeft(cell, tile);
        const rect = {
          x: tx * scale,
          y: ty * scale,
          width: tile.width * scale,
          height: tile.height * scale,
        };
        return uri ? (
          <SvgImage
            key={index}
            href={{ uri }}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            // `slice` crops rather than distorts. A tile photo that is not the
            // same aspect ratio as the tile it depicts is the member's photo
            // being imperfect; stretching it would make the *drawing* lie about
            // the shape of a product that has a shape.
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <Rect
            key={index}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fill={material.colorHex}
          />
        );
      })}
    </Pattern>
  );
}

// ---------------------------------------------------------------------------
// Openings, labels, dimensions
// ---------------------------------------------------------------------------

function OpeningMark({
  opening,
  projection,
  backgroundColor,
  mutedColor,
}: {
  opening: Opening;
  projection: Projection;
  backgroundColor: string;
  mutedColor: string;
}) {
  const rect = projectRect(projection, opening);
  return (
    <G>
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill={opening.deducts ? backgroundColor : 'none'}
        stroke={mutedColor}
        strokeWidth={1.5}
        strokeDasharray={opening.deducts ? undefined : '4 3'}
      />
      {/* A cross for a hole that is removed from the takeoff, so "deducted" is
          visible on the drawing rather than only in a form. */}
      {opening.deducts && rect.width > 14 && rect.height > 14 ? (
        <>
          <Line
            x1={rect.x}
            y1={rect.y}
            x2={rect.x + rect.width}
            y2={rect.y + rect.height}
            stroke={mutedColor}
            strokeWidth={1}
          />
          <Line
            x1={rect.x + rect.width}
            y1={rect.y}
            x2={rect.x}
            y2={rect.y + rect.height}
            stroke={mutedColor}
            strokeWidth={1}
          />
        </>
      ) : null}
    </G>
  );
}

function RegionLabels({
  regions,
  projection,
  color,
}: {
  regions: Region[];
  projection: Projection;
  color: string;
}) {
  return (
    <G>
      {regions.map(region => {
        if (region.netM2 <= 0) return null;
        const centre = centroidScreen(region, projection);
        if (!centre) return null;
        return (
          <SvgText
            key={`label-${region.subAreaId ?? 'base'}`}
            x={centre[0]}
            y={centre[1]}
            fill={color}
            fontSize={11}
            fontWeight="600"
            textAnchor="middle"
          >
            {region.label}
          </SvgText>
        );
      })}
    </G>
  );
}

function centroidScreen(
  region: Region,
  projection: Projection,
): [number, number] | null {
  if (region.outline.length < 3) return null;
  const sum = region.outline.reduce<[number, number]>(
    (acc, point) => {
      const [x, y] = projection.toScreen(point);
      return [acc[0] + x, acc[1] + y];
    },
    [0, 0],
  );
  return [sum[0] / region.outline.length, sum[1] / region.outline.length];
}

/**
 * Edge lengths, drawn outside the shape.
 *
 * Only for edges long enough that the text fits — a 12 cm return with "0.12 m"
 * across it is unreadable and hides the corner it is describing. The member can
 * still read that edge by tapping it.
 */
function Dimensions({
  surface,
  projection,
  color,
  unit,
}: {
  surface: Surface;
  projection: Projection;
  color: string;
  unit: LengthUnit;
}) {
  const outline = surface.outline;
  return (
    <G>
      {outline.map((point, index) => {
        const next = outline[(index + 1) % outline.length];
        const lengthM = Math.hypot(next[0] - point[0], next[1] - point[1]);
        const a = projection.toScreen(point);
        const b = projection.toScreen(next);
        const pixelLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (pixelLength < 44) return null;
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // Push the label away from the shape along the edge normal.
        const nx = -(b[1] - a[1]) / pixelLength;
        const ny = (b[0] - a[0]) / pixelLength;
        const centre = shapeCentre(outline, projection);
        const sign =
          (mid[0] - centre[0]) * nx + (mid[1] - centre[1]) * ny >= 0 ? 1 : -1;
        return (
          <SvgText
            key={`dim-${index}`}
            x={mid[0] + nx * 11 * sign}
            y={mid[1] + ny * 11 * sign + 3}
            fill={color}
            fontSize={10}
            textAnchor="middle"
          >
            {formatLength(lengthM, unit)}
          </SvgText>
        );
      })}
    </G>
  );
}

function shapeCentre(
  outline: Surface['outline'],
  projection: Projection,
): [number, number] {
  const sum = outline.reduce<[number, number]>(
    (acc, point) => {
      const [x, y] = projection.toScreen(point);
      return [acc[0] + x, acc[1] + y];
    },
    [0, 0],
  );
  return [sum[0] / outline.length, sum[1] / outline.length];
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, overflow: 'hidden' },
});
