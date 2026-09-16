/**
 * The permission resolver both backends share.
 *
 * These are the only tests in the repo that can prove the Worker and the device
 * ledger agree about who may edit a project, because agreement is achieved by
 * both of them calling THESE functions rather than by two implementations
 * happening to match. What is asserted here is therefore the contract itself:
 * the fail-open defaults that keep pre-0163 rows working, the creator pin that
 * stops a household locking itself out, and the parser's refusal to throw on a
 * column it did not write.
 */
import { describe, expect, it } from 'vitest';

import {
  canEditHomeProject,
  canViewHomeProject,
  effectiveHomeProjectRole,
  normalizeHomeProjectRole,
  normalizeHomeProjectVisibility,
  parseHomeProjectAccessGrants,
  serializeHomeProjectAccessGrants,
} from '../src/home-project-access';

const CREATOR = 'user-creator';
const PEER = 'user-peer';

describe('normalisation — a row written before migration 0163', () => {
  it('reads an absent visibility as published, not draft', () => {
    // The whole back-compat story. Reading absent as `draft` would make every
    // project in every household vanish for everyone but its creator on deploy.
    expect(normalizeHomeProjectVisibility(undefined)).toBe('published');
    expect(normalizeHomeProjectVisibility(null)).toBe('published');
    expect(normalizeHomeProjectVisibility('')).toBe('published');
    expect(normalizeHomeProjectVisibility('nonsense')).toBe('published');
    expect(normalizeHomeProjectVisibility('draft')).toBe('draft');
  });

  it('reads an absent role as owner — the access every member already had', () => {
    expect(normalizeHomeProjectRole(undefined)).toBe('owner');
    expect(normalizeHomeProjectRole(null)).toBe('owner');
    expect(normalizeHomeProjectRole('nonsense')).toBe('owner');
    expect(normalizeHomeProjectRole('viewer')).toBe('viewer');
  });
});

describe('parseHomeProjectAccessGrants', () => {
  it('never throws on a column it did not write', () => {
    // A parse error here would turn one malformed byte into a project nobody
    // can open, when the honest answer is "no grants, use the default".
    expect(parseHomeProjectAccessGrants(null)).toEqual([]);
    expect(parseHomeProjectAccessGrants(undefined)).toEqual([]);
    expect(parseHomeProjectAccessGrants('')).toEqual([]);
    expect(parseHomeProjectAccessGrants('   ')).toEqual([]);
    expect(parseHomeProjectAccessGrants('{not json')).toEqual([]);
    expect(parseHomeProjectAccessGrants('{"user_id":"a"}')).toEqual([]);
    expect(parseHomeProjectAccessGrants(42)).toEqual([]);
  });

  it('drops entries that are not a grant and keeps the ones that are', () => {
    expect(
      parseHomeProjectAccessGrants(
        JSON.stringify([
          { user_id: PEER, role: 'viewer' },
          { user_id: 'x', role: 'admin' },
          { role: 'viewer' },
          null,
        ])
      )
    ).toEqual([{ user_id: PEER, role: 'viewer' }]);
  });

  it('resolves a duplicated user last-wins, on both backends identically', () => {
    expect(
      parseHomeProjectAccessGrants(
        JSON.stringify([
          { user_id: PEER, role: 'owner' },
          { user_id: PEER, role: 'viewer' },
        ])
      )
    ).toEqual([{ user_id: PEER, role: 'viewer' }]);
  });

  it('accepts an already-parsed array, so a ledger row round-trips', () => {
    expect(parseHomeProjectAccessGrants([{ user_id: PEER, role: 'viewer' }])).toEqual([
      { user_id: PEER, role: 'viewer' },
    ]);
  });
});

describe('serializeHomeProjectAccessGrants', () => {
  it('stores NULL rather than "[]" for an empty list', () => {
    // So a project whose access sheet was opened and closed reads back
    // byte-identical to one that never was.
    expect(serializeHomeProjectAccessGrants([])).toBeNull();
  });

  it('round-trips through the parser', () => {
    const grants = [{ user_id: PEER, role: 'viewer' as const }];
    expect(parseHomeProjectAccessGrants(serializeHomeProjectAccessGrants(grants))).toEqual(
      grants
    );
  });
});

