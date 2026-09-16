/**
 * Budget → Settings → Danger zone.
 *
 * Two irreversible local operations, so what is pinned here is mostly what does
 * NOT happen: nothing runs on the first tap, Cancel runs nothing at all, and the
 * erase confirmation says out loud that backups survive (and warns when there
 * are none to survive).
 */
const mockGetPrevious = jest.fn();
const mockCleanUp = jest.fn();
const mockErase = jest.fn();

jest.mock('@features/budget/local/localDataReset', () => ({
  getPreviousLocalBudgetData: (...a: unknown[]) => mockGetPrevious(...a),
  cleanUpPreviousLocalBudgetData: (...a: unknown[]) => mockCleanUp(...a),
  eraseLocalBudgetData: (...a: unknown[]) => mockErase(...a),
}));

const mockListLocalBackups = jest.fn();
jest.mock('@features/budget/local/backup/backupDestinations', () => ({
  listLocalBudgetBackups: (...a: unknown[]) => mockListLocalBackups(...a),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetDangerZoneCard } from '../BudgetDangerZoneCard';

const MB = 1024 * 1024;

const mockOnOpenBackup = jest.fn();

async function renderCard() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetDangerZoneCard onOpenBackup={mockOnOpenBackup} />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return tree;
}

const findByTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props?.testID === id);

const queryByTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

const hasText = (tree: ReactTestRenderer.ReactTestRenderer, sub: string) =>
  collectRenderedText(tree).some((t) => t.includes(sub));

/** Tap a button and flush the promise chain its handler starts. */
async function press(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  await act(async () => {
    findByTestID(tree, id).props.onPress();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPrevious.mockResolvedValue([
    { label: 'memberA', sizeBytes: 2 * MB, archivedAt: '2026-08-01T10:00:00.000Z' },
    { label: 'memberB', sizeBytes: 1 * MB, archivedAt: '2026-07-01T10:00:00.000Z' },
  ]);
  mockCleanUp.mockResolvedValue({ removed: 2, bytesFreed: 3 * MB });
  mockErase.mockResolvedValue({ removed: 0, bytesFreed: 0 });
  mockListLocalBackups.mockResolvedValue([{ fileName: 'symply-budget-backup-2026-08-10-0900.json' }]);
});

describe('BudgetDangerZoneCard — previous data', () => {
  it('summarises what earlier sign-ins left, with the disk they hold', async () => {
    const tree = await renderCard();
    expect(findByTestID(tree, 'budget-danger-previous-summary').props.children).toBe(
      '2 budgets from earlier sign-ins · 3.0 MB'
    );
  });

  it('offers nothing to clean up when the device is already clear', async () => {
    mockGetPrevious.mockResolvedValue([]);
    const tree = await renderCard();
    expect(findByTestID(tree, 'budget-danger-previous-summary').props.children).toBe(
      'Nothing left over from earlier sign-ins'
    );
    expect(findByTestID(tree, 'budget-danger-cleanup').props.disabled).toBe(true);
  });

  it('asks before deleting anything', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-cleanup');
    expect(mockCleanUp).not.toHaveBeenCalled();
    expect(queryByTestID(tree, 'budget-danger-cleanup-confirm-panel')).toBeTruthy();
    // The warning has to say the live budget is safe — that is the whole
    // difference between this row and the one below it.
    expect(hasText(tree, 'Your own budget is not touched.')).toBe(true);
  });

  it('deletes the retired ledgers on confirm and reports what it freed', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-cleanup');
    await press(tree, 'budget-danger-cleanup-confirm');

    expect(mockCleanUp).toHaveBeenCalledTimes(1);
    expect(findByTestID(tree, 'budget-danger-note').props.children).toBe(
      'Removed 2 old budgets, freeing 3.0 MB.'
    );
    // Panel closes, and the list is re-read so the row reflects the new state.
    expect(queryByTestID(tree, 'budget-danger-cleanup-confirm-panel')).toBeNull();
    expect(mockGetPrevious).toHaveBeenCalledTimes(2);
  });

  it('cancelling deletes nothing', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-cleanup');
    await press(tree, 'budget-danger-cleanup-cancel');
    expect(mockCleanUp).not.toHaveBeenCalled();
    expect(queryByTestID(tree, 'budget-danger-cleanup-confirm-panel')).toBeNull();
  });

  it('surfaces a failure instead of implying the data went away', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCleanUp.mockRejectedValue(new Error('boom'));
    const tree = await renderCard();
    await press(tree, 'budget-danger-cleanup');
    await press(tree, 'budget-danger-cleanup-confirm');
    expect(findByTestID(tree, 'budget-danger-note').props.children).toBe(
      'Could not remove the old data. Try again.'
    );
  });
});

describe('BudgetDangerZoneCard — erase this device', () => {
  it('asks before erasing, and says backups survive', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-erase');

    expect(mockErase).not.toHaveBeenCalled();
    expect(queryByTestID(tree, 'budget-danger-erase-confirm-panel')).toBeTruthy();
    expect(hasText(tree, 'It cannot be')).toBe(true);
    expect(hasText(tree, 'Your saved backups and the phrases that open them are kept')).toBe(true);
    // A backup exists, so the "no way back" warning stays out of the way.
    expect(queryByTestID(tree, 'budget-danger-no-backup-warning')).toBeNull();
  });

  it('warns when this device has no backup to fall back on', async () => {
    mockListLocalBackups.mockResolvedValue([]);
    const tree = await renderCard();
    await press(tree, 'budget-danger-erase');
    expect(queryByTestID(tree, 'budget-danger-no-backup-warning')).toBeTruthy();
  });

  it('sends the member to Backup & Restore without erasing', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-erase');
    await press(tree, 'budget-danger-backup-first');

    expect(mockOnOpenBackup).toHaveBeenCalledTimes(1);
    expect(mockErase).not.toHaveBeenCalled();
    expect(queryByTestID(tree, 'budget-danger-erase-confirm-panel')).toBeNull();
  });

  it('erases on confirm and says the device is starting over', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-erase');
    await press(tree, 'budget-danger-erase-confirm');

    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(findByTestID(tree, 'budget-danger-note').props.children).toBe(
      'Erased. This device is starting from an empty budget.'
    );
  });

  it('cancelling erases nothing', async () => {
    const tree = await renderCard();
    await press(tree, 'budget-danger-erase');
    await press(tree, 'budget-danger-erase-cancel');
    expect(mockErase).not.toHaveBeenCalled();
    expect(queryByTestID(tree, 'budget-danger-erase-confirm-panel')).toBeNull();
  });

  it('admits when the wipe did not finish', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockErase.mockRejectedValue(new Error('boom'));
    const tree = await renderCard();
    await press(tree, 'budget-danger-erase');
    await press(tree, 'budget-danger-erase-confirm');
    // Never "Erased." on a failure — some data may still be on the phone.
    expect(findByTestID(tree, 'budget-danger-note').props.children).toContain(
      'Could not erase everything'
    );
  });
});
