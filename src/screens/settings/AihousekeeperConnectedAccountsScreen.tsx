import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from "expo-router/react-navigation";
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { oauthGoogleApi } from '@api/oauthGoogle';
import { brand } from '@brand';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

// Required for web; no-op on native. Must run at module scope.
WebBrowser.maybeCompleteAuthSession();

const APP_CALLBACK_URL = `${brand.scheme}://oauth/google/callback`;

/**
 * Aihousekeeper Connected Accounts (plan §H2).
 *
 * Backend-driven OAuth: the mobile app asks the Worker for a signed Google
 * consent URL, opens it with `WebBrowser.openAuthSessionAsync`, and waits for
 * the Worker's callback to 302 back to `simplehouse://oauth/google/callback`.
 * `openAuthSessionAsync` detects the custom-scheme redirect, dismisses the
 * in-app browser, and resolves the promise. We then refetch the status.
 */
export function AihousekeeperConnectedAccountsScreen() {
  const colors = useAppColors();  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const { name: personaName } = useAihousekeeperPersona();
  const queryClient = useQueryClient();
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id ?? null);

  const statusQuery = useQuery({
    queryKey: ['oauth-google-status', householdId],
    queryFn: () => oauthGoogleApi.status(householdId as string),
    enabled: !!householdId,
  });

  const invalidateStatus = useCallback(() => {
    if (householdId) {
      queryClient.invalidateQueries({
        queryKey: ['oauth-google-status', householdId],
      });
    }
  }, [householdId, queryClient]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!householdId) throw new Error('No household selected');
      const { url } = await oauthGoogleApi.start(householdId, brand.scheme);
      const result = await WebBrowser.openAuthSessionAsync(url, APP_CALLBACK_URL);
      return result;
    },
    onSuccess: (result) => {
      if (result.type === 'success' && result.url) {
        try {
          const parsed = new URL(result.url);
          const status = parsed.searchParams.get('status');
          if (status === 'success') {
            invalidateStatus();
            return;
          }
          const reason = parsed.searchParams.get('reason') ?? 'Unknown error';
          Alert.alert('Could not connect', `Google returned: ${reason}`);
        } catch {
          // Malformed URL — treat as success and refetch to reconcile.
          invalidateStatus();
        }
      }
      // result.type === 'cancel' | 'dismiss' | 'locked' — silent no-op.
    },
    onError: (err) => {
      Alert.alert(
        'Could not start sign-in',
        err instanceof Error ? err.message : 'Please try again.'
      );
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!householdId) throw new Error('No household selected');
      return oauthGoogleApi.disconnect(householdId);
    },
    onSuccess: invalidateStatus,
    onError: (err) => {
      Alert.alert(
        'Could not disconnect',
        err instanceof Error ? err.message : 'Please try again.'
      );
    },
  });

  const handleConnect = () => connectMutation.mutate();

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Google Calendar?',
      `${personaName} will stop proposing calendar slots until you reconnect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => disconnectMutation.mutate(),
        },
      ]
    );
  };

  const isConnected = statusQuery.data?.connected === true;
  const isBusy =
    connectMutation.isPending ||
    disconnectMutation.isPending ||
    statusQuery.isLoading;

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="Connected accounts"
          showBackButton
          onBackPress={() => navigation.goBack()}
        />
        <AdaptiveContainer
          maxWidth={isTablet ? 800 : undefined}
          padding={containerPadding}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.intro}
            >
              Link external accounts so {personaName} can coordinate across
              your calendar and contractors.
            </Typography>

            <Card
              variant="filled"
              style={[
                styles.accountCard,
                { backgroundColor: colors.backgroundSecondary },
              ]}
            >
              <Typography variant="body" weight="semibold">
                Google Calendar
              </Typography>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.description}
              >
                Allow {personaName} to propose calendar slots when scheduling
                contractor visits. {personaName} never writes events without
                your confirmation.
              </Typography>

              {statusQuery.isLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : isConnected ? (
                <>
                  <Typography
                    variant="footnote"
                    color={colors.success ?? colors.primary}
                    style={styles.statusText}
                  >
                    Connected
                    {statusQuery.data?.linked_at
                      ? ` · linked ${new Date(
                          statusQuery.data.linked_at
                        ).toLocaleDateString()}`
                      : ''}
                  </Typography>
                  <View style={styles.buttonRow}>
                    <Button
                      title="Disconnect"
                      variant="secondary"
                      size="md"
                      onPress={handleDisconnect}
                      disabled={isBusy}
                      loading={disconnectMutation.isPending}
                    />
                  </View>
                </>
              ) : (
                <View style={styles.buttonRow}>
                  <Button
                    title="Connect Google Calendar"
                    variant="primary"
                    size="md"
                    onPress={handleConnect}
                    disabled={!householdId || isBusy}
                    loading={connectMutation.isPending}
                  />
                </View>
              )}
            </Card>
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  intro: { marginBottom: 16, marginTop: 8 },
  accountCard: { marginBottom: 12 },
  description: { marginTop: 4 },
  loadingRow: { marginTop: 12, alignItems: 'flex-start' },
  statusText: { marginTop: 8 },
  buttonRow: { marginTop: 12 },
});
