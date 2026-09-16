/**
 * AihousekeeperHubScreen — landing page for the AI Housekeeper tab.
 *
 * Surfaces all Aihousekeeper functionality in one place:
 *   - Today's briefing card (tap → BriefingScreen, with an inline preview
 *     if today's briefing is already composed)
 *   - Chat with Aihousekeeper (→ AihousekeeperChatScreen)
 *   - Pending approvals (→ ApprovalsScreen) with a live badge of
 *     status='pending' rows
 *   - Trust ledger (→ TrustLedgerScreen)
 *   - Memory + settings (→ AihousekeeperSettingsScreen)
 *
 * All navigation goes through the react-navigation Root stack by name.
 * React Query drives the badge counts + briefing preview, so the hub
 * stays fresh whenever the user comes back to the tab.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { aihousekeeperApi } from '@api/aihousekeeper';
import { PersonaAvatar } from '@components/aihousekeeper';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

export function AihousekeeperHubScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const { persona, name: personaName } = useAihousekeeperPersona();

  // Today's briefing (falls back to most recent if today isn't composed).
  const briefingsQuery = useQuery({
    queryKey: ['aihousekeeper', 'briefings', hid, 'hub-preview'],
    queryFn: () => {
      if (!hid) throw new Error('no household');
      return aihousekeeperApi.listBriefings(hid);
    },
    enabled: !!hid,
  });

  // Live pending-approval count for the hub badge.
  const approvalsQuery = useQuery({
    queryKey: ['aihousekeeper', 'approvals', hid, 'hub-count'],
    queryFn: () => {
      if (!hid) throw new Error('no household');
      return aihousekeeperApi.listApprovals(hid, { status: 'pending', limit: 50 });
    },
    enabled: !!hid,
    staleTime: 30_000,
  });

  // Pending followups (surface a subtle count if non-zero).
  const followupsQuery = useQuery({
    queryKey: ['aihousekeeper', 'followups', hid, 'hub-count'],
    queryFn: () => {
      if (!hid) throw new Error('no household');
      return aihousekeeperApi.listFollowups(hid, 'pending');
    },
    enabled: !!hid,
    staleTime: 30_000,
  });

  const todayBriefing = useMemo(() => {
    const list = briefingsQuery.data?.briefings ?? [];
    if (list.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    return list.find((b) => b.date === today) ?? list[0];
  }, [briefingsQuery.data]);

  const pendingApprovalsCount = approvalsQuery.data?.approvals.length ?? 0;
  const pendingFollowupsCount = followupsQuery.data?.followups.length ?? 0;

  if (!hid) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader title="AI Housekeeper" />
        <View style={styles.empty}>
          <Typography variant="headline" weight="semibold">
            Select a household
          </Typography>
          <Typography
            variant="body"
            color={colors.textSecondary}
            style={styles.emptyCopy}
          >
            Pick a household from the switcher to see {personaName}.
          </Typography>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader title="AI Housekeeper" />
      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={[
          styles.scroll,
          { paddingHorizontal: containerPadding },
        ]}>
        <AdaptiveContainer maxWidth={isTablet ? 720 : undefined}>
          {/* Hero: today's briefing preview. Tapping only navigates when a
              briefing actually exists — otherwise the hero is a passive
              info card (no router.push to /briefing/<date> that would 404). */}
          <Pressable
            onPress={() => {
              if (todayBriefing) {
                router.push(`/briefing/${todayBriefing.date}`);
              }
            }}
            disabled={!todayBriefing}
            style={({ pressed }) => [
              styles.hero,
              {
                backgroundColor: colors.primary,
                opacity: pressed && todayBriefing ? 0.9 : 1,
              },
            ]}
          >
            <View style={styles.heroHeader}>
              <View style={styles.heroHeaderLeft}>
                <PersonaAvatar persona={persona} size={43} />
                <View>
                  <Typography variant="caption1" weight="semibold" color={colors.white}>
                    {personaName.toUpperCase()} · TODAY'S BRIEFING
                  </Typography>
                </View>
              </View>
              {todayBriefing ? (
                <View style={styles.heroTapHint}>
                  <Typography variant="caption1" color="rgba(255,255,255,0.8)">
                    Tap to open
                  </Typography>
                  <Icon
                    name="chevron-forward"
                    size={14}
                    color="rgba(255,255,255,0.8)"
                  />
                </View>
              ) : null}
            </View>
            {briefingsQuery.isLoading ? (
              <ActivityIndicator color={colors.white} style={styles.heroLoader} />
            ) : todayBriefing ? (
              <>
                <Typography
                  variant="body"
                  color={colors.white}
                  style={styles.heroBody}
                  numberOfLines={4}
                >
                  {todayBriefing.paragraph}
                </Typography>
                {todayBriefing.bullets && todayBriefing.bullets.length > 0 ? (
                  <Typography
                    variant="caption1"
                    color="rgba(255,255,255,0.9)"
                    style={styles.heroMeta}
                  >
                    {todayBriefing.bullets.length} action item
                    {todayBriefing.bullets.length === 1 ? '' : 's'}
                  </Typography>
                ) : null}
              </>
            ) : (
              <Typography variant="body" color="rgba(255,255,255,0.9)">
                {personaName} hasn't composed a briefing yet — come back in the morning
                after the household has some activity.
              </Typography>
            )}
          </Pressable>

          {/* Primary actions */}
          <View style={styles.grid}>
            <HubCard
              icon="chatbubble-ellipses"
              title={`Chat with ${personaName}`}
              subtitle="Ask, remember, schedule, assign"
              onPress={() => router.push('/aihousekeeper-chat')}
            />
            <HubCard
              icon="checkmark-circle"
              title="Approvals"
              subtitle={
                pendingApprovalsCount > 0
                  ? `${pendingApprovalsCount} pending action${
                      pendingApprovalsCount === 1 ? '' : 's'
                    }`
                  : 'No pending actions'
              }
              badge={pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined}
              onPress={() => router.push('/aihousekeeper-approvals')}
            />
            <HubCard
              icon="journal"
              title="Trust ledger"
              subtitle={`What ${personaName} did and why`}
              onPress={() => router.push('/aihousekeeper-trust-ledger')}
            />
            <HubCard
              icon="document-text"
              title="Briefings"
              subtitle="Past mornings"
              onPress={() => router.push('/aihousekeeper-briefings')}
            />
            {pendingFollowupsCount > 0 ? (
              <HubCard
                icon="time"
                title="Followups"
                subtitle={`${pendingFollowupsCount} scheduled`}
                badge={pendingFollowupsCount}
                onPress={() => router.push('/aihousekeeper-settings')}
              />
            ) : null}
            <HubCard
              icon="settings-sharp"
              title="Settings"
              subtitle="Housekeeper, channels, memory"
              onPress={() => router.push('/aihousekeeper-settings')}
            />
          </View>
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

