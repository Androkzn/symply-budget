import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useNavigation, useRoute, useFocusEffect } from 'expo-router/react-navigation';
import type { RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, Image, Animated, Alert } from 'react-native';
import { Swipeable, TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  gardenPlansApi,
  GardenPlan,
  GardenPlanBoundaryDraft,
  gardenPlanDisplayLabel,
  gardenPlanProvenanceLabel,
  isMapDrawnPlan,
} from '@api/garden-plans';
import { AppBackground, GrowingPlant, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import { canRenderGardenSatellite } from '@components/garden';
import { AdaptiveContainer } from '@components/layout';
import { Typography, FloatingActionButton, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useHouseLedgerTables } from '@features/house/local/useHouseLedgerTables';
import type { GardeningStackParamList } from '@navigation/types';
import { navigateToHouseholds } from '@services/navigation';
import { showToast } from '@services/toastManager';
import { useGardenPlanStore } from '@stores/gardenPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import {Spacing, CornerRadius, Layout, EmptyState as EmptyTokens, useAppColors } from '@theme';

type GardenRoute = RouteProp<GardeningStackParamList, 'GardeningMain'>;
type GardenNav = NativeStackNavigationProp<GardeningStackParamList, 'GardeningMain'>;

/**
 * Pull a user-friendly error string out of an axios error coming from the
 * backend. Backend error envelope is `{ error: { code, message } }`. Falls
 * back to the axios `Error.message` and finally to `defaultMessage`.
 */
function extractApiErrorMessage(error: unknown, defaultMessage: string): string {
  if (typeof error === 'object' && error !== null) {
    const maybeAxios = error as {
      response?: { data?: { error?: { message?: unknown } | string } };
      message?: unknown;
    };
    const apiError = maybeAxios.response?.data?.error;
    if (typeof apiError === 'string' && apiError.trim()) return apiError;
    if (typeof apiError === 'object' && apiError !== null) {
      const apiMsg = (apiError as { message?: unknown }).message;
      if (typeof apiMsg === 'string' && apiMsg.trim()) return apiMsg;
    }
    if (typeof maybeAxios.message === 'string' && maybeAxios.message.trim()) {
      return maybeAxios.message;
    }
  }
  return defaultMessage;
}

export function GardenPlansScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const navigation = useNavigation<GardenNav>();
  const route = useRoute<GardenRoute>();  const insets = useSafeAreaInsets();
  const { currentHousehold, households, setCurrentHousehold } = useHouseholdStore();
  const { gardenPlans, setGardenPlans, setLoading, isLoading, removeGardenPlan } =
    useGardenPlanStore();
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<GardenPlanBoundaryDraft[]>([]);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const draftSwipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const householdIdParam = route.params?.householdId;

  useEffect(() => {
    if (!householdIdParam || !households.length) return;
    if (currentHousehold?.id === householdIdParam) return;
    const target = households.find((h) => h.id === householdIdParam);
    if (target) setCurrentHousehold(target);
  }, [householdIdParam, households, currentHousehold?.id, setCurrentHousehold]);

  const loadGardenPlans = useCallback(
    async (showLoadingIndicator = true) => {
      if (!currentHousehold) return;
      try {
        if (showLoadingIndicator) setLoading(true);
        const plansResponse = await gardenPlansApi.list(currentHousehold.id);
        setGardenPlans(plansResponse.garden_plans);
        try {
          const draftsResponse = await gardenPlansApi.listBoundaryDrafts(currentHousehold.id);
          setPendingDrafts(draftsResponse.boundary_drafts);
        } catch (draftError) {
          console.warn('Failed to load pending garden boundary drafts:', draftError);
          setPendingDrafts([]);
        }
      } catch (error) {
        console.error('Failed to load garden plans:', error);
        if (showLoadingIndicator) showToast('error', 'Failed to load yard plans');
      } finally {
        if (showLoadingIndicator) setLoading(false);
      }
    },
    [currentHousehold, setGardenPlans, setLoading]
  );

  useEffect(() => {
    loadGardenPlans();
  }, [loadGardenPlans]);

  useFocusEffect(
    useCallback(() => {
      loadGardenPlans(false);
    }, [loadGardenPlans])
  );

  /**
   * Repaint when the member's OTHER device writes.
   *
   * `useFocusEffect` above fires when you arrive on this screen, not when the
   * data moves while you are standing on it. With an iPhone and an iPad on the
   * same household, a plan created or deleted on one used to sit invisible on
   * the other until the member navigated away and back — the rows had synced,
   * only the list was stale, which looks like nothing being wrong at all.
   *
   * Silent reload (`false`): a peer's write is not a reason to throw a spinner
   * over a list the member is reading.
   */
  useHouseLedgerTables(
    ['gardenPlans', 'gardenPlanObjects', 'gardenPlanBoundaryDrafts'],
    () => loadGardenPlans(false),
    { householdId: currentHousehold?.id ?? null },
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGardenPlans();
    setRefreshing(false);
  }, [loadGardenPlans]);

  const handleView = useCallback(
    (plan: GardenPlan) => {
      navigation.navigate('GardenPlanViewer', { gardenPlanId: plan.id });
    },
    [navigation]
  );

  const handleAdd = useCallback(() => {
    navigation.navigate('GardenPlanUpload');
  }, [navigation]);

  const handleOpenDraft = useCallback(
    (draft: GardenPlanBoundaryDraft) => {
      navigation.navigate('GardenPlanBoundaryConfirm', { draftId: draft.id });
    },
    [navigation]
  );

  const handleDelete = useCallback(
    (plan: GardenPlan) => {
      if (!currentHousehold || deletingId) return;
      Alert.alert(
        'Delete Yard Plan',
        `Are you sure you want to delete "${gardenPlanDisplayLabel(plan)}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                setDeletingId(plan.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await gardenPlansApi.delete(currentHousehold.id, plan.id);
                removeGardenPlan(plan.id);
                showToast('success', 'Yard plan deleted');
                swipeableRefs.current.get(plan.id)?.close();
              } catch (error) {
                console.error('Failed to delete yard plan:', error);
                showToast('error', 'Failed to delete yard plan');
              } finally {
                setDeletingId(null);
              }
            },
          },
        ]
      );
    },
    [currentHousehold, deletingId, removeGardenPlan]
  );

  const handleDeleteDraft = useCallback(
    (draft: GardenPlanBoundaryDraft) => {
      if (!currentHousehold || deletingDraftId) return;
      Alert.alert(
        'Delete Boundary Draft',
        `Delete the saved boundary for ${draft.formatted_address}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                setDeletingDraftId(draft.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await gardenPlansApi.deleteBoundaryDraft(currentHousehold.id, draft.id);
                setPendingDrafts((drafts) => drafts.filter((item) => item.id !== draft.id));
                showToast('success', 'Boundary draft deleted');
                draftSwipeableRefs.current.get(draft.id)?.close();
              } catch (error) {
                console.error('Failed to delete boundary draft:', error);
                showToast('error', 'Failed to delete boundary draft');
              } finally {
                setDeletingDraftId(null);
              }
            },
          },
        ]
      );
    },
    [currentHousehold, deletingDraftId]
  );

  const renderRightActions = useCallback(
    (
      progress: Animated.AnimatedInterpolation<number>,
      _dragX: Animated.AnimatedInterpolation<number>,
      plan: GardenPlan
    ) => {
      const translateX = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [80, 0],
      });
      const isDeleting = deletingId === plan.id;
      return (
        <Animated.View style={[styles.swipeActions, { transform: [{ translateX }] }]}>
          <TouchableOpacity
            style={[
              styles.swipeButton,
              { backgroundColor: colors.error },
              isDeleting && styles.swipeButtonDisabled,
            ]}
            onPress={() => handleDelete(plan)}
            disabled={isDeleting}
            testID={`garden-plan-card-delete-${plan.id}`}
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
    },
    [deletingId, handleDelete, colors.backgroundMain, colors.error]
  );

  const renderDraftRightActions = useCallback(
    (
      progress: Animated.AnimatedInterpolation<number>,
      _dragX: Animated.AnimatedInterpolation<number>,
      draft: GardenPlanBoundaryDraft
    ) => {
      const translateX = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [80, 0],
      });
      const isDeleting = deletingDraftId === draft.id;
      return (
        <Animated.View style={[styles.swipeActions, { transform: [{ translateX }] }]}>
          <TouchableOpacity
            style={[
              styles.swipeButton,
              { backgroundColor: colors.error },
              isDeleting && styles.swipeButtonDisabled,
            ]}
            onPress={() => handleDeleteDraft(draft)}
            disabled={isDeleting}
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
    },
    [deletingDraftId, handleDeleteDraft, colors.backgroundMain, colors.error]
  );

  const openHouseholdManagement = useCallback(() => {
    navigateToHouseholds();
  }, []);

  const handleCancelGeneration = useCallback(
    async (plan: GardenPlan) => {
      if (!currentHousehold) return;
      try {
        setDeletingId(plan.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await gardenPlansApi.cancelGeneration(currentHousehold.id, plan.id);
        await loadGardenPlans(false);
        showToast('success', 'Generation cancelled');
      } catch (error) {
        console.error('Failed to cancel generation:', error);
        showToast('error', extractApiErrorMessage(error, 'Could not cancel'));
      } finally {
        setDeletingId(null);
      }
    },
    [currentHousehold, loadGardenPlans]
  );

  const handleRetryGeneration = useCallback(
    async (plan: GardenPlan) => {
      if (!currentHousehold) return;
      try {
        setDeletingId(plan.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await gardenPlansApi.retryGeneration(currentHousehold.id, plan.id);
        await loadGardenPlans(false);
        showToast('success', 'Retrying — we’ll notify you when it’s ready');
      } catch (error) {
        console.error('Failed to retry generation:', error);
        showToast('error', extractApiErrorMessage(error, 'Could not retry'));
      } finally {
        setDeletingId(null);
      }
    },
    [currentHousehold, loadGardenPlans]
  );

  const handleGeneratingTap = useCallback(
    (plan: GardenPlan) => {
      Alert.alert(
        'Still generating',
        "Your plan is still being drawn. We'll notify you when it's ready (usually 15–30 seconds).",
        [
          {
            text: 'Cancel generation',
            style: 'destructive',
            onPress: () => handleCancelGeneration(plan),
          },
          {
            text: 'Retry now',
            onPress: () => handleRetryGeneration(plan),
          },
          { text: 'OK', style: 'cancel' },
        ]
      );
    },
    [handleCancelGeneration, handleRetryGeneration]
  );

  const handleFailedTap = useCallback(
    (plan: GardenPlan) => {
      const reason = plan.error_message ?? 'Image generation failed.';
      Alert.alert("Couldn't generate plan", reason, [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDelete(plan),
        },
        {
          text: 'Retry',
          onPress: () => handleRetryGeneration(plan),
        },
        { text: 'OK', style: 'cancel' },
      ]);
    },
    [handleDelete, handleRetryGeneration]
  );

  const renderCard = (plan: GardenPlan) => {
    const label = gardenPlanDisplayLabel(plan);
    const isGenerating = plan.status === 'generating';
    const isFailed = plan.status === 'failed';
    // A plan is openable when it has something to DRAW: an uploaded picture, or
    // a boundary the viewer can put satellite tiles behind. Testing
    // `display_image_key` alone predated map-drawn plans and would render every
    // one of them as a greyed-out card that does nothing when tapped — the plan
    // is complete and perfectly viewable, it simply has no bytes.
    const canView =
      plan.status === 'completed' &&
      (!!plan.display_image_key || canRenderGardenSatellite(plan.boundary_geojson));
    const onPress = canView
      ? () => handleView(plan)
      : isGenerating
        ? () => handleGeneratingTap(plan)
        : isFailed
          ? () => handleFailedTap(plan)
          : undefined;
    return (
      <Swipeable
        key={plan.id}
        ref={(ref) => {
          if (ref) swipeableRefs.current.set(plan.id, ref);
          else swipeableRefs.current.delete(plan.id);
        }}
        renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, plan)}
        overshootRight={false}
        friction={2}
      >
        <GHTouchableOpacity
          onPress={onPress}
          activeOpacity={onPress ? 0.7 : 1}
          testID={`garden-plan-card-${plan.id}`}
        >
          <Card variant="elevated" style={[styles.card, !canView && styles.cardDisabled]}>
            {plan.thumbnail_key && canView ? (
              <Image
                source={{ uri: `${ENV.API_BASE_URL}/files/${plan.thumbnail_key}` }}
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
                {isGenerating ? (
                  <GrowingPlant size={32} />
                ) : (
                  <Icon
                    name={isFailed ? 'warning' : 'leaf'}
                    size={24}
                    color={isFailed ? colors.error : colors.textSecondary}
                  />
                )}
              </View>
            )}
            <View style={styles.details}>
              <Typography variant="body" weight="semibold">
                {label}
              </Typography>
              <Typography
                variant="caption1"
                color={
                  isFailed ? colors.error : colors.textSecondary
                }
                style={styles.fileInfo}
              >
                {isGenerating
                  ? 'Generating…'
                  : isFailed
                    ? plan.error_message ?? "Couldn't generate"
                    : gardenPlanCaption(plan)}
              </Typography>
            </View>
          </Card>
        </GHTouchableOpacity>
      </Swipeable>
    );
  };

  const renderPendingDraftCard = (draft: GardenPlanBoundaryDraft) => (
    <Swipeable
      key={draft.id}
      ref={(ref) => {
        if (ref) draftSwipeableRefs.current.set(draft.id, ref);
        else draftSwipeableRefs.current.delete(draft.id);
      }}
      renderRightActions={(progress, dragX) => renderDraftRightActions(progress, dragX, draft)}
      overshootRight={false}
      friction={2}
    >
      <GHTouchableOpacity
        activeOpacity={0.75}
        onPress={() => handleOpenDraft(draft)}
      >
        <Card variant="elevated" style={styles.card}>
          {draft.preview_image_url ? (
            <Image
              source={{ uri: draft.preview_image_url }}
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
              <Icon name="map" size={24} color={colors.textSecondary} />
            </View>
          )}
          <View style={styles.details}>
            <Typography variant="body" weight="semibold">
              Review saved boundary
            </Typography>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.fileInfo}
              numberOfLines={2}
            >
              {draft.formatted_address}
            </Typography>
            <Typography
              variant="caption1"
              color={colors.primary}
              style={styles.fileInfo}
            >
              {draft.status === 'confirmed'
                ? 'Boundary saved • Continue generation'
                : 'Boundary draft • Review and save'}
            </Typography>
          </View>
        </Card>
      </GHTouchableOpacity>
    </Swipeable>
  );

  const renderPlanContent = () => {
    const hasPlans = gardenPlans.length > 0;
    const hasPendingDrafts = pendingDrafts.length > 0;

    if (!hasPlans && !hasPendingDrafts) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="leaf" size={EmptyTokens.iconSize} color={colors.textSecondary} style={styles.emptyIcon} />
          <Typography variant="title1" weight="semibold" style={styles.emptyTitle}>
            No Yard Plans Yet
          </Typography>
          <Typography
            variant="body"
            color={colors.textSecondary}
            style={styles.emptyMessage}
          >
            Trace your lot on the map — or add a photo or sketch — then mark the front
            yard, back yard and beds and pin mowing, irrigation and fence repairs to the
            right spot
          </Typography>
        </View>
      );
    }

    return (
      <>
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
              <Typography variant="body" color={colors.textSecondary}>
                ›
              </Typography>
            </View>
          </TouchableOpacity>
        )}

        {hasPlans && <View style={styles.list}>{gardenPlans.map(renderCard)}</View>}

        {hasPendingDrafts && (
          <View style={styles.pendingSection}>
            <Typography variant="headline" color={colors.textPrimary}>
              Pending boundaries
            </Typography>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.pendingSectionCopy}
            >
              Saved boundaries waiting for garden plan generation.
            </Typography>
            <View style={styles.list}>{pendingDrafts.map(renderPendingDraftCard)}</View>
          </View>
        )}
      </>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="garden-plans-screen">
        <ScreenHeader
          title="Garden"
          showBackButton={router.canGoBack()}
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
          rightElement={<SettingsGearButton />}
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
            ) : (
              renderPlanContent()
            )}
            <ScreenScrollEnd testID={screenScrollEndTestId('garden-plans-screen')} />
          </ScrollView>

          {/* Shared floating pill — same component as every other floating CTA
              in the app; default bottomOffset clears the tab bar. */}
          <FloatingActionButton
            title="Add Yard or Garden Plan"
            onPress={handleAdd}
            icon="+"
            testID="garden-plans-add-button"
          />
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

