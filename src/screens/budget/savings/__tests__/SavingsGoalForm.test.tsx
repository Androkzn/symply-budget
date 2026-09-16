/**
 * SavingsGoalForm — goal create/edit form, emergency-fund wizard + custom goal.
 *
 * Stubs `@components/common` (its real `SafeAreaView` barrel transitively pulls
 * the SidebarTabBar → TaskDetail navigator chain that crashes under the mocked
 * `@react-navigation/native`), the native date picker, the savings API, and the
 * stores — then exercises: the emergency-fund months wizard (BE suggestion
 * prefills the target), the NO_HISTORY manual-entry hint, and creating a custom
 * goal (dollars → int cents) which marks dirty + goes back.
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    // Mirrors `SheetHeader`, the form's own top bar since it stopped hand-rolling
    // one: the ✕ carries `leftTestID` (the id the Cancel flow drives) and the
    // single trailing commit carries `rightTestID`.
    SheetHeader: ({
      title,
      onLeftPress,
      leftTestID,
      rightLabel,
      onRightPress,
      rightDisabled,
      rightTestID,
    }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onLeftPress, testID: leftTestID }),
        rightLabel
          ? React.createElement(
              TouchableOpacity,
              { onPress: onRightPress, disabled: rightDisabled, testID: rightTestID },
              React.createElement(Text, null, rightLabel)
            )
          : null
      ),
  };
});

// Native date picker → a prop-forwarding stub so tests can drive its onChange.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) =>
    React.createElement(View, { testID: 'date-time-picker', ...props });
});

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockRouteParams: any = {};
// Stable navigation object so navigation-dependent effects don't re-run on
// every render.
const mockNavigation = { goBack: mockGoBack, navigate: mockNavigate };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

// Validation + save-failure UX now flow through showToast (not Alert). Spy on it
// so we can assert the real messages without the zustand store + setTimeout.
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockListGoals = jest.fn();
const mockCreateGoal = jest.fn();
const mockUpdateGoal = jest.fn();
const mockDeleteGoal = jest.fn();
const mockGetEmergencyFundSuggestion = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listGoals: (...args: unknown[]) => mockListGoals(...args),
    createGoal: (...args: unknown[]) => mockCreateGoal(...args),
    updateGoal: (...args: unknown[]) => mockUpdateGoal(...args),
    deleteGoal: (...args: unknown[]) => mockDeleteGoal(...args),
    getEmergencyFundSuggestion: (...args: unknown[]) => mockGetEmergencyFundSuggestion(...args),
  },
}));

jest.mock('@stores/householdStore', () => {
  const state = {
    currentHousehold: { id: 'hh-test' },
    currentHouseholdMembers: [{ id: 'm1', user_id: 'u1', display_name: 'Andrei' }],
  };
  const useHouseholdStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useHouseholdStore };
});

const mockMarkDirty = jest.fn();

jest.mock('@stores/savingsStore', () => {
  // markDirty is a wrapper so it resolves the (hoist-deferred) mockMarkDirty at
  // call time rather than capturing its still-undefined value at factory eval.
  const state = {
    selectedYear: 2026,
    selectedMonth: 7,
    markDirty: (...args: unknown[]) => mockMarkDirty(...args),
  };
  const useSavingsStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  (useSavingsStore as any).getState = () => state;
  return { useSavingsStore };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { showToast } from '@services/toastManager';

import { SavingsGoalForm } from '../SavingsGoalForm';

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsGoalForm />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Collect all rendered Text strings for hint/label assertions. */
function allText(root: ReactTestRenderer.ReactTestInstance): string {
  return root
    .findAllByType('Text' as any)
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter((c) => typeof c === 'string')
    .join(' | ');
}

