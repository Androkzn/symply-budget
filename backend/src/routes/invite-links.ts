import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { AuthService } from '../services/auth-service';
import { HouseholdService } from '../services/household-service';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';
import { inviteLinkTokenSchema } from '../utils/validation';

const inviteLinks = new Hono<{ Bindings: Env }>();

/**
 * POST /invite-links/validate - Inspect a shareable invite link.
 * Returns the household summary so the Join screen can render it before the
 * user commits. Auth required (the requester must be a signed-in user).
 */
inviteLinks.post(
  '/validate',
  authMiddleware(),
  zValidator('json', inviteLinkTokenSchema),
  async (c) => {
    const userId = c.get('userId');
    const { token } = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);

    const result = await householdService.validateInviteLink(token, userId);
    return c.json(result);
  }
);

/**
 * POST /invite-links/request - Submit a "request to join" against a link.
 * Notifies the household's owners, who approve or deny from the members screen.
 */
inviteLinks.post(
  '/request',
  authMiddleware(),
  zValidator('json', inviteLinkTokenSchema),
  async (c) => {
    const userId = c.get('userId');
    const { token } = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);
    const authService = new AuthService(c.env, c.env.DB);
    const notificationService = new NotificationService(c.env, c.env.DB);

    const result = await householdService.requestToJoin(token, userId);

    if (result.status === 'pending' && result.created && result.ownerUserIds.length > 0) {
      const requester = await authService.getUserById(userId);
      const requesterName = requester?.display_name || requester?.email || 'Someone';

      const sends = result.ownerUserIds.map((ownerId) =>
        notificationService
          .sendNotification({
            userId: ownerId,
            type: 'household_update',
            title: 'New Join Request',
            body: `${requesterName} wants to join "${result.household.name}"`,
            data: {
              screen: 'HouseholdMembers',
              householdId: result.household.id,
              householdName: result.household.name,
              updateType: 'join_request_received',
              requestId: result.request_id ?? '',
            },
            referenceType: 'household_join_request',
            referenceId: result.request_id,
          })
          .catch((err) => console.error('Join-request owner notify failed:', err))
      );
      // Keep the notifications alive past the response: on Workers, un-awaited
      // promises are cancelled once we return, which previously dropped the
      // owner's push + in-app notification entirely.
      c.executionCtx.waitUntil(Promise.all(sends));
    }

    return c.json(result);
  }
);

/**
 * GET /invite-links/owner-pending - Pending join requests for households the user owns.
 */
inviteLinks.get('/owner-pending', authMiddleware(), async (c) => {
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const requests = await householdService.getOwnerPendingJoinRequests(userId);
  return c.json({ requests });
});

/**
 * GET /invite-links/my-requests - List the current user's own pending join
 * requests (with household names) so the app can show a "request pending"
 * state while they wait for an owner to approve.
 */
inviteLinks.get('/my-requests', authMiddleware(), async (c) => {
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const requests = await householdService.getMyPendingJoinRequests(userId);
  return c.json({ requests });
});

export default inviteLinks;
