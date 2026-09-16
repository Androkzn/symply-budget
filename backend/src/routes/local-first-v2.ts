import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireLocalFirstApi } from '../middleware/brand-gate';
import { AiKeyShareService, notifyAiKeyShared } from '../services/ai-key-share-service';
import { verifyCheckpointPublisher } from '../services/checkpoint-authorization';
import { LocalFirstCheckpointService } from '../services/local-first-checkpoint-service';
import { LocalFirstControlService } from '../services/local-first-control-service';
import { notifyLocalFirstInviteEvent } from '../services/local-first-invite-notifications';
import { notifyLocalFirstMemberEvent } from '../services/local-first-member-notifications';
import { LocalFirstMailboxService } from '../services/local-first-mailbox-service';
import {
  LocalFirstSyncWakeService,
  buildSyncWakeRequest,
  requiresSourceDeviceId,
  resolveSyncWakePolicy,
} from '../services/local-first-sync-wake-service';
import type { Env } from '../types';
import {
  ForbiddenError,
  NotFoundError,
  PersonalHouseholdViolationError,
  ValidationError,
} from '../utils/errors';

import localFirstBlobRoutes from './local-first-blobs';

/**
 * Decode a client-supplied base64 ciphertext, or `null` if it is not base64.
 *
 * `atob` THROWS on malformed input, and the zod schemas guarding these routes
 * only prove the field is a string of a sane length. Unhandled, that throw
 * surfaces as `500 internal_error` — which reads as "the server is broken" for
 * what is really a bad request, and is what `PUT …/checkpoints` was observed
 * returning on staging. Both blob-accepting routes (checkpoint chunks and
 * mailbox deposits) share the hazard, so they share the decode.
 */
function decodeCiphertextBase64(base64: string): ArrayBuffer | null {
  try {
    // Freshly allocated here, so `.buffer` is always a real ArrayBuffer even
    // though the type widens to ArrayBufferLike.
    return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)).buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

const v2 = new Hono<{ Bindings: Env }>();

/**
 * A personal-household refusal, rendered in this router's error shape.
 *
 * The router answers every failure inline rather than throwing to `app.onError`
 * — it is also mounted bare in tests — so the named error is translated here
 * once instead of being re-described at each call site.
 */
function personalHouseholdRefusal(
  c: { json: (body: unknown, status: 403) => Response },
  error: PersonalHouseholdViolationError,
): Response {
  return c.json({ error: { code: error.code, message: error.message } }, 403);
}

v2.use(requireLocalFirstApi());
v2.use('/*', authMiddleware());

/**
 * Run work after the response, and never let it decide the response.
 *
 * Two hazards, both seen for real. On Workers an un-awaited promise is
 * cancelled the moment the handler returns — which is how the House
 * join-request notification was silently dropped once — so the happy path must
 * go through `waitUntil`. But `executionCtx` does not exist everywhere this
 * router runs (it is mounted bare in unit tests), and reaching for it there
 * throws INSIDE the handler and turns a perfectly good enrolment into a 500.
 *
 * An enrolment must never fail because somebody could not be told about it.
 */
function afterResponse(
  c: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } },
  work: Promise<unknown>,
): void {
  const settled = work.catch((error) => {
    console.error('[lf-invite] post-response work failed', error);
  });
  try {
    c.executionCtx?.waitUntil(settled);
  } catch {
    // No ExecutionContext bound: let it run un-awaited. It is already
    // catch-guarded, so the worst case is that it does not finish.
  }
}

function userId(c: { get: (k: 'userId') => string | undefined }): string {
  const id = c.get('userId');
  if (!id) throw new ValidationError('Unauthorized');
  return id;
}

const deviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  signingPublicKey: z.string().min(32).max(256),
  agreementPublicKey: z.string().min(32).max(256),
  label: z.string().max(120).nullable().optional(),
});

const pushRegisterSchema = z.object({
  householdId: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  token: z.string().min(1).max(512),
  platform: z.enum(['ios', 'android', 'web']),
});

/**
 * The ONLY place a sync wake is emitted. Both `/v2` call sites go through it so
 * the exclusion rule cannot drift between them — the asymmetry between the two
 * is exactly how a dead wake becomes a push loop.
 *
 * Brand policy (`local-first-sync-wake-service.ts`) decides two things:
 *
 *  - **wake type** — previously `isFullBudget(env) ? BUDGET : HOUSE`, which gave
 *    Health `house_sync_wake` because its `budgetMode` is `'minimal'`. The client
 *    filter is a hard equality, so every Health wake was silently dropped.
 *  - **what to exclude when the caller names no source device.** The exclusion
 *    itself is no longer a per-brand choice: every brand excludes the depositing
 *    DEVICE, so a member's own second device is woken like any other peer.
 *
 * The device id is the only thing standing between a wake and the caller waking
 * ITSELF (`syncOnce` → deposit → wake → `syncOnce`). Every client sends it; a
 * brand with no safe fallback for a request that omits it refuses to emit
 * rather than emitting a loop.
 */
async function enqueueSyncWake(
  env: Env,
  input: {
    householdId: string;
    callerUserId: string;
    sourceDeviceId?: string | null;
  },
): Promise<void> {
  const policy = resolveSyncWakePolicy(env);

  if (requiresSourceDeviceId(policy) && !input.sourceDeviceId) {
    console.warn(
      '[local-first-v2] sync wake skipped: brand excludes by device only and no sourceDeviceId was supplied',
    );
    return;
  }

  try {
    const wake = new LocalFirstSyncWakeService(env);
    await wake.sendSyncWake(buildSyncWakeRequest(env, input));
  } catch (error) {
    console.warn('[local-first-v2] sync wake enqueue failed', error);
  }
}

v2.get('/households', async (c) => {
  const service = new LocalFirstControlService(c.env);
  const households = await service.listHouseholdsForUser(userId(c));
  return c.json({ households });
});

