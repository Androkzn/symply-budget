/**
 * LoanDraftSection — "track a loan" for the Add-payment flow, before the
 * recurring payment itself exists. Covers: starts with tracking off and
 * `getDraftLoanPayload()` returning `null`; turning tracking on reveals the
 * SAME shared field rows `LoanInfoSection` uses; "Fill with AI" via camera
 * and via Google Drive both call `budgetLoansApi.extractDraft` (never the
 * per-payment `extract`, since there's no `recurring_payment_id` yet);
 * `onScanningChange` reporting; and `getDraftLoanPayload()`'s valid/invalid
 * results, reusing the exact validation `LoanInfoSection.handleSave` runs
 * (mirrored here via the same fixtures as `LoanInfoSection.test.tsx`).
 */
const mockUpsertLoan = jest.fn();
const mockExtractDraftLoan = jest.fn();
jest.mock('@api/budgetLoans', () => ({
  __esModule: true,
  budgetLoansApi: {
    upsert: (...a: unknown[]) => mockUpsertLoan(...a),
    extractDraft: (...a: unknown[]) => mockExtractDraftLoan(...a),
  },
}));

// `ScanImportSources`/`ProcessingOverlay` — same forwarding stub as
// `LoanInfoSection.test.tsx` so "Fill with AI" can be driven by testID.
jest.mock('@components/common', () => {
  const ReactLib = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    ScanImportSources: ({
      testIDPrefix,
      disabled,
      onCamera,
      onGallery,
      onFile,
      onDrive,
    }: {
      testIDPrefix?: string;
      disabled?: boolean;
      onCamera?: () => void;
      onGallery?: () => void;
      onFile?: () => void;
      onDrive?: () => void;
    }) => {
      const handlers: Record<string, (() => void) | undefined> = {
        camera: onCamera,
        gallery: onGallery,
        file: onFile,
        drive: onDrive,
      };
      return ReactLib.createElement(
        View,
        null,
        Object.keys(handlers)
          .filter((key) => handlers[key])
          .map((key) =>
            ReactLib.createElement(TouchableOpacity, {
              key,
              testID: `${testIDPrefix}-${key}`,
              disabled,
              onPress: handlers[key],
            })
          )
      );
    },
    ProcessingOverlay: ({ visible, testID }: { visible: boolean; testID?: string }) =>
      visible ? ReactLib.createElement(View, { testID: testID ?? 'processing-overlay' }) : null,
  };
});

// `CloudFilePicker` (Google Drive) — same testable stub as `LoanInfoSection.test.tsx`.
jest.mock('@components/cloud-storage', () => {
  const ReactLib = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: ({
      visible,
      onFileSelected,
    }: {
      visible: boolean;
      onFileSelected: (file: { uri: string; name: string; size: number }) => void;
    }) =>
      visible
        ? ReactLib.createElement(Pressable, {
            testID: 'loan-drive-picker',
            onPress: () => onFileSelected({ uri: 'file:///drive-loan.pdf', name: 'drive-loan.pdf', size: 10 }),
          })
        : null,
  };
});

const mockOpenCamera = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openCamera: (...a: unknown[]) => mockOpenCamera(...a),
    openPicker: jest.fn(),
  },
}));

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(),
}));

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

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { LoanDraftSection, type LoanDraftSectionHandle } from '../LoanDraftSection';
import { estimateStartDateFromProgress } from '../loanShared';

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function renderDraft(
  props: {
    onScanningChange?: (scanning: boolean) => void;
    onExtractedPayment?: (fields: { amountCents: number | null; dueDayOfMonth: number | null }) => void;
    startTracking?: boolean;
  } = {}
) {
  const ref = React.createRef<LoanDraftSectionHandle>();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LoanDraftSection ref={ref} householdId="hh-test" recurringPaymentLabel="Car loan" {...props} />
      </ThemeProvider>
    );
  });
  return { tree, ref };
}

