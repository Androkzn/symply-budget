import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  budgetRenewalDocumentContentSource,
  budgetRenewalsApi,
  RENEWAL_CATEGORIES,
  RENEWAL_CYCLES,
  RENEWAL_DOCUMENT_MIME_TYPES,
  type BudgetRenewal,
  type BudgetRenewalDocument,
  type RenewalCategory,
  type RenewalCycle,
  type RenewalDocumentSource,
} from '@api/budgetRenewals';
import { CloudFilePicker } from '@components/cloud-storage';
import { ScanImportSources } from '@components/common';
import { Card, GradientButton, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import ImageCropPicker from '@services/image-picker-compat';
import { showToast } from '@services/toastManager';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

const CATEGORY_LABELS: Record<RenewalCategory, string> = {
  insurance: 'Insurance',
  warranty: 'Warranty',
  subscription: 'Subscription',
  membership: 'Membership',
  license: 'License',
  other: 'Other',
};

const CYCLE_LABELS: Record<RenewalCycle, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Every 6 months',
  annual: 'Annually',
  custom: 'Custom',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Best-effort MIME guess for sources (Drive) that don't reliably report one. */
function guessMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/pdf';
  }
}

interface RenewalReminderSectionProps {
  householdId: string;
  recurringPaymentId: string;
  recurringPaymentLabel: string;
}

/**
 * "Track a renewal" for one Monthly-Payments item — condo/car insurance,
 * warranties, memberships, licenses. Rendered inside
 * `SavingsRecurringPaymentsScreen`'s edit-payment modal, split into its own
 * component to keep that already-large screen from growing further.
 *
 * Self-contained: fetches/saves against `budgetRenewalsApi` directly rather
 * than going through the parent form's submit, since a renewal is genuinely a
 * separate record with its own endpoint (`/recurring-payments/:id/renewal`) —
 * bundling it into the payment's PATCH would mean one field's typo blocks
 * saving the other.
 */
