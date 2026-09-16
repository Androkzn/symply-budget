import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { BottomSheet, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

/**
 * WHICH budget you are looking at — the first question Invite & Household
 * raises and, until this card, the last one it answered.
 *
 * The hub opened on "Share a budget with someone", then a list of the people in
 * a household it never named, and the household itself was a row at the very
 * bottom under MANAGE. Someone holding two households — which BR-016 makes
 * ordinary — had to scroll past both an invite form and a member list to find
 * out whose members they had just been reading.
 *
 * So the household leads, and it takes the shape of the answer it has to give:
 *
 *  - **one household** — a CARD. There is nothing to choose, so offering a
 *    chooser would be a control that does nothing on tap; it states the name and
 *    goes to that household's edit sheet instead.
 *  - **several** — the same card as a DROPDOWN. Tapping it lists them, and
 *    picking one switches the engine to it.
 *
 * Every household in the list carries its own edit button, so the one thing the
 * single-household card promises — tap it, rename it — stays reachable when a
 * second household turns the card into a picker.
 */

export interface BudgetHouseholdChoice {
  id: string;
  name: string;
  /** As the engine spells it: `owner` / `member`. */
  role: string;
  isActive: boolean;
}

interface BudgetHouseholdSwitcherCardProps {
  households: BudgetHouseholdChoice[];
  /** Move the engine to that household. Rejections are the caller's to report. */
  onSelect: (householdId: string) => Promise<void> | void;
  /** Open that household's edit sheet — rename, delete, leave. */
  onEdit: (householdId: string) => void;
  /** The households screen itself, for creating and removing. */
  onManage: () => void;
}

/** `owner` → `Owner`. The engine stores the role lower-case; a card is a label. */
function roleLabel(role: string): string {
  if (!role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * "Owner — tap to rename this household", or just the hint when the role is
 * missing. A cold session registry can hold a household whose role has not been
 * learned yet, and "— tap to rename" with a dangling dash reads as a bug.
 */
function withRole(role: string, hint: string): string {
  const label = roleLabel(role);
  return label ? `${label} — ${hint}` : hint;
}

export function BudgetHouseholdSwitcherCard({
  households,
  onSelect,
  onEdit,
  onManage,
}: BudgetHouseholdSwitcherCardProps) {
  const colors = useAppColors();
  const [isOpen, setIsOpen] = useState(false);
  /** The row being switched to, if any — see `handleSelect`. */
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // The engine always has exactly one active session, but the list can arrive a
  // render before the active flag does (a switch in flight, a store copy read
  // cold), and a card with no name is worse than the first household's name.
  const active = households.find((household) => household.isActive) ?? households[0] ?? null;
  if (!active) return null;

  const isDropdown = households.length > 1;

  /**
   * Awaited, with the row spinning, rather than dismissed on tap.
   *
   * Activation hydrates that household's rows on its first visit, so an
   * optimistic dismiss drops the member back onto a hub still describing the
   * household they just left — which reads as the switch having failed. The
   * sheet closes when the engine has actually moved.
   */
  const handleSelect = async (choice: BudgetHouseholdChoice) => {
    if (switchingId) return;
    if (choice.isActive) {
      setIsOpen(false);
      return;
    }
    setSwitchingId(choice.id);
    try {
      await onSelect(choice.id);
      setIsOpen(false);
    } finally {
      setSwitchingId(null);
    }
  };

  const handleEdit = (householdId: string) => {
    setIsOpen(false);
    onEdit(householdId);
  };

  const subtitle = isDropdown
    ? withRole(active.role, 'tap to switch household')
    : withRole(active.role, 'tap to rename this household');

  return (
    <View style={styles.block} testID="budget-household-switcher">
      <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
        HOUSEHOLD
      </Typography>

      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        onPress={() => (isDropdown ? setIsOpen(true) : onEdit(active.id))}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={
          isDropdown
            ? `Household ${active.name}. ${households.length} on this device. Tap to switch.`
            : `Household ${active.name}. Tap to edit.`
        }
        testID="budget-household-switcher-trigger"
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}>
          <Icon name="home-outline" forceIonicons size={IconSize.lg} color={colors.primary} />
        </View>

        <View style={styles.cardText}>
          <Typography variant="headline" weight="semibold" numberOfLines={1}>
            {active.name}
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            {subtitle}
          </Typography>
        </View>

        {isDropdown ? (
          <View style={styles.trailing}>
            <View style={[styles.countPill, { backgroundColor: colors.primary + '22' }]}>
              <Typography variant="caption2" weight="semibold" color={colors.primary}>
                {households.length}
              </Typography>
            </View>
            <Icon
              name="chevron-down"
              forceIonicons
              size={IconSize.md}
              color={colors.textSecondary}
            />
          </View>
        ) : (
          <Icon
            name="chevron-forward"
            forceIonicons
            size={IconSize.md}
            color={colors.textSecondary}
          />
        )}
      </TouchableOpacity>

      <BottomSheet
        visible={isOpen}
        onClose={() => setIsOpen(false)}
        height="content"
        title="Switch household"
        showCloseButton
      >
        <View style={styles.sheet} testID="budget-household-picker-sheet">
          {households.map((household) => (
            <View
              key={household.id}
              style={[
                styles.pickerRow,
                {
                  backgroundColor: household.isActive
                    ? colors.primary + '15'
                    : colors.backgroundSecondary,
                  borderColor: household.isActive ? colors.primary : colors.borderColor,
                },
              ]}
            >
              <TouchableOpacity
                style={styles.pickerRowMain}
                onPress={() => {
                  void handleSelect(household);
                }}
                // Every row goes dead while one switch is in flight: a second
                // activation queues behind the first on the engine's session
                // chain and lands the member where they tapped two taps ago.
                disabled={switchingId !== null}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`budget-household-picker-item-${household.id}`}
              >
                <Icon
                  name="home-outline"
                  forceIonicons
                  size={IconSize.md}
                  color={household.isActive ? colors.primary : colors.textSecondary}
                />
                <View style={styles.pickerRowText}>
                  <Typography variant="body" weight={household.isActive ? 'semibold' : 'regular'}>
                    {household.name}
                  </Typography>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    {household.isActive
                      ? withRole(household.role, 'you are in this one')
                      : roleLabel(household.role)}
                  </Typography>
                </View>
                {switchingId === household.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : household.isActive ? (
                  <Icon
                    name="checkmark-circle"
                    forceIonicons
                    size={IconSize.md}
                    color={colors.primary}
                  />
                ) : null}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleEdit(household.id)}
                disabled={switchingId !== null}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.pickerEdit}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${household.name}`}
                testID={`budget-household-picker-edit-${household.id}`}
              >
                <Icon
                  name="create-outline"
                  forceIonicons
                  size={IconSize.md}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          ))}

          {/* Adding and removing a household are the households screen's, not a
              picker's — but somebody who opened this to look for one of them
              should not have to close it and hunt for the row underneath. */}
          <TouchableOpacity
            style={styles.manageRow}
            onPress={() => {
              setIsOpen(false);
              onManage();
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID="budget-household-picker-manage"
          >
            <Icon name="add-circle-outline" forceIonicons size={IconSize.md} color={colors.primary} />
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Add or remove households
            </Typography>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: Spacing.lg },
  groupLabel: {
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  sheet: { paddingBottom: Spacing.lg, gap: Spacing.sm },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    paddingRight: Spacing.sm,
  },
  pickerRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.base,
  },
  pickerRowText: { flex: 1, gap: 2 },
  pickerEdit: { padding: Spacing.sm },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.base,
  },
});
