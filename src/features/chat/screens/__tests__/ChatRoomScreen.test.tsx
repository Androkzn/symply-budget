/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any -- jest.mock factories are hoisted above imports; loose mock types */
/**
 * ChatRoomScreen — the Symply Budget in-room chat surface: message list
 * (system / member / AI / mine / deleted / edited / attachment / @mention
 * bubbles), the composer (send, edit, @mention autocomplete, image attach +
 * upload), the header (back + room settings), loading / empty / typing states,
 * mark-as-read on focus, and socket-driven store updates.
 *
 * Presentational leaves (@components/common, @components/ui, Icon, expo-image)
 * are stubbed to plain RN primitives; the stores (household / auth / member /
 * notification), the chat API, the socket hook, react-query and navigation are
 * mocked so every flow is deterministic. The REAL Budget chat store is used so
 * that store writes (query hydrate, optimistic send, socket push) re-render the
 * list exactly as they do at runtime.
 */

// --- Presentational leaves -> plain primitives -----------------------------
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: any) => React.createElement(View, null, children ?? null),
    HeaderActionButton: ({ children, onPress, testID, accessibilityLabel }: any) =>
      React.createElement(Pressable, { onPress, testID, accessibilityLabel }, children ?? null),
    ScreenHeader: ({ title, rightElement, showBackButton, onBackPress }: any) =>
      React.createElement(View, { testID: 'screen-header' }, [
        React.createElement(Text, { key: 't' }, title ?? null),
        showBackButton
          ? React.createElement(Pressable, { key: 'b', testID: 'header-back', onPress: onBackPress })
          : null,
        rightElement ?? null,
      ]),
  };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    Avatar: () => null,
    Card: ({ children }: any) => React.createElement(View, null, children ?? null),
    // Carries its `name` so a test can assert WHICH glyph was asked for — the
    // assistant avatar's whole bug was a name the active kit doesn't ship.
    Icon: ({ name }: any) => React.createElement(View, { testID: `icon-${name}` }),
    Typography: ({ children }: any) => React.createElement(Text, null, children ?? null),
    // Mirrors the House kit, which ships `ai-housekeeper` but NOT `ai-coach`
    // (see Icon.tsx: the alias table is shared by all five brands, so a slug
    // one kit has is routinely missing from another's).
    hasBrandIcon: (name: string) => name === 'ai-housekeeper',
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('expo-image', () => ({
  __esModule: true,
  Image: () => null,
}));

// --- Image + document + Drive attach pipeline ------------------------------
const mockRequestCameraPerms = jest.fn();
const mockRequestMediaPerms = jest.fn();
const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestCameraPermissionsAsync: (...a: unknown[]) => mockRequestCameraPerms(...a),
  requestMediaLibraryPermissionsAsync: (...a: unknown[]) => mockRequestMediaPerms(...a),
  launchCameraAsync: (...a: unknown[]) => mockLaunchCamera(...a),
  launchImageLibraryAsync: (...a: unknown[]) => mockLaunchLibrary(...a),
  MediaTypeOptions: { Images: 'Images' },
}));

const mockGetDocument = jest.fn();
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: (...a: unknown[]) => mockGetDocument(...a),
}));

// Every picked/captured image goes through `toVisionSafeAttachment`, which
// measures it via `ImageManipulator.manipulate(uri).renderAsync()`. Unmocked,
// that threw here, the screen swallowed the error, and NO upload was attempted
// — the photo-attachment tests failed with 0 calls to getImageUploadUrl.
// A small reported size keeps an already-jpeg fixture passing through untouched.
jest.mock('expo-image-manipulator', () => {
  const rendered = {
    width: 100,
    height: 100,
    saveAsync: async () => ({ uri: 'file:///vision-safe.jpg' }),
  };
  const context = { resize: () => context, renderAsync: async () => rendered };
  return {
    __esModule: true,
    ImageManipulator: { manipulate: () => context },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

// CloudFilePicker: a testable stub. When `visible`, pressing it selects a file
// (drives the Google Drive path); hidden otherwise.
jest.mock('@components/cloud-storage', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: ({ visible, onFileSelected }: any) =>
      visible
        ? React.createElement(Pressable, {
            testID: 'cloud-file-picker',
            onPress: () => onFileSelected({ uri: 'file://drive.pdf', name: 'drive.pdf', size: 10 }),
          })
        : null,
  };
});

const mockReadAsString = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  readAsStringAsync: (...a: unknown[]) => mockReadAsString(...a),
  cacheDirectory: 'file:///cache/',
  downloadAsync: (...a: Parameters<typeof mockDownloadAsync>) => mockDownloadAsync(...a),
}));

