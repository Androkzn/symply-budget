import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
  type PermissionResponse,
} from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProcessingOverlay } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * `HealthScanCamera` — the ONE live full-screen camera primitive behind every
 * donor camera-scan surface: Barcode, Nutrition Label and Weigh-Food (Scale).
 *
 * Ports the donor's three near-identical `UIViewControllerRepresentable`
 * camera controllers (`BarcodeScannerView`, `NutritionLabelScannerView`,
 * `ScaleFoodCaptureView` — SimpleHealth/Presentation/Features/…) into ONE
 * component with a frame-shape/color/hint prop surface, rather than porting
 * three separate screens. All three donor screens share the same chrome (back
 * arrow, flash toggle, black background, corner-marked frame, bottom hint
 * row, blocking processing overlay, permission-denied state) and differ only
 * in the frame's shape/color and whether capture is a manual shutter or a
 * continuous barcode scan — exactly what the props below vary.
 *
 * DELIBERATE DIFFERENCES FROM THE DONOR:
 *
 *  - **Brand palette, not the donor's literal colors.** The donor hardcodes
 *    green (barcode), orange/yellow (label) and blue/cyan (scale) gradients.
 *    Every brand in this ecosystem ships its own palette (`brands/<id>/brand.cjs`),
 *    so the frame/hint accent is a prop the CALLER resolves from
 *    `useAppColors()` — Symply Health passes its brand red family — rather
 *    than a hardcoded hex baked into this shared file.
 *  - **No gradient border, no animated scan-line.** The donor strokes the
 *    frame with a `LinearGradient` and animates a moving scan line across the
 *    barcode frame. Reproducing that needs `expo-linear-gradient` (not a
 *    dependency here) and an `Animated` loop for a purely decorative touch;
 *    the frame is a solid brand-color border with corner brackets instead —
 *    same guidance, no new dependency.
 *  - **The donor's Photo-AI (meal photo) camera is NOT this component.** Its
 *    own source (`FoodImageAnalysis/FoodCameraView.swift`) uses the plain
 *    system camera (`UIImagePickerController`) with no custom frame at all —
 *    only Barcode, Label and Scale get the guided overlay. `HealthScanScreen`
 *    keeps its existing system-camera capture for meal-photo mode and reaches
 *    for this component only in label/scale mode.
 */

export type HealthScanFrameShape = 'landscape' | 'portrait' | 'dashed';

export interface HealthScanCameraHint {
  /** Ionicons glyph name (or a brand-kit slug — falls through automatically). */
  icon: string;
  label: string;
}

export interface HealthScanCameraCapture {
  uri: string;
  name: string;
}

export interface HealthScanCameraProps {
  visible: boolean;
  onClose: () => void;
  /** Top bar title, e.g. "Scan Barcode". */
  title: string;
  /** Guidance line rendered under the frame. */
  instruction: string;
  /** Bottom hint row — 2 or 3 short icon+label tips. */
  hints: HealthScanCameraHint[];
  frameShape: HealthScanFrameShape;
  /** Frame border / hint-icon accent — brand-derived, resolved by the caller. */
  accentColor: string;
  /** Icon centered inside the frame (e.g. a scale glyph). Scale mode only. */
  frameIcon?: string;
  /** Secondary line under `frameIcon`, inside the frame. */
  frameCaption?: string;

  /**
   * Barcode mode: continuous auto-detect, no shutter button. Mutually
   * exclusive with `onCapture` — pass exactly one.
   */
  onBarcodeScanned?: (data: string, type: string) => void;
  barcodeTypes?: BarcodeType[];

  /** Photo mode: manual white shutter button. */
  onCapture?: (capture: HealthScanCameraCapture) => void | Promise<void>;

  /** Blocking overlay while the caller processes what the camera handed back. */
  processing?: boolean;
  processingMessage?: string;
}

/** Donor's `VNDetectBarcodesRequest.symbologies` (BarcodeScannerView.swift), translated to expo-camera's names. */
export const HEALTH_BARCODE_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
];

/** Donor's `handleBarcodeDetected` debounce window — same barcode, same 2s. */
const BARCODE_DEBOUNCE_MS = 2000;

