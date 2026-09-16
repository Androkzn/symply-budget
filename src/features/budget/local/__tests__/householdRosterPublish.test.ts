/**
 * Publishing the roster — the half that writes to the store.
 *
 * `householdRoster.test.ts` covers the pure builders. This file covers the
 * guards around the write, which are the parts that can silently make peers
 * VANISH from a member list: publishing a household this device is no longer
 * holding, or letting a transient empty answer overwrite a roster that names
 * people. On screen, both look exactly like "they left".
 */
 

const mockFetchControlPlaneState = jest.fn();
jest.mock('../controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: (...a: unknown[]) => mockFetchControlPlaneState(...a),
}));

let mockSessionOpen = true;
jest.mock('../engine', () => ({
  __esModule: true,
  isLocalBudgetSessionOpen: () => mockSessionOpen,
  getLocalLedger: () => ({
    memberId: 'usr_ada',
    deviceId: 'dev_1',
    household: { id: 'hh_local_1', created_at: '2026-01-01T00:00:00.000Z' },
  }),
}));

let mockLocalFirst = true;
jest.mock('../flag', () => ({
  __esModule: true,
  isBudgetLocalFirst: () => mockLocalFirst,
}));

import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import type { ControlPlaneState } from '../controlPlaneClient';
import {
  publishBudgetRoster,
  refreshBudgetHouseholdRoster,
  selfBudgetRoster,
} from '../householdRoster';

function state(overrides: Partial<ControlPlaneState> = {}): ControlPlaneState {
  return {
    householdId: 'hh_local_1',
    keyEpoch: 1,
    securityRevision: 1,
    members: [],
    devices: [],
    ...overrides,
  };
}

const TWO_MEMBERS = state({
  members: [
    {
      userId: 'usr_ada',
      role: 'OWNER',
      status: 'active',
      displayName: 'Ada Lovelace',
      avatarUrl: 'https://api.example.com/avatars/usr_ada-1.jpg',
      email: 'ada@example.com',
    },
    {
      userId: 'usr_alan',
      role: 'ADULT',
      status: 'active',
      displayName: 'Alan Turing',
      avatarUrl: null,
      email: 'alan@example.com',
    },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionOpen = true;
  mockLocalFirst = true;
  useHouseholdStore.setState({ currentHouseholdMembers: [] });
  useAuthStore.setState({
    user: {
      id: 'usr_ada',
      email: 'ada@example.com',
      display_name: 'Ada Lovelace',
      avatar_url: 'https://api.example.com/avatars/usr_ada-1.jpg',
    },
  } as never);
});

describe('publishBudgetRoster', () => {
  it('puts every member — name and avatar — into the store the screens read', () => {
    publishBudgetRoster(TWO_MEMBERS);

    const roster = useHouseholdStore.getState().currentHouseholdMembers;
    expect(roster.map((m) => m.display_name)).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(roster[0]!.avatar_url).toBe('https://api.example.com/avatars/usr_ada-1.jpg');
    // Keyed on the user id, which is what ledger rows carry.
    expect(roster.map((m) => m.id)).toEqual(['usr_ada', 'usr_alan']);
  });

  /**
   * A control plane mid-bootstrap answers with no members. Writing that over a
   * roster that already names people would empty the pension switcher and the
   * savings member map — indistinguishable, on screen, from everyone leaving.
   */
  it('refuses to blank a populated roster with an empty answer', () => {
    publishBudgetRoster(TWO_MEMBERS);
    const before = useHouseholdStore.getState().currentHouseholdMembers;

    const kept = publishBudgetRoster(state({ members: [] }));

    expect(kept).toEqual(before);
    expect(useHouseholdStore.getState().currentHouseholdMembers).toHaveLength(2);
  });

  it('publishes an empty roster when there was nothing to lose', () => {
    publishBudgetRoster(state({ members: [] }));
    expect(useHouseholdStore.getState().currentHouseholdMembers).toEqual([]);
  });

  /** A household switch that raced the fetch must not cross-contaminate. */
  it('ignores state about a household this device is not holding', () => {
    publishBudgetRoster(TWO_MEMBERS);

    publishBudgetRoster(
      state({
        householdId: 'hh_other',
        members: [{ userId: 'usr_zoe', role: 'OWNER', status: 'active', displayName: 'Zoe' }],
      }),
    );

    expect(
      useHouseholdStore.getState().currentHouseholdMembers.map((m) => m.display_name),
    ).toEqual(['Ada Lovelace', 'Alan Turing']);
  });
});

describe('selfBudgetRoster', () => {
  it('names and pictures you from the auth store, for a cold offline start', () => {
    const [self] = selfBudgetRoster();

    expect(self).toMatchObject({
      id: 'usr_ada',
      user_id: 'usr_ada',
      display_name: 'Ada Lovelace',
      // The old seed hardcoded null here, so your own avatar never appeared.
      avatar_url: 'https://api.example.com/avatars/usr_ada-1.jpg',
      role: 'owner',
    });
  });

  it('uses the ledger member id, not a synthesised one', () => {
    expect(selfBudgetRoster()[0]!.id).not.toMatch(/^mem_/);
  });

  it('is empty when nobody is signed in', () => {
    useAuthStore.setState({ user: null } as never);
    expect(selfBudgetRoster()).toEqual([]);
  });
});

describe('refreshBudgetHouseholdRoster', () => {
  it('fetches and publishes', async () => {
    mockFetchControlPlaneState.mockResolvedValue(TWO_MEMBERS);

    const roster = await refreshBudgetHouseholdRoster();

    expect(mockFetchControlPlaneState).toHaveBeenCalledWith('hh_local_1');
    expect(roster).toHaveLength(2);
  });

  /**
   * The offline case, and the reason this never throws: a member list that
   * empties itself the moment the network drops is worse than a stale one.
   */
  it('keeps the last known roster when the control plane is unreachable', async () => {
    publishBudgetRoster(TWO_MEMBERS);
    mockFetchControlPlaneState.mockRejectedValue(new Error('offline'));

    const roster = await refreshBudgetHouseholdRoster();

    expect(roster).toHaveLength(2);
    expect(useHouseholdStore.getState().currentHouseholdMembers).toHaveLength(2);
  });

  it('does nothing on a server-backed household', async () => {
    mockLocalFirst = false;
    await refreshBudgetHouseholdRoster();
    expect(mockFetchControlPlaneState).not.toHaveBeenCalled();
  });

  it('does nothing before the local session is open', async () => {
    mockSessionOpen = false;
    await refreshBudgetHouseholdRoster();
    expect(mockFetchControlPlaneState).not.toHaveBeenCalled();
  });
});
