/**
 * Budget → Invite & Household → "IN THIS HOUSEHOLD".
 *
 * Budget V2 had no member list at all: a household was represented by its
 * DEVICES and by whoever was waiting at the door, so "who else is in this
 * budget?" had no answer anywhere in the app. Pinned here: everyone is named,
 * everyone gets a face, you are marked as you, and looking at the list refreshes
 * it — that last one is what makes a peer's rename show up without a relaunch.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

const mockRefreshRoster = jest.fn(async () => []);
jest.mock('@features/budget/local/householdRoster', () => {
  const actual = jest.requireActual('@features/budget/local/householdRoster');
  return {
    __esModule: true,
    ...actual,
    refreshBudgetHouseholdRoster: () => mockRefreshRoster(),
  };
});

jest.mock('@features/budget/local/flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => true,
}));

/** Flipped by the enrolment test: a household claimed but not yet approved. */
let mockAwaitingEnrolment = false;

jest.mock('@features/budget/local/engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => true,
  isAwaitingHouseholdEnrolment: () => mockAwaitingEnrolment,
  getLocalLedger: () => ({
    memberId: 'usr_ada',
    deviceId: 'dev_1',
    household: { id: 'hh_local_1', created_at: '2026-01-01T00:00:00.000Z' },
  }),
  // BR-016: the card reads the active household through `useSyncExternalStore`
  // so it repaints on a switch rather than showing the previous household's
  // roster. Both arguments must be real functions — omitting the subscribe or
  // the snapshot surfaces as React's opaque "getSnapshot is not a function",
  // which says nothing about which mock is short.
  getActiveBudgetHouseholdId: () => 'hh_local_1',
  subscribeToLedgerChanges: () => () => undefined,
}));

// `useFocusEffect` runs its callback on mount in this harness — which is the
// behaviour under test: opening the list is itself a refresh.
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    __esModule: true,
    useFocusEffect: (cb: () => undefined | (() => void)) => React.useEffect(cb, [cb]),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import { BudgetHouseholdMembersCard } from '../BudgetHouseholdMembersCard';

const ADA = {
  id: 'usr_ada',
  user_id: 'usr_ada',
  display_name: 'Ada Lovelace',
  avatar_url: 'https://api.example.com/avatars/usr_ada-1.jpg',
  email: 'ada@example.com',
  role: 'owner' as const,
  joined_at: '2026-01-01T00:00:00.000Z',
};

const ALAN = {
  id: 'usr_alan',
  user_id: 'usr_alan',
  display_name: null,
  avatar_url: null,
  email: 'alan@example.com',
  role: 'member' as const,
  joined_at: '2026-02-01T00:00:00.000Z',
};

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetHouseholdMembersCard />
      </ThemeProvider>,
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return tree;
}

const query = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0] ?? null;

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockAwaitingEnrolment = false;
  useAuthStore.setState({ user: { id: 'usr_ada', email: 'ada@example.com' } } as never);
  // `currentHousehold` matters as much as the members now: the card compares the
  // household the roster was published FOR against the engine's active one, and
  // shows "loading" rather than a roster it cannot confirm belongs here. That is
  // what stops the household you just left staying on screen after a switch — so
  // a fixture without it renders the loading state, not the list.
  useHouseholdStore.setState({
    currentHouseholdMembers: [ADA, ALAN],
    currentHousehold: { id: 'hh_local_1' } as never,
  });
});

describe('BudgetHouseholdMembersCard', () => {
  it('names every member in the household', async () => {
    const tree = await render();
    const rendered = texts(tree);

    expect(rendered).toContain('Ada Lovelace');
    // No display name set — the address is what this household recognises them
    // by, and it beats the old "Household member".
    expect(rendered).toContain('alan');
    expect(rendered.some((t) => t.includes('Household member'))).toBe(false);
  });

  it('gives every member a face, falling back to initials over a real url', async () => {
    const tree = await render();
    const images = tree.root.findAll(
      (n) => typeof n.props?.source === 'object' && n.props?.source?.uri,
    );

    expect(images.map((i) => i.props.source.uri)).toContain(
      'https://api.example.com/avatars/usr_ada-1.jpg',
    );
    // Alan has no avatar, so he gets initials rather than a broken image.
    expect(texts(tree)).toContain('AL');
  });

  it('marks which row is you', async () => {
    const tree = await render();

    expect(query(tree, 'budget-household-member-usr_ada')).not.toBeNull();
    expect(query(tree, 'budget-household-member-usr_alan')).not.toBeNull();
    expect(texts(tree)).toContain('You');
  });

  it('says the role in plain words, never the control plane vocabulary', async () => {
    const tree = await render();
    const rendered = texts(tree).join(' | ');

    expect(rendered).toContain('Owner');
    expect(rendered).toContain('Member');
    expect(rendered).not.toContain('ADULT');
  });

  /** The fourth refresh trigger — the one only a screen can know about. */
  it('refreshes the roster when the list is looked at', async () => {
    await render();
    expect(mockRefreshRoster).toHaveBeenCalledTimes(1);
  });

  it('explains itself rather than showing an empty card', async () => {
    useHouseholdStore.setState({ currentHouseholdMembers: [] });
    mockRefreshRoster.mockImplementation(() => new Promise(() => []) as Promise<never[]>);

    const tree = await render();

    expect(query(tree, 'budget-household-members-empty')).not.toBeNull();
    expect(texts(tree).join(' ')).toContain('Loading the people');
  });

  /**
   * A household this device has claimed but not been let into.
   *
   * Every read of that household is answered 403 until the owner approves, so
   * the only roster in the store is the self-row seed — and rendering it named
   * the waiting member alone, badged OWNER, under "IN THIS HOUSEHOLD". Seen on
   * staging: the invitee's screen showed them as the owner of the household
   * they were still queuing outside.
   */
  it('claims nobody is in a household this device is still queuing to join', async () => {
    mockAwaitingEnrolment = true;
    useHouseholdStore.setState({
      currentHouseholdMembers: [{ ...ADA, role: 'owner' as const }],
      currentHousehold: { id: 'hh_local_1' } as never,
    });

    const tree = await render();
    const rendered = texts(tree).join(' | ');

    expect(query(tree, 'budget-household-members-empty')).not.toBeNull();
    // The card explains the wait in terms of data arriving, not of approval —
    // the copy the component ships today (see the `awaitingEnrolment` branch).
    expect(rendered).toContain('as this device receives the household data');
    expect(rendered).not.toContain('Owner');
    expect(query(tree, 'budget-household-member-usr_ada')).toBeNull();
  });
});
