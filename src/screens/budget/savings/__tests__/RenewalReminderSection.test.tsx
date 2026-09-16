/**
 * RenewalReminderSection — "track a renewal" for one Monthly-Payments item.
 * Covers: cold load (nothing tracked), enabling tracking + save (validates the
 * date, calls upsert with the picked category/cycle), an existing renewal
 * pre-filling the fields, "Mark as renewed" (confirm → markRenewed), and
 * "stop tracking" (confirm → remove). Attachment upload is exercised at the
 * screen-integration level via `ScanImportSources`'s stubbed camera/gallery/
 * file handlers — the native picker libraries themselves are mocked out here,
 * same convention as `MortgageStatementFormScreen.test.tsx`.
 */
jest.mock('@components/common', () => {
  const React = require('react');
  const { TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    ScanImportSources: ({
      testIDPrefix,
      onFile,
    }: {
      testIDPrefix?: string;
      onFile?: () => void;
    }) => React.createElement(TouchableOpacity, { testID: `${testIDPrefix}-file`, onPress: onFile }),
  };
});

jest.mock('@components/cloud-storage', () => ({
  __esModule: true,
  CloudFilePicker: () => null,
}));

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));
jest.mock('expo-document-picker', () => ({ __esModule: true, getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ __esModule: true, cacheDirectory: '/cache/', downloadAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ __esModule: true, isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));

const mockGetRenewal = jest.fn();
const mockUpsertRenewal = jest.fn();
const mockMarkRenewed = jest.fn();
const mockRemoveRenewal = jest.fn();
jest.mock('@api/budgetRenewals', () => ({
  __esModule: true,
  RENEWAL_CATEGORIES: ['insurance', 'warranty', 'subscription', 'membership', 'license', 'other'],
  RENEWAL_CYCLES: ['monthly', 'quarterly', 'semi_annual', 'annual', 'custom'],
  RENEWAL_DOCUMENT_SOURCES: ['camera', 'gallery', 'file', 'drive', 'manual'],
  RENEWAL_DOCUMENT_MIME_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
  budgetRenewalsApi: {
    get: (...a: unknown[]) => mockGetRenewal(...a),
    upsert: (...a: unknown[]) => mockUpsertRenewal(...a),
    markRenewed: (...a: unknown[]) => mockMarkRenewed(...a),
    remove: (...a: unknown[]) => mockRemoveRenewal(...a),
    createDocument: jest.fn(),
    uploadDocumentBytes: jest.fn(),
    deleteDocument: jest.fn(),
  },
  budgetRenewalDocumentContentSource: jest.fn(() => null),
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { RenewalReminderSection } from '../RenewalReminderSection';

async function renderSection() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <RenewalReminderSection
          householdId="hh-test"
          recurringPaymentId="rp-1"
          recurringPaymentLabel="Condo insurance"
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

describe('RenewalReminderSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRenewal.mockResolvedValue({ renewal: null, documents: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches this payment\'s renewal on mount and starts with tracking off', async () => {
    const tree = await renderSection();
    expect(mockGetRenewal).toHaveBeenCalledWith('hh-test', 'rp-1');
    expect(tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.value).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'renewal-save' })).toHaveLength(0);
  });

  it('turning tracking on reveals the fields; saving validates the date', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderSection();
    await act(async () => {
      tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.onValueChange(true);
    });
    expect(tree.root.findByProps({ testID: 'renewal-save' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'renewal-next-date' }).props.onChangeText('not-a-date');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'renewal-save' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Invalid date', expect.any(String));
    expect(mockUpsertRenewal).not.toHaveBeenCalled();
  });

  it('saves the picked category/cycle/date to budgetRenewalsApi.upsert', async () => {
    mockUpsertRenewal.mockResolvedValue({
      renewal: {
        id: 'ren-1',
        household_id: 'hh-test',
        recurring_payment_id: 'rp-1',
        category: 'insurance',
        provider: null,
        reference_number: null,
        cycle: 'annual',
        cycle_months: null,
        next_renewal_date: '2999-09-15',
        renewal_amount_cents: null,
        auto_renew: false,
        reminder_lead_days: 14,
        status: 'upcoming',
        notes: null,
        last_renewed_at: null,
        renewal_count: 0,
        created_by: null,
        created_at: '',
        updated_at: '',
      },
    });
    const tree = await renderSection();
    await act(async () => {
      tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.onValueChange(true);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'renewal-category-insurance' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'renewal-next-date' }).props.onChangeText('2999-09-15');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'renewal-save' }).props.onPress();
    });

    expect(mockUpsertRenewal).toHaveBeenCalledWith(
      'hh-test',
      'rp-1',
      expect.objectContaining({ category: 'insurance', next_renewal_date: '2999-09-15' })
    );
    // A saved renewal reveals "Mark as renewed" + attachments.
    expect(tree.root.findByProps({ testID: 'renewal-mark-renewed' })).toBeTruthy();
  });

  it('pre-fills from an existing renewal and rolls it forward on "Mark as renewed"', async () => {
    mockGetRenewal.mockResolvedValue({
      renewal: {
        id: 'ren-1',
        household_id: 'hh-test',
        recurring_payment_id: 'rp-1',
        category: 'insurance',
        provider: 'Aviva',
        reference_number: 'POL-1',
        cycle: 'annual',
        cycle_months: null,
        next_renewal_date: '2999-09-15',
        renewal_amount_cents: null,
        auto_renew: false,
        reminder_lead_days: 14,
        status: 'upcoming',
        notes: null,
        last_renewed_at: null,
        renewal_count: 0,
        created_by: null,
        created_at: '',
        updated_at: '',
      },
      documents: [],
    });
    mockMarkRenewed.mockResolvedValue({
      renewal: {
        id: 'ren-1',
        household_id: 'hh-test',
        recurring_payment_id: 'rp-1',
        category: 'insurance',
        provider: 'Aviva',
        reference_number: 'POL-1',
        cycle: 'annual',
        cycle_months: null,
        next_renewal_date: '3000-09-15',
        renewal_amount_cents: null,
        auto_renew: false,
        reminder_lead_days: 14,
        status: 'upcoming',
        notes: null,
        last_renewed_at: '2999-09-01T00:00:00.000Z',
        renewal_count: 1,
        created_by: null,
        created_at: '',
        updated_at: '',
      },
    });

    const tree = await renderSection();
    expect(tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.value).toBe(true);
    expect(tree.root.findByProps({ testID: 'renewal-provider' }).props.value).toBe('Aviva');
    expect(tree.root.findByProps({ testID: 'renewal-next-date' }).props.value).toBe('2999-09-15');

    confirmAlert('Mark renewed');
    await act(async () => {
      await tree.root.findByProps({ testID: 'renewal-mark-renewed' }).props.onPress();
    });
    expect(mockMarkRenewed).toHaveBeenCalledWith('hh-test', 'rp-1');
    expect(tree.root.findByProps({ testID: 'renewal-next-date' }).props.value).toBe('3000-09-15');
  });

  it('stopping tracking removes the renewal after confirming', async () => {
    mockGetRenewal.mockResolvedValue({
      renewal: {
        id: 'ren-1',
        household_id: 'hh-test',
        recurring_payment_id: 'rp-1',
        category: 'other',
        provider: null,
        reference_number: null,
        cycle: 'annual',
        cycle_months: null,
        next_renewal_date: '2999-09-15',
        renewal_amount_cents: null,
        auto_renew: false,
        reminder_lead_days: 14,
        status: 'upcoming',
        notes: null,
        last_renewed_at: null,
        renewal_count: 0,
        created_by: null,
        created_at: '',
        updated_at: '',
      },
      documents: [],
    });
    mockRemoveRenewal.mockResolvedValue({ success: true });

    const tree = await renderSection();
    expect(tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.value).toBe(true);

    confirmAlert('Stop tracking');
    await act(async () => {
      await tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.onValueChange(false);
    });
    expect(mockRemoveRenewal).toHaveBeenCalledWith('hh-test', 'rp-1');
    expect(tree.root.findByProps({ testID: 'renewal-tracking-switch' }).props.value).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'renewal-save' })).toHaveLength(0);
  });
});
