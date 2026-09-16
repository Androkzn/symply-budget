import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from "expo-router/react-navigation";
import React, { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { AssistantBriefing, BriefingEmptyReason } from '@/types/aihousekeeper';
import { aihousekeeperApi } from '@api/aihousekeeper';
import { AppBackground, HeaderActionButton, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { watchSyncService } from '@services/watch-sync';
import { useAihousekeeperStore } from '@stores/aihousekeeperStore';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';

interface BriefingScreenProps {
  /** Optional — if set, fetch that specific date instead of today's. */
  date?: string;
}

export function BriefingScreen({ date }: BriefingScreenProps = {}) {  const colors = useAppColors();
  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const queryClient = useQueryClient();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const { name: personaName } = useAihousekeeperPersona();

  const cacheBriefing = useAihousekeeperStore((s) => s.cacheBriefing);
  const readCachedBriefing = useAihousekeeperStore((s) => s.readCachedBriefing);
  const setLastBriefingDate = useAihousekeeperStore((s) => s.setLastBriefingDate);

  const briefingQuery = useQuery({
    queryKey: ['aihousekeeper', 'briefing', hid, date ?? 'latest'],
    queryFn: async () => {
      if (!hid) throw new Error('No household selected');
      if (date) {
        const { briefing } = await aihousekeeperApi.getBriefing(hid, date);
        return briefing;
      }
      // No specific date → pull from list and take the most recent.
      const { briefings } = await aihousekeeperApi.listBriefings(hid);
      return briefings[0] ?? null;
    },
    enabled: !!hid,
  });

  const markRead = useMutation({
    mutationFn: (briefingDate: string) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.markBriefingRead(hid, briefingDate);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'briefings', hid] });
    },
  });

  const briefing = briefingQuery.data ?? null;

  // Plan §H4: on successful fetch, write to offline cache.
  // Plan §H7: also push the paragraph to the Apple Watch (iOS-only; no-op elsewhere).
  useEffect(() => {
    if (!hid || !briefing) return;
    cacheBriefing(hid, {
      date: briefing.date,
      paragraph: briefing.paragraph,
      bullets: briefing.bullets ?? [],
      cachedAt: new Date().toISOString(),
    });
    setLastBriefingDate(briefing.date);
    if (briefing.paragraph && briefing.date) {
      void watchSyncService.syncBriefing(briefing.paragraph, briefing.date);
    }
  }, [hid, briefing, cacheBriefing, setLastBriefingDate]);

  // Auto-mark briefing as read on view (non-blocking).
  useEffect(() => {
    if (!hid || !briefing || briefing.read_at) return;
    markRead.mutate(briefing.date);
    // markRead intentionally not in deps — stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, briefing?.id]);

  const cached = useMemo(() => {
    if (!hid) return null;
    return readCachedBriefing(hid);
  }, [hid, readCachedBriefing]);

  const headerBack = (
    <ScreenHeader
      title="Today's briefing"
      showBackButton
      onBackPress={() => navigation.goBack()}
      rightElement={
        <HeaderActionButton
          label="Chat"
          onPress={() =>
            (navigation as unknown as { navigate: (s: string) => void }).navigate(
              'AihousekeeperChat'
            )
          }
        />
      }
    />
  );

  if (!hid) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <EmptyState
          icon="home"
          title="Select a household"
          description={`Pick a household from the switcher to see ${personaName}'s briefing.`}
        />
      </AppBackground>
    );
  }

  // Loading (H3)
  if (briefingQuery.isLoading) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography
            variant="body"
            color={colors.textSecondary}
            style={{ marginTop: 12 }}
          >
            Loading today's briefing...
          </Typography>
        </View>
      </AppBackground>
    );
  }

  // Error (H3) — fall back to cached payload (H4) if we have one.
  if (briefingQuery.isError) {
    if (cached) {
      return (
        <AppBackground opacity={0.5}>
          <View style={styles.container}>
            {headerBack}
            <AdaptiveContainer
              maxWidth={isTablet ? 800 : undefined}
              padding={containerPadding}
            >
              <OfflineBanner cachedAt={cached.cachedAt} theme={{ colors }} />
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                <BriefingContent
                  date={cached.date}
                  paragraph={cached.paragraph}
                  bullets={cached.bullets}
                />
              </ScrollView>
            </AdaptiveContainer>
          </View>
        </AppBackground>
      );
    }

    // Distinguish "no briefing exists yet" (404) from real network / 5xx
    // errors. Axios sets `error.response.status` for HTTP failures; a
    // missing `error.response` is the real connection-failure signal.
    const err = briefingQuery.error as
      | { response?: { status?: number } }
      | undefined;
    const httpStatus = err?.response?.status;
    const isNotFound = httpStatus === 404;

    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <View style={styles.centered}>
          <Typography variant="headline" weight="semibold">
            {isNotFound ? 'No briefing yet' : "Couldn't load today's briefing"}
          </Typography>
          <Typography
            variant="body"
            color={colors.textSecondary}
            style={{ marginTop: 8, textAlign: 'center' }}
          >
            {isNotFound
              ? `${personaName} hasn't composed a briefing for this day. Check back in the morning after the household has some activity.`
              : 'Check your connection and try again.'}
          </Typography>
          {isNotFound ? null : (
            <Pressable
              onPress={() => briefingQuery.refetch()}
              style={[
                styles.retryBtn,
                { backgroundColor: colors.primary },
              ]}
            >
              <Typography variant="body" weight="semibold" color={colors.white}>
                Retry
              </Typography>
            </Pressable>
          )}
        </View>
      </AppBackground>
    );
  }

  // Empty (no briefing at all yet) — H3
  if (!briefing) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <EmptyState
          icon="sunny"
          title="Nothing to brief yet"
          description={`${personaName}'s still getting to know your household. Check back in the morning.`}
        />
      </AppBackground>
    );
  }

  // Empty-reason present (H3): Aihousekeeper had nothing worth surfacing today.
  if (briefing.empty_reason) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <EmptyState
          icon="checkmark-circle"
          title="All quiet today"
          description={emptyReasonCopy(briefing.empty_reason, personaName)}
        />
      </AppBackground>
    );
  }

  // Normal render
  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        {headerBack}
        <AdaptiveContainer
          maxWidth={isTablet ? 800 : undefined}
          padding={containerPadding}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <BriefingContent
              date={briefing.date}
              paragraph={briefing.paragraph}
              bullets={briefing.bullets ?? []}
            />
            {briefing.source_signals && briefing.source_signals.length > 0 && (
              <SourceSignals briefing={briefing} />
            )}
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