// --- expo-sharing (save image → iOS share sheet) ---------------------------
const mockShareAsync = jest.fn(async (..._args: unknown[]) => undefined);
const mockDownloadAsync = jest.fn(async (_url: string, target: string) => ({ uri: target }));
jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: async () => true,
  shareAsync: (...a: unknown[]) => mockShareAsync(...a),
}));

// --- react-query: run the queryFn, control isLoading -----------------------
let mockQueryIsLoading = false;
jest.mock('@tanstack/react-query', () => {
  const React = require('react');
  return {
    __esModule: true,
    useQuery: (opts: any) => {
      React.useEffect(() => {
        if (opts && opts.enabled !== false && typeof opts.queryFn === 'function') {
          Promise.resolve().then(() => opts.queryFn()).catch(() => undefined);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return { isLoading: mockQueryIsLoading, data: undefined, isError: false, error: null };
    },
    // The screen refreshes the project screens after the assistant writes to
    // them (`useChatActions`); nothing here asserts on it, but the hook runs on
    // every render, so the client has to exist.
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  };
});

// --- navigation ------------------------------------------------------------
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() };
let mockRouteParams: { roomId: string; roomName: string; aiEnabled?: boolean } = {
  roomId: 'r1',
  roomName: 'General',
  aiEnabled: true,
};
jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
}));

// --- stores ----------------------------------------------------------------
let mockHouseholdId: string | undefined = 'hh1';
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel: any) =>
    sel({ currentHousehold: mockHouseholdId ? { id: mockHouseholdId } : null }),
}));

let mockUserId: string | undefined = 'me';
jest.mock('@stores/authStore', () => {
  const state = () => ({ user: mockUserId ? { id: mockUserId } : null, token: 'tok' });
  const hook = (sel: any) => sel(state());
  hook.getState = () => state();
  return { __esModule: true, useAuthStore: hook };
});

let mockMembers: any[] = [];
jest.mock('@hooks/useHouseholdMembers', () => ({
  __esModule: true,
  useHouseholdMembers: () => ({ data: mockMembers, isLoading: false }),
}));

// AI entitlement — the @assistant mention is gated on `aiEnabled && canUseAI`.
// Default entitled so existing assertions hold; a dedicated test flips it off.
let mockCanUseAI = true;
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => ({ canUseAI: mockCanUseAI }),
}));

// Persisted composer preferences ("always ask the assistant"). An in-memory map
// rather than the MMKV mock so it can be cleared between tests — a preference
// that leaked forward would silently prefix @assistant onto other tests' sends.
const mockStoredBooleans = new Map<string, boolean>();
jest.mock('@services/storage', () => ({
  __esModule: true,
  storageHelpers: {
    getBoolean: async (key: string) => mockStoredBooleans.get(key),
    setBoolean: async (key: string, value: boolean) => {
      mockStoredBooleans.set(key, value);
    },
  },
}));

const mockRefreshUnreadCount = jest.fn();
jest.mock('@stores/notificationStore', () => {
  const state = () => ({ refreshUnreadCount: mockRefreshUnreadCount });
  const hook = (sel: any) => (typeof sel === 'function' ? sel(state()) : state());
  hook.getState = () => state();
  return { __esModule: true, useNotificationStore: hook };
});

