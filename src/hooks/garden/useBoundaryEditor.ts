import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LatLng } from 'react-native-maps';

import {
  gardenPlansApi,
  type GardenPlan,
  type GardenPlanMeasurementUnit,
  type GeoJsonPolygonGeometry,
} from '@api/garden-plans';
import type { Household } from '@api/households';
import { showToast } from '@services/toastManager';
import { useSettingsStore } from '@stores/settingsStore';

const METERS_TO_FEET = 3.280839895;
const SQ_METERS_TO_SQ_FEET = 10.7639104167;
const COORDINATE_EPSILON = 0.000000001;
const HISTORY_MAX = 25;

export type EdgeMetric = {
  index: number;
  lengthM: number;
  lengthLabel: string;
};

export interface BoundaryMeasurement {
  edges: EdgeMetric[];
  areaM2: number;
  areaLabel: string;
  perimeterLabel: string;
}

export function ringFromGeoJson(geo: string | null | undefined): LatLng[] {
  if (!geo) return [];
  try {
    const parsed = JSON.parse(geo) as { type?: string; coordinates?: unknown };
    if (!parsed?.coordinates || !Array.isArray(parsed.coordinates)) return [];
    const polygon =
      parsed.type === 'Polygon'
        ? (parsed.coordinates as unknown[])
        : parsed.type === 'MultiPolygon'
          ? ((parsed.coordinates as unknown[])[0] as unknown[])
          : null;
    if (!polygon?.[0]) return [];
    const ring = polygon[0] as unknown[];
    const out: LatLng[] = [];
    for (const c of ring) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        out.push({ latitude: lat, longitude: lon });
      }
    }
    if (out.length < 3) return [];
    const first = out[0];
    const last = out[out.length - 1];
    if (first.latitude === last.latitude && first.longitude === last.longitude) {
      return out.slice(0, -1);
    }
    return out;
  } catch {
    return [];
  }
}

export function closedRing(corners: LatLng[]): LatLng[] {
  if (corners.length < 3) return corners;
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (first.latitude === last.latitude && first.longitude === last.longitude) {
    return corners;
  }
  return [...corners, { ...first }];
}

export function toBoundaryGeoJson(corners: LatLng[]): GeoJsonPolygonGeometry {
  const c = closedRing(corners);
  const ring = c.map((p) => [p.longitude, p.latitude]);
  return { type: 'Polygon', coordinates: [ring] };
}

