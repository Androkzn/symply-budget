/**
 * Draw your yard on the map — the guided three-step plan builder.
 *
 * ## What this replaces, and why it is not the old flow revived
 *
 * There was a satellite tracing flow here once. It is retired, and the reason it
 * is retired is worth stating because it shaped every decision below: it POSTed
 * the household's street address to the Worker so the Worker could geocode it
 * and fetch a static satellite image through a server-held Mapbox key. For a
 * local-first household — which is every `symply-house` install by default — that
 * is the home's address leaving a device that is supposed to hold nothing but
 * ciphertext. `GardenPlanBoundaryService.createDraft` throws
 * `MAP_PREVIEW_REMOVED` before it writes anything, and
 * `localGardenPlansApi.createBoundaryDraft` refuses locally rather than relaying
 * the address in exchange for a 410.
 *
 * This flow reaches no server at all:
 *
 *  - **Geocoding is the OS geocoder** (`@services/geocoding` → CLGeocoder on iOS,
 *    `Geocoder` on Android). No API key, no Symply endpoint, no address in
 *    flight. It is the same boundary the member already accepted with their
 *    phone.
 *  - **Imagery is the platform's own map**, through `react-native-maps`. Apple
 *    Maps satellite on iOS, Google on Android, both already linked into this
 *    binary and already used by the neighbours feature.
 *  - **The save is `gardenPlansApi.createMapPlan`**, which is LOCAL — it writes
 *    the ledger and nothing else.
 *
 * ## Why this screen has to exist for the feature to exist at all
 *
 * Under local-first, `getUploadUrl`, `uploadFile` and `confirmUpload` all throw
 * (H6: a yard plan IS a photo, and there is no bucket to put one in). Since
 * `getUploadUrl` is also where the `garden_plans` ROW is created, a local-first
 * household could not create a yard plan by ANY route. Fifteen carefully ported
 * local methods, an object editor and a marker layer, all operating on a table
 * that could never acquire a first row.
 *
 * A map-drawn plan has no bytes — the imagery is the device's, the plan is the
 * geometry — so it needs no bucket, and it is therefore the one creation path
 * that works. That is not a happy accident of this design; it is the reason to
 * prefer it.
 *
 * ## The three steps, and why in this order
 *
 * 1. **The lot.** One closed ring around the whole property. It establishes the
 *    coordinate frame everything else is stored in — `garden_plan_objects` are
 *    normalized `0..1` over the lot's bounding box — so nothing else can be
 *    placed until it exists. The map opens on the home with a rectangle already
 *    on it: dragging four corners onto four fences is a task; inventing a
 *    polygon on blank imagery is a project.
 * 2. **The areas.** Front yard, back yard, the house footprint, the driveway.
 *    This is the layer that makes a plan mean something — "water the garden" can
 *    be pinned to the garden, and the maintained-area figure can exclude the roof
 *    and the tarmac. Skippable, because a member who only wants to drop a few
 *    markers should not be made to trace their house first.
 * 3. **The elements.** Handed wholesale to `GardenPlanVectorEditor`, which
 *    already owns the 56-preset library, drag/resize/rotate, undo/redo and the
 *    satellite background. Rebuilding any of that here would have been the
 *    single worst decision available.
 *
 * Steps one and two share `GardenMapPolygonEditor` because they are the same
 * interaction twice.
 */
import type { GardenPlanObject } from '@models/garden-objects';
import {
  GARDEN_ZONE_KIND_SPECS,
  buildZoneMetadata,
  gardenZoneKindSpec,
  zoneRingInPlanSpace,
  type GardenZoneKind,
} from '@models/garden-zones';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import type MapView from 'react-native-maps';
import type { LatLng, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  gardenPlansApi,
  type GardenPlanType,
  type GeoJsonPolygonGeometry,
} from '@api/garden-plans';
import { ScreenHeader } from '@components/common';
import {
  GardenMapPolygonEditor,
  GardenPlanVectorEditor,
  type EditableRing,
} from '@components/garden';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { GardeningStackParamList } from '@navigation/types';
import { geocodeAddress } from '@services/geocoding';
import ImageCropPicker from '@services/image-picker-compat';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useSettingsStore } from '@stores/settingsStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import {
  boundsOfRing,
  boxOfNormalizedRing,
  formatArea,
  formatLength,
  haversineM,
  isPointInRing,
  polygonAreaSqM,
  polygonPerimeterM,
  ringToGeo,
  ringToNormalized,
  seedRectangle,
  toBoundaryGeoJson,
  type MeasurementUnit,
} from '@utils/gardenGeo';
import { fitAnalyzedPlanToLot, gardenElementVocabulary } from '@utils/gardenPlanDraft';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

type Nav = NativeStackNavigationProp<GardeningStackParamList, 'GardenPlanMapWizard'>;
type RouteT = RouteProp<GardeningStackParamList, 'GardenPlanMapWizard'>;

type WizardStep = 'lot' | 'areas' | 'elements';

const STEP_ORDER: WizardStep[] = ['lot', 'areas', 'elements'];

const STEP_COPY: Record<WizardStep, { title: string; caption: string }> = {
  lot: {
    title: 'Your lot',
    caption: 'Drag the corners onto your property line. Tap a faint dot to add a corner.',
  },
  areas: {
    title: 'Areas',
    caption: 'Outline the house and each part of the yard. You can skip any of these.',
  },
  elements: {
    title: 'Features',
    caption: 'Drop in the shed, the pool, the trees — anything you want to keep track of.',
  },
};

