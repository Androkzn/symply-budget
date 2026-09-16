/**
 * Scan Barcode — the donor's `BarcodeScannerView` parent, parity P5.
 *
 * The donor's own comment on `BarcodeScannerView` says "Parent view MUST
 * dismiss the scanner in onBarcodeScanned" — this screen IS that parent, so
 * the cases here pin: the live camera closes the instant a code is read, the
 * lookup result renders the right one of three shapes (found / not-in-database
 * / could-not-ask), and a found hit saves and logs through the SAME
 * `importExternalFood` / `logExternalFoodToDiary` calls the Foods tab uses —
 * no second write path for a barcode hit.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  importExternalFood,
  logExternalFoodToDiary,
  lookupFoodBarcode,
  type BarcodeLookupOutcome,
  type ExternalFoodItem,
} from '../../healthFoodStorage';
import { HealthBarcodeScanScreen } from '../HealthBarcodeScanScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({
      title,
      onBackPress,
      backButtonTestID,
    }: {
      title?: string;
      onBackPress?: () => void;
      backButtonTestID?: string;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'screen-header', accessibilityLabel: title },
        ReactMock.createElement(Pressable, { testID: backButtonTestID, onPress: onBackPress })
      ),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    ProcessingOverlay: ({ visible, message, testID }: { visible: boolean; message?: string; testID?: string }) =>
      visible ? ReactMock.createElement(View, { testID, accessibilityLabel: message }) : null,
  };
});

// The shared live camera is its own suite (`HealthScanCamera.test.tsx`); here
// it is a thin stand-in exposing exactly the props this screen drives —
// `visible`, `onClose` and, critically, `onBarcodeScanned`.
jest.mock('../../components/HealthScanCamera', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    HealthScanCamera: (props: Record<string, unknown>) =>
      ReactMock.createElement(View, { testID: 'health-scan-camera-stub', ...props }),
    HEALTH_BARCODE_TYPES: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
  };
});

jest.mock('../../healthFoodStorage', () => ({
  ...jest.requireActual('../../healthFoodStorage'),
  lookupFoodBarcode: jest.fn(),
  importExternalFood: jest.fn(),
  logExternalFoodToDiary: jest.fn(),
}));

const mockLookup = lookupFoodBarcode as jest.Mock;
const mockImport = importExternalFood as jest.Mock;
const mockLog = logExternalFoodToDiary as jest.Mock;

function externalFood(over: Partial<ExternalFoodItem> = {}): ExternalFoodItem {
  return {
    id: 'fatsecret:12345',
    provider: 'fatsecret',
    providerFoodId: '12345',
    name: 'Greek Yoghurt',
    brand: 'Symply Dairy',
    portion: 170,
    unit: 'g',
    servingId: 'srv-1',
    servingDescription: '1 pot (170 g)',
    serving: { calories: 150, protein: 15, carbs: 12, fat: 4 },
    per100: { calories: 88, protein: 9, carbs: 7, fat: 2.4 },
    servings: [
      {
        id: 'srv-1',
        description: '1 pot (170 g)',
        portion: 170,
        unit: 'g',
        isMetric: true,
        macros: { calories: 150, protein: 15, carbs: 12, fat: 4 },
      },
    ],
    ...over,
  };
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance | string) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as never);
  };
  walk(tree.root);
  return out.join(' ');
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthBarcodeScanScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Drive the stubbed camera's `onBarcodeScanned` as if a real scan happened. */
async function scan(tree: ReactTestRenderer.ReactTestRenderer, code = '012345678905') {
  await act(async () => {
    tree.root.findByProps({ testID: 'health-scan-camera-stub' }).props.onBarcodeScanned(code);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockImport.mockResolvedValue({ foods: [], status: 'saved', message: null, food: null, created: true });
  mockLog.mockResolvedValue({
    foods: [],
    status: 'saved',
    message: null,
    logged: { calories: 150, protein: 15, carbs: 12, fat: 4 },
    mealSlot: 'snacks',
    created: true,
  });
});

describe('HealthBarcodeScanScreen', () => {
  it('HEALTH-BARCODE-001: opens straight into the live camera', async () => {
    const tree = await render();
    expect(tree.root.findByProps({ testID: 'health-scan-camera-stub' }).props.visible).toBe(true);
    expect(byTestId(tree, 'health-barcode-scan-found')).toHaveLength(0);
  });

  it('HEALTH-BARCODE-002: a scan closes the camera and looks the code up', async () => {
    let release: (value: BarcodeLookupOutcome) => void = () => {};
    mockLookup.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const tree = await render();

    await scan(tree);
    expect(tree.root.findByProps({ testID: 'health-scan-camera-stub' }).props.visible).toBe(false);
    expect(mockLookup).toHaveBeenCalledWith('012345678905');
    expect(byTestId(tree, 'health-barcode-scan-overlay')).toHaveLength(1);

    await act(async () => {
      release({ food: externalFood(), providerNotice: null, offline: false });
    });
    expect(byTestId(tree, 'health-barcode-scan-overlay')).toHaveLength(0);
    expect(byTestId(tree, 'health-barcode-scan-found')).toHaveLength(1);
  });

  it('HEALTH-BARCODE-003: a found food renders its macros and can be logged to the chosen slot', async () => {
    mockLookup.mockResolvedValue({ food: externalFood(), providerNotice: null, offline: false });
    const tree = await render();
    await scan(tree);

    expect(textOf(tree)).toContain('Greek Yoghurt');
    expect(textOf(tree)).toContain('Symply Dairy');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-barcode-scan-slot-breakfast' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-barcode-scan-log' }).props.onPress();
    });

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fatsecret:12345' }),
      expect.objectContaining({ mealSlot: 'breakfast' })
    );
    expect(textOf(tree)).toContain('Breakfast');
  });

  it('HEALTH-BARCODE-004: "Save only" imports without logging', async () => {
    mockLookup.mockResolvedValue({ food: externalFood(), providerNotice: null, offline: false });
    const tree = await render();
    await scan(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-barcode-scan-save' }).props.onPress();
    });

    expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({ id: 'fatsecret:12345' }));
    expect(mockLog).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Saved "Greek Yoghurt"');
  });

  it('HEALTH-BARCODE-005: a well-formed code the database does not know renders "not in database", not an error', async () => {
    mockLookup.mockResolvedValue({ food: null, providerNotice: null, offline: false });
    const tree = await render();
    await scan(tree);

    expect(byTestId(tree, 'health-barcode-scan-found')).toHaveLength(0);
    expect(textOf(tree)).toContain('not in the food database yet');
  });

  it('HEALTH-BARCODE-006: a provider outage/not-configured/offline state renders ITS OWN message, never the not-found copy', async () => {
    mockLookup.mockResolvedValue({
      food: null,
      providerNotice: 'The food database is not switched on for this app yet, so this searches your own foods only.',
      offline: false,
    });
    const tree = await render();
    await scan(tree);

    expect(textOf(tree)).toContain('not switched on for this app yet');
    expect(textOf(tree)).not.toContain('not in the food database yet');
  });

  it('HEALTH-BARCODE-007: "Scan another barcode" clears the result and reopens the camera', async () => {
    mockLookup.mockResolvedValue({ food: externalFood(), providerNotice: null, offline: false });
    const tree = await render();
    await scan(tree);
    expect(byTestId(tree, 'health-barcode-scan-found')).toHaveLength(1);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-barcode-scan-rescan' }).props.onPress();
    });

    expect(byTestId(tree, 'health-barcode-scan-found')).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'health-scan-camera-stub' }).props.visible).toBe(true);
  });

  it('HEALTH-BARCODE-008: a second code scanned mid-lookup is ignored — the first lookup is not interrupted', async () => {
    let release: (value: BarcodeLookupOutcome) => void = () => {};
    mockLookup.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const tree = await render();

    await scan(tree, '111111111111');
    await scan(tree, '222222222222');
    expect(mockLookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ food: externalFood(), providerNotice: null, offline: false });
    });
  });

  it('HEALTH-BARCODE-009: closing the camera before any scan goes back, using replace when there is nowhere to go back to', async () => {
    mockCanGoBack = false;
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-camera-stub' }).props.onClose();
    });
    expect(mockReplace).toHaveBeenCalledWith('/settings');
    expect(mockBack).not.toHaveBeenCalled();

    mockCanGoBack = true;
    mockReplace.mockClear();
    const second = await render();
    await act(async () => {
      second.root.findByProps({ testID: 'health-scan-camera-stub' }).props.onClose();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('HEALTH-BARCODE-010: closing the camera AFTER a result just hides it — the result stays on screen', async () => {
    mockLookup.mockResolvedValue({ food: externalFood(), providerNotice: null, offline: false });
    const tree = await render();
    await scan(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-camera-stub' }).props.onClose();
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-barcode-scan-found')).toHaveLength(1);
  });
});
