import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type PermissionResponse,
} from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * The raw decoded payload — a `simplehouse://lf-invite?…` link when the code
   * came from this app, but deliberately NOT parsed here.
   *
   * The screen owns what an unrecognised code means, because that answer is a
   * sentence to the person joining ("that is not a Symply House invite"), not a
   * null this component could do anything useful with.
   */
  onScanned: (payload: string) => void;
};

/**
 * The camera half of the invite hand-off — Join → Scan QR code.
 *
 * Fires ONCE per opening. A QR in the frame decodes on every camera frame, so
 * `onBarcodeScanned` runs dozens of times a second while the phone is held
 * still; without the latch below, the join confirmation would be re-opened (and
 * the fields refilled) continuously and the sheet would appear to freeze.
 *
 * The scanner is a convenience, never the only way in: every failure path here —
 * no permission, no camera, a code from some other app — ends by pointing at the
 * code and secret fields behind it, which are always available.
 */
export function HouseInviteQrScanner({ visible, onClose, onScanned }: Props) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const handled = useRef(false);

  // Asked only once the camera is actually on screen: an OS prompt that fires
  // behind a closed modal arrives with nothing to explain it.
  useEffect(() => {
    if (visible && permission !== null && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  // Re-arm on each opening, and drop a torch left on by the previous scan.
  useEffect(() => {
    if (visible) {
      handled.current = false;
      setMountError(null);
      setTorchOn(false);
    }
  }, [visible]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (handled.current) return;
      handled.current = true;
      // The camera is about to be dismissed by the caller, so this is the only
      // signal that anything was read at all.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onScanned(result.data);
    },
    [onScanned],
  );

  if (!visible) return null;

  const granted = permission?.granted === true;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      testID="house-invite-scanner-modal"
    >
      <View style={styles.root} testID="house-invite-scanner">
        {granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torchOn}
            animateShutter={false}
            onMountError={() =>
              setMountError('The camera could not be started. Enter the code and secret instead.')
            }
            // QR only. Every other symbology this camera can read is something we
            // would have to reject anyway, and narrowing the set keeps a barcode
            // on a nearby cereal box from claiming the one scan.
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcodeScanned}
            testID="house-invite-scanner-camera"
          />
        ) : (
          <PermissionGate permission={permission} onRequest={() => void requestPermission()} />
        )}

        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close scanner"
            testID="house-invite-scanner-close"
            style={styles.iconButton}
            hitSlop={12}
          >
            <Icon name="close" forceIonicons size={22} color="#FFFFFF" />
          </Pressable>
          <Typography variant="headline" weight="semibold" color="#FFFFFF">
            Scan invite
          </Typography>
          {granted ? (
            <Pressable
              onPress={() => setTorchOn((on) => !on)}
              accessibilityRole="button"
              accessibilityLabel={torchOn ? 'Turn the light off' : 'Turn the light on'}
              testID="house-invite-scanner-torch"
              style={styles.iconButton}
              hitSlop={12}
            >
              <Icon
                name={torchOn ? 'flash' : 'flash-off'}
                forceIonicons
                size={22}
                color={torchOn ? colors.warning : '#FFFFFF'}
              />
            </Pressable>
          ) : (
            <View style={styles.iconButton} />
          )}
        </View>

        {granted ? (
          <View style={styles.guideLayer} pointerEvents="none">
            <View style={styles.frame} />
            <Typography variant="footnote" color="#FFFFFF" style={styles.instruction}>
              Point this at the invite QR code on their phone.
            </Typography>
            <Typography variant="caption2" color="rgba(255,255,255,0.75)" style={styles.instruction}>
              Symply House → Invite &amp; home → Invite → Generate QR code.
            </Typography>
          </View>
        ) : null}

        {mountError !== null ? (
          <View
            style={[styles.errorToast, { bottom: insets.bottom + Spacing.xl }]}
            testID="house-invite-scanner-error"
          >
            <Icon name="warning-outline" forceIonicons size={16} color={colors.warning} />
            <Typography variant="footnote" color="#FFFFFF" style={styles.errorText}>
              {mountError}
            </Typography>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function PermissionGate({
  permission,
  onRequest,
}: {
  permission: PermissionResponse | null;
  onRequest: () => void;
}) {
  if (permission === null) {
    return (
      <View style={styles.center} testID="house-invite-scanner-checking">
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Typography variant="footnote" color="#FFFFFF" style={styles.permissionBody}>
          Checking camera access…
        </Typography>
      </View>
    );
  }

  return (
    <View style={styles.center} testID="house-invite-scanner-permission-denied">
      <Icon name="camera-outline" forceIonicons size={48} color="#FFFFFF" />
      <Typography variant="title3" weight="semibold" color="#FFFFFF" style={styles.permissionTitle}>
        Camera access needed
      </Typography>
      <Typography variant="footnote" color="rgba(255,255,255,0.8)" style={styles.permissionBody}>
        Symply House uses the camera only to read the invite code you are shown. You can close this
        and type the code and secret instead.
      </Typography>
      <Pressable
        onPress={permission.canAskAgain ? onRequest : () => void Linking.openSettings()}
        accessibilityRole="button"
        accessibilityLabel={permission.canAskAgain ? 'Allow camera access' : 'Open Settings'}
        testID={
          permission.canAskAgain
            ? 'house-invite-scanner-request-permission'
            : 'house-invite-scanner-open-settings'
        }
        style={styles.permissionButton}
      >
        <Typography variant="footnote" weight="semibold" color="#FFFFFF">
          {permission.canAskAgain ? 'Allow camera access' : 'Open Settings'}
        </Typography>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  guideLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  // A square, because a QR is square — an aiming box of the wrong shape invites
  // people to fill it, and a code held at that distance is out of focus.
  frame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: CornerRadius.lg,
  },
  instruction: { textAlign: 'center', paddingHorizontal: Spacing.xl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  permissionTitle: { textAlign: 'center' },
  permissionBody: { textAlign: 'center' },
  permissionButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.xxl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  errorToast: {
    position: 'absolute',
    left: Spacing.base,
    right: Spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  errorText: { flex: 1 },
});

export default HouseInviteQrScanner;
