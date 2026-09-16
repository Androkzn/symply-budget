import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { Icon, ProgressBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { CornerRadius, Spacing, hexToRgba, useAppColors } from '@theme';

import type { HealthKitImportResult, HealthKitSyncAreaProgress, HealthKitSyncProgress } from '../healthKit';

export interface HealthKitSyncProgressModalProps {
  /** Drive this from `useHealthKitConnection().busy`. */
  visible: boolean;
  /** The same hook's `progress` — frames update live while `visible` is true. */
  progress: HealthKitSyncProgress | null;
  testID?: string;
}

const STAGE_COPY: Record<HealthKitSyncProgress['stage'], string> = {
  reading: 'Reading your last two months from Apple Health…',
  saving: 'Saving it all to your log…',
  done: 'All caught up',
};

/** How long the completion summary stays up once the sync itself has finished. */
const DONE_HOLD_MS = 1600;

function summaryLine(result: HealthKitImportResult): string {
  const added = result.imported + result.weightImported;
  if (added === 0) return 'Nothing new — you were already up to date.';
  const noun = added === 1 ? 'entry' : 'entries';
  return `${added} ${noun} added to your log.`;
}

function AreaRow({ area, tint, subtle }: { area: HealthKitSyncAreaProgress; tint: string; subtle: string }) {
  const active = area.status !== 'pending';
  return (
    <View style={styles.row} testID={`healthkit-sync-progress-area-${area.type}`}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: hexToRgba(tint, active ? 0.14 : 0.06) },
        ]}
      >
        <Icon name={area.icon} size={16} color={active ? tint : subtle} />
      </View>
      <Typography
        variant="footnote"
        weight={active ? 'medium' : 'regular'}
        color={active ? undefined : subtle}
        style={styles.rowLabel}
      >
        {area.label}
      </Typography>
      {area.status === 'reading' ? (
        <ActivityIndicator size="small" color={tint} testID={`healthkit-sync-progress-area-${area.type}-spinner`} />
      ) : area.status === 'done' ? (
        <View style={styles.rowResult}>
          <Typography variant="caption1" weight="semibold" color={tint}>
            {area.samplesRead > 0 ? `${area.samplesRead}` : '—'}
          </Typography>
          <Icon name="checkmark" size={14} color={tint} />
        </View>
      ) : (
        <View style={[styles.pendingDot, { backgroundColor: subtle }]} />
      )}
    </View>
  );
}

/**
 * The overlay `HealthKitPermissionScreen`, `HealthHomeScreen`, `HealthMoreScreen`
 * and `HealthWeightScreen` all show while `useHealthKitConnection().syncing` is
 * true — a per-area breakdown instead of a bare spinner, so the two-month
 * historical backfill (`healthKitHistoricalWindows`) has something to look at
 * instead of a blank wait. Deliberately gated on `syncing` rather than `busy`:
 * `busy` also covers the OS permission sheet, and presenting this full-screen
 * modal while that sheet is up races it for the native presentation slot —
 * the sheet displaces the modal, then the modal reappears once the sheet is
 * answered, which read as a flicker rather than one continuous overlay.
 *
 * Stays mounted for `DONE_HOLD_MS` after `visible` drops back to `false`, so the
 * "N entries added" summary is readable rather than vanishing the instant the
 * import settles.
 */
export function HealthKitSyncProgressModal({
  visible,
  progress,
  testID = 'healthkit-sync-progress-modal',
}: HealthKitSyncProgressModalProps) {
  const colors = useAppColors();
  const [holdOpen, setHoldOpen] = useState(false);
  const [prevVisible, setPrevVisible] = useState(visible);

  // Decided DURING render, not in a `useEffect` — a `true → false` transition
  // must earn its hold in the very same commit that first shows `visible` as
  // false. Deferring it to an effect left one full render (and, on a real
  // device, one real native `Modal` unmount) where neither `visible` nor
  // `holdOpen` was true yet, so the sync overlay closed and the "All caught
  // up" frame opened a beat later as if it were a second popup, rather than
  // one continuous overlay.
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    // Only an actual true → false transition earns a hold. Mounting directly
    // with `visible=false` (a screen that never showed this sync) must not
    // resurrect a stale `done` frame left over from long before.
    setHoldOpen(!visible && progress?.stage === 'done');
  }

  useEffect(() => {
    if (!holdOpen) return undefined;
    const timer = setTimeout(() => setHoldOpen(false), DONE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [holdOpen]);

  if (!visible && !holdOpen) return null;

  const stage = progress?.stage ?? 'reading';
  const areas = progress?.areas ?? [];
  const totalAreas = progress?.totalAreas ?? 0;
  const completedAreas = progress?.completedAreas ?? 0;

  // A progress bar that only reflected "areas read" would sit at 100% through
  // the whole saving phase, which reads as stuck. Reading fills the first 80%,
  // saving claims a fixed 90%, and only `done` reaches 100%.
  const fraction =
    progress === null
      ? 0.05
      : stage === 'done'
        ? 1
        : stage === 'saving'
          ? 0.9
          : totalAreas > 0
            ? 0.1 + (completedAreas / totalAreas) * 0.7
            : 0.1;

  const result = progress?.result ?? null;
  const skippedCount = result ? result.skipped.length + result.weightSkipped.length : 0;
  const troubleCount = result ? result.failed + result.weightFailed : 0;

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay} testID={testID} accessibilityViewIsModal>
        <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={styles.header}>
            {stage === 'done' ? (
              <View style={[styles.doneBadge, { backgroundColor: hexToRgba(colors.primary, 0.14) }]}>
                <Icon name="checkmark" size={32} color={colors.primary} />
              </View>
            ) : (
              <ActivityIndicator size="large" color={colors.primary} />
            )}
          </View>

          <Typography
            variant="headline"
            weight="semibold"
            align="center"
            style={styles.title}
            testID={`${testID}-title`}
          >
            {progress === null ? 'Connecting to Apple Health…' : STAGE_COPY[stage]}
          </Typography>

          {result ? (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              align="center"
              testID={`${testID}-summary`}
            >
              {summaryLine(result)}
              {skippedCount > 0 ? ` ${skippedCount} already matched what you had.` : ''}
            </Typography>
          ) : null}

          {troubleCount > 0 ? (
            <Typography variant="caption1" color={colors.textSecondary} align="center">
              A few readings didn’t save — they’ll try again next sync.
            </Typography>
          ) : null}

          <View style={styles.progressBar}>
            <ProgressBar progress={fraction} height={6} color={colors.primary} />
          </View>

          {areas.length > 0 ? (
            <View style={styles.areas}>
              {areas.map((area) => (
                <AreaRow key={area.type} area={area} tint={colors.primary} subtle={colors.textSecondary} />
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '86%',
    maxWidth: 360,
    padding: Spacing.xl,
    borderRadius: CornerRadius.lg,
    gap: Spacing.xs,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  doneBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginBottom: Spacing.xxs,
  },
  progressBar: {
    marginVertical: Spacing.sm,
  },
  areas: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
  },
  rowResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.4,
  },
});
