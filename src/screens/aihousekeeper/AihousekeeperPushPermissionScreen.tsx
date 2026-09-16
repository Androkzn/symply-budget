import { useNavigation } from "expo-router/react-navigation";
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppBackground } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { notificationService } from '@services/notifications';
import { useAihousekeeperStore } from '@stores/aihousekeeperStore';
import { useAppColors } from '@theme';

/**
 * Plan §H5 push permission rationale screen.
 *
 * Shown after sign-in when push permission is `undetermined`.
 *
 * - "Allow notifications" → triggers OS prompt via notificationService.
 * - "Maybe later"         → writes ISO8601 to `pushPromptDismissedAt`
 *                           (re-prompt rule: 7 days if still undetermined).
 */
export function AihousekeeperPushPermissionScreen() {
  const colors = useAppColors();  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const setPushPromptDismissedAt = useAihousekeeperStore(
    (s) => s.setPushPromptDismissedAt
  );
  const { name: personaName } = useAihousekeeperPersona();
  const [pending, setPending] = useState(false);

  const handleAllow = async () => {
    setPending(true);
    try {
      const granted = await notificationService.requestPermission();
      if (granted) {
        await notificationService.registerWithServer();
      }
    } finally {
      setPending(false);
      navigation.goBack();
    }
  };

  const handleMaybeLater = () => {
    setPushPromptDismissedAt(new Date().toISOString());
    navigation.goBack();
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <AdaptiveContainer
          maxWidth={isTablet ? 600 : undefined}
          padding={containerPadding}
        >
          <View style={styles.content}>
            <View style={styles.hero}>
              <Icon
                name="notifications"
                size={72}
                color={colors.primary}
                style={styles.icon}
              />
              <Typography
                variant="title3"
                weight="bold"
                style={styles.title}
              >
                Let {personaName} tap your shoulder?
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.body}
              >
                {personaName} can quietly tap your shoulder about the 1–2
                things that actually matter each day. No spam — {personaName}{' '}
                is hard-capped at three pings a day and respects your quiet
                hours.
              </Typography>
            </View>

            <View style={styles.buttons}>
              <Button
                title="Allow notifications"
                variant="primary"
                size="lg"
                onPress={handleAllow}
                disabled={pending}
              />
              <View style={{ height: 12 }} />
              <Button
                title="Maybe later"
                variant="secondary"
                size="lg"
                onPress={handleMaybeLater}
                disabled={pending}
              />
            </View>
          </View>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

/**
 * Utility for the caller: should the rationale screen be shown right now?
 *
 * Returns true if permission is `undetermined` AND either never-dismissed OR
 * dismissed more than 7 days ago. Kept as a pure predicate so the caller
 * (App init / post-sign-in flow) can invoke it against the
 * `pushPromptDismissedAt` value pulled from `useAihousekeeperStore`.
 */
export function shouldShowAihousekeeperPushRationale(
  permissionStatus: 'granted' | 'denied' | 'undetermined',
  pushPromptDismissedAt: string | null,
  now: Date = new Date()
): boolean {
  if (permissionStatus !== 'undetermined') return false;
  if (!pushPromptDismissedAt) return true;
  const dismissed = Date.parse(pushPromptDismissedAt);
  if (Number.isNaN(dismissed)) return true;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return now.getTime() - dismissed >= sevenDaysMs;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingVertical: 32 },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  icon: {
    marginBottom: 24,
  },
  title: { textAlign: 'center', marginBottom: 12 },
  body: { textAlign: 'center', lineHeight: 24 },
  buttons: { paddingHorizontal: 24, paddingBottom: 16 },
});
