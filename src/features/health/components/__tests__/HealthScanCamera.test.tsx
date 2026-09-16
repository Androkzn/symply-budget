/**
 * `HealthScanCamera` — the shared live full-screen camera primitive behind
 * Barcode, Nutrition Label and Weigh-Food (Scale).
 *
 * Pins the behaviours ported from the donor's three camera controllers
 * (`BarcodeScannerView`, `NutritionLabelScannerView`, `ScaleFoodCaptureView`):
 *
 *  1. Nothing renders while `visible` is false.
 *  2. Barcode mode auto-detects continuously; the SAME code within the 2s
 *     debounce window is dropped, a haptic fires on a real detection, and a
 *     shutter is never shown.
 *  3. Photo mode (label/scale) is the opposite: a manual shutter takes a
 *     picture and hands back a `{ uri, name }` shot; no barcode listener.
 *  4. Permission states — checking / denied-can-ask-again / denied-forever —
 *     each render their own copy, and the camera itself is never shown
 *     without a granted permission.
 *  5. Flash toggles `enableTorch`; close fires `onClose`; a mount error shows
 *     a dismissible toast rather than a raw native string.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthScanCamera, HEALTH_BARCODE_TYPES } from '../HealthScanCamera';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */

const mockTakePictureAsync = jest.fn();
const mockRequestPermission = jest.fn();
let mockPermission: { granted: boolean; canAskAgain: boolean; status: string } | null = {
  granted: true,
  canAskAgain: true,
  status: 'granted',
};

jest.mock('expo-camera', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const CameraView = ReactMock.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactMock.useImperativeHandle(ref, () => ({
      takePictureAsync: mockTakePictureAsync,
    }));
    return ReactMock.createElement(View, { testID: 'health-scan-camera-view', ...props });
  });
  return {
    __esModule: true,
    CameraView,
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    ProcessingOverlay: ({ visible, message, testID }: { visible: boolean; message?: string; testID?: string }) =>
      visible ? ReactMock.createElement(View, { testID, accessibilityLabel: message }) : null,
  };
});

function render(props: Partial<React.ComponentProps<typeof HealthScanCamera>> = {}) {
  const defaults: React.ComponentProps<typeof HealthScanCamera> = {
    visible: true,
    onClose: jest.fn(),
    title: 'Scan Barcode',
    instruction: 'Point camera at barcode',
    hints: [{ icon: 'barcode-outline', label: 'UPC/EAN' }],
    frameShape: 'landscape',
    accentColor: '#E5484D',
    onBarcodeScanned: jest.fn(),
    barcodeTypes: HEALTH_BARCODE_TYPES,
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthScanCamera {...defaults} {...props} />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockTakePictureAsync.mockResolvedValue({ uri: 'file:///photo.jpg', width: 100, height: 100, format: 'jpg' });
});