/**
 * The seed rectangle, in metres.
 *
 * Roughly a modest suburban lot. It is meant to be visibly WRONG — small enough
 * that every corner needs moving — because a rectangle that nearly fits invites
 * a member to accept it, and an accepted rectangle that is nearly right is a
 * yard plan whose every measurement is quietly off.
 */
const SEED_LOT_WIDTH_M = 22;
const SEED_LOT_DEPTH_M = 30;

/** Matching the retired flow's cap: past a dozen corners, a lot is a nightmare to edit. */
const MAX_LOT_VERTICES = 16;
const LOT_RING_ID = 'lot';
const LOT_COLOR = '#F97316';

interface DraftZone {
  id: string;
  kind: GardenZoneKind;
  label: string;
  ring: LatLng[];
}

/**
 * Pick a plan image and hand it back as base64, ready for the model.
 *
 * Two steps that are easy to skip and both bite:
 *
 *  - **`toVisionSafeAttachment` first.** An iPhone hands you HEIC by default and
 *    no provider reads it; the Worker sniffs the magic bytes and would refuse
 *    with `unsupported_media`, which the member reads as "this feature is
 *    broken" rather than "your phone's photo format". The same helper also caps
 *    the long edge at 1568px, which keeps a photographed A1 survey under the
 *    request ceiling.
 *  - **`readAsStringAsync` from `expo-file-system/legacy`.** The non-legacy
 *    entry point in SDK 57 does not expose it, and every other base64 read in
 *    this repo imports from `/legacy` for the same reason.
 *
 * Returns `null` on cancel — the single most common outcome, and not an error.
 */
async function pickPlanImageAsBase64(): Promise<{ base64: string; mime: string } | null> {
  try {
    const picked = await ImageCropPicker.openPicker({
      cropping: true,
      cropperToolbarTitle: 'Crop to the plan',
      compressImageQuality: 1,
      mediaType: 'photo',
      freeStyleCropEnabled: true,
    });

    const safe = await toVisionSafeAttachment({
      uri: picked.path,
      name: picked.filename || 'site-plan.jpg',
      type: picked.mime || 'image/jpeg',
    });

    const { readAsStringAsync } = await import('expo-file-system/legacy');
    const base64 = await readAsStringAsync(safe.uri, { encoding: 'base64' });
    if (!base64) return null;
    return { base64, mime: safe.type };
  } catch (error) {
    if (isPickerPermissionError(error)) {
      presentPickerPermissionDeniedAlert('library');
      return null;
    }
    if ((error as { code?: string })?.code === 'E_PICKER_CANCELLED') return null;
    console.error('Failed to read plan image:', error);
    showToast('error', 'Could not read that file');
    return null;
  }
}

/**
 * Turn the Worker's typed refusal into the sentence it already wrote.
 *
 * The route answers `{ error: { code, message } }` with member-facing copy for
 * every failure mode — the PDF/HEIC case in particular carries the instruction
 * that actually unblocks the member ("export the page as a JPEG"). Falling back
 * to a generic string would throw that away, so the server's message is
 * preferred whenever there is one.
 */
function readableAnalyzeError(error: unknown): string {
  const message = (
    error as { response?: { data?: { error?: { message?: unknown } } } }
  )?.response?.data?.error?.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;
  return 'Could not read that plan. Try a clearer image, or trace the yard by hand.';
}

