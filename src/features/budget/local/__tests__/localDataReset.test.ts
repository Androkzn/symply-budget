import { readFileSync } from 'fs';
import { join } from 'path';

const LOCAL_DIR = join(__dirname, '..');

/** Ordered log of the side effects an erase performs, in the order it performs them. */
const calls: string[] = [];

jest.mock('../engine', () => ({
  resetLocalBudgetSession: jest.fn(async () => {
    calls.push('resetSession');
  }),
}));

jest.mock('../ensureSession', () => ({
  ensureBudgetLocalSession: jest.fn(async () => {
    calls.push('ensureSession');
  }),
}));

const mockPurge = jest.fn(async () => {
  calls.push('purgeArchives');
  return { removed: 2, bytesFreed: 3 * 1024 * 1024 };
});

jest.mock('../persistence', () => ({
  listArchivedLocalBudgetLedgers: jest.fn(async () => [
    { label: 'memberA', sizeBytes: 2 * 1024 * 1024, archivedAt: '2026-08-01T10:00:00.000Z' },
    { label: 'memberB', sizeBytes: 1 * 1024 * 1024, archivedAt: '2026-07-01T10:00:00.000Z' },
  ]),
  purgeArchivedLocalBudgetLedgers: (...args: unknown[]) => mockPurge(...(args as [])),
}));

const mockRemoveItem = jest.fn(async (key: string) => {
  calls.push(`removeItem:${key}`);
});

jest.mock('@services/storage', () => ({
  asyncStorage: { removeItem: (key: string) => mockRemoveItem(key) },
  storageHelpers: { getObject: jest.fn(), setObject: jest.fn() },
}));

const mockStoreReset = jest.fn(() => {
  calls.push('budgetStoreReset');
});

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: { getState: () => ({ reset: mockStoreReset }) },
}));

import {
  cleanUpPreviousLocalBudgetData,
  eraseLocalBudgetData,
  getPreviousLocalBudgetData,
} from '../localDataReset';
import { RECEIPT_ALIASES_KEY } from '../receiptAliases';

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
});

describe('Danger Zone — previous local data', () => {
  it('lists what earlier sign-ins left on this device', async () => {
    const previous = await getPreviousLocalBudgetData();
    expect(previous).toHaveLength(2);
    expect(previous[0]).toMatchObject({ label: 'memberA', sizeBytes: 2 * 1024 * 1024 });
  });

  it('cleaning up destroys the retired ledgers and reports what it freed', async () => {
    const result = await cleanUpPreviousLocalBudgetData();
    expect(result).toEqual({ removed: 2, bytesFreed: 3 * 1024 * 1024 });
    expect(calls).toEqual(['purgeArchives']);
  });

  it('cleaning up never touches the live ledger', async () => {
    await cleanUpPreviousLocalBudgetData();
    // The whole point of the first Danger Zone row: it removes other people's
    // leftovers, so it must not close, reset or re-open the current session.
    expect(calls).not.toContain('resetSession');
    expect(calls).not.toContain('ensureSession');
  });
});

describe('Danger Zone — erase this device', () => {
  it('purges leftovers, wipes the ledger, then mints an empty one', async () => {
    await eraseLocalBudgetData();

    expect(calls).toEqual([
      // Archives first: the reset below mints a new ledger, and anything left in
      // the SQLite directory after that is exactly what the member asked to lose.
      'purgeArchives',
      'resetSession',
      `removeItem:${RECEIPT_ALIASES_KEY}`,
      'budgetStoreReset',
      // Last — Budget screens must always find a ledger to render.
      'ensureSession',
    ]);
  });

  it('reports the disk it reclaimed', async () => {
    await expect(eraseLocalBudgetData()).resolves.toEqual({
      removed: 2,
      bytesFreed: 3 * 1024 * 1024,
    });
  });

  it('leaves the backups and the phrases that open them alone', () => {
    const source = readFileSync(join(LOCAL_DIR, 'localDataReset.ts'), 'utf8');

    // Backups are the escape hatch from this very button, and the phrases that
    // open them live behind the same module — reaching into it at all is the
    // regression. (Deleting a phrase is the worst case: archives that exist and
    // can never be decrypted.)
    expect(source).not.toMatch(/^import .*from '\.\/backup\//m);
    expect(source).not.toContain('deleteLocalBudgetBackup(');
    expect(source).not.toContain('deleteCloudBudgetBackup(');
    expect(source).not.toContain('forgetRememberedRestorePhrase(');
  });
});

describe('purging retired ledgers', () => {
  it('destroys the ciphertext AND its Keychain slot', () => {
    const source = readFileSync(join(LOCAL_DIR, 'persistence.ts'), 'utf8');
    const fn = source.match(
      /export async function purgeArchivedLocalBudgetLedgers[\s\S]*?\n\}/,
    );
    expect(fn).not.toBeNull();

    // A leftover SecureStore slot outlives an app uninstall on iOS, so a purge
    // that only deleted files would leave key material behind forever.
    expect(fn![0]).toContain('deleteArchivedBudgetLocalFirstDbFile');
    expect(fn![0]).toContain('SecureStore.deleteItemAsync');
    expect(fn![0]).toContain('archivedDekKey');
  });

  it('folds the write-ahead siblings into one archive, and deletes them with it', () => {
    const store = readFileSync(join(LOCAL_DIR, 'budget-local-first-store.ts'), 'utf8');

    const del = store.match(
      /export async function deleteArchivedBudgetLocalFirstDbFile[\s\S]*?\n\}/,
    );
    expect(del).not.toBeNull();
    expect(del![0]).toContain("'-wal'");
    expect(del![0]).toContain("'-shm'");

    // Listing reports one row per label with the siblings' bytes added in, so
    // "3.4 MB" is what deleting the row actually frees.
    const list = store.match(
      /export async function listArchivedBudgetLocalFirstDbFiles[\s\S]*?\n\}/,
    );
    expect(list).not.toBeNull();
    expect(list![0]).toContain('sizeBytes += size');
  });
});