export function HealthScanCamera({
  visible,
  onClose,
  title,
  instruction,
  hints,
  frameShape,
  accentColor,
  frameIcon,
  frameCaption,
  onBarcodeScanned,
  barcodeTypes,
  onCapture,
  processing = false,
  processingMessage,
}: HealthScanCameraProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [flashOn, setFlashOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const lastBarcodeRef = useRef<{ data: string; at: number } | null>(null);

  const isBarcodeMode = onBarcodeScanned !== undefined;

  // Ask once the sheet is actually open — asking behind a closed modal would
  // fire the OS prompt before the member has any context for it.
  useEffect(() => {
    if (visible && permission !== null && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  // Reset per-open transient state so a stale error/flash setting from a
  // previous session never reappears on the next.
  useEffect(() => {
    if (visible) {
      setMountError(null);
      setCapturing(false);
      lastBarcodeRef.current = null;
    }
  }, [visible]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (!isBarcodeMode || processing) return;
      const now = Date.now();
      const last = lastBarcodeRef.current;
      // Same code within the debounce window is a duplicate detection, not a
      // second scan — the donor's own `handleBarcodeDetected` rule.
      if (last && last.data === result.data && now - last.at < BARCODE_DEBOUNCE_MS) return;
      lastBarcodeRef.current = { data: result.data, at: now };
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onBarcodeScanned?.(result.data, result.type);
    },
    [isBarcodeMode, processing, onBarcodeScanned]
  );

  const handleShutter = useCallback(async () => {
    if (!onCapture || capturing || processing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85, base64: false });
      if (photo?.uri) {
        const ext = photo.format === 'png' ? 'png' : 'jpg';
        await onCapture({ uri: photo.uri, name: `scan-${Date.now()}.${ext}` });
      } else {
        setMountError('That photo could not be captured. Try again.');
      }
    } catch {
      setMountError('That photo could not be captured. Try again.');
    } finally {
      setCapturing(false);
    }
  }, [onCapture, capturing, processing]);

  if (!visible) return null;

  const granted = permission?.granted === true;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      testID="health-scan-camera-modal"
    >
      <View style={styles.root} testID="health-scan-camera">
        {granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={flashOn}
            animateShutter={false}
            onMountError={() => setMountError('The camera could not be started.')}
            barcodeScannerSettings={
              isBarcodeMode ? { barcodeTypes: barcodeTypes ?? HEALTH_BARCODE_TYPES } : undefined
            }
            onBarcodeScanned={isBarcodeMode ? handleBarcodeScanned : undefined}
            testID="health-scan-camera-view"
          />
        ) : (
          <PermissionGate permission={permission} onRequest={() => void requestPermission()} />
        )}

        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close camera"
            testID="health-scan-camera-close"
            style={styles.iconButton}
            hitSlop={12}
          >
            <Icon name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>
          <Typography variant="headline" weight="semibold" color="#FFFFFF">
            {title}
          </Typography>
          <Pressable
            onPress={() => setFlashOn((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={flashOn ? 'Turn flash off' : 'Turn flash on'}
            testID="health-scan-camera-flash"
            style={styles.iconButton}
            hitSlop={12}
          >
            <Icon
              name={flashOn ? 'flash' : 'flash-off'}
              size={22}
              color={flashOn ? colors.warning : '#FFFFFF'}
            />
          </Pressable>
        </View>

        {granted && (
          <View style={styles.guideLayer} pointerEvents="none">
            <FrameGuide
              shape={frameShape}
              accentColor={accentColor}
              icon={frameIcon}
              caption={frameCaption}
            />
            <Typography variant="footnote" color="#FFFFFF" style={styles.instruction}>
              {instruction}
            </Typography>
          </View>
        )}

        {granted && hints.length > 0 && (
          <View
            style={[styles.hintRow, { paddingBottom: insets.bottom + Spacing.lg }]}
            testID="health-scan-camera-hints"
          >
            {hints.map((hint) => (
              <View key={hint.label} style={styles.hintItem}>
                <Icon name={hint.icon} size={20} color={accentColor} />
                <Typography variant="caption2" color="rgba(255,255,255,0.85)">
                  {hint.label}
                </Typography>
              </View>
            ))}
          </View>
        )}

        {granted && onCapture !== undefined && (
          <Pressable
            onPress={() => void handleShutter()}
            disabled={capturing || processing}
            accessibilityRole="button"
            accessibilityState={{ disabled: capturing || processing }}
            accessibilityLabel="Take photo"
            testID="health-scan-camera-shutter"
            style={[
              styles.shutterOuter,
              { bottom: insets.bottom + Spacing.xxl, opacity: capturing || processing ? 0.5 : 1 },
            ]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
        )}

        {mountError !== null && (
          <View style={styles.errorToast} testID="health-scan-camera-error">
            <Icon name="warning-outline" size={16} color={colors.warning} />
            <Typography variant="footnote" color="#FFFFFF" style={styles.errorText}>
              {mountError}
            </Typography>
            <Pressable
              onPress={() => setMountError(null)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              testID="health-scan-camera-error-dismiss"
            >
              <Typography variant="caption1" weight="semibold" color="#FFFFFF">
                Dismiss
              </Typography>
            </Pressable>
          </View>
        )}

        <ProcessingOverlay
          visible={processing}
          message={processingMessage ?? 'Working…'}
          embedded
          testID="health-scan-camera-processing"
        />
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
      <View style={styles.center} testID="health-scan-camera-checking">
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Typography variant="footnote" color="#FFFFFF" style={styles.checkingText}>
          Checking camera access…
        </Typography>
      </View>
    );
  }

  return (
    <View style={styles.center} testID="health-scan-camera-permission-denied">
      <Icon name="camera-outline" size={48} color="#FFFFFF" />
      <Typography variant="title3" weight="semibold" color="#FFFFFF" style={styles.permissionTitle}>
        Camera access needed
      </Typography>
      <Typography variant="footnote" color="rgba(255,255,255,0.8)" style={styles.permissionBody}>
        Allow camera access to scan and photograph food.
      </Typography>
      {permission.canAskAgain ? (
        <Pressable
          onPress={onRequest}
          accessibilityRole="button"
          accessibilityLabel="Allow camera access"
          testID="health-scan-camera-request-permission"
          style={styles.permissionButton}
        >
          <Typography variant="footnote" weight="semibold" color="#FFFFFF">
            Allow camera access
          </Typography>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
          testID="health-scan-camera-open-settings"
          style={styles.permissionButton}
        >
          <Typography variant="footnote" weight="semibold" color="#FFFFFF">
            Open Settings
          </Typography>
        </Pressable>
      )}
    </View>
  );
}

function FrameGuide({
  shape,
  accentColor,
  icon,
  caption,
}: {
  shape: HealthScanFrameShape;
  accentColor: string;
  icon?: string;
  caption?: string;
}) {
  const frameStyle =
    shape === 'landscape'
      ? styles.frameLandscape
      : shape === 'portrait'
        ? styles.framePortrait
        : styles.frameDashed;

  return (
    <View
      style={[
        frameStyle,
        {
          borderColor: accentColor,
          borderStyle: shape === 'dashed' ? 'dashed' : 'solid',
        },
      ]}
      testID="health-scan-camera-frame"
    >
      {icon !== undefined && (
        <View style={styles.frameContent}>
          <Icon name={icon} size={44} color="rgba(255,255,255,0.7)" />
          {caption !== undefined && (
            <Typography variant="caption1" color="rgba(255,255,255,0.8)" style={styles.frameCaption}>
              {caption}
            </Typography>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
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
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instruction: {
    marginTop: Spacing.base,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  frameLandscape: {
    width: 280,
    height: 160,
    borderWidth: 3,
    borderRadius: CornerRadius.md,
  },
  framePortrait: {
    width: 280,
    height: 380,
    borderWidth: 3,
    borderRadius: CornerRadius.md,
  },
  frameDashed: {
    width: 300,
    height: 280,
    borderWidth: 3,
    borderRadius: CornerRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  frameCaption: {
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  hintRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  hintItem: {
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  shutterOuter: {
    position: 'absolute',
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  checkingText: {
    marginTop: Spacing.base,
  },
  permissionTitle: {
    marginTop: Spacing.base,
  },
  permissionBody: {
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  errorToast: {
    position: 'absolute',
    bottom: 140,
    left: Spacing.base,
    right: Spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    backgroundColor: 'rgba(40,40,40,0.95)',
  },
  errorText: {
    flex: 1,
  },
});

export default HealthScanCamera;
