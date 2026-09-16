import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  groupBodyMetrics,
  HealthBodyCompareCard,
  HealthBodyDashboard,
  HealthBodyTrendCard,
  HealthSectionScreen,
  HealthToggleRow,
  lengthBodyMetrics,
} from '../components';
import {
  addBodyEntry,
  addBodySession,
  BODY_METRIC_HINTS,
  BODY_METRIC_LABELS,
  BODY_METRICS,
  bodyEntriesForDay,
  bodyEntryDay,
  bodyMetricTier,
  deleteBodyEntry,
  formatMeasurement,
  LENGTH_UNITS,
  loadBodyEntries,
  parseMeasurementInput,
  summarizeBody,
  unitForMetric,
  type BodyEntry,
  type BodyMetric,
  type LengthUnit,
} from '../healthBodyStorage';
import {
  latestWeight,
  loadWeightLog,
  loadHealthPrefs,
  sanitizeWeightInput,
  sortEntriesDesc,
  todayDateKey,
  type WeightUnit,
} from '../healthLocalStorage';
import { formatDayKey, shiftDateKey } from '../healthNutritionStorage';
import {
  EMPTY_WEIGHT_GOAL,
  loadWeightGoal,
  weightToKg,
  type WeightGoal,
} from '../healthWeightStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Body tab — the donor's "Body" surface, measurements only.
 *
 * Parity with the donor's Measure + Progress segments:
 *   · every site the storage layer exposes — the donor's COMPREHENSIVE list
 *     since 0131, grouped the way its manual-entry form groups them (Upper body
 *     / Arms / Legs / Whole body / Composition), with the finer points of each
 *     limb behind one "detailed sites" switch rather than always on;
 *   · the donor's DATE NAVIGATION on entry: a reading taken yesterday is logged
 *     against yesterday instead of being stamped today, which is what makes the
 *     trend line and the compare card mean anything;
 *   · the donor's session sheet — many sites saved as ONE row — alongside a
 *     one-site quick add, because "I just taped my waist" and "it is Sunday and
 *     I am doing all of them" are different jobs;
 *   · a per-metric trend chart with the donor's 1M/3M/6M/1Y/All ranges, rather
 *     than a single latest number;
 *   · body fat on its OWN chart — a percentage and a circumference cannot share
 *     an axis;
 *   · the donor's ratio and body-composition cards, minus its grading;
 *   · a two-date comparison, which the donor only ever did implicitly against
 *     the immediately previous reading.
 *
 * Body PHOTOS are deliberately absent: the migration matrix files them under
 * "Later — future Health media spec" because they need their own storage,
 * retention and deletion review. That also excludes the donor's photo-derived
 * AI measurement and silhouette surfaces, which cannot run without them.
 */
