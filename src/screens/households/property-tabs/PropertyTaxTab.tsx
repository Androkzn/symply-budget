import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Dimensions, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { CloudFilePicker } from '@components/cloud-storage';
import { Card, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { BottomSheet } from '@components/ui/BottomSheet';
import { utilitiesApi, type PropertyTax, type SuggestedPropertyTax } from '@features/utilities/api/utilities';
import {
  useResolvedJurisdiction,
  assessedValueLabel,
  taxableValueNote,
  usBillDeliveryNote,
} from '@hooks/usePropertyJurisdiction';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { Spacing, CornerRadius, scaledFont, useAppColors } from '@theme';
import { maskDayKeyInput } from '@utils/dateInput';
import { numericTextHandler } from '@utils/keyboard';
import { useDisplayCurrency } from '@utils/money';

import {
  pickPropertyDocument,
  PROPERTY_DOCUMENT_MIME_TYPES,
  type PickedDocument,
} from './documentPicker';
import { SectionCard, formatMoney, formatDate } from './PropertyInsightWidgets';

interface Props {
  householdId: string;
  /** Called after a create/update so the parent can refresh insights. */
  onChanged: () => void;
}

interface ReviewState {
  documentUrl: string;
  existingId: string | null;
  taxYear: number;
  taxAmount: string; // dollars, editable
  mainPaymentDueDate: string;
  grantEligible: boolean;
  grantApplied: boolean; // claim it now — deducts from what's owed
  alreadyPaid: boolean;
  assessedValue: number; // cents (from extraction)
  municipalityName?: string;
}

export function PropertyTaxTab({ householdId, onChanged }: Props) {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const [taxes, setTaxes] = useState<PropertyTax[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  // Tax rules follow the property's address, not the user's. The document a
  // homeowner receives, and whether any of it can be claimed on the bill, are
  // both jurisdiction-specific — Alberta and Saskatchewan have no grant at all.
  const household = useHouseholdStore((s) => s.households.find((h) => h.id === householdId) || null);
  const jurisdiction = useResolvedJurisdiction(household);
  // Split the tagged union once — the two registries share no field names worth
  // confusing, so reading the wrong country's record is a compile error.
  const ca = jurisdiction?.country === 'CA' ? jurisdiction.ca : null;
  const us = jurisdiction?.country === 'US' ? jurisdiction.us : null;
  const documentTypes = (ca ?? us)?.documentTypes ?? null;
  const taxDocument = documentTypes?.find((d) => /tax/i.test(d)) ?? documentTypes?.[0] ?? null;
  // Relief that comes off this bill. Deferrals and income-tax-return credits are
  // not claimed here, so they must not drive the grant toggles.
  const billCredit =
    ca?.reliefPrograms.find(
      (p) => p.applyMode !== 'income-tax-return' && p.kind !== 'deferral'
    ) ?? null;
  // Null once we know the region and it has nothing to claim — the toggles are
  // then hidden rather than offering a grant that does not exist. A US state is
  // always that case: its relief is a homestead exemption the county already
  // holds on file against the value, not a grant claimed against this bill, so
  // the `homeowner_grant_*` columns those toggles write have nothing to mean.
  const creditName = jurisdiction ? billCredit?.name ?? null : 'Homeowner grant';
  const reviewTaxableNote = taxableValueNote(jurisdiction, review?.assessedValue);
  // Most mortgaged US homes escrow property tax: the county mails the bill to
  // the loan servicer and the owner sees an information-only statement, or
  // nothing. Without this, an empty list reads as "you owe nothing".
  const escrowNote = usBillDeliveryNote(jurisdiction);

  const load = useCallback(async () => {
    try {
      const rows = await utilitiesApi.getPropertyTaxes(householdId);
      setTaxes(rows);
    } catch (error) {
      console.error('[PropertyTaxTab] load error:', error);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    load();
  }, [load]);

  // Shared extraction path for every source (camera / library / files / Drive).
  const extractTax = async (file: PickedDocument) => {
    setUploading(true);
    try {
      const res = await utilitiesApi.uploadAndExtractPropertyTax(householdId, file);
      const s: SuggestedPropertyTax = res.suggestedTax;
      setReview({
        documentUrl: res.documentUrl,
        existingId: res.duplicate && res.existingTax ? res.existingTax.id : null,
        taxYear: s.taxYear,
        taxAmount: (s.taxAmount / 100).toFixed(2),
        mainPaymentDueDate: s.mainPaymentDueDate,
        grantEligible: creditName ? s.homeownerGrantEligible : false,
        grantApplied: false,
        alreadyPaid: false,
        assessedValue: s.assessedValue,
        municipalityName: s.municipalityName,
      });
    } catch (error) {
      console.error('[PropertyTaxTab] upload error:', error);
      Alert.alert('Extraction failed', 'Could not read that notice. Try a clearer PDF or photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    const file = await pickPropertyDocument(`Add ${taxDocument ?? 'Property Tax Notice'}`, {
      onGoogleDrive: () => setShowDrivePicker(true),
    });
    if (file) await extractTax(file);
  };

  // A file chosen from the saved "property-taxes" Drive folder.
  const handleDriveFileSelected = async (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    await extractTax({
      uri: file.uri,
      name: file.name || 'property-tax.pdf',
      type: 'application/pdf',
    });
  };

  const handleSaveReview = async () => {
    if (!review) return;
    const amountCents = Math.round(parseFloat(review.taxAmount || '0') * 100);
    if (!amountCents || Number.isNaN(amountCents)) {
      Alert.alert('Invalid amount', 'Enter the total tax amount.');
      return;
    }
    setSaving(true);
    try {
      if (review.existingId) {
        // A record for this year already exists — update its figures / paid state.
        await utilitiesApi.updatePropertyTax(householdId, review.existingId, {
          taxAmount: amountCents,
          assessedValue: review.assessedValue || undefined,
          mainPaymentPaidDate: review.alreadyPaid
            ? new Date().toISOString().split('T')[0]
            : undefined,
        });
      } else {
        const created = await utilitiesApi.createPropertyTax(householdId, {
          taxYear: review.taxYear,
          assessedValue: review.assessedValue || 0,
          taxAmount: amountCents,
          mainPaymentAmount: amountCents,
          mainPaymentDueDate: review.mainPaymentDueDate,
          homeownerGrantEligible: review.grantEligible,
          homeownerGrantApplied: review.grantEligible && review.grantApplied,
          documentUrl: review.documentUrl,
          municipalityName: review.municipalityName,
          mainPaymentPaidDate: review.alreadyPaid
            ? new Date().toISOString().split('T')[0]
            : undefined,
        });
        // Soft one-property grant rule — another property already claimed it.
        if (created.grantWarning) {
          Alert.alert(creditName ?? 'Homeowner grant', created.grantWarning);
        }
      }
      showToast('success', 'Property tax saved');
      setReview(null);
      await load();
      onChanged();
    } catch (error) {
      console.error('[PropertyTaxTab] save error:', error);
      Alert.alert('Error', 'Failed to save the property tax record.');
    } finally {
      setSaving(false);
    }
  };

  const markPaid = (tax: PropertyTax) => {
    if (tax.main_payment_paid_date) return;
    Alert.alert('Mark as paid', `Record the ${tax.tax_year} property tax as paid?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark paid',
        onPress: async () => {
          try {
            await utilitiesApi.updatePropertyTax(householdId, tax.id, {
              mainPaymentPaidDate: new Date().toISOString().split('T')[0],
            });
            await load();
            onChanged();
          } catch (error) {
            console.error('[PropertyTaxTab] markPaid error:', error);
            Alert.alert('Error', 'Failed to update.');
          }
        },
      },
    ]);
  };

  const chartWidth = Dimensions.get('window').width - Spacing.xl * 2 - Spacing.base * 2;
  const ascending = [...taxes].sort((a, b) => a.tax_year - b.tax_year);
  const chartData = ascending.map((t) => ({
    value: t.tax_amount / 100,
    label: `'${String(t.tax_year).slice(2)}`,
  }));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.uploadButton, { backgroundColor: colors.primary }]}
        onPress={handleUpload}
        disabled={uploading}
        activeOpacity={0.85}
        testID="property-tax-upload"
      >
        {uploading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Typography variant="body" weight="semibold" color={colors.white}>
            + Upload {taxDocument ?? 'tax notice'}
          </Typography>
        )}
      </TouchableOpacity>
      <Typography variant="caption2" color={colors.textTertiary} style={styles.hint}>
        Snap a photo, pick a PDF or import from Google Drive — we'll read the year, amount, due date
        {creditName ? ` and ${creditName}` : ''}.
      </Typography>

      {/* Two US-only facts that change how everything below should be read: the
          bill may never reach the owner at all, and the rate on it is not quoted
          in mills everywhere — reading Texas's $1.25 per $100 as mills produces
          a bill one tenth of the real one, plausibly enough that nobody notices. */}
      {!!escrowNote && (
        <Card
          variant="filled"
          style={[styles.noteCard, { backgroundColor: colors.backgroundSecondary }]}
          testID="property-tax-escrow-note"
        >
          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
            Your bill may go to your mortgage servicer
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.noteBody}>
            {escrowNote}
          </Typography>
          {!!us?.rateBasisNote && (
            <Typography variant="caption2" color={colors.textTertiary} style={styles.noteBody}>
              {us.rateBasisNote}
            </Typography>
          )}
        </Card>
      )}

      {chartData.length >= 2 && (
        <SectionCard title="Property tax by year" testID="property-tax-chart">
          <AppBarChart data={chartData} width={chartWidth} />
        </SectionCard>
      )}

      {taxes.length === 0 ? (
        <Card
          variant="filled"
          style={[styles.empty, { backgroundColor: colors.backgroundSecondary }]}
          testID="property-tax-empty"
        >
          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
            No property tax notices yet
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.emptyBody}>
            Upload your {taxDocument ?? 'municipal tax notice'} to track what's due
            {creditName ? `, claim your ${creditName},` : ''} and see year-over-year trends.
          </Typography>
        </Card>
      ) : (
        <View style={styles.list}>
          {taxes.map((tax) => {
            const paid = !!tax.main_payment_paid_date;
            return (
              <Card
                key={tax.id}
                variant="filled"
                style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
                testID={`property-tax-row-${tax.tax_year}`}
              >
                <View style={styles.rowMain}>
                  <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                    {tax.tax_year}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Due {formatDate(tax.main_payment_due_date)}
                    {tax.homeowner_grant_applied_date
                      ? ` · grant applied${
                          tax.homeowner_grant_amount ? ` −${formatMoney(tax.homeowner_grant_amount)}` : ''
                        }`
                      : tax.homeowner_grant_eligible
                      ? ' · grant eligible'
                      : ''}
                  </Typography>
                </View>
                <View style={styles.rowRight}>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    {formatMoney(tax.tax_amount)}
                  </Typography>
                  {paid ? (
                    <View style={[styles.badge, { backgroundColor: colors.success + '22' }]}>
                      <Typography variant="caption2" weight="semibold" color={colors.success}>
                        Paid
                      </Typography>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => markPaid(tax)}
                      style={[styles.badge, { backgroundColor: colors.warning + '22' }]}
                      testID={`property-tax-mark-paid-${tax.tax_year}`}
                    >
                      <Typography variant="caption2" weight="semibold" color={colors.warning}>
                        Mark paid
                      </Typography>
                    </TouchableOpacity>
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Review sheet */}
      <BottomSheet
        visible={!!review}
        onClose={() => setReview(null)}
        height="content"
        title="Review tax notice"
        showCloseButton
        headerAction={{
          label: 'Save',
          onPress: handleSaveReview,
          loading: saving,
          testID: 'property-tax-review-save',
        }}
      >
        {review && (
          <View style={styles.review}>
            <Typography variant="caption1" color={colors.textSecondary}>
              {review.municipalityName || 'Property tax'} · {review.taxYear}
              {review.existingId ? ' · updating existing record' : ''}
            </Typography>

            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary}>
                Total tax amount
              </Typography>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                value={review.taxAmount}
                onChangeText={numericTextHandler((t) => setReview({ ...review, taxAmount: t }))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                testID="property-tax-review-amount"
              />
            </View>

            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary}>
                Main due date
              </Typography>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                value={review.mainPaymentDueDate}
                onChangeText={(t) => setReview({ ...review, mainPaymentDueDate: maskDayKeyInput(t) })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                autoCorrect={false}
                testID="property-tax-review-due-date"
              />
            </View>

            {/* The value the bill was actually calculated from. Where the region
                taxes a fraction of it (SK 80%, MB 45%), say so — the mill rate
                applies to that, not to the assessed value. */}
            {review.assessedValue > 0 && (
              <View style={styles.field}>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {assessedValueLabel(jurisdiction)}
                </Typography>
                <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                  {formatMoney(review.assessedValue)}
                </Typography>
                {!!reviewTaxableNote && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    {reviewTaxableNote}
                  </Typography>
                )}
              </View>
            )}

            {!!creditName && (
              <View style={styles.toggleRow}>
                <Typography variant="body" color={colors.textPrimary}>
                  {creditName} eligible
                </Typography>
                <Toggle
                  value={review.grantEligible}
                  onValueChange={(v) =>
                    setReview({ ...review, grantEligible: v, grantApplied: v && review.grantApplied })
                  }
                />
              </View>
            )}
            {!!creditName && review.grantEligible && (
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabel}>
                  <Typography variant="body" color={colors.textPrimary}>
                    Grant applied
                  </Typography>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Deducts it from what's owed
                  </Typography>
                </View>
                <Toggle
                  value={review.grantApplied}
                  onValueChange={(v) => setReview({ ...review, grantApplied: v })}
                />
              </View>
            )}
            <View style={styles.toggleRow}>
              <Typography variant="body" color={colors.textPrimary}>
                Already paid
              </Typography>
              <Toggle
                value={review.alreadyPaid}
                onValueChange={(v) => setReview({ ...review, alreadyPaid: v })}
              />
            </View>
          </View>
        )}
      </BottomSheet>

      {/* Google Drive import — pins its own remembered folder (shared with the
          Add Property Tax screen) so tax notices always come from one place. */}
      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={PROPERTY_DOCUMENT_MIME_TYPES}
        rememberScope="property-taxes"
        autoRemember
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.base },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  uploadButton: {
    paddingVertical: Spacing.base,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
  },
  hint: { textAlign: 'center' },
  empty: { padding: Spacing.lg, borderRadius: CornerRadius.md, gap: Spacing.xs },
  emptyBody: { lineHeight: 18 },
  noteCard: { padding: Spacing.base, borderRadius: CornerRadius.md, gap: Spacing.xs },
  noteBody: { lineHeight: 18 },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  rowMain: { flex: 1, gap: Spacing.xxs },
  rowRight: { alignItems: 'flex-end', gap: Spacing.xs },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
  },
  review: { gap: Spacing.base, paddingBottom: Spacing.xl },
  field: { gap: Spacing.xs },
  input: {
    ...scaledFont('buttonLabel'),
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  toggleLabel: {
    flex: 1,
    gap: Spacing.xxs,
  },
});
