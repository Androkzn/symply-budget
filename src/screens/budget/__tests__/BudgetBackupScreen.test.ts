/**
 * Presentation logic behind the Backup & Restore screen's status card.
 *
 * The card is the reason the screen exists — it answers "am I safe?" before any
 * control is reachable — so its wording and tone are derived, never stored, and
 * are pinned here.
 */
import { BUDGET_AUTO_BACKUP_DEFAULTS } from '@features/budget/local/backup/autoBackup';
import type { BudgetBackupEvent } from '@features/budget/local/backup/backupHistory';

import {
  deriveBackupHealth,
  formatBackupFileName,
  formatBackupSize,
  formatRelativeDay,
  type BackupEvidence,
} from '../BudgetBackupScreen';

const NOW = new Date('2026-08-12T12:00:00.000Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('formatBackupFileName', () => {
  it('turns a timestamped archive name into something readable', () => {
    const label = formatBackupFileName('symply-budget-backup-2026-08-11-0915.json');
    expect(label).toMatch(/2026/);
    expect(label).not.toContain('symply-budget-backup');
    expect(label).not.toContain('.json');
  });

  it('falls back to the bare name when it carries no timestamp', () => {
    expect(formatBackupFileName('sweet-home-v2-restore.backup.json')).toBe(
      'sweet-home-v2-restore.backup',
    );
  });
});