// --- chat API --------------------------------------------------------------
const mockGetMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockEditMessage = jest.fn();
const mockDeleteMessage = jest.fn();
const mockMarkRead = jest.fn();
const mockGetImageUploadUrl = jest.fn();
const mockUploadImageBytes = jest.fn();
// The shared screen reads its API client + store from the ChatConfig (via
// context), so we build a mock api object and a fresh test store instead of
// mocking the api module.
const mockChatApi = {
  getMessages: (...a: unknown[]) => mockGetMessages(...a),
  sendMessage: (...a: unknown[]) => mockSendMessage(...a),
  editMessage: (...a: unknown[]) => mockEditMessage(...a),
  deleteMessage: (...a: unknown[]) => mockDeleteMessage(...a),
  markRead: (...a: unknown[]) => mockMarkRead(...a),
  getImageUploadUrl: (...a: unknown[]) => mockGetImageUploadUrl(...a),
  uploadImageBytes: (...a: unknown[]) => mockUploadImageBytes(...a),
};

// --- socket hook -----------------------------------------------------------
const mockSendTyping = jest.fn();
let mockIsPeerTyping = false;
let mockTypingActor: 'ai' | 'member' | null = null;
let mockTypingUserId: string | null = null;
jest.mock('../../useChatSocket', () => ({
  __esModule: true,
  useChatSocket: () => ({
    status: 'open',
    isPeerTyping: mockIsPeerTyping,
    typingActor: mockTypingActor,
    typingUserId: mockTypingUserId,
    sendTyping: mockSendTyping,
  }),
}));

import React from 'react';
import { ActionSheetIOS, Alert, FlatList } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import type { ChatConfig } from '../../ChatConfig';
import { ChatConfigProvider } from '../../ChatConfigContext';
import { createChatStore } from '../../createChatStore';
import { ChatRoomScreen } from '../ChatRoomScreen';

// A fresh isolated store + a test ChatConfig wiring the mock api into it.
const testStore = createChatStore();
const testConfig = {
  id: 'test',
  routeSegment: 'budget-chat-rooms',
  socketLabel: 'budget-chat',
  rememberScope: 'budget-chat',
  presentation: 'fab',
  api: mockChatApi,
  store: testStore,
  notif: { messageType: 'budget_chat_message', mentionType: 'budget_chat_mention' },
  route: { host: '/budget-chat', screen: 'BudgetChatRoom' },
} as unknown as ChatConfig;

// atob is used by the image-upload byte path; guarantee it exists.
if (typeof (globalThis as any).atob !== 'function') {
  (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
}

const DEFAULT_MEMBERS = [
  { user_id: 'me', display_name: 'Me', email: 'me@x.com', role: 'owner' },
  { user_id: 'u2', display_name: 'Alice', email: 'alice@x.com', role: 'member' },
  { user_id: 'u3', display_name: 'Bob', email: 'bob@x.com', role: 'owner' },
];

function msg(over: Record<string, unknown>): any {
  return {
    id: 'x',
    room_id: 'r1',
    sender_type: 'user',
    sender_user_id: 'u2',
    sender_name: 'Alice',
    body: 'hi',
    attachments: null,
    mentions: null,
    metadata: null,
    edited_at: null,
    deleted_at: null,
    created_at: '2026-07-15T00:00:00Z',
    ...over,
  };
}

const MESSAGES = [
  msg({ id: 's1', sender_type: 'system', sender_user_id: null, sender_name: null, body: 'Room created' }),
  msg({ id: 'm1', sender_type: 'user', sender_user_id: 'u2', sender_name: 'Alice', body: 'Hello @Bob and @assistant here', mentions: ['u3'] }),
  msg({ id: 'a1', sender_type: 'ai', sender_user_id: null, sender_name: null, body: 'I can help with that' }),
  msg({
    id: 'x1',
    sender_type: 'user',
    sender_user_id: 'me',
    sender_name: 'Me',
    body: 'My own message',
    attachments: [{ key: 'k1', url: 'https://img/1.jpg', mimeType: 'image/jpeg', width: 100, height: 100 }],
    edited_at: '2026-07-15T00:03:30Z',
  }),
  msg({ id: 'd1', sender_type: 'user', sender_user_id: 'u2', sender_name: 'Alice', body: 'oops', deleted_at: '2026-07-15T00:04:00Z' }),
];

const flush = async () => {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
};

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
  return out.join(' ');
}

async function renderScreen(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ChatConfigProvider config={testConfig}>
          <ChatRoomScreen />
        </ChatConfigProvider>
      </ThemeProvider>
    );
  });
  await act(async () => {
    await flush();
  });
  return tree;
}

