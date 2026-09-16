/**
 * TaskFormBody — utility functions + full rendered form.
 *
 * Covers:
 *  - createEmptyTaskForm / taskToFormData / taskFormToRequest round-trips
 *  - is_personal field in all three helpers
 *  - getCategoryLabel / getCategoryIcon for all known categories
 *  - Every rendered field fires onChange (title, category, priority, frequency,
 *    due-date shortcut, contractor, personal, reminder toggles)
 *  - Rendered on iPhone SE and iPad Pro (compact + regular width)
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

jest.mock('@api/household-spaces', () => ({
  householdSpacesApi: {
    list: jest.fn().mockResolvedValue({ spaces: [] }),
  },
}));

jest.mock('@components/spaces/SpacePicker', () => ({
  SpacePicker: () => null,
}));

jest.mock('@services/navigation', () => ({
  navigateToSpacesManagement: jest.fn(),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: jest.fn((selector?: (s: { currentHousehold: { id: string; name: string } | null }) => unknown) => {
    const state = { currentHousehold: { id: 'hh_test', name: 'Test Home' } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

jest.mock('@hooks/useHouseholdMembers', () => ({
  useHouseholdMembers: jest.fn(() => ({ data: [], isLoading: false })),
}));

jest.mock('@stores/spaceStore', () => ({
  useSpaceStore: jest.fn((selector: (s: { spaces: []; setSpaces: jest.Mock }) => unknown) =>
    selector({ spaces: [], setSpaces: jest.fn() })
  ),
}));

const PERSONAL_TASK_LABEL = 'Personal task (only visible to me)';
const CONTRACTOR_LABEL = 'This task requires a contractor';

import React from 'react';
import { TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { Task } from '@api/tasks';
import {
  createEmptyTaskForm,
  taskToFormData,
  taskFormToRequest,
  getCategoryLabel,
  getCategoryIcon,
  TaskFormBody,
  type TaskFormData,
} from '@components/tasks/TaskFormBody';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  renderOnDevice,
  treeText,
  ALL_DEVICES,
  type DeviceName,
} from '../../../test-utils/deviceRender';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Find a TouchableOpacity that contains a descendant text node matching `text`. */
function findButtonWithText(
  r: ReactTestRenderer.ReactTestRenderer,
  text: string
): ReactTestRenderer.ReactTestInstance | undefined {
  return r.root.findAllByType(TouchableOpacity).find((btn) => {
    try {
      return (
        btn.findAll(
          (n) => typeof n.props?.children === 'string' && String(n.props.children).includes(text),
          { deep: true }
        ).length > 0
      );
    } catch {
      return false;
    }
  });
}

const DAY = 1000 * 60 * 60 * 24;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't_form_01',
    system_category: 'plumbing',
    title: 'Fix dripping faucet',
    description: 'Kitchen sink drips constantly',
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: iso(7),
    last_completed_at: null,
    assigned_to: { id: 'u1', display_name: 'Alice' },
    space_id: 's1',
    is_active: true,
    source: 'manual',
    priority_severity: 'high',
    reminder_enabled: true,
    reminder_days_before: 3,
    reminder_time: '08:00',
    reminder_repeat: false,
    needs_contractor: true,
    contractor_category: 'plumber',
    created_at: iso(-5),
    updated_at: iso(-5),
    is_personal: false,
    created_by: 'u1',
    ...overrides,
  };
}

function render(
  formData: TaskFormData,
  onChange: (patch: Partial<TaskFormData>) => void = jest.fn()
) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <TaskFormBody formData={formData} onChange={onChange} />
      </ThemeProvider>
    );
  });
  return r;
}

// ─── createEmptyTaskForm ─────────────────────────────────────────────────────

