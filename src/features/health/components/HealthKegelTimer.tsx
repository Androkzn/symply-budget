import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  createKegelSession,
  kegelPhaseProgress,
  kegelPhaseSeconds,
  kegelProgressLabel,
  KEGEL_PHASE_INSTRUCTIONS,
  KEGEL_PHASE_LABELS,
  KEGEL_RELAX_SECONDS,
  KEGEL_SET_OPTIONS,
  KEGEL_SQUEEZE_SECONDS,
  pauseKegelSession,
  startKegelSession,
  tickKegelSession,
  type KegelSession,
} from '../healthVitalityStorage';

/**
 * The donor's `KegelWorkoutView` — a guided squeeze / relax timer.
 *
 * Donor timings, unchanged: five seconds squeezing, five seconds releasing,
 * three sets by default (the donor hard-coded three; the length is selectable
 * here). All of the sequencing is the pure reducer in `healthVitalityStorage`
 * — this file owns the interval, the haptics and the paint, nothing else.
 *
 * ## What it does that the donor does not
 *
 *  - **Finishing the session logs the sets.** The donor's card showed "This
 *    Week 12 · Streak 5" as literal hard-coded integers, and the completed
 *    workout was never written anywhere. Here `onComplete` hands the finished
 *    count to the day's entry, so the figure on the card is the one the person
 *    earned.
 *  - **Backgrounding pauses it.** A timer that keeps counting while the phone
 *    is in a pocket would claim sets nobody held. The donor's `Timer` simply
 *    stops firing and the session silently stalls mid-set.
 *  - **Pause resumes; stop rewinds.** A half-held squeeze cannot be resumed
 *    honestly once the person has let go, so `startKegelSession` rewinds from
 *    idle and only a PAUSE keeps its place.
 *
 * ## What it does not do
 *
 * It does not say what kegels are for, how many a person should do, or what
 * their score means. It counts seconds and sets. The donor's surrounding
 * copy ("improve erection quality, orgasm intensity, and endurance") is a
 * clinical claim about an outcome this app cannot observe, and is not ported —
 * see the screen header.
 */

const HAPTICS_UNAVAILABLE_IS_FINE = () => {
  /* A device without a taptic engine is not an error worth surfacing. */
};

export interface HealthKegelTimerProps {
  /** Called once, with the number of sets finished, when a session completes. */
  onComplete: (completedSets: number) => void;
  testID?: string;
}

