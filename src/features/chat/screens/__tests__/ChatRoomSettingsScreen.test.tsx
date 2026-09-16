/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any -- jest.mock factories are hoisted above imports; loose mock types */
/**
 * BudgetChatRoomSettingsScreen — the per-room participants + danger-zone screen.
 * This suite renders it and drives every branch: the loading spinner, the query
 * function (hydrating the everyone/selected state), the "everyone in the
 * household" toggle (open vs restricted), per-member toggles + save (both the
 * restricted `[...selected]` and the open `[]` payloads), the save error alert,
 * the delete confirm → deleteRoom → removeRoom → navigate flow and its error
 * alert, the read-only (non-owner) hint, and the default-"General"-room lock.
 * Navigation, the store, the api and the presentational leaves are all stubbed.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockPop = jest.fn();
const mockNav = { navigate: mockNavigate, goBack: mockGoBack, pop: mockPop };
let mockRouteParams: Record<string, unknown> = {
  roomId: 'r1',
  roomName: 'Bills',
  canManage: true,
};
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

let mockQueryResult: Record<string, unknown> = { data: undefined, isLoading: false };
let mockLastQueryOpts: any = null;
jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQuery: (opts: unknown) => {
    mockLastQueryOpts = opts;
    return mockQueryResult;
  },
}));

let mockCurrentHousehold: { id: string } | null = { id: 'hh1' };
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentHousehold: mockCurrentHousehold };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// The shared screen reads its store + api from the ChatConfig (via context); we
// build a selector-style mock store + a mock api and hand them to a test config.
const mockRemoveRoom = jest.fn();
const mockRenameRoomInStore = jest.fn();
const mockClearMessagesInStore = jest.fn();
let mockStoreRooms: unknown[] = [{ id: 'r1', is_default: false }];
const mockChatStore = (sel?: (s: unknown) => unknown) => {
  const state = {
    removeRoom: mockRemoveRoom,
    renameRoom: mockRenameRoomInStore,
    clearMessages: mockClearMessagesInStore,
    rooms: mockStoreRooms,
  };
  return typeof sel === 'function' ? sel(state) : state;
};

const mockGetParticipants = jest.fn();
const mockSetParticipants = jest.fn();
const mockDeleteRoom = jest.fn();
const mockRenameRoom = jest.fn();
const mockClearHistory = jest.fn();
const mockChatApi = {
  getParticipants: (...a: unknown[]) => mockGetParticipants(...a),
  setParticipants: (...a: unknown[]) => mockSetParticipants(...a),
  deleteRoom: (...a: unknown[]) => mockDeleteRoom(...a),
  renameRoom: (...a: unknown[]) => mockRenameRoom(...a),
  clearHistory: (...a: unknown[]) => mockClearHistory(...a),
};

// --- Presentational leaves -> plain primitives -----------------------------
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: unknown }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ title, onBackPress }: { title?: unknown; onBackPress?: () => void }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(Text, null, title ?? null),
        onBackPress
          ? React.createElement(TouchableOpacity, { testID: 'header-back', onPress: onBackPress })
          : null
      ),
  };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    Avatar: () => null,
    Button: ({
      title,
      onPress,
      disabled,
      testID,
    }: {
      title?: unknown;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement(
        TouchableOpacity,
        { testID: testID || `button-${String(title)}`, onPress, disabled },
        React.createElement(Text, null, title ?? null)
      ),
    Card: ({ children }: { children?: unknown }) => React.createElement(View, null, children ?? null),
    TextInput: ({
      value,
      onChangeText,
      testID,
    }: {
      value?: string;
      onChangeText?: (t: string) => void;
      testID?: string;
    }) => {
      const { TextInput: RNTextInput } = require('react-native');
      return React.createElement(RNTextInput, {
        testID: testID || 'ui-textinput',
        value,
        onChangeText,
      });
    },
    // TouchableOpacity so the instance is reliably addressable (matches the
    // Button mock). One instance per toggle, pressed via `.props.onPress()`.
    Toggle: ({
      value,
      onValueChange,
      disabled,
    }: {
      value?: boolean;
      onValueChange?: (v: boolean) => void;
      disabled?: boolean;
    }) =>
      React.createElement(TouchableOpacity, {
        testID: 'ui-toggle',
        disabled,
        onPress: () => onValueChange && onValueChange(!value),
      }),
    Typography: ({ children }: { children?: unknown }) =>
      React.createElement(Text, null, children ?? null),
  };
});

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import type { ChatConfig } from '../../ChatConfig';
import { ChatConfigProvider } from '../../ChatConfigContext';
import { ChatRoomSettingsScreen } from '../ChatRoomSettingsScreen';

const testConfig = {
  id: 'test',
  routeSegment: 'budget-chat-rooms',
  socketLabel: 'budget-chat',
  rememberScope: 'budget-chat',
  presentation: 'fab',
  api: mockChatApi,
  store: mockChatStore,
  notif: { messageType: 'budget_chat_message', mentionType: 'budget_chat_mention' },
  route: { host: '/budget-chat', screen: 'BudgetChatRoom' },
} as unknown as ChatConfig;

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const MEMBERS = [
  { user_id: 'u1', display_name: 'Alice', email: 'alice@x.com', role: 'owner' },
  { user_id: 'u2', display_name: '', email: 'bob@x.com', role: 'member' },
];

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join('');
}

function toggles(tree: ReactTestRenderer.ReactTestRenderer) {
  // The interactive toggle instances (order: everyone, then one per member).
  // The same onPress reference lands on both the composite and its host node,
  // so dedupe by onPress identity to get exactly one entry per toggle.
  const all = tree.root.findAll(
    (n) => n.props?.testID === 'ui-toggle' && typeof n.props?.onPress === 'function'
  );
  const seen = new Set<unknown>();
  const out: ReactTestRenderer.ReactTestInstance[] = [];
  for (const n of all) {
    if (seen.has(n.props.onPress)) continue;
    seen.add(n.props.onPress);
    out.push(n);
  }
  return out;
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ChatConfigProvider config={testConfig}>
          <ChatRoomSettingsScreen />
        </ChatConfigProvider>
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

// Hydrate everyone/selected via the (mocked) query function so restricted-mode
// member rows render, exactly as the real query would on mount.
async function runQuery(participants: unknown) {
  mockGetParticipants.mockResolvedValue(participants);
  await act(async () => {
    await mockLastQueryOpts.queryFn();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { roomId: 'r1', roomName: 'Bills', canManage: true };
  mockCurrentHousehold = { id: 'hh1' };
  mockStoreRooms = [{ id: 'r1', is_default: false }];
  mockQueryResult = { data: undefined, isLoading: false };
  mockLastQueryOpts = null;
});

describe('BudgetChatRoomSettingsScreen', () => {
  it('shows a spinner while participants are loading', async () => {
    mockQueryResult.isLoading = true;
    const tree = await renderScreen();
    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('navigates back from the header', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'header-back' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('lists members in restricted mode, toggles one, and saves the selection', async () => {
    const participants = { restricted: true, participant_ids: ['u1'], members: MEMBERS };
    mockQueryResult.data = participants;
    mockSetParticipants.mockResolvedValue({ restricted: true, participant_ids: ['u1', 'u2'] });

    const tree = await renderScreen();
    // Runs the query function -> everyone=false, selected={u1}.
    await runQuery(participants);
    expect(mockGetParticipants).toHaveBeenCalledWith('hh1', 'r1');

    const texts = allText(tree.root);
    expect(texts).toContain('Alice');
    expect(texts).toContain('Owner'); // owner role label
    expect(texts).toContain('bob@x.com'); // display_name blank -> email fallback
    expect(texts).toContain('Turn off to limit who can see this room.'); // non-default hint

    // toggles[0] = everyone, [1] = Alice, [2] = Bob. Add Bob to the selection.
    await act(async () => {
      toggles(tree)[2].props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-save' }).props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockSetParticipants).toHaveBeenCalledWith('hh1', 'r1', ['u1', 'u2']);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('hydrates from an open room, then restricts it to the current members', async () => {
    // Open room (restricted:false): selected seeds from the full member list.
    const participants = { restricted: false, participant_ids: [], members: MEMBERS };
    mockQueryResult.data = participants;
    mockSetParticipants.mockResolvedValue({ restricted: true, participant_ids: ['u1', 'u2'] });

    const tree = await renderScreen();
    await runQuery(participants); // everyone=true, selected={u1,u2}

    // Turn "everyone" off -> restricted; member rows appear with all selected.
    await act(async () => {
      toggles(tree)[0].props.onPress();
    });
    expect(allText(tree.root)).toContain('Alice');

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-save' }).props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockSetParticipants).toHaveBeenCalledWith('hh1', 'r1', ['u1', 'u2']);
  });

  it('saves an empty participant set when switched back to "everyone"', async () => {
    const participants = { restricted: true, participant_ids: ['u1'], members: MEMBERS };
    mockQueryResult.data = participants;
    mockSetParticipants.mockResolvedValue({ restricted: false, participant_ids: [] });

    const tree = await renderScreen();
    await runQuery(participants); // everyone=false

    // Flip the "everyone" toggle back on -> open room, payload [].
    await act(async () => {
      toggles(tree)[0].props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-save' }).props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockSetParticipants).toHaveBeenCalledWith('hh1', 'r1', []);
  });

  it('alerts when saving participants fails', async () => {
    const participants = { restricted: true, participant_ids: ['u1'], members: MEMBERS };
    mockQueryResult.data = participants;
    mockSetParticipants.mockRejectedValue(new Error('network down'));

    const tree = await renderScreen();
    await runQuery(participants);

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-save' }).props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('confirms then deletes the room, drops it from the store, and returns to the list', async () => {
    mockDeleteRoom.mockResolvedValue({ success: true });
    const tree = await renderScreen();

    // Press "Delete room" -> confirmation alert.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-delete' }).props.onPress();
    });
    const call = alertSpy.mock.calls.find((c) => c[0] === 'Delete room?');
    expect(call).toBeTruthy();
    const destructive = (call![2] as Array<{ text: string; onPress?: () => void }>).find(
      (b) => b.text === 'Delete'
    );

    // Confirm the destructive action.
    await act(async () => {
      await destructive!.onPress!();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockDeleteRoom).toHaveBeenCalledWith('hh1', 'r1');
    expect(mockRemoveRoom).toHaveBeenCalledWith('r1');
    // Pops the deleted room's two screens rather than navigating to a route
    // name. These screens are hosted by more than one stack — the chat tab and
    // the Home Projects stack, which has no `ChatRoomsList` — and navigating to
    // a name a stack has never heard of is a silent no-op that would strand the
    // member on the settings screen for a room they just deleted.
    expect(mockPop).toHaveBeenCalledWith(2);
    expect(mockNavigate).not.toHaveBeenCalledWith('ChatRoomsList');
  });

  it('alerts when deleting the room fails', async () => {
    mockDeleteRoom.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-delete' }).props.onPress();
    });
    const call = alertSpy.mock.calls.find((c) => c[0] === 'Delete room?');
    const destructive = (call![2] as Array<{ text: string; onPress?: () => void }>).find(
      (b) => b.text === 'Delete'
    );

    await act(async () => {
      await destructive!.onPress!();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('Could not delete', 'Please try again.');
    expect(mockNavigate).not.toHaveBeenCalledWith('ChatRoomsList');
  });

  it('is read-only for non-owners: no save/delete, and a permission hint', async () => {
    mockRouteParams = { roomId: 'r1', roomName: 'Bills', canManage: false };
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('Only a household owner');
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-save' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-delete' })).toHaveLength(0);
    // The "everyone" toggle is disabled for non-owners.
    expect(toggles(tree)[0].props.disabled).toBe(true);
  });

  it('locks participants + delete on the default General room, but still allows rename + clear history', async () => {
    mockStoreRooms = [{ id: 'r1', is_default: true }];
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('The General room is always open to everyone.');
    // Participant editing + room delete stay blocked on the default room...
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-save' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-delete' })).toHaveLength(0);
    // ...but an owner can still rename it and clear its history.
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-rename' }).length).toBeGreaterThan(0);
    expect(
      tree.root.findAllByProps({ testID: 'chat-room-settings-clear-history' }).length
    ).toBeGreaterThan(0);
    // Default room's participant toggle is locked.
    expect(toggles(tree)[0].props.disabled).toBe(true);
  });

  it('locks participants + delete on the dedicated AI assistant room, but still allows clear history', async () => {
    mockStoreRooms = [{ id: 'r1', is_default: false, is_assistant: true }];
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('This is your private chat with the AI assistant — no one else can join.');
    // No participant save and no delete on the assistant room.
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-save' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'chat-room-settings-delete' })).toHaveLength(0);
    // Clearing history is still allowed (the room persists, pinned on top).
    expect(
      tree.root.findAllByProps({ testID: 'chat-room-settings-clear-history' }).length
    ).toBeGreaterThan(0);
    // The everyone/participant toggle is locked.
    expect(toggles(tree)[0].props.disabled).toBe(true);
  });

  it('renames the room: PATCHes the new name, updates the store, and returns', async () => {
    mockRenameRoom.mockResolvedValue({ id: 'r1', name: 'Groceries', updated_at: 'x' });
    const tree = await renderScreen();

    // Type a new name into the room-name field, then Save name.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-name-input' }).props.onChangeText('Groceries');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-rename' }).props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockRenameRoom).toHaveBeenCalledWith('hh1', 'r1', 'Groceries');
    expect(mockRenameRoomInStore).toHaveBeenCalledWith('r1', 'Groceries');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('disables Save name until the name actually changes', async () => {
    const tree = await renderScreen();
    // Unchanged from the route param "Bills" → Save disabled.
    expect(
      tree.root.findByProps({ testID: 'chat-room-settings-rename' }).props.disabled
    ).toBe(true);
  });

  it('clears history: confirms, purges via the API, resets the store, and returns', async () => {
    mockClearHistory.mockResolvedValue({ success: true });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-clear-history' }).props.onPress();
    });
    const call = alertSpy.mock.calls.find((c) => c[0] === 'Clear all messages?');
    expect(call).toBeTruthy();
    const destructive = (call![2] as Array<{ text: string; onPress?: () => void }>).find(
      (b) => b.text === 'Clear all'
    );

    await act(async () => {
      await destructive!.onPress!();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockClearHistory).toHaveBeenCalledWith('hh1', 'r1');
    expect(mockClearMessagesInStore).toHaveBeenCalledWith('r1');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('alerts when clearing history fails', async () => {
    mockClearHistory.mockRejectedValue(new Error('nope'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings-clear-history' }).props.onPress();
    });
    const call = alertSpy.mock.calls.find((c) => c[0] === 'Clear all messages?');
    const destructive = (call![2] as Array<{ text: string; onPress?: () => void }>).find(
      (b) => b.text === 'Clear all'
    );

    await act(async () => {
      await destructive!.onPress!();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('Could not clear', 'Please try again.');
  });
});
