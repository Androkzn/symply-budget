import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import {
  HealthSocialService,
  NEVER_SHAREABLE_SCOPES,
  SHAREABLE_SCOPES,
  type Failure,
} from '../services/health-social-service';
import type { Env } from '../types';

/**
 * Symply Health — parity phase P4, the SOCIAL surface: family sharing,
 * accountability buddies, community rooms, joinable challenges, and the SCOPED
 * SHARE GRANT that is the only thing which makes any of it readable.
 *
 * Mounted at `/health` alongside routes/health.ts (P1) and routes/health-food.ts
 * (P2); this router owns the disjoint `/social/*` sub-tree, so mount ordering
 * between the health routers does not matter.
 *
 * THIN CLIENT, exactly like its siblings: every authorisation decision, every
 * cascade and every derived figure lives in `HealthSocialService`. Handlers
 * validate a shape, pass it through, and render the service's verdict.
 *
 * ===================== THIS SURFACE SHIPS DISABLED ======================
 * `health_social_enabled` in CONFIG_KV must hold the LITERAL STRING 'true'.
 * Absent, empty, 'false', 'FALSE', '1', 'yes' — every one of those 404s the
 * entire sub-tree.
 *
 * NOTE THE INVERSION. The repo's usual kill-switch convention is the opposite:
 * `routes/savings.ts` treats an ABSENT key as ENABLED and only the literal
 * 'false' disables, and `services/config-flags.ts` treats '1' and 'yes' as
 * truthy. Neither is safe here. Health social data is DENY-BY-DEFAULT
 * (documents/apps/symply-health/migration.md — "Health inbound and outbound
 * sharing is denied by default"; family/community/social are "denied until
 * approved"), so a missing key, a typo'd key, a KV read that returns null on a
 * fresh environment, or a half-finished rollout must all mean OFF. The check is
 * therefore `!== 'true'`, deliberately NOT `isTruthyKvFlag()`.
 *
 * Enable, per environment, only after privacy review signs off:
 *   wrangler kv key put --binding CONFIG_KV --env staging    --remote health_social_enabled true
 *   wrangler kv key put --binding CONFIG_KV --env production --remote health_social_enabled true
 * Disable instantly by deleting the key.
 * ========================================================================
 *
 * Gate order is BRAND → FLAG → AUTH. The flag fires before the token check so an
 * unauthenticated probe of a disabled fleet gets a flat 404 and never a 401,
 * which would confirm the surface exists.
 *
 * Deliberately NOT ported from the donor (see the service header for the rest):
 * the user-directory search endpoints, the buddy feed (journey updates /
 * reactions / comments), family photos, per-family "dashboard preferences"
 * (share-by-default), message attachments, and the community notification
 * inbox — the platform notification service owns that.
 */

/** CONFIG_KV key. Absent ⇒ OFF. Only the literal 'true' enables. */
export const HEALTH_SOCIAL_FLAG_KEY = 'health_social_enabled';

/**
 * The whole gate, as a pure function so a test can pin it without HTTP.
 *
 * INVERSE of `savings_enabled`: this answers false for `null`, `''`, `'false'`,
 * `'FALSE'`, `'1'`, `'yes'`, `'True'` — everything except exactly `'true'`.
 */
export function isHealthSocialEnabled(flag: string | null | undefined): boolean {
  return flag === 'true';
}

const healthSocial = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 1. Brand: 404s the surface on House/Budget/Kaizen Workers.
healthSocial.use('/*', requireHealthApi());

/**
 * The kill switch as standalone middleware.
 *
 * Exported because mounting it on THIS router is not enough in the real Worker:
 * `routes/health.ts` is mounted at the same `/health` prefix and registers
 * `use('/*', authMiddleware())`, which Hono runs for every `/health/*` path —
 * including these. Auth therefore fired first and an unauthenticated probe of a
 * DISABLED surface got 401 instead of 404, quietly confirming the path exists.
 *
 * `src/index.ts` registers this on the app for `/health/social/*` BEFORE any
 * `/health` mount, so the flag is genuinely the first thing consulted. It stays
 * mounted here as well: defence in depth, and it keeps this router correct when
 * mounted standalone in tests.
 */
