/**
 * Wishes API layer — CRUD, the entry feed, and image upload.
 *
 * Mocks the axios client so every test is pure logic — no network, no auth
 * store, no native modules. Asserts each helper builds the right URL, passes
 * the right params/payload, and unwraps the response correctly.
 */

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  api: {
    upload: jest.fn(),
  },
}));

import { api, apiClient } from '../client';
import { wishesApi } from '../wishes';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPatch = apiClient.patch as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;
const mockUpload = (api as unknown as { upload: jest.Mock }).upload;

const HID = 'hh_test_01';
const WID = 'wish_01';
const base = `/households/${HID}/wishes`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('wishesApi.list', () => {
  it('GETs the wishes base with no params by default and unwraps `wishes`', async () => {
    const wishes = [{ id: WID, title: 'Buy a boat' }];
    mockGet.mockResolvedValueOnce({ data: { wishes } });
    const result = await wishesApi.list(HID);
    expect(mockGet).toHaveBeenCalledWith(base, { params: undefined });
    expect(result).toEqual(wishes);
  });

  it('passes a status filter as a query param', async () => {
    mockGet.mockResolvedValueOnce({ data: { wishes: [] } });
    await wishesApi.list(HID, 'achieved');
    expect(mockGet).toHaveBeenCalledWith(base, { params: { status: 'achieved' } });
  });
});

describe('wishesApi.get', () => {
  it('GETs a single wish and unwraps `wish`', async () => {
    const wish = { id: WID, title: 'Buy a boat', entries: [] };
    mockGet.mockResolvedValueOnce({ data: { wish } });
    const result = await wishesApi.get(HID, WID);
    expect(mockGet).toHaveBeenCalledWith(`${base}/${WID}`);
    expect(result).toEqual(wish);
  });
});

describe('wishesApi.create', () => {
  it('POSTs the create payload and unwraps `wish`', async () => {
    const payload = { title: 'Buy a boat', estimated_cost_cents: 5000000 };
    const wish = { id: WID, ...payload };
    mockPost.mockResolvedValueOnce({ data: { wish } });
    const result = await wishesApi.create(HID, payload);
    expect(mockPost).toHaveBeenCalledWith(base, payload);
    expect(result).toEqual(wish);
  });
});

describe('wishesApi.update', () => {
  it('PATCHes the wish and unwraps `wish`', async () => {
    const patch = { status: 'achieved' as const };
    mockPatch.mockResolvedValueOnce({ data: { wish: { id: WID, status: 'achieved' } } });
    const result = await wishesApi.update(HID, WID, patch);
    expect(mockPatch).toHaveBeenCalledWith(`${base}/${WID}`, patch);
    expect(result).toEqual({ id: WID, status: 'achieved' });
  });
});

describe('wishesApi.remove', () => {
  it('DELETEs the wish', async () => {
    mockDelete.mockResolvedValueOnce({ status: 204 });
    await wishesApi.remove(HID, WID);
    expect(mockDelete).toHaveBeenCalledWith(`${base}/${WID}`);
  });
});

describe('wishesApi.addEntry', () => {
  it('POSTs a note entry to /entries and unwraps `entry`', async () => {
    const payload = { kind: 'note' as const, body: 'Found the perfect one' };
    mockPost.mockResolvedValueOnce({ data: { entry: { id: 'e1', ...payload } } });
    const result = await wishesApi.addEntry(HID, WID, payload);
    expect(mockPost).toHaveBeenCalledWith(`${base}/${WID}/entries`, payload);
    expect(result).toEqual({ id: 'e1', kind: 'note', body: 'Found the perfect one' });
  });

  it('POSTs a link entry with title + price', async () => {
    const payload = {
      kind: 'link' as const,
      url: 'https://example.com/boat',
      link_title: 'The one',
      price_cents: 4200000,
    };
    mockPost.mockResolvedValueOnce({ data: { entry: { id: 'e2', ...payload } } });
    await wishesApi.addEntry(HID, WID, payload);
    expect(mockPost).toHaveBeenCalledWith(`${base}/${WID}/entries`, payload);
  });

  it('POSTs a reply (parent_entry_id) entry', async () => {
    const payload = { kind: 'note' as const, body: 'Love it', parent_entry_id: 'e-parent' };
    mockPost.mockResolvedValueOnce({ data: { entry: { id: 'e3', ...payload } } });
    await wishesApi.addEntry(HID, WID, payload);
    expect(mockPost).toHaveBeenCalledWith(`${base}/${WID}/entries`, payload);
  });
});

describe('wishesApi.updateEntry', () => {
  it('PATCHes an entry and unwraps `entry`', async () => {
    const patch = { body: 'edited' };
    mockPatch.mockResolvedValueOnce({ data: { entry: { id: 'e1', body: 'edited' } } });
    const result = await wishesApi.updateEntry(HID, WID, 'e1', patch);
    expect(mockPatch).toHaveBeenCalledWith(`${base}/${WID}/entries/e1`, patch);
    expect(result).toEqual({ id: 'e1', body: 'edited' });
  });
});

describe('wishesApi.deleteEntry', () => {
  it('DELETEs a single entry under the wish', async () => {
    mockDelete.mockResolvedValueOnce({ status: 204 });
    await wishesApi.deleteEntry(HID, WID, 'e1');
    expect(mockDelete).toHaveBeenCalledWith(`${base}/${WID}/entries/e1`);
  });
});

describe('wishesApi.uploadImage', () => {
  it('uploads multipart FormData to /image via api.upload and unwraps `image_key`', async () => {
    mockUpload.mockResolvedValueOnce({ image_key: 'wishes/hh/w/img.jpg' });
    const asset = {
      uri: 'file:///photo.jpg',
      mimeType: 'image/jpeg',
      width: 100,
      height: 100,
    } as unknown as Parameters<typeof wishesApi.uploadImage>[2];

    const key = await wishesApi.uploadImage(HID, WID, asset);

    const [url, body] = mockUpload.mock.calls[0];
    expect(url).toBe(`${base}/${WID}/image`);
    expect(body).toBeInstanceOf(FormData);
    expect(key).toBe('wishes/hh/w/img.jpg');
  });
});
