import * as FileSystem from 'expo-file-system/legacy';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localWishesApi } from '../wishes/localWishesApi';
import { resolveWishImageUri } from '../wishes/localWishMedia';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
}));

const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
const mockMakeDir = FileSystem.makeDirectoryAsync as jest.Mock;
const mockCopy = FileSystem.copyAsync as jest.Mock;

describe('localWishesApi', () => {
  beforeEach(async () => {
    mockGetInfo.mockResolvedValue({ exists: true });
    mockMakeDir.mockResolvedValue(undefined);
    mockCopy.mockResolvedValue(undefined);
    await openLocalBudgetSessionForTests({ userId: 'user-wish-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('creates a wish and lists it with zero counts', async () => {
    const householdId = getLocalLedger().household.id;
    const wish = await localWishesApi.create(householdId, { title: 'Dream boat' });
    expect(wish.title).toBe('Dream boat');
    expect(wish.created_by).toBe('user-wish-1');

    const listed = await localWishesApi.list(householdId);
    expect(listed).toHaveLength(1);
    expect(listed[0].entry_count).toBe(0);
    expect(listed[0].image_count).toBe(0);
  });

  it('adds note and link entries with rollups and author enrichment', async () => {
    const householdId = getLocalLedger().household.id;
    const wish = await localWishesApi.create(householdId, { title: 'Kitchen reno' });

    await localWishesApi.addEntry(householdId, wish.id, {
      kind: 'note',
      body: 'Love the marble counters',
    });
    await localWishesApi.addEntry(householdId, wish.id, {
      kind: 'link',
      url: 'https://example.com/tile',
      link_title: 'Tile inspo',
      price_cents: 120000,
    });

    const listed = await localWishesApi.list(householdId);
    expect(listed[0].entry_count).toBe(2);
    expect(listed[0].image_count).toBe(0);

    const detail = await localWishesApi.get(householdId, wish.id);
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0].author_id).toBe('user-wish-1');
    expect(detail.entries[0].author_avatar_url).toBeNull();
    expect(detail.created_by_name).toBeNull();
  });

  it('uploads an image locally, attaches it, and sets cover on first image entry', async () => {
    const householdId = getLocalLedger().household.id;
    const wish = await localWishesApi.create(householdId, { title: 'Photo wish' });

    const imageKey = await localWishesApi.uploadImage(householdId, wish.id, {
      uri: 'file:///picked.jpg',
      mimeType: 'image/jpeg',
      width: 100,
      height: 100,
    } as Parameters<typeof localWishesApi.uploadImage>[2]);

    expect(imageKey).toMatch(/^wishes\/local\//);
    expect(mockCopy).toHaveBeenCalled();
    expect(getLocalLedger().wishAttachments).toHaveLength(1);
    expect(resolveWishImageUri(imageKey)).toContain('file:///docs/wish-images/');

    await localWishesApi.addEntry(householdId, wish.id, {
      kind: 'image',
      image_key: imageKey,
      body: 'Found it',
    });

    const listed = await localWishesApi.list(householdId);
    expect(listed[0].image_count).toBe(1);
    expect(listed[0].cover_image_key).toBe(imageKey);
  });

  it('updates, filters by status, and removes a wish', async () => {
    const householdId = getLocalLedger().household.id;
    const wish = await localWishesApi.create(householdId, { title: 'To archive' });

    const updated = await localWishesApi.update(householdId, wish.id, {
      status: 'achieved',
      notes: 'Done',
    });
    expect(updated.status).toBe('achieved');
    expect(updated.notes).toBe('Done');

    const active = await localWishesApi.list(householdId, 'active');
    expect(active).toHaveLength(0);
    const achieved = await localWishesApi.list(householdId, 'achieved');
    expect(achieved).toHaveLength(1);

    await localWishesApi.remove(householdId, wish.id);
    expect(getLocalLedger().wishes).toHaveLength(0);
  });

  it('edits and deletes entries, promoting the next cover image', async () => {
    const householdId = getLocalLedger().household.id;
    const wish = await localWishesApi.create(householdId, { title: 'Covers' });

    const firstKey = await localWishesApi.uploadImage(householdId, wish.id, {
      uri: 'file:///a.jpg',
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
    } as Parameters<typeof localWishesApi.uploadImage>[2]);
    const secondKey = await localWishesApi.uploadImage(householdId, wish.id, {
      uri: 'file:///b.jpg',
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
    } as Parameters<typeof localWishesApi.uploadImage>[2]);

    const first = await localWishesApi.addEntry(householdId, wish.id, {
      kind: 'image',
      image_key: firstKey,
    });
    await localWishesApi.addEntry(householdId, wish.id, {
      kind: 'image',
      image_key: secondKey,
    });

    const note = await localWishesApi.addEntry(householdId, wish.id, {
      kind: 'note',
      body: 'caption',
    });
    const edited = await localWishesApi.updateEntry(householdId, wish.id, note.id, {
      body: 'updated caption',
    });
    expect(edited.body).toBe('updated caption');

    await localWishesApi.deleteEntry(householdId, wish.id, first.id);
    const afterDelete = await localWishesApi.list(householdId);
    expect(afterDelete[0].cover_image_key).toBe(secondKey);
    expect(getLocalLedger().wishAttachments.some((a) => a.key === firstKey)).toBe(false);
  });
});
