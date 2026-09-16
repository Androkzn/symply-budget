import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { savingsApi, type PensionOverview, type RegisteredAccountType } from '@api/savings';
import { Avatar, Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { usePensionStore } from '@stores/pensionStore';
import { Spacing, useAppColors } from '@theme';

import { budgetCtaFill, BUDGET_CTA_ROW_STYLES, budgetCtaTint } from '../budgetCtaLayout';
import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { PensionEntrySheet, type PensionEntryInitial } from './PensionEntrySheet';
import { PensionProgressBar } from './PensionProgressBar';
import {
  pensionLines,
  pensionMemberIdentities,
  pensionMemberOptions,
  pensionScopeLabel,
  showsMemberOnRows,
} from './pensionScope';

const TYPE_LABEL: Record<RegisteredAccountType, string> = {
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  fhsa: 'FHSA',
  dpsp: 'DPSP',
  rpp: 'Pension (RPP)',
};

/**
 * Pension → Room sub-view. The simple setup: set each household member's contribution
 * room (RRSP/TFSA) with no account. An "Add contribution room" button + tappable rows
 * open the shared `PensionEntrySheet`. Self-contained — no dependency on Accounts.
 */
export function PensionRoomView() {
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
      console.error('Error loading pension room:', error);
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

  const rooms = pensionLines(overview, selectedMemberId).filter(
    (a) => (a.account.starting_room_cents ?? 0) > 0
  );
  const showMember = showsMemberOnRows(selectedMemberId);
  const scopeName = pensionScopeLabel(
    pensionMemberOptions(pensionMemberIdentities(overview), currentHouseholdMembers, null),
    selectedMemberId
  );

  const openAdd = () => {
    // Scoped to a member, "Add" means add for THEM — the sheet shouldn't
    // reopen on whoever happens to sort first.
    setInitial(selectedMemberId ? { memberId: selectedMemberId } : undefined);
    setSheetOpen(true);
  };
  const openEdit = (memberId: string | null, type: RegisteredAccountType, roomCents: number | null) => {
    if (type !== 'rrsp' && type !== 'tfsa') return;
    setInitial({ memberId: memberId ?? undefined, accountType: type, roomCents });
    setSheetOpen(true);
  };

  const confirmDelete = (memberId: string | null, type: RegisteredAccountType, label: string) => {
    if (!currentHousehold?.id || !memberId || (type !== 'rrsp' && type !== 'tfsa')) return;
    Alert.alert(`Delete ${label} room?`, 'This clears this account’s contribution room. Goals and contributions stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await savingsApi.setMemberLine(currentHousehold.id, {
              member_id: memberId,
              account_type: type,
              room_cents: 0,
            });
            markDirty();
          } catch (error) {
            console.error('Error deleting pension room:', error);
            Alert.alert('Error', 'Could not delete this room. Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <View testID="pension-room" style={styles.root}>
      <View style={BUDGET_CTA_ROW_STYLES.addRow}>
        <TouchableOpacity
          onPress={openAdd}
          activeOpacity={0.85}
          style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaFill(colors.primary)]}
          testID="pension-room-add"
        >
          <Icon name="add" size={16} color={budgetCtaTint('primary', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('primary', colors)}>
            Add contribution room
          </Typography>
        </TouchableOpacity>
      </View>

      {isLoading && !overview ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="shield-checkmark-outline" size={38} color={colors.textTertiary} />
          <Typography variant="caption1" color={colors.textSecondary} style={styles.emptyBody}>
            {showMember
              ? "Add each person's RRSP and TFSA contribution room — no account needed. You'll find these numbers on your CRA My Account."
              : `Add ${scopeName}'s RRSP and TFSA contribution room — no account needed. You'll find these numbers on their CRA My Account.`}
          </Typography>
        </View>
      ) : (
        rooms.map((r) => {
          // "% filled" = how much of the room the member has already used, kept
          // consistent with the remaining figure we show (used = total − remaining).
          const total = r.account.starting_room_cents ?? 0;
          const remaining = r.room.roomRemaining;
          const used = Math.max(0, total - remaining);
          const fraction = total > 0 ? used / total : 0;
          const pctLabel = Math.min(100, Math.round(fraction * 100));
          const over = remaining < 0;
          return (
            <Card
              key={r.account.id}
              variant="outlined"
              pressable
              onPress={() => openEdit(r.memberId, r.account.account_type, r.account.starting_room_cents)}
              style={styles.card}
              testID="pension-room-row"
            >
              <View style={styles.cardTop}>
                {/* Scoped to one member, the avatar + name repeat on every row —
                    the header title already says whose pension this is. */}
                {showMember && (
                  <Avatar
                    user={{ display_name: r.memberName, avatar_url: r.memberAvatarUrl }}
                    size="sm"
                  />
                )}
                <Typography variant="body" weight="semibold" numberOfLines={1} style={styles.cardTitle}>
                  {TYPE_LABEL[r.account.account_type]}
                  {showMember && r.memberName ? ` · ${r.memberName}` : ''}
                </Typography>
                <TouchableOpacity
                  onPress={() =>
                    confirmDelete(r.memberId, r.account.account_type, TYPE_LABEL[r.account.account_type])
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.deleteBtn}
                  testID="pension-room-delete"
                >
                  <Icon name="trash-outline" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </View>

              <View style={styles.metaRow}>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {formatCurrency(used)} of {formatCurrency(total)} used
                </Typography>
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={over ? colors.error : colors.primary}
                >
                  {pctLabel}%
                </Typography>
              </View>

              <PensionProgressBar fraction={fraction} color={colors.primary} over={over} />

              <Typography
                variant="caption2"
                weight="semibold"
                color={over ? colors.error : colors.textSecondary}
              >
                {over
                  ? `${formatCurrency(Math.abs(remaining))} over your room`
                  : `${formatCurrency(remaining)} room remaining`}
              </Typography>
            </Card>
          );
        })
      )}

      {currentHousehold?.id && (
        <PensionEntrySheet
          visible={sheetOpen}
          mode="room"
          householdId={currentHousehold.id}
          members={currentHouseholdMembers}
          initial={initial}
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
  card: { padding: Spacing.base, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { flex: 1 },
  deleteBtn: { padding: Spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