function BriefingContent({
  date,
  paragraph,
  bullets,
}: {
  date: string;
  paragraph: string;
  bullets: string[];
}) {
  const colors = useAppColors();
  return (
    <View>
      <Typography
        variant="footnote"
        color={colors.textSecondary}
        style={styles.dateLabel}
      >
        {date}
      </Typography>
      <Card
        variant="filled"
        style={[
          styles.paragraphCard,
          { backgroundColor: colors.backgroundSecondary },
        ]}
      >
        <Typography variant="body" color={colors.textPrimary}>
          {paragraph}
        </Typography>
      </Card>
      {bullets.length > 0 && (
        <Card
          variant="filled"
          style={[
            styles.bulletsCard,
            { backgroundColor: colors.backgroundSecondary },
          ]}
        >
          {bullets.map((b, i) => (
            <View key={`${i}-${b.slice(0, 16)}`} style={styles.bulletRow}>
              <Typography
                variant="body"
                color={colors.primary}
                style={styles.bulletDot}
              >
                •
              </Typography>
              <Typography
                variant="body"
                color={colors.textPrimary}
                style={styles.bulletText}
              >
                {b}
              </Typography>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

function SourceSignals({ briefing }: { briefing: AssistantBriefing }) {
  const colors = useAppColors();
  const { name: personaName } = useAihousekeeperPersona();
  return (
    <View style={{ marginTop: 24 }}>
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
        style={{ marginBottom: 8 }}
      >
        WHY THESE
      </Typography>
      <Card
        variant="filled"
        style={{ backgroundColor: colors.backgroundSecondary }}
      >
        <Typography
          variant="footnote"
          color={colors.textSecondary}
        >
          Based on {briefing.source_signals.length} signal
          {briefing.source_signals.length === 1 ? '' : 's'} {personaName} tracked today.
        </Typography>
      </Card>
    </View>
  );
}

function OfflineBanner({
  cachedAt,
  theme,
}: {
  cachedAt: string;
  theme: { colors: { warning: string; textSecondary: string } };
}) {
  const when = new Date(cachedAt);
  const label = isNaN(when.getTime())
    ? cachedAt
    : when.toLocaleString(undefined, {
        hour: 'numeric',
        minute: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  return (
    <View
      style={[
        styles.offlineBanner,
        { backgroundColor: theme.colors.warning + '22' },
      ]}
    >
      <Typography variant="footnote" color={theme.colors.textSecondary}>
        Offline — last updated {label}
      </Typography>
    </View>
  );
}

function emptyReasonCopy(
  reason: NonNullable<BriefingEmptyReason>,
  personaName: string
): string {
  switch (reason) {
    case 'no_signals':
      return `${personaName} had nothing new to surface this morning.`;
    case 'all_quiet':
      return 'No tasks, no changes — enjoy the quiet.';
    case 'recently_briefed':
      return `You were briefed recently. ${personaName}'s holding off to avoid noise.`;
    case 'fallback_failed':
      return `${personaName} couldn't compose a briefing — try again later.`;
    default:
      return 'No briefing today.';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 16,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  dateLabel: { marginBottom: 8, marginLeft: 4 },
  paragraphCard: { marginBottom: 12 },
  bulletsCard: { paddingVertical: 8 },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  bulletDot: { width: 20, textAlign: 'center', ...scaledFont('bodyLarge') },
  bulletText: { flex: 1 },
  offlineBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
});