export function GardenPlanMapWizardScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const mapRef = useRef<MapView | null>(null);

  const measurementUnit = useSettingsStore(
    (s) => (s.settings['garden.measurementUnit'] as MeasurementUnit | undefined) ?? 'meters',
  );

  const [step, setStep] = useState<WizardStep>('lot');
  const [locating, setLocating] = useState(true);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- step 1: the lot ----------------------------------------------------
  const [lotRing, setLotRing] = useState<LatLng[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [lotHistory, setLotHistory] = useState<LatLng[][]>([]);

  // ---- step 2: the areas --------------------------------------------------
  const [zones, setZones] = useState<DraftZone[]>([]);
  const [drawingKind, setDrawingKind] = useState<GardenZoneKind | null>(null);
  const [drawingRing, setDrawingRing] = useState<LatLng[]>([]);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  // ---- step 3: the elements ----------------------------------------------
  const [elements, setElements] = useState<GardenPlanObject[]>([]);


  const planType: GardenPlanType = route.params?.defaultPlanType ?? 'other_outdoor';

  /**
   * Open the map on the home.
   *
   * Order of preference is deliberate: the household's own address first,
   * because that is the lot the member came here to trace. There is no fallback
   * to the device's current position — a member planning their garden from the
   * office would be handed their office roof and, worse, might not notice before
   * tracing it.
   */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const query = [
        currentHousehold?.address_line1,
        currentHousehold?.city,
        currentHousehold?.state_province,
        currentHousehold?.postal_code,
        currentHousehold?.country,
      ]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter((part) => part.length > 0)
        .join(', ');

      const point = query ? await geocodeAddress(query) : null;
      if (cancelled) return;

      if (!point) {
        setLocating(false);
        return;
      }

      const centre: LatLng = { latitude: point.latitude, longitude: point.longitude };
      const seeded = seedRectangle(centre, SEED_LOT_WIDTH_M, SEED_LOT_DEPTH_M);
      setLotRing(seeded);
      setInitialRegion({
        latitude: centre.latitude,
        longitude: centre.longitude,
        // ~2.5x the seed so the whole rectangle and its surroundings are visible
        // at the start. The member zooms in from here; the camera range set in
        // `GardenMapPolygonEditor` is what lets them go all the way to a fence.
        latitudeDelta: 0.0016,
        longitudeDelta: 0.0016,
      });
      setLocating(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    currentHousehold?.address_line1,
    currentHousehold?.city,
    currentHousehold?.country,
    currentHousehold?.postal_code,
    currentHousehold?.state_province,
  ]);

  // ---- lot editing --------------------------------------------------------

  const pushLotHistory = useCallback(() => {
    setLotHistory((prev) => [...prev.slice(-19), lotRing.map((p) => ({ ...p }))]);
  }, [lotRing]);

  const undoLot = useCallback(() => {
    setLotHistory((prev) => {
      if (prev.length === 0) return prev;
      setLotRing(prev[prev.length - 1]);
      setSelectedVertex(null);
      return prev.slice(0, -1);
    });
  }, []);

  const moveLotVertex = useCallback((index: number, coordinate: LatLng) => {
    setLotRing((prev) => {
      if (!prev[index]) return prev;
      const next = [...prev];
      next[index] = coordinate;
      return next;
    });
  }, []);

  const insertLotVertex = useCallback(
    (edgeIndex: number, coordinate: LatLng) => {
      if (lotRing.length >= MAX_LOT_VERTICES) {
        showToast('info', `A lot can have up to ${MAX_LOT_VERTICES} corners`);
        return;
      }
      pushLotHistory();
      setLotRing((prev) => {
        const next = [...prev];
        next.splice(edgeIndex + 1, 0, coordinate);
        return next;
      });
      setSelectedVertex(edgeIndex + 1);
    },
    [lotRing.length, pushLotHistory],
  );

  /**
   * Add a corner from the PANEL, splitting the longest edge.
   *
   * The midpoint handles on the map are the discoverable way to do this and stay
   * the primary one. They are not the only way they can be, for two reasons that
   * happen to point the same direction:
   *
   *  - **VoiceOver cannot drag a map annotation.** A member using it could reach
   *    every other control in this wizard and had no way at all to add a corner,
   *    which made the lot step unusable rather than merely awkward.
   *  - **Nor can a UI test address one reliably.** `MKMapView` publishes its
   *    annotations to the accessibility tree only intermittently — the same
   *    snapshot that shows every panel control can come back with the map's
   *    handles missing entirely.
   *
   * The longest edge is the right default because it is where a rectangle most
   * needs detail: it is the side a member is about to bend around a bay window
   * or a driveway cut.
   */
  const addCornerToLongestEdge = useCallback(() => {
    if (lotRing.length < 2) return;
    let bestIndex = 0;
    let bestLength = -1;
    for (let i = 0; i < lotRing.length; i += 1) {
      const a = lotRing[i];
      const b = lotRing[(i + 1) % lotRing.length];
      const length = haversineM(a, b);
      if (length > bestLength) {
        bestLength = length;
        bestIndex = i;
      }
    }
    const a = lotRing[bestIndex];
    const b = lotRing[(bestIndex + 1) % lotRing.length];
    insertLotVertex(bestIndex, {
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
    });
  }, [insertLotVertex, lotRing]);

  const removeSelectedVertex = useCallback(() => {
    if (selectedVertex === null) return;
    if (lotRing.length <= 3) {
      showToast('info', 'A lot needs at least three corners');
      return;
    }
    pushLotHistory();
    setLotRing((prev) => prev.filter((_, index) => index !== selectedVertex));
    setSelectedVertex(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [lotRing.length, pushLotHistory, selectedVertex]);

  // ---- zone drawing -------------------------------------------------------

  const beginZone = useCallback((kind: GardenZoneKind) => {
    setDrawingKind(kind);
    setDrawingRing([]);
    setEditingZoneId(null);
    setSelectedVertex(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const cancelZone = useCallback(() => {
    setDrawingKind(null);
    setDrawingRing([]);
  }, []);

  const commitZone = useCallback(() => {
    if (!drawingKind || drawingRing.length < 3) return;
    const spec = gardenZoneKindSpec(drawingKind);
    setZones((prev) => [
      ...prev,
      {
        id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: drawingKind,
        label: spec.label,
        ring: drawingRing,
      },
    ]);
    setDrawingKind(null);
    setDrawingRing([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [drawingKind, drawingRing]);

  const removeZone = useCallback((id: string) => {
    setZones((prev) => prev.filter((zone) => zone.id !== id));
    setEditingZoneId((current) => (current === id ? null : current));
  }, []);

  const moveZoneVertex = useCallback(
    (index: number, coordinate: LatLng) => {
      if (!editingZoneId) return;
      setZones((prev) =>
        prev.map((zone) => {
          if (zone.id !== editingZoneId) return zone;
          const ring = [...zone.ring];
          ring[index] = coordinate;
          return { ...zone, ring };
        }),
      );
    },
    [editingZoneId],
  );

  const insertZoneVertex = useCallback(
    (edgeIndex: number, coordinate: LatLng) => {
      if (!editingZoneId) return;
      setZones((prev) =>
        prev.map((zone) => {
          if (zone.id !== editingZoneId) return zone;
          const ring = [...zone.ring];
          ring.splice(edgeIndex + 1, 0, coordinate);
          return { ...zone, ring };
        }),
      );
      setSelectedVertex(edgeIndex + 1);
    },
    [editingZoneId],
  );

  const handleMapPress = useCallback(
    (coordinate: LatLng) => {
      if (step === 'areas' && drawingKind) {
        Haptics.selectionAsync();
        setDrawingRing((prev) => [...prev, coordinate]);
        return;
      }
      setSelectedVertex(null);
    },
    [drawingKind, step],
  );

  // ---- derived ------------------------------------------------------------

  const lotBounds = useMemo(() => boundsOfRing(lotRing), [lotRing]);
  const lotAreaM2 = useMemo(() => polygonAreaSqM(lotRing), [lotRing]);
  const lotPerimeterM = useMemo(() => polygonPerimeterM(lotRing), [lotRing]);

  const zoneAreas = useMemo(
    () => new Map(zones.map((zone) => [zone.id, polygonAreaSqM(zone.ring)])),
    [zones],
  );

  /**
   * Yard area — the lot, less everything traced that is not yard.
   *
   * Floored at zero rather than allowed to go negative: overlapping zones are
   * legal (a garden inside a back yard is a normal thing to draw) and there is
   * no attempt to union them, so a member who outlines the same ground twice
   * could otherwise be told they have "-40 m² of yard".
   */
  const maintainedAreaM2 = useMemo(() => {
    const excluded = zones.reduce((sum, zone) => {
      const spec = gardenZoneKindSpec(zone.kind);
      return spec.countsAsYard ? sum : sum + (zoneAreas.get(zone.id) ?? 0);
    }, 0);
    return Math.max(lotAreaM2 - excluded, 0);
  }, [lotAreaM2, zoneAreas, zones]);

  const rings = useMemo<EditableRing[]>(() => {
    const out: EditableRing[] = [];
    if (lotRing.length >= 2) {
      out.push({
        id: LOT_RING_ID,
        ring: lotRing,
        color: LOT_COLOR,
        label: step === 'lot' ? null : 'Lot',
        sublabel: step === 'lot' ? null : formatArea(lotAreaM2, measurementUnit),
      });
    }
    for (const zone of zones) {
      const spec = gardenZoneKindSpec(zone.kind);
      out.push({
        id: zone.id,
        ring: zone.ring,
        color: spec.color,
        label: zone.label,
        sublabel: formatArea(zoneAreas.get(zone.id) ?? 0, measurementUnit),
      });
    }
    if (drawingKind && drawingRing.length > 0) {
      out.push({
        id: 'drawing',
        ring: drawingRing,
        color: gardenZoneKindSpec(drawingKind).color,
        open: drawingRing.length < 3,
      });
    }
    return out;
  }, [
    drawingKind,
    drawingRing,
    lotAreaM2,
    lotRing,
    measurementUnit,
    step,
    zoneAreas,
    zones,
  ]);

  const activeRingId = step === 'lot' ? LOT_RING_ID : step === 'areas' ? editingZoneId : null;

  const boundaryGeoJson = useMemo(
    () => (lotRing.length >= 3 ? JSON.stringify(toBoundaryGeoJson(lotRing)) : null),
    [lotRing],
  );

  /**
   * The zones, as the rows they will be saved as.
   *
   * Derived rather than kept in state because it is needed in two places that
   * must not disagree: the save, and step three — where these are handed to
   * `GardenPlanVectorEditor` alongside the elements so a member placing a shed
   * can see which part of the yard they are placing it in. A zone the editor
   * cannot see is a zone the member is placing features blind against.
   *
   * The conversion to the object's own frame happens inside `buildZoneMetadata`,
   * which takes the box it must be measured against, so the two can never drift
   * out of step.
   */
  const zoneObjects = useMemo<GardenPlanObject[]>(() => {
    if (!lotBounds) return [];
    const out: GardenPlanObject[] = [];
    for (const zone of zones) {
      const ring = ringToNormalized(zone.ring, lotBounds);
      const box = boxOfNormalizedRing(ring);
      if (!box) continue;
      out.push({
        id: zone.id,
        type: 'zone',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rotation: 0,
        label: zone.label,
        color: gardenZoneKindSpec(zone.kind).color,
        metadata: buildZoneMetadata(zone.kind, ring, box),
      });
    }
    return out;
  }, [lotBounds, zones]);

  /**
   * Split the editor's output back into zones and elements.
   *
   * The editor does not know what a zone is — it sees an object with a type it
   * has no special case for, and drags, resizes and deletes it like any other.
   * That is exactly why the ring is stored in the object's OWN frame: a moved or
   * resized zone still describes the right shape without the editor updating any
   * metadata, so all that is needed here is to read the outline back out and
   * return it to geographic space, where the map steps keep it.
   */
  /** Zones first, so their lower `sort_order` puts them under the features. */
  const editorObjects = useMemo(
    () => [...zoneObjects, ...elements],
    [elements, zoneObjects],
  );

  const applyEditorObjects = useCallback(
    (next: GardenPlanObject[]) => {
      if (!lotBounds) return;
      const nextElements: GardenPlanObject[] = [];
      const byId = new Map<string, DraftZone>(zones.map((zone) => [zone.id, zone]));
      const nextZones: DraftZone[] = [];

      for (const object of next) {
        if (object.type !== 'zone') {
          nextElements.push(object);
          continue;
        }
        const original = byId.get(object.id);
        if (!original) continue;
        const ring = zoneRingInPlanSpace(object);
        nextZones.push(
          ring && ring.length >= 3
            ? { ...original, label: object.label ?? original.label, ring: ringToGeo(ring, lotBounds) }
            : original,
        );
      }

      setElements(nextElements);
      // A zone deleted in the editor is a zone deleted, full stop — the member
      // did it deliberately and step two would otherwise resurrect it.
      setZones(nextZones);
    },
    [lotBounds, zones],
  );

  // ---- the AI shortcut ----------------------------------------------------
  const [analyzing, setAnalyzing] = useState(false);

  /**
   * "I already have a plan of this" — read it, and drop the result on the lot.
   *
   * This runs in step TWO rather than as an entry point of its own, and the
   * ordering is the whole reason it works. By the time it is offered, the member
   * has already traced their lot, so there is a real coordinate frame to fit the
   * reading onto (`fitAnalyzedPlanToLot`). Offered before that, the model's
   * output would be normalized to a piece of paper and anchored to nothing.
   *
   * Everything it produces is a DRAFT sitting on the map, in the same editable
   * state as a zone the member drew by hand — same drag handles, same delete.
   * Nothing is saved until they finish the wizard.
   */
  const runAiDraft = useCallback(async () => {
    if (!currentHousehold || !lotBounds || analyzing) return;

    const picked = await pickPlanImageAsBase64();
    if (!picked) return;

    setAnalyzing(true);
    try {
      const response = await gardenPlansApi.analyzePlanImage(currentHousehold.id, {
        image_base64: picked.base64,
        media_type: picked.mime,
        element_vocabulary: gardenElementVocabulary(),
      });

      const fitted = fitAnalyzedPlanToLot(response.draft);

      if (fitted.zones.length === 0 && fitted.elements.length === 0) {
        showToast('info', 'Nothing recognisable in that plan — try tracing by hand');
        return;
      }

      setZones((prev) => [
        ...prev,
        ...fitted.zones.map((zone, index) => ({
          id: `ai-zone-${Date.now()}-${index}`,
          kind: zone.kind,
          label: zone.label,
          ring: ringToGeo(zone.ring, lotBounds),
        })),
      ]);
      setElements((prev) => [...prev, ...fitted.elements].slice(0, 80));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        'success',
        `Drafted ${fitted.zones.length} area${fitted.zones.length === 1 ? '' : 's'} and ${
          fitted.elements.length
        } feature${fitted.elements.length === 1 ? '' : 's'} — drag anything that is off`,
      );

      if (fitted.northHeadingDegrees !== null) {
        // Surfaced, never applied. See `gardenPlanDraft.ts` on why a rotation
        // guessed from a possibly-misread north arrow is worse than none.
        showToast('info', 'That plan has north at an angle — rotate the map to line it up');
      }
    } catch (error) {
      console.error('Failed to analyze plan image:', error);
      showToast('error', readableAnalyzeError(error));
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, currentHousehold, lotBounds]);

  // ---- save ---------------------------------------------------------------

  /**
   * Convert everything into the storage frame and write it in one call.
   *
   * The zone rings and the element positions are both normalized against the
   * LOT's bounding box here, and that is the only place the conversion happens —
   * see `@utils/gardenGeo` for why the two spaces exist and which way the y axis
   * runs in each.
   *
   * Zones are pushed BEFORE elements so their `sort_order` is lower and they
   * render underneath. `replaceObjects` sets `sort_order` from the array index,
   * and `createMapPlan` does the same, so array order is z-order.
   */
  const handleSave = useCallback(async () => {
    if (!currentHousehold || !lotBounds || lotRing.length < 3) return;
    setSaving(true);
    try {
      const objects = [...zoneObjects, ...elements].slice(0, 80);

      const response = await gardenPlansApi.createMapPlan(currentHousehold.id, {
        plan_type: planType,
        label: route.params?.label ?? null,
        boundary_geojson: toBoundaryGeoJson(lotRing) as GeoJsonPolygonGeometry,
        boundary_source: 'user_drawn',
        objects,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('success', 'Yard plan saved');
      navigation.replace('GardenPlanViewer', {
        gardenPlanId: response.garden_plan.id,
      });
    } catch (error) {
      console.error('Failed to save map yard plan:', error);
      showToast('error', 'Could not save the yard plan');
    } finally {
      setSaving(false);
    }
  }, [
    currentHousehold,
    elements,
    lotBounds,
    lotRing,
    navigation,
    planType,
    route.params?.label,
    // `zoneObjects` rather than `zones`: the save reads the derived rows, and
    // closing over the raw zones instead would let a stale set be written after
    // an edit in step three.
    zoneObjects,
  ]);

  // ---- navigation between steps ------------------------------------------

  const goNext = useCallback(() => {
    if (step === 'lot') {
      if (lotRing.length < 3) {
        showToast('info', 'Trace at least three corners first');
        return;
      }
      setSelectedVertex(null);
      setStep('areas');
      return;
    }
    if (step === 'areas') {
      cancelZone();
      setSelectedVertex(null);
      setStep('elements');
      return;
    }
    void handleSave();
  }, [cancelZone, handleSave, lotRing.length, step]);

  // `goBack` needs `confirmExit`, which is declared below it. A ref rather than
  // a reorder: the two are mutually referential in reading order, and moving
  // either one puts a `useCallback` dependency array above the value it names.
  const confirmExitRef = useRef<() => void>(() => {});

  const goBack = useCallback(() => {
    const index = STEP_ORDER.indexOf(step);
    if (index <= 0) {
      // Leaving from step one throws the traced lot away, so it asks first —
      // the same guard the header's back arrow uses. Before this, the footer
      // said "Cancel" and discarded silently while the arrow six points above
      // it confirmed, which is two different answers to one question.
      confirmExitRef.current();
      return;
    }
    cancelZone();
    setSelectedVertex(null);
    setStep(STEP_ORDER[index - 1]);
  }, [cancelZone, step]);

  const confirmExit = useCallback(() => {
    if (lotRing.length === 0 && zones.length === 0 && elements.length === 0) {
      navigation.goBack();
      return;
    }
    Alert.alert('Discard this plan?', 'Your outline and areas will not be saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [elements.length, lotRing.length, navigation, zones.length]);

  confirmExitRef.current = confirmExit;

  // ---- render -------------------------------------------------------------

  if (locating) {
    return (
      <View
        style={[styles.centred, { backgroundColor: colors.backgroundMain }]}
        testID="garden-map-wizard-locating"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Typography variant="body" color={colors.textSecondary} style={styles.centredText}>
          Finding your home…
        </Typography>
      </View>
    );
  }

  if (!initialRegion) {
    return (
      <View
        style={[styles.centred, { backgroundColor: colors.backgroundMain }]}
        testID="garden-map-wizard-unavailable"
      >
        <Icon name="location-outline" size={44} color={colors.textSecondary} />
        <Typography variant="headline" weight="semibold" style={styles.centredText}>
          We could not place your address
        </Typography>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          style={[styles.centredText, styles.centredBody]}
        >
          Add a street address to this home and try again, or upload a photo or site plan
          instead.
        </Typography>
        <TouchableOpacity
          style={[styles.fallbackButton, { backgroundColor: colors.primary }]}
          onPress={() => navigation.replace('GardenPlanUpload')}
          activeOpacity={0.85}
          testID="garden-map-wizard-upload-instead"
        >
          <Typography variant="body" weight="semibold" color={colors.white}>
            Upload instead
          </Typography>
        </TouchableOpacity>
      </View>
    );
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const copy = STEP_COPY[step];

  return (
    <View style={styles.root} testID="garden-plan-map-wizard-screen">
      {/* Steps one and two own the map; step three hands it to the vector
          editor, which renders its own satellite background from the boundary
          we just traced. Two map instances are never mounted at once. */}
      {step === 'elements' ? (
        <GardenPlanVectorEditor
          backgroundMode="satellite"
          boundaryGeoJson={boundaryGeoJson}
          objects={editorObjects}
          onChange={applyEditorObjects}
          showHeader={false}
          fullScreen
          bottomInset={insets.bottom + 96}
        />
      ) : (
        <GardenMapPolygonEditor
          mapRef={mapRef}
          initialRegion={initialRegion}
          rings={rings}
          activeRingId={activeRingId}
          selectedVertex={selectedVertex}
          onSelectVertex={setSelectedVertex}
          onMoveVertex={step === 'lot' ? moveLotVertex : moveZoneVertex}
          onBeginVertexDrag={step === 'lot' ? pushLotHistory : undefined}
          onInsertVertex={step === 'lot' ? insertLotVertex : insertZoneVertex}
          onMapPress={handleMapPress}
          drawing={Boolean(drawingKind)}
        />
      )}

      <View style={[styles.headerWrap, { paddingTop: insets.top }]} pointerEvents="box-none">
        <ScreenHeader
          title={copy.title}
          showBackButton
          onBackPress={confirmExit}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.stepDots}>
          {STEP_ORDER.map((entry, index) => (
            <View
              key={entry}
              style={[
                styles.stepDot,
                {
                  backgroundColor: index <= stepIndex ? colors.primary : 'rgba(255,255,255,0.55)',
                  width: index === stepIndex ? 22 : 8,
                },
              ]}
            />
          ))}
        </View>
      </View>

      <View
        style={[styles.panel, { paddingBottom: insets.bottom + Spacing.md }]}
        pointerEvents="box-none"
        testID="garden-map-wizard-panel"
      >
        {/* Two ids on purpose. `garden-map-wizard-panel` answers "is the wizard
            chrome up"; the step-suffixed one answers "which step am I on"
            without any flow having to match on copy. The header title would
            have done the latter, but "Areas" is BOTH a step title and a stat
            label in the same panel, so a text assertion on it is ambiguous by
            construction. */}
        <View
          style={[styles.panelCard, { backgroundColor: colors.backgroundMain }]}
          testID={`garden-map-wizard-panel-${step}`}
        >
          <Typography variant="caption1" color={colors.textSecondary} style={styles.panelCaption}>
            {copy.caption}
          </Typography>

          {step === 'lot' ? (
            <LotPanel
              areaLabel={formatArea(lotAreaM2, measurementUnit)}
              perimeterLabel={formatLength(lotPerimeterM, measurementUnit)}
              cornerCount={lotRing.length}
              canUndo={lotHistory.length > 0}
              onUndo={undoLot}
              onAddCorner={addCornerToLongestEdge}
              selectedVertex={selectedVertex}
              onRemoveVertex={removeSelectedVertex}
            />
          ) : null}

          {step === 'areas' ? (
            <AreasPanel
              zones={zones}
              zoneAreas={zoneAreas}
              measurementUnit={measurementUnit}
              maintainedAreaLabel={formatArea(maintainedAreaM2, measurementUnit)}
              drawingKind={drawingKind}
              drawingCount={drawingRing.length}
              editingZoneId={editingZoneId}
              onBeginZone={beginZone}
              onCancelZone={cancelZone}
              onCommitZone={commitZone}
              onUndoPoint={() => setDrawingRing((prev) => prev.slice(0, -1))}
              onEditZone={(id) => {
                setEditingZoneId((current) => (current === id ? null : id));
                setSelectedVertex(null);
              }}
              onRemoveZone={removeZone}
              analyzing={analyzing}
              onAiDraft={runAiDraft}
            />
          ) : null}

          {step === 'elements' ? (
            <ElementsPanel
              count={elements.length}
              zoneSummary={summariseElementsByZone(elements, zones, lotBounds)}
            />
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
              onPress={goBack}
              activeOpacity={0.8}
              testID="garden-map-wizard-back"
            >
              <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                {stepIndex === 0 ? 'Cancel' : 'Back'}
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: saving || (step === 'lot' && lotRing.length < 3) ? 0.5 : 1,
                },
              ]}
              onPress={goNext}
              disabled={saving || (step === 'lot' && lotRing.length < 3)}
              activeOpacity={0.85}
              testID="garden-map-wizard-next"
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Typography variant="body" weight="semibold" color={colors.white}>
                  {step === 'elements' ? 'Save plan' : 'Next'}
                </Typography>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function LotPanel({
  areaLabel,
  perimeterLabel,
  cornerCount,
  canUndo,
  onUndo,
  onAddCorner,
  selectedVertex,
  onRemoveVertex,
}: {
  areaLabel: string;
  perimeterLabel: string;
  cornerCount: number;
  canUndo: boolean;
  onUndo: () => void;
  onAddCorner: () => void;
  selectedVertex: number | null;
  onRemoveVertex: () => void;
}) {
  const colors = useAppColors();

  return (
    <View>
      <View style={styles.statRow}>
        <Stat label="Area" value={areaLabel} testID="garden-map-wizard-stat-area" />
        <Stat label="Perimeter" value={perimeterLabel} testID="garden-map-wizard-stat-perimeter" />
        <Stat label="Corners" value={String(cornerCount)} testID="garden-map-wizard-stat-corners" />
      </View>
      <View style={styles.inlineActions}>
        <InlineAction
          icon="add-circle-outline"
          label="Add corner"
          onPress={onAddCorner}
          testID="garden-map-wizard-add-corner"
        />
        <InlineAction
          icon="arrow-undo-outline"
          label="Undo"
          disabled={!canUndo}
          onPress={onUndo}
          testID="garden-map-wizard-undo"
        />
        <InlineAction
          icon="trash-outline"
          label="Remove corner"
          disabled={selectedVertex === null}
          onPress={onRemoveVertex}
          tint={colors.error}
          testID="garden-map-wizard-remove-corner"
        />
      </View>
    </View>
  );
}

function AreasPanel({
  zones,
  zoneAreas,
  measurementUnit,
  maintainedAreaLabel,
  drawingKind,
  drawingCount,
  editingZoneId,
  onBeginZone,
  onCancelZone,
  onCommitZone,
  onUndoPoint,
  onEditZone,
  onRemoveZone,
  analyzing,
  onAiDraft,
}: {
  zones: DraftZone[];
  zoneAreas: Map<string, number>;
  measurementUnit: MeasurementUnit;
  maintainedAreaLabel: string;
  drawingKind: GardenZoneKind | null;
  drawingCount: number;
  editingZoneId: string | null;
  onBeginZone: (kind: GardenZoneKind) => void;
  onCancelZone: () => void;
  onCommitZone: () => void;
  onUndoPoint: () => void;
  onEditZone: (id: string) => void;
  onRemoveZone: (id: string) => void;
  analyzing: boolean;
  onAiDraft: () => void;
}) {
  const colors = useAppColors();

  if (drawingKind) {
    const spec = gardenZoneKindSpec(drawingKind);
    return (
      <View>
        <View style={[styles.drawingBanner, { backgroundColor: `${spec.color}22` }]}>
          <Icon name={spec.ionIcon} size={18} color={spec.color} />
          <View style={styles.drawingBannerText}>
            <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
              Tracing {spec.label.toLowerCase()}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {drawingCount < 3
                ? `Tap each corner — ${3 - drawingCount} more to close the shape`
                : `${drawingCount} corners. Tap Done when the outline looks right.`}
            </Typography>
          </View>
        </View>
        <View style={styles.inlineActions}>
          <InlineAction
            icon="close-outline"
            label="Cancel"
            onPress={onCancelZone}
            testID="garden-map-wizard-draw-cancel"
          />
          <InlineAction
            icon="arrow-undo-outline"
            label="Undo point"
            disabled={drawingCount === 0}
            onPress={onUndoPoint}
            testID="garden-map-wizard-draw-undo"
          />
          <InlineAction
            icon="checkmark-outline"
            label="Done"
            disabled={drawingCount < 3}
            onPress={onCommitZone}
            tint={colors.primary}
            testID="garden-map-wizard-draw-done"
          />
        </View>
      </View>
    );
  }

  return (
    <View>
      {zones.length > 0 ? (
        <>
          <View style={styles.statRow}>
            <Stat
              label="Yard to maintain"
              value={maintainedAreaLabel}
              testID="garden-map-wizard-maintained-area"
            />
            <Stat label="Areas" value={String(zones.length)} testID="garden-map-wizard-zone-count" />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.zoneChips}
          >
            {zones.map((zone, index) => {
              const spec = gardenZoneKindSpec(zone.kind);
              const editing = editingZoneId === zone.id;
              return (
                <TouchableOpacity
                  key={zone.id}
                  testID={`garden-map-wizard-zone-chip-${index}`}
                  accessibilityLabel={`Area ${zone.label}`}
                  style={[
                    styles.zoneChip,
                    {
                      backgroundColor: editing ? `${spec.color}30` : colors.backgroundSecondary,
                      borderColor: editing ? spec.color : 'transparent',
                    },
                  ]}
                  onPress={() => onEditZone(zone.id)}
                  onLongPress={() => onRemoveZone(zone.id)}
                  activeOpacity={0.8}
                >
                  <Icon name={spec.ionIcon} size={14} color={spec.color} />
                  <View style={styles.zoneChipText}>
                    <Typography variant="caption2" weight="semibold" color={colors.textPrimary}>
                      {zone.label}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {formatArea(zoneAreas.get(zone.id) ?? 0, measurementUnit)}
                    </Typography>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            Tap an area to move its corners. Press and hold to delete it.
          </Typography>
        </>
      ) : null}

      {/* The shortcut for anyone who already owns a drawing of this yard.

          It lives HERE, in step two, rather than as an entry of its own — by
          this point the member has traced their lot, so there is a real
          coordinate frame to fit the reading onto. Offered any earlier, the
          model's output would be normalized to a sheet of paper and anchored to
          nothing. See `fitAnalyzedPlanToLot`. */}
      <TouchableOpacity
        style={[
          styles.aiDraftButton,
          { borderColor: colors.primary, opacity: analyzing ? 0.6 : 1 },
        ]}
        onPress={onAiDraft}
        disabled={analyzing}
        activeOpacity={0.85}
        testID="garden-map-wizard-ai-draft"
      >
        {analyzing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon name="sparkles" size={16} color={colors.primary} />
        )}
        <View style={styles.aiDraftText}>
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            {analyzing ? 'Reading your plan…' : 'Draft from a site plan'}
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            Have a survey, site plan or aerial shot? We will trace the areas for you to
            correct.
          </Typography>
        </View>
      </TouchableOpacity>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.zoneChips}
      >
        {GARDEN_ZONE_KIND_SPECS.map((spec) => (
          <TouchableOpacity
            key={spec.id}
            style={[styles.addZoneChip, { borderColor: spec.color }]}
            onPress={() => onBeginZone(spec.id)}
            activeOpacity={0.8}
            testID={`garden-map-wizard-zone-${spec.id}`}
          >
            <Icon name="add" size={14} color={spec.color} />
            <Typography
              variant="caption2"
              weight="semibold"
              color={spec.color}
              style={styles.addZoneChipLabel}
            >
              {spec.label}
            </Typography>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function ElementsPanel({
  count,
  zoneSummary,
}: {
  count: number;
  zoneSummary: string | null;
}) {
  const colors = useAppColors();
  return (
    <View>
      <View style={styles.statRow}>
        <Stat label="Features" value={String(count)} testID="garden-map-wizard-feature-count" />
        {zoneSummary ? <Stat label="Placed in" value={zoneSummary} /> : null}
      </View>
      <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
        Use the + button on the canvas to open the library — sheds, pools, trees, beds and
        more.
      </Typography>
    </View>
  );
}

/**
 * A labelled figure in the bottom panel.
 *
 * `testID` sits on the VALUE rather than the wrapper, and that is deliberate: an
 * E2E assertion wants to read the number ("Corners: 5" after adding one), and
 * React Native merges a `<View>`'s children into one accessibility node only
 * sometimes. Putting the id on the text node makes `assertVisible` on the id and
 * a text match on the same node both work.
 */
function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.stat}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography
        variant="body"
        weight="semibold"
        color={colors.textPrimary}
        testID={testID}
        accessibilityLabel={testID ? `${label} ${value}` : undefined}
      >
        {value}
      </Typography>
    </View>
  );
}

function InlineAction({
  icon,
  label,
  onPress,
  disabled,
  tint,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  testID?: string;
}) {
  const colors = useAppColors();
  const color = disabled ? colors.textSecondary : (tint ?? colors.textPrimary);
  return (
    <TouchableOpacity
      style={[styles.inlineAction, { opacity: disabled ? 0.4 : 1 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      testID={testID}
      // Maestro matches the WHOLE accessibility string and does not test
      // occlusion, so a bare label like "Undo" would also match the drawing
      // banner's "Undo point". The id is the selector; this keeps the spoken
      // label honest for anyone actually using VoiceOver.
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Icon name={icon} size={16} color={color} />
      <Typography variant="caption2" weight="medium" color={color} style={styles.inlineActionLabel}>
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

/**
 * "3 in Back yard" — a one-line reassurance that elements landed somewhere named.
 *
 * Returns `null` rather than "0 zones" when there is nothing useful to say, so
 * the panel simply omits the stat instead of showing an empty one.
 */
function summariseElementsByZone(
  elements: GardenPlanObject[],
  zones: DraftZone[],
  lotBounds: ReturnType<typeof boundsOfRing>,
): string | null {
  if (!lotBounds || zones.length === 0 || elements.length === 0) return null;
  const counts = new Map<string, number>();
  for (const element of elements) {
    for (const zone of zones) {
      const ring = ringToNormalized(zone.ring, lotBounds);
      if (isPointInRing({ x: element.x, y: element.y }, ring)) {
        counts.set(zone.label, (counts.get(zone.label) ?? 0) + 1);
        break;
      }
    }
  }
  if (counts.size === 0) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${best[1]} in ${best[0]}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  centredText: { marginTop: Spacing.md, textAlign: 'center' },
  centredBody: { maxWidth: 320 },
  fallbackButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.full,
  },
  headerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  stepDots: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 6,
    marginTop: Spacing.xs,
  },
  stepDot: { height: 8, borderRadius: 4 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.md },
  panelCard: {
    borderRadius: 20,
    padding: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  panelCaption: { marginBottom: Spacing.sm },
  statRow: { flexDirection: 'row', gap: Spacing.lg, marginBottom: Spacing.sm },
  stat: {},
  inlineActions: { flexDirection: 'row', gap: Spacing.lg, marginBottom: Spacing.xs },
  inlineAction: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  inlineActionLabel: { marginLeft: 5 },
  drawingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  drawingBannerText: { marginLeft: Spacing.sm, flex: 1 },
  zoneChips: { gap: Spacing.sm, paddingVertical: 4 },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  zoneChipText: { marginLeft: 6 },
  addZoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addZoneChipLabel: { marginLeft: 4 },
  aiDraftButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  aiDraftText: { flex: 1, marginLeft: Spacing.sm },
  hint: { marginTop: 4, marginBottom: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  primaryButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
});
