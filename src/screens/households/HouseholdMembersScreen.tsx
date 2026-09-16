import * as Haptics from 'expo-haptics';
import { useNavigation } from "expo-router/react-navigation";
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Share,
} from 'react-native';

import { brand, isHouseBrand } from '@brand';
import { SafeAreaView, AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle } from '@components/common';
import { InvitationsList } from '@components/household/InvitationsList';
import { InviteBottomSheet } from '@components/household/InviteBottomSheet';
import { JoinRequestsList } from '@components/household/JoinRequestsList';
import { MemberCard } from '@components/household/MemberCard';
import { Typography, EmptyState, SkeletonLoader } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useHouseholdMembers, useInvalidateHouseholdMembers } from '@hooks/useHouseholdMembers';
import type { SettingsStackScreenProps } from '@navigation/types';
import { captureException } from '@services/monitoring';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useMemberStore } from '@stores/memberStore';
import { useAppColors } from '@theme';
import { getApiErrorMessage } from '@utils/apiError';


// Brand is fixed per JS bundle. House frames a household as a "property"; every
// other brand (Budget, …) uses the neutral "household".
const UNIT_NOUN = isHouseBrand() ? 'property' : 'household';

export function HouseholdMembersScreen({
  route,
}: SettingsStackScreenProps<'HouseholdMembers'>) {  const colors = useAppColors();
  const navigation = useNavigation();
  const { householdId } = route.params;
  const { currentHousehold, households } = useHouseholdStore();
  const { user } = useAuthStore();
  const {
    data: members = [],
    isLoading: membersLoading,
    refetch: refetchMembers,
    error: membersError,
  } = useHouseholdMembers(householdId);
  const invalidateMembers = useInvalidateHouseholdMembers();
  const {
    pendingInvitations,
    joinRequests,
    isLoading: storeLoading,
    error: storeError,
    fetchJoinRequests,
    createInviteLink,
    approveJoinRequest,
    denyJoinRequest,
    refreshOwnerJoinRequests,
    inviteMember,
    resendInvitation,
    revokeInvitation,
    removeMember,
    updateMemberRole,
  } = useMemberStore();

  const isLoading = membersLoading || storeLoading;
  const error =
    (membersError instanceof Error ? membersError.message : null) ?? storeError;

  const [isInviteSheetVisible, setIsInviteSheetVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  useEffect(() => {
    loadMembers();
  }, [householdId]);

  const loadMembers = async () => {
    try {
      await Promise.all([
        refetchMembers(),
        fetchJoinRequests(householdId),
        refreshOwnerJoinRequests(),
      ]);
    } catch {
      Alert.alert('Error', `Failed to load ${UNIT_NOUN} members`);
    }
  };

  const refreshMembersAfterMutation = async () => {
    await invalidateMembers(householdId);
  };

  const handleShareInviteLink = async () => {
    let url: string;
    try {
      setIsCreatingLink(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      url = await createInviteLink(householdId);
    } catch (error) {
      // Log the real cause so link-creation failures are diagnosable — the old
      // handler swallowed everything behind one generic message.
      captureException(error, {
        source: 'household_members.create_invite_link',
        householdId,
      });
      Alert.alert('Error', getApiErrorMessage(error, 'Failed to create invite link'));
      return;
    } finally {
      setIsCreatingLink(false);
    }

    // Sharing is separate: a cancelled/failed share sheet must NOT be reported as
    // "Failed to create invite link" — the link already exists at this point.
    try {
      const name = currentHousehold?.name || 'my household';
      await Share.share({
        message: `Join ${name} on ${brand.displayName}: ${url}`,
      });
    } catch (error) {
      captureException(error, {
        source: 'household_members.share_invite_link',
        householdId,
      });
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    const request = joinRequests.find((r) => r.id === requestId);
    const memberName = request?.display_name || request?.email || 'This person';
    const householdName =
      households.find((h) => h.id === householdId)?.name ||
      currentHousehold?.name ||
      'your household';

    try {
      await approveJoinRequest(householdId, requestId);
      await refreshMembersAfterMutation();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Member added',
        `${memberName} has been approved and added to ${householdName}.`
      );
    } catch (error) {
      Alert.alert(
        'Unable to approve',
        getApiErrorMessage(error, 'This join request could not be approved. Please try again.')
      );
    }
  };

  const handleDenyRequest = async (requestId: string) => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await denyJoinRequest(householdId, requestId);
    } catch (error) {
      Alert.alert(
        'Unable to decline',
        getApiErrorMessage(error, 'This join request could not be declined. Please try again.')
      );
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadMembers();
    setIsRefreshing(false);
  };

  const handleInvite = async (email: string, role: 'owner' | 'member') => {
    try {
      await inviteMember(householdId, email, role);
      await refreshMembersAfterMutation();
      Alert.alert('Success', `Invitation sent to ${email}`);
    } catch (error) {
      throw error;
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await resendInvitation(householdId, invitationId);
      Alert.alert('Success', 'Invitation resent');
    } catch (error) {
      Alert.alert('Error', 'Failed to resend invitation');
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await revokeInvitation(householdId, invitationId);
      Alert.alert('Success', 'Invitation revoked');
    } catch (error) {
      Alert.alert('Error', 'Failed to revoke invitation');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await removeMember(householdId, userId);
      await refreshMembersAfterMutation();
      Alert.alert('Success', `Member removed from ${UNIT_NOUN}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to remove member');
    }
  };

  const handleChangeRole = async (userId: string, newRole: 'owner' | 'member') => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await updateMemberRole(householdId, userId, newRole);
      await refreshMembersAfterMutation();
      Alert.alert('Success', 'Member role updated');
    } catch (error) {
      Alert.alert('Error', 'Failed to update member role');
    }
  };

  const currentUserMember = members.find((m) => m.user_id === user?.id);
  const currentUserRole = currentUserMember?.role || 'member';
  const canInvite = currentUserRole === 'owner';

  if (isLoading && members.length === 0) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView edges={[]}>
          <ScreenHeader
            title="Members"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
          />
          <View style={styles.content}>
            <SkeletonLoader type="member" count={3} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={[]} testID="household-members-screen">
        <ScreenHeader
          title="Members"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.container]}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {/* "Members" is now the centered header title; the body keeps the
              household/property name as context. */}
          <View style={styles.titleSection}>
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.subtitle}
            >
              {currentHousehold?.name || (isHouseBrand() ? 'Property' : 'Household')}
            </Typography>
          </View>

          {canInvite && (
            <TouchableOpacity
              testID="household-invite-link"
              style={[
                styles.shareLinkButton,
                {
                  backgroundColor: colors.primary + '15',
                  borderColor: colors.primary,
                },
              ]}
              onPress={handleShareInviteLink}
              disabled={isCreatingLink}
              activeOpacity={0.8}
            >
              {!isCreatingLink && (
                <Icon
                  name="link"
                  size={18}
                  color={colors.primary}
                  style={styles.shareLinkIcon}
                />
              )}
              <Typography variant="body" color={colors.primary} weight="semibold">
                {isCreatingLink ? 'Creating link…' : 'Invite via link'}
              </Typography>
            </TouchableOpacity>
          )}

          {canInvite && joinRequests.length > 0 && (
            <JoinRequestsList
              requests={joinRequests}
              onApprove={handleApproveRequest}
              onDeny={handleDenyRequest}
            />
          )}

          {pendingInvitations.length > 0 && (
            <InvitationsList
              invitations={pendingInvitations}
              onResend={handleResendInvitation}
              onRevoke={handleRevokeInvitation}
            />
          )}

          {members.length > 0 ? (
            <>
              <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
                Active Members ({members.length})
              </Typography>

              {members.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  isCurrentUser={member.user_id === user?.id}
                  currentUserRole={currentUserRole}
                  onRemove={() => handleRemoveMember(member.user_id)}
                  onChangeRole={() =>
                    handleChangeRole(
                      member.user_id,
                      member.role === 'owner' ? 'member' : 'owner'
                    )
                  }
                />
              ))}
            </>
          ) : error ? (
            <EmptyState
              icon="warning"
              title="Couldn't load members"
              description={error}
              action={{ label: 'Retry', onPress: loadMembers }}
            />
          ) : (
            <EmptyState
              icon="people"
              title="No Members Yet"
              description={`Invite members to collaborate on this ${UNIT_NOUN}`}
            />
          )}
          <ScreenScrollEnd testID={screenScrollEndTestId('household-members-screen')} />
        </ScrollView>

        {canInvite && (
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.black }]}
            onPress={() => setIsInviteSheetVisible(true)}
            activeOpacity={0.8}
          >
            <Typography variant="title2" color={colors.white} weight="bold">
              +
            </Typography>
          </TouchableOpacity>
        )}

        <InviteBottomSheet
          visible={isInviteSheetVisible}
          onClose={() => setIsInviteSheetVisible(false)}
          onInvite={handleInvite}
          householdId={householdId}
        />
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 100,
  },
  titleSection: {
    marginBottom: 24,
  },
  subtitle: {
    marginTop: 8,
  },
  shareLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  shareLinkIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
