/**
 * LoanInfoSection — "track a loan" for one Monthly-Payments item. Covers:
 * cold load (nothing tracked), enabling tracking + save validation (date,
 * principal, term, missing rate on 'fixed'), a saved 0% loan showing a
 * zero-interest summary card, an existing loan pre-filling the fields,
 * "stop tracking" (confirm → remove), the purely-informational "amount
 * already paid" field (passes through as-is, never derives `start_date`), the
 * "More details" collapsible section (lender/notes/portal_url), client-side
 * portal_url validation, "Fill with AI" via camera/gallery/file (draft
 * populates fields for review — nothing is auto-saved), and "Fill with AI"
 * via Google Drive (the shared `LoanFieldsForm`'s `CloudFilePicker`, same
 * `runExtract` path as the other three sources). Mirrors
 * `RenewalReminderSection.test.tsx`'s structure.
 */
const mockGetLoan = jest.fn();
const mockUpsertLoan = jest.fn();
const mockRemoveLoan = jest.fn();
const mockExtractLoan = jest.fn();
jest.mock('@api/budgetLoans', () => ({
  __esModule: true,
  budgetLoansApi: {
    get: (...a: unknown[]) => mockGetLoan(...a),
    upsert: (...a: unknown[]) => mockUpsertLoan(...a),
    remove: (...a: unknown[]) => mockRemoveLoan(...a),
    extract: (...a: unknown[]) => mockExtractLoan(...a),
  },
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

// `ScanImportSources`/`ProcessingOverlay` are the shared Camera·Gallery·File·
// Drive picker row + blocking loader — stub them to plain forwarding elements
// (same pattern as `SavingsImportScreen.test.tsx`) so "Fill with AI" can be
// driven by pressing a testID without needing the real native picker UI.
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

// `CloudFilePicker` (Google Drive) — a testable stub. When `visible`,
// pressing it hands back a fixed file (drives the Drive path); hidden
// otherwise. Same convention as `ChatRoomScreen.test.tsx`.
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
const mockOpenPicker = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openCamera: (...a: unknown[]) => mockOpenCamera(...a),
    openPicker: (...a: unknown[]) => mockOpenPicker(...a),
  },
}));

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a),
}));

// `toVisionSafeAttachment` MEASURES every image before deciding anything, so
// `.manipulate(uri).renderAsync()` runs even for an already vision-safe
// `image/jpeg` fixture — the short-circuit is downstream of the measurement,
// not upstream of it. The old inert `manipulate: jest.fn()` returned undefined,
// so `.renderAsync()` threw, the screen swallowed it, and the extract API was
// never called (every "Fill with AI" assertion failed with 0 calls).
// Report a small image so the safe-mime fixtures still short-circuit and reach
// the API byte-identical.
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
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { LoanInfoSection } from '../LoanInfoSection';
import { estimateStartDateFromProgress } from '../loanShared';

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

async function renderSection(
  props: {
    onScanningChange?: (scanning: boolean) => void;
    onExtractedPayment?: (fields: { amountCents: number | null; dueDayOfMonth: number | null }) => void;
  } = {}
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LoanInfoSection
          householdId="hh-test"
          recurringPaymentId="rp-1"
          recurringPaymentLabel="Car loan"
          {...props}
        />
      </ThemeProvider>
    );
  });
  return tree;
}

function confirmAlert(buttonLabel: string) {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const list = (buttons as { text?: string; onPress?: () => void }[]) ?? [];
    list.find((b) => b.text === buttonLabel)?.onPress?.();
  });
}

const EXISTING_LOAN = {
  id: 'loan-1',
  household_id: 'hh-test',
  recurring_payment_id: 'rp-1',
  loan_kind: 'installment' as const,
  rate_type: 'fixed' as const,
  rate_bps: 649,
  principal_cents: 1_800_000,
  term_months: 60,
  start_date: '2024-01-15',
  lender: 'Toyota Financial',
  notes: null,
  portal_url: null,
  created_by: null,
  created_at: '',
  updated_at: '',
};

const EXISTING_SUMMARY = {
  termMonths: 60,
  elapsedMonths: 24,
  paymentsRemaining: 36,
  currentBalanceCents: 1_100_000,
  interestPaidToDateCents: 90_000,
  totalInterestCents: 300_000,
  totalCostCents: 2_100_000,
  payoffDate: '2029-01-15',
};