export function HealthBodyScreen() {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);

  const [entries, setEntries] = useState<BodyEntry[]>([]);
  const [goal, setGoal] = useState<WeightGoal>(EMPTY_WEIGHT_GOAL);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<BodyMetric>('waist');
  const [unit, setUnit] = useState<LengthUnit>('cm');
  const [draft, setDraft] = useState('');

  /** The day a new reading is stamped with. The donor's `selectedDate`. */
  const [date, setDate] = useState(todayDateKey());
  const [showDetailed, setShowDetailed] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [session, setSession] = useState<Partial<Record<BodyMetric, string>>>({});
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback(async () => {
    // The composition card needs a weight and the 0125 biometrics; both already
    // have loaders, so this tab reads them rather than collecting them again.
    const [body, log, weightGoal, prefs] = await Promise.all([
      loadBodyEntries(),
      loadWeightLog(),
      loadWeightGoal(),
      loadHealthPrefs(),
    ]);
    setEntries(body);
    setGoal(weightGoal);
    const latest = latestWeight(sortEntriesDesc(log));
    setWeightKg(latest ? weightToKg(latest.value, latest.unit) : null);
    setPreferredUnit(prefs.preferredUnit);
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

  const summaries = useMemo(() => summarizeBody(entries), [entries]);
  const summaryByMetric = useMemo(
    () => new Map(summaries.map((summary) => [summary.metric, summary])),
    [summaries],
  );

  /**
   * Which sites the screen shows.
   *
   * Always the primary set (the donor's own manual sheet). Always any detailed
   * site that already HAS a reading — hiding a number the member took the
   * trouble to measure would be a bug, not a simplification. Everything else
   * only with the switch on.
   */
  const visibleMetrics = useMemo(
    () =>
      (BODY_METRICS as readonly BodyMetric[]).filter(
        (option) =>
          showDetailed ||
          bodyMetricTier(option) === 'primary' ||
          (summaryByMetric.get(option)?.count ?? 0) > 0,
      ),
    [showDetailed, summaryByMetric],
  );
  const hiddenCount = BODY_METRICS.length - visibleMetrics.length;

  // Groups are derived from the visible sites, so a site added to the storage
  // layer appears here — in the right section — without touching this screen.
  const groups = useMemo(() => groupBodyMetrics(visibleMetrics), [visibleMetrics]);
  const lengths = useMemo(() => lengthBodyMetrics(visibleMetrics), [visibleMetrics]);
  const chartsBodyFat = visibleMetrics.includes('bodyFat');

  const history = useMemo(
    () => entries.filter((entry) => entry.metric === metric).slice(0, 8),
    [entries, metric],
  );
  const dayEntries = useMemo(() => bodyEntriesForDay(entries, date), [entries, date]);

  const parsed = parseMeasurementInput(draft, metric);
  const canLog = parsed !== null;
  const activeUnit = unitForMetric(metric, unit);
  const isToday = date === todayDateKey();
  const dayLabel = formatDayKey(date);

  /** Only the fields that parse to a real number reach the wire. */
  const sessionValues = useMemo(() => {
    const values: Partial<Record<BodyMetric, number>> = {};
    for (const [key, raw] of Object.entries(session) as [BodyMetric, string][]) {
      const value = parseMeasurementInput(raw ?? '', key);
      if (value !== null) values[key] = value;
    }
    return values;
  }, [session]);
  const sessionCount = Object.keys(sessionValues).length;

  const handleLog = async () => {
    if (parsed === null) return;
    setEntries(await addBodyEntry(metric, parsed, activeUnit, date));
    setDraft('');
  };

  const handleSaveSession = async () => {
    if (sessionCount === 0 || saving) return;
    setSaving(true);
    try {
      setEntries(await addBodySession(sessionValues, unit, date));
      setSession({});
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setEntries(await deleteBodyEntry(id));
  };

  return (
    <HealthSectionScreen title="Body" testID="health-body-screen" loading={loading}>
      {/* Latest value per site, grouped, with the change since the previous reading */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          MEASUREMENTS
        </Typography>
        {entries.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-body-measurements-empty"
          >
            No measurements yet. Add your first reading below to start a trend.
          </Typography>
        ) : null}
        {groups.map((group) => (
          <View key={group.id} style={styles.group}>
            <Typography variant="caption1" color={colors.textSecondary}>
              {group.title}
            </Typography>
            <View style={styles.summaryGrid}>
              {group.metrics.map((option) => {
                const summary = summaryByMetric.get(option);
                const latest = summary?.latest ?? null;
                const delta = summary?.delta ?? null;
                return (
                  <View
                    key={option}
                    style={[styles.summaryTile, { backgroundColor: colors.backgroundMain }]}
                    testID={`health-body-summary-${option}`}
                    accessible
                    accessibilityLabel={`${BODY_METRIC_LABELS[option]}: ${
                      latest ? `${formatMeasurement(latest.value)} ${latest.unit}` : 'not logged'
                    }`}
                  >
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {BODY_METRIC_LABELS[option]}
                    </Typography>
                    <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                      {latest ? `${formatMeasurement(latest.value)} ${latest.unit}` : '—'}
                    </Typography>
                    {delta !== null && delta !== 0 ? (
                      <View style={styles.deltaRow}>
                        <Icon
                          name={delta < 0 ? 'arrow-down' : 'arrow-up'}
                          size={12}
                          color={colors.primary}
                        />
                        <Typography variant="caption1" color={colors.primary}>
                          {formatMeasurement(Math.abs(delta))} {latest?.unit}
                        </Typography>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </Card>

      {/*
        Per-metric trend — lengths only, one site at a time, one unit per axis.

        Both guards below read the VISIBLE vocabulary rather than the log, so
        with the shipped set they are constant-true and the `: null` arms are
        unreachable by any input. They stay because removing a metric from
        `BODY_METRICS` must remove its card rather than leave a chart bound to a
        metric the app no longer collects.
      */}
      {/* istanbul ignore next -- constant over BODY_METRICS; see comment above */ lengths.length >
      0 ? (
        <HealthBodyTrendCard
          entries={entries}
          metrics={lengths}
          chartWidth={chartWidth}
          title="MEASUREMENT TRENDS"
          idPrefix="health-body-trend"
          color={colors.chartCool}
        />
      ) : null}

      {/* Body fat lives on its own axis — a % is not a circumference */}
      {/* istanbul ignore next -- constant over BODY_METRICS; see comment above */ chartsBodyFat ? (
        <HealthBodyTrendCard
          entries={entries}
          metrics={['bodyFat']}
          chartWidth={chartWidth}
          title="BODY FAT TREND"
          idPrefix="health-body-fat-trend"
          color={colors.chartWarm}
        />
      ) : null}

      {/*
        Entry controls: which DAY a reading belongs to, how many sites are on
        offer, and the donor's full session sheet.

        The date sits with the entry forms rather than at the top of the tab
        because it governs writing, not reading: the cards above are the whole
        history and are unaffected by it.
      */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          MEASUREMENT DATE
        </Typography>
        <View style={styles.dayRow}>
          <Pressable
            onPress={() => setDate(shiftDateKey(date, -1))}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            testID="health-body-prev-day"
            style={[styles.dayBtn, { borderColor: colors.borderColor }]}
          >
            <Icon name="chevron-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.dayLabelColumn}>
            <Typography
              variant="headline"
              weight="semibold"
              color={colors.textPrimary}
              testID="health-body-day-label"
            >
              {dayLabel}
            </Typography>
            {!isToday ? (
              <Pressable
                onPress={() => setDate(todayDateKey())}
                accessibilityRole="button"
                accessibilityLabel="Jump back to today"
                testID="health-body-today-button"
                hitSlop={8}
              >
                <Typography variant="caption1" weight="semibold" color={colors.primary}>
                  Back to today
                </Typography>
              </Pressable>
            ) : null}
          </View>
          {/* Forward is blocked at today: a measurement cannot be taken later
              than now, and the donor's `nextDay()` refuses the same move. */}
          <Pressable
            onPress={() => !isToday && setDate(shiftDateKey(date, 1))}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: isToday }}
            testID="health-body-next-day"
            style={[styles.dayBtn, { borderColor: colors.borderColor, opacity: isToday ? 0.4 : 1 }]}
          >
            <Icon name="chevron-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
        <Typography variant="caption1" color={colors.textSecondary}>
          New readings are recorded against {dayLabel.toLowerCase()}.
        </Typography>

        <HealthToggleRow
          label={
            hiddenCount > 0
              ? `Show detailed sites (${hiddenCount} more)`
              : 'Show detailed sites'
          }
          value={showDetailed}
          onChange={setShowDetailed}
          icon="body-measurements"
          testID="health-body-detailed-toggle"
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          The extra points up an arm, a leg or the belly. A tape takes all of them; most people only
          need the main sites.
        </Typography>

        <Pressable
          onPress={() => setSessionOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Log a full measuring session"
          accessibilityState={{ expanded: sessionOpen }}
          testID="health-body-session-toggle"
          style={[styles.sessionToggle, { borderColor: colors.borderColor }]}
        >
          <Icon name={sessionOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
          <Typography variant="footnote" weight="semibold" color={colors.primary}>
            {sessionOpen ? 'Close session form' : 'Log a full session'}
          </Typography>
        </Pressable>

        {sessionOpen ? (
          <View style={styles.session} testID="health-body-session">
            {/* One unit for the whole session — the donor's sheet has a single
                unit picker too, and a tape does not change mid-body. */}
            <View style={styles.sessionHead}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Measured in
              </Typography>
              <View style={[styles.unitToggle, { borderColor: colors.borderColor }]}>
                {LENGTH_UNITS.map((option) => {
                  const active = option === unit;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setUnit(option)}
                      accessibilityRole="button"
                      accessibilityLabel={`Measure the session in ${option}`}
                      accessibilityState={{ selected: active }}
                      testID={`health-body-session-unit-${option}`}
                      style={[styles.unitOption, active && { backgroundColor: colors.primary }]}
                    >
                      <Typography
                        variant="footnote"
                        weight="semibold"
                        color={active ? colors.white : colors.textSecondary}
                      >
                        {option}
                      </Typography>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {groups.map((group) => (
              <View key={group.id} style={styles.group}>
                <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                  {group.title}
                </Typography>
                {group.metrics.map((option) => (
                  <View key={option} style={styles.sessionRow}>
                    <View style={styles.sessionLabel}>
                      <Typography variant="body" color={colors.textPrimary}>
                        {BODY_METRIC_LABELS[option]}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {BODY_METRIC_HINTS[option]}
                      </Typography>
                    </View>
                    <TextInput
                      value={session[option] ?? ''}
                      onChangeText={(text) =>
                        setSession((current) => ({
                          ...current,
                          [option]: sanitizeWeightInput(text),
                        }))
                      }
                      placeholder="—"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      accessibilityLabel={`${BODY_METRIC_LABELS[option]} in ${unitForMetric(
                        option,
                        unit,
                      )}`}
                      testID={`health-body-session-field-${option}`}
                      style={[
                        styles.sessionInput,
                        {
                          color: colors.textPrimary,
                          borderColor: colors.borderColor,
                          backgroundColor: colors.backgroundMain,
                        },
                      ]}
                    />
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {unitForMetric(option, unit)}
                    </Typography>
                  </View>
                ))}
              </View>
            ))}

            <Pressable
              onPress={() => void handleSaveSession()}
              disabled={sessionCount === 0 || saving}
              accessibilityRole="button"
              accessibilityLabel={`Save ${sessionCount} measurements for ${dayLabel.toLowerCase()}`}
              accessibilityState={{ disabled: sessionCount === 0 || saving }}
              testID="health-body-session-save"
              style={[
                styles.sessionSave,
                {
                  backgroundColor:
                    sessionCount > 0 && !saving ? colors.primary : colors.borderColor,
                },
              ]}
            >
              <Typography variant="body" weight="semibold" color={colors.white}>
                {sessionCount === 0
                  ? 'Fill in at least one site'
                  : `Save ${sessionCount} ${sessionCount === 1 ? 'site' : 'sites'}`}
              </Typography>
            </Pressable>
            <Typography variant="caption1" color={colors.textSecondary}>
              A session is stored as one record for {dayLabel.toLowerCase()}, so removing a single
              reading later leaves the rest of it alone.
            </Typography>
          </View>
        ) : null}
      </Card>

      {/* Quick add — one site, for when a single number is all there is */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          ADD A MEASUREMENT
        </Typography>
        {groups.map((group) => (
          <View key={group.id} style={styles.group}>
            <Typography variant="caption1" color={colors.textSecondary}>
              {group.title}
            </Typography>
            <View style={styles.metricGrid}>
              {group.metrics.map((option) => {
                const active = option === metric;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setMetric(option)}
                    accessibilityRole="button"
                    accessibilityLabel={`Measure ${BODY_METRIC_LABELS[option]}`}
                    accessibilityState={{ selected: active }}
                    testID={`health-body-metric-${option}`}
                    style={[
                      styles.metricChip,
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
                      {BODY_METRIC_LABELS[option]}
                    </Typography>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <View style={styles.logRow}>
          <TextInput
            value={draft}
            onChangeText={(text) => setDraft(sanitizeWeightInput(text))}
            placeholder={`Enter ${BODY_METRIC_LABELS[metric].toLowerCase()}`}
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => void handleLog()}
            accessibilityLabel={`${BODY_METRIC_LABELS[metric]} value in ${activeUnit}`}
            testID="health-body-value-input"
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          {metric === 'bodyFat' ? (
            <View
              style={[styles.percentBadge, { borderColor: colors.borderColor }]}
              testID="health-body-percent-badge"
              accessible
              accessibilityLabel="Measured in percent"
            >
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                %
              </Typography>
            </View>
          ) : (
            <View style={[styles.unitToggle, { borderColor: colors.borderColor }]}>
              {LENGTH_UNITS.map((option) => {
                const active = option === unit;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setUnit(option)}
                    accessibilityRole="button"
                    accessibilityLabel={`Measure in ${option}`}
                    accessibilityState={{ selected: active }}
                    testID={`health-body-unit-${option}`}
                    style={[styles.unitOption, active && { backgroundColor: colors.primary }]}
                  >
                    <Typography
                      variant="footnote"
                      weight="semibold"
                      color={active ? colors.white : colors.textSecondary}
                    >
                      {option}
                    </Typography>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Pressable
            onPress={() => void handleLog()}
            disabled={!canLog}
            accessibilityRole="button"
            accessibilityLabel="Log measurement"
            accessibilityState={{ disabled: !canLog }}
            testID="health-body-add-button"
            style={[
              styles.logButton,
              { backgroundColor: canLog ? colors.primary : colors.borderColor },
            ]}
          >
            <Icon name="add" size={22} color={colors.white} />
          </Pressable>
        </View>
        <Typography variant="caption1" color={colors.textSecondary} testID="health-body-metric-hint">
          {BODY_METRIC_HINTS[metric]}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          Measure at the same time of day, with the tape parallel to the floor and snug but not
          tight — that is what makes a trend mean anything.
        </Typography>
      </Card>

      {/* What is already on the selected day, so a session can be checked and corrected */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          RECORDED ON {dayLabel.toUpperCase()}
        </Typography>
        {dayEntries.length === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-body-day-empty">
            Nothing recorded for {dayLabel.toLowerCase()} yet.
          </Typography>
        ) : (
          dayEntries.map((entry) => (
            <View
              key={entry.id}
              style={[styles.entryRow, { borderTopColor: colors.borderColor }]}
              testID={`health-body-day-row-${entry.metric}`}
            >
              <Typography variant="body" color={colors.textPrimary} style={styles.compareLabel}>
                {BODY_METRIC_LABELS[entry.metric]}
              </Typography>
              <View style={styles.entryMeta}>
                <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                  {formatMeasurement(entry.value)} {entry.unit}
                </Typography>
                <Pressable
                  onPress={() => void handleDelete(entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${BODY_METRIC_LABELS[
                    entry.metric
                  ].toLowerCase()} from ${dayLabel.toLowerCase()}`}
                  testID={`health-body-day-remove-${entry.metric}`}
                  hitSlop={8}
                >
                  <Icon name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))
        )}
        {dayEntries.length > 1 ? (
          <Typography variant="caption1" color={colors.textSecondary}>
            Measured a site twice on this day? The most recent reading is the one charted for it.
          </Typography>
        ) : null}
      </Card>

      {/* History for the selected metric */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          {BODY_METRIC_LABELS[metric].toUpperCase()} HISTORY
        </Typography>
        {history.length === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID="health-body-history-empty">
            No {BODY_METRIC_LABELS[metric].toLowerCase()} readings yet.
          </Typography>
        ) : (
          history.map((entry) => (
            <View key={entry.id} style={[styles.entryRow, { borderTopColor: colors.borderColor }]}>
              <Typography variant="body" color={colors.textPrimary}>
                {formatMeasurement(entry.value)} {entry.unit}
              </Typography>
              <View style={styles.entryMeta}>
                {/* The day it was TAKEN, not the day it was typed — those are
                    different as soon as a reading is back-dated. */}
                <Typography variant="footnote" color={colors.textSecondary}>
                  {formatDayKey(bodyEntryDay(entry))}
                </Typography>
                <Pressable
                  onPress={() => void handleDelete(entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete measurement"
                  testID={`health-body-delete-${entry.id}`}
                  hitSlop={8}
                >
                  <Icon name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>

      {/* Ratios, BMI/BMR/lean mass, and left-vs-right — all derived, none graded */}
      <HealthBodyDashboard
        entries={entries}
        weightKg={weightKg}
        heightCm={goal.heightCm}
        gender={goal.gender}
        birthYear={goal.birthYear}
        activityLevel={goal.activityLevel}
        weightUnit={preferredUnit}
      />

      {/* Baseline vs a later day, across every site at once */}
      <HealthBodyCompareCard entries={entries} metrics={visibleMetrics} />
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
  group: {
    gap: Spacing.xs,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    borderRadius: CornerRadius.sm,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  dayBtn: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayLabelColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  sessionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  session: {
    gap: Spacing.sm,
  },
  sessionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sessionLabel: {
    flex: 1,
    gap: 1,
  },
  sessionInput: {
    width: 78,
    height: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
    textAlign: 'right',
  },
  sessionSave: {
    height: 46,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  metricChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  logRow: {
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
  unitToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  unitOption: {
    paddingHorizontal: Spacing.sm,
    height: 44,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentBadge: {
    height: 44,
    minWidth: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
  compareLabel: {
    flexShrink: 1,
  },
});
