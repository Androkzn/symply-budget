import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, type RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { householdsApi, type HouseholdMember } from '@api/households';
import {
  savingsApi,
  type SavingsImportDraft,
  type SavingsImportScope,
  type SavingsHistorySelections,
} from '@api/savings';
import { AIAccessGate } from '@components/ai/AIAccessGate';
import { AppBackground, ProcessingOverlay, SafeAreaView, ScanImportSources, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';


type Nav = NativeStackNavigationProp<BudgetStackParamList>;

interface ScopeCopy {
  title: string;
  inputLabel: string;
  placeholder: string;
}

/** Per-type wording so the one importer reads as a focused Income / Spending /
 *  Monthly-Payments flow. Backend uses the matching scope to pick its prompt. */
const SCOPE_COPY: Record<SavingsImportScope, ScopeCopy> = {
  all: {
    title: 'Import to Savings',
    inputLabel: 'Paste a statement, payslip, or notes',
    placeholder: 'e.g. Payroll $4,200 on the 1st. Rent $1,800/mo. Groceries $340.',
  },
  income: {
    title: 'Import income',
    inputLabel: 'Paste a payslip, deposits, or income notes',
    placeholder: 'e.g. Payroll $4,200 on the 1st. Rental income $1,500/mo. Tax refund $900.',
  },
  spending: {
    title: 'Import spending',
    inputLabel: 'Paste a receipt, statement, or spending notes',
    placeholder: 'e.g. Groceries $340 on Jul 2. Dinner out $85. New couch $1,200.',
  },
  recurring: {
    title: 'Import monthly payments',
    inputLabel: 'Paste your monthly bills, subscriptions, or a "Monthly Payments" sheet',
    placeholder: 'e.g. Rent $1,800. Hydro $85. Internet $89. Netflix $16.99. Car loan $410.',
  },
  history: {
    title: 'Import previous years',
    inputLabel: 'Upload or paste a whole-year budget sheet (months down rows or across columns)',
    placeholder:
      'e.g. a screenshot of your yearly tracker — a months × categories grid, laid out either way (one row per month, or one column per month).',
  },
};

const IMPORT_ATTACHMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB client cap

interface Attachment {
  uri: string;
  name: string;
  type: string;
  size: number | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Period label for an extracted row: "January 2026" for a whole-month entry
 * (day = 01, the common spreadsheet case), else the specific date "Jan 5, 2026".
 */
function formatDraftPeriod(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-');
  if (d === '01') return `${MONTH_NAMES[Number(m) - 1] ?? ''} ${y}`.trim();
  return ymdToLocal(ymd).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ymdToLocal(ymd: string): Date {
  return new Date(ymd.slice(0, 10) + 'T12:00:00');
}

/** Display name for a household member (falls back to the email local-part). */
function memberLabel(m: { display_name: string | null; email: string }): string {
  return m.display_name?.trim() || m.email.split('@')[0];
}

function guessMimeType(name: string, fallback = 'application/pdf'): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return fallback;
}

/** True for a client-side timeout / lost-connection (not a real server rejection). */
function isTimeoutLikeError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; response?: unknown } | undefined;
  if (!e) return false;
  if (e.code === 'ECONNABORTED') return true; // axios timeout
  if (e.response) return false; // server actually answered → terminal
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('network');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), ms));

// Editable draft rows — carry an `include` flag + a mutable copy of the fields we let the user tweak.
// (Use `type` intersections, not `interface extends`: you cannot extend an indexed-access type.)
type IncomeRow = SavingsImportDraft['income'][number] & { include: boolean };
type SpendingRow = SavingsImportDraft['spending'][number] & { include: boolean };
type PaymentRow = SavingsImportDraft['recurringPayments'][number] & { include: boolean };
type GridRow = NonNullable<SavingsImportDraft['monthlyGridSpending']>[number] & { include: boolean };

interface EditableDraft {
  income: IncomeRow[];
  spending: SpendingRow[];
  recurringPayments: PaymentRow[];
  monthlyGrid: GridRow[];
}

