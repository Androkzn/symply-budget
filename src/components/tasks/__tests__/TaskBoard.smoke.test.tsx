/**
 * UI smoke tests — render the real dashboard presentational components through
 * the lightweight ThemeProvider (no native modules) and assert they mount,
 * show their key content, and fire their callbacks. Mirrors the repo's
 * react-test-renderer convention (no @testing-library installed).
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { Task } from '@api/tasks';
import { TaskBoardColumn } from '@components/tasks/TaskBoardColumn';
import { TaskSummaryBar } from '@components/tasks/TaskSummaryBar';
import { ThemeProvider } from '@contexts/ThemeContext';
import type { BoardSection, BoardSummary } from '@hooks/useTaskBoardData';

function render(node: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return r;
}

/** Flatten every string rendered anywhere in the tree. */
function allText(r: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(r.toJSON());
}

const summary: BoardSummary = { overdue: 2, dueToday: 4, mine: 3, blocked: 1, total: 12 };

describe('TaskSummaryBar', () => {
  it('renders the four stat labels with their counts', () => {
    const r = render(<TaskSummaryBar summary={summary} onSelect={() => {}} />);
    const text = allText(r);
    ['Overdue', 'Due today', 'Mine', 'Blocked', '2', '4', '3', '1'].forEach((t) =>
      expect(text).toContain(t)
    );
  });

  it('fires onSelect with the tapped stat (first card = overdue)', () => {
    const onSelect = jest.fn();
    const r = render(<TaskSummaryBar summary={summary} onSelect={onSelect} />);
    const buttons = r.root.findAllByType(TouchableOpacity);
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    act(() => {
      buttons[0].props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith('overdue');
  });
});

describe('TaskBoardColumn', () => {
  const task: Task = {
    id: 't1',
    system_category: 'plumbing',
    title: 'Replace kitchen faucet',
    description: null,
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: new Date(Date.now() + 86400000).toISOString(),
    last_completed_at: null,
    assigned_to: { id: 'u1', display_name: 'Alice' },
    space_id: 's1',
    is_active: true,
    source: 'manual',
    priority_severity: 'high',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const section: BoardSection = {
    key: 'todo',
    title: 'To Do',
    emoji: '📋',
    color: '#2563EB',
    tasks: [task],
  };

  it('renders the column header, count and its task card', () => {
    const r = render(
      <TaskBoardColumn section={section} width={300} onTaskPress={() => {}} onTaskMenu={() => {}} />
    );
    const text = allText(r);
    expect(text).toContain('To Do');
    expect(text).toContain('Replace kitchen faucet');
    expect(text).toContain('1'); // column count badge
  });

  it('renders an empty column without crashing', () => {
    const r = render(
      <TaskBoardColumn
        section={{ key: 'done', title: 'Done', emoji: '✅', tasks: [] }}
        width={300}
        onTaskPress={() => {}}
        onTaskMenu={() => {}}
      />
    );
    expect(allText(r)).toContain('No tasks');
  });
});
