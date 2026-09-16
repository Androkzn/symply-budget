import * as Haptics from 'expo-haptics';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { householdsApi } from '@api/households';
import { SafeAreaView, AppBackground } from '@components/common';
import { OnboardingStepHeader } from '@components/onboarding';
import { Typography, Button, Card, Chip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { recordOnboardingStep } from '@features/house/onboarding/recordStep';
import { trackEvent } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useInviteStore } from '@stores/inviteStore';
import { Layout, useAppColors } from '@theme';

type Stage = 'validating' | 'invalid' | 'ready' | 'requesting' | 'requested' | 'already_member';

/**
 * Onboarding step shown INSTEAD of "Set Up Your Home" when the user arrived via
 * an invite link (a `pendingJoinToken` is present). They request to join the
 * inviting household; once they submit (or if already a member) onboarding is
 * marked complete and they enter the app — skipping the home-owner setup steps
 * (report / garbage / floor plan) which don't apply to a joining member.
 */
export function JoinHouseholdScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const pendingJoinToken = useInviteStore((s) => s.pendingJoinToken);
  const clearPendingJoinToken = useInviteStore((s) => s.clearPendingJoinToken);
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);
  const { fetchHouseholds } = useHouseholdStore();

  const [stage, setStage] = useState<Stage>('validating');
  const [error, setError] = useState<string | null>(null);
  const [household, setHousehold] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState<'owner' | 'member'>('member');

  useEffect(() => {
    let cancelled = false;
    const validate = async () => {
      if (!pendingJoinToken) {
        setError('No invitation found.');
        setStage('invalid');
        return;
      }
      try {
        const result = await householdsApi.validateInviteLink(pendingJoinToken);
        if (cancelled) return;
        if (result.valid && result.household) {
          setHousehold(result.household);
          setRole((result.role as 'owner' | 'member') ?? 'member');
          setStage(result.alreadyMember ? 'already_member' : 'ready');
        } else {
          setError(result.error || 'This invite link is invalid or has expired.');
          setStage('invalid');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to validate invitation');
        setStage('invalid');
      }
    };
    validate();
    return () => {
      cancelled = true;
    };
  }, [pendingJoinToken]);

  // Finish onboarding: mark the household step + complete, flip the store, and
  // clear the token so the post-onboarding redirect doesn't re-trigger.
  //
  // The two step calls are recorded rather than awaited. Awaited they were the
  // worst instance of the stall `recordOnboardingStep` documents — TWO requests
  // in series, each with a 30s timeout and each able to add a token refresh and
  // a retry, in front of a member who has just been let into a home. Nothing
  // below reads their result. `fetchHouseholds` stays awaited: it is not
  // bookkeeping, it is what the screen after this one renders from.
  const finishOnboarding = async () => {
    recordOnboardingStep('household');
    recordOnboardingStep('complete');
    await fetchHouseholds().catch(() => {});
    clearPendingJoinToken();
    completeOnboarding();
  };

  const handleRequest = async () => {
    if (!pendingJoinToken) return;
    try {
      setStage('requesting');
      setError(null);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await householdsApi.requestToJoin(pendingJoinToken);
      trackEvent('household_join_requested', { status: result.status });
      if (result.status === 'already_member') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStage('already_member');
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage('requested');
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : 'Failed to send join request');
      setStage('ready');
    }
  };

  const renderBody = () => {
    if (stage === 'validating') {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography variant="body" color={colors.textSecondary} style={styles.loadingText}>
            Checking your invitation…
          </Typography>
        </View>
      );
    }

    if (stage === 'invalid') {
      return (
        <Card variant="filled" style={styles.card}>
          <Icon name="warning" size={40} color={colors.error} style={styles.icon} />
          <Typography variant="title2" weight="bold" style={styles.centered}>
            Invitation Unavailable
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            {error || 'This invite link is invalid or has expired. Ask the household owner for a new one.'}
          </Typography>
          <Button title="Continue" variant="primary" size="lg" onPress={finishOnboarding} fullWidth />
        </Card>
      );
    }

    if (stage === 'requested') {
      return (
        <Card variant="filled" style={styles.card}>
          <Icon name="mail" size={40} color={colors.primary} style={styles.icon} />
          <Typography variant="title1" weight="bold" style={styles.centered}>
            Request Sent
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            We've asked an owner of{' '}
            <Typography variant="body" weight="semibold">{household?.name}</Typography>{' '}
            to approve you. You'll get a notification once you're in.
          </Typography>
          <Button title={`Continue to ${ENV.APP_NAME}`} variant="primary" size="lg" onPress={finishOnboarding} fullWidth />
        </Card>
      );
    }

    if (stage === 'already_member') {
      return (
        <Card variant="filled" style={styles.card}>
          <Icon name="checkmark-circle" size={40} color={colors.primary} style={styles.icon} />
          <Typography variant="title1" weight="bold" style={styles.centered}>
            You're In!
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.message}>
            You're already a member of{' '}
            <Typography variant="body" weight="semibold">{household?.name}</Typography>.
          </Typography>
          <Button title={`Continue to ${ENV.APP_NAME}`} variant="primary" size="lg" onPress={finishOnboarding} fullWidth />
        </Card>
      );
    }

    // ready | requesting
    return (
      <Card variant="filled" style={styles.card}>
        <Icon name="home" size={40} color={colors.primary} style={styles.icon} />
        <Typography variant="title1" weight="bold" style={styles.centered}>
          Join a Home
        </Typography>
        <Typography variant="body" color={colors.textSecondary} style={styles.message}>
          You've been invited to join:
        </Typography>

        <Card variant="outlined" style={[styles.householdCard, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="title2" weight="semibold" style={styles.centered}>
            {household?.name}
          </Typography>
          <View style={styles.roleRow}>
            <Typography variant="caption1" color={colors.textSecondary}>Role:</Typography>
            <Chip
              label={role === 'owner' ? 'Owner' : 'Member'}
              variant={role === 'owner' ? 'primary' : 'secondary'}
              size="sm"
            />
          </View>
        </Card>

        <Card variant="outlined" style={[styles.infoCard, { backgroundColor: colors.primary + '10' }]}>
          <Typography variant="caption1" color={colors.textSecondary}>
            A household owner will review your request before you're added. You can skip and set up your own home instead.
          </Typography>
        </Card>

        {error && (
          <Typography variant="caption1" color={colors.error} style={styles.errorText}>
            {error}
          </Typography>
        )}

        <Button
          title="Request to Join"
          variant="primary"
          size="lg"
          onPress={handleRequest}
          loading={stage === 'requesting'}
          fullWidth
        />
        <View style={styles.skip}>
          <Button
            title="Skip — set up my own home"
            variant="ghost"
            size="md"
            onPress={() => {
              clearPendingJoinToken();
              finishOnboarding();
            }}
            disabled={stage === 'requesting'}
            fullWidth
          />
        </View>
      </Card>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        {/*
          The brand lockup moved INTO this header rather than sitting in the
          body below it, so the row carries a back arrow the way every other
          step's does. There is no forward chevron: accepting the invite is the
          only thing this screen is for, and its own buttons are the way past
          it.
        */}
        <OnboardingStepHeader
          testID="onboarding-join-household"
          currentStep={1}
          totalSteps={2}
          stepLabel="Join Home"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.container}>
          <View style={styles.content}>{renderBody()}</View>
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: { alignItems: 'center', marginVertical: 24 },
  content: { flex: 1, justifyContent: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16 },
  card: { padding: 28, alignItems: 'center' },
  icon: { marginBottom: 20 },
  centered: { textAlign: 'center', marginBottom: 8 },
  message: { marginBottom: 20, textAlign: 'center', lineHeight: 24 },
  householdCard: { padding: 16, marginBottom: 16, width: '100%', alignItems: 'center' },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  infoCard: { padding: 14, marginBottom: 20, width: '100%' },
  errorText: { marginBottom: 12, textAlign: 'center' },
  skip: { marginTop: 8, width: '100%' },
});
