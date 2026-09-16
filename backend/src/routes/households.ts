import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { AuthService } from '../services/auth-service';
import { EmailService } from '../services/email-service';
import { HouseholdService } from '../services/household-service';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';
import { generateId } from '../utils/id';
import {
  createHouseholdSchema,
  updateHouseholdSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  createInviteLinkSchema,
} from '../utils/validation';

const households = new Hono<{ Bindings: Env }>();

// All household routes require authentication
households.use('/*', authMiddleware());

/**
 * GET /households - Get all households for current user
 */
households.get('/', async (c) => {
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const householdList = await householdService.getUserHouseholds(userId);

  return c.json({ households: householdList });
});

/**
 * POST /households - Create a new household
 */
households.post('/', zValidator('json', createHouseholdSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.req.valid('json');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const household = await householdService.createHousehold(userId, input);

  return c.json({ household }, 201);
});

/**
 * GET /households/:id - Get household by ID
 */
households.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const household = await householdService.getHousehold(householdId, userId);
  const members = await householdService.getMembers(householdId, userId);

  return c.json({ household, members });
});

/**
 * PATCH /households/:id - Update household
 */
households.patch('/:id', zValidator('json', updateHouseholdSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const input = c.req.valid('json');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const household = await householdService.updateHousehold(householdId, userId, input);

  return c.json({ household });
});

/**
 * DELETE /households/:id - Delete household
 */
households.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  await householdService.deleteHousehold(householdId, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:id/leave - Leave a household (any member).
 */
households.post('/:id/leave', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const { householdName, ownerUserIds, leaverName } = await householdService.leaveHousehold(
    householdId,
    userId
  );

  // Notify the remaining owner(s) that a member has left.
  if (ownerUserIds.length > 0) {
    const notificationService = new NotificationService(c.env, c.env.DB);
    const sends = ownerUserIds.map((ownerId) =>
      notificationService
        .sendNotification({
          userId: ownerId,
          type: 'household_update',
          title: 'Member Left',
          body: `${leaverName} left "${householdName}"`,
          data: {
            screen: 'HouseholdMembers',
            householdId,
            householdName,
            updateType: 'member_left',
          },
          referenceType: 'household_member',
          referenceId: userId,
        })
        .catch((err) => console.error('Member-left owner notify failed:', err))
    );
    // Un-awaited promises are cancelled once we return on Workers; keep them
    // alive so the owner's push + in-app notification actually send.
    c.executionCtx.waitUntil(Promise.all(sends));
  }

  return c.body(null, 204);
});

/**
 * GET /households/:id/user-search?q= - Search app users to invite (owners).
 * Returns a minimal public profile, excluding current members.
 */
households.get('/:id/user-search', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const query = c.req.query('q') ?? '';
  const householdService = new HouseholdService(c.env, c.env.DB);

  const users = await householdService.searchInvitableUsers(householdId, userId, query);

  return c.json({ users });
});

/**
 * POST /households/:id/invite - Invite a member
 */
households.post('/:id/invite', zValidator('json', inviteMemberSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const input = c.req.valid('json');
  const householdService = new HouseholdService(c.env, c.env.DB);
  const emailService = new EmailService(c.env);
  const authService = new AuthService(c.env, c.env.DB);
  const notificationService = new NotificationService(c.env, c.env.DB);

  const { token, invitation_id } = await householdService.inviteMember(householdId, userId, input);

  // Get household and inviter info for email
  const household = await householdService.getHousehold(householdId, userId);
  const inviter = await authService.getUserById(userId);
  const inviterName = inviter?.display_name || inviter?.email || 'A household member';

  // Send invitation email. waitUntil keeps it alive past the response — on
  // Workers an un-awaited promise is cancelled once we return.
  c.executionCtx.waitUntil(
    emailService
      .sendHouseholdInvitation(input.email, token, household.name, inviterName)
      .catch(console.error)
  );

  // Send push notification to invitee if they're an existing user
  const invitee = await authService.getUserByEmail(input.email);
  if (invitee) {
    c.executionCtx.waitUntil(
      notificationService
        .sendNotification({
          userId: invitee.id,
          type: 'household_update',
          title: 'Household Invitation',
          body: `${inviterName} invited you to join "${household.name}"`,
          data: {
            screen: 'AcceptInvite',
            householdId,
            householdName: household.name,
            invitationType: 'invitation_received',
            invitationId: invitation_id,
          },
          referenceType: 'household_invitation',
          referenceId: invitation_id,
        })
        .catch(console.error)
    );
  }

  return c.json(
    {
      invitation: {
        id: invitation_id,
        email: input.email,
        role: input.role,
      },
    },
    201
  );
});

/**
 * GET /households/:id/invitations - Get pending invitations
 */
households.get('/:id/invitations', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const invitations = await householdService.getInvitations(householdId, userId);

  return c.json({ invitations });
});

