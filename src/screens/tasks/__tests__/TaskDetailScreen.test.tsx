/**
 * TaskDetailScreen — layout contract for iPhone and iPad.
 *
 * The detail view is shown two ways:
 *  1. Full-screen push (Tasks tab) — AppBackground + optional sidebar inset.
 *  2. Bottom sheet (Home tab) — solid surface, NO sidebar inset, NO scenic
 *     background (those caused the split "image left / cramped text right" bug).
 *
 * These tests mock data fetching so we assert the rendered chrome only.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@config/env', () => ({
  ENV: {
    API_BASE_URL: 'https://api.test',
    TIMEOUTS: { API_REQUEST: 10000 },
  },
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    ScrollView: RN.ScrollView,
    TouchableOpacity: RN.TouchableOpacity,
  };
});

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const navigationMock = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    getParent: () => ({ navigate: jest.fn() }),
  };
  return {
    ...actual,
    useNavigation: () => navigationMock,
    useRoute: () => ({ params: { taskId: 't_detail_01', householdId: 'hh_01' } }),
    useFocusEffect: jest.fn(),
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector: (s: { currentHousehold: { id: string } | null }) => unknown) =>
    selector({ currentHousehold: { id: 'hh_01' } }),
}));

jest.mock('@hooks/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({
    data: [{ user_id: 'u1', display_name: 'Mira' }],
    isLoading: false,
  }),
}));

const mockUpdateMaintenanceTask = jest.fn();
const mockRemoveMaintenanceTask = jest.fn();
jest.mock('@stores/taskStore', () => ({
  useTaskStore: () => ({
    updateMaintenanceTask: mockUpdateMaintenanceTask,
    removeMaintenanceTask: mockRemoveMaintenanceTask,
  }),
}));

jest.mock('@stores/tabBarVisibilityStore', () => ({
  useTabBarVisibilityStore: (selector: (s: { isSidebarVisible: boolean }) => unknown) =>
    selector({ isSidebarVisible: true }),
}));

jest.mock('@services/toastManager', () => ({
  showToast: jest.fn(),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children ?? null);
  return {
    __esModule: true,
    AppBackground: passthrough,
    SafeAreaView: passthrough,
    SheetHeader: ({
      title,
      onLeftPress,
      rightElement,
      rightLabel,
      onRightPress,
      leftTestID,
      rightTestID,
      testID,
    }: Record<string, unknown>) =>
      React.createElement(
        View,
        { testID },
        title ? React.createElement(Text, null, title) : null,
        onLeftPress
          ? React.createElement(TouchableOpacity, {
              onPress: onLeftPress,
              testID: leftTestID,
            })
          : null,
        rightElement ??
          (rightLabel
            ? React.createElement(TouchableOpacity, {
                onPress: onRightPress,
                testID: rightTestID,
              }, React.createElement(Text, null, rightLabel))
            : null)
      ),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
      rightElement,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        { testID: 'task-detail-header' },
        title ? React.createElement(Text, null, title) : null,
        showBackButton
          ? React.createElement(TouchableOpacity, { onPress: onBackPress })
          : null,
        rightElement ?? null
      ),
    ScreenScrollEnd: () => null,
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('@components/tasks/SubtaskList', () => ({
  SubtaskList: () => null,
}));

jest.mock('@components/tasks/TaskActivityFeed', () => ({
  TaskActivityFeed: () => null,
}));

// Capture the completion modal's props so tests can invoke onComplete without
// driving the (mocked-away) modal UI. The real modal collects notes/photos and
// then calls onComplete — we simulate that call directly.
const mockCompletionModalProps: {
  onComplete?: (data: { notes: string; photos: string[] }) => Promise<void>;
} = {};
jest.mock('@components/maintenance/TaskCompletionModal', () => ({
  TaskCompletionModal: (props: {
    onComplete?: (data: { notes: string; photos: string[] }) => Promise<void>;
  }) => {
    mockCompletionModalProps.onComplete = props.onComplete;
    return null;
  },
}));

jest.mock('@components/tasks/AssigneePickerSheet', () => ({
  AssigneePickerSheet: () => null,
}));

jest.mock('@components/tasks/WorkflowStageIndicator', () => ({
  WorkflowStageIndicator: () => null,
}));

jest.mock('@components/tasks/TaskDetailBottomSheet', () => ({
  TaskDetailBottomSheet: () => null,
}));

jest.mock('@api/tasks', () => ({
  tasksApi: {
    get: jest.fn(),
    getHistory: jest.fn(),
    getTaskQuotes: jest.fn().mockResolvedValue({ quotes: [] }),
    listSubtasks: jest.fn().mockResolvedValue([]),
    complete: jest.fn(),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { tasksApi } from '@api/tasks';
import type { Task } from '@api/tasks';
import { TaskDetailSheetOnBackContext } from '@contexts/index';
import { SchemeScope } from '@contexts/SchemeContext';
import { ThemeProvider } from '@contexts/ThemeContext';
import { TaskDetailScreen } from '@screens/tasks/TaskDetailScreen';
import { showToast } from '@services/toastManager';
import type { ColorScheme } from '@stores/appStore';

import {
  ALL_DEVICES,
  IPADS,
  setDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const DAY = 1000 * 60 * 60 * 24;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't_detail_01',
    system_category: 'landscaping',
    title: 'Water the plants',
    description:
      'Water indoor or outdoor plants as part of regular maintenance. Assuming this is routine plant care rather than a one-time task.',
    frequency: 'weekly',
    custom_interval_days: null,
    next_due_date: iso(2),
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'ai_generated',
    priority_severity: 'medium',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: iso(-1),
    updated_at: iso(-1),
    is_personal: false,
    created_by: 'u1',
    subtasks: [],
    ...overrides,
  };
}

function collectPaddingLefts(node: unknown, acc: number[] = []): number[] {
  if (!node || typeof node !== 'object') return acc;
  const record = node as Record<string, unknown>;

  if (record.props && typeof record.props === 'object') {
    const style = (record.props as { style?: unknown }).style;
    const styles = Array.isArray(style) ? style : style ? [style] : [];
    for (const entry of styles) {
      if (entry && typeof entry === 'object' && 'paddingLeft' in entry) {
        const pl = (entry as { paddingLeft?: number }).paddingLeft;
        if (typeof pl === 'number') acc.push(pl);
      }
    }
  }

  const children = record.children;
  if (Array.isArray(children)) {
    for (const child of children) collectPaddingLefts(child, acc);
  } else if (children) {
    collectPaddingLefts(children, acc);
  }
  return acc;
}

function maxPaddingLeft(node: unknown): number {
  const values = collectPaddingLefts(node);
  return values.length ? Math.max(...values) : 0;
}

function hasScenicBackground(node: unknown): boolean {
  const json = JSON.stringify(node);
  return json.includes('splash-light') || json.includes('splash-dark');
}

function mergedStyle(node: ReactTestRenderer.ReactTestInstance): Record<string, unknown> {
  const style = node.props?.style;
  const styles = Array.isArray(style) ? style : style ? [style] : [];
  return Object.assign({}, ...styles.filter(Boolean));
}

function findPressableWithLabel(
  r: ReactTestRenderer.ReactTestRenderer,
  label: string
): ReactTestRenderer.ReactTestInstance | undefined {
  return r.root.findAll(
    (n) => typeof (n.props as { onPress?: unknown })?.onPress === 'function',
    { deep: true }
  ).find((btn) => {
    try {
      return (
        btn.findAll(
          (n) => typeof n.props?.children === 'string' && String(n.props.children).includes(label),
          { deep: true }
        ).length > 0
      );
    } catch {
      return false;
    }
  });
}

const mockSheetOnBack = jest.fn();

async function renderDetail(opts?: {
  inSheet?: boolean;
  device?: DeviceName;
  task?: Partial<Task>;
  scheme?: ColorScheme;
}) {
  const task = makeTask(opts?.task);
  (tasksApi.get as jest.Mock).mockResolvedValue({ task });
  (tasksApi.getHistory as jest.Mock).mockResolvedValue({ completions: [] });

  if (opts?.device) setDevice(opts.device);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SchemeScope scheme={opts?.scheme ?? 'clean'}>
        <ThemeProvider>
          <TaskDetailSheetOnBackContext.Provider value={opts?.inSheet ? mockSheetOnBack : null}>
            <TaskDetailScreen />
          </TaskDetailSheetOnBackContext.Provider>
        </ThemeProvider>
      </SchemeScope>
    );
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TaskDetailScreen — content', () => {
  it('renders the full task title (not truncated)', async () => {
    const r = await renderDetail();
    expect(treeText(r)).toContain('Water the plants');
    expect(treeText(r)).not.toContain('Water the pla...');
  });

  it('surfaces cadence & due as compact chips, and the assignee as an actionable row', async () => {
    const r = await renderDetail();
    const text = treeText(r);
    // Recurring cadence and due countdown show as compact chips…
    expect(text).toContain('Weekly');
    expect(text).toContain('Due in');
    // …and the old busy "Frequency: value" label row is gone.
    expect(text).not.toContain('Frequency');
    // The assignee stays a labeled, tappable row (avatar + name when assigned,
    // or "Assign" when unassigned) so it remains actionable — not a passive chip.
    const assignee = r.root.findByProps({ testID: 'task-detail-assignee' });
    expect(assignee).toBeTruthy();
    expect(assignee.props.onPress).toEqual(expect.any(Function));
    expect(text).toContain('Assigned to:');
    expect(text).toContain('Assign');
  });

  it('shows primary actions', async () => {
    const r = await renderDetail();
    const text = treeText(r);
    expect(text).toContain('Complete');
    expect(text).toContain('Pause');
    expect(text).toContain('Delete');
  });

  it('hides the contractor CTA for tasks that do not need a pro', async () => {
    const r = await renderDetail({ task: { needs_contractor: false } });
    expect(treeText(r)).not.toContain('Find a Contractor');
  });

  it('shows the contractor CTA only when the task needs a pro', async () => {
    const r = await renderDetail({ task: { needs_contractor: true } });
    expect(treeText(r)).toContain('Find a Contractor');
  });

  it('shows attachment photos and marks the cover image', async () => {
    const r = await renderDetail({
      task: {
        photos: [
          {
            id: 'p1',
            photo_key: 'maintenance-photos/h1/a.jpg',
            photo_url: 'https://api.example/files/maintenance-photos/h1/a.jpg',
            sort_order: 0,
          },
          {
            id: 'p2',
            photo_key: 'maintenance-photos/h1/b.jpg',
            photo_url: 'https://api.example/files/maintenance-photos/h1/b.jpg',
            sort_order: 1,
          },
        ],
        cover_photo_id: 'p2',
        cover_photo_url: 'https://api.example/files/maintenance-photos/h1/b.jpg',
      },
    });
    expect(treeText(r)).toContain('Cover');
  });
});

describe('TaskDetailScreen — action row buttons', () => {
  it('Pause and Delete share equal flex row buttons at the compact height', async () => {
    const r = await renderDetail({ inSheet: true, device: 'iPad Pro 11 (portrait)' });
    const pause = findPressableWithLabel(r, 'Pause');
    const del = findPressableWithLabel(r, 'Delete');
    expect(pause).toBeTruthy();
    expect(del).toBeTruthy();

    const pauseSlot = pause!.parent!;
    const deleteSlot = del!.parent!;
    expect(mergedStyle(pauseSlot).flex).toBe(1);
    expect(mergedStyle(deleteSlot).flex).toBe(1);
    expect(mergedStyle(pauseSlot).flexBasis).toBe(0);
    expect(mergedStyle(deleteSlot).flexBasis).toBe(0);

    const pauseStyle = mergedStyle(pause!);
    const deleteStyle = mergedStyle(del!);
    // Compact action row — shorter than the old 48pt buttons.
    expect(pauseStyle.minHeight).toBeGreaterThanOrEqual(30);
    expect(pauseStyle.minHeight).toBeLessThan(48);
    expect(deleteStyle.minHeight).toBeGreaterThanOrEqual(30);
    expect(pauseStyle.width).toBe('100%');
    expect(deleteStyle.width).toBe('100%');
    expect(pauseStyle.justifyContent).toBe('center');
    expect(deleteStyle.justifyContent).toBe('center');
  });

  it('Complete shares the same equal-width row as Pause and Delete', async () => {
    const r = await renderDetail({ inSheet: true, device: 'iPhone 14 Pro' });
    const complete = findPressableWithLabel(r, 'Complete');
    const pause = findPressableWithLabel(r, 'Pause');
    expect(complete).toBeTruthy();
    expect(pause).toBeTruthy();
    expect(mergedStyle(complete!.parent!).flex).toBe(1);
    expect(mergedStyle(pause!.parent!).flex).toBe(1);
    const style = mergedStyle(pause!);
    expect(style.minHeight).toBeGreaterThanOrEqual(30);
    expect(style.width).toBe('100%');
  });
});

describe('TaskDetailScreen — bottom sheet (Home) layout', () => {
  it.each(IPADS.map((d) => [d] as [DeviceName]))(
    'does not reserve sidebar inset inside sheet on %s',
    async (device) => {
      const r = await renderDetail({ inSheet: true, device });
      expect(maxPaddingLeft(r.toJSON())).toBeLessThan(100);
    }
  );

  it.each(IPADS.map((d) => [d] as [DeviceName]))(
    'uses a solid surface (no scenic AppBackground) in sheet on %s',
    async (device) => {
      const r = await renderDetail({ inSheet: true, device });
      expect(hasScenicBackground(r.toJSON())).toBe(false);
    }
  );
});

describe('TaskDetailScreen — full-screen (Tasks tab) layout', () => {
  // The scenic/aurora splash was retired: AppBackground is now a flat,
  // theme-following surface, so full-screen never renders a splash regardless
  // of the (legacy) schema.
  it('uses a solid (non-scenic) background full-screen in the legacy House schema', async () => {
    const r = await renderDetail({
      inSheet: false,
      device: 'iPad Pro 11 (landscape)',
      scheme: 'house',
    });
    expect(hasScenicBackground(r.toJSON())).toBe(false);
  });

  it('uses a solid (non-scenic) background full-screen in the default Clean schema', async () => {
    const r = await renderDetail({
      inSheet: false,
      device: 'iPad Pro 11 (landscape)',
      scheme: 'clean',
    });
    expect(hasScenicBackground(r.toJSON())).toBe(false);
  });
});

describe('TaskDetailScreen — every device', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))('mounts without crash on %s', async (device) => {
    const r = await renderDetail({ inSheet: true, device });
    expect(r.toJSON()).toBeTruthy();
    expect(treeText(r)).toContain('Task Details');
  });
});

describe('TaskDetailScreen — completion flow', () => {
  const completeResponse = (overrides?: Partial<Task>) => ({
    task: makeTask({ is_active: false, ...overrides }),
    completion: { id: 'c1', completed_at: iso(0), notes: null },
  });

  it('in a sheet: completes the API call, updates the store, toasts success, and closes the sheet', async () => {
    const response = completeResponse();
    (tasksApi.complete as jest.Mock).mockResolvedValue(response);

    await renderDetail({ inSheet: true });
    expect(mockCompletionModalProps.onComplete).toBeDefined();

    await act(async () => {
      await mockCompletionModalProps.onComplete!({ notes: 'done', photos: [] });
    });

    expect(tasksApi.complete).toHaveBeenCalledWith('hh_01', 't_detail_01', {
      notes: 'done',
      photo_keys: undefined,
    });
    expect(mockUpdateMaintenanceTask).toHaveBeenCalledWith('t_detail_01', response.task);
    expect(showToast).toHaveBeenCalledWith('success', 'Task completed!');
    // The sheet presentation closes via its onBack callback.
    expect(mockSheetOnBack).toHaveBeenCalled();
  });

  it('full-screen: navigates back after completing', async () => {
    (tasksApi.complete as jest.Mock).mockResolvedValue(completeResponse());

    await renderDetail({ inSheet: false });

    await act(async () => {
      await mockCompletionModalProps.onComplete!({ notes: '', photos: [] });
    });

    expect(tasksApi.complete).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('success', 'Task completed!');
    const nav = jest.requireMock('@react-navigation/native') as {
      useNavigation: () => { goBack: jest.Mock };
    };
    expect(nav.useNavigation().goBack).toHaveBeenCalled();
  });
});

describe('photos authored on another device', () => {
  /**
   * A task photo taken on a peer's phone arrives as an H6 DESCRIPTOR, and its
   * `photo_url` is deliberately the empty string — `buildPhotoRows` refuses to
   * fabricate a `/files/lf-blob/...` link for bytes that are AES-GCM sealed in
   * R2. So a screen that renders `photo_url` renders nothing at all: the row
   * synced perfectly and the member sees a grey box, which is exactly how "our
   * images do not sync" is reported when the sync is in fact fine.
   */
  const blobPhoto = {
    id: 'tp_from_peer',
    photo_key: 'lf-blob/blob_deadbeef',
    photo_url: '',
    sort_order: 0,
    blob: {
      blobId: 'blob_deadbeef',
      mime: 'image/jpeg',
      bytes: 2048,
      sha256: 'a'.repeat(64),
      chunkCount: 1,
      keyEpoch: 1,
    },
  };

  it('renders the descriptor rather than the empty url', async () => {
    const r = await renderDetail({ task: { photos: [blobPhoto] } as Partial<Task> });

    const rendered = r.root.findByProps({ testID: 'task-detail-photo-blob-0' });
    expect(rendered).toBeTruthy();
    expect(rendered.props.descriptor).toEqual(blobPhoto.blob);
    // Scoped to the property the task belongs to: the blob content key is
    // derived from THAT home's HDK, so resolving it against the active one
    // would derive a wrong key for a task opened from another property.
    expect(rendered.props.householdId).toBe('hh_01');
  });

  it('still renders a legacy server-backed photo by url', async () => {
    // A server-backed household has real `/files/<key>` URLs and no descriptor.
    // The blob path must not swallow those.
    const legacy = {
      id: 'tp_legacy',
      photo_key: 'tasks/hh_01/legacy.jpg',
      photo_url: 'https://api.test/files/tasks/hh_01/legacy.jpg',
      sort_order: 0,
    };

    const r = await renderDetail({ task: { photos: [legacy] } as Partial<Task> });

    expect(r.root.findAllByProps({ testID: 'task-detail-photo-blob-0' })).toHaveLength(0);
    // Asserted by walking for the uri rather than matching `source` whole:
    // React Native rewrites an Image's `source` on the way to the host node, so
    // a deep-equal on the prop object matches nothing even when the URL is used.
    const uris = r.root
      .findAll(
        (node) =>
          typeof (node.props as { source?: { uri?: string } })?.source?.uri === 'string',
        { deep: true },
      )
      .map((node) => (node.props as { source: { uri: string } }).source.uri);
    expect(uris).toContain(legacy.photo_url);
  });
});
