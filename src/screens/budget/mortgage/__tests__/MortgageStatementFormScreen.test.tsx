/**
 * MortgageStatementFormScreen — the "Add statement" form leads with Scan /
 * import (AI); manual entry is COLLAPSED by default and revealed by a tap. This
 * verifies:
 *  - adding: manual fields (+ Save) are hidden until the toggle is pressed
 *  - a scan attempt auto-reveals the fields (review the read / fix it manually)
 *  - editing an existing statement opens straight to the fields (no toggle)
 */
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      onBackPress,
      rightElement,
    }: {
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(View, { testID: 'screen-header', onPress: onBackPress }, rightElement ?? null),
    screenScrollViewStyle: { scroll: {} },
    ScanImportSources: ({
      onCamera,
      testIDPrefix,
    }: {
      onCamera?: () => void;
      testIDPrefix?: string;
    }) => {
      const React2 = require('react');
      const { TouchableOpacity } = require('react-native');
      return React2.createElement(TouchableOpacity, {
        testID: `${testIDPrefix}-camera`,
        onPress: onCamera,
      });
    },
    ProcessingOverlay: ({ visible }: { visible?: boolean }) =>
      visible ? React.createElement(View, { testID: 'processing-overlay' }) : null,
  };
});

jest.mock('@components/cloud-storage', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: () => React.createElement(View, { testID: 'cloud-file-picker' }),
  };
});

const mockGoBack = jest.fn();
const mockSetOptions = jest.fn();
const mockRemoveListener = jest.fn();
const mockAddListener = jest.fn(() => mockRemoveListener);
let mockRouteParams: Record<string, unknown> = { mortgageId: 'm-1' };
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({
    goBack: mockGoBack,
    setOptions: mockSetOptions,
    addListener: mockAddListener,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const mockExtract = jest.fn();
const mockAddStatement = jest.fn();
const mockDeleteStatement = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    extractStatement: (...a: unknown[]) => mockExtract(...a),
    addStatement: (...a: unknown[]) => mockAddStatement(...a),
    deleteStatement: (...a: unknown[]) => mockDeleteStatement(...a),
  },
}));

const mockOpenCamera = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: (...a: unknown[]) => mockOpenCamera(...a), openPicker: jest.fn() },
}));

jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: jest.fn() }));
// `toVisionSafeAttachment` measures EVERY image up front (see
// `LoanInfoSection.test.tsx` for the full note), so `.manipulate(...)` runs even
// for vision-safe fixtures. A small reported size keeps the short-circuit.
jest.mock('expo-image-manipulator', () => {
  const rendered = {
    width: 100,
    height: 100,
    saveAsync: async () => ({ uri: 'file:///vision-safe.jpg' }),
  };
  const context = { resize: () => context, renderAsync: async () => rendered };
  return {
    __esModule: true,
    ImageManipulator: { manipulate: () => context },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-1' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: unknown) => unknown) => {
    const s = { markDirty: jest.fn() };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageStatementFormScreen } from '../MortgageStatementFormScreen';

async function render(routeParams?: Record<string, unknown>) {
  if (routeParams) mockRouteParams = routeParams;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageStatementFormScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

const query = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  tree.root.findAllByProps({ testID });
// A testID resolves to both a composite and a host instance, so presence is a
// boolean check, not an exact count.
const has = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  query(tree, testID).length > 0;
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

type AlertButton = { text?: string; onPress?: () => void };
let alertSpy: jest.SpyInstance;
// Invoke the onPress of a button (by label) in the most recent Alert.alert call.
const pressAlertButton = (text: string) => {
  const calls = alertSpy.mock.calls;
  const buttons = (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
  buttons.find((b) => b.text === text)?.onPress?.();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { mortgageId: 'm-1' };
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('MortgageStatementFormScreen — manual entry collapse', () => {
  it('hides the manual fields (and Save) until the toggle is pressed', async () => {
    const tree = await render();

    // Collapsed: the toggle shows, the fields + Save do not.
    expect(has(tree, 'mortgage-statement-manual-toggle')).toBe(true);
    expect(has(tree, 'mortgage-statement-manual-fields')).toBe(false);
    expect(has(tree, 'mortgage-statement-save')).toBe(false);

    await act(async () => {
      query(tree, 'mortgage-statement-manual-toggle')[0].props.onPress();
    });

    // Expanded: fields + Save appear.
    expect(has(tree, 'mortgage-statement-manual-fields')).toBe(true);
    expect(has(tree, 'mortgage-statement-save')).toBe(true);
  });

  it('auto-reveals the fields after a scan run', async () => {
    mockOpenCamera.mockResolvedValue({ path: 'file:///s.jpg', filename: 's.jpg', mime: 'image/jpeg' });
    mockExtract.mockResolvedValue({ draft: { closingBalance: 480000 } });
    const tree = await render();

    expect(has(tree, 'mortgage-statement-manual-fields')).toBe(false);

    await act(async () => {
      query(tree, 'mortgage-statement-camera')[0].props.onPress();
      await flush();
    });

    expect(mockExtract).toHaveBeenCalled();
    expect(has(tree, 'mortgage-statement-manual-fields')).toBe(true);
    expect(has(tree, 'mortgage-statement-save')).toBe(true);
  });

  it('blocks the screen with the processing overlay only while a scan is in flight', async () => {
    mockOpenCamera.mockResolvedValue({ path: 'file:///s.jpg', filename: 's.jpg', mime: 'image/jpeg' });
    // Hold the extract in its pending state so we can assert the overlay shows.
    let resolveExtract!: (v: unknown) => void;
    mockExtract.mockReturnValue(new Promise((res) => {
      resolveExtract = res;
    }));
    const tree = await render();

    // Idle: no overlay.
    expect(has(tree, 'processing-overlay')).toBe(false);

    await act(async () => {
      query(tree, 'mortgage-statement-camera')[0].props.onPress();
      await flush();
    });

    // In flight: overlay blocks the screen and back is registered + swallowed.
    expect(has(tree, 'processing-overlay')).toBe(true);
    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: false });
    expect(mockAddListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));

    // Header back is a no-op while busy.
    await act(async () => {
      query(tree, 'screen-header')[0].props.onPress();
    });
    expect(mockGoBack).not.toHaveBeenCalled();

    // Resolve the scan → overlay clears and the gesture is re-enabled.
    await act(async () => {
      resolveExtract({ draft: { closingBalance: 480000 } });
      await flush();
    });
    expect(has(tree, 'processing-overlay')).toBe(false);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it('opens straight to the fields when editing (no toggle)', async () => {
    const tree = await render({
      mortgageId: 'm-1',
      statement: {
        id: 's-1',
        statement_date: '2026-06-01',
        closing_balance_cents: 48000000,
        interest_paid_cents: null,
        principal_paid_cents: null,
        payment_amount_cents: null,
      },
    });

    expect(has(tree, 'mortgage-statement-manual-toggle')).toBe(false);
    expect(has(tree, 'mortgage-statement-manual-fields')).toBe(true);
    expect(has(tree, 'mortgage-statement-save')).toBe(true);
  });
});

describe('MortgageStatementFormScreen — save dialogs', () => {
  const openManualAndFillClosing = async (
    tree: ReactTestRenderer.ReactTestRenderer,
    closing = '480000'
  ) => {
    await act(async () => {
      query(tree, 'mortgage-statement-manual-toggle')[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ label: 'Closing balance ($)' })[0].props.onChangeText(closing);
    });
  };

  const pressHeaderSave = async (tree: ReactTestRenderer.ReactTestRenderer) => {
    await act(async () => {
      query(tree, 'mortgage-statement-save')[0].props.onPress();
      await flush();
    });
  };

  it('confirms on success and closes only after the dialog is dismissed', async () => {
    mockAddStatement.mockResolvedValue({});
    const tree = await render();
    await openManualAndFillClosing(tree);
    await pressHeaderSave(tree);

    expect(mockAddStatement).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Statement saved', expect.any(String), expect.any(Array));
    // Screen stays open until the member taps OK.
    expect(mockGoBack).not.toHaveBeenCalled();
    pressAlertButton('OK');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('shows an error dialog and stays on the screen when the save fails', async () => {
    mockAddStatement.mockRejectedValue({ response: { status: 500 } });
    const tree = await render();
    await openManualAndFillClosing(tree);
    await pressHeaderSave(tree);

    expect(alertSpy).toHaveBeenCalledWith('Could not save', expect.any(String));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('prompts to replace on a 409 and re-commits with replace=true', async () => {
    mockAddStatement.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValueOnce({});
    const tree = await render();
    await openManualAndFillClosing(tree);
    await pressHeaderSave(tree);

    expect(alertSpy).toHaveBeenCalledWith(
      'Statement already exists',
      expect.any(String),
      expect.any(Array)
    );
    expect(mockGoBack).not.toHaveBeenCalled();

    await act(async () => {
      pressAlertButton('Replace');
      await flush();
    });
    expect(mockAddStatement).toHaveBeenCalledTimes(2);
    expect((mockAddStatement.mock.calls[1][2] as { replace?: boolean }).replace).toBe(true);
  });

  it('sends the scanned interest rate (bps) so the forecast re-bases on it', async () => {
    mockOpenCamera.mockResolvedValue({ path: 'file:///s.jpg', filename: 's.jpg', mime: 'image/jpeg' });
    // The extractor read a rate-changed statement: closing balance + 3.59% rate.
    mockExtract.mockResolvedValue({
      draft: { closingBalance: 965467.16, interestRate: 3.59, primeRate: 4.45, variance: -0.86 },
    });
    mockAddStatement.mockResolvedValue({});
    const tree = await render();

    await act(async () => {
      query(tree, 'mortgage-statement-camera')[0].props.onPress();
      await flush();
    });
    await pressHeaderSave(tree);

    expect(mockAddStatement).toHaveBeenCalledTimes(1);
    const body = mockAddStatement.mock.calls[0][2] as {
      interestRateBps?: number;
      primeRateBps?: number | null;
      varianceBps?: number | null;
      source?: string;
    };
    // 3.59% → 359 bps; the source reflects the scan, not "manual".
    expect(body.interestRateBps).toBe(359);
    expect(body.primeRateBps).toBe(445);
    expect(body.varianceBps).toBe(-86);
    expect(body.source).toBe('camera');
  });

  it('warns and calls no API when the closing balance is missing', async () => {
    const tree = await render();
    await act(async () => {
      query(tree, 'mortgage-statement-manual-toggle')[0].props.onPress();
    });
    await pressHeaderSave(tree);

    expect(mockAddStatement).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Closing balance needed', expect.any(String));
  });
});
