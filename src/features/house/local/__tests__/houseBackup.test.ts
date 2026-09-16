/**
 * H9 encrypted backup (plan §10).
 *
 * The archive format, Argon2id derivation and 12-word phrase are the package's
 * and are already covered by Budget's suites over the same code. What is House's
 * and therefore tested here is the multi-property delta:
 *
 *  - **a file may hold several homes, one SECTION each** — House holds 1–3
 *    ledgers with separate HDKs and memberships, and the hazard Q15 named is
 *    mixing them, not co-locating them. So the sectioned shape is pinned here,
 *    and so is the rule that a single-home file still parses;
 *  - **every registered table travels, whatever shape the live object is in** —
 *    a snapshot built by copying can silently lose a table; this one is built by
 *    naming them;
 *  - **blob descriptors travel, blob bytes do not** — the manifest is reported so
 *    a restore can say what it will re-fetch, instead of silently producing rows
 *    whose attachments resolve to nothing;
 *  - **crypto material never reaches archive metadata**.
 *
 * Static imports throughout (plan §6.2).
 */
import {
  HOUSE_ALL_HOMES_ID,
  HOUSE_MULTI_BACKUP_FORMAT,
  HOUSE_MULTI_BACKUP_VERSION,
  aggregateHouseSummaries,
  collectBlobManifest,
  houseBackupFileName,
  houseLedgerSnapshot,
  houseRestoreOutcomeMessage,
  parseHouseBackupSnapshot,
  snapshotFromHouseLedger,
  summarizeHouseLedger,
  type HouseBackupSection,
  type HouseRestoreResult,
} from '../backup/houseBackup';
import { HOUSE_LEDGER_TABLE_NAMES } from '../schema';

import { emptyHouseLedger, taskRow } from './houseLedgerTestKit';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn(),
}));

function ledgerWithBlobs() {
  const ledger = emptyHouseLedger();
  ledger.tasks = [
    taskRow('t1', {
      title: 'Roof inspection',
      photos: [
        { id: 'p1', blobId: 'blob_aaa', sha256: 'a'.repeat(64), bytes: 1024, mime: 'image/jpeg' },
        { id: 'p2', blobId: 'blob_bbb', sha256: 'b'.repeat(64), bytes: 2048, mime: 'image/png' },
      ],
    }),
  ] as typeof ledger.tasks;
  ledger.appliances = [
    {
      id: 'a1',
      manual: { blobId: 'blob_ccc', sha256: 'c'.repeat(64), bytes: 4096, mime: 'application/pdf' },
    },
  ] as unknown as typeof ledger.appliances;
  return ledger;
}

