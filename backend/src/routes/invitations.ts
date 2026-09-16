import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { AuthService } from '../services/auth-service';
import { HouseholdService } from '../services/household-service';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';
import { acceptInvitationSchema } from '../utils/validation';

const invitations = new Hono<{ Bindings: Env }>();

/**
 * POST /invitations/validate - Validate an invitation token
 */
invitations.post(
  '/validate',
  authMiddleware(),
  zValidator('json', acceptInvitationSchema),
  async (c) => {
    const userId = c.get('userId');
    const { token } = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);

    const result = await householdService.validateInvitation(token, userId);

    return c.json(result);
  }
);

/**
 * POST /invitations/accept - Accept a household invitation
 */
invitations.post(
  '/accept',
  authMiddleware(),
  zValidator('json', acceptInvitationSchema),
  async (c) => {
    const userId = c.get('userId');
    const userEmail = c.get('userEmail'); // Email from JWT claims
    const { token } = c.req.valid('json');
    const householdService = new HouseholdService(c.env, c.env.DB);
    const authService = new AuthService(c.env, c.env.DB);
    const notificationService = new NotificationService(c.env, c.env.DB);

    // Get user's email if not in JWT (fallback)
    let email = userEmail;
    if (!email) {
      const user = await authService.getUserById(userId);
      email = user?.email || '';
    }

    const household = await householdService.acceptInvitation(token, userId, email);

    // Get the new member's info for the notification
    const newMember = await authService.getUserById(userId);
    const newMemberName = newMember?.display_name || newMember?.email || 'A new member';

    // Notify all household owners that a new member has joined
    const members = await householdService.getMembers(household.id, userId);
    for (const member of members) {
      // Don't notify the new member themselves
      if (member.user_id !== userId && member.role === 'owner') {
        c.executionCtx.waitUntil(
          notificationService
            .sendNotification({
              userId: member.user_id,
              type: 'household_update',
              title: 'New Household Member',
              body: `${newMemberName} has joined "${household.name}"`,
              data: {
                screen: 'HouseholdMembers',
                householdId: household.id,
                householdName: household.name,
                updateType: 'invitation_accepted',
                newMemberId: userId,
              },
              referenceType: 'household',
              referenceId: household.id,
            })
            .catch(console.error)
        );
      }
    }

    return c.json({ household });
  }
);

/**
 * POST /invitations/:invitationId/accept-in-app - Accept an invitation by id
 * (no emailed token). For existing users who tap the in-app invite
 * notification. Email-matching is still enforced server-side.
 */
invitations.post('/:invitationId/accept-in-app', authMiddleware(), async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const invitationId = c.req.param('invitationId');
  if (!invitationId) {
    return c.json({ error: 'Invitation id required' }, 400);
  }
  const householdService = new HouseholdService(c.env, c.env.DB);
  const authService = new AuthService(c.env, c.env.DB);
  const notificationService = new NotificationService(c.env, c.env.DB);

  let email = userEmail;
  if (!email) {
    const user = await authService.getUserById(userId);
    email = user?.email || '';
  }

  const household = await householdService.acceptInvitationById(invitationId, userId, email);

  // Notify owners that a new member joined (mirrors the token-accept flow).
  const newMember = await authService.getUserById(userId);
  const newMemberName = newMember?.display_name || newMember?.email || 'A new member';
  const members = await householdService.getMembers(household.id, userId);
  for (const member of members) {
    if (member.user_id !== userId && member.role === 'owner') {
      c.executionCtx.waitUntil(
        notificationService
          .sendNotification({
            userId: member.user_id,
            type: 'household_update',
            title: 'New Household Member',
            body: `${newMemberName} has joined "${household.name}"`,
            data: {
              screen: 'HouseholdMembers',
              householdId: household.id,
              householdName: household.name,
              updateType: 'invitation_accepted',
              newMemberId: userId,
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
 * POST /invitations/:invitationId/decline-in-app - Decline an invitation by id.
 */
invitations.post('/:invitationId/decline-in-app', authMiddleware(), async (c) => {
  const userEmail = c.get('userEmail');
  const invitationId = c.req.param('invitationId');
  if (!invitationId) {
    return c.json({ error: 'Invitation id required' }, 400);
  }
  const householdService = new HouseholdService(c.env, c.env.DB);
  const authService = new AuthService(c.env, c.env.DB);

  let email = userEmail;
  if (!email) {
    const user = await authService.getUserById(c.get('userId'));
    email = user?.email || '';
  }

  await householdService.declineInvitationById(invitationId, email);

  return c.body(null, 204);
});

export default invitations;