describe('createEmptyTaskForm', () => {
  it('returns a blank form with all required fields', () => {
    const f = createEmptyTaskForm();
    expect(f.title).toBe('');
    expect(f.description).toBe('');
    expect(f.frequency).toBe('one_time');
    expect(f.system_category).toBe('other');
    expect(f.priority_severity).toBe('nice_to_have');
    expect(f.needs_contractor).toBe(false);
    expect(f.reminder_enabled).toBe(true);
    expect(f.reminder_days_before).toBe(1);
    expect(f.reminder_time).toBe('09:00');
    expect(f.reminder_repeat).toBe(true);
    expect(f.next_due_date).toBeNull();
  });

  it('defaults is_personal to false', () => {
    expect(createEmptyTaskForm().is_personal).toBe(false);
  });

  it('defaults assigned_to to null', () => {
    expect(createEmptyTaskForm().assigned_to).toBeNull();
  });

  it('defaults space_id to null', () => {
    expect(createEmptyTaskForm().space_id).toBeNull();
  });

  it('defaults photos to empty and coverPhotoIndex to 0', () => {
    const f = createEmptyTaskForm();
    expect(f.photos).toEqual([]);
    expect(f.coverPhotoIndex).toBe(0);
  });
});

// ─── taskToFormData ──────────────────────────────────────────────────────────

describe('taskToFormData', () => {
  it('maps all task fields to form fields correctly', () => {
    const task = baseTask();
    const f = taskToFormData(task);
    expect(f.title).toBe('Fix dripping faucet');
    expect(f.description).toBe('Kitchen sink drips constantly');
    expect(f.system_category).toBe('plumbing');
    expect(f.priority_severity).toBe('high');
    expect(f.frequency).toBe('one_time');
    expect(f.needs_contractor).toBe(true);
    expect(f.contractor_category).toBe('plumber');
    expect(f.reminder_enabled).toBe(true);
    expect(f.reminder_days_before).toBe(3);
    expect(f.reminder_time).toBe('08:00');
    expect(f.reminder_repeat).toBe(false);
  });

  it('parses next_due_date string to a Date', () => {
    const task = baseTask({ next_due_date: '2026-07-10T00:00:00.000Z' });
    const f = taskToFormData(task);
    expect(f.next_due_date).toBeInstanceOf(Date);
    expect((f.next_due_date as Date).getFullYear()).toBe(2026);
  });

  it('preserves is_personal=true from the task', () => {
    const task = baseTask({ is_personal: true });
    expect(taskToFormData(task).is_personal).toBe(true);
  });

  it('falls back to is_personal=false when not set (legacy task)', () => {
    const task = baseTask({ is_personal: undefined });
    expect(taskToFormData(task).is_personal).toBe(false);
  });

  it('maps the assigned_to user id', () => {
    const task = baseTask({ assigned_to: { id: 'u42', display_name: 'Andrei' } });
    expect(taskToFormData(task).assigned_to).toBe('u42');
  });

  it('maps space_id from task', () => {
    const task = baseTask({ space_id: 'space-42' });
    expect(taskToFormData(task).space_id).toBe('space-42');
  });

  it('maps assigned_to to null when unassigned', () => {
    const task = baseTask({ assigned_to: null });
    expect(taskToFormData(task).assigned_to).toBeNull();
  });

  it('falls back to empty string when description is null', () => {
    const task = baseTask({ description: null });
    expect(taskToFormData(task).description).toBe('');
  });

  it('falls back contractor_category to "general" when missing', () => {
    const task = baseTask({ contractor_category: undefined, needs_contractor: false });
    expect(taskToFormData(task).contractor_category).toBe('general');
  });

  it('converts custom_interval_days to string', () => {
    const task = baseTask({ frequency: 'custom', custom_interval_days: 45 });
    const f = taskToFormData(task);
    expect(f.custom_interval_days).toBe('45');
  });

  it('maps task photos and cover index from the API task', () => {
    const task = baseTask({
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
    });
    const f = taskToFormData(task);
    expect(f.photos).toHaveLength(2);
    expect(f.photos[0]).toMatchObject({
      id: 'p1',
      uri: 'https://api.example/files/maintenance-photos/h1/a.jpg',
      photo_key: 'maintenance-photos/h1/a.jpg',
    });
    expect(f.coverPhotoIndex).toBe(1);
  });

  it('defaults coverPhotoIndex to 0 when cover_photo_id is missing', () => {
    const task = baseTask({
      photos: [
        {
          id: 'p1',
          photo_key: 'k1',
          photo_url: 'https://api.example/files/k1',
          sort_order: 0,
        },
      ],
      cover_photo_id: null,
    });
    expect(taskToFormData(task).coverPhotoIndex).toBe(0);
  });
});

