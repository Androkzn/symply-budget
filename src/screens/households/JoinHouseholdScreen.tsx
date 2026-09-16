import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { householdsApi } from '@api/households';
import { SafeAreaView, AppBackground, ScreenHeader } from '@components/common';
import { Typography, Button, Card, Avatar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { useInviteStore } from '@stores/inviteStore';
import { useMemberStore } from '@stores/memberStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { logMovementFeed, logMovementFeedError } from '@utils/movementFeedDebug';

interface JoinHouseholdScreenProps {
  token: string;
}

interface Inviter {
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

interface LinkDetails {
  household: { id: string; name: string };
  role: 'owner' | 'member';
  homePhotoUrl?: string | null;
  inviter?: Inviter;
}

type Stage =
  | 'validating'
  | 'invalid'
  | 'ready'
  | 'requesting'
  | 'requested'
  | 'declined'
  | 'already_member';

/**
 * Join screen for shareable invite links (`/join/<token>`). Mirrors
 * `AcceptInviteScreen` but uses the open-link, owner-approved flow: the user
 * sees the household, taps "Request to Join", and an owner approves before they
 * become a member.
 */
export function JoinHouseholdScreen({ token }: JoinHouseholdScreenProps) {  const colors = useAppColors();
  const { clearPendingJoinToken, joinRequestOutcome, clearJoinRequestOutcome } = useInviteStore();
  const { fetchHouseholds } = useHouseholdStore();
  const refreshMyJoinRequests = useMemberStore((state) => state.refreshMyJoinRequests);
  const myPendingJoinRequests = useMemberStore((state) => state.myPendingJoinRequests);

  const [stage, setStage] = useState<Stage>('validating');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<LinkDetails | null>(null);

  // We are now showing the link — drop the pending token so it can't re-trigger.
  useEffect(() => {
    clearPendingJoinToken();
  }, [clearPendingJoinToken]);

  useEffect(() => {
    let cancelled = false;

    const validate = async () => {
      if (!token) {
        setError('Invalid invite link');
        setStage('invalid');
        return;
      }

      try {
        const result = await householdsApi.validateInviteLink(token);
        if (cancelled) return;

        if (result.valid && result.household) {
          setDetails({
            household: result.household,
            role: (result.role as 'owner' | 'member') ?? 'member',
            homePhotoUrl: result.homePhotoUrl,
            inviter: result.inviter,
          });
          setStage(result.alreadyMember ? 'already_member' : 'ready');
        } else {
          setError(result.error || 'This invite link is invalid or has expired.');
          setStage('invalid');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to validate invite link');
        setStage('invalid');
      }
    };

    validate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const syncRequestStatus = useCallback(async () => {
    if (!details?.household.id) return;
    await refreshMyJoinRequests();
    const pending = useMemberStore.getState().myPendingJoinRequests;
    const stillPending = pending.some((r) => r.household_id === details.household.id);
    if (!stillPending && stage === 'requested') {
      setStage('declined');
    }
  }, [details?.household.id, refreshMyJoinRequests, stage]);

  useFocusEffect(
    useCallback(() => {
      if (stage === 'requested') {
        void syncRequestStatus();
      }
    }, [stage, syncRequestStatus])
  );

  useEffect(() => {
    if (!joinRequestOutcome || !details?.household.id) return;
    if (joinRequestOutcome.householdId !== details.household.id) return;

    if (joinRequestOutcome.status === 'denied') {
      setStage('declined');
    } else if (joinRequestOutcome.status === 'approved') {
      void fetchHouseholds().then(() => setStage('already_member'));
    }
    clearJoinRequestOutcome();
  }, [
    joinRequestOutcome,
    details?.household.id,
    fetchHouseholds,
    clearJoinRequestOutcome,
  ]);

  useEffect(() => {
    if (stage !== 'requested' || !details?.household.id) return undefined;
    const stillPending = myPendingJoinRequests.some(
      (r) => r.household_id === details.household.id
    );
    if (myPendingJoinRequests.length > 0 && !stillPending) {
      setStage('declined');
    }
    return undefined;
  }, [myPendingJoinRequests, stage, details?.household.id]);

  const handleRequest = async () => {
    try {
      setStage('requesting');
      setError(null);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const result = await householdsApi.requestToJoin(token);

      logMovementFeed('requestToJoin response', result);

      if (result.status === 'already_member') {
        await fetchHouseholds();
        setStage('already_member');
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage('requested');
    } catch (err) {
      logMovementFeedError('requestToJoin failed', err);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : 'Failed to send join request');
      setStage('ready');
    }
  };

  const goHome = () => {
    router.replace('/');
  };

  const renderHero = (iconName: keyof typeof Ionicons.glyphMap) => (
    <View style={[styles.heroBadge, { backgroundColor: colors.primary + '14' }]}>
      <Icon name={iconName} size={40} color={colors.primary} />
    </View>
  );

  const renderInviter = (inviter?: Inviter) => {
    if (!inviter) return null;
    const name = inviter.displayName || inviter.email || 'A household owner';
    return (
      <View style={[styles.inviterRow, { borderTopColor: colors.borderColor }]}>
        <Avatar
          user={{
            display_name: inviter.displayName,
            avatar_url: inviter.avatarUrl,
            email: inviter.email ?? undefined,
          }}
          size="sm"
        />
        <View style={styles.inviterTextGroup}>
          <Typography variant="caption1" color={colors.textTertiary}>
            Invited by
          </Typography>
          <Typography variant="subheadline" weight="semibold">
            {name}
          </Typography>
        </View>
      </View>
    );
  };

  const renderBody = () => {
    if (stage === 'validating') {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography variant="body" color={colors.textSecondary} style={styles.loadingText}>
            Checking invite…
          </Typography>
        </View>
      );
    }

    if (stage === 'invalid') {
      return (
        <Card variant="elevated" style={styles.card}>
          {renderHero('warning')}
          <Typography variant="title2" weight="bold" style={styles.title} testID="invite-unavailable-title">
            Invite Unavailable
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            {error ||
              'This invite link is invalid or has expired. Ask the household owner for a new one.'}
          </Typography>
          <Button title="Go to Home" variant="primary" size="lg" onPress={goHome} fullWidth />
        </Card>
      );
    }

    if (stage === 'requested') {
      return (
        <Card variant="elevated" style={styles.card}>
          {renderHero('mail')}
          <Typography
            variant="title1"
            weight="bold"
            style={styles.title}
            testID="join-stage-requested"
          >
            Request Sent
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            Your request to join{' '}
            <Typography variant="body" weight="semibold">
              {details?.household.name}
            </Typography>{' '}
            was sent. You'll get a notification once an owner approves or declines it.
          </Typography>
          <Button title="Done" variant="primary" size="lg" onPress={goHome} fullWidth />
        </Card>
      );
    }

    if (stage === 'declined') {
      return (
        <Card variant="elevated" style={styles.card}>
          {renderHero('sad-outline')}
          <Typography variant="title1" weight="bold" style={styles.title}>
            Request Declined
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            The owner declined your request to join{' '}
            <Typography variant="body" weight="semibold">
              {details?.household.name}
            </Typography>
            . You can request to join again if you'd like.
          </Typography>
          {error && (
            <Typography variant="caption1" color={colors.error} style={styles.errorText}>
              {error}
            </Typography>
          )}
          <View style={styles.actions}>
            <Button
              title="Request to Join Again"
              variant="primary"
              size="lg"
              onPress={handleRequest}
              fullWidth
            />
            <Button title="Go to Home" variant="ghost" size="lg" onPress={goHome} fullWidth />
          </View>
        </Card>
      );
    }

    if (stage === 'already_member') {
      return (
        <Card variant="elevated" style={styles.card}>
          {renderHero('checkmark-circle')}
          <Typography
            variant="title1"
            weight="bold"
            style={styles.title}
            testID="join-stage-already-member"
          >
            You're Already In
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            You're already a member of{' '}
            <Typography variant="body" weight="semibold">
              {details?.household.name}
            </Typography>
            .
          </Typography>
          <Button title="Go to Home" variant="primary" size="lg" onPress={goHome} fullWidth />
        </Card>
      );
    }

    // ready | requesting
    return (
      <Card variant="elevated" style={styles.card}>
        {/* "Join Household" is the centered header title; the body leads with the
            invite context so the name isn't duplicated. */}
        <Typography variant="subheadline" color={colors.textSecondary} style={styles.subtitle}>
          You've been invited to join
        </Typography>

        <View style={[styles.householdCard, { backgroundColor: colors.cardSubtle }]}>
          <Typography variant="title2" weight="bold" style={styles.householdName}>
            {details?.household.name}
          </Typography>
          {details?.homePhotoUrl && (
            <Image
              source={{ uri: details.homePhotoUrl }}
              style={[styles.cardPhoto, { backgroundColor: colors.groupedListBackground }]}
              contentFit="cover"
              transition={200}
              accessibilityLabel={`Photo of ${details.household.name}`}
            />
          )}
          {renderInviter(details?.inviter)}
        </View>

        <View style={[styles.infoCard, { backgroundColor: colors.primary + '0F' }]}>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.infoText}>
            A household owner will review your request before you're added.
          </Typography>
        </View>

        {error && (
          <Typography variant="caption1" color={colors.error} style={styles.errorText}>
            {error}
          </Typography>
        )}

        <View style={styles.actions}>
          <Button
            testID="join-request-submit"
            title="Request to Join"
            variant="primary"
            size="lg"
            onPress={handleRequest}
            loading={stage === 'requesting'}
            fullWidth
          />
          <Button
            title="Not Now"
            variant="ghost"
            size="lg"
            onPress={goHome}
            disabled={stage === 'requesting'}
            fullWidth
          />
        </View>
      </Card>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Join Household"
        showNotificationBell={false}
        showAvatar={false}
      />
      <SafeAreaView edges={['bottom']}>
        <View style={styles.container} testID="join-household-screen">
          <View style={styles.content}>{renderBody()}</View>
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.xl,
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.base,
  },
  card: {
    padding: Spacing.xl,
    borderRadius: CornerRadius.card,
    alignItems: 'center',
  },
  heroBadge: {
    width: 88,
    height: 88,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  cardPhoto: {
    width: '100%',
    height: 160,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.base,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  message: {
    marginBottom: Spacing.xl,
    textAlign: 'center',
    lineHeight: 24,
  },
  householdCard: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.md,
    width: '100%',
    alignItems: 'center',
  },
  householdName: {
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  inviterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.base,
    paddingTop: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: '100%',
  },
  inviterTextGroup: {
    flex: 1,
    gap: Spacing.xxs,
  },
  infoCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.lg,
    width: '100%',
  },
  infoText: {
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    marginBottom: Spacing.base,
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.sm,
    width: '100%',
  },
});
