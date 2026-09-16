/**
 * The home photo travels, or the property only half-syncs.
 *
 * `uploadPhoto` threw "Home photos sync in a later update" long after H6 had
 * shipped — `localTasksApi`, `localAppliancesApi` and `localHomeProjectsApi`
 * were all sealing bytes through the same channel — so a member editing a
 * property got an Alert titled **Error** over a save that had otherwise worked,
 * and the one thing on the property that could not reach another member was the
 * picture of it.
 *
 * What is pinned here is the shape of the fix rather than the crypto:
 *
 *  1. the descriptor lands **in the ledger row**, which is what makes it travel
 *     — a peer that syncs `households` gets it and can open the bytes;
 *  2. `photo_key` takes the synthetic `lf-blob/` form, because the DTO requires
 *     a key and there is no R2 object to name;
 *  3. both fields move **together**, on every path — a key without a descriptor
 *     is a receipt for bytes nothing can open, and a descriptor without a key
 *     breaks the DTO;
 *  4. replacing or deleting a photo **drops the old bytes**, so a member who
 *     re-crops the same picture four times does not leave four sealed copies
 *     against the household's quota.
 *
 * The blob channel itself is doubled: it reaches the network, and `houseBlobStore`
 * has its own suite. What matters here is what the ledger ends up holding.
 */
const mockUploadHouseBlob = jest.fn();
const mockDeleteHouseBlob = jest.fn(async () => undefined);

jest.mock('../blobs', () => {
  const actual = jest.requireActual('../blobs');
  return {
    ...actual,
    uploadHouseBlob: (...args: unknown[]) => mockUploadHouseBlob(...(args as [])),
    deleteHouseBlob: (...args: unknown[]) => mockDeleteHouseBlob(...(args as [])),
  };
});

import {
  closeLocalHouseSession,
  getLocalHouseLedgerFor,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { localHouseholdsApi } from '../localHouseholdsApi';

const USER = 'user-home-photo';

/** What `uploadHouseBlob` hands back — content-derived, device-independent. */
function descriptor(blobId: string) {
  return {
    blobId,
    mime: 'image/jpeg',
    bytes: 204_800,
    sha256: `sha-${blobId}`,
    chunkCount: 1,
    keyEpoch: 1,
  };
}

async function oneProperty(): Promise<string> {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
  return ledger.household.id;
}

beforeEach(() => {
  mockUploadHouseBlob.mockReset();
  mockDeleteHouseBlob.mockReset();
  mockDeleteHouseBlob.mockResolvedValue(undefined);
  mockUploadHouseBlob.mockResolvedValue(descriptor('blob_first'));
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('a home photo is sealed to the household and written to the row', () => {
  it('stores the descriptor AND the synthetic key, in the ledger', async () => {
    const householdId = await oneProperty();

    const result = await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/home.jpg');

    expect(result).toEqual({ success: true, image_key: 'lf-blob/blob_first' });
    const row = (await getLocalHouseLedgerFor(householdId)).household;
    // The descriptor is the half that makes the picture reachable by a peer.
    expect(row.photo_blob).toEqual(descriptor('blob_first'));
    // The key is the half the DTO requires, in the namespace that says the bytes
    // are NOT at /files/<key>.
    expect(row.photo_key).toBe('lf-blob/blob_first');
  });

  it('seals to the property named, not to whichever is active', async () => {
    const householdId = await oneProperty();

    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/home.jpg', 'image/png');

    expect(mockUploadHouseBlob).toHaveBeenCalledWith({
      sourceUri: 'file:///tmp/home.jpg',
      mime: 'image/png',
      householdId,
    });
  });

  it('survives a close and reopen — it is a ledger row, not a local binding', async () => {
    // The same proof the other property fields get: a value that only lived in
    // the in-memory binding would converge on nobody.
    const householdId = await oneProperty();
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/home.jpg');

    await closeLocalHouseSession();
    await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });

    const row = (await getLocalHouseLedgerFor(householdId)).household;
    expect(row.photo_blob?.blobId).toBe('blob_first');
    expect(row.photo_key).toBe('lf-blob/blob_first');
  });
});

describe('replacing a photo does not leave the old bytes behind', () => {
  it('drops the previous blob once the new row is written', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/one.jpg');

    mockUploadHouseBlob.mockResolvedValue(descriptor('blob_second'));
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/two.jpg');

    expect(mockDeleteHouseBlob).toHaveBeenCalledWith('blob_first', householdId);
    const row = (await getLocalHouseLedgerFor(householdId)).household;
    expect(row.photo_blob?.blobId).toBe('blob_second');
  });

  it('keeps the photo when the same bytes are re-uploaded under one id', async () => {
    // A resumed upload returns the SAME descriptor. Deleting on that would erase
    // the picture the row is about to point at.
    const householdId = await oneProperty();
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/one.jpg');
    mockDeleteHouseBlob.mockClear();

    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/one.jpg');

    expect(mockDeleteHouseBlob).not.toHaveBeenCalled();
  });

  it('still writes the row when the old bytes cannot be deleted', async () => {
    // Offline. The member's new photo must land regardless — an orphan on the
    // relay costs quota, a failed save costs them the picture.
    const householdId = await oneProperty();
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/one.jpg');
    mockDeleteHouseBlob.mockRejectedValue(new Error('offline'));
    mockUploadHouseBlob.mockResolvedValue(descriptor('blob_second'));

    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/two.jpg');

    expect((await getLocalHouseLedgerFor(householdId)).household.photo_blob?.blobId).toBe(
      'blob_second',
    );
  });
});

describe('deleting a photo clears both halves', () => {
  it('clears the key and the descriptor in one op, and drops the bytes', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/home.jpg');

    await localHouseholdsApi.deletePhoto(householdId);

    const row = (await getLocalHouseLedgerFor(householdId)).household;
    // Both. A peer left holding the descriptor would keep rendering the picture
    // the owner just removed.
    expect(row.photo_key).toBeNull();
    expect(row.photo_blob ?? null).toBeNull();
    expect(mockDeleteHouseBlob).toHaveBeenCalledWith('blob_first', householdId);
  });

  it('is a no-op on the blob channel for a property that never had a photo', async () => {
    const householdId = await oneProperty();

    await localHouseholdsApi.deletePhoto(householdId);

    expect(mockDeleteHouseBlob).not.toHaveBeenCalled();
    expect((await getLocalHouseLedgerFor(householdId)).household.photo_key).toBeNull();
  });

  it('still clears the row when the bytes cannot be deleted', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.uploadPhoto(householdId, 'file:///tmp/home.jpg');
    mockDeleteHouseBlob.mockRejectedValue(new Error('offline'));

    await localHouseholdsApi.deletePhoto(householdId);

    expect((await getLocalHouseLedgerFor(householdId)).household.photo_key).toBeNull();
  });
});