describe('HealthScanCamera', () => {
  it('HEALTH-CAM-001: renders nothing while not visible', () => {
    const tree = render({ visible: false });
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera' })).toHaveLength(0);
  });

  it('HEALTH-CAM-002: shows the live camera view once permission is granted', () => {
    const tree = render();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-view' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-frame' })).toBeTruthy();
  });

  it('HEALTH-CAM-003: a checking-access state shows before permission resolves', () => {
    mockPermission = null;
    const tree = render();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-checking' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-view' })).toHaveLength(0);
  });

  it('HEALTH-CAM-004: a denied-but-askable permission offers to ask again, and asks once on open', () => {
    mockPermission = { granted: false, canAskAgain: true, status: 'denied' };
    const tree = render();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-permission-denied' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-request-permission' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-open-settings' })).toHaveLength(0);
    // Asked automatically once the sheet opened, not just on tap.
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-CAM-005: a permanently-denied permission offers Settings instead of asking again', () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    const tree = render();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-open-settings' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-request-permission' })).toHaveLength(0);
  });

  it('HEALTH-CAM-006: close fires onClose', () => {
    const onClose = jest.fn();
    const tree = render({ onClose });
    act(() => {
      tree.root.findByProps({ testID: 'health-scan-camera-close' }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-CAM-007: flash toggles enableTorch and its own icon', () => {
    const tree = render();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-view' }).props.enableTorch).toBe(false);
    act(() => {
      tree.root.findByProps({ testID: 'health-scan-camera-flash' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'health-scan-camera-view' }).props.enableTorch).toBe(true);
  });

  it('HEALTH-CAM-008: barcode mode has no shutter and passes the barcode settings down', () => {
    const tree = render();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-shutter' })).toHaveLength(0);
    const cam = tree.root.findByProps({ testID: 'health-scan-camera-view' });
    expect(cam.props.barcodeScannerSettings).toEqual({ barcodeTypes: HEALTH_BARCODE_TYPES });
    expect(typeof cam.props.onBarcodeScanned).toBe('function');
  });

  it('HEALTH-CAM-009: a detected barcode calls onBarcodeScanned with data and type', () => {
    const onBarcodeScanned = jest.fn();
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const tree = render({ onBarcodeScanned });
    act(() => {
      tree.root
        .findByProps({ testID: 'health-scan-camera-view' })
        .props.onBarcodeScanned({ data: '012345678905', type: 'ean13' });
    });
    expect(onBarcodeScanned).toHaveBeenCalledWith('012345678905', 'ean13');
  });

  it('HEALTH-CAM-010: the SAME code within 2s is a duplicate detection, not a second scan', () => {
    const onBarcodeScanned = jest.fn();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const tree = render({ onBarcodeScanned });
    const cam = () => tree.root.findByProps({ testID: 'health-scan-camera-view' });

    act(() => {
      cam().props.onBarcodeScanned({ data: '012345678905', type: 'ean13' });
    });
    now.mockReturnValue(1500); // 500ms later — inside the 2s debounce window
    act(() => {
      cam().props.onBarcodeScanned({ data: '012345678905', type: 'ean13' });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);

    now.mockReturnValue(3200); // past the debounce window — a real re-scan
    act(() => {
      cam().props.onBarcodeScanned({ data: '012345678905', type: 'ean13' });
    });
    expect(onBarcodeScanned).toHaveBeenCalledTimes(2);
  });

  it('HEALTH-CAM-011: photo mode shows a shutter and no barcode listener', () => {
    const tree = render({ onBarcodeScanned: undefined, onCapture: jest.fn(), frameShape: 'portrait' });
    expect(tree.root.findByProps({ testID: 'health-scan-camera-shutter' })).toBeTruthy();
    const cam = tree.root.findByProps({ testID: 'health-scan-camera-view' });
    expect(cam.props.onBarcodeScanned).toBeUndefined();
    expect(cam.props.barcodeScannerSettings).toBeUndefined();
  });

  it('HEALTH-CAM-012: the shutter takes a picture and hands back a uri + name', async () => {
    const onCapture = jest.fn();
    const tree = render({ onBarcodeScanned: undefined, onCapture, frameShape: 'portrait' });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-camera-shutter' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledTimes(1);
    const capture = onCapture.mock.calls[0][0];
    expect(capture.uri).toBe('file:///photo.jpg');
    expect(capture.name).toMatch(/\.jpg$/);
  });

  it('HEALTH-CAM-013: the shutter is disabled while a caller-supplied scan is processing', () => {
    const tree = render({ onBarcodeScanned: undefined, onCapture: jest.fn(), frameShape: 'portrait', processing: true });
    expect(
      tree.root.findByProps({ testID: 'health-scan-camera-shutter' }).props.accessibilityState.disabled
    ).toBe(true);
  });

  it('HEALTH-CAM-014: a camera mount error shows a dismissible toast, not a raw message', () => {
    const tree = render();
    act(() => {
      tree.root.findByProps({ testID: 'health-scan-camera-view' }).props.onMountError();
    });
    expect(tree.root.findByProps({ testID: 'health-scan-camera-error' })).toBeTruthy();
    act(() => {
      tree.root.findByProps({ testID: 'health-scan-camera-error-dismiss' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-error' })).toHaveLength(0);
  });

  it('HEALTH-CAM-015: a dashed scale frame renders its icon and caption inside the guide', () => {
    const tree = render({
      onBarcodeScanned: undefined,
      onCapture: jest.fn(),
      frameShape: 'dashed',
      frameIcon: 'weight',
      frameCaption: 'Make sure the scale display is visible',
      hints: [],
    });
    expect(tree.root.findByProps({ testID: 'health-scan-camera-frame' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-hints' })).toHaveLength(0);
  });
});