export function requireHealthSocialFlag() {
  return async (
    c: { env: Env; json: (body: unknown, status: 404) => Response },
    next: () => Promise<void>
  ) => {
    const flag = await c.env.CONFIG_KV.get(HEALTH_SOCIAL_FLAG_KEY);
    if (!isHealthSocialEnabled(flag)) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    await next();
  };
}

// 2. Kill switch — deny-by-default, see the header. Before auth on purpose.
healthSocial.use('/*', requireHealthSocialFlag());

// 3. Auth.
healthSocial.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthSocialService {
  return new HealthSocialService(c.env.DB);
}

/** Every failure carries its own status — the route never re-derives one. */
function errorBody(f: Failure) {
  return { error: { code: f.code, message: f.message } };
}

/* ============================== SCHEMAS ================================ */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const emailSchema = z.string().trim().min(3).max(254).email();
const messageSchema = z.string().max(500).optional();

/**
 * The share scope enum is built from `SHAREABLE_SCOPES` so zod and the service
 * can never disagree. A request naming `cycle` still reaches the service — zod
 * would answer a generic 400 and the point of this task is that the SENSITIVE
 * refusal is explicit — so the enum is widened to "any string" here and the
 * verdict comes from `validateScopes`, which distinguishes `forbidden_scope`
 * from `unknown_scope`.
 */
const scopeListSchema = z.array(z.string().min(1).max(40)).min(1).max(SHAREABLE_SCOPES.length + 8);

/* =============================== FAMILY ================================ */

healthSocial.get('/social/family', async (c) => {
  return c.json({ family: await svc(c).getFamily(uid(c)) });
});

healthSocial.post(
  '/social/family',
  zValidator('json', z.object({ name: z.string().trim().min(1).max(80) })),
  async (c) => {
    const result = await svc(c).createFamily(uid(c), c.req.valid('json').name);
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ family: result.family }, 201);
  }
);

healthSocial.get('/social/family/members', async (c) => {
  const family = await svc(c).getFamily(uid(c));
  return c.json({ members: family?.members ?? [] });
});

/**
 * Rule 5: the response body and status are IDENTICAL whether `email` belongs to
 * an account, to an account already in another family, or to nobody. 201 in
 * every case — the resource created is the INVITATION, whose existence does not
 * depend on the addressee.
 */
healthSocial.post(
  '/social/family/invite',
  zValidator('json', z.object({ email: emailSchema, message: messageSchema })),
  async (c) => {
    const { email, message } = c.req.valid('json');
    const result = await svc(c).inviteToFamily(uid(c), email, message);
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ invitation: result.invitation }, 201);
  }
);

healthSocial.get('/social/family/invitations', async (c) => {
  const service = svc(c);
  const [received, sent] = await Promise.all([
    service.listReceivedInvitations(uid(c)),
    service.listSentInvitations(uid(c)),
  ]);
  return c.json({ received, sent });
});

/** Deep-link resolution — addressee only, so a guessed code reveals nothing. */
healthSocial.get('/social/family/invitations/code/:code', async (c) => {
  const result = await svc(c).resolveInviteCode(uid(c), c.req.param('code'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ invitation: result.invitation });
});

/** Joining grants NOTHING — an explicit /social/shares grant is still required. */
healthSocial.post('/social/family/invitations/:id/accept', async (c) => {
  const result = await svc(c).acceptInvitation(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ family: result.family });
});

healthSocial.post('/social/family/invitations/:id/decline', async (c) => {
  const result = await svc(c).declineInvitation(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ declined: true });
});

/** Rule 4 — revokes every family grant between the leaver and each member. */
healthSocial.post('/social/family/leave', async (c) => {
  const result = await svc(c).leaveFamily(uid(c));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ left: true, revoked_grants: result.revoked });
});

/** Owner-only; same symmetric revocation. 404 for a non-owner (never 403). */
healthSocial.delete('/social/family/members/:userId', async (c) => {
  const result = await svc(c).removeMember(uid(c), c.req.param('userId'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ removed: true, revoked_grants: result.revoked });
});

/* =============================== BUDDIES =============================== */

healthSocial.get('/social/buddies', async (c) => {
  return c.json({ buddies: await svc(c).listBuddies(uid(c)) });
});

healthSocial.get('/social/buddies/requests', async (c) => {
  return c.json(await svc(c).listBuddyRequests(uid(c)));
});

