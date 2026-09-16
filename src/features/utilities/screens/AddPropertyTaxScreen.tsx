import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert } from 'react-native';

import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, ProcessingOverlay, ScreenHeader } from '@components/common';
import { Typography, Card, TextInput, GradientButton, IconBackgroundChip } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {
  utilitiesApi,
  type ExtractedPropertyTaxData,
  type SuggestedPropertyTax,
} from '@features/utilities/api/utilities';
import type { UtilitiesStackParamList } from '@navigation/types';
import {
  contentTypeFromUri,
  PROPERTY_DOCUMENT_MIME_TYPES,
} from '@screens/households/property-tabs/documentPicker';
import ImageCropPicker from '@services/image-picker-compat';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, hexToRgba, Layout, Spacing, useAppColors } from '@theme';
import { maskDayKeyInput } from '@utils/dateInput';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, formatMoneyUnits, useDisplayCurrency } from '@utils/money';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import {
  buildCreatePropertyTaxRequest,
  centsToInput,
  emptyPropertyTaxForm,
  netOwedAfterGrant,
} from './propertyTaxFormUtils';

/** Cents → "$5,053.34" for the amount-owed preview. */
const formatCents = (cents: number): string => formatMoney(cents, { decimals: 2 });

type AddPropertyTaxScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList>;

// The four ways to bring a property tax notice in — mirrors the utility-bill
// import so the whole utilities flow feels like one app.
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

// One extracted-but-not-yet-saved notice, waiting in the review queue.
type PendingTax = {
  extractedData: ExtractedPropertyTaxData;
  suggestedTax: SuggestedPropertyTax;
  documentUrl: string;
  duplicate: boolean;
};