/** Message-bubble Pressables (system rows have no Pressable). */
function messageRows(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n) => n.props?.delayLongPress === 300);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseholdId = 'hh1';
  mockUserId = 'me';
  mockMembers = DEFAULT_MEMBERS.map((m) => ({ ...m }));
  mockRouteParams = { roomId: 'r1', roomName: 'General', aiEnabled: true };
  mockIsPeerTyping = false;
  mockTypingActor = null;
  mockTypingUserId = null;
  mockQueryIsLoading = false;
  mockCanUseAI = true;
  mockStoredBooleans.clear();

  [mockGetMessages, mockSendMessage, mockEditMessage, mockDeleteMessage, mockMarkRead,
    mockGetImageUploadUrl, mockUploadImageBytes, mockRequestCameraPerms, mockRequestMediaPerms,
    mockLaunchCamera, mockLaunchLibrary, mockReadAsString, mockGetDocument].forEach((m) => m.mockReset());

  mockGetMessages.mockResolvedValue([]);
  mockMarkRead.mockResolvedValue({ success: true });
  mockSendMessage.mockResolvedValue(msg({ id: 'sent', sender_user_id: 'me' }));

  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

  act(() => testStore.getState().reset());
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore?.();
});

describe('ChatRoomScreen — render + hydrate', () => {
  it('hydrates from the query, renders every bubble variant, and marks the room read on focus', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);

    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(mockGetMessages).toHaveBeenCalledWith('hh1', 'r1', { limit: 50 });
    expect(texts).toContain('General'); // header title
    expect(texts).toContain('Room created'); // system row
    expect(texts).toContain('Hello'); // member bubble body
    expect(texts).toContain('@Bob'); // @mention rendered as its own highlighted node
    expect(texts).toContain('Assistant'); // AI sender label
    expect(texts).toContain('I can help with that');
    expect(texts).toContain('My own message'); // mine bubble
    expect(texts).toContain('edited'); // edited hint
    expect(texts).toContain('This message was deleted'); // soft-deleted bubble

    // Focusing the populated room marks it read (last message id) + refreshes badge.
    expect(mockMarkRead).toHaveBeenCalledWith('hh1', 'r1', 'd1');
    await act(async () => {
      await flush();
    });
    expect(mockRefreshUnreadCount).toHaveBeenCalled();
  });

  it('draws the assistant avatar from a slug the ACTIVE brand kit ships', async () => {
    // `<Icon>` falls through to Ionicons for a name its kit lacks, and
    // `ai-coach` is not an Ionicons glyph either — so hardcoding it put the
    // missing-glyph "?" box where House's assistant avatar belongs. The name
    // has to be resolved against the kit, not asserted.
    mockGetMessages.mockResolvedValue(MESSAGES);
    const tree = await renderScreen();

    const avatar = tree.root.findByProps({ testID: 'chat-assistant-avatar' });
    expect(avatar.findAllByProps({ testID: 'icon-ai-housekeeper' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'icon-ai-coach' })).toHaveLength(0);
  });

  it('shows the AI-aware empty state when no members are cached', async () => {
    mockMembers = [];
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('No messages yet');
    // aiEnabled → prompts the AI mention. `@ai` is the handle the hint offers;
    // `@assistant` still works and is what the mention row inserts.
    expect(texts).toContain('@ai');
  });

  it('omits the AI hint from the empty state when the room has AI disabled', async () => {
    mockRouteParams = { roomId: 'r1', roomName: 'General', aiEnabled: false };
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('No messages yet');
    expect(texts).not.toContain('ask the AI');
  });

  it('omits the @assistant hint when the room allows AI but the account has no AI access', async () => {
    // aiEnabled room, but the account has not connected a provider / subscribed.
    // The composer hint (`aiAvailable`, no __DEV__ bypass) must not advertise the
    // assistant, so we never point users at a mention whose send would 403.
    mockRouteParams = { roomId: 'r1', roomName: 'General', aiEnabled: true };
    mockCanUseAI = false;
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('No messages yet');
    expect(texts).not.toContain('ask the AI');
  });

  it('renders the loading spinner instead of the list while the query is pending', async () => {
    mockQueryIsLoading = true;
    const tree = await renderScreen();

    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(allText(tree.root)).not.toContain('No messages yet');
  });

  it('surfaces the peer typing indicator', async () => {
    mockIsPeerTyping = true;
    mockTypingActor = 'member';
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('Someone is typing');
  });

  it('names the typing member when the relay identified them', async () => {
    mockIsPeerTyping = true;
    mockTypingActor = 'member';
    mockTypingUserId = 'u2';
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('Alice is typing');
  });

  it('labels the assistant’s thinking as the assistant, not "Someone"', async () => {
    // The AI's typing frame and a member's arrive as the same socket event, so
    // both used to read "Someone is typing…" — in a room where the member had
    // just asked the assistant a question, naming the one participant it could
    // not be.
    mockIsPeerTyping = true;
    mockTypingActor = 'ai';
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('Assistant is typing');
    expect(allText(tree.root)).not.toContain('Someone is typing');
  });
});

