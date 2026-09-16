import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthKegelTimer, HealthSectionScreen, HealthStatTiles } from '../components';
import { HealthScaleRow, HealthToggleRow } from '../components/HealthScaleRow';
import { recentDayKeys, sanitizeIntegerInput } from '../healthActivityStorage';
import { todayDateKey } from '../healthLocalStorage';
import { formatDayKey } from '../healthNutritionStorage';
import {
  activeIssues,
  clampKegelSets,
  createEmptyVitalityEntry,
  DEFAULT_MENS_TRACK_SETTINGS,
  energyScore,
  erectionScore,
  KEGEL_PHASE_INSTRUCTIONS,
  KEGEL_PHASE_LABELS,
  libidoDescription,
  loadMensTrackSettings,
  loadVitalityEntries,
  loadVitalityForDate,
  mentalScore,
  MENS_TRACK_LABELS,
  MENS_TRACK_PRESETS,
  MENS_TRACK_SECTIONS,
  saveMensTrackSettings,
  saveVitalityEntry,
  sexualHealthScore,
  summarizeVitality,
  VITALITY_ISSUE_LABELS,
  VITALITY_ISSUES,
  vitalityScore,
  vitalityStatus,
  type MensTrackSettings,
  type VitalityEntry,
} from '../healthVitalityStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

const TREND_DAYS = 7;

/**
 * Men's Health tab — the donor's `MensHealthView`, rebuilt on the new UI.
 *
 * One entry per day: libido and desire, sexual activity and satisfaction,
 * erection health, issues, energy / clarity / mood / sleep / stress, and kegel
 * sets — now with the donor's guided squeeze/relax timer behind the last of
 * those. The vitality score uses the donor's exact formula (see
 * `healthVitalityStorage`), so the number means the same thing it did before.
 *
 * ── WHAT THIS SCREEN DOES NOT DO ─────────────────────────────────────────────
 *
 * It records what the person tells it, and arithmetic on what they recorded. It
 * does not diagnose, does not interpret a symptom, and does not advise —
 * matching the judgement `HealthInjuriesScreen` made when it dropped the
 * donor's "Recovery Tips" card.
 *
 * The donor's **Optimization Tips** card is therefore NOT ported. Its six rows
 * are not general wellness copy; five of the six assert a physiological
 * mechanism the app cannot observe and does not measure — "Testosterone
 * production peaks during deep sleep", "Squats, deadlifts boost testosterone
 * naturally", "Oysters, beef, pumpkin seeds support T levels", "High cortisol
 * suppresses testosterone", and "Limit alcohol & smoking — both negatively
 * impact erectile function". That last one is the clearest case: it renders
 * directly beneath a checklist on which the person has just ticked "Difficulty
 * getting an erection", where it reads as advice for a condition they have
 * self-reported, from an app that has diagnosed nothing. This is the same
 * surface, and the same reasoning, as the injury screen's recovery tips.
 *
 * What DID port is the donor's technique copy — `KegelPhase.description`, which
 * describes the movement the timer is counting. That is instruction, in the
 * same register as the exercise library's per-movement instructions, and it
 * claims nothing about an outcome. The donor's own framing of that exercise
 * ("improve erection quality, orgasm intensity, and endurance") is dropped with
 * the rest.
 *
 * Two figures on the donor's cards were literal hard-coded integers —
 * `kegelStat(title: "This Week", value: 12)`, `"Streak", value: 5` — and its
 * weekly bar chart was `CGFloat.random(in: 30...80)`. Every figure here is
 * computed from the person's own entries or it is not shown.
 *
 * ── SECTION PREFERENCES ──────────────────────────────────────────────────────
 *
 * The donor's settings sheet is ported as the "What to show" card, against
 * `/health/mens-health/settings` — a deployed route that had no client at all.
 * On a log this intimate, being able to switch a topic off is not a nicety: it
 * is what lets someone keep the tracker without being asked, every day, about
 * the thing they would rather not be asked about. The donor's reminder toggle
 * is NOT ported — there is no Health reminder producer on either end yet, and a
 * switch that schedules nothing is a lie.
 */