describe('SavingsGoalForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockGetEmergencyFundSuggestion.mockResolvedValue({
      suggestedTarget: 900000,
      essentialMonthlySpending: 150000,
      months: 6,
    });
    mockCreateGoal.mockResolvedValue({});
    mockUpdateGoal.mockResolvedValue({});
    mockDeleteGoal.mockResolvedValue({});
    mockListGoals.mockResolvedValue({ goals: [] });
  });

  it('runs the emergency-fund wizard: picking a months option fetches + prefills the BE target', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    const root = tree.root;

    // Default months (6) triggers an initial suggestion fetch on mount.
    expect(mockGetEmergencyFundSuggestion).toHaveBeenCalledWith('hh-test', 6);

    // Switch to 12 months → refetch with the new months value.
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-months-12' }).props.onPress();
    });
    // allow the suggestion promise to flush
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetEmergencyFundSuggestion).toHaveBeenCalledWith('hh-test', 12);
    // BE-suggested target (900000 cents) prefilled into the target field ($9000).
    expect(root.findByProps({ testID: 'savings-goal-target' }).props.value).toBe('9000');
  });

  it('shows the manual-entry hint when the suggestion has note NO_HISTORY', async () => {
    mockRouteParams = {};
    mockGetEmergencyFundSuggestion.mockResolvedValue({
      suggestedTarget: 0,
      essentialMonthlySpending: 0,
      months: 6,
      note: 'NO_HISTORY',
    });

    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      await Promise.resolve();
    });

    expect(allText(root)).toContain('No spending history yet');
    // Target left blank for manual entry (no auto-fill from a zero suggestion).
    expect(root.findByProps({ testID: 'savings-goal-target' }).props.value).toBe('');
  });

  it('creates a custom goal (dollars → int cents), marks dirty, and goes back', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    const root = tree.root;

    // Switch to the custom goal type.
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-type-custom' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-name' }).props.onChangeText('New car fund');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-target' }).props.onChangeText('12000');
    });

    await act(async () => {
      await root.findByProps({ testID: 'savings-goal-form-save-header' }).props.onPress();
    });

    expect(mockCreateGoal).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCreateGoal.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(payload).toMatchObject({
      id: 'test-uuid',
      type: 'custom',
      name: 'New car fund',
      target_amount_cents: 1200000,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('blocks a custom goal with no name', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-type-custom' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-goal-form-save-header' }).props.onPress();
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('name'));
    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('blocks a custom goal with no target amount', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-type-custom' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-name' }).props.onChangeText('Car');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-goal-form-save-header' }).props.onPress();
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('target'));
    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('prefills an existing goal and saves via updateGoal (with current + allocation)', async () => {
    mockRouteParams = { goalId: 'g-1' };
    mockListGoals.mockResolvedValue({
      goals: [
        {
          id: 'g-1',
          household_id: 'hh-test',
          type: 'custom',
          name: 'Vacation',
          target_amount_cents: 500000,
          current_amount_cents: 100000,
          monthly_allocation_cents: 25000,
          months_of_expenses: null,
          target_date: null,
          sort_order: 0,
          created_at: '',
          updated_at: '',
        },
      ],
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.findByProps({ testID: 'savings-goal-target' }).props.value).toBe('5000');
    expect(root.findByProps({ testID: 'savings-goal-current' }).props.value).toBe('1000');
    expect(root.findByProps({ testID: 'savings-goal-allocation' }).props.value).toBe('250');

    await act(async () => {
      root.findByProps({ testID: 'savings-goal-allocation' }).props.onChangeText('300');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-goal-form-save-header' }).props.onPress();
    });
    expect(mockUpdateGoal).toHaveBeenCalledTimes(1);
    const [hid, id, payload] = mockUpdateGoal.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(id).toBe('g-1');
    expect(payload).toMatchObject({
      target_amount_cents: 500000,
      current_amount_cents: 100000,
      monthly_allocation_cents: 30000,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('deletes a goal through the delete control', async () => {
    mockRouteParams = { goalId: 'g-1' };
    mockListGoals.mockResolvedValue({
      goals: [
        {
          id: 'g-1',
          household_id: 'hh-test',
          type: 'custom',
          name: 'Vacation',
          target_amount_cents: 500000,
          current_amount_cents: 0,
          monthly_allocation_cents: null,
          months_of_expenses: null,
          target_date: null,
          sort_order: 0,
          created_at: '',
          updated_at: '',
        },
      ],
    });
    const { Alert } = require('react-native');
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-goal-form-delete' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockDeleteGoal).toHaveBeenCalledWith('hh-test', 'g-1');
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('cancels back to the previous screen', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-goal-form-cancel' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('re-enables suggestion auto-fill when switching back to the safety-pillow type', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      await Promise.resolve();
    });
    // Switch to custom then back to emergency_fund.
    await act(async () => root.findByProps({ testID: 'savings-goal-type-custom' }).props.onPress());
    await act(async () =>
      root.findByProps({ testID: 'savings-goal-type-emergency_fund' }).props.onPress()
    );
    // Changing months now re-fetches and re-fills the suggested target.
    await act(async () => {
      root.findByProps({ testID: 'savings-goal-months-9' }).props.onPress();
      await Promise.resolve();
    });
    expect(root.findByProps({ testID: 'savings-goal-target' }).props.value).toBe('9000');
  });

  it('alerts and returns when the edited goal no longer exists', async () => {
    mockRouteParams = { goalId: 'missing' };
    mockListGoals.mockResolvedValue({ goals: [] });
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Goal not found', expect.any(String));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('alerts and returns when loading the goal fails', async () => {
    mockRouteParams = { goalId: 'g-1' };
    mockListGoals.mockRejectedValue(new Error('boom'));
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Could not load goal', expect.any(String));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('clears the suggestion when the emergency-fund fetch fails', async () => {
    mockRouteParams = {};
    mockGetEmergencyFundSuggestion.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    // No suggestion card and target stays empty (nothing to auto-fill).
    expect(tree.root.findByProps({ testID: 'savings-goal-target' }).props.value).toBe('');
  });

  it('toasts an error when saving fails', async () => {
    mockRouteParams = {};
    mockCreateGoal.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-goal-type-custom' }).props.onPress());
    await act(async () => root.findByProps({ testID: 'savings-goal-name' }).props.onChangeText('Car'));
    await act(async () =>
      root.findByProps({ testID: 'savings-goal-target' }).props.onChangeText('100')
    );
    await act(async () => {
      await root.findByProps({ testID: 'savings-goal-form-save-header' }).props.onPress();
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('save'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('alerts when deleting fails', async () => {
    mockRouteParams = { goalId: 'g-1' };
    mockListGoals.mockResolvedValue({
      goals: [
        {
          id: 'g-1',
          household_id: 'hh-test',
          type: 'custom',
          name: 'Vacation',
          target_amount_cents: 500000,
          current_amount_cents: 0,
          monthly_allocation_cents: null,
          months_of_expenses: null,
          target_date: null,
          sort_order: 0,
          created_at: '',
          updated_at: '',
        },
      ],
    });
    mockDeleteGoal.mockRejectedValue(new Error('boom'));
    const { Alert } = require('react-native');
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-goal-form-delete' }).props.onPress();
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('delete'));
    alertSpy.mockRestore();
  });

  it('prefills the target date of an existing custom goal and re-formats it on save', async () => {
    mockRouteParams = { goalId: 'g-1' };
    mockListGoals.mockResolvedValue({
      goals: [
        {
          id: 'g-1',
          household_id: 'hh-test',
          type: 'custom',
          name: 'Vacation',
          target_amount_cents: 500000,
          current_amount_cents: 0,
          monthly_allocation_cents: null,
          months_of_expenses: null,
          target_date: '2027-01-15',
          sort_order: 0,
          created_at: '',
          updated_at: '',
        },
      ],
    });
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    // Save is gated on the form being dirty (useUnsavedChanges), so nudge an
    // unrelated field — leaving the loaded target date untouched — to make the
    // save actually route through updateGoal and prove the date round-trips.
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-goal-name' }).props.onChangeText('Vacation fund');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-goal-form-save-header' }).props.onPress();
    });
    const [, , payload] = mockUpdateGoal.mock.calls[0];
    expect(payload.target_date).toBe('2027-01-15');
  });

  it('opens the date picker, selects and clears a target date (custom goal)', async () => {
    mockRouteParams = {};
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-goal-type-custom' }).props.onPress());

    // Open the picker.
    await act(async () => root.findByProps({ testID: 'savings-goal-date-picker' }).props.onPress());
    // Drive its onChange with a concrete date.
    const chosen = new Date(2028, 5, 10, 12, 0, 0);
    await act(async () => {
      root.findByProps({ testID: 'date-time-picker' }).props.onChange({}, chosen);
    });
    expect(root.findByProps({ testID: 'savings-goal-date-picker' }).props).toBeTruthy();

    // Dismiss the iOS picker via its Done button (picker container's other button).
    await act(async () => {
      const container = root.findByProps({ testID: 'date-time-picker' }).parent!.parent!;
      const done = container.findAll((n) => typeof n.props?.onPress === 'function')[0];
      done.props.onPress();
    });
    expect(root.findAllByProps({ testID: 'date-time-picker' })).toHaveLength(0);

    // Clear it again.
    await act(async () => root.findByProps({ testID: 'savings-goal-date-clear' }).props.onPress());
    expect(root.findAllByProps({ testID: 'savings-goal-date-clear' })).toHaveLength(0);
  });

  it('formats a sub-$1000 essential-spending suggestion as whole dollars', async () => {
    mockRouteParams = {};
    mockGetEmergencyFundSuggestion.mockResolvedValue({
      suggestedTarget: 900000,
      essentialMonthlySpending: 50000,
      months: 6,
    });
    const tree = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    expect(allText(tree.root)).toContain('$500');
  });
});
