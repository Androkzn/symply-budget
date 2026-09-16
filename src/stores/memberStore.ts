import { produce } from 'immer';
import { create } from 'zustand';

import {
  householdsApi,
  type HouseholdMember,
  type HouseholdInvitation,
  type JoinRequest,
  type OwnerJoinRequest,
  type MyJoinRequest,
  type CreateInviteLinkRequest,
} from '@api/households';
import { logMovementFeed, logMovementFeedError } from '@utils/movementFeedDebug';

interface MemberState {
  members: HouseholdMember[];
  pendingInvitations: HouseholdInvitation[];
  joinRequests: JoinRequest[];
  ownerPendingJoinRequests: OwnerJoinRequest[];
  myPendingJoinRequests: MyJoinRequest[];
  isLoading: boolean;
  error: string | null;
  optimisticUpdates: string[];
}

interface MemberActions {
  fetchMembers: (householdId: string) => Promise<void>;
  inviteMember: (
    householdId: string,
    email: string,
    role: 'owner' | 'member'
  ) => Promise<void>;
  resendInvitation: (householdId: string, invitationId: string) => Promise<void>;
  revokeInvitation: (householdId: string, invitationId: string) => Promise<void>;
  removeMember: (householdId: string, userId: string) => Promise<void>;
  updateMemberRole: (
    householdId: string,
    userId: string,
    role: 'owner' | 'member'
  ) => Promise<void>;
  fetchJoinRequests: (householdId: string) => Promise<void>;
  refreshOwnerJoinRequests: () => Promise<void>;
  refreshMyJoinRequests: () => Promise<void>;
  createInviteLink: (
    householdId: string,
    data?: CreateInviteLinkRequest
  ) => Promise<string>;
  approveJoinRequest: (householdId: string, requestId: string) => Promise<void>;
  denyJoinRequest: (householdId: string, requestId: string) => Promise<void>;
  reset: () => void;
}

type MemberStore = MemberState & MemberActions;

const initialState: MemberState = {
  members: [],
  pendingInvitations: [],
  joinRequests: [],
  ownerPendingJoinRequests: [],
  myPendingJoinRequests: [],
  isLoading: false,
  error: null,
  optimisticUpdates: [],
};

