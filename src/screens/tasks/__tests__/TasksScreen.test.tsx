/**
 * TasksScreen — the main Tasks tab (a core Simple House feature).
 *
 * Covers the screen's real behaviours: it mounts on iPhone AND iPad, renders the
 * Add-Task FAB and (when there are tasks) the search bar, opens the Add-Task
 * sheet from the FAB, and handles its corner cases — the no-household guard, the
 * global data-loading guard, the "no tasks at all" empty state (which hides the
 * summary/filter/search chrome) vs. the "filtered to empty" empty state (which
 * keeps them), and the iPad split-view layout that appears past the 1024pt
 * breakpoint. Stores, api and heavy child components are mocked so the screen
 * mounts in isolation; useTaskBoardData / useDeviceType / SearchBar / Typography
 * stay REAL so filtering, the device-size branch and the search input are
 * exercised for real.
 */

// deviceRender drives useDeviceType (and useLayoutPadding) via a mocked
// useWindowDimensions — hoisted so setDevice() can point it at any device size.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// useIsFocused / useFocusEffect (imported by the screen from
// expo-router/react-navigation → @react-navigation/native) need a real
// navigation container; stub them so the screen mounts standalone.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useIsFocused: () => true,
    useFocusEffect: jest.fn(),
  };
});

// expo-linear-gradient — the FAB wraps its label in a gradient; render children.
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    LinearGradient: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(View, rest, children),
  };
});

// ===== Mutable mock state (reset in beforeEach) =====
const DAY = 1000 * 60 * 60 * 24;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

type MockTask = Record<string, unknown> & { id: string; title: string };

function makeTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: 't_main_01',
    system_category: 'landscaping',
    title: 'Water the plants',
    description: 'Routine plant care',
    frequency: 'weekly',
    custom_interval_days: null,
    next_due_date: iso(3),
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    priority_severity: 'medium',
    enrichment_status: 'enriched',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: false,
    needs_contractor: false,
    contractor_category: null,
    created_at: iso(-5),
    updated_at: iso(-5),
    is_personal: false,
    created_by: 'u1',
    ...overrides,
  };
}

const mockHouseholdState: { currentHousehold: { id: string; name?: string } | null } = {
  currentHousehold: { id: 'hh_01', name: 'Maple House' },
};

const mockDataState: { isLoading: boolean } = { isLoading: false };

const mockTaskState: {
  upcomingTasks: MockTask[];
  maintenanceTasks: MockTask[];
  setUpcomingTasks: jest.Mock;
  setMaintenanceTasks: jest.Mock;
  updateMaintenanceTask: jest.Mock;
  isLoading: boolean;
  setLoading: jest.Mock;
  error: string | null;
  setError: jest.Mock;
  pendingTaskNavigation: string | null;
  setPendingTaskNavigation: jest.Mock;
} = {
  upcomingTasks: [],
  maintenanceTasks: [],
  setUpcomingTasks: jest.fn(),
  setMaintenanceTasks: jest.fn(),
  updateMaintenanceTask: jest.fn(),
  isLoading: false,
  setLoading: jest.fn(),
  error: null,
  setError: jest.fn(),
  pendingTaskNavigation: null,
  setPendingTaskNavigation: jest.fn(),
};

const emptyFilters = {
  mineOnly: false,
  dueTodayOnly: false,
  hideDone: false,
  assigneeIds: [],
  spaceIds: [],
  priorities: [],
  statuses: [],
  personalOnly: false,
};

const mockTaskBoardState = {
  viewMode: 'list' as 'list' | 'board',
  groupBy: 'status' as const,
  filters: emptyFilters,
  toggleMineOnly: jest.fn(),
  toggleDueTodayOnly: jest.fn(),
  toggleStatus: jest.fn(),
};

// Captured Add-Task sheet props so a test can drive its callbacks.
const addSheetProps: {
  visible?: boolean;
  onCopyExisting?: () => void;
  onAddFromTemplates?: () => void;
} = {};

// ===== Store / context / api mocks =====
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: typeof mockHouseholdState) => unknown) =>
    selector ? selector(mockHouseholdState) : mockHouseholdState,
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@hooks/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({
    data: [{ user_id: 'u1', display_name: 'Mira' }],
    isLoading: false,
  }),
}));

jest.mock('@stores/spaceStore', () => ({
  useSpaceStore: (selector: (s: { setSpaces: jest.Mock }) => unknown) =>
    selector({ setSpaces: jest.fn() }),
}));

