/**
 * Symply Health SOCIAL — CROSS-USER AUTHORISATION, at the HTTP layer.
 *
 * `health-social.test.ts` proves the five privacy rules on their happy paths and
 * on the headline negatives. This file is deliberately almost all NEGATIVES: for
 * a surface whose entire purpose is letting one account read another account's
 * health data, "B cannot" is worth more than "B can", and the branches that
 * decide it are the ones nothing else drives.
 *
 * Four questions, one section each:
 *
 *   FAMILY MEMBERSHIP — does sharing a family leak anything by itself? (An
 *     invitation inbox is a list of email addresses; a member list is a social
 *     graph; a removed member must lose all three at once.)
 *   BUDDY CONSENT — can a connection be created, accepted or used by anyone
 *     other than the two people in it?
 *   CHALLENGE PARTICIPATION — `canSeeChallenge` has four branches (creator,
 *     participant, `public`, `family`, `buddies`) and the sibling suites drive
 *     only creator / participant / public / family-negative. The `buddies`
 *     branch and the family POSITIVE branch decide who may see a leaderboard,
 *     and were completely untested.
 *   SHARE VISIBILITY — the grant lists, the revoke verb and the metric read must
 *     each be scoped to exactly one of the two parties.
 *
 * Plus a CORNER section for the unvalidated query parameters (`?limit`,
 * `?from`, `?to`), which reach SQL directly.
 *
 * ORACLE PARITY is asserted by comparing whole response fingerprints rather than
 * status codes: throughout this router a refusal must be byte-identical to "that
 * does not exist", because a distinguishable refusal confirms the target is
 * real. `expectIndistinguishable` is the assertion that says so.
 *
 * Harness mirrors health-social.test.ts.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';
import healthSocialRoutes, { HEALTH_SOCIAL_FLAG_KEY } from '../health-social';

import {
  createHealthSocialTables,
  createHealthTables,
  resetHealthSocialTables,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_az_alice';
const UID_B = 'u_az_bob';
const UID_C = 'u_az_carol';
const UID_D = 'u_az_dave';
const UID_E = 'u_az_erin';
const ALL = [UID_A, UID_B, UID_C, UID_D, UID_E];
const EMAIL = (id: string) => `${id}@example.com`;

const DAY = '2026-06-01';

let tokenA = '';
let tokenB = '';
let tokenC = '';
let tokenD = '';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({ sub: userId, email: EMAIL(userId), email_verified: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthSocialRoutes);
  return app;
}

async function call(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  return mkApp().request(
    `/health${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    HEALTH_ENV
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** status + body — the whole observable answer, for oracle-parity assertions. */
async function fingerprint(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

/**
 * The core privacy assertion of this file: a refusal aimed at something REAL
 * must be byte-identical to a refusal aimed at something imaginary. Anything
 * else — a different code, a different message, a different status — is an
 * existence oracle.
 */
async function expectIndistinguishable(real: Response, imaginary: Response): Promise<void> {
  expect(await fingerprint(real)).toEqual(await fingerprint(imaginary));
}

interface ErrorBody {
  error: { code: string; message: string };
}
interface Grant {
  id: string;
  owner_id: string;
  viewer_id: string;
  relationship_type: string;
  scope: string;
  active: boolean;
}

/* ============================ shorthands ============================== */

/** `owner` creates a family (if needed) and `member` joins it for real. */
async function joinFamily(
  ownerToken: string,
  memberToken: string,
  memberEmail: string
): Promise<void> {
  const created = await call('POST', '/social/family', ownerToken, { name: 'Fam' });
  expect([201, 409]).toContain(created.status);
  expect((await call('POST', '/social/family/invite', ownerToken, { email: memberEmail })).status)
    .toBe(201);
  const inbox = await json<{ received: Array<{ id: string }> }>(
    await call('GET', '/social/family/invitations', memberToken)
  );
  expect(inbox.received.length).toBeGreaterThan(0);
  expect(
    (await call('POST', `/social/family/invitations/${inbox.received[0].id}/accept`, memberToken))
      .status
  ).toBe(200);
}

/** `a` requests, `b` accepts. Returns the connection id. */
async function makeBuddies(
  aToken: string,
  bToken: string,
  bEmail: string
): Promise<string> {
  expect((await call('POST', '/social/buddies/request', aToken, { email: bEmail })).status).toBe(201);
  const inbox = await json<{ received: Array<{ id: string }> }>(
    await call('GET', '/social/buddies/requests', bToken)
  );
  expect(inbox.received.length).toBeGreaterThan(0);
  const id = inbox.received[0].id;
  expect((await call('POST', `/social/buddies/${id}/accept`, bToken)).status).toBe(200);
  return id;
}

async function grant(
  ownerToken: string,
  viewerId: string,
  relationship: 'family' | 'buddy',
  scopes: string[]
): Promise<Grant[]> {
  const res = await call('POST', '/social/shares', ownerToken, {
    viewer_id: viewerId,
    relationship_type: relationship,
    scopes,
  });
  expect(res.status).toBe(201);
  return (await json<{ grants: Grant[] }>(res)).grants;
}

/** Give A a day of real P1 data so a granted read has something to answer with. */
async function seedAliceDay(): Promise<void> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRoutes);
  const headers = { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown) =>
    app.request(
      `/health${path}`,
      { method: 'POST', headers, body: JSON.stringify(body) },
      HEALTH_ENV
    );
  await post('/weight/entries', { date: DAY, weight: 70.5, unit: 'kg' });
  await post('/water/entries', { date: DAY, amount_ml: 500 });
  await post('/entries/steps', { date: DAY, steps: 8000 });
}

