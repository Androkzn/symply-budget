/**
 * The banner that explains an unenrolled device.
 *
 * A fresh install now adopts the household the account already owns instead of
 * minting an empty one. That removed the orphan households but left the member
 * somewhere that LOOKS fine and is not: real household name, "Active" pill, a
 * dashboard offering "Add income" — and every write silently refused, because
 * the household key can only arrive from a device that already holds it. This
 * banner is the only thing that says so, which is why "renders nothing" is as
 * important a case here as "renders".
 */
const mockLocalFirst = jest.fn(() => true);
const mockSessionOpen = jest.fn(() => true);
let mockHouseholds: Array<{ householdId: string; awaitingEnrolment: boolean }> = [];

jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst(),
}));

jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => mockSessionOpen(),
  getActiveBudgetHouseholdId: () => mockHouseholds[0]?.householdId ?? null,
  listLocalBudgetHouseholds: () => mockHouseholds,
  // Returns an unsubscribe, like the real one — the banner subscribes because
  // enrolment completes inside a sync, not from anything on this screen.
  subscribeToLedgerChanges: () => () => undefined,
}));

const mockOpenURL = jest.fn((_url: string) => Promise.resolve(true));
jest.mock('expo-linking', () => ({
  __esModule: true,
  createURL: (path: string, opts?: { queryParams?: Record<string, string> }) =>
    `simplebudget://${path}?${new URLSearchParams(opts?.queryParams ?? {}).toString()}`,
  openURL: (url: string) => mockOpenURL(url),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { useBudgetSyncStatusStore } from '@features/budget/local/sync/syncStatusStore';

import { BudgetEnrolmentBanner } from '../BudgetEnrolmentBanner';

async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetEnrolmentBanner />
      </ThemeProvider>,
    );
  });
  return r;
}

beforeEach(() => {
  mockHouseholds = [];
  useBudgetSyncStatusStore.getState().reset();
  useBudgetSyncStatusStore.getState().setResult({ membershipConfirmed: true });
  mockOpenURL.mockClear();
  mockLocalFirst.mockReturnValue(true);
  mockSessionOpen.mockReturnValue(true);
});

describe('BudgetEnrolmentBanner', () => {
  it('shows received data as processing until the screen refresh completes', async () => {
    mockHouseholds = [{ householdId:'hh_a', awaitingEnrolment:false }];
    useBudgetSyncStatusStore.getState().setResult({backfilling:true,stage:'applying',phase:'syncing',recentlyActivePeers:1});
    const r = await render();
    expect(JSON.stringify(r.toJSON())).toContain('Data received, processing…');
    await act(async () => {useBudgetSyncStatusStore.getState().setResult({backfilling:false,stage:'done',phase:'ok'});});
    expect(r.root.findAllByProps({testID:'budget-enrolment-banner'})).toHaveLength(0);
  });

  it('renders nothing for an enrolled device', async () => {
    mockHouseholds = [{ householdId: 'hh_a', awaitingEnrolment: false }];
    const r = await render();
    expect(r.root.findAllByProps({ testID: 'budget-enrolment-banner' })).toHaveLength(0);
  });

  it('does not show another household’s enrollment over the active budget', async () => {
    mockHouseholds = [
      { householdId: 'hh_a', awaitingEnrolment: false },
      { householdId: 'hh_b', awaitingEnrolment: true },
    ];
    const r = await render();
    expect(r.root.findAllByProps({ testID: 'budget-enrolment-banner' })).toHaveLength(0);
  });

  it('tells the member their data is safe and what unblocks it', async () => {
    mockHouseholds = [{ householdId: 'hh_b', awaitingEnrolment: true }];
    const r = await render();
    const text = JSON.stringify(r.toJSON());
    // The three things a member stuck here needs: why it is empty, that nothing
    // is lost, and that saving will not work until they act.
    expect(text).not.toContain('waiting to be approved');
    expect(text).toContain('Preparing your household data');
    expect(text).toContain('no new invitation is needed');
    expect(text).not.toContain('Restore from Backup');
  });

  it('never promises that an approving device exists', async () => {
    // A household roster can hold only a GHOST — a previous install of this same
    // device, still `active`, unreachable forever, and carrying the SAME label as
    // the device showing this banner. "Waiting for your other device" is true and
    // unfollowable there, so the copy must not assert one exists, and must always
    // offer the route where the member can see the real list and recover.
    mockHouseholds = [{ householdId: 'hh_b', awaitingEnrolment: true }];
    useBudgetSyncStatusStore.getState().setResult({ recentlyActivePeers: 0 });
    const r = await render();
    const text = JSON.stringify(r.toJSON());
    expect(text).not.toContain('your other device');
    expect(text).toContain('restore from a backup');
  });

  it('opens Device Sync by URL, carrying a navNonce', async () => {
    mockHouseholds = [{ householdId: 'hh_b', awaitingEnrolment: true }];
    const r = await render();
    await act(async () => {
      r.root.findByProps({ testID: 'budget-enrolment-banner-cta' }).props.onPress();
    });
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    const url = mockOpenURL.mock.calls[0]![0];
    expect(url).toContain('screen=BudgetSync');
    // Without it NavigationHandler dedupes on screen:itemId:navNonce and the
    // second tap is silently ignored — a button that looks dead.
    expect(url).toMatch(/navNonce=\d+/);
  });

  it('stays out of the way when local-first is off', async () => {
    mockLocalFirst.mockReturnValue(false);
    mockHouseholds = [{ householdId: 'hh_b', awaitingEnrolment: true }];
    const r = await render();
    expect(r.root.findAllByProps({ testID: 'budget-enrolment-banner' })).toHaveLength(0);
  });
});


it('continues showing history progress after the household key arrives', async () => {
  mockHouseholds = [{ householdId: 'hh_a', awaitingEnrolment: false }];
  useBudgetSyncStatusStore.getState().setResult({ backfilling: true, stage: 'downloading', recentlyActivePeers: 1, snapshotProgress: { done: 2, total: 7 } });
  const r = await render();
  const text = JSON.stringify(r.toJSON());
  expect(text).toContain('Syncing your household data');
  expect(text).toContain('Downloading household history');
  expect(text).not.toContain('Restore from Backup');
});

it('shows a sync failure separately from waiting for participants', async () => {
  mockHouseholds = [{ householdId: 'hh_a', awaitingEnrolment: true }];
  useBudgetSyncStatusStore.getState().setResult({ phase: 'error', recentlyActivePeers: 1 });
  const r = await render();
  expect(JSON.stringify(r.toJSON())).toContain('Sync is temporarily unavailable');
});
