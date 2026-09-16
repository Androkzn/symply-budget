import { describe, expect, it } from 'vitest';

import {
  createBackupArchive,
  openBackupArchive,
  recoveryPhraseFromEntropyHex,
  verifyBackupArchive,
} from '../src/index';

const ENTROPY = '00112233445566778899aabbccddeeff';

describe('backup archive', () => {
  // Argon2id recovery params (m=65536) are intentionally heavy.
  it('round-trips snapshot under recovery phrase', { timeout: 30_000 }, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupArchive(
      {
        snapshotJson: JSON.stringify({ version: 1, expenses: [{ id: 'e1', amount: 100 }] }),
        householdId: 'hh_test',
        deviceId: 'dev_test',
        keyEpoch: 1,
        createdAt: '2026-08-10T12:00:00.000Z',
      },
      { phrase },
    );

    expect(created.phrase.split(' ')).toHaveLength(12);
    expect(created.archive.format).toBe('symply-local-first-backup');
    expect(created.archiveJson).not.toContain('expenses');

    const verified = verifyBackupArchive(created.archiveJson, phrase);
    expect(verified.status).toBe('ok');
    expect(verified.payload?.householdId).toBe('hh_test');
    expect(verified.payload?.snapshotJson).toContain('e1');

    const opened = openBackupArchive(created.archiveJson, phrase);
    expect(JSON.parse(opened.snapshotJson).expenses[0].amount).toBe(100);
  });

  it('rejects wrong phrase and corrupt archive', { timeout: 30_000 }, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupArchive(
      {
        snapshotJson: '{}',
        householdId: 'hh_test',
        deviceId: 'dev_test',
        keyEpoch: 1,
        createdAt: '2026-08-10T12:00:00.000Z',
      },
      { phrase },
    );

    const wrong = verifyBackupArchive(
      created.archiveJson,
      recoveryPhraseFromEntropyHex('ffeeddccbbaa99887766554433221100'),
    );
    expect(wrong.status).toBe('decrypt_failed');

    const badPhrase = verifyBackupArchive(created.archiveJson, 'not a real phrase at all here');
    expect(badPhrase.status).toBe('invalid_phrase');

    const corrupt = verifyBackupArchive('{ "format": "nope" }', phrase);
    expect(corrupt.status).toBe('corrupt');
  });
});