v2.post(
  '/households',
  zValidator(
    'json',
    z.object({
      householdId: z.string().min(1).max(128),
      displayName: z.string().min(1).max(120),
      device: deviceSchema,
    }),
  ),
  async (c) => {
    const body = c.req.valid('json');
    const service = new LocalFirstControlService(c.env);
    try {
      const result = await service.createHousehold({
        householdId: body.householdId,
        ownerUserId: userId(c),
        displayName: body.displayName,
        device: body.device,
      });
      return c.json(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'create_failed';
      if (message.includes('UNIQUE')) {
        // Already registered — the client re-posts this on every session open.
        // Use it to re-assert the legacy household/member mirror so households
        // created before that mirror existed become chat-capable on next launch
        // (see LocalFirstControlService.ensureLegacyMirror).
        await service.ensureLegacyMirror(body.householdId, userId(c));
        return c.json({ error: { code: 'conflict', message: 'Household already exists' } }, 409);
      }
      throw error;
    }
  },
);

v2.get('/households/:householdId/state', async (c) => {
  const householdId = c.req.param('householdId');
  const service = new LocalFirstControlService(c.env);
  try {
    const state = await service.getState(householdId, userId(c));
    return c.json({ state });
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }
});

/**
 * Who is waiting to be let in, with enough about them to judge.
 *
 * Split out of `/state` because it needs a join the coordinator cannot do: the
 * DO holds user ids and key material, and an owner deciding whether to admit
 * someone needs a person — an address and a device name. An approval screen
 * that can only say "code ABC123 is waiting" gives the owner nothing to refuse
 * on, which is the gap every linked-device phishing campaign walks through.
 */
v2.get('/households/:householdId/invites/pending', async (c) => {
  const householdId = c.req.param('householdId');
  const service = new LocalFirstControlService(c.env);
  try {
    const pending = await service.listPendingInvites(householdId, userId(c));
    return c.json({ pending });
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }
});

/**
 * Every invite still in play — unclaimed and claimed alike.
 *
 * Distinct from `/invites/pending`, which answers only "who is waiting" and so
 * cannot see an invite nobody has claimed yet. An owner who minted a code and
 * closed the app had no way back to it: the code lived in the screen's memory
 * and nowhere else, so it could not be shown again and could not be cancelled.
 */
v2.get('/households/:householdId/invites/outstanding', async (c) => {
  const householdId = c.req.param('householdId');
  const service = new LocalFirstControlService(c.env);
  try {
    const invites = await service.listOutstandingInvites(householdId, userId(c));
    return c.json({ invites });
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }
});

/**
 * Take an invite out of play before it is approved.
 *
 * The counterpart to creating one, and the answer to a leak: a code sent to the
 * wrong person, screenshotted into a group chat, or simply minted by mistake
 * was until now live until it expired, with nothing an owner could do about it.
 * Refuses an already-approved invite — that device is enrolled, and removing it
 * is device revocation, a different act this must not silently perform.
 */
v2.post('/households/:householdId/invites/:inviteId/revoke', async (c) => {
  const householdId = c.req.param('householdId');
  const inviteId = c.req.param('inviteId');
  const service = new LocalFirstControlService(c.env);
  try {
    const context = await service.revokeInvite({
      householdId,
      inviteId,
      actorUserId: userId(c),
    });
    // Somebody may be sitting on "Waiting for approval…" that will now never
    // come. Only the claimant is told: the owner just tapped the button.
    if (context.status === 'revoked') {
      afterResponse(c, notifyLocalFirstInviteEvent(c.env, 'revoked', context));
    }
    return c.json({ invite: { inviteId, status: context.status } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'revoke_failed';
    if (message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    if (message === 'invite_already_approved') {
      return c.json(
        {
          error: {
            code: 'conflict',
            message: 'That invite has already been approved — revoke the device instead',
          },
        },
        409,
      );
    }
    if (message === 'not_found') {
      return c.json({ error: { code: 'not_found', message: 'Invite not found' } }, 404);
    }
    throw error;
  }
});

v2.post(
  '/households/:householdId/devices',
  zValidator('json', deviceSchema),
  async (c) => {
    const householdId = c.req.param('householdId');
    const body = c.req.valid('json');
    const service = new LocalFirstControlService(c.env);
    try {
      const state = await service.registerDevice({
        householdId,
        userId: userId(c),
        ...body,
      });
      return c.json({ state });
    } catch (error) {
      if (error instanceof PersonalHouseholdViolationError) {
        return personalHouseholdRefusal(c, error);
      }
      if (error instanceof Error && error.message === 'not_a_member') {
        return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
      }
      throw error;
    }
  },
);

v2.delete('/households/:householdId/devices/:deviceId', async (c) => {
  const householdId = c.req.param('householdId');
  const deviceId = c.req.param('deviceId');
  const service = new LocalFirstControlService(c.env);
  try {
    const state = await service.revokeDevice({
      householdId,
      actorUserId: userId(c),
      deviceId,
    });
    return c.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'revoke_failed';
    if (message === 'forbidden') {
      return c.json({ error: { code: 'forbidden', message: 'Owner required' } }, 403);
    }
    if (message === 'device_not_found') {
      return c.json({ error: { code: 'not_found', message: 'Device not found' } }, 404);
    }
    throw error;
  }
});

/**
 * Remove a revoked device from the household's record.
 *
 * A separate path from the DELETE above rather than a flag on it, because the
 * two are different acts with different consequences: that one ends a device's
 * access and rotates the household key, this one only tidies the list of the
 * ones already ended. Sharing a route would put an irreversible deletion one
 * mistyped query parameter away from a revocation.
 *
 * 409 when the device is still active — the caller has to revoke it first, and
 * saying so is more useful than performing a revocation they did not ask for.
 */
v2.delete('/households/:householdId/devices/:deviceId/record', async (c) => {
  const householdId = c.req.param('householdId');
  const deviceId = c.req.param('deviceId');
  const service = new LocalFirstControlService(c.env);
  try {
    const state = await service.forgetDevice({
      householdId,
      actorUserId: userId(c),
      deviceId,
    });
    return c.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'forget_failed';
    if (message === 'forbidden') {
      return c.json({ error: { code: 'forbidden', message: 'Owner required' } }, 403);
    }
    if (message === 'device_not_found') {
      return c.json({ error: { code: 'not_found', message: 'Device not found' } }, 404);
    }
    if (message === 'device_not_revoked') {
      return c.json(
        {
          error: {
            code: 'conflict',
            message: 'That device still has access — revoke it before removing it from the list',
          },
        },
        409,
      );
    }
    throw error;
  }
});

/**
 * Who is in the household, administered by its owner.
 *
 * Until these two existed a household was a one-way door: an owner could let
 * somebody in (invite → approve) and could revoke a DEVICE, but could not end a
 * membership. Revoking devices one at a time did not do it — the membership row
 * stayed `active`, so the person could enrol a fresh device and walk back in.
 * And a role was fixed at the moment the invite was minted, so an owner who
 * lost their phone could not be replaced by anybody else in the household.
 *
 * Both are owner-only, and both are refused on the caller's OWN membership:
 * that is what keeps "a household always has an active owner" true (see
 * `handleUpsertMember`). Leaving a household yourself is a different act, on a
 * different screen.
 */
v2.patch(
  '/households/:householdId/members/:userId',
  zValidator('json', z.object({ role: z.enum(['OWNER', 'ADULT']) })),
  async (c) => {
    const householdId = c.req.param('householdId');
    const memberUserId = c.req.param('userId');
    const { role } = c.req.valid('json');
    const actorUserId = userId(c);
    const service = new LocalFirstControlService(c.env);
    try {
      const state = await service.updateMemberRole({
        householdId,
        actorUserId,
        memberUserId,
        role,
      });
      afterResponse(
        c,
        service.getHouseholdName(householdId).then((householdName) =>
          notifyLocalFirstMemberEvent(c.env, role === 'OWNER' ? 'promoted' : 'demoted', {
            householdId,
            householdName,
            memberUserId,
            actorUserId,
          }),
        ),
      );
      return c.json({ state });
    } catch (error) {
      return memberAdminRefusal(c, error);
    }
  },
);

v2.delete('/households/:householdId/members/:userId', async (c) => {
  const householdId = c.req.param('householdId');
  const memberUserId = c.req.param('userId');
  const actorUserId = userId(c);
  const service = new LocalFirstControlService(c.env);
  try {
    // The name is read BEFORE the removal only in the sense that it is read
    // from the household row, which the removal does not touch — but the
    // notification itself goes out after the response, because a removal must
    // not wait on a push, and must not fail with one.
    const state = await service.removeMember({ householdId, actorUserId, memberUserId });
    afterResponse(
      c,
      service.getHouseholdName(householdId).then((householdName) =>
        notifyLocalFirstMemberEvent(c.env, 'removed', {
          householdId,
          householdName,
          memberUserId,
          actorUserId,
        }),
      ),
    );
    return c.json({ state });
  } catch (error) {
    return memberAdminRefusal(c, error);
  }
});

/**
 * Leave a household.
 *
 * The member-shaped counterpart to the DELETE above, and deliberately its own
 * route rather than "DELETE your own member row": that handler refuses an actor
 * acting on themselves, which is what keeps a household's last owner in place,
 * and the exception belongs somewhere it can be read rather than buried as a
 * special case inside the rule.
 *
 * No notification. `notifyLocalFirstMemberEvent` addresses the person a change was
 * made TO and skips when they are the actor, which is exactly this case — the
 * leaver already knows. The remaining members learn from the roster on their
 * next sync, the same way they learn everything else about the household.
 */
v2.post('/households/:householdId/leave', async (c) => {
  const householdId = c.req.param('householdId');
  const service = new LocalFirstControlService(c.env);
  try {
    const state = await service.leaveHousehold({ householdId, actorUserId: userId(c) });
    return c.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'leave_failed';
    if (message === 'last_owner_cannot_leave') {
      return c.json(
        {
          error: {
            code: 'conflict',
            message:
              'You are the last owner of this household — make someone else an owner before you leave',
          },
        },
        409,
      );
    }
    // A household with no coordinator state was never shared: there is no
    // membership to end, and the caller's local copy is the whole of it. Same
    // answer as "you are already out", because for the client it is the same
    // thing — go ahead and finish cleaning up.
    if (message === 'member_not_found' || message === 'household_not_bootstrapped') {
      return c.json(
        { error: { code: 'not_found', message: 'You are not a member of this household' } },
        404,
      );
    }
    throw error;
  }
});

/**
 * The three ways member administration is refused, in this router's error
 * shape. Shared by both handlers so the codes a client branches on cannot drift
 * between "change their role" and "remove them" — they are the same rules.
 */
function memberAdminRefusal(
  c: { json: (body: unknown, status: 403 | 404 | 409) => Response },
  error: unknown,
): Response {
  const message = error instanceof Error ? error.message : 'member_update_failed';
  if (message === 'forbidden') {
    return c.json({ error: { code: 'forbidden', message: 'Owner required' } }, 403);
  }
  if (message === 'member_not_found') {
    return c.json({ error: { code: 'not_found', message: 'Not a member of this household' } }, 404);
  }
  if (message === 'cannot_change_own_membership') {
    return c.json(
      {
        error: {
          code: 'conflict',
          message: 'You cannot change or remove your own membership',
        },
      },
      409,
    );
  }
  throw error;
}

/**
 * Largest base64 ciphertext a single mailbox deposit may carry (~384 KB raw).
 * Exported so the client can bound a batch before it is rejected.
 */
export const MAILBOX_MAX_CIPHERTEXT_B64 = 512_000;

/**
 * One GET returns at most this many blobs / bytes; the client keeps fetching
 * while `hasMore`. Chunked push turns one deposit into many, and the old
 * count-only LIMIT 100 over 384 KB blobs would have built ~51 MB of base64 in
 * Worker memory for a single response.
 */
export const MAILBOX_FETCH_MAX_BLOBS = 25;
export const MAILBOX_FETCH_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Deposits to the same mailbox inside this window share one wake. A wake
 * carries no content and every blob is returned by the same fetch, so
 * coalescing costs nothing and stops a multi-chunk catch-up fanning out one
 * push notification per chunk.
 */
export const SYNC_WAKE_COALESCE_MS = 10_000;

/**
 * Chunked base64. `String.fromCharCode` per byte over a 384 KB blob is the same
 * `out +=` pathology the client-side encoders were measured at (~56x heap
 * churn), and it now runs once per chunk rather than once per sync.
 * 8190 is a multiple of 3, so only the final chunk ever pads.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8190;
  if (bytes.length <= CHUNK) {
    return btoa(String.fromCharCode(...bytes));
  }
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + CHUNK))));
  }
  return parts.join('');
}

v2.post(
  '/households/:householdId/mailbox',
  zValidator(
    'json',
    z.object({
      recipientDeviceId: z.string().min(1).max(128).nullable().optional(),
      /** Depositor device — excluded from opaque sync wake fan-out. */
      sourceDeviceId: z.string().min(1).max(128).nullable().optional(),
      /**
       * Base64 ciphertext envelope (opaque to the server).
       *
       * The outer bound only stops an unbounded body; the real limit is
       * MAILBOX_MAX_CIPHERTEXT_B64 below, checked separately so an oversized
       * batch gets an explicit 413 instead of a generic validation 400. The
       * client cannot otherwise tell a permanent "your history no longer fits"
       * from a transient bad request, and it retried forever with a batch that
       * only grew.
       */
      ciphertextBase64: z.string().min(1).max(4_000_000),
      /**
       * false on every chunk but the last of a multi-chunk push. Without it a
       * 31-chunk catch-up wakes every peer 31 times.
       */
      wake: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const householdId = c.req.param('householdId');
    const body = c.req.valid('json');
    if (body.ciphertextBase64.length > MAILBOX_MAX_CIPHERTEXT_B64) {
      return c.json(
        {
          error: {
            code: 'payload_too_large',
            message: 'Op batch exceeds the per-blob limit',
            limit: MAILBOX_MAX_CIPHERTEXT_B64,
            actual: body.ciphertextBase64.length,
          },
        },
        413,
      );
    }
    const control = new LocalFirstControlService(c.env);
    try {
      await control.getState(householdId, userId(c));
    } catch (error) {
      if (error instanceof Error && error.message === 'not_a_member') {
        return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
      }
      throw error;
    }

    const mailbox = new LocalFirstMailboxService(c.env);
    if (body.sourceDeviceId) {
      if (!(await mailbox.deviceBelongsToUser(householdId, body.sourceDeviceId, userId(c)))) {
        return c.json(
          { error: { code: 'forbidden', message: 'Device does not belong to this user' } },
          403,
        );
      }
    }

    const binary = decodeCiphertextBase64(body.ciphertextBase64);
    if (!binary) {
      return c.json(
        { error: { code: 'validation_error', message: 'ciphertextBase64 is not valid base64' } },
        400,
      );
    }
    const row = await mailbox.deposit({
      householdId,
      recipientDeviceId: body.recipientDeviceId ?? null,
      ciphertext: binary,
    });

    // Claimed on the wake, not derived from neighbouring blobs: the wake-less
    // chunks of this very push are what a created_at query would have found.
    const shouldWake =
      body.wake !== false &&
      (await mailbox.claimWake(
        householdId,
        body.recipientDeviceId ?? null,
        SYNC_WAKE_COALESCE_MS,
      ));
    if (shouldWake) {
      void enqueueSyncWake(c.env, {
        householdId,
        callerUserId: userId(c),
        sourceDeviceId: body.sourceDeviceId ?? null,
      });
    }

    return c.json(
      {
        blob: {
          blobId: row.id,
          householdId: row.household_id,
          recipientDeviceId: row.recipient_device_id,
          sizeBytes: row.size_bytes,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        },
      },
      201,
    );
  },
);

/**
 * Opaque page cursor: `<created_at>|<id>`.
 *
 * The client must not have to know the ordering, and the pair is what the
 * ordering actually is — a chunked push deposits inside one millisecond, so
 * created_at alone either skips rows or repeats them.
 */
function encodeMailboxCursor(cursor: { createdAt: string; id: string }): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

function decodeMailboxCursor(raw?: string): { createdAt: string; id: string } | undefined {
  if (!raw) return undefined;
  const split = raw.indexOf('|');
  if (split <= 0 || split === raw.length - 1) return undefined;
  return { createdAt: raw.slice(0, split), id: raw.slice(split + 1) };
}

v2.get('/households/:householdId/mailbox', async (c) => {
  const householdId = c.req.param('householdId');
  const deviceId = c.req.query('deviceId');
  if (!deviceId) {
    return c.json({ error: { code: 'validation_error', message: 'deviceId required' } }, 400);
  }
  const control = new LocalFirstControlService(c.env);
  try {
    await control.getState(householdId, userId(c));
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }

  const mailbox = new LocalFirstMailboxService(c.env);
  if (!(await mailbox.deviceBelongsToUser(householdId, deviceId, userId(c)))) {
    return c.json(
      { error: { code: 'forbidden', message: 'Device does not belong to this user' } },
      403,
    );
  }

  // The device just proved it is alive and entitled to read — the one moment
  // per sync cycle where both are established. Stamped after the ownership
  // check so a rejected caller can never mark someone else's device as live,
  // and not awaited so liveness bookkeeping never delays a sync.
  c.executionCtx.waitUntil(control.touchDevice(householdId, deviceId));
  const { rows, hasMore, nextCursor } = await mailbox.listForDevice(householdId, deviceId, {
    maxBlobs: MAILBOX_FETCH_MAX_BLOBS,
    maxTotalBytes: MAILBOX_FETCH_MAX_BYTES,
    after: decodeMailboxCursor(c.req.query('cursor')),
  });
  const blobs = [];
  for (const row of rows) {
    const buf = await mailbox.fetchCiphertext(row.r2_key);
    if (!buf) continue;
    blobs.push({
      blobId: row.id,
      householdId: row.household_id,
      recipientDeviceId: row.recipient_device_id,
      ciphertextBase64: bytesToBase64(new Uint8Array(buf)),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  }
  return c.json({
    blobs,
    hasMore,
    ...(nextCursor ? { cursor: encodeMailboxCursor(nextCursor) } : {}),
  });
});

v2.post(
  '/households/:householdId/mailbox/ack',
  zValidator(
    'json',
    z.object({
      blobIds: z.array(z.string().min(1)).max(100),
      /** Acking device. Only mail addressed to it can be acked. */
      deviceId: z.string().min(1).max(128),
    }),
  ),
  async (c) => {
    const householdId = c.req.param('householdId');
    const body = c.req.valid('json');
    const control = new LocalFirstControlService(c.env);
    try {
      await control.getState(householdId, userId(c));
    } catch (error) {
      if (error instanceof Error && error.message === 'not_a_member') {
        return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
      }
      throw error;
    }
    const mailbox = new LocalFirstMailboxService(c.env);
    // Membership is not enough: without this, any member's device could ack —
    // and so destroy — mail addressed to another member's device, including the
    // wrapped-HDK envelope a joining device is waiting on.
    if (!(await mailbox.deviceBelongsToUser(householdId, body.deviceId, userId(c)))) {
      return c.json(
        { error: { code: 'forbidden', message: 'Device does not belong to this user' } },
        403,
      );
    }
    const acked = await mailbox.ack(body.blobIds, householdId, body.deviceId);
    return c.json({ acked });
  },
);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomShortCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

v2.post(
  '/households/:householdId/invites',
  zValidator(
    'json',
    z.object({
      role: z.enum(['OWNER', 'ADULT']).default('ADULT'),
      ttlHours: z.number().int().min(1).max(168).optional(),
      /**
       * Address the invite is for. Optional, because an owner sharing a QR code
       * across the kitchen table has no address to type — but when it IS set the
       * claim is restricted to that account, which is what makes a leaked link
       * inert. Clients ask for it by default.
       */
      inviteeEmail: z.string().email().max(320).optional(),
    }),
  ),
  async (c) => {
    const householdId = c.req.param('householdId');
    const body = c.req.valid('json');
    const inviteId = crypto.randomUUID();
    const shortCode = randomShortCode();
    const secret = randomSecret();
    const secretHash = await sha256Hex(secret);
    /**
     * One hour, not the day this used to be. The link is a bearer credential in
     * whatever messenger carried it, so its lifetime is the window in which a
     * forwarded or synced copy still opens the household. Enrolment is a
     * live, two-person act — the invitee is normally in the room or on the
     * phone — so an hour is generous for the flow and far tighter than the
     * exposure. Callers can still ask for longer.
     */
    const ttlHours = body.ttlHours ?? 1;
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    const inviteeEmail = body.inviteeEmail?.trim().toLowerCase() ?? null;
    const service = new LocalFirstControlService(c.env);
    try {
      await service.createInvite({
        householdId,
        createdByUserId: userId(c),
        role: body.role,
        inviteId,
        shortCode,
        secretHash,
        expiresAt,
        inviteeEmail,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'create_failed';
      if (message === 'not_a_member' || message === 'forbidden') {
        return c.json({ error: { code: 'forbidden', message: 'Owner required' } }, 403);
      }
      if (message === 'conflict') {
        return c.json({ error: { code: 'conflict', message: 'Invite conflict' } }, 409);
      }
      throw error;
    }

    const base = c.env.APP_URL?.replace(/\/$/, '') ?? '';
    return c.json(
      {
        invite: {
          inviteId,
          shortCode,
          /**
           * Returned once — never stored in plaintext on the server, which is
           * also what lets it be an ingredient of the enrolment SAS this tier
           * therefore cannot compute. See `deriveEnrolmentSas`.
           */
          secret,
          role: body.role,
          expiresAt,
          inviteeEmail,
          universalLink: `${base}/v2/invites/${inviteId}`,
          qrPayload: `symply-budget://lf-invite?id=${inviteId}&secret=${secret}&code=${shortCode}`,
        },
      },
      201,
    );
  },
);

v2.get('/invites/lookup', async (c) => {
  const code = c.req.query('code');
  const id = c.req.query('id');
  const service = new LocalFirstControlService(c.env);
  const row = code
    ? await service.lookupInviteByShortCode(code)
    : id
      ? await service.lookupInviteById(id)
      : null;
  if (!row) {
    return c.json({ error: { code: 'not_found', message: 'Invite not found' } }, 404);
  }
  return c.json({
    invite: {
      inviteId: row.inviteId,
      householdId: row.householdId,
      // The name the invitee is shown before they confirm a join that replaces
      // the budget on their device. Null when the household row is gone.
      householdName: row.householdName,
      status: row.status,
      expiresAt: row.expiresAt,
    },
  });
});

v2.post(
  '/households/:householdId/invites/:inviteId/claim',
  zValidator(
    'json',
    z.object({
      secret: z.string().min(16).max(128),
      deviceId: z.string().min(1).max(128),
      signingPublicKey: z.string().min(32).max(256),
      agreementPublicKey: z.string().min(32).max(256),
    }),
  ),
  async (c) => {
    const householdId = c.req.param('householdId');
    const inviteId = c.req.param('inviteId');
    const body = c.req.valid('json');
    const secretHash = await sha256Hex(body.secret);
    const service = new LocalFirstControlService(c.env);
    try {
      const result = await service.claimInvite({
        householdId,
        inviteId,
        secretHash,
        userId: userId(c),
        deviceId: body.deviceId,
        signingPublicKey: body.signingPublicKey,
        agreementPublicKey: body.agreementPublicKey,
      });
      // Tell the one account that can actually act on this: the invite's
      // creator holds the secret, so only their device can derive the six
      // digits and approve. Read AFTER the claim so the row describes what is
      // now true — and entirely inside `afterResponse`, because the claim has
      // already succeeded by this point and nothing about telling someone may
      // turn that into a failure.
      afterResponse(
        c,
        service
          .getInviteNotificationContext(householdId, inviteId)
          .then((context) =>
            context ? notifyLocalFirstInviteEvent(c.env, 'claimed', context) : undefined,
          ),
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof PersonalHouseholdViolationError) {
        return personalHouseholdRefusal(c, error);
      }
      const message = error instanceof Error ? error.message : 'claim_failed';
      if (message === 'invalid_secret') {
        return c.json({ error: { code: 'forbidden', message: 'Invalid invite secret' } }, 403);
      }
      if (message === 'invitee_mismatch') {
        return c.json(
          {
            error: {
              code: 'forbidden',
              message: 'This invite was issued to a different account',
            },
          },
          403,
        );
      }
      if (message === 'invite_expired') {
        return c.json({ error: { code: 'gone', message: 'Invite expired' } }, 410);
      }
      // Its own code, not the generic `conflict` below: this is the one 409 the
      // invitee can act on, and the client turns it into "ask them for a new
      // one" instead of the useless "invite not claimable".
      if (message === 'invite_expiring') {
        return c.json(
          {
            error: {
              code: 'invite_expiring',
              message: 'Invite is about to expire — ask for a new one',
            },
          },
          409,
        );
      }
      if (message === 'invite_not_active' || message === 'conflict') {
        return c.json({ error: { code: 'conflict', message: 'Invite not claimable' } }, 409);
      }
      if (message === 'not_found') {
        return c.json({ error: { code: 'not_found', message: 'Invite not found' } }, 404);
      }
      throw error;
    }
  },
);

v2.post(
  '/households/:householdId/invites/:inviteId/approve',
  zValidator(
    'json',
    z.object({
      /**
       * The keys the owner's device displayed to the human during the SAS
       * comparison, echoed back so approval cannot land on a claim that changed
       * since. The digits themselves are never sent: they are derived from the
       * invite secret, which this tier does not hold and must not learn.
       */
      confirmedSigningPublicKey: z.string().min(32).max(256),
      confirmedAgreementPublicKey: z.string().min(32).max(256),
    }),
  ),
  async (c) => {
    const householdId = c.req.param('householdId');
    const inviteId = c.req.param('inviteId');
    const body = c.req.valid('json');
    const service = new LocalFirstControlService(c.env);
    try {
      const result = await service.approveInvite({
        householdId,
        inviteId,
        actorUserId: userId(c),
        confirmedSigningPublicKey: body.confirmedSigningPublicKey,
        confirmedAgreementPublicKey: body.confirmedAgreementPublicKey,
      });
      // The wait is over on the OTHER phone, and nothing there would have said
      // so: the household key arrives by mailbox on the next sync, which can be
      // minutes away, and until it lands that screen still reads "Waiting for
      // approval…".
      afterResponse(
        c,
        service
          .getInviteNotificationContext(householdId, inviteId)
          .then((context) =>
            context ? notifyLocalFirstInviteEvent(c.env, 'approved', context) : undefined,
          ),
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof PersonalHouseholdViolationError) {
        return personalHouseholdRefusal(c, error);
      }
      const message = error instanceof Error ? error.message : 'approve_failed';
      if (message === 'forbidden') {
        return c.json({ error: { code: 'forbidden', message: 'Owner required' } }, 403);
      }
      if (
        message === 'invite_not_claimed' ||
        message === 'claim_incomplete' ||
        message === 'claim_changed'
      ) {
        return c.json({ error: { code: 'conflict', message: message } }, 409);
      }
      if (message === 'not_found') {
        return c.json({ error: { code: 'not_found', message: 'Invite not found' } }, 404);
      }
      throw error;
    }
  },
);

v2.post('/push/register', zValidator('json', pushRegisterSchema), async (c) => {
  const body = c.req.valid('json');
  const control = new LocalFirstControlService(c.env);
  try {
    await control.getState(body.householdId, userId(c));
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }

  const wake = new LocalFirstSyncWakeService(c.env);
  try {
    await wake.registerPushToken({
      householdId: body.householdId,
      userId: userId(c),
      deviceId: body.deviceId,
      token: body.token,
      platform: body.platform,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'register_failed';
    if (message === 'device_not_found') {
      return c.json({ error: { code: 'not_found', message: 'Device not enrolled' } }, 404);
    }
    throw error;
  }

  return c.json({ registered: true }, 201);
});

v2.post('/households/:householdId/sync-wake', async (c) => {
  const householdId = c.req.param('householdId');
  const control = new LocalFirstControlService(c.env);
  try {
    await control.getState(householdId, userId(c));
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }

  // `sourceDeviceId` is optional on the wire but REQUIRED for a brand that
  // excludes by device only (Health). Without it `enqueueSyncWake` refuses to
  // emit rather than waking the caller — see the helper's note. Not validated
  // against the caller: the peer query is already household-scoped, so a wrong
  // device id can only ever exclude one more device from a wake in a household
  // the caller has already been authorized for.
  const body: { sourceDeviceId?: string | null } = await c.req
    .json<{ sourceDeviceId?: string | null }>()
    .catch(() => ({}) as { sourceDeviceId?: string | null });

  const policy = resolveSyncWakePolicy(c.env);
  if (requiresSourceDeviceId(policy) && !body.sourceDeviceId) {
    return c.json(
      {
        error: {
          code: 'source_device_required',
          message: 'sourceDeviceId is required for this brand',
        },
      },
      400,
    );
  }

  const wake = new LocalFirstSyncWakeService(c.env);
  const result = await wake.sendSyncWake(
    buildSyncWakeRequest(c.env, {
      householdId,
      callerUserId: userId(c),
      sourceDeviceId: body.sourceDeviceId ?? null,
    }),
  );
  return c.json({ wake: result });
});

const checkpointManifestSchema = z.object({
  v: z.literal(1),
  householdId: z.string().min(1).max(128),
  generation: z.number().int().positive(),
  versionVector: z.record(z.string(), z.number()),
  chunkCount: z.number().int().positive().max(10_000),
  rootHash: z.string().min(16).max(128),
  signerDeviceId: z.string().min(1).max(128),
  signatureB64: z.string().min(16).max(512),
});

v2.put(
  '/households/:householdId/checkpoints',
  zValidator(
    'json',
    z.object({
      generation: z.number().int().positive(),
      chunkIndex: z.number().int().min(0).max(10_000),
      chunkCount: z.number().int().positive().max(10_000),
      ciphertextBase64: z.string().min(1).max(4_000_000),
      manifest: checkpointManifestSchema.optional(),
    }),
  ),
  async (c) => {
    const householdId = c.req.param('householdId');
    const body = c.req.valid('json');
    if (body.ciphertextBase64.length > MAILBOX_MAX_CIPHERTEXT_B64) {
      return c.json(
        {
          error: {
            code: 'payload_too_large',
            message: 'Checkpoint chunk exceeds the per-blob limit',
            limit: MAILBOX_MAX_CIPHERTEXT_B64,
            actual: body.ciphertextBase64.length,
          },
        },
        413,
      );
    }
    if (body.chunkIndex >= body.chunkCount) {
      return c.json({ error: { code: 'validation_error', message: 'chunkIndex out of range' } }, 400);
    }
    const control = new LocalFirstControlService(c.env);
    const manifest = body.manifest;
    if (manifest && (manifest.householdId !== householdId || manifest.generation !== body.generation ||
        manifest.chunkCount !== body.chunkCount)) {
      return c.json({ error: { code: 'validation_error', message: 'manifest mismatch' } }, 400);
    }
    try {
      if (manifest) {
        const state = await control.getState(householdId, userId(c));
        if (!await verifyCheckpointPublisher(state, userId(c), manifest)) {
          return c.json({ error: { code: 'forbidden', message: 'Invalid checkpoint publisher' } }, 403);
        }
      } else {
        // Older clients send the manifest only on the last chunk.
        await control.assertOwner(householdId, userId(c));
      }
    } catch (error) {
      if (error instanceof Error && ['not_owner', 'not_a_member'].includes(error.message)) {
        return c.json({ error: { code: 'forbidden', message: 'Not an authorized publisher' } }, 403);
      }
      throw error;
    }
    const binary = decodeCiphertextBase64(body.ciphertextBase64);
    if (!binary) {
      return c.json(
        { error: { code: 'validation_error', message: 'ciphertextBase64 is not valid base64' } },
        400,
      );
    }
    const checkpoints = new LocalFirstCheckpointService(c.env);
    if (manifest && !await checkpoints.reserveManifest({
      householdId, generation: body.generation, chunkCount: manifest.chunkCount,
      versionVector: JSON.stringify(manifest.versionVector), rootHash: manifest.rootHash,
      signerDeviceId: manifest.signerDeviceId, signatureB64: manifest.signatureB64,
    })) {
      return c.json({ error: { code: 'conflict', message: 'Checkpoint generation already reserved' } }, 409);
    }
    await checkpoints.putChunk({
      householdId,
      generation: body.generation,
      chunkIndex: body.chunkIndex,
      chunkCount: body.chunkCount,
      ciphertext: binary,
    });
    if (body.manifest && body.chunkIndex === body.chunkCount - 1) {
      if (body.manifest.householdId !== householdId || body.manifest.generation !== body.generation) {
        return c.json({ error: { code: 'validation_error', message: 'manifest mismatch' } }, 400);
      }
      await checkpoints.putManifest({
        householdId,
        generation: body.generation,
        chunkCount: body.manifest.chunkCount,
        versionVector: JSON.stringify(body.manifest.versionVector),
        rootHash: body.manifest.rootHash,
        signerDeviceId: body.manifest.signerDeviceId,
        signatureB64: body.manifest.signatureB64,
      });
    }
    return c.json({ ok: true }, 201);
  },
);

v2.get('/households/:householdId/checkpoints/latest', async (c) => {
  const householdId = c.req.param('householdId');
  const control = new LocalFirstControlService(c.env);
  try {
    await control.getState(householdId, userId(c));
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }
  const latest = await new LocalFirstCheckpointService(c.env).latestComplete(householdId);
  if (!latest) {
    return c.json({ error: { code: 'not_found', message: 'No checkpoint' } }, 404);
  }
  const manifest = latest.manifest;
  return c.json({
    generation: latest.generation,
    chunkCount: manifest.chunk_count,
    expiresAt: manifest.expires_at,
    manifest: {
      v: 1,
      householdId: manifest.household_id,
      generation: manifest.generation,
      versionVector: JSON.parse(manifest.version_vector) as Record<string, number>,
      chunkCount: manifest.chunk_count,
      rootHash: manifest.root_hash,
      signerDeviceId: manifest.signer_device_id,
      signatureB64: manifest.signature_b64,
    },
  });
});

v2.get('/households/:householdId/checkpoints/latest/chunks/:index', async (c) => {
  const householdId = c.req.param('householdId');
  const index = Number(c.req.param('index'));
  if (!Number.isInteger(index) || index < 0) {
    return c.json({ error: { code: 'validation_error', message: 'index required' } }, 400);
  }
  const control = new LocalFirstControlService(c.env);
  try {
    await control.getState(householdId, userId(c));
  } catch (error) {
    if (error instanceof Error && error.message === 'not_a_member') {
      return c.json({ error: { code: 'forbidden', message: 'Not a member' } }, 403);
    }
    throw error;
  }
  const requestedGeneration = c.req.query('generation');
  const generation = requestedGeneration == null ? undefined : Number(requestedGeneration);
  if (generation != null && (!Number.isSafeInteger(generation) || generation < 1)) {
    return c.json({ error: { code: 'validation_error', message: 'Invalid generation' } }, 400);
  }
  const checkpoints = new LocalFirstCheckpointService(c.env);
  const latest = await checkpoints.latestComplete(householdId, generation);
  if (!latest) {
    return c.json({ error: { code: 'not_found', message: 'No checkpoint' } }, 404);
  }
  const chunk = await checkpoints.getChunk(householdId, latest.generation, index);
  if (!chunk) {
    return c.json({ error: { code: 'not_found', message: 'Chunk missing' } }, 404);
  }
  return c.json({
    generation: latest.generation,
    chunkIndex: index,
    ciphertextBase64: bytesToBase64(new Uint8Array(chunk.bytes)),
  });
});

/**
 * H6 encrypted blob channel. Mounted here rather than on the app so it inherits
 * this router's `requireLocalFirstApi()` + `authMiddleware()` — see the header
 * comment in `local-first-blobs.ts`.
 */
v2.route('/', localFirstBlobRoutes);

/**
 * TURN credentials for WebRTC.
 * Returns not_configured until Cloudflare Realtime TURN secrets are provisioned.
 */
v2.post('/turn', async (c) => {
  const turnKeyId = c.env.CF_REALTIME_TURN_KEY_ID;
  const turnApiToken = c.env.CF_REALTIME_TURN_API_TOKEN;
  if (!turnKeyId || !turnApiToken) {
    return c.json({
      status: 'not_configured',
      iceServers: [] as Array<{ urls: string[]; username?: string; credential?: string }>,
      ttlSeconds: 0,
    });
  }

  // Placeholder for Cloudflare Calls/Realtime TURN credential minting.
  // When secrets are present, wire the official credential endpoint here.
  return c.json({
    status: 'not_configured',
    iceServers: [],
    ttlSeconds: 0,
    message: 'TURN key present but credential minting not wired yet',
  });
});

/* ── Household AI key sharing ──────────────────────────────────────────────
 *
 * A member offers their own BYOK provider key to the household. The Worker is
 * a relay for a sealed envelope it cannot open (see ai-key-share-service.ts);
 * these handlers do authorization, shape validation and the fan-out notice.
 *
 * Errors are answered inline in this router's `{ error: { code, message } }`
 * shape rather than thrown, because `/v2` is also mounted bare in unit tests
 * where `app.onError` is not in the chain.
 */

/** Map a service error onto this router's response shape. */
function aiKeyShareFailure(
  c: { json: (body: unknown, status: 400 | 403 | 404) => Response },
  error: unknown,
): Response | null {
  if (error instanceof ForbiddenError) {
    return c.json({ error: { code: 'forbidden', message: error.message } }, 403);
  }
  if (error instanceof NotFoundError) {
    return c.json({ error: { code: 'not_found', message: error.message } }, 404);
  }
  if (error instanceof ValidationError) {
    // `validation_error`, not a one-off `invalid`: the client's
    // `getApiErrorMessage` only surfaces a Worker message for codes it knows,
    // and every other route in the fleet already speaks this one. Under the old
    // code these messages ("Sealed under a stale key epoch…") were silently
    // replaced by the caller's generic fallback.
    return c.json({ error: { code: 'validation_error', message: error.message } }, 400);
  }
  return null;
}

v2.get('/households/:householdId/ai-key-shares', async (c) => {
  const service = new AiKeyShareService(c.env);
  try {
    const shares = await service.listShares(c.req.param('householdId'), userId(c));
    const keyEpoch = await service.currentKeyEpoch(c.req.param('householdId'));
    // The epoch is returned with the list so a sharing device seals under the
    // current one without a second round trip.
    return c.json({ shares, keyEpoch });
  } catch (error) {
    const handled = aiKeyShareFailure(c, error);
    if (handled) return handled;
    throw error;
  }
});

const aiKeyShareUpsertSchema = z.object({
  /** base64(nonce || ciphertext || tag), sealed on this device under the HDK. */
  ciphertext: z.string().min(16).max(4096),
  keyEpoch: z.number().int().positive(),
  envelopeVersion: z.string().min(1).max(16),
  /** Last four characters of the key — never more. */
  keyHint: z.string().max(4),
});

v2.put(
  '/households/:householdId/ai-key-shares/:provider',
  zValidator('json', aiKeyShareUpsertSchema),
  async (c) => {
    const householdId = c.req.param('householdId');
    const actorUserId = userId(c);
    const body = c.req.valid('json');
    const service = new AiKeyShareService(c.env);

    try {
      const result = await service.upsertShare({
        householdId,
        userId: actorUserId,
        provider: c.req.param('provider'),
        ciphertext: body.ciphertext,
        keyEpoch: body.keyEpoch,
        envelopeVersion: body.envelopeVersion,
        keyHint: body.keyHint,
      });

      // Telling the household is the point of the feature, but it must not be
      // able to fail the share — and an un-awaited promise is cancelled the
      // moment this handler returns.
      afterResponse(
        c,
        (async () => {
          const [members, owner] = await Promise.all([
            service.memberUserIds(householdId, actorUserId),
            c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`)
              .bind(actorUserId)
              .first<{ display_name: string | null }>(),
          ]);
          if (members.length === 0) return;
          await notifyAiKeyShared(c.env, {
            householdId,
            ownerUserId: actorUserId,
            ownerName: owner?.display_name ?? null,
            provider: result.provider,
            memberUserIds: members,
          });
        })(),
      );

      return c.json({ share: result }, 200);
    } catch (error) {
      const handled = aiKeyShareFailure(c, error);
      if (handled) return handled;
      throw error;
    }
  },
);

const aiKeyShareConsentSchema = z.object({
  consentVersion: z.string().min(1).max(64),
});

v2.post(
  '/households/:householdId/ai-key-shares/:shareId/consent',
  zValidator('json', aiKeyShareConsentSchema),
  async (c) => {
    const service = new AiKeyShareService(c.env);
    try {
      const result = await service.recordConsent({
        householdId: c.req.param('householdId'),
        userId: userId(c),
        shareId: c.req.param('shareId'),
        consentVersion: c.req.valid('json').consentVersion,
      });
      return c.json(result);
    } catch (error) {
      const handled = aiKeyShareFailure(c, error);
      if (handled) return handled;
      throw error;
    }
  },
);

/**
 * Hand back the sealed envelope so the caller's device can open it in memory.
 *
 * POST rather than GET: it stamps usage and is a deliberate act, not a cacheable
 * read. The response is ciphertext — the plaintext key never transits the Worker.
 */
v2.post('/households/:householdId/ai-key-shares/:shareId/envelope', async (c) => {
  const service = new AiKeyShareService(c.env);
  try {
    const envelope = await service.readShareEnvelope({
      householdId: c.req.param('householdId'),
      userId: userId(c),
      shareId: c.req.param('shareId'),
    });
    return c.json({ envelope });
  } catch (error) {
    const handled = aiKeyShareFailure(c, error);
    if (handled) return handled;
    throw error;
  }
});

v2.delete('/households/:householdId/ai-key-shares/:provider', async (c) => {
  const householdId = c.req.param('householdId');
  const actorUserId = userId(c);
  const service = new AiKeyShareService(c.env);
  try {
    const result = await service.revokeShare({
      householdId,
      userId: actorUserId,
      provider: c.req.param('provider'),
    });

    // Only the members who had accepted the key are told. Their AI is about to
    // stop working, and "you need your own key now" is a far better experience
    // than discovering it as an unexplained failure on the next receipt scan.
    if (result.notify.length > 0) {
      afterResponse(
        c,
        (async () => {
          const owner = await c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`)
            .bind(actorUserId)
            .first<{ display_name: string | null }>();
          await notifyAiKeyShared(c.env, {
            householdId,
            ownerUserId: actorUserId,
            ownerName: owner?.display_name ?? null,
            provider: result.provider,
            memberUserIds: result.notify,
            event: 'revoked',
          });
        })(),
      );
    }

    return c.json({ ok: result.ok, provider: result.provider });
  } catch (error) {
    const handled = aiKeyShareFailure(c, error);
    if (handled) return handled;
    throw error;
  }
});

export default v2;
