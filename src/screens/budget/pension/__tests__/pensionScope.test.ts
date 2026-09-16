import type { HouseholdMember } from '@api/households';
import type { PensionOverview } from '@api/savings';

import {
  pensionLines,
  pensionMemberIdentities,
  pensionMemberOptions,
  pensionScopeLabel,
  showsMemberOnRows,
} from '../pensionScope';

function member(id: string, over: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id,
    user_id: `user-${id}`,
    display_name: `Name ${id}`,
    avatar_url: null,
    email: `${id}@example.com`,
    role: 'member',
    joined_at: '2026-01-01',
    ...over,
  };
}

function group(memberId: string | null, accountIds: string[], memberName: string | null = null) {
  return {
    memberId,
    memberName,
    memberAvatarUrl: null,
    totalBalanceCents: 0,
    accounts: accountIds.map((id) => ({
      account: { id } as never,
      memberName,
      room: {} as never,
    })),
  };
}

function overview(groups: ReturnType<typeof group>[]): PensionOverview {
  return { year: 2026, totals: {} as never, groups, warnings: [] };
}

describe('pensionLines', () => {
  const data = overview([
    group('mem-a', ['a-rrsp', 'a-tfsa'], 'Alex'),
    group('mem-b', ['b-rrsp'], 'Bo'),
    group(null, ['orphan']),
  ]);

  it('returns every row under the all-members scope', () => {
    expect(pensionLines(data, null).map((l) => l.account.id)).toEqual([
      'a-rrsp',
      'a-tfsa',
      'b-rrsp',
      'orphan',
    ]);
  });

  it('keeps only the scoped member’s rows', () => {
    const lines = pensionLines(data, 'mem-a');
    expect(lines.map((l) => l.account.id)).toEqual(['a-rrsp', 'a-tfsa']);
    expect(lines.every((l) => l.memberId === 'mem-a')).toBe(true);
  });

  it('carries the group’s member identity onto each row', () => {
    expect(pensionLines(data, 'mem-b')[0]).toMatchObject({
      memberId: 'mem-b',
      memberName: 'Bo',
      memberAvatarUrl: null,
    });
  });

  // `registered_accounts.member_id` is `on delete set null`, so a departed
  // member leaves rows behind that belong to nobody. They must never be folded
  // into a member's scope — that would show one person another's numbers.
  it('never matches a member-less row against a scoped member', () => {
    expect(pensionLines(data, 'mem-a').map((l) => l.account.id)).not.toContain('orphan');
  });

  it('is empty for a member with no rows, rather than falling back to everyone', () => {
    expect(pensionLines(data, 'mem-missing')).toEqual([]);
  });

  it('handles a missing overview', () => {
    expect(pensionLines(null, null)).toEqual([]);
    expect(pensionLines(undefined, 'mem-a')).toEqual([]);
  });
});

describe('pensionMemberOptions', () => {
  it('names members from the household roster', () => {
    expect(pensionMemberOptions([], [member('mem-a')], null)).toEqual([
      { id: 'mem-a', label: 'Name mem-a' },
    ]);
  });

  it('falls back to the email when a member has no display name', () => {
    const options = pensionMemberOptions([], [member('mem-a', { display_name: '  ' })], null);
    expect(options).toEqual([{ id: 'mem-a', label: 'mem-a@example.com' }]);
  });

  it('includes members the roster does not know, so a local-first peer is reachable', () => {
    const options = pensionMemberOptions(
      [{ id: 'mem-a', name: null }, { id: 'mem-peer', name: null }],
      [member('mem-a')],
      'mem-a',
    );
    expect(options).toEqual([
      { id: 'mem-a', label: 'Name mem-a' },
      { id: 'mem-peer', label: 'Household member' },
    ]);
  });

  it('labels the local member "You" when nothing else names them', () => {
    expect(pensionMemberOptions([{ id: 'mem-me', name: null }], [], 'mem-me')).toEqual([
      { id: 'mem-me', label: 'You' },
    ]);
  });

  it('prefers a name the overview carries over the generic fallback', () => {
    expect(pensionMemberOptions([{ id: 'mem-x', name: 'Robin' }], [], null)).toEqual([
      { id: 'mem-x', label: 'Robin' },
    ]);
  });

  it('does not offer member-less rows as a scope', () => {
    expect(pensionMemberOptions([{ id: null, name: null }], [], null)).toEqual([]);
  });

  it('does not duplicate a member present in both sources', () => {
    const options = pensionMemberOptions(
      [{ id: 'mem-a', name: 'Stale name' }],
      [member('mem-a')],
      null,
    );
    expect(options).toEqual([{ id: 'mem-a', label: 'Name mem-a' }]);
  });
});

describe('pensionScopeLabel', () => {
  const options = [{ id: 'mem-a', label: 'Alex' }];

  it('names the scoped member', () => {
    expect(pensionScopeLabel(options, 'mem-a')).toBe('Alex');
  });

  it('reads "Everyone" for the all-members scope', () => {
    expect(pensionScopeLabel(options, null)).toBe('Everyone');
  });

  it('falls back to "Everyone" rather than blank for a member who is gone', () => {
    expect(pensionScopeLabel(options, 'mem-gone')).toBe('Everyone');
  });
});

describe('pensionMemberIdentities', () => {
  it('maps the overview groups to id + name pairs', () => {
    expect(
      pensionMemberIdentities(overview([group('mem-a', ['x'], 'Alex'), group(null, ['y'])])),
    ).toEqual([
      { id: 'mem-a', name: 'Alex' },
      { id: null, name: null },
    ]);
  });

  it('handles a missing overview', () => {
    expect(pensionMemberIdentities(null)).toEqual([]);
  });
});

describe('showsMemberOnRows', () => {
  it('shows the member on each row only when rows can differ', () => {
    expect(showsMemberOnRows(null)).toBe(true);
    expect(showsMemberOnRows('mem-a')).toBe(false);
  });
});