export function HealthKegelTimer({ onComplete, testID = 'health-kegel-timer' }: HealthKegelTimerProps) {
  const colors = useAppColors();
  const [session, setSession] = useState<KegelSession>(() => createKegelSession());

  // The reducer runs off the previous state inside the interval, so the
  // interval never needs re-creating when the session changes.
  const phaseRef = useRef(session.phase);
  const completedRef = useRef(false);

  useEffect(() => {
    if (session.status !== 'running') return undefined;
    const id = setInterval(() => {
      setSession((current) => tickKegelSession(current));
    }, 1000);
    return () => clearInterval(id);
  }, [session.status]);

  // A phase flip is the whole point of the exercise and the person's eyes are
  // usually shut, so it gets a tap.
  useEffect(() => {
    if (session.phase !== phaseRef.current) {
      phaseRef.current = session.phase;
      if (session.status === 'running') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(HAPTICS_UNAVAILABLE_IS_FINE);
      }
    }
  }, [session.phase, session.status]);

  useEffect(() => {
    if (session.status === 'done' && !completedRef.current) {
      completedRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        HAPTICS_UNAVAILABLE_IS_FINE
      );
      onComplete(session.completedSets);
    }
  }, [session.status, session.completedSets, onComplete]);

  // Leaving the app mid-set would otherwise keep counting sets nobody held.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setSession((current) => pauseKegelSession(current));
    });
    return () => subscription.remove();
  }, []);

  const handleStart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(HAPTICS_UNAVAILABLE_IS_FINE);
    completedRef.current = false;
    setSession((current) => startKegelSession(current));
  }, []);

  const handlePause = useCallback(() => {
    setSession((current) => pauseKegelSession(current));
  }, []);

  const handleReset = useCallback(() => {
    completedRef.current = false;
    setSession((current) => createKegelSession(current.totalSets));
  }, []);

  const handleSets = useCallback((totalSets: number) => {
    completedRef.current = false;
    setSession(createKegelSession(totalSets));
  }, []);

  const running = session.status === 'running';
  const done = session.status === 'done';
  const idle = session.status === 'idle';
  // The relax phase is deliberately the calmer of the two colours: the person
  // is reading it out of the corner of an eye, and "which one am I in" has to
  // survive that.
  const phaseColor = session.phase === 'squeeze' ? colors.primary : colors.info;

  return (
    <View style={styles.container} testID={testID}>
      <ProgressRing
        progress={kegelPhaseProgress(session)}
        size={148}
        stroke={13}
        color={done ? colors.success : phaseColor}
        showPercent={false}
        testID={`${testID}-ring`}
      >
        {done ? (
          <>
            <Icon name="complete" size={30} color={colors.success} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {pluralizeSets(session.completedSets)}
            </Typography>
          </>
        ) : (
          <>
            <Typography
              variant="footnote"
              weight="bold"
              color={phaseColor}
              testID={`${testID}-phase`}
            >
              {KEGEL_PHASE_LABELS[session.phase].toUpperCase()}
            </Typography>
            <Typography
              variant="title1"
              weight="bold"
              color={colors.textPrimary}
              testID={`${testID}-seconds`}
            >
              {session.secondsLeft}
            </Typography>
          </>
        )}
      </ProgressRing>

      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textPrimary}
        testID={`${testID}-progress`}
      >
        {kegelProgressLabel(session)}
      </Typography>

      <Typography variant="caption1" color={colors.textSecondary} style={styles.instruction}>
        {done
          ? `${pluralizeSets(session.completedSets)} added to today.`
          : KEGEL_PHASE_INSTRUCTIONS[session.phase]}
      </Typography>

      {/* Session length — locked while a session is in flight, because changing
          it mid-run would silently redefine what "complete" meant. */}
      <View style={styles.setRow}>
        <Typography variant="caption1" color={colors.textSecondary}>
          Sets
        </Typography>
        {KEGEL_SET_OPTIONS.map((option) => {
          const active = session.totalSets === option;
          return (
            <Pressable
              key={option}
              onPress={() => handleSets(option)}
              disabled={running}
              accessibilityRole="button"
              accessibilityLabel={`${option} sets`}
              accessibilityState={{ selected: active, disabled: running }}
              testID={`${testID}-sets-${option}`}
              style={[
                styles.setChip,
                {
                  borderColor: active ? colors.primary : colors.borderColor,
                  backgroundColor: active ? colors.primary : 'transparent',
                  opacity: running ? 0.4 : 1,
                },
              ]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textSecondary}
              >
                {option}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={running ? handlePause : handleStart}
          accessibilityRole="button"
          accessibilityLabel={running ? 'Pause kegel session' : startLabel(session)}
          testID={`${testID}-start`}
          style={[styles.primaryButton, { backgroundColor: running ? colors.error : colors.primary }]}
        >
          <Icon name={running ? 'pause' : 'play'} size={18} color={colors.white} />
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            {running ? 'Pause' : startLabel(session)}
          </Typography>
        </Pressable>

        {!idle && (
          <Pressable
            onPress={handleReset}
            accessibilityRole="button"
            accessibilityLabel="Reset kegel session"
            testID={`${testID}-reset`}
            style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
              Reset
            </Typography>
          </Pressable>
        )}
      </View>

      <Typography variant="caption1" color={colors.textSecondary}>
        {KEGEL_SQUEEZE_SECONDS}s squeeze · {KEGEL_RELAX_SECONDS}s relax ·{' '}
        {sessionMinutes(session.totalSets)}
      </Typography>
    </View>
  );
}

/**
 * "1 set" vs "N sets" — the completed-set count is user-facing, so the plural
 * has to agree. Shared by the ring's centre label and the "added to today"
 * caption so the two can never disagree with each other.
 */
export function pluralizeSets(count: number): string {
  return `${count} ${count === 1 ? 'set' : 'sets'}`;
}

/** "Start" / "Resume" / "Start again" — the button says which one it is. */
export function startLabel(session: KegelSession): string {
  if (session.status === 'paused') return 'Resume';
  if (session.status === 'done') return 'Start again';
  return 'Start';
}

/** Plain-language session length, so the commitment is known before it starts. */
export function sessionMinutes(totalSets: number): string {
  const seconds = totalSets * (KEGEL_SQUEEZE_SECONDS + KEGEL_RELAX_SECONDS);
  if (seconds < 60) return `${seconds}s in total`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min in total` : `${minutes} min ${rest}s in total`;
}

/** Exported for the screen's summary line: one full set is squeeze + relax. */
export const KEGEL_SET_SECONDS = kegelPhaseSeconds('squeeze') + kegelPhaseSeconds('relax');

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  instruction: {
    textAlign: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  setChip: {
    minWidth: 40,
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xxs,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.sm,
  },
  secondaryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
});