describe('formatBackupSize', () => {
  it('scales the unit to the size', () => {
    expect(formatBackupSize(512)).toBe('512 B');
    expect(formatBackupSize(2048)).toBe('2 KB');
    expect(formatBackupSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('renders nothing for an unknown size rather than a bare "0"', () => {
    expect(formatBackupSize(0)).toBe('');
  });
});

describe('formatRelativeDay', () => {
  it('reads as a human would say it', () => {
    expect(formatRelativeDay(daysAgo(0), NOW)).toBe('today');
    expect(formatRelativeDay(daysAgo(1), NOW)).toBe('yesterday');
    expect(formatRelativeDay(daysAgo(5), NOW)).toBe('5 days ago');
    expect(formatRelativeDay(daysAgo(31), NOW)).toBe('a month ago');
    expect(formatRelativeDay(daysAgo(90), NOW)).toBe('3 months ago');
  });

  it('degrades quietly on an unparseable timestamp', () => {
    expect(formatRelativeDay('garbage', NOW)).toBe('recently');
  });
});

describe('deriveBackupHealth', () => {
  const settings = (patch = {}) => ({ ...BUDGET_AUTO_BACKUP_DEFAULTS, ...patch });

  /** Evidence with nothing in it — the shape every case starts from. */
  const evidence = (patch: Partial<BackupEvidence> = {}): BackupEvidence => ({
    newestLocalBackupAt: null,
    localListKnown: true,
    lastSuccess: null,
    ...patch,
  });

  /** A recorded write, in the shape backupHistory persists. */
  const wroteTo = (
    destination: BudgetBackupEvent['destination'],
    at: string,
  ): BudgetBackupEvent => ({ at, destination, kind: 'scheduled', fileName: null });

  it('warns, without alarming, when nothing has ever been backed up', () => {
    const health = deriveBackupHealth(settings(), evidence(), NOW);
    expect(health.tone).toBe('warn');
    expect(health.title).toBe('No backup yet');
    // Says what is at stake — a neutral "not configured" teaches nothing.
    expect(health.detail).toMatch(/lose this phone/i);
  });

  it('reports protected when a schedule is on and running', () => {
    const health = deriveBackupHealth(
      settings({ enabled: true, frequency: 'weekly', lastRunAt: daysAgo(2) }),
      evidence({ newestLocalBackupAt: daysAgo(2), lastSuccess: wroteTo('device', daysAgo(2)) }),
      NOW,
    );
    expect(health.tone).toBe('good');
    expect(health.title).toBe('Protected');
    expect(health.detail).toContain('2 days ago');
  });

  it('flags a schedule that has drifted well past its due date', () => {
    const health = deriveBackupHealth(
      settings({ enabled: true, frequency: 'daily', lastRunAt: daysAgo(9) }),
      evidence({ newestLocalBackupAt: daysAgo(9), lastSuccess: wroteTo('device', daysAgo(9)) }),
      NOW,
    );
    expect(health.tone).toBe('warn');
    expect(health.title).toBe('Backup overdue');
  });

  it('does not cry overdue while inside the grace window', () => {
    const health = deriveBackupHealth(
      settings({ enabled: true, frequency: 'daily', lastRunAt: daysAgo(2) }),
      evidence({ newestLocalBackupAt: daysAgo(2), lastSuccess: wroteTo('device', daysAgo(2)) }),
      NOW,
    );
    expect(health.title).toBe('Protected');
  });

  it('escalates to bad when the last run actually failed', () => {
    const health = deriveBackupHealth(
      settings({
        enabled: true,
        lastRunAt: daysAgo(1),
        lastStatus: 'failed',
        lastError: 'Could not upload the backup to Google Drive.',
      }),
      evidence({ newestLocalBackupAt: daysAgo(1) }),
      NOW,
    );
    expect(health.tone).toBe('bad');
    expect(health.title).toBe('Needs attention');
    // Shows the real reason rather than a generic "something went wrong".
    expect(health.detail).toContain('Google Drive');
  });

  it('treats a lost cloud grant as needing attention, not as merely stale', () => {
    const health = deriveBackupHealth(
      settings({ enabled: true, lastRunAt: daysAgo(1), lastStatus: 'needs_auth' }),
      evidence({ newestLocalBackupAt: daysAgo(1) }),
      NOW,
    );
    expect(health.tone).toBe('bad');
  });

  it('acknowledges recent manual backups when automation is off', () => {
    const health = deriveBackupHealth(settings(), evidence({ newestLocalBackupAt: daysAgo(3) }), NOW);
    expect(health.tone).toBe('good');
    expect(health.title).toBe('Backed up');
    expect(health.detail).toMatch(/Automatic backup is off/);
  });

  it('warns once a manual-only backup has gone stale', () => {
    const health = deriveBackupHealth(settings(), evidence({ newestLocalBackupAt: daysAgo(75) }), NOW);
    expect(health.tone).toBe('warn');
    expect(health.title).toBe('Backup is old');
  });

  it('uses the most recent of the schedule and the on-disk archives', () => {
    // A cloud schedule ran yesterday; the newest on-device file is ancient.
    const health = deriveBackupHealth(
      settings({ enabled: true, frequency: 'weekly', destination: 'google-drive', lastRunAt: daysAgo(1) }),
      evidence({
        newestLocalBackupAt: daysAgo(200),
        lastSuccess: wroteTo('google-drive', daysAgo(1)),
      }),
      NOW,
    );
    expect(health.tone).toBe('good');
    expect(health.detail).toContain('yesterday');
  });

  it('is safe before settings have loaded', () => {
    const health = deriveBackupHealth(null, evidence(), NOW);
    expect(health.title).toBe('No backup yet');
  });

  // The bug this evidence model was built for: a run to THIS device leaves a
  // timestamp and a file, and only the file is the backup. Delete the file —
  // from the list here, or from Files — and the card kept saying "Protected"
  // above a list reading "No backups on this device yet".
  describe('when the archive a run wrote is gone', () => {
    it('refuses to call a deleted on-device backup protection', () => {
      const health = deriveBackupHealth(
        settings({ enabled: true, frequency: 'weekly', destination: 'device', lastRunAt: daysAgo(0) }),
        evidence({ newestLocalBackupAt: null, lastSuccess: wroteTo('device', daysAgo(0)) }),
        NOW,
      );
      expect(health.tone).toBe('warn');
      expect(health.title).toBe('Backup missing');
      // Does not pretend they never backed up — it says the copy went away.
      expect(health.detail).toMatch(/no longer on this device/i);
    });

    it('applies the same rule to installs that only ever stored lastRunAt', () => {
      // No recorded event: the legacy timestamp is read as a run to the
      // schedule's own destination, and held to the same standard.
      const health = deriveBackupHealth(
        settings({ enabled: true, destination: 'device', lastRunAt: daysAgo(0) }),
        evidence({ newestLocalBackupAt: null, lastSuccess: null }),
        NOW,
      );
      expect(health.title).toBe('Backup missing');
    });

    it('keeps trusting a run that left the phone — it cannot be checked from here', () => {
      const health = deriveBackupHealth(
        settings({ enabled: true, frequency: 'weekly', destination: 'google-drive', lastRunAt: daysAgo(1) }),
        evidence({ newestLocalBackupAt: null, lastSuccess: wroteTo('google-drive', daysAgo(1)) }),
        NOW,
      );
      expect(health.title).toBe('Protected');
      // Says where they are, so an empty on-device list is not a contradiction.
      expect(health.detail).toContain('Google Drive');
    });

    it('does not read an unreadable folder as an empty one', () => {
      const health = deriveBackupHealth(
        settings({ enabled: true, destination: 'device', lastRunAt: daysAgo(1) }),
        evidence({ newestLocalBackupAt: null, localListKnown: false, lastSuccess: wroteTo('device', daysAgo(1)) }),
        NOW,
      );
      expect(health.title).toBe('Protected');
    });

    it('still counts an older copy that survived', () => {
      // Last run went to this device and its file is gone, but an earlier
      // archive is still there — that one is real protection.
      const health = deriveBackupHealth(
        settings(),
        evidence({ newestLocalBackupAt: daysAgo(4), lastSuccess: wroteTo('device', daysAgo(0)) }),
        NOW,
      );
      expect(health.title).toBe('Backed up');
      expect(health.detail).toContain('4 days ago');
    });
  });

  it('credits a manual backup that went to the cloud', () => {
    // Nothing on this device and no schedule — but the app watched the upload
    // finish, and saying "No backup yet" to that member was its own small lie.
    const health = deriveBackupHealth(
      settings(),
      evidence({ lastSuccess: { ...wroteTo('dropbox', daysAgo(2)), kind: 'manual' } }),
      NOW,
    );
    expect(health.tone).toBe('good');
    expect(health.title).toBe('Backed up');
  });
});
