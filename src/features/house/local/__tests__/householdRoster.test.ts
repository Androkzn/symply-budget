/**
 * Who shares a home, by name and face.
 *
 * Three properties, and each one is a bug that shipped somewhere in the fleet
 * before it was a test:
 *
 *  - the roster's `id` is the USER id, because a local ledger's `memberId` IS
 *    the user id and every row is stamped with it. A synthesised `mem_<uid>`
 *    matches nothing: the row is in the list and still nothing resolves to a
 *    name;
 *  - a roster is kept PER PROPERTY and only the active one is mirrored into the
 *    single-list store, because the only trip that ever fetches property B's
 *    members is B's background sync — and A's names under B read, on screen,
 *    exactly like B's members;
 *  - an EMPTY answer never replaces a populated one, because a control plane
 *    mid-bootstrap answering with no members would otherwise flicker every peer
 *    out of every picker, which is indistinguishable from somebody leaving.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockActive = { id: 'hh-1' as string | null };

jest.mock('../flag', () => ({ __esModule: true, isHouseLocalFirst: () => true }));

jest.mock('../engine', () => ({
  __esModule: true,
  isLocalHouseSessionOpen: () => mockActive.id !== null,
  getLocalHouseLedger: () => ({
    deviceId: 'dev-self',
    memberId: 'u1',
    household: { id: mockActive.id, name: 'Maple Street House', created_at: '2024-01-01T00:00:00Z' },
  }),
}));

jest.mock('../controlPlaneClient', () => ({
  __esModule: true,
  fetchControlPlaneState: jest.fn(),
}));

import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import type { ControlPlaneState } from '../controlPlaneClient';
import {
  buildHouseRoster,
  forgetHouseRoster,
  getHouseRoster,
  houseMemberName,
  publishHouseRoster,
  refreshHouseHouseholdRoster,
  republishActiveHouseRoster,
  resetHouseRosters,
  sortHouseRoster,
} from '../householdRoster';


const { fetchControlPlaneState } = require('../controlPlaneClient') as {
  fetchControlPlaneState: jest.Mock;
};

function state(overrides?: Partial<ControlPlaneState>): ControlPlaneState {
  return {
    householdId: 'hh-1',
    keyEpoch: 1,
    securityRevision: 1,
    members: [
      { userId: 'u1', role: 'OWNER', status: 'active', displayName: 'Ada', email: 'ada@x.test' },
      { userId: 'u2', role: 'ADULT', status: 'active', displayName: null, email: 'bo@x.test' },
    ],
    devices: [
      {
        deviceId: 'dev-1',
        userId: 'u1',
        signingPublicKey: 'aa',
        agreementPublicKey: 'bb',
        status: 'active',
        enrolledAt: '2024-03-02T00:00:00Z',
      },
      {
        deviceId: 'dev-0',
        userId: 'u1',
        signingPublicKey: 'aa',
        agreementPublicKey: 'bb',
        status: 'active',
        enrolledAt: '2024-02-01T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetHouseRosters();
  mockActive.id = 'hh-1';
  useHouseholdStore.setState({ currentHouseholdMembers: [] });
  useAuthStore.setState({
    user: { id: 'u1', email: 'ada@x.test', display_name: 'Ada' },
  } as never);
});

describe('houseMemberName', () => {
  it('prefers what the member chose, then the local part of their address', () => {
    expect(houseMemberName({ display_name: 'Ada', email: 'ada@x.test' })).toBe('Ada');
    expect(houseMemberName({ display_name: null, email: 'bo@x.test' })).toBe('bo');
  });

  it('falls back to a readable noun, never to an id', () => {
    expect(houseMemberName({ display_name: null, email: '' })).toBe('Home member');
    expect(houseMemberName(null)).toBe('Home member');
  });
});

describe('buildHouseRoster', () => {
  it('keys each row on the USER id, which is what ledger rows are stamped with', () => {
    const roster = buildHouseRoster(state());
    expect(roster.map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(roster.map((m) => m.user_id)).toEqual(['u1', 'u2']);
  });

  it("dates a membership from the person's EARLIEST enrolled device", () => {
    // A membership record carries no timestamp of its own, so the first device
    // they enrolled is the closest honest answer to "since when".
    expect(buildHouseRoster(state())[0]?.joined_at).toBe('2024-02-01T00:00:00Z');
  });

  it('drops revoked members — a greyed row reads as "still here"', () => {
    const roster = buildHouseRoster(
      state({
        members: [
          { userId: 'u1', role: 'OWNER', status: 'active' },
          { userId: 'u2', role: 'ADULT', status: 'revoked' },
        ],
      }),
    );
    expect(roster.map((m) => m.user_id)).toEqual(['u1']);
  });

  it('maps the V2 roles onto the two-role shape every screen already renders', () => {
    const roster = buildHouseRoster(state());
    expect(roster.map((m) => m.role)).toEqual(['owner', 'member']);
  });
});

describe('sortHouseRoster', () => {
  it('puts owners first, then everyone else by name', () => {
    const sorted = sortHouseRoster(buildHouseRoster(state()));
    expect(sorted.map((m) => m.user_id)).toEqual(['u1', 'u2']);
  });
});

describe('publishHouseRoster', () => {
  it('mirrors the ACTIVE property into the single-list store', () => {
    publishHouseRoster(state(), 'hh-1');
    expect(useHouseholdStore.getState().currentHouseholdMembers?.map((m) => m.user_id)).toEqual([
      'u1',
      'u2',
    ]);
  });

  it("keeps a background property's roster under its OWN key, and off the screen", () => {
    publishHouseRoster(
      state({
        householdId: 'hh-2',
        members: [{ userId: 'u9', role: 'OWNER', status: 'active', displayName: 'Cy' }],
      }),
      'hh-2',
    );

    // B's answer is remembered…
    expect(getHouseRoster('hh-2').map((m) => m.user_id)).toEqual(['u9']);
    // …and never painted under A. This is the one cross-property bleed a member
    // can actually read: "who are these people?"
    expect(useHouseholdStore.getState().currentHouseholdMembers).toEqual([]);
  });

  it('never replaces a populated roster with an empty answer', () => {
    publishHouseRoster(state(), 'hh-1');
    const kept = publishHouseRoster(state({ members: [] }), 'hh-1');

    expect(kept.map((m) => m.user_id)).toEqual(['u1', 'u2']);
    expect(useHouseholdStore.getState().currentHouseholdMembers?.length).toBe(2);
  });

  it("trusts the CALLER's property id over the server's, because the caller asked", () => {
    // An older Worker that answers without `householdId` must not have a
    // background property's members attributed to the active one.
    publishHouseRoster({ ...state(), householdId: '' } as ControlPlaneState, 'hh-2');
    expect(useHouseholdStore.getState().currentHouseholdMembers).toEqual([]);
    expect(getHouseRoster('hh-2')).toHaveLength(2);
  });
});

describe('republishActiveHouseRoster', () => {
  it('swaps the store to whichever property is now active', () => {
    publishHouseRoster(state(), 'hh-1');
    publishHouseRoster(
      state({
        householdId: 'hh-2',
        members: [{ userId: 'u9', role: 'OWNER', status: 'active', displayName: 'Cy' }],
      }),
      'hh-2',
    );

    mockActive.id = 'hh-2';
    expect(republishActiveHouseRoster().map((m) => m.user_id)).toEqual(['u9']);
    expect(useHouseholdStore.getState().currentHouseholdMembers?.map((m) => m.user_id)).toEqual([
      'u9',
    ]);
  });

  it('lands a switch on "just you" rather than on a blank member list', () => {
    // True, and momentary: you are always in your own home, and the real answer
    // arrives on that property's next sync.
    mockActive.id = 'hh-3';
    expect(republishActiveHouseRoster().map((m) => m.user_id)).toEqual(['u1']);
  });
});

describe('forgetHouseRoster', () => {
  it('drops a removed property, so a re-join under the same id starts clean', () => {
    publishHouseRoster(state(), 'hh-1');
    forgetHouseRoster('hh-1');
    // Falls back to the store's own seed for the active property rather than to
    // the names of a home this device no longer holds.
    expect(getHouseRoster('hh-1')).toEqual(useHouseholdStore.getState().currentHouseholdMembers);
  });
});

describe('refreshHouseHouseholdRoster', () => {
  it('fetches the NAMED property and publishes what came back', async () => {
    fetchControlPlaneState.mockResolvedValue(state());
    const roster = await refreshHouseHouseholdRoster('hh-1');

    expect(fetchControlPlaneState).toHaveBeenCalledWith('hh-1');
    expect(roster.map((m) => m.user_id)).toEqual(['u1', 'u2']);
  });

  it('keeps the last known roster when the network cannot answer', async () => {
    publishHouseRoster(state(), 'hh-1');
    fetchControlPlaneState.mockRejectedValue(new Error('offline'));

    const roster = await refreshHouseHouseholdRoster('hh-1');
    expect(roster.map((m) => m.user_id)).toEqual(['u1', 'u2']);
  });
});