describe('ChatRoomScreen — composer', () => {
  it('sends a plain text message and appends it to the room', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('Hello world');
    });
    expect(mockSendTyping).toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(mockSendMessage).toHaveBeenCalledWith('hh1', 'r1', { body: 'Hello world' });
  });

  it('restores the text and alerts when sending fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('network down'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('keep me');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Message not sent', 'Please try again.');
    // Text is restored so the user does not lose it.
    expect(tree.root.findByProps({ testID: 'chat-room-input' }).props.value).toBe('keep me');
  });

  it('offers @mention suggestions and tags the picked member on send', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('@');
    });

    // Candidates are everyone but me.
    expect(tree.root.findAllByProps({ testID: 'mention-u2' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mention-u3' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mention-assistant' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'mention-u2' }).props.onPress();
    });
    // Picking a mention inserts the handle and closes the suggestion bar.
    expect(tree.root.findByProps({ testID: 'chat-room-input' }).props.value).toBe('@Alice ');
    expect(tree.root.findAllByProps({ testID: 'mention-u2' })).toHaveLength(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(mockSendMessage).toHaveBeenCalledWith('hh1', 'r1', { body: '@Alice', mentions: ['u2'] });
  });

  it('offers @mention suggestions for a mention typed in FRONT of an edited message', async () => {
    // The reported bug: the composer only matched an @token at the END of the
    // input, so editing a message to add "@assistant" never opened the picker
    // and the assistant could not be tagged from an edit at all.
    mockGetMessages.mockResolvedValue(MESSAGES);
    mockEditMessage.mockResolvedValue(
      msg({ id: 'x1', sender_user_id: 'me', body: '@assistant My own message', edited_at: 'now' })
    );
    const tree = await renderScreen();

    await act(async () => {
      messageRows(tree)[2].props.onLongPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](sheet[0].options.indexOf('Edit'));
    });
    expect(tree.root.findByProps({ testID: 'chat-room-input' }).props.value).toBe('My own message');

    // Type "@a" at the head of the existing body, one character at a time.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('@My own message');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('@aMy own message');
    });

    expect(tree.root.findAllByProps({ testID: 'mention-assistant' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'mention-assistant' }).props.onPress();
    });
    // The handle replaces the token in place — the body it was typed in front of survives.
    expect(tree.root.findByProps({ testID: 'chat-room-input' }).props.value).toBe(
      '@assistant My own message'
    );

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });
    expect(mockEditMessage).toHaveBeenCalledWith('hh1', 'r1', 'x1', {
      body: '@assistant My own message',
      attachments: [{ key: 'k1', mimeType: 'image/jpeg', width: 100, height: 100 }],
    });
  });

  it('edits an existing message through the long-press action sheet', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);
    mockEditMessage.mockResolvedValue(msg({ id: 'x1', sender_user_id: 'me', body: 'Edited body', edited_at: 'now' }));
    const tree = await renderScreen();

    // Long-press my own bubble (index 2 of the non-system rows).
    await act(async () => {
      messageRows(tree)[2].props.onLongPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    expect(sheet[0].options).toContain('Edit');
    await act(async () => {
      sheet[1](sheet[0].options.indexOf('Edit'));
    });

    // Composer flips into edit mode.
    expect(allText(tree.root)).toContain('Editing message');
    expect(tree.root.findByProps({ testID: 'chat-room-input' }).props.value).toBe('My own message');

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('Edited body');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    // The message's existing image is seeded into the tray and, left untouched,
    // is sent back so the edit keeps it.
    expect(mockEditMessage).toHaveBeenCalledWith('hh1', 'r1', 'x1', {
      body: 'Edited body',
      attachments: [{ key: 'k1', mimeType: 'image/jpeg', width: 100, height: 100 }],
    });
  });

  it('removes an existing image on edit and saves without it', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);
    mockEditMessage.mockResolvedValue(
      msg({ id: 'x1', sender_user_id: 'me', body: 'My own message', edited_at: 'now' })
    );
    const tree = await renderScreen();

    // Enter edit mode on my own message (row index 2), which carries image k1.
    await act(async () => {
      messageRows(tree)[2].props.onLongPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](sheet[0].options.indexOf('Edit'));
    });

    // The seeded image chip exposes a remove button (a Pressable wrapping a
    // "close" Icon); walk up from the icon to the pressable and tap it.
    let node: ReactTestRenderer.ReactTestInstance | null =
      tree.root.findAll((n) => n.props?.name === 'close')[0];
    while (node && typeof node.props?.onPress !== 'function') node = node.parent;
    await act(async () => {
      node?.props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(mockEditMessage).toHaveBeenCalledWith('hh1', 'r1', 'x1', {
      body: 'My own message',
      attachments: [],
    });
  });

  it('deletes a message via the long-press sheet + confirmation alert', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);
    mockDeleteMessage.mockResolvedValue(msg({ id: 'm1', deleted_at: 'now' }));
    const tree = await renderScreen();

    // Owner long-presses someone else's bubble (row index 0 = Alice's message).
    await act(async () => {
      messageRows(tree)[0].props.onLongPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    expect(sheet[0].options).toContain('Delete');
    await act(async () => {
      sheet[1](sheet[0].options.indexOf('Delete')); // Delete → confirmation Alert
    });

    // Invoke the destructive button in the confirmation alert.
    const alertCall = (Alert.alert as jest.Mock).mock.calls.at(-1);
    const deleteBtn = alertCall[2].find((b: any) => b.text === 'Delete');
    await act(async () => {
      deleteBtn.onPress();
      await flush();
    });

    expect(mockDeleteMessage).toHaveBeenCalledWith('hh1', 'r1', 'm1');
  });

  it('uploads a picked photo and sends it as an attachment', async () => {
    mockRequestMediaPerms.mockResolvedValue({ status: 'granted' });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://p.jpg', mimeType: 'image/jpeg', width: 10, height: 10, fileName: 'p.jpg' }],
    });
    mockGetImageUploadUrl.mockResolvedValue({
      image_id: 'i1',
      image_key: 'k1',
      upload_url: 'https://r2/put',
      content_type: 'image/jpeg',
    });
    mockReadAsString.mockResolvedValue('AAAA'); // decodes to 3 bytes
    mockUploadImageBytes.mockImplementation(async (_u, _b, _c, onProgress) => {
      if (onProgress) onProgress(1);
      return { image_key: 'k1' };
    });
    mockSendMessage.mockResolvedValue(
      msg({ id: 'sent1', sender_user_id: 'me', body: null, attachments: [{ key: 'k1', url: 'https://img' }] })
    );

    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-attach' }).props.onPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](1); // Photo Library
      await flush();
    });

    expect(mockGetImageUploadUrl).toHaveBeenCalled();
    expect(mockUploadImageBytes).toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      'hh1',
      'r1',
      expect.objectContaining({ attachments: [expect.objectContaining({ key: 'k1' })] })
    );
  });
});

