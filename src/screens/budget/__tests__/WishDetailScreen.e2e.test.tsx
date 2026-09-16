/**
 * WishDetailScreen — end-to-end UI flow test.
 *
 * Drives the REAL detail screen through the three things a user does with a
 * wish: add a link, add an image (photo), and update the main (cover) photo —
 * both by promoting an existing photo and by uploading a fresh one. Only the
 * native boundaries are mocked: the photo picker, Alert, toast, navigation, and
 * the wishes API (its own URL/payload contract is covered by wishes.api.test).
 * Everything between a tap and an API call is the real screen logic.
 */

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockWishId = 'w1';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: { wishId: mockWishId } }),
}));

const mockPickPhoto = jest.fn();
jest.mock('@services/photo-upload', () => ({
  PhotoUploadService: { pickPhoto: (...args: unknown[]) => mockPickPhoto(...args) },
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockGet = jest.fn();
const mockAddEntry = jest.fn();
const mockUpdate = jest.fn();
const mockUploadImage = jest.fn();
const mockDeleteEntry = jest.fn();
jest.mock('@api/wishes', () => ({
  wishesApi: {
    get: (...a: unknown[]) => mockGet(...a),
    addEntry: (...a: unknown[]) => mockAddEntry(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    updateEntry: jest.fn(),
    uploadImage: (...a: unknown[]) => mockUploadImage(...a),
    deleteEntry: (...a: unknown[]) => mockDeleteEntry(...a),
  },
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => React.createElement(View, props) };
});

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    // Mirrors `SheetHeader`, the link sheet's top bar: the ✕ carries
    // `leftTestID` (the id the close flow drives) beside the centred title.
    SheetHeader: ({ title, onLeftPress, leftTestID }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onLeftPress, testID: leftTestID })
      ),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ rightElement }: { rightElement?: React.ReactNode }) =>
      React.createElement(View, { testID: 'screen-header' }, rightElement ?? null),
  };
});

const mockHouseholdId = 'hh-1';
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: mockHouseholdId } }),
}));

import React from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { WishEntry, WishWithEntries } from '@api/wishes';
import { ThemeProvider } from '@contexts/ThemeContext';

import { WishDetailScreen } from '../WishDetailScreen';

const HID = 'hh-1';
const WID = 'w1';

function makeWish(overrides: Partial<WishWithEntries> = {}): WishWithEntries {
  return {
    id: WID,
    household_id: HID,
    title: 'Buy a boat',
    notes: 'A little sailboat',
    cover_image_key: null,
    estimated_cost_cents: 4200000,
    target_date: null,
    status: 'active',
    sort_order: 0,
    created_by: 'u1',
    created_by_name: 'Pat',
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    entries: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<WishEntry> = {}): WishEntry {
  return {
    id: 'e1',
    wish_id: WID,
    household_id: HID,
    kind: 'note',
    body: null,
    image_key: null,
    url: null,
    link_title: null,
    price_cents: null,
    created_by: 'other',
    created_at: '2026-07-06T01:00:00Z',
    author_id: 'other',
    author_name: 'Alex',
    author_avatar_url: null,
    parent_entry_id: null,
    reply_to: null,
    ...overrides,
  };
}

let currentWish: WishWithEntries;
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
  // Keep at most one tree mounted at a time so trees don't accumulate across
  // tests (a stale tree's late effects can unmount the next test's renderer).
  act(() => {
    renderers.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* already gone */
      }
    });
  });
  renderers.length = 0;

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WishDetailScreen />
      </ThemeProvider>
    );
  });
  await flush();
  renderers.push(tree);
  return tree;
}

/**
 * Invoke a menu action by title from whichever native surface was opened most
 * recently: header/other menus use Alert.alert; the entry long-press menu uses
 * ActionSheetIOS on iOS (pressing an option invokes its callback with that index).
 */