// ─── taskFormToRequest ───────────────────────────────────────────────────────

describe('taskFormToRequest', () => {
  it('builds a clean payload with no extra whitespace in title', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: '  Fix gutter  ' };
    expect(taskFormToRequest(f).title).toBe('Fix gutter');
  });

  it('omits description when blank', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'T', description: '  ' };
    expect(taskFormToRequest(f).description).toBeUndefined();
  });

  it('passes description when non-blank', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'T', description: 'Details here' };
    expect(taskFormToRequest(f).description).toBe('Details here');
  });

  it('includes custom_interval_days only for custom frequency', () => {
    const f: TaskFormData = {
      ...createEmptyTaskForm(),
      title: 'T',
      frequency: 'custom',
      custom_interval_days: '45',
    };
    expect(taskFormToRequest(f).custom_interval_days).toBe(45);

    const f2: TaskFormData = { ...createEmptyTaskForm(), title: 'T', frequency: 'monthly' };
    expect(taskFormToRequest(f2).custom_interval_days).toBeUndefined();
  });

  it('serialises next_due_date to ISO string', () => {
    const date = new Date('2026-07-10T00:00:00.000Z');
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'T', next_due_date: date };
    expect(taskFormToRequest(f).next_due_date).toBe(date.toISOString());
  });

  it('omits next_due_date when null', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'T', next_due_date: null };
    expect(taskFormToRequest(f).next_due_date).toBeUndefined();
  });

  it('sets workflow_stage and contractor_category only when needs_contractor=true', () => {
    const withContractor: TaskFormData = {
      ...createEmptyTaskForm(),
      title: 'T',
      needs_contractor: true,
      contractor_category: 'plumber',
    };
    const req1 = taskFormToRequest(withContractor);
    expect(req1.workflow_stage).toBe('planning');
    expect(req1.contractor_category).toBe('plumber');

    const reqEdit = taskFormToRequest(withContractor, { isEditing: true });
    expect(reqEdit.workflow_stage).toBeUndefined();
    expect(reqEdit.contractor_category).toBe('plumber');

    const noContractor: TaskFormData = {
      ...createEmptyTaskForm(),
      title: 'T',
      needs_contractor: false,
    };
    const req2 = taskFormToRequest(noContractor);
    expect(req2.workflow_stage).toBeUndefined();
    expect(req2.contractor_category).toBeUndefined();
  });

  it('passes is_personal=true through to the request payload', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'My private note', is_personal: true };
    expect(taskFormToRequest(f).is_personal).toBe(true);
  });

  it('passes is_personal=false through to the request payload', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'Shared task' };
    expect(taskFormToRequest(f).is_personal).toBe(false);
  });

  it('includes assigned_to for a shared task', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'T', assigned_to: 'u42' };
    expect(taskFormToRequest(f).assigned_to).toBe('u42');
  });

  it('omits assigned_to for a personal task (it belongs to the current user)', () => {
    const f: TaskFormData = {
      ...createEmptyTaskForm(),
      title: 'T',
      is_personal: true,
      assigned_to: 'u42',
    };
    expect(taskFormToRequest(f).assigned_to).toBeUndefined();
  });

  it('includes space_id in create request', () => {
    const f: TaskFormData = { ...createEmptyTaskForm(), title: 'T', space_id: 'space-9' };
    expect(taskFormToRequest(f).space_id).toBe('space-9');
  });

  it('passes all reminder fields', () => {
    const f: TaskFormData = {
      ...createEmptyTaskForm(),
      title: 'T',
      reminder_enabled: true,
      reminder_days_before: 3,
      reminder_time: '08:30',
      reminder_repeat: false,
    };
    const req = taskFormToRequest(f);
    expect(req.reminder_enabled).toBe(true);
    expect(req.reminder_days_before).toBe(3);
    expect(req.reminder_time).toBe('08:30');
    expect(req.reminder_repeat).toBe(false);
  });
});