describe('ChatRoomScreen — always ask the assistant', () => {
  const toggle = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAllByProps({ testID: 'chat-room-assistant-toggle' })[0];

  it('addresses the assistant on every send once switched on, and remembers the room', async () => {
    const tree = await renderScreen();
    expect(toggle(tree).props.accessibilityState).toEqual({ checked: false });

    await act(async () => {
      toggle(tree).props.onPress();
      await flush();
    });
    expect(toggle(tree).props.accessibilityState).toEqual({ checked: true });

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('find mold removal');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });
    // The handle is IN the sent body — the Worker triggers off the stored text.
    expect(mockSendMessage).toHaveBeenCalledWith('hh1', 'r1', {
      body: '@assistant find mold removal',
    });

    // A fresh mount of the same room comes back on.
    tree.unmount();
    const reopened = await renderScreen();
    expect(toggle(reopened).props.accessibilityState).toEqual({ checked: true });
  });

  it('does not stack a second handle on a message that already tags the assistant', async () => {
    const tree = await renderScreen();
    await act(async () => {
      toggle(tree).props.onPress();
      await flush();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('@ai what next');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });
    expect(mockSendMessage).toHaveBeenCalledWith('hh1', 'r1', { body: '@ai what next' });
  });

  it('carries the handle into an edit too', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);
    mockEditMessage.mockResolvedValue(msg({ id: 'x1', sender_user_id: 'me', edited_at: 'now' }));
    const tree = await renderScreen();

    await act(async () => {
      toggle(tree).props.onPress();
      await flush();
    });
    await act(async () => {
      messageRows(tree)[2].props.onLongPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](sheet[0].options.indexOf('Edit'));
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });
    expect(mockEditMessage).toHaveBeenCalledWith('hh1', 'r1', 'x1', {
      body: '@assistant My own message',
      attachments: [{ key: 'k1', mimeType: 'image/jpeg', width: 100, height: 100 }],
    });
  });

  it('is hidden when the account has no AI access, and its preference is inert', async () => {
    mockStoredBooleans.set('chat:test:assistant-default:r1', true);
    mockCanUseAI = false;
    const tree = await renderScreen();

    expect(tree.root.findAllByProps({ testID: 'chat-room-assistant-toggle' })).toHaveLength(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('just talking');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });
    // No handle: a send that would 403 server-side must not look like a question
    // the assistant is about to answer.
    expect(mockSendMessage).toHaveBeenCalledWith('hh1', 'r1', { body: 'just talking' });
  });
});

