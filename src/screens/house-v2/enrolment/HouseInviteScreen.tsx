import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { HouseHouseholdMembersCard } from '@features/house/components/HouseHouseholdMembersCard';
import { HouseJoinRequestsPanel } from '@features/house/components/HouseJoinRequestsPanel';
import { HouseJoinWaitingPanel } from '@features/house/components/HouseJoinWaitingPanel';
import { HouseMembershipLossPanel } from '@features/house/components/HouseMembershipLossPanel';
import { HouseSyncProgressPanel } from '@features/house/components/HouseSyncProgressPanel';
import {
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  subscribeToHouseLedgerChanges,
} from '@features/house/local/engine';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { takePendingHouseInvite } from '@features/house/local/inviteLinkStore';
import { useHouseJoinRequests } from '@features/house/local/useHouseJoinRequests';
import { useHouseJoinWait } from '@features/house/local/useHouseJoinWait';
import type { SettingsStackParamList } from '@navigation/types';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

/**
 * House → **Invite & home**. The hub for everything about the people you share
 * a home with.
 *
 * It used to be one screen that did the owner's job only — mint a code, then
 * approve — with the invitee's half on another route and the homes themselves
 * nowhere. Three problems, all the same problem:
 *
 *  - the two halves are for **two different people** — the owner handing an
 *    invite over, and the invitee accepting one — so stacking them meant every
 *    arrival scrolled past a form addressed to somebody else;
 *  - the **homes** — the thing all of this is about — were a screen in another
 *    part of the app, so "who is in this?" and "which home is this?" were
 *    answered two navigation trees apart;
 *  - nothing on the surface showed whose TURN it was.
 *
 * So: three rows that PUSH, in the order the questions get asked — who is here
 * (inline, because it is the answer, not a task), then invite / join / manage.
 * A pushed screen has a title, a back button and an animation that says where
 * you went.
 *
 * The two live states stay HERE as well as on their own screens, because each is
 * somebody's turn: a pending join request is waiting on the owner, and a claimed
 * invite is the invitee waiting to be let in. Both are what a push notification
 * brings someone here to see, and a hub that showed no trace of it would be the
 * worst possible landing.
 */

/** A row that goes somewhere. */
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
  /** Optional state the row itself carries, e.g. "2 homes". */
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
 * The homes this device holds, re-read when the engine changes.
 *
 * Synchronous and cold-safe — `listLocalHouseProperties` reads only cold-session
 * fields, so no property is hydrated to answer it — which is what makes it safe
 * on a render path. Subscribed rather than read once: joining ADDS one and
 * switching changes which is active, both underneath this screen.
 */
function useHeldProperties() {
  const [, bump] = useState(0);
  useEffect(() => subscribeToHouseLedgerChanges(() => bump((n) => n + 1)), []);
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return [];
  return listLocalHouseProperties();
}

export function HouseInviteScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();

  const joinRequests = useHouseJoinRequests();
  const wait = useHouseJoinWait();
  const properties = useHeldProperties();
  const active = properties.find((property) => property.isActive) ?? null;

  /**
   * A tapped invite link, handed straight to the screen that can act on it.
   *
   * The link carries the code and the secret, and the invitee's only remaining
   * act is agreeing to the home it names. Taking them to Join with the fields
   * already filled is the least this owes somebody it just summoned — the
   * alternative is landing them on a hub with no sign of why they are here.
   * Nothing is claimed by the navigation itself: the confirmation on the other
   * side is what enrols, so a link forwarded into a group chat still cannot
   * enrol whoever tapped it first.
   */
  useFocusEffect(
    useCallback(() => {
      const pending = takePendingHouseInvite();
      if (!pending) return;
      navigation.navigate('HouseJoin', { code: pending.code, secret: pending.secret });
    }, [navigation]),
  );

  const propertyBadge = properties.length > 1 ? `${properties.length} on this device` : null;

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
      <SafeAreaView edges={[]} testID="house-invite-screen">
        <ScreenHeader
          title="Invite & home"
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
          {/* Whoever's turn it is, first. All four render nothing when there is
              nothing waiting, so the ordinary screen starts at the intro.
              The membership notice leads: it is the only one that reports
              something already DONE and irreversible, and this screen is where
              the removal notification lands. The progress panel follows it and
              precedes the waiting panel, because a member who has just been let
              in leaves "waiting" and enters "downloading" — the two describe
              consecutive halves of the same join. */}
          <HouseMembershipLossPanel />
          <HouseSyncProgressPanel />
          <HouseJoinRequestsPanel {...joinRequests} />
          <HouseJoinWaitingPanel {...wait} />

          <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
            Share a home with someone. They scan a code; you approve their device before it can see
            anything.
          </Typography>

          {/* Who is already here, before any of the tasks. This screen is
              reached by asking about a home, so opening on rows about inviting
              somebody answers a question nobody has asked yet. */}
          <HouseHouseholdMembersCard />

          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            MANAGE
          </Typography>

          <NavRow
            testID="house-invite-section-invite"
            icon="qr-code-outline"
            title="Invite"
            summary="Show a QR code for someone to scan, then approve their device"
            onPress={() => navigation.navigate('HouseInviteCreate')}
          />

          <NavRow
            testID="house-invite-section-join"
            icon="scan-outline"
            title="Join"
            summary={
              // The outcome outranks the wait, and must: the row went on saying
              // "waiting for them to approve this device" directly underneath a
              // banner saying the invite had expired, which reads as the screen
              // not knowing which of the two is true.
              wait.outcome
                ? wait.outcome === 'revoked'
                  ? 'That invite was cancelled — join again with a new one'
                  : wait.outcome === 'expired'
                    ? 'That invite expired — join again with a new one'
                    : 'You were removed from that home — join again with a new invite'
                : wait.awaiting
                  ? 'Waiting for them to approve this device'
                  : "Add someone else's home to this device — scan their QR code, or enter the invite by hand"
            }
            onPress={() => navigation.navigate('HouseJoin')}
          />

          <NavRow
            testID="house-invite-section-properties"
            icon="home-outline"
            title="Homes"
            badge={propertyBadge}
            summary={
              active
                ? `${active.name} — rename it, add another, or switch which one you are in`
                : 'Create, rename and switch between the homes on this device'
            }
            onPress={() => navigation.navigate('HouseProperties')}
          />

          <NavRow
            testID="house-invite-section-devices"
            icon="phone-portrait-outline"
            title="Device sync"
            summary="See which devices hold this home, rename this one, or revoke one"
            onPress={() => navigation.navigate('HouseDeviceSync')}
          />
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

export default HouseInviteScreen;

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
