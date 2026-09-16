import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import { todayDateKey } from '../healthLocalStorage';
import {
  addWaterAmount,
  clampGoalMl,
  deleteWaterEntry,
  formatEntryTime,
  formatVolume,
  loadWaterDay,
  loadWaterPrefs,
  parseVolume,
  saveWaterUnit,
  setWaterGoalMl,
  stepMl,
  toUnitInput,
  unitLabel,
  WATER_GOAL_PRESETS_ML,
  WATER_PRESETS,
  waterGlasses,
  waterProgress,
  waterRemainingMl,
  type WaterDayDetail,
  type WaterUnit,
} from '../healthWaterStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Water tab — the donor's `WaterIntakeView` (422 lines), which Home's ±1-cup
 * counter never was.
 *
 * What this surface adds over the counter: the three preset quick-adds, a
 * custom amount, today's per-entry log with a real per-row delete, an editable
 * goal, and an ml/oz display choice.
 *
 * ONE RECORD, TWO SURFACES. Both write the same `/health/water/entries` rows and
 * both refresh `health.water.v1`, so a cup added on Home appears in this log and
 * a drink deleted here moves Home's counter. Home keeps counting CUPS because
 * that is the only thing a ±1 control can mean; this screen counts millilitres
 * because a 500 ml bottle is not two cups.
 *
 * The donor's animated wave is deliberately not ported: it is a per-frame
 * `Canvas` in a `TimelineView(.animation)`, i.e. a continuously repainting
 * surface, and the figure it encodes — progress against the goal — is already
 * carried by the ring, the caption and the glasses row. Three ways to say it is
 * enough; a fourth that spins the CPU is not.
 */

/** Rejected input restores the last good value rather than showing an error. */
function sanitizeAmount(raw: string): string {
  return raw.replace(/[^0-9.]/g, '').slice(0, 6);
}

/** The four display units — same set the onboarding water step offers. */
const WATER_UNIT_OPTIONS: { key: WaterUnit; label: string; a11yLabel: string }[] = [
  { key: 'ml', label: 'ml', a11yLabel: 'millilitres' },
  { key: 'L', label: 'L', a11yLabel: 'litres' },
  { key: 'cups', label: 'cups', a11yLabel: 'cups' },
  { key: 'oz', label: 'fl oz', a11yLabel: 'fluid ounces' },
];

