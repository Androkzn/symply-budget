/**
 * TaskDetailStackNavigator — nested detail → edit stack.
 *
 * Edit must push ScheduleTask inside this stack (card push), not as a sibling
 * modal on the parent Tasks stack — that pattern breaks iPad touch handling.
 */

// This suite exercises the REAL nested detail→edit native-stack (that is the
// whole point — verifying edit pushes as a card inside this stack on iPhone AND
// iPad). jest.setup.js globally stubs @react-navigation/native-stack to an inert
// navigator (Screen renders null) so unrelated suites don't crash; opt out here
// so the navigator actually mounts its screens.
jest.unmock('@react-navigation/native-stack');

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 834, height: 1194, scale: 2, fontScale: 1 })),
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
    GestureHandlerRootView: RN.View,
    ScrollView: RN.ScrollView,
    TouchableOpacity: RN.TouchableOpacity,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const inset = { top: 24, bottom: 20, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 834, height: 1194 };
  const PassThrough = ({ children, style }: { children?: React.ReactNode; style?: object }) =>
    React.createElement(View, { style: [{ flex: 1 }, style] }, children);
  return {
    SafeAreaProvider: PassThrough,
    SafeAreaView: PassThrough,
    SafeAreaInsetsContext: React.createContext(inset),
    SafeAreaFrameContext: React.createContext(frame),
    initialWindowMetrics: { insets: inset, frame },
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
  };
});

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useFocusEffect: jest.fn(),
  };
});

const mockHouseholdState = {
  currentHousehold: { id: 'hh_01' },
};

const mockTaskStoreState = {
  updateMaintenanceTask: jest.fn(),
  removeMaintenanceTask: jest.fn(),
  addMaintenanceTask: jest.fn(),
};

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector?: (s: typeof mockHouseholdState) => unknown) =>
    selector ? selector(mockHouseholdState) : mockHouseholdState,
}));

jest.mock('@hooks/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({
    data: [{ user_id: 'u1', display_name: 'Mira' }],
    isLoading: false,
  }),
}));

jest.mock('@stores/taskStore', () => ({
  useTaskStore: (selector?: (s: typeof mockTaskStoreState) => unknown) =>
    selector ? selector(mockTaskStoreState) : mockTaskStoreState,
}));

jest.mock('@stores/notificationStore', () => ({
  useNotificationStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ permissionGranted: true, permissionPrompted: true, requestPermission: jest.fn() }),
    { getState: () => ({ permissionGranted: true, permissionPrompted: true, requestPermission: jest.fn() }) }
  ),
}));

jest.mock('@stores/tabBarVisibilityStore', () => ({
  useTabBarVisibilityStore: (selector: (s: { isSidebarVisible: boolean }) => unknown) =>
    selector({ isSidebarVisible: true }),
}));

jest.mock('@services/toastManager', () => ({
  showToast: jest.fn(),
}));

