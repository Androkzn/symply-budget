import React from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';

import type { HouseholdInvitation } from '@api/households';
import { Card, Typography, Chip } from '@components/ui';
import { useAppColors } from '@theme';

interface InvitationsListProps {
  invitations: HouseholdInvitation[];
  onResend: (invitationId: string) => void;
  onRevoke: (invitationId: string) => void;
}

export function InvitationsList({ invitations, onResend, onRevoke }: InvitationsListProps) {
  const colors = useAppColors();
  if (invitations.length === 0) {
    return null;
  }

  const handleResend = (invitation: HouseholdInvitation) => {
    Alert.alert(
      'Resend Invitation',
      `Resend invitation to ${invitation.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resend',
          onPress: () => onResend(invitation.id),
        },
      ]
    );
  };

  const handleRevoke = (invitation: HouseholdInvitation) => {
    Alert.alert(
      'Revoke Invitation',
      `Revoke invitation for ${invitation.email}? They will no longer be able to join using this invitation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => onRevoke(invitation.id),
        },
      ]
    );
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const getExpiryText = (expiresAt: string) => {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return 'Expired';
    } else if (daysUntilExpiry === 0) {
      return 'Expires today';
    } else if (daysUntilExpiry === 1) {
      return 'Expires tomorrow';
    } else {
      return `Expires in ${daysUntilExpiry} days`;
    }
  };

  return (
    <View style={styles.container}>
      <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
        Pending Invitations
      </Typography>

      {invitations.map((invitation) => (
        <Card
          key={invitation.id}
          variant="filled"
          style={[
            styles.invitationCard,
            {
              backgroundColor: isExpired(invitation.expires_at)
                ? colors.error + '10'
                : colors.backgroundSecondary,
            },
          ]}
        >
          <View style={styles.invitationHeader}>
            <View style={styles.invitationInfo}>
              <Typography variant="body" weight="semibold">
                {invitation.email}
              </Typography>
              <View style={styles.badgeRow}>
                <Chip
                  label={isExpired(invitation.expires_at) ? 'EXPIRED' : 'PENDING'}
                  variant={isExpired(invitation.expires_at) ? 'error' : 'warning'}
                  size="sm"
                />
                <Chip
                  label={invitation.role === 'owner' ? 'Owner' : 'Member'}
                  variant={invitation.role === 'owner' ? 'primary' : 'secondary'}
                  size="sm"
                />
              </View>
              <Typography
                variant="caption2"
                color={
                  isExpired(invitation.expires_at)
                    ? colors.error
                    : colors.textTertiary
                }
                style={styles.expiryText}
              >
                {getExpiryText(invitation.expires_at)}
              </Typography>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => handleResend(invitation)}
              style={[
                styles.actionButton,
                { 
                  backgroundColor: isExpired(invitation.expires_at) 
                    ? colors.primary + '10' 
                    : colors.primary + '20',
                },
              ]}
              disabled={false} // Always allow resend, even for expired
            >
              <Typography 
                variant="footnote" 
                color={colors.primary} 
                weight="medium"
              >
                {isExpired(invitation.expires_at) ? 'Send New' : 'Resend'}
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleRevoke(invitation)}
              style={[
                styles.actionButton,
                { backgroundColor: colors.error + '15' },
              ]}
            >
              <Typography variant="footnote" color={colors.error} weight="medium">
                Revoke
              </Typography>
            </TouchableOpacity>
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  invitationCard: {
    padding: 16,
    marginBottom: 12,
  },
  invitationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  invitationInfo: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  expiryText: {
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
});