export function HealthWaterScreen() {
  const colors = useAppColors();

  const [day, setDay] = useState<WaterDayDetail | null>(null);
  const [unit, setUnit] = useState<WaterUnit>('ml');
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [busy, setBusy] = useState(false);

  const hydrate = useCallback(async () => {
    const [today, prefs] = await Promise.all([loadWaterDay(), loadWaterPrefs()]);
    setDay(today);
    setUnit(prefs.unit);
    setLoading(false);
  }, []);

  // Hydrates on mount AND every subsequent focus (leave-and-return) — a plain
  // mount-only `useEffect` would be redundant with this, since `useFocusEffect`
  // already fires immediately when the screen is focused on first render.
  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );
  // Also re-hydrate the instant a HealthKit sync lands while already on this
  // tab — the background observer/catch-up paths don't wait for a nav event.
  useHealthKitSyncHydration(hydrate);

  const progress = useMemo(() => (day ? waterProgress(day) : 0), [day]);
  const remaining = useMemo(() => (day ? waterRemainingMl(day) : 0), [day]);
  const glasses = useMemo(() => (day ? waterGlasses(day) : { filled: 0, total: 8 }), [day]);
  const goalReached = !!day && day.totalMl >= day.goalMl;
  const step = stepMl(unit);
  const customMl = parseVolume(custom, unit);

  const handleAdd = async (amountMl: number, container?: string) => {
    if (busy || amountMl <= 0) return;
    setBusy(true);
    try {
      setDay(await addWaterAmount(amountMl, { container: container ?? null }));
    } finally {
      setBusy(false);
    }
  };

  const handleAddCustom = async () => {
    if (customMl <= 0) return;
    await handleAdd(customMl);
    setCustom('');
  };

  const handleDelete = (id: string, amountMl: number) => {
    Alert.alert('Remove drink', `Remove ${formatVolume(amountMl, unit)} from today?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void deleteWaterEntry(id, todayDateKey()).then(setDay),
      },
    ]);
  };

  const handleUnit = async (next: WaterUnit) => {
    setUnit(next);
    setCustom('');
    await saveWaterUnit(next);
  };

  const openGoalEditor = () => {
    // `day` and `loading` are always set TOGETHER at the end of `hydrate`
    // (never independently, and never back to null afterwards), and the
    // "Change goal" row that calls this is itself hidden by
    // `HealthSectionScreen` while `loading` is true — so this can never
    // actually fire with a null `day`. Kept as a guard against a future
    // caller of this handler breaking that invariant.
    /* istanbul ignore next */
    if (!day) return;
    setGoalDraft(toUnitInput(day.goalMl, unit));
    setEditingGoal(true);
  };

  const handleSaveGoal = async (explicitMl?: number) => {
    const parsed = explicitMl ?? parseVolume(goalDraft, unit);
    if (parsed <= 0) {
      // Invalid input silently restores rather than surfacing a parse error.
      setEditingGoal(false);
      return;
    }
    setDay(await setWaterGoalMl(clampGoalMl(parsed)));
    setEditingGoal(false);
  };

  return (
    <HealthSectionScreen title="Water" testID="health-water-screen" loading={loading}>
      {/* Hero — total vs goal, with the same figure spelled three ways */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.heroRow}>
          <ProgressRing
            progress={progress}
            size={132}
            stroke={12}
            showPercent={false}
            color={colors.primary}
            testID="health-water-ring"
          >
            <Typography variant="title2" weight="bold" color={colors.textPrimary}>
              {formatVolume(day?.totalMl ?? 0, unit)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              of {formatVolume(day?.goalMl ?? 0, unit)}
            </Typography>
          </ProgressRing>

          <View style={styles.heroSide}>
            <Typography
              variant="body"
              weight="medium"
              color={goalReached ? colors.success : colors.textPrimary}
              testID="health-water-remaining"
            >
              {goalReached
                ? 'Goal reached'
                : `${formatVolume(remaining, unit)} to go`}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {glasses.filled} of {glasses.total} glasses
            </Typography>
            <View
              style={styles.glassRow}
              accessible
              accessibilityLabel={`${glasses.filled} of ${glasses.total} glasses`}
            >
              {Array.from({ length: glasses.total }).map((_, index) => (
                <View
                  // A fixed-length row of anonymous glass slots — index IS identity.
                  key={index}
                  style={[
                    styles.glass,
                    {
                      backgroundColor:
                        index < glasses.filled ? colors.primary : colors.borderColor,
                    },
                  ]}
                />
              ))}
            </View>
            <Pressable
              onPress={openGoalEditor}
              accessibilityRole="button"
              accessibilityLabel="Change daily water goal"
              testID="health-water-edit-goal"
              hitSlop={8}
              style={styles.linkRow}
            >
              <Icon name="edit" size={14} color={colors.primary} />
              <Typography variant="caption1" color={colors.primary}>
                Change goal
              </Typography>
            </Pressable>
          </View>
        </View>

        {/* Unit — DISPLAY only; every stored figure stays in millilitres */}
        <View style={styles.unitRow}>
          {WATER_UNIT_OPTIONS.map((option) => {
            const selected = unit === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => void handleUnit(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Show amounts in ${option.a11yLabel}`}
                testID={`health-water-unit-${option.key}`}
                style={[
                  styles.unitChip,
                  {
                    backgroundColor: selected ? colors.primary : 'transparent',
                    borderColor: selected ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="medium"
                  color={selected ? colors.white : colors.textSecondary}
                >
                  {option.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* Goal editor — donor `WaterGoalEditor` presets plus a typed amount */}
      {editingGoal ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-water-goal-editor"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            DAILY GOAL
          </Typography>
          <View style={styles.presetWrap}>
            {WATER_GOAL_PRESETS_ML.map((ml) => (
              <Pressable
                key={ml}
                onPress={() => void handleSaveGoal(ml)}
                accessibilityRole="button"
                accessibilityLabel={`Set goal to ${formatVolume(ml, unit)}`}
                testID={`health-water-goal-preset-${ml}`}
                style={[styles.goalChip, { borderColor: colors.borderColor }]}
              >
                <Typography variant="caption1" color={colors.textPrimary}>
                  {formatVolume(ml, unit)}
                </Typography>
              </Pressable>
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput
              value={goalDraft}
              onChangeText={(text) => setGoalDraft(sanitizeAmount(text))}
              keyboardType="decimal-pad"
              placeholder={`Goal in ${unitLabel(unit)}`}
              placeholderTextColor={colors.textSecondary}
              testID="health-water-goal-input"
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.backgroundMain,
                },
              ]}
            />
            <Pressable
              onPress={() => void handleSaveGoal()}
              accessibilityRole="button"
              accessibilityLabel="Save water goal"
              testID="health-water-goal-save"
              style={[styles.addButton, { backgroundColor: colors.primary }]}
            >
              <Icon name="checkmark" size={20} color={colors.white} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => setEditingGoal(false)}
            accessibilityRole="button"
            testID="health-water-goal-cancel"
            hitSlop={8}
          >
            <Typography variant="caption1" color={colors.textSecondary}>
              Cancel
            </Typography>
          </Pressable>
        </Card>
      ) : null}

      {/* Preset quick-adds — the donor's Glass / Mug / Bottle, exact amounts */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          QUICK ADD
        </Typography>
        <View style={styles.presetWrap}>
          {WATER_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => void handleAdd(preset.ml, preset.id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Add a ${preset.label}, ${formatVolume(preset.ml, unit)}`}
              accessibilityState={{ disabled: busy }}
              testID={`health-water-preset-${preset.id.toLowerCase()}`}
              style={[
                styles.preset,
                { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
              ]}
            >
              <Icon name={preset.icon} size={24} color={colors.primary} />
              <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
                {formatVolume(preset.ml, unit)}
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary}>
                {preset.label}
              </Typography>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* Custom amount — a typed figure with ± steps, not the donor's wheel */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          CUSTOM AMOUNT
        </Typography>
        <View style={styles.addRow}>
          <Pressable
            onPress={() => {
              const next = Math.max(0, (customMl || 0) - step);
              setCustom(toUnitInput(next, unit));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Decrease by ${formatVolume(step, unit)}`}
            testID="health-water-custom-minus"
            style={[styles.stepButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="remove" size={20} color={colors.textPrimary} />
          </Pressable>
          <TextInput
            value={custom}
            onChangeText={(text) => setCustom(sanitizeAmount(text))}
            keyboardType="decimal-pad"
            placeholder={unitLabel(unit)}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            onSubmitEditing={() => void handleAddCustom()}
            testID="health-water-custom-input"
            style={[
              styles.input,
              styles.customInput,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          <Pressable
            onPress={() => {
              const next = (customMl || 0) + step;
              setCustom(toUnitInput(next, unit));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Increase by ${formatVolume(step, unit)}`}
            testID="health-water-custom-plus"
            style={[styles.stepButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="add" size={20} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={() => void handleAddCustom()}
            disabled={customMl <= 0 || busy}
            accessibilityRole="button"
            accessibilityLabel="Add custom amount"
            accessibilityState={{ disabled: customMl <= 0 || busy }}
            testID="health-water-custom-add"
            style={[
              styles.addButton,
              { backgroundColor: customMl > 0 && !busy ? colors.primary : colors.borderColor },
            ]}
          >
            <Icon name="add" size={22} color={colors.white} />
          </Pressable>
        </View>
      </Card>

      {/* Today's log — one row per drink, each individually removable */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.logHeader}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            TODAY&apos;S LOG
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            {day?.entries.length ?? 0} {day?.entries.length === 1 ? 'entry' : 'entries'}
          </Typography>
        </View>

        {(day?.entries.length ?? 0) === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-water-log-empty">
            Nothing logged yet today. Use a quick add above.
          </Typography>
        ) : (
          day?.entries.map((entry) => (
            <View key={entry.id} style={styles.logRow} testID={`health-water-entry-${entry.id}`}>
              <View style={[styles.logIcon, { backgroundColor: colors.backgroundMain }]}>
                <Icon name="water" size={18} color={colors.primary} />
              </View>
              <View style={styles.logText}>
                <Typography variant="body" weight="medium" color={colors.textPrimary}>
                  {formatVolume(entry.amountMl, unit)}
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {[entry.container, formatEntryTime(entry.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </View>
              <Pressable
                onPress={() => handleDelete(entry.id, entry.amountMl)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${formatVolume(entry.amountMl, unit)}`}
                testID={`health-water-delete-${entry.id}`}
                hitSlop={8}
              >
                <Icon name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))
        )}
      </Card>
    </HealthSectionScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  heroSide: {
    flex: 1,
    gap: Spacing.xs,
  },
  glassRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  glass: {
    width: 10,
    height: 16,
    borderRadius: 3,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
  },
  unitRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  unitChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.xxl,
    borderWidth: 1,
  },
  presetWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  preset: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  goalChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  customInput: {
    textAlign: 'center',
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  logIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logText: {
    flex: 1,
    gap: 2,
  },
});
