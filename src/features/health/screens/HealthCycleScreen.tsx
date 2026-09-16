import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, CycleWheel, Typography } from '@components/ui';
import { monthKeyOf } from '@components/ui/CalendarHeatmap';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthCycleCalendar, HealthSectionScreen, HealthStatTiles } from '../components';
import { HealthScaleRow } from '../components/HealthScaleRow';
import {
  averageCycleLength,
  averagePeriodLength,
  commonSymptoms,
  createEmptySymptomEntry,
  CRAVING_LABELS,
  CRAVINGS,
  CYCLE_PHASE_DESCRIPTIONS,
  CYCLE_PHASE_ICONS,
  CYCLE_PHASE_LABELS,
  CYCLE_SYMPTOM_CATEGORY,
  CYCLE_SYMPTOM_LABELS,
  CYCLE_SYMPTOMS,
  cycleDayOn,
  DEFAULT_CYCLE_SETTINGS,
  ENERGY_LABELS,
  FLOW_LABELS,
  FLOW_LEVELS,
  loadCycleSettings,
  loadCycleSymptoms,
  loadPeriodEntries,
  logPeriodDay,
  MOOD_EMOJI,
  MOOD_LABELS,
  phaseOn,
  phaseLoggedDays,
  phaseSymptomCounts,
  predictCycle,
  relativeDayLabel,
  removePeriodDay,
  saveCycleSettings,
  saveCycleSymptomEntry,
  SEVERITY_LABELS,
  SLEEP_QUALITY_LABELS,
  upcomingCycleEvents,
  type Craving,
  type CycleSettings,
  type CycleSymptom,
  type CycleSymptomEntry,
  type FlowLevel,
  type PeriodEntry,
  type SymptomSeverity,
} from '../healthCycleStorage';
import { todayDateKey } from '../healthLocalStorage';
import { formatDayKey } from '../healthNutritionStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Women's Health tab — the donor's `WomensHealthView`, rebuilt on the new UI.
 *
 * Cycle phase, a month calendar, period logging with a flow level, a daily
 * symptom / mood / energy / sleep log, and calendar-arithmetic predictions for
 * the next period and fertile window.
 *
 * Backed by `/health/cycle/*` on Health's OWN Worker + D1 (parity P1), with an
 * offline cache. It is per-USER, never household-shared, never sent to another
 * Symply app, and never sent to an AI provider — the predictions are plain
 * arithmetic over the user's own logged dates.
 *
 * ── WHAT THIS SCREEN DOES NOT DO ─────────────────────────────────────────────
 *
 * It records what the person tells it, and does arithmetic on the dates they
 * logged. It does not diagnose, does not grade a cycle as normal or abnormal,
 * and does not advise. Two donor surfaces are deliberately absent, on the same
 * grounds `HealthInjuriesScreen` dropped the donor's "Recovery Tips":
 *
 *  - **The phase tip rows.** `phaseDietTip` / `phaseExerciseTip` /
 *    `phaseSelfCareTip` ("Focus on iron-rich foods and stay hydrated", "Great
 *    time for high-intensity workouts", "Peak performance — try something new")
 *    are prescriptions issued on the strength of a date calculation. In their
 *    place the PATTERNS card reads the person's OWN log back to them, per
 *    phase — a record, not a recommendation.
 *  - **The fertility grade.** The donor's `fertilityStatus` labels the day
 *    "High fertility" / "Medium fertility" / "Low fertility". That is a
 *    clinical read on a number derived from a 28-day average, and someone will
 *    make a contraceptive decision on it. The calendar marks the estimated
 *    window and names it an estimate; it never ranks it.
 *
 * ── DELIBERATE DIFFERENCES FROM THE DONOR ────────────────────────────────────
 *
 *  - **A logged period day and an expected one look different.** The donor
 *    paints both the same pink circle. See `HealthCycleCalendar`.
 *  - **Any day can be logged, not just today.** Tapping a calendar day moves
 *    the flow and symptom cards onto it; the donor's log sheets always stamped
 *    the current date.
 *  - **Sleep quality is stored.** `cycle_symptom_entries.sleep_quality` has
 *    existed since parity P1 with nothing writing it.
 */
export function HealthCycleScreen() {
  const colors = useAppColors();

  const todayKey = todayDateKey();

  const [settings, setSettings] = useState<CycleSettings>(DEFAULT_CYCLE_SETTINGS);
  const [periods, setPeriods] = useState<PeriodEntry[]>([]);
  const [symptomLog, setSymptomLog] = useState<CycleSymptomEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [month, setMonth] = useState(() => monthKeyOf(todayKey));
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const [storedSettings, storedPeriods, storedSymptoms] = await Promise.all([
      loadCycleSettings(),
      loadPeriodEntries(),
      loadCycleSymptoms(),
    ]);
    setSettings(storedSettings);
    setPeriods(storedPeriods);
    setSymptomLog(storedSymptoms);
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

  // The day the log cards are pointed at. Derived from the list rather than
  // held separately, so a save can never leave the form showing a stale copy.
  const selectedEntry = useMemo(
    () => symptomLog.find((entry) => entry.date === selectedDate) ?? createEmptySymptomEntry(selectedDate),
    [symptomLog, selectedDate]
  );
  const [noteDraft, setNoteDraft] = useState('');
  useEffect(() => {
    setNoteDraft(selectedEntry.notes);
  }, [selectedEntry.notes, selectedDate]);

  const cycleDay = cycleDayOn(todayKey, settings);
  const phase = phaseOn(todayKey, settings);
  const prediction = useMemo(() => predictCycle(settings), [settings]);
  const events = useMemo(() => upcomingCycleEvents(settings, todayKey), [settings, todayKey]);
  const observedCycle = useMemo(() => averageCycleLength(periods), [periods]);
  const observedPeriod = useMemo(() => averagePeriodLength(periods), [periods]);
  const topSymptoms = useMemo(() => commonSymptoms(symptomLog), [symptomLog]);
  const phasePatterns = useMemo(
    () => (phase ? phaseSymptomCounts(symptomLog, settings, phase) : []),
    [symptomLog, settings, phase]
  );
  const phaseDays = useMemo(
    () => (phase ? phaseLoggedDays(symptomLog, settings, phase) : 0),
    [symptomLog, settings, phase]
  );
  const selectedPeriod = periods.find((entry) => entry.date === selectedDate) ?? null;
  const recentPeriods = periods.slice(0, 6);
  const selectedLabel = formatDayKey(selectedDate);

  const persist = async (patch: Partial<CycleSymptomEntry>) => {
    setSymptomLog(await saveCycleSymptomEntry(patch, selectedDate));
  };

  const handleFlow = async (flow: FlowLevel) => {
    setPeriods(await logPeriodDay(flow, selectedDate));
    setSettings(await loadCycleSettings());
  };

  const handleRemovePeriod = async (date: string) => {
    setPeriods(await removePeriodDay(date));
    // The server re-anchors (or clears) the cycle when the anchor day goes, so
    // re-read settings or the card would keep rendering the deleted period's
    // day and phase.
    setSettings(await loadCycleSettings());
  };

  const handleSymptom = async (symptom: CycleSymptom) => {
    // Tapping cycles none → mild → moderate → severe → none, so one control
    // covers both "I have this" and "how bad".
    const current = selectedEntry.symptoms[symptom] ?? 0;
    const next = ((current + 1) % 4) as SymptomSeverity;
    const symptoms = { ...selectedEntry.symptoms };
    if (next === 0) {
      delete symptoms[symptom];
    } else {
      symptoms[symptom] = next;
    }
    await persist({ symptoms });
  };

  const handleSelectDay = useCallback((date: string) => {
    setSelectedDate(date);
    setMonth(monthKeyOf(date));
  }, []);

  const handleCycleLength = useCallback(() => {
    Alert.alert('Average cycle length', 'How many days from one period to the next?', [
      ...[26, 28, 30, 32].map((value) => ({
        text: `${value} days`,
        onPress: () => void saveCycleSettings({ cycleLength: value }).then(setSettings),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, []);

  return (
    <HealthSectionScreen title="Women's Health" testID="health-cycle-screen" loading={loading}>
      {/* Where you are in the cycle */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            TODAY
          </Typography>
          <Pressable
            onPress={handleCycleLength}
            accessibilityRole="button"
            accessibilityLabel="Change average cycle length"
            testID="health-cycle-length-button"
          >
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Cycle {settings.cycleLength} days
            </Typography>
          </Pressable>
        </View>

        {cycleDay === null || phase === null ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-cycle-no-anchor">
            Log a period day below to start tracking your cycle.
          </Typography>
        ) : (
          <>
            <View style={styles.phaseRow}>
              {/* The donor's cycle wheel. Its phase arcs are derived from the
                  SAME `phaseForCycleDay` rule that produces the label beside it,
                  so the picture and the words can never disagree. */}
              <CycleWheel
                cycleLength={settings.cycleLength}
                periodLength={settings.periodLength}
                currentDay={cycleDay}
                loggedDays={periods.map((p) => p.date)}
                size={116}
                stroke={12}
                testID="health-cycle-wheel"
              >
                <Icon name={CYCLE_PHASE_ICONS[phase]} size={22} color={colors.primary} />
              </CycleWheel>
              <View style={styles.phaseText}>
                <Typography
                  variant="title3"
                  weight="bold"
                  color={colors.textPrimary}
                  testID="health-cycle-day"
                >
                  Day {cycleDay}
                </Typography>
                <Typography
                  variant="body"
                  weight="medium"
                  color={colors.primary}
                  testID="health-cycle-phase"
                >
                  {CYCLE_PHASE_LABELS[phase]}
                </Typography>
              </View>
            </View>
            <Typography variant="footnote" color={colors.textSecondary}>
              {CYCLE_PHASE_DESCRIPTIONS[phase]}
            </Typography>
          </>
        )}

        <HealthStatTiles
          stats={[
            {
              label: 'Next period',
              value:
                prediction.daysUntilNextPeriod === null
                  ? '—'
                  : `in ${prediction.daysUntilNextPeriod}d`,
              icon: 'cycle',
              testID: 'health-cycle-next-period',
            },
            {
              label: 'Fertile window',
              value: prediction.fertileWindowStart
                ? `${formatDayKey(prediction.fertileWindowStart)}`
                : '—',
              icon: 'insights',
              testID: 'health-cycle-fertile-window',
            },
            {
              label: 'Avg cycle',
              value: observedCycle !== null ? `${observedCycle}d` : `${settings.cycleLength}d`,
              icon: 'trends',
              testID: 'health-cycle-average',
            },
          ]}
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          Predictions are estimates from the dates you logged — not medical or contraceptive
          advice.
        </Typography>
      </Card>

      {/* Month calendar */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          CALENDAR
        </Typography>
        <HealthCycleCalendar
          month={month}
          onMonthChange={setMonth}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDay}
          todayKey={todayKey}
          settings={settings}
          periods={periods}
          symptoms={symptomLog}
        />
      </Card>

      {/* What's coming — the donor's insights sheet, on the page */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WHAT&apos;S COMING
        </Typography>
        {events.length === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-cycle-upcoming-empty">
            Log a period day and these dates will appear.
          </Typography>
        ) : (
          events.map((event) => (
            <View
              key={event.key}
              style={[styles.entryRow, { borderTopColor: colors.borderColor }]}
              testID={`health-cycle-upcoming-${event.key}`}
            >
              <View style={styles.upcomingLabel}>
                <Icon name={event.icon} size={16} color={colors.primary} />
                <Typography variant="body" color={colors.textPrimary}>
                  {event.label}
                </Typography>
              </View>
              <View style={styles.entryMeta}>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {event.date}
                </Typography>
                <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                  {relativeDayLabel(event.daysAway)}
                </Typography>
              </View>
            </View>
          ))
        )}
      </Card>

      {/* Period logging — for the selected day */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {selectedPeriod ? 'FLOW' : 'LOG A PERIOD DAY'}
          </Typography>
          <Typography
            variant="footnote"
            weight="semibold"
            color={colors.primary}
            testID="health-cycle-selected-date"
          >
            {selectedLabel}
          </Typography>
        </View>
        <View style={styles.flowRow}>
          {FLOW_LEVELS.map((level) => {
            const active = selectedPeriod?.flow === level;
            return (
              <Pressable
                key={level}
                onPress={() => void handleFlow(level)}
                accessibilityRole="button"
                accessibilityLabel={`${FLOW_LABELS[level]} flow on ${selectedLabel}`}
                accessibilityState={{ selected: active }}
                testID={`health-cycle-flow-${level}`}
                style={[
                  styles.flowChip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {FLOW_LABELS[level]}
                </Typography>
              </Pressable>
            );
          })}
        </View>
        {selectedPeriod && (
          <Pressable
            onPress={() => void handleRemovePeriod(selectedDate)}
            accessibilityRole="button"
            accessibilityLabel={`Remove the period entry for ${selectedLabel}`}
            testID="health-cycle-remove-selected"
          >
            <Typography variant="footnote" color={colors.error}>
              Remove this entry
            </Typography>
          </Pressable>
        )}
      </Card>

      {/* Daily symptom log — for the selected day */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            HOW YOU FEEL
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {selectedLabel}
          </Typography>
        </View>
        <HealthScaleRow
          label="Mood"
          value={selectedEntry.mood}
          onChange={(next) => void persist({ mood: next })}
          max={5}
          icon="mood"
          hint={
            selectedEntry.mood
              ? `${MOOD_EMOJI[selectedEntry.mood]} ${MOOD_LABELS[selectedEntry.mood]}`
              : undefined
          }
          testID="health-cycle-mood"
        />
        <HealthScaleRow
          label="Energy"
          value={selectedEntry.energy}
          onChange={(next) => void persist({ energy: next })}
          max={5}
          icon="energy-active"
          hint={selectedEntry.energy ? ENERGY_LABELS[selectedEntry.energy] : undefined}
          testID="health-cycle-energy"
        />
        <HealthScaleRow
          label="Sleep"
          value={selectedEntry.sleepQuality}
          onChange={(next) => void persist({ sleepQuality: next })}
          max={5}
          icon="sleep"
          hint={
            selectedEntry.sleepQuality
              ? SLEEP_QUALITY_LABELS[selectedEntry.sleepQuality]
              : undefined
          }
          testID="health-cycle-sleep"
        />

        <Typography variant="caption1" color={colors.textSecondary} style={styles.subLabel}>
          SYMPTOMS — tap to cycle severity
        </Typography>
        <View style={styles.symptomGrid}>
          {CYCLE_SYMPTOMS.map((symptom) => {
            const severity = selectedEntry.symptoms[symptom] ?? 0;
            const active = severity > 0;
            return (
              <Pressable
                key={symptom}
                onPress={() => void handleSymptom(symptom)}
                accessibilityRole="button"
                accessibilityLabel={`${CYCLE_SYMPTOM_LABELS[symptom]}: ${SEVERITY_LABELS[severity as SymptomSeverity]}`}
                testID={`health-cycle-symptom-${symptom}`}
                style={[
                  styles.symptomChip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight={active ? 'semibold' : 'regular'}
                  color={active ? colors.white : colors.textSecondary}
                >
                  {CYCLE_SYMPTOM_LABELS[symptom]}
                  {active ? ` · ${SEVERITY_LABELS[severity as SymptomSeverity]}` : ''}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <Typography variant="caption1" color={colors.textSecondary} style={styles.subLabel}>
          CRAVINGS
        </Typography>
        <View style={styles.symptomGrid}>
          {CRAVINGS.map((craving: Craving) => {
            const active = selectedEntry.craving === craving;
            return (
              <Pressable
                key={craving}
                onPress={() => void persist({ craving })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`health-cycle-craving-${craving}`}
                style={[
                  styles.symptomChip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {CRAVING_LABELS[craving]}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          onBlur={() => void persist({ notes: noteDraft })}
          onEndEditing={(e) => void persist({ notes: e.nativeEvent.text })}
          placeholder="Anything else about this day?"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Cycle notes"
          testID="health-cycle-notes-input"
          style={[
            styles.noteInput,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
      </Card>

      {/* Patterns */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          PATTERNS
        </Typography>
        {topSymptoms.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-cycle-patterns-empty"
          >
            Log a few days to see which symptoms show up most.
          </Typography>
        ) : (
          topSymptoms.map(({ symptom, count }) => (
            <View key={symptom} style={styles.patternRow} testID={`health-cycle-pattern-${symptom}`}>
              <Icon
                name={CYCLE_SYMPTOM_CATEGORY[symptom] === 'physical' ? 'symptoms' : 'mood'}
                size={16}
                color={colors.primary}
              />
              <Typography variant="body" color={colors.textPrimary} style={styles.patternLabel}>
                {CYCLE_SYMPTOM_LABELS[symptom]}
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                {count} {count === 1 ? 'day' : 'days'}
              </Typography>
            </View>
          ))
        )}

        {/* Per-phase read of the person's OWN log — this is what stands in for
            the donor's phase tip rows. It states its own denominator, because
            "cramps on 2 days" means nothing without "of 3 days logged". */}
        {phase !== null && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-cycle-phase-pattern"
          >
            {phasePatterns.length === 0
              ? `Nothing logged yet in your ${CYCLE_PHASE_LABELS[phase].toLowerCase()} phase.`
              : `In your ${CYCLE_PHASE_LABELS[phase].toLowerCase()} phase you have most often logged ${phasePatterns
                  .map((p) => CYCLE_SYMPTOM_LABELS[p.symptom].toLowerCase())
                  .join(', ')} — across ${phaseDays} logged ${phaseDays === 1 ? 'day' : 'days'}.`}
          </Typography>
        )}

        {observedPeriod !== null && (
          <Typography variant="caption1" color={colors.textSecondary}>
            Your periods average {observedPeriod} {observedPeriod === 1 ? 'day' : 'days'}.
          </Typography>
        )}
      </Card>

      {/* Recent period days */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          RECENT PERIOD DAYS
        </Typography>
        {recentPeriods.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-cycle-history-empty"
          >
            No period days logged yet.
          </Typography>
        ) : (
          recentPeriods.map((entry) => (
            <View key={entry.id} style={[styles.entryRow, { borderTopColor: colors.borderColor }]}>
              <Pressable
                onPress={() => handleSelectDay(entry.date)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${entry.date} on the calendar`}
                testID={`health-cycle-open-${entry.date}`}
              >
                <Typography variant="body" color={colors.textPrimary}>
                  {formatDayKey(entry.date)}
                </Typography>
              </Pressable>
              <View style={styles.entryMeta}>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {FLOW_LABELS[entry.flow]}
                </Typography>
                <Pressable
                  onPress={() => void handleRemovePeriod(entry.date)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete period day ${entry.date}`}
                  testID={`health-cycle-delete-${entry.date}`}
                  hitSlop={8}
                >
                  <Icon name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>

      <View style={styles.footnoteRow}>
        <Icon name="local-only" size={16} color={colors.textSecondary} />
        <Typography variant="caption1" color={colors.textSecondary}>
          Cycle data is private to your account and is never shared with other Symply apps.
        </Typography>
      </View>
    </HealthSectionScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  subLabel: {
    letterSpacing: 0.6,
    marginTop: Spacing.xs,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  phaseText: {
    flex: 1,
    gap: 2,
  },
  flowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  flowChip: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  symptomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  symptomChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  noteInput: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  patternLabel: {
    flex: 1,
  },
  upcomingLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  footnoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
