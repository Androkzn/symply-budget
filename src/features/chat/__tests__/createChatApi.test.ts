/**
 * budgetChatRoomsApi — the Symply Budget app's independent household-chat API
 * client (separate `budget-chat-rooms` routes / `budget_chat_*` tables). Pins
 * the exact path, verb, body, and the `res.data.<field>` unwrapping for every
 * method, plus the two-step image upload (reserve URL → PUT bytes with progress).
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock('@api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import { createChatApi } from '../createChatApi';

// The shared factory bound to a route segment IS the api client — exercise it
// with the Budget segment so the pinned paths match this suite's expectations.
const budgetChatRoomsApi = createChatApi('budget-chat-rooms');

const HH = 'hh-1';
const BASE = '/households/hh-1/budget-chat-rooms';

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe('budgetChatRoomsApi — rooms', () => {
  it('listRooms GETs the base path and unwraps rooms', async () => {
    const rooms = [{ id: 'r1' }];
    mockGet.mockResolvedValue({ data: { rooms } });
    const res = await budgetChatRoomsApi.listRooms(HH);
    expect(mockGet).toHaveBeenCalledWith(BASE);
    expect(res).toBe(rooms);
  });

  it('createRoom POSTs the request and unwraps room', async () => {
    const room = { id: 'r1', name: 'Bills' };
    mockPost.mockResolvedValue({ data: { room } });
    const res = await budgetChatRoomsApi.createRoom(HH, { name: 'Bills', ai_enabled: true });
    expect(mockPost).toHaveBeenCalledWith(BASE, { name: 'Bills', ai_enabled: true });
    expect(res).toBe(room);
  });

  it('renameRoom PATCHes the room name and unwraps room', async () => {
    const room = { id: 'r1', name: 'Renamed', updated_at: 'x' };
    mockPatch.mockResolvedValue({ data: { room } });
    const res = await budgetChatRoomsApi.renameRoom(HH, 'r1', 'Renamed');
    expect(mockPatch).toHaveBeenCalledWith(`${BASE}/r1`, { name: 'Renamed' });
    expect(res).toBe(room);
  });

  it('deleteRoom DELETEs the room and unwraps data', async () => {
    mockDelete.mockResolvedValue({ data: { success: true } });
    const res = await budgetChatRoomsApi.deleteRoom(HH, 'r1');
    expect(mockDelete).toHaveBeenCalledWith(`${BASE}/r1`);
    expect(res).toEqual({ success: true });
  });

  it('clearHistory DELETEs the room messages collection and unwraps data', async () => {
    mockDelete.mockResolvedValue({ data: { success: true } });
    const res = await budgetChatRoomsApi.clearHistory(HH, 'r1');
    expect(mockDelete).toHaveBeenCalledWith(`${BASE}/r1/messages`);
    expect(res).toEqual({ success: true });
  });
});

describe('budgetChatRoomsApi — messages', () => {
  it('getMessages GETs history with pagination params and unwraps messages', async () => {
    const messages = [{ id: 'm1' }];
    mockGet.mockResolvedValue({ data: { messages } });
    const res = await budgetChatRoomsApi.getMessages(HH, 'r1', { before: '2026-07-01', limit: 50 });
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/r1/messages`, {
      params: { before: '2026-07-01', limit: 50 },
    });
    expect(res).toBe(messages);
  });

  it('getMessages defaults params to undefined', async () => {
    mockGet.mockResolvedValue({ data: { messages: [] } });
    await budgetChatRoomsApi.getMessages(HH, 'r1');
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/r1/messages`, { params: undefined });
  });

  it('sendMessage POSTs the input and unwraps message', async () => {
    const message = { id: 'm1', body: 'hi' };
    mockPost.mockResolvedValue({ data: { message } });
    const input = { body: 'hi', mentions: ['u2'] };
    const res = await budgetChatRoomsApi.sendMessage(HH, 'r1', input);
    expect(mockPost).toHaveBeenCalledWith(`${BASE}/r1/messages`, input);
    expect(res).toBe(message);
  });

  it('editMessage PATCHes the body + attachments and unwraps message', async () => {
    mockPatch.mockResolvedValue({ data: { message: { id: 'm1', body: 'edited' } } });
    const input = { body: 'edited', attachments: [{ key: 'k1', mimeType: 'image/jpeg' }] };
    await budgetChatRoomsApi.editMessage(HH, 'r1', 'm1', input);
    expect(mockPatch).toHaveBeenCalledWith(`${BASE}/r1/messages/m1`, input);
  });

  it('deleteMessage DELETEs the message and unwraps message', async () => {
    mockDelete.mockResolvedValue({ data: { message: { id: 'm1', deleted_at: 'x' } } });
    const res = await budgetChatRoomsApi.deleteMessage(HH, 'r1', 'm1');
    expect(mockDelete).toHaveBeenCalledWith(`${BASE}/r1/messages/m1`);
    expect(res).toEqual({ id: 'm1', deleted_at: 'x' });
  });

  it('markRead POSTs the last-read id', async () => {
    mockPost.mockResolvedValue({ data: { success: true } });
    await budgetChatRoomsApi.markRead(HH, 'r1', 'm9');
    expect(mockPost).toHaveBeenCalledWith(`${BASE}/r1/read`, { last_read_message_id: 'm9' });
  });

  it('markRead tolerates an absent last-read id', async () => {
    mockPost.mockResolvedValue({ data: { success: true } });
    await budgetChatRoomsApi.markRead(HH, 'r1');
    expect(mockPost).toHaveBeenCalledWith(`${BASE}/r1/read`, { last_read_message_id: undefined });
  });
});

describe('budgetChatRoomsApi — participants', () => {
  it('getParticipants GETs the participant set', async () => {
    mockGet.mockResolvedValue({ data: { restricted: false, participant_ids: [], members: [] } });
    const res = await budgetChatRoomsApi.getParticipants(HH, 'r1');
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/r1/participants`);
    expect(res).toEqual({ restricted: false, participant_ids: [], members: [] });
  });

  it('setParticipants PUTs the participant ids', async () => {
    mockPut.mockResolvedValue({ data: { restricted: true, participant_ids: ['u1', 'u2'] } });
    await budgetChatRoomsApi.setParticipants(HH, 'r1', ['u1', 'u2']);
    expect(mockPut).toHaveBeenCalledWith(`${BASE}/r1/participants`, {
      participant_ids: ['u1', 'u2'],
    });
  });
});

describe('budgetChatRoomsApi — image attachments', () => {
  it('getImageUploadUrl POSTs the filename/content-type', async () => {
    const payload = {
      image_id: 'i1',
      image_key: 'k1',
      upload_url: 'https://r2/put',
      content_type: 'image/png',
    };
    mockPost.mockResolvedValue({ data: payload });
    const res = await budgetChatRoomsApi.getImageUploadUrl(HH, 'r1', {
      filename: 'a.png',
      content_type: 'image/png',
    });
    expect(mockPost).toHaveBeenCalledWith(`${BASE}/r1/images/upload-url`, {
      filename: 'a.png',
      content_type: 'image/png',
    });
    expect(res).toBe(payload);
  });

  it('uploadImageBytes PUTs raw bytes through the authenticated apiClient and reports progress', async () => {
    mockPut.mockResolvedValue({ data: { image_key: 'k1' } });
    const onProgress = jest.fn();
    const body = new Uint8Array([1, 2, 3]).buffer;
    // Relative Worker path (NOT a presigned R2 URL) — must go through apiClient
    // so the API base URL + bearer token are attached, else the upload fails.
    const uploadUrl = `${BASE}/r1/images/i1/upload`;

    const res = await budgetChatRoomsApi.uploadImageBytes(uploadUrl, body, 'image/png', onProgress);

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [url, sentBody, config] = mockPut.mock.calls[0] as [
      string,
      unknown,
      {
        headers: Record<string, string>;
        transformRequest: Array<(d: unknown) => unknown>;
        onUploadProgress: (e: { loaded: number; total: number }) => void;
      },
    ];
    expect(url).toBe(uploadUrl);
    expect(sentBody).toBe(body);
    expect(config.headers['Content-Type']).toBe('image/png');
    // transformRequest must be an identity fn so axios doesn't mangle the bytes.
    expect(config.transformRequest[0](body)).toBe(body);

    config.onUploadProgress({ loaded: 5, total: 10 });
    expect(onProgress).toHaveBeenCalledWith(0.5);

    expect(res).toEqual({ image_key: 'k1' });
  });

  it('uploadImageBytes without an onProgress callback still succeeds', async () => {
    mockPut.mockResolvedValue({ data: { image_key: 'k2' } });
    const res = await budgetChatRoomsApi.uploadImageBytes(
      `${BASE}/r1/images/i1/upload`,
      new ArrayBuffer(2),
      'image/jpeg',
    );
    // Firing progress with no callback must not throw.
    const [, , config] = mockPut.mock.calls[0] as [
      string,
      unknown,
      { onUploadProgress: (e: { loaded: number; total: number }) => void },
    ];
    expect(() => config.onUploadProgress({ loaded: 1, total: 2 })).not.toThrow();
    expect(res).toEqual({ image_key: 'k2' });
  });

  it('uploadImageBytes returns empty image_key when the PUT has no JSON body', async () => {
    mockPut.mockResolvedValue({ data: undefined });
    const res = await budgetChatRoomsApi.uploadImageBytes(
      `${BASE}/r1/images/i1/upload`,
      new ArrayBuffer(1),
      'image/png',
    );
    expect(res).toEqual({ image_key: '' });
  });
});
