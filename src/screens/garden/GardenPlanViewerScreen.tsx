import type { GardenPlanObject } from '@models/garden-objects';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from 'expo-router/react-navigation';
import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { Alert, StyleSheet, View, TouchableOpacity, TextInput, FlatList, Keyboard, Modal, Pressable } from 'react-native';
import type { Camera } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FloorPlanMarker } from '@api/floor-plans';
import {
  gardenPlansApi,
  GardenPlanMarker,
  GardenPlan,
  gardenPlanDisplayLabel,
} from '@api/garden-plans';
import type { Task } from '@api/tasks';
import { HeaderActionButton, ScreenHeader } from '@components/common';
import type { PendingMarker } from '@components/floor-plans';
import {
  canRenderGardenSatellite,
  GardenEditSaveBar,
  GardenPlanUnifiedViewer,
  GardenPlanVectorEditor,
  type GardenPlanEditMode,
  type GardenPlanUnifiedViewerHandle,
} from '@components/garden';
import { AddTaskOptionsBottomSheet } from '@components/tasks/AddTaskOptionsBottomSheet';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { ENV } from '@config/env';
import { useHouseLedgerTables } from '@features/house/local/useHouseLedgerTables';
import { useBoundaryEditor } from '@hooks/garden/useBoundaryEditor';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { GardeningStackParamList } from '@navigation/types';
import { navigateAfterInteractions } from '@services/nav-when-ready';
import {
  navigateToTask,
  navigateToScheduleTask,
  navigateToCopyFromExistingTasks,
  navigateToTaskTemplates,
} from '@services/navigation';
import { showToast } from '@services/toastManager';
import { useGardenPlanStore } from '@stores/gardenPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { ButtonMetrics, Header, scaledFont, useAppColors } from '@theme';
import { palette } from '@theme/colors';

type Nav = NativeStackNavigationProp<GardeningStackParamList, 'GardenPlanViewer'>;
type RouteT = RouteProp<GardeningStackParamList, 'GardenPlanViewer'>;
const MAIN_ACTION_COLOR = palette.button.teal;