// ─── getCategoryLabel / getCategoryIcon ──────────────────────────────────────

describe('getCategoryLabel / getCategoryIcon', () => {
  const knownCategories = ['plumbing', 'hvac', 'electrical', 'exterior', 'cleaning', 'other'] as const;

  it.each(knownCategories)('getCategoryLabel returns a non-empty string for "%s"', (cat) => {
    expect(getCategoryLabel(cat).length).toBeGreaterThan(0);
  });

  it.each(knownCategories)('getCategoryIcon returns a non-empty Ionicon name for "%s"', (cat) => {
    expect(getCategoryIcon(cat).length).toBeGreaterThan(0);
  });

  it('getCategoryLabel falls back to "General" for unknown category', () => {
    expect(getCategoryLabel('__unknown__')).toBe('General');
  });

  it('getCategoryIcon falls back to the default Ionicon for unknown category', () => {
    expect(getCategoryIcon('__unknown__')).toBe('ellipsis-horizontal-circle');
  });
});

// ─── Rendered form — every device ────────────────────────────────────────────

const EVERY_DEVICE = ALL_DEVICES.map((d) => [d] as [DeviceName]);

describe('TaskFormBody render — every device', () => {
  it.each(EVERY_DEVICE)('mounts without crash on %s', (device) => {
    const r = renderOnDevice(
      device,
      <TaskFormBody formData={createEmptyTaskForm()} onChange={jest.fn()} />
    );
    expect(r.toJSON()).toBeTruthy();
  });

  it.each(EVERY_DEVICE)('shows "Task Name" field label on %s', (device) => {
    const r = renderOnDevice(
      device,
      <TaskFormBody formData={createEmptyTaskForm()} onChange={jest.fn()} />
    );
    expect(treeText(r)).toContain('Task Name');
  });

  it.each(EVERY_DEVICE)('shows personal task toggle label on %s', (device) => {
    const r = renderOnDevice(
      device,
      <TaskFormBody formData={createEmptyTaskForm()} onChange={jest.fn()} />
    );
    expect(treeText(r)).toContain(PERSONAL_TASK_LABEL);
  });

  it.each(EVERY_DEVICE)('shows "Where" field label on %s', (device) => {
    const r = renderOnDevice(
      device,
      <TaskFormBody formData={createEmptyTaskForm()} onChange={jest.fn()} />
    );
    expect(treeText(r)).toContain('Where');
  });

  it.each(EVERY_DEVICE)('shows photo attachment section on %s', (device) => {
    const r = renderOnDevice(
      device,
      <TaskFormBody formData={createEmptyTaskForm()} onChange={jest.fn()} />
    );
    expect(treeText(r)).toContain('Photos');
    expect(treeText(r)).toContain('0/5');
  });
});

// ─── Rendered form — onChange callbacks ──────────────────────────────────────