/**
 * DELETE /households/:id/invitations/:invitationId - Cancel invitation
 */
households.delete('/:id/invitations/:invitationId', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const invitationId = c.req.param('invitationId');
  const householdService = new HouseholdService(c.env, c.env.DB);

  await householdService.cancelInvitation(householdId, invitationId, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:id/invite-link - Create a shareable invite link.
 * Returns a ready-to-share URL the client hands to the OS share sheet.
 */
households.post('/:id/invite-link', zValidator('json', createInviteLinkSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const input = c.req.valid('json');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const { token, short_code, link_id, expires_at, role } = await householdService.createInviteLink(
    householdId,
    userId,
    input
  );

  const url = `${c.env.APP_URL}/join/${token}`;
  const short_url = `${c.env.APP_URL}/j/${short_code}`;

  return c.json(
    {
      invite_link: {
        id: link_id,
        url,
        short_url,
        token,
        short_code,
        role,
        expires_at,
      },
    },
    201
  );
});

/**
 * GET /households/:id/join-requests - List pending join requests (owners only)
 */
households.get('/:id/join-requests', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  const requests = await householdService.getJoinRequests(householdId, userId);

  return c.json({ requests });
});

/**
 * POST /households/:id/join-requests/:requestId/approve - Approve a request
 */
households.post('/:id/join-requests/:requestId/approve', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const requestId = c.req.param('requestId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  const notificationService = new NotificationService(c.env, c.env.DB);

  const { household, member_user_id, requester_name } = await householdService.approveJoinRequest(
    householdId,
    requestId,
    userId
  );

  await notificationService.deleteJoinRequestReceivedNotifications(requestId);

  // Notify the approved user that they're now in.
  c.executionCtx.waitUntil(
    notificationService
      .sendNotification({
        userId: member_user_id,
        type: 'household_update',
        title: 'Request Approved',
        body: `You've joined "${household.name}"`,
        data: {
          screen: 'HouseholdMembers',
          householdId: household.id,
          householdName: household.name,
          updateType: 'join_request_approved',
        },
        referenceType: 'household',
        referenceId: household.id,
      })
      .catch(console.error)
  );

  // Notify the other owners that the member list changed.
  const members = await householdService.getMembers(householdId, userId);
  for (const member of members) {
    if (
      member.user_id !== userId &&
      member.user_id !== member_user_id &&
      member.role === 'owner'
    ) {
      c.executionCtx.waitUntil(
        notificationService
          .sendNotification({
            userId: member.user_id,
            type: 'household_update',
            title: 'New Household Member',
            body: `${requester_name} has joined "${household.name}"`,
            data: {
              screen: 'HouseholdMembers',
              householdId: household.id,
              householdName: household.name,
              updateType: 'invitation_accepted',
            },
            referenceType: 'household',
            referenceId: household.id,
          })
          .catch(console.error)
      );
    }
  }

  return c.json({ household });
});

/**
 * POST /households/:id/join-requests/:requestId/deny - Deny a request
 */
households.post('/:id/join-requests/:requestId/deny', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const requestId = c.req.param('requestId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  const notificationService = new NotificationService(c.env, c.env.DB);

  const { requester_user_id, household_name } = await householdService.denyJoinRequest(
    householdId,
    requestId,
    userId
  );

  await notificationService.deleteJoinRequestReceivedNotifications(requestId);

  c.executionCtx.waitUntil(
    notificationService
      .sendNotification({
        userId: requester_user_id,
        type: 'household_update',
        title: 'Join Request Declined',
        body: `Your request to join "${household_name}" was declined`,
        data: {
          screen: 'JoinHousehold',
          householdId,
          householdName: household_name,
          updateType: 'join_request_denied',
          requestId,
        },
        referenceType: 'household_join_request',
        referenceId: requestId,
      })
      .catch(console.error)
  );

  return c.body(null, 204);
});

/**
 * DELETE /households/:id/members/:userId - Remove member
 */
households.delete('/:id/members/:memberId', async (c) => {
  const requestingUserId = c.get('userId');
  const householdId = c.req.param('id');
  const memberUserId = c.req.param('memberId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  const notificationService = new NotificationService(c.env, c.env.DB);

  // Get household info before removing member
  const household = await householdService.getHousehold(householdId, requestingUserId);

  await householdService.removeMember(householdId, memberUserId, requestingUserId);

  // Notify the removed member (unless they removed themselves)
  if (memberUserId !== requestingUserId) {
    c.executionCtx.waitUntil(
      notificationService
        .sendNotification({
          userId: memberUserId,
          type: 'household_update',
          title: 'Removed from Household',
          body: `You have been removed from "${household.name}"`,
          data: {
            screen: 'Households',
            householdId,
            householdName: household.name,
            updateType: 'member_removed',
          },
          referenceType: 'household',
          referenceId: householdId,
        })
        .catch(console.error)
    );
  }

  // Notify other household members about the change
  const members = await householdService.getMembers(householdId, requestingUserId);
  for (const member of members) {
    if (member.user_id !== requestingUserId) {
      c.executionCtx.waitUntil(
        notificationService
          .sendNotification({
            userId: member.user_id,
            type: 'household_update',
            title: 'Household Member Removed',
            body: `A member has been removed from "${household.name}"`,
            data: {
              screen: 'HouseholdMembers',
              householdId,
              householdName: household.name,
              updateType: 'member_list_changed',
            },
            referenceType: 'household',
            referenceId: householdId,
          })
          .catch(console.error)
      );
    }
  }

  return c.body(null, 204);
});

/**
 * PATCH /households/:id/members/:userId - Update member role
 */
households.patch(
  '/:id/members/:memberId',
  zValidator('json', updateMemberRoleSchema),
  async (c) => {
    const requestingUserId = c.get('userId');
    const householdId = c.req.param('id');
    const memberUserId = c.req.param('memberId');
    const { role } = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);

    const member = await householdService.updateMemberRole(
      householdId,
      memberUserId,
      requestingUserId,
      role
    );

    return c.json({ member });
  }
);

// Schema for photo upload URL request
const photoUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().regex(/^image\/(jpeg|jpg|png|gif|webp)$/i, 'Invalid image type'),
});

