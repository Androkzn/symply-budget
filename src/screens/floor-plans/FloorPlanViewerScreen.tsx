import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from 'expo-router/react-navigation';
import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Pressable, TextInput, FlatList, Keyboard, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { 
  floorPlansApi, 
  FloorPlanMarker, 
  FloorPlan, 
  FloorPlanAnalysis,
  FloorPlanRegion,
  BoundingBox,
} from '@api/floor-plans';
import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import type { Task } from '@api/tasks';
import { tasksApi } from '@api/tasks';
import { AppBackground, ScreenHeader } from '@components/common';
import { FloorPlanViewer, FloorPlanZoneViewer, type PendingMarker } from '@components/floor-plans';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { ENV } from '@config/env';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import type { FloorPlansSharedStack } from '@navigation/types';
import { navigateAfterInteractions } from '@services/nav-when-ready';
import { navigateToTask, navigateToScheduleTask } from '@services/navigation';
import { showToast } from '@services/toastManager';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { scaledFont, useAppColors } from '@theme';
import { areaUnitFor, formatArea } from '@utils/areaUnits';
import {
  getStructureTypeIcon,
  getSystemCategoryIcon,
  type IoniconName,
} from '@utils/categoryIcons';
import { detectSpaceAtPoint } from '@utils/spaceHitTest';

type NavigationProp = NativeStackNavigationProp<FloorPlansSharedStack, 'FloorPlanViewer'>;
type FloorPlanViewerRouteProp = RouteProp<FloorPlansSharedStack, 'FloorPlanViewer'>;

// Tapped location info
interface TappedLocation {
  x: number;
  y: number;
  xPercent: number;
  yPercent: number;
  spaceName?: string;
  spaceId?: string;
}

// Floor/Area zone for selection
interface FloorZone {
  id: string;
  name: string;
  icon: IoniconName;
  type: 'floor' | 'detached';
  // Floor level (from analysis) — drives the card gradient for floor zones.
  level?: number;
  // Index of this zone within its source list (analysis.floors / analysis.detached_areas).
  // Used to navigate to the area editor.
  sourceIndex: number;
  area?: number;
  spacesCount?: number;
  spaces?: string[];
  boundingBox?: BoundingBox | null;
}


