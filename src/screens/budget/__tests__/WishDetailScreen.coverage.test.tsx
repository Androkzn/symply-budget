/**
 * WishDetailScreen — branch/coverage completion suite.
 *
 * Complements the collab + e2e suites by driving the REAL screen through the
 * handlers those suites don't reach: the header "…" menu (edit details, status
 * changes, delete wish), every long-press entry menu branch (note/link/image),
 * the reply/edit composer banner, cover-photo flows, link editing, and — for
 * each of these — the error/catch path (API rejects → toast). Only native
 * boundaries are mocked (picker, Alert, Linking, toast, navigation, wishes API,
 * AddWishModal); everything between a tap and an API call is the real screen.
 */

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: { wishId: 'w1' } }),
}));

const mockPickPhoto = jest.fn();
jest.mock('@services/photo-upload', () => ({
  PhotoUploadService: { pickPhoto: (...a: unknown[]) => mockPickPhoto(...a) },
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockGet = jest.fn();
const mockAddEntry = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateEntry = jest.fn();
const mockUploadImage = jest.fn();
const mockDeleteEntry = jest.fn();
const mockRemove = jest.fn();
jest.mock('@api/wishes', () => ({
  wishesApi: {
    get: (...a: unknown[]) => mockGet(...a),
    addEntry: (...a: unknown[]) => mockAddEntry(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    updateEntry: (...a: unknown[]) => mockUpdateEntry(...a),
    uploadImage: (...a: unknown[]) => mockUploadImage(...a),
    deleteEntry: (...a: unknown[]) => mockDeleteEntry(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
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

// ScreenHeader mock exposes BOTH the back button (onBackPress) and the "…"
// rightElement so the header's back + menu handlers are reachable in tests.
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
    ScreenHeader: ({
      rightElement,
      onBackPress,
    }: {
      rightElement?: React.ReactNode;
      onBackPress?: () => void;
    }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(TouchableOpacity, { key: 'back', testID: 'wish-back', onPress: onBackPress }),
        rightElement ?? null
      ),
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-1' } }),
}));

// Stub AddWishModal so its onClose (setShowEdit(false)) is reachable without
// pulling the whole modal tree into these tests.
jest.mock('../AddWishModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AddWishModal: (props: { visible: boolean; onClose: () => void; onSaved: () => void }) =>
      props.visible
        ? React.createElement(View, {
            testID: 'add-wish-modal',
            onClose: props.onClose,
            onSaved: props.onSaved,
          })
        : null,
  };
});

import React from 'react';
import { ActionSheetIOS, Alert, Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { WishEntry, WishWithEntries } from '@api/wishes';
import { ThemeProvider } from '@contexts/ThemeContext';
import { showToast } from '@services/toastManager';

import { WishDetailScreen } from '../WishDetailScreen';

const HID = 'hh-1';
const WID = 'w1';
const toast = showToast as jest.Mock;

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
 * The most recently opened menu, whichever native surface it used: header/other
 * menus go through Alert.alert, the entry long-press menu goes through
 * ActionSheetIOS on iOS. Normalize both to a {title, buttons[]} shape (pressing an
 * action-sheet option invokes its callback with that index) and pick the newer of
 * the two via jest's invocationCallOrder, so the same press helpers drive either.
 */
function lastAlert(): {
  title: string;
  buttons: Array<{ text: string; onPress?: () => void }>;
} {
  const alertMock = Alert.alert as jest.Mock;
  const sheetMock = ActionSheetIOS.showActionSheetWithOptions as jest.Mock;
  const alertOrder = alertMock.mock.invocationCallOrder;
  const sheetOrder = sheetMock.mock.invocationCallOrder;
  const lastAlertOrder = alertOrder.length ? alertOrder[alertOrder.length - 1] : -1;
  const lastSheetOrder = sheetOrder.length ? sheetOrder[sheetOrder.length - 1] : -1;

  if (lastSheetOrder > lastAlertOrder) {
    const call = sheetMock.mock.calls[sheetMock.mock.calls.length - 1];
    const options = call[0].options as string[];
    const cb = call[1] as (i: number) => void;
    return {
      title: (call[0].title as string) ?? '',
      buttons: options.map((text, i) => ({ text, onPress: () => cb(i) })),
    };
  }
  const call = alertMock.mock.calls[alertMock.mock.calls.length - 1];
  return { title: call[0] as string, buttons: call[2] as Array<{ text: string; onPress?: () => void }> };
}

function alertHas(title: string): boolean {
  return lastAlert().buttons.some((b) => b.text === title);
}

function pressAlertButton(title: string) {
  const button = lastAlert().buttons.find((b) => b.text === title);
  if (!button) throw new Error(`Alert button "${title}" not found`);
  button.onPress?.();
}

/** Open the header "…" menu (rightElement TouchableOpacity). */
function openHeaderMenu(tree: ReactTestRenderer.ReactTestRenderer) {
  let node: ReactTestRenderer.ReactTestInstance | null = tree.root.findAllByProps({
    name: 'ellipsis-horizontal',
  })[0];
  while (node && typeof node.props?.onPress !== 'function') node = node.parent;
  if (!node) throw new Error('header menu button not found');
  act(() => node!.props.onPress());
}

function longPressEntry(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  act(() => tree.root.findByProps({ testID: `wish-entry-${id}` }).props.onLongPress());
}

function typeNote(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  const input = tree.root.findAll(
    (n) => n.props?.placeholder === 'Add a note…' || n.props?.placeholder === 'Edit note…'
  )[0];
  act(() => input.props.onChangeText(text));
}

beforeEach(() => {
  jest.clearAllMocks();
  currentWish = makeWish();
  mockGet.mockImplementation(async () => currentWish);
  mockAddEntry.mockResolvedValue({ id: 'e-new' });
  mockUpdate.mockResolvedValue({ ...makeWish() });
  mockUpdateEntry.mockResolvedValue({ id: 'e-edited' });
  mockUploadImage.mockResolvedValue('wishes/hh-1/w1/uploaded.jpg');
  mockDeleteEntry.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as unknown as void);
});

afterEach(async () => {
  // Unmount INSIDE an async act and drain microtasks so no scheduled effect
  // (a late load()/scrollToEnd rAF, a resolved picker/Linking promise) leaks
  // past the boundary and tears down the NEXT test's fresh renderer.
  await act(async () => {
    renderers.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* already gone */
      }
    });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
  renderers.length = 0;
  (Alert.alert as jest.Mock).mockRestore?.();
  (Linking.openURL as jest.Mock).mockRestore?.();
});

// ---------------------------------------------------------------------------
// Load error
// ---------------------------------------------------------------------------

describe('load errors', () => {
  it('toasts when the wish fails to load', async () => {
    mockGet.mockRejectedValueOnce(new Error('network'));
    await renderScreen();
    expect(toast).toHaveBeenCalledWith('error', 'Could not load this wish');
  });
});

// ---------------------------------------------------------------------------
// Header "…" menu — edit details, status changes, delete
// ---------------------------------------------------------------------------

describe('header menu', () => {
  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'wish-back' }).props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('opens the edit modal from "Edit details" and closes it', async () => {
    currentWish = makeWish({ cover_image_key: 'wishes/hh-1/w1/cover.jpg' });
    const tree = await renderScreen();

    openHeaderMenu(tree);
    // Cover already set -> "Change cover photo"; active wish -> achieve + archive.
    expect(alertHas('Change cover photo')).toBe(true);
    expect(alertHas('Mark as achieved')).toBe(true);
    expect(alertHas('Archive')).toBe(true);

    act(() => pressAlertButton('Edit details'));
    const modal = tree.root.findByProps({ testID: 'add-wish-modal' });
    expect(modal).toBeTruthy();
    act(() => modal.props.onClose());
    // Closing removes the modal from the tree.
    expect(tree.root.findAllByProps({ testID: 'add-wish-modal' })).toHaveLength(0);
  });

  it('marks an active wish as achieved', async () => {
    const tree = await renderScreen();
    openHeaderMenu(tree);
    await act(async () => {
      pressAlertButton('Mark as achieved');
      await flush();
    });
    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { status: 'achieved' });
    expect(toast).toHaveBeenCalledWith('success', 'Marked as achieved 🎉');
  });

  it('archives an active wish', async () => {
    const tree = await renderScreen();
    openHeaderMenu(tree);
    await act(async () => {
      pressAlertButton('Archive');
      await flush();
    });
    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { status: 'archived' });
    expect(toast).toHaveBeenCalledWith('success', 'Updated');
  });

  it('toasts when a status change fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('boom'));
    const tree = await renderScreen();
    openHeaderMenu(tree);
    await act(async () => {
      pressAlertButton('Archive');
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not update');
  });

  it('moves an achieved wish back to dreaming (Add cover photo shown)', async () => {
    currentWish = makeWish({ status: 'achieved', cover_image_key: null });
    const tree = await renderScreen();
    openHeaderMenu(tree);
    expect(alertHas('Add cover photo')).toBe(true);
    expect(alertHas('Move back to dreaming')).toBe(true);
    expect(alertHas('Archive')).toBe(true);
    await act(async () => {
      pressAlertButton('Move back to dreaming');
      await flush();
    });
    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { status: 'active' });
  });

  it('unarchives an archived wish', async () => {
    currentWish = makeWish({ status: 'archived' });
    const tree = await renderScreen();
    openHeaderMenu(tree);
    expect(alertHas('Mark as achieved')).toBe(true);
    expect(alertHas('Unarchive')).toBe(true);
    await act(async () => {
      pressAlertButton('Unarchive');
      await flush();
    });
    expect(mockUpdate).toHaveBeenCalledWith(HID, WID, { status: 'active' });
  });

  it('adds a cover photo from the menu (picker cancelled = no-op)', async () => {
    currentWish = makeWish({ cover_image_key: null });
    mockPickPhoto.mockResolvedValueOnce(null);
    const tree = await renderScreen();
    openHeaderMenu(tree);
    await act(async () => {
      pressAlertButton('Add cover photo');
      await flush();
    });
    expect(mockPickPhoto).toHaveBeenCalled();
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  it('deletes the wish and navigates back', async () => {
    const tree = await renderScreen();
    openHeaderMenu(tree);
    act(() => pressAlertButton('Delete wish'));
    // Nested confirmation alert.
    expect(lastAlert().title).toBe('Delete wish?');
    await act(async () => {
      pressAlertButton('Delete');
      await flush();
    });
    expect(mockRemove).toHaveBeenCalledWith(HID, WID);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('toasts when deleting the wish fails', async () => {
    mockRemove.mockRejectedValueOnce(new Error('nope'));
    const tree = await renderScreen();
    openHeaderMenu(tree);
    act(() => pressAlertButton('Delete wish'));
    await act(async () => {
      pressAlertButton('Delete');
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not delete');
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Composer — reply banner, edit banner, error paths
// ---------------------------------------------------------------------------

describe('composer', () => {
  it('toasts when adding a note fails', async () => {
    mockAddEntry.mockRejectedValueOnce(new Error('down'));
    const tree = await renderScreen();
    typeNote(tree, 'Hello there');
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-send-note' }).props.onPress();
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not add note');
  });

  it('toasts a save-changes error when editing a note fails', async () => {
    currentWish = makeWish({ entries: [makeEntry({ id: 'e-note', body: 'first' })] });
    mockUpdateEntry.mockRejectedValueOnce(new Error('bad'));
    const tree = await renderScreen();

    longPressEntry(tree, 'e-note');
    act(() => pressAlertButton('Edit'));
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-send-note' }).props.onPress();
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not save changes');
  });

  it('cancels an in-progress note edit (banner "Editing note")', async () => {
    currentWish = makeWish({ entries: [makeEntry({ id: 'e-note', body: 'draft' })] });
    const tree = await renderScreen();

    longPressEntry(tree, 'e-note');
    act(() => pressAlertButton('Edit'));
    // Editing banner + prefilled composer.
    expect(tree.root.findAll((n) => n.props?.children === 'Editing note').length).toBeGreaterThan(0);
    act(() => tree.root.findByProps({ testID: 'wish-cancel-edit' }).props.onPress());
    // Placeholder returns to the add state after cancelling.
    expect(tree.root.findAll((n) => n.props?.placeholder === 'Add a note…').length).toBeGreaterThan(0);
  });

  it('cancels a reply (banner "Replying to …")', async () => {
    currentWish = makeWish({
      entries: [makeEntry({ id: 'e-note', body: 'sailboat?', author_name: 'Alex' })],
    });
    const tree = await renderScreen();

    longPressEntry(tree, 'e-note');
    act(() => pressAlertButton('Reply'));
    expect(tree.root.findAll((n) => n.props?.children === 'Replying to Alex').length).toBeGreaterThan(0);
    act(() => tree.root.findByProps({ testID: 'wish-cancel-edit' }).props.onPress());
    // Reply banner is gone.
    expect(tree.root.findAll((n) => n.props?.children === 'Replying to Alex')).toHaveLength(0);
  });

  it('toasts when adding a photo fails during upload', async () => {
    mockPickPhoto.mockResolvedValueOnce({ uri: 'file:///p.jpg', mimeType: 'image/jpeg' });
    mockUploadImage.mockRejectedValueOnce(new Error('upload failed'));
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-add-photo' }).props.onPress();
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not add photo');
  });
});

// ---------------------------------------------------------------------------
// Entry long-press menu — note / link / image branches
// ---------------------------------------------------------------------------

describe('entry menu', () => {
  it('removes a note entry via its menu', async () => {
    currentWish = makeWish({ entries: [makeEntry({ id: 'e-note', body: 'scratch this' })] });
    const tree = await renderScreen();
    longPressEntry(tree, 'e-note');
    expect(lastAlert().title).toBe('Note');
    await act(async () => {
      pressAlertButton('Remove');
      await flush();
    });
    expect(mockDeleteEntry).toHaveBeenCalledWith(HID, WID, 'e-note');
  });

  it('toasts when removing an entry fails', async () => {
    currentWish = makeWish({ entries: [makeEntry({ id: 'e-note', body: 'oops' })] });
    mockDeleteEntry.mockRejectedValueOnce(new Error('locked'));
    const tree = await renderScreen();
    longPressEntry(tree, 'e-note');
    await act(async () => {
      pressAlertButton('Remove');
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not remove item');
  });

  it('opens a link entry from its menu (Open)', async () => {
    currentWish = makeWish({
      entries: [makeEntry({ id: 'e-link', kind: 'link', url: 'https://boats.example', link_title: 'Boat' })],
    });
    const tree = await renderScreen();
    longPressEntry(tree, 'e-link');
    expect(lastAlert().title).toBe('Link');
    await act(async () => {
      pressAlertButton('Open');
      await flush();
    });
    expect(Linking.openURL).toHaveBeenCalledWith('https://boats.example');
  });

  it('opens the link URL by tapping the link row', async () => {
    currentWish = makeWish({
      entries: [makeEntry({ id: 'e-link', kind: 'link', url: 'https://tap.example', link_title: 'Tap me' })],
    });
    const tree = await renderScreen();
    const row = tree.root.findByProps({ testID: 'wish-entry-e-link' });
    const linkPressable = row.findAll((n) => n.props?.activeOpacity === 0.7)[0];
    await act(async () => {
      linkPressable.props.onPress();
      await flush();
    });
    expect(Linking.openURL).toHaveBeenCalledWith('https://tap.example');
  });

  it('removes a link entry via its menu', async () => {
    currentWish = makeWish({
      entries: [makeEntry({ id: 'e-link', kind: 'link', url: 'https://gone.example', link_title: 'Gone' })],
    });
    const tree = await renderScreen();
    longPressEntry(tree, 'e-link');
    expect(lastAlert().title).toBe('Link');
    await act(async () => {
      pressAlertButton('Remove');
      await flush();
    });
    expect(mockDeleteEntry).toHaveBeenCalledWith(HID, WID, 'e-link');
  });

  it('edits a link entry through its menu + link sheet', async () => {
    currentWish = makeWish({
      entries: [
        makeEntry({
          id: 'e-link',
          kind: 'link',
          url: 'https://old.example',
          link_title: 'Old',
          price_cents: 1500,
        }),
      ],
    });
    const tree = await renderScreen();
    longPressEntry(tree, 'e-link');
    act(() => pressAlertButton('Edit'));

    // Link sheet opens prefilled from the entry (editing mode).
    const urlInput = tree.root.findByProps({ testID: 'wish-link-url' });
    expect(urlInput.props.value).toBe('https://old.example');
    act(() => urlInput.props.onChangeText('https://new.example'));
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-link-submit' }).props.onPress();
      await flush();
    });
    expect(mockUpdateEntry).toHaveBeenCalledWith(
      HID,
      WID,
      'e-link',
      expect.objectContaining({ url: 'https://new.example', link_title: 'Old', price_cents: 1500 })
    );
  });

  it('offers "Set as main photo" only when the image is not already the cover', async () => {
    currentWish = makeWish({
      cover_image_key: 'wishes/hh-1/w1/other.jpg',
      entries: [makeEntry({ id: 'e-img', kind: 'image', image_key: 'wishes/hh-1/w1/new.jpg' })],
    });
    const tree = await renderScreen();
    longPressEntry(tree, 'e-img');
    expect(lastAlert().title).toBe('Photo');
    expect(alertHas('Set as main photo')).toBe(true);
    // setAsCover error path.
    mockUpdate.mockRejectedValueOnce(new Error('cover fail'));
    await act(async () => {
      pressAlertButton('Set as main photo');
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not update main photo');
  });

  it('hides "Set as main photo" when the image is already the cover', async () => {
    const key = 'wishes/hh-1/w1/cover.jpg';
    currentWish = makeWish({
      cover_image_key: key,
      entries: [makeEntry({ id: 'e-img', kind: 'image', image_key: key })],
    });
    const tree = await renderScreen();
    longPressEntry(tree, 'e-img');
    expect(alertHas('Set as main photo')).toBe(false);
    // Removing the cover image still works.
    await act(async () => {
      pressAlertButton('Remove photo');
      await flush();
    });
    expect(mockDeleteEntry).toHaveBeenCalledWith(HID, WID, 'e-img');
  });
});

// ---------------------------------------------------------------------------
// Cover photo (fresh upload) error path
// ---------------------------------------------------------------------------

describe('change cover photo', () => {
  it('toasts when a fresh cover upload fails', async () => {
    currentWish = makeWish({ cover_image_key: 'wishes/hh-1/w1/existing.jpg' });
    mockPickPhoto.mockResolvedValueOnce({ uri: 'file:///c.jpg', mimeType: 'image/jpeg' });
    mockUploadImage.mockRejectedValueOnce(new Error('r2 down'));
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-change-cover' }).props.onPress();
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not update main photo');
  });
});

// ---------------------------------------------------------------------------
// Add-link modal — validation, close, save error
// ---------------------------------------------------------------------------

describe('add-link modal', () => {
  it('rejects an empty link with a toast', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'wish-add-link' }).props.onPress());
    act(() => tree.root.findByProps({ testID: 'wish-link-submit' }).props.onPress());
    expect(toast).toHaveBeenCalledWith('error', 'Paste a link first');
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('toasts when saving a link fails', async () => {
    mockAddEntry.mockRejectedValueOnce(new Error('save fail'));
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'wish-add-link' }).props.onPress());
    act(() => tree.root.findByProps({ testID: 'wish-link-url' }).props.onChangeText('example.com'));
    await act(async () => {
      tree.root.findByProps({ testID: 'wish-link-submit' }).props.onPress();
      await flush();
    });
    expect(toast).toHaveBeenCalledWith('error', 'Could not save link');
  });

  it('closes the link sheet via its backdrop / close control', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'wish-add-link' }).props.onPress());
    const modal = tree.root.findByProps({ animationType: 'slide' });
    expect(modal.props.visible).toBe(true);
    act(() => modal.props.onRequestClose());
    expect(tree.root.findByProps({ animationType: 'slide' }).props.visible).toBe(false);
  });
});