export function RenewalReminderSection({
  householdId,
  recurringPaymentId,
  recurringPaymentLabel,
}: RenewalReminderSectionProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const accent = theme.pastel.teal;

  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [renewal, setRenewal] = useState<BudgetRenewal | null>(null);
  const [documents, setDocuments] = useState<BudgetRenewalDocument[]>([]);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  const [category, setCategory] = useState<RenewalCategory>('other');
  const [provider, setProvider] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [cycle, setCycle] = useState<RenewalCycle>('annual');
  const [cycleMonths, setCycleMonths] = useState('12');
  const [nextRenewalDate, setNextRenewalDate] = useState(todayPlusDays(365));
  const [reminderLeadDays, setReminderLeadDays] = useState('14');
  const [notes, setNotes] = useState('');

  const applyRenewal = useCallback((r: BudgetRenewal | null) => {
    setRenewal(r);
    setTracking(r !== null);
    if (r) {
      setCategory(r.category);
      setProvider(r.provider ?? '');
      setReferenceNumber(r.reference_number ?? '');
      setCycle(r.cycle);
      setCycleMonths(r.cycle_months != null ? String(r.cycle_months) : '12');
      setNextRenewalDate(r.next_renewal_date);
      setReminderLeadDays(String(r.reminder_lead_days));
      setNotes(r.notes ?? '');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    budgetRenewalsApi
      .get(householdId, recurringPaymentId)
      .then((result) => {
        if (cancelled) return;
        applyRenewal(result.renewal);
        setDocuments(result.documents);
      })
      .catch(() => {
        if (!cancelled) applyRenewal(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, recurringPaymentId, applyRenewal]);

  const handleToggle = () => {
    if (tracking && renewal) {
      Alert.alert('Stop tracking renewal?', 'This removes the renewal date and any attached documents.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop tracking',
          style: 'destructive',
          onPress: async () => {
            try {
              await budgetRenewalsApi.remove(householdId, recurringPaymentId);
              setRenewal(null);
              setDocuments([]);
              setTracking(false);
            } catch {
              Alert.alert('Error', 'Could not remove this renewal. Please try again.');
            }
          },
        },
      ]);
      return;
    }
    setTracking(true);
  };

  const handleSave = async () => {
    if (!DATE_RE.test(nextRenewalDate)) {
      Alert.alert('Invalid date', 'Enter the next renewal date as YYYY-MM-DD.');
      return;
    }
    const leadDays = Number.parseInt(reminderLeadDays, 10);
    if (!Number.isFinite(leadDays) || leadDays < 0) {
      Alert.alert('Invalid reminder', 'Enter how many days before the renewal to start the reminder.');
      return;
    }

    setSaving(true);
    try {
      const { renewal: saved } = await budgetRenewalsApi.upsert(householdId, recurringPaymentId, {
        category,
        provider: provider.trim() || null,
        reference_number: referenceNumber.trim() || null,
        cycle,
        cycle_months: cycle === 'custom' ? Number.parseInt(cycleMonths, 10) || 12 : null,
        next_renewal_date: nextRenewalDate,
        reminder_lead_days: leadDays,
        notes: notes.trim() || null,
      });
      applyRenewal(saved);
      showToast('success', 'Renewal reminder saved');
    } catch {
      Alert.alert('Error', 'Could not save this renewal. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkRenewed = () => {
    Alert.alert('Mark as renewed?', `This rolls "${recurringPaymentLabel}" forward to its next renewal date.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark renewed',
        onPress: async () => {
          setMarking(true);
          try {
            const { renewal: updated } = await budgetRenewalsApi.markRenewed(householdId, recurringPaymentId);
            applyRenewal(updated);
            showToast('success', `Next renewal: ${updated.next_renewal_date}`);
          } catch {
            Alert.alert('Error', 'Could not mark this as renewed. Please try again.');
          } finally {
            setMarking(false);
          }
        },
      },
    ]);
  };

  const uploadDocument = useCallback(
    async (uri: string, name: string, mimeType: string, source: RenewalDocumentSource) => {
      if (!renewal) {
        Alert.alert('Save the renewal first', 'Save the renewal date before attaching a document.');
        return;
      }
      setUploading(true);
      try {
        const bytes = await (await fetch(uri)).blob();
        const { document, upload } = await budgetRenewalsApi.createDocument(householdId, recurringPaymentId, {
          file_name: name,
          mime_type: mimeType,
          file_size: bytes.size,
          source,
        });
        try {
          await budgetRenewalsApi.uploadDocumentBytes(upload.path, bytes, mimeType);
          setDocuments((docs) => [document, ...docs]);
        } catch (uploadError) {
          await budgetRenewalsApi.deleteDocument(householdId, recurringPaymentId, document.id).catch(() => undefined);
          throw uploadError;
        }
      } catch {
        Alert.alert('Error', 'Could not attach that file. Please try again.');
      } finally {
        setUploading(false);
      }
    },
    [renewal, householdId, recurringPaymentId]
  );

  const pickCamera = useCallback(async () => {
    try {
      const image = await ImageCropPicker.openCamera({ cropping: false, compressImageQuality: 0.8, mediaType: 'photo' });
      await uploadDocument(image.path, image.filename || 'photo.jpg', image.mime || 'image/jpeg', 'camera');
    } catch (e) {
      if (isPickerPermissionError(e)) presentPickerPermissionDeniedAlert('camera');
      else if ((e as { code?: string })?.code !== 'E_PICKER_CANCELLED') Alert.alert('Error', 'Could not open the camera.');
    }
  }, [uploadDocument]);

  const pickGallery = useCallback(async () => {
    try {
      const image = await ImageCropPicker.openPicker({ cropping: false, compressImageQuality: 0.8, mediaType: 'photo' });
      const picked = Array.isArray(image) ? image[0] : image;
      if (!picked) return;
      await uploadDocument(picked.path, picked.filename || 'photo.jpg', picked.mime || 'image/jpeg', 'gallery');
    } catch (e) {
      if (isPickerPermissionError(e)) presentPickerPermissionDeniedAlert('library');
      else if ((e as { code?: string })?.code !== 'E_PICKER_CANCELLED') Alert.alert('Error', 'Could not open the photo library.');
    }
  }, [uploadDocument]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...RENEWAL_DOCUMENT_MIME_TYPES],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await uploadDocument(asset.uri, asset.name || 'document', asset.mimeType || guessMimeType(asset.name || ''), 'file');
      }
    } catch {
      Alert.alert('Error', 'Could not open the file picker.');
    }
  }, [uploadDocument]);

  const onDriveFile = useCallback(
    (file: { uri: string; name: string; size: number }) => {
      setShowDrivePicker(false);
      const name = file.name || 'document';
      void uploadDocument(file.uri, name, guessMimeType(name), 'drive');
    },
    [uploadDocument]
  );

  const handleOpenDocument = useCallback(
    async (doc: BudgetRenewalDocument) => {
      const source = budgetRenewalDocumentContentSource(householdId, recurringPaymentId, doc.id);
      if (!source) {
        Alert.alert('Error', 'Please sign in again to open this file.');
        return;
      }
      try {
        if (!(await Sharing.isAvailableAsync())) return;
        const safeName = doc.file_name.replace(/[^\w.\-() ]+/g, '_') || 'file';
        const target = `${FileSystem.cacheDirectory}renewal-doc-${Date.now()}-${safeName}`;
        const { uri } = await FileSystem.downloadAsync(source.uri, target, { headers: source.headers });
        await Sharing.shareAsync(uri, { mimeType: doc.mime_type, dialogTitle: doc.file_name });
      } catch {
        Alert.alert('Error', 'That file could not be opened.');
      }
    },
    [householdId, recurringPaymentId]
  );

  const handleDeleteDocument = useCallback(
    (doc: BudgetRenewalDocument) => {
      Alert.alert('Delete this attachment?', `"${doc.file_name}" will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await budgetRenewalsApi.deleteDocument(householdId, recurringPaymentId, doc.id);
              setDocuments((docs) => docs.filter((d) => d.id !== doc.id));
            } catch {
              Alert.alert('Error', 'Could not delete this attachment.');
            }
          },
        },
      ]);
    },
    [householdId, recurringPaymentId]
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={accent} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={[styles.toggleRow, { borderColor: colors.borderColor }]} testID="renewal-tracking-toggle">
        <View style={styles.toggleText}>
          <Typography variant="body" weight="semibold">
            Track a renewal
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Insurance, warranties, memberships, licenses — get nudged before it's due.
          </Typography>
        </View>
        <Toggle value={tracking} onValueChange={handleToggle} testID="renewal-tracking-switch" />
      </View>

      {tracking && (
        <View style={styles.fields}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Category
          </Typography>
          <View style={styles.chipRow}>
            {RENEWAL_CATEGORIES.map((value) => {
              const active = category === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.chip,
                    { borderColor: accent, backgroundColor: active ? accent : 'transparent' },
                  ]}
                  onPress={() => setCategory(value)}
                  testID={`renewal-category-${value}`}
                >
                  <Typography variant="caption1" weight="semibold" color={active ? colors.white : accent}>
                    {CATEGORY_LABELS[value]}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            testID="renewal-provider"
            label="Provider (optional)"
            placeholder="e.g. Aviva, TD Insurance"
            value={provider}
            onChangeText={setProvider}
          />
          <TextInput
            testID="renewal-reference-number"
            label="Policy / reference number (optional)"
            value={referenceNumber}
            onChangeText={setReferenceNumber}
          />

          <TextInput
            testID="renewal-next-date"
            label="Next renewal date (YYYY-MM-DD)"
            value={nextRenewalDate}
            onChangeText={setNextRenewalDate}
          />

          <Typography variant="caption1" color={colors.textSecondary}>
            Renews every
          </Typography>
          <View style={styles.chipRow}>
            {RENEWAL_CYCLES.map((value) => {
              const active = cycle === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.chip,
                    { borderColor: accent, backgroundColor: active ? accent : 'transparent' },
                  ]}
                  onPress={() => setCycle(value)}
                  testID={`renewal-cycle-${value}`}
                >
                  <Typography variant="caption1" weight="semibold" color={active ? colors.white : accent}>
                    {CYCLE_LABELS[value]}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>
          {cycle === 'custom' && (
            <TextInput
              testID="renewal-cycle-months"
              label="Every how many months"
              value={cycleMonths}
              onChangeText={setCycleMonths}
              keyboardType="number-pad"
            />
          )}

          <TextInput
            testID="renewal-lead-days"
            label="Start reminding me this many days before"
            value={reminderLeadDays}
            onChangeText={setReminderLeadDays}
            keyboardType="number-pad"
          />

          <TextInput
            testID="renewal-notes"
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            style={styles.multiline}
          />

          <GradientButton
            title={saving ? 'Saving…' : renewal ? 'Update renewal' : 'Save renewal'}
            variant="teal"
            onPress={handleSave}
            disabled={saving}
            fullWidth
            testID="renewal-save"
          />

          {renewal && (
            <>
              <TouchableOpacity
                style={[styles.markRenewed, { borderColor: colors.borderColor }]}
                onPress={handleMarkRenewed}
                disabled={marking}
                testID="renewal-mark-renewed"
              >
                <Icon name="checkmark-circle-outline" size={IconSize.md} color={colors.success} />
                <Typography variant="body" weight="semibold" color={colors.success}>
                  {marking ? 'Updating…' : 'Mark as renewed'}
                </Typography>
              </TouchableOpacity>

              <Typography variant="caption1" weight="medium" color={colors.textSecondary}>
                Attachments
              </Typography>
              <ScanImportSources
                testIDPrefix="renewal-attach"
                disabled={uploading}
                onCamera={pickCamera}
                onGallery={pickGallery}
                onFile={pickFile}
                onDrive={() => setShowDrivePicker(true)}
              />
              {uploading && <ActivityIndicator size="small" color={accent} />}

              {documents.map((doc) => (
                <Card key={doc.id} variant="outlined" style={styles.documentRow}>
                  <TouchableOpacity
                    style={styles.documentInfo}
                    onPress={() => handleOpenDocument(doc)}
                    testID={`renewal-document-${doc.id}`}
                  >
                    <Icon name="document-attach-outline" size={IconSize.md} color={accent} />
                    <View style={styles.documentText}>
                      <Typography variant="caption1" weight="medium" numberOfLines={1}>
                        {doc.file_name}
                      </Typography>
                      <Typography variant="caption2" color={colors.textSecondary}>
                        {formatFileSize(doc.file_size)}
                      </Typography>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteDocument(doc)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID={`renewal-document-delete-${doc.id}`}
                  >
                    <Icon name="close-circle" size={IconSize.md} color={colors.textSecondary} />
                  </TouchableOpacity>
                </Card>
              ))}
            </>
          )}
        </View>
      )}

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={[...RENEWAL_DOCUMENT_MIME_TYPES]}
        rememberScope="budget-renewal"
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={onDriveFile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.base, alignItems: 'center' },
  section: { gap: Spacing.smd },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.smd,
    paddingVertical: Spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleText: { flex: 1, gap: Spacing.xxs },
  fields: { gap: Spacing.smd },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.smd,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  markRenewed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.smd,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  documentInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  documentText: { flex: 1, gap: Spacing.xxs },
});
