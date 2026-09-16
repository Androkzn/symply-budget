import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert } from 'react-native';

import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, ProcessingOverlay, ScreenHeader } from '@components/common';
import { Typography, Card, TextInput, GradientButton, IconBackgroundChip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  utilitiesApi,
  getDuplicateBill,
  type ExtractedBillData,
  type UtilityBill,
} from '@features/utilities/api/utilities';
import { useIsDirty } from '@hooks/useUnsavedChanges';
import type { UtilitiesStackParamList } from '@navigation/types';
import ImageCropPicker from '@services/image-picker-compat';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { prorateBillToMonths } from '@utils/bill-proration';
import { maskDayKeyInput } from '@utils/dateInput';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, formatMoneyUnits, useDisplayCurrency } from '@utils/money';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

type AddUtilityBillScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList>;

const BILL_TYPES = ['electricity', 'gas', 'water', 'garbage'] as const;

// Mirrors CreateUtilityBillRequest['billType'] in @features/utilities/api/utilities — the form
// tracks a free-form string (AI extraction can hand us anything), so we narrow
// to this union at the submit boundary instead of casting to `any`.
type UtilityBillType = 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';

// The four ways to bring a bill in. Rendered as icon-circle tiles that mirror
// the dashboard's Quick Actions so the whole utilities flow feels like one app.
type SourceOption = {
  key: 'camera' | 'gallery' | 'file' | 'drive';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

const SOURCE_OPTIONS: SourceOption[] = [
  { key: 'camera', icon: 'camera-outline', label: 'Take Photo' },
  { key: 'gallery', icon: 'images-outline', label: 'Gallery' },
  { key: 'file', icon: 'document-text-outline', label: 'Upload File' },
  { key: 'drive', icon: 'cloud-outline', label: 'Google Drive' },
];

// "Apr 2026 – Jun 2026" (or a single month) for a bill's billing period — used
// in the duplicate warning so the user knows which bill already exists.
function formatMonthRange(start?: string | null, end?: string | null): string {
  const fmt = (value?: string | null): string => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a || b || 'this period';
}

// Cents → "$12.34" for the monthly-breakdown preview.
function formatCents(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

export function AddUtilityBillScreen() {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<AddUtilityBillScreenNavigationProp>();
  const route = useRoute<RouteProp<UtilitiesStackParamList, 'AddUtilityBill'>>();
  const { currentHousehold } = useHouseholdStore();
  // When a billId is passed we're editing an existing bill instead of adding a
  // new one — the screen loads that bill, prefills the form, and PATCHes on save.
  const editingBillId = route.params?.billId ?? null;
  const isEditing = editingBillId !== null;
  const [isLoadingBill, setIsLoadingBill] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedBillData | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  // Batch import from Drive: bills the AI wasn't confident enough to auto-create
  // are queued here and reviewed one at a time (the form shows the head of the
  // queue; `reviewQueue` holds the ones still waiting behind it).
  const [reviewQueue, setReviewQueue] = useState<
    Array<{ extractedData: ExtractedBillData; documentUrl: string }>
  >([]);
  const [isReviewingBatch, setIsReviewingBatch] = useState(false);
  // "Processing 2 of 5" progress while extracting a batch of Drive files.
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  // Every bill created during a multi-file import (auto-created + manually
  // reviewed) — handed to the ConfirmBillPayments screen once the batch wraps
  // up so the user can confirm which are already paid in one place.
  const importedBillsRef = useRef<UtilityBill[]>([]);

  const [formData, setFormData] = useState({
    billType: 'electricity',
    provider: '',
    accountNumber: '',
    billingPeriodStart: '',
    billingPeriodEnd: '',
    amount: '',
    dueDate: '',
    usageQuantity: '',
    usageUnit: 'kWh',
  });
  // Snapshot of the loaded bill's editable fields (edit mode only). Save stays
  // disabled until `formData` diverges from this — see [[useUnsavedChanges]].
  const [baselineFormData, setBaselineFormData] = useState<{
    billType: string;
    provider: string;
    accountNumber: string;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    amount: string;
    dueDate: string;
    usageQuantity: string;
    usageUnit: string;
  } | null>(null);
  // Inline "already paid?" toggle for the manual/single-import add flow. Unpaid
  // (default) bills get a "Pay bill" task; paid bills don't. Multi-file imports
  // confirm this on the dedicated ConfirmBillPayments screen instead.
  const [markPaid, setMarkPaid] = useState(false);

  // Live preview of which calendar months this bill will land in, and how much
  // of its amount each gets. A bill spanning month boundaries is prorated by day
  // count (same rule the dashboard applies once saved), so the user sees exactly
  // which months get created/updated before hitting save.
  const monthlyBreakdown = useMemo(() => {
    const amountCents = Math.round(parseFloat(formData.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return [];
    return prorateBillToMonths(
      formData.billingPeriodStart,
      formData.billingPeriodEnd,
      amountCents
    );
  }, [formData.billingPeriodStart, formData.billingPeriodEnd, formData.amount]);

  // Edit mode only: has the form diverged from the loaded bill? Gates the Save
  // button so it stays disabled until there is an actual change to persist. The
  // fields here mirror exactly what `updateExistingBill` sends. In create mode
  // the baseline is null and this value is unused.
  const isDirty = useIsDirty(
    {
      billType: formData.billType,
      provider: formData.provider,
      accountNumber: formData.accountNumber,
      billingPeriodStart: formData.billingPeriodStart,
      billingPeriodEnd: formData.billingPeriodEnd,
      amount: formData.amount,
      dueDate: formData.dueDate,
      usageQuantity: formData.usageQuantity,
      usageUnit: formData.usageUnit,
    },
    baselineFormData
  );

  // Helper to format date for display (YYYY-MM-DD)
  const formatDateForInput = (dateStr: string | null): string => {
    if (!dateStr) return '';
    return dateStr;
  };

  // Apply extracted data to form
  const applyExtractedData = (data: ExtractedBillData) => {
    setFormData({
      billType: data.provider.type || 'electricity',
      provider: data.provider.name || '',
      accountNumber: data.account.number || '',
      billingPeriodStart: formatDateForInput(data.billing.periodStart),
      billingPeriodEnd: formatDateForInput(data.billing.periodEnd),
      amount: data.financial.amountDue?.toString() || '',
      dueDate: formatDateForInput(data.billing.dueDate),
      usageQuantity: data.usage.quantity?.toString() || '',
      usageUnit: data.usage.unit || 'kWh',
    });
  };

  // Edit mode: fetch the bill and prefill the form. Amounts are stored in cents
  // server-side but edited in dollars, so convert on the way in.
  useEffect(() => {
    if (!isEditing || !currentHousehold?.id || !editingBillId) return;
    let cancelled = false;
    (async () => {
      try {
        const bills = await utilitiesApi.getBills(currentHousehold.id);
        const bill = bills.find((b) => b.id === editingBillId);
        if (cancelled) return;
        if (!bill) {
          Alert.alert('Error', 'Bill not found', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
          return;
        }
        const loaded = {
          billType: bill.bill_type,
          provider: bill.provider ?? '',
          accountNumber: bill.account_number ?? '',
          billingPeriodStart: bill.billing_period_start,
          billingPeriodEnd: bill.billing_period_end,
          amount: (bill.amount / 100).toString(),
          dueDate: bill.due_date,
          usageQuantity: bill.usage_quantity != null ? String(bill.usage_quantity) : '',
          usageUnit: bill.usage_unit ?? 'kWh',
        };
        setFormData(loaded);
        // Baseline = the loaded bill's values, so Save stays disabled until edited.
        setBaselineFormData(loaded);
      } catch (err) {
        console.error('Error loading bill for edit:', err);
        if (!cancelled) Alert.alert('Error', 'Failed to load bill details');
      } finally {
        if (!cancelled) setIsLoadingBill(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, currentHousehold?.id, editingBillId, navigation]);

  // Load one queued bill into the form for review. `remaining` are the ones
  // still waiting behind it.
  const loadReviewItem = (
    item: { extractedData: ExtractedBillData; documentUrl: string },
    remaining: Array<{ extractedData: ExtractedBillData; documentUrl: string }>
  ) => {
    setExtractedData(item.extractedData);
    setDocumentUrl(item.documentUrl);
    applyExtractedData(item.extractedData);
    setMarkPaid(false); // paid status is confirmed later, on ConfirmBillPayments
    setReviewQueue(remaining);
    setIsReviewingBatch(true);
  };

  const handleScanBill = async () => {
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }

    try {
      setIsScanning(true);

      // Launch camera with react-native-image-crop-picker
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
      });

      // Upload and extract
      const safeFile = await toVisionSafeAttachment({
        uri: image.path,
        type: image.mime || 'image/jpeg',
        name: 'bill-photo.jpg',
      });
      const response = await utilitiesApi.uploadAndExtractBill(currentHousehold.id, safeFile);

      if (response.success) {
        setExtractedData(response.extractedData);
        setDocumentUrl(response.documentUrl);
        applyExtractedData(response.extractedData);

        const confidence = Math.round(response.confidence.overall * 100);
        Alert.alert(
          'Bill Scanned Successfully',
          `Extracted data with ${confidence}% confidence.\n\nProvider: ${response.extractedData.provider.name || 'Unknown'}\nAmount: ${response.extractedData.financial.amountDue != null ? formatMoneyUnits(response.extractedData.financial.amountDue, { decimals: 2 }) : 'N/A'}\n\nPlease review and confirm the details.${response.duplicate ? '\n\n⚠️ This looks like a bill you already added.' : ''}`
        );
      }
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error scanning bill:', error);
        Alert.alert('Error', 'Failed to scan bill. Please try again or enter manually.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handlePickFromGallery = async () => {
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }

    try {
      setIsScanning(true);

      // Launch image picker with react-native-image-crop-picker
      const image = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });

      // Upload and extract
      const safeFile = await toVisionSafeAttachment({
        uri: image.path,
        type: image.mime || 'image/jpeg',
        name: 'bill-image.jpg',
      });
      const response = await utilitiesApi.uploadAndExtractBill(currentHousehold.id, safeFile);

      if (response.success) {
        setExtractedData(response.extractedData);
        setDocumentUrl(response.documentUrl);
        applyExtractedData(response.extractedData);

        const confidence = Math.round(response.confidence.overall * 100);
        Alert.alert(
          'Bill Processed Successfully',
          `Extracted data with ${confidence}% confidence.\n\nProvider: ${response.extractedData.provider.name || 'Unknown'}\nAmount: ${response.extractedData.financial.amountDue != null ? formatMoneyUnits(response.extractedData.financial.amountDue, { decimals: 2 }) : 'N/A'}\n\nPlease review and confirm the details.${response.duplicate ? '\n\n⚠️ This looks like a bill you already added.' : ''}`
        );
      }
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error picking from gallery:', error);
        Alert.alert('Error', 'Failed to process bill. Please try again or enter manually.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleUploadPDF = async () => {
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }

    try {
      setIsScanning(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];

        // Upload and extract
        const response = await utilitiesApi.uploadAndExtractBill(currentHousehold.id, {
          uri: asset.uri,
          type: asset.mimeType || 'application/pdf',
          name: asset.name || 'bill.pdf',
        });

        if (response.success) {
          setExtractedData(response.extractedData);
          setDocumentUrl(response.documentUrl);
          applyExtractedData(response.extractedData);

          const confidence = Math.round(response.confidence.overall * 100);
          Alert.alert(
            'Bill Processed Successfully',
            `Extracted data with ${confidence}% confidence.\n\nProvider: ${response.extractedData.provider.name || 'Unknown'}\nAmount: ${response.extractedData.financial.amountDue != null ? formatMoneyUnits(response.extractedData.financial.amountDue, { decimals: 2 }) : 'N/A'}\n\nPlease review and confirm the details.${response.duplicate ? '\n\n⚠️ This looks like a bill you already added.' : ''}`
          );
        }
      }
    } catch (error) {
      console.error('Error uploading PDF:', error);
      Alert.alert('Error', 'Failed to process bill. Please try again or enter manually.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleDriveFileSelected = async (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }

    try {
      setIsScanning(true);

      const response = await utilitiesApi.uploadAndExtractBill(currentHousehold.id, {
        uri: file.uri,
        type: 'application/pdf',
        name: file.name || 'bill.pdf',
      });

      if (response.success) {
        setExtractedData(response.extractedData);
        setDocumentUrl(response.documentUrl);
        applyExtractedData(response.extractedData);

        const confidence = Math.round(response.confidence.overall * 100);
        Alert.alert(
          'Bill Processed Successfully',
          `Extracted data with ${confidence}% confidence.\n\nProvider: ${response.extractedData.provider.name || 'Unknown'}\nAmount: ${response.extractedData.financial.amountDue != null ? formatMoneyUnits(response.extractedData.financial.amountDue, { decimals: 2 }) : 'N/A'}\n\nPlease review and confirm the details.${response.duplicate ? '\n\n⚠️ This looks like a bill you already added.' : ''}`
        );
      }
    } catch (error) {
      console.error('Error processing Drive bill:', error);
      Alert.alert('Error', 'Failed to process bill from Google Drive. Please try again or enter manually.');
    } finally {
      setIsScanning(false);
    }
  };

  // Batch import: extract every picked file with server-side auto-create. High
  // confidence bills are created for us; the rest come back for manual review.
  const handleDriveFilesSelected = async (
    files: Array<{ uri: string; name: string; size: number }>
  ) => {
    setShowDrivePicker(false);
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }
    if (files.length === 0) return;
    // A single pick keeps the familiar review-and-confirm flow.
    if (files.length === 1) {
      return handleDriveFileSelected(files[0]);
    }

    const householdId = currentHousehold.id;
    // Fresh batch — collect every bill we create so the confirm step can list them.
    importedBillsRef.current = [];
    let created = 0;
    let failed = 0;
    let duplicates = 0;
    const needsReview: Array<{ extractedData: ExtractedBillData; documentUrl: string }> = [];

    setIsScanning(true);
    try {
      for (let i = 0; i < files.length; i++) {
        setBatchProgress({ current: i + 1, total: files.length });
        try {
          const response = await utilitiesApi.uploadAndExtractBill(
            householdId,
            { uri: files[i].uri, type: 'application/pdf', name: files[i].name || 'bill.pdf' },
            true // autoCreate high-confidence bills server-side
          );
          if (response.duplicate) {
            // Already in the account — skip silently, report in the summary.
            duplicates += 1;
          } else if (response.autoCreated) {
            created += 1;
            if (response.bill) importedBillsRef.current.push(response.bill);
          } else {
            needsReview.push({
              extractedData: response.extractedData,
              documentUrl: response.documentUrl,
            });
          }
        } catch (err) {
          console.error('Error processing Drive bill:', files[i].name, err);
          failed += 1;
        }
      }
    } finally {
      setIsScanning(false);
      setBatchProgress(null);
    }

    const dupeLine = duplicates > 0 ? `\n${duplicates} already imported and skipped.` : '';
    const failedLine = failed > 0 ? `\n${failed} couldn't be read and were skipped.` : '';

    // Nothing new landed — distinguish "all duplicates" from a real failure.
    if (created === 0 && needsReview.length === 0) {
      if (duplicates > 0) {
        Alert.alert(
          'Already Imported',
          `All ${duplicates} bill${duplicates === 1 ? ' was' : 's were'} already in your account.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert('Import Failed', 'Could not process the selected bills. Please try again.');
      }
      return;
    }

    if (needsReview.length > 0) {
      // Auto-created ones are done; walk the user through the rest. Once the
      // review queue drains, afterCreate() routes to the confirm-payments step.
      const [first, ...rest] = needsReview;
      loadReviewItem(first, rest);
      const createdLine = created > 0 ? `${created} added automatically.\n\n` : '';
      Alert.alert(
        'Review Needed',
        `${createdLine}${needsReview.length} bill${needsReview.length === 1 ? '' : 's'} need${
          needsReview.length === 1 ? 's' : ''
        } your review — confirm each below.${dupeLine}${failedLine}`
      );
      return;
    }

    // Everything auto-created — go straight to confirming payment status.
    goToConfirmPayments();
  };

  // Hand the freshly-imported bills to the confirm-payments screen so the user
  // can mark which are already paid (unpaid ones keep their "Pay bill" task).
  // Replaces this form in the stack so Back returns to the bills list, not here.
  const goToConfirmPayments = () => {
    const importedBills = importedBillsRef.current;
    importedBillsRef.current = [];
    setIsReviewingBatch(false);
    if (importedBills.length === 0) {
      navigation.goBack();
      return;
    }
    navigation.replace('ConfirmBillPayments', { bills: importedBills });
  };

  const handleSkipReview = () => {
    if (reviewQueue.length > 0) {
      const [next, ...rest] = reviewQueue;
      loadReviewItem(next, rest);
    } else {
      // Skipped the last one — still confirm payment status for whatever we did
      // create earlier in this batch (auto-created + reviewed).
      goToConfirmPayments();
    }
  };

  const handleSourcePress = (key: SourceOption['key']) => {
    switch (key) {
      case 'camera':
        return handleScanBill();
      case 'gallery':
        return handlePickFromGallery();
      case 'file':
        return handleUploadPDF();
      case 'drive':
        return setShowDrivePicker(true);
    }
  };

  // Shared post-create flow: advance the review queue or wrap up.
  const afterCreate = () => {
    if (reviewQueue.length > 0) {
      // More queued imports — advance to the next without leaving the screen.
      const [next, ...rest] = reviewQueue;
      loadReviewItem(next, rest);
      Alert.alert('Bill Added', `Next bill loaded — ${rest.length + 1} left to review.`);
    } else if (isReviewingBatch) {
      // Last bill in a multi-file import — move on to confirming payment status.
      goToConfirmPayments();
    } else {
      Alert.alert('Success', 'Bill added successfully', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    }
  };

  const submitBill = async (allowDuplicate = false) => {
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }

    try {
      setIsSubmitting(true);
      const amountCents = Math.round(parseFloat(formData.amount) * 100);
      const today = new Date().toISOString().split('T')[0];
      const created = await utilitiesApi.createBill(
        currentHousehold.id,
        {
          billType: formData.billType as UtilityBillType,
          provider: formData.provider || undefined,
          accountNumber: formData.accountNumber || undefined,
          billingPeriodStart: formData.billingPeriodStart,
          billingPeriodEnd: formData.billingPeriodEnd,
          amount: amountCents, // Convert to cents
          dueDate: formData.dueDate,
          // Inline "already paid?" toggle — a paid bill skips its "Pay bill" task.
          paidDate: markPaid ? today : undefined,
          paidAmount: markPaid ? amountCents : undefined,
          usageQuantity: formData.usageQuantity ? parseFloat(formData.usageQuantity) : undefined,
          usageUnit: formData.usageUnit || undefined,
          documentUrl: documentUrl || undefined,
          aiExtractedData: extractedData || undefined,
          confidenceScore: extractedData?.confidence.overall,
        },
        // During a batch review the paid/unpaid choice — and thus the "Pay bill"
        // task — is confirmed later on ConfirmBillPayments, so defer it here to
        // avoid creating a task per imported bill up front.
        { allowDuplicate, deferPayTask: isReviewingBatch }
      );

      // During a multi-file review, collect each confirmed bill for the
      // final confirm-payments step.
      if (isReviewingBatch) importedBillsRef.current.push(created);

      afterCreate();
    } catch (error) {
      // Month-based duplicate — let the user decide whether to add it anyway.
      const duplicate = getDuplicateBill(error);
      if (duplicate !== undefined) {
        const detail = duplicate
          ? `${duplicate.provider || 'A bill'} · ${formatMonthRange(
              duplicate.billing_period_start,
              duplicate.billing_period_end
            )} · ${formatMoney(duplicate.amount, { decimals: 2 })}`
          : 'a bill for this period';
        Alert.alert('Possible duplicate', `You already have ${detail} saved. Add this one anyway?`, [
          {
            text: 'Cancel',
            style: 'cancel',
            // In a batch review, skip the duplicate and advance to the next.
            onPress: () => {
              if (reviewQueue.length > 0 || isReviewingBatch) handleSkipReview();
            },
          },
          { text: 'Add anyway', style: 'destructive', onPress: () => submitBill(true) },
        ]);
        return;
      }
      console.error('Error creating bill:', error);
      Alert.alert('Error', 'Failed to add bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Edit mode: PATCH the existing bill with the edited fields (no duplicate
  // check — the user is correcting a bill that already exists).
  const updateExistingBill = async () => {
    if (!currentHousehold?.id || !editingBillId) return;
    try {
      setIsSubmitting(true);
      await utilitiesApi.updateBill(currentHousehold.id, editingBillId, {
        billType: formData.billType as UtilityBillType,
        provider: formData.provider,
        accountNumber: formData.accountNumber,
        billingPeriodStart: formData.billingPeriodStart,
        billingPeriodEnd: formData.billingPeriodEnd,
        amount: Math.round(parseFloat(formData.amount) * 100),
        dueDate: formData.dueDate,
        usageQuantity: formData.usageQuantity ? parseFloat(formData.usageQuantity) : undefined,
        usageUnit: formData.usageUnit || undefined,
      });
      showToast('success', 'Bill updated');
      navigation.goBack();
    } catch (error) {
      console.error('Error updating bill:', error);
      Alert.alert('Error', 'Failed to update bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    if (!currentHousehold?.id || !editingBillId) return;
    Alert.alert('Delete Bill', 'Are you sure you want to delete this bill? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsSubmitting(true);
            await utilitiesApi.deleteBill(currentHousehold.id, editingBillId);
            // Editing is always reached from the bill's detail screen, so pop
            // both this form and that (now-stale) detail screen — landing back
            // on the list/dashboard, which refetches on focus.
            navigation.pop(2);
          } catch (error) {
            console.error('Error deleting bill:', error);
            Alert.alert('Error', 'Failed to delete bill');
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    ]);
  };

  const handleSubmit = () => {
    // Validate required fields
    if (!formData.billingPeriodStart || !formData.billingPeriodEnd || !formData.amount || !formData.dueDate) {
      Alert.alert('Validation Error', 'Please fill in all required fields');
      return;
    }

    // Truthiness alone was the only check on `amount`, so "abc" passed it and
    // then `Math.round(parseFloat('abc') * 100)` produced NaN, which
    // JSON.stringify serialises as `null` — the request reached the Worker with
    // a null amount and failed there, or worse, stored one.
    if (!Number.isFinite(parseFloat(formData.amount))) {
      Alert.alert('Validation Error', 'Amount must be a number, for example 179.72');
      return;
    }

    // Same hole on the optional usage field.
    if (formData.usageQuantity && !Number.isFinite(parseFloat(formData.usageQuantity))) {
      Alert.alert('Validation Error', 'Usage quantity must be a number, for example 812');
      return;
    }

    // A reversed period is accepted by the backend schema (both fields are bare
    // strings) and then silently contributes nothing to any chart, because
    // proration yields zero month slices. Catch it here, where the user can fix it.
    if (formData.billingPeriodEnd < formData.billingPeriodStart) {
      Alert.alert('Validation Error', 'The billing period end date cannot be before the start date');
      return;
    }

    if (isEditing) {
      updateExistingBill();
    } else {
      submitBill();
    }
  };

  if (isLoadingBill) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader title="Edit Bill" showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title={isEditing ? 'Edit Bill' : 'Add Bill'}
        showBackButton
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView {...keyboardDismissScrollProps} style={styles.scrollView} contentContainerStyle={styles.content}>
        {isReviewingBatch && (
          <Card variant="elevated" style={styles.reviewBanner}>
            <Typography variant="body" weight="semibold" color={colors.textPrimary}>
              Reviewing imported bills
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.reviewBannerText}>
              {reviewQueue.length > 0
                ? `Confirm this bill, then ${reviewQueue.length} more will follow.`
                : 'Confirm this last bill to finish.'}
            </Typography>
            <TouchableOpacity onPress={handleSkipReview} activeOpacity={0.7}>
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                Skip this bill
              </Typography>
            </TouchableOpacity>
          </Card>
        )}

        {!isEditing && (
        <Card variant="elevated" style={styles.scanCard}>
          <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
            Scan or Upload Bill
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.sectionSubtitle}>
            Use AI to automatically extract bill information
          </Typography>
          <View style={styles.scanButtonsRow}>
            {SOURCE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.scanButton,
                  { backgroundColor: colors.secondaryButtonBackground },
                  isScanning && styles.scanButtonDisabled,
                ]}
                onPress={() => handleSourcePress(option.key)}
                disabled={isScanning}
                activeOpacity={0.8}
                testID={option.key === 'file' ? 'utility-bill-source-file' : undefined}
              >
                <IconBackgroundChip
                  name={option.icon}
                  size={22}
                  backgroundColor={colors.primary + '14'}
                  style={styles.scanIconCircle}
                />
                <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                  {option.label}
                </Typography>
              </TouchableOpacity>
            ))}
          </View>
          {extractedData && (
            <View style={[styles.extractionStatus, { backgroundColor: colors.success + '1A' }]}>
              <View style={styles.extractionStatusHeader}>
                <Icon name="checkmark-circle" size={18} color={colors.success} />
                <Typography variant="body" weight="semibold" color={colors.success}>
                  Bill data extracted
                </Typography>
              </View>
              <Typography variant="caption1" color={colors.success}>
                {Math.round(extractedData.confidence.overall * 100)}% confidence • {extractedData.provider.name || 'Unknown provider'}
              </Typography>
            </View>
          )}
        </Card>
        )}

        <Card variant="elevated" style={styles.formCard}>
          <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
            {isEditing ? 'Bill Details' : 'Or Enter Manually'}
          </Typography>

          <View style={styles.formRow}>
            <View style={styles.formGroup}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Bill Type *
              </Typography>
              <View style={styles.typeButtons}>
                {BILL_TYPES.map((type) => {
                  const selected = formData.billType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeButton,
                        {
                          backgroundColor: selected ? colors.primary : colors.secondaryButtonBackground,
                        },
                      ]}
                      onPress={() => setFormData({ ...formData, billType: type })}
                      activeOpacity={0.8}
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={selected ? colors.white : colors.textPrimary}
                      >
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
              Provider
            </Typography>
            <TextInput
              value={formData.provider}
              onChangeText={(text) => setFormData({ ...formData, provider: text })}
              placeholder="e.g., BC Hydro, FortisBC"
            />
          </View>

          <View style={styles.formGroup}>
            <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
              Account Number
            </Typography>
            <TextInput
              value={formData.accountNumber}
              onChangeText={(text) => setFormData({ ...formData, accountNumber: text })}
              placeholder="Account number"
            />
          </View>

          <View style={styles.formRow}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Billing Period Start *
              </Typography>
              <TextInput
                value={formData.billingPeriodStart}
                onChangeText={(text) =>
                  setFormData({ ...formData, billingPeriodStart: maskDayKeyInput(text) })
                }
                placeholder="YYYY-MM-DD"
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Billing Period End *
              </Typography>
              <TextInput
                value={formData.billingPeriodEnd}
                onChangeText={(text) =>
                  setFormData({ ...formData, billingPeriodEnd: maskDayKeyInput(text) })
                }
                placeholder="YYYY-MM-DD"
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.formRow}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Amount ($) *
              </Typography>
              <TextInput
                value={formData.amount}
                onChangeText={(text) => setFormData({ ...formData, amount: text })}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Due Date *
              </Typography>
              <TextInput
                value={formData.dueDate}
                onChangeText={(text) => setFormData({ ...formData, dueDate: maskDayKeyInput(text) })}
                placeholder="YYYY-MM-DD"
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
          </View>

          {monthlyBreakdown.length > 0 && (
            <View style={styles.formGroup}>
              <Typography
                variant="caption1"
                weight="medium"
                color={colors.textSecondary}
                style={styles.label}
              >
                {monthlyBreakdown.length > 1 ? 'Monthly breakdown' : 'Applies to'}
              </Typography>
              <View
                style={[styles.breakdownBox, { backgroundColor: colors.secondaryButtonBackground }]}
              >
                {monthlyBreakdown.length > 1 && (
                  <Typography
                    variant="caption2"
                    color={colors.textTertiary}
                    style={styles.breakdownHint}
                  >
                    Spread across {monthlyBreakdown.length} months by number of billing days.
                  </Typography>
                )}
                {monthlyBreakdown.map((slice, index) => (
                  <View
                    key={slice.monthKey}
                    style={[
                      styles.breakdownRow,
                      index < monthlyBreakdown.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.divider,
                      },
                    ]}
                  >
                    <Typography variant="body" color={colors.textPrimary}>
                      {slice.monthLabel}
                    </Typography>
                    <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                      {formatCents(slice.amount)}
                    </Typography>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.formRow}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Usage Quantity
              </Typography>
              <TextInput
                value={formData.usageQuantity}
                onChangeText={(text) => setFormData({ ...formData, usageQuantity: text })}
                placeholder="0"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Unit
              </Typography>
              <TextInput
                value={formData.usageUnit}
                onChangeText={(text) => setFormData({ ...formData, usageUnit: text })}
                placeholder="kWh, GJ, m³"
              />
            </View>
          </View>

          {!isEditing && !isReviewingBatch && (
            <View style={styles.formGroup}>
              <Typography
                variant="caption1"
                weight="medium"
                color={colors.textSecondary}
                style={styles.label}
              >
                Payment Status
              </Typography>
              <View style={styles.paidToggleRow}>
                {[
                  { value: false, label: 'Unpaid', icon: 'time-outline' as const },
                  { value: true, label: 'Paid', icon: 'checkmark-circle' as const },
                ].map((opt) => {
                  const selected = markPaid === opt.value;
                  const activeColor = opt.value ? colors.success : colors.primary;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => setMarkPaid(opt.value)}
                      activeOpacity={0.8}
                      style={[
                        styles.paidToggleButton,
                        {
                          backgroundColor: selected ? activeColor : colors.secondaryButtonBackground,
                        },
                      ]}
                    >
                      <Icon
                        name={opt.icon}
                        size={16}
                        color={selected ? colors.white : colors.textSecondary}
                      />
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={selected ? colors.white : colors.textPrimary}
                      >
                        {opt.label}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!markPaid && (
                <Typography variant="caption2" color={colors.textTertiary} style={styles.paidHint}>
                  We'll add a “Pay bill” task due {formData.dueDate || 'on its due date'}.
                </Typography>
              )}
            </View>
          )}

          <GradientButton
            onPress={handleSubmit}
            disabled={isSubmitting || (isEditing && !isDirty)}
            style={styles.submitButton}
            title={
              isSubmitting
                ? isEditing
                  ? 'Saving...'
                  : 'Adding...'
                : isEditing
                  ? 'Save Changes'
                  : 'Add Bill'
            }
            fullWidth
          />

          {isEditing && (
            <TouchableOpacity
              onPress={handleDelete}
              disabled={isSubmitting}
              style={styles.deleteButton}
              activeOpacity={0.7}
            >
              <Icon name="trash-outline" size={18} color={colors.error} />
              <Typography variant="body" weight="semibold" color={colors.error}>
                Delete Bill
              </Typography>
            </TouchableOpacity>
          )}
        </Card>
      </ScrollView>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter="application/pdf"
        rememberScope="utilities"
        autoRemember
        multiSelect
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
        onFilesSelected={handleDriveFilesSelected}
      />

      {/* Single blocking overlay for any AI processing — replaces per-tile
          spinners and prevents interaction while a bill is being read. */}
      <ProcessingOverlay
        visible={isScanning}
        message={
          batchProgress
            ? `Processing bill ${batchProgress.current} of ${batchProgress.total}…`
            : 'Reading your bill…'
        }
        caption="Extracting details with AI"
      />
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  reviewBanner: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
    gap: Spacing.xs,
  },
  reviewBannerText: {
    marginBottom: Spacing.xs,
  },
  scanCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
  },
  sectionSubtitle: {
    marginBottom: Spacing.base,
  },
  scanButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  scanButton: {
    flexBasis: '47%',
    flexGrow: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 92,
    gap: Spacing.sm,
  },
  scanButtonDisabled: {
    opacity: 0.4,
  },
  scanIconCircle: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extractionStatus: {
    marginTop: Spacing.base,
    padding: Spacing.md,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
  },
  extractionStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  formCard: {
    padding: Spacing.lg,
  },
  formRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  formGroup: {
    marginBottom: Spacing.base,
  },
  halfWidth: {
    flex: 1,
  },
  label: {
    marginBottom: Spacing.sm,
  },
  breakdownBox: {
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.base,
  },
  breakdownHint: {
    paddingTop: Spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  typeButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  typeButton: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.sm,
  },
  paidToggleRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  paidToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.smd,
    borderRadius: CornerRadius.md,
  },
  paidHint: {
    marginTop: Spacing.xs,
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.base,
    paddingVertical: Spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
