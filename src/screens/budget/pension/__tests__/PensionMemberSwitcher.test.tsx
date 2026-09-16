// Mocks are declared before the module imports they stand in for; the type-only
// import of HouseholdMember lives with the rest below (it is erased at runtime).
const mockSetSelectedMember = jest.fn();
const mockHouseholdState = { currentHouseholdMembers: [] as HouseholdMember[] };
const mockPensionState = {
  selectedMemberId: null as string | null,
  memberGroups: [] as { id: string | null; name: string | null }[],
  setSelectedMember: (id: string | null) => mockSetSelectedMember(id),
};

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (s?: (x: typeof mockHouseholdState) => unknown) =>
    s ? s(mockHouseholdState) : mockHouseholdState,
}));
jest.mock('@stores/pensionStore', () => ({
  usePensionStore: (s?: (x: typeof mockPensionState) => unknown) =>
    s ? s(mockPensionState) : mockPensionState,
}));

// A server household: no local ledger to read a member id from.
jest.mock('@features/budget/local', () => ({
  isLocalBudgetSessionOpen: () => false,
  getLocalLedger: () => {
    throw new Error('no local session');
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { HouseholdMember } from '@api/households';
import { ThemeProvider } from '@contexts/ThemeContext';

import { PensionMemberSwitcher } from '../PensionMemberSwitcher';

function member(id: string, displayName: string): HouseholdMember {
  return {
    id,
    user_id: `user-${id}`,
    display_name: displayName,
    avatar_url: null,
    email: `${id}@example.com`,
    role: 'member',
    joined_at: '2026-01-01',
  };
}

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionMemberSwitcher />
      </ThemeProvider>,
    );
  });
  return tree;
}

function titleText(tree: ReactTestRenderer.ReactTestRenderer): string {
  const node = tree.root.findByProps({ testID: 'pension-member-switcher-title' });
  return JSON.stringify(node.props.children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseholdState.currentHouseholdMembers = [];
  mockPensionState.memberGroups = [];
  mockPensionState.selectedMemberId = null;
});

describe('PensionMemberSwitcher', () => {
  it('stays a plain "Pension" title when there is nobody to switch between', () => {
    mockHouseholdState.currentHouseholdMembers = [member('mem-a', 'Alex')];
    const tree = render();
    expect(titleText(tree)).toContain('Pension');
    expect(tree.root.findAllByProps({ testID: 'pension-member-switcher-trigger' })).toHaveLength(0);
  });

  it('becomes a picker once a second member exists, defaulting to Everyone', () => {
    mockHouseholdState.currentHouseholdMembers = [member('mem-a', 'Alex'), member('mem-b', 'Bo')];
    const tree = render();
    expect(titleText(tree)).toContain('Everyone');
    expect(tree.root.findAllByProps({ testID: 'pension-member-switcher-trigger' }).length).toBeGreaterThan(0);
  });

  it('titles itself with the scoped member', () => {
    mockHouseholdState.currentHouseholdMembers = [member('mem-a', 'Alex'), member('mem-b', 'Bo')];
    mockPensionState.selectedMemberId = 'mem-b';
    expect(titleText(render())).toContain('Bo');
  });

  it('offers a member the roster has not loaded but who holds rows', () => {
    mockHouseholdState.currentHouseholdMembers = [member('mem-a', 'Alex')];
    mockPensionState.memberGroups = [
      { id: 'mem-a', name: null },
      { id: 'mem-peer', name: 'Robin' },
    ];
    const tree = render();
    act(() => {
      tree.root.findByProps({ testID: 'pension-member-switcher-trigger' }).props.onPress();
    });
    expect(
      tree.root.findAllByProps({ testID: 'pension-member-switcher-row-mem-peer' }).length,
    ).toBeGreaterThan(0);
  });

  it('selects a member from the sheet', () => {
    mockHouseholdState.currentHouseholdMembers = [member('mem-a', 'Alex'), member('mem-b', 'Bo')];
    const tree = render();
    act(() => {
      tree.root.findByProps({ testID: 'pension-member-switcher-trigger' }).props.onPress();
    });
    act(() => {
      tree.root
        .findAllByProps({ testID: 'pension-member-switcher-row-mem-b' })[0]
        .props.onPress();
    });
    expect(mockSetSelectedMember).toHaveBeenCalledWith('mem-b');
  });

  // Otherwise the list below would filter to nothing under a title naming
  // someone who is no longer in the household.
  it('drops back to Everyone when the scoped member is gone', () => {
    mockHouseholdState.currentHouseholdMembers = [member('mem-a', 'Alex'), member('mem-b', 'Bo')];
    mockPensionState.selectedMemberId = 'mem-left';
    const tree = render();
    expect(mockSetSelectedMember).toHaveBeenCalledWith(null);
    expect(titleText(tree)).toContain('Everyone');
  });
});
