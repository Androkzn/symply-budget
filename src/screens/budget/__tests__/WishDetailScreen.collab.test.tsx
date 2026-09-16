/**
 * WishDetailScreen — collaboration flows (author attribution, editing, replies).
 *
 * Split out from WishDetailScreen.e2e so each file mounts the (heavy, modal-
 * carrying) detail screen only a few times. Drives the REAL screen; only native
 * boundaries (picker, Alert, toast, navigation, wishes API) are mocked.
 */

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { wishId: 'w1' } }),
}));

jest.mock('@services/photo-upload', () => ({
  PhotoUploadService: { pickPhoto: jest.fn() },
}));
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockGet = jest.fn();
const mockAddEntry = jest.fn();
const mockUpdateEntry = jest.fn();
jest.mock('@api/wishes', () => ({
  wishesApi: {
    get: (...a: unknown[]) => mockGet(...a),
    addEntry: (...a: unknown[]) => mockAddEntry(...a),
    update: jest.fn().mockResolvedValue({}),
    updateEntry: (...a: unknown[]) => mockUpdateEntry(...a),
    uploadImage: jest.fn(),
    deleteEntry: jest.fn(),
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
  const { View } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ rightElement }: { rightElement?: React.ReactNode }) =>
      React.createElement(View, { testID: 'screen-header' }, rightElement ?? null),
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-1' } }),
}));

import React from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { WishEntry, WishWithEntries } from '@api/wishes';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { WishDetailScreen } from '../WishDetailScreen';

const HID = 'hh-1';
const WID = 'w1';

function makeWish(overrides: Partial<WishWithEntries> = {}): WishWithEntries {
  return {
    id: WID,
    household_id: HID,
    title: 'Buy a boat',
    notes: null,
    cover_image_key: null,
    estimated_cost_cents: null,
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
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
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

// Press a menu action by title from whichever native surface was opened most
// recently: header/other menus use Alert.alert; the entry long-press menu uses
// ActionSheetIOS on iOS (pressing an option invokes its callback with that index).
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
  currentWish = makeWish();
  mockGet.mockImplementation(async () => currentWish);
  mockAddEntry.mockResolvedValue({ id: 'e-new' });
  mockUpdateEntry.mockResolvedValue({ id: 'e-edited' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
});

afterEach(() => {
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

it("shows another member's name on their entry (chat attribution)", async () => {
  currentWish = makeWish({
    entries: [makeEntry({ id: 'e-note', body: 'I found a great deal', author_name: 'Alex' })],
  });
  const tree = await renderScreen();
  const texts = collectRenderedText(tree);
  expect(texts).toContain('Alex');
  expect(texts).toContain('I found a great deal');
});

it('edits a note via the long-press menu + composer', async () => {
  currentWish = makeWish({ entries: [makeEntry({ id: 'e-note', body: 'first draft' })] });
  const tree = await renderScreen();

  act(() => tree.root.findByProps({ testID: 'wish-entry-e-note' }).props.onLongPress());
  act(() => pressAlertButton('Edit'));
  await act(async () => {
    tree.root.findByProps({ testID: 'wish-send-note' }).props.onPress();
    await flush();
  });

  expect(mockUpdateEntry).toHaveBeenCalledWith(HID, WID, 'e-note', { body: 'first draft' });
});

it('posts a reply to another entry (threaded chat)', async () => {
  currentWish = makeWish({ entries: [makeEntry({ id: 'e-note', body: 'What about a sailboat?' })] });
  const tree = await renderScreen();

  act(() => tree.root.findByProps({ testID: 'wish-entry-e-note' }).props.onLongPress());
  act(() => pressAlertButton('Reply'));
  const input = tree.root.findAll((n) => n.props?.placeholder === 'Add a note…')[0];
  act(() => input.props.onChangeText('Love it'));
  await act(async () => {
    tree.root.findByProps({ testID: 'wish-send-note' }).props.onPress();
    await flush();
  });

  expect(mockAddEntry).toHaveBeenCalledWith(
    HID,
    WID,
    expect.objectContaining({ kind: 'note', body: 'Love it', parent_entry_id: 'e-note' })
  );
});