// calibrateScale API exists in floorPlansApi but has no UI entry point in this screen.
export function FloorPlanViewerScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<FloorPlanViewerRouteProp>();
  const floorPlanId = route.params?.floorPlanId;
  const initialZoneType = route.params?.initialZoneType;
  const initialZoneIndex = route.params?.initialZoneIndex;
  const insets = useSafeAreaInsets();  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const areaUnit = areaUnitFor(currentHousehold?.unit_system ?? 'imperial');
  const { ensureCanUseAI } = useRequireAIAccess();
  const {
    setCurrentFloorPlan,
    markers,
    setMarkers,
    isLoading,
    setLoading,
  } = useFloorPlanStore();
  const { maintenanceTasks } = useTaskStore();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [analysis, setAnalysis] = useState<FloorPlanAnalysis | null>(null);
  const [regions, setRegions] = useState<FloorPlanRegion[]>([]);
  const [householdSpaces, setHouseholdSpaces] = useState<HouseholdSpace[]>([]);
  
  // View mode: 'floors' shows floor cards, 'map' shows interactive floor plan
  const [viewMode, setViewMode] = useState<'floors' | 'map'>('floors');
  
  // Floor selection state
  const [selectedFloor, setSelectedFloor] = useState<FloorZone | null>(null);
  
  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  
  // Bottom sheet state
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [tappedLocation, setTappedLocation] = useState<TappedLocation | null>(null);
  const [showTaskSearch, setShowTaskSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);
  
  // Marker action sheet state
  const [showMarkerActionSheet, setShowMarkerActionSheet] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<FloorPlanMarker | null>(null);
  const [isDeletingMarker, setIsDeletingMarker] = useState(false);
  
  // Pending marker - shown immediately on tap before task is linked
  const [pendingMarker, setPendingMarker] = useState<PendingMarker | null>(null);
  
  // Ref to track if a marker was just pressed (prevents pending marker on marker taps)
  const markerPressedRef = useRef(false);

  // Hint dismissal state - resets when user navigates away and returns
  const [showHint, setShowHint] = useState(true);

  // True when the screen was opened directly into the map view (e.g. tapping a
  // floor card from My Home). In that case the back button should exit the
  // screen instead of falling back to the zones list.
  const openedDirectlyRef = useRef<boolean>(
    initialZoneType === 'floor' || initialZoneType === 'detached' || initialZoneType === 'full',
  );
  // Guard so the auto-jump only runs once per mount.
  const hasAutoJumpedRef = useRef(false);

  // Build zones list from analysis (floors + detached areas)
  const zones = useMemo((): FloorZone[] => {
    console.log('[FloorPlanViewer] Analysis data:', analysis);
    console.log('[FloorPlanViewer] Floors from analysis:', analysis?.floors);
    console.log('[FloorPlanViewer] Detached areas from analysis:', analysis?.detached_areas);
    
    const result: FloorZone[] = [];
    
    // Add floors
    if (analysis?.floors) {
      analysis.floors.forEach((floor, idx) => {
        console.log(`[FloorPlanViewer] Floor ${idx}:`, floor.name, 'bbox:', floor.bounding_box);
        const spaceNames = floor.spaces?.map(s => s.name).filter(Boolean) || [];
        result.push({
          id: `floor-${idx}`,
          name: floor.name,
          type: 'floor',
          sourceIndex: idx,
          level: floor.level,
          icon: getFloorIcon(floor.level),
          area: floor.area?.value ?? undefined,
          spacesCount: floor.spaces?.length || 0,
          spaces: spaceNames,
          boundingBox: floor.bounding_box || undefined,
        });
      });
    }
    
    // Add detached areas (sheds, detached garages, etc.)
    if (analysis?.detached_areas) {
      analysis.detached_areas.forEach((area, idx) => {
        console.log(`[FloorPlanViewer] Detached ${idx}:`, area.name, 'type:', area.type, 'bbox:', area.bounding_box);
        const spaceNames = area.spaces?.map(s => s.name).filter(Boolean) || [];
        result.push({
          id: `detached-${idx}`,
          name: area.name,
          type: 'detached',
          sourceIndex: idx,
          icon: getStructureTypeIcon(area.type),
          area: area.area?.value ?? undefined,
          spacesCount: area.spaces?.length || 0,
          spaces: spaceNames,
          boundingBox: area.bounding_box || undefined,
        });
      });
    }
    
    return result;
  }, [analysis]);
  
  // Alias for backward compatibility
  const floors = zones;

  // Handle floor card tap - go to map view
  const handleFloorPress = useCallback((floor: FloorZone) => {
    setSelectedFloor(floor);
    setViewMode('map');
  }, []);

  // Auto-jump to map view when the screen is opened directly into a zone
  // (e.g. from a floor card on My Home). Runs once per mount, as soon as the
  // requested zone is available (or immediately for the 'full' shortcut).
  useEffect(() => {
    if (hasAutoJumpedRef.current) return;
    if (!imageUrl) return;

    if (initialZoneType === 'full') {
      hasAutoJumpedRef.current = true;
      setSelectedFloor(null);
      setViewMode('map');
      return;
    }

    if (initialZoneType === 'floor' || initialZoneType === 'detached') {
      if (initialZoneIndex == null) return;
      const target = zones.find(
        (zone) => zone.type === initialZoneType && zone.sourceIndex === initialZoneIndex,
      );
      if (!target) return;
      hasAutoJumpedRef.current = true;
      setSelectedFloor(target);
      setViewMode('map');
    }
  }, [imageUrl, initialZoneType, initialZoneIndex, zones]);

  // Open the area editor for an existing zone.
  const handleEditArea = useCallback((floor: FloorZone) => {
    if (!floorPlanId) return;
    navigation.navigate('FloorPlanAreaEdit', {
      floorPlanId,
      areaKind: floor.type,
      areaIndex: floor.sourceIndex,
    });
  }, [floorPlanId, navigation]);

  // Open the area editor in "add new" mode.
  const handleAddArea = useCallback(() => {
    if (!floorPlanId) return;
    navigation.navigate('FloorPlanAreaEdit', {
      floorPlanId,
    });
  }, [floorPlanId, navigation]);

  // Handle AI analysis trigger. Rooms can always be added by hand (Add area) —
  // this is the optional automatic path, so it needs a provider.
  const handleAnalyze = useCallback(async () => {
    if (!ensureCanUseAI()) return;
    if (!currentHousehold || !floorPlanId) return;

    setIsAnalyzing(true);
    setAnalysisStatus('processing');

    try {
      const response = await floorPlansApi.triggerAnalysis(currentHousehold.id, floorPlanId);
      console.log('[FloorPlanViewer] Analysis response:', response);
      
      if (response.status === 'completed' && response.analysis) {
        setAnalysis(response.analysis);
        setAnalysisStatus('completed');
        showToast('success', 'Floor plan analysis complete!');
      } else if (response.status === 'processing') {
        showToast('info', 'Analyzing floor plan... This may take a minute.');
        // Start polling for completion
        pollAnalysisStatus();
      }
    } catch (error: any) {
      console.error('Failed to analyze floor plan:', error);
      setAnalysisStatus('failed');
      showToast('error', 'We couldn’t analyze this floor plan. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentHousehold, floorPlanId, ensureCanUseAI]);

  // Track polling interval
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll for analysis status
  const pollAnalysisStatus = useCallback(async () => {
    if (!currentHousehold || !floorPlanId) return;

    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        // Drive Pass 2 one region at a time (avoids Worker waitUntil kills)
        try {
          const step = await floorPlansApi.processPendingRegions(
            currentHousehold.id,
            floorPlanId
          );
          if (step.regions) setRegions(step.regions);
          if (
            step.status === 'completed' ||
            (step.remaining === 0 && (step.regions?.length ?? 0) > 0)
          ) {
            const response = await floorPlansApi.getAnalysis(currentHousehold.id, floorPlanId);
            if (response.analysis) setAnalysis(response.analysis);
            setAnalysisStatus('completed');
            setIsAnalyzing(false);
            showToast('success', 'Floor plan analysis complete!');
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            return;
          }
        } catch (stepErr) {
          console.warn('[FloorPlanViewer] process-pending failed:', stepErr);
        }

        const response = await floorPlansApi.getAnalysis(currentHousehold.id, floorPlanId);
        console.log('[FloorPlanViewer] Poll response:', response);
        
        if (response.status === 'completed' && response.analysis) {
          setAnalysis(response.analysis);
          setAnalysisStatus('completed');
          setIsAnalyzing(false);
          try {
            const regionsResponse = await floorPlansApi.listRegions(
              currentHousehold.id,
              floorPlanId
            );
            setRegions(regionsResponse.regions ?? []);
          } catch {
            // best-effort
          }
          showToast('success', 'Floor plan analysis complete!');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        } else if (response.status === 'failed') {
          setAnalysisStatus('failed');
          setIsAnalyzing(false);
          showToast('error', response.message || 'Analysis failed');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        } else if (response.analysis) {
          // Show skeleton zones while Pass 2 continues
          setAnalysis(response.analysis);
        }
      } catch (error) {
        console.error('Failed to poll analysis status:', error);
      }
    }, 4000);

    // Stop polling after 10 minutes (multi-region pipeline)
    pollTimeoutRef.current = setTimeout(() => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setIsAnalyzing(false);
      showToast('info', 'Analysis is taking longer than expected. Pull to refresh later.');
    }, 600000);
  }, [currentHousehold, floorPlanId]);
  
  // Filter tasks based on search - use real maintenance tasks from store
  const filteredTasks = useMemo(() => {
    // Only show active tasks that aren't completed
    const activeTasks = maintenanceTasks.filter(t => t.is_active);
    
    if (!searchQuery.trim()) return activeTasks;
    
    const query = searchQuery.toLowerCase();
    return activeTasks.filter(
      t => t.title.toLowerCase().includes(query) || 
           (t.system_category?.toLowerCase().includes(query))
    );
  }, [maintenanceTasks, searchQuery]);

  // Build a map of task ID to system_category for marker icons
  const taskCategories = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const task of maintenanceTasks) {
      map[task.id] = task.system_category ?? null;
    }
    return map;
  }, [maintenanceTasks]);

  // Detect which space was tapped based on analysis data
  const detectTappedSpace = useCallback(
    (xPercent: number, yPercent: number): { id?: string; name?: string } => {
      if (!floorPlanId) return {};
      const hit = detectSpaceAtPoint(householdSpaces, xPercent, yPercent, floorPlanId);
      return hit ? { id: hit.id, name: hit.name } : {};
    },
    [householdSpaces, floorPlanId]
  );

  // Load floor plan and markers
  const loadData = useCallback(async (silent = false) => {
    if (!currentHousehold || !floorPlanId) return;

    try {
      if (!silent) setLoading(true);

      // Load floor plan
      const fpResponse = await floorPlansApi.get(currentHousehold.id, floorPlanId);
      setFloorPlan(fpResponse.floor_plan);
      setCurrentFloorPlan(fpResponse.floor_plan);

      // Load markers
      const markersResponse = await floorPlansApi.listMarkers(
        currentHousehold.id,
        floorPlanId
      );
      setMarkers(markersResponse.markers);

      // Set image URL
      if (fpResponse.floor_plan.display_image_key) {
        setImageUrl(`${ENV.API_BASE_URL}/files/${fpResponse.floor_plan.display_image_key}`);
      }

      // Check for existing analysis
      setAnalysisStatus(fpResponse.floor_plan.ai_analysis_status);
      console.log('[FloorPlanViewer] AI analysis status:', fpResponse.floor_plan.ai_analysis_status);
      console.log('[FloorPlanViewer] AI analysis data:', fpResponse.floor_plan.ai_analysis_data);
      
      if (fpResponse.floor_plan.ai_analysis_data) {
        const analysisData = typeof fpResponse.floor_plan.ai_analysis_data === 'string'
          ? JSON.parse(fpResponse.floor_plan.ai_analysis_data)
          : fpResponse.floor_plan.ai_analysis_data;
        setAnalysis(analysisData);
      }

      // Load per-region hybrid vector assets (best-effort)
      try {
        const regionsResponse = await floorPlansApi.listRegions(
          currentHousehold.id,
          floorPlanId
        );
        setRegions(regionsResponse.regions ?? []);
      } catch (regionErr) {
        console.warn('[FloorPlanViewer] Failed to load regions:', regionErr);
        setRegions([]);
      }

      try {
        const spacesResponse = await householdSpacesApi.list(currentHousehold.id);
        setHouseholdSpaces(spacesResponse.spaces ?? []);
      } catch (spaceErr) {
        console.warn('[FloorPlanViewer] Failed to load spaces:', spaceErr);
        setHouseholdSpaces([]);
      }
    } catch (error: any) {
      console.error('Failed to load floor plan:', error);
      const errorMsg = error?.response?.data?.error || error?.message || 'Unknown error';
      showToast('error', `Failed to load: ${errorMsg}`);
      if (!silent) navigation.goBack();
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentHousehold, floorPlanId, setCurrentFloorPlan, setMarkers, setLoading, navigation]);

  useEffect(() => {
    loadData();
    
    // Cleanup polling on unmount
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, [loadData]);

  // Refresh silently when returning from the area editor so renames / new
  // areas show up immediately without a loading flash.
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      loadData(true);
    }, [loadData]),
  );

  // Auto-start analysis or polling based on status
  useEffect(() => {
    if (analysisStatus === 'processing' || analysisStatus === 'pending') {
      // Analysis in progress - start polling
      setIsAnalyzing(true);
      pollAnalysisStatus();
    } else if (analysisStatus === null && floorPlan && !isAnalyzing) {
      // Never analyzed - auto-trigger analysis
      console.log('[FloorPlanViewer] Auto-triggering analysis for floor plan');
      handleAnalyze();
    }
  }, [analysisStatus, floorPlan, isAnalyzing, pollAnalysisStatus, handleAnalyze]);

  // Handle tap on floor plan - show pending marker immediately
  const handlePlanPress = useCallback((x: number, y: number, xPercent: number, yPercent: number) => {
    // If a marker was just pressed, don't show pending marker
    // The marker's onPress fires slightly after the tap gesture
    if (markerPressedRef.current) {
      console.log('[FloorPlanViewerScreen] Ignoring tap - marker was pressed');
      return;
    }
    
    const detected = detectTappedSpace(xPercent, yPercent);

    console.log('[FloorPlanViewerScreen] Tap at:', { x, y, xPercent, yPercent, detected });

    // Hide hint on first tap
    setShowHint(false);

    // Delay showing pending marker slightly to allow marker press to cancel it
    setTimeout(() => {
      // Check again in case marker press happened during delay
      if (markerPressedRef.current) {
        console.log('[FloorPlanViewerScreen] Cancelling pending marker - marker was pressed');
        return;
      }
      
      // Show pending marker at tap location
      setPendingMarker({ x, y, xPercent, yPercent });

      setTappedLocation({
        x,
        y,
        xPercent,
        yPercent,
        spaceName: detected.name,
        spaceId: detected.id,
      });
      setShowActionSheet(true);
      setShowTaskSearch(false);
      setSearchQuery('');
    }, 50);
  }, [detectTappedSpace]);

  // Handle marker press - show action sheet
  const handleMarkerPress = useCallback((marker: FloorPlanMarker) => {
    console.log('[FloorPlanViewer] Marker pressed, opening action sheet:', marker.id);
    // Set flag to prevent pending marker from showing (tap gesture fires before this)
    markerPressedRef.current = true;
    // Clear any pending marker - we're viewing an existing one, not creating new
    setPendingMarker(null);
    setSelectedMarker(marker);
    setShowMarkerActionSheet(true);
    // Reset flag after a short delay
    setTimeout(() => {
      markerPressedRef.current = false;
    }, 100);
  }, []);

  // Handle view task from marker
  const handleViewTask = useCallback(() => {
    console.log('[FloorPlanViewer] handleViewTask called, selectedMarker:', selectedMarker?.id);
    if (!selectedMarker) return;
    
    const taskId = selectedMarker.linked_entity_id;
    const entityType = selectedMarker.linked_entity_type;
    
    // Close sheet first
    setShowMarkerActionSheet(false);
    setSelectedMarker(null);
    
    // Then navigate
    if (entityType === 'task' || entityType === 'maintenance_task') {
      console.log('[FloorPlanViewer] Navigating to TaskDetail with taskId:', taskId);
      navigateAfterInteractions(() => navigateToTask(taskId));
    }
  }, [selectedMarker]);

  // Handle edit task from marker
  const handleEditTask = useCallback(() => {
    console.log('[FloorPlanViewer] handleEditTask called, selectedMarker:', selectedMarker?.id);
    if (!selectedMarker) return;
    
    const taskId = selectedMarker.linked_entity_id;
    const entityType = selectedMarker.linked_entity_type;
    
    // Close sheet first
    setShowMarkerActionSheet(false);
    setSelectedMarker(null);
    
    // Then navigate
    if (entityType === 'task' || entityType === 'maintenance_task') {
      console.log('[FloorPlanViewer] Navigating to ScheduleTask with taskId:', taskId);
      navigateAfterInteractions(() => navigateToScheduleTask(taskId));
    }
  }, [selectedMarker]);

  // Handle delete marker
  const handleDeleteMarker = useCallback(async () => {
    console.log('[FloorPlanViewerScreen] handleDeleteMarker called, selectedMarker:', selectedMarker?.id);
    if (!selectedMarker || !currentHousehold) return;
    
    const markerId = selectedMarker.id;
    
    setIsDeletingMarker(true);
    try {
      console.log('[FloorPlanViewerScreen] Deleting marker:', markerId);
      await floorPlansApi.deleteMarker(currentHousehold.id, markerId);
      
      // Remove marker from local state using functional update to avoid stale closures
      setMarkers(prevMarkers => prevMarkers.filter(m => m.id !== markerId));
      showToast('success', 'Marker removed from floor plan');
    } catch (error) {
      console.error('[FloorPlanViewerScreen] Failed to delete marker:', error);
      showToast('error', 'Failed to remove marker');
    } finally {
      setIsDeletingMarker(false);
      // Close sheet after operation
      setShowMarkerActionSheet(false);
      setSelectedMarker(null);
    }
  }, [selectedMarker, currentHousehold, setMarkers]);

  // Handle new task creation — use tab parent so navigation works from inside the sheet
  const handleCreateNewTask = useCallback(() => {
    setShowActionSheet(false);
    setPendingMarker(null); // Clear pending marker
    navigateToScheduleTask();
  }, []);

  // Handle linking existing task
  const handleLinkExistingTask = useCallback(async (task: Task) => {
    if (!tappedLocation || !currentHousehold || !floorPlanId) return;
    
    setShowActionSheet(false);
    
    const markerData = {
      x_percent: tappedLocation.xPercent * 100,
      y_percent: tappedLocation.yPercent * 100,
      label: task.title,
      marker_type: 'pin' as const,
      linked_entity_type: 'task' as const,
      linked_entity_id: task.id,
      space_id: tappedLocation.spaceId,
    };
    
    try {
      const response = await floorPlansApi.createMarker(currentHousehold.id, floorPlanId, markerData);
      setMarkers(prevMarkers => [...prevMarkers, response.marker]);

      if (tappedLocation.spaceId && !task.space_id) {
        await tasksApi.update(currentHousehold.id, task.id, {
          space_id: tappedLocation.spaceId,
        });
      }
      
      setPendingMarker(null);
      
      showToast('success', `Linked "${task.title}" to ${tappedLocation.spaceName || 'this location'}`);
    } catch (error: any) {
      console.error('Failed to link task:', error);
      console.error('Error response:', error?.response?.data);
      showToast('error', 'Failed to link task to floor plan');
      // Clear pending marker on error too
      setPendingMarker(null);
    }
  }, [tappedLocation, currentHousehold, floorPlanId, setMarkers]);


  // Render task item in search list
  const renderTaskItem = ({ item }: { item: Task }) => (
    <TouchableOpacity
      style={styles.taskItem}
      onPress={() => handleLinkExistingTask(item)}
      activeOpacity={0.7}
    >
      <View style={styles.taskItemContent}>
        <View style={styles.taskItemIcon}>
          <Icon
            name={getSystemCategoryIcon(item.system_category)}
            size={18}
            color={colors.textPrimary}
          />
        </View>
        <View style={styles.taskItemText}>
          <Typography variant="body" weight="medium">{item.title}</Typography>
          <Typography variant="caption1" color="textSecondary">
            {item.system_category || 'General'}
          </Typography>
        </View>
      </View>
      {item.next_due_date && (
        <View style={[styles.taskStatusBadge, { backgroundColor: colors.primary }]}>
          <Typography variant="caption1" style={{ color: colors.white }}>
            {new Date(item.next_due_date).toLocaleDateString()}
          </Typography>
        </View>
      )}
    </TouchableOpacity>
  );

  // Render bottom sheet content
  const renderActionSheetContent = () => {
    if (showTaskSearch) {
      // Task search view
      return (
        <View style={styles.searchContainer}>
          {/* Search Input */}
          <View style={styles.searchInputWrapper}>
            <Icon name="search" size={18} color={colors.textSecondary} style={styles.searchIcon} />
            <TextInput
              ref={searchInputRef}
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder="Search tasks..."
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Task List */}
          <FlatList
            data={filteredTasks}
            renderItem={renderTaskItem}
            keyExtractor={(item) => item.id}
            style={styles.taskList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptySearch}>
                <Typography variant="body" color="textSecondary">
                  No tasks found
                </Typography>
              </View>
            }
          />

          {/* Back button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setShowTaskSearch(false);
              setSearchQuery('');
              Keyboard.dismiss();
            }}
          >
            <View style={styles.backButtonRow}>
              <Icon name="chevron-back" size={18} color={colors.textSecondary} />
              <Typography variant="body" color="textSecondary">Back</Typography>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    // Main action options
    return (
      <View style={styles.actionOptions}>
        {/* Location indicator */}
        {tappedLocation?.spaceName && (
          <View style={[styles.locationBadge, styles.locationBadgeRow]}>
            <Icon name="location" size={14} color={colors.primary} />
            <Typography variant="caption1" color="primary">
              {tappedLocation.spaceName}
            </Typography>
          </View>
        )}

        {/* New Task Option */}
        <Pressable
          style={styles.actionOption}
          onPress={handleCreateNewTask}
          android_ripple={undefined}
          testID="floor-plan-marker-new-task"
        >
          <LinearGradient
            colors={['rgba(0, 200, 150, 0.15)', 'rgba(0, 200, 150, 0.05)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionOptionGradient}
          >
            <View style={[styles.actionOptionIcon, { backgroundColor: 'rgba(0, 200, 150, 0.2)' }]}>
              <Icon name="add" size={24} color={colors.success} />
            </View>
            <View style={styles.actionOptionText}>
              <Typography variant="subheadline" weight="semibold">New Task</Typography>
              <Typography variant="caption1" color="textSecondary">
                Create a new maintenance task for this location
              </Typography>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
          </LinearGradient>
        </Pressable>

        {/* Existing Task Option */}
        <TouchableOpacity
          style={styles.actionOption}
          onPress={() => setShowTaskSearch(true)}
          activeOpacity={0.8}
          testID="floor-plan-marker-link-existing"
        >
          <LinearGradient
            colors={['rgba(59, 130, 246, 0.15)', 'rgba(59, 130, 246, 0.05)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionOptionGradient}
          >
            <View style={[styles.actionOptionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
              <Icon name="link" size={24} color={colors.accent} />
            </View>
            <View style={styles.actionOptionText}>
              <Typography variant="subheadline" weight="semibold">Existing Task</Typography>
              <Typography variant="caption1" color="textSecondary">
                Link an existing task to this location
              </Typography>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  };

  // Get display title based on view mode
  const displayTitle = useMemo(() => {
    if (viewMode === 'map') {
      if (selectedFloor) {
        return selectedFloor.name; // e.g., "Main Floor"
      }
      return 'Full Floor Plan'; // Viewing entire plan
    }
    // In floors view, show household name (the property this plan belongs to)
    if (currentHousehold?.name) return currentHousehold.name;
    if (floorPlan?.building_name) return floorPlan.building_name;
    return 'Floor Plan';
  }, [viewMode, selectedFloor, floorPlan, currentHousehold]);

  // Render floor cards grid
  // No `automaticallyAdjustKeyboardInsets` on purpose: a full-bleed floor-plan
  // viewer must not shift under the keyboard, and this grid holds cards, not
  // text inputs. `keyboardShouldPersistTaps` is here so a tap lands on a card
  // instead of being swallowed while a field elsewhere holds focus.
  const renderFloorsView = () => (
    <ScrollView keyboardShouldPersistTaps="handled"
      style={styles.floorsContainer}
      contentContainerStyle={[styles.floorsContent, { paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Floor cards */}
      {floors.length > 0 && (
        <View style={styles.floorsGrid}>
          {floors.map((floor) => {
            // Get first few space names for preview
            const spacesPreview = floor.spaces?.slice(0, 3).join(', ') || '';
            const hasMoreSpaces = (floor.spaces?.length || 0) > 3;
            
            return (
              <TouchableOpacity
                key={floor.id}
                style={[styles.floorCard, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleFloorPress(floor)}
                activeOpacity={0.8}
                testID={`floor-plan-zone-card-${floor.id}`}
              >
                {/* Horizontal layout: preview on left, content on right */}
                <View style={styles.floorCardRow}>
                  {/* Preview image of the floor plan area */}
                  {imageUrl && floor.boundingBox && (
                    <View style={[styles.floorCardPreview, { backgroundColor: colors.backgroundSecondary }]}>
                      <Image
                        source={{ uri: imageUrl }}
                        style={[
                          styles.floorCardPreviewImage,
                          {
                            // Scale and position the image to show just the bounding box area
                            width: 120 / (floor.boundingBox.x2 - floor.boundingBox.x1),
                            height: 160 / (floor.boundingBox.y2 - floor.boundingBox.y1),
                            left: -120 * floor.boundingBox.x1 / (floor.boundingBox.x2 - floor.boundingBox.x1),
                            top: -160 * floor.boundingBox.y1 / (floor.boundingBox.y2 - floor.boundingBox.y1),
                          },
                        ]}
                        resizeMode="cover"
                      />
                    </View>
                  )}
                  
                  {/* Content */}
                  <LinearGradient
                    colors={getFloorGradient(floor.level, floor.type)}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.floorCardGradient}
                  >
                    <View style={styles.floorCardContent}>
                      <Typography variant="titleSmall" weight="semibold" color={colors.white} style={styles.floorCardName}>
                        {floor.name}
                      </Typography>
                      <View style={styles.floorCardStats}>
                        {!!floor.area && (
                          <Typography variant="bodySmall" weight="medium" color="rgba(255, 255, 255, 0.9)">
                            {formatArea(floor.area, areaUnit)}
                          </Typography>
                        )}
                        {!!floor.area && (floor.spacesCount ?? 0) > 0 && (
                          <Typography variant="bodySmall" color="rgba(255, 255, 255, 0.6)"> • </Typography>
                        )}
                        {(floor.spacesCount ?? 0) > 0 && (
                          <Typography variant="bodySmall" weight="medium" color="rgba(255, 255, 255, 0.9)">
                            {floor.spacesCount} {floor.spacesCount === 1 ? 'space' : 'spaces'}
                          </Typography>
                        )}
                      </View>
                      {/* Spaces preview */}
                      {spacesPreview && (
                        <Typography variant="caption" color="rgba(255, 255, 255, 0.7)" style={styles.floorCardSpacesList} numberOfLines={1}>
                          {spacesPreview}{hasMoreSpaces ? ` +${(floor.spaces?.length || 0) - 3} more` : ''}
                        </Typography>
                      )}
                    </View>

                    {/* Arrow */}
                    <Icon name="chevron-forward" size={24} color="rgba(255, 255, 255, 0.8)" style={styles.floorCardArrow} />
                  </LinearGradient>

                  {/* Edit pencil — overlay so it doesn't trigger the card tap */}
                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation();
                      handleEditArea(floor);
                    }}
                    hitSlop={8}
                    style={styles.floorCardEditButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${floor.name}`}
                    testID={`floor-plan-zone-edit-${floor.id}`}
                  >
                    <Icon name="create-outline" size={18} color={colors.white} />
                  </Pressable>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Add new area button - always visible when we have an analyzed plan */}
      {(analysisStatus === 'completed' || floors.length > 0) && (
        <TouchableOpacity
          style={[styles.addAreaButton, { borderColor: colors.borderColor }]}
          onPress={handleAddArea}
          activeOpacity={0.8}
          testID="floor-plan-add-area"
        >
          <Icon name="add-circle-outline" size={22} color={colors.primary} />
          <Typography variant="body" weight="semibold" color="primary">
            Add custom area
          </Typography>
        </TouchableOpacity>
      )}

      {/* No floors - show appropriate state */}
      {floors.length === 0 && (
        <View style={styles.noFloorsContainer}>
          {/* Processing state - show spinner */}
          {(analysisStatus === 'processing' || isAnalyzing) ? (
            <>
              <View style={styles.analyzingSpinner}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
              <Typography variant="subheadline" weight="semibold" style={styles.noFloorsTitle}>
                Analyzing Floor Plan...
              </Typography>
              <Typography variant="body" color="textSecondary" style={styles.noFloorsText}>
                AI is detecting floors, spaces, and dimensions. This may take up to a minute.
              </Typography>
            </>
          ) : analysisStatus === 'failed' ? (
            // Failed state - show retry button
            <>
              <Icon name="warning" size={64} color={colors.warning} style={styles.noFloorsIcon} />
              <Typography variant="subheadline" weight="semibold" style={styles.noFloorsTitle}>
                Analysis Failed
              </Typography>
              <Typography variant="body" color="textSecondary" style={styles.noFloorsText}>
                Something went wrong during analysis. You can try again or view the full floor plan.
              </Typography>
              <TouchableOpacity
                style={styles.analyzeButton}
                onPress={handleAnalyze}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['rgba(0, 200, 150, 0.8)', 'rgba(0, 180, 130, 0.9)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.analyzeButtonGradient}
                >
                  <View style={styles.retryButtonRow}>
                    <Icon name="refresh" size={18} color={colors.white} />
                    <Typography variant="body" weight="semibold" style={{ color: colors.white }}>
                      Retry Analysis
                    </Typography>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : analysisStatus === 'completed' ? (
            // Completed but no floors detected
            <>
              <Icon name="home" size={64} color={colors.textSecondary} style={styles.noFloorsIcon} />
              <Typography variant="subheadline" weight="semibold" style={styles.noFloorsTitle}>
                No Floors Detected
              </Typography>
              <Typography variant="body" color="textSecondary" style={styles.noFloorsText}>
                AI could not detect separate floors in this floor plan. You can still view and interact with it.
              </Typography>
            </>
          ) : (
            // Null/pending state - starting analysis automatically
            <>
              <View style={styles.analyzingSpinner}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
              <Typography variant="subheadline" weight="semibold" style={styles.noFloorsTitle}>
                Starting Analysis...
              </Typography>
              <Typography variant="body" color="textSecondary" style={styles.noFloorsText}>
                AI analysis will begin automatically.
              </Typography>
            </>
          )}

          <TouchableOpacity
            style={styles.fullPlanButton}
            onPress={() => {
              setSelectedFloor(null);
              setViewMode('map');
            }}
            testID="floor-plan-view-full"
          >
            <View style={styles.fullPlanButtonRow}>
              <Typography variant="body" color="primary">
                View Full Floor Plan
              </Typography>
              <Icon name="chevron-forward" size={18} color={colors.primary} />
            </View>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );

  // Resolve hybrid vector assets for the currently selected floor/area
  const selectedRegion = useMemo(() => {
    if (!selectedFloor || regions.length === 0) return null;
    const kind = selectedFloor.type === 'detached' ? 'detached' : 'floor';
    return (
      regions.find((r) => r.kind === kind && r.name === selectedFloor.name) ||
      regions.find(
        (r) =>
          r.kind === kind &&
          r.sort_order ===
            (kind === 'floor'
              ? selectedFloor.sourceIndex
              : (analysis?.floors?.length ?? 0) + selectedFloor.sourceIndex)
      ) ||
      null
    );
  }, [selectedFloor, regions, analysis?.floors?.length]);

  const toAbsoluteFileUrl = useCallback((relativeOrAbsolute: string | null | undefined) => {
    if (!relativeOrAbsolute) return null;
    if (relativeOrAbsolute.startsWith('http')) return relativeOrAbsolute;
    return `${ENV.API_BASE_URL}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
  }, []);

  // Render interactive map view (with tap-to-add)
  const renderMapView = () => {
    const cropUrl = toAbsoluteFileUrl(selectedRegion?.crop_image_url);
    const traceUrl = toAbsoluteFileUrl(selectedRegion?.vector_trace_url);
    const semanticUrl = toAbsoluteFileUrl(selectedRegion?.vector_semantic_url);

    return (
      <View style={styles.mapContainer}>
        {/* Use FloorPlanZoneViewer to zoom into selected floor's bounding box */}
        {selectedFloor?.boundingBox ? (
          <FloorPlanZoneViewer
            imageUrl={imageUrl!}
            boundingBox={selectedFloor.boundingBox}
            cropImageUrl={cropUrl}
            vectorTraceUrl={traceUrl}
            vectorSemanticUrl={semanticUrl}
            markers={markers}
            pendingMarker={pendingMarker}
            taskCategories={taskCategories}
            onMarkerPress={handleMarkerPress}
            onPlanPress={handlePlanPress}
            interactive
          />
        ) : (
          <FloorPlanViewer
            imageUrl={imageUrl!}
            markers={markers}
            pendingMarker={pendingMarker}
            taskCategories={taskCategories}
            onMarkerPress={handleMarkerPress}
            onPlanPress={handlePlanPress}
            interactive
          />
        )}
        
        {/* Hint - dismissible on first tap, shows once per view */}
        {showHint && (
          <View
            style={[styles.tapHint, { bottom: insets.bottom + 90 }]}
            pointerEvents="none"
          >
            <Typography variant="caption1" color="textSecondary">
              Tap to place a task • Pinch to zoom • Double-tap to zoom in/out
            </Typography>
          </View>
        )}

      </View>
    );
  };

  if (isLoading || !imageUrl) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Loading..."
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
          />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="floor-plan-viewer-screen">
        {/* Header with dynamic back behavior */}
        <ScreenHeader
          title={displayTitle}
          showBackButton
          onBackPress={() => {
            // When the screen was opened directly into the map view (e.g. from
            // a My Home floor card), exit instead of falling back to a zones
            // list the user never saw.
            if (viewMode === 'map' && !openedDirectlyRef.current) {
              setViewMode('floors');
              setSelectedFloor(null);
            } else {
              navigation.goBack();
            }
          }}
          showNotificationBell={false}
          showAvatar={false}
        />

        {/* Show floors grid or map based on view mode */}
        {viewMode === 'floors' ? renderFloorsView() : renderMapView()}

        {/* Action Bottom Sheet - for adding tasks */}
        <BottomSheet
          visible={showActionSheet}
          onClose={() => {
            setShowActionSheet(false);
            setShowTaskSearch(false);
            setSearchQuery('');
            setPendingMarker(null); // Clear pending marker on close
          }}
          height={showTaskSearch ? 'tall' : 'standard'}
          title={showTaskSearch ? 'Link Existing Task' : 'Add Task'}
          showCloseButton
        >
          {renderActionSheetContent()}
        </BottomSheet>

        {/* Marker Action Bottom Sheet - for existing markers */}
        <BottomSheet
          visible={showMarkerActionSheet}
          onClose={() => {
            setShowMarkerActionSheet(false);
            setSelectedMarker(null);
          }}
          height="short"
          title={selectedMarker?.label || 'Task Options'}
          showCloseButton
        >
          <View style={styles.markerActionContainer}>
            {/* View Task */}
            <TouchableOpacity
              style={styles.markerActionOption}
              onPress={handleViewTask}
              activeOpacity={0.7}
              testID="floor-plan-marker-view"
            >
              <View style={[styles.markerActionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Icon name="eye" size={20} color={colors.accent} />
              </View>
              <View style={styles.markerActionText}>
                <Typography variant="body" weight="medium">View Task</Typography>
                <Typography variant="caption1" color="textSecondary">
                  See task details and history
                </Typography>
              </View>
            </TouchableOpacity>

            {/* Edit Task */}
            <TouchableOpacity
              style={styles.markerActionOption}
              onPress={handleEditTask}
              activeOpacity={0.7}
              testID="floor-plan-marker-edit"
            >
              <View style={[styles.markerActionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Icon name="pencil" size={20} color={colors.success} />
              </View>
              <View style={styles.markerActionText}>
                <Typography variant="body" weight="medium">Edit Task</Typography>
                <Typography variant="caption1" color="textSecondary">
                  Modify task settings
                </Typography>
              </View>
            </TouchableOpacity>

            {/* Remove from Floor Plan */}
            <TouchableOpacity
              style={styles.markerActionOption}
              onPress={handleDeleteMarker}
              disabled={isDeletingMarker}
              activeOpacity={0.7}
              testID="floor-plan-marker-remove"
            >
              <View style={[styles.markerActionIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                {isDeletingMarker ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Icon name="trash" size={20} color={colors.error} />
                )}
              </View>
              <View style={styles.markerActionText}>
                <Typography variant="body" weight="medium" style={{ color: colors.error }}>
                  Remove from Floor Plan
                </Typography>
                <Typography variant="caption1" color="textSecondary">
                  Unlink task from this location
                </Typography>
              </View>
            </TouchableOpacity>
          </View>
        </BottomSheet>
      </View>
    </AppBackground>
  );
}

// Helper functions
function getFloorIcon(level: number): IoniconName {
  if (level < 0) return 'arrow-down'; // Basement/Below
  if (level === 0 || level === 1) return 'home'; // Main/Ground
  if (level === 2) return 'arrow-up'; // Second floor
  return 'business'; // Upper floors
}

function getFloorGradient(level?: number, type?: 'floor' | 'detached'): [string, string] {
  // Detached areas get orange/amber gradient
  if (type === 'detached') {
    return ['rgba(245, 158, 11, 0.4)', 'rgba(217, 119, 6, 0.6)']; // Amber
  }

  if (level !== undefined && level < 0) {
    return ['rgba(147, 51, 234, 0.4)', 'rgba(126, 34, 206, 0.6)']; // Purple for basement
  }
  if (level === 0 || level === 1) {
    return ['rgba(59, 130, 246, 0.4)', 'rgba(37, 99, 235, 0.6)']; // Blue for main
  }
  if (level === 2) {
    return ['rgba(16, 185, 129, 0.4)', 'rgba(5, 150, 105, 0.6)']; // Green for upper
  }
  return ['rgba(100, 116, 139, 0.4)', 'rgba(71, 85, 105, 0.6)']; // Gray default
}

// Unused - kept for potential future use
// function getStatusColor(status: string): string {
//   switch (status) {
//     case 'pending':
//       return 'rgba(234, 179, 8, 0.8)';
//     case 'in_progress':
//       return 'rgba(59, 130, 246, 0.8)';
//     case 'completed':
//       return 'rgba(34, 197, 94, 0.8)';
//     default:
//       return 'rgba(100, 100, 100, 0.8)';
//   }
// }

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Floors view
  floorsContainer: {
    flex: 1,
  },
  floorsContent: {
    padding: 20,
  },
  floorsGrid: {
    flexDirection: 'column',
    gap: 12,
  },
  floorCard: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  floorCardRow: {
    flexDirection: 'row',
    height: 160,
  },
  floorCardPreview: {
    width: 120,
    height: 160,
    overflow: 'hidden',
    position: 'relative',
  },
  floorCardPreviewImage: {
    position: 'absolute',
  },
  floorCardGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  floorCardContent: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  floorCardName: {},
  floorCardStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  floorCardSpacesList: {
    marginTop: 4,
  },
  floorCardArrow: {
    marginLeft: 12,
  },
  floorCardEditButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addAreaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  fullPlanButton: {
    alignItems: 'center',
    paddingVertical: 20,
    marginTop: 12,
  },
  fullPlanButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  retryButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // No floors state
  noFloorsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  noFloorsIcon: {
    marginBottom: 16,
  },
  analyzingSpinner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(78, 205, 196, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  noFloorsTitle: {
    marginBottom: 8,
    textAlign: 'center',
  },
  noFloorsText: {
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 280,
  },
  analyzeButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  analyzeButtonDisabled: {
    opacity: 0.6,
  },
  analyzeButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
  },
  processingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  // Map container
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  tapHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    marginHorizontal: 40,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'center',
  },
  // Action options in bottom sheet
  actionOptions: {
    gap: 16,
    paddingTop: 8,
  },
  locationBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 200, 150, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 8,
  },
  locationBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionOption: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  actionOptionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionOptionIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  actionOptionText: {
    flex: 1,
  },
  // Search container
  searchContainer: {
    flex: 1,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    ...scaledFont('body'),
  },
  taskList: {
    flex: 1,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  taskItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  taskItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  taskItemText: {
    flex: 1,
  },
  taskStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  emptySearch: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  backButton: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    marginTop: 8,
  },
  backButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Marker action sheet styles
  markerActionContainer: {
    paddingTop: 8,
  },
  markerActionOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  markerActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  markerActionText: {
    flex: 1,
  },
});