describe('LoanDraftSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenCamera.mockResolvedValue({ path: 'file:///loan.jpg', filename: 'loan.jpg', mime: 'image/jpeg' });
  });

  it('starts with tracking off, no fields, and getDraftLoanPayload() returns null', () => {
    const { tree, ref } = renderDraft();
    expect(tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.value).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'loan-principal' })).toHaveLength(0);
    expect(ref.current?.getDraftLoanPayload()).toBeNull();
  });

  it('starts with tracking already on when startTracking is passed (Group = "Loans & Debt")', () => {
    const { tree } = renderDraft({ startTracking: true });
    expect(tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.value).toBe(true);
    expect(tree.root.findByProps({ testID: 'loan-principal' })).toBeTruthy();
  });

  it('turning tracking on reveals the same shared field rows as LoanInfoSection', () => {
    const { tree } = renderDraft();
    act(() => {
      tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
    });
    expect(tree.root.findByProps({ testID: 'loan-principal' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'loan-term-months' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'loan-start-date' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'loan-ai-fill-toggle' })).toBeTruthy();
    // No Save button and no summary card — this is a draft, nothing is
    // persisted until the parent screen saves the payment.
    expect(tree.root.findAllByProps({ testID: 'loan-save' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'loan-summary-card' })).toHaveLength(0);
  });

  it('toggling tracking back off does not prompt to confirm (nothing is persisted yet)', () => {
    const { tree, ref } = renderDraft();
    act(() => {
      tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
    });
    act(() => {
      tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
    });
    act(() => {
      tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(false);
    });
    expect(tree.root.findAllByProps({ testID: 'loan-principal' })).toHaveLength(0);
    expect(ref.current?.getDraftLoanPayload()).toBeNull();
  });

  describe('"Fill with AI"', () => {
    const DRAFT = {
      principal_cents: 1_800_000,
      monthlyPaymentCents: 37_921,
      dueDayOfMonth: 22,
      term_months: 60,
      rate_type: 'fixed' as const,
      rate_bps: 649,
      lender: 'Toyota Financial',
      notes: 'Financed at the dealership',
      amountPaidCents: 240_000,
      lowConfidenceFields: [],
    };

    beforeEach(() => {
      mockExtractDraftLoan.mockResolvedValue({ draft: DRAFT });
    });

    it('calls budgetLoansApi.extractDraft (never the per-payment extract) with the household id and no payment id', async () => {
      const { tree } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(mockExtractDraftLoan).toHaveBeenCalledWith('hh-test', expect.any(FormData));
      expect(tree.root.findByProps({ testID: 'loan-principal' }).props.value).toBe('18000');
      expect(tree.root.findByProps({ testID: 'loan-term-months' }).props.value).toBe('60');
      expect(tree.root.findByProps({ testID: 'loan-lender' }).props.value).toBe('Toyota Financial');
      expect(tree.root.findByProps({ testID: 'loan-amount-already-paid' }).props.value).toBe('2400');
      expect(mockUpsertLoan).not.toHaveBeenCalled();
    });

    it('backs into a startDate from amount paid + monthly payment, so an already-running loan does not read as 0% paid', async () => {
      const { tree } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      // DRAFT: amountPaidCents 240_000 / monthlyPaymentCents 37_921 ≈ 6 payments in.
      const expected = estimateStartDateFromProgress(
        DRAFT.amountPaidCents,
        DRAFT.monthlyPaymentCents,
        DRAFT.term_months
      );
      expect(expected).not.toBeNull();
      expect(tree.root.findByProps({ testID: 'loan-start-date' }).props.value).toBe(expected);
    });

    it('leaves startDate at today when the statement showed no monthly payment to divide by', async () => {
      mockExtractDraftLoan.mockResolvedValue({
        draft: { ...DRAFT, monthlyPaymentCents: null },
      });
      const { tree } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      const before = tree.root.findByProps({ testID: 'loan-start-date' }).props.value;
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(tree.root.findByProps({ testID: 'loan-start-date' }).props.value).toBe(before);
    });

    it('also reads a statement from Google Drive via extractDraft', async () => {
      const { tree } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-drive' }).props.onPress();
      });
      expect(tree.root.findByProps({ testID: 'loan-drive-picker' })).toBeTruthy();

      await act(async () => {
        tree.root.findByProps({ testID: 'loan-drive-picker' }).props.onPress();
        await flushMicrotasks();
      });

      expect(mockExtractDraftLoan).toHaveBeenCalledWith('hh-test', expect.any(FormData));
      expect(tree.root.findByProps({ testID: 'loan-principal' }).props.value).toBe('18000');
    });

    it('reports scanning state via onScanningChange around the extractDraft call', async () => {
      const onScanningChange = jest.fn();
      const { tree } = renderDraft({ onScanningChange });
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(onScanningChange.mock.calls[0]).toEqual([true]);
      expect(onScanningChange.mock.calls[onScanningChange.mock.calls.length - 1]).toEqual([false]);
    });

    it('reports the extracted monthly payment + due day via onExtractedPayment, for the PARENT to fill', async () => {
      const onExtractedPayment = jest.fn();
      const { tree } = renderDraft({ onExtractedPayment });
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(onExtractedPayment).toHaveBeenCalledWith({ amountCents: 37_921, dueDayOfMonth: 22 });
    });

    it('does not call onExtractedPayment when the statement showed neither figure', async () => {
      mockExtractDraftLoan.mockResolvedValue({
        draft: { ...DRAFT, monthlyPaymentCents: null, dueDayOfMonth: null },
      });
      const onExtractedPayment = jest.fn();
      const { tree } = renderDraft({ onExtractedPayment });
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(onExtractedPayment).not.toHaveBeenCalled();
    });
  });

  describe('getDraftLoanPayload()', () => {
    it('returns a valid payload once required fields are filled in', () => {
      const { tree, ref } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });

      const result = ref.current?.getDraftLoanPayload();
      expect(result).toEqual({
        valid: true,
        payload: expect.objectContaining({
          rate_type: 'zero',
          rate_bps: 0,
          principal_cents: 120_000,
          term_months: 12,
          start_date: '2026-01-15',
        }),
      });
    });

    it('returns a clear error and does not throw when the principal is missing', () => {
      const { tree, ref } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      // Principal left blank.

      const result = ref.current?.getDraftLoanPayload();
      expect(result?.valid).toBe(false);
      expect(result && !result.valid ? result.error : '').toContain('Missing principal');
    });

    it('returns a clear error when the rate is missing on a Fixed-rate loan', () => {
      const { tree, ref } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      // Default rate type is 'fixed' with no rate entered.

      const result = ref.current?.getDraftLoanPayload();
      expect(result?.valid).toBe(false);
      expect(result && !result.valid ? result.error : '').toContain('Missing rate');
    });

    it('returns a clear error on an invalid portal_url', () => {
      const { tree, ref } = renderDraft();
      act(() => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-more-details-toggle' }).props.onPress();
      });
      act(() => {
        tree.root.findByProps({ testID: 'loan-portal-url' }).props.onChangeText('not a url');
      });

      const result = ref.current?.getDraftLoanPayload();
      expect(result?.valid).toBe(false);
      expect(result && !result.valid ? result.error : '').toContain('Invalid link');
    });
  });
});