export function AddPropertyTaxScreen() {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<AddPropertyTaxScreenNavigationProp>();
  const { currentHousehold } = useHouseholdStore();

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);

  // Multi-file import: notices still waiting behind the one in the form.
  const [reviewQueue, setReviewQueue] = useState<PendingTax[]>([]);
  const [isReviewingBatch, setIsReviewingBatch] = useState(false);

  const [markPaid, setMarkPaid] = useState(false);
  const [form, setForm] = useState({ ...emptyPropertyTaxForm });

  // Prefill the review form from an extraction result.
  const applyPending = (pending: PendingTax) => {
    const { suggestedTax: s, extractedData: e } = pending;
    setForm({
      taxYear: s.taxYear ? String(s.taxYear) : '',
      municipalityName: s.municipalityName || e.municipality.name || '',
      assessedValue: centsToInput(s.assessedValue),
      taxAmount: centsToInput(s.taxAmount),
      mainDueDate: s.mainPaymentDueDate || '',
      advanceAmount: centsToInput(s.advancePaymentAmount),
      advanceDueDate: s.advancePaymentDueDate || '',
      grantEligible: s.homeownerGrantEligible,
      grantAmount: centsToInput(s.homeownerGrantAmount),
      grantApplied: false,
    });
    setDocumentUrl(pending.documentUrl);
    setConfidence(pending.suggestedTax.confidenceScore ?? pending.extractedData.confidence.overall);
    setIsDuplicate(pending.duplicate);
    setMarkPaid(false);
  };

  const loadReviewItem = (item: PendingTax, rest: PendingTax[]) => {
    setReviewQueue(rest);
    applyPending(item);
  };

  // ─── Extraction (single source) ─────────────────────────────────────────────

  const extractOne = async (file: { uri: string; type: string; name: string }) => {
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }
    try {
      setIsScanning(true);
      const safeFile = await toVisionSafeAttachment(file);
      const response = await utilitiesApi.uploadAndExtractPropertyTax(currentHousehold.id, safeFile);
      if (response.success) {
        applyPending({
          extractedData: response.extractedData,
          suggestedTax: response.suggestedTax,
          documentUrl: response.documentUrl,
          duplicate: !!response.duplicate,
        });
        setIsReviewingBatch(false);
        setReviewQueue([]);
        const pct = Math.round(response.confidence.overall * 100);
        Alert.alert(
          'Notice Scanned',
          `Extracted with ${pct}% confidence.\n\n${
            response.extractedData.municipality.name || 'Property tax'
          } · ${response.extractedData.taxYear ?? ''}\nAmount due: ${
            response.extractedData.financial.totalTaxAmount != null
              ? formatMoneyUnits(response.extractedData.financial.totalTaxAmount, { decimals: 2 })
              : 'N/A'
          }\n\nReview the details and choose paid or unpaid below.${
            response.duplicate ? `\n\n⚠️ You already have a record for ${response.extractedData.taxYear}.` : ''
          }`
        );
      }
    } catch (error) {
      console.error('Error extracting property tax:', error);
      Alert.alert('Error', 'Failed to read the notice. Please try again or enter it manually.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanPhoto = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      await extractOne({ uri: image.path, type: image.mime || 'image/jpeg', name: 'property-tax.jpg' });
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error scanning notice:', error);
        Alert.alert('Error', 'Failed to scan the notice.');
      }
    }
  };

  const handlePickFromGallery = async () => {
    try {
      const image = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      await extractOne({ uri: image.path, type: image.mime || 'image/jpeg', name: 'property-tax.jpg' });
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error picking from gallery:', error);
        Alert.alert('Error', 'Failed to process the notice.');
      }
    }
  };

  const handleUploadFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: PROPERTY_DOCUMENT_MIME_TYPES,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await extractOne({
          uri: asset.uri,
          type: asset.mimeType || 'application/pdf',
          name: asset.name || 'property-tax.pdf',
        });
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      Alert.alert('Error', 'Failed to process the notice.');
    }
  };

  const handleSourcePress = (key: SourceOption['key']) => {
    switch (key) {
      case 'camera':
        return handleScanPhoto();
      case 'gallery':
        return handlePickFromGallery();
      case 'file':
        return handleUploadFile();
      case 'drive':
        return setShowDrivePicker(true);
    }
  };

  // ─── Google Drive import (single + multi-select from a saved folder) ─────────

  const handleDriveFileSelected = async (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    const name = file.name || 'property-tax.pdf';
    await extractOne({ uri: file.uri, type: contentTypeFromUri(name, 'application/pdf'), name });
  };

  const handleDriveFilesSelected = async (
    files: Array<{ uri: string; name: string; size: number }>
  ) => {
    setShowDrivePicker(false);
    if (!currentHousehold?.id || files.length === 0) return;
    if (files.length === 1) return handleDriveFileSelected(files[0]);

    setIsScanning(true);
    setScanProgress({ current: 0, total: files.length });
    const pending: PendingTax[] = [];
    let failed = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setScanProgress({ current: i + 1, total: files.length });
        try {
          const name = files[i].name || 'property-tax.pdf';
          const safeFile = await toVisionSafeAttachment({
            uri: files[i].uri,
            type: contentTypeFromUri(name, 'application/pdf'),
            name,
          });
          const response = await utilitiesApi.uploadAndExtractPropertyTax(
            currentHousehold.id,
            safeFile
          );
          if (response.success) {
            pending.push({
              extractedData: response.extractedData,
              suggestedTax: response.suggestedTax,
              documentUrl: response.documentUrl,
              duplicate: !!response.duplicate,
            });
          }
        } catch (err) {
          failed += 1;
          console.error('Error extracting Drive notice:', files[i].name, err);
        }
      }
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }

    if (pending.length === 0) {
      Alert.alert('Import Failed', 'Could not read the selected notices. Please try again.');
      return;
    }

    const [first, ...rest] = pending;
    setIsReviewingBatch(true);
    loadReviewItem(first, rest);
    const failedLine = failed > 0 ? `\n${failed} couldn't be read and were skipped.` : '';
    Alert.alert(
      'Review Needed',
      `${pending.length} notice${pending.length === 1 ? '' : 's'} scanned — confirm each below, choosing paid or unpaid.${failedLine}`
    );
  };

  // ─── Save ────────────────────────────────────────────────────────────────────

  const afterSave = () => {
    if (reviewQueue.length > 0) {
      const [next, ...rest] = reviewQueue;
      loadReviewItem(next, rest);
      Alert.alert('Saved', `Next notice loaded — ${rest.length + 1} left to review.`);
    } else {
      Alert.alert('Saved', 'Property tax added.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    }
  };

  const handleSubmit = async () => {
    if (!currentHousehold?.id) {
      Alert.alert('Error', 'No property selected');
      return;
    }
    // Validation + cents conversion + paid-date handling live in the util so
    // they're unit-tested without rendering the screen.
    const today = new Date().toISOString().split('T')[0];
    const built = buildCreatePropertyTaxRequest(form, { markPaid, documentUrl, today });
    if (!built.ok) {
      Alert.alert('Validation Error', built.error);
      return;
    }

    try {
      setIsSubmitting(true);
      const created = await utilitiesApi.createPropertyTax(currentHousehold.id, built.request);
      // Soft one-property grant rule: another property already claimed it this
      // year. Let them proceed — just make sure they know.
      if (created.grantWarning) {
        Alert.alert('Home Owner Grant', created.grantWarning, [
          { text: 'Got it', onPress: afterSave },
        ]);
      } else {
        afterSave();
      }
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 500) {
        Alert.alert(
          'Already Exists',
          `You may already have a ${form.taxYear} property tax record. Open it from the Property Tax screen to update it.`
        );
      } else {
        console.error('Error creating property tax:', error);
        Alert.alert('Error', 'Failed to save the property tax.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (reviewQueue.length > 0) {
      const [next, ...rest] = reviewQueue;
      loadReviewItem(next, rest);
    } else {
      navigation.goBack();
    }
  };

  // What they'll actually owe once the grant is deducted (null until the total
  // is a valid amount) — drives the live preview under the grant toggle.
  const netOwed = netOwedAfterGrant(form);

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader title="Add Property Tax" showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        testID="add-property-tax-scroll"
      >
        {isReviewingBatch && (
          <Card variant="elevated" style={styles.reviewBanner}>
            <Typography variant="body" weight="semibold" color={colors.textPrimary}>
              Reviewing imported notices
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.reviewBannerText}>
              {reviewQueue.length > 0
                ? `Confirm this notice, then ${reviewQueue.length} more will follow.`
                : 'Confirm this last notice to finish.'}
            </Typography>
            <TouchableOpacity onPress={handleSkip} activeOpacity={0.7}>
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                Skip this notice
              </Typography>
            </TouchableOpacity>
          </Card>
        )}

        <Card variant="elevated" style={styles.scanCard}>
          <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
            Scan or Upload Notice
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.sectionSubtitle}>
            Use AI to read your property tax notice automatically
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
                testID={`property-tax-source-${option.key}`}
              >
                <IconBackgroundChip
                  name={option.icon}
                  size={22}
                  backgroundColor={hexToRgba(colors.primary, 0.08)}
                  style={styles.scanIconCircle}
                />
                <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                  {option.label}
                </Typography>
              </TouchableOpacity>
            ))}
          </View>
          {confidence !== null && (
            <View
              style={[styles.extractionStatus, { backgroundColor: hexToRgba(colors.success, 0.1) }]}
              testID="property-tax-confidence"
            >
              <View style={styles.extractionStatusHeader}>
                <Icon name="checkmark-circle" size={18} color={colors.success} />
                <Typography variant="body" weight="semibold" color={colors.success}>
                  Notice read
                </Typography>
              </View>
              <Typography variant="caption1" color={colors.success}>
                {Math.round(confidence * 100)}% confidence
                {form.municipalityName ? ` • ${form.municipalityName}` : ''}
              </Typography>
            </View>
          )}
          {isDuplicate && (
            <View
              style={[
                styles.extractionStatus,
                styles.extractionStatusRow,
                { backgroundColor: hexToRgba(colors.warning, 0.1) },
              ]}
              testID="property-tax-duplicate-warning"
            >
              <Icon name="warning" size={16} color={colors.warning} />
              <Typography variant="caption1" weight="semibold" color={colors.warning} style={styles.extractionStatusRowText}>
                A record for {form.taxYear} already exists — saving will fail unless you change the year.
              </Typography>
            </View>
          )}
        </Card>

        <Card variant="elevated" style={styles.formCard}>
          <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
            {confidence !== null ? 'Review Details' : 'Or Enter Manually'}
          </Typography>

          <View style={styles.formRow2}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Tax Year *
              </Typography>
              <TextInput
                value={form.taxYear}
                onChangeText={(text) => setForm({ ...form, taxYear: text })}
                placeholder="2026"
                keyboardType="number-pad"
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Municipality
              </Typography>
              <TextInput
                value={form.municipalityName}
                onChangeText={(text) => setForm({ ...form, municipalityName: text })}
                placeholder="City of Surrey"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
              Total Amount Due (No Grant) *
            </Typography>
            <TextInput
              value={form.taxAmount}
              onChangeText={(text) => setForm({ ...form, taxAmount: text })}
              placeholder="5053.34"
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.formRow2}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Due Date *
              </Typography>
              <TextInput
                value={form.mainDueDate}
                onChangeText={(text) => setForm({ ...form, mainDueDate: maskDayKeyInput(text) })}
                placeholder="YYYY-MM-DD"
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Assessed Value
              </Typography>
              <TextInput
                value={form.assessedValue}
                onChangeText={(text) => setForm({ ...form, assessedValue: text })}
                placeholder="1181000"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.formRow2}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Advance Payment
              </Typography>
              <TextInput
                value={form.advanceAmount}
                onChangeText={(text) => setForm({ ...form, advanceAmount: text })}
                placeholder="Optional"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
                Advance Due Date
              </Typography>
              <TextInput
                value={form.advanceDueDate}
                onChangeText={(text) => setForm({ ...form, advanceDueDate: maskDayKeyInput(text) })}
                placeholder="YYYY-MM-DD"
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Home Owner Grant */}
          <View style={styles.formGroup}>
            <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
              Home Owner Grant
            </Typography>
            <View style={styles.paidToggleRow}>
              {[
                { value: false, label: 'Not eligible', icon: 'close-circle-outline' as const },
                { value: true, label: 'Eligible', icon: 'ribbon-outline' as const },
              ].map((opt) => {
                const selected = form.grantEligible === opt.value;
                const activeColor = opt.value ? colors.primary : colors.textSecondary;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    onPress={() => setForm({ ...form, grantEligible: opt.value })}
                    activeOpacity={0.8}
                    style={[
                      styles.paidToggleButton,
                      { backgroundColor: selected ? activeColor : colors.secondaryButtonBackground },
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
            {form.grantEligible && (
              <View style={styles.grantAmountWrap}>
                <TextInput
                  value={form.grantAmount}
                  onChangeText={(text) => setForm({ ...form, grantAmount: text })}
                  placeholder="Grant amount (e.g. 570)"
                  keyboardType="decimal-pad"
                />

                {/* Apply now = claim the grant and deduct it from what's owed. */}
                <View style={styles.paidToggleRow}>
                  {[
                    { value: false, label: 'Not claimed', icon: 'time-outline' as const },
                    { value: true, label: 'Applied', icon: 'checkmark-circle' as const },
                  ].map((opt) => {
                    const selected = form.grantApplied === opt.value;
                    const activeColor = opt.value ? colors.success : colors.primary;
                    return (
                      <TouchableOpacity
                        key={opt.label}
                        onPress={() => setForm({ ...form, grantApplied: opt.value })}
                        activeOpacity={0.8}
                        style={[
                          styles.paidToggleButton,
                          { backgroundColor: selected ? activeColor : colors.secondaryButtonBackground },
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

                {form.grantApplied ? (
                  <>
                    {netOwed !== null && (
                      <View style={styles.netOwedRow}>
                        <Typography variant="footnote" color={colors.textSecondary}>
                          Amount owed after grant
                        </Typography>
                        <Typography variant="body" weight="semibold" color={colors.success}>
                          {formatCents(netOwed)}
                        </Typography>
                      </View>
                    )}
                    <Typography variant="caption2" color={colors.textTertiary} style={styles.paidHint}>
                      We'll deduct the grant from what's owed — only claim it on your principal residence.
                    </Typography>
                  </>
                ) : (
                  <Typography variant="caption2" color={colors.textTertiary} style={styles.paidHint}>
                    We'll add a “Claim Home Owner Grant” task due {form.mainDueDate || 'on the due date'}.
                  </Typography>
                )}
              </View>
            )}
          </View>

          {/* Payment status */}
          <View style={styles.formGroup}>
            <Typography variant="caption1" weight="medium" color={colors.textSecondary} style={styles.label}>
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
                      { backgroundColor: selected ? activeColor : colors.secondaryButtonBackground },
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
                We'll add a “Pay property tax” task due {form.mainDueDate || 'on its due date'}.
              </Typography>
            )}
          </View>

          <GradientButton
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={styles.submitButton}
            title={isSubmitting ? 'Saving...' : 'Add Property Tax'}
            fullWidth
            testID="property-tax-submit"
          />
        </Card>
      </ScrollView>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={PROPERTY_DOCUMENT_MIME_TYPES}
        rememberScope="property-taxes"
        autoRemember
        multiSelect
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
        onFilesSelected={handleDriveFilesSelected}
      />

      <ProcessingOverlay
        visible={isScanning}
        message={
          scanProgress
            ? `Reading notice ${scanProgress.current} of ${scanProgress.total}…`
            : 'Reading your notice…'
        }
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
    padding: Spacing.base,
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
    marginBottom: Spacing.xs,
  },
  sectionSubtitle: {
    marginBottom: Spacing.base,
  },
  scanButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  scanButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.md,
    gap: Spacing.xs,
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extractionStatus: {
    marginTop: Spacing.base,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    gap: Spacing.xs,
  },
  extractionStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  extractionStatusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  extractionStatusRowText: {
    flex: 1,
  },
  formCard: {
    padding: Spacing.lg,
  },
  formGroup: {
    marginBottom: Spacing.base,
  },
  formRow2: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  halfWidth: {
    flex: 1,
  },
  label: {
    marginBottom: Spacing.xs,
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
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  grantAmountWrap: {
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  netOwedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paidHint: {
    marginTop: Spacing.xs,
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
});
