/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any -- jest.mock factories are hoisted above imports; loose mock types */
/**
 * BudgetChatRoomsListScreen — the Budget app's household chat room list. This
 * suite renders the screen and drives every top-level branch: the "no home
 * selected" empty state, the loading spinner, the empty conversation list (with
 * its call-to-action), the populated list (room preview variants, AI chip,
 * unread badge capping), opening a room, and the create-room bottom sheet
 * (name/AI toggle → createRoom → invalidate → navigate, plus the guard + cancel
 * paths). The React Query hook is mocked so we can flip loading/refetching and
 * invoke the query function directly; the store/api/navigation and the
 * presentational leaves are stubbed to plain RN primitives.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
// addListener('focus', cb) fires cb immediately so the focus-refetch runs, and
// returns an unsubscribe fn (the effect cleanup calls it).
const mockAddListener = jest.fn((_event: string, cb: () => void) => {
  cb();
  return jest.fn();
});
const mockNav = { navigate: mockNavigate, goBack: mockGoBack, addListener: mockAddListener };
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => mockNav,
  useRoute: () => ({ params: {} }),
}));

const mockRefetch = jest.fn();
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
let mockQueryResult: Record<string, unknown> = {
  isLoading: false,
  isRefetching: false,
  refetch: mockRefetch,
  data: undefined,
};
let mockLastQueryOpts: any = null;
jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQuery: (opts: unknown) => {
    mockLastQueryOpts = opts;
    return mockQueryResult;
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

let mockCurrentHousehold: { id: string } | null = null;
const mockFetchHouseholds = jest.fn();
jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentHousehold: mockCurrentHousehold, fetchHouseholds: mockFetchHouseholds };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// The shared screen reads its store + api from the ChatConfig (via context); we
// build a selector-style mock store + a mock api and hand them to a test config.
const mockSetRooms = jest.fn();
let mockRooms: unknown[] = [];
const mockChatStore = (sel?: (s: unknown) => unknown) => {
  const state = { rooms: mockRooms, setRooms: mockSetRooms };
  return typeof sel === 'function' ? sel(state) : state;
};

const mockListRooms = jest.fn();
const mockCreateRoom = jest.fn();
const mockChatApi = {
  listRooms: (...a: unknown[]) => mockListRooms(...a),
  createRoom: (...a: unknown[]) => mockCreateRoom(...a),
};

jest.mock('@hooks/useLayoutPadding', () => ({
  __esModule: true,
  useLayoutPadding: () => ({ content: 16, cardGap: 12, section: 16, sidebarInset: 0 }),
}));

const mockNavigateToHouseholds = jest.fn();
jest.mock('@services/navigation', () => ({
  __esModule: true,
  navigateToHouseholds: (...a: unknown[]) => mockNavigateToHouseholds(...a),
}));

// --- Presentational leaves -> plain primitives -----------------------------
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: unknown }) =>
      React.createElement(View, null, children ?? null),
    // House's header gear. Stubbed rather than left out: this barrel is mocked
    // wholesale, so an export missing from it renders as `undefined` and React
    // throws before a single assertion runs.
    SettingsGearButton: () =>
      React.createElement(View, { testID: 'header-settings-gear' }),
    ScreenHeader: ({ title, rightElement }: { title?: unknown; rightElement?: unknown }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(Text, null, title ?? null),
        rightElement ?? null
      ),
    HeaderActionButton: ({
      label,
      onPress,
      testID,
    }: {
      label?: unknown;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        TouchableOpacity,
        { testID: testID || 'header-action', onPress },
        React.createElement(Text, null, label ?? null)
      ),
  };
});

jest.mock('@components/layout', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AdaptiveContainer: ({ children }: { children?: unknown }) =>
      React.createElement(View, null, children ?? null),
  };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity, TextInput } = require('react-native');
  return {
    __esModule: true,
    BottomSheet: ({ visible, children }: { visible?: boolean; children?: unknown }) =>
      visible ? React.createElement(View, { testID: 'bottom-sheet' }, children ?? null) : null,
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
    Chip: ({ label }: { label?: unknown }) =>
      React.createElement(Text, { testID: 'chip' }, label ?? null),
    EmptyState: ({
      title,
      description,
      action,
    }: {
      title?: unknown;
      description?: unknown;
      action?: { label?: unknown; onPress?: () => void };
    }) =>
      React.createElement(
        View,
        { testID: 'empty-state' },
        React.createElement(Text, null, title ?? null),
        React.createElement(Text, null, description ?? null),
        action
          ? React.createElement(
              TouchableOpacity,
              { testID: 'empty-state-action', onPress: action.onPress },
              React.createElement(Text, null, action.label ?? null)
            )
          : null
      ),
    FilterTabs: ({
      tabs,
      activeTab,
      onTabChange,
    }: {
      tabs?: Array<{ id: string; label: string }>;
      activeTab?: string;
      onTabChange?: (id: string) => void;
    }) =>
      React.createElement(
        View,
        { testID: 'filter-tabs' },
        (tabs ?? []).map((tab) =>
          React.createElement(
            TouchableOpacity,
            {
              key: tab.id,
              testID: `filter-tab-${tab.id}`,
              // Mirrors the real control's active styling so a test can assert
              // which segment is selected without reaching into theme colors.
              accessibilityState: { selected: tab.id === activeTab },
              onPress: () => onTabChange && onTabChange(tab.id),
            },
            React.createElement(Text, null, tab.label)
          )
        )
      ),
    TextInput: ({
      value,
      onChangeText,
      testID,
    }: {
      value?: string;
      onChangeText?: (t: string) => void;
      testID?: string;
    }) =>
      React.createElement(TextInput, {
        testID: testID || 'chat-rooms-name-input',
        value,
        onChangeText,
      }),
    Toggle: ({
      value,
      onValueChange,
    }: {
      value?: boolean;
      onValueChange?: (v: boolean) => void;
    }) =>
      React.createElement(TouchableOpacity, {
        testID: 'ui-toggle',
        onPress: () => onValueChange && onValueChange(!value),
      }),
    Typography: ({ children }: { children?: unknown }) =>
      React.createElement(Text, null, children ?? null),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import type { ChatConfig } from '../../ChatConfig';
import { ChatConfigProvider } from '../../ChatConfigContext';
import { ChatRoomsListScreen } from '../ChatRoomsListScreen';

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

/**
 * House-shaped config: `subjectHref` is the "chats can belong to a project"
 * signal, and it is what grows the fourth ("Projects") filter tab.
 */
