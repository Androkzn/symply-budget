import React from 'react';
import { Modal, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import {
  CornerRadius,
  Elevation,
  Opacity,
  Spacing,
  Toast as ToastLayout,
  useAppColors,
} from '@theme';
import { isLocalFirstBuild } from '@utils/localFirst';

/**
 * Full-screen connectivity gate — mounted once at the app root, unconditional
 * on auth (a signed-out member on the login screen needs the same signal).
 * `useNetworkStatus` debounces and cross-checks `isConnected` +
 * `isInternetReachable`, so this only engages on a real, sustained outage —
 * not a brief Wi-Fi↔cellular handoff.
 *
 * Blocks every touch behind the same `transparent Modal` primitive
 * [ProcessingOverlay] uses (swallows the Android back button too), with a
 * persistent top banner carrying a manual Retry action — NetInfo's own
 * recovery signal can lag behind reality on some carriers / captive portals,
 * so the member isn't stuck waiting on the poller.
 *
 * **Never on a local-first build.** There the device's ledger is the source of
 * truth, so an outage costs the member nothing but sync latency — blocking the
 * whole UI over it would break the one promise local-first makes. The hook
 * still runs (see below), so this renders nothing at all rather than being
 * unmounted; the sync surfaces report "offline" in their own copy instead.
 */
export function NetworkBlockOverlay() {
  // Called before any early return, and deliberately still called on
  // local-first builds: this hook is the app's ONLY NetInfo subscription and
  // it drives React Query's `onlineManager`. Skipping it would leave
  // `onlineManager` permanently "online", so every remote query would fire
  // into a dead radio and surface a network error — the opposite of what
  // suppressing the overlay is for. Fed properly, React Query pauses those
  // queries instead and refetches on recovery.
  const { isOnline, isRetrying, retry } = useNetworkStatus();
  const colors = useAppColors();

  if (isLocalFirstBuild()) return null;
  if (isOnline) return null;

  const topOffset = Platform.OS === 'ios' ? ToastLayout.offsetTopIOS : ToastLayout.offsetTopAndroid;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={() => {}}
      testID="network-block-overlay"
    >
      <View
        style={[styles.scrim, { backgroundColor: colors.modalBackdrop }]}
        accessibilityViewIsModal
      >
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.error, top: topOffset },
            Platform.select({
              ios: {
                shadowColor: colors.black,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: Opacity.toast,
                shadowRadius: 8,
              },
              android: { elevation: Elevation.overlay },
            }),
          ]}
        >
          <Icon name="cloud-offline-outline" size={22} color={colors.white} style={styles.icon} />
          <View style={styles.textCol}>
            <Typography variant="body" weight="semibold" color={colors.white}>
              No internet connection
            </Typography>
            <Typography variant="caption1" color={colors.white} style={styles.caption}>
              Paused until you're back online.
            </Typography>
          </View>
          <TouchableOpacity
            onPress={retry}
            disabled={isRetrying}
            style={styles.retryButton}
            testID="network-block-retry"
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Typography variant="body" weight="semibold" color={colors.white}>
                Retry
              </Typography>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
  },
  banner: {
    position: 'absolute',
    left: Spacing.base,
    right: Spacing.base,
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: Spacing.sm,
  },
  textCol: {
    flex: 1,
  },
  caption: {
    marginTop: 2,
  },
  retryButton: {
    marginLeft: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    minWidth: 44,
    alignItems: 'center',
  },
});