function toEditable(draft: SavingsImportDraft): EditableDraft {
  return {
    income: draft.income.map((r) => ({ ...r, include: true })),
    spending: draft.spending.map((r) => ({ ...r, include: true })),
    recurringPayments: draft.recurringPayments.map((r) => ({ ...r, include: true })),
    monthlyGrid: (draft.monthlyGridSpending ?? []).map((r) => ({ ...r, include: true })),
  };
}

/** "March 2025" label for a 'YYYY-MM' grid period. */
function formatGridPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const [y, m] = period.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? ''} ${y}`.trim();
}

/** Build the commit payload from included rows, stripping the local `include` flag. */
function toSelections(draft: EditableDraft): SavingsImportDraft {
  return {
    income: draft.income
      .filter((r) => r.include)
      .map((r) => ({
        member_name: r.member_name,
        source_type: r.source_type,
        label: r.label,
        amount_cents: r.amount_cents,
        income_date: r.income_date,
        is_recurring: r.is_recurring,
        day_of_month: r.day_of_month,
      })),
    spending: draft.spending
      .filter((r) => r.include)
      .map((r) => ({
        category_name: r.category_name,
        label: r.label,
        amount_cents: r.amount_cents,
        spending_date: r.spending_date,
      })),
    recurringPayments: draft.recurringPayments
      .filter((r) => r.include)
      .map((r) => ({
        label: r.label,
        amount_cents: r.amount_cents,
        category_name: r.category_name,
        day_of_month: r.day_of_month,
        group_label: r.group_label,
        is_essential: r.is_essential,
      })),
  };
}

/** Build the previous-years commit payload (income + grid cells) from included rows. */
function toHistorySelections(draft: EditableDraft): SavingsHistorySelections {
  return {
    income: draft.income
      .filter((r) => r.include)
      .map((r) => ({
        member_name: r.member_name,
        source_type: r.source_type,
        label: r.label,
        amount_cents: r.amount_cents,
        income_date: r.income_date,
        is_recurring: r.is_recurring,
        day_of_month: r.day_of_month,
      })),
    monthlyGridSpending: draft.monthlyGrid
      .filter((r) => r.include)
      .map((r) => ({
        period: r.period,
        category_name: r.category_name,
        amount_cents: r.amount_cents,
      })),
  };
}

function centsFromDollarsInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

export function SavingsImportScreen({
  route,
}: {
  route?: RouteProp<BudgetStackParamList, 'SavingsImport'>;
} = {}) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const scope: SavingsImportScope = route?.params?.scope ?? 'all';
  const copy = SCOPE_COPY[scope];
  const navigation = useNavigation<Nav>();
  const { currentHousehold } = useHouseholdStore();
  const { markDirty, setSelectedMonth } = useSavingsStore();

  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [stillProcessing, setStillProcessing] = useState(false);
  const [members, setMembers] = useState<HouseholdMember[]>([]);

  // Household members for the income Member dropdown in the review list.
  useEffect(() => {
    if (!currentHousehold?.id) return;
    householdsApi
      .get(currentHousehold.id)
      .then((res) => setMembers(res.members))
      .catch(() => {});
  }, [currentHousehold?.id]);

  const canAnalyze = Boolean(text.trim() || attachment);

  const includedCount = useMemo(() => {
    if (!draft) return 0;
    return (
      draft.income.filter((r) => r.include).length +
      draft.spending.filter((r) => r.include).length +
      draft.recurringPayments.filter((r) => r.include).length +
      draft.monthlyGrid.filter((r) => r.include).length
    );
  }, [draft]);

  const totalCount = useMemo(() => {
    if (!draft) return 0;
    return (
      draft.income.length +
      draft.spending.length +
      draft.recurringPayments.length +
      draft.monthlyGrid.length
    );
  }, [draft]);

  const allSelected = totalCount > 0 && includedCount === totalCount;

  // How many result sections have rows. When only one section is present, the
  // global "X of Y selected · Select/Deselect all" row already controls it, so
  // the per-section header toggle would be a duplicate — hide it in that case.
  const visibleSectionCount = useMemo(() => {
    if (!draft) return 0;
    return (
      (draft.income.length > 0 ? 1 : 0) +
      (draft.spending.length > 0 ? 1 : 0) +
      (draft.recurringPayments.length > 0 ? 1 : 0) +
      (draft.monthlyGrid.length > 0 ? 1 : 0)
    );
  }, [draft]);
  const showSectionToggles = visibleSectionCount > 1;

  // Flip the `include` flag on every row (used by the global Select/Deselect all).
  const setAllIncluded = (include: boolean) =>
    setDraft((prev) =>
      prev
        ? {
            income: prev.income.map((r) => ({ ...r, include })),
            spending: prev.spending.map((r) => ({ ...r, include })),
            recurringPayments: prev.recurringPayments.map((r) => ({ ...r, include })),
            monthlyGrid: prev.monthlyGrid.map((r) => ({ ...r, include })),
          }
        : prev
    );
  const setIncomeAll = (include: boolean) =>
    setDraft((prev) =>
      prev ? { ...prev, income: prev.income.map((r) => ({ ...r, include })) } : prev
    );
  const setSpendingAll = (include: boolean) =>
    setDraft((prev) =>
      prev ? { ...prev, spending: prev.spending.map((r) => ({ ...r, include })) } : prev
    );
  const setPaymentsAll = (include: boolean) =>
    setDraft((prev) =>
      prev
        ? { ...prev, recurringPayments: prev.recurringPayments.map((r) => ({ ...r, include })) }
        : prev
    );
  const setGridAll = (include: boolean) =>
    setDraft((prev) =>
      prev ? { ...prev, monthlyGrid: prev.monthlyGrid.map((r) => ({ ...r, include })) } : prev
    );

  const showDraft = (jid: string, d: SavingsImportDraft) => {
    setJobId(jid);
    setDraft(toEditable(d));
    setStillProcessing(false);
  };

  // Client timeout recovery (plan W4): a long Sonnet PDF/vision read can outlast the
  // 2-min upload timeout. Poll importGet a few times with backoff before giving up.
  const recoverAfterTimeout = async (hid: string, knownJobId: string | null) => {
    if (!knownJobId) {
      setStillProcessing(true);
      Alert.alert(
        'Still working',
        'This is taking a while. Please reopen Import shortly to see the result, or try again.'
      );
      return;
    }
    /* istanbul ignore next -- defensive recovery poll: the analyze timeout path never yields a jobId with today's API, so this block is unreachable from the UI */
    {
      const delays = [3000, 5000, 8000];
      for (const delay of delays) {
        await sleep(delay);
        try {
          const { job, draft: polled } = await savingsApi.importGet(hid, knownJobId);
          if (job.status === 'ready' && polled) {
            showDraft(knownJobId, polled);
            return;
          }
          if (job.status === 'failed') {
            Alert.alert('Import failed', 'We could not read that file. Please try a clearer copy.');
            return;
          }
        } catch (pollError) {
          console.error('Error polling savings import job:', pollError);
        }
      }
      // Still analyzing after the poll window.
      setJobId(knownJobId);
      setStillProcessing(true);
      Alert.alert(
        'Still processing',
        'This import is still being read. Reopen shortly — your file is safe and nothing was saved.'
      );
    }
  };

  const handleAnalyze = async () => {
    if (!currentHousehold?.id || !canAnalyze || isAnalyzing) return;
    /* istanbul ignore next -- defensive: every attach path (gallery/file/drive) already rejects >20MB before setting the attachment */
    if (attachment?.size != null && attachment.size > MAX_UPLOAD_BYTES) {
      Alert.alert('File too large', 'Please choose a file under 20 MB.');
      return;
    }
    const hid = currentHousehold.id;
    setIsAnalyzing(true);
    setDraft(null);
    setJobId(null);
    setStillProcessing(false);
    let returnedJobId: string | null = null;
    try {
      const result = attachment
        ? await savingsApi.importAnalyzeWithFile(
            hid,
            await toVisionSafeAttachment({
              uri: attachment.uri,
              type: attachment.type,
              name: attachment.name,
            }),
            text.trim() || undefined,
            scope
          )
        : await savingsApi.importAnalyze(hid, text.trim(), scope);
      returnedJobId = result.jobId ?? null;
      showDraft(result.jobId, result.draft);
    } catch (error) {
      if (isTimeoutLikeError(error)) {
        // Not terminal — the job may still finish. Try to recover it.
        await recoverAfterTimeout(hid, returnedJobId);
      } else {
        // Surface the backend's user-friendly reason (e.g. "try a clearer file
        // or paste the numbers as text"); avoid console.error so the dev red-box
        // doesn't hide it.
        const serverMsg = (
          error as { response?: { data?: { message?: string; error?: string } } }
        )?.response?.data?.message;
        Alert.alert(
          "Couldn't import",
          serverMsg ||
            'We could not read that file. Try a clearer photo, a PDF, or paste the numbers as text.'
        );
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Where a statement comes from — all four, from the shared hook.
   *
   * The camera tile was the one missing: three pickers were written by hand
   * here and photographing a paper statement, which is the most obvious way to
   * import one, was not among them. The 20 MB ceiling is enforced once, on
   * whatever any of the four hands back, instead of three times in three
   * slightly different ways.
   */
  const { sourceHandlers, drivePicker } = useAttachmentSources({
    rememberScope: 'savings-import',
    mimeTypes: [...IMPORT_ATTACHMENT_MIMES],
    maxFileBytes: MAX_UPLOAD_BYTES,
    pickerOptions: {
      cropping: false,
      compressImageQuality: 0.8,
      mediaType: 'photo',
    },
    onPicked: ([picked]) => {
      if (!picked) return;
      const size = typeof picked.size === 'number' ? picked.size : null;
      if (size != null && size > MAX_UPLOAD_BYTES) {
        Alert.alert('File too large', 'Please choose a file under 20 MB.');
        return;
      }
      setAttachment({
        uri: picked.uri,
        name: picked.name || 'attachment',
        type: picked.mime || guessMimeType(picked.name || ''),
        size,
      });
    },
  });

  const toggleIncome = (index: number) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            income: prev.income.map((r, i) => (i === index ? { ...r, include: !r.include } : r)),
          }
        : prev
    );
  const editIncomeAmount = (index: number, raw: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            income: prev.income.map((r, i) =>
              i === index ? { ...r, amount_cents: centsFromDollarsInput(raw) } : r
            ),
          }
        : prev
    );
  const editIncomeMember = (index: number, member: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            income: prev.income.map((r, i) =>
              i === index ? { ...r, member_name: member.trim() || null } : r
            ),
          }
        : prev
    );
  const editIncomeLabel = (index: number, raw: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            income: prev.income.map((r, i) => (i === index ? { ...r, label: raw } : r)),
          }
        : prev
    );

  // Native iOS action-sheet member picker for an income row.
  const pickIncomeMember = (index: number) => {
    if (Platform.OS === 'ios') {
      const options = ['No member', ...members.map(memberLabel), 'Cancel'];
      const cancelButtonIndex = options.length - 1;
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Select member', options, cancelButtonIndex },
        (i) => {
          if (i === cancelButtonIndex) return;
          editIncomeMember(index, i === 0 ? '' : memberLabel(members[i - 1]));
        }
      );
    }
  };

  const toggleSpending = (index: number) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            spending: prev.spending.map((r, i) =>
              i === index ? { ...r, include: !r.include } : r
            ),
          }
        : prev
    );
  const editSpendingAmount = (index: number, raw: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            spending: prev.spending.map((r, i) =>
              i === index ? { ...r, amount_cents: centsFromDollarsInput(raw) } : r
            ),
          }
        : prev
    );
  const editSpendingCategory = (index: number, category: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            spending: prev.spending.map((r, i) =>
              i === index ? { ...r, category_name: category.trim() || null } : r
            ),
          }
        : prev
    );

  const togglePayment = (index: number) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            recurringPayments: prev.recurringPayments.map((r, i) =>
              i === index ? { ...r, include: !r.include } : r
            ),
          }
        : prev
    );
  const editPaymentAmount = (index: number, raw: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            recurringPayments: prev.recurringPayments.map((r, i) =>
              i === index ? { ...r, amount_cents: centsFromDollarsInput(raw) } : r
            ),
          }
        : prev
    );
  const editPaymentCategory = (index: number, category: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            recurringPayments: prev.recurringPayments.map((r, i) =>
              i === index ? { ...r, category_name: category.trim() || null } : r
            ),
          }
        : prev
    );

  const toggleGrid = (index: number) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            monthlyGrid: prev.monthlyGrid.map((r, i) =>
              i === index ? { ...r, include: !r.include } : r
            ),
          }
        : prev
    );
  const editGridAmount = (index: number, raw: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            monthlyGrid: prev.monthlyGrid.map((r, i) =>
              i === index ? { ...r, amount_cents: centsFromDollarsInput(raw) } : r
            ),
          }
        : prev
    );
  const editGridCategory = (index: number, category: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            monthlyGrid: prev.monthlyGrid.map((r, i) =>
              i === index ? { ...r, category_name: category } : r
            ),
          }
        : prev
    );

  const handleCommit = async () => {
    if (!currentHousehold?.id || !jobId || !draft || isCommitting) return;
    if (includedCount === 0) {
      Alert.alert('Nothing selected', 'Include at least one row before saving.');
      return;
    }
    setIsCommitting(true);
    try {
      if (scope === 'history') {
        const result = await savingsApi.importCommitHistory(
          currentHousehold.id,
          jobId,
          toHistorySelections(draft)
        );
        markDirty();
        const yearLabel = result.years.length ? ` (${result.years.join(', ')})` : '';
        Alert.alert(
          'Previous years imported',
          `${result.income} monthly income · ${result.spending} spending entries added${yearLabel}.`
        );
        navigation.goBack();
        return;
      }
      const selections = toSelections(draft);
      const result = await savingsApi.importCommit(currentHousehold.id, jobId, selections);
      markDirty();

      // The Savings views are scoped to the selected month, but imported rows
      // carry their real statement dates (usually a past/other month). Without
      // this, returning to the (current-month) list shows nothing new — it reads
      // as "the import didn't save". Jump the view to the most recent imported
      // month across BOTH income and spending so the new rows are immediately
      // visible (a spending-only import has no income, so keying off income
      // alone left the view on the wrong month), and flag multi-month imports.
      const importedMonths = [
        ...selections.income.map((r) => r.income_date.slice(0, 7)),
        ...selections.spending.map((r) => r.spending_date.slice(0, 7)),
      ].filter((p) => /^\d{4}-\d{2}$/.test(p));
      const distinctMonths = new Set(importedMonths).size;
      if (importedMonths.length > 0) {
        const [y, m] = importedMonths.reduce((a, b) => (a > b ? a : b)).split('-').map(Number);
        setSelectedMonth(y, m);
      }
      const spanNote =
        distinctMonths > 1
          ? `\n\nImport spans ${distinctMonths} months — use the month selector to review each.`
          : '';
      Alert.alert(
        'Saved to Savings',
        `${result.income} income · ${result.spending} spending · ${result.recurringPayments} monthly payments added.${spanNote}`
      );
      navigation.goBack();
    } catch (error) {
      console.error('Error committing savings import:', error);
      Alert.alert('Error', 'Could not save these items. Please try again.');
    } finally {
      setIsCommitting(false);
    }
  };

  const renderSelectToggle = (selected: boolean, onPress: () => void, testID: string) => (
    <TouchableOpacity
      onPress={onPress}
      testID={testID}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Typography variant="caption1" weight="semibold" color={theme.pastel.teal}>
        {selected ? 'Deselect all' : 'Select all'}
      </Typography>
    </TouchableOpacity>
  );

  const renderCheck = (included: boolean) => (
    <View
      style={[
        styles.check,
        {
          borderColor: included ? theme.pastel.teal : colors.borderColor,
          backgroundColor: included ? theme.pastel.teal : 'transparent',
        },
      ]}
    >
      {included && <Icon name="checkmark" size={14} color={colors.white} />}
    </View>
  );

  return (
    <AIAccessGate title="Unlock AI for savings import">
    <AppBackground>
    <SafeAreaView edges={[]} testID="savings-import">
      <ScreenHeader
        title={copy.title}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.attachSection}>
          <Typography variant="caption1" weight="medium" color={colors.textSecondary}>
            Attach a statement / receipt (PDF or image, under 20 MB)
          </Typography>
          <ScanImportSources
            testIDPrefix="savings-import"
            disabled={isAnalyzing}
            {...sourceHandlers}
          />
          {attachment && (
            <View
              style={[
                styles.attachmentChip,
                { backgroundColor: colors.backgroundSecondary, borderColor: theme.pastel.teal },
              ]}
            >
              <Icon name="document-attach-outline" size={18} color={theme.pastel.teal} />
              <Typography
                variant="caption1"
                weight="medium"
                style={styles.attachmentName}
                numberOfLines={1}
              >
                {attachment.name}
              </Typography>
              <TouchableOpacity
                onPress={() => setAttachment(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="savings-import-remove-attachment"
              >
                <Icon name="close-circle" size={IconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TextInput
          testID="savings-import-input"
          label={copy.inputLabel}
          placeholder={copy.placeholder}
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={4}
          style={styles.multiline}
        />

        <GradientButton
          title="Analyze"
          variant="blue"
          onPress={handleAnalyze}
          disabled={!canAnalyze}
          loading={isAnalyzing}
          fullWidth
          testID="savings-import-analyze"
        />

        {stillProcessing && !draft && (
          <View style={[styles.notice, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="body" color={colors.textSecondary} align="center">
              Still processing — reopen this screen shortly to review the import. Nothing has been
              saved yet.
            </Typography>
          </View>
        )}

        {draft && (
          <>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.reviewLabel}
            >
              Review and edit, then save. Nothing is saved until you press Save.
            </Typography>

            {totalCount > 0 && (
              <View style={styles.selectAllRow}>
                <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
                  {`${includedCount} of ${totalCount} selected`}
                </Typography>
                {renderSelectToggle(
                  allSelected,
                  () => setAllIncluded(!allSelected),
                  'savings-import-select-all'
                )}
              </View>
            )}

            {/* Income */}
            {draft.income.length > 0 && (
              <View style={styles.section} testID="savings-import-section-income">
                <View style={styles.sectionHeader}>
                  <Typography variant="subheadline" weight="semibold">
                    Income
                  </Typography>
                  {showSectionToggles &&
                    renderSelectToggle(
                      draft.income.every((r) => r.include),
                      () => setIncomeAll(!draft.income.every((r) => r.include)),
                      'savings-import-select-income'
                    )}
                </View>
                {draft.income.map((row, i) => (
                  <View
                    key={`income-${i}`}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.backgroundSecondary,
                        borderColor: row.include ? theme.pastel.teal : colors.borderColor,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.cardTop}
                      activeOpacity={0.8}
                      onPress={() => toggleIncome(i)}
                      testID="savings-import-income-toggle"
                    >
                      {renderCheck(row.include)}
                      <Typography
                        variant="body"
                        weight="semibold"
                        style={styles.cardTitle}
                        numberOfLines={2}
                      >
                        {row.label}
                      </Typography>
                    </TouchableOpacity>
                    <View style={styles.editStack}>
                      <TextInput
                        label="Name"
                        value={row.label}
                        onChangeText={(v) => editIncomeLabel(i, v)}
                        placeholder="Income name"
                        testID="savings-import-income-label"
                      />
                      <TextInput
                        label="Amount ($)"
                        value={(row.amount_cents / 100).toString()}
                        onChangeText={(v) => editIncomeAmount(i, v)}
                        keyboardType="decimal-pad"
                      />
                      <View>
                        <Typography
                          variant="caption1"
                          color={colors.textSecondary}
                          style={styles.ddLabel}
                        >
                          Member
                        </Typography>
                        <TouchableOpacity
                          style={[
                            styles.memberDD,
                            {
                              borderColor: colors.borderColor,
                              backgroundColor: colors.groupedListBackground,
                            },
                          ]}
                          onPress={() => pickIncomeMember(i)}
                          testID="savings-import-income-member"
                        >
                          <Typography
                            variant="body"
                            numberOfLines={1}
                            color={row.member_name ? colors.textPrimary : colors.textSecondary}
                          >
                            {row.member_name || 'Select member'}
                          </Typography>
                          <Icon name="chevron-down" size={IconSize.sm} color={theme.pastel.teal} />
                        </TouchableOpacity>
                      </View>
                      <View>
                        <Typography
                          variant="caption1"
                          color={colors.textSecondary}
                          style={styles.ddLabel}
                        >
                          Month / date
                        </Typography>
                        <Typography variant="body">
                          {formatDraftPeriod(row.income_date) || '—'}
                        </Typography>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Spending */}
            {draft.spending.length > 0 && (
              <View style={styles.section} testID="savings-import-section-spending">
                <View style={styles.sectionHeader}>
                  <Typography variant="subheadline" weight="semibold">
                    Spending
                  </Typography>
                  {showSectionToggles &&
                    renderSelectToggle(
                      draft.spending.every((r) => r.include),
                      () => setSpendingAll(!draft.spending.every((r) => r.include)),
                      'savings-import-select-spending'
                    )}
                </View>
                {draft.spending.map((row, i) => (
                  <View
                    key={`spending-${i}`}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.backgroundSecondary,
                        borderColor: row.include ? theme.pastel.teal : colors.borderColor,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.cardTop}
                      activeOpacity={0.8}
                      onPress={() => toggleSpending(i)}
                      testID="savings-import-spending-toggle"
                    >
                      {renderCheck(row.include)}
                      <Typography
                        variant="body"
                        weight="semibold"
                        style={styles.cardTitle}
                        numberOfLines={2}
                      >
                        {row.label}
                      </Typography>
                    </TouchableOpacity>
                    <View style={styles.editStack}>
                      <TextInput
                        label="Amount ($)"
                        value={(row.amount_cents / 100).toString()}
                        onChangeText={(v) => editSpendingAmount(i, v)}
                        keyboardType="decimal-pad"
                      />
                      <TextInput
                        label="Category"
                        value={row.category_name ?? ''}
                        onChangeText={(v) => editSpendingCategory(i, v)}
                        placeholder="Optional"
                      />
                      <View>
                        <Typography
                          variant="caption1"
                          color={colors.textSecondary}
                          style={styles.ddLabel}
                        >
                          Month / date
                        </Typography>
                        <Typography variant="body">
                          {formatDraftPeriod(row.spending_date) || '—'}
                        </Typography>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Monthly Payments */}
            {draft.recurringPayments.length > 0 && (
              <View style={styles.section} testID="savings-import-section-payments">
                <View style={styles.sectionHeader}>
                  <Typography variant="subheadline" weight="semibold">
                    Monthly Payments
                  </Typography>
                  {showSectionToggles &&
                    renderSelectToggle(
                      draft.recurringPayments.every((r) => r.include),
                      () => setPaymentsAll(!draft.recurringPayments.every((r) => r.include)),
                      'savings-import-select-payments'
                    )}
                </View>
                {draft.recurringPayments.map((row, i) => (
                  <View
                    key={`payment-${i}`}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.backgroundSecondary,
                        borderColor: row.include ? theme.pastel.teal : colors.borderColor,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.cardTop}
                      activeOpacity={0.8}
                      onPress={() => togglePayment(i)}
                      testID="savings-import-payment-toggle"
                    >
                      {renderCheck(row.include)}
                      <Typography
                        variant="body"
                        weight="semibold"
                        style={styles.cardTitle}
                        numberOfLines={2}
                      >
                        {row.label}
                        {row.is_essential ? ' · Essential' : ''}
                      </Typography>
                    </TouchableOpacity>
                    <View style={styles.editRow}>
                      <TextInput
                        label="Amount ($)"
                        value={(row.amount_cents / 100).toString()}
                        onChangeText={(v) => editPaymentAmount(i, v)}
                        keyboardType="decimal-pad"
                        style={styles.editInput}
                      />
                      <TextInput
                        label="Category"
                        value={row.category_name ?? ''}
                        onChangeText={(v) => editPaymentCategory(i, v)}
                        placeholder="Optional"
                        style={styles.editInput}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Monthly grid (previous-years import) */}
            {draft.monthlyGrid.length > 0 && (
              <View style={styles.section} testID="savings-import-section-grid">
                <View style={styles.sectionHeader}>
                  <Typography variant="subheadline" weight="semibold">
                    Monthly spending
                  </Typography>
                  {showSectionToggles &&
                    renderSelectToggle(
                      draft.monthlyGrid.every((r) => r.include),
                      () => setGridAll(!draft.monthlyGrid.every((r) => r.include)),
                      'savings-import-select-grid'
                    )}
                </View>
                {draft.monthlyGrid.map((row, i) => (
                  <View
                    key={`grid-${i}`}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.backgroundSecondary,
                        borderColor: row.include ? theme.pastel.teal : colors.borderColor,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.cardTop}
                      activeOpacity={0.8}
                      onPress={() => toggleGrid(i)}
                      testID="savings-import-grid-toggle"
                    >
                      {renderCheck(row.include)}
                      <Typography
                        variant="body"
                        weight="semibold"
                        style={styles.cardTitle}
                        numberOfLines={2}
                      >
                        {`${row.category_name} · ${formatGridPeriod(row.period)}`}
                      </Typography>
                    </TouchableOpacity>
                    <View style={styles.editRow}>
                      <TextInput
                        label="Amount ($)"
                        value={(row.amount_cents / 100).toString()}
                        onChangeText={(v) => editGridAmount(i, v)}
                        keyboardType="decimal-pad"
                        style={styles.editInput}
                      />
                      <TextInput
                        label="Category"
                        value={row.category_name}
                        onChangeText={(v) => editGridCategory(i, v)}
                        style={styles.editInput}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {includedCount === 0 &&
              draft.income.length === 0 &&
              draft.spending.length === 0 &&
              draft.recurringPayments.length === 0 &&
              draft.monthlyGrid.length === 0 && (
                <View style={styles.notice}>
                  <Typography variant="body" color={colors.textSecondary} align="center">
                    Nothing found to import. Try a clearer file or add more detail.
                  </Typography>
                </View>
              )}

            <GradientButton
              title={
                isCommitting
                  ? 'Saving…'
                  : includedCount > 0
                    ? scope === 'history'
                      ? `Import ${includedCount} rows`
                      : `Save ${includedCount} to Savings`
                    : 'Include at least one'
              }
              variant="blue"
              onPress={handleCommit}
              disabled={isCommitting || includedCount === 0}
              fullWidth
              style={styles.saveButton}
              testID="savings-import-save"
            />
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              align="center"
              style={styles.formatHint}
            >
              {`Preview total: ${formatCurrency(
                [
                  ...draft.income,
                  ...draft.spending,
                  ...draft.recurringPayments,
                  ...draft.monthlyGrid,
                ].reduce((sum, r) => (r.include ? sum + r.amount_cents : sum), 0)
              )} selected`}
            </Typography>
          </>
        )}
      </ScrollView>

      {drivePicker}

      {/* Blocks the screen while we read the import so it can't be re-submitted
          or abandoned mid-analysis. */}
      <ProcessingOverlay
        visible={isAnalyzing}
        message="Analyzing…"
        caption="Extracting details with AI"
      />
    </SafeAreaView>
    </AppBackground>
    </AIAccessGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance, gap: Spacing.base },
  multiline: { minHeight: Layout.multilineFieldMinHeight, textAlignVertical: 'top' },
  attachSection: { gap: Spacing.smd },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.smd,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  attachmentName: { flex: 1 },
  notice: { borderRadius: CornerRadius.md + Spacing.xxs, padding: Spacing.base },
  reviewLabel: { marginTop: Spacing.xs, marginBottom: -Spacing.xs },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  section: { gap: Spacing.smd },
  card: {
    borderRadius: CornerRadius.md + Spacing.xxs,
    borderWidth: 1.5,
    padding: Spacing.md + Spacing.xxs,
    gap: Spacing.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.smd },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1 },
  editRow: { flexDirection: 'row', gap: Spacing.md, paddingLeft: Spacing.xxl },
  editInput: { flex: 1 },
  editStack: { gap: Spacing.md, paddingLeft: Spacing.xxl, marginTop: Spacing.xs },
  ddLabel: { marginBottom: Spacing.xs },
  memberDD: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md + Spacing.xxs,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveButton: { marginTop: Spacing.xs },
  formatHint: { marginTop: -Spacing.sm },
});