const subjectConfig = {
  ...testConfig,
  subjectHref: () => '/projects',
} as unknown as ChatConfig;

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

async function renderScreen(config: ChatConfig = testConfig) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ChatConfigProvider config={config}>
          <ChatRoomsListScreen />
        </ChatConfigProvider>
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const ROOMS = [
  {
    id: 'r1',
    name: 'General',
    ai_enabled: true,
    is_default: true,
    restricted: false,
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: { sender_type: 'ai', sender_name: null, body: 'Hi there' },
    unread_count: 3,
  },
  {
    id: 'r2',
    name: 'Bills',
    ai_enabled: false,
    is_default: false,
    restricted: false,
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: { sender_type: 'user', sender_name: 'Bob', body: 'pay rent' },
    unread_count: 150,
  },
  {
    id: 'r3',
    name: 'Quiet',
    ai_enabled: false,
    is_default: false,
    restricted: false,
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: null,
    unread_count: 0,
  },
  {
    id: 'r4',
    name: 'Anon',
    ai_enabled: false,
    is_default: false,
    restricted: false,
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: { sender_type: 'user', sender_name: '', body: 'no name' },
    unread_count: 1,
  },
];

const ASSISTANT_ROOM = {
  id: 'ai',
  name: 'AI Budget Assistant',
  ai_enabled: true,
  is_default: false,
  is_assistant: true,
  restricted: false,
  created_by: 'u1',
  created_at: '2026-07-09T00:00:00.000Z',
  updated_at: '2026-07-09T00:00:00.000Z',
  last_message: null,
  unread_count: 0,
};

