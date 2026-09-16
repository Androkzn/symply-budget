import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from "expo-router/react-navigation";
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type {
  AssistantLedgerCategory,
  AssistantTrustLedgerEntry,
} from '@/types/aihousekeeper';
import { aihousekeeperApi } from '@api/aihousekeeper';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
// Note: useMemo is used for ledgerOpts; grouped is computed inline below
// after conditional returns, so it intentionally does not use useMemo.

import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

const CATEGORY_FILTERS: Array<{
  value: AssistantLedgerCategory | 'all';
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: 'decision', label: 'Decisions' },
  { value: 'message_sent', label: 'Messages' },
  { value: 'task_changed', label: 'Tasks' },
  { value: 'memory_added', label: 'Memory' },
  { value: 'followup_scheduled', label: 'Followups' },
  { value: 'assignment', label: 'Assignments' },
];

export function TrustLedgerScreen() {  const colors = useAppColors();
  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const queryClient = useQueryClient();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const { name: personaName } = useAihousekeeperPersona();

  const [activeFilter, setActiveFilter] = useState<
    AssistantLedgerCategory | 'all'
  >('all');

  const ledgerOpts = useMemo(
    () => ({
      category: activeFilter === 'all' ? undefined : activeFilter,
      limit: 100,
    }),
    [activeFilter]
  );

  const ledgerQuery = useQuery({
    queryKey: ['aihousekeeper', 'ledger', hid, ledgerOpts],
    queryFn: () => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.listTrustLedger(hid, ledgerOpts);
    },
    enabled: !!hid,
  });

  const dismissMutation = useMutation({
    mutationFn: (entryId: string) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.dismissLedgerEntry(hid, entryId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'ledger', hid] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: (entryId: string) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.undoLedgerEntry(hid, entryId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'ledger', hid] });
    },
    onSuccess: (result) => {
      if (result.status !== 'undone') {
        Alert.alert(
          'Could not undo',
          result.message ??
            (result.status === 'irreversible'
              ? 'This action cannot be reversed.'
              : 'This entry has already been undone.')
        );
      }
    },
  });

  const headerBack = (
    <ScreenHeader
      title="Trust ledger"
      showBackButton
      onBackPress={() => navigation.goBack()}
    />
  );

  const handleUndo = (entry: AssistantTrustLedgerEntry) => {
    Alert.alert(
      'Undo this action?',
      entry.summary,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => undoMutation.mutate(entry.id),
        },
      ]
    );
  };

  const handleDismiss = (entry: AssistantTrustLedgerEntry) => {
    dismissMutation.mutate(entry.id);
  };

  if (!hid) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <EmptyState
          icon="home"
          title="Select a household"
          description={`Pick a household to see ${personaName}'s trust ledger.`}
        />
      </AppBackground>
    );
  }

  if (ledgerQuery.isLoading) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (ledgerQuery.isError) {
    return (
      <AppBackground opacity={0.5}>
        {headerBack}
        <View style={styles.centered}>
          <Typography variant="headline" weight="semibold">
            Couldn't load the trust ledger
          </Typography>
          <Pressable
            onPress={() => ledgerQuery.refetch()}
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

  const entries = ledgerQuery.data?.entries ?? [];
  // Group by day (occurred_at YYYY-MM-DD prefix).
  // Computed inline (not via useMemo) since we're past conditional hook-returns
  // in this render branch; cheap at typical ledger sizes (<500 entries).
  const grouped: Array<[string, AssistantTrustLedgerEntry[]]> = (() => {
    const map = new Map<string, AssistantTrustLedgerEntry[]>();
    for (const e of entries) {
      const day = (e.occurred_at ?? '').slice(0, 10) || 'Unknown';
      const list = map.get(day) ?? [];
      list.push(e);
      map.set(day, list);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  })();

  return (
    <AppBackground opacity={0.5} testID="aihousekeeper-trust-ledger-screen">
      <View style={styles.container}>
        {headerBack}
        <AdaptiveContainer
          maxWidth={isTablet ? 800 : undefined}
          padding={containerPadding}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {CATEGORY_FILTERS.map((f) => {
              const active = activeFilter === f.value;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => setActiveFilter(f.value)}
                  style={[
                    styles.chip,
                    {
                      borderColor: colors.borderColor,
                      backgroundColor: active
                        ? colors.primary
                        : 'transparent',
                    },
                  ]}
                >
                  <Typography
                    variant="footnote"
                    weight="medium"
                    color={active ? colors.white : colors.textPrimary}
                  >
                    {f.label}
                  </Typography>
                </Pressable>
              );
            })}
          </ScrollView>

          {entries.length === 0 ? (
            <EmptyState
              icon="journal"
              title={`${personaName} hasn't done much yet`}
              description={`As ${personaName} takes actions, they'll show up here with the reasoning behind them.`}
            />
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {grouped.map(([day, dayEntries]) => (
                <View key={day} style={{ marginBottom: 16 }}>
                  <Typography
                    variant="footnote"
                    weight="semibold"
                    color={colors.textSecondary}
                    style={styles.dayHeader}
                  >
                    {day}
                  </Typography>
                  {dayEntries.map((entry) => (
                    <LedgerItem
                      key={entry.id}
                      entry={entry}
                      onUndo={handleUndo}
                      onDismiss={handleDismiss}
                      undoPending={undoMutation.isPending}
                      dismissPending={dismissMutation.isPending}
                    />
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

function LedgerItem({
  entry,
  onUndo,
  onDismiss,
  undoPending,
  dismissPending,
}: {
  entry: AssistantTrustLedgerEntry;
  onUndo: (entry: AssistantTrustLedgerEntry) => void;
  onDismiss: (entry: AssistantTrustLedgerEntry) => void;
  undoPending: boolean;
  dismissPending: boolean;
}) {
  const colors = useAppColors();
  const canUndo = entry.reversible && !entry.user_dismissed_at;
  return (
    <Card
      variant="filled"
      style={[
        styles.entryCard,
        {
          backgroundColor: colors.backgroundSecondary,
          opacity: entry.user_dismissed_at ? 0.5 : 1,
        },
      ]}
    >
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
      >
        {entry.category.replace(/_/g, ' ')}
      </Typography>
      <Typography
        variant="body"
        weight="medium"
        color={colors.textPrimary}
        style={{ marginTop: 4 }}
      >
        {entry.summary}
      </Typography>
      {entry.rationale ? (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          style={{ marginTop: 6 }}
        >
          Why: {entry.rationale}
        </Typography>
      ) : null}
      <View style={styles.entryActions}>
        {canUndo && (
          <Pressable
            disabled={undoPending}
            onPress={() => onUndo(entry)}
            style={[
              styles.actionBtn,
              { backgroundColor: colors.primary },
            ]}
          >
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.white}
            >
              Undo
            </Typography>
          </Pressable>
        )}
        {!entry.user_dismissed_at && (
          <Pressable
            disabled={dismissPending}
            onPress={() => onDismiss(entry)}
            style={[
              styles.actionBtn,
              {
                backgroundColor: 'transparent',
                borderWidth: 1,
                borderColor: colors.borderColor,
              },
            ]}
          >
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textSecondary}
            >
              Dismiss
            </Typography>
          </Pressable>
        )}
      </View>
    </Card>
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  dayHeader: {
    letterSpacing: 0.5,
    marginBottom: 6,
    paddingLeft: 4,
  },
  entryCard: { marginBottom: 8 },
  entryActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
});
