import * as SecureStore from 'expo-secure-store';

import {
  forgetRememberedRestorePhrase,
  getRememberedRestorePhrase,
  rememberRestorePhrase,
} from '../backup/restorePhraseMemory';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

/**
 * BR-016 keys the remembered phrase by household. Each household's archives are
 * sealed under their own phrase, so one device-wide memory would pre-fill the
 * restore field with another budget's words — the member accepts the offered
 * default, waits out a full Argon2 pass, and is told it is wrong.
 *
 * The engine is mocked rather than opened: this suite is about the keychain
 * contract, and a real session would make the key depend on a minted id.
 */
const TEST_HOUSEHOLD = 'hh_local_test01';
jest.mock('../engine', () => ({
  getActiveBudgetHouseholdId: jest.fn(() => 'hh_local_test01'),
  listLocalBudgetHouseholds: jest.fn(() => [{ householdId: 'hh_local_test01' }]),
}));

/** SecureStore rejects `:`, so this folder's usual separator is `.` here. */
const KEY = `budget.backup.lastRestorePhrase.${TEST_HOUSEHOLD}`;

const mockStore = SecureStore as jest.Mocked<typeof SecureStore>;

// Real BIP39 mnemonics — the module validates, so placeholders would be dropped.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
// Wordlist words, deliberately bad checksum — what a typo actually looks like.
const INVALID = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

describe('remembered restore phrase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns nothing before any restore has succeeded', async () => {
    mockStore.getItemAsync.mockResolvedValue(null);
    await expect(getRememberedRestorePhrase()).resolves.toBeNull();
  });

  it('round-trips a phrase that opened an archive', async () => {
    await rememberRestorePhrase(PHRASE);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(
      KEY,
      PHRASE,
    );

    mockStore.getItemAsync.mockResolvedValue(PHRASE);
    await expect(getRememberedRestorePhrase()).resolves.toBe(PHRASE);
  });

  it('normalises case and spacing before storing', async () => {
    await rememberRestorePhrase(`  ${PHRASE.toUpperCase().replace(/ /g, '   ')}  `);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(
      KEY,
      PHRASE,
    );
  });

  it('refuses to store a phrase that is not a valid mnemonic', async () => {
    await rememberRestorePhrase(INVALID);
    expect(mockStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('ignores a stored value that no longer validates', async () => {
    mockStore.getItemAsync.mockResolvedValue(INVALID);
    await expect(getRememberedRestorePhrase()).resolves.toBeNull();
  });

  it('never fails a restore when the keychain write throws', async () => {
    mockStore.setItemAsync.mockRejectedValue(new Error('keychain locked'));
    await expect(rememberRestorePhrase(PHRASE)).resolves.toBeUndefined();
  });

  it('reads through a keychain failure as "nothing remembered"', async () => {
    mockStore.getItemAsync.mockRejectedValue(new Error('keychain locked'));
    await expect(getRememberedRestorePhrase()).resolves.toBeNull();
  });

  it('forgets on request', async () => {
    await forgetRememberedRestorePhrase();
    expect(mockStore.deleteItemAsync).toHaveBeenCalledWith(KEY);
  });
});