describe('LoanInfoSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLoan.mockResolvedValue({ loan: null, summary: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('fetches this payment\'s loan on mount and starts with tracking off', async () => {
    const tree = await renderSection();
    expect(mockGetLoan).toHaveBeenCalledWith('hh-test', 'rp-1');
    expect(tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.value).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'loan-save' })).toHaveLength(0);
  });

  it('turning tracking on reveals the fields; saving validates the date', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderSection();
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
    });
    expect(tree.root.findByProps({ testID: 'loan-save' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('18000');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('60');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('not-a-date');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Invalid date', expect.any(String));
    expect(mockUpsertLoan).not.toHaveBeenCalled();
  });

  it('requires a rate when "Fixed rate" is selected', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderSection();
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('18000');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('60');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
    });
    // Default rate type is 'fixed' with no rate entered.
    await act(async () => {
      await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Missing rate', expect.any(String));
    expect(mockUpsertLoan).not.toHaveBeenCalled();
  });

  it('saves a 0% plan without requiring a rate and shows the zero-interest summary', async () => {
    mockUpsertLoan.mockResolvedValue({
      loan: {
        ...EXISTING_LOAN,
        rate_type: 'zero',
        rate_bps: 0,
        principal_cents: 120_000,
        term_months: 12,
        start_date: '2026-01-15',
        lender: null,
      },
      summary: {
        termMonths: 12,
        elapsedMonths: 0,
        paymentsRemaining: 12,
        currentBalanceCents: 120_000,
        interestPaidToDateCents: 0,
        totalInterestCents: 0,
        totalCostCents: 120_000,
        payoffDate: '2027-01-15',
      },
    });

    const tree = await renderSection();
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
    });

    expect(mockUpsertLoan).toHaveBeenCalledWith(
      'hh-test',
      'rp-1',
      expect.objectContaining({ rate_type: 'zero', rate_bps: 0, principal_cents: 120_000, term_months: 12 })
    );
    const card = tree.root.findByProps({ testID: 'loan-summary-card' });
    expect(card).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'loan-progress-bar' }).props.max).toBe(12);
  });

  it('pre-fills from an existing loan', async () => {
    mockGetLoan.mockResolvedValue({ loan: EXISTING_LOAN, summary: EXISTING_SUMMARY });

    const tree = await renderSection();
    expect(tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.value).toBe(true);
    expect(tree.root.findByProps({ testID: 'loan-principal' }).props.value).toBe('18000');
    expect(tree.root.findByProps({ testID: 'loan-term-months' }).props.value).toBe('60');
    expect(tree.root.findByProps({ testID: 'loan-rate-pct' }).props.value).toBe('6.49');
    expect(tree.root.findByProps({ testID: 'loan-lender' }).props.value).toBe('Toyota Financial');
    expect(tree.root.findByProps({ testID: 'loan-progress-bar' }).props.value).toBe(24);
  });

  it('stopping tracking removes the loan after confirming', async () => {
    mockGetLoan.mockResolvedValue({ loan: EXISTING_LOAN, summary: EXISTING_SUMMARY });
    mockRemoveLoan.mockResolvedValue({ success: true });

    const tree = await renderSection();
    expect(tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.value).toBe(true);

    confirmAlert('Stop tracking');
    await act(async () => {
      await tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(false);
    });
    expect(mockRemoveLoan).toHaveBeenCalledWith('hh-test', 'rp-1');
    expect(tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.value).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'loan-save' })).toHaveLength(0);
  });

  describe('"amount already paid" (purely informational)', () => {
    it('passes the entered amount straight through as amount_paid_cents, without touching start_date', async () => {
      mockUpsertLoan.mockResolvedValue({ loan: EXISTING_LOAN, summary: EXISTING_SUMMARY });

      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-amount-already-paid' }).props.onChangeText('600');
      });
      await act(async () => {
        await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
      });

      expect(mockUpsertLoan).toHaveBeenCalledWith(
        'hh-test',
        'rp-1',
        expect.objectContaining({ start_date: '2026-01-15', amount_paid_cents: 60_000 })
      );
    });

    it('saves null when left blank', async () => {
      mockUpsertLoan.mockResolvedValue({ loan: EXISTING_LOAN, summary: EXISTING_SUMMARY });

      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      await act(async () => {
        await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
      });

      expect(mockUpsertLoan).toHaveBeenCalledWith(
        'hh-test',
        'rp-1',
        expect.objectContaining({ amount_paid_cents: null })
      );
    });

    it('rejects an unparseable amount, and does not save', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-amount-already-paid' }).props.onChangeText('abc');
      });
      await act(async () => {
        await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
      });

      expect(alertSpy).toHaveBeenCalledWith('Invalid entry', expect.any(String));
      expect(mockUpsertLoan).not.toHaveBeenCalled();
    });
  });

  describe('"More details" (lender / notes / portal_url)', () => {
    it('starts collapsed for a brand-new loan', async () => {
      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      expect(tree.root.findAllByProps({ testID: 'loan-more-details-body' })).toHaveLength(0);

      await act(async () => {
        tree.root.findByProps({ testID: 'loan-more-details-toggle' }).props.onPress();
      });
      expect(tree.root.findByProps({ testID: 'loan-more-details-body' })).toBeTruthy();
    });

    it('starts expanded when loading an existing loan with lender/notes/portal_url set', async () => {
      mockGetLoan.mockResolvedValue({
        loan: {
          ...EXISTING_LOAN,
          notes: 'Financed at the dealership',
          portal_url: 'https://example.com/my-account',
        },
        summary: EXISTING_SUMMARY,
      });

      const tree = await renderSection();
      expect(tree.root.findByProps({ testID: 'loan-more-details-body' })).toBeTruthy();
      expect(tree.root.findByProps({ testID: 'loan-notes' }).props.value).toBe('Financed at the dealership');
      expect(tree.root.findByProps({ testID: 'loan-portal-url' }).props.value).toBe(
        'https://example.com/my-account'
      );
    });

    it('rejects an invalid portal_url and does not save', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-principal' }).props.onChangeText('1200');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('12');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-more-details-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-portal-url' }).props.onChangeText('not a url');
      });
      await act(async () => {
        await tree.root.findByProps({ testID: 'loan-save' }).props.onPress();
      });

      expect(alertSpy).toHaveBeenCalledWith('Invalid link', expect.any(String));
      expect(mockUpsertLoan).not.toHaveBeenCalled();
    });
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
      mockOpenCamera.mockResolvedValue({ path: 'file:///loan.jpg', filename: 'loan.jpg', mime: 'image/jpeg' });
      mockExtractLoan.mockResolvedValue({ draft: DRAFT });
    });

    it('populates every field from the draft for review, without auto-saving', async () => {
      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(mockExtractLoan).toHaveBeenCalledWith('hh-test', 'rp-1', expect.any(FormData));
      expect(tree.root.findByProps({ testID: 'loan-principal' }).props.value).toBe('18000');
      expect(tree.root.findByProps({ testID: 'loan-term-months' }).props.value).toBe('60');
      expect(tree.root.findByProps({ testID: 'loan-rate-pct' }).props.value).toBe('6.49');
      expect(tree.root.findByProps({ testID: 'loan-lender' }).props.value).toBe('Toyota Financial');
      expect(tree.root.findByProps({ testID: 'loan-notes' }).props.value).toBe('Financed at the dealership');
      expect(tree.root.findByProps({ testID: 'loan-amount-already-paid' }).props.value).toBe('2400');
      expect(mockUpsertLoan).not.toHaveBeenCalled();
    });

    it('backs into a startDate from amount paid + monthly payment, so an already-running loan does not read as 0% paid', async () => {
      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
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

    it('reports scanning state via onScanningChange around the extract call', async () => {
      const onScanningChange = jest.fn();
      const tree = await renderSection({ onScanningChange });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(onScanningChange).toHaveBeenCalledWith(true);
      expect(onScanningChange.mock.calls[0]).toEqual([true]);
      expect(onScanningChange.mock.calls[onScanningChange.mock.calls.length - 1]).toEqual([false]);
    });

    it('reports the extracted monthly payment + due day via onExtractedPayment, for the PARENT to fill', async () => {
      const onExtractedPayment = jest.fn();
      const tree = await renderSection({ onExtractedPayment });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(onExtractedPayment).toHaveBeenCalledWith({ amountCents: 37_921, dueDayOfMonth: 22 });
    });

    it('does not call onExtractedPayment when the statement showed neither figure', async () => {
      mockExtractLoan.mockResolvedValue({
        draft: { ...DRAFT, monthlyPaymentCents: null, dueDayOfMonth: null },
      });
      const onExtractedPayment = jest.fn();
      const tree = await renderSection({ onExtractedPayment });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(onExtractedPayment).not.toHaveBeenCalled();
    });

    it('shows a friendly alert and leaves fields untouched on a failed read', async () => {
      mockExtractLoan.mockRejectedValue(new Error('boom'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-camera' }).props.onPress();
        await flushMicrotasks();
      });

      expect(alertSpy).toHaveBeenCalledWith('Could not read that', expect.any(String));
      expect(tree.root.findByProps({ testID: 'loan-principal' }).props.value).toBe('');
      expect(mockUpsertLoan).not.toHaveBeenCalled();
    });

    it('reads a statement from Google Drive the same way as camera/gallery/file', async () => {
      const tree = await renderSection();
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(true);
      });
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-toggle' }).props.onPress();
      });
      // The Drive tile opens the CloudFilePicker; it isn't visible until then.
      expect(tree.root.findAllByProps({ testID: 'loan-drive-picker' })).toHaveLength(0);
      await act(async () => {
        tree.root.findByProps({ testID: 'loan-ai-fill-drive' }).props.onPress();
      });
      expect(tree.root.findByProps({ testID: 'loan-drive-picker' })).toBeTruthy();

      await act(async () => {
        tree.root.findByProps({ testID: 'loan-drive-picker' }).props.onPress();
        await flushMicrotasks();
      });

      expect(mockExtractLoan).toHaveBeenCalledWith('hh-test', 'rp-1', expect.any(FormData));
      expect(tree.root.findByProps({ testID: 'loan-principal' }).props.value).toBe('18000');
      expect(tree.root.findByProps({ testID: 'loan-term-months' }).props.value).toBe('60');
      expect(tree.root.findByProps({ testID: 'loan-lender' }).props.value).toBe('Toyota Financial');
      expect(mockUpsertLoan).not.toHaveBeenCalled();
      // The picker closes itself once a file is handed back.
      expect(tree.root.findAllByProps({ testID: 'loan-drive-picker' })).toHaveLength(0);
    });
  });
});