export const useMemberStore = create<MemberStore>((set, get) => ({
  ...initialState,

  fetchMembers: async (householdId: string) => {
    set({ isLoading: true, error: null });

    try {
      const householdData = await householdsApi.get(householdId);
      set({ members: householdData.members });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch members',
        isLoading: false,
      });
      return;
    }

    try {
      // Invitations are owner-only; a non-owner member 403s here, which must
      // not block the members list above from loading.
      const invitationsData = await householdsApi.getInvitations(householdId);
      set({ pendingInvitations: invitationsData.invitations });
    } catch {
      set({ pendingInvitations: [] });
    }

    set({ isLoading: false });
  },

  inviteMember: async (householdId: string, email: string, role: 'owner' | 'member') => {
    const tempId = `temp-${Date.now()}`;

    try {
      // Optimistic update
      set(
        produce((state: MemberState) => {
          state.pendingInvitations.push({
            id: tempId,
            email,
            role,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
          });
          state.optimisticUpdates.push(tempId);
        })
      );

      const { invitation } = await householdsApi.invite(householdId, { email, role });

      // Replace temp invitation with real one
      set(
        produce((state: MemberState) => {
          const index = state.pendingInvitations.findIndex((inv) => inv.id === tempId);
          if (index !== -1) {
            // Keep the optimistic expires_at and created_at since API response doesn't include them
            const existingInvitation = state.pendingInvitations[index];
            state.pendingInvitations[index] = {
              ...existingInvitation,
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
            };
          }
          state.optimisticUpdates = state.optimisticUpdates.filter((id) => id !== tempId);
        })
      );
    } catch (error) {
      // Rollback optimistic update
      set(
        produce((state: MemberState) => {
          state.pendingInvitations = state.pendingInvitations.filter(
            (inv) => inv.id !== tempId
          );
          state.optimisticUpdates = state.optimisticUpdates.filter((id) => id !== tempId);
          state.error =
            error instanceof Error ? error.message : 'Failed to send invitation';
        })
      );
      throw error;
    }
  },

  resendInvitation: async (householdId: string, invitationId: string) => {
    // Find the invitation first
    const invitation = get().pendingInvitations.find((inv) => inv.id === invitationId);
    if (!invitation) {
      const error = new Error('Invitation not found');
      set({ error: error.message });
      throw error;
    }

    const { email, role } = invitation;

    try {
      // First, revoke the old invitation
      await householdsApi.cancelInvitation(householdId, invitationId);

      // Remove from local state immediately
      set(
        produce((state: MemberState) => {
          state.pendingInvitations = state.pendingInvitations.filter(
            (inv) => inv.id !== invitationId
          );
        })
      );

      // Then send a new invitation
      await get().inviteMember(householdId, email, role);
    } catch (error) {
      // If anything fails, refresh the invitations list to get accurate state
      try {
        const { invitations } = await householdsApi.getInvitations(householdId);
        set({ pendingInvitations: invitations });
      } catch {
        // Ignore refresh errors
      }

      set({
        error: error instanceof Error ? error.message : 'Failed to resend invitation',
      });
      throw error;
    }
  },

  revokeInvitation: async (householdId: string, invitationId: string) => {
    const invitation = get().pendingInvitations.find((inv) => inv.id === invitationId);

    try {
      // Optimistic update
      set(
        produce((state: MemberState) => {
          state.pendingInvitations = state.pendingInvitations.filter(
            (inv) => inv.id !== invitationId
          );
          state.optimisticUpdates.push(invitationId);
        })
      );

      await householdsApi.cancelInvitation(householdId, invitationId);

      // Remove from optimistic updates
      set(
        produce((state: MemberState) => {
          state.optimisticUpdates = state.optimisticUpdates.filter(
            (id) => id !== invitationId
          );
        })
      );
    } catch (error) {
      // Rollback optimistic update
      if (invitation) {
        set(
          produce((state: MemberState) => {
            state.pendingInvitations.push(invitation);
            state.optimisticUpdates = state.optimisticUpdates.filter(
              (id) => id !== invitationId
            );
            state.error =
              error instanceof Error ? error.message : 'Failed to revoke invitation';
          })
        );
      }
      throw error;
    }
  },

  removeMember: async (householdId: string, userId: string) => {
    const member = get().members.find((m) => m.user_id === userId);

    try {
      // Optimistic update
      set(
        produce((state: MemberState) => {
          state.members = state.members.filter((m) => m.user_id !== userId);
          state.optimisticUpdates.push(userId);
        })
      );

      await householdsApi.removeMember(householdId, userId);

      // Remove from optimistic updates
      set(
        produce((state: MemberState) => {
          state.optimisticUpdates = state.optimisticUpdates.filter((id) => id !== userId);
        })
      );
    } catch (error) {
      // Rollback optimistic update
      if (member) {
        set(
          produce((state: MemberState) => {
            state.members.push(member);
            state.optimisticUpdates = state.optimisticUpdates.filter((id) => id !== userId);
            state.error =
              error instanceof Error ? error.message : 'Failed to remove member';
          })
        );
      }
      throw error;
    }
  },

  updateMemberRole: async (
    householdId: string,
    userId: string,
    role: 'owner' | 'member'
  ) => {
    const memberIndex = get().members.findIndex((m) => m.user_id === userId);
    const oldRole = memberIndex !== -1 ? get().members[memberIndex].role : null;

    try {
      // Optimistic update
      set(
        produce((state: MemberState) => {
          if (memberIndex !== -1) {
            state.members[memberIndex].role = role;
            state.optimisticUpdates.push(userId);
          }
        })
      );

      const { member } = await householdsApi.updateMemberRole(householdId, userId, role);

      // Update with server response
      set(
        produce((state: MemberState) => {
          const index = state.members.findIndex((m) => m.user_id === userId);
          if (index !== -1) {
            state.members[index] = member;
          }
          state.optimisticUpdates = state.optimisticUpdates.filter((id) => id !== userId);
        })
      );
    } catch (error) {
      // Rollback optimistic update
      if (memberIndex !== -1 && oldRole) {
        set(
          produce((state: MemberState) => {
            state.members[memberIndex].role = oldRole;
            state.optimisticUpdates = state.optimisticUpdates.filter((id) => id !== userId);
            state.error =
              error instanceof Error ? error.message : 'Failed to update member role';
          })
        );
      }
      throw error;
    }
  },

  // Pending "request to join" submissions. Owner-only endpoint — non-owners
  // get a 403, which we swallow so the members screen still renders for them.
  fetchJoinRequests: async (householdId: string) => {
    logMovementFeed('fetchJoinRequests start', { householdId });
    try {
      const { requests } = await householdsApi.getJoinRequests(householdId);
      set({ joinRequests: requests });
      logMovementFeed('fetchJoinRequests ok', { householdId, count: requests.length });
    } catch (error) {
      logMovementFeedError('fetchJoinRequests failed', error);
      set({ joinRequests: [] });
    }
  },

  refreshOwnerJoinRequests: async () => {
    logMovementFeed('GET /invite-links/owner-pending');
    try {
      const { requests } = await householdsApi.getOwnerPendingJoinRequests();
      set({ ownerPendingJoinRequests: requests });
      logMovementFeed('owner-pending ok', {
        count: requests.length,
        requests: requests.map((r) => ({
          id: r.id,
          household: r.household_name,
          email: r.email,
        })),
      });
    } catch (error) {
      logMovementFeedError('owner-pending failed', error);
      set({ ownerPendingJoinRequests: [] });
    }
  },

  refreshMyJoinRequests: async () => {
    logMovementFeed('GET /invite-links/my-requests');
    try {
      const { requests } = await householdsApi.getMyJoinRequests();
      set({ myPendingJoinRequests: requests });
      logMovementFeed('my-requests ok', { count: requests.length });
    } catch (error) {
      logMovementFeedError('my-requests failed', error);
      set({ myPendingJoinRequests: [] });
    }
  },

  // Create a shareable invite link and return its (short) URL for the share sheet.
  createInviteLink: async (householdId: string, data?: CreateInviteLinkRequest) => {
    const { invite_link } = await householdsApi.createInviteLink(householdId, data);
    return invite_link.short_url || invite_link.url;
  },

  approveJoinRequest: async (householdId: string, requestId: string) => {
    const joinRequest = get().joinRequests.find((r) => r.id === requestId);
    const ownerRequest = get().ownerPendingJoinRequests.find((r) => r.id === requestId);

    try {
      set(
        produce((state: MemberState) => {
          state.joinRequests = state.joinRequests.filter((r) => r.id !== requestId);
          state.ownerPendingJoinRequests = state.ownerPendingJoinRequests.filter(
            (r) => r.id !== requestId
          );
        })
      );

      await householdsApi.approveJoinRequest(householdId, requestId);

      // Pull the now-updated member list (the approved user was added).
      const householdData = await householdsApi.get(householdId);
      set({ members: householdData.members });
      await get().refreshOwnerJoinRequests();

      try {
        const { useNotificationStore } = await import('@stores/notificationStore');
        await useNotificationStore.getState().dismissJoinRequestNotifications(requestId);
      } catch (dismissError) {
        logMovementFeedError('dismissJoinRequestNotifications failed', dismissError);
      }
    } catch (error) {
      // Rollback on failure.
      set(
        produce((state: MemberState) => {
          if (joinRequest && !state.joinRequests.some((r) => r.id === requestId)) {
            state.joinRequests.push(joinRequest);
          }
          if (ownerRequest && !state.ownerPendingJoinRequests.some((r) => r.id === requestId)) {
            state.ownerPendingJoinRequests.push(ownerRequest);
          }
          state.error =
            error instanceof Error ? error.message : 'Failed to approve request';
        })
      );
      throw error;
    }
  },

  denyJoinRequest: async (householdId: string, requestId: string) => {
    const joinRequest = get().joinRequests.find((r) => r.id === requestId);
    const ownerRequest = get().ownerPendingJoinRequests.find((r) => r.id === requestId);

    try {
      set(
        produce((state: MemberState) => {
          state.joinRequests = state.joinRequests.filter((r) => r.id !== requestId);
          state.ownerPendingJoinRequests = state.ownerPendingJoinRequests.filter(
            (r) => r.id !== requestId
          );
        })
      );

      await householdsApi.denyJoinRequest(householdId, requestId);
      logMovementFeed('denyJoinRequest ok', { householdId, requestId });
      await get().refreshOwnerJoinRequests();

      try {
        const { useNotificationStore } = await import('@stores/notificationStore');
        await useNotificationStore.getState().dismissJoinRequestNotifications(requestId);
      } catch (dismissError) {
        logMovementFeedError('dismissJoinRequestNotifications failed', dismissError);
      }
    } catch (error) {
      set(
        produce((state: MemberState) => {
          if (joinRequest && !state.joinRequests.some((r) => r.id === requestId)) {
            state.joinRequests.push(joinRequest);
          }
          if (ownerRequest && !state.ownerPendingJoinRequests.some((r) => r.id === requestId)) {
            state.ownerPendingJoinRequests.push(ownerRequest);
          }
          state.error =
            error instanceof Error ? error.message : 'Failed to deny request';
        })
      );
      throw error;
    }
  },

  reset: () => {
    set(initialState);
  },
}));