describe('effectiveHomeProjectRole', () => {
  const base = { created_by: CREATOR };

  it('defaults an ungranted member to the project default', () => {
    expect(effectiveHomeProjectRole({ ...base, default_role: 'viewer' }, PEER)).toBe('viewer');
    expect(effectiveHomeProjectRole({ ...base, default_role: 'owner' }, PEER)).toBe('owner');
    // Absent default — a pre-0163 row — is `owner`, the pre-0163 behaviour.
    expect(effectiveHomeProjectRole(base, PEER)).toBe('owner');
  });

  it('lets an explicit grant beat the default in both directions', () => {
    expect(
      effectiveHomeProjectRole(
        { ...base, default_role: 'viewer', access_json: JSON.stringify([{ user_id: PEER, role: 'owner' }]) },
        PEER
      )
    ).toBe('owner');
    expect(
      effectiveHomeProjectRole(
        { ...base, default_role: 'owner', access_json: JSON.stringify([{ user_id: PEER, role: 'viewer' }]) },
        PEER
      )
    ).toBe('viewer');
  });

  it('pins the creator to owner even against a viewer grant and a viewer default', () => {
    // The lockout guard. Without it, "set everyone to view only" produces a
    // project nobody in the household can ever edit again — there is no
    // household-admin override for a project's own access list.
    expect(
      effectiveHomeProjectRole(
        {
          created_by: CREATOR,
          default_role: 'viewer',
          access_json: JSON.stringify([{ user_id: CREATOR, role: 'viewer' }]),
        },
        CREATOR
      )
    ).toBe('owner');
  });

  it('gives a signed-out reader nothing', () => {
    expect(effectiveHomeProjectRole({ ...base, default_role: 'owner' }, null)).toBe('viewer');
    expect(effectiveHomeProjectRole({ ...base, default_role: 'owner' }, undefined)).toBe('viewer');
  });
});

describe('canViewHomeProject', () => {
  it('shows a published project to everyone', () => {
    expect(canViewHomeProject({ created_by: CREATOR, visibility: 'published' }, PEER)).toBe(true);
    // …including a member the project has never heard of.
    expect(canViewHomeProject({ created_by: CREATOR }, 'someone-else')).toBe(true);
  });

  it('shows a draft to its creator alone', () => {
    expect(canViewHomeProject({ created_by: CREATOR, visibility: 'draft' }, CREATOR)).toBe(true);
    expect(canViewHomeProject({ created_by: CREATOR, visibility: 'draft' }, PEER)).toBe(false);
    expect(canViewHomeProject({ created_by: CREATOR, visibility: 'draft' }, null)).toBe(false);
  });

  it('hides a draft from a member holding an owner GRANT', () => {
    // Visibility and role are orthogonal on purpose: a grant on a draft would
    // be a project a member can open but that nobody told them about, and the
    // point of a draft is that it has not been shared yet. Publishing shares it.
    expect(
      canViewHomeProject(
        {
          created_by: CREATOR,
          visibility: 'draft',
          access_json: JSON.stringify([{ user_id: PEER, role: 'owner' }]),
        },
        PEER
      )
    ).toBe(false);
  });

  it('hides a draft whose creator is unknown from everyone', () => {
    // `created_by` is `ON DELETE SET NULL`, so a draft outlives the account that
    // made it. Nobody inherits it — the alternative is a private plan becoming
    // public the day its author leaves the household.
    expect(canViewHomeProject({ created_by: null, visibility: 'draft' }, PEER)).toBe(false);
    expect(canViewHomeProject({ created_by: null, visibility: 'draft' }, null)).toBe(false);
  });
});

describe('canEditHomeProject', () => {
  it('is exactly "your effective role is owner"', () => {
    expect(canEditHomeProject({ created_by: CREATOR, default_role: 'viewer' }, PEER)).toBe(false);
    expect(canEditHomeProject({ created_by: CREATOR, default_role: 'viewer' }, CREATOR)).toBe(true);
    expect(canEditHomeProject({ created_by: CREATOR }, PEER)).toBe(true);
  });
});
