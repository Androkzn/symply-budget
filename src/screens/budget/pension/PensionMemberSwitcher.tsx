import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { AdaptiveModal, SheetHeader } from '@components/common';
import { Avatar, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { getLocalLedger, isLocalBudgetSessionOpen } from '@features/budget/local';
import { useHouseholdStore } from '@stores/householdStore';
import { usePensionStore } from '@stores/pensionStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import { pensionMemberOptions, pensionScopeLabel } from './pensionScope';

/** This device's member id on a local-first budget; null on a server household. */
function localMemberId(): string | null {
  if (!isLocalBudgetSessionOpen()) return null;
  try {
    return getLocalLedger().memberId;
  } catch {
    return null;
  }
}

/**
 * The Pension tab's header title, doubled as the member picker.
 *
 * Contribution room is PERSONAL — RRSP/TFSA/FHSA room accrues to an individual,
 * over-contribution penalties are assessed per person, and spouses can't pool
 * it — so "whose pension" is the tab's primary axis, alongside the year stepper
 * (which tax year) and the sub-tabs (Room / Goals / Contributions). Before this,
 * every member's rows were flattened into one list with the name demoted to a
 * `· Name` suffix.
 *
 * Mirrors `MortgageSwitcher`: same title-as-control pattern, same fallback to a
 * plain title when there is nothing to switch between (a one-member household).
 * Never fetches: the options come from the household roster plus the member
 * identities the sub-views publish after loading an overview. A local-first
 * ledger holds only this device's member, so without that second source a
 * shared local budget's peers would be unreachable here.
 */
export function PensionMemberSwitcher() {
  const colors = useAppColors();
  const roster = useHouseholdStore((s) => s.currentHouseholdMembers);
  const memberGroups = usePensionStore((s) => s.memberGroups);
  const selectedMemberId = usePensionStore((s) => s.selectedMemberId);
  const setSelectedMember = usePensionStore((s) => s.setSelectedMember);

  const [isOpen, setIsOpen] = useState(false);

  // Both slices are persisted, so a payload written before either field existed
  // rehydrates as undefined — hence the empty-array floor inside the memo.
  const { options, rosterById } = useMemo(() => {
    const members = roster ?? [];
    return {
      options: pensionMemberOptions(memberGroups, members, localMemberId()),
      rosterById: new Map(members.map((m) => [m.id, m])),
    };
  }, [memberGroups, roster]);

  // The scoped member is no longer selectable — they left the household while
  // the tab was pinned to them. Fall back to Everyone, or the list below would
  // filter to nothing under a title that no longer names anyone.
  const scopeIsStale =
    selectedMemberId !== null && !options.some((o) => o.id === selectedMemberId);
  useEffect(() => {
    if (scopeIsStale) setSelectedMember(null);
  }, [scopeIsStale, setSelectedMember]);

  // One member (or none loaded yet): there is no scope to choose, so the title
  // stays the screen name rather than that person's own name.
  if (options.length < 2) {
    return (
      <Typography
        variant="headline"
        weight="semibold"
        numberOfLines={1}
        align="center"
        testID="pension-member-switcher-title"
      >
        Pension
      </Typography>
    );
  }

  const label = pensionScopeLabel(options, scopeIsStale ? null : selectedMemberId);

  const onSelect = (memberId: string | null) => {
    setIsOpen(false);
    if (memberId !== selectedMemberId) setSelectedMember(memberId);
  };

  const rowStyle = (selected: boolean) =>
    StyleSheet.flatten([
      styles.row,
      {
        backgroundColor: colors.backgroundSecondary,
        // Reserve the ring's width on every row so selecting one doesn't nudge
        // the list.
        borderColor: selected ? colors.primary : 'transparent',
      },
    ]);

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        activeOpacity={0.7}
        onPress={() => setIsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Pension: ${label}. Switch member`}
        testID="pension-member-switcher-trigger"
      >
        <Typography
          variant="headline"
          weight="semibold"
          numberOfLines={1}
          style={styles.triggerLabel}
          testID="pension-member-switcher-title"
        >
          {label}
        </Typography>
        <Icon name="chevron-down" size={IconSize.sm} color={colors.textSecondary} />
      </TouchableOpacity>

      <AdaptiveModal visible={isOpen} onClose={() => setIsOpen(false)}>
        <View
          style={[styles.sheet, { backgroundColor: colors.backgroundMain }]}
          testID="pension-member-switcher-sheet"
        >
          <SheetHeader
            title="Whose pension"
            leftVariant="close"
            onLeftPress={() => setIsOpen(false)}
            leftTestID="pension-member-switcher-close"
            leftAccessibilityLabel="Close"
          />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {/* "Everyone" lists each person's rows side by side — it never sums
                room across members, which would be a number nobody can act on. */}
            <TouchableOpacity
              style={rowStyle(selectedMemberId === null)}
              activeOpacity={0.7}
              onPress={() => onSelect(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedMemberId === null }}
              accessibilityLabel="Show every member"
              testID="pension-member-switcher-row-all"
            >
              <Icon
                name={selectedMemberId === null ? 'checkmark-circle' : 'ellipse-outline'}
                size={IconSize.lg}
                color={selectedMemberId === null ? colors.primary : colors.textTertiary}
              />
              <View style={styles.rowMeta}>
                <Typography variant="body" weight="semibold">
                  Everyone
                </Typography>
                <Typography variant="caption" color={colors.textSecondary}>
                  Every member&apos;s room, goals and contributions
                </Typography>
              </View>
            </TouchableOpacity>

            {options.map((option) => {
              const selected = option.id === selectedMemberId;
              const member = rosterById.get(option.id);
              return (
                <TouchableOpacity
                  key={option.id}
                  style={rowStyle(selected)}
                  activeOpacity={0.7}
                  onPress={() => onSelect(option.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Show ${option.label} only`}
                  testID={`pension-member-switcher-row-${option.id}`}
                >
                  <Icon
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={IconSize.lg}
                    color={selected ? colors.primary : colors.textTertiary}
                    testID={selected ? `pension-member-switcher-selected-${option.id}` : undefined}
                  />
                  <Avatar
                    user={{
                      display_name: member?.display_name ?? option.label,
                      avatar_url: member?.avatar_url ?? null,
                    }}
                    size="sm"
                  />
                  <View style={styles.rowMeta}>
                    <Typography variant="body" weight="semibold" numberOfLines={1}>
                      {option.label}
                    </Typography>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </AdaptiveModal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    gap: Spacing.xxs,
  },
  triggerLabel: {
    flexShrink: 1,
  },
  sheet: {
    flex: 1,
  },
  sheetContent: {
    padding: Spacing.base,
    gap: Spacing.sm,
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
  },
  rowMeta: {
    flex: 1,
    gap: Spacing.xxs,
  },
});
