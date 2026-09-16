import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  categoryLabel,
  difficultyLabel,
  humanizeToken,
  injuryWarningFor,
  INJURY_FLAG_LABELS,
  requiresInjuryAcknowledgement,
  workoutTypeLabel,
  type ExerciseItem,
} from '../healthExerciseStorage';

/**
 * Exercise detail — instructions, target muscles, difficulty and "log this".
 *
 * A MODAL rather than a route: the library is a browse-and-pick surface, and a
 * sheet keeps the user's scroll position, filters and search query alive behind
 * it. Pushing a screen would throw all three away on every peek.
 *
 * SAFETY (the reason this screen has a confirmation step at all): when the
 * server has flagged this movement `avoid`, the log button asks a second time.
 * `logExercise` refuses an unacknowledged `avoid` in the store as well, so the
 * rule holds even if another caller skips this screen.
 *
 * Nothing here decides whether an exercise is risky — `injuryFlag` and
 * `injuryBodyParts` are the Worker's verdict, rendered as received.
 */

export interface HealthExerciseDetailScreenProps {
  exercise: ExerciseItem;
  onClose: () => void;
  onToggleFavorite: (exercise: ExerciseItem) => void;
  /** `acknowledged` is true once the user has confirmed a flagged movement. */
  onLog: (exercise: ExerciseItem, minutes: number, acknowledged: boolean) => void;
  /** Result copy from the last log attempt, shown inline. */
  message?: string | null;
}

/** Digits only — a session duration is a whole number of minutes. */
function sanitizeMinutes(raw: string): string {
  return typeof raw === 'string' ? raw.replace(/[^0-9]/g, '').slice(0, 4) : '';
}

