import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { BudgetHouseholdMembersCard } from '@features/budget/components/BudgetHouseholdMembersCard';
import {
  BudgetHouseholdSwitcherCard,
  type BudgetHouseholdChoice,
} from '@features/budget/components/BudgetHouseholdSwitcherCard';
import { BudgetJoinRequestsPanel } from '@features/budget/components/BudgetJoinRequestsPanel';
import { BudgetJoinWaitingPanel } from '@features/budget/components/BudgetJoinWaitingPanel';
import { BudgetMembershipLossPanel } from '@features/budget/components/BudgetMembershipLossPanel';
import { BudgetSyncProgressPanel } from '@features/budget/components/BudgetSyncProgressPanel';
import {
  activateLocalBudgetHousehold,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { takePendingBudgetInvite } from '@features/budget/local/inviteLinkStore';
import { useBudgetJoinRequests } from '@features/budget/local/useBudgetJoinRequests';
import { useBudgetJoinWait } from '@features/budget/local/useBudgetJoinWait';
import type { BudgetStackParamList } from '@navigation/types';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

/**
 * Budget → **Invite & Household**. The hub for everything about the people you
 * share a budget with.
 *
 * It used to be two collapsible sections — Invite and Join — stacked on one
 * scrolling screen, with the households themselves living somewhere else
 * entirely (More → Household & Members). Three problems, all of them the same
 * problem:
 *
 *  - a **disclosure triangle is not a destination**. Everything inside a closed
 *    section is invisible to the eye, to a screen reader and to a UI test, and
 *    the person arriving had to know which triangle was theirs before they
 *    could see anything at all;
 *  - the two halves are for **two different people** — the owner handing an
 *    invite over, and the invitee accepting one — so stacking them meant every
 *    arrival scrolled past a form addressed to somebody else;
 *  - the **households** — the thing all of this is about — were a screen in
 *    another part of the app, so "who is in this?" and "which budget is this?"
 *    were answered two navigation trees apart.
 *
 * So: three rows that PUSH, in the order the questions get asked — who is here
 * (inline, because it is the answer, not a task), then invite / join / manage.
 * A pushed screen has a title, a back button and an animation that says where
 * you went, none of which a collapsing panel has.
 *
 * The two live states stay HERE as well as on their own screens, because each
 * is somebody's turn: a pending join request is waiting on the owner, and a
 * claimed invite is the invitee waiting to be let in. Both are what a push
 * notification brings someone here to see, and a hub that showed no trace of it
 * would be the worst possible landing.
 */

/** A row that goes somewhere — the replacement for the collapsing section. */
function NavRow({
  testID,
  icon,
  title,
  summary,
  badge,
  onPress,
}: {
  testID: string;
  icon: string;
  title: string;
  summary: string;
  /** Optional state the row itself carries, e.g. "2 households". */
  badge?: string | null;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${summary}`}
      testID={testID}
    >
      <Icon name={icon} forceIonicons size={IconSize.lg} color={colors.primary} />
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Typography variant="headline" weight="semibold">
            {title}
          </Typography>
          {badge ? (
            <Typography variant="caption2" color={colors.primary} weight="semibold">
              {badge}
            </Typography>
          ) : null}
        </View>
        <Typography variant="caption2" color={colors.textSecondary}>
          {summary}
        </Typography>
      </View>
      <Icon name="chevron-forward" forceIonicons size={IconSize.md} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

/**
 * The households this device holds, re-read when the engine changes.
 *
 * Synchronous and cold-safe — `listLocalBudgetHouseholds` reads only
 * cold-session fields, so no household is hydrated to answer it — which is what
 * makes it safe on a render path. Subscribed rather than read once: joining
 * ADDS one and switching changes which is active, both underneath this screen.
 */
function useHeldHouseholds() {
  const [, bump] = useState(0);
  useEffect(() => subscribeToLedgerChanges(bump), []);
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return [];
  return listLocalBudgetHouseholds();
}

export function BudgetInviteScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();

  const joinRequests = useBudgetJoinRequests();
  const wait = useBudgetJoinWait();
  const households = useHeldHouseholds();

  /**
   * A tapped invite link, handed straight to the screen that can act on it.
   *
   * The link carries the code and the secret, and the invitee's only remaining
   * act is agreeing to the household it names. Taking them to Join with the
   * fields already filled is the least this owes somebody it just summoned —
   * the alternative is landing them on a hub with no sign of why they are here.
   * Nothing is claimed by the navigation itself: the confirmation on the other
   * side is what enrols, so a link forwarded into a group chat still cannot
   * enrol whoever tapped it first.
   */
  useFocusEffect(
    useCallback(() => {
      const pending = takePendingBudgetInvite();
      if (!pending) return;
      navigation.navigate('BudgetJoin', { code: pending.code, secret: pending.secret });
    }, [navigation]),
  );

  const householdBadge =
    households.length > 1 ? `${households.length} on this device` : null;

  /**
   * The engine's summaries, flattened for the card at the top.
   *
   * `householdId` rather than `id` is the engine's own field name
   * (`listLocalBudgetHouseholds`), and everything downstream of this screen —
   * navigation params, the edit sheet — speaks in `id`. Translating once here
   * keeps that seam in one place.
   */
  const householdChoices = useMemo<BudgetHouseholdChoice[]>(
    () =>
      households.map((household) => ({
        id: household.householdId,
        name: household.name,
        role: household.role,
        isActive: household.isActive,
      })),
    [households],
  );

  /**
   * Move the engine, and only the engine.
   *
   * `ensureSession` follows ledger changes and republishes `householdStore`, so
   * activation is the whole switch — writing the store here as well would put a
   * second author on a value the engine owns. Failure is realistically
   * `BudgetLocalUnknownHouseholdError`: a household listed from a registry entry
   * that outlived its ledger. Saying so and staying put beats leaving the hub
   * naming a household the engine never moved to.
   */
  const handleSelectHousehold = useCallback(async (householdId: string) => {
    try {
      await activateLocalBudgetHousehold(householdId);
    } catch (error) {
      console.warn('[budget-invite] could not switch household', householdId, error);
      Alert.alert(
        'Could not switch',
        'That household is not available on this device. Open Households to refresh the list, then try again.',
      );
    }
  }, []);

  /**
   * One household's own page — photo, name, address, people, and the exits.
   *
   * Named by id rather than left to "whatever is active": the picker can push a
   * BACKGROUND household here, and the edit screen edits the household it was
   * given (offering to switch to it) instead of quietly editing the other one.
   */
  const handleEditHousehold = useCallback(
    (householdId: string) => {
      navigation.navigate('BudgetHouseholdEdit', { householdId });
    },
    [navigation],
  );

  /**
   * Pull to re-ask both sides of the hand-off.
   *
   * Its own `pulling` flag rather than the hook's `isChecking`: that one also
   * flips for the ten-second poll, which would spin the control by itself every
   * ten seconds and make the screen look like it is loading when nobody asked.
   *
   * Both halves are refreshed because this screen shows both — the owner's
   * waiting-to-join list AND this device's own wait — and someone who pulls
   * because "nothing is happening" cannot be expected to know which half of the
   * exchange they are on.
   */
  const [pulling, setPulling] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await Promise.all([joinRequests.refresh(), wait.refresh()]);
    } finally {
      setPulling(false);
    }
  }, [joinRequests, wait]);

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-invite-screen">
        <ScreenHeader
          title="Invite & Household"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={onPullRefresh}
              tintColor={colors.textSecondary}
            />
          }
        >
          {/* Whoever's turn it is, first. All three render nothing when there
              is nothing waiting, so the ordinary screen starts at the intro.
              The membership notice leads: it is the only one of the three that
              reports something already DONE and irreversible, and this screen
              is where the removal notification lands. */}
          <BudgetMembershipLossPanel />
          <BudgetJoinRequestsPanel {...joinRequests} />
          <BudgetJoinWaitingPanel {...wait} />
          {/* Last of the four: it reports work in flight rather than something
              needing an answer, so it must not push a request or a wait down. */}
          <BudgetSyncProgressPanel />

          <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
            Share a budget with someone. They scan a code; you approve their device before it can
            see anything.
          </Typography>

          {/* WHICH household, before WHO is in it. The member list underneath
              is a list of people in something, and until this card that
              something was named nowhere above the fold. */}
          <BudgetHouseholdSwitcherCard
            households={householdChoices}
            onSelect={handleSelectHousehold}
            onEdit={handleEditHousehold}
            onManage={() => navigation.navigate('BudgetHouseholds')}
          />

          {/* Who is already here, before any of the tasks. This screen is
              reached by asking about a household, so opening on rows about
              inviting somebody answered a question nobody had asked yet. */}
          <BudgetHouseholdMembersCard />

          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            MANAGE
          </Typography>

          <NavRow
            testID="budget-invite-section-invite"
            icon="qr-code-outline"
            title="Invite"
            summary="Show a QR code for someone to scan, then approve their device"
            onPress={() => navigation.navigate('BudgetInviteCreate')}
          />

          <NavRow
            testID="budget-invite-section-join"
            icon="scan-outline"
            title="Join"
            summary={
              // The outcome outranks the wait, and must: the row went on
              // saying "waiting for them to approve this device" directly
              // underneath a banner saying the invite had expired, which
              // reads as the screen not knowing which of the two is true.
              wait.outcome
                ? wait.outcome === 'revoked'
                  ? 'That invite was cancelled — join again with a new one'
                  : wait.outcome === 'expired'
                    ? 'That invite expired — join again with a new one'
                    : 'You were removed from that household — join again with a new invite'
                : wait.awaiting
                  ? 'Waiting for them to approve this device'
                  : "Add someone else's household to this device — scan their QR code, or enter the invite by hand"
            }
            onPress={() => navigation.navigate('BudgetJoin')}
          />

          <NavRow
            testID="budget-invite-section-households"
            icon="people-outline"
            title="Households"
            badge={householdBadge}
            // No longer repeats the active household's name: the card at the
            // top of the screen states it, and two lines naming the same
            // household read as two different households on a quick scan.
            summary="Create, rename and switch between the budgets on this device"
            onPress={() => navigation.navigate('BudgetHouseholds')}
          />
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  intro: { marginBottom: Spacing.lg },
  groupLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    borderRadius: CornerRadius.lg,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
