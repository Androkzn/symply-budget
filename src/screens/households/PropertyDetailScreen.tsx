import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { householdsApi } from '@api/households';
import { SafeAreaView, AppBackground, ScreenHeader } from '@components/common';
import { HousePropertyPhoto } from '@components/house-v2/HousePropertyPhoto';
import { Button, Card, FilterTabs, Typography } from '@components/ui';
import type { FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import { utilitiesApi, type PropertyInsights } from '@features/utilities/api/utilities';
import type { SettingsStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { Spacing, CornerRadius, IconSize, useAppColors } from '@theme';

import { PropertyAssessmentTab } from './property-tabs/PropertyAssessmentTab';
import { PropertyMembersTab } from './property-tabs/PropertyMembersTab';
import { PropertyOverviewTab } from './property-tabs/PropertyOverviewTab';
import { PropertyTaxTab } from './property-tabs/PropertyTaxTab';

type TabId = 'overview' | 'tax' | 'assessment' | 'members';

interface MenuAction {
  label: string;
  destructive?: boolean;
  run: () => void;
}

/**
 * Property-level actions live behind the header's "…" rather than as buttons in
 * the hero card. The hero's job is to say WHICH property this is and whether it
 * is the active one; the acts you can perform on it — including the destructive
 * one — belong in the one place a member looks for screen-level actions.
 *
 * Presented as a native action sheet on iOS (an ordered list with a real
 * destructive style) and as an Alert on Android, matching HomeProjectHubScreen.
 */
function presentActionMenu(title: string, actions: MenuAction[]) {
  if (Platform.OS === 'ios') {
    const options = [...actions.map((a) => a.label), 'Cancel'];
    const destructiveButtonIndex = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options,
        cancelButtonIndex: options.length - 1,
        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
      },
      (index) => {
        if (index >= 0 && index < actions.length) actions[index].run();
      }
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...actions.map((a) => ({
      text: a.label,
      onPress: a.run,
      style: a.destructive ? ('destructive' as const) : undefined,
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

export function PropertyDetailScreen({
  navigation,
  route,
}: SettingsStackScreenProps<'PropertyDetail'>) {
  const { householdId, initialTab } = route.params;  const colors = useAppColors();
  const { refreshActivePropertyData } = useData();
  const { households, currentHousehold, setCurrentHousehold, removeHousehold } =
    useHouseholdStore();

  const liveHousehold = households.find((h) => h.id === householdId) || null;

  /**
   * The row is gone from the store the instant it is deleted, one render before
   * we leave. Rendering off the last copy we held keeps that frame showing the
   * property the user is leaving instead of a nameless, memberless husk.
   */
  const lastHouseholdRef = useRef(liveHousehold);
  if (liveHousehold) lastHouseholdRef.current = liveHousehold;
  const household = liveHousehold ?? lastHouseholdRef.current;

  const isActive = currentHousehold?.id === householdId;
  const isOwner = household?.my_role === 'owner';

  const [activeTab, setActiveTab] = useState<TabId>(initialTab || 'overview');
  const [insights, setInsights] = useState<PropertyInsights | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInsights = useCallback(async () => {
    try {
      const data = await utilitiesApi.getPropertyInsights(householdId);
      setInsights(data);
    } catch (error) {
      console.error('[PropertyDetail] insights error:', error);
    }
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      loadInsights();
    }, [loadInsights])
  );

  /**
   * Both the "gone now" watcher and the delete/leave handlers want this screen
   * off the stack, and after a delete BOTH fire — the store update re-renders
   * the watcher while the handler is still awaiting. Funnelling them through one
   * latch keeps that from unwinding two screens deep.
   *
   * The destination is My Properties by name, not `goBack()`: a property that no
   * longer exists has no screen it is guaranteed to sit above (a deep link can
   * land here with nothing beneath it, and goBack is then a no-op that strands
   * the user on a property that isn't there any more).
   *
   * `popTo`, not `navigate` — under React Navigation 7 `navigate` MOVES the
   * existing list route to the top of the stack, which would leave the deleted
   * property sitting underneath it as the back destination. `popTo` unwinds to
   * the list, and substitutes it when it isn't in the stack at all.
   */
  const dismissedRef = useRef(false);
  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    navigation.popTo('HouseholdManagement');
  }, [navigation]);

  /**
   * If the property goes away — deleted here, deleted on another device, or
   * revoked — don't strand the user on it.
   *
   * Two ways to know it is gone rather than merely not loaded yet: the store
   * holds OTHER rows and not this one, or we held this row and then lost it.
   * The second clause is what covers deleting the LAST property: that empties
   * the store, so the first clause alone left the user on a husk of a screen.
   */
  const sawHouseholdRef = useRef(false);
  if (liveHousehold) sawHouseholdRef.current = true;
  useEffect(() => {
    if (liveHousehold) return;
    if (households.length > 0 || sawHouseholdRef.current) {
      dismiss();
    }
  }, [liveHousehold, households.length, dismiss]);

  const handleSetActive = useCallback(async () => {
    if (isActive || !household) return;
    setBusy(true);
    try {
      setCurrentHousehold(household);
      await refreshActivePropertyData();
    } catch (error) {
      console.error('[PropertyDetail] switch error:', error);
    } finally {
      setBusy(false);
    }
  }, [isActive, household, setCurrentHousehold, refreshActivePropertyData]);

  /**
   * Delete (owner) and Leave (member) are the same act under different words:
   * this account gives up the property. Both drop the row locally and hand the
   * active slot to whatever remains, mirroring HouseholdManagementScreen — the
   * other surface that owns these two calls — so the two cannot drift apart.
   */
  const giveUpProperty = useCallback(
    async (mode: 'delete' | 'leave') => {
      if (!household) return;
      setBusy(true);
      try {
        if (mode === 'delete') {
          await householdsApi.delete(household.id);
        } else {
          await householdsApi.leave(household.id);
        }
        removeHousehold(household.id);

        // Hand the active slot to a survivor before leaving, so the list we
        // return to isn't reading a property this account no longer holds. A
        // failure to refresh that survivor is not a reason to keep the user on
        // a property that is already gone — hence its own catch.
        if (isActive) {
          const next = households.find((h) => h.id !== household.id);
          if (next) {
            setCurrentHousehold(next);
            try {
              await refreshActivePropertyData();
            } catch (refreshError) {
              console.error('[PropertyDetail] post-delete refresh error:', refreshError);
            }
          }
        }
        dismiss();
      } catch (error) {
        console.error(`[PropertyDetail] ${mode} error:`, error);
        Alert.alert(
          'Error',
          error instanceof Error
            ? error.message
            : `Failed to ${mode} property. Please try again.`
        );
      } finally {
        setBusy(false);
      }
    },
    [
      household,
      isActive,
      households,
      removeHousehold,
      setCurrentHousehold,
      refreshActivePropertyData,
      dismiss,
    ]
  );

  const confirmGiveUpProperty = useCallback(() => {
    if (!household) return;
    if (isOwner) {
      Alert.alert(
        'Delete Property',
        `Are you sure you want to delete "${household.name}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              giveUpProperty('delete');
            },
          },
        ]
      );
      return;
    }
    Alert.alert(
      'Leave Property',
      `Are you sure you want to leave "${household.name}"? You'll lose access until you're invited back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            giveUpProperty('leave');
          },
        },
      ]
    );
  }, [household, isOwner, giveUpProperty]);

  const openActionsMenu = useCallback(() => {
    if (!household) return;
    const actions: MenuAction[] = [];
    // Omitted rather than disabled when it is already the active property:
    // an action sheet has no disabled state, and a no-op row reads as broken.
    if (!isActive) {
      actions.push({
        label: 'Set active',
        run: () => {
          handleSetActive();
        },
      });
    }
    actions.push({
      label: 'Edit details',
      run: () => navigation.navigate('HouseholdManagement', { editHouseholdId: householdId }),
    });
    actions.push({
      label: isOwner ? 'Delete property' : 'Leave property',
      destructive: true,
      run: confirmGiveUpProperty,
    });
    presentActionMenu(household.name, actions);
  }, [
    household,
    isActive,
    isOwner,
    householdId,
    navigation,
    handleSetActive,
    confirmGiveUpProperty,
  ]);

  const memberCount = household?.member_count ?? 0;
  const tabs: FilterTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tax', label: 'Property Tax' },
    { id: 'assessment', label: 'Assessment' },
    { id: 'members', label: 'Members', count: memberCount },
  ];

  const addressLine = [household?.city, household?.state_province].filter(Boolean).join(', ');

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title={household?.name || 'Property'}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          liveHousehold ? (
            <TouchableOpacity
              onPress={openActionsMenu}
              disabled={busy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Property actions"
              testID="property-detail-menu"
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="ellipsis-horizontal" size={IconSize.lg} color={colors.textPrimary} />
              )}
            </TouchableOpacity>
          ) : undefined
        }
      />
      <SafeAreaView edges={[]} testID="property-detail-screen">
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          testID="property-detail-scroll"
        >
          {/* Hero */}
          <Card
            variant="filled"
            style={[styles.hero, { backgroundColor: colors.backgroundSecondary }]}
            testID="property-detail-hero"
          >
            <View style={styles.heroTop}>
              {/*
                `photo_url` alone renders NOTHING on a local-first home. The
                bytes are AES-GCM sealed in R2 under H6 and `photo_key` is the
                synthetic `lf-blob/<blobId>` form, so the URL the Worker signs
                from it points at an object it never wrote — a broken image over
                a photo that is present, synced and openable. `HousePropertyPhoto`
                is the component that knows all three routes (picked file,
                descriptor, signed URL) and picks in that order.
              */}
              <HousePropertyPhoto
                household={household}
                width={72}
                borderRadius={CornerRadius.md}
                iconSize={32}
                style={{ backgroundColor: colors.groupedListBackground }}
                testID="property-detail-photo"
              />
              <View style={styles.heroInfo}>
                <Typography variant="headline" weight="bold" color={colors.textPrimary}>
                  {household?.name}
                </Typography>
                {!!household?.address_line1 && (
                  <Typography variant="footnote" color={colors.textSecondary}>
                    {household.address_line1}
                  </Typography>
                )}
                {!!addressLine && (
                  <Typography variant="footnote" color={colors.textSecondary}>
                    {addressLine}
                  </Typography>
                )}
                <Typography variant="caption2" color={colors.textTertiary}>
                  {memberCount} {memberCount === 1 ? 'member' : 'members'} · {household?.my_role}
                </Typography>
              </View>
              {/* Active state and the act of switching occupy the same slot:
                  the pill when this IS the active property, and a real button
                  when it isn't. Burying "Set active" in the header "…" alone
                  left the single most likely reason to open a non-active
                  property with no visible affordance on the property itself. */}
              {isActive ? (
                <View style={[styles.activeBadge, { backgroundColor: colors.primary + '22' }]}>
                  <Typography variant="caption2" weight="semibold" color={colors.primary}>
                    Active
                  </Typography>
                </View>
              ) : (
                <Button
                  title="Set active"
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  disabled={busy}
                  onPress={handleSetActive}
                  accessibilityLabel="Set active"
                  testID="property-detail-set-active"
                />
              )}
            </View>
          </Card>

          {/* Tabs */}
          <View style={styles.tabs}>
            <FilterTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(id) => setActiveTab(id as TabId)}
              scrollable
            />
          </View>

          {/* Active tab body */}
          <View style={styles.body}>
            {activeTab === 'overview' && (
              <PropertyOverviewTab
                insights={insights}
                onGoToTax={() => setActiveTab('tax')}
                onGoToAssessment={() => setActiveTab('assessment')}
              />
            )}
            {activeTab === 'tax' && (
              <PropertyTaxTab householdId={householdId} onChanged={loadInsights} />
            )}
            {activeTab === 'assessment' && (
              <PropertyAssessmentTab householdId={householdId} onChanged={loadInsights} />
            )}
            {activeTab === 'members' && (
              <PropertyMembersTab
                householdId={householdId}
                onManage={() => navigation.navigate('HouseholdMembers', { householdId })}
              />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.xl, paddingBottom: 120 },
  hero: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    gap: Spacing.base,
    marginBottom: Spacing.lg,
  },
  heroTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  heroInfo: { flex: 1, gap: 2 },
  activeBadge: {
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.full,
  },
  tabs: { marginBottom: Spacing.lg },
  body: { minHeight: 200 },
});