jest.mock('@stores/taskStore', () => ({
  useTaskStore: (selector?: (s: typeof mockTaskState) => unknown) =>
    selector ? selector(mockTaskState) : mockTaskState,
}));

jest.mock('@stores/taskBoardStore', () => ({
  useTaskBoardStore: (selector?: (s: typeof mockTaskBoardState) => unknown) =>
    selector ? selector(mockTaskBoardState) : mockTaskBoardState,
}));

jest.mock('@contexts/DataContext', () => ({
  useData: () => mockDataState,
}));

jest.mock('@hooks/useFeature', () => ({
  useFeature: jest.fn(() => true),
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

jest.mock('@api/tasks', () => ({
  tasksApi: {
    getUpcoming: jest.fn().mockResolvedValue({ tasks: [] }),
    list: jest.fn().mockResolvedValue({ tasks: [] }),
    complete: jest.fn().mockResolvedValue({ task: {} }),
  },
}));

jest.mock('@api/household-spaces', () => ({
  householdSpacesApi: { list: jest.fn().mockResolvedValue({ spaces: [] }) },
}));

// ===== Chrome + heavy child stubs =====
// ScreenHeader real pulls in ProfileProvider + notification wiring; AppBackground
// pulls scenic assets. Neither is the subject here (other suites cover them).
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'app-background' }, children ?? null),
    ScreenHeader: () => React.createElement(View, { testID: 'screen-header' }),
    ScreenScrollEnd: () => React.createElement(View, { testID: 'screen-scroll-end' }),
    screenScrollEndTestId: (id: string) => id,
  };
});

// AdaptiveContainer forwards maxWidth (1400 on tablets, undefined on phones);
// SplitView renders master + detail so the iPad split-view branch is observable.
jest.mock('@components/layout', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AdaptiveContainer: ({ children, maxWidth }: { children?: React.ReactNode; maxWidth?: number }) =>
      React.createElement(View, { testID: 'adaptive-container', maxWidth }, children),
    SplitView: ({ master, detail }: { master?: React.ReactNode; detail?: React.ReactNode }) =>
      React.createElement(View, { testID: 'split-view' }, master, detail),
  };
});

jest.mock('@components/maintenance', () => ({
  __esModule: true,
  TaskCompletionModal: () => null,
}));

jest.mock('@navigation/TaskDetailStackHost', () => ({
  __esModule: true,
  TaskDetailStackHost: () => null,
}));

jest.mock('@components/tasks', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    AddTaskSheet: (props: {
      visible?: boolean;
      onCopyExisting?: () => void;
      onAddFromTemplates?: () => void;
    }) => {
      addSheetProps.visible = props.visible;
      addSheetProps.onCopyExisting = props.onCopyExisting;
      addSheetProps.onAddFromTemplates = props.onAddFromTemplates;
      return props.visible ? React.createElement(View, { testID: 'add-task-sheet' }) : null;
    },
    TaskSummaryBar: () => React.createElement(View, { testID: 'task-summary-bar' }),
    TaskFilterControls: () => React.createElement(View, { testID: 'task-filter-controls' }),
    TaskBoardColumn: ({ section }: { section: { title: string } }) =>
      React.createElement(View, { testID: 'task-board-column' }, React.createElement(Text, null, section.title)),
    TaskCardItem: ({ task }: { task: { title: string } }) =>
      React.createElement(View, { testID: 'task-card' }, React.createElement(Text, null, task.title)),
  };
});

import React from 'react';
import { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';

import { TasksScreen } from '@screens/tasks/TasksScreen';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  renderOnDevice,
  type DeviceName,
} from '../../../test-utils/deviceRender';

/**
 * Flatten every string/number the tree renders. We walk instances rather than
 * `JSON.stringify(toJSON())` because the list ScrollView takes a
 * `refreshControl={<RefreshControl/>}` element prop whose React-element value
 * has circular refs that break JSON serialization.
 */
function screenText(r: ReturnType<typeof renderOnDevice>): string {
  return r.root
    .findAll((n) => {
      const c = (n.props as { children?: unknown })?.children;
      return typeof c === 'string' || typeof c === 'number';
    })
    .map((n) => String((n.props as { children: unknown }).children))
    .join(' ');
}

