import React, { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  parseCaloriesInput,
  parseMacroInput,
  sanitizeAmountInput,
  type MealEntry,
  type MealSlot,
} from '../healthNutritionStorage';

import { MACRO_SERIES } from './HealthMacroBreakdown';

/**
 * Symply Health — the contents of one meal slot (donor `mealEntryRow` +
 * `EditNutritionEntrySheet` + `MoveFoodSheet`, folded into one inline surface).
 *
 * Three actions per item, which is what the donor's context menu offered:
 * edit, move to another meal, delete.
 *
 * ON RULE 1 (never recompute nutrition on the device): the typed editor changes
 * the TYPED figures — the same numbers the manual add row collects — and does
 * not rescale anything.
 *
 * The PORTION control beside it is the one thing that does rescale, and it does
 * not do the arithmetic either: it hands the new portion to
 * `/nutrition/entries/:id/portion` and renders whatever the server derives from
 * the row's stored `base_*_per_100` (0124). It appears only when the row HAS
 * that basis (`entry.canReportion`) — a hand-typed row, or one logged before
 * 0124, has nothing to rescale from and gets the typed editor alone rather than
 * a control that would 400.
 */

export interface MealEntryPatch {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface HealthMealDetailProps {
  slot: MealSlot;
  entries: MealEntry[];
  /** Id of the row currently being written — its controls lock while in flight. */
  busyEntryId?: string | null;
  onSaveEntry: (entry: MealEntry, patch: MealEntryPatch) => void;
  onMoveEntry: (entry: MealEntry, target: MealSlot) => void;
  onDeleteEntry: (entry: MealEntry) => void;
  /** Re-derive this row's macros for a new portion. Server-side arithmetic. */
  onReportionEntry?: (entry: MealEntry, portion: number) => void;
  /**
   * Multi-select (donor `multiSelectActionButtons`). Supplying `onToggleSelect`
   * puts the slot into selection mode: every row gains a tick box and LOSES its
   * edit / move / delete buttons, because the donor suppresses the per-row
   * context menu while selecting and two competing delete affordances on one row
   * is how you delete the wrong thing.
   */
  selectedIds?: readonly string[];
  onToggleSelect?: (entry: MealEntry) => void;
}

/** The editor's raw field values, before parsing. */
export interface MealEntryDraft {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  /** Blank when the row has no basis — the portion field is hidden for those. */
  portion: string;
}

const INVALID_MESSAGE = 'Calories must be a number above zero, and macros numbers in grams.';
const INVALID_PORTION_MESSAGE = 'A portion has to be a number above zero.';

/** Mirrors the route bound: `z.number().positive().max(1000)`. */
const MAX_PORTION = 1000;

/**
 * `null` when the typed portion cannot be sent. Decimals are KEPT — half a
 * serving is a real portion, and rounding it here would ask the server to derive
 * from a basis the user never typed.
 */
export function portionFromDraft(raw: string): number | null {
  const normalized = (raw ?? '').trim().replace(',', '.');
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_PORTION) return null;
  return value;
}

function draftFrom(entry: MealEntry): MealEntryDraft {
  return {
    name: entry.name,
    calories: String(entry.calories),
    protein: String(entry.protein),
    carbs: String(entry.carbs),
    fat: String(entry.fat),
    portion: entry.portion === undefined ? '' : String(entry.portion),
  };
}

/** `null` when the draft cannot be saved — the caller shows friendly copy. */
export function patchFromDraft(draft: MealEntryDraft): MealEntryPatch | null {
  const calories = parseCaloriesInput(draft.calories);
  const protein = parseMacroInput(draft.protein);
  const carbs = parseMacroInput(draft.carbs);
  const fat = parseMacroInput(draft.fat);
  if (calories === null || calories <= 0) return null;
  if (protein === null || carbs === null || fat === null) return null;
  return { name: draft.name.trim(), calories, protein, carbs, fat };
}

