/**
 * BudgetPlannedFitCard — interaction coverage.
 *
 * The sibling `BudgetPlannedFitCard.test.tsx` pins the read-only render (summary
 * figures, window toggles, fit rows). This file drives the *edit* affordances the
 * card exposes straight from the dashboard: the per-item action menu
 * (ActionSheetIOS on iOS, Alert on Android) and each action it fans out to —
 * Open task (`navigateToTask`), Edit (`onEditItem`), Duplicate
 * (`budgetApi.createItem`) and Delete (`budgetApi.deleteItem`) — plus their
 * success, failure and "no household" guards. Together these exercise
 * `handleDuplicate`, `confirmDelete`, `openItemMenu` and the interactive row
 * press/long-press wiring.
 *
 * Stores + API are mocked so the async flows are deterministic and no network is
 * touched; `navigateToTask` is the jest.setup global stub, asserted directly.
 */

// Mutable so a single spec can flip "no current household" to exercise the guards.
let mockCurrentHousehold: { id: string } | null = { id: 'hh-consistency' };
const mockMarkInsightsDirty = jest.fn();
const mockCreateItem = jest.fn();
const mockDeleteItem = jest.fn();

jest.mock('@api/budget', () => ({
  budgetApi: {
    createItem: (...args: unknown[]) => mockCreateItem(...args),
    deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: mockCurrentHousehold };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { markInsightsDirty: mockMarkInsightsDirty };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { MonthlyOverview } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';
import { navigateToTask } from '@services/navigation';

import {
  CANONICAL_MONTH,
  CANONICAL_YEAR,
  makeCanonicalMonthlyOverview,
} from '../../../test-utils/budgetConsistency';
import { BudgetPlannedFitCard } from '../BudgetPlannedFitCard';

type AlertButton = { text?: string; onPress?: () => void | Promise<void> };

function render(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

/** Interactive fit rows, in render order (high → medium → low priority). */
function rows(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByProps({ testID: 'budget-planned-fit-row' });
}

/** Drive the iOS action sheet to pick option `index` when the next menu opens. */
function pickActionSheet(index: number) {
  return jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((_opts: unknown, cb: unknown) => (cb as (i: number) => void)(index));
}

describe('BudgetPlannedFitCard — item action menu', () => {
  const overview: MonthlyOverview = makeCanonicalMonthlyOverview();
  // Row 0 == "Water filter" (bi-filter): the highest-priority affordable item and,
  // with no source_type, an item whose menu is [Edit, Duplicate, Delete].
  const FIRST_ITEM_ID = 'bi-filter';
  const FIRST_ITEM_TITLE = 'Water filter';

  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentHousehold = { id: 'hh-consistency' };
    Platform.OS = 'ios';
    mockCreateItem.mockResolvedValue({ id: 'new-item' });
    mockDeleteItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders interactive rows only when an edit handler is supplied', () => {
    const readOnly = render(
      <BudgetPlannedFitCard overview={overview} year={CANONICAL_YEAR} month={CANONICAL_MONTH} />
    );
    // Without onEditItem the rows carry no press handler (canEdit === false).
    expect(rows(readOnly)[0].props.onPress).toBeUndefined();
    expect(rows(readOnly)[0].props.accessibilityRole).toBeUndefined();

    const editable = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );
    expect(typeof rows(editable)[0].props.onPress).toBe('function');
    expect(rows(editable)[0].props.accessibilityRole).toBe('button');
  });

  it('long-press opens the iOS action sheet and Edit calls onEditItem', () => {
    pickActionSheet(0); // no linked task → index 0 is "Edit"
    const onEditItem = jest.fn();
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={onEditItem}
      />
    );

    act(() => rows(tree)[0].props.onLongPress());

    expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        title: FIRST_ITEM_TITLE,
        options: ['Edit', 'Duplicate', 'Delete', 'Cancel'],
        cancelButtonIndex: 3,
        destructiveButtonIndex: 2,
      }),
      expect.any(Function)
    );
    expect(onEditItem).toHaveBeenCalledWith(FIRST_ITEM_ID);
  });

  it('Duplicate creates a copy of the item and marks insights dirty', async () => {
    pickActionSheet(1); // "Duplicate"
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    await act(async () => {
      rows(tree)[0].props.onPress();
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({
        title: FIRST_ITEM_TITLE,
        priority: 'high',
        timeframe: 'immediate',
        estimated_cost_min: 25000,
        estimated_cost_max: 25000,
        is_recurring: false,
        target_date: `${CANONICAL_YEAR}-07-15`,
      })
    );
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-consistency');
  });

  it('carries recurrence details through a Duplicate of a recurring item', async () => {
    pickActionSheet(1); // "Duplicate"
    const recurringOverview: MonthlyOverview = {
      ...overview,
      items: overview.items.map((it) =>
        it.id === FIRST_ITEM_ID
          ? { ...it, is_recurring: true, recurrence_frequency: 'monthly' }
          : it
      ),
    };
    const tree = render(
      <BudgetPlannedFitCard
        overview={recurringOverview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    await act(async () => {
      rows(tree)[0].props.onPress();
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      'hh-consistency',
      expect.objectContaining({ is_recurring: true, recurrence_frequency: 'monthly' })
    );
  });

  it('surfaces an error alert when Duplicate fails', async () => {
    pickActionSheet(1); // "Duplicate"
    mockCreateItem.mockRejectedValueOnce(new Error('network down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    await act(async () => {
      rows(tree)[0].props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Could not duplicate this planned spending.');
    expect(mockMarkInsightsDirty).not.toHaveBeenCalled();
  });

  it('Delete confirms, then deletes the item and marks insights dirty', async () => {
    pickActionSheet(2); // "Delete"
    let deletePress: (() => void | Promise<void>) | undefined;
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _msg, buttons?: AlertButton[] | undefined) => {
        deletePress = buttons?.find((b) => b.text === 'Delete')?.onPress;
      });
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    act(() => rows(tree)[0].props.onPress());

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete planned spending',
      expect.stringContaining(FIRST_ITEM_TITLE),
      expect.any(Array)
    );
    expect(deletePress).toBeDefined();

    await act(async () => {
      await deletePress!();
    });

    expect(mockDeleteItem).toHaveBeenCalledWith('hh-consistency', FIRST_ITEM_ID);
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-consistency');
  });

  it('surfaces an error alert when Delete fails', async () => {
    pickActionSheet(2); // "Delete"
    mockDeleteItem.mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let deletePress: (() => void | Promise<void>) | undefined;
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _msg, buttons?: AlertButton[] | undefined) => {
        // Only the confirm dialog carries buttons; the error alert has none.
        const found = buttons?.find((b) => b.text === 'Delete')?.onPress;
        if (found) deletePress = found;
      });
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    act(() => rows(tree)[0].props.onPress());
    await act(async () => {
      await deletePress!();
    });

    expect(mockDeleteItem).toHaveBeenCalled();
    expect(mockMarkInsightsDirty).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Could not delete this item.');
  });

  it('offers "Open task" for a task-linked item and navigates to it', () => {
    pickActionSheet(0); // linked task present → index 0 is "Open task"
    const linkedOverview: MonthlyOverview = {
      ...overview,
      items: overview.items.map((it) =>
        it.id === FIRST_ITEM_ID
          ? { ...it, source_type: 'task', source_id: 'task-xyz' }
          : it
      ),
    };
    const tree = render(
      <BudgetPlannedFitCard
        overview={linkedOverview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    act(() => rows(tree)[0].props.onPress());

    expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['Open task', 'Edit', 'Duplicate', 'Delete', 'Cancel'],
      }),
      expect.any(Function)
    );
    expect(navigateToTask).toHaveBeenCalledWith('task-xyz');
  });

  it('renders an Alert-based action menu on Android and runs the chosen action', () => {
    Platform.OS = 'android';
    const asSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => {});
    let editPress: (() => void) | undefined;
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _msg, buttons?: AlertButton[] | undefined) => {
        editPress = buttons?.find((b) => b.text === 'Edit')?.onPress as (() => void) | undefined;
      });
    const onEditItem = jest.fn();
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={onEditItem}
      />
    );

    act(() => rows(tree)[0].props.onPress());

    // Android must NOT touch the iOS action sheet.
    expect(asSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(FIRST_ITEM_TITLE, undefined, expect.any(Array));
    expect(editPress).toBeDefined();

    act(() => editPress!());
    expect(onEditItem).toHaveBeenCalledWith(FIRST_ITEM_ID);
  });

  it('no-ops Duplicate and Delete when there is no current household', async () => {
    mockCurrentHousehold = null;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const asSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementationOnce((_opts: unknown, cb: unknown) => (cb as (i: number) => void)(1)) // Duplicate
      .mockImplementationOnce((_opts: unknown, cb: unknown) => (cb as (i: number) => void)(2)); // Delete
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
        onEditItem={jest.fn()}
      />
    );

    await act(async () => {
      rows(tree)[0].props.onPress(); // Duplicate → guard returns early
    });
    await act(async () => {
      rows(tree)[0].props.onPress(); // Delete → guard returns early
    });

    expect(asSpy).toHaveBeenCalledTimes(2);
    expect(mockCreateItem).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
    // confirmDelete bails before ever opening its confirmation dialog.
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