describe('ChatRoomScreen — attach + edge cases', () => {
  it('captures a photo from the camera and uploads it', async () => {
    mockRequestCameraPerms.mockResolvedValue({ status: 'granted' });
    mockLaunchCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://c.jpg', mimeType: 'image/jpeg', width: 5, height: 5 }],
    });
    mockGetImageUploadUrl.mockResolvedValue({
      image_id: 'i',
      image_key: 'k9',
      upload_url: 'https://r2/c',
      content_type: 'image/jpeg',
    });
    mockReadAsString.mockResolvedValue('AAAA');
    mockUploadImageBytes.mockResolvedValue({ image_key: 'k9' });

    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-attach' }).props.onPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](0); // Take Photo
      await flush();
    });

    expect(mockLaunchCamera).toHaveBeenCalled();
    expect(mockUploadImageBytes).toHaveBeenCalled();
  });

  it('uploads a document from the Files app ("File from iPhone") and sends it with its filename', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://statement.pdf', name: 'statement.pdf', mimeType: 'application/pdf' }],
    });
    mockGetImageUploadUrl.mockResolvedValue({
      image_id: 'i',
      image_key: 'kdoc',
      upload_url: 'https://r2/doc',
      content_type: 'application/pdf',
    });
    mockReadAsString.mockResolvedValue('AAAA');
    mockUploadImageBytes.mockImplementation(async (_u, _b, _c, onProgress) => {
      if (onProgress) onProgress(1);
      return { image_key: 'kdoc' };
    });
    mockSendMessage.mockResolvedValue(
      msg({ id: 'sentDoc', sender_user_id: 'me', body: null, attachments: [{ key: 'kdoc', url: 'https://f/doc' }] })
    );

    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-attach' }).props.onPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    expect(sheet[0].options).toEqual([
      'Take Photo',
      'Photo Library',
      'File from iPhone',
      'Google Drive',
      'Cancel',
    ]);
    await act(async () => {
      sheet[1](2); // File from iPhone
      await flush();
    });

    expect(mockGetDocument).toHaveBeenCalled();
    expect(mockUploadImageBytes).toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      'hh1',
      'r1',
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ key: 'kdoc', name: 'statement.pdf', mimeType: 'application/pdf' }),
        ],
      })
    );
  });

  it('uploads a file selected from Google Drive', async () => {
    mockGetImageUploadUrl.mockResolvedValue({
      image_id: 'i',
      image_key: 'kdrive',
      upload_url: 'https://r2/drive',
      content_type: 'application/pdf',
    });
    mockReadAsString.mockResolvedValue('AAAA');
    mockUploadImageBytes.mockResolvedValue({ image_key: 'kdrive' });

    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-attach' }).props.onPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](3); // Google Drive → reveals the CloudFilePicker
      await flush();
    });

    // The mocked picker is now visible; pressing it selects a file.
    await act(async () => {
      tree.root.findByProps({ testID: 'cloud-file-picker' }).props.onPress();
      await flush();
    });

    expect(mockGetImageUploadUrl).toHaveBeenCalledWith(
      'hh1',
      'r1',
      expect.objectContaining({ filename: 'drive.pdf', content_type: 'application/pdf' })
    );
    expect(mockUploadImageBytes).toHaveBeenCalled();
  });

  it('renders a non-image attachment as a tappable document chip labeled with its filename', async () => {
    mockGetMessages.mockResolvedValue([
      msg({
        id: 'doc1',
        sender_user_id: 'me',
        sender_name: 'Me',
        body: null,
        attachments: [
          { key: 'kd', url: 'https://f/kd', mimeType: 'application/pdf', name: 'budget-2026.pdf' },
        ],
      }),
    ]);

    const tree = await renderScreen();

    expect(allText(tree.root)).toContain('budget-2026.pdf');
  });

  it('alerts and skips upload when photo-library permission is denied', async () => {
    mockRequestMediaPerms.mockResolvedValue({ status: 'denied' });
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-attach' }).props.onPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](1); // Photo Library
      await flush();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Photo permission needed', 'Enable photo access in Settings.');
    expect(mockGetImageUploadUrl).not.toHaveBeenCalled();
  });

  it('marks the failed image chip when the upload throws', async () => {
    mockRequestMediaPerms.mockResolvedValue({ status: 'granted' });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://p.jpg', mimeType: 'image/jpeg', width: 10, height: 10, fileName: 'p.jpg' }],
    });
    mockGetImageUploadUrl.mockRejectedValue(new Error('reserve failed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-attach' }).props.onPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](1);
      await flush();
    });

    // Upload failed → no ready image, so the send button never posts a message.
    expect(mockSendMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('alerts when saving an edit fails', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);
    mockEditMessage.mockRejectedValue(new Error('nope'));
    const tree = await renderScreen();

    await act(async () => {
      messageRows(tree)[2].props.onLongPress();
    });
    const sheet = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
    await act(async () => {
      sheet[1](sheet[0].options.indexOf('Edit'));
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-input' }).props.onChangeText('new body');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-send' }).props.onPress();
      await flush();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Could not save edit', 'Please try again.');
  });

  it('scrolls to the end on content-size and layout changes', async () => {
    mockGetMessages.mockResolvedValue(MESSAGES);
    const tree = await renderScreen();
    const list = tree.root
      .findAllByType(FlatList)
      .find((n) => typeof n.props.onContentSizeChange === 'function');
    expect(list).toBeTruthy();
    await act(async () => {
      list!.props.onContentSizeChange();
      list!.props.onLayout();
    });
    // No throw = the ref-guarded scrollToEnd branches executed.
    expect(mockGetMessages).toHaveBeenCalled();
  });
});

describe('ChatRoomScreen — header + live updates', () => {
  it('navigates to room settings with the owner-manage flag', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-room-settings' }).props.onPress();
    });
    expect(mockNavigation.navigate).toHaveBeenCalledWith('ChatRoomSettings', {
      roomId: 'r1',
      roomName: 'General',
      canManage: true, // "me" is an owner
    });
  });

  it('goes back from the header', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'header-back' }).props.onPress();
    });
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('re-renders when a message arrives over the socket (store push)', async () => {
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('No messages yet');

    await act(async () => {
      testStore.getState().appendMessage(
        'r1',
        msg({ id: 'live1', sender_user_id: 'u3', sender_name: 'Bob', body: 'incoming live message' })
      );
      await flush();
    });

    expect(allText(tree.root)).toContain('incoming live message');
  });
});
