import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { listLocalBudgetBackups } from '@features/budget/local/backup/backupDestinations';
import {
  cleanUpPreviousLocalBudgetData,
  eraseLocalBudgetData,
  getPreviousLocalBudgetData,
  type ArchivedLocalLedger,
  type LocalBudgetCleanupResult,
} from '@features/budget/local/localDataReset';
import { CornerRadius, IconSize, Spacing, hexToRgba, useAppColors } from '@theme';

import { formatDataSize } from './budgetFormat';

/**
 * Budget → Settings → Danger zone.
 *
 * Two irreversible operations on the data this phone is the system of record
 * for, kept apart from everything else on the screen and behind an explicit
 * second tap:
 *
 *  1. "Clean up previous data" — the ledgers earlier sign-ins left behind. An
 *     account switch retires the outgoing member's budget instead of shredding
 *     it, which is right for the member who signed out and wrong for the person
 *     holding the phone, who until now had no way to see or remove it.
 *  2. "Erase budget data on this device" — start over from an empty ledger.
 *
 * Confirmation is INLINE rather than an `Alert`: a destructive warning is read
 * more reliably where the action is than in a modal that appears after the
 * decision, and iOS renders `UIAlertController` in its own window, which
 * XCUITest snapshots of the app window miss (same reasoning as the Join panel
 * above it).
 */

type Props = {
  /** Sends the member to Backup & Restore before they erase anything. */
  onOpenBackup: () => void;
};

type PendingConfirm = 'cleanup' | 'erase' | null;

