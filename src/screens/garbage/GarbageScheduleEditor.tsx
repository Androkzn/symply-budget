import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';

import { garbageCollectionApi } from '@api/garbage-collection';
import type { GarbageScheduleType } from '@api/garbage-collection';
import { Typography, Button, Card } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

type StreamType = 'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem';
type EditableFrequency = 'weekly' | 'biweekly' | 'monthly' | 'on-request';

interface GarbageScheduleEditorProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  title?: string;
  municipality?: string;
  setOutTime?: string;
  /** Pre-fill (from AI detection or an existing schedule). Each stream keeps
   *  its OWN frequency and day — nothing is collapsed. */
  initialSchedules: GarbageScheduleType[];
  /** AI guidance to help the user fill in what couldn't be auto-detected. */
  notes?: string;
  /** Official municipal lookup URL (from AI sources) for the exact day. */
  lookupUrl?: string;
}

const TYPE_META: Record<StreamType, { label: string; icon: IoniconName }> = {
  garbage: { label: 'Garbage', icon: 'trash' },
  recycling: { label: 'Recycling', icon: 'refresh-circle' },
  organics: { label: 'Organics', icon: 'leaf' },
  yardWaste: { label: 'Yard Waste', icon: 'leaf' },
  bulkItem: { label: 'Bulky Items', icon: 'cube' },
};

const ALL_TYPES: StreamType[] = ['garbage', 'recycling', 'organics', 'yardWaste', 'bulkItem'];

const FREQ_OPTIONS: Array<{ value: EditableFrequency; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'on-request', label: 'On request' },
];

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Local editable row.
interface Row {
  type: StreamType;
  frequency: EditableFrequency | 'seasonal';
  dayOfWeek?: number;
  week?: 'A' | 'B';
  weekOfMonth?: number[];
  seasonStart?: { month: number; day: number };
  seasonEnd?: { month: number; day: number };
}

function toRows(schedules: GarbageScheduleType[]): Row[] {
  return schedules
    .filter((s) => ALL_TYPES.includes(s.type as StreamType))
    .map((s) => ({
      type: s.type as StreamType,
      frequency: s.frequency,
      dayOfWeek: s.dayOfWeek,
      week: s.week,
      weekOfMonth: s.weekOfMonth,
      seasonStart: s.seasonStart,
      seasonEnd: s.seasonEnd,
    }));
}

