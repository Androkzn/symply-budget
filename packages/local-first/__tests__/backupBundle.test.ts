import { describe, expect, it } from 'vitest';

import {
  createBackupBundle,
  openBackupBundle,
  readBackupFileKind,
  recoveryPhraseFromEntropyHex,
  verifyBackupBundle,
  createBackupArchive,
  type BackupBundleDocument,
  type BackupBundleSectionPayload,
} from '../src/index';

const ENTROPY = '00112233445566778899aabbccddeeff';
const OTHER_ENTROPY = 'ffeeddccbbaa99887766554433221100';

/** Argon2id at recovery strength is deliberately heavy; every case pays one pass. */
const SLOW = { timeout: 30_000 };

function section(
  householdId: string,
  householdName: string,
  extra: Partial<BackupBundleSectionPayload> = {},
): BackupBundleSectionPayload {
  return {
    snapshotJson: JSON.stringify({ version: 1, expenses: [{ id: `e-${householdId}` }] }),
    householdId,
    householdName,
    deviceId: 'dev_test',
    keyEpoch: 1,
    createdAt: '2026-08-29T12:00:00.000Z',
    ...extra,
  };
}

describe('backup bundle', () => {
  it('round-trips several households under one phrase', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupBundle(
      [
        section('hh_a', 'Main budget'),
        section('hh_b', 'Holiday'),
        section('hh_c', "Nan's care costs"),
      ],
      { phrase },
    );

    expect(created.bundle.version).toBe(3);
    expect(created.bundle.meta.householdIds).toEqual(['hh_a', 'hh_b', 'hh_c']);
    expect(readBackupFileKind(created.bundleJson)).toBe('bundle');

    const verified = verifyBackupBundle(created.bundleJson, phrase);
    expect(verified.status).toBe('ok');
    expect(verified.households).toHaveLength(3);
    expect(verified.households.map((entry) => entry.payload?.householdName)).toEqual([
      'Main budget',
      'Holiday',
      "Nan's care costs",
    ]);
    expect(JSON.parse(verified.households[1].payload!.snapshotJson).expenses[0].id).toBe(
      'e-hh_b',
    );
  });

  it('keeps household names and rows out of the cleartext', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupBundle([section('hh_a', "Nan's care costs")], { phrase });

    // Ids are cleartext by design (the restore picker counts them); names and
    // rows must not be.
    expect(created.bundleJson).toContain('hh_a');
    expect(created.bundleJson).not.toContain('care costs');
    expect(created.bundleJson).not.toContain('expenses');
  });

  it('carries an opaque attachment sidecar', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupBundle(
      [section('hh_a', 'Main', { attachmentsJson: JSON.stringify([{ key: 'k1', dataB64: 'AA' }]) })],
      { phrase },
    );
    const opened = openBackupBundle(created.bundleJson, phrase);
    expect(JSON.parse(opened.households[0].payload!.attachmentsJson!)[0].key).toBe('k1');
  });

  it('rejects a wrong phrase, an invalid phrase and a corrupt file', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupBundle([section('hh_a', 'Main')], { phrase });

    expect(
      verifyBackupBundle(created.bundleJson, recoveryPhraseFromEntropyHex(OTHER_ENTROPY)).status,
    ).toBe('decrypt_failed');
    expect(verifyBackupBundle(created.bundleJson, 'not a real phrase at all here').status).toBe(
      'invalid_phrase',
    );
    expect(verifyBackupBundle('{ "format": "nope" }', phrase).status).toBe('corrupt');
    expect(() => openBackupBundle('{ "format": "nope" }', phrase)).toThrow();
  });

  it('loses only the damaged household, not the whole file', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupBundle(
      [section('hh_a', 'Main'), section('hh_b', 'Holiday')],
      { phrase },
    );

    const damaged = JSON.parse(created.bundleJson) as BackupBundleDocument;
    // Flip a byte inside the second section's ciphertext.
    const ct = damaged.households[1].ciphertextB64;
    damaged.households[1].ciphertextB64 = `${ct.slice(0, 20)}${ct[20] === 'A' ? 'B' : 'A'}${ct.slice(21)}`;

    const verified = verifyBackupBundle(JSON.stringify(damaged), phrase);
    expect(verified.status).toBe('partial');
    expect(verified.households[0].status).toBe('ok');
    expect(verified.households[1].status).toBe('decrypt_failed');
    // The surviving household is still fully restorable.
    expect(verified.households[0].payload?.householdName).toBe('Main');
  });

  it('refuses a section moved between households', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const created = createBackupBundle(
      [section('hh_a', 'Main'), section('hh_b', 'Holiday')],
      { phrase },
    );

    // Relabel hh_b's ciphertext as hh_a's: the AAD binds the id, so this must
    // fail rather than restore Holiday's rows into Main.
    const tampered = JSON.parse(created.bundleJson) as BackupBundleDocument;
    tampered.households[1].householdId = 'hh_a';
    const verified = verifyBackupBundle(JSON.stringify(tampered), phrase);
    expect(verified.households[1].status).toBe('decrypt_failed');
  });

  it('refuses to seal nothing, or the same household twice', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    expect(() => createBackupBundle([], { phrase })).toThrow(/no households/);
    expect(() =>
      createBackupBundle([section('hh_a', 'Main'), section('hh_a', 'Main again')], { phrase }),
    ).toThrow(/duplicate household/);
  });

  it('tells a v2 archive, a v3 bundle and junk apart without a phrase', SLOW, () => {
    const phrase = recoveryPhraseFromEntropyHex(ENTROPY);
    const archive = createBackupArchive(
      {
        snapshotJson: '{}',
        householdId: 'hh_a',
        deviceId: 'dev_test',
        keyEpoch: 1,
        createdAt: '2026-08-29T12:00:00.000Z',
      },
      { phrase },
    );
    const bundle = createBackupBundle([section('hh_a', 'Main')], { phrase });

    expect(readBackupFileKind(archive.archiveJson)).toBe('archive');
    expect(readBackupFileKind(bundle.bundleJson)).toBe('bundle');
    expect(readBackupFileKind('{"format":"symply-local-first-backup","version":99}')).toBe(
      'unknown',
    );
    expect(readBackupFileKind('not json')).toBe('unknown');
  });
});