export function BudgetDangerZoneCard({ onOpenBackup }: Props) {
  const colors = useAppColors();

  const [previous, setPrevious] = useState<ArchivedLocalLedger[] | null>(null);
  /** Device archives only — enough to warn "you have no way back from here". */
  const [localBackupCount, setLocalBackupCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [archives, backups] = await Promise.all([
      getPreviousLocalBudgetData().catch(() => [] as ArchivedLocalLedger[]),
      listLocalBudgetBackups().catch(() => []),
    ]);
    setPrevious(archives);
    setLocalBackupCount(backups.length);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const previousBytes = useMemo(
    () => (previous ?? []).reduce((sum, entry) => sum + entry.sizeBytes, 0),
    [previous],
  );

  const previousCount = previous?.length ?? 0;
  const hasPrevious = previousCount > 0;

  const previousLine = useMemo(() => {
    if (previous === null) return 'Checking this device…';
    if (!hasPrevious) return 'Nothing left over from earlier sign-ins';
    const size = formatDataSize(previousBytes);
    return `${previousCount} budget${previousCount === 1 ? '' : 's'} from earlier sign-ins${
      size ? ` · ${size}` : ''
    }`;
  }, [previous, hasPrevious, previousCount, previousBytes]);

  const cleanUpWarning =
    previousCount === 1
      ? 'Permanently deletes the budget left behind by an account that signed out of this device, and the key that opens it. Your own budget is not touched.'
      : `Permanently deletes the ${previousCount} budgets left behind by accounts that signed out of this device, and the keys that open them. Your own budget is not touched.`;

  /** One busy/confirm/note lifecycle for both actions. */
  const runDangerousAction = (
    action: () => Promise<LocalBudgetCleanupResult>,
    onDone: (result: LocalBudgetCleanupResult) => string,
    failure: string,
  ) => {
    setConfirm(null);
    setNote(null);
    setIsBusy(true);
    void action()
      .then((result) => setNote({ ok: true, text: onDone(result) }))
      .catch((error) => {
        console.error('[BudgetDangerZone] action failed', error);
        setNote({ ok: false, text: failure });
      })
      .finally(() => {
        setIsBusy(false);
        void refresh();
      });
  };

  const handleCleanUp = () =>
    runDangerousAction(
      cleanUpPreviousLocalBudgetData,
      ({ removed, bytesFreed }) => {
        if (removed === 0) return 'There was nothing left to remove.';
        const size = formatDataSize(bytesFreed);
        return `Removed ${removed} old budget${removed === 1 ? '' : 's'}${
          size ? `, freeing ${size}` : ''
        }.`;
      },
      'Could not remove the old data. Try again.',
    );

  const handleErase = () =>
    runDangerousAction(
      eraseLocalBudgetData,
      () => 'Erased. This device is starting from an empty budget.',
      'Could not erase everything. Some data may still be on this device — try again.',
    );

  return (
    <>
      <Typography
        variant="caption1"
        weight="semibold"
        color={colors.error}
        style={styles.groupLabel}
      >
        DANGER ZONE
      </Typography>

      <Card
        style={[styles.card, { borderColor: hexToRgba(colors.error, 0.35) }]}
        testID="budget-danger-zone"
      >
        {/* 1 — other people's leftovers. Safe for the current budget, so it
            leads: it is the one most members actually want. */}
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Typography variant="body" weight="medium">
              Clean up previous data
            </Typography>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="budget-danger-previous-summary"
            >
              {previousLine}
            </Typography>
          </View>
          <GradientButton
            title="Clean up"
            variant="secondary"
            size="sm"
            disabled={!hasPrevious || isBusy}
            onPress={() => {
              setNote(null);
              setConfirm('cleanup');
            }}
            testID="budget-danger-cleanup"
          />
        </View>

        {confirm === 'cleanup' ? (
          <View style={styles.confirmPanel} testID="budget-danger-cleanup-confirm-panel">
            {/* One string, not interpolated fragments — it is read aloud as one
                sentence and asserted on as one. */}
            <Typography variant="caption1" color={colors.warning}>
              {cleanUpWarning}
            </Typography>
            <View style={styles.confirmButtons}>
              <GradientButton
                title="Delete old budgets"
                disabled={isBusy}
                onPress={handleCleanUp}
                testID="budget-danger-cleanup-confirm"
              />
              <GradientButton
                title="Cancel"
                variant="secondary"
                onPress={() => setConfirm(null)}
                testID="budget-danger-cleanup-cancel"
              />
            </View>
          </View>
        ) : null}

        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        {/* 2 — the member's own budget. Nothing on a server to fall back on, so
            the confirm panel spells out what is kept and offers a backup first. */}
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Typography variant="body" weight="medium">
              Erase budget data on this device
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Removes every category, expense, plan, saving and history kept here. Saved backups are
              not deleted.
            </Typography>
          </View>
          <GradientButton
            title="Erase"
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onPress={() => {
              setNote(null);
              setConfirm('erase');
            }}
            testID="budget-danger-erase"
          />
        </View>

        {confirm === 'erase' ? (
          <View style={styles.confirmPanel} testID="budget-danger-erase-confirm-panel">
            <View style={styles.warningRow}>
              <Icon name="alert-circle" forceIonicons size={IconSize.md} color={colors.error} />
              <Typography variant="caption1" color={colors.error} style={styles.warningText}>
                This budget lives on this phone — erasing it here erases it everywhere. It cannot be
                undone.
              </Typography>
            </View>
            <Typography variant="caption2" color={colors.textSecondary}>
              Your saved backups and the phrases that open them are kept, so you can restore one
              afterwards from Backup &amp; Restore.
            </Typography>
            {localBackupCount === 0 ? (
              <Typography
                variant="caption1"
                color={colors.error}
                testID="budget-danger-no-backup-warning"
              >
                There is no backup on this device. Back up first if you might want any of this
                again.
              </Typography>
            ) : null}
            <View style={styles.confirmButtons}>
              <GradientButton
                title="Back up first"
                variant="secondary"
                onPress={() => {
                  setConfirm(null);
                  onOpenBackup();
                }}
                testID="budget-danger-backup-first"
              />
              <GradientButton
                title={isBusy ? 'Erasing…' : 'Erase everything'}
                disabled={isBusy}
                onPress={handleErase}
                testID="budget-danger-erase-confirm"
              />
              <GradientButton
                title="Cancel"
                variant="secondary"
                onPress={() => setConfirm(null)}
                testID="budget-danger-erase-cancel"
              />
            </View>
          </View>
        ) : null}

        {note ? (
          <Typography
            variant="caption1"
            color={note.ok ? colors.textSecondary : colors.error}
            style={styles.note}
            testID="budget-danger-note"
          >
            {note.text}
          </Typography>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.xxs,
    letterSpacing: 0.8,
  },
  card: {
    padding: Spacing.base,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
  },
  rowText: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.md,
  },
  confirmPanel: {
    marginTop: Spacing.smd,
    gap: Spacing.xs,
  },
  confirmButtons: {
    marginTop: Spacing.xxs,
    gap: Spacing.xs,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  warningText: { flex: 1 },
  note: { marginTop: Spacing.smd },
});