function pressAlertButton(title: string) {
  const alertMock = Alert.alert as jest.Mock;
  const sheetMock = ActionSheetIOS.showActionSheetWithOptions as jest.Mock;
  const alertOrder = alertMock.mock.invocationCallOrder;
  const sheetOrder = sheetMock.mock.invocationCallOrder;
  const lastAlertOrder = alertOrder.length ? alertOrder[alertOrder.length - 1] : -1;
  const lastSheetOrder = sheetOrder.length ? sheetOrder[sheetOrder.length - 1] : -1;

  if (lastSheetOrder > lastAlertOrder) {
    const [opts, cb] = sheetMock.mock.calls[sheetMock.mock.calls.length - 1];
    const index = (opts.options as string[]).indexOf(title);
    if (index < 0) throw new Error(`Action sheet option "${title}" not found`);
    (cb as (i: number) => void)(index);
    return;
  }
  const buttons = alertMock.mock.calls[alertMock.mock.calls.length - 1][2] as Array<{
    text: string;
    onPress?: () => void;
  }>;
  const button = buttons.find((b) => b.text === title);
  if (!button) throw new Error(`Alert button "${title}" not found`);
  button.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWishId = WID;
  currentWish = makeWish();
  mockGet.mockImplementation(async () => currentWish);
  mockAddEntry.mockResolvedValue({ id: 'e-new' });
  mockUpdate.mockResolvedValue({ ...currentWish });
  mockUploadImage.mockResolvedValue('wishes/hh-1/w1/uploaded.jpg');
  mockDeleteEntry.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
});

afterEach(async () => {
  // Let any in-flight load()/update promises settle before we tear the tree
  // down, otherwise a late setState races the next test's fresh renderer.
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  act(() => {
    renderers.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* already gone */
      }
    });
  });
  renderers.length = 0;
  (Alert.alert as jest.Mock).mockRestore?.();
  (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mockRestore?.();
});

describe('WishDetailScreen e2e — add a link', () => {
  it('opens the link sheet, normalizes the URL, and posts a link entry', async () => {
    const tree = await renderScreen();

    act(() => tree.root.findByProps({ testID: 'wish-add-link' }).props.onPress());
    act(() => tree.root.findByProps({ testID: 'wish-link-url' }).props.onChangeText('example.com/boat'));
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-link-submit' }).props.onPress();
      await flush();
    });

    expect(mockAddEntry).toHaveBeenCalledWith(
      HID,
      WID,
      expect.objectContaining({ kind: 'link', url: 'https://example.com/boat' })
    );
  });
});

describe('WishDetailScreen e2e — add an image', () => {
  it('picks a photo, uploads it, and posts an image entry', async () => {
    mockPickPhoto.mockResolvedValueOnce({ uri: 'file:///boat.jpg', mimeType: 'image/jpeg' });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'wish-add-photo' }).props.onPress();
      await flush();
    });

    expect(mockUploadImage).toHaveBeenCalledWith(HID, WID, expect.objectContaining({ uri: 'file:///boat.jpg' }));
    expect(mockAddEntry).toHaveBeenCalledWith(
      HID,
      WID,
      expect.objectContaining({ kind: 'image', image_key: 'wishes/hh-1/w1/uploaded.jpg' })
    );
  });
});

describe('WishDetailScreen e2e — update the main photo', () => {
  it('promotes an existing image entry to the cover via its long-press menu', async () => {
    currentWish = makeWish({
      cover_image_key: 'wishes/hh-1/w1/old.jpg',
      entries: [makeEntry({ id: 'e-img', kind: 'image', image_key: 'wishes/hh-1/w1/new.jpg' })],
    });
    const tree = await renderScreen();

    act(() => tree.root.findByProps({ testID: 'wish-entry-e-img' }).props.onLongPress());
    await act(async () => {
      pressAlertButton('Set as main photo');
      await flush();
    });

    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { cover_image_key: 'wishes/hh-1/w1/new.jpg' });
  });

  it('uploads a fresh cover photo from the empty-cover hero button', async () => {
    currentWish = makeWish({ cover_image_key: null });
    mockPickPhoto.mockResolvedValueOnce({ uri: 'file:///cover.jpg', mimeType: 'image/jpeg' });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'wish-add-cover' }).props.onPress();
      await flush();
    });

    // Fresh photo is uploaded, added to the feed, AND set as the cover.
    expect(mockUploadImage).toHaveBeenCalledWith(HID, WID, expect.objectContaining({ uri: 'file:///cover.jpg' }));
    expect(mockAddEntry).toHaveBeenCalledWith(
      HID,
      WID,
      expect.objectContaining({ kind: 'image', image_key: 'wishes/hh-1/w1/uploaded.jpg' })
    );
    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { cover_image_key: 'wishes/hh-1/w1/uploaded.jpg' });
  });

  it('shows a Change-photo control when a cover already exists', async () => {
    currentWish = makeWish({ cover_image_key: 'wishes/hh-1/w1/existing.jpg' });
    mockPickPhoto.mockResolvedValueOnce({ uri: 'file:///cover2.jpg', mimeType: 'image/jpeg' });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'wish-change-cover' }).props.onPress();
      await flush();
    });

    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { cover_image_key: 'wishes/hh-1/w1/uploaded.jpg' });
  });
});
