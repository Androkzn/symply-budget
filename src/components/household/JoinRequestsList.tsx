import React from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';

import type { JoinRequest } from '@api/households';
import { Avatar, Card, Typography } from '@components/ui';
import { useAppColors } from '@theme';

interface JoinRequestsListProps {
  requests: JoinRequest[];
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}

/**
 * Owner-facing list of pending "request to join" submissions from shareable
 * invite links. Mirrors `InvitationsList` styling.
 */
export function JoinRequestsList({ requests, onApprove, onDeny }: JoinRequestsListProps) {
  const colors = useAppColors();
  if (requests.length === 0) {
    return null;
  }

  const handleDeny = (request: JoinRequest) => {
    const who = request.display_name || request.email;
    Alert.alert('Decline Request', `Decline ${who}'s request to join?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => onDeny(request.id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
        Join Requests ({requests.length})
      </Typography>

      {requests.map((request) => (
        <Card
          key={request.id}
          variant="filled"
          style={[styles.requestCard, { backgroundColor: colors.backgroundSecondary }]}
        >
          <View style={styles.header}>
            <Avatar
              user={{
                display_name: request.display_name,
                avatar_url: request.avatar_url,
                email: request.email,
              }}
              size="md"
            />
            <View style={styles.info}>
              <Typography variant="body" weight="semibold">
                {request.display_name || request.email}
              </Typography>
              {request.display_name ? (
                <Typography variant="caption2" color={colors.textTertiary}>
                  {request.email}
                </Typography>
              ) : null}
            </View>
          </View>

          <View style={styles.actions} testID={`join-request-${request.id}`}>
            <TouchableOpacity
              testID={`join-request-deny-${request.id}`}
              onPress={() => handleDeny(request)}
              style={[styles.actionButton, { backgroundColor: colors.error + '15' }]}
            >
              <Typography variant="footnote" color={colors.error} weight="medium">
                Decline
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              testID={`join-request-approve-${request.id}`}
              onPress={() => onApprove(request.id)}
              style={[styles.actionButton, { backgroundColor: colors.primary + '20' }]}
            >
              <Typography variant="footnote" color={colors.primary} weight="medium">
                Approve
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
  requestCard: {
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  info: {
    flex: 1,
    marginLeft: 12,
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