jest.mock('@components/tasks/SubtaskList', () => ({ SubtaskList: () => null }));
jest.mock('@components/tasks/TaskActivityFeed', () => ({ TaskActivityFeed: () => null }));
jest.mock('@components/maintenance/TaskCompletionModal', () => ({ TaskCompletionModal: () => null }));
jest.mock('@components/tasks/AssigneePickerSheet', () => ({ AssigneePickerSheet: () => null }));
jest.mock('@components/tasks/WorkflowStageIndicator', () => ({ WorkflowStageIndicator: () => null }));

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
            ? React.createElement(
                TouchableOpacity,
                { onPress: onRightPress, testID: rightTestID },
                React.createElement(Text, null, rightLabel),
              )
            : null),
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
          ? React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' })
          : null,
        rightElement ?? null,
      ),
    ScreenScrollEnd: () => null,
    screenScrollViewStyle: { scroll: { flex: 1 }, contentGrow: { flexGrow: 1 } },
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('@api/tasks', () => ({
  tasksApi: {
    get: jest.fn(),
    update: jest.fn(),
    getHistory: jest.fn(),
    getTaskQuotes: jest.fn().mockResolvedValue({ quotes: [] }),
    listSubtasks: jest.fn().mockResolvedValue([]),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { tasksApi } from '@api/tasks';
import type { Task } from '@api/tasks';
import { TaskDetailSheetOnBackContext } from '@contexts/index';
import { ThemeProvider } from '@contexts/ThemeContext';
import { TaskDetailStackHost } from '@navigation/TaskDetailStackHost';

import { ALL_DEVICES, PHONES, treeText, type DeviceName } from '../../test-utils/deviceRender';

const DAY = 1000 * 60 * 60 * 24;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function makeTask(): Task {
  return {
    id: 't_edit_01',
    system_category: 'errands',
    title: 'Return Amazon gift by July 10',
    description: 'Return before deadline',
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: iso(7),
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    priority_severity: 'high',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: false,
    needs_contractor: false,
    contractor_category: undefined,
    created_at: iso(-5),
    updated_at: iso(-5),
    is_personal: false,
    created_by: 'u1',
  };
}


async function renderStack(
  device: DeviceName = 'iPad Pro 11 (portrait)',
  options?: { inSheet?: boolean; task?: Task }
) {
  const { setDevice } = require('../../test-utils/deviceRender');
  setDevice(device);

  (tasksApi.get as jest.Mock).mockResolvedValue({ task: options?.task ?? makeTask() });
  (tasksApi.getHistory as jest.Mock).mockResolvedValue({ completions: [] });

  const stack = (
    <TaskDetailStackHost initialTask={{ taskId: 't_edit_01', householdId: 'hh_01' }} />
  );

  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        {options?.inSheet ? (
          <TaskDetailSheetOnBackContext.Provider value={jest.fn()}>
            {stack}
          </TaskDetailSheetOnBackContext.Provider>
        ) : (
          stack
        )}
      </ThemeProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

describe('TaskDetailStackNavigator', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'shows task detail then edit screen on nested push (%s)',
    async (device) => {
      const r = await renderStack(device);
      expect(treeText(r)).toContain('Task Details');

      const editBtn = r.root.findByProps({ testID: 'task-detail-edit' });
      await act(async () => {
        editBtn.props.onPress();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(treeText(r)).toContain('Edit Task');
      expect(treeText(r)).toContain('Return Amazon gift by July 10');
      expect(r.root.findByProps({ testID: 'schedule-task-save' })).toBeTruthy();
    }
  );

  it.each(PHONES.map((d) => [d] as [DeviceName]))(
    'edit form is tappable inside bottom sheet context (%s)',
    async (device) => {
      const r = await renderStack(device, { inSheet: true });
      await act(async () => {
        r.root.findByProps({ testID: 'task-detail-edit' }).props.onPress();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(treeText(r)).toContain('Edit Task');
      const inputs = r.root.findAll(
        (n) => n.props?.onChangeText != null && n.props?.value != null
      );
      expect(inputs.length).toBeGreaterThan(0);
      await act(async () => {
        inputs[0].props.onChangeText('Updated from sheet');
      });
      expect(inputs[0].props.value).toBe('Updated from sheet');
    }
  );

  it('edit form title field accepts text changes on iPad', async () => {
    const r = await renderStack('iPad Pro 11 (portrait)');
    const editBtn = r.root.findByProps({ testID: 'task-detail-edit' });
    await act(async () => {
      editBtn.props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const inputs = r.root.findAll(
      (n) => n.props?.onChangeText != null && n.props?.value != null
    );
    expect(inputs.length).toBeGreaterThan(0);

    await act(async () => {
      inputs[0].props.onChangeText('Updated task title');
    });
    expect(inputs[0].props.value).toBe('Updated task title');
  });

  it('save header button is tappable on edit screen', async () => {
    (tasksApi.update as jest.Mock).mockResolvedValue({
      task: { ...makeTask(), title: 'Updated task title' },
    });

    // Save is gated: disabled unless the form is dirty AND valid (non-empty
    // title AND either personal or an assignee). Load a personal task so the
    // assignee requirement is satisfied, then edit the title to make it dirty.
    const r = await renderStack('iPad Pro 11 (portrait)', {
      task: { ...makeTask(), is_personal: true, assigned_to: null },
    });
    await act(async () => {
      r.root.findByProps({ testID: 'task-detail-edit' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const inputs = r.root.findAll(
      (n) => n.props?.onChangeText != null && n.props?.value != null
    );
    expect(inputs.length).toBeGreaterThan(0);
    await act(async () => {
      inputs[0].props.onChangeText('Updated task title');
    });

    const saveHeader = r.root.findByProps({ testID: 'schedule-task-save-header' });
    expect(saveHeader.props.onPress).toEqual(expect.any(Function));
    expect(saveHeader.props.disabled ?? saveHeader.props.rightDisabled).toBeFalsy();
    await act(async () => {
      saveHeader.props.onPress();
      await Promise.resolve();
    });
    expect(tasksApi.update).toHaveBeenCalled();
  });
});