describe('snapshotFromHouseLedger', () => {
  it('never puts crypto material in the snapshot', () => {
    const ledger = emptyHouseLedger();
    ledger.crypto = {
      signingPrivateKeyHex: 'dead',
      signingPublicKeyHex: 'beef',
      agreementPrivateKeyHex: 'cafe',
      agreementPublicKeyHex: 'f00d',
      hdkHex: 'aaaabbbb',
      keyEpoch: 1,
    };

    const json = snapshotFromHouseLedger(ledger);

    // Keys belong inside the AEAD ciphertext only. Leaking the HDK into the
    // snapshot would make the recovery phrase pointless.
    expect(json).not.toContain('aaaabbbb');
    expect(json).not.toContain('signingPrivateKeyHex');
    expect(JSON.parse(json).crypto).toBeUndefined();
  });

  it('drops the op log — restore merges tables through LWW, it does not replay', () => {
    const ledger = emptyHouseLedger();
    ledger.ops = [{ opId: 'op1' }] as unknown as typeof ledger.ops;
    expect(JSON.parse(snapshotFromHouseLedger(ledger)).ops).toEqual([]);
  });

  it('keeps every ledger table', () => {
    const parsed = JSON.parse(snapshotFromHouseLedger(emptyHouseLedger()));
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      expect(parsed[table]).toBeDefined();
    }
  });

  /**
   * The completeness guarantee, and the reason the snapshot is built by NAMING
   * the tables rather than by copying the ledger and deleting from it.
   *
   * A ledger object that has lost an array — a partially hydrated session, a
   * shape written by an older build, a table added to the registry ahead of the
   * interface — would otherwise produce an archive with that table simply
   * absent, and a restore of it would silently put back everything except one
   * kind of row. Naming them turns that into an empty array, which restores to
   * "nothing to merge" instead of "nothing to see".
   */
  it('emits every registered table even when the live ledger is missing one', () => {
    const ledger = emptyHouseLedger();
    delete (ledger as unknown as Record<string, unknown>).appliances;
    (ledger as unknown as Record<string, unknown>).tasks = null;

    const parsed = JSON.parse(snapshotFromHouseLedger(ledger));

    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      expect(Array.isArray(parsed[table])).toBe(true);
    }
    expect(parsed.appliances).toEqual([]);
    expect(parsed.tasks).toEqual([]);
  });

  it('carries the identity a restore needs to place the rows', () => {
    // Without `household` there is nothing to check the archive against, and
    // `restoreHouseBackup` cannot tell the cabin's file from the house's.
    const parsed = JSON.parse(snapshotFromHouseLedger(emptyHouseLedger()));
    expect(parsed.household).toMatchObject({ id: 'hh_test', name: 'Shared home' });
    expect(parsed.memberId).toBe('member-local');
    expect(parsed.deviceId).toBe('dev-local');
    expect(parsed.version).toBe(1);
  });

  it('leaves merge watermarks and settled conflicts behind', () => {
    // `lww` describes the device that wrote it, and restore deliberately stamps
    // everything `RESTORE_HLC` so live writes win (D-20) — carrying watermarks
    // in would either be ignored or, if honoured, let a backup beat newer work.
    // `conflicts` is session state; restoring it would re-raise banners for
    // merges the member already settled.
    const ledger = emptyHouseLedger();
    ledger.lww = { tasks: { t1: {} } } as unknown as typeof ledger.lww;
    ledger.conflicts = [{ table: 'tasks' }] as unknown as typeof ledger.conflicts;

    const parsed = JSON.parse(snapshotFromHouseLedger(ledger));

    expect(parsed.lww).toBeUndefined();
    expect(parsed.conflicts).toBeUndefined();
  });
});

describe('collectBlobManifest — descriptors travel, bytes do not (Q15)', () => {
  it('finds descriptors nested anywhere in a row, not just in named columns', () => {
    // Blob-bearing columns span 25 tables across the wave plan; a hand-kept
    // column list would silently miss the next one, so the walk is by shape.
    const manifest = collectBlobManifest(ledgerWithBlobs());
    expect(manifest.map((b) => b.blobId).sort()).toEqual(['blob_aaa', 'blob_bbb', 'blob_ccc']);
  });

  it('carries the size and mime a restore screen needs to explain the re-fetch', () => {
    const manifest = collectBlobManifest(ledgerWithBlobs());
    expect(manifest.find((b) => b.blobId === 'blob_ccc')).toMatchObject({
      bytes: 4096,
      mime: 'application/pdf',
      table: 'appliances',
    });
  });

  it('deduplicates a blob referenced from more than one row', () => {
    const ledger = ledgerWithBlobs();
    ledger.tasks = [
      ...ledger.tasks,
      taskRow('t2', {
        photos: [
          { id: 'p3', blobId: 'blob_aaa', sha256: 'a'.repeat(64), bytes: 1024, mime: 'image/jpeg' },
        ],
      }),
    ] as typeof ledger.tasks;
    expect(collectBlobManifest(ledger).filter((b) => b.blobId === 'blob_aaa')).toHaveLength(1);
  });

  it('is empty for a ledger with no attachments', () => {
    expect(collectBlobManifest(emptyHouseLedger())).toEqual([]);
  });

  it('ignores a shape that merely has a blobId but no content hash', () => {
    // Guards against sweeping up unrelated rows: a descriptor is defined by
    // carrying its integrity hash, which is what makes the bytes verifiable.
    const ledger = emptyHouseLedger();
    ledger.tasks = [taskRow('t1', { photos: [{ id: 'p', blobId: 'blob_x' }] })] as typeof ledger.tasks;
    expect(collectBlobManifest(ledger)).toEqual([]);
  });

  it('does not recurse without bound on a deeply nested row', () => {
    const ledger = emptyHouseLedger();
    let deep: Record<string, unknown> = { blobId: 'blob_deep', sha256: 'd'.repeat(64) };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    ledger.tasks = [taskRow('t1', { extra: deep })] as typeof ledger.tasks;
    expect(() => collectBlobManifest(ledger)).not.toThrow();
  });
});