export function GarbageScheduleEditor({
  visible,
  onClose,
  onSaved,
  title = 'Review Schedule',
  municipality,
  setOutTime,
  initialSchedules,
  notes,
  lookupUrl,
}: GarbageScheduleEditorProps) {  const colors = useAppColors();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [rows, setRows] = useState<Row[]>([]);
  // Snapshot of the rows as first seeded into the editor — the dirty baseline.
  // For a brand-new schedule this is the empty/default set, so any edit → dirty.
  const [baselineRows, setBaselineRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const seeded = toRows(initialSchedules);
      setRows(seeded);
      setBaselineRows(seeded);
      setError(null);
    }
  }, [visible, initialSchedules]);

  const availableToAdd = useMemo(
    () => ALL_TYPES.filter((t) => !rows.some((r) => r.type === t)),
    [rows]
  );

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const addType = (type: StreamType) => {
    setRows((prev) => [...prev, { type, frequency: type === 'bulkItem' ? 'on-request' : 'biweekly' }]);
  };

  const needsDay = (freq: Row['frequency']) => freq !== 'on-request';

  // Validation. `errors` block saving; `warnings` are non-blocking tips.
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (rows.length === 0) errors.push('Add at least one collection type.');

    rows.forEach((r) => {
      if (needsDay(r.frequency) && r.dayOfWeek === undefined) {
        errors.push(`Pick a collection day for ${TYPE_META[r.type].label}.`);
      }
    });

    // Biweekly streams on the same day that don't have distinct A/B weeks will
    // pile onto the same dates — warn (many cities alternate them).
    const biByDay: Record<number, Row[]> = {};
    rows
      .filter((r) => r.frequency === 'biweekly' && r.dayOfWeek !== undefined)
      .forEach((r) => {
        (biByDay[r.dayOfWeek as number] ||= []).push(r);
      });
    Object.values(biByDay).forEach((group) => {
      if (group.length < 2) return;
      const distinctWeeks = new Set(group.map((g) => g.week).filter(Boolean));
      const allDistinct = group.every((g) => g.week) && distinctWeeks.size === group.length;
      if (!allDistinct) {
        warnings.push(
          `${group.map((g) => TYPE_META[g.type].label).join(' & ')} share a biweekly day. ` +
            'If they actually alternate, set each to a different week (A / B) below.'
        );
      }
    });

    return { errors, warnings };
  }, [rows]);

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: rows,
    baseline: baselineRows,
    successMessage: 'Schedule saved',
    onClose,
    onSave: async () => {
      if (!currentHousehold) return false;
      if (validation.errors.length > 0) {
        setError(validation.errors[0]);
        return false;
      }

      const schedules: GarbageScheduleType[] = rows.map((r) => ({
        type: r.type,
        frequency: r.frequency,
        ...(needsDay(r.frequency) && r.dayOfWeek !== undefined ? { dayOfWeek: r.dayOfWeek } : {}),
        ...(r.frequency === 'biweekly' && r.week ? { week: r.week } : {}),
        ...(r.frequency === 'monthly' && r.weekOfMonth ? { weekOfMonth: r.weekOfMonth } : {}),
        ...(r.seasonStart ? { seasonStart: r.seasonStart } : {}),
        ...(r.seasonEnd ? { seasonEnd: r.seasonEnd } : {}),
      }));

      setError(null);
      console.log('[GARBAGE] Editor.handleSave: saving', JSON.stringify(schedules));
      await garbageCollectionApi.createSchedule(currentHousehold.id, {
        municipality: municipality || currentHousehold.city || 'Unknown',
        schedules,
        set_out_time: setOutTime || undefined,
        source: 'municipal_api',
      });
      console.log('[GARBAGE] Editor.handleSave: saved OK');
      onSaved();
      return;
    },
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} height="full" title={title} showCloseButton>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.intro}>
          Each type can have its own frequency and pickup day. Adjust anything that doesn’t match,
          then save.
        </Typography>

        {/* Tip: AI guidance + official lookup link for the missing day */}
        {(notes || lookupUrl) && (
          <View style={[styles.tipCard, { backgroundColor: `${colors.primary}12` }]}>
            <View style={styles.tipTitle}>
              <Icon name="bulb" size={16} color={colors.textPrimary} />
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                Tip
              </Typography>
            </View>
            {notes ? (
              <Typography variant="footnote" color={colors.textSecondary}>
                {notes}
              </Typography>
            ) : null}
            {lookupUrl ? (
              <TouchableOpacity onPress={() => Linking.openURL(lookupUrl)} style={styles.tipLink}>
                <Typography variant="footnote" weight="semibold" color={colors.primary}>
                  Look up your exact collection day
                </Typography>
                <Icon name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Non-blocking validation tips (e.g. overlapping biweekly streams) */}
        {validation.warnings.map((w, i) => (
          <View key={i} style={[styles.warnCard, { backgroundColor: `${colors.warning}15` }]}>
            <Icon name="warning" size={16} color={colors.warning} style={styles.warnIcon} />
            <Typography variant="footnote" color={colors.textSecondary} style={styles.warnText}>{w}</Typography>
          </View>
        ))}

        {rows.map((row, index) => {
          const meta = TYPE_META[row.type];
          return (
            <Card
              key={`${row.type}-${index}`}
              variant="filled"
              style={[styles.rowCard, { backgroundColor: colors.backgroundSecondary }]}
            >
              <View style={styles.rowHeader}>
                <Icon name={meta.icon} size={20} color={colors.textPrimary} />
                <Typography variant="headline" weight="semibold" style={styles.rowTitle}>
                  {meta.label}
                </Typography>
                <TouchableOpacity onPress={() => removeRow(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>

              {/* Frequency */}
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary} style={styles.fieldLabel}>
                FREQUENCY
              </Typography>
              <View style={styles.segmentRow}>
                {FREQ_OPTIONS.map((opt) => {
                  const active = row.frequency === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => updateRow(index, { frequency: opt.value })}
                      style={[
                        styles.segment,
                        {
                          backgroundColor: active ? colors.primary : colors.backgroundMain,
                          borderColor: active ? colors.primary : colors.borderColor,
                        },
                      ]}
                    >
                      <Typography
                        variant="caption1"
                        weight={active ? 'semibold' : 'regular'}
                        color={active ? colors.white : colors.textPrimary}
                      >
                        {opt.label}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Day of week */}
              {needsDay(row.frequency) && (
                <>
                  <Typography variant="caption1" weight="semibold" color={colors.textSecondary} style={styles.fieldLabel}>
                    COLLECTION DAY
                  </Typography>
                  <View style={styles.dayRow}>
                    {DAY_LETTERS.map((letter, day) => {
                      const active = row.dayOfWeek === day;
                      return (
                        <TouchableOpacity
                          key={day}
                          onPress={() => updateRow(index, { dayOfWeek: day })}
                          style={[
                            styles.dayChip,
                            {
                              backgroundColor: active ? colors.primary : colors.backgroundMain,
                              borderColor: active ? colors.primary : colors.borderColor,
                            },
                          ]}
                        >
                          <Typography
                            variant="caption1"
                            weight={active ? 'bold' : 'regular'}
                            color={active ? colors.white : colors.textPrimary}
                          >
                            {letter}
                          </Typography>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {row.frequency === 'biweekly' && (
                    <>
                      <Typography variant="caption1" weight="semibold" color={colors.textSecondary} style={styles.fieldLabel}>
                        COLLECTION WEEK
                      </Typography>
                      <View style={styles.segmentRow}>
                        {(['A', 'B'] as const).map((w) => {
                          const active = row.week === w;
                          return (
                            <TouchableOpacity
                              key={w}
                              onPress={() => updateRow(index, { week: active ? undefined : w })}
                              style={[
                                styles.segment,
                                {
                                  backgroundColor: active ? colors.primary : colors.backgroundMain,
                                  borderColor: active ? colors.primary : colors.borderColor,
                                },
                              ]}
                            >
                              <Typography
                                variant="caption1"
                                weight={active ? 'semibold' : 'regular'}
                                color={active ? colors.white : colors.textPrimary}
                              >
                                Week {w}
                              </Typography>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Typography variant="caption2" color={colors.textTertiary} style={styles.weekHint}>
                        Only needed when two streams alternate (e.g. garbage on Week A, recycling on Week B).
                      </Typography>
                    </>
                  )}
                </>
              )}
            </Card>
          );
        })}

        {/* Add a type */}
        {availableToAdd.length > 0 && (
          <View style={styles.addSection}>
            <Typography variant="caption1" weight="semibold" color={colors.textSecondary} style={styles.fieldLabel}>
              ADD A TYPE
            </Typography>
            <View style={styles.addChips}>
              {availableToAdd.map((type) => (
                <TouchableOpacity
                  key={type}
                  onPress={() => addType(type)}
                  style={[styles.addChip, { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain }]}
                >
                  <Icon name={TYPE_META[type].icon} size={16} color={colors.textPrimary} />
                  <Typography variant="footnote" weight="medium" style={styles.addChipLabel}>
                    {TYPE_META[type].label}
                  </Typography>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {error && (
          <Typography variant="footnote" color={colors.warning} align="center" style={styles.error}>
            {error}
          </Typography>
        )}

        <Button
          title={isSaving ? 'Saving…' : 'Save Schedule'}
          variant="primary"
          size="md"
          onPress={save}
          disabled={isSaving || !isDirty || validation.errors.length > 0}
          fullWidth
          style={styles.saveBtn}
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  intro: {
    marginBottom: 12,
  },
  tipCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  tipTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  tipLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 8,
  },
  warnCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  warnIcon: {
    marginTop: 1,
  },
  warnText: {
    flex: 1,
  },
  weekHint: {
    marginTop: 4,
    marginBottom: 4,
  },
  rowCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  rowTitle: {
    flex: 1,
  },
  fieldLabel: {
    marginBottom: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSection: {
    marginTop: 4,
    marginBottom: 8,
  },
  addChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  addChipLabel: {
    marginLeft: 2,
  },
  error: {
    marginTop: 8,
  },
  saveBtn: {
    marginTop: 16,
  },
});

export default GarbageScheduleEditor;