export function HealthVitalityScreen() {
  const colors = useAppColors();

  const [entries, setEntries] = useState<VitalityEntry[]>([]);
  const [today, setToday] = useState<VitalityEntry>(createEmptyVitalityEntry());
  const [tracking, setTracking] = useState<MensTrackSettings>(DEFAULT_MENS_TRACK_SETTINGS);
  const [showTrackingOptions, setShowTrackingOptions] = useState(false);
  const [kegelDraft, setKegelDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const [all, todayEntry, storedTracking] = await Promise.all([
      loadVitalityEntries(),
      loadVitalityForDate(),
      loadMensTrackSettings(),
    ]);
    const resolved = todayEntry ?? createEmptyVitalityEntry();
    setEntries(all);
    setToday(resolved);
    setTracking(storedTracking);
    setKegelDraft(resolved.kegelSets > 0 ? String(resolved.kegelSets) : '');
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

  // Before anything is logged the donor shows the neutral 50 baseline rather
  // than a zero that would read as "you scored badly".
  const loggedToday = today.loggedAt.length > 0;
  const scored = loggedToday ? today : null;
  const score = vitalityScore(scored);
  const issues = activeIssues(today);
  const weekKeys = useMemo(() => recentDayKeys(TREND_DAYS), []);
  const trend = useMemo(() => summarizeVitality(entries, weekKeys), [entries, weekKeys]);
  const history = entries.slice(0, 6);
  const shownSections = MENS_TRACK_SECTIONS.filter((section) => tracking[section]).length;

  const persist = useCallback(
    async (patch: Partial<VitalityEntry>) => {
      const optimistic = { ...today, ...patch, loggedAt: new Date().toISOString() };
      setToday(optimistic);
      const next = await saveVitalityEntry(patch);
      setEntries(next);
      const saved = next.find((e) => e.date === todayDateKey());
      if (saved) setToday(saved);
    },
    [today]
  );

  const handleKegels = async (raw?: string) => {
    const value = clampKegelSets(Number(raw ?? kegelDraft));
    setKegelDraft(value > 0 ? String(value) : '');
    await persist({ kegelSets: value });
  };

  /**
   * A finished guided session ADDS to the day rather than replacing it — a
   * second session at night is a second session, not a correction of the
   * morning's.
   */
  const handleSessionComplete = useCallback(
    (completedSets: number) => {
      if (completedSets <= 0) return;
      const next = clampKegelSets(today.kegelSets + completedSets);
      setKegelDraft(next > 0 ? String(next) : '');
      void persist({ kegelSets: next });
    },
    [today.kegelSets, persist]
  );

  const handleTracking = async (patch: Partial<MensTrackSettings>) => {
    setTracking((current) => ({ ...current, ...patch }));
    setTracking(await saveMensTrackSettings(patch));
  };

  return (
    <HealthSectionScreen title="Men's Health" testID="health-vitality-screen" loading={loading}>
      {/* Vitality score */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          VITALITY
        </Typography>
        <View style={styles.scoreRow}>
          <ProgressRing
            progress={score / 100}
            size={104}
            stroke={11}
            showPercent={false}
            testID="health-vitality-ring"
          >
            <Typography
              variant="title2"
              weight="bold"
              color={colors.textPrimary}
              testID="health-vitality-score"
            >
              {score}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              / 100
            </Typography>
          </ProgressRing>
          <View style={styles.scoreText}>
            <Typography
              variant="headline"
              weight="semibold"
              color={colors.textPrimary}
              testID="health-vitality-status"
            >
              {vitalityStatus(score)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {loggedToday
                ? 'Average of your sexual-health, erection, energy and mental sub-scores.'
                : 'Not logged today — showing the neutral baseline.'}
            </Typography>
          </View>
        </View>
        <HealthStatTiles
          stats={[
            {
              label: 'Sexual health',
              value: String(sexualHealthScore(scored)),
              icon: 'heart-rate',
              testID: 'health-vitality-sub-sexual',
            },
            {
              label: 'Erection',
              value: String(erectionScore(scored)),
              icon: 'recovery',
              testID: 'health-vitality-sub-erection',
            },
            {
              label: 'Energy',
              value: String(energyScore(scored)),
              icon: 'energy-active',
              testID: 'health-vitality-sub-energy',
            },
            {
              label: 'Mental',
              value: String(mentalScore(scored)),
              icon: 'insights',
              testID: 'health-vitality-sub-mental',
            },
          ]}
        />
      </Card>

      {/* Drive */}
      {(tracking.trackLibido || tracking.trackSexualDesire) && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-vitality-card-drive"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            DRIVE
          </Typography>
          {tracking.trackLibido && (
            <HealthScaleRow
              label="Libido"
              value={today.libido}
              onChange={(next) => void persist({ libido: next })}
              icon="heart-rate"
              hint={libidoDescription(loggedToday ? today : null)}
              testID="health-vitality-libido"
            />
          )}
          {tracking.trackSexualDesire && (
            <HealthScaleRow
              label="Desire through the day"
              value={today.sexualDesireLevel}
              onChange={(next) => void persist({ sexualDesireLevel: next })}
              icon="mood"
              testID="health-vitality-desire"
            />
          )}
        </Card>
      )}

      {/* Activity + satisfaction */}
      {tracking.trackSexualActivity && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-vitality-card-activity"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            ACTIVITY
          </Typography>
          <HealthToggleRow
            label="Sex with a partner"
            value={today.hadPartnerSex}
            onChange={(next) => void persist({ hadPartnerSex: next })}
            testID="health-vitality-partner-sex"
          />
          <HealthToggleRow
            label="Solo"
            value={today.hadMasturbation}
            onChange={(next) => void persist({ hadMasturbation: next })}
            testID="health-vitality-solo"
          />
          <HealthToggleRow
            label="Orgasm"
            value={today.hadOrgasm}
            onChange={(next) => void persist({ hadOrgasm: next })}
            testID="health-vitality-orgasm"
          />
          {(today.hadPartnerSex || today.hadMasturbation) && (
            <HealthScaleRow
              label="Satisfaction"
              value={today.overallSatisfaction}
              onChange={(next) => void persist({ overallSatisfaction: next })}
              icon="score-gauge"
              testID="health-vitality-satisfaction"
            />
          )}
        </Card>
      )}

      {/* Erection health */}
      {(tracking.trackMorningErection || tracking.trackEroticDreams) && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-vitality-card-erection"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            ERECTION HEALTH
          </Typography>
          {tracking.trackMorningErection && (
            <>
              <HealthToggleRow
                label="Morning erection"
                value={today.hadMorningErection}
                onChange={(next) => void persist({ hadMorningErection: next })}
                testID="health-vitality-morning"
              />
              {today.hadMorningErection && (
                <HealthScaleRow
                  label="Morning quality"
                  value={today.morningErectionQuality}
                  onChange={(next) => void persist({ morningErectionQuality: next })}
                  testID="health-vitality-morning-quality"
                />
              )}
              <HealthScaleRow
                label="Quality during activity"
                value={today.erectionQuality}
                onChange={(next) => void persist({ erectionQuality: next })}
                testID="health-vitality-quality"
              />
            </>
          )}
          {tracking.trackEroticDreams && (
            <HealthToggleRow
              label="Erotic dream"
              value={today.hadEroticDream}
              onChange={(next) => void persist({ hadEroticDream: next })}
              testID="health-vitality-erotic-dream"
            />
          )}
        </Card>
      )}

      {/* Issues */}
      {tracking.trackIssues && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-vitality-card-issues"
        >
          <View style={styles.cardHead}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              ANYTHING OFF TODAY?
            </Typography>
            <Typography
              variant="footnote"
              color={issues.length > 0 ? colors.primary : colors.textSecondary}
              testID="health-vitality-issue-count"
            >
              {issues.length === 0 ? 'None' : `${issues.length} noted`}
            </Typography>
          </View>
          {VITALITY_ISSUES.map((issue) => (
            <HealthToggleRow
              key={issue}
              label={VITALITY_ISSUE_LABELS[issue]}
              value={today[issue]}
              onChange={(next) => void persist({ [issue]: next } as Partial<VitalityEntry>)}
              testID={`health-vitality-issue-${issue}`}
            />
          ))}
        </Card>
      )}

      {/* Energy & mind */}
      {tracking.trackEnergy && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-vitality-card-energy"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            ENERGY &amp; MIND
          </Typography>
          <HealthScaleRow
            label="Energy"
            value={today.energyLevel}
            onChange={(next) => void persist({ energyLevel: next })}
            icon="energy-active"
            testID="health-vitality-energy"
          />
          <HealthScaleRow
            label="Mental clarity"
            value={today.mentalClarity}
            onChange={(next) => void persist({ mentalClarity: next })}
            icon="insights"
            testID="health-vitality-clarity"
          />
          <HealthScaleRow
            label="Mood"
            value={today.mood}
            onChange={(next) => void persist({ mood: next })}
            icon="mood"
            testID="health-vitality-mood"
          />
          <HealthScaleRow
            label="Sleep quality"
            value={today.sleepQuality}
            onChange={(next) => void persist({ sleepQuality: next })}
            icon="sleep"
            testID="health-vitality-sleep"
          />
          <HealthScaleRow
            label="Stress"
            value={today.stressLevel}
            onChange={(next) => void persist({ stressLevel: next })}
            icon="stress"
            testID="health-vitality-stress"
          />
        </Card>
      )}

      {/* Kegels — the donor's guided timer */}
      {tracking.trackKegels && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-vitality-card-kegels"
        >
          <View style={styles.cardHead}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              KEGELS
            </Typography>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textPrimary}
              testID="health-vitality-kegel-today"
            >
              {today.kegelSets} today
            </Typography>
          </View>

          <HealthKegelTimer onComplete={handleSessionComplete} />

          {/* Technique — the donor's own phase descriptions, so the movement is
              readable before the countdown starts. */}
          <View style={styles.techniqueBlock}>
            {(['squeeze', 'relax'] as const).map((phase) => (
              <View key={phase} style={styles.techniqueRow}>
                <Icon name="timer" size={14} color={colors.textSecondary} />
                <Typography variant="caption1" color={colors.textSecondary} style={styles.techniqueText}>
                  <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                    {KEGEL_PHASE_LABELS[phase]}.{' '}
                  </Typography>
                  {KEGEL_PHASE_INSTRUCTIONS[phase]}
                </Typography>
              </View>
            ))}
          </View>

          {/* Manual count, for sets done away from the timer. */}
          <View style={styles.kegelRow}>
            <TextInput
              value={kegelDraft}
              onChangeText={(text) => setKegelDraft(sanitizeIntegerInput(text))}
              onEndEditing={(e) => void handleKegels(e.nativeEvent.text)}
              onSubmitEditing={() => void handleKegels()}
              onBlur={() => void handleKegels()}
              placeholder="Sets today"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel="Kegel sets today"
              testID="health-vitality-kegel-input"
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
              onPress={() => void handleKegels()}
              accessibilityRole="button"
              accessibilityLabel="Save kegel sets"
              testID="health-vitality-kegel-save"
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
            >
              <Icon name="complete" size={20} color={colors.white} />
            </Pressable>
          </View>
        </Card>
      )}

      {/* Week */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          LAST 7 DAYS
        </Typography>
        <HealthStatTiles
          stats={[
            {
              label: 'Days logged',
              value: `${trend.daysLogged}/${TREND_DAYS}`,
              icon: 'journal',
              testID: 'health-vitality-week-days',
            },
            {
              label: 'Avg score',
              value: trend.daysLogged > 0 ? String(trend.averageScore) : '—',
              icon: 'score-gauge',
              testID: 'health-vitality-week-score',
            },
            {
              label: 'Kegel sets',
              value: String(trend.kegelSets),
              icon: 'strength',
              testID: 'health-vitality-week-kegels',
            },
          ]}
        />
        {/* Absent is not zero: the averages above cover the days that were
            logged, and this line says how many that was. */}
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="health-vitality-week-basis"
        >
          {trend.daysLogged === 0
            ? `Nothing logged in the last ${TREND_DAYS} days — the figures above are blank rather than zero.`
            : `Averaged over the ${trend.daysLogged} ${
                trend.daysLogged === 1 ? 'day' : 'days'
              } you logged, not all ${TREND_DAYS}.`}
        </Typography>
        {history.length > 0 &&
          history.map((entry) => (
            <View key={entry.id} style={[styles.entryRow, { borderTopColor: colors.borderColor }]}>
              <Typography variant="body" color={colors.textPrimary}>
                {formatDayKey(entry.date)}
              </Typography>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                testID={`health-vitality-history-${entry.date}`}
              >
                {vitalityScore(entry)} · {activeIssues(entry).length} issues
              </Typography>
            </View>
          ))}
      </Card>

      {/* What to show — the donor's settings sheet, minus the reminder */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Pressable
          onPress={() => setShowTrackingOptions((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Choose which sections to show"
          accessibilityState={{ expanded: showTrackingOptions }}
          testID="health-vitality-tracking-toggle"
          style={styles.cardHead}
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            WHAT TO SHOW
          </Typography>
          <View style={styles.entryMeta}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="health-vitality-tracking-count"
            >
              {shownSections} of {MENS_TRACK_SECTIONS.length}
            </Typography>
            <Icon
              name={showTrackingOptions ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
          </View>
        </Pressable>

        {showTrackingOptions && (
          <>
            <Typography variant="caption1" color={colors.textSecondary}>
              Hiding a section only changes this screen. Anything you already logged stays exactly
              as it was.
            </Typography>

            <View style={styles.presetRow}>
              {MENS_TRACK_PRESETS.map((preset) => (
                <Pressable
                  key={preset.key}
                  onPress={() => void handleTracking(preset.settings)}
                  accessibilityRole="button"
                  accessibilityLabel={`Preset: ${preset.label}`}
                  testID={`health-vitality-preset-${preset.key}`}
                  style={[styles.presetChip, { borderColor: colors.borderColor }]}
                >
                  <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                    {preset.label}
                  </Typography>
                </Pressable>
              ))}
            </View>

            {MENS_TRACK_SECTIONS.map((section) => (
              <HealthToggleRow
                key={section}
                label={MENS_TRACK_LABELS[section]}
                value={tracking[section]}
                onChange={(next) => void handleTracking({ [section]: next } as Partial<MensTrackSettings>)}
                testID={`health-vitality-track-${section}`}
              />
            ))}
          </>
        )}
      </Card>

      {/* Donor's disclaimer — wellness, not diagnosis */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.footnoteRow}>
          <Icon name="privacy" size={16} color={colors.textSecondary} />
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            style={styles.disclaimer}
            testID="health-vitality-disclaimer"
          >
            This is a personal wellness log, not a medical assessment. If something here worries
            you or persists, talk to a doctor. Everything you enter is private to your account
            and is never shared with other Symply apps.
          </Typography>
        </View>
      </Card>
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
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  scoreText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  techniqueBlock: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  techniqueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  techniqueText: {
    flex: 1,
  },
  kegelRow: {
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
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  presetChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
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
    gap: Spacing.sm,
  },
  footnoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  disclaimer: {
    flex: 1,
  },
});
