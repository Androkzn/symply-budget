/**
 * Task card behaviour tests for two rules:
 *
 *  1. Assignee avatar — TaskCardItem ALWAYS leads with an avatar: the explicit
 *     assignee for delegated tasks, and the current user as a fallback for
 *     unassigned tasks (quick tasks land unassigned). The name label is dropped —
 *     the avatar alone carries the assignee.
 *  2. Effort tier — HomeTaskCard renders the AI estimate as an effort label
 *     (Quick / Short / Medium / Half day / All day) instead of a raw minute count.
 *
 * Uses react-test-renderer + treeText(), matching the repo's card-test convention.
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

jest.mock('@stores/spaceStore', () => ({
  useSpaceStore: jest.fn((selector: (state: { spaces: Array<{ id: string; name: string }> }) => unknown) =>
    selector({
      spaces: [{ id: 's1', name: 'Basement Bathroom' }],
    })
  ),
}));

// Mutable current-user id so each test can pick the viewer. `mock`-prefixed so
// jest's hoist allowlist permits referencing it inside the factory.
let mockCurrentUserId: string | null = null;
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string; display_name: string } | null }) => unknown) =>
    selector({ user: mockCurrentUserId ? { id: mockCurrentUserId, display_name: 'Me' } : null }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { Task } from '@api/tasks';
import { TIME_EFFORT_LABELS } from '@api/tasks';
import { HomeTaskCard } from '@components/home/HomeTaskCard';
import { TaskCardItem } from '@components/tasks/TaskCardItem';
import { Avatar } from '@components/ui/Avatar';
import { ThemeProvider } from '@contexts/ThemeContext';

import { treeText } from '../../../test-utils/deviceRender';

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

// ─── HomeTaskCard — effort tier ───────────────────────────────────────────────

describe('HomeTaskCard — effort tier', () => {
  const base = {
    title: 'Fix the gutter',
    dueText: 'Due July 15',
    category: 'exterior' as const,
    prioritySeverity: 'medium' as const,
  };

  it.each([
    ['quick', TIME_EFFORT_LABELS.quick],
    ['short', TIME_EFFORT_LABELS.short],
    ['medium', TIME_EFFORT_LABELS.medium],
    ['half_day', TIME_EFFORT_LABELS.half_day],
    ['all_day', TIME_EFFORT_LABELS.all_day],
  ] as const)('renders the "%s" tier as the "%s" label', (effort, label) => {
    const r = wrap(<HomeTaskCard {...base} timeEffort={effort} />);
    expect(treeText(r)).toContain(label);
  });

  it('does not render a raw minute count', () => {
    const text = treeText(wrap(<HomeTaskCard {...base} timeEffort="medium" />));
    expect(text).not.toContain('1h 30m');
    expect(text).not.toContain('90 min');
  });

  it('renders no effort pill when there is no tier', () => {
    const text = treeText(wrap(<HomeTaskCard {...base} timeEffort={null} />));
    Object.values(TIME_EFFORT_LABELS).forEach((label) => expect(text).not.toContain(label));
  });
});

// ─── TaskCardItem — assignee gating ───────────────────────────────────────────

describe('TaskCardItem — assignee avatar for me and other members', () => {
  afterEach(() => {
    mockCurrentUserId = null;
  });

  it('leads with the assignee avatar for another member, without the name label', () => {
    mockCurrentUserId = 'me';
    const task = makeTask({ assigned_to: { id: 'u1', display_name: 'Alice' } });
    const r = wrap(<TaskCardItem task={task} onPress={jest.fn()} />);
    expect(r.root.findAllByType(Avatar).length).toBeGreaterThan(0);
    // The name label is gone — the avatar alone carries the assignee.
    expect(treeText(r)).not.toContain('Alice');
  });

  it('shows the avatar when the task is assigned to the current user', () => {
    mockCurrentUserId = 'u1';
    const task = makeTask({ assigned_to: { id: 'u1', display_name: 'Alice' } });
    const r = wrap(<TaskCardItem task={task} onPress={jest.fn()} />);
    expect(r.root.findAllByType(Avatar).length).toBeGreaterThan(0);
  });

  it('falls back to the current-user avatar when the task is unassigned', () => {
    mockCurrentUserId = 'me';
    const task = makeTask({ assigned_to: null });
    const r = wrap(<TaskCardItem task={task} onPress={jest.fn()} />);
    // Still renders the card itself — and still shows an avatar (the current user).
    expect(treeText(r)).toContain('Clean the gutters');
    expect(r.root.findAllByType(Avatar).length).toBeGreaterThan(0);
  });

  it('shows the space name when task has a space_id', () => {
    const task = makeTask({ space_id: 's1' });
    const r = wrap(<TaskCardItem task={task} onPress={jest.fn()} />);
    expect(treeText(r)).toContain('Basement Bathroom');
  });

  it('hides the space pill when task has no space_id', () => {
    const task = makeTask({ space_id: null });
    const r = wrap(<TaskCardItem task={task} onPress={jest.fn()} />);
    expect(treeText(r)).not.toContain('Basement Bathroom');
  });
});
