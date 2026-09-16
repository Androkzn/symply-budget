import * as SecureStore from 'expo-secure-store';

import {
  forgetRememberedRestorePhrase,
  getRememberedRestorePhrase,
  rememberRestorePhrase,
} from '../backup/restorePhraseMemory';

/**
 * The last recovery phrase that actually opened an archive on this device.
 *
 * Kept so a second restore does not re-ask for words the member already proved
 * they hold, and keyed by home because each home's archives are sealed under
 * their own (Q15). One device-wide memory would pre-fill the restore field with
 * some other home's words: the member accepts the offered default, waits out a
 * full Argon2 pass, and is told it is wrong.
 *
 * The engine is mocked rather than opened — this suite is about the keychain
 * contract, and a real session would make the key depend on a minted id.
 */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const HOUSE_A = 'hh_local_maple';
const HOUSE_B = 'hh_local_cabin';

/** Mutable rather than spied — see the note in houseRestorePhraseMemory.test.ts. */
let mockActiveHouseholdId: string | null = 'hh_local_maple';
jest.mock('../engine', () => ({
  getActiveHouseholdId: () => mockActiveHouseholdId,
}));

/** SecureStore rejects `:`, so this folder's usual separator is `.` here. */
const KEY_A = `house.backup.lastRestorePhrase.${HOUSE_A}`;
const KEY_B = `house.backup.lastRestorePhrase.${HOUSE_B}`;

const mockStore = SecureStore as jest.Mocked<typeof SecureStore>;

// Real BIP39 mnemonics — the module validates, so placeholders would be dropped.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
// Wordlist words, deliberately bad checksum — what a typo actually looks like.
const INVALID =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveHouseholdId = HOUSE_A;
});

describe('the remembered restore phrase', () => {
  it('returns nothing before any restore has succeeded', async () => {
    mockStore.getItemAsync.mockResolvedValue(null);
    await expect(getRememberedRestorePhrase()).resolves.toBeNull();
  });

  it('round-trips a phrase that opened an archive', async () => {
    await rememberRestorePhrase(PHRASE);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(KEY_A, PHRASE);

    mockStore.getItemAsync.mockResolvedValue(PHRASE);
    await expect(getRememberedRestorePhrase()).resolves.toBe(PHRASE);
  });

  it('normalises case and spacing before storing', async () => {
    await rememberRestorePhrase(`  ${PHRASE.toUpperCase().replace(/ /g, '   ')}  `);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(KEY_A, PHRASE);
  });

  it('refuses to store a phrase that is not a valid mnemonic', async () => {
    // Only ever written after a successful decrypt, so a typo can never become
    // the remembered default.
    await rememberRestorePhrase(INVALID);
    expect(mockStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('ignores a stored value that no longer validates', async () => {
    // Worse than none: it would pre-fill a field the member then trusts.
    mockStore.getItemAsync.mockResolvedValue(INVALID);
    await expect(getRememberedRestorePhrase()).resolves.toBeNull();
  });

  it('keys the memory per home, so the cabin is never offered the house’s words', async () => {
    await rememberRestorePhrase(PHRASE, HOUSE_B);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(KEY_B, PHRASE);

    mockStore.getItemAsync.mockImplementation(async (key: string) =>
      key === KEY_B ? PHRASE : null,
    );
    await expect(getRememberedRestorePhrase(HOUSE_B)).resolves.toBe(PHRASE);
    // A home with no remembered phrase correctly asks rather than guessing.
    await expect(getRememberedRestorePhrase(HOUSE_A)).resolves.toBeNull();
  });

  it('folds a key segment the keychain would reject rather than throwing', async () => {
    // SecureStore rejects anything outside [A-Za-z0-9._-] — it throws rather
    // than degrading — and a server-issued id need not fit.
    await rememberRestorePhrase(PHRASE, 'hh:local/weird id');
    const [key] = mockStore.setItemAsync.mock.calls[0];
    expect(key).toBe('house.backup.lastRestorePhrase.hh_local_weird_id');
  });

  it('does nothing at all when no home is open', async () => {
    mockActiveHouseholdId = null;

    await rememberRestorePhrase(PHRASE);
    expect(mockStore.setItemAsync).not.toHaveBeenCalled();
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
    expect(mockStore.deleteItemAsync).toHaveBeenCalledWith(KEY_A);
  });
});
