import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { savingsApi, type PensionOverview, type RegisteredAccountType } from '@api/savings';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { usePensionStore } from '@stores/pensionStore';
import { Spacing, useAppColors } from '@theme';

import { budgetCtaFill, BUDGET_CTA_ROW_STYLES, budgetCtaTint } from '../budgetCtaLayout';
import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { PensionEntrySheet, type PensionEntryInitial } from './PensionEntrySheet';
import { PensionProgressBar } from './PensionProgressBar';
import { pensionLines, pensionMemberIdentities, showsMemberOnRows } from './pensionScope';

const TYPE_LABEL: Record<RegisteredAccountType, string> = {
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  fhsa: 'FHSA',
  dpsp: 'DPSP',
  rpp: 'Pension (RPP)',
};

/**
 * Pension → Goals sub-view. Set an annual contribution goal per member (amount OR % of
 * room) with an "Add goal" button + tappable rows opening the shared `PensionEntrySheet`;
 * progress counts recurring + manual contributions. Self-contained — no Accounts dependency.
 */
export function PensionGoalsView() {
  const colors = useAppColors();
  const { currentHousehold, currentHouseholdMembers } = useHouseholdStore();
  const { selectedYear, selectedMemberId, dataRevision, markDirty, setMemberGroups } =
    usePensionStore();

  const [overview, setOverview] = useState<PensionOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [initial, setInitial] = useState<PensionEntryInitial | undefined>(undefined);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const next = await savingsApi.getRegisteredOverview(currentHousehold.id, selectedYear);
      setOverview(next);
      setMemberGroups(pensionMemberIdentities(next));
    } catch (error) {
      console.error('Error loading pension goals:', error);
    }
  }, [currentHousehold?.id, selectedYear, setMemberGroups]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  React.useEffect(() => {
    if (dataRevision === 0) return;
    void load();
  }, [currentHousehold?.id, selectedYear, dataRevision, load]);

  const goals = pensionLines(overview, selectedMemberId).filter(
    (a) => a.room.goalCents != null && a.room.goalCents > 0
  );
  const showMember = showsMemberOnRows(selectedMemberId);

  // `${memberId}:${type}` → room base in cents, so the sheet can preview the dollar goal a %
  // resolves to. Base mirrors the backend's `effectiveGoalCents` (starting_room ?? annualLimit);
  // built from every rrsp/tfsa account (not just ones with a goal) to cover Add-goal too.
  const goalBases = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of overview?.groups ?? []) {
      for (const a of g.accounts) {
        if (a.account.account_type !== 'rrsp' && a.account.account_type !== 'tfsa') continue;
        map[`${g.memberId ?? ''}:${a.account.account_type}`] =
          a.account.starting_room_cents ?? a.room.annualLimit;
      }
    }
    return map;
  }, [overview]);

  const openAdd = () => {
    // Scoped to a member, "Add goal" means a goal for THEM.
    setInitial(selectedMemberId ? { memberId: selectedMemberId } : undefined);
    setSheetOpen(true);
  };

  const confirmDelete = (memberId: string | null, type: RegisteredAccountType, label: string) => {
    const t = type === 'tfsa' ? 'tfsa' : 'rrsp';
    if (!currentHousehold?.id || !memberId) return;
    Alert.alert(`Delete ${label} goal?`, 'This clears the annual goal for this account. Room and contributions stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await savingsApi.setMemberLine(currentHousehold.id, {
              member_id: memberId,
              account_type: t,
              goal_cents: null,
              goal_pct: null,
            });
            markDirty();
          } catch (error) {
            console.error('Error deleting pension goal:', error);
            Alert.alert('Error', 'Could not delete this goal. Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <View testID="pension-goals" style={styles.root}>
      <View style={BUDGET_CTA_ROW_STYLES.addRow}>
        <TouchableOpacity
          onPress={openAdd}
          activeOpacity={0.85}
          style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaFill(colors.primary)]}
          testID="pension-goal-add"
        >
          <Icon name="add" size={16} color={budgetCtaTint('primary', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('primary', colors)}>
            Add goal
          </Typography>
        </TouchableOpacity>
      </View>

      {isLoading && !overview ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : goals.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="flag-outline" size={36} color={colors.textTertiary} />
          <Typography variant="caption1" color={colors.textSecondary} style={styles.emptyBody}>
            Set an annual contribution goal — a dollar amount or a % of your room — and track
            progress as you contribute.
          </Typography>
        </View>
      ) : (
        goals.map((summary) => {
          const { account, room, memberName, memberId } = summary;
          const goalCents = room.goalCents ?? 0;
          const fraction = goalCents > 0 ? room.goalContributedCents / goalCents : 0;
          const isPct = account.annual_goal_pct != null;
          return (
            <Card
              key={account.id}
              variant="outlined"
              pressable
              onPress={() => {
                setInitial({
                  memberId: memberId ?? undefined,
                  accountType: account.account_type === 'tfsa' ? 'tfsa' : 'rrsp',
                  goalCents: account.annual_goal_cents,
                  goalPct: account.annual_goal_pct,
                });
                setSheetOpen(true);
              }}
              style={styles.card}
              testID="pension-goal-row"
            >
              <View style={styles.cardHeader}>
                <Typography variant="body" weight="semibold" numberOfLines={1} style={styles.cardTitle}>
                  {TYPE_LABEL[account.account_type]}
                  {/* Scoped to one member the name repeats on every row — the
                      header title already says whose goals these are. */}
                  {showMember && memberName ? ` · ${memberName}` : ''}
                </Typography>
                <View style={styles.headerRight}>
                  {isPct && (
                    <Typography variant="caption2" color={colors.primary}>
                      {account.annual_goal_pct}% of room
                    </Typography>
                  )}
                  <TouchableOpacity
                    onPress={() =>
                      confirmDelete(memberId, account.account_type, TYPE_LABEL[account.account_type])
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.deleteBtn}
                    testID="pension-goal-delete"
                  >
                    <Icon name="trash-outline" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.goalHeader}>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {formatCurrency(room.goalContributedCents)} / {formatCurrency(goalCents)}
                </Typography>
                <Typography variant="caption1" weight="semibold" color={colors.primary}>
                  {room.goalPct}%
                </Typography>
              </View>
              <PensionProgressBar fraction={fraction} color={colors.success} />
            </Card>
          );
        })
      )}

      {currentHousehold?.id && (
        <PensionEntrySheet
          visible={sheetOpen}
          mode="goal"
          householdId={currentHousehold.id}
          members={currentHouseholdMembers}
          initial={initial}
          goalBases={goalBases}
          onClose={() => setSheetOpen(false)}
          onSaved={markDirty}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'stretch', gap: Spacing.base, paddingBottom: Spacing.lg },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  empty: { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  emptyBody: { textAlign: 'center' },
  card: { gap: Spacing.sm, padding: Spacing.base },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  deleteBtn: { padding: Spacing.xs },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
