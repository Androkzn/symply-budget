import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { smartEngineApi, type TransferConsentRecord, type TransferPackageId } from '@api/smart-engine';
import { brand, isHouseBudgetTransferPair, isHouseOrFullBudgetBrand } from '@brand';
import { SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { resolveSoftTransferErrorMessage } from './errors';
import { getBrandDisplayName, getPackageLabel } from './labels';

type DataSharingNavigation = NativeStackNavigationProp<Record<string, object | undefined>>;

function isHouseBudgetConsent(consent: TransferConsentRecord): boolean {
  return isHouseBudgetTransferPair(consent.source_brand_id, consent.destination_brand_id);
}

export function DataSharingScreen() {  const colors = useAppColors();
  const navigation = useNavigation<DataSharingNavigation>();
  const localHouseholds = useHouseholdStore((s) => s.households);

  const [consents, setConsents] = useState<TransferConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const rows = await smartEngineApi.listConsents();
      setConsents(rows.filter((c) => c.status === 'active' && isHouseBudgetConsent(c)));
    } catch (error) {
      setErrorMessage(resolveSoftTransferErrorMessage(error));
      setConsents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const handleRevoke = (consent: TransferConsentRecord) => {
    Alert.alert(
      'Revoke data sharing?',
      `Stop sharing ${getPackageLabel(consent.package_id as TransferPackageId).title} between ${getBrandDisplayName(consent.source_brand_id)} and ${getBrandDisplayName(consent.destination_brand_id)}.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevokingId(consent.id);
            try {
              await smartEngineApi.revokeConsent(consent.id);
              await load();
            } catch (error) {
              Alert.alert('Could not revoke', resolveSoftTransferErrorMessage(error));
            } finally {
              setRevokingId(null);
            }
          },
        },
      ]
    );
  };

  const intro =
    isHouseOrFullBudgetBrand()
      ? 'Active permissions for sharing data between your linked Symply apps. Revoking stops future transfers; it does not undo data already imported.'
      : 'Active Soft Transfer permissions for this account.';

  return (
    <SafeAreaView edges={[]} testID="data-sharing-screen">
      <ScreenHeader
        title="Data sharing"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Typography variant="body" color={colors.textSecondary} style={styles.intro}>
          {intro}
        </Typography>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {errorMessage ? (
          <Card variant="filled" style={styles.messageCard}>
            <Typography variant="body" color={colors.textSecondary}>
              {errorMessage}
            </Typography>
          </Card>
        ) : null}

        {!loading && !errorMessage && consents.length === 0 ? (
          <Card variant="filled" style={styles.messageCard}>
            <Typography variant="body" weight="medium">
              No active sharing permissions
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              When you connect your Symply apps, active consents appear here.
            </Typography>
          </Card>
        ) : null}

        {consents.map((consent) => {
          const pkg = getPackageLabel(consent.package_id as TransferPackageId);
          const revoking = revokingId === consent.id;
          return (
            <Card key={consent.id} variant="filled" style={styles.consentCard}>
              <View style={styles.consentHeader}>
                <IconBackgroundChip name="swap-horizontal-outline" style={styles.iconWrap} />
                <View style={styles.consentText}>
                  <Typography variant="body" weight="semibold">
                    {pkg.title}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    {getBrandDisplayName(consent.source_brand_id)} →{' '}
                    {getBrandDisplayName(consent.destination_brand_id)}
                  </Typography>
                </View>
              </View>
              <Typography variant="footnote" color={colors.textSecondary}>
                {consent.purpose}
              </Typography>
              {consent.expires_at ? (
                <Typography variant="caption2" color={colors.textTertiary}>
                  Expires {new Date(consent.expires_at).toLocaleDateString()}
                </Typography>
              ) : (
                <Typography variant="caption2" color={colors.textTertiary}>
                  Active until revoked
                </Typography>
              )}
              <Typography
                variant="body"
                color={colors.primary}
                weight="medium"
                style={styles.revokeLink}
                onPress={revoking ? undefined : () => handleRevoke(consent)}
                testID={`revoke-consent-${consent.id}`}
              >
                {revoking ? 'Revoking…' : 'Revoke'}
              </Typography>
            </Card>
          );
        })}

        {localHouseholds.length > 0 ? (
          <Typography variant="caption2" color={colors.textTertiary} style={styles.footerNote}>
            Signed in as {brand.displayName}. Household context: {localHouseholds.length}{' '}
            {localHouseholds.length === 1 ? 'group' : 'groups'} on this device.
          </Typography>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.md,
  },
  intro: {
    marginBottom: Spacing.xs,
  },
  loading: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  messageCard: {
    padding: Spacing.lg,
    borderRadius: CornerRadius.lg,
    gap: Spacing.xs,
  },
  consentCard: {
    padding: Spacing.lg,
    borderRadius: CornerRadius.lg,
    gap: Spacing.sm,
  },
  consentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  revokeLink: {
    marginTop: Spacing.xs,
  },
  footerNote: {
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
});