/** First pressable whose rendered subtree contains `text`. */
function pressableWithText(
  r: ReturnType<typeof renderOnDevice>,
  text: string
): ReactTestInstance | undefined {
  return r.root
    .findAll((n) => typeof (n.props as { onPress?: unknown })?.onPress === 'function')
    .find(
      (btn) =>
        btn.findAll(
          (n) =>
            typeof (n.props as { children?: unknown })?.children === 'string' &&
            String((n.props as { children: string }).children).includes(text)
        ).length > 0
    );
}

const mockNavigation = { navigate: jest.fn(), goBack: jest.fn(), push: jest.fn() };

function makeProps() {
  return {
    navigation: mockNavigation,
    route: { key: 'TasksMain', name: 'TasksMain' },
  } as any;
}

/** Render at a device size and flush loadData's async settle. */
async function renderScreen(device: DeviceName) {
  const r = renderOnDevice(device, <TasksScreen {...makeProps()} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
}

/** Host/composite nodes carrying this testID. */
function allByTestID(r: ReturnType<typeof renderOnDevice>, testID: string) {
  return r.root.findAll((n) => (n.props as { testID?: string })?.testID === testID);
}

/** The pressable (onPress-bearing) instance with this testID. */
function pressByTestID(r: ReturnType<typeof renderOnDevice>, testID: string) {
  return r.root.findAll(
    (n) =>
      (n.props as { testID?: string })?.testID === testID &&
      typeof (n.props as { onPress?: unknown })?.onPress === 'function'
  )[0];
}

/** The text-input (onChangeText-bearing) instance with this testID. */
function inputByTestID(r: ReturnType<typeof renderOnDevice>, testID: string) {
  return r.root.findAll(
    (n) =>
      (n.props as { testID?: string })?.testID === testID &&
      typeof (n.props as { onChangeText?: unknown })?.onChangeText === 'function'
  )[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseholdState.currentHousehold = { id: 'hh_01', name: 'Maple House' };
  mockDataState.isLoading = false;
  mockTaskState.upcomingTasks = [makeTask()];
  mockTaskState.maintenanceTasks = [
    makeTask({ id: 't_main_02', title: 'Clean gutters', next_due_date: iso(10) }),
  ];
  mockTaskState.isLoading = false;
  mockTaskState.error = null;
  mockTaskState.pendingTaskNavigation = null;
  mockTaskBoardState.viewMode = 'list';
  mockTaskBoardState.filters = emptyFilters;
  addSheetProps.visible = undefined;
});

describe('TasksScreen — layout', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'mounts the tasks screen with the Add-Task FAB and search bar on %s',
    async (device) => {
      const r = await renderScreen(device);
      expect(allByTestID(r, 'tasks-screen').length).toBeGreaterThan(0);
      expect(pressByTestID(r, 'tasks-add-fab')).toBeTruthy();
      // Search + summary + filter chrome show because the household HAS tasks.
      expect(allByTestID(r, 'tasks-search-bar').length).toBeGreaterThan(0);
      expect(allByTestID(r, 'task-summary-bar').length).toBeGreaterThan(0);
      // The real Typography renders the task titles the board grouped.
      expect(screenText(r)).toContain('Water the plants');
    }
  );

  it('caps content width at 1400 on iPad but not on iPhone', async () => {
    const ipad = await renderScreen('iPad Pro 11 (portrait)');
    expect(allByTestID(ipad, 'adaptive-container')[0].props.maxWidth).toBe(1400);

    const phone = await renderScreen('iPhone 14 Pro');
    expect(allByTestID(phone, 'adaptive-container')[0].props.maxWidth).toBeUndefined();
  });
});

describe('TasksScreen — add task flow', () => {
  it('opens the Add-Task sheet when the FAB is tapped', async () => {
    const r = await renderScreen('iPhone 14 Pro');
    // Sheet starts hidden.
    expect(allByTestID(r, 'add-task-sheet').length).toBe(0);
    expect(addSheetProps.visible).toBe(false);

    await act(async () => {
      pressByTestID(r, 'tasks-add-fab').props.onPress();
    });

    expect(addSheetProps.visible).toBe(true);
    expect(allByTestID(r, 'add-task-sheet').length).toBeGreaterThan(0);
  });

  it('routes the sheet "copy existing" and "from templates" actions to their screens', async () => {
    await renderScreen('iPad Pro 11 (portrait)');
    expect(addSheetProps.onCopyExisting).toEqual(expect.any(Function));

    act(() => addSheetProps.onCopyExisting!());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('CopyFromExistingTasks');

    act(() => addSheetProps.onAddFromTemplates!());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('TaskTemplates');
  });

  it('navigates to the time-budget planner from the assistant shortcut', async () => {
    const r = await renderScreen('iPhone 14 Pro');
    // The "What can I do right now?" shortcut shows when tasks exist AND the
    // smartTaskAssistant feature is on (mocked true).
    const btn = pressableWithText(r, 'What can I do right now?');
    expect(btn).toBeTruthy();
    act(() => btn!.props.onPress());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('TimeBudgetPlanner');
  });
});

