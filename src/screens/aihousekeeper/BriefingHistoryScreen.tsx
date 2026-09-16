import { useQuery } from '@tanstack/react-query';
import { useNavigation } from "expo-router/react-navigation";
import React from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { AssistantBriefing } from '@/types/aihousekeeper';
import { aihousekeeperApi } from '@api/aihousekeeper';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

export function BriefingHistoryScreen() {  const colors = useAppColors();
  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const { name: personaName } = useAihousekeeperPersona();

  const briefingsQuery = useQuery({
    queryKey: ['aihousekeeper', 'briefings', hid],
    queryFn: () => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.listBriefings(hid);
    },
    enabled: !!hid,
  });

  const headerBack = (
    <ScreenHeader
      title="Briefings"
      showBackButton
      onBackPress={() => navigation.goBack()}
    />
  );

  const handleOpen = (briefing: AssistantBriefing) => {
    (navigation as { navigate: (s: string, p?: unknown) => void }).navigate(
      'Briefing',
      { date: briefing.date }
    );
  };

  if (!hid) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-briefings-screen">
        {headerBack}
        <EmptyState
          icon="home"
          title="Select a household"
          description={`Pick a household to see ${personaName}'s briefing history.`}
        />
      </AppBackground>
    );
  }

  if (briefingsQuery.isLoading) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-briefings-screen">
        {headerBack}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (briefingsQuery.isError) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-briefings-screen">
        {headerBack}
        <View style={styles.centered}>
          <Typography variant="headline" weight="semibold">
            Couldn't load briefings
          </Typography>
          <Pressable
            onPress={() => briefingsQuery.refetch()}
            style={[
              styles.retryBtn,
              { backgroundColor: colors.primary },
            ]}
          >
            <Typography variant="body" weight="semibold" color={colors.white}>
              Retry
            </Typography>
          </Pressable>
        </View>
      </AppBackground>
    );
  }

  const briefings = briefingsQuery.data?.briefings ?? [];
  /*
    Every branch below carries `aihousekeeper-briefings-screen`, not just the
    populated one.

    Briefings were composed by the Worker's cron; the local facade
    (`localAihousekeeperApi`) can read and mark them read but nothing on the
    device ever WRITES one. A local-first household therefore always lands
    here, on the empty branch — which was the one branch without the testID, so
    the screen the E2E flow waits for could never appear on the build the
    product actually ships. `ApprovalsScreen` already tags all five of its
    branches for the same reason.
  */
  if (briefings.length === 0) {
    return (
      <AppBackground opacity={0.5} testID="aihousekeeper-briefings-screen">
        {headerBack}
        <EmptyState
          icon="journal"
          title="No briefings yet"
          description={`${personaName} hasn't published any briefings for this household.`}
        />
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5} testID="aihousekeeper-briefings-screen">
      <View style={styles.container}>
        {headerBack}
        <AdaptiveContainer
          maxWidth={isTablet ? 800 : undefined}
          padding={containerPadding}
        >
          <FlatList
            data={briefings}
            keyExtractor={(b) => b.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable onPress={() => handleOpen(item)}>
                <Card
                  variant="filled"
                  style={[
                    styles.item,
                    { backgroundColor: colors.backgroundSecondary },
                  ]}
                >
                  <View style={styles.itemHeader}>
                    <Typography variant="footnote" weight="semibold">
                      {item.date}
                    </Typography>
                    {item.read_at ? null : (
                      <View
                        style={[
                          styles.unreadDot,
                          { backgroundColor: colors.primary },
                        ]}
                      />
                    )}
                  </View>
                  <Typography
                    variant="body"
                    color={colors.textPrimary}
                    style={{ marginTop: 6 }}
                    numberOfLines={3}
                  >
                    {item.empty_reason ? 'All quiet today.' : item.paragraph}
                  </Typography>
                </Card>
              </Pressable>
            )}
          />
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
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
  listContent: { paddingBottom: 120 },
  item: { marginBottom: 8 },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
});