interface HubCardProps {
  icon: IoniconName;
  title: string;
  subtitle: string;
  badge?: number;
  onPress: () => void;
}

function HubCard({
  icon,
  title,
  subtitle,
  badge,
  onPress,
}: HubCardProps) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cardWrap,
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Card style={styles.card}>
        <View style={styles.cardIconRow}>
          <Icon name={icon} size={28} color={colors.primary} />
          {badge !== undefined ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.primary },
              ]}
            >
              <Typography variant="caption1" weight="semibold" color={colors.white}>
                {badge}
              </Typography>
            </View>
          ) : null}
        </View>
        <Typography variant="subheadline" weight="semibold" style={styles.cardTitle}>
          {title}
        </Typography>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          style={styles.cardSubtitle}
          numberOfLines={2}
        >
          {subtitle}
        </Typography>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1, paddingVertical: 16, paddingBottom: 48 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyCopy: { marginTop: 8, textAlign: 'center' },

  hero: {
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  heroBody: { lineHeight: 22 },
  heroMeta: { marginTop: 10 },
  heroLoader: { marginVertical: 8 },
  heroTapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cardWrap: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  card: {
    padding: 14,
    minHeight: 110,
  },
  cardIconRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: { marginTop: 4 },
  cardSubtitle: { marginTop: 4 },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AihousekeeperHubScreen;
