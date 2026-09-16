import React from 'react';
import {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon as SvgPolygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import {
  type GardenObjectIconKey,
  type SimpleShape,
  presetMetadataFromObject,
} from '@/types/garden-object-presets';
import type { GardenPlanObject } from '@/types/garden-objects';
import { zoneMetadataFromObject } from '@/types/garden-zones';

const DEFAULT_STROKE = '#1F2937';
const DEFAULT_STROKE_WIDTH = 4;

/**
 * Resolve the human-friendly label for an object, preferring the user-supplied
 * label and falling back to the preset/type name.
 */
export function getGardenObjectDisplayLabel(object: GardenPlanObject): string {
  const trimmed = object.label?.trim();
  if (trimmed) return trimmed;
  return TYPE_FALLBACK_LABEL[object.type] ?? 'Object';
}

const TYPE_FALLBACK_LABEL: Record<GardenPlanObject['type'], string> = {
  tree: 'Tree',
  shrub: 'Shrub',
  flower: 'Flowers',
  raised_bed: 'Raised bed',
  path: 'Path',
  patio: 'Patio',
  label: 'Note',
  // Only reached by a zone saved with no label of its own. A zone drawn in the
  // wizard always carries its kind's name ("Back yard"), so this is the generic
  // fallback rather than the usual case.
  zone: 'Area',
};

interface RenderArgs {
  object: GardenPlanObject;
  width: number;
  height: number;
  color: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Render a garden object's body. Translation/rotation must be applied by the
 * caller (so labels and selection chrome can use the same transform).
 *
 * Resolution order:
 *   1. metadata.iconKey  → preset-aware custom icon
 *   2. metadata.shape    → shape primitive override (legacy)
 *   3. object.type       → built-in type renderer
 */
export function renderGardenObjectBody({
  object,
  width,
  height,
  color,
  stroke = DEFAULT_STROKE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: RenderArgs): React.ReactNode {
  // Zones resolve FIRST, ahead of the metadata branches below.
  //
  // A zone's metadata deliberately declares `shape: 'rectangle'` so that a build
  // which predates zones still draws the row as a rectangle in the right place
  // rather than dropping it (see `@models/garden-zones`). This build knows
  // better, and checking the type before the shape is what lets both be true —
  // old readers get the honest fallback, new readers get the traced outline.
  if (object.type === 'zone') {
    return renderZone(object, width, height, color, strokeWidth);
  }

  const meta = presetMetadataFromObject(object);

  if (meta.iconKey) {
    return renderIcon(meta.iconKey, width, height, color, stroke, strokeWidth, object);
  }

  if (meta.shape && object.type !== 'label') {
    return renderPrimitive(meta.shape, width, height, color, stroke, strokeWidth);
  }

  return renderByType(object, width, height, color, stroke, strokeWidth);
}

function renderPrimitive(
  shape: SimpleShape,
  width: number,
  height: number,
  color: string,
  stroke: string,
  strokeWidth: number,
): React.ReactNode {
  if (shape === 'circle') {
    return (
      <Circle r={Math.min(width, height) / 2} fill={color} stroke={stroke} strokeWidth={strokeWidth} />
    );
  }
  const squareSide = Math.min(width, height);
  const w = shape === 'square' ? squareSide : width;
  const h = shape === 'square' ? squareSide : height;
  return (
    <Rect
      x={-w / 2}
      y={-h / 2}
      width={w}
      height={h}
      rx={shape === 'square' ? 14 : 18}
      fill={color}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

/**
 * Draw a zone as the polygon the member actually traced.
 *
 * The ring is stored in the OBJECT's own frame — offsets from its centre as a
 * fraction of its width and height — which is precisely the frame this renderer
 * draws in: the caller has already translated to the centre and rotated, and
 * hands down `width`/`height` in canvas units. So the conversion is one
 * multiply per axis and there is no scale to recover and no plan-space
 * coordinate to subtract. (`@models/garden-zones` explains why the ring is
 * stored that way; the short version is that it makes a dragged or resized zone
 * keep its shape for free.)
 *
 * A row with no usable ring falls back to its bounding rectangle rather than
 * emitting `NaN` into the SVG, which React Native Svg renders as an invisible
 * element with no error anywhere.
 *
 * Zones are drawn UNDER everything else by virtue of `sort_order` — the wizard
 * writes them first — and are filled softly and stroked with a dash so a member
 * can tell an area (a region they named) from a patio (a thing they placed) at a
 * glance, without reading the label.
 */
function renderZone(
  object: GardenPlanObject,
  width: number,
  height: number,
  color: string,
  strokeWidth: number,
): React.ReactNode {
  const zone = zoneMetadataFromObject(object);

  if (!zone) {
    return (
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={Math.min(width, height) * 0.04}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${strokeWidth * 4},${strokeWidth * 3}`}
      />
    );
  }

  const points = zone.polygon
    .map((point) => `${point.x * width},${point.y * height}`)
    .join(' ');

  return (
    <SvgPolygon
      points={points}
      fill={color}
      fillOpacity={0.18}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeDasharray={`${strokeWidth * 4},${strokeWidth * 3}`}
      strokeLinejoin="round"
    />
  );
}

function renderByType(
  object: GardenPlanObject,
  width: number,
  height: number,
  color: string,
  stroke: string,
  strokeWidth: number,
): React.ReactNode {
  switch (object.type) {
    case 'tree':
      return iconTree(width, height, color, stroke, strokeWidth);
    case 'shrub':
      return iconShrub(width, height, color, stroke, strokeWidth);
    case 'flower':
      return iconFlower(width, height, color, stroke, strokeWidth);
    case 'raised_bed':
      return iconRaisedBed(width, height, color, stroke, strokeWidth);
    case 'patio':
      return iconPatio(width, height, color, stroke, strokeWidth);
    case 'path':
      return iconPathCurve(width, height, color, stroke, strokeWidth);
    case 'label':
      return iconNote(width, height, color, stroke, strokeWidth, object.label || 'Note');
    default:
      return null;
  }
}

function renderIcon(
  iconKey: GardenObjectIconKey,
  width: number,
  height: number,
  color: string,
  stroke: string,
  strokeWidth: number,
  object: GardenPlanObject,
): React.ReactNode {
  switch (iconKey) {
    // ─── water ─────────────────────────────────────────────────
    case 'pool':
      return iconPool(width, height, color, stroke, strokeWidth);
    case 'pool_round':
      return iconPoolRound(width, height, color, stroke, strokeWidth);
    case 'hot_tub':
      return iconHotTub(width, height, color, stroke, strokeWidth);
    case 'fountain':
      return iconFountain(width, height, color, stroke, strokeWidth);
    case 'pond':
      return iconPond(width, height, color, stroke, strokeWidth);
    case 'bird_bath':
      return iconBirdBath(width, height, color, stroke, strokeWidth);
    case 'waterfall':
      return iconWaterfall(width, height, color, stroke, strokeWidth);

    // ─── plants ────────────────────────────────────────────────
    case 'tree':
      return iconTree(width, height, color, stroke, strokeWidth);
    case 'tree_pine':
      return iconPine(width, height, color, stroke, strokeWidth);
    case 'palm':
      return iconPalm(width, height, color, stroke, strokeWidth);
    case 'shrub':
      return iconShrub(width, height, color, stroke, strokeWidth);
    case 'hedge':
      return iconHedge(width, height, color, stroke, strokeWidth);
    case 'flower':
      return iconFlower(width, height, color, stroke, strokeWidth);
    case 'grass':
      return iconGrass(width, height, color, stroke, strokeWidth);
    case 'cactus':
      return iconCactus(width, height, color, stroke, strokeWidth);
    case 'fern':
      return iconFern(width, height, color, stroke, strokeWidth);
    case 'vine':
      return iconVine(width, height, color, stroke, strokeWidth);

    // ─── structures ────────────────────────────────────────────
    case 'shed':
      return iconShed(width, height, color, stroke, strokeWidth);
    case 'greenhouse':
      return iconGreenhouse(width, height, color, stroke, strokeWidth);
    case 'pergola':
      return iconPergola(width, height, color, stroke, strokeWidth);
    case 'gazebo':
      return iconGazebo(width, height, color, stroke, strokeWidth);
    case 'arbor':
      return iconArbor(width, height, color, stroke, strokeWidth);
    case 'trellis':
      return iconTrellis(width, height, color, stroke, strokeWidth);
    case 'fence':
      return iconFence(width, height, color, stroke, strokeWidth);
    case 'gate':
      return iconGate(width, height, color, stroke, strokeWidth);
    case 'wall':
      return iconWall(width, height, color, stroke, strokeWidth);

    // ─── outdoor living ────────────────────────────────────────
    case 'patio':
      return iconPatio(width, height, color, stroke, strokeWidth);
    case 'deck':
      return iconDeck(width, height, color, stroke, strokeWidth);
    case 'kitchen':
      return iconKitchen(width, height, color, stroke, strokeWidth);
    case 'firepit':
      return iconFirepit(width, height, color, stroke, strokeWidth);
    case 'bbq':
      return iconBbq(width, height, color, stroke, strokeWidth);
    case 'pizza_oven':
      return iconPizzaOven(width, height, color, stroke, strokeWidth);

    // ─── furniture ─────────────────────────────────────────────
    case 'bench':
      return iconBench(width, height, color, stroke, strokeWidth);
    case 'table_chairs':
      return iconTableChairs(width, height, color, stroke, strokeWidth);
    case 'lounger':
      return iconLounger(width, height, color, stroke, strokeWidth);
    case 'hammock':
      return iconHammock(width, height, color, stroke, strokeWidth);
    case 'swing':
      return iconSwing(width, height, color, stroke, strokeWidth);
    case 'umbrella':
      return iconUmbrella(width, height, color, stroke, strokeWidth);

    // ─── decor ─────────────────────────────────────────────────
    case 'statue':
      return iconStatue(width, height, color, stroke, strokeWidth);
    case 'planter':
      return iconPlanter(width, height, color, stroke, strokeWidth);
    case 'lantern':
      return iconLantern(width, height, color, stroke, strokeWidth);
    case 'lamp_post':
      return iconLampPost(width, height, color, stroke, strokeWidth);
    case 'bird_feeder':
      return iconBirdFeeder(width, height, color, stroke, strokeWidth);

    // ─── beds ──────────────────────────────────────────────────
    case 'raised_bed':
      return iconRaisedBed(width, height, color, stroke, strokeWidth);
    case 'flower_bed':
      return iconFlowerBed(width, height, color, stroke, strokeWidth);
    case 'veg_patch':
      return iconVegPatch(width, height, color, stroke, strokeWidth);
    case 'mulch':
      return iconMulch(width, height, color, stroke, strokeWidth);

    // ─── paths ─────────────────────────────────────────────────
    case 'path_curve':
      return iconPathCurve(width, height, color, stroke, strokeWidth);
    case 'stepping_stones':
      return iconSteppingStones(width, height, color, stroke, strokeWidth);
    case 'driveway':
      return iconDriveway(width, height, color, stroke, strokeWidth);
    case 'gravel':
      return iconGravel(width, height, color, stroke, strokeWidth);
    case 'lawn':
      return iconLawn(width, height, color, stroke, strokeWidth);

    // ─── play ──────────────────────────────────────────────────
    case 'sandbox':
      return iconSandbox(width, height, color, stroke, strokeWidth);
    case 'trampoline':
      return iconTrampoline(width, height, color, stroke, strokeWidth);
    case 'play_set':
      return iconPlaySet(width, height, color, stroke, strokeWidth);

    // ─── notes ─────────────────────────────────────────────────
    case 'note':
      return iconNote(width, height, color, stroke, strokeWidth, object.label || 'Note');

    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Shared geometry helpers
// ────────────────────────────────────────────────────────────────────

function box(width: number, height: number, fill: string, stroke: string, strokeWidth: number, rx = 14) {
  return (
    <Rect
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      rx={rx}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

function lighten(color: string, amount = 0.35): string {
  // Alpha tweak — works for hex with no alpha; falls back to original.
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    return color + Math.round(255 * amount).toString(16).padStart(2, '0');
  }
  return color;
}

// ────────────────────────────────────────────────────────────────────
// Water features
// ────────────────────────────────────────────────────────────────────

function iconPool(w: number, h: number, color: string, stroke: string, sw: number) {
  const cornerR = Math.min(w, h) * 0.18;
  // Inset just enough to clear the rounded corners on each side.
  const padding = Math.max(6, Math.min(cornerR * 0.6, w * 0.06));
  const innerWidth = Math.max(0, w - padding * 2);
  // Aim for ~3–5 visible humps regardless of pool size so the wave reads as
  // water at any zoom; never less than 3 for a proper ripple, capped so very
  // wide pools don't get a busy wash.
  const segments = Math.max(3, Math.min(6, Math.round(innerWidth / Math.max(18, h * 0.6))));
  const segW = innerWidth / segments;
  const startX = -w / 2 + padding;
  const buildWave = (yOffset: number, amp: number) => {
    const parts: string[] = [`M ${startX.toFixed(2)} ${yOffset.toFixed(2)}`];
    for (let i = 0; i < segments; i++) {
      const x0 = startX + i * segW;
      const x1 = startX + (i + 1) * segW;
      const cx = (x0 + x1) / 2;
      const dir = i % 2 === 0 ? -1 : 1;
      parts.push(
        `Q ${cx.toFixed(2)} ${(yOffset + dir * amp).toFixed(2)} ${x1.toFixed(2)} ${yOffset.toFixed(2)}`,
      );
    }
    return parts.join(' ');
  };
  const strokeW = Math.max(2, sw * 0.6);
  return (
    <G>
      {box(w, h, color, stroke, sw, cornerR)}
      {/* water ripples */}
      <Path
        d={buildWave(-h * 0.12, Math.min(h * 0.18, 14))}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.75}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      <Path
        d={buildWave(h * 0.16, Math.min(h * 0.14, 10))}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.5}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
    </G>
  );
}

function iconPoolRound(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Circle r={r} fill={color} stroke={stroke} strokeWidth={sw} />
      <Circle r={r * 0.72} fill="none" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={sw * 0.5} />
      <Circle r={r * 0.42} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={sw * 0.5} />
    </G>
  );
}

function iconHotTub(w: number, h: number, color: string, stroke: string, sw: number) {
  const side = Math.min(w, h);
  return (
    <G>
      {box(side, side, color, stroke, sw, side * 0.18)}
      {Array.from({ length: 4 }).map((_, i) => (
        <Circle
          key={i}
          cx={(-side / 2 + side * 0.25) + (i % 2) * side * 0.5}
          cy={(-side / 2 + side * 0.25) + Math.floor(i / 2) * side * 0.5}
          r={side * 0.07}
          fill="#FFFFFF"
          fillOpacity={0.65}
        />
      ))}
    </G>
  );
}

function iconFountain(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Circle r={r} fill={color} stroke={stroke} strokeWidth={sw} />
      <Circle r={r * 0.6} fill={lighten(color, 0.35)} stroke={stroke} strokeWidth={sw * 0.5} />
      <Circle r={r * 0.22} fill="#FFFFFF" stroke={stroke} strokeWidth={sw * 0.5} />
      <Path
        d={`M 0 ${-r * 0.22} q ${-r * 0.12} ${-r * 0.4} 0 ${-r * 0.6} q ${r * 0.12} ${r * 0.2} 0 ${r * 0.6}`}
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeWidth={sw * 0.4}
      />
    </G>
  );
}

function iconPond(w: number, h: number, color: string, stroke: string, sw: number) {
  // organic blob using a smooth path
  const a = w / 2;
  const b = h / 2;
  return (
    <G>
      <Path
        d={`M ${-a} 0
          C ${-a} ${-b * 1.05}, ${-a * 0.2} ${-b * 1.1}, ${a * 0.4} ${-b * 0.9}
          C ${a * 1.1} ${-b * 0.7}, ${a * 1.05} ${b * 0.6}, ${a * 0.3} ${b * 0.95}
          C ${-a * 0.5} ${b * 1.1}, ${-a * 1.05} ${b * 0.4}, ${-a} 0 Z`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
      />
      <Path
        d={`M ${-a * 0.4} ${-b * 0.2} q ${a * 0.2} ${-b * 0.2} ${a * 0.6} 0`}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.6}
        strokeWidth={sw * 0.5}
        strokeLinecap="round"
      />
    </G>
  );
}

function iconBirdBath(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Circle r={r} fill={color} stroke={stroke} strokeWidth={sw} />
      <Circle r={r * 0.6} fill="#E0F2FE" stroke={stroke} strokeWidth={sw * 0.5} />
      <Circle r={r * 0.18} fill="#FFFFFF" />
    </G>
  );
}

function iconWaterfall(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      {box(w, h, color, stroke, sw, Math.min(w, h) * 0.25)}
      {Array.from({ length: 3 }).map((_, i) => (
        <Path
          key={i}
          d={`M ${-w / 4 + i * (w / 4)} ${-h / 2 + 8} q 8 ${h / 3} 0 ${h - 16}`}
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity={0.7}
          strokeWidth={sw * 0.6}
          strokeLinecap="round"
        />
      ))}
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Plants
// ────────────────────────────────────────────────────────────────────

function iconTree(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  // Top-down view of a deciduous tree: a leafy canopy made of overlapping
  // foliage clusters around a central trunk, with inner highlights for depth.
  const clusters = 7;
  const clusterR = r * 0.42;
  const ringR = r * 0.58;
  const highlight = lighten(color, 0.55);
  return (
    <G>
      {/* Outer foliage clusters create a scalloped, leafy silhouette */}
      {Array.from({ length: clusters }).map((_, i) => {
        const angle = (i / clusters) * Math.PI * 2 - Math.PI / 2;
        return (
          <Circle
            key={`o-${i}`}
            cx={Math.cos(angle) * ringR}
            cy={Math.sin(angle) * ringR}
            r={clusterR}
            fill={color}
            stroke={stroke}
            strokeWidth={sw * 0.7}
          />
        );
      })}
      {/* Central canopy mass blends the clusters into one form */}
      <Circle r={r * 0.7} fill={color} stroke={stroke} strokeWidth={sw * 0.7} />
      {/* Inner highlight clusters add dimension and a sun-lit feel */}
      {Array.from({ length: clusters }).map((_, i) => {
        const angle = (i / clusters) * Math.PI * 2 - Math.PI / 2 + Math.PI / clusters;
        return (
          <Circle
            key={`i-${i}`}
            cx={Math.cos(angle) * r * 0.32}
            cy={Math.sin(angle) * r * 0.32}
            r={r * 0.2}
            fill={highlight}
          />
        );
      })}
      {/* Trunk peeking through the canopy */}
      <Circle r={r * 0.13} fill="#7C2D12" stroke={stroke} strokeWidth={sw * 0.4} />
    </G>
  );
}

function iconPine(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  // Top-down view of a conifer: a star-burst of needled boughs radiating
  // from a small central trunk.
  const points = 10;
  const outer = r;
  const inner = r * 0.62;
  const trunkR = r * 0.12;
  const path = Array.from({ length: points * 2 })
    .map((_, i) => {
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? outer : inner;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ') + ' Z';
  return (
    <G>
      <Path
        d={path}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* Inner star with lighter shade for depth */}
      <Path
        d={Array.from({ length: points * 2 })
          .map((_, i) => {
            const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
            const radius = i % 2 === 0 ? r * 0.58 : r * 0.32;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join(' ') + ' Z'}
        fill={lighten(color, 0.4)}
        stroke={stroke}
        strokeWidth={sw * 0.4}
        strokeLinejoin="round"
      />
      {/* Trunk at the very center */}
      <Circle r={trunkR} fill="#7C2D12" stroke={stroke} strokeWidth={sw * 0.4} />
    </G>
  );
}

function iconPalm(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  const fronds = 9;
  const highlight = lighten(color, 0.4);
  return (
    <G>
      {/* Long, drooping fronds radiating from the trunk */}
      {Array.from({ length: fronds }).map((_, i) => {
        const angle = (i / fronds) * Math.PI * 2;
        const deg = (angle * 180) / Math.PI;
        const len = r * 0.95;
        return (
          <G key={`f-${i}`} transform={`rotate(${deg})`}>
            {/* Frond leaf */}
            <Path
              d={`M 0 0 Q ${len * 0.5} ${-r * 0.18} ${len} 0 Q ${len * 0.5} ${r * 0.18} 0 0 Z`}
              fill={color}
              stroke={stroke}
              strokeWidth={sw * 0.5}
              strokeLinejoin="round"
            />
            {/* Frond rib for a feathered look */}
            <Path
              d={`M 0 0 L ${len} 0`}
              stroke={highlight}
              strokeWidth={sw * 0.4}
              strokeOpacity={0.8}
              strokeLinecap="round"
            />
          </G>
        );
      })}
      {/* Trunk with coconut cluster */}
      <Circle r={r * 0.2} fill="#92400E" stroke={stroke} strokeWidth={sw * 0.5} />
      <Circle cx={-r * 0.07} cy={-r * 0.07} r={r * 0.06} fill="#FBBF24" fillOpacity={0.9} />
      <Circle cx={r * 0.08} cy={r * 0.05} r={r * 0.05} fill="#FBBF24" fillOpacity={0.9} />
    </G>
  );
}

function iconShrub(w: number, h: number, color: string, stroke: string, sw: number) {
  return <Ellipse rx={w / 2} ry={h / 2} fill={color} stroke={stroke} strokeWidth={sw} />;
}

function iconHedge(w: number, h: number, color: string, stroke: string, sw: number) {
  const bumps = Math.max(3, Math.min(8, Math.round(w / Math.max(h, 1))));
  const bumpW = w / bumps;
  const r = Math.min(bumpW, h) / 2;
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2 + r * 0.2} width={w} height={h - r * 0.2} rx={r * 0.4} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: bumps }).map((_, i) => (
        <Circle
          key={i}
          cx={-w / 2 + bumpW / 2 + i * bumpW}
          cy={-h / 2 + r}
          r={r * 0.95}
          fill={lighten(color, 0.35)}
          stroke={stroke}
          strokeWidth={sw * 0.5}
        />
      ))}
    </G>
  );
}

function iconFlower(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <Circle
            key={i}
            cx={Math.cos(angle) * w * 0.22}
            cy={Math.sin(angle) * h * 0.22}
            r={Math.min(w, h) * 0.18}
            fill={color}
            stroke={stroke}
            strokeWidth={sw / 2}
          />
        );
      })}
      <Circle r={Math.min(w, h) * 0.14} fill="#FFFFFF" stroke={stroke} strokeWidth={sw / 2} />
    </G>
  );
}

function iconGrass(w: number, h: number, color: string, _stroke: string, sw: number) {
  const blades = 5;
  return (
    <G>
      {Array.from({ length: blades }).map((_, i) => {
        const x = -w / 2 + (i + 0.5) * (w / blades);
        return (
          <Path
            key={i}
            d={`M ${x} ${h / 2} q ${(i % 2 === 0 ? -1 : 1) * w * 0.05} ${-h / 2} 0 ${-h}`}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(2, sw * 0.7)}
            strokeLinecap="round"
          />
        );
      })}
    </G>
  );
}

function iconCactus(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w * 0.2} y={-h / 2} width={w * 0.4} height={h} rx={w * 0.18} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={-w * 0.5} y={-h * 0.18} width={w * 0.3} height={h * 0.4} rx={w * 0.1} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={w * 0.2} y={-h * 0.05} width={w * 0.3} height={h * 0.35} rx={w * 0.1} fill={color} stroke={stroke} strokeWidth={sw} />
    </G>
  );
}

function iconFern(w: number, h: number, color: string, stroke: string, sw: number) {
  const fronds = 6;
  return (
    <G>
      {Array.from({ length: fronds }).map((_, i) => {
        const angle = -90 + (i / (fronds - 1)) * 180;
        return (
          <Ellipse
            key={i}
            cx={0}
            cy={0}
            rx={w * 0.45}
            ry={h * 0.1}
            fill={color}
            stroke={stroke}
            strokeWidth={sw * 0.5}
            transform={`rotate(${angle} 0 0)`}
          />
        );
      })}
    </G>
  );
}

function iconVine(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Path
        d={`M ${-w / 2} 0 q ${w / 4} ${-h} ${w / 2} 0 t ${w / 2} 0`}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(2, sw)}
        strokeLinecap="round"
      />
      {Array.from({ length: 5 }).map((_, i) => (
        <Circle
          key={i}
          cx={-w / 2 + (i + 0.5) * (w / 5)}
          cy={(i % 2 === 0 ? -1 : 1) * h * 0.3}
          r={Math.min(w, h) * 0.08}
          fill={lighten(color, 0.4)}
          stroke={stroke}
          strokeWidth={sw * 0.4}
        />
      ))}
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Structures
// ────────────────────────────────────────────────────────────────────

function iconShed(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2 + h * 0.25} width={w} height={h * 0.75} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      <Path
        d={`M ${-w / 2 - 6} ${-h / 2 + h * 0.25} L 0 ${-h / 2} L ${w / 2 + 6} ${-h / 2 + h * 0.25} Z`}
        fill={lighten(color, 0.3)}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <Rect x={-w * 0.12} y={h * 0.05} width={w * 0.24} height={h * 0.3} fill={lighten(color, 0.5)} stroke={stroke} strokeWidth={sw * 0.5} />
    </G>
  );
}

function iconGreenhouse(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2 + h * 0.2} width={w} height={h * 0.8} rx={8} fill={color} fillOpacity={0.6} stroke={stroke} strokeWidth={sw} />
      <Path
        d={`M ${-w / 2 - 4} ${-h / 2 + h * 0.2} L 0 ${-h / 2} L ${w / 2 + 4} ${-h / 2 + h * 0.2} Z`}
        fill={lighten(color, 0.4)}
        stroke={stroke}
        strokeWidth={sw}
      />
      <Line x1={0} y1={-h / 2} x2={0} y2={h / 2} stroke={stroke} strokeWidth={sw * 0.5} />
      <Line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={stroke} strokeWidth={sw * 0.5} />
    </G>
  );
}

function iconPergola(w: number, h: number, color: string, stroke: string, sw: number) {
  const beams = 5;
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} fillOpacity={0.5} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: beams }).map((_, i) => (
        <Line
          key={i}
          x1={-w / 2 + (i + 1) * (w / (beams + 1))}
          y1={-h / 2}
          x2={-w / 2 + (i + 1) * (w / (beams + 1))}
          y2={h / 2}
          stroke={stroke}
          strokeWidth={sw * 0.7}
        />
      ))}
    </G>
  );
}

function iconGazebo(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  // hexagon
  const points = Array.from({ length: 6 })
    .map((_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      return `${Math.cos(angle) * r},${Math.sin(angle) * r}`;
    })
    .join(' ');
  return (
    <G>
      <Path
        d={`M ${points.split(' ').join(' L ')} Z`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        return (
          <Line
            key={i}
            x1={0}
            y1={0}
            x2={Math.cos(angle) * r}
            y2={Math.sin(angle) * r}
            stroke={stroke}
            strokeWidth={sw * 0.5}
          />
        );
      })}
    </G>
  );
}

function iconArbor(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Path
        d={`M ${-w / 2} ${h / 2} L ${-w / 2} ${-h / 2 + h * 0.3} q ${w / 2} ${-h * 0.6} ${w} 0 L ${w / 2} ${h / 2}`}
        fill={lighten(color, 0.45)}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </G>
  );
}

function iconTrellis(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill={lighten(color, 0.4)} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: 5 }).map((_, i) => (
        <Line
          key={`v-${i}`}
          x1={-w / 2 + (i + 1) * (w / 6)}
          y1={-h / 2}
          x2={-w / 2 + (i + 1) * (w / 6)}
          y2={h / 2}
          stroke={color}
          strokeWidth={sw * 0.6}
        />
      ))}
      {Array.from({ length: 2 }).map((_, i) => (
        <Line
          key={`h-${i}`}
          x1={-w / 2}
          y1={-h / 2 + (i + 1) * (h / 3)}
          x2={w / 2}
          y2={-h / 2 + (i + 1) * (h / 3)}
          stroke={color}
          strokeWidth={sw * 0.6}
        />
      ))}
    </G>
  );
}

function iconFence(w: number, h: number, color: string, stroke: string, sw: number) {
  const posts = Math.max(4, Math.round(w / Math.max(h * 2, 1)));
  return (
    <G>
      <Line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color} strokeWidth={Math.max(2, h * 0.4)} strokeLinecap="round" />
      {Array.from({ length: posts }).map((_, i) => (
        <Rect
          key={i}
          x={-w / 2 + (i + 0.5) * (w / posts) - h * 0.18}
          y={-h / 2}
          width={h * 0.36}
          height={h}
          rx={h * 0.1}
          fill={color}
          stroke={stroke}
          strokeWidth={sw * 0.5}
        />
      ))}
    </G>
  );
}

function iconGate(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill={color} stroke={stroke} strokeWidth={sw} />
      <Line x1={-w / 2} y1={-h / 2} x2={w / 2} y2={h / 2} stroke={stroke} strokeWidth={sw * 0.6} />
      <Line x1={-w / 2} y1={h / 2} x2={w / 2} y2={-h / 2} stroke={stroke} strokeWidth={sw * 0.6} />
    </G>
  );
}

function iconWall(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill={color} stroke={stroke} strokeWidth={sw} />
      <Line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={lighten(color, 0.3)} strokeWidth={sw * 0.5} />
      {Array.from({ length: 5 }).map((_, i) => (
        <Line
          key={i}
          x1={-w / 2 + (i + 1) * (w / 6)}
          y1={-h / 2}
          x2={-w / 2 + (i + 1) * (w / 6)}
          y2={0}
          stroke={lighten(color, 0.3)}
          strokeWidth={sw * 0.4}
        />
      ))}
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Outdoor living
// ────────────────────────────────────────────────────────────────────

function iconPatio(w: number, h: number, color: string, stroke: string, sw: number) {
  return box(w, h, color, stroke, sw, Math.min(w, h) * 0.12);
}

function iconDeck(w: number, h: number, color: string, stroke: string, sw: number) {
  const planks = Math.max(4, Math.round(w / Math.max(h * 0.4, 1)));
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: planks - 1 }).map((_, i) => (
        <Line
          key={i}
          x1={-w / 2 + (i + 1) * (w / planks)}
          y1={-h / 2}
          x2={-w / 2 + (i + 1) * (w / planks)}
          y2={h / 2}
          stroke={stroke}
          strokeWidth={sw * 0.4}
          strokeOpacity={0.55}
        />
      ))}
    </G>
  );
}

function iconKitchen(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={-w * 0.4} y={-h * 0.35} width={w * 0.25} height={h * 0.3} rx={3} fill="#1F2937" stroke="#FFFFFF" strokeWidth={sw * 0.4} />
      <Rect x={-w * 0.05} y={-h * 0.35} width={w * 0.25} height={h * 0.3} rx={3} fill="#FFFFFF" stroke="#1F2937" strokeWidth={sw * 0.4} />
      <Rect x={w * 0.22} y={-h * 0.35} width={w * 0.18} height={h * 0.3} rx={3} fill={lighten(color, 0.4)} stroke={stroke} strokeWidth={sw * 0.4} />
    </G>
  );
}

function iconFirepit(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Circle r={r} fill="#1F2937" stroke={stroke} strokeWidth={sw} />
      <Circle r={r * 0.7} fill={color} />
      <Path
        d={`M 0 ${r * 0.3} q ${-r * 0.4} ${-r * 0.5} 0 ${-r * 0.9} q ${r * 0.4} ${r * 0.3} 0 ${r * 0.9}`}
        fill="#FBBF24"
        stroke="#FFFFFF"
        strokeWidth={sw * 0.4}
      />
    </G>
  );
}

function iconBbq(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h * 0.1} width={w} height={h * 0.6} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={-w / 2 + 4} y={0} width={w - 8} height={h * 0.18} rx={3} fill="#FBBF24" />
      <Line x1={-w * 0.3} y1={h * 0.4} x2={-w * 0.3} y2={h / 2} stroke={stroke} strokeWidth={sw * 0.7} />
      <Line x1={w * 0.3} y1={h * 0.4} x2={w * 0.3} y2={h / 2} stroke={stroke} strokeWidth={sw * 0.7} />
    </G>
  );
}

function iconPizzaOven(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Path
        d={`M ${-r} ${r} L ${-r} 0 a ${r} ${r} 0 1 1 ${r * 2} 0 L ${r} ${r} Z`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
      />
      <Circle cx={0} cy={r * 0.05} r={r * 0.45} fill="#1F2937" stroke="#FFFFFF" strokeWidth={sw * 0.4} />
      <Circle cx={0} cy={r * 0.05} r={r * 0.28} fill="#FBBF24" />
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Furniture
// ────────────────────────────────────────────────────────────────────

function iconBench(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h * 0.2} width={w} height={h * 0.5} rx={4} fill={color} stroke={stroke} strokeWidth={sw} />
      <Line x1={-w / 2} y1={h * 0.05} x2={w / 2} y2={h * 0.05} stroke={stroke} strokeOpacity={0.3} strokeWidth={sw * 0.4} />
      <Rect x={-w * 0.42} y={h * 0.3} width={w * 0.1} height={h * 0.5} rx={2} fill={color} stroke={stroke} strokeWidth={sw * 0.5} />
      <Rect x={w * 0.32} y={h * 0.3} width={w * 0.1} height={h * 0.5} rx={2} fill={color} stroke={stroke} strokeWidth={sw * 0.5} />
    </G>
  );
}

function iconTableChairs(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Circle r={r} fill={color} stroke={stroke} strokeWidth={sw} />
      <Circle r={r * 0.55} fill={lighten(color, 0.35)} stroke={stroke} strokeWidth={sw * 0.5} />
      {Array.from({ length: 4 }).map((_, i) => {
        const angle = (Math.PI / 2) * i + Math.PI / 4;
        return (
          <Circle
            key={i}
            cx={Math.cos(angle) * r * 1.15}
            cy={Math.sin(angle) * r * 1.15}
            r={r * 0.28}
            fill={lighten(color, 0.5)}
            stroke={stroke}
            strokeWidth={sw * 0.5}
          />
        );
      })}
    </G>
  );
}

function iconLounger(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(w, h) * 0.3} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={-w * 0.4} y={-h / 2 + 4} width={w * 0.8} height={h * 0.3} rx={Math.min(w, h) * 0.2} fill={lighten(color, 0.45)} />
    </G>
  );
}

function iconHammock(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Path
        d={`M ${-w / 2} ${-h / 2} q 0 ${h * 1.2} ${w} 0`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
      />
      {Array.from({ length: 5 }).map((_, i) => (
        <Line
          key={i}
          x1={-w / 2 + (i + 1) * (w / 6)}
          y1={-h / 2 + h * 0.05}
          x2={-w / 2 + (i + 1) * (w / 6)}
          y2={h * 0.4}
          stroke="#FFFFFF"
          strokeOpacity={0.6}
          strokeWidth={sw * 0.4}
        />
      ))}
    </G>
  );
}

function iconSwing(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h * 0.5} rx={2} fill={color} stroke={stroke} strokeWidth={sw} />
      <Line x1={-w * 0.4} y1={-h / 2} x2={-w * 0.4} y2={-h * 1.2} stroke={stroke} strokeWidth={sw * 0.5} />
      <Line x1={w * 0.4} y1={-h / 2} x2={w * 0.4} y2={-h * 1.2} stroke={stroke} strokeWidth={sw * 0.5} />
    </G>
  );
}

function iconUmbrella(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Path
        d={`M ${-r} 0 a ${r} ${r} 0 1 1 ${r * 2} 0 Z`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
      />
      <Path d={`M ${-r * 0.5} 0 q 0 ${-r * 0.5} ${r * 0.5} 0`} fill={lighten(color, 0.3)} />
      <Path d={`M ${r * 0.5} 0 q 0 ${-r * 0.5} ${-r * 0.5} 0`} fill={lighten(color, 0.5)} />
      <Line x1={0} y1={0} x2={0} y2={r * 0.95} stroke={stroke} strokeWidth={sw * 0.6} />
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Decor
// ────────────────────────────────────────────────────────────────────

function iconStatue(w: number, h: number, color: string, stroke: string, sw: number) {
  const half = Math.min(w, h) / 2;
  return (
    <G>
      <Rect x={-half * 0.7} y={half * 0.4} width={half * 1.4} height={half * 0.6} rx={2} fill={color} stroke={stroke} strokeWidth={sw} />
      <Circle cx={0} cy={-half * 0.4} r={half * 0.5} fill={lighten(color, 0.4)} stroke={stroke} strokeWidth={sw * 0.7} />
      <Rect x={-half * 0.25} y={-half * 0.05} width={half * 0.5} height={half * 0.5} rx={2} fill={lighten(color, 0.4)} stroke={stroke} strokeWidth={sw * 0.7} />
    </G>
  );
}

function iconPlanter(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Path
        d={`M ${-r * 0.85} ${-r * 0.2} L ${-r * 0.6} ${r} L ${r * 0.6} ${r} L ${r * 0.85} ${-r * 0.2} Z`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
      />
      <Ellipse cx={0} cy={-r * 0.2} rx={r * 0.85} ry={r * 0.18} fill={lighten(color, 0.4)} stroke={stroke} strokeWidth={sw * 0.6} />
      <Circle cx={-r * 0.3} cy={-r * 0.55} r={r * 0.32} fill="#16A34A" />
      <Circle cx={r * 0.3} cy={-r * 0.55} r={r * 0.28} fill="#22C55E" />
    </G>
  );
}

function iconLantern(w: number, h: number, color: string, stroke: string, sw: number) {
  const half = Math.min(w, h) / 2;
  return (
    <G>
      <Rect x={-half * 0.7} y={-half * 0.2} width={half * 1.4} height={half * 1.2} rx={half * 0.15} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={-half * 0.5} y={-half * 0.05} width={half * 1} height={half * 0.9} rx={half * 0.08} fill="#FFFFFF" stroke={stroke} strokeWidth={sw * 0.5} />
      <Line x1={0} y1={-half * 0.2} x2={0} y2={-half} stroke={stroke} strokeWidth={sw * 0.5} />
    </G>
  );
}

function iconLampPost(w: number, h: number, color: string, stroke: string, sw: number) {
  const half = Math.min(w, h) / 2;
  return (
    <G>
      <Defs>
        <LinearGradient id="lampGlow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FEF3C7" stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="0.9" />
        </LinearGradient>
      </Defs>
      <Circle r={half} fill="url(#lampGlow)" stroke={stroke} strokeWidth={sw} />
      <Circle r={half * 0.45} fill="#FFFFFF" fillOpacity={0.85} />
    </G>
  );
}

function iconBirdFeeder(w: number, h: number, color: string, stroke: string, sw: number) {
  const half = Math.min(w, h) / 2;
  return (
    <G>
      <Path
        d={`M ${-half} 0 L 0 ${-half} L ${half} 0 Z`}
        fill={color}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <Rect x={-half * 0.8} y={0} width={half * 1.6} height={half * 0.6} rx={2} fill={lighten(color, 0.4)} stroke={stroke} strokeWidth={sw * 0.6} />
      <Line x1={0} y1={-half} x2={0} y2={-half * 1.4} stroke={stroke} strokeWidth={sw * 0.5} />
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Beds
// ────────────────────────────────────────────────────────────────────

function iconRaisedBed(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(w, h) * 0.2} fill={color} stroke={stroke} strokeWidth={sw} />
      <Rect x={-w / 2 + sw} y={-h / 2 + sw} width={w - sw * 2} height={h - sw * 2} rx={Math.min(w, h) * 0.16} fill={lighten(color, 0.4)} />
    </G>
  );
}

function iconFlowerBed(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      {iconRaisedBed(w, h, color, stroke, sw)}
      {Array.from({ length: 6 }).map((_, i) => (
        <Circle
          key={i}
          cx={-w / 2 + (i + 0.5) * (w / 6)}
          cy={(i % 2 === 0 ? -1 : 1) * h * 0.18}
          r={Math.min(w, h) * 0.1}
          fill="#EC4899"
          stroke="#FFFFFF"
          strokeWidth={sw * 0.4}
        />
      ))}
    </G>
  );
}

function iconVegPatch(w: number, h: number, color: string, stroke: string, sw: number) {
  const rows = 4;
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: rows - 1 }).map((_, i) => (
        <Line
          key={i}
          x1={-w / 2 + 6}
          y1={-h / 2 + (i + 1) * (h / rows)}
          x2={w / 2 - 6}
          y2={-h / 2 + (i + 1) * (h / rows)}
          stroke="#FFFFFF"
          strokeOpacity={0.5}
          strokeWidth={sw * 0.4}
          strokeDasharray="6 4"
        />
      ))}
    </G>
  );
}

function iconMulch(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: 12 }).map((_, i) => (
        <Circle
          key={i}
          cx={-w / 2 + (i % 4) * (w / 4) + (w / 8) + ((i % 2) * 6)}
          cy={-h / 2 + Math.floor(i / 4) * (h / 3) + h / 6}
          r={Math.min(w, h) * 0.04}
          fill={lighten(color, 0.4)}
        />
      ))}
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Paths & surfaces
// ────────────────────────────────────────────────────────────────────

function iconPathCurve(w: number, h: number, color: string, _stroke: string, sw: number) {
  return (
    <Path
      d={`M ${-w / 2} 0 C ${-w / 4} ${-h} ${w / 4} ${h} ${w / 2} 0`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(sw * 1.5, h)}
      strokeLinecap="round"
    />
  );
}

function iconSteppingStones(w: number, _h: number, color: string, stroke: string, sw: number) {
  const stones = 5;
  const r = (w / stones) * 0.4;
  return (
    <G>
      {Array.from({ length: stones }).map((_, i) => (
        <Ellipse
          key={i}
          cx={-w / 2 + (i + 0.5) * (w / stones)}
          cy={i % 2 === 0 ? -r * 0.2 : r * 0.2}
          rx={r}
          ry={r * 0.7}
          fill={color}
          stroke={stroke}
          strokeWidth={sw * 0.6}
        />
      ))}
    </G>
  );
}

function iconDriveway(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      <Line x1={0} y1={-h / 2 + 6} x2={0} y2={h / 2 - 6} stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={sw * 0.4} strokeDasharray="10 8" />
    </G>
  );
}

function iconGravel(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: 18 }).map((_, i) => (
        <Circle
          key={i}
          cx={-w / 2 + (i % 6) * (w / 6) + (w / 12) + ((i % 3) * 4)}
          cy={-h / 2 + Math.floor(i / 6) * (h / 3) + h / 6}
          r={Math.min(w, h) * 0.05}
          fill="#FFFFFF"
          fillOpacity={0.45}
        />
      ))}
    </G>
  );
}

function iconLawn(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(w, h) * 0.08} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: 24 }).map((_, i) => {
        const x = -w / 2 + ((i % 8) + 0.5) * (w / 8);
        const y = -h / 2 + (Math.floor(i / 8) + 0.5) * (h / 3);
        return (
          <Path
            key={i}
            d={`M ${x} ${y + 6} q -4 -8 0 -16`}
            fill="none"
            stroke={lighten(color, -0.1) === color ? '#15803D' : '#15803D'}
            strokeOpacity={0.5}
            strokeWidth={sw * 0.4}
            strokeLinecap="round"
          />
        );
      })}
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Play
// ────────────────────────────────────────────────────────────────────

function iconSandbox(w: number, h: number, color: string, stroke: string, sw: number) {
  const side = Math.min(w, h);
  return (
    <G>
      <Rect x={-side / 2} y={-side / 2} width={side} height={side} rx={side * 0.08} fill={color} stroke={stroke} strokeWidth={sw} />
      {Array.from({ length: 16 }).map((_, i) => (
        <Circle
          key={i}
          cx={-side / 2 + ((i % 4) + 0.5) * (side / 4)}
          cy={-side / 2 + (Math.floor(i / 4) + 0.5) * (side / 4)}
          r={side * 0.025}
          fill="#92400E"
          fillOpacity={0.55}
        />
      ))}
    </G>
  );
}

function iconTrampoline(w: number, h: number, color: string, stroke: string, sw: number) {
  const r = Math.min(w, h) / 2;
  return (
    <G>
      <Circle r={r} fill={color} stroke={stroke} strokeWidth={sw} />
      <Circle r={r * 0.78} fill="#FFFFFF" stroke={stroke} strokeWidth={sw * 0.4} />
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        return (
          <Line
            key={i}
            x1={Math.cos(angle) * r * 0.78}
            y1={Math.sin(angle) * r * 0.78}
            x2={Math.cos(angle) * r}
            y2={Math.sin(angle) * r}
            stroke={stroke}
            strokeWidth={sw * 0.4}
          />
        );
      })}
    </G>
  );
}

function iconPlaySet(w: number, h: number, color: string, stroke: string, sw: number) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={color} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
      <Rect x={-w * 0.4} y={-h * 0.1} width={w * 0.3} height={h * 0.5} rx={4} fill="#F59E0B" stroke={stroke} strokeWidth={sw * 0.5} />
      <Path
        d={`M ${w * 0.05} ${-h * 0.4} L ${w * 0.45} ${h * 0.4} L ${-w * 0.05} ${h * 0.4} Z`}
        fill="#22D3EE"
        stroke={stroke}
        strokeWidth={sw * 0.5}
        strokeLinejoin="round"
      />
    </G>
  );
}

// ────────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────────

function iconNote(w: number, h: number, color: string, stroke: string, sw: number, label: string) {
  return (
    <G>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(w, h) * 0.4} fill={`${color}DD`} stroke={stroke} strokeWidth={sw} />
      <SvgText
        x={0}
        y={Math.min(w, h) * 0.16}
        fill="#FFFFFF"
        fontSize={Math.max(20, Math.min(w, h) * 0.55)}
        fontWeight="700"
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </G>
  );
}
