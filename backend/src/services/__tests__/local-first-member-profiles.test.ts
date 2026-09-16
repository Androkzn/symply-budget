import { describe, expect, it, beforeEach } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstControlService } from '../local-first-control-service';

/**
 * The coordinator is the security authority and holds ids, roles and key
 * material — deliberately no display names. But a roster of `usr_9f2c…` is not
 * a roster: every Budget surface that had to name a peer fell back to the
 * literal string "Household member", and no surface anywhere could show a face.
 *
 * `getState` therefore joins `users` on top of coordinator state. These tests
 * pin that join, and — more importantly — pin that it is BEST EFFORT: a
 * household whose profile lookup fails still has to sync, because the same
 * response carries the device keys the sync depends on.
 */

interface Stmt {
  sql: string;
  args: unknown[];
}

const COORDINATOR_STATE = {
  householdId: 'hh_local_1',
  keyEpoch: 1,
  securityRevision: 1,
  members: [
    { userId: 'usr_ada', role: 'OWNER', status: 'active' },
    { userId: 'usr_alan', role: 'ADULT', status: 'active' },
  ],
  devices: [
    {
      deviceId: 'dev_1',
      userId: 'usr_ada',
      signingPublicKey: 'aa',
      agreementPublicKey: 'bb',
      status: 'active',
      enrolledAt: '2026-01-09T00:00:00.000Z',
    },
  ],
  invites: [],
};

function fakeEnv(options?: { profiles?: Record<string, unknown>[]; failProfiles?: boolean }) {
  const statements: Stmt[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              statements.push({ sql, args });
              return { success: true };
            },
            async first<T>() {
              statements.push({ sql, args });
              // `assertMember` — the caller is a member.
              return { id: 'membership-row' } as T;
            },
            async all<T>() {
              statements.push({ sql, args });
              if (options?.failProfiles) throw new Error('D1_ERROR: forced');
              return { results: (options?.profiles ?? []) as T[] };
            },
          };
        },
      };
    },
  };

  const env = {
    DB: db,
    // Avatars are stored as bucket keys and resolved per request onto the
    // Worker that owns the object (`utils/avatar-url.ts`), so the roster's
    // faces depend on this being present.
    API_URL: 'https://budget-api.example.com',
    HOUSEHOLD_COORDINATOR: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () =>
          new Response(JSON.stringify(COORDINATOR_STATE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      }),
    },
  } as unknown as Env;

  return { env, statements };
}

describe('LocalFirstControlService.getState — member profiles', () => {
  let logged: unknown[][];
  beforeEach(() => {
    logged = [];
     
    console.error = (...a: unknown[]) => logged.push(a);
  });

  it('resolves every member to a person the household can read', async () => {
    const { env } = fakeEnv({
      profiles: [
        {
          id: 'usr_ada',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          // The stored form: a key, carrying no host.
          avatar_url: 'avatars/usr_ada-1.jpg',
          updated_at: '2026-08-17T10:00:00.000Z',
        },
        {
          id: 'usr_alan',
          email: 'alan@example.com',
          display_name: 'Alan Turing',
          avatar_url: null,
          updated_at: '2026-08-01T10:00:00.000Z',
        },
      ],
    });

    const state = await new LocalFirstControlService(env).getState('hh_local_1', 'usr_ada');

    expect(state.members).toEqual([
      expect.objectContaining({
        userId: 'usr_ada',
        role: 'OWNER',
        displayName: 'Ada Lovelace',
        // A URL this Worker can serve — NOT the bare key that is stored. Handed
        // over raw it renders as a broken image and the whole household falls
        // back to initials.
        avatarUrl: 'https://budget-api.example.com/avatars/usr_ada-1.jpg',
        email: 'ada@example.com',
        profileUpdatedAt: '2026-08-17T10:00:00.000Z',
      }),
      expect.objectContaining({
        userId: 'usr_alan',
        displayName: 'Alan Turing',
        avatarUrl: null,
        email: 'alan@example.com',
      }),
    ]);
  });

  /**
   * The regression that emptied a household's faces.
   *
   * Writes became bucket keys when `users.avatar_url` stopped storing a host
   * (`utils/avatar-url.ts`), but only `/auth/me` resolved them — so the roster
   * handed the client `avatars/x.jpg`, `<Image>` failed on it, and every member
   * fell back to initials with nothing on screen to say why. The legacy row is
   * the other half: it names a DIFFERENT app's Worker (every child D1 was
   * cloned from House), whose bucket does not hold the object.
   */
  it('serves avatars this Worker can actually serve, whichever form is stored', async () => {
    const { env } = fakeEnv({
      profiles: [
        {
          id: 'usr_ada',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          // Legacy absolute, naming House rather than this app.
          avatar_url: 'https://simple-house-api.example.dev/avatars/usr_ada-1.jpg',
          updated_at: null,
        },
        {
          id: 'usr_alan',
          email: 'alan@example.com',
          display_name: 'Alan Turing',
          // A provider picture from social sign-in — not ours to re-host.
          avatar_url: 'https://lh3.googleusercontent.com/a/photo.jpg',
          updated_at: null,
        },
      ],
    });

    const state = await new LocalFirstControlService(env).getState('hh_local_1', 'usr_ada');

    expect(state.members[0]).toMatchObject({
      avatarUrl: 'https://budget-api.example.com/avatars/usr_ada-1.jpg',
    });
    expect(state.members[1]).toMatchObject({
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
    });
  });

  it('names the person holding each device, so a device list is answerable', async () => {
    const { env } = fakeEnv({
      profiles: [
        {
          id: 'usr_ada',
          email: 'ada@example.com',
          display_name: 'Ada Lovelace',
          avatar_url: null,
          updated_at: null,
        },
      ],
    });

    const state = await new LocalFirstControlService(env).getState('hh_local_1', 'usr_ada');

    expect(state.devices[0]).toMatchObject({
      deviceId: 'dev_1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      // The key material the sync actually runs on is untouched by the join.
      signingPublicKey: 'aa',
      agreementPublicKey: 'bb',
    });
  });

  it('asks for each distinct user exactly once', async () => {
    const { env, statements } = fakeEnv();
    await new LocalFirstControlService(env).getState('hh_local_1', 'usr_ada');

    const lookups = statements.filter((s) => /FROM users WHERE id IN/.test(s.sql));
    expect(lookups).toHaveLength(1);
    // `usr_ada` is both a member and a device owner — one placeholder each.
    expect(lookups[0]!.args).toEqual(['usr_ada', 'usr_alan']);
  });

  /**
   * The load-bearing one. This response carries the device keys a sync cannot
   * run without, so a failed name lookup must degrade to initials rather than
   * take the household offline.
   */
  it('still returns usable state when the profile lookup fails', async () => {
    const { env } = fakeEnv({ failProfiles: true });

    const state = await new LocalFirstControlService(env).getState('hh_local_1', 'usr_ada');

    expect(state.members).toHaveLength(2);
    expect(state.members[0]).toMatchObject({
      userId: 'usr_ada',
      role: 'OWNER',
      displayName: null,
      avatarUrl: null,
    });
    expect(state.devices[0]!.signingPublicKey).toBe('aa');
    expect(logged.length).toBeGreaterThan(0);
  });

  it('leaves a member with no user row blank rather than undefined', async () => {
    const { env } = fakeEnv({ profiles: [] });

    const state = await new LocalFirstControlService(env).getState('hh_local_1', 'usr_ada');

    expect(state.members[0]).toMatchObject({
      displayName: null,
      avatarUrl: null,
      email: null,
      profileUpdatedAt: null,
    });
  });
});