/**
 * The card's second line: where the plan came from, and what kind of file it is.
 *
 * A MAP-DRAWN plan has no file, so it gets no format suffix. The suffix used to
 * fall through a ternary whose last branch was `'Image'`, which labelled a plan
 * with no bytes at all "Drawn on the map • Image" — a format that does not
 * exist, appended to a provenance that already says everything there is to say.
 */
function gardenPlanCaption(plan: GardenPlan): string {
  const provenance = gardenPlanProvenanceLabel(plan);
  if (isMapDrawnPlan(plan)) return provenance;
  const format =
    plan.content_type === 'application/pdf'
      ? 'PDF'
      : plan.content_type === 'image/svg+xml'
        ? 'Vector'
        : 'Image';
  return `${provenance} • ${format}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.lg },
  contentGrow: { flexGrow: 1 },
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
  emptyIcon: { marginBottom: Spacing.base },
  emptyTitle: { marginBottom: Spacing.sm, textAlign: 'center' },
  emptyMessage: {
    textAlign: 'center',
    paddingHorizontal: Spacing.xxl,
    maxWidth: Layout.emptyStateCopyMaxWidth,
  },
  propertyHeader: { marginBottom: Spacing.lg },
  propertyHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  propertyHeaderText: { flex: 1 },
  list: { gap: Layout.cardSpacing },
  pendingSection: {
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  pendingSectionCopy: {
    marginTop: -Spacing.xs,
    marginBottom: Spacing.xs,
  },
  card: { flexDirection: 'row', alignItems: 'center', padding: Spacing.smd },
  cardDisabled: { opacity: 0.7 },
  thumbnail: {
    width: 72,
    height: 56,
    borderRadius: CornerRadius.sm,
    marginRight: Spacing.smd,
  },
  placeholderThumbnail: { justifyContent: 'center', alignItems: 'center' },
  details: { flex: 1, justifyContent: 'center' },
  fileInfo: { marginTop: Spacing.xxs },
  swipeActions: { flexDirection: 'row', marginLeft: Spacing.sm, gap: Spacing.sm },
  swipeButton: {
    width: 70,
    borderRadius: CornerRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  swipeButtonDisabled: { opacity: 0.6 },
  swipeButtonLabel: { marginTop: Spacing.xs },
});
