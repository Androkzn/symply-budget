import type { ControlPlaneState } from '../controlPlaneClient';
import {
  budgetMemberName,
  buildBudgetRoster,
  sortBudgetRoster,
} from '../householdRoster';

/**
 * The roster is what every Budget surface draws a peer's name and face from.
 * Before it existed, the store held exactly one row — this device's own account
 * — so the pension switcher offered "Household member" and the savings member
 * map said "Member" for everybody else.
 */

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

describe('buildBudgetRoster', () => {
  it('carries the display name and avatar the control plane resolved', () => {
    const roster = buildBudgetRoster(
      state({
        members: [
          {
            userId: 'usr_ada',
            role: 'OWNER',
            status: 'active',
            displayName: 'Ada Lovelace',
            avatarUrl: 'https://api.example.com/avatars/usr_ada-1.jpg',
            email: 'ada@example.com',
          },
        ],
      }),
    );

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      display_name: 'Ada Lovelace',
      avatar_url: 'https://api.example.com/avatars/usr_ada-1.jpg',
      email: 'ada@example.com',
      role: 'owner',
    });
  });

  /**
   * The bug this whole module exists to close. A local ledger stamps every
   * savings / pension row with `memberId`, and `memberId` IS the user id
   * (`engine.ts`). The old seed used `mem_<uid>`, so the roster row and the
   * ledger row could never be the same person and every lookup fell through to
   * a placeholder name.
   */
  it('keys members on the raw user id, so ledger rows resolve to a person', () => {
    const roster = buildBudgetRoster(
      state({ members: [{ userId: 'usr_ada', role: 'ADULT', status: 'active' }] }),
    );

    expect(roster[0]!.id).toBe('usr_ada');
    expect(roster[0]!.id).not.toMatch(/^mem_/);
    expect(roster[0]!.user_id).toBe('usr_ada');
  });

  it('maps V2 roles onto the two the app renders', () => {
    const roster = buildBudgetRoster(
      state({
        members: [
          { userId: 'a', role: 'OWNER', status: 'active' },
          { userId: 'b', role: 'ADULT', status: 'active' },
          { userId: 'c', role: 'TEEN', status: 'active' },
        ],
      }),
    );

    expect(roster.map((m) => m.role)).toEqual(['owner', 'member', 'member']);
  });

  it('drops revoked members — a greyed-out row reads as "still here"', () => {
    const roster = buildBudgetRoster(
      state({
        members: [
          { userId: 'a', role: 'OWNER', status: 'active' },
          { userId: 'gone', role: 'ADULT', status: 'revoked' },
        ],
      }),
    );

    expect(roster.map((m) => m.user_id)).toEqual(['a']);
  });

  it('dates a membership from the earliest device that person enrolled', () => {
    const roster = buildBudgetRoster(
      state({
        members: [{ userId: 'usr_ada', role: 'ADULT', status: 'active' }],
        devices: [
          {
            deviceId: 'dev_2',
            userId: 'usr_ada',
            signingPublicKey: 'aa',
            agreementPublicKey: 'bb',
            status: 'active',
            enrolledAt: '2026-03-02T00:00:00.000Z',
          },
          {
            deviceId: 'dev_1',
            userId: 'usr_ada',
            signingPublicKey: 'cc',
            agreementPublicKey: 'dd',
            status: 'active',
            enrolledAt: '2026-01-09T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(roster[0]!.joined_at).toBe('2026-01-09T00:00:00.000Z');
  });

  /**
   * A peer on an older build, or a server whose profile lookup failed, sends
   * members with no profile at all. That must still produce a roster — the UI
   * falls back to initials — rather than rows of `undefined`.
   */
  it('survives a state with no profile fields at all', () => {
    const roster = buildBudgetRoster(
      state({ members: [{ userId: 'usr_ada', role: 'ADULT', status: 'active' }] }),
    );

    expect(roster[0]).toMatchObject({ display_name: null, avatar_url: null, email: '' });
  });
});

describe('budgetMemberName', () => {
  it('prefers the name the member chose', () => {
    expect(budgetMemberName({ display_name: 'Ada', email: 'ada@example.com' })).toBe('Ada');
  });

  it('falls back to the part of the address people recognise', () => {
    expect(budgetMemberName({ display_name: null, email: 'ada@example.com' })).toBe('ada');
    expect(budgetMemberName({ display_name: '   ', email: 'ada@example.com' })).toBe('ada');
  });

  it('never renders an opaque id — a neutral noun beats one', () => {
    expect(budgetMemberName({ display_name: null, email: '' })).toBe('Household member');
    expect(budgetMemberName(null)).toBe('Household member');
    expect(budgetMemberName(null, '')).toBe('');
  });
});

describe('sortBudgetRoster', () => {
  it('puts the owner first, then everyone else by name', () => {
    const roster = buildBudgetRoster(
      state({
        members: [
          { userId: 'c', role: 'ADULT', status: 'active', displayName: 'Zoe' },
          { userId: 'b', role: 'ADULT', status: 'active', displayName: 'Alan' },
          { userId: 'a', role: 'OWNER', status: 'active', displayName: 'Ada' },
        ],
      }),
    );

    expect(sortBudgetRoster(roster).map((m) => m.display_name)).toEqual(['Ada', 'Alan', 'Zoe']);
  });
});