async function makeTopic(token: string, title = 'Hydration'): Promise<string> {
  const res = await call('POST', '/social/community/topics', token, { title, category: 'tips' });
  expect(res.status).toBe(201);
  return (await json<{ topic: { id: string } }>(res)).topic.id;
}

async function makeChallenge(
  token: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  const res = await call('POST', '/social/challenges', token, {
    name: '10k steps',
    metric: 'activity',
    target_value: 10000,
    visibility: 'public',
    start_date: DAY,
    ...over,
  });
  expect(res.status).toBe(201);
  return (await json<{ challenge: { id: string } }>(res)).challenge.id;
}

describe('health social cross-user authorisation', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthSocialTables(testEnv.DB);
    await resetHealthSocialTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, ALL);
    [tokenA, tokenB, tokenC, tokenD] = await Promise.all(
      [UID_A, UID_B, UID_C, UID_D].map(mintToken)
    );
    await testEnv.CONFIG_KV.put(HEALTH_SOCIAL_FLAG_KEY, 'true');
  });

  /* ==================================================================== */
  /* 1. FAMILY MEMBERSHIP                                                 */
  /* ==================================================================== */

  describe('family membership conveys no visibility of its own', () => {
    it('a member cannot see the invitations the family has sent or received', async () => {
      // The inbox is a list of EMAIL ADDRESSES the owner typed. Sharing a
      // family must not turn every member into a reader of that list.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await call('POST', '/social/family/invite', tokenA, { email: EMAIL(UID_C) });

      const bobs = await json<{ received: unknown[]; sent: unknown[] }>(
        await call('GET', '/social/family/invitations', tokenB)
      );
      expect(bobs.received).toEqual([]);
      expect(bobs.sent).toEqual([]);

      // …and the raw payload carries no address at all, not even a filtered one.
      const raw = await (await call('GET', '/social/family/invitations', tokenB)).text();
      expect(raw).not.toContain(EMAIL(UID_C));
    });

    it('an invite code that is not yours reads exactly like one that never existed', async () => {
      await call('POST', '/social/family', tokenA, { name: 'Fam' });
      const invite = await json<{ invitation: { invite_code: string } }>(
        await call('POST', '/social/family/invite', tokenA, { email: EMAIL(UID_B) })
      );
      // Carol holds a real, valid, currently-pending code that is addressed to
      // Bob. It must be worth exactly as much to her as eight random letters.
      await expectIndistinguishable(
        await call('GET', `/social/family/invitations/code/${invite.invitation.invite_code}`, tokenC),
        await call('GET', '/social/family/invitations/code/ZZZZ9999', tokenC)
      );
    });

    it('a removed member loses the family, the member list and every grant at once', async () => {
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      expect(
        (await call('GET', `/social/shares/${UID_A}/metrics?date=${DAY}`, tokenB)).status
      ).toBe(200);

      expect((await call('DELETE', `/social/family/members/${UID_B}`, tokenA)).status).toBe(200);

      expect((await json<{ family: unknown }>(await call('GET', '/social/family', tokenB))).family)
        .toBeNull();
      expect(
        (await json<{ members: unknown[] }>(await call('GET', '/social/family/members', tokenB)))
          .members
      ).toEqual([]);
      expect(
        (await json<{ grants: Grant[] }>(await call('GET', '/social/shares/received', tokenB)))
          .grants
      ).toEqual([]);
      expect(
        (await call('GET', `/social/shares/${UID_A}/metrics?date=${DAY}`, tokenB)).status
      ).toBe(404);
      // The remaining family no longer lists them either.
      const fam = await json<{ family: { members: Array<{ user_id: string }> } }>(
        await call('GET', '/social/family', tokenA)
      );
      expect(fam.family.members.map((m) => m.user_id)).toEqual([UID_A]);
    });

    it('an outsider cannot remove a member of a family they are not in', async () => {
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      // Dave is in no family at all; the refusal must not confirm that Bob is.
      await expectIndistinguishable(
        await call('DELETE', `/social/family/members/${UID_B}`, tokenD),
        await call('DELETE', '/social/family/members/u_nobody_at_all', tokenD)
      );
      expect(
        (
          await json<{ family: { members: unknown[] } }>(await call('GET', '/social/family', tokenA))
        ).family.members
      ).toHaveLength(2);
    });

    it('an owner removing a non-member reads like removing a ghost', async () => {
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      // Dave is a real account, just not in this family. Carol is real too.
      await expectIndistinguishable(
        await call('DELETE', `/social/family/members/${UID_D}`, tokenA),
        await call('DELETE', '/social/family/members/u_nobody_at_all', tokenA)
      );
    });

    it('an invitation can be answered exactly once', async () => {
      await call('POST', '/social/family', tokenA, { name: 'Fam' });
      await call('POST', '/social/family/invite', tokenA, { email: EMAIL(UID_B) });
      const inbox = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/family/invitations', tokenB)
      );
      const id = inbox.received[0].id;
      expect((await call('POST', `/social/family/invitations/${id}/accept`, tokenB)).status).toBe(200);
      // Replaying the accept, and switching to a decline afterwards, are both
      // "no such pending invitation" — not a second membership row.
      await expectIndistinguishable(
        await call('POST', `/social/family/invitations/${id}/accept`, tokenB),
        await call('POST', '/social/family/invitations/hfi_ghost/accept', tokenB)
      );
      await expectIndistinguishable(
        await call('POST', `/social/family/invitations/${id}/decline`, tokenB),
        await call('POST', '/social/family/invitations/hfi_ghost/decline', tokenB)
      );
      const fam = await json<{ family: { members: unknown[] } }>(
        await call('GET', '/social/family', tokenA)
      );
      expect(fam.family.members).toHaveLength(2);
    });

    it('inviting without a family is refused before anything is written', async () => {
      const res = await call('POST', '/social/family/invite', tokenD, { email: EMAIL(UID_B) });
      expect(res.status).toBe(400);
      expect((await json<ErrorBody>(res)).error.code).toBe('not_in_family');
      const sent = await json<{ sent: unknown[] }>(
        await call('GET', '/social/family/invitations', tokenD)
      );
      expect(sent.sent).toEqual([]);
      // Bob's inbox stays empty: a refused invite writes no row anyone can see.
      const bobs = await json<{ received: unknown[] }>(
        await call('GET', '/social/family/invitations', tokenB)
      );
      expect(bobs.received).toEqual([]);
    });
  });

  /* ==================================================================== */
  /* 2. BUDDY CONSENT                                                     */
  /* ==================================================================== */

  describe('buddy consent belongs to the addressee alone', () => {
    it('the requester cannot accept their own request', async () => {
      // Otherwise "add a buddy" would be a unilateral act, and the buddy
      // relationship is what a `buddy` grant is checked against.
      await call('POST', '/social/buddies/request', tokenA, { email: EMAIL(UID_B) });
      const sent = await json<{ sent: Array<{ id: string }> }>(
        await call('GET', '/social/buddies/requests', tokenA)
      );
      const id = sent.sent[0].id;
      await expectIndistinguishable(
        await call('POST', `/social/buddies/${id}/accept`, tokenA),
        await call('POST', '/social/buddies/hbud_ghost/accept', tokenA)
      );
      expect(
        (await json<{ buddies: unknown[] }>(await call('GET', '/social/buddies', tokenA))).buddies
      ).toEqual([]);
    });

    it('a third party can neither accept nor decline somebody else request', async () => {
      await call('POST', '/social/buddies/request', tokenA, { email: EMAIL(UID_B) });
      const inbox = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/buddies/requests', tokenB)
      );
      const id = inbox.received[0].id;
      for (const verb of ['accept', 'decline'] as const) {
        await expectIndistinguishable(
          await call('POST', `/social/buddies/${id}/${verb}`, tokenC),
          await call('POST', `/social/buddies/hbud_ghost/${verb}`, tokenC)
        );
      }
      // Still pending for the person it was actually addressed to.
      const still = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/buddies/requests', tokenB)
      );
      expect(still.received.map((r) => r.id)).toEqual([id]);
    });

    it('a pending request is not a connection and cannot back a grant', async () => {
      await call('POST', '/social/buddies/request', tokenA, { email: EMAIL(UID_B) });
      expect(
        (await json<{ buddies: unknown[] }>(await call('GET', '/social/buddies', tokenA))).buddies
      ).toEqual([]);
      expect(
        (await json<{ buddies: unknown[] }>(await call('GET', '/social/buddies', tokenB))).buddies
      ).toEqual([]);
      // …and the refusal is the same one a total stranger gets.
      await expectIndistinguishable(
        await call('POST', '/social/shares', tokenA, {
          viewer_id: UID_B,
          relationship_type: 'buddy',
          scopes: ['weight'],
        }),
        await call('POST', '/social/shares', tokenA, {
          viewer_id: UID_E,
          relationship_type: 'buddy',
          scopes: ['weight'],
        })
      );
    });

    it('a declined request leaves neither side a buddy and can be re-sent', async () => {
      await call('POST', '/social/buddies/request', tokenA, { email: EMAIL(UID_B) });
      const inbox = await json<{ received: Array<{ id: string }> }>(
        await call('GET', '/social/buddies/requests', tokenB)
      );
      expect((await call('POST', `/social/buddies/${inbox.received[0].id}/decline`, tokenB)).status)
        .toBe(200);
      expect(
        (await json<{ buddies: unknown[] }>(await call('GET', '/social/buddies', tokenA))).buddies
      ).toEqual([]);

      // Re-asking returns it to pending rather than 409-ing, which would be a
      // state oracle ("you already asked, and they said no").
      const again = await call('POST', '/social/buddies/request', tokenA, { email: EMAIL(UID_B) });
      expect(again.status).toBe(201);
      expect((await json<{ request: { status: string } }>(again)).request.status).toBe('pending');
    });

    it('removing a connection empties the list on BOTH sides', async () => {
      const link = await makeBuddies(tokenA, tokenB, EMAIL(UID_B));
      expect(
        (await json<{ buddies: unknown[] }>(await call('GET', '/social/buddies', tokenA))).buddies
      ).toHaveLength(1);
      expect((await call('DELETE', `/social/buddies/${link}`, tokenB)).status).toBe(200);
      for (const token of [tokenA, tokenB]) {
        expect(
          (await json<{ buddies: unknown[] }>(await call('GET', '/social/buddies', token))).buddies
        ).toEqual([]);
      }
      // A bystander's attempt reads like a request that never existed.
      await expectIndistinguishable(
        await call('DELETE', `/social/buddies/${link}`, tokenC),
        await call('DELETE', '/social/buddies/hbud_ghost', tokenC)
      );
    });
  });

  /* ==================================================================== */
  /* 3. CHALLENGE PARTICIPATION                                           */
  /* ==================================================================== */

  describe('challenge visibility', () => {
    it('visibility=buddies is visible to a buddy and invisible to everyone else', async () => {
      // The `buddies` branch of `canSeeChallenge` (health-social-service.ts:1321)
      // had no test at either layer: every existing spec uses `public` or the
      // `family` NEGATIVE. It decides who may read a leaderboard.
      await makeBuddies(tokenA, tokenB, EMAIL(UID_B));
      const id = await makeChallenge(tokenA, { visibility: 'buddies' });

      const buddy = await json<{ challenges: Array<{ id: string }> }>(
        await call('GET', '/social/challenges', tokenB)
      );
      expect(buddy.challenges.map((c) => c.id)).toContain(id);
      expect((await call('POST', `/social/challenges/${id}/join`, tokenB)).status).toBe(200);

      const stranger = await json<{ challenges: Array<{ id: string }> }>(
        await call('GET', '/social/challenges', tokenD)
      );
      expect(stranger.challenges.map((c) => c.id)).not.toContain(id);
      // 404, not 403 — a 403 would confirm the challenge exists.
      await expectIndistinguishable(
        await call('POST', `/social/challenges/${id}/join`, tokenD),
        await call('POST', '/social/challenges/hchl_ghost/join', tokenD)
      );
      await expectIndistinguishable(
        await call('GET', `/social/challenges/${id}/progress`, tokenD),
        await call('GET', '/social/challenges/hchl_ghost/progress', tokenD)
      );
    });

    it('a FAMILY relationship is not a buddy relationship for visibility', async () => {
      // Family and buddies are separate keys everywhere else in this service;
      // visibility must not quietly treat one as the other.
      await joinFamily(tokenA, tokenC, EMAIL(UID_C));
      const id = await makeChallenge(tokenA, { visibility: 'buddies' });
      const relative = await json<{ challenges: Array<{ id: string }> }>(
        await call('GET', '/social/challenges', tokenC)
      );
      expect(relative.challenges.map((c) => c.id)).not.toContain(id);
      expect((await call('POST', `/social/challenges/${id}/join`, tokenC)).status).toBe(404);
    });

    it('visibility=family is visible to a family member and to nobody else', async () => {
      // The POSITIVE half of the family branch — the sibling suites only cover
      // the negative, so a `sharedFamilyId` that always returned null would
      // still have looked green.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      const id = await makeChallenge(tokenA, { visibility: 'family' });
      const relative = await json<{ challenges: Array<{ id: string }> }>(
        await call('GET', '/social/challenges', tokenB)
      );
      expect(relative.challenges.map((c) => c.id)).toContain(id);
      expect((await call('GET', `/social/challenges/${id}/progress`, tokenB)).status).toBe(200);
      expect((await call('GET', `/social/challenges/${id}/progress`, tokenD)).status).toBe(404);
    });

    it('the creator always sees their own challenge, even with no relationships', async () => {
      const id = await makeChallenge(tokenA, { visibility: 'buddies' });
      const mine = await json<{ challenges: Array<{ id: string; joined: boolean }> }>(
        await call('GET', '/social/challenges', tokenA)
      );
      expect(mine.challenges.find((c) => c.id === id)?.joined).toBe(true);
      expect((await call('GET', `/social/challenges/${id}/progress`, tokenA)).status).toBe(200);
    });

    it('a participant keeps access after the relationship that let them in is gone', async () => {
      // Documented behaviour of `canSeeChallenge`: participation short-circuits
      // before visibility. Pinned so a future change to the visibility rules is
      // a deliberate decision about people who already joined.
      const link = await makeBuddies(tokenA, tokenB, EMAIL(UID_B));
      const id = await makeChallenge(tokenA, { visibility: 'buddies' });
      expect((await call('POST', `/social/challenges/${id}/join`, tokenB)).status).toBe(200);
      expect((await call('DELETE', `/social/buddies/${link}`, tokenB)).status).toBe(200);
      expect((await call('GET', `/social/challenges/${id}/progress`, tokenB)).status).toBe(200);
    });
  });

  describe('challenge participation', () => {
    it('joining twice does not create a second seat', async () => {
      const id = await makeChallenge(tokenA);
      expect((await call('POST', `/social/challenges/${id}/join`, tokenB)).status).toBe(200);
      expect((await call('POST', `/social/challenges/${id}/join`, tokenB)).status).toBe(200);
      const list = await json<{ challenges: Array<{ id: string; participant_count: number }> }>(
        await call('GET', '/social/challenges', tokenB)
      );
      expect(list.challenges.find((c) => c.id === id)?.participant_count).toBe(2);
    });

    it('leaving one you never joined reads like leaving one that never existed', async () => {
      const id = await makeChallenge(tokenA);
      await expectIndistinguishable(
        await call('POST', `/social/challenges/${id}/leave`, tokenB),
        await call('POST', '/social/challenges/hchl_ghost/leave', tokenB)
      );
    });

    it('recording progress needs a seat, and a missing challenge reads the same', async () => {
      const id = await makeChallenge(tokenA);
      await expectIndistinguishable(
        await call('POST', `/social/challenges/${id}/progress`, tokenB, { date: DAY, value: 1 }),
        await call('POST', '/social/challenges/hchl_ghost/progress', tokenB, {
          date: DAY,
          value: 1,
        })
      );
      // …and it stops working the moment the seat is given up.
      expect(
        (await call('POST', `/social/challenges/${id}/progress`, tokenA, { date: DAY, value: 1 }))
          .status
      ).toBe(201);
      expect((await call('POST', `/social/challenges/${id}/leave`, tokenA)).status).toBe(200);
      expect(
        (await call('POST', `/social/challenges/${id}/progress`, tokenA, { date: DAY, value: 2 }))
          .status
      ).toBe(404);
    });

    it('`mine` carries only the caller rows, never a hidden peer figure', async () => {
      // `challengeProgress` selects EVERY participant's progress rows in one
      // query and then splits them. If `mine` were ever computed before that
      // filter, a peer's daily numbers would ship inside the caller's own list.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      const id = await makeChallenge(tokenA);
      await call('POST', `/social/challenges/${id}/join`, tokenB);
      await call('POST', `/social/challenges/${id}/progress`, tokenA, { date: DAY, value: 12345 });
      await call('POST', `/social/challenges/${id}/progress`, tokenB, { date: DAY, value: 6789 });

      const res = await call('GET', `/social/challenges/${id}/progress`, tokenB);
      const body = await json<{
        mine: Array<{ user_id: string; value: number }>;
        leaderboard: Array<{ user_id: string }>;
        hidden_participants: number;
      }>(res);
      expect(body.mine.map((r) => r.user_id)).toEqual([UID_B]);
      expect(body.mine.map((r) => r.value)).toEqual([6789]);
      expect(body.leaderboard.map((r) => r.user_id)).toEqual([UID_B]);
      expect(body.hidden_participants).toBe(1);
      // Alice's figure must not appear ANYWHERE in the payload, not even as a
      // total, until she grants the metric.
      expect(JSON.stringify(body)).not.toContain('12345');
      expect(JSON.stringify(body)).not.toContain(UID_A);
    });

    it('the from/to window filters the caller own rows', async () => {
      const id = await makeChallenge(tokenA);
      for (const [date, value] of [
        ['2026-05-30', 1],
        ['2026-06-01', 2],
        ['2026-06-03', 3],
      ] as const) {
        expect(
          (await call('POST', `/social/challenges/${id}/progress`, tokenA, { date, value })).status
        ).toBe(201);
      }
      const windowed = await json<{ mine: Array<{ date: string }> }>(
        await call('GET', `/social/challenges/${id}/progress?from=2026-06-01&to=2026-06-02`, tokenA)
      );
      expect(windowed.mine.map((r) => r.date)).toEqual(['2026-06-01']);
    });
  });

  /* ==================================================================== */
  /* 4. SHARE VISIBILITY                                                  */
  /* ==================================================================== */

  describe('grants are scoped to the two parties named on them', () => {
    it('the given list and the held list never cross, even three ways', async () => {
      // A → B (weight), C → B (water), B → A (habits). Every list must show
      // exactly the two rows that name its caller in the right role.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await joinFamily(tokenC, tokenD, EMAIL(UID_D));
      const cb = await makeBuddies(tokenC, tokenB, EMAIL(UID_B));
      expect(cb).toBeTruthy();

      await grant(tokenA, UID_B, 'family', ['weight']);
      await grant(tokenC, UID_B, 'buddy', ['water']);
      await grant(tokenB, UID_A, 'family', ['habits']);

      const given = await json<{ grants: Grant[] }>(await call('GET', '/social/shares', tokenB));
      expect(given.grants.map((g) => `${g.owner_id}->${g.viewer_id}:${g.scope}`)).toEqual([
        `${UID_B}->${UID_A}:habits`,
      ]);

      const held = await json<{ grants: Grant[] }>(
        await call('GET', '/social/shares/received', tokenB)
      );
      expect(held.grants.map((g) => `${g.owner_id}->${g.viewer_id}:${g.scope}`).sort()).toEqual(
        [`${UID_A}->${UID_B}:weight`, `${UID_C}->${UID_B}:water`].sort()
      );

      // Dave shares a family with Carol but is named on nothing.
      expect(
        (await json<{ grants: Grant[] }>(await call('GET', '/social/shares', tokenD))).grants
      ).toEqual([]);
      expect(
        (await json<{ grants: Grant[] }>(await call('GET', '/social/shares/received', tokenD)))
          .grants
      ).toEqual([]);
    });

    it('a third party cannot revoke a grant they are not the owner of', async () => {
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await joinFamily(tokenA, tokenC, EMAIL(UID_C));
      const [g] = await grant(tokenA, UID_B, 'family', ['weight']);
      // Carol is in the SAME family and still gets "no such grant".
      await expectIndistinguishable(
        await call('DELETE', `/social/shares/${g.id}`, tokenC),
        await call('DELETE', '/social/shares/hms_ghost', tokenC)
      );
      await seedAliceDay();
      expect(
        (await call('GET', `/social/shares/${UID_A}/metrics?date=${DAY}`, tokenB)).status
      ).toBe(200);
    });

    it('an owner who does not exist reads exactly like an owner who shared nothing', async () => {
      // `readSharedMetrics` returns null for "no grant", "relationship gone" and
      // "no such account" so the three are one answer. Asserted as a whole
      // fingerprint because a differing MESSAGE would be enough to enumerate
      // accounts one id at a time.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await expectIndistinguishable(
        await call('GET', `/social/shares/${UID_A}/metrics?date=${DAY}`, tokenB),
        await call('GET', `/social/shares/u_definitely_not_a_user/metrics?date=${DAY}`, tokenB)
      );
    });

    it('a family grant and a buddy grant to the same viewer union into one payload', async () => {
      // Two relationships, two grant rows, ONE read. If the read keyed on
      // relationship type instead of unioning, half the granted data would
      // silently disappear.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await makeBuddies(tokenA, tokenB, EMAIL(UID_B));
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      await grant(tokenA, UID_B, 'buddy', ['water']);

      const body = await json<{ scopes: string[]; metrics: Record<string, unknown> }>(
        await call('GET', `/social/shares/${UID_A}/metrics?date=${DAY}`, tokenB)
      );
      expect(body.scopes.sort()).toEqual(['water', 'weight']);
      expect(body.metrics.water).toEqual({ total_ml: 500 });
      expect(body.metrics).not.toHaveProperty('activity');
    });

    it('a viewer cannot pivot one grant into a read of a THIRD account', async () => {
      // Bob holds a real grant from Alice. That must buy him nothing against
      // Carol, who is in the same family as him.
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await joinFamily(tokenA, tokenC, EMAIL(UID_C));
      await seedAliceDay();
      await grant(tokenA, UID_B, 'family', ['weight']);
      await expectIndistinguishable(
        await call('GET', `/social/shares/${UID_C}/metrics?date=${DAY}`, tokenB),
        await call('GET', `/social/shares/u_definitely_not_a_user/metrics?date=${DAY}`, tokenB)
      );
    });
  });

  /* ==================================================================== */
  /* 5. COMMUNITY ROOM MEMBERSHIP                                         */
  /* ==================================================================== */

  describe('community rooms', () => {
    it('a creator who leaves their own room can no longer read it', async () => {
      // Room membership, not authorship, is the read key — otherwise "leave"
      // would be cosmetic for the one person most likely to have posted.
      const id = await makeTopic(tokenA);
      await call('POST', `/social/community/topics/${id}/messages`, tokenA, { content: 'hello' });
      expect((await call('POST', `/social/community/topics/${id}/leave`, tokenA)).status).toBe(200);
      const res = await call('GET', `/social/community/topics/${id}/messages`, tokenA);
      expect(res.status).toBe(403);
      expect((await json<ErrorBody>(res)).error.code).toBe('not_a_participant');
    });

    it('leaving a room twice is refused, and leaving one you never joined too', async () => {
      const id = await makeTopic(tokenA);
      expect((await call('POST', `/social/community/topics/${id}/leave`, tokenA)).status).toBe(200);
      const second = await call('POST', `/social/community/topics/${id}/leave`, tokenA);
      expect(second.status).toBe(404);
      expect((await json<ErrorBody>(second)).error.message).toBe('Topic membership not found');
      expect((await call('POST', `/social/community/topics/${id}/leave`, tokenB)).status).toBe(404);
    });

    it('a locked room still reads but refuses new posts', async () => {
      // `is_locked` has no write endpoint yet (moderation is manual/SQL), so it
      // is set the way an operator would. The branch still has to work.
      const id = await makeTopic(tokenA);
      await testEnv.DB.prepare(`UPDATE health_community_topics SET is_locked = 1 WHERE id = ?`)
        .bind(id)
        .run();
      const blocked = await call('POST', `/social/community/topics/${id}/messages`, tokenA, {
        content: 'still talking',
      });
      expect(blocked.status).toBe(403);
      expect((await json<ErrorBody>(blocked)).error.code).toBe('topic_locked');
      expect((await call('GET', `/social/community/topics/${id}/messages`, tokenA)).status).toBe(200);
    });

    it('a reply cannot reach across rooms', async () => {
      // `reply_to_id` is a free string. Threading a message onto a parent in a
      // room the caller is not in would quote content out of a private room.
      const roomA = await makeTopic(tokenA, 'Room A');
      const roomB = await makeTopic(tokenB, 'Room B');
      const posted = await json<{ message: { id: string } }>(
        await call('POST', `/social/community/topics/${roomB}/messages`, tokenB, {
          content: 'in room B',
        })
      );
      const res = await call('POST', `/social/community/topics/${roomA}/messages`, tokenA, {
        content: 'quoting you',
        reply_to_id: posted.message.id,
      });
      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.message).toBe('Message not found');
    });

    it('the room creator cannot delete somebody else message', async () => {
      const id = await makeTopic(tokenA);
      await call('POST', `/social/community/topics/${id}/join`, tokenB);
      const posted = await json<{ message: { id: string } }>(
        await call('POST', `/social/community/topics/${id}/messages`, tokenB, { content: 'mine' })
      );
      // Creating the room is not moderating it.
      await expectIndistinguishable(
        await call('DELETE', `/social/community/messages/${posted.message.id}`, tokenA),
        await call('DELETE', '/social/community/messages/hmsg_ghost', tokenA)
      );
      expect(
        (
          await json<{ messages: unknown[] }>(
            await call('GET', `/social/community/topics/${id}/messages`, tokenA)
          )
        ).messages
      ).toHaveLength(1);
    });

    it('the category filter narrows the directory instead of emptying it', async () => {
      // The route rejects a category outside the enum (covered elsewhere); this
      // is the POSITIVE half — a filter that silently matched nothing would
      // read to a member as "there are no rooms about nutrition".
      await call('POST', '/social/community/topics', tokenA, {
        title: 'Macros',
        category: 'nutrition',
      });
      await call('POST', '/social/community/topics', tokenA, {
        title: 'Squats',
        category: 'fitness',
      });
      const filtered = await json<{ topics: Array<{ title: string; category: string }> }>(
        await call('GET', '/social/community/topics?category=nutrition', tokenA)
      );
      expect(filtered.topics.map((t) => t.title)).toEqual(['Macros']);
      expect(filtered.topics.every((t) => t.category === 'nutrition')).toBe(true);
      const unfiltered = await json<{ topics: unknown[] }>(
        await call('GET', '/social/community/topics', tokenA)
      );
      expect(unfiltered.topics.length).toBeGreaterThan(filtered.topics.length);
    });

    it('a soft-deleted message cannot be deleted again', async () => {
      const id = await makeTopic(tokenA);
      const posted = await json<{ message: { id: string } }>(
        await call('POST', `/social/community/topics/${id}/messages`, tokenA, { content: 'x' })
      );
      expect(
        (await call('DELETE', `/social/community/messages/${posted.message.id}`, tokenA)).status
      ).toBe(200);
      await expectIndistinguishable(
        await call('DELETE', `/social/community/messages/${posted.message.id}`, tokenA),
        await call('DELETE', '/social/community/messages/hmsg_ghost', tokenA)
      );
    });
  });

  /* ==================================================================== */
  /* 6. CORNER — the query parameters that reach SQL unvalidated          */
  /* ==================================================================== */

  describe('malformed list parameters never 5xx', () => {
    /**
     * `?limit` is read with a bare `Number(...)` and handed to
     * `Math.min(limit ?? 50, cap)` → drizzle `.limit()`. `Number('abc')` is NaN
     * and `Math.min(NaN, 100)` is NaN, so a single junk character in a query
     * string decides whether a bound parameter is a number at all. A 5xx here
     * is a trivially reachable denial of service on the first screen of the
     * Social tab, so every list is swept with the same values.
     */
    const JUNK = ['abc', '', '-1', '0', 'NaN', 'Infinity', '1e999', '99999999', '1.5'];

    /** The three lists that accept `?limit`, each with its own path builder. */
    const LIMIT_LISTS: ReadonlyArray<readonly [string, (limit: string) => Promise<string>]> = [
      ['GET /social/community/topics', async (l) => `/social/community/topics?limit=${l}`],
      ['GET /social/challenges', async (l) => `/social/challenges?limit=${l}`],
      [
        'GET /social/community/topics/:id/messages',
        async (l) => {
          const listed = await json<{ topics: Array<{ id: string }> }>(
            await call('GET', '/social/community/topics', tokenA)
          );
          return `/social/community/topics/${listed.topics[0].id}/messages?limit=${l}`;
        },
      ],
    ];

    beforeEach(async () => {
      const topic = await makeTopic(tokenA);
      await call('POST', `/social/community/topics/${topic}/messages`, tokenA, { content: 'a' });
      await makeChallenge(tokenA);
    });

    it.each(
      LIMIT_LISTS.flatMap(([label, build]) =>
        JUNK.map((limit) => [`${label}?limit=${limit || '(empty)'}`, build, limit] as const)
      )
    )('%s', async (_label, build, limit) => {
      const res = await call('GET', await build(limit), tokenA);
      expect(res.status, `limit=${limit} -> ${res.status}`).toBeLessThan(500);
    });

    // FIXED (was `HEALTH-SOCIAL-DEFECT-01`): a fractional `?limit` used to
    // reach `LIMIT ?` as a REAL, which D1 rejects with `SQLITE_MISMATCH` → 500.
    // The three list routes now reject a non-integer limit with 400 before it
    // reaches the service; '1.5' moved into `JUNK` above, which the sweep at
    // HEALTH-SOCIAL-102 already asserts stays under 500.

    it('challenge progress survives a garbage from/to window', async () => {
      // `from` / `to` are passed straight into `gte`/`lte` with no shape check.
      // They are bound parameters, so this is a robustness question, not an
      // injection one — but a 5xx would still take the leaderboard down.
      const listed = await json<{ challenges: Array<{ id: string }> }>(
        await call('GET', '/social/challenges', tokenA)
      );
      const id = listed.challenges[0].id;
      for (const q of [
        '?from=not-a-date',
        '?to=not-a-date',
        '?from=2026-06-02&to=2026-06-01',
        "?from='%20OR%201=1--",
        '?from=&to=',
      ]) {
        const res = await call('GET', `/social/challenges/${id}/progress${q}`, tokenA);
        expect(res.status, q).toBeLessThan(500);
      }
    });

    it('a shared-metrics read of a syntactically valid but impossible date answers', async () => {
      await joinFamily(tokenA, tokenB, EMAIL(UID_B));
      await grant(tokenA, UID_B, 'family', ['water']);
      // The route only checks YYYY-MM-DD shape, so this reaches the query.
      const res = await call('GET', `/social/shares/${UID_A}/metrics?date=9999-99-99`, tokenB);
      expect(res.status).toBe(200);
      expect((await json<{ metrics: { water: unknown } }>(res)).metrics.water).toEqual({
        total_ml: 0,
      });
    });
  });
});