describe('summarizeHouseLedger', () => {
  it('reports per-table counts and a total the restore screen can show', () => {
    const summary = summarizeHouseLedger(ledgerWithBlobs());
    expect(summary.tableCounts.tasks).toBe(1);
    expect(summary.tableCounts.appliances).toBe(1);
    expect(summary.totalRows).toBe(2);
  });

  it('counts every ledger table, including the empty ones', () => {
    const summary = summarizeHouseLedger(emptyHouseLedger());
    expect(Object.keys(summary.tableCounts).sort()).toEqual([...HOUSE_LEDGER_TABLE_NAMES].sort());
    expect(summary.totalRows).toBe(0);
  });

  it('identifies the property, because an archive is per property (Q15)', () => {
    const summary = summarizeHouseLedger(emptyHouseLedger());
    expect(summary.householdId).toBe('hh_test');
    expect(summary.propertyName).toBe('Shared home');
  });

  it('surfaces the blob manifest rather than hiding the missing bytes', () => {
    expect(summarizeHouseLedger(ledgerWithBlobs()).blobManifest).toHaveLength(3);
  });
});

// --- The multi-home file ------------------------------------------------------

/** A section as `buildHouseBackupArchive` writes one, without opening a session. */
function sectionFor(householdId: string, name: string, titles: string[] = []): HouseBackupSection {
  const ledger = emptyHouseLedger(householdId, 'member-local', 'dev-local');
  ledger.household.name = name;
  ledger.tasks = titles.map((title, index) =>
    taskRow(`${householdId}-task-${index}`, { title, household_id: householdId }),
  ) as typeof ledger.tasks;
  return {
    householdId,
    propertyName: name,
    memberId: ledger.memberId,
    deviceId: ledger.deviceId,
    keyEpoch: 1,
    awaitingEnrolment: false,
    summary: summarizeHouseLedger(ledger),
    ledger: houseLedgerSnapshot(ledger),
  };
}

function multiSnapshot(sections: HouseBackupSection[]): string {
  return JSON.stringify({
    format: HOUSE_MULTI_BACKUP_FORMAT,
    version: HOUSE_MULTI_BACKUP_VERSION,
    createdAt: '2026-08-29T09:15:00.000Z',
    deviceId: 'dev-local',
    households: sections,
  });
}

describe('parseHouseBackupSnapshot — one file, several homes, kept apart', () => {
  it('reads a multi-home file as one section per home, in file order', () => {
    const parsed = parseHouseBackupSnapshot(
      multiSnapshot([
        sectionFor('hh_maple', 'Maple Street', ['Roof inspection']),
        sectionFor('hh_cabin', 'Lake Cabin', ['Dock repair', 'Wood store']),
      ]),
    );

    expect(parsed.scope).toBe('multi');
    expect(parsed.sections.map((section) => section.householdId)).toEqual(['hh_maple', 'hh_cabin']);
    // The whole point of the sectioned shape: each home's rows stay that home's.
    expect(parsed.sections[0].summary.tableCounts.tasks).toBe(1);
    expect(parsed.sections[1].summary.tableCounts.tasks).toBe(2);
  });

  it('still reads a single-home file, which is every archive written before this', () => {
    // Backwards compatibility is not optional here: a member's only backup may
    // predate the sectioned format by months, and it is the file they reach for
    // on the worst day they will have with this app.
    const ledger = emptyHouseLedger('hh_maple', 'member-local', 'dev-local');
    ledger.tasks = [taskRow('t1', { title: 'Roof inspection' })] as typeof ledger.tasks;

    const parsed = parseHouseBackupSnapshot(snapshotFromHouseLedger(ledger));

    expect(parsed.scope).toBe('single');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].householdId).toBe('hh_maple');
    expect(parsed.sections[0].summary.tableCounts.tasks).toBe(1);
  });

  it('refuses a file that is neither, rather than restoring nothing and claiming success', () => {
    expect(() => parseHouseBackupSnapshot('not json at all')).toThrow(/damaged/i);
    expect(() => parseHouseBackupSnapshot('{"tasks":[]}')).toThrow(/damaged|not a Symply/i);
  });

  it('refuses a multi-home file with no homes in it', () => {
    expect(() => parseHouseBackupSnapshot(multiSnapshot([]))).toThrow(/no homes/i);
  });

  it('drops a section with no ledger instead of restoring an empty home over a real one', () => {
    const broken = JSON.parse(multiSnapshot([sectionFor('hh_maple', 'Maple Street')]));
    broken.households.push({ householdId: 'hh_cabin', propertyName: 'Lake Cabin' });

    const parsed = parseHouseBackupSnapshot(JSON.stringify(broken));

    expect(parsed.sections.map((section) => section.householdId)).toEqual(['hh_maple']);
  });
});

