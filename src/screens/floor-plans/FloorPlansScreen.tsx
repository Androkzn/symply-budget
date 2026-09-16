import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, useFocusEffect } from 'expo-router/react-navigation';
import type { RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, Image, Animated, Alert } from 'react-native';
import { Swipeable, TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floorPlansApi, FloorPlan } from '@api/floor-plans';
import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, FloatingActionButton, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import type { FloorPlansSharedStack } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import {Spacing,
  CornerRadius,
  Layout,
  EmptyState as EmptyTokens, useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { floorPlanDisplayLabel } from '@utils/floorPlanLabel';

// Group floor plans by building
interface BuildingGroup {
  buildingName: string;
  floorPlans: FloorPlan[];
  totalMarkers: number;
}

type FloorPlansEntryRoute = RouteProp<FloorPlansSharedStack, 'FloorPlansMain'>;

export function FloorPlansScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<
    NativeStackNavigationProp<FloorPlansSharedStack, 'FloorPlansMain'>
  >();
  const route = useRoute<FloorPlansEntryRoute>();  const insets = useSafeAreaInsets();
  const { currentHousehold, households, setCurrentHousehold } = useHouseholdStore();
  const { floorPlans, setFloorPlans, setLoading, isLoading, removeFloorPlan } = useFloorPlanStore();
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const hasAutoOpenedSinglePlanRef = useRef(false);

  const householdIdParam = route.params?.householdId;

  // When opened from My Properties with a specific household, switch to it so we show that property's floor plans
  useEffect(() => {
    if (!householdIdParam || !households.length) return;
    if (currentHousehold?.id === householdIdParam) return;
    const target = households.find((h) => h.id === householdIdParam);
    if (target) {
      setCurrentHousehold(target);
    }
  }, [householdIdParam, households, currentHousehold?.id, setCurrentHousehold]);

  // Load floor plans
  const loadFloorPlans = useCallback(async (showLoadingIndicator = true) => {
    if (!currentHousehold) return;

    try {
      if (showLoadingIndicator) {
        setLoading(true);
      }
      const response = await floorPlansApi.list(currentHousehold.id);
      console.log('[FloorPlans] Loaded:', response.floor_plans.map(fp => ({ id: fp.id.slice(-8), status: fp.status })));
      setFloorPlans(response.floor_plans);
    } catch (error) {
      console.error('Failed to load floor plans:', error);
      if (showLoadingIndicator) {
        showToast('error', 'Failed to load floor plans');
      }
    } finally {
      if (showLoadingIndicator) {
        setLoading(false);
      }
    }
  }, [currentHousehold, setFloorPlans, setLoading]);

  useEffect(() => {
    loadFloorPlans();
  }, [loadFloorPlans]);

  // Refetch when the screen regains focus — catches floor plans routed by
  // Aihousekeeper via the approvals flow (user flow: Bo chat → approve → back here).
  useFocusEffect(
    useCallback(() => {
      loadFloorPlans(false);
    }, [loadFloorPlans])
  );

  // Auto-refresh for floor plans that need status updates
  useEffect(() => {
    if (!currentHousehold) return;

    // Poll when floor plans are processing OR recently uploaded (awaiting completion)
    const needsPolling = floorPlans.some(fp => 
      fp.status === 'processing' || 
      fp.status === 'uploaded' || 
      fp.status === 'pending_upload'
    );

    if (!needsPolling) return;

    // Poll every 5 seconds for status updates (silently, no loading indicator)
    const interval = setInterval(() => {
      console.log('[FloorPlans] Polling for status updates...');
      loadFloorPlans(false); // Silent update - no loading indicator
    }, 5000);

    return () => clearInterval(interval);
  }, [currentHousehold, floorPlans, loadFloorPlans]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFloorPlans();
    setRefreshing(false);
  }, [loadFloorPlans]);

  // Group floor plans by building
  const groupedFloorPlans = useMemo((): BuildingGroup[] => {
    const groups = new Map<string, FloorPlan[]>();

    floorPlans.forEach((fp) => {
      const building = fp.building_name || 'Uncategorized';
      if (!groups.has(building)) {
        groups.set(building, []);
      }
      groups.get(building)!.push(fp);
    });

    // Sort floor plans within each building by floor number
    groups.forEach((plans) => {
      plans.sort((a, b) => {
        if (a.floor_number === null) return 1;
        if (b.floor_number === null) return -1;
        return a.floor_number - b.floor_number;
      });
    });

    // Convert to array and sort buildings
    return Array.from(groups.entries())
      .map(([buildingName, plans]) => ({
        buildingName,
        floorPlans: plans,
        totalMarkers: 0, // TODO: Load marker counts
      }))
      .sort((a, b) => a.buildingName.localeCompare(b.buildingName));
  }, [floorPlans]);

  // Navigate to floor plan viewer
  const handleViewFloorPlan = useCallback((floorPlan: FloorPlan) => {
    navigation.navigate('FloorPlanViewer', { floorPlanId: floorPlan.id });
  }, [navigation]);

  // Navigate to upload screen
  const handleAddFloorPlan = useCallback(() => {
    navigation.navigate('FloorPlanUpload', undefined);
  }, [navigation]);

  // Delete floor plan
  const handleDelete = useCallback(async (floorPlan: FloorPlan) => {
    if (!currentHousehold || deletingId) return;

    Alert.alert(
      'Delete Floor Plan',
      `Are you sure you want to delete "${floorPlan.floor_label || 'this floor plan'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(floorPlan.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              
              await floorPlansApi.delete(currentHousehold.id, floorPlan.id);
              removeFloorPlan(floorPlan.id);
              showToast('success', 'Floor plan deleted');
              
              // Close swipeable
              swipeableRefs.current.get(floorPlan.id)?.close();
            } catch (error) {
              console.error('Failed to delete floor plan:', error);
              showToast('error', 'Failed to delete floor plan');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }, [currentHousehold, deletingId, removeFloorPlan]);

  // Retry/reprocess floor plan (for stuck uploads)
  const handleRetry = useCallback(async (floorPlan: FloorPlan) => {
    if (!currentHousehold || retryingId) return;

    try {
      setRetryingId(floorPlan.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // For stuck uploads, try to confirm upload again which will now set completed status
      if (floorPlan.status === 'uploaded' || floorPlan.status === 'pending_upload') {
        await floorPlansApi.confirmUpload(currentHousehold.id, floorPlan.id, {
          building_name: floorPlan.building_name || currentHousehold.name,
          floor_number: floorPlan.floor_number ?? undefined,
          floor_label: floorPlan.floor_label ?? undefined,
        });
        showToast('success', 'Floor plan processed successfully');
        await loadFloorPlans(false);
      } else if (floorPlan.status === 'failed') {
        // For failed plans, delete and prompt to re-upload
        showToast('info', 'Please delete and re-upload this floor plan');
      }

      // Close swipeable
      swipeableRefs.current.get(floorPlan.id)?.close();
    } catch (error: any) {
      console.error('Failed to retry floor plan:', error);
      console.log('Error response:', error?.response?.data);
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to process';
      const statusCode = error?.response?.status;
      
      // Handle specific error codes
      if (statusCode === 404 || errorMessage.toLowerCase().includes('not found')) {
        showToast('error', 'File missing from storage. Please delete and re-upload.');
      } else if (statusCode === 403) {
        // 403 means already processed or status changed - always refresh to get latest
        showToast('info', 'Refreshing floor plan status...');
        await loadFloorPlans(false);
      } else {
        showToast('error', `Retry failed: ${errorMessage}`);
      }
      
      // Close swipeable on error too
      swipeableRefs.current.get(floorPlan.id)?.close();
    } finally {
      setRetryingId(null);
    }
  }, [currentHousehold, retryingId, loadFloorPlans]);

  // Render swipe actions
  const renderRightActions = useCallback((
    progress: Animated.AnimatedInterpolation<number>,
    _dragX: Animated.AnimatedInterpolation<number>,
    floorPlan: FloorPlan
  ) => {
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [160, 0],
    });

    const isDeleting = deletingId === floorPlan.id;
    const isRetrying = retryingId === floorPlan.id;
    // Only show retry for statuses where it makes sense
    const showRetry = floorPlan.status === 'uploaded' || 
                      floorPlan.status === 'pending_upload' || 
                      floorPlan.status === 'failed';

    return (
      <Animated.View style={[styles.swipeActions, { transform: [{ translateX }] }]}>
        {/* Retry/Reprocess button */}
        {showRetry && (
          <TouchableOpacity
            style={[
              styles.swipeButton,
              { backgroundColor: colors.warning },
              isRetrying && styles.swipeButtonDisabled,
            ]}
            onPress={() => handleRetry(floorPlan)}
            disabled={isRetrying || isDeleting}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color={colors.backgroundMain} />
            ) : (
              <Icon name="refresh" size={24} color={colors.backgroundMain} />
            )}
            <Typography
              variant="caption1"
              weight="semibold"
              color={colors.backgroundMain}
              style={styles.swipeButtonLabel}
            >
              {isRetrying ? 'Processing...' : 'Retry'}
            </Typography>
          </TouchableOpacity>
        )}

        {/* Delete button */}
        <TouchableOpacity
          style={[
            styles.swipeButton,
            { backgroundColor: colors.error },
            isDeleting && styles.swipeButtonDisabled,
          ]}
          onPress={() => handleDelete(floorPlan)}
          disabled={isDeleting || isRetrying}
          testID={`floor-plan-card-delete-${floorPlan.id}`}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.backgroundMain} />
          ) : (
            <Icon name="trash" size={24} color={colors.backgroundMain} />
          )}
          <Typography
            variant="caption1"
            weight="semibold"
            color={colors.backgroundMain}
            style={styles.swipeButtonLabel}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Typography>
        </TouchableOpacity>
      </Animated.View>
    );
  }, [deletingId, retryingId, handleDelete, handleRetry, colors.backgroundMain, colors.error, colors.warning]);

  // Get status display info
  const getStatusInfo = (
    floorPlan: FloorPlan
  ): { label: string; color: string; icon: IoniconName; showSpinner?: boolean } => {
    switch (floorPlan.status) {
      case 'pending_upload':
        return { label: 'Pending Upload', color: colors.warning, icon: 'hourglass' };
      case 'uploaded':
        return {
          label: 'Uploaded - Awaiting Processing',
          color: colors.primary,
          icon: 'cloud-upload',
        };
      case 'processing':
        return {
          label: floorPlan.processing_stage || 'Processing...',
          color: colors.primary,
          icon: 'settings',
          showSpinner: true,
        };
      case 'completed':
        return { label: 'Ready', color: colors.success, icon: 'checkmark-circle' };
      case 'failed':
        return {
          label: floorPlan.error_message || 'Processing failed',
          color: colors.error,
          icon: 'warning',
        };
      default:
        return { label: floorPlan.status, color: colors.textSecondary, icon: 'help-circle' };
    }
  };

  // Check if floor plan is viewable
  const isViewable = (floorPlan: FloorPlan) => {
    return floorPlan.status === 'completed' && floorPlan.display_image_key;
  };

  useEffect(() => {
    if (isLoading) return;
    if (hasAutoOpenedSinglePlanRef.current) return;
    const viewablePlans = floorPlans.filter(isViewable);
    if (viewablePlans.length !== 1) return;
    hasAutoOpenedSinglePlanRef.current = true;
    navigation.navigate('FloorPlanViewer', { floorPlanId: viewablePlans[0].id });
  }, [floorPlans, isLoading, navigation]);

  // Render floor plan card
  const renderFloorPlanCard = (floorPlan: FloorPlan) => {
    const label = floorPlanDisplayLabel(floorPlan);
    const statusInfo = getStatusInfo(floorPlan);
    const canView = isViewable(floorPlan);

    return (
      <Swipeable
        key={floorPlan.id}
        ref={(ref) => {
          if (ref) {
            swipeableRefs.current.set(floorPlan.id, ref);
          } else {
            swipeableRefs.current.delete(floorPlan.id);
          }
        }}
        renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, floorPlan)}
        overshootRight={false}
        friction={2}
      >
        <GHTouchableOpacity
          onPress={() => canView ? handleViewFloorPlan(floorPlan) : null}
          activeOpacity={canView ? 0.7 : 1}
          testID={`floor-plan-card-${floorPlan.id}`}
        >
          <Card variant="elevated" style={[styles.card, !canView && styles.floorPlanCardDisabled]}>
            {/* Thumbnail */}
            {floorPlan.thumbnail_key ? (
              <Image
                source={{ uri: `${ENV.API_BASE_URL}/files/${floorPlan.thumbnail_key}` }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            ) : (
              <View
                style={[
                  styles.thumbnail,
                  styles.placeholderThumbnail,
                  { backgroundColor: colors.groupedListBackground },
                ]}
              >
                <Icon name="grid-outline" size={24} color={colors.textSecondary} />
              </View>
            )}

            {/* Details */}
            <View style={styles.details}>
              <Typography variant="body" weight="semibold">
                {label}
              </Typography>
              
              {/* Status Badge */}
              <View style={styles.statusBadge}>
                {statusInfo.showSpinner ? (
                  <ActivityIndicator size="small" color={statusInfo.color} />
                ) : (
                  <Icon
                    name={statusInfo.icon}
                    size={14}
                    color={statusInfo.color}
                    style={{ marginRight: Spacing.xs }}
                  />
                )}
                <Typography 
                  variant="caption1" 
                  color={statusInfo.color} 
                  style={styles.statusText}
                  numberOfLines={2}
                >
                  {statusInfo.label}
                </Typography>
              </View>

              {/* File info */}
              <Typography variant="caption1" color={colors.textSecondary} style={styles.fileInfo}>
                {floorPlan.content_type === 'application/pdf' ? 'PDF' : 'Image'} • {Math.round(floorPlan.file_size / 1024)}KB
              </Typography>
            </View>
          </Card>
        </GHTouchableOpacity>
      </Swipeable>
    );
  };

  // Render building group
  // Hide building name header if there's only one building (redundant with property name)
  const renderBuildingGroup = (group: BuildingGroup, showHeader: boolean) => (
    <View key={group.buildingName} style={styles.buildingGroup}>
      {showHeader && (
        <Typography variant="headline" weight="semibold" style={styles.buildingName}>
          {group.buildingName}
        </Typography>
      )}
      <View style={styles.floorPlansList}>
        {group.floorPlans.map(renderFloorPlanCard)}
      </View>
    </View>
  );

  const openHouseholdManagement = useCallback(() => {
    navigation.navigate('HouseholdManagement');
  }, [navigation]);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="floor-plans-screen">
        <ScreenHeader
          title="Floor Plans"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[
              styles.content,
              styles.contentGrow,
              { paddingBottom: insets.bottom + Layout.floatingButtonClearance },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            }
          >
            {isLoading && !refreshing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : groupedFloorPlans.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Icon
                  name="grid-outline"
                  size={EmptyTokens.iconSize}
                  color={colors.textSecondary}
                  style={styles.emptyIcon}
                />
                <Typography variant="title1" weight="semibold" style={styles.emptyTitle}>
                  No Floor Plans Yet
                </Typography>
                <Typography variant="body" color={colors.textSecondary} style={styles.emptyMessage}>
                  Add floor plans to visualize your property and link tasks to specific locations
                </Typography>
              </View>
            ) : (
              <>
                {/* Property Name Header - Tappable */}
                {currentHousehold && (
                  <TouchableOpacity 
                    style={styles.propertyHeader}
                    onPress={openHouseholdManagement}
                    activeOpacity={0.7}
                  >
                    <View style={styles.propertyHeaderContent}>
                      <View style={styles.propertyHeaderText}>
                        <Typography variant="title2" weight="bold">
                          {currentHousehold.name}
                        </Typography>
                        {currentHousehold.address_line1 && (
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {currentHousehold.address_line1}
                            {currentHousehold.city ? `, ${currentHousehold.city}` : ''}
                          </Typography>
                        )}
                      </View>
                      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
                    </View>
                  </TouchableOpacity>
                )}
                {groupedFloorPlans.map((group) => 
                  renderBuildingGroup(group, groupedFloorPlans.length > 1)
                )}
           <ScreenScrollEnd testID={screenScrollEndTestId('floor-plans-screen')} />
                 </>
            )}
          </ScrollView>

          {/* Shared floating pill — same component as every other floating CTA
              in the app; default bottomOffset clears the tab bar. */}
          <FloatingActionButton
            title="Add Floor Plan"
            onPress={handleAddFloorPlan}
            icon="+"
            testID="floor-plans-add-button"
          />
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.lg,
  },
  contentGrow: {
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: EmptyTokens.blockPaddingVertical,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: EmptyTokens.blockPaddingVertical,
  },
  emptyIcon: {
    marginBottom: Spacing.base,
    opacity: EmptyTokens.iconOpacity,
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  propertyHeader: {
    marginBottom: Spacing.lg,
  },
  propertyHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  propertyHeaderText: {
    flex: 1,
  },
  buildingGroup: {
    marginBottom: Spacing.xl,
  },
  buildingName: {
    marginBottom: Spacing.md,
    opacity: 0.7,
  },
  floorPlansList: {
    gap: Layout.cardSpacing,
  },
  floorPlanCard: {
    marginBottom: Spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.smd,
  },
  thumbnail: {
    width: 72,
    height: 56,
    borderRadius: CornerRadius.sm,
    marginRight: Spacing.smd,
  },
  placeholderThumbnail: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  details: {
    flex: 1,
    justifyContent: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xxs,
  },
  statusText: {
    marginLeft: Spacing.xxs,
    flex: 1,
  },
  fileInfo: {
    marginTop: Spacing.xxs,
  },
  floorPlanCardDisabled: {
    opacity: 0.7,
  },
  swipeActions: {
    flexDirection: 'row',
    marginLeft: Spacing.sm,
    gap: Spacing.sm,
  },
  swipeButton: {
    width: 70,
    borderRadius: CornerRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  swipeButtonDisabled: {
    opacity: 0.6,
  },
  swipeButtonLabel: {
    marginTop: Spacing.xs,
  },
});