export function HealthExerciseDetailScreen({
  exercise,
  onClose,
  onToggleFavorite,
  onLog,
  message = null,
}: HealthExerciseDetailScreenProps) {
  const colors = useAppColors();
  const [minutes, setMinutes] = useState(String(exercise.defaultMinutes));
  const [confirming, setConfirming] = useState(false);

  // Re-seed when the sheet is reused for a different exercise.
  useEffect(() => {
    setMinutes(String(exercise.defaultMinutes));
    setConfirming(false);
  }, [exercise.id, exercise.defaultMinutes]);

  const parsedMinutes = Number(minutes);
  const canLog = Number.isInteger(parsedMinutes) && parsedMinutes > 0;
  const needsConfirm = requiresInjuryAcknowledgement(exercise);
  const warning = injuryWarningFor(exercise);

  const handleLog = () => {
    if (!canLog) return;
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    onLog(exercise, parsedMinutes, needsConfirm);
    setConfirming(false);
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      testID="health-exercise-detail"
    >
      <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
        <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
          <Typography variant="headline" color={colors.textPrimary} style={styles.headerTitle}>
            {exercise.name}
          </Typography>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close exercise details"
            testID="health-exercise-detail-close"
            hitSlop={8}
            style={[styles.iconButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="close" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          {...keyboardDismissScrollProps}
          testID="health-exercise-detail-scroll"
        >
          {/* The safety banner comes FIRST — above the instructions the user
              would otherwise start following. */}
          {/* `injuryWarningFor` returns null for an unflagged movement, so the
              flag check is a narrowing aid, not a second condition. */}
          {warning && exercise.injuryFlag !== null && (
            <Card
              variant="filled"
              style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              testID="health-exercise-detail-injury"
            >
              <View style={styles.warningHead}>
                <Icon
                  name="warning"
                  size={18}
                  color={exercise.injuryFlag === 'avoid' ? colors.error : colors.warning}
                />
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={exercise.injuryFlag === 'avoid' ? colors.error : colors.warning}
                >
                  {INJURY_FLAG_LABELS[exercise.injuryFlag]}
                </Typography>
              </View>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                accessibilityLabel={warning}
              >
                {warning}
              </Typography>
            </Card>
          )}

          <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              ABOUT
            </Typography>
            <View style={styles.chipRow}>
              <MetaChip label={categoryLabel(exercise.category)} testID="health-exercise-detail-category" />
              <MetaChip
                label={`${difficultyLabel(exercise.difficulty)} · ${exercise.difficultyLevel}/5`}
                testID="health-exercise-detail-difficulty"
              />
              <MetaChip
                label={workoutTypeLabel(exercise.workoutType)}
                testID="health-exercise-detail-type"
              />
            </View>
            <Typography variant="caption1" color={colors.textSecondary}>
              Equipment:{' '}
              {exercise.equipment.length === 0
                ? 'None'
                : exercise.equipment.map(humanizeToken).join(', ')}
            </Typography>
          </Card>

          <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              TARGET MUSCLES
            </Typography>
            <Typography
              variant="body"
              color={colors.textPrimary}
              testID="health-exercise-detail-primary"
            >
              {exercise.muscleGroups.length === 0
                ? 'Whole body'
                : exercise.muscleGroups.map(humanizeToken).join(', ')}
            </Typography>
            {exercise.secondaryMuscles.length > 0 && (
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-exercise-detail-secondary"
              >
                Also works {exercise.secondaryMuscles.map(humanizeToken).join(', ').toLowerCase()}
              </Typography>
            )}
            {exercise.bodyParts.length > 0 && (
              <Typography variant="caption1" color={colors.textSecondary}>
                Loads {exercise.bodyParts.map(humanizeToken).join(', ').toLowerCase()}
              </Typography>
            )}
          </Card>

          <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              HOW TO DO IT
            </Typography>
            <Typography
              variant="body"
              color={colors.textPrimary}
              testID="health-exercise-detail-instructions"
            >
              {exercise.instructions ?? 'No instructions for this movement yet.'}
            </Typography>
          </Card>

          {message && (
            <Card
              variant="filled"
              style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              testID="health-exercise-detail-message"
            >
              <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
                {message}
              </Typography>
            </Card>
          )}

          {/* Log this — writes a session through the EXISTING workouts endpoint */}
          <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              LOG THIS
            </Typography>
            <View style={styles.minutesRow}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Minutes
              </Typography>
              <TextInput
                value={minutes}
                onChangeText={(text) => setMinutes(sanitizeMinutes(text))}
                placeholder="10"
                placeholderTextColor={colors.textSecondary}
                keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
                returnKeyType="done"
                accessibilityLabel="Session length in minutes"
                testID="health-exercise-minutes-input"
                style={[
                  styles.minutesInput,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                    backgroundColor: colors.backgroundMain,
                  },
                ]}
              />
            </View>
            {confirming && (
              <Typography
                variant="footnote"
                color={colors.error}
                testID="health-exercise-log-confirm"
                accessibilityLabel="Tap log again to record this flagged exercise"
              >
                You logged an injury that this loads. Tap again to record it anyway.
              </Typography>
            )}
            <Pressable
              onPress={handleLog}
              disabled={!canLog}
              accessibilityRole="button"
              accessibilityLabel={
                confirming ? `Record ${exercise.name} anyway` : `Log ${exercise.name}`
              }
              accessibilityState={{ disabled: !canLog }}
              testID="health-exercise-log-button"
              style={[
                styles.primaryButton,
                { backgroundColor: canLog ? colors.primary : colors.borderColor },
              ]}
            >
              <Icon name="add" size={18} color={colors.white} />
              <Typography variant="body" weight="semibold" color={colors.white}>
                {confirming ? 'Log it anyway' : 'Log this workout'}
              </Typography>
            </Pressable>
            <Pressable
              onPress={() => onToggleFavorite(exercise)}
              accessibilityRole="button"
              accessibilityLabel={
                exercise.isFavorite
                  ? `Remove ${exercise.name} from favourites`
                  : `Add ${exercise.name} to favourites`
              }
              accessibilityState={{ selected: exercise.isFavorite }}
              testID="health-exercise-detail-favorite"
              style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
            >
              <Icon
                name={exercise.isFavorite ? 'star' : 'star-outline'}
                size={18}
                color={exercise.isFavorite ? colors.primary : colors.textSecondary}
              />
              <Typography variant="body" color={colors.textPrimary}>
                {exercise.isFavorite ? 'In your favourites' : 'Add to favourites'}
              </Typography>
            </Pressable>
          </Card>
        </ScrollView>
      </View>
    </Modal>
  );
}

function MetaChip({ label, testID }: { label: string; testID: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.chip, { backgroundColor: colors.backgroundMain }]} testID={testID}>
      <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
  },
  // `flex: 1` on the ScrollView itself, not just the content container — without
  // it the sheet sizes to its content and a long exercise cannot be scrolled at
  // all on a short handset (src/__tests__/scrollContract.test.ts).
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: Spacing.xxl,
  },
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  warningHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: CornerRadius.sm,
  },
  minutesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  minutesInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
});
