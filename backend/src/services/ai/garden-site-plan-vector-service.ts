import type { GeoJsonPolygonGeometry } from '../../types/geo';

export const GARDEN_PLAN_VECTOR_WIDTH = 1536;
export const GARDEN_PLAN_VECTOR_HEIGHT = 1024;

type Point = { x: number; y: number };
type LatLng = { latitude: number; longitude: number };

interface EditableGardenPlanSvgInput {
  boundaryGeojson: string | null;
  diagramPrompt: string;
  areaLabel: string;
}

export interface EditableGardenPlanSvgResult {
  svg: string;
  width: number;
  height: number;
}

export function generateEditableGardenPlanSvg(
  input: EditableGardenPlanSvgInput
): EditableGardenPlanSvgResult | null {
  const geometry = parseJson<GeoJsonPolygonGeometry>(input.boundaryGeojson);
  if (!geometry) return null;

  const boundary = firstRing(geometry);
  if (boundary.length < 3) return null;

  const projectedBoundary = projectRing(boundary);
  const featureLabels = extractMustHaveLabels(input.diagramPrompt);
  const featurePoints = layoutFeaturePoints(projectedBoundary, featureLabels.length);
  const featureElements = featureLabels.map((label, index) =>
    renderFeatureElement(label, featurePoints[index], index)
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${GARDEN_PLAN_VECTOR_WIDTH}" height="${GARDEN_PLAN_VECTOR_HEIGHT}" viewBox="0 0 ${GARDEN_PLAN_VECTOR_WIDTH} ${GARDEN_PLAN_VECTOR_HEIGHT}">
  <title>${escapeXml(input.areaLabel)} editable garden plan</title>
  <desc>Editable vector garden plan generated from the confirmed map boundary. Add, move, or restyle objects as SVG vector elements.</desc>
  <rect id="background" width="100%" height="100%" fill="#f7f3ea"/>
  <g id="editable-plan">
    <polygon id="confirmed-boundary" points="${pointsAttr(projectedBoundary)}" fill="#dcefcf" stroke="#2f7d32" stroke-width="6" stroke-linejoin="round"/>
    <g id="lawn-zone">
      <polygon points="${pointsAttr(scalePolygon(projectedBoundary, 0.78))}" fill="#b9dc94" stroke="#7aad5b" stroke-width="3" stroke-dasharray="10 8"/>
      <text x="${GARDEN_PLAN_VECTOR_WIDTH / 2}" y="${GARDEN_PLAN_VECTOR_HEIGHT / 2}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="#365c2b">Open lawn / flexible garden zone</text>
    </g>
    <g id="planting-border" fill="none" stroke="#5f8f3d" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
      <polyline points="${pointsAttr(scalePolygon(projectedBoundary, 0.92))}"/>
    </g>
    <g id="editable-objects">
      ${featureElements.join('\n      ')}
    </g>
  </g>
</svg>`;

  return {
    svg,
    width: GARDEN_PLAN_VECTOR_WIDTH,
    height: GARDEN_PLAN_VECTOR_HEIGHT,
  };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function firstRing(geometry: GeoJsonPolygonGeometry): LatLng[] {
  const ring =
    geometry.type === 'Polygon'
      ? (geometry.coordinates as unknown[])[0]
      : ((geometry.coordinates as unknown[])[0] as unknown[] | undefined)?.[0];
  if (!Array.isArray(ring)) return [];
  return ring
    .slice(0, -1)
    .map((coord) => {
      if (!Array.isArray(coord)) return null;
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon };
    })
    .filter((coord): coord is LatLng => coord !== null);
}

function projectRing(ring: LatLng[]): Point[] {
  const lats = ring.map((coord) => coord.latitude);
  const lons = ring.map((coord) => coord.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pad = 96;
  const width = GARDEN_PLAN_VECTOR_WIDTH - pad * 2;
  const height = GARDEN_PLAN_VECTOR_HEIGHT - pad * 2;
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  const scale = Math.min(width / lonSpan, height / latSpan);
  const renderedWidth = lonSpan * scale;
  const renderedHeight = latSpan * scale;
  const offsetX = (GARDEN_PLAN_VECTOR_WIDTH - renderedWidth) / 2;
  const offsetY = (GARDEN_PLAN_VECTOR_HEIGHT - renderedHeight) / 2;

  return ring.map((coord) => ({
    x: offsetX + (coord.longitude - minLon) * scale,
    y: offsetY + (maxLat - coord.latitude) * scale,
  }));
}

function extractMustHaveLabels(prompt: string): string[] {
  const match = prompt.match(/Must include, each clearly labeled in plan view: ([^.]+)/i);
  const raw = match?.[1] ?? '';
  const labels = raw
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .slice(0, 8);
  return labels.length > 0 ? labels : ['Planting bed', 'Path', 'Seating'];
}

function layoutFeaturePoints(boundary: Point[], count: number): Point[] {
  const center = polygonCenter(boundary);
  const radiusX = GARDEN_PLAN_VECTOR_WIDTH * 0.24;
  const radiusY = GARDEN_PLAN_VECTOR_HEIGHT * 0.22;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
}

function renderFeatureElement(label: string, point: Point, index: number): string {
  const id = slugify(label) || `object-${index + 1}`;
  const color = ['#77a95c', '#d9a441', '#9aa66f', '#c07c59'][index % 4];
  return `<g id="${id}" class="editable-object" transform="translate(${round(point.x)} ${round(point.y)})">
        <circle r="44" fill="${color}" stroke="#2f4f2f" stroke-width="4"/>
        <text y="8" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>
      </g>`;
}

function scalePolygon(points: Point[], factor: number): Point[] {
  const center = polygonCenter(points);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  }));
}

function polygonCenter(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function pointsAttr(points: Point[]): string {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(' ');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
