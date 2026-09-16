import { readFileSync } from 'fs';
import { join } from 'path';

import { archiveLocalBudgetPersistence, loadDbKeyHex, saveDbKeyHex } from '../persistence';

const LOCAL_DIR = join(__dirname, '..');

/**
 * Signing in as a different member used to call `clearLocalBudgetPersistence()`,
 * which deletes the SQLite file AND the DEK. One unexpected account switch
 * therefore destroyed every category, expense and budget on the device, with no
 * warning, no confirmation and no export — observed 2026-08-14 as a ledger
 * recreated at 13:28:40 holding nothing but the 10 seed categories.
 *
 * The file move and the per-member SecureStore slot only exist on device
 * (`isJestRuntime()` short-circuits both), so the disk behaviour is pinned
 * against the source — the same approach versionIdentity uses for pbxproj.
 */
describe('ledger archive on account switch', () => {
  it('retires the live DEK so the next member mints a fresh ledger', async () => {
    await saveDbKeyHex('deadbeef');
    expect(await loadDbKeyHex()).toBe('deadbeef');

    await archiveLocalBudgetPersistence('memberA');

    expect(await loadDbKeyHex()).toBeNull();
  });

  it('is safe to run when there is nothing to archive', async () => {
    await expect(archiveLocalBudgetPersistence('nobody')).resolves.toBeNull();
  });

  it('the account-switch branch archives instead of deleting', () => {
    const engine = readFileSync(join(LOCAL_DIR, 'engine.ts'), 'utf8');
    const branch = engine.match(
      /if \(storedMemberId && storedMemberId !== input\.userId\) \{([\s\S]*?)\n {2}\}/,
    );
    expect(branch).not.toBeNull();

    expect(branch![1]).toContain('archiveLocalBudgetPersistence');
    // The regression: a bare clear here shreds the outgoing member's ledger.
    expect(branch![1]).not.toContain('clearLocalBudgetPersistence');
  });

  it('keeps the archived DEK in SecureStore, never on disk beside the ciphertext', () => {
    const persistence = readFileSync(join(LOCAL_DIR, 'persistence.ts'), 'utf8');
    const fn = persistence.match(
      /export async function archiveLocalBudgetPersistence[\s\S]*?\n\}/,
    );
    expect(fn).not.toBeNull();

    // Same storage boundary as the live key — writing it next to the database
    // would make the at-rest encryption pointless.
    expect(fn![0]).toContain('SecureStore.setItemAsync');
    expect(fn![0]).toContain('archivedDekKey');
    expect(fn![0]).not.toMatch(/writeAsStringAsync|documentDirectory/);
  });

  it('namespaces the archived key per member so two switches cannot collide', () => {
    const persistence = readFileSync(join(LOCAL_DIR, 'persistence.ts'), 'utf8');
    expect(persistence).toMatch(/function archivedDekKey\(label: string\)/);
    expect(persistence).toMatch(/budget\.localFirst\.dek\.archived\.\$\{label\}/);
  });

  it('moves the write-ahead siblings too, so the archive is not torn', () => {
    const store = readFileSync(join(LOCAL_DIR, 'budget-local-first-store.ts'), 'utf8');
    const fn = store.match(/export async function archiveBudgetLocalFirstDbFile[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain("'-wal'");
    expect(fn![0]).toContain("'-shm'");
  });
});
