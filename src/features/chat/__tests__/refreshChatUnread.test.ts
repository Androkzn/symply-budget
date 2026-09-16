/**
 * refreshChatUnread — best-effort refresh of a chat's unread badge (rooms +
 * per-room unread) into its store without opening chat. Driven by a ChatConfig
 * (its api + store). Covers: explicit household id, falling back to the selected
 * household, the no-household no-op, and error-swallowing (a stale badge beats a
 * crash).
 */
const mockListRooms = jest.fn();
const mockSetRooms = jest.fn();
const mockGetHouseholdState = jest.fn();

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: { getState: () => mockGetHouseholdState() },
}));

import type { ChatConfig } from '../ChatConfig';
import { refreshChatUnread } from '../refreshChatUnread';

// A minimal config wiring the mock api + store into the shared refresher.
const config = {
  api: { listRooms: (...args: unknown[]) => mockListRooms(...args) },
  store: { getState: () => ({ setRooms: mockSetRooms }) },
} as unknown as ChatConfig;

beforeEach(() => {
  mockListRooms.mockReset();
  mockSetRooms.mockReset();
  mockGetHouseholdState.mockReset();
  mockGetHouseholdState.mockReturnValue({ currentHousehold: { id: 'hh-selected' } });
});

it('uses the explicit household id when provided', async () => {
  const rooms = [{ id: 'r1', unread_count: 2 }];
  mockListRooms.mockResolvedValue(rooms);

  await refreshChatUnread(config, 'hh-explicit');

  expect(mockListRooms).toHaveBeenCalledWith('hh-explicit');
  expect(mockSetRooms).toHaveBeenCalledWith(rooms);
});

it('falls back to the currently-selected household', async () => {
  mockListRooms.mockResolvedValue([]);

  await refreshChatUnread(config);

  expect(mockListRooms).toHaveBeenCalledWith('hh-selected');
  expect(mockSetRooms).toHaveBeenCalledWith([]);
});

it('is a no-op when no household is selected', async () => {
  mockGetHouseholdState.mockReturnValue({ currentHousehold: null });

  await refreshChatUnread(config);

  expect(mockListRooms).not.toHaveBeenCalled();
  expect(mockSetRooms).not.toHaveBeenCalled();
});

it('swallows API errors and leaves the last-known badge in place', async () => {
  mockListRooms.mockRejectedValue(new Error('offline'));

  await expect(refreshChatUnread(config, 'hh-explicit')).resolves.toBeUndefined();

  expect(mockSetRooms).not.toHaveBeenCalled();
});
