/**
 * "Get the Symply apps" — the ecosystem grid. Lists every OTHER Symply app with
 * an installed / not-installed status. Not-installed apps open the store; once
 * an app is installed (auto-detected on return, or confirmed manually) the user
 * can accept baseline data sharing with it, which grants a Soft Transfer
 * profile consent so the new app can pick up their Symply profile.
 *
 * Brand-neutral: renders in every brand's own name + palette. Shown in all five
 * apps (each lists the other four).
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { smartEngineApi, type TransferConsentRecord } from '@api/smart-engine';
import { getBrandImageAssets } from '@brand/assets';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { Card, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  getActiveAppName,
  getSiblingApps,
  type SiblingApp,
} from '@features/ecosystem/siblingApps';
import { useInstalledApps } from '@features/ecosystem/useInstalledApps';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type Status = 'not-installed' | 'installed' | 'connected';

function StatusPill({ status }: { status: Status }) {
  const colors = useAppColors();
  const config: Record<Status, { label: string; fg: string; bg: string; icon: string }> = {
    'not-installed': {
      label: 'Not installed',
      fg: colors.textSecondary,
      bg: colors.secondaryButtonBackground,
      icon: 'ellipse-outline',
    },
    installed: {
      label: 'Installed',
      fg: colors.statusComplete,
      bg: colors.statusCompleteBg,
      icon: 'checkmark-circle',
    },
    connected: {
      label: 'Connected',
      fg: colors.statusComplete,
      bg: colors.statusCompleteBg,
      icon: 'link',
    },
  };
  const c = config[status];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]} testID={`app-status-${status}`}>
      <Icon name={c.icon} size={13} color={c.fg} />
      <Typography variant="caption2" weight="medium" color={c.fg}>
        {c.label}
      </Typography>
    </View>
  );
}

function AppRow({
  app,
  status,
  onInstall,
  onConfirmInstalled,
  onOpen,
  onShare,
}: {
  app: SiblingApp;
  status: Status;
  onInstall: () => void;
  onConfirmInstalled: () => void;
  onOpen: () => void;
  onShare: () => void;
}) {
  const colors = useAppColors();
  const icon = getBrandImageAssets(app.id).appIcon;

  return (
    <Card variant="filled" style={styles.row} testID={`sibling-app-${app.id}`}>
      <View style={styles.rowTop}>
        <Image source={icon} style={styles.appIcon} resizeMode="cover" />
        <View style={styles.rowText}>
          <Typography variant="body" weight="semibold" numberOfLines={1}>
            {app.displayName}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {app.tagline}
          </Typography>
        </View>
        <StatusPill status={status} />
      </View>

      {status === 'not-installed' ? (
        <View style={styles.actions}>
          <GradientButton
            title="Install"
            variant="primary"
            size="sm"
            onPress={onInstall}
            style={styles.installBtn}
            testID={`install-${app.id}`}
          />
          <Pressable
            onPress={onConfirmInstalled}
            hitSlop={8}
            accessibilityRole="button"
            testID={`already-installed-${app.id}`}
          >
            <Typography variant="footnote" weight="medium" color={colors.textSecondary}>
              Already installed?
            </Typography>
          </Pressable>
        </View>
      ) : null}

      {status === 'installed' || status === 'connected' ? (
        <GradientButton
          title="Open"
          variant="secondary"
          size="sm"
          onPress={onOpen}
          fullWidth
          testID={`open-${app.id}`}
        />
      ) : null}

      {status === 'installed' && app.profileConsent ? (
        <GradientButton
          title="Accept data sharing"
          variant="primary"
          size="sm"
          onPress={onShare}
          fullWidth
          style={styles.shareBtn}
          testID={`share-${app.id}`}
        />
      ) : null}

      {status === 'installed' && !app.profileConsent ? (
        <Typography variant="caption1" color={colors.textTertiary} style={styles.note}>
          Data sharing with this app isn’t available yet.
        </Typography>
      ) : null}

      {status === 'connected' ? (
        <Typography variant="caption1" color={colors.textTertiary} style={styles.note}>
          Sharing your {getActiveAppName()} profile. Manage in Settings → Data sharing.
        </Typography>
      ) : null}
    </Card>
  );
}

export default function SymplyAppsScreen() {
  const router = useRouter();
  const apps = useMemo(() => getSiblingApps(), []);
  const { installed, recheck } = useInstalledApps(
    useMemo(() => apps.map((a) => ({ id: a.id, scheme: a.scheme })), [apps]),
  );

  // Apps the user manually confirmed as installed when auto-detection can't see
  // them (iOS without the query scheme, or a build predating it).
  const [manualInstalled, setManualInstalled] = useState<Record<string, boolean>>({});
  const [consents, setConsents] = useState<TransferConsentRecord[]>([]);

  const loadConsents = useCallback(async () => {
    try {
      const rows = await smartEngineApi.listConsents();
      setConsents(rows.filter((c) => c.status === 'active'));
    } catch {
      // Best-effort: some brands' Workers may not expose /smart-engine yet.
      setConsents([]);
    }
  }, []);

  // Refresh consents each time the screen focuses (e.g. after the share step).
  useFocusEffect(
    useCallback(() => {
      void loadConsents();
    }, [loadConsents]),
  );

  const isConnected = useCallback(
    (app: SiblingApp) => {
      const route = app.profileConsent;
      if (!route) return false;
      return consents.some(
        (c) =>
          c.package_id === route.packageId &&
          c.source_brand_id === route.sourceBrandId &&
          c.destination_brand_id === route.destinationBrandId,
      );
    },
    [consents],
  );

  const statusFor = useCallback(
    (app: SiblingApp): Status => {
      if (isConnected(app)) return 'connected';
      if (installed[app.id] || manualInstalled[app.id]) return 'installed';
      return 'not-installed';
    },
    [installed, manualInstalled, isConnected],
  );

  const handleInstall = useCallback(
    (app: SiblingApp) => {
      if (app.storeUrl) {
        void Linking.openURL(app.storeUrl);
      } else {
        Alert.alert(
          `${app.displayName} is coming soon`,
          'This app isn’t on the store yet. If you already have it, tap “Already installed?”.',
        );
      }
    },
    [],
  );

  const handleOpen = useCallback((app: SiblingApp) => {
    void Linking.openURL(`${app.scheme}://`);
  }, []);

  const handleShare = useCallback(
    (app: SiblingApp) => {
      router.push(`/symply-apps/share?app=${app.id}`);
    },
    [router],
  );

  return (
    <AIFlowScaffold
      title="Symply apps"
      subtitle={`Get the rest of the Symply family and share your ${getActiveAppName()} profile so each new app is set up in seconds.`}
      screenTestID="symply-apps-screen"
    >
      {apps.map((app) => {
        const status = statusFor(app);
        return (
          <AppRow
            key={app.id}
            app={app}
            status={status}
            onInstall={() => handleInstall(app)}
            onConfirmInstalled={() => {
              setManualInstalled((prev) => ({ ...prev, [app.id]: true }));
              void recheck();
              // Once confirmed installed, take them straight to data sharing.
              if (app.profileConsent) handleShare(app);
            }}
            onOpen={() => handleOpen(app)}
            onShare={() => handleShare(app)}
          />
        );
      })}
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
    gap: Spacing.sm,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  appIcon: {
    width: 52,
    height: 52,
    borderRadius: CornerRadius.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CornerRadius.full,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  installBtn: {
    flex: 1,
  },
  shareBtn: {
    marginTop: Spacing.xxs,
  },
  note: {
    marginTop: Spacing.xxs,
  },
});