/**
 * POST /households/:id/photo/upload-url - Get presigned upload URL for household photo
 */
households.post(
  '/:id/photo/upload-url',
  zValidator('json', photoUploadUrlSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = c.req.param('id');
    const { filename } = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);

    // Verify user has access to this household
    await householdService.getHousehold(householdId, userId);

    // Generate unique image key
    const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const imageId = generateId();
    const imageKey = `${householdId}/${imageId}.${ext}`;
    const r2Key = `household-photos/${imageKey}`;

    // For Cloudflare R2, we'll use direct upload
    // Return the key and let client upload directly
    return c.json({
      upload_url: null, // R2 doesn't support presigned URLs the same way, we use PUT endpoint
      image_key: imageKey,
      r2_key: r2Key,
    });
  }
);

/**
 * PUT /households/:id/photo - Upload household photo directly
 */
households.put('/:id/photo', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  // Verify user has access to this household
  await householdService.getHousehold(householdId, userId);

  // Get the image from request body
  const contentType = c.req.header('Content-Type') || 'image/jpeg';
  
  // Validate content type
  if (!contentType.match(/^image\/(jpeg|jpg|png|gif|webp)$/i)) {
    return c.json({ error: { code: 'invalid_type', message: 'Invalid image type' } }, 400);
  }

  const body = await c.req.arrayBuffer();
  
  // Validate size (max 10MB)
  if (body.byteLength > 10 * 1024 * 1024) {
    return c.json({ error: { code: 'too_large', message: 'Image must be less than 10MB' } }, 400);
  }

  // Generate unique image key
  const ext = contentType.split('/')[1] || 'jpg';
  const imageId = generateId();
  const imageKey = `${householdId}/${imageId}.${ext}`;
  const r2Key = `household-photos/${imageKey}`;

  // Upload to R2
  await c.env.REPORTS_BUCKET.put(r2Key, body, {
    httpMetadata: {
      contentType: contentType,
    },
  });

  // Update household with new photo key
  await householdService.updateHousehold(householdId, userId, { photo_key: imageKey });

  return c.json({
    success: true,
    image_key: imageKey,
  });
});

/**
 * DELETE /households/:id/photo - Delete household photo
 */
households.delete('/:id/photo', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('id');
  const householdService = new HouseholdService(c.env, c.env.DB);

  // Get household to find current photo key
  const household = await householdService.getHousehold(householdId, userId);
  
  if ((household as any).photo_key) {
    // Delete from R2
    const r2Key = `household-photos/${(household as any).photo_key}`;
    await c.env.REPORTS_BUCKET.delete(r2Key);
  }

  // Clear photo key in database
  await householdService.updateHousehold(householdId, userId, { photo_key: null });

  return c.json({ success: true });
});

/**
 * Household photo image proxy
 * GET /api/household-photos/:householdId/:imageId - Serve household photo from R2
 */
const householdPhotoProxy = new Hono<{ Bindings: Env }>();
householdPhotoProxy.get('/household-photos/:householdId/:imageId', async (c) => {
  const householdId = c.req.param('householdId');
  const imageId = c.req.param('imageId');
  const imageKey = `${householdId}/${imageId}`;

  try {
    const object = await c.env.REPORTS_BUCKET.get(`household-photos/${imageKey}`);

    if (!object) {
      return c.json({ error: { code: 'not_found', message: 'Image not found' } }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.httpEtag);

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error serving household photo:', error);
    return c.json({ error: { code: 'internal_error', message: 'Failed to load image' } }, 500);
  }
});

export default households;
export { householdPhotoProxy };