export function areCornersEqual(a: LatLng[], b: LatLng[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (point, index) =>
      Math.abs(point.latitude - b[index].latitude) <= COORDINATE_EPSILON &&
      Math.abs(point.longitude - b[index].longitude) <= COORDINATE_EPSILON,
  );
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function polygonAreaSqM(coords: LatLng[]): number {
  if (coords.length < 3) return 0;
  const avgLat = coords.reduce((s, p) => s + p.latitude, 0) / coords.length;
  const mDegLat = 111_320;
  const mDegLon = 111_320 * Math.cos((avgLat * Math.PI) / 180);
  const projected = coords.map((p) => ({
    x: p.longitude * mDegLon,
    y: p.latitude * mDegLat,
  }));
  let sum = 0;
  for (let i = 0; i < projected.length; i++) {
    const j = (i + 1) % projected.length;
    sum += projected[i].x * projected[j].y - projected[j].x * projected[i].y;
  }
  return Math.abs(sum) / 2;
}

export function isSelectedEdgeEndpoint(
  index: number,
  selectedEdgeIndex: number | null,
  totalCorners: number,
): boolean {
  if (selectedEdgeIndex === null || totalCorners < 2) return false;
  return index === selectedEdgeIndex || index === (selectedEdgeIndex + 1) % totalCorners;
}

export interface UseBoundaryEditorResult {
  corners: LatLng[];
  savedCorners: LatLng[];
  selectedVertex: number | null;
  setSelectedVertex: (index: number | null) => void;
  hasChanges: boolean;
  saving: boolean;
  history: LatLng[][];
  redoHistory: LatLng[][];
  canUndo: boolean;
  canRedo: boolean;
  measurement: BoundaryMeasurement;
  selectedEdgeCoordinates: LatLng[] | null;
  pushHistory: () => void;
  onVertexDrag: (index: number, c: LatLng) => void;
  onVertexDragEnd: (index: number, c: LatLng) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
  reset: () => void;
}

interface UseBoundaryEditorOptions {
  plan: GardenPlan | null;
  household: Household | null;
  gardenPlanId: string | undefined;
}

/**
 * Owns all editable state for the lot boundary polygon: corners, undo/redo
 * history, selection, derived measurements, drag handlers, and save/reset
 * against `gardenPlansApi.updateBoundary`. Initialises from
 * `plan.boundary_geojson` when the plan id changes.
 */
export function useBoundaryEditor({
  plan,
  household,
  gardenPlanId,
}: UseBoundaryEditorOptions): UseBoundaryEditorResult {
  const measurementUnit = useSettingsStore(
    (s) =>
      (s.settings['garden.measurementUnit'] as GardenPlanMeasurementUnit | undefined) ??
      'meters',
  );

  const [corners, setCorners] = useState<LatLng[]>([]);
  const [savedCorners, setSavedCorners] = useState<LatLng[]>([]);
  const [history, setHistory] = useState<LatLng[][]>([]);
  const [redoHistory, setRedoHistory] = useState<LatLng[][]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed when the underlying plan boundary changes (e.g. switching plans
  // or after a successful save reload).
  useEffect(() => {
    const ring = ringFromGeoJson(plan?.boundary_geojson ?? null);
    if (ring.length >= 3) {
      setCorners(ring);
      setSavedCorners(ring);
    } else {
      setCorners([]);
      setSavedCorners([]);
    }
    setHistory([]);
    setRedoHistory([]);
    setSelectedVertex(null);
  }, [plan?.id, plan?.boundary_geojson]);

  const measurement = useMemo<BoundaryMeasurement>(() => {
    const n = corners.length;
    const edges: EdgeMetric[] = [];
    let perimeterM = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const lengthM = haversineM(corners[i], corners[j]);
      perimeterM += lengthM;
      const len = measurementUnit === 'feet' ? lengthM * METERS_TO_FEET : lengthM;
      const unit = measurementUnit === 'feet' ? 'ft' : 'm';
      edges.push({
        index: i,
        lengthM,
        lengthLabel: `${len.toFixed(len >= 100 ? 0 : 1)} ${unit}`,
      });
    }
    const areaM2 = polygonAreaSqM(corners);
    const area = measurementUnit === 'feet' ? areaM2 * SQ_METERS_TO_SQ_FEET : areaM2;
    const areaUnit = measurementUnit === 'feet' ? 'ft²' : 'm²';
    return {
      edges,
      areaM2,
      areaLabel: `${area.toFixed(area >= 1000 ? 0 : 1)} ${areaUnit}`,
      perimeterLabel:
        measurementUnit === 'feet'
          ? `${(perimeterM * METERS_TO_FEET).toFixed(1)} ft`
          : `${perimeterM.toFixed(1)} m`,
    };
  }, [corners, measurementUnit]);

  const hasChanges = useMemo(
    () => !areCornersEqual(corners, savedCorners),
    [corners, savedCorners],
  );

  const selectedEdgeCoordinates = useMemo(() => {
    if (selectedVertex === null || corners.length < 2) return null;
    const nextIndex = (selectedVertex + 1) % corners.length;
    return [corners[selectedVertex], corners[nextIndex]];
  }, [corners, selectedVertex]);

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), corners.map((c) => ({ ...c }))]);
    setRedoHistory([]);
  }, [corners]);

  const onVertexDrag = useCallback((index: number, c: LatLng) => {
    setCorners((prev) => {
      if (!prev[index]) return prev;
      const current = prev[index];
      if (
        Math.abs(current.latitude - c.latitude) < COORDINATE_EPSILON &&
        Math.abs(current.longitude - c.longitude) < COORDINATE_EPSILON
      ) {
        return prev;
      }
      const next = [...prev];
      next[index] = c;
      return next;
    });
  }, []);

  const onVertexDragEnd = useCallback((index: number, c: LatLng) => {
    setCorners((prev) => {
      const next = [...prev];
      next[index] = c;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setRedoHistory((r) => [...r.slice(-(HISTORY_MAX - 1)), corners.map((c) => ({ ...c }))]);
      setCorners(prev);
      return h.slice(0, -1);
    });
  }, [corners]);

  const redo = useCallback(() => {
    setRedoHistory((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), corners.map((c) => ({ ...c }))]);
      setCorners(next);
      return r.slice(0, -1);
    });
  }, [corners]);

  const save = useCallback(async () => {
    if (!household || !gardenPlanId) return false;
    if (corners.length < 3) {
      showToast('error', 'Need at least three corners');
      return false;
    }
    if (!hasChanges) return true;
    setSaving(true);
    try {
      const geo = toBoundaryGeoJson(corners);
      await gardenPlansApi.updateBoundary(household.id, gardenPlanId, {
        boundary_geojson: geo,
        boundary_source: 'user_adjusted',
      });
      setSavedCorners(corners.map((c) => ({ ...c })));
      setHistory([]);
      setRedoHistory([]);
      showToast('success', 'Boundary saved');
      return true;
    } catch (e: unknown) {
      console.error(e);
      showToast('error', 'Could not save boundary');
      return false;
    } finally {
      setSaving(false);
    }
  }, [corners, gardenPlanId, hasChanges, household]);

  const reset = useCallback(() => {
    setCorners(savedCorners.map((c) => ({ ...c })));
    setHistory([]);
    setRedoHistory([]);
    setSelectedVertex(null);
  }, [savedCorners]);

  return {
    corners,
    savedCorners,
    selectedVertex,
    setSelectedVertex,
    hasChanges,
    saving,
    history,
    redoHistory,
    canUndo: history.length > 0,
    canRedo: redoHistory.length > 0,
    measurement,
    selectedEdgeCoordinates,
    pushHistory,
    onVertexDrag,
    onVertexDragEnd,
    undo,
    redo,
    save,
    reset,
  };
}
