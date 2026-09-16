/**
 * The device's one backup recovery phrase.
 *
 * Backups used to mint twelve fresh words per archive and show them once, so a
 * member who backed up weekly ended up holding a pile of phrases, unable to tell
 * which opened which file — and losing an archive for every slip they mislaid.
 * What is pinned here is the replacement: minted once, kept in the keychain,
 * handed to every backup afterwards, and replaced only when the member asks.
 */
import * as SecureStore from 'expo-secure-store';

import {
  ensureBudgetBackupPhrase,
  getBudgetBackupPhrase,
  perHouseholdFoldCandidates,
  rotateBudgetBackupPhrase,
} from '../backup/backupPhrase';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

/**
 * Mocked rather than driven through a real session: nothing here is about the
 * ledger, and the in-memory engine accumulates households across cases.
 */
const mockActiveHouseholdId = jest.fn<string | null, []>();
const mockHouseholds = jest.fn<{ householdId: string }[], []>();
jest.mock('../engine', () => ({
  getActiveBudgetHouseholdId: () => mockActiveHouseholdId(),
  listLocalBudgetHouseholds: () => mockHouseholds(),
}));

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;

const PHRASE_KEY = 'budget.backup.autoPhrase';

/** A keychain that actually remembers, so "reused" means something. */
function useKeychain(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  mockGet.mockImplementation(async (key: string) => store[key] ?? null);
  mockSet.mockImplementation(async (key: string, value: string) => {
    store[key] = value;
  });
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  useKeychain();
  mockActiveHouseholdId.mockReturnValue(null);
  mockHouseholds.mockReturnValue([]);
});

describe('the device backup phrase', () => {
  it('reports nothing before anything has needed one', async () => {
    expect(await getBudgetBackupPhrase()).toBeNull();
    // Reading must never be a write — a scheduled run asks this question to
    // decide whether it may proceed, and minting behind its back would seal an
    // archive under words nobody has ever seen.
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('mints a valid 12-word phrase on first use and stores it in the keychain', async () => {
    const { phrase, created } = await ensureBudgetBackupPhrase();

    expect(created).toBe(true);
    expect(phrase.split(' ')).toHaveLength(12);
    expect(mockSet).toHaveBeenCalledWith(PHRASE_KEY, phrase);
  });

  it('hands the same phrase back forever after, flagged as not new', async () => {
    const first = await ensureBudgetBackupPhrase();
    mockSet.mockClear();

    const second = await ensureBudgetBackupPhrase();
    const third = await ensureBudgetBackupPhrase();

    expect(second.phrase).toBe(first.phrase);
    expect(third.phrase).toBe(first.phrase);
    // `created: false` is what keeps the sheet from reopening over every backup.
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    // And nothing is rewritten, so no run can quietly retire the words the
    // member wrote down.
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('replaces the phrase only when asked, and the new one sticks', async () => {
    const { phrase: original } = await ensureBudgetBackupPhrase();

    const rotated = await rotateBudgetBackupPhrase();

    expect(rotated).not.toBe(original);
    expect(rotated.split(' ')).toHaveLength(12);
    expect(await getBudgetBackupPhrase()).toBe(rotated);
    // The old words are gone from this device — which is exactly why the screen
    // warns before calling this: archives already written still need them.
    expect((await ensureBudgetBackupPhrase()).phrase).toBe(rotated);
  });

  /**
   * BR-016 briefly kept a phrase per household. Those keys are read once and
   * folded back, active household first — otherwise a member who enabled backups
   * under the old build would be handed a brand-new phrase and every archive
   * they already had would become unopenable.
   */
  it('adopts a per-household phrase left by the BR-016 build', async () => {
    const legacy = 'zebra yankee xray whiskey victor uniform tango sierra romeo quebec papa oscar';
    useKeychain({ [`${PHRASE_KEY}.hh_local_b`]: legacy });
    mockActiveHouseholdId.mockReturnValue('hh_local_b');
    mockHouseholds.mockReturnValue([{ householdId: 'hh_local_a' }, { householdId: 'hh_local_b' }]);

    const { phrase, created } = await ensureBudgetBackupPhrase();

    expect(phrase).toBe(legacy);
    // Adopted, not minted — the archives it sealed stay openable.
    expect(created).toBe(false);
    expect(mockSet).toHaveBeenCalledWith(PHRASE_KEY, legacy);
  });

  it('looks at the active household first when several left a phrase behind', () => {
    mockActiveHouseholdId.mockReturnValue('hh_local_b');
    mockHouseholds.mockReturnValue([{ householdId: 'hh_local_a' }, { householdId: 'hh_local_b' }]);

    // With no single right answer to "what was the device's phrase", the one the
    // member is actually looking at is the least surprising.
    expect(perHouseholdFoldCandidates()).toEqual(['hh_local_b', 'hh_local_a']);
  });

  it('survives a keychain that refuses to be read', async () => {
    mockGet.mockRejectedValue(new Error('device locked'));

    // Null, not a throw: the caller decides what a missing phrase means, and a
    // locked keychain must not take down whatever triggered the backup.
    expect(await getBudgetBackupPhrase()).toBeNull();
  });
});