/** A project's general chat and one material chat beneath it. */
const PROJECT_ROOMS = [
  {
    id: 'p1',
    name: 'Kitchen Reno',
    ai_enabled: true,
    is_default: false,
    is_assistant: false,
    restricted: false,
    subject: {
      type: 'home_project',
      id: 'proj-1',
      label: 'Kitchen Reno',
      parent_id: null,
      parent_label: null,
      has_context: true,
    },
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: null,
    unread_count: 0,
  },
  {
    id: 'm1',
    name: 'Herringbone Oak',
    ai_enabled: true,
    is_default: false,
    is_assistant: false,
    restricted: false,
    subject: {
      type: 'home_project_material',
      id: 'mat-1',
      label: 'Herringbone Oak',
      parent_id: 'proj-1',
      parent_label: 'Kitchen Reno',
      has_context: true,
    },
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: null,
    unread_count: 0,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentHousehold = null;
  mockRooms = [];
  mockQueryResult = {
    isLoading: false,
    isRefetching: false,
    refetch: mockRefetch,
    data: undefined,
  };
  mockLastQueryOpts = null;
});

describe('BudgetChatRoomsListScreen', () => {
  it('shows the "no household selected" empty state and hides the New button', async () => {
    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('No household selected');
    expect(texts).toContain('Create or select a household to start chatting with your members.');
    // No household → no "+ New" header action.
    expect(tree.root.findAllByProps({ testID: 'chat-rooms-new-button' })).toHaveLength(0);

    // The empty state offers a "Create household" CTA that routes to the
    // households manager (Settings → HouseholdManagement).
    const cta = tree.root.findByProps({ testID: 'empty-state-action' });
    expect(allText(cta)).toContain('Create household');
    await act(async () => {
      cta.props.onPress();
    });
    expect(mockNavigateToHouseholds).toHaveBeenCalledTimes(1);
  });

  it('self-heals by fetching households when none is selected on mount', async () => {
    // The in-memory household store is null after a cold start / JS reload; the
    // screen should hydrate it rather than dead-ending on "No household selected".
    await renderScreen();
    expect(mockFetchHouseholds).toHaveBeenCalled();
  });

  it('does not re-fetch households when one is already selected', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    await renderScreen();
    expect(mockFetchHouseholds).not.toHaveBeenCalled();
  });

  it('shows a spinner while the rooms query is loading', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockQueryResult.isLoading = true;

    const tree = await renderScreen();
    expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('renders the empty conversation state whose action opens the create sheet', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = [];

    const tree = await renderScreen();
    const texts = allText(tree.root);
    expect(texts).toContain('No conversations yet');

    // The empty-state CTA opens the create bottom sheet.
    await act(async () => {
      tree.root.findByProps({ testID: 'empty-state-action' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'bottom-sheet' }).length).toBeGreaterThan(0);
  });

  it('renders each room with the right preview, AI chip and capped unread badge', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = ROOMS;

    const tree = await renderScreen();
    const texts = allText(tree.root);

    expect(texts).toContain('General');
    expect(texts).toContain('Assistant: Hi there'); // ai sender preview
    expect(texts).toContain('Bob: pay rent'); // named user preview
    expect(texts).toContain('No messages yet'); // no last_message
    expect(texts).toContain('no name'); // empty sender_name → no prefix
    expect(texts).toContain('99+'); // unread capped
    // AI chip only on the ai_enabled room (host elements only, one per chip).
    const chips = tree.root
      .findAllByProps({ testID: 'chip' })
      .filter((n) => typeof n.type === 'string');
    expect(chips).toHaveLength(1);
  });

  it('shows the dedicated assistant room as name + chip only, with no hint line', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = [ASSISTANT_ROOM];

    const tree = await renderScreen();
    const texts = allText(tree.root);
    expect(texts).toContain('AI Budget Assistant');
    // Assistant rooms swap the AI chip for a clearer "Assistant" label...
    expect(texts).toContain('Assistant');
    // ...and carry NO fallback subtitle: the row is the name, full stop. The
    // old hint explained an @assistant syntax this room never required.
    expect(texts).not.toContain('Ask me anything');
    expect(texts).not.toContain('No messages yet');
  });

  it('still previews the assistant’s last message when it has one', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = [
      {
        ...ASSISTANT_ROOM,
        last_message: { sender_type: 'ai', sender_name: null, body: 'Your water bill is up 12%' },
      },
    ];

    const tree = await renderScreen();
    // Dropping the fallback must not drop the preview — only the empty-room hint.
    expect(allText(tree.root)).toContain('Assistant: Your water bill is up 12%');
  });

  describe('filter tabs', () => {
    const HOUSE_ROOMS = [ASSISTANT_ROOM, ...PROJECT_ROOMS, ROOMS[1]]; // + "Bills"

    async function pressTab(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
      await act(async () => {
        tree.root.findByProps({ testID: `filter-tab-${id}` }).props.onPress();
      });
    }

    it('renders All / General / Projects / AI Assistant with All selected on arrival', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = HOUSE_ROOMS;

      const tree = await renderScreen(subjectConfig);
      const ids = tree.root
        .findByProps({ testID: 'filter-tabs' })
        .findAll(
          (n) =>
            typeof n.type === 'string' &&
            typeof n.props.testID === 'string' &&
            n.props.testID.startsWith('filter-tab-')
        )
        .map((n) => n.props.testID);
      expect(ids).toEqual([
        'filter-tab-all',
        'filter-tab-general',
        'filter-tab-projects',
        'filter-tab-assistant',
      ]);

      // "All" is the landing tab, and it hides nothing.
      expect(
        tree.root.findByProps({ testID: 'filter-tab-all' }).props.accessibilityState.selected
      ).toBe(true);
      const texts = allText(tree.root);
      expect(texts).toContain('AI Budget Assistant');
      expect(texts).toContain('Bills');
      expect(texts).toContain('Herringbone Oak');
    });

    it('drops the Projects tab for an app whose chats cannot belong to a project', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = [ASSISTANT_ROOM, ROOMS[1]];

      // Budget-shaped config (no `subjectHref`) → three tabs, not four.
      const tree = await renderScreen();
      expect(tree.root.findAllByProps({ testID: 'filter-tab-projects' })).toHaveLength(0);
      expect(tree.root.findAllByProps({ testID: 'filter-tab-general' }).length).toBeGreaterThan(0);
    });

    it('General shows only household rooms — no project chats, no assistant', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = HOUSE_ROOMS;

      const tree = await renderScreen(subjectConfig);
      await pressTab(tree, 'general');

      const texts = allText(tree.root);
      expect(texts).toContain('Bills');
      expect(texts).not.toContain('AI Budget Assistant');
      expect(texts).not.toContain('Herringbone Oak');
    });

    it('Projects shows the project chat and its materials only', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = HOUSE_ROOMS;

      const tree = await renderScreen(subjectConfig);
      await pressTab(tree, 'projects');

      const texts = allText(tree.root);
      expect(texts).toContain('Herringbone Oak');
      // The project's own chat renders as "General" under its section header.
      expect(texts).toContain('Kitchen Reno');
      expect(texts).not.toContain('Bills');
      expect(texts).not.toContain('AI Budget Assistant');
    });

    it('AI Assistant shows the assistant room alone', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = HOUSE_ROOMS;

      const tree = await renderScreen(subjectConfig);
      await pressTab(tree, 'assistant');

      const texts = allText(tree.root);
      expect(texts).toContain('AI Budget Assistant');
      expect(texts).not.toContain('Bills');
      expect(texts).not.toContain('Herringbone Oak');
    });

    it('gives an empty filter its own copy and withholds the create CTA on Projects', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = [ASSISTANT_ROOM]; // nothing project-scoped

      const tree = await renderScreen(subjectConfig);
      await pressTab(tree, 'projects');

      expect(allText(tree.root)).toContain('No project chats yet');
      // "New conversation" would create a HOUSEHOLD room — invisible from the
      // tab that offered it, so the CTA is withheld here.
      expect(tree.root.findAllByProps({ testID: 'empty-state-action' })).toHaveLength(0);
    });

    it('hides the tab row entirely while the household has no conversations', async () => {
      mockCurrentHousehold = { id: 'hh1' };
      mockRooms = [];

      const tree = await renderScreen(subjectConfig);
      expect(tree.root.findAllByProps({ testID: 'filter-tabs' })).toHaveLength(0);
      expect(allText(tree.root)).toContain('No conversations yet');
    });
  });

  it('navigates to a room when its card is pressed', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = ROOMS;

    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-rooms-first-room' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ChatRoom', {
      roomId: 'r1',
      roomName: 'General',
      aiEnabled: true,
    });
  });

  it('creates a room from the bottom sheet, invalidates, and opens it', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = ROOMS;
    mockCreateRoom.mockResolvedValue({ id: 'r9', name: 'Bills', ai_enabled: false });

    const tree = await renderScreen();

    // Open the create sheet via the header "+ New" button.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-rooms-new-button' }).props.onPress();
    });

    // Type a name and flip the AI toggle off.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-rooms-name-input' }).props.onChangeText('Bills');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'ui-toggle' }).props.onPress();
    });

    // Press Create.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-rooms-create-button' }).props.onPress();
      for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });

    expect(mockCreateRoom).toHaveBeenCalledWith('hh1', { name: 'Bills', ai_enabled: false });
    // Namespaced by the chat's app id (`test` in this harness) — House and
    // Budget rooms are different data sets and used to collide on a shared
    // `['chat','rooms',hid]` key.
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['chat', 'test', 'rooms', 'hh1'],
    });
    expect(mockNavigate).toHaveBeenCalledWith('ChatRoom', {
      roomId: 'r9',
      roomName: 'Bills',
      aiEnabled: false,
    });
  });

  it('ignores create with a blank name and closes the sheet on cancel', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    mockRooms = ROOMS;

    const tree = await renderScreen();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-rooms-new-button' }).props.onPress();
    });

    // Blank name → handleCreate returns early, no API call.
    await act(async () => {
      tree.root.findByProps({ testID: 'chat-rooms-create-button' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateRoom).not.toHaveBeenCalled();

    // Cancel closes the sheet.
    await act(async () => {
      tree.root.findByProps({ testID: 'button-Cancel' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'bottom-sheet' })).toHaveLength(0);
  });

  it('runs the query function (fetch + store hydrate) and refetches on focus', async () => {
    mockCurrentHousehold = { id: 'hh1' };
    const list = [{ id: 'x' }];
    mockListRooms.mockResolvedValue(list);

    await renderScreen();

    // The focus listener fired the refetch on mount.
    expect(mockRefetch).toHaveBeenCalled();

    // Drive the query function itself.
    expect(mockLastQueryOpts).toBeTruthy();
    let result: unknown;
    await act(async () => {
      result = await mockLastQueryOpts.queryFn();
    });
    expect(mockListRooms).toHaveBeenCalledWith('hh1');
    expect(mockSetRooms).toHaveBeenCalledWith(list);
    expect(result).toBe(list);
  });
});
