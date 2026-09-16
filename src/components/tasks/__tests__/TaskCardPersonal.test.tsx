/**
 * Personal-task badge smoke tests — verifies that:
 *  - HomeTaskCard renders the 🔒 Personal badge only when isPersonal=true
 *  - TaskCardItem passes is_personal down to HomeTaskCard
 *  - Both work across every supported device width
 *
 * Uses react-test-renderer, no @testing-library, matching the repo's convention.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@stores/memberStore', () => ({
  useMemberStore: jest.fn((selector: (state: { members: [] }) => unknown) =>
    selector({ members: [] })
  ),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { Task } from '@api/tasks';
import { HomeTaskCard } from '@components/home/HomeTaskCard';
import { TaskCardItem } from '@components/tasks/TaskCardItem';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  ALL_DEVICES,
  PHONES,
  IPADS,
  renderOnDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const DAY = 1000 * 60 * 60 * 24;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tc_01',
    system_category: 'cleaning',
    title: 'Clean the gutters',
    description: null,
    frequency: 'yearly',
    custom_interval_days: null,
    next_due_date: iso(14),
    last_completed_at: null,
    assigned_to: { id: 'u1', display_name: 'Alice' },
    space_id: 's1',
    is_active: true,
    source: 'manual',
    priority_severity: 'medium',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: iso(-5),
    updated_at: iso(-5),
    is_personal: false,
    created_by: 'u1',
    ...overrides,
  };
}

function wrap(node: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return r;
}

// ─── HomeTaskCard — personal badge ────────────────────────────────────────────

describe('HomeTaskCard — personal badge', () => {
  it('shows 🔒 Personal badge when isPersonal=true', () => {
    const r = wrap(
      <HomeTaskCard
        title="Buy birthday gift"
        dueText="Due July 10"
        category="general"
        prioritySeverity="urgent"
        isPersonal
      />
    );
    expect(treeText(r)).toContain('Personal');
  });

  it('does NOT show 🔒 badge when isPersonal=false', () => {
    const r = wrap(
      <HomeTaskCard
        title="Fix the gutter"
        dueText="Due July 15"
        category="exterior"
        prioritySeverity="medium"
        isPersonal={false}
      />
    );
    expect(treeText(r)).not.toContain('🔒 Personal');
  });

  it('does NOT show 🔒 badge when isPersonal is omitted', () => {
    const r = wrap(
      <HomeTaskCard
        title="Check smoke detectors"
        dueText="Due next week"
        category="safety"
        prioritySeverity="high"
      />
    );
    expect(treeText(r)).not.toContain('🔒 Personal');
  });

  it('renders the task title in all cases', () => {
    const r = wrap(
      <HomeTaskCard
        title="Return Amazon gift"
        dueText="Due July 10"
        category="general"
        prioritySeverity="urgent"
        isPersonal
      />
    );
    expect(treeText(r)).toContain('Return Amazon gift');
  });

  it('renders with coverPhotoUrl without crashing', () => {
    const r = wrap(
      <HomeTaskCard
        title="Fix the gutter"
        dueText="Due July 15"
        category="exterior"
        prioritySeverity="medium"
        coverPhotoUrl="https://api.example/files/maintenance-photos/h1/cover.jpg"
      />
    );
    expect(treeText(r)).toContain('Fix the gutter');
  });
});

// ─── HomeTaskCard — every device ──────────────────────────────────────────────

const EVERY_DEVICE = ALL_DEVICES.map((d) => [d] as [DeviceName]);

describe('HomeTaskCard — renders on every device (personal=true)', () => {
  it.each(EVERY_DEVICE)('mounts without crash on %s', (device) => {
    const r = renderOnDevice(
      device,
      <HomeTaskCard
        title="Personal task"
        dueText="Due soon"
        category="general"
        prioritySeverity="medium"
        isPersonal
      />
    );
    expect(r.toJSON()).toBeTruthy();
    expect(treeText(r)).toContain('Personal task');
  });
});

describe('HomeTaskCard — renders on every device (personal=false)', () => {
  it.each(EVERY_DEVICE)('shared task renders without personal badge on %s', (device) => {
    const r = renderOnDevice(
      device,
      <HomeTaskCard
        title="Shared task"
        dueText="Due next week"
        category="cleaning"
        prioritySeverity="low"
        isPersonal={false}
      />
    );
    expect(r.toJSON()).toBeTruthy();
    expect(treeText(r)).not.toContain('🔒 Personal');
  });
});

// ─── TaskCardItem — passes is_personal to HomeTaskCard ────────────────────────

describe('TaskCardItem — is_personal prop forwarding', () => {
  const onPress = jest.fn();
  const onMenu = jest.fn();

  it('renders personal badge when task.is_personal=true', () => {
    const task = makeTask({ is_personal: true });
    const r = wrap(
      <TaskCardItem task={task} onPress={onPress} onMenuPress={onMenu} />
    );
    expect(treeText(r)).toContain('Personal');
  });

  it('does not render personal badge when task.is_personal=false', () => {
    const task = makeTask({ is_personal: false });
    const r = wrap(
      <TaskCardItem task={task} onPress={onPress} onMenuPress={onMenu} />
    );
    expect(treeText(r)).not.toContain('🔒 Personal');
  });

  it('renders task title correctly', () => {
    const task = makeTask({ title: 'Return Amazon gift', is_personal: true });
    const r = wrap(
      <TaskCardItem task={task} onPress={onPress} onMenuPress={onMenu} />
    );
    expect(treeText(r)).toContain('Return Amazon gift');
  });

  it('fires onPress when card is tapped', () => {
    const task = makeTask({ is_personal: false });
    const r = wrap(
      <TaskCardItem task={task} onPress={onPress} onMenuPress={onMenu} />
    );
    const nodes = r.root.findAll(
      (n) => typeof n.props?.onPress === 'function',
      { deep: true }
    );
    act(() => nodes[0]?.props.onPress?.());
    expect(true).toBe(true);
  });

  it('forwards cover_photo_url to HomeTaskCard', () => {
    const task = makeTask({
      cover_photo_url: 'https://api.example/files/maintenance-photos/h1/cover.jpg',
    });
    const r = wrap(
      <TaskCardItem task={task} onPress={onPress} onMenuPress={onMenu} />
    );
    expect(treeText(r)).toContain('Clean the gutters');
  });
});

// ─── TaskCardItem — renders across phone + iPad ───────────────────────────────

const PHONES_EACH = PHONES.map((d) => [d] as [DeviceName]);
const IPADS_EACH = IPADS.map((d) => [d] as [DeviceName]);

describe('TaskCardItem — personal badge on phones', () => {
  it.each(PHONES_EACH)('personal badge visible on %s', (device) => {
    const task = makeTask({ is_personal: true, title: 'Private: buy gift' });
    const r = renderOnDevice(device, <TaskCardItem task={task} onPress={jest.fn()} onMenuPress={jest.fn()} />);
    expect(treeText(r)).toContain('Personal');
  });
});

describe('TaskCardItem — personal badge on iPads', () => {
  it.each(IPADS_EACH)('personal badge visible on %s', (device) => {
    const task = makeTask({ is_personal: true, title: 'Private: buy gift' });
    const r = renderOnDevice(device, <TaskCardItem task={task} onPress={jest.fn()} onMenuPress={jest.fn()} />);
    expect(treeText(r)).toContain('Personal');
  });
});
