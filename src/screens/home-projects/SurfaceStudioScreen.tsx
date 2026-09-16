/**
 * Surface Studio — the room, its surfaces, their areas and what they cost.
 *
 * ## The shape of the UI, and why it is this one
 *
 * The pattern comes straight from what plan and takeoff tools converged on, and
 * from the two things a phone is bad at (precise drawing) and good at
 * (choosing between pictures):
 *
 *  1. **Room** — pick a shape, drag the corners. Presets first, because
 *     drawing a room vertex by vertex on a phone produces something that is
 *     nearly square and never quite, and every quantity downstream inherits
 *     that error.
 *  2. **Surfaces** — a strip of live, scale-true thumbnails; tap one to open it
 *     as an unfolded elevation. Members say "the wall with the window", not
 *     "wall 3".
 *  3. **Areas** — split a surface with a line, or draw a region, and give each
 *     piece its own material. This is the request the whole feature exists for:
 *     half a wall painted, half in panelling.
 *  4. **Takeoff** — the quantities that fall out of all of the above, traceable
 *     back to the surface they came from, and promotable into the project's
 *     materials list in one tap.
 *
 * ## What is stored, and what that buys
 *
 * One JSON document in `home_project_geometry` (`schema_version: 2`), written
 * through `putManualGeometry` — a route that already exists on the Worker and a
 * write that is already local on a local-first household. **The entire feature
 * therefore works offline and needed no migration, no new table and no ledger
 * registration.** Material swatch photos are ordinary project attachments,
 * which is the one byte channel both backends already have.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  homeProjectsApi,
  useHomeProjectHub,
  useHomeProjectMutation,
} from '@api/home-projects';
import type {
  HomeProjectAttachment,
  HomeProjectSelection,
} from '@api/home-projects';
import { ScreenHeader } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { LengthPickerSheet } from '@components/home-projects/surfaces/LengthPickerSheet';
import {
  MaterialEditorSheet,
  type ProjectFinishOption,
} from '@components/home-projects/surfaces/MaterialEditorSheet';
import { OpeningSheet } from '@components/home-projects/surfaces/OpeningSheet';
import { RoomPlanCanvas } from '@components/home-projects/surfaces/RoomPlanCanvas';
import { RoomShapeIcon } from '@components/home-projects/surfaces/RoomShapeIcon';
import { SplitSheet } from '@components/home-projects/surfaces/SplitSheet';
import {
  SurfaceCanvas,
  type SurfaceCanvasHandle,
} from '@components/home-projects/surfaces/SurfaceCanvas';
import { SurfacePreviewPanel } from '@components/home-projects/surfaces/SurfacePreviewPanel';
import { SurfaceStrip } from '@components/home-projects/surfaces/SurfaceStrip';
import { SwatchPreview } from '@components/home-projects/surfaces/SwatchPreview';
import { TakeoffPanel } from '@components/home-projects/surfaces/TakeoffPanel';
import { UnitPicker } from '@components/home-projects/surfaces/UnitPicker';
import { Icon } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { toMemberFacingError } from '@features/house/local/memberFacingError';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import {
  MATERIAL_KIND_DEFAULTS,
  ROOM_SHAPE_PRESETS,
  buildShapeOutline,
  clampShapeParams,
  computeTakeoff,
  createRoomSurfaceModel,
  insetPolygon,
  makeRectSubArea,
  makeSubArea,
  polygonBounds,
  regionsOf,
  removeSubArea,
  resizeEdge,
  roomShapePreset,
  seedShapeParams,
  surfaceGrossArea,
  splitRegion,
  starterPalette,
  updateSubArea,
  validateSubArea,
  type RoomShapeKey,
  type RoomShapeParams,
  type SplitAxis,
} from '@features/house/surfaces';
import {
  formatLength,
  formatSurfaceArea,
  lengthInputValue,
  lengthKeyboardType,
  lengthPlaceholder,
  lengthUnitFor,
  parseLength,
  type LengthUnit,
} from '@features/house/surfaces/units';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import {
  countMaterialUsage,
  useRoomSurfaceModel,
  useTextureUris,
  withMaterialRemoved,
  withMaterialUpserted,
} from '@hooks/useRoomSurfaceModel';
import type { HomeProjectsStackParamList } from '@navigation/types';
import { trackEvent } from '@services/analytics';
import { useHouseholdStore } from '@stores/householdStore';
import {
  finishKindForCategory,
  materialFromSelection,
  type Material,
  type MaterialKind,
  type Opening,
  type RoomSurfaceModel,
  type Surface,
  type SurfaceScaleBrief,
} from '@symply/contracts';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  describeBudgetOutcome,
  sendTakeoffToBudget,
  withSelectionLinks,
} from './surfaceBudget';

type Props = NativeStackScreenProps<
  HomeProjectsStackParamList,
  'SurfaceStudio'
>;

type Tab = 'room' | 'surfaces' | 'takeoff';

/**
 * The finish sheet: which area it is for, and what it is currently editing.
 *
 * There used to be two sheets — a picker and an editor — and the hop between
 * them was both a wasted tap and the source of a stacked-modal freeze. They are
 * one page now: the palette sits at the top, the form below it, and choosing an
 * existing finish and adjusting one are the same screen because they are the
 * same decision.
 */
type MaterialSheet = {
  regionId: string | null;
  /** `null` while a brand-new finish is being filled in. */
  material: Material | null;
  materialKind: MaterialKind;
  /**
   * Open the imported-materials list on arrival.
   *
   * Set when the member came in through "From project", so the thing they
   * asked for is the thing they land on rather than a form they have to
   * scroll past.
   */
  fromProject?: boolean;
} | null;

/**
 * What the ceiling wheel offers, metres.
 *
 * The plan dimensions carry their own bounds on
 * `RoomShapeParamSpec.min`/`max`, because they depend on each other — an alcove
 * cannot be wider than the room it is cut into. Height depends on nothing, so
 * it is a plain pair here.
 */
const ROOM_HEIGHT_MIN_M = 1.5;
const ROOM_HEIGHT_MAX_M = 6;

/**
 * The swatch on an "Areas & finishes" row.
 *
 * Big enough to read the material rather than to acknowledge it: a tile's face
 * size and its joint are the whole reason `SwatchPreview` draws to scale, and
 * at 72 × 48 a 600 mm tile and a 300 mm one looked identical.
 */
const REGION_SWATCH_WIDTH = 112;
const REGION_SWATCH_HEIGHT = 78;

/** A stable empty array, so "no model yet" is not a new dependency each render. */
const EMPTY_SURFACES: Surface[] = [];

/**
 * The floating tab bar draws over this screen. `styles.content` reserved 60px,
 * which is less than the bar, so whatever ends the scroll came to rest beneath
 * it. On the room setup that is the `room-start` CTA: `scrollUntilVisible`
 * brought it into the hierarchy, the tap landed on the tab bar instead, and
 * because the CTA is centred the hit went to the bar's CENTRE item — Budget.
 * The flow then failed on `surface-tab-surfaces` from an entirely different
 * tab, which reads as a broken studio rather than a mis-delivered tap.
 */
const TAB_BAR_CONTENT_HEIGHT = 64;