// FloorPlanViewer expects FloorPlanMarker; garden markers are shape-compatible
// except for the parent id field. Adapt at render time (the viewer only reads
// id / x_percent / y_percent / marker_icon / marker_color / label).
function toFloorPlanMarker(m: GardenPlanMarker): FloorPlanMarker {
  return {
    id: m.id,
    floor_plan_id: m.garden_plan_id,
    x_percent: m.x_percent,
    y_percent: m.y_percent,
    linked_entity_type: m.linked_entity_type,
    linked_entity_id: m.linked_entity_id,
    marker_type: 'pin',
    marker_color: m.marker_color,
    marker_icon: m.marker_icon,
    label: m.label,
    show_label: m.show_label,
    space_id: m.space_id,
    created_by: m.created_by,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

interface TappedLocation {
  xPercent: number;
  yPercent: number;
}

export function GardenPlanViewerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const gardenPlanId = route.params?.gardenPlanId;
  const didInitialFocusRef = useRef(false);

  useEffect(() => {
    didInitialFocusRef.current = false;
  }, [gardenPlanId]);
  const insets = useSafeAreaInsets();  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const {
    setCurrentGardenPlan,
    markers,
    setMarkers,
    isLoading,
    setLoading,
  } = useGardenPlanStore();
  const { maintenanceTasks } = useTaskStore();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [plan, setPlan] = useState<GardenPlan | null>(null);
  const [vectorObjects, setVectorObjects] = useState<GardenPlanObject[]>([]);
  const [showEditChooser, setShowEditChooser] = useState(false);
  const [showNameEditor, setShowNameEditor] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  // The "Edit name" card lives in a raw `Modal` and autofocuses its field, so
  // the keyboard is already up when it appears — centred on the FULL screen it
  // landed behind the keypad along with Cancel/Save. Padding the centring layer
  // re-centres the card in what is left above it (see `@hooks/useKeyboardInset`).
  const keyboardInset = useKeyboardInset();

  const [showActionSheet, setShowActionSheet] = useState(false);
  const [tappedLocation, setTappedLocation] = useState<TappedLocation | null>(null);
  const [pendingMarker, setPendingMarker] = useState<PendingMarker | null>(null);
  const [showAddTaskOptions, setShowAddTaskOptions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const [selectedMarker, setSelectedMarker] = useState<GardenPlanMarker | null>(null);
  const [showMarkerActionSheet, setShowMarkerActionSheet] = useState(false);
  const [isDeletingMarker, setIsDeletingMarker] = useState(false);
  const markerPressedRef = useRef(false);

  const [showSatellite, setShowSatellite] = useState(true);
  const [polygonOpacity, setPolygonOpacity] = useState(0.45);
  const [mapOpacity, setMapOpacity] = useState(1);
  const [showSatelliteSettings, setShowSatelliteSettings] = useState(false);
  const [editMode, setEditMode] = useState<GardenPlanEditMode>('none');
  const unifiedViewerRef = useRef<GardenPlanUnifiedViewerHandle | null>(null);
  const loadDataRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);

  // Object-edit-mode draft state. The editor is mounted inline on top of the
  // shared viewer surface so users move between view → edit objects → view
  // without any navigation transition (and the satellite camera is preserved).
  const [objectDraft, setObjectDraft] = useState<GardenPlanObject[]>([]);
  const [objectsSaving, setObjectsSaving] = useState(false);
  const [objectsEditCamera, setObjectsEditCamera] = useState<Camera | undefined>(undefined);

  const boundaryEditor = useBoundaryEditor({
    plan,
    household: currentHousehold,
    gardenPlanId,
  });

  const canShowSatellite = useMemo(
    () => canRenderGardenSatellite(plan?.boundary_geojson ?? null),
    [plan?.boundary_geojson],
  );

  /**
   * Is there anything to draw?
   *
   * A plan's picture is EITHER an uploaded image or satellite tiles behind a
   * traced boundary — a map-drawn plan has no bytes at all, so `imageUrl` stays
   * null for it forever. Three separate gates in this screen tested `imageUrl`
   * alone and each one silently withheld a working plan: the canvas showed a
   * spinner, and the header dropped BOTH the Edit action and the satellite
   * toggle, which left a saved plan visible but impossible to edit.
   *
   * One predicate, used by every gate, so the next one cannot drift.
   */
  const hasPlanSurface = Boolean(imageUrl) || canShowSatellite;
  useEffect(() => {
    setShowSatellite(true);
    setShowSatelliteSettings(false);
    setEditMode('none');
  }, [gardenPlanId]);
  useEffect(() => {
    if (plan && !canShowSatellite && showSatellite) setShowSatellite(false);
  }, [canShowSatellite, plan, showSatellite]);
  const openObjectEditor = useCallback(() => {
    setShowEditChooser(true);
  }, []);

  const openBoundaryEditor = useCallback(() => {
    if (!gardenPlanId || !canShowSatellite) return;
    setShowEditChooser(false);
    setShowSatelliteSettings(false);
    if (!showSatellite) setShowSatellite(true);
    setEditMode('boundary');
  }, [canShowSatellite, gardenPlanId, showSatellite]);

  const openObjectsFromChooser = useCallback(() => {
    if (!gardenPlanId) return;
    setShowEditChooser(false);
    setShowSatelliteSettings(false);
    if (!showSatellite) setShowSatellite(true);
    setObjectDraft(vectorObjects.map((o) => ({ ...o })));
    void (async () => {
      const camera = await unifiedViewerRef.current?.getCamera();
      setObjectsEditCamera(camera ?? undefined);
      setEditMode('objects');
    })();
  }, [gardenPlanId, showSatellite, vectorObjects]);

  const exitBoundaryEdit = useCallback(() => {
    boundaryEditor.reset();
    setEditMode('none');
  }, [boundaryEditor]);

  const handleBoundarySave = useCallback(async () => {
    const ok = await boundaryEditor.save();
    if (ok) {
      setEditMode('none');
      void loadDataRef.current?.(true);
    }
  }, [boundaryEditor]);

  const objectsHasChanges = useMemo(() => {
    if (objectDraft.length !== vectorObjects.length) return true;
    const baseline = new Map(vectorObjects.map((o) => [o.id, o]));
    return objectDraft.some((next) => {
      const prev = baseline.get(next.id);
      if (!prev) return true;
      return (
        prev.x !== next.x ||
        prev.y !== next.y ||
        prev.width !== next.width ||
        prev.height !== next.height ||
        prev.rotation !== next.rotation ||
        prev.color !== next.color ||
        prev.label !== next.label ||
        prev.type !== next.type ||
        JSON.stringify(prev.metadata ?? null) !== JSON.stringify(next.metadata ?? null)
      );
    });
  }, [objectDraft, vectorObjects]);

  const exitObjectsEdit = useCallback(() => {
    setObjectDraft([]);
    setObjectsEditCamera(undefined);
    setEditMode('none');
  }, []);

  const handleObjectsSave = useCallback(async () => {
    if (!currentHousehold || !gardenPlanId) return;
    if (!objectsHasChanges) {
      exitObjectsEdit();
      return;
    }
    setObjectsSaving(true);
    try {
      const response = await gardenPlansApi.replaceObjects(
        currentHousehold.id,
        gardenPlanId,
        objectDraft,
      );
      setVectorObjects(response.objects);
      showToast('success', 'Garden plan objects saved');
      exitObjectsEdit();
    } catch (error) {
      console.error('Failed to save garden plan objects:', error);
      showToast('error', 'Failed to save garden objects');
    } finally {
      setObjectsSaving(false);
    }
  }, [currentHousehold, exitObjectsEdit, gardenPlanId, objectDraft, objectsHasChanges]);

  const handleObjectsCancel = useCallback(() => {
    if (!objectsHasChanges) {
      exitObjectsEdit();
      return;
    }
    Alert.alert(
      'Discard changes?',
      'Your unsaved object edits will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: exitObjectsEdit,
        },
      ],
      { cancelable: true },
    );
  }, [exitObjectsEdit, objectsHasChanges]);

  const openNameEditor = useCallback(() => {
    if (!plan) return;
    setNameDraft(gardenPlanDisplayLabel(plan));
    setShowEditChooser(false);
    setShowNameEditor(true);
  }, [plan]);

  const loadData = useCallback(
    async (silent = false) => {
      if (!currentHousehold || !gardenPlanId) return;
      try {
        if (!silent) setLoading(true);
        const res = await gardenPlansApi.get(currentHousehold.id, gardenPlanId);
        setPlan(res.garden_plan);
        setCurrentGardenPlan(res.garden_plan);

        const markersRes = await gardenPlansApi.listMarkers(currentHousehold.id, gardenPlanId);
        setMarkers(markersRes.markers);
        const objectsRes = await gardenPlansApi.listObjects(currentHousehold.id, gardenPlanId);
        setVectorObjects(objectsRes.objects);

        if (res.garden_plan.display_image_key) {
          setImageUrl(`${ENV.API_BASE_URL}/files/${res.garden_plan.display_image_key}`);
        }
      } catch (error: any) {
        console.error('Failed to load yard plan:', error);
        const msg = error?.response?.data?.error || error?.message || 'Unknown error';
        showToast('error', `Failed to load: ${msg}`);
        if (!silent) navigation.goBack();
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [currentHousehold, gardenPlanId, setCurrentGardenPlan, setMarkers, setLoading, navigation]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      if (!gardenPlanId || !currentHousehold) return;
      if (!didInitialFocusRef.current) {
        didInitialFocusRef.current = true;
        return;
      }
      void loadData(true);
    }, [gardenPlanId, currentHousehold, loadData])
  );

  /**
   * Repaint when the member's OTHER device edits THIS plan.
   *
   * `enabled` is the load-bearing half. A silent reload replaces `plan`,
   * `vectorObjects` and `markers` with the stored rows — which is exactly right
   * while the member is looking, and destructive while they are EDITING:
   * `objectDraft` and the boundary editor's `corners` are unsaved work held in
   * component state, and a peer writing an unrelated marker would wipe them
   * with nothing on screen to explain where the changes went.
   *
   * So live refresh runs only in view mode. Edits made on the other device while
   * this one is mid-edit are picked up on save/exit, when `editMode` returns to
   * `none` and the reload is safe again.
   */
  useHouseLedgerTables(
    ['gardenPlans', 'gardenPlanObjects', 'gardenPlanMarkers'],
    () => {
      if (!gardenPlanId || !currentHousehold) return;
      void loadData(true);
    },
    {
      householdId: currentHousehold?.id ?? null,
      enabled: editMode === 'none' && !showEditChooser && !showNameEditor,
    },
  );

  // Guard against navigating away (back button, swipe) while the user has
  // unsaved boundary or object edits. Prompts to discard or keep editing.
  useEffect(() => {
    const boundaryDirty = editMode === 'boundary' && boundaryEditor.hasChanges;
    const objectsDirty = editMode === 'objects' && objectsHasChanges;
    if (!boundaryDirty && !objectsDirty) return;
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      const message = boundaryDirty
        ? 'Your unsaved boundary edits will be lost.'
        : 'Your unsaved object edits will be lost.';
      Alert.alert(
        'Discard changes?',
        message,
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              if (boundaryDirty) {
                boundaryEditor.reset();
              } else {
                setObjectDraft([]);
                setObjectsEditCamera(undefined);
              }
              setEditMode('none');
              navigation.dispatch(event.data.action);
            },
          },
        ],
        { cancelable: true },
      );
    });
    return unsubscribe;
  }, [boundaryEditor, editMode, navigation, objectsHasChanges]);

  const filteredTasks = useMemo(() => {
    const active = maintenanceTasks.filter((t) => t.is_active);
    if (!searchQuery.trim()) return active;
    const q = searchQuery.toLowerCase();
    return active.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || t.system_category?.toLowerCase().includes(q)
    );
  }, [maintenanceTasks, searchQuery]);

  const taskCategories = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const task of maintenanceTasks) {
      map[task.id] = task.system_category ?? null;
    }
    return map;
  }, [maintenanceTasks]);

  const handlePlanPress = useCallback(
    (x: number, y: number, xPercent: number, yPercent: number) => {
      if (markerPressedRef.current) return;
      setTimeout(() => {
        if (markerPressedRef.current) return;
        setPendingMarker({ x, y, xPercent, yPercent });
        setTappedLocation({ xPercent, yPercent });
        setShowAddTaskOptions(true);
        setShowActionSheet(false);
        setSearchQuery('');
      }, 50);
    },
    []
  );
  const handleBoundaryLongPress = useCallback(() => {
    if (!plan?.boundary_draft_id) {
      showToast('info', 'Boundary draft is unavailable for editing');
      return;
    }
    navigation.navigate('GardenPlanBoundaryConfirm', { draftId: plan.boundary_draft_id });
  }, [navigation, plan?.boundary_draft_id]);

  const handleMarkerPress = useCallback((fpMarker: FloorPlanMarker) => {
    markerPressedRef.current = true;
    setPendingMarker(null);
    const garden = markers.find((m) => m.id === fpMarker.id);
    if (garden) {
      setSelectedMarker(garden);
      setShowMarkerActionSheet(true);
    }
    setTimeout(() => {
      markerPressedRef.current = false;
    }, 100);
  }, [markers]);

  const handleCreateNewTask = useCallback(() => {
    setShowAddTaskOptions(false);
    setShowActionSheet(false);
    setPendingMarker(null);
    navigateToScheduleTask();
  }, []);

  const handleCopyExistingTask = useCallback(() => {
    setShowAddTaskOptions(false);
    setShowActionSheet(false);
    setPendingMarker(null);
    navigateToCopyFromExistingTasks();
  }, []);

  const handleAddFromTemplates = useCallback(() => {
    setShowAddTaskOptions(false);
    setShowActionSheet(false);
    setPendingMarker(null);
    navigateToTaskTemplates();
  }, []);

  const handleOpenLinkExistingFromOptions = useCallback(() => {
    setShowAddTaskOptions(false);
    setShowActionSheet(true);
  }, []);

  const handleLinkExistingTask = useCallback(
    async (task: Task) => {
      if (!tappedLocation || !currentHousehold || !gardenPlanId) return;
      setShowActionSheet(false);
      try {
        const response = await gardenPlansApi.createMarker(currentHousehold.id, gardenPlanId, {
          x_percent: Math.round(tappedLocation.xPercent * 100),
          y_percent: Math.round(tappedLocation.yPercent * 100),
          label: task.title,
          linked_entity_type: 'task',
          linked_entity_id: task.id,
        });
        setMarkers((prev) => [...prev, response.marker]);
        setPendingMarker(null);
        showToast('success', `Linked "${task.title}" to yard plan`);
      } catch (error: any) {
        console.error('Failed to link task:', error);
        showToast('error', 'Failed to link task to yard plan');
        setPendingMarker(null);
      }
    },
    [tappedLocation, currentHousehold, gardenPlanId, setMarkers]
  );

  const handleViewTask = useCallback(() => {
    if (!selectedMarker) return;
    const taskId = selectedMarker.linked_entity_id;
    setShowMarkerActionSheet(false);
    setSelectedMarker(null);
    if (selectedMarker.linked_entity_type === 'task') {
      navigateAfterInteractions(() => navigateToTask(taskId));
    }
  }, [selectedMarker]);

  const handleDeleteMarker = useCallback(async () => {
    if (!selectedMarker || !currentHousehold) return;
    const markerId = selectedMarker.id;
    setIsDeletingMarker(true);
    try {
      await gardenPlansApi.deleteMarker(currentHousehold.id, markerId);
      setMarkers((prev) => prev.filter((m) => m.id !== markerId));
      showToast('success', 'Pin removed');
    } catch (error) {
      console.error('Failed to delete marker:', error);
      showToast('error', 'Failed to remove pin');
    } finally {
      setIsDeletingMarker(false);
      setShowMarkerActionSheet(false);
      setSelectedMarker(null);
    }
  }, [selectedMarker, currentHousehold, setMarkers]);

  const handleSaveName = useCallback(async () => {
    const nextName = nameDraft.trim();
    if (!currentHousehold || !gardenPlanId || !plan || !nextName) {
      if (!nextName) showToast('error', 'Enter a plan name');
      return;
    }

    setIsSavingName(true);
    try {
      const response = await gardenPlansApi.update(currentHousehold.id, gardenPlanId, {
        label: nextName,
      });
      setPlan(response.garden_plan);
      setCurrentGardenPlan(response.garden_plan);
      setShowNameEditor(false);
      showToast('success', 'Plan name updated');
    } catch (error) {
      console.error('Failed to update garden plan name:', error);
      showToast('error', 'Failed to update plan name');
    } finally {
      setIsSavingName(false);
    }
  }, [currentHousehold, gardenPlanId, nameDraft, plan, setCurrentGardenPlan]);

  const headerTitle = plan ? gardenPlanDisplayLabel(plan) : 'Yard plan';

  const renderTaskItem = ({ item }: { item: Task }) => (
    <TouchableOpacity
      style={styles.taskItem}
      onPress={() => handleLinkExistingTask(item)}
      activeOpacity={0.7}
    >
      <View style={styles.taskItemText}>
        <Typography variant="body" weight="medium">
          {item.title}
        </Typography>
        <Typography variant="caption1" color="textSecondary">
          {item.system_category || 'General'}
        </Typography>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.backgroundMain }]}>
      <View style={styles.container} testID="garden-plan-viewer-screen">
        {/* A map-drawn plan has NO image — `display_image_key` is null and
            `imageUrl` never resolves — so gating the viewer on `imageUrl` alone
            left it spinning forever on a plan that had loaded perfectly well.
            What the viewer actually needs is SOMETHING to draw: an uploaded
            picture, or a boundary it can put satellite tiles behind. */}
        {isLoading || !hasPlanSurface ? (
          <View style={styles.loading} testID="garden-plan-viewer-loading">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <GardenPlanUnifiedViewer
            ref={unifiedViewerRef}
            mode={showSatellite ? 'satellite' : 'plan'}
            imageUrl={imageUrl}
            imageWidth={plan?.width_px ?? undefined}
            imageHeight={plan?.height_px ?? undefined}
            markers={markers.map(toFloorPlanMarker)}
            gardenObjects={vectorObjects}
            boundaryGeoJson={plan?.boundary_geojson ?? null}
            showBackgroundImage={vectorObjects.length === 0 && !plan?.boundary_geojson}
            pendingMarker={pendingMarker}
            taskCategories={taskCategories}
            onMarkerPress={handleMarkerPress}
            onPlanPress={handlePlanPress}
            onBoundaryLongPress={handleBoundaryLongPress}
            controlsTopInset={insets.top + 56}
            bottomInset={editMode === 'boundary' ? insets.bottom + 72 : insets.bottom}
            mapOpacity={mapOpacity}
            polygonOpacity={polygonOpacity}
            showSatelliteSettings={showSatelliteSettings}
            onMapOpacityChange={setMapOpacity}
            onPolygonOpacityChange={setPolygonOpacity}
            onToggleSatelliteSettings={() => setShowSatelliteSettings((v) => !v)}
            editMode={editMode}
            boundaryEditor={editMode === 'boundary' ? boundaryEditor : null}
          />
        )}
        {/* Inline object editor overlay. Mounted on top of the unified viewer
            so the user transitions between view ↔ edit objects without any
            screen navigation. The initial camera mirrors the viewer's current
            camera so the framing is preserved. */}
        {editMode === 'objects' && plan ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <GardenPlanVectorEditor
              backgroundImageUrl={imageUrl}
              backgroundMode={showSatellite ? 'satellite' : 'plan'}
              boundaryGeoJson={plan.boundary_geojson ?? null}
              initialCamera={
                objectsEditCamera
                  ? {
                      center: {
                        latitude: objectsEditCamera.center.latitude,
                        longitude: objectsEditCamera.center.longitude,
                      },
                      altitude: objectsEditCamera.altitude,
                      heading: objectsEditCamera.heading,
                      pitch: objectsEditCamera.pitch,
                    }
                  : undefined
              }
              objects={objectDraft}
              onChange={setObjectDraft}
              showHeader={false}
              fullScreen
              transparent
              bottomInset={insets.bottom + 96}
            />
          </View>
        ) : null}
        <View style={styles.headerOverlay}>
          <ScreenHeader
            title={
              editMode === 'boundary'
                ? 'Edit boundary'
                : editMode === 'objects'
                  ? 'Edit objects'
                  : headerTitle
            }
            showBackButton
            onBackPress={() => {
              if (editMode === 'objects') {
                handleObjectsCancel();
                return;
              }
              navigation.goBack();
            }}
            rightElement={
              !isLoading && hasPlanSurface && editMode === 'none' ? (
                <View style={styles.headerActions}>
                  {canShowSatellite && (
                    <HeaderActionButton
                      iconOnly
                      onPress={() => setShowSatellite((s) => !s)}
                      accessibilityLabel={
                        showSatellite ? 'Hide satellite background' : 'Show satellite background'
                      }
                    >
                      <Icon
                        name={showSatellite ? 'map' : 'globe-outline'}
                        size={Header.actionIconSize}
                        color={colors.primary}
                      />
                    </HeaderActionButton>
                  )}
                  <HeaderActionButton
                    label="Edit"
                    onPress={openObjectEditor}
                    testID="garden-plan-viewer-edit-button"
                  />
                </View>
              ) : null
            }
            showNotificationBell={false}
            showAvatar={false}
          />
        </View>
        {editMode === 'boundary' && (
          <GardenEditSaveBar
            title={
              boundaryEditor.measurement.edges.length >= 3
                ? `${boundaryEditor.measurement.areaLabel} • ${boundaryEditor.measurement.perimeterLabel}`
                : 'Drag the corners to reshape the lot'
            }
            hasChanges={boundaryEditor.hasChanges}
            saving={boundaryEditor.saving}
            saveDisabled={boundaryEditor.corners.length < 3}
            bottomInset={insets.bottom}
            onSave={handleBoundarySave}
            onCancel={exitBoundaryEdit}
          />
        )}
        {editMode === 'objects' && (
          <GardenEditSaveBar
            title={
              objectDraft.length === 0
                ? 'Tap “+” to add objects from the library'
                : `${objectDraft.length} object${objectDraft.length === 1 ? '' : 's'}`
            }
            hasChanges={objectsHasChanges}
            saving={objectsSaving}
            bottomInset={insets.bottom}
            onSave={handleObjectsSave}
            onCancel={handleObjectsCancel}
          />
        )}

        {/* Add marker sheet */}
        <BottomSheet
          visible={showActionSheet}
          onClose={() => {
            setShowActionSheet(false);
            setPendingMarker(null);
          }}
          title="Pin a task"
          showCloseButton
        >
          <View style={styles.searchContainer}>
            <View style={styles.searchInputWrapper}>
              <Icon
                name="search"
                size={18}
                color={colors.textTertiary}
                style={styles.searchIcon}
              />
              <TextInput
                ref={searchInputRef}
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search tasks..."
                placeholderTextColor={colors.textTertiary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>
            {/* No `automaticallyAdjustKeyboardInsets` on purpose: this list
                sits inside the plan VIEWER, whose canvas is positioned against
                the full screen. Insetting it would shift the drawing out from
                under the overlay. It also contains no text input — only
                `keyboardShouldPersistTaps`, so a tap while some other field is
                focused still lands on a task row rather than being eaten. */}
            <FlatList
              data={filteredTasks}
              keyExtractor={(item) => item.id}
              renderItem={renderTaskItem}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
              style={styles.taskList}
            />
          </View>
        </BottomSheet>
        <AddTaskOptionsBottomSheet
          visible={showAddTaskOptions}
          onClose={() => {
            setShowAddTaskOptions(false);
            setPendingMarker(null);
          }}
          onLinkExisting={handleOpenLinkExistingFromOptions}
          onAddNew={handleCreateNewTask}
          onCopyExisting={handleCopyExistingTask}
          onAddFromTemplates={handleAddFromTemplates}
        />

        {/* Marker sheet */}
        <BottomSheet
          visible={showMarkerActionSheet}
          onClose={() => {
            setShowMarkerActionSheet(false);
            setSelectedMarker(null);
          }}
          title={selectedMarker?.label || 'Pinned task'}
          showCloseButton
        >
          <View style={styles.sheetContent}>
            <TouchableOpacity
              style={[styles.sheetAction, { borderColor: colors.borderColor }]}
              onPress={handleViewTask}
            >
              <Icon name="document-text" size={18} color={colors.textPrimary} />
              <Typography variant="body">View task</Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetAction, { borderColor: colors.borderColor }]}
              onPress={handleDeleteMarker}
              disabled={isDeletingMarker}
            >
              <Icon name="trash" size={18} color={colors.error} />
              <Typography variant="body" color={colors.error}>
                {isDeletingMarker ? 'Removing...' : 'Remove pin'}
              </Typography>
            </TouchableOpacity>
          </View>
        </BottomSheet>
        <Modal
          visible={showEditChooser}
          transparent
          animationType="fade"
          onRequestClose={() => setShowEditChooser(false)}
        >
          {/* `accessibilityViewIsModal` is not decoration here.

              Without it, assistive tech can still reach the plan behind this
              sheet — the map, its zoom controls, the header — which is wrong for
              VoiceOver (a modal must trap focus) and turned out to break UI
              automation outright: with a satellite MapView left in the tree, the
              accessibility snapshot for this screen came back with THREE nodes,
              all of them the status bar. Every control in this chooser was on
              screen and none of them was findable.

              Trapping focus prunes the map subtree from the snapshot, which
              fixes both problems with the same flag. */}
          <View style={styles.editChooserRoot} accessibilityViewIsModal>
            <Pressable
              style={styles.editChooserBackdrop}
              onPress={() => setShowEditChooser(false)}
              accessibilityLabel="Close edit menu"
            />
            <View pointerEvents="box-none" style={styles.editChooserCenter}>
              <View
                pointerEvents="auto"
                style={[
                  styles.editChooserCard,
                  { backgroundColor: colors.backgroundMain, borderColor: colors.borderColor },
                ]}
                testID="garden-plan-edit-chooser"
              >
                <Typography variant="title3" weight="semibold" style={styles.editChooserTitle}>
                  Edit plan
                </Typography>
                <Typography variant="caption1" color="textSecondary" style={styles.editChooserSub}>
                  Choose what to change
                </Typography>
                <TouchableOpacity
                  style={[styles.editChooserRow, { borderColor: colors.borderColor }]}
                  onPress={openNameEditor}
                  activeOpacity={0.75}
                  testID="garden-plan-edit-name"
                >
                  <View style={styles.editChooserIcon}>
                    <Icon name="text-outline" size={20} color={MAIN_ACTION_COLOR} />
                  </View>
                  <View style={styles.editChooserText}>
                    <Typography variant="body" weight="semibold">
                      Edit name
                    </Typography>
                    <Typography variant="caption1" color="textSecondary">
                      Change the plan title shown in the header
                    </Typography>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.editChooserRow,
                    { borderColor: colors.borderColor },
                    !canShowSatellite && styles.editChooserRowDisabled,
                  ]}
                  onPress={openBoundaryEditor}
                  disabled={!canShowSatellite}
                  activeOpacity={0.75}
                  testID="garden-plan-edit-boundary"
                >
                  <View style={styles.editChooserIcon}>
                    <Icon name="map-outline" size={20} color={MAIN_ACTION_COLOR} />
                  </View>
                  <View style={styles.editChooserText}>
                    <Typography variant="body" weight="semibold">
                      Edit boundaries
                    </Typography>
                    <Typography variant="caption1" color="textSecondary">
                      Drag corners to reshape the lot outline
                    </Typography>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editChooserRow, { borderColor: colors.borderColor }]}
                  onPress={openObjectsFromChooser}
                  activeOpacity={0.75}
                  testID="garden-plan-edit-objects"
                >
                  <View style={styles.editChooserIcon}>
                    <Icon name="leaf-outline" size={20} color={MAIN_ACTION_COLOR} />
                  </View>
                  <View style={styles.editChooserText}>
                    <Typography variant="body" weight="semibold">
                      Edit objects
                    </Typography>
                    <Typography variant="caption1" color="textSecondary">
                      Trees, beds, paths on your plan
                    </Typography>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editChooserCancel}
                  onPress={() => setShowEditChooser(false)}
                  testID="garden-plan-edit-chooser-cancel"
                >
                  <Typography variant="body" color="textSecondary">
                    Cancel
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={showNameEditor}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNameEditor(false)}
        >
          <View style={styles.editChooserRoot}>
            <Pressable
              style={styles.editChooserBackdrop}
              onPress={() => setShowNameEditor(false)}
            />
            <View
              pointerEvents="box-none"
              style={[
                styles.editChooserCenter,
                keyboardInset > 0 ? { paddingBottom: keyboardInset } : null,
              ]}
            >
              <View
                pointerEvents="auto"
                style={[
                  styles.editChooserCard,
                  { backgroundColor: colors.backgroundMain, borderColor: colors.borderColor },
                ]}
              >
                <Typography variant="title3" weight="semibold" style={styles.editChooserTitle}>
                  Edit name
                </Typography>
                <TextInput
                  style={[
                    styles.nameInput,
                    {
                      borderColor: colors.borderColor,
                      color: colors.textPrimary,
                    },
                  ]}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Plan name"
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                  testID="garden-plan-name-input"
                />
                <View style={styles.nameEditorActions}>
                  <TouchableOpacity
                    style={styles.nameEditorCancel}
                    onPress={() => setShowNameEditor(false)}
                    testID="garden-plan-name-cancel"
                  >
                    <Typography variant="body" color="textSecondary">
                      Cancel
                    </Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.nameEditorSave,
                      { opacity: isSavingName ? 0.55 : 1 },
                    ]}
                    onPress={handleSaveName}
                    disabled={isSavingName}
                    activeOpacity={0.8}
                    testID="garden-plan-name-save"
                  >
                    <Typography variant="body" color={colors.white} weight="semibold">
                      {isSavingName ? 'Saving...' : 'Save'}
                    </Typography>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: Header.overlayZIndex,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Header.actionGap,
  },
  sheetContent: { padding: 16, gap: 12 },
  sheetTitle: { marginBottom: 4 },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchContainer: { padding: 16, flex: 1, minHeight: 400 },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 10,
    marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, ...scaledFont('body') },
  taskList: { flex: 1 },
  taskItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  taskItemText: { flex: 1 },
  objectEditorScreen: { flex: 1 },
  objectEditorHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  objectEditorHeaderButton: {
    minWidth: 72,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    borderWidth: 1,
    borderColor: MAIN_ACTION_COLOR,
    backgroundColor: MAIN_ACTION_COLOR,
    paddingHorizontal: 12,
  },
  objectEditorBody: {
    flex: 1,
  },
  editChooserRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  editChooserBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  editChooserCenter: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  editChooserCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  editChooserTitle: { marginBottom: 2 },
  editChooserSub: { marginBottom: 8 },
  editChooserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  editChooserRowDisabled: {
    opacity: 0.6,
  },
  editChooserIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22, 163, 151, 0.12)',
  },
  editChooserText: {
    flex: 1,
    gap: 4,
  },
  editChooserCancel: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  nameInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    ...scaledFont('body'),
  },
  nameEditorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  nameEditorCancel: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  nameEditorSave: {
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ButtonMetrics.primaryCornerRadius,
    backgroundColor: MAIN_ACTION_COLOR,
    paddingHorizontal: 18,
  },
});