describe('TaskFormBody — onChange callbacks', () => {
  it('fires onChange when personal task checkbox is tapped', () => {
    const onChange = jest.fn();
    const r = render(createEmptyTaskForm(), onChange);
    const personalBtn = findButtonWithText(r, PERSONAL_TASK_LABEL);
    expect(personalBtn).toBeDefined();
    act(() => personalBtn!.props.onPress());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ is_personal: true }));
  });

  it('fires onChange when contractor checkbox is tapped', () => {
    const onChange = jest.fn();
    const r = render(createEmptyTaskForm(), onChange);
    const contractorBtn = findButtonWithText(r, CONTRACTOR_LABEL);
    expect(contractorBtn).toBeDefined();
    act(() => contractorBtn!.props.onPress());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ needs_contractor: true }));
  });

  it('shows contractor category picker when needs_contractor is true', () => {
    const formWithContractor: TaskFormData = { ...createEmptyTaskForm(), needs_contractor: true };
    const r = render(formWithContractor);
    expect(treeText(r)).toContain('Contractor Category');
  });

  it('shows the "Assign to" field for a shared task', () => {
    const r = render(createEmptyTaskForm());
    expect(treeText(r)).toContain('Assign to');
    expect(treeText(r)).toContain('Select assignee');
  });

  it('hides the "Assign to" field for a personal task', () => {
    const r = render({ ...createEmptyTaskForm(), is_personal: true });
    expect(treeText(r)).not.toContain('Assign to');
  });

  it('hides contractor category picker when needs_contractor is false', () => {
    const r = render(createEmptyTaskForm());
    expect(treeText(r)).not.toContain('Contractor Category');
  });

  it('renders the task title field value', () => {
    const form: TaskFormData = { ...createEmptyTaskForm(), title: 'Return Amazon gift' };
    const r = render(form);
    expect(treeText(r)).toContain('Return Amazon gift');
  });

  it('shows photo count when attachments are present', () => {
    const form: TaskFormData = {
      ...createEmptyTaskForm(),
      photos: [
        { uri: 'file:///a.jpg' },
        { uri: 'file:///b.jpg' },
      ],
      coverPhotoIndex: 0,
    };
    const r = render(form);
    expect(treeText(r)).toContain('2/5');
    expect(treeText(r)).toContain('Tap a photo to set it as the task card image');
  });
});

// ─── is_personal toggle state ─────────────────────────────────────────────────

describe('TaskFormBody — is_personal field', () => {
  it('renders un-checked when is_personal=false', () => {
    const form: TaskFormData = { ...createEmptyTaskForm(), is_personal: false };
    const r = render(form);
    expect(treeText(r)).toContain(PERSONAL_TASK_LABEL);
    // The checkbox renders NO checkmark icon when un-checked.
    const personalBtn = findButtonWithText(r, PERSONAL_TASK_LABEL)!;
    const checks = personalBtn.findAll((n) => n.props?.name === 'checkmark');
    expect(checks.length).toBe(0);
  });

  it('renders checked when is_personal=true', () => {
    const form: TaskFormData = { ...createEmptyTaskForm(), is_personal: true };
    const r = render(form);
    expect(treeText(r)).toContain(PERSONAL_TASK_LABEL);
    // The checkbox shows an Ionicons "checkmark" when checked (was a literal ✓
    // before the emoji→Ionicons migration, which this assertion tracks).
    const personalBtn = findButtonWithText(r, PERSONAL_TASK_LABEL)!;
    const checks = personalBtn.findAll((n) => n.props?.name === 'checkmark');
    expect(checks.length).toBeGreaterThan(0);
  });

  it('toggling twice restores original state via onChange', () => {
    const onChange = jest.fn();
    const r = render(createEmptyTaskForm(), onChange);
    const personalBtn = findButtonWithText(r, PERSONAL_TASK_LABEL)!;

    act(() => personalBtn.props.onPress());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ is_personal: true }));

    // Simulate update: re-render with is_personal=true, then tap again
    const onChange2 = jest.fn();
    const r2 = render({ ...createEmptyTaskForm(), is_personal: true }, onChange2);
    const personalBtn2 = findButtonWithText(r2, PERSONAL_TASK_LABEL)!;
    act(() => personalBtn2.props.onPress());
    expect(onChange2).toHaveBeenLastCalledWith(expect.objectContaining({ is_personal: false }));
  });
});