/** Same invariant-response rule as the family invite (rule 5). */
healthSocial.post(
  '/social/buddies/request',
  zValidator('json', z.object({ email: emailSchema, message: messageSchema })),
  async (c) => {
    const { email, message } = c.req.valid('json');
    const result = await svc(c).requestBuddy(uid(c), email, message);
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ request: result.request }, 201);
  }
);

/** Accepting grants NOTHING (rule 1). */
healthSocial.post('/social/buddies/:id/accept', async (c) => {
  const result = await svc(c).acceptBuddy(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ buddy: result.buddy });
});

healthSocial.post('/social/buddies/:id/decline', async (c) => {
  const result = await svc(c).declineBuddy(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ declined: true });
});

/** Rule 4 — revokes every buddy grant between the two, both directions. */
healthSocial.delete('/social/buddies/:id', async (c) => {
  const result = await svc(c).removeBuddy(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ removed: true, revoked_grants: result.revoked });
});

/* ============================== COMMUNITY ============================== */

const topicCategory = z.enum([
  'nutrition',
  'fitness',
  'recipes',
  'motivation',
  'tips',
  'general',
  'challenges',
]);

healthSocial.get('/social/community/topics', async (c) => {
  const { category, limit } = c.req.query();
  const parsed = category ? topicCategory.safeParse(category) : null;
  if (parsed && !parsed.success) {
    return c.json({ error: { code: 'bad_request', message: 'invalid category' } }, 400);
  }
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const topics = await svc(c).listTopics(uid(c), {
    category: parsed?.data,
    limit: parsedLimit,
  });
  return c.json({ topics });
});

healthSocial.post(
  '/social/community/topics',
  zValidator(
    'json',
    z.object({
      title: z.string().trim().min(1).max(120),
      description: z.string().max(500).nullable().optional(),
      category: topicCategory,
      icon: z.string().max(40).nullable().optional(),
      color: z.string().max(20).nullable().optional(),
    })
  ),
  async (c) => {
    return c.json({ topic: await svc(c).createTopic(uid(c), c.req.valid('json')) }, 201);
  }
);

healthSocial.post('/social/community/topics/:id/join', async (c) => {
  const result = await svc(c).joinTopic(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ joined: true });
});

healthSocial.post('/social/community/topics/:id/leave', async (c) => {
  const result = await svc(c).leaveTopic(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ left: true });
});

/** Reading requires JOINING — browsing the directory never exposes messages. */
healthSocial.get('/social/community/topics/:id/messages', async (c) => {
  const limit = c.req.query('limit');
  const parsedLimit = limit ? Number(limit) : undefined;
  // Bound into `LIMIT ?`, and D1 rejects a non-integer REAL there with
  // SQLITE_MISMATCH — so `?limit=1.5` used to 500 on an ordinary list.
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const result = await svc(c).listMessages(uid(c), c.req.param('id'), {
    limit: parsedLimit,
  });
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ messages: result.messages });
});

/**
 * TEXT ONLY — there is no attachment field by design. The donor allowed
 * `recipe_share` / `workout_share` / `achievement` payloads here, which would
 * push health data into a public room without any grant.
 */
healthSocial.post(
  '/social/community/topics/:id/messages',
  zValidator(
    'json',
    z.object({
      content: z.string().trim().min(1).max(2000),
      reply_to_id: z.string().max(80).optional(),
    })
  ),
  async (c) => {
    const { content, reply_to_id } = c.req.valid('json');
    const result = await svc(c).postMessage(uid(c), c.req.param('id'), content, reply_to_id);
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ message: result.message }, 201);
  }
);

healthSocial.delete('/social/community/messages/:id', async (c) => {
  const result = await svc(c).deleteMessage(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ deleted: true });
});

/* ============================== CHALLENGES ============================= */

healthSocial.get('/social/challenges', async (c) => {
  const limit = c.req.query('limit');
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const challenges = await svc(c).listChallenges(uid(c), {
    limit: parsedLimit,
  });
  return c.json({ challenges });
});

healthSocial.post(
  '/social/challenges',
  zValidator(
    'json',
    z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(1000).nullable().optional(),
      // Left as a free string on purpose: `validateScopes` must be the one that
      // answers, so a `cycle` challenge is refused with `forbidden_scope`
      // rather than a generic zod enum error.
      metric: z.string().min(1).max(40),
      target_value: z.number().positive().max(1_000_000),
      unit: z.string().max(20).optional(),
      frequency: z.enum(['daily', 'weekly']).optional(),
      visibility: z.enum(['public', 'family', 'buddies']).optional(),
      start_date: dateSchema,
      end_date: dateSchema.nullable().optional(),
    })
  ),
  async (c) => {
    const result = await svc(c).createChallenge(uid(c), c.req.valid('json'));
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ challenge: result.challenge }, 201);
  }
);