export function HealthMealDetail({
  slot,
  entries,
  busyEntryId = null,
  onSaveEntry,
  onMoveEntry,
  onDeleteEntry,
  onReportionEntry,
  selectedIds,
  onToggleSelect,
}: HealthMealDetailProps) {
  const colors = useAppColors();
  const selecting = onToggleSelect !== undefined;
  const selected = new Set(selectedIds ?? []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealEntryDraft | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [showInvalidPortion, setShowInvalidPortion] = useState(false);

  const startEdit = useCallback((entry: MealEntry) => {
    setMovingId(null);
    setMenuId(null);
    setShowInvalid(false);
    setShowInvalidPortion(false);
    setEditingId(entry.id);
    setDraft(draftFrom(entry));
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft(null);
    setShowInvalid(false);
    setShowInvalidPortion(false);
  }, []);

  const commitEdit = useCallback(
    (entry: MealEntry) => {
      /* istanbul ignore next -- unreachable: the Save button lives inside
         `isEditing && draft`, so there is no draft-less press. Kept because the
         narrowing below needs it. */
      if (!draft) return;
      const patch = patchFromDraft(draft);
      if (!patch) {
        setShowInvalid(true);
        return;
      }
      cancelEdit();
      onSaveEntry(entry, patch);
    },
    [draft, cancelEdit, onSaveEntry]
  );

  /**
   * Apply a new portion. Separate from Save on purpose: Save writes the typed
   * figures, this one asks the SERVER to re-derive them, and folding the two
   * into one button would make it impossible to tell which number won.
   */
  const commitPortion = useCallback(
    (entry: MealEntry) => {
      /* istanbul ignore next -- unreachable: Rescale renders only inside
         `isEditing && draft` AND `entry.canReportion && onReportionEntry`, so
         both are set by the time it can be pressed. Kept for the narrowing. */
      if (!draft || !onReportionEntry) return;
      const portion = portionFromDraft(draft.portion);
      if (portion === null) {
        setShowInvalidPortion(true);
        return;
      }
      setShowInvalidPortion(false);
      cancelEdit();
      onReportionEntry(entry, portion);
    },
    [draft, cancelEdit, onReportionEntry]
  );

  const testID = `health-meal-detail-${slot}`;

  if (entries.length === 0) {
    return (
      <View style={styles.wrap} testID={testID}>
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID={`${testID}-empty`}
          accessibilityLabel={`Nothing logged for ${MEAL_SLOT_LABELS[slot]} yet`}
        >
          Nothing logged for {MEAL_SLOT_LABELS[slot].toLowerCase()} yet.
        </Typography>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      {entries.map((entry) => {
        // Selection mode wins: an editor left open behind a tick box would let
        // the same row be edited and deleted by two different gestures.
        const isEditing = !selecting && editingId === entry.id;
        const isMoving = !selecting && movingId === entry.id;
        const menuOpen = !selecting && menuId === entry.id;
        const busy = busyEntryId === entry.id;
        const isSelected = selected.has(entry.id);

        return (
          <View
            key={entry.id}
            testID={`health-meal-item-${entry.id}`}
            style={[styles.row, { borderTopColor: colors.borderColor }]}
          >
            <View style={styles.rowHead}>
              {selecting ? (
                <Pressable
                  onPress={() => onToggleSelect?.(entry)}
                  hitSlop={8}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Select ${entry.name}`}
                  accessibilityState={{ checked: isSelected, selected: isSelected }}
                  testID={`health-meal-select-${entry.id}`}
                  style={[
                    styles.checkbox,
                    {
                      borderColor: isSelected ? colors.primary : colors.borderColor,
                      backgroundColor: isSelected ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  {isSelected ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
                </Pressable>
              ) : null}
              <View style={styles.rowText}>
                <Typography variant="body" color={colors.textPrimary} numberOfLines={2}>
                  {entry.name}
                </Typography>
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  testID={`health-meal-item-${entry.id}-kcal`}
                >
                  {entry.calories} kcal
                  {/* The portion the macros describe. Shown only when the row
                      carries one, so a hand-typed entry does not gain a
                      meaningless "1 serving". */}
                  {entry.canReportion && entry.portion !== undefined
                    ? ` · ${entry.portion}${entry.unit ? ` ${entry.unit}` : ''}`
                    : ''}
                </Typography>
                <View style={styles.pills}>
                  {MACRO_SERIES.map((series) => (
                    <View key={series.key} style={styles.pill}>
                      <View style={[styles.pillDot, { backgroundColor: series.color }]} />
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {series.short} {entry[series.key]}g
                      </Typography>
                    </View>
                  ))}
                </View>
              </View>

              {/* Rendered away, not hidden: a `display: none` row action is
                  still in the tree, still focusable by assistive tech and still
                  findable by an E2E flow that has no business reaching it. */}
              {selecting ? null : (
                <View style={styles.actions}>
                  <RowAction
                    icon="ellipsis-horizontal"
                    label={menuOpen ? `Close actions for ${entry.name}` : `Actions for ${entry.name}`}
                    testID={`health-meal-more-${entry.id}`}
                    disabled={busy}
                    onPress={() => setMenuId(menuOpen ? null : entry.id)}
                  />
                </View>
              )}
            </View>

            {/* One row, three verbs — folded behind the "more" button instead
                of three permanently-visible icons, so the row stays readable
                at a glance and the card has room to breathe. */}
            {menuOpen ? (
              <View style={styles.menuRow} testID={`health-meal-menu-${entry.id}`}>
                <Pressable
                  onPress={() => startEdit(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${entry.name}`}
                  testID={`health-meal-menu-edit-${entry.id}`}
                  style={[styles.menuChip, { borderColor: colors.borderColor }]}
                >
                  <Icon name="create-outline" size={14} color={colors.textSecondary} />
                  <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                    Edit
                  </Typography>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMovingId(entry.id);
                    setMenuId(null);
                    setEditingId(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${entry.name} to another meal`}
                  testID={`health-meal-menu-move-${entry.id}`}
                  style={[styles.menuChip, { borderColor: colors.borderColor }]}
                >
                  <Icon name="swap-horizontal" size={14} color={colors.textSecondary} />
                  <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                    Move
                  </Typography>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMenuId(null);
                    onDeleteEntry(entry);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${entry.name}`}
                  testID={`health-meal-menu-delete-${entry.id}`}
                  style={[styles.menuChip, { borderColor: colors.error }]}
                >
                  <Icon name="trash-outline" size={14} color={colors.error} />
                  <Typography variant="caption1" weight="semibold" color={colors.error}>
                    Delete
                  </Typography>
                </Pressable>
              </View>
            ) : null}

            {isMoving ? (
              <View style={styles.moveRow} testID={`health-meal-move-${entry.id}-options`}>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Move to
                </Typography>
                {MEAL_SLOTS.filter((option) => option !== entry.slot).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => {
                      setMovingId(null);
                      onMoveEntry(entry, option);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${entry.name} to ${MEAL_SLOT_LABELS[option]}`}
                    testID={`health-meal-move-${entry.id}-${option}`}
                    style={[styles.moveChip, { borderColor: colors.borderColor }]}
                  >
                    <Typography variant="caption1" weight="semibold" color={colors.primary}>
                      {MEAL_SLOT_LABELS[option]}
                    </Typography>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {isEditing && draft ? (
              <View style={styles.editor} testID={`health-meal-edit-${entry.id}-form`}>
                <TextInput
                  value={draft.name}
                  onChangeText={(text) => setDraft({ ...draft, name: text })}
                  placeholder="What did you eat?"
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={`Name for ${entry.name}`}
                  testID={`health-meal-edit-name-${entry.id}`}
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                      backgroundColor: colors.backgroundMain,
                    },
                  ]}
                />
                <View style={styles.editAmounts}>
                  <EditField
                    label="kcal"
                    value={draft.calories}
                    onChange={(next) => setDraft({ ...draft, calories: next })}
                    accessibilityLabel={`Calories for ${entry.name}`}
                    testID={`health-meal-edit-calories-${entry.id}`}
                  />
                  <EditField
                    label="P (g)"
                    value={draft.protein}
                    onChange={(next) => setDraft({ ...draft, protein: next })}
                    accessibilityLabel={`Protein grams for ${entry.name}`}
                    testID={`health-meal-edit-protein-${entry.id}`}
                  />
                  <EditField
                    label="C (g)"
                    value={draft.carbs}
                    onChange={(next) => setDraft({ ...draft, carbs: next })}
                    accessibilityLabel={`Carb grams for ${entry.name}`}
                    testID={`health-meal-edit-carbs-${entry.id}`}
                  />
                  <EditField
                    label="F (g)"
                    value={draft.fat}
                    onChange={(next) => setDraft({ ...draft, fat: next })}
                    accessibilityLabel={`Fat grams for ${entry.name}`}
                    testID={`health-meal-edit-fat-${entry.id}`}
                  />
                </View>
                {showInvalid ? (
                  <Typography
                    variant="caption1"
                    color={colors.error}
                    testID={`health-meal-edit-error-${entry.id}`}
                  >
                    {INVALID_MESSAGE}
                  </Typography>
                ) : null}

                {entry.canReportion && onReportionEntry ? (
                  <View style={styles.portionRow} testID={`health-meal-portion-${entry.id}-row`}>
                    <EditField
                      label={`Portion${entry.unit ? ` (${entry.unit})` : ''}`}
                      value={draft.portion}
                      onChange={(next) => setDraft({ ...draft, portion: next })}
                      accessibilityLabel={`Portion for ${entry.name}`}
                      testID={`health-meal-portion-${entry.id}`}
                    />
                    <Pressable
                      onPress={() => commitPortion(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={`Rescale ${entry.name} to the new portion`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      testID={`health-meal-portion-apply-${entry.id}`}
                      style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
                    >
                      <Typography variant="footnote" weight="semibold" color={colors.primary}>
                        Rescale
                      </Typography>
                    </Pressable>
                  </View>
                ) : null}
                {entry.canReportion && onReportionEntry ? (
                  <Typography
                    variant="caption1"
                    color={showInvalidPortion ? colors.error : colors.textSecondary}
                    testID={`health-meal-portion-note-${entry.id}`}
                  >
                    {showInvalidPortion
                      ? INVALID_PORTION_MESSAGE
                      : 'Rescaling asks the server to work the macros out for the new portion.'}
                  </Typography>
                ) : null}
                <View style={styles.editActions}>
                  <Pressable
                    onPress={cancelEdit}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel editing ${entry.name}`}
                    testID={`health-meal-edit-cancel-${entry.id}`}
                    style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
                  >
                    <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                      Cancel
                    </Typography>
                  </Pressable>
                  <Pressable
                    onPress={() => commitEdit(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={`Save changes to ${entry.name}`}
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    testID={`health-meal-edit-save-${entry.id}`}
                    style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                  >
                    <Typography variant="footnote" weight="semibold" color={colors.white}>
                      Save
                    </Typography>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function RowAction({
  icon,
  label,
  testID,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  testID: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[styles.action, { borderColor: colors.borderColor, opacity: disabled ? 0.4 : 1 }]}
    >
      <Icon name={icon} size={15} color={colors.textSecondary} />
    </Pressable>
  );
}

function EditField({
  label,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.editField}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(sanitizeAmountInput(text))}
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={[
          styles.editInput,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.xxs,
  },
  row: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  action: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  menuChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  moveChip: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  editor: {
    gap: Spacing.sm,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  editAmounts: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  portionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  editField: {
    flex: 1,
    gap: Spacing.xxs,
  },
  editInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.lg,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
