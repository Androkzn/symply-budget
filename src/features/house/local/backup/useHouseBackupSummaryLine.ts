import { useEffect, useMemo, useState } from 'react';

import { getHouseAutoBackupSettings, type HouseAutoBackupSettings } from './autoBackup';
import { useHouseBackupTaskStore } from './backupTaskStore';

/**
 * The one line the Settings row shows under "Backup & Restore".
 *
 * A chevron row that says nothing is a row people stop tapping. This says the
 * only thing worth saying from outside the screen: whether a seal is happening
 * right now, whether the last scheduled one failed, and otherwise what the
 * schedule is. Ported from `BudgetSettingsScreen`'s `backupSummaryLine`.
 *
 * Reads the ACTIVE home. The Backup screen itself lets the member point at any
 * of their homes, but a Settings row has one line and the home they have open
 * is the one it can honestly describe.
 */
export function useHouseBackupSummaryLine(enabled: boolean): {
  line: string;
  /** True when the last automatic run left something for the member to fix. */
  needsAttention: boolean;
} {
  const [settings, setSettings] = useState<HouseAutoBackupSettings | null>(null);

  // A seal can be running from anywhere — this screen, the Backup screen, or
  // the scheduler on foreground — so the row reads the shared task slot.
  const taskStatus = useHouseBackupTaskStore((t) => t.status);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getHouseAutoBackupSettings()
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
    // `taskStatus` is a dependency on purpose: a finished run changes the answer.
  }, [enabled, taskStatus]);

  return useMemo(() => {
    if (taskStatus === 'running') {
      return { line: 'Backing up… we’ll let you know when it’s done', needsAttention: false };
    }
    if (!settings?.enabled) {
      return {
        line: 'Save a copy of this home, or restore one',
        needsAttention: false,
      };
    }
    if (settings.lastStatus && settings.lastStatus !== 'ok') {
      return {
        line: settings.lastError ?? 'Last automatic backup did not finish',
        needsAttention: true,
      };
    }
    if (!settings.lastRunAt) {
      return { line: 'Automatic backup is on — nothing saved yet', needsAttention: false };
    }
    const when = new Date(settings.lastRunAt);
    const label = Number.isNaN(when.getTime())
      ? 'recently'
      : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return { line: `Automatic backup is on · last ${label}`, needsAttention: false };
  }, [settings, taskStatus]);
}