healthSocial.post('/social/challenges/:id/join', async (c) => {
  const result = await svc(c).joinChallenge(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ joined: true });
});

healthSocial.post('/social/challenges/:id/leave', async (c) => {
  const result = await svc(c).leaveChallenge(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ left: true });
});

/**
 * The leaderboard carries ONLY participants who granted the caller the
 * challenge's metric scope; everybody else is an anonymous count. Joining the
 * same challenge is a relationship, and a relationship grants nothing (rule 1).
 */
healthSocial.get('/social/challenges/:id/progress', async (c) => {
  const { from, to } = c.req.query();
  const result = await svc(c).challengeProgress(uid(c), c.req.param('id'), { from, to });
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({
    challenge: result.challenge,
    mine: result.mine,
    leaderboard: result.leaderboard,
    hidden_participants: result.hidden_participants,
  });
});

healthSocial.post(
  '/social/challenges/:id/progress',
  zValidator(
    'json',
    z.object({ date: dateSchema, value: z.number().min(0).max(1_000_000) })
  ),
  async (c) => {
    const result = await svc(c).recordProgress(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ progress: result.progress }, 201);
  }
);

/* ================================ SHARES =============================== */
/* The scoped grant. Literal paths are registered before `/:ownerId/metrics`
 * so `scopes` and `received` can never be read as a user id.               */

/**
 * The catalogue the client renders. `never_shareable` is returned explicitly so
 * the exclusion is discoverable by the app rather than tribal knowledge.
 */
healthSocial.get('/social/shares/scopes', async (c) => {
  return c.json(svc(c).scopeCatalogue());
});

healthSocial.get('/social/shares', async (c) => {
  return c.json({ grants: await svc(c).listGrants(uid(c)) });
});

healthSocial.get('/social/shares/received', async (c) => {
  return c.json({ grants: await svc(c).listReceivedGrants(uid(c)) });
});

/**
 * The ONE endpoint that creates read access.
 *
 * There is no `owner_id` field: the grantor is always the authenticated caller,
 * so "A cannot grant on B's behalf" is structural. A `cycle` / `vitality` /
 * `body_photos` / `body_measurements` scope is refused with `forbidden_scope`.
 */
healthSocial.post(
  '/social/shares',
  zValidator(
    'json',
    z.object({
      viewer_id: z.string().min(1).max(80),
      relationship_type: z.enum(['family', 'buddy']),
      scopes: scopeListSchema,
    })
  ),
  async (c) => {
    const result = await svc(c).grantScopes(uid(c), c.req.valid('json'));
    if (!result.ok) return c.json(errorBody(result), result.status);
    return c.json({ grants: result.grants }, 201);
  }
);

/** Rule 3 — the next read by that viewer already fails. */
healthSocial.delete('/social/shares/:id', async (c) => {
  const result = await svc(c).revokeGrant(uid(c), c.req.param('id'));
  if (!result.ok) return c.json(errorBody(result), result.status);
  return c.json({ revoked: true, grant: result.grant });
});

/**
 * Read another user's shared metrics for ONE day.
 *
 * 404 when the caller holds no active grant, when the relationship behind every
 * grant is gone, and when the owner does not exist — all three are
 * indistinguishable on purpose. The payload contains ONLY the granted groups;
 * an ungranted group is absent entirely rather than null.
 */
healthSocial.get('/social/shares/:ownerId/metrics', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: { code: 'bad_request', message: 'date must be YYYY-MM-DD' } }, 400);
  }
  const shared = await svc(c).readSharedMetrics(uid(c), c.req.param('ownerId'), date);
  if (!shared) {
    return c.json({ error: { code: 'not_found', message: 'Shared data not found' } }, 404);
  }
  return c.json(shared);
});

/** Re-exported for the tests that pin the exclusion list from the HTTP layer. */
export { NEVER_SHAREABLE_SCOPES, SHAREABLE_SCOPES };

export default healthSocial;