export function SurfaceStudioScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { projectId } = route.params;
  const colors = useAppColors();
  /** iPad's floating leading rail draws over x=0 — reserve its width. */
  const { sidebarInset } = useLayoutPadding();
  const showError = useMemberFacingAlert();
  const window = useWindowDimensions();
  const householdId = useHouseholdStore(s => s.currentHousehold?.id);
  const unitSystem = useHouseholdStore(s => s.currentHousehold?.unit_system);
  /**
   * The unit the member is typing and reading in.
   *
   * `null` means "follow the household", so a property switched to metric in
   * Settings takes effect here without the member having to notice. Once they
   * pick one it sticks for the visit — deliberately not persisted, because a
   * unit chosen to measure one splashback should not silently become how the
   * whole app reads next week. Nothing about it reaches the document.
   */
  const [lengthUnitOverride, setLengthUnitOverride] =
    useState<LengthUnit | null>(null);
  const lengthUnit =
    lengthUnitOverride ?? lengthUnitFor(unitSystem ?? 'imperial');

  const {
    data: hub,
    isLoading,
    refetch,
  } = useHomeProjectHub(householdId, projectId);
  const { invalidate } = useHomeProjectMutation(householdId, projectId);

  const surfaceModel = useRoomSurfaceModel({
    householdId,
    projectId,
    payloadJson: hub?.geometry?.payload_json,
    geometryId: hub?.geometry?.id,
    onSaved: invalidate,
  });
  const {
    model,
    update,
    start,
    dirty,
    saving,
    error,
    remoteChanged,
    discard,
    clear,
  } = surfaceModel;
  const textureUris = useTextureUris(hub?.attachments, householdId);

  /**
   * Texture uris, widened to cover a selection's OWN photo.
   *
   * `useTextureUris` resolves attachments with `kind: 'texture'` — the swatches
   * uploaded from the finish sheet. A material imported from a shop link
   * carries its picture as `kind: 'photo'` instead, so without this an imported
   * tile promoted to a finish would always draw as its fallback colour, even on
   * a household where the bytes are one url away.
   *
   * Urls only, deliberately. A sealed local-first blob needs the
   * `HouseBlobImage` policy — the cellular prompt and its four named failure
   * states — that `useTextureUris` refuses to bypass for a wall covered in
   * thumbnails, so on those households the colour fallback stands. Which is
   * exactly why `materialSchema` makes `colorHex` required.
   */
  const materialTextureUris = useMemo(() => {
    const merged: Record<string, string | undefined> = { ...textureUris };
    for (const row of hub?.attachments ?? []) {
      if (row.status !== 'ready' || merged[row.id]) continue;
      const url = row.url?.trim();
      if (url) merged[row.id] = url;
    }
    return merged;
  }, [textureUris, hub?.attachments]);

  /**
   * Everything the member already shopped for, offered as a finish.
   *
   * The conversion is the contract's (`materialFromSelection`), which refuses
   * rather than inventing a colour or a repeat size. A refusal is kept in the
   * list rather than filtered out of it: a member who has just imported a tile
   * and cannot find it here would conclude the import failed, when what
   * actually happened is that the page never printed a colour.
   */
  const projectFinishOptions = useMemo<ProjectFinishOption[]>(() => {
    const attachments = hub?.attachments ?? [];
    return (hub?.selections ?? []).map(selection => {
      const swatch = swatchAttachmentFor(attachments, selection.id);
      const textureUri = swatch ? materialTextureUris[swatch.id] : undefined;
      const result = materialFromSelection(selection, {
        textureAttachmentId: swatch?.id ?? null,
      });
      if (!result.ok) {
        return {
          selectionId: selection.id,
          name: selection.name,
          caption: result.message,
          material: null,
          blockedReason: result.message,
        };
      }
      return {
        selectionId: selection.id,
        name: selection.name,
        caption: finishOptionCaption(result.material),
        material: result.material,
        textureUri,
      };
    });
  }, [hub?.selections, hub?.attachments, materialTextureUris]);

  const [tab, setTab] = useState<Tab>('room');
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(
    null,
  );
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [splitSheet, setSplitSheet] = useState<{
    axis: SplitAxis;
    regionId?: string;
  } | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  /**
   * The finish flow is ONE sheet at a time, not two overlapping modals.
   *
   * Opening the editor while the picker was still mounted put a second
   * `<Modal>` over the first. On iOS that second modal frequently never
   * presents — which is why "Edit" appeared to do nothing — and dismissing
   * either one mid-presentation leaves an invisible full-screen overlay that
   * swallows every touch. That overlay was the frozen app: the screen was
   * still there, nothing responded.
   *
   * A single discriminated state makes the two mutually exclusive by
   * construction, and `regionId` rides along so closing the editor returns to
   * the picker for the same area rather than dumping the member back to the
   * surface.
   */
  const [materialSheet, setMaterialSheet] = useState<MaterialSheet>(null);
  /**
   * The other surfaces a chosen finish should land on as well.
   *
   * Seeded with the one the sheet was opened from and never empty. One paint
   * usually covers every wall in the room, and without this the member makes
   * the same choice once per wall.
   */
  const [applyTo, setApplyTo] = useState<string[]>([]);
  const [openingSheet, setOpeningSheet] = useState<{
    opening: Opening | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The canvas of the surface currently open, so a preview can capture exactly
   * the drawing the member is looking at. See `SurfaceCanvasHandle`.
   */
  const canvasRef = useRef<SurfaceCanvasHandle>(null);
  const [previewBriefs, setPreviewBriefs] = useState<
    Record<string, SurfaceScaleBrief>
  >({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** The wall length row that is open on the Room tab. */
  const [activeEdge, setActiveEdge] = useState<number | null>(null);

  // Memoised because `?? []` mints a fresh array on every render, which would
  // make it a changing dependency of both hooks below — and the effect that
  // repairs the selection would then run every frame of a drag.
  const surfaces = useMemo(() => model?.surfaces ?? EMPTY_SURFACES, [model]);
  const selectedSurface = useMemo(
    () => surfaces.find(surface => surface.id === selectedSurfaceId) ?? null,
    [surfaces, selectedSurfaceId],
  );

  /**
   * Which surfaces the open finish can also land on.
   *
   * Whole surfaces only, and only ones of the same KIND as the one being
   * edited: offering to put a floor tile on the ceiling is offering a mistake.
   * A surface marked not-in-scope is left out for the same reason it is left
   * out of the takeoff.
   */
  const applyTargets = useMemo(() => {
    if (!selectedSurface) return [];
    return surfaces
      .filter(
        surface =>
          surface.excluded !== true && surface.kind === selectedSurface.kind,
      )
      .map(surface => ({
        id: surface.id,
        label: surface.label,
        selected:
          surface.id === selectedSurface.id || applyTo.includes(surface.id),
        // The surface the sheet was opened from is the one being edited, so it
        // cannot be unticked out of its own edit.
        locked: surface.id === selectedSurface.id,
      }));
  }, [surfaces, selectedSurface, applyTo]);

  const toggleApplyTarget = useCallback((surfaceId: string) => {
    setApplyTo(current =>
      current.includes(surfaceId)
        ? current.filter(id => id !== surfaceId)
        : [...current, surfaceId],
    );
  }, []);

  // Keep a valid selection through a plan edit that removed the open wall.
  useEffect(() => {
    if (!model) return;
    if (
      selectedSurfaceId &&
      surfaces.some(surface => surface.id === selectedSurfaceId)
    )
      return;
    setSelectedSurfaceId(surfaces[0]?.id ?? null);
    setSelectedRegionId(null);
  }, [model, surfaces, selectedSurfaceId]);

  useEffect(() => {
    trackEvent('home_project_surface_studio_opened', { project_id: projectId });
  }, [projectId]);

  /**
   * A back-press with unsaved work saves it rather than asking.
   *
   * The autosave already fires 1.2 s after the last edit, so the only way to be
   * here dirty is to leave inside that window — which means the member finished
   * an edit and immediately navigated. Prompting to confirm work they can see on
   * the screen is a dialog with one sensible answer.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (dirty) void surfaceModel.save();
    });
    return unsubscribe;
  }, [navigation, dirty, surfaceModel]);

  /**
   * Set one wall to an exact length.
   *
   * Refuses silently when the result would be self-intersecting or degenerate —
   * `resizeEdge` returns null and the wheel simply cannot be confirmed onto that
   * value, which is a better answer than an alert explaining that a wall cannot
   * pass through the opposite wall.
   */
  const setEdgeLength = useCallback(
    (edgeIndex: number, metres: number) => {
      update(
        current => {
          const resized = resizeEdge(current.room.outline, edgeIndex, metres);
          if (!resized) return current;
          return { ...current, room: { ...current.room, outline: resized } };
        },
        { reconcile: true },
      );
      setActiveEdge(edgeIndex);
    },
    [update],
  );

  /**
   * Delete the whole layout and go back to the shape picker.
   *
   * Confirmed, because it is the one action here that cannot be undone by the
   * undo stack — the stack lives in this screen and the row is gone from both
   * backends. The count in the copy is what the member is actually losing.
   */
  const deleteRoom = () => {
    const areaCount =
      model?.surfaces.reduce(
        (sum, surface) => sum + surface.subAreas.length,
        0,
      ) ?? 0;
    const finishes = model?.materials.length ?? 0;
    Alert.alert(
      'Delete this room layout?',
      areaCount > 0 || finishes > 0
        ? `Every surface, its ${areaCount} sub-area${
            areaCount === 1 ? '' : 's'
          } and ${finishes} finish${
            finishes === 1 ? '' : 'es'
          } go with it. The rest of the project is untouched.`
        : 'You will start again from the shape picker. The rest of the project is untouched.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void clear().then(() => {
              setSelectedSurfaceId(null);
              setSelectedRegionId(null);
              setActiveEdge(null);
              setTab('room');
            });
            trackEvent('home_project_surface_room_deleted', {
              project_id: projectId,
            });
          },
        },
      ],
    );
  };

  const mutateSurface = useCallback(
    (surfaceId: string, mutator: (surface: Surface) => Surface) => {
      update(current => ({
        ...current,
        surfaces: current.surfaces.map(surface =>
          surface.id === surfaceId ? mutator(surface) : surface,
        ),
      }));
    },
    [update],
  );

  // ---- room -------------------------------------------------------------

  const canvasWidth = Math.max(240, window.width - 32);

  const startRoom = (
    presetKey: string,
    outline: RoomSurfaceModel['room']['outline'],
    height: number,
  ) => {
    start(
      createRoomSurfaceModel({
        outline,
        wallHeight_m: height,
        materials: starterPalette(),
        origin: 'manual',
      }),
    );
    setTab('surfaces');
    trackEvent('home_project_surface_room_created', { preset: presetKey });
  };

  // ---- areas ------------------------------------------------------------

  const doSplit = (at: number) => {
    if (!selectedSurface || !splitSheet) return;
    const result = splitRegion(selectedSurface, splitSheet.axis, at, {
      regionId: splitSheet.regionId,
    });
    if (!result.ok) {
      setSplitError(result.message ?? 'That split does not work here.');
      return;
    }
    mutateSurface(selectedSurface.id, () => result.surface);
    setSplitError(null);
    setSplitSheet(null);
    setSelectedRegionId(result.createdIds[0] ?? null);
  };

  /**
   * "Add an area" drops an inset rectangle in the middle of the surface.
   *
   * Not a free-draw: a rectangle the member then adjusts is faster than placing
   * four corners, it is guaranteed valid on arrival, and it is the shape almost
   * every real sub-area is. Anything genuinely irregular is reachable by
   * splitting twice.
   */
  const addArea = () => {
    if (!selectedSurface) return;
    const bounds = polygonBounds(selectedSurface.outline);
    const label = `Area ${selectedSurface.subAreas.length + 1}`;
    // An inset of the surface's own shape first — on an L-shaped floor that
    // gives an L-shaped region, which is what a member expects "add an area"
    // to mean. Falling back to a centred rectangle covers the case where the
    // shape is too small or too thin to inset.
    const inset = insetPolygon(
      selectedSurface.outline,
      Math.min(bounds.width, bounds.height) * 0.2,
    );
    const candidate =
      inset && validateSubArea(selectedSurface, inset).ok
        ? makeSubArea(selectedSurface, inset, label, selectedSurface.materialId)
        : makeRectSubArea(
            selectedSurface,
            bounds.minX + bounds.width * 0.25,
            bounds.minY + bounds.height * 0.25,
            bounds.width * 0.5,
            bounds.height * 0.5,
            label,
            selectedSurface.materialId,
          );

    const validation = validateSubArea(selectedSurface, candidate.outline);
    if (!validation.ok) {
      Alert.alert(
        'Could not add an area',
        validation.message ?? 'Try splitting the surface instead.',
      );
      return;
    }
    mutateSurface(selectedSurface.id, surface => ({
      ...surface,
      subAreas: [...surface.subAreas, candidate],
    }));
    setSelectedRegionId(candidate.id);
  };

  /**
   * Put a finish on the area the sheet is open for, and keep the sheet open.
   *
   * Staying open is the point of merging the two sheets: the member sees the
   * drawing behind change, and can carry on adjusting the finish they just
   * chose without a second trip. `Done` is what closes it.
   */
  /**
   * Put a finish on the open region, and on any other whole surfaces ticked.
   *
   * The open surface is addressed through its REGION — which may be a sub-area,
   * a wainscot say — while the others take it as their base material. That
   * asymmetry is the honest one: "also paint the other three walls" means the
   * walls, not some sub-area of them that the member has not looked at.
   */
  const applyMaterialTo = (materialId: string | null) => {
    if (!selectedSurface || !materialSheet) return;
    const { regionId } = materialSheet;
    const alsoOn = new Set(applyTo.filter(id => id !== selectedSurface.id));
    update(current => ({
      ...current,
      surfaces: current.surfaces.map(surface => {
        if (surface.id === selectedSurface.id) {
          return regionId === null
            ? { ...surface, materialId }
            : updateSubArea(surface, regionId, { materialId });
        }
        return alsoOn.has(surface.id) ? { ...surface, materialId } : surface;
      }),
    }));
  };

  const assignMaterial = (materialId: string | null) => {
    if (!selectedSurface || !materialSheet) return;
    applyMaterialTo(materialId);
    // Load the chosen finish into the form below, so "select" and "adjust" are
    // one continuous action rather than two screens.
    const chosen = materialId
      ? model?.materials.find(entry => entry.id === materialId) ?? null
      : null;
    setMaterialSheet(current =>
      current
        ? {
            ...current,
            material: chosen,
            materialKind: chosen?.kind ?? current.materialKind,
          }
        : current,
    );
  };

  // ---- materials --------------------------------------------------------

  /**
   * Open the finish sheet for one area.
   *
   * Straight into the edit page, already loaded with whatever the area
   * currently uses — the picker step that used to sit in between answered a
   * question the member had not asked. `fromProject` decides which of the two
   * ways in is already open when they arrive.
   */
  const openMaterialSheet = (regionId: string | null, fromProject = false) => {
    if (!model) return;
    const current = currentMaterialId(selectedSurface, regionId);
    const existing =
      model.materials.find(entry => entry.id === current) ?? null;
    setApplyTo(selectedSurface ? [selectedSurface.id] : []);
    setMaterialSheet({
      regionId,
      material: existing,
      materialKind:
        existing?.kind ?? suggestedKinds(selectedSurface)[0] ?? 'paint',
      fromProject,
    });
  };

  /**
   * Put a material the member already shopped for onto the open area.
   *
   * Upserted into the room's palette AND assigned in one step, because tapping
   * a tile you have already bought means "this one", not "add it to a list I
   * will then choose from". This is the whole bridge: colour, repeat size,
   * grout and swatch cross over together, so the wall is drawn to scale without
   * the member retyping a single number they already imported.
   *
   * An import that states no colour cannot become a finish — `colorHex` is
   * required and inventing one paints a wall the member never chose — so it
   * loads the manual form instead. Everything the listing DID state is
   * pre-filled and the colour picker is right there, which is the prompt the
   * contract's refusal exists to trigger.
   */
  const applyProjectMaterialOption = (option: ProjectFinishOption) => {
    if (!materialSheet) return;
    const applied = option.material;
    if (applied) {
      update(current => withMaterialUpserted(current, applied));
      applyMaterialTo(applied.id);
    }
    const selection = (hub?.selections ?? []).find(
      row => row.id === option.selectionId,
    );
    const draft =
      applied ??
      (selection
        ? draftFinishFromSelection(
            selection,
            swatchAttachmentFor(hub?.attachments ?? [], selection.id)?.id ??
              null,
          )
        : null);
    setMaterialSheet(current =>
      current
        ? {
            ...current,
            material: draft,
            materialKind: draft?.kind ?? current.materialKind,
            // Collapse the list now that a choice is made — the form below is
            // what the member looks at next, whichever branch they took.
            fromProject: false,
          }
        : current,
    );
    trackEvent('home_project_surface_material_from_selection', {
      project_id: projectId,
      applied: Boolean(applied),
    });
  };

  /**
   * Save the form, and put the result on the area.
   *
   * Both halves, every time. The sheet is opened FROM an area, so a finish
   * edited here is the finish that area should have — the older split flow only
   * assigned on create, which meant adjusting a colour left the area on the
   * version before the adjustment.
   */
  const saveMaterial = (material: Material) => {
    const sheet = materialSheet;
    update(current => withMaterialUpserted(current, material));
    if (sheet && selectedSurface) applyMaterialTo(material.id);
    setMaterialSheet(null);
  };

  const deleteMaterial = (materialId: string) => {
    const usage = countMaterialUsage(model, materialId);
    const remove = () => {
      update(current => withMaterialRemoved(current, materialId));
      setMaterialSheet(current =>
        current ? { ...current, material: null } : current,
      );
    };
    if (usage === 0) {
      remove();
      return;
    }
    Alert.alert(
      'Delete this material?',
      `It is used on ${usage} area${
        usage === 1 ? '' : 's'
      }. They will go back to “no finish yet”.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: remove },
      ],
    );
  };

  /**
   * Attach a swatch photo to the material being edited.
   *
   * Uploaded as an ordinary project attachment with `kind: 'texture'`, so it is
   * sealed into the H6 blob channel on a local-first household and lands in R2
   * otherwise, with no branch here. The hub is invalidated afterwards because
   * `useTextureUris` reads the attachment list.
   */
  const pickTexture = async (uri: string) => {
    if (!householdId || !materialSheet) return;
    setBusy(true);
    try {
      const attachment = await homeProjectsApi.uploadSelectionPhoto(
        householdId,
        projectId,
        uri,
        undefined,
        undefined,
        'texture',
      );
      setMaterialSheet(current =>
        current?.material
          ? {
              ...current,
              material: {
                ...current.material,
                textureAttachmentId: attachment.id,
              },
            }
          : current,
      );
      // A material still being created has no palette row yet, so the id is
      // carried on the draft the sheet holds. One that already exists is
      // written straight through, or the photo would be lost if the member
      // closed the sheet with the back gesture.
      if (materialSheet.material) {
        update(current =>
          withMaterialUpserted(current, {
            ...materialSheet.material!,
            textureAttachmentId: attachment.id,
          }),
        );
      }
      invalidate();
      await refetch();
    } catch (err) {
      showError(err, 'Could not add the photo.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * A material photo's four sources.
   *
   * This reached `expo-image-picker` directly and offered the photo library
   * alone, so a tile shot the member had downloaded from the manufacturer — a
   * file, not a camera-roll photo — could not be used as the texture. The row
   * is disclosed inside the editor sheet rather than presented as a second
   * modal, for the reason `materialSheet` documents above.
   */
  const {
    sourceHandlers: textureSources,
    drivePicker: textureDrivePicker,
    driveOpen: textureDriveOpen,
  } = useAttachmentSources({
    rememberScope: 'surface-texture',
    pickerOptions: { cropping: true, compressImageQuality: 0.9, mediaType: 'photo' },
    onPicked: ([picked]) => {
      if (picked) void pickTexture(picked.uri);
    },
  });

  // ---- photo preview -----------------------------------------------------

  /**
   * The newest render for a surface.
   *
   * Matched on the filename the Worker writes (`surface-<id>.png`), because the
   * attachment DTO carries no surface field and `tags` is filtered to
   * before/after by the service. It is a weaker link than a column and it is
   * deterministic — but it is the kind of thing that rots quietly, so if a
   * `surface_id` ever lands on `home_project_attachments` this should move to
   * it. Attachments are returned newest-last by neither backend, so the last
   * match wins rather than the first.
   */
  const previewFor = useCallback(
    (surfaceId: string): HomeProjectAttachment | null => {
      const matches = (hub?.attachments ?? []).filter(
        row =>
          row.kind === 'ai_render' &&
          row.filename === `surface-${surfaceId}.png`,
      );
      return matches[matches.length - 1] ?? null;
    },
    [hub?.attachments],
  );

  /**
   * Generate a photoreal preview of the open surface.
   *
   * The canvas capture is best-effort: `toDataURL` is native and can be absent,
   * and a preview without it is prompt-only rather than failed — the Worker
   * says as much in its response. Everything the model is *held to* is computed
   * server-side from the stored document, so a missing drawing costs fidelity
   * and never correctness.
   */
  const generatePreview = async () => {
    if (!householdId || !selectedSurface) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      // Save first: the Worker builds the brief from the STORED document, so an
      // unsaved split would be previewed as the wall before it was split.
      if (dirty) await surfaceModel.save();
      const layout = await canvasRef.current?.capturePng();
      const result = await homeProjectsApi.generateSurfacePreview(
        householdId,
        projectId,
        selectedSurface.id,
        layout ?? undefined,
      );
      setPreviewBriefs(current => ({
        ...current,
        [selectedSurface.id]: result.brief,
      }));
      invalidate();
      await refetch();
      trackEvent('home_project_surface_preview_generated', {
        project_id: projectId,
        used_layout: Boolean(layout),
      });
    } catch (err) {
      const { message } = toMemberFacingError(
        err,
        'Could not make a preview just now.',
      );
      setPreviewError(message);
    } finally {
      setPreviewBusy(false);
    }
  };

  // ---- takeoff ----------------------------------------------------------

  /**
   * Price the room into the project's budget.
   *
   * This is the other end of "attach a material to a surface": the finish the
   * member put on a wall carries `selectionId`, so the material they chose and
   * the area they measured are the same fact, and this turns that fact into
   * money. Each takeoff line's linked selection gets a `materials` budget line
   * worth exactly what the takeoff panel is showing — `computeTakeoff` is the
   * only thing that prices anything, because it is the arithmetic the member is
   * looking at when they tap.
   *
   * It used to match by NAME and create a selection whenever it missed, which
   * meant renaming a finish doubled the budget, re-measuring a room never moved
   * it, and a material attached from the project's own list came back as a copy
   * of itself. See `surfaceBudget.ts` for the rest of the reasoning, including
   * why it takes two passes.
   *
   * The links it returns are written back into the room document, so the next
   * run finds the same selections instead of minting new ones.
   */
  const sendToBudget = async () => {
    if (!model || !householdId) return;
    const takeoff = computeTakeoff(model);
    if (takeoff.lines.length === 0) return;
    setBusy(true);
    try {
      // The links are stored in the document, so an unsaved edit has to reach
      // the ledger before we start writing ids into it — otherwise the save
      // that follows would race the autosave holding the older materials.
      if (dirty) await surfaceModel.save();
      const outcome = await sendTakeoffToBudget({
        takeoff,
        model,
        selections: hub?.selections ?? [],
        optionGroups: hub?.option_groups ?? [],
        ports: {
          createSelection: input =>
            homeProjectsApi.createSelection(householdId, projectId, input),
          updateSelection: (selectionId, patch) =>
            homeProjectsApi.updateSelection(
              householdId,
              projectId,
              selectionId,
              patch,
            ),
          createBudgetLine: input =>
            homeProjectsApi.createBudgetLine(householdId, projectId, input),
          updateBudgetLine: (lineId, patch) =>
            homeProjectsApi.updateBudgetLine(
              householdId,
              projectId,
              lineId,
              patch,
            ),
          // `refetch` rather than `invalidate`: the second pass needs the rows
          // in hand, including the budget lines `createSelection` minted on its
          // own, and an invalidation only schedules a read. The cache-wide
          // invalidate still happens once at the end, for the other screens.
          reload: async () => {
            const fresh = await refetch();
            return {
              selections: fresh.data?.selections ?? hub?.selections ?? [],
              budgetLines: fresh.data?.budget_lines ?? hub?.budget_lines ?? [],
            };
          },
        },
      });
      // `update` runs its callback at call time rather than at render time
      // (see `useRoomSurfaceModel`), so this flag is set before the next line
      // reads it — and a promote that recorded no new link leaves the document
      // alone instead of putting a byte-identical copy through the ledger.
      let linksChanged = false;
      update(current => {
        const next = withSelectionLinks(current, outcome.linked);
        linksChanged = next !== current;
        return next;
      });
      if (linksChanged) await surfaceModel.save();
      invalidate();
      await refetch();
      Alert.alert('Budget updated', describeBudgetOutcome(outcome));
      trackEvent('home_project_surface_takeoff_sent', {
        lines: takeoff.lines.length,
        created: outcome.created,
        priced_lines: outcome.pricedLines,
      });
    } catch (err) {
      showError(err, 'Could not add these materials to the project.');
    } finally {
      setBusy(false);
    }
  };

  // ---- render -----------------------------------------------------------

  if (isLoading || !hub) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.backgroundMain,
          paddingLeft: sidebarInset,
        }}
      >
        <ScreenHeader
          title="Surfaces"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.backgroundMain,
        paddingLeft: sidebarInset,
      }}
    >
      <ScreenHeader
        title={hub.project.title}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <StatusStrip
        dirty={dirty}
        saving={saving}
        error={error}
        remoteChanged={remoteChanged}
        onDiscard={discard}
        onRetry={() => void surfaceModel.save()}
      />

      {!model ? (
        <RoomStarter
          lengthUnit={lengthUnit}
          onUnitChange={setLengthUnitOverride}
          onStart={startRoom}
          hasLegacyGeometry={Boolean(hub.geometry?.payload_json)}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabs}
            contentContainerStyle={styles.tabsContent}
          >
            {(['room', 'surfaces', 'takeoff'] as Tab[]).map(key => (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: tab === key ? colors.primary : colors.card,
                    borderColor:
                      tab === key ? colors.primary : colors.borderColor,
                  },
                ]}
                testID={`surface-tab-${key}`}
              >
                <Text
                  style={{
                    color: tab === key ? '#fff' : colors.textPrimary,
                    fontWeight: '600',
                    textTransform: 'capitalize',
                  }}
                >
                  {key}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            {...keyboardDismissScrollProps}
            style={styles.scrollBody}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: 60 + TAB_BAR_CONTENT_HEIGHT + insets.bottom },
            ]}
          >
            {tab === 'room' ? (
              <RoomTab
                model={model}
                width={canvasWidth}
                lengthUnit={lengthUnit}
                onUnitChange={setLengthUnitOverride}
                selectedSurfaceId={selectedSurfaceId}
                onSelectSurface={id => {
                  setSelectedSurfaceId(id);
                  setSelectedRegionId(null);
                  setTab('surfaces');
                }}
                onOutlineChange={outline =>
                  update(
                    current => ({
                      ...current,
                      room: { ...current.room, outline },
                    }),
                    {
                      reconcile: true,
                      history: false,
                    },
                  )
                }
                onOutlineCommit={outline =>
                  update(
                    current => ({
                      ...current,
                      room: { ...current.room, outline },
                    }),
                    {
                      reconcile: true,
                    },
                  )
                }
                onEdgeLength={setEdgeLength}
                activeEdge={activeEdge}
                onActivateEdge={setActiveEdge}
                onHeightChange={wallHeight_m =>
                  update(
                    current => ({
                      ...current,
                      room: { ...current.room, wallHeight_m },
                    }),
                    {
                      reconcile: true,
                    },
                  )
                }
                canUndo={surfaceModel.canUndo}
                canRedo={surfaceModel.canRedo}
                onUndo={surfaceModel.undo}
                onRedo={surfaceModel.redo}
                staleWallIds={surfaceModel.staleWallIds}
                onDeleteRoom={deleteRoom}
              />
            ) : null}

            {tab === 'surfaces' ? (
              <SurfacesTab
                model={model}
                surface={selectedSurface}
                width={canvasWidth}
                lengthUnit={lengthUnit}
                canvasRef={canvasRef}
                previewSlot={
                  selectedSurface ? (
                    <SurfacePreviewPanel
                      surfaceLabel={selectedSurface.label}
                      householdId={householdId}
                      attachment={previewFor(selectedSurface.id)}
                      brief={previewBriefs[selectedSurface.id] ?? null}
                      width={canvasWidth}
                      busy={previewBusy}
                      onGenerate={() => void generatePreview()}
                      error={previewError}
                      testID="surface-preview-panel"
                    />
                  ) : null
                }
                textureUris={materialTextureUris}
                selectedRegionId={selectedRegionId}
                staleWallIds={surfaceModel.staleWallIds}
                projectMaterialCount={projectFinishOptions.length}
                onApplyProjectMaterial={regionId =>
                  openMaterialSheet(regionId, true)
                }
                onSelectSurface={id => {
                  setSelectedSurfaceId(id);
                  setSelectedRegionId(null);
                }}
                onSelectRegion={setSelectedRegionId}
                onSplit={(axis, regionId) => {
                  setSplitError(null);
                  setSplitSheet({ axis, regionId });
                }}
                onAddArea={addArea}
                onOpenMaterial={regionId => openMaterialSheet(regionId)}
                onRemoveRegion={regionId => {
                  if (!selectedSurface) return;
                  mutateSurface(selectedSurface.id, surface =>
                    removeSubArea(surface, regionId),
                  );
                  setSelectedRegionId(null);
                }}
                onRenameRegion={(regionId, label) => {
                  if (!selectedSurface) return;
                  mutateSurface(selectedSurface.id, surface =>
                    updateSubArea(surface, regionId, { label }),
                  );
                }}
                onAddOpening={() => setOpeningSheet({ opening: null })}
                onEditOpening={opening => setOpeningSheet({ opening })}
                onToggleExcluded={() => {
                  if (!selectedSurface) return;
                  mutateSurface(selectedSurface.id, surface => ({
                    ...surface,
                    excluded: !surface.excluded,
                  }));
                }}
                onRelabelSurface={label => {
                  if (!selectedSurface) return;
                  mutateSurface(selectedSurface.id, surface => ({
                    ...surface,
                    label,
                  }));
                }}
                onRederiveSurface={() => {
                  if (!selectedSurface) return;
                  mutateSurface(selectedSurface.id, surface => ({
                    ...surface,
                    outlineLocked: false,
                  }));
                  update(current => ({ ...current }), { reconcile: true });
                }}
              />
            ) : null}

            {tab === 'takeoff' ? (
              <TakeoffPanel
                model={model}
                lengthUnit={lengthUnit}
                currency={hub.project.currency}
                onSendToBudget={() => void sendToBudget()}
                sending={busy}
              />
            ) : null}
          </ScrollView>
        </>
      )}

      {/* ---- sheets ---- */}
      {selectedSurface && splitSheet ? (
        <SplitSheet
          visible
          targetLabel={
            splitSheet.regionId
              ? selectedSurface.subAreas.find(
                  area => area.id === splitSheet.regionId,
                )?.label ?? selectedSurface.label
              : selectedSurface.label
          }
          axis={splitSheet.axis}
          onAxisChange={axis => setSplitSheet({ ...splitSheet, axis })}
          {...splitRange(selectedSurface, splitSheet)}
          lengthUnit={lengthUnit}
          onSplit={doSplit}
          onClose={() => {
            setSplitSheet(null);
            setSplitError(null);
          }}
          error={splitError}
        />
      ) : null}

      {model && materialSheet ? (
        <MaterialEditorSheet
          // Hidden, not unmounted, while the Drive browse is up: unmounting
          // would lose the half-edited material the sheet is holding.
          visible={!textureDriveOpen}
          subtitle={regionSubtitle(
            selectedSurface,
            materialSheet.regionId,
            lengthUnit,
          )}
          material={materialSheet.material}
          initialKind={materialSheet.materialKind}
          materials={model.materials}
          textureUris={materialTextureUris}
          projectMaterials={projectFinishOptions}
          projectMaterialsExpanded={materialSheet.fromProject === true}
          onUseProjectMaterial={applyProjectMaterialOption}
          selectedMaterialId={currentMaterialId(
            selectedSurface,
            materialSheet.regionId,
          )}
          onSelectMaterial={assignMaterial}
          onStartNew={kind =>
            setMaterialSheet(current =>
              current
                ? { ...current, material: null, materialKind: kind }
                : current,
            )
          }
          suggestedKinds={suggestedKinds(selectedSurface)}
          applyTargets={applyTargets}
          onToggleApplyTarget={toggleApplyTarget}
          textureUri={
            materialSheet.material?.textureAttachmentId
              ? textureUris[materialSheet.material.textureAttachmentId]
              : undefined
          }
          textureSources={textureSources}
          onClearTexture={() =>
            setMaterialSheet(current =>
              current?.material
                ? {
                    ...current,
                    material: {
                      ...current.material,
                      textureAttachmentId: null,
                    },
                  }
                : current,
            )
          }
          onSave={saveMaterial}
          onDelete={
            // Only for a finish that is actually in the room's palette. A
            // pre-filled draft from an import is not saved yet, and offering to
            // delete it would offer to delete nothing.
            materialSheet.material &&
            model.materials.some(
              entry => entry.id === materialSheet.material?.id,
            )
              ? deleteMaterial
              : undefined
          }
          usageCount={
            materialSheet.material
              ? countMaterialUsage(model, materialSheet.material.id)
              : 0
          }
          currency={hub.project.currency}
          onClose={() => setMaterialSheet(null)}
        />
      ) : null}

      {selectedSurface && openingSheet ? (
        <OpeningSheet
          visible
          surfaceLabel={selectedSurface.label}
          opening={openingSheet.opening}
          maxX={polygonBounds(selectedSurface.outline).maxX}
          maxY={polygonBounds(selectedSurface.outline).maxY}
          lengthUnit={lengthUnit}
          onSave={opening => {
            mutateSurface(selectedSurface.id, surface => ({
              ...surface,
              openings: surface.openings.some(row => row.id === opening.id)
                ? surface.openings.map(row =>
                    row.id === opening.id ? opening : row,
                  )
                : [...surface.openings, opening],
            }));
            setOpeningSheet(null);
          }}
          onDelete={openingId => {
            mutateSurface(selectedSurface.id, surface => ({
              ...surface,
              openings: surface.openings.filter(row => row.id !== openingId),
            }));
            setOpeningSheet(null);
          }}
          onClose={() => setOpeningSheet(null)}
        />
      ) : null}

      {textureDrivePicker}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The durable photo for one selection, if it has one.
 *
 * A texture wins over a product photo: a member who photographed the actual
 * tile shot it flat and straight on, which is what tiles across a wall. The
 * vendor's hero image is a styled room shot as often as it is a swatch, so it
 * is the fallback rather than the choice.
 */
function swatchAttachmentFor(
  attachments: HomeProjectAttachment[],
  selectionId: string,
): HomeProjectAttachment | null {
  const rows = attachments.filter(
    row => row.selection_id === selectionId && row.status === 'ready',
  );
  return (
    rows.find(row => row.kind === 'texture') ??
    rows.find(row => row.kind === 'photo') ??
    null
  );
}

/** "Tile Depot · 600 × 600 mm" — what the import knows, at a glance. */
function finishOptionCaption(material: Material): string {
  const parts: string[] = [];
  if (material.vendor) parts.push(material.vendor);
  if (material.unit_w_mm && material.unit_h_mm) {
    parts.push(`${material.unit_w_mm} × ${material.unit_h_mm} mm`);
  }
  if (parts.length === 0)
    parts.push(MATERIAL_KIND_DEFAULTS[material.kind].label);
  return parts.join(' · ');
}

/**
 * The finish form, pre-filled from a selection that cannot be converted.
 *
 * `materialFromSelection` refuses an import with no colour, and this is the
 * caller doing what that refusal delegates to it: seeding the SAME conversion
 * with the kind's starting colour so the member sees every other imported fact
 * already in place, and picks the one thing the listing never stated.
 *
 * The colour lands in a text field under a swatch grid the member is looking
 * at — not on a wall behind their back, which is the failure the refusal
 * prevents. Running it through the one conversion rather than hand-mapping the
 * fields again also inherits its other rule for free: a listing that stated no
 * size still yields no repeat, so the size boxes arrive empty and
 * `quantityGap` says so.
 */
function draftFinishFromSelection(
  selection: HomeProjectSelection,
  textureAttachmentId: string | null,
): Material | null {
  const kind = finishKindForCategory(selection.category);
  const result = materialFromSelection(
    { ...selection, color_hex: MATERIAL_KIND_DEFAULTS[kind].colorHex ?? null },
    { textureAttachmentId },
  );
  return result.ok ? result.material : null;
}

function currentMaterialId(
  surface: Surface | null,
  regionId: string | null,
): string | null {
  if (!surface) return null;
  if (regionId === null) return surface.materialId;
  return (
    surface.subAreas.find(area => area.id === regionId)?.materialId ?? null
  );
}

function regionSubtitle(
  surface: Surface | null,
  regionId: string | null,
  lengthUnit: ReturnType<typeof lengthUnitFor>,
): string {
  if (!surface) return '';
  const region = regionsOf(surface).find(entry => entry.subAreaId === regionId);
  if (!region) return surface.label;
  return `${surface.label} · ${region.label} · ${formatSurfaceArea(
    region.netM2,
    lengthUnit,
  )}`;
}

/** A wall is not offered flooring, and a floor is not offered wallpaper. */
function suggestedKinds(surface: Surface | null): MaterialKind[] {
  if (!surface) return ['paint', 'tile'];
  if (surface.kind === 'floor') return ['flooring', 'tile', 'stone', 'other'];
  if (surface.kind === 'ceiling') return ['paint', 'panel', 'other'];
  return ['paint', 'tile', 'panel', 'wallpaper'];
}

/** The legal range for a split, in the surface's own coordinates. */
function splitRange(
  surface: Surface,
  sheet: { axis: SplitAxis; regionId?: string },
): { min: number; max: number; initial: number } {
  const region = sheet.regionId
    ? surface.subAreas.find(area => area.id === sheet.regionId)
    : undefined;
  const bounds = polygonBounds(region ? region.outline : surface.outline);
  const min = sheet.axis === 'horizontal' ? bounds.minY : bounds.minX;
  const max = sheet.axis === 'horizontal' ? bounds.maxY : bounds.maxX;
  return { min, max, initial: (min + max) / 2 };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function StatusStrip({
  dirty,
  saving,
  error,
  remoteChanged,
  onDiscard,
  onRetry,
}: {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  remoteChanged: boolean;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const colors = useAppColors();
  if (error) {
    return (
      <Pressable
        style={[styles.status, { backgroundColor: colors.error }]}
        onPress={onRetry}
        testID="surface-status-error"
      >
        <Text style={styles.statusText}>{error} Tap to try again.</Text>
      </Pressable>
    );
  }
  if (remoteChanged) {
    return (
      <View style={[styles.status, { backgroundColor: colors.warning }]}>
        <Text style={styles.statusText}>
          Someone else changed this room. Yours will replace theirs when it
          saves.
        </Text>
        <Pressable
          onPress={onDiscard}
          hitSlop={8}
          testID="surface-status-discard"
        >
          <Text style={[styles.statusText, styles.statusAction]}>
            Take theirs
          </Text>
        </Pressable>
      </View>
    );
  }
  if (saving || dirty) {
    return (
      <View style={[styles.status, { backgroundColor: colors.card }]}>
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>
          {saving ? 'Saving…' : 'Unsaved changes'}
        </Text>
      </View>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function RoomStarter({
  lengthUnit,
  onUnitChange,
  onStart,
  hasLegacyGeometry,
}: {
  lengthUnit: LengthUnit;
  onUnitChange: (unit: LengthUnit) => void;
  /**
   * Takes the finished OUTLINE rather than a width and a depth.
   *
   * A T needs four numbers and a rectangle two, so a fixed argument list stopped
   * being able to describe what the member drew. The starter already builds the
   * exact polygon for its preview; handing that over means the room created is
   * provably the room previewed.
   */
  onStart: (
    presetKey: string,
    outline: RoomSurfaceModel['room']['outline'],
    height: number,
  ) => void;
  hasLegacyGeometry: boolean;
}) {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const window = useWindowDimensions();
  // Two across on a tablet, one on a phone. Below this the icon and the
  // description share about 130 points and the description wraps to three
  // lines, which makes four options taller than the form they introduce.
  const presetMinWidth = window.width >= 700 ? '46%' : '100%';
  // 16 screen padding either side, 14 card padding either side.
  const previewWidth = Math.max(200, window.width - 60);
  const [presetKey, setPresetKey] = useState(ROOM_SHAPE_PRESETS[0].key);
  const preset = useMemo(() => roomShapePreset(presetKey), [presetKey]);

  /**
   * Every dimension the chosen shape needs, in METRES, keyed by param.
   *
   * Metres rather than typed text is what makes the unit picker free:
   * switching to centimetres re-renders the same numbers rather than
   * converting strings, so there is no path on which `11' 10"` can be
   * reinterpreted as 11.83 metres. Text exists only inside a field the member
   * has explicitly switched to manual entry, and only until it parses.
   *
   * Keyed by param rather than three named `useState`s because a rectangle
   * needs two dimensions and a T needs four — an L with a 2 m bite and an L
   * with a 0.4 m bite are different rooms with the same bounding box, and
   * width × depth cannot tell them apart.
   */
  const [params, setParams] = useState<RoomShapeParams>(() =>
    seedShapeParams(ROOM_SHAPE_PRESETS[0], 3.6, 3),
  );
  const [heightM, setHeightM] = useState(2.4);

  /** Which dimension the member last touched — the one the preview calls out. */
  const [activeParam, setActiveParam] = useState<string | null>(null);

  /**
   * Changing shape keeps what has already been measured.
   *
   * Width and depth carry across unchanged, and any feature the new shape
   * shares by name comes with them; the rest are seeded and everything is
   * re-clamped, since a 2 m alcove does not fit a room that is now 1.5 m wide.
   */
  const changeShape = (key: RoomShapeKey) => {
    const next = roomShapePreset(key);
    setParams(current =>
      seedShapeParams(next, current.width, current.depth, current),
    );
    setPresetKey(key);
    setActiveParam(null);
  };

  const setParam = (key: string, metres: number) => {
    setParams(current =>
      clampShapeParams(preset, { ...current, [key]: metres }),
    );
    setActiveParam(key);
  };

  /**
   * Validated against the shape's OWN bounds rather than a pair of constants,
   * so a shape that adds a dimension cannot be created in a state its
   * `build()` would have to defend itself against.
   */
  const ready =
    preset.params.every(spec => {
      const value = params[spec.key];
      return (
        Number.isFinite(value) &&
        value >= spec.min(params) - 1e-6 &&
        value <= spec.max(params) + 1e-6
      );
    }) &&
    heightM >= ROOM_HEIGHT_MIN_M &&
    heightM <= ROOM_HEIGHT_MAX_M;

  /**
   * The preview is the room the button will make — not a drawing of one.
   *
   * Built by the same `createRoomSurfaceModel` that `Create the room` calls,
   * from the same parameters, and drawn by the same `RoomPlanCanvas` the Room
   * tab uses. There is no second implementation to disagree: if the preview
   * shows a six-wall L with a 2 m return, that is precisely what is created.
   *
   * `buildPreview` is separate so the picker sheet can render the SAME plan at
   * a value the wheel has not been committed to yet.
   */
  const buildPreview = useCallback(
    (overrides?: { params?: RoomShapeParams; heightM?: number }) =>
      createRoomSurfaceModel({
        outline: buildShapeOutline(preset, overrides?.params ?? params),
        wallHeight_m: overrides?.heightM ?? heightM,
      }),
    [preset, params, heightM],
  );

  // Memoised: `createRoomSurfaceModel` mints ids, so rebuilding it every render
  // would hand the canvas a new object — and a new set of surface ids — on
  // every frame while a wheel is spinning.
  const previewModel = useMemo(() => buildPreview(), [buildPreview]);

  const previewStats = useMemo(() => {
    const walls = previewModel.surfaces.filter(
      surface => surface.kind === 'wall',
    );
    const floor = previewModel.surfaces.find(
      surface => surface.kind === 'floor',
    );
    return {
      wallCount: walls.length,
      floorM2: floor ? surfaceGrossArea(floor) : 0,
      wallM2: walls.reduce((sum, wall) => sum + surfaceGrossArea(wall), 0),
    };
  }, [previewModel]);

  /** The plan edges the dimension being edited governs. */
  const highlightEdges = useMemo(() => {
    if (!activeParam) return [];
    return preset.params.find(spec => spec.key === activeParam)?.edges ?? [];
  }, [preset, activeParam]);

  /** The small plan the picker sheet shows above its wheels. */
  const renderSheetPreview = (paramKey: string) => (draftM: number) => {
    const model =
      paramKey === 'height'
        ? buildPreview({ heightM: draftM })
        : buildPreview({
            params: clampShapeParams(preset, { ...params, [paramKey]: draftM }),
          });
    const edges =
      paramKey === 'height'
        ? []
        : preset.params.find(spec => spec.key === paramKey)?.edges ?? [];
    return (
      <RoomPlanCanvas
        model={model}
        width={Math.min(260, previewWidth)}
        height={140}
        selectedSurfaceId={null}
        highlightEdges={edges}
        showAreas={false}
        lengthUnit={lengthUnit}
        colors={{
          outline: colors.textPrimary,
          fill: colors.backgroundMain,
          muted: colors.textSecondary,
          accent: colors.primary,
          background: colors.backgroundMain,
          text: colors.textPrimary,
        }}
      />
    );
  };

  return (
    <ScrollView
      {...keyboardDismissScrollProps}
      style={styles.scrollBody}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 60 + TAB_BAR_CONTENT_HEIGHT + insets.bottom },
      ]}
    >
      <Text style={[styles.h1, { color: colors.textPrimary }]}>
        Start with the room
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Pick the closest shape and enter rough sizes. You can drag the corners
        afterwards, and every wall, the floor and the ceiling appear
        automatically.
      </Text>
      {hasLegacyGeometry ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          This project has older measurements that could not be read as a room.
          Starting here replaces them.
        </Text>
      ) : null}

      <View style={styles.presetGrid}>
        {ROOM_SHAPE_PRESETS.map(option => {
          const selected = presetKey === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => changeShape(option.key)}
              style={[
                styles.preset,
                {
                  minWidth: presetMinWidth,
                  borderColor: selected ? colors.primary : colors.borderColor,
                  borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  backgroundColor: colors.card,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.label}. ${option.description}`}
              testID={`room-preset-${option.key}`}
            >
              {/* Drawn from the preset itself, so the picture cannot disagree
                  with the room the button makes. See `RoomShapeIcon`. */}
              <RoomShapeIcon
                shape={option.key}
                color={selected ? colors.primary : colors.textSecondary}
                fill={selected ? colors.primary : colors.backgroundMain}
                fillOpacity={selected ? 0.16 : 1}
                testID={`room-preset-icon-${option.key}`}
              />
              <View style={styles.presetText}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>
                  {option.label}
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 12,
                    marginTop: 3,
                  }}
                >
                  {option.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <UnitPicker
        value={lengthUnit}
        onChange={onUnitChange}
        label="Measure in"
        testID="room-unit-picker"
      />

      <View style={styles.dimGrid}>
        {preset.params.map(spec => (
          <DimField
            key={spec.key}
            label={spec.label}
            metres={params[spec.key]}
            onChange={metres => setParam(spec.key, metres)}
            onActivate={() => setActiveParam(spec.key)}
            unit={lengthUnit}
            minM={spec.min(params)}
            maxM={spec.max(params)}
            active={activeParam === spec.key}
            preview={renderSheetPreview(spec.key)}
            testID={`room-dim-${spec.key}`}
          />
        ))}
        <DimField
          label="Ceiling"
          metres={heightM}
          onChange={setHeightM}
          onActivate={() => setActiveParam('height')}
          unit={lengthUnit}
          minM={ROOM_HEIGHT_MIN_M}
          maxM={ROOM_HEIGHT_MAX_M}
          active={activeParam === 'height'}
          preview={renderSheetPreview('height')}
          testID="room-height"
        />
      </View>

      <View
        style={[
          styles.previewCard,
          { borderColor: colors.borderColor, backgroundColor: colors.card },
        ]}
        testID="room-preview"
      >
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          Preview
        </Text>
        <RoomPlanCanvas
          model={previewModel}
          width={previewWidth}
          height={Math.min(300, previewWidth * 0.68)}
          selectedSurfaceId={null}
          highlightEdges={highlightEdges}
          showAreas={false}
          lengthUnit={lengthUnit}
          colors={{
            outline: colors.textPrimary,
            fill: colors.backgroundMain,
            muted: colors.textSecondary,
            accent: colors.primary,
            background: colors.card,
            text: colors.textPrimary,
          }}
          testID="room-preview-plan"
        />
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {previewStats.wallCount} walls, a floor and a ceiling ·{' '}
          {formatSurfaceArea(previewStats.wallM2, lengthUnit)} of wall ·{' '}
          {formatSurfaceArea(previewStats.floorM2, lengthUnit)} of floor
        </Text>
      </View>

      <Pressable
        style={[
          styles.cta,
          { backgroundColor: ready ? colors.primary : colors.borderColor },
        ]}
        disabled={!ready}
        onPress={() =>
          ready &&
          onStart(presetKey, buildShapeOutline(preset, params), heightM)
        }
        testID="room-start"
      >
        <Text style={styles.ctaText}>Create the room</Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * One room dimension: a wheel by default, a keyboard on request.
 *
 * The wheel is the default because these three numbers feed every area, tile
 * count and cost in the project, and a keyboard's failure mode is a typo that
 * looks entirely reasonable — `36` for `3.6` gives a room ten times too big
 * with nothing on screen to flag it. A bounded wheel cannot produce that value.
 *
 * Manual entry stays one tap away, and stays *stuck* once chosen for that
 * field: a member who reached for it has an exact figure off a laser measure,
 * and bouncing them back to a wheel that has no row for 3.617 m after every
 * edit would be the app arguing with them. The small keypad/wheel toggle is how
 * they go back.
 */
function DimField({
  label,
  metres,
  onChange,
  onActivate,
  unit,
  minM,
  maxM,
  active = false,
  preview,
  testID,
}: {
  label: string;
  metres: number;
  onChange: (metres: number) => void;
  /** Fired the moment the field is touched, before any value changes. */
  onActivate?: () => void;
  unit: LengthUnit;
  minM: number;
  maxM: number;
  /** Outlined in the accent colour while this is the dimension being edited. */
  active?: boolean;
  /** Live plan shown inside the wheel sheet. See `LengthPickerSheetProps`. */
  preview?: (draftMetres: number) => React.ReactNode;
  testID: string;
}) {
  const colors = useAppColors();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [text, setText] = useState(() => lengthInputValue(metres, unit));

  // Re-render the manual text when the value or the unit changes underneath —
  // from the stored metres, never by re-parsing what is in the box, so the
  // picker and a unit switch cannot compound a rounding error.
  const [lastSync, setLastSync] = useState(`${metres}:${unit}`);
  if (lastSync !== `${metres}:${unit}`) {
    setLastSync(`${metres}:${unit}`);
    setText(lengthInputValue(metres, unit));
  }

  const outOfRange = metres < minM || metres > maxM;

  return (
    <View style={styles.dimField}>
      <Text
        style={[
          styles.fieldLabel,
          { color: active ? colors.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>

      {manual ? (
        <View style={styles.dimManualRow}>
          <TextInput
            value={text}
            onFocus={onActivate}
            onChangeText={next => {
              setText(next);
              const parsed = parseLength(next, unit);
              // Only a parsable value is lifted. A half-typed field must not
              // push `NaN` up and bounce a converted number back into it.
              if (parsed !== null && parsed > 0) {
                setLastSync(`${parsed}:${unit}`);
                onChange(parsed);
              }
            }}
            keyboardType={lengthKeyboardType(unit)}
            placeholder={lengthPlaceholder(unit)}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoFocus
            style={[
              styles.input,
              styles.dimManualInput,
              {
                color: colors.textPrimary,
                borderColor: outOfRange ? colors.error : colors.borderColor,
                backgroundColor: colors.card,
              },
            ]}
            testID={testID}
          />
          <Pressable
            onPress={() => setManual(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${label.toLowerCase()} on a wheel`}
            testID={`${testID}-use-picker`}
          >
            <Icon name="options-outline" size={20} color={colors.primary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            onActivate?.();
            setPickerOpen(true);
          }}
          style={[
            styles.input,
            styles.dimValue,
            {
              borderColor: outOfRange
                ? colors.error
                : active
                ? colors.primary
                : colors.borderColor,
              borderWidth: active && !outOfRange ? 2 : StyleSheet.hairlineWidth,
              backgroundColor: colors.card,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${formatLength(metres, unit)}`}
          testID={testID}
        >
          <Text style={[styles.dimValueText, { color: colors.textPrimary }]}>
            {formatLength(metres, unit)}
          </Text>
          <Icon name="chevron-down" size={16} color={colors.textSecondary} />
        </Pressable>
      )}

      <LengthPickerSheet
        visible={pickerOpen}
        title={label}
        value={metres}
        minM={minM}
        maxM={maxM}
        unit={unit}
        onConfirm={onChange}
        onClose={() => setPickerOpen(false)}
        onManualEntry={() => {
          setPickerOpen(false);
          setManual(true);
        }}
        preview={preview}
        testID={`${testID}-picker`}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Room tab
// ---------------------------------------------------------------------------

/** The wall standing on a plan edge, for its member-facing name. */
function wallForEdge(model: RoomSurfaceModel, edgeIndex: number) {
  return model.surfaces.find(
    surface => surface.kind === 'wall' && surface.planEdge === edgeIndex,
  );
}

/**
 * The room as it would be if this wall were that long — for the live plan
 * inside the wheel sheet.
 *
 * Falls back to the current room when the length is illegal (a wall dragged
 * through the opposite wall), so the preview holds its last good shape instead
 * of blanking while the member spins past it.
 */
function previewEdgeResize(
  model: RoomSurfaceModel,
  edgeIndex: number,
  metres: number,
): RoomSurfaceModel {
  const resized = resizeEdge(model.room.outline, edgeIndex, metres);
  if (!resized) return model;
  return { ...model, room: { ...model.room, outline: resized } };
}

function RoomTab({
  model,
  width,
  lengthUnit,
  onUnitChange,
  selectedSurfaceId,
  onSelectSurface,
  onOutlineChange,
  onOutlineCommit,
  onEdgeLength,
  onHeightChange,
  activeEdge,
  onActivateEdge,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  staleWallIds,
  onDeleteRoom,
}: {
  model: RoomSurfaceModel;
  width: number;
  lengthUnit: LengthUnit;
  onUnitChange: (unit: LengthUnit) => void;
  selectedSurfaceId: string | null;
  onSelectSurface: (surfaceId: string) => void;
  onOutlineChange: (outline: RoomSurfaceModel['room']['outline']) => void;
  onOutlineCommit: (outline: RoomSurfaceModel['room']['outline']) => void;
  /** Set one wall to an exact length. See `resizeEdge`. */
  onEdgeLength: (edgeIndex: number, metres: number) => void;
  onHeightChange: (height: number) => void;
  /** The wall whose length row is open — called out on the plan. */
  activeEdge: number | null;
  onActivateEdge: (edgeIndex: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  staleWallIds: string[];
  onDeleteRoom: () => void;
}) {
  const colors = useAppColors();

  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Drag a corner to change the shape. Tap a wall to open it. Nearly-square
        corners snap square, so a real room comes out square.
      </Text>

      <RoomPlanCanvas
        model={model}
        width={width}
        height={Math.min(360, width)}
        editable
        selectedSurfaceId={selectedSurfaceId}
        highlightEdges={activeEdge === null ? undefined : [activeEdge]}
        onSelectSurface={onSelectSurface}
        onOutlineChange={onOutlineChange}
        onOutlineCommit={onOutlineCommit}
        lengthUnit={lengthUnit}
        colors={{
          outline: colors.textPrimary,
          fill: colors.card,
          muted: colors.textSecondary,
          accent: colors.primary,
          background: colors.backgroundMain,
          text: colors.textPrimary,
        }}
        testID="room-plan-canvas"
      />

      <View style={styles.inlineRow}>
        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          style={[
            styles.smallBtn,
            { borderColor: colors.borderColor, opacity: canUndo ? 1 : 0.4 },
          ]}
          testID="room-undo"
        >
          <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
            Undo
          </Text>
        </Pressable>
        <Pressable
          onPress={onRedo}
          disabled={!canRedo}
          style={[
            styles.smallBtn,
            { borderColor: colors.borderColor, opacity: canRedo ? 1 : 0.4 },
          ]}
          testID="room-redo"
        >
          <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
            Redo
          </Text>
        </Pressable>
      </View>

      <UnitPicker
        value={lengthUnit}
        onChange={onUnitChange}
        label="Measure in"
        testID="room-tab-unit-picker"
      />

      {/*
        Every wall, editable by number.
        
        Dragging a corner cannot produce 3.62 m, and 3.62 m is what a member
        measured — every area, tile count and cost in the project is derived
        from these lengths, so they have to be typeable. The row highlights its
        wall on the plan above while it is open, and the wheel carries the same
        plan so the highlight is still visible once the sheet covers it.
      */}
      <Text style={[styles.h2, { color: colors.textPrimary }]}>
        Wall lengths
      </Text>
      <View style={styles.dimGrid}>
        {model.room.outline.map((point, index) => {
          const next =
            model.room.outline[(index + 1) % model.room.outline.length];
          const wall = wallForEdge(model, index);
          return (
            <DimField
              key={`edge-${index}`}
              label={wall?.label ?? `Wall ${index + 1}`}
              metres={Math.hypot(next[0] - point[0], next[1] - point[1])}
              onChange={metres => onEdgeLength(index, metres)}
              onActivate={() => onActivateEdge(index)}
              unit={lengthUnit}
              minM={0.2}
              maxM={30}
              active={activeEdge === index}
              preview={draft => (
                <RoomPlanCanvas
                  model={previewEdgeResize(model, index, draft)}
                  width={260}
                  height={150}
                  selectedSurfaceId={null}
                  highlightEdges={[index]}
                  showAreas={false}
                  lengthUnit={lengthUnit}
                  colors={{
                    outline: colors.textPrimary,
                    fill: colors.backgroundMain,
                    muted: colors.textSecondary,
                    accent: colors.primary,
                    background: colors.backgroundMain,
                    text: colors.textPrimary,
                  }}
                />
              )}
              testID={`room-edge-${index}`}
            />
          );
        })}
      </View>

      {/* The same field the starter uses, so the ceiling is edited one way in
          both places — and every wall in the room is re-derived from it. */}
      <View style={styles.dimRow}>
        <DimField
          label="Ceiling height"
          metres={model.room.wallHeight_m}
          onChange={onHeightChange}
          unit={lengthUnit}
          minM={ROOM_HEIGHT_MIN_M}
          maxM={ROOM_HEIGHT_MAX_M}
          testID="room-wall-height"
        />
      </View>

      {staleWallIds.length > 0 ? (
        <Text style={[styles.body, { color: colors.warning }]}>
          {staleWallIds.length} wall
          {staleWallIds.length === 1 ? ' has' : 's have'} a shape you edited by
          hand, so it was left alone when the plan changed. Open it to re-fit.
        </Text>
      ) : null}

      <Pressable
        onPress={onDeleteRoom}
        style={[styles.dangerBtn, { borderColor: colors.error }]}
        testID="room-delete"
      >
        <Text style={{ color: colors.error, fontWeight: '600' }}>
          Delete this room layout
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Surfaces tab
// ---------------------------------------------------------------------------

function SurfacesTab({
  model,
  surface,
  width,
  lengthUnit,
  canvasRef,
  previewSlot,
  textureUris,
  selectedRegionId,
  staleWallIds,
  projectMaterialCount,
  onApplyProjectMaterial,
  onSelectSurface,
  onSelectRegion,
  onSplit,
  onAddArea,
  onOpenMaterial,
  onRemoveRegion,
  onRenameRegion,
  onAddOpening,
  onEditOpening,
  onToggleExcluded,
  onRelabelSurface,
  onRederiveSurface,
}: {
  model: RoomSurfaceModel;
  surface: Surface | null;
  width: number;
  lengthUnit: ReturnType<typeof lengthUnitFor>;
  canvasRef: React.Ref<SurfaceCanvasHandle>;
  /** The photo-preview panel, composed by the screen and rendered here. */
  previewSlot: React.ReactNode;
  textureUris: Record<string, string | undefined>;
  selectedRegionId: string | null;
  staleWallIds: string[];
  /** How many materials the project already holds. 0 hides the shortcut. */
  projectMaterialCount: number;
  onApplyProjectMaterial: (regionId: string | null) => void;
  onSelectSurface: (id: string) => void;
  onSelectRegion: (id: string | null) => void;
  onSplit: (axis: SplitAxis, regionId?: string) => void;
  onAddArea: () => void;
  onOpenMaterial: (regionId: string | null) => void;
  onRemoveRegion: (regionId: string) => void;
  onRenameRegion: (regionId: string, label: string) => void;
  onAddOpening: () => void;
  onEditOpening: (opening: Opening) => void;
  onToggleExcluded: () => void;
  onRelabelSurface: (label: string) => void;
  onRederiveSurface: () => void;
}) {
  const colors = useAppColors();
  // Side by side once there is room for both to stay legible; stacked below
  // that, since a 130-point-wide plan is a smudge rather than an answer.
  const sideBySide = width >= 620;
  const planWidth = sideBySide ? Math.round(width * 0.34) : width;
  const elevationWidth = sideBySide ? Math.round(width * 0.62) : width;
  const regions = surface ? regionsOf(surface) : [];
  const materialsById = new Map(
    model.materials.map(material => [material.id, material]),
  );

  return (
    <View style={{ gap: 12 }}>
      <SurfaceStrip
        surfaces={model.surfaces}
        materials={model.materials}
        textureUris={textureUris}
        selectedSurfaceId={surface?.id ?? null}
        onSelect={onSelectSurface}
        lengthUnit={lengthUnit}
        staleSurfaceIds={staleWallIds}
        testID="surface-strip"
      />

      {!surface ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Pick a surface above.
        </Text>
      ) : (
        <>
          <SurfaceTitle
            surface={surface}
            lengthUnit={lengthUnit}
            onRelabel={onRelabelSurface}
            onToggleExcluded={onToggleExcluded}
          />

          {/*
            The plan and the surface, together.
            
            An elevation on its own is an anonymous rectangle — the screenshot
            that prompted this showed a 5 × 8 box with no way to tell which of
            four identical walls it was. The plan beside it answers "which one",
            and `RoomPlanCanvas` picks the mark that means something on a plan:
            a wall IS an edge, so it lights the line; a floor or ceiling IS the
            enclosed region, so it tints the area.
            
            Tapping a wall on the plan selects it, which is the same gesture as
            the Room tab and faster than scrolling the strip.
          */}
          <View style={sideBySide ? styles.drawingRow : undefined}>
            <View style={sideBySide ? styles.planColumn : undefined}>
              <Text style={[styles.caption, { color: colors.textSecondary }]}>
                Where it is
              </Text>
              <RoomPlanCanvas
                model={model}
                width={planWidth}
                height={Math.min(240, planWidth)}
                selectedSurfaceId={surface.id}
                onSelectSurface={onSelectSurface}
                showAreas={false}
                lengthUnit={lengthUnit}
                colors={{
                  outline: colors.textPrimary,
                  fill: colors.card,
                  muted: colors.textSecondary,
                  accent: colors.primary,
                  background: colors.backgroundMain,
                  text: colors.textPrimary,
                }}
                testID="surface-locator-plan"
              />
            </View>

            <View style={sideBySide ? styles.elevationColumn : undefined}>
              <Text style={[styles.caption, { color: colors.textSecondary }]}>
                {surface.kind === 'wall' ? 'The wall, flattened' : 'Seen flat'}
              </Text>
              <SurfaceCanvas
                ref={canvasRef}
                surface={surface}
                materials={model.materials}
                textureUris={textureUris}
                width={elevationWidth}
                height={Math.min(300, elevationWidth * 0.75)}
                selectedRegionId={selectedRegionId}
                onSelectRegion={onSelectRegion}
                showDimensions
                showRegionLabels={surface.subAreas.length > 0}
                lengthUnit={lengthUnit}
                backgroundColor={colors.backgroundMain}
                outlineColor={colors.textPrimary}
                mutedColor={colors.textSecondary}
                accentColor={colors.primary}
                testID="surface-canvas"
              />
            </View>
          </View>

          <View style={styles.toolRow}>
            <Tool
              label="Split across"
              onPress={() =>
                onSplit('horizontal', selectedRegionId ?? undefined)
              }
              testID="tool-split-h"
            />
            <Tool
              label="Split down"
              onPress={() => onSplit('vertical', selectedRegionId ?? undefined)}
              testID="tool-split-v"
            />
            <Tool label="Add area" onPress={onAddArea} testID="tool-add-area" />
            <Tool
              label="Add opening"
              onPress={onAddOpening}
              testID="tool-add-opening"
            />
            {surface.outlineLocked ? (
              <Tool
                label="Re-fit to plan"
                onPress={onRederiveSurface}
                testID="tool-refit"
              />
            ) : null}
            {/*
              Beside the other tools, but last and next to the finishes list it
              acts on. Hidden entirely when the project has nothing imported —
              a shortcut to an empty list is worse than no shortcut, and the
              manual "+ Paint" row in the sheet remains the way in.
            */}
            {projectMaterialCount > 0 ? (
              <Tool
                label={`Use a project material (${projectMaterialCount})`}
                onPress={() => onApplyProjectMaterial(selectedRegionId)}
                testID="surface-apply-material"
              />
            ) : null}
          </View>

          <Text style={[styles.h2, { color: colors.textPrimary }]}>
            Areas &amp; finishes
          </Text>
          {regions.map(region => {
            const material = region.materialId
              ? materialsById.get(region.materialId)
              : undefined;
            const selected = region.subAreaId === selectedRegionId;
            return (
              <View
                key={region.subAreaId ?? 'base'}
                style={[
                  styles.regionRow,
                  {
                    borderColor: selected ? colors.primary : colors.borderColor,
                    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                    backgroundColor: colors.card,
                  },
                ]}
                testID={`region-row-${region.subAreaId ?? 'base'}`}
              >
                <Pressable
                  style={styles.regionMain}
                  onPress={() => onSelectRegion(region.subAreaId)}
                >
                  {material ? (
                    <SwatchPreview
                      material={material}
                      textureUri={
                        material.textureAttachmentId
                          ? textureUris[material.textureAttachmentId]
                          : undefined
                      }
                      width={REGION_SWATCH_WIDTH}
                      height={REGION_SWATCH_HEIGHT}
                      showScaleNote={false}
                    />
                  ) : (
                    <View
                      style={[
                        styles.emptySwatch,
                        { borderColor: colors.borderColor },
                      ]}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    {region.subAreaId ? (
                      <TextInput
                        value={region.label}
                        onChangeText={label =>
                          onRenameRegion(region.subAreaId!, label)
                        }
                        style={[
                          styles.regionLabelInput,
                          { color: colors.textPrimary },
                        ]}
                        testID={`region-label-${region.subAreaId}`}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.regionLabel,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {region.label}
                      </Text>
                    )}
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                      {formatSurfaceArea(region.netM2, lengthUnit)}
                      {region.openings.length > 0
                        ? ` · ${region.openings.length} opening${
                            region.openings.length === 1 ? '' : 's'
                          } deducted`
                        : ''}
                    </Text>
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {material ? material.name : 'No finish yet'}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.regionActions}>
                  {/*
                    A filled pill, not a text link.
                    
                    This is the primary action on the row — it is how a finish
                    gets chosen at all, and the whole takeoff is empty until it
                    is used — but it read as the least important thing there,
                    sitting in the same weight and colour as "Split" and
                    "Remove". Given a solid ground it is the first thing the eye
                    lands on, which is what it should have been.
                  */}
                  <Pressable
                    onPress={() => onOpenMaterial(region.subAreaId)}
                    hitSlop={8}
                    style={[
                      styles.regionPrimaryBtn,
                      { backgroundColor: colors.primary },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit the finish for ${region.label}`}
                    testID={`region-material-${region.subAreaId ?? 'base'}`}
                  >
                    <Text style={styles.regionPrimaryBtnText}>Edit</Text>
                  </Pressable>
                  {region.subAreaId ? (
                    <View style={styles.regionSecondaryActions}>
                      <Pressable
                        onPress={() => onSplit('horizontal', region.subAreaId!)}
                        hitSlop={8}
                        testID={`region-split-${region.subAreaId}`}
                      >
                        <Text
                          style={{
                            color: colors.primary,
                            fontWeight: '600',
                            fontSize: 13,
                          }}
                        >
                          Split
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onRemoveRegion(region.subAreaId!)}
                        hitSlop={8}
                        testID={`region-remove-${region.subAreaId}`}
                      >
                        <Text
                          style={{
                            color: colors.error,
                            fontWeight: '600',
                            fontSize: 13,
                          }}
                        >
                          Remove
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}

          {surface.openings.length > 0 ? (
            <>
              <Text style={[styles.h2, { color: colors.textPrimary }]}>
                Openings
              </Text>
              {surface.openings.map(opening => (
                <Pressable
                  key={opening.id}
                  onPress={() => onEditOpening(opening)}
                  style={[
                    styles.openingRow,
                    {
                      borderColor: colors.borderColor,
                      backgroundColor: colors.card,
                    },
                  ]}
                  testID={`opening-row-${opening.id}`}
                >
                  <Text
                    style={{ color: colors.textPrimary, fontWeight: '600' }}
                  >
                    {opening.label ?? capitalise(opening.type)}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                    {formatLength(opening.width, lengthUnit)} ×{' '}
                    {formatLength(opening.height, lengthUnit)}
                    {opening.deducts ? ' · deducted' : ' · finished inside'}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}

          {previewSlot}
        </>
      )}
    </View>
  );
}

function SurfaceTitle({
  surface,
  lengthUnit,
  onRelabel,
  onToggleExcluded,
}: {
  surface: Surface;
  lengthUnit: ReturnType<typeof lengthUnitFor>;
  onRelabel: (label: string) => void;
  onToggleExcluded: () => void;
}) {
  const colors = useAppColors();
  const regions = regionsOf(surface);
  const net = regions.reduce((sum, region) => sum + region.netM2, 0);
  return (
    <View style={styles.titleRow}>
      <View style={{ flex: 1 }}>
        <TextInput
          value={surface.label}
          onChangeText={onRelabel}
          style={[styles.surfaceTitle, { color: colors.textPrimary }]}
          testID="surface-label"
        />
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {formatSurfaceArea(net, lengthUnit)} to finish
          {surface.subAreas.length > 0
            ? ` · ${surface.subAreas.length + 1} areas`
            : ''}
        </Text>
      </View>
      <Pressable
        onPress={onToggleExcluded}
        style={[styles.smallBtn, { borderColor: colors.borderColor }]}
        testID="surface-toggle-excluded"
      >
        <Text
          style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 13 }}
        >
          {surface.excluded ? 'Include' : 'Not in scope'}
        </Text>
      </Pressable>
    </View>
  );
}

function Tool({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tool,
        { borderColor: colors.borderColor, backgroundColor: colors.card },
      ]}
      testID={testID}
    >
      <Text
        style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 13 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /** The scroller itself must fill its column; `content` sizes what is inside. */
  scrollBody: { flex: 1 },
  content: { padding: 16, paddingBottom: 60, gap: 12 },
  tabs: { maxHeight: 46, flexGrow: 0 },
  tabsContent: { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  tab: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  h1: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 16, fontWeight: '700', marginTop: 6 },
  body: { fontSize: 13, lineHeight: 19 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  preset: {
    borderRadius: 12,
    padding: 12,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  presetText: { flex: 1 },
  dimRow: { flexDirection: 'row', gap: 10 },
  // Wraps, because a rectangle needs three fields and a T needs five.
  dimGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dimField: { flexGrow: 1, flexBasis: 140 },
  dimValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  dimValueText: { fontSize: 16, fontWeight: '600' },
  dimManualRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dimManualInput: { flex: 1 },
  fieldLabel: { fontSize: 12, marginBottom: 4, fontWeight: '600' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  previewCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  cta: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  statusText: { color: '#fff', fontSize: 12, flexShrink: 1 },
  statusAction: { fontWeight: '700', textDecorationLine: 'underline' },
  inlineRow: { flexDirection: 'row', gap: 8 },
  smallBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  drawingRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  planColumn: { flexShrink: 0 },
  elevationColumn: { flexShrink: 0 },
  caption: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  tool: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  surfaceTitle: {
    fontSize: 18,
    fontWeight: '700',
    padding: 0,
    marginBottom: 2,
  },
  /**
   * One row: swatch, text, actions — all vertically centred.
   *
   * The actions used to be a second line under the whole row, which left the
   * Edit pill floating at the bottom-right corner of a tall card with nothing
   * beside it. Putting them in the row aligns the primary action with the
   * thing it acts on.
   */
  regionRow: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  regionMain: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' },
  regionLabel: { fontSize: 15, fontWeight: '700' },
  regionLabelInput: { fontSize: 15, fontWeight: '700', padding: 0 },
  regionActions: { alignItems: 'flex-end', gap: 8 },
  regionSecondaryActions: { flexDirection: 'row', gap: 16 },
  regionPrimaryBtn: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  regionPrimaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emptySwatch: {
    width: REGION_SWATCH_WIDTH,
    height: REGION_SWATCH_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  dangerBtn: {
    marginTop: 16,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
  },
  openingRow: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 2,
  },
});