describe('TasksScreen — search', () => {
  it('updates the query and shows the filtered-empty state when nothing matches', async () => {
    const r = await renderScreen('iPhone 14 Pro');
    expect(screenText(r)).toContain('Water the plants');

    await act(async () => {
      inputByTestID(r, 'tasks-search-input').props.onChangeText('zzz-no-such-task');
    });

    // The controlled input reflects the new value…
    expect(inputByTestID(r, 'tasks-search-input').props.value).toBe('zzz-no-such-task');
    // …and the board is now empty, but because the household DOES have tasks the
    // empty state offers to clear filters (chrome stays) rather than "add first".
    const text = screenText(r);
    expect(text).toContain('No tasks here');
    expect(text).toContain('Try clearing filters or add a new task.');
    expect(text).not.toContain('Water the plants');
  });
});

describe('TasksScreen — corner cases', () => {
  it('shows the no-household guard (no tasks-screen, no FAB) when no home is selected', async () => {
    mockHouseholdState.currentHousehold = null;
    const r = await renderScreen('iPhone 14 Pro');
    const text = screenText(r);
    expect(text).toContain('No Home Selected');
    expect(text).toContain('Create or select a home to view tasks');
    expect(allByTestID(r, 'tasks-screen').length).toBe(0);
    expect(pressByTestID(r, 'tasks-add-fab')).toBeUndefined();
  });

  it('shows the global loading guard while DataContext is still loading', async () => {
    mockDataState.isLoading = true;
    const r = await renderScreen('iPad Pro 11 (portrait)');
    expect(screenText(r)).toContain('Loading...');
    expect(allByTestID(r, 'tasks-screen').length).toBe(0);
  });

  it('shows the "add your first task" empty state and hides search chrome when there are no tasks', async () => {
    mockTaskState.upcomingTasks = [];
    mockTaskState.maintenanceTasks = [];
    const r = await renderScreen('iPhone 14 Pro');
    const text = screenText(r);
    // Empty-first-run copy differs from the filtered-empty copy.
    expect(text).toContain('No tasks here');
    expect(text).toContain('Add your first task to get started.');
    // Summary / filters / search are suppressed as noise on an empty board…
    expect(allByTestID(r, 'tasks-search-bar').length).toBe(0);
    expect(allByTestID(r, 'task-summary-bar').length).toBe(0);
    // …but the FAB stays so the user can add their first task.
    expect(pressByTestID(r, 'tasks-add-fab')).toBeTruthy();
  });
});

describe('TasksScreen — iPad split view', () => {
  it.each(
    (['iPad Pro 12.9 (portrait)', 'iPad Pro 11 (landscape)'] as DeviceName[]).map(
      (d) => [d] as [DeviceName]
    )
  )('uses the master/detail split view past the 1024pt breakpoint on %s', async (device) => {
    const r = await renderScreen(device);
    expect(allByTestID(r, 'split-view').length).toBeGreaterThan(0);
    // With nothing selected the detail pane shows its placeholder.
    expect(screenText(r)).toContain('Select a task');
    // The master pane still carries the screen + FAB.
    expect(allByTestID(r, 'tasks-screen').length).toBeGreaterThan(0);
    expect(pressByTestID(r, 'tasks-add-fab')).toBeTruthy();
  });

  it.each(PHONES.concat(IPADS.filter((d) => d.includes('portrait') && d.includes('11'))).map(
    (d) => [d] as [DeviceName]
  ))('renders a single-pane layout (no split view) on %s', async (device) => {
    const r = await renderScreen(device);
    expect(allByTestID(r, 'split-view').length).toBe(0);
    expect(screenText(r)).not.toContain('Select a task');
  });
});
