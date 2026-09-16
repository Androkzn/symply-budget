import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { householdsApi } from '@api/households';
import { SafeAreaView, AppBackground, HeaderLogo, AuthWave } from '@components/common';
import { Typography, Button, Card, Chip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import type { RootStackScreenProps } from '@navigation/types';
import { navigateToHouseholdMembers } from '@services/navigation';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import {Layout, useAppColors } from '@theme';


interface InvitationDetails {
  household: { id: string; name: string };
  role: 'owner' | 'member';
  expiresAt: string;
}

export function AcceptInviteScreen({
  route,
  navigation,
}: RootStackScreenProps<'AcceptInvite'>) {
  const colors = useAppColors();  const { token } = route.params;
  const { isAuthenticated } = useAuthStore();
  const { setCurrentHousehold, addHousehold, fetchHouseholds } = useHouseholdStore();

  const [isValidating, setIsValidating] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitationValid, setInvitationValid] = useState(false);
  const [invitationDetails, setInvitationDetails] = useState<InvitationDetails | null>(null);

  useEffect(() => {
  const validateToken = async () => {
    if (!token) {
      setError('Invalid invitation link');
      setIsValidating(false);
      return;
    }

    // If not authenticated, we can't validate the token server-side yet
    // Show the invitation UI and let them log in first
    if (!isAuthenticated) {
      setInvitationValid(true);
      setIsValidating(false);
      return;
    }

    // Validate the token with the backend
    try {
      setError(null);
      const result = await householdsApi.validateInvitation(token);
      
      if (result.valid && result.household) {
        setInvitationValid(true);
        setInvitationDetails({
          household: result.household,
          role: result.role as 'owner' | 'member',
          expiresAt: result.expiresAt || '',
        });
      } else {
        setInvitationValid(false);
        setError(result.error || 'Invalid or expired invitation');
      }
    } catch (err) {
      // Handle specific error cases
      const errorMessage = err instanceof Error ? err.message : 'Failed to validate invitation';
      if (errorMessage.includes('already a member')) {
        setError('You are already a member of this property');
      } else if (errorMessage.includes('expired')) {
        setError('This invitation has expired. Please ask for a new invitation.');
      } else if (errorMessage.includes('different email')) {
        setError('This invitation was sent to a different email address. Please use the correct account.');
      } else {
        setError(errorMessage);
      }
      setInvitationValid(false);
    } finally {
      setIsValidating(false);
    }
  };

    void validateToken();
  }, [token, isAuthenticated]);

  const handleAccept = async () => {
    if (!isAuthenticated) {
      // User needs to log in first - pass token for redirect
      navigation.navigate('Auth', {
        screen: 'Login',
        params: { redirectTo: 'AcceptInvite', inviteToken: token },
      });
      return;
    }

    try {
      setIsAccepting(true);
      setError(null);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const { household } = await householdsApi.acceptInvitation(token);

      // Refresh households list and set current
      await fetchHouseholds();
      addHousehold(household);
      setCurrentHousehold(household);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to the household members screen
      router.replace('/');
      navigateToHouseholdMembers(household.id);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      
      // Handle specific error cases
      const errorMessage = err instanceof Error ? err.message : 'Failed to accept invitation';
      if (errorMessage.includes('already a member')) {
        setError('You are already a member of this property');
      } else if (errorMessage.includes('expired')) {
        setError('This invitation has expired. Please ask for a new invitation.');
      } else if (errorMessage.includes('different email')) {
        setError('This invitation was sent to a different email address. Please use the correct account.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDecline = () => {
    router.replace('/');
  };

  if (isValidating) {
    return (
      <AppBackground opacity={0.5}>
        <AuthWave />
        <SafeAreaView edges={['top', 'bottom']} testID="accept-invite-screen">
          <View style={styles.container}>
            <View style={styles.header}>
              <HeaderLogo height={48} />
            </View>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.loadingText}
              >
                Validating invitation...
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (error || !invitationValid) {
    return (
      <AppBackground opacity={0.5}>
        <AuthWave />
        <SafeAreaView edges={['top', 'bottom']} testID="accept-invite-screen">
          <View style={styles.container}>
            <View style={styles.header}>
              <HeaderLogo height={48} />
            </View>

            <View style={styles.content}>
              <Card variant="filled" style={styles.errorCard}>
                <Icon
                  name="warning"
                  size={64}
                  color={colors.error}
                  style={styles.errorIcon}
                />
                <Typography variant="title2" weight="bold" style={styles.errorTitle}>
                  Invalid Invitation
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.errorMessage}
                >
                  {error ||
                    'This invitation link is invalid or has expired. Please ask the property owner to send you a new invitation.'}
                </Typography>
                <Button
                  title="Go to Home"
                  variant="primary"
                  size="lg"
                  onPress={handleDecline}
                  fullWidth
                />
              </Card>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
        <AuthWave />
      <SafeAreaView edges={['top', 'bottom']}>
        <View style={styles.container}>
          <View style={styles.header}>
            <HeaderLogo height={48} />
          </View>

          <View style={styles.content}>
            <Card variant="filled" style={styles.inviteCard}>
              <Icon
                name="home"
                size={64}
                color={colors.primary}
                style={styles.inviteIcon}
              />

              <Typography variant="title1" weight="bold" style={styles.inviteTitle}>
                You've Been Invited!
              </Typography>

              {invitationDetails ? (
                <>
                  <Typography
                    variant="body"
                    color={colors.textSecondary}
                    style={styles.inviteMessage}
                  >
                    You've been invited to join:
                  </Typography>
                  
                  <Card
                    variant="outlined"
                    style={[styles.householdCard, { backgroundColor: colors.backgroundSecondary }]}
                  >
                    <Typography variant="title2" weight="semibold" style={styles.householdName}>
                      {invitationDetails.household.name}
                    </Typography>
                    <View style={styles.roleRow}>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Role:
                      </Typography>
                      <Chip
                        label={invitationDetails.role === 'owner' ? 'Owner' : 'Member'}
                        variant={invitationDetails.role === 'owner' ? 'primary' : 'secondary'}
                        size="sm"
                      />
                    </View>
                  </Card>
                </>
              ) : (
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.inviteMessage}
                >
                  You've been invited to join a household on {ENV.APP_NAME}. Accept
                  this invitation to start collaborating.
                </Typography>
              )}

              {!isAuthenticated && (
                <Card
                  variant="outlined"
                  style={[
                    styles.infoCard,
                    { backgroundColor: colors.primary + '10' },
                  ]}
                >
                  <Typography variant="caption1" color={colors.textSecondary}>
                    You'll need to log in or create an account to accept this invitation.
                  </Typography>
                </Card>
              )}

              {error && (
                <Card
                  variant="outlined"
                  style={[
                    styles.infoCard,
                    { backgroundColor: colors.error + '10', borderColor: colors.error },
                  ]}
                >
                  <Typography variant="caption1" color={colors.error}>
                    {error}
                  </Typography>
                </Card>
              )}

              <View style={styles.actions}>
                <View style={styles.actionButton}>
                  <Button
                    title="Decline"
                    variant="secondary"
                    size="lg"
                    onPress={handleDecline}
                    disabled={isAccepting}
                    fullWidth
                  />
                </View>
                <View style={styles.actionButton}>
                  <Button
                    title={isAuthenticated ? 'Accept Invitation' : 'Log In & Accept'}
                    variant="primary"
                    size="lg"
                    onPress={handleAccept}
                    loading={isAccepting}
                    fullWidth
                    testID="accept-invite-accept-button"
                  />
                </View>
              </View>
            </Card>
          </View>
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
  header: {
    alignItems: 'center',
    marginBottom: 40,
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
    marginTop: 16,
  },
  inviteCard: {
    padding: 32,
    alignItems: 'center',
  },
  inviteIcon: {
    marginBottom: 24,
  },
  inviteTitle: {
    marginBottom: 16,
    textAlign: 'center',
  },
  inviteMessage: {
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  householdCard: {
    padding: 16,
    marginBottom: 24,
    width: '100%',
    alignItems: 'center',
  },
  householdName: {
    marginBottom: 8,
    textAlign: 'center',
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoCard: {
    padding: 16,
    marginBottom: 24,
    width: '100%',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  actionButton: {
    flex: 1,
  },
  errorCard: {
    padding: 32,
    alignItems: 'center',
  },
  errorIcon: {
    marginBottom: 24,
  },
  errorTitle: {
    marginBottom: 16,
    textAlign: 'center',
  },
  errorMessage: {
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 24,
  },
});