describe('aggregateHouseSummaries', () => {
  it('adds the homes up without losing which home is which', () => {
    const combined = aggregateHouseSummaries([
      sectionFor('hh_maple', 'Maple Street', ['a']).summary,
      sectionFor('hh_cabin', 'Lake Cabin', ['b', 'c']).summary,
    ]);

    expect(combined.householdId).toBe(HOUSE_ALL_HOMES_ID);
    expect(combined.totalRows).toBe(3);
    expect(combined.tableCounts.tasks).toBe(3);
    // The split survives the sum — "4,812 rows" over three homes is a number
    // nobody can act on, and "is the cabin in here" is the actual question.
    expect(combined.households?.map((home) => home.propertyName)).toEqual([
      'Maple Street',
      'Lake Cabin',
    ]);
  });

  it('counts an attachment once even if two homes referenced it', () => {
    const a = sectionFor('hh_maple', 'Maple Street').summary;
    const b = sectionFor('hh_cabin', 'Lake Cabin').summary;
    const blob = { table: 'tasks', blobId: 'blob_shared', bytes: 10, mime: 'image/jpeg' };
    a.blobManifest = [blob];
    b.blobManifest = [blob];

    expect(aggregateHouseSummaries([a, b]).blobManifest).toHaveLength(1);
  });
});

describe('houseRestoreOutcomeMessage', () => {
  const outcome = (households: HouseRestoreResult['households']): HouseRestoreResult => ({
    householdId: households[0].householdId,
    summary: summarizeHouseLedger(emptyHouseLedger()),
    blobManifest: [],
    households,
  });

  it('reads as it always did for one home', () => {
    const summary = summarizeHouseLedger(emptyHouseLedger());
    expect(
      houseRestoreOutcomeMessage(
        outcome([
          {
            householdId: 'hh_test',
            propertyName: 'Shared home',
            status: 'restored',
            message: 'ok',
            summary,
          },
        ]),
      ),
    ).toBe('Shared home is back on this device.');
  });

  /**
   * The sentence this whole per-section design exists to make possible. "3 homes
   * restored" over a file that silently skipped the cabin is the failure mode
   * the format prevents, and it must not be reintroduced in the summary at the
   * end of it.
   */
  it('names a home the file could not put back rather than averaging it away', () => {
    const message = houseRestoreOutcomeMessage(
      outcome([
        { householdId: 'hh_maple', propertyName: 'Maple Street', status: 'restored', message: 'ok' },
        { householdId: 'hh_barn', propertyName: 'The Barn', status: 'restored', message: 'ok' },
        {
          householdId: 'hh_cabin',
          propertyName: 'Lake Cabin',
          status: 'not_on_device',
          message: 'not here',
        },
      ]),
    );

    expect(message).toBe(
      '2 homes are back on this device — Lake Cabin could not be restored.',
    );
  });

  it('does not scold about a home the member deliberately left out', () => {
    // Narrowing the file to one home is a choice, not a failure.
    const message = houseRestoreOutcomeMessage(
      outcome([
        { householdId: 'hh_maple', propertyName: 'Maple Street', status: 'restored', message: 'ok' },
        {
          householdId: 'hh_cabin',
          propertyName: 'Lake Cabin',
          status: 'not_selected',
          message: 'left alone',
        },
      ]),
    );

    expect(message).toBe('Maple Street is back on this device.');
  });
});

describe('archive naming (H5 multi-property)', () => {
  it('names the property so three homes give three distinguishable files', () => {
    expect(houseBackupFileName('Lakeside Cabin', '2026-08-13')).toBe(
      'symply-house-lakeside-cabin-2026-08-13.backup.json',
    );
  });

  it('falls back when the property name has nothing usable', () => {
    expect(houseBackupFileName('***', '2026-08-13')).toBe(
      'symply-house-home-2026-08-13.backup.json',
    );
  });

  it('bounds a very long property name', () => {
    expect(houseBackupFileName('x'.repeat(300), '2026-08-13').length).toBeLessThan(90);
  });
});
