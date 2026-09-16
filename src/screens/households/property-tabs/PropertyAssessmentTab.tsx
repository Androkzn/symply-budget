import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Dimensions, Linking, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { householdsApi } from '@api/households';
import { CloudFilePicker } from '@components/cloud-storage';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import {
  utilitiesApi,
  type BCAssessmentData,
  type BCAssessmentSale,
  type BCAssessmentValueHistoryYear,
  type SuggestedBCAssessment,
} from '@features/utilities/api/utilities';
import {
  useResolvedJurisdiction,
  assessedValueLabel,
  assessmentAuthorityLabel,
  taxableValueNote,
  appealDeadlineDisplay,
  valueStackLabels,
  type PropertyJurisdiction,
} from '@hooks/usePropertyJurisdiction';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import type { UsAssessmentCap, UsHomesteadExemption } from '@symply/contracts';
import { Spacing, CornerRadius, scaledFont, useAppColors } from '@theme';
import { maskDayKeyInput } from '@utils/dateInput';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';
import { useDisplayCurrency } from '@utils/money';

import {
  pickPropertyDocument,
  PROPERTY_DOCUMENT_MIME_TYPES,
  type PickedDocument,
} from './documentPicker';
import { SectionCard, formatMoney, formatMoneyShort } from './PropertyInsightWidgets';

interface Props {
  householdId: string;
  onChanged: () => void;
}

interface ReviewState {
  documentUrl: string;
  existingId: string | null;
  /**
   * Typed by hand rather than read off a notice. Private mode disables AI
   * extraction entirely, so this is the only way an assessment gets recorded
   * there — the sheet grows a year field and drops the document-only sections.
   */
  manual: boolean;
  assessmentYear: number;
  /** The year as typed, so a half-entered "20" never becomes the year 20. */
  yearInput: string;
  assessedValue: string; // dollars, editable
  landValue: string;
  improvementValue: string;
  previousYearValue?: number; // cents
  changePercent?: number;
  appealDeadline: string;
  propertyClass?: string;
  /** Every year the AI read from this document (newest first), for review. */
  valueHistory: BCAssessmentValueHistoryYear[];
  /** How many prior years were auto-saved from the value history. */
  backfilledCount: number;
  /** Public sales printed on the notice (newest first), for review. */
  salesHistory: BCAssessmentSale[];
  /** The best candidate for the owner's real purchase price (latest sale). */
  suggestedPurchase: BCAssessmentSale | null;
}

const dollars = (cents?: number) => (cents != null ? (cents / 100).toFixed(0) : '');

// Format an ISO date (YYYY-MM-DD) as e.g. "Jun 12, 2025" without pulling in a
// heavy date lib — the strings come from the backend already normalized.
const formatSaleDate = (iso: string | null): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
};

// On-bill relief reaches the owner without them doing anything, so it must never
// read as a to-do; the other modes genuinely need an application.
const reliefActionLabel = (
  program: PropertyJurisdiction['reliefPrograms'][number]
): string => {
  if (program.applyMode === 'on-bill') return 'How it works';
  if (program.applyMode === 'income-tax-return') return 'Claim on your tax return';
  return 'Learn more and apply';
};

// Registry copy marks the traps it is warning about with markdown emphasis
// ("**not to school levies**"). Nothing here renders markdown, so without this
// the homeowner reads the asterisks.
const plainText = (text: string): string => text.replace(/\*\*/g, '');

// One line built from a cap's own fields rather than its paragraph-long
// `summary`. The two facts an owner acts on are how fast the value may climb and
// what wipes the gap — a buyer who assumes the seller's bill carries over is the
// person this line exists for.
const capSummaryLine = (cap: UsAssessmentCap): string => {
  const parts = [
    cap.tiedToInflation
      ? `Rises at most ${cap.annualLimitPercent}% a year, or inflation if that is lower`
      : `Rises at most ${cap.annualLimitPercent}% a year`,
  ];
  if (cap.resetsOnSale) parts.push('resets to market value when the property is sold');
  if (cap.portable) parts.push('the built-up gap can move with you to a new home');
  if (cap.expiresIso) parts.push(`ends ${cap.expiresIso}`);
  return `${parts.join(' · ')}.`;
};

// Where a US benefit actually lands. New York's STAR credit is a cheque from the
// state, so labelling it the way an on-bill grant is labelled sends the owner
// looking for a reduction that is never printed on their bill.
const usExemptionDeliveryLine = (exemption: UsHomesteadExemption): string => {
  switch (exemption.deliveryMethod) {
    case 'reduces_taxable_value':
      return 'Comes off the value your rate is applied to.';
    case 'reduces_tax_due':
      return 'Comes off the tax due on your bill.';
    // `separate_payment`
    default:
      return 'Paid to you separately by the state — it never appears on your tax bill.';
  }
};

// Which levies the benefit reaches. Florida's second $25,000 band skips school
// levies and New York's STAR touches nothing else — and school millage is
// usually the largest line on the bill, so assuming "all of it" overstates the
// saving by the biggest number on the page. Null where it really is all of it.
const usExemptionScopeLine = (exemption: UsHomesteadExemption): string | null => {
  if (exemption.appliesToSchoolLevies && exemption.appliesToNonSchoolLevies) return null;
  if (exemption.appliesToSchoolLevies) return 'School levies only';
  if (exemption.appliesToNonSchoolLevies) return 'Does not apply to school levies';
  return null;
};

// A roll year a human could plausibly hold a notice for. Guards the manual year
// field, which is free text and therefore accepts "20", "20256" and "abcd".
const isSaneYear = (year: number): boolean =>
  Number.isInteger(year) && year >= 1900 && year <= 2100;

// Land + buildings should add up to the total. Real notices round the parts
// against each other, so a cent of disagreement is noise — more than that is
// worth flagging, and never worth blocking: the notice says what it says.
const splitExceedsTotal = (land: string, improvement: string, totalCents: number): boolean => {
  if (!land.trim() || !improvement.trim()) return false;
  const parts = Math.round(parseFloat(land) * 100) + Math.round(parseFloat(improvement) * 100);
  if (!Number.isFinite(parts) || !Number.isFinite(totalCents)) return false;
  return parts > totalCents + 1;
};

// Parse at noon local so the calendar day never shifts across time zones.
const ymdToDate = (ymd: string): Date => new Date(ymd.slice(0, 10) + 'T12:00:00');
const dateToYMD = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export function PropertyAssessmentTab({ householdId, onChanged }: Props) {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const [rows, setRows] = useState<BCAssessmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  // Shown inside the sheet rather than as an Alert: the field that is wrong is
  // on screen, and an Alert over a full-height sheet hides it.
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  // Real purchase price lives on the household (what the owner paid), separate
  // from the assessed value. Read from the store, persist via the households API.
  const household = useHouseholdStore((s) => s.households.find((h) => h.id === householdId) || null);
  const updateHouseholdLocal = useHouseholdStore((s) => s.updateHousehold);

  const [purchaseEditor, setPurchaseEditor] = useState(false);
  const [purchasePriceInput, setPurchasePriceInput] = useState('');
  const [purchaseDateInput, setPurchaseDateInput] = useState('');
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [showPurchaseDatePicker, setShowPurchaseDatePicker] = useState(false);

  // Assessment rules follow the property's address, not the user's: the
  // authority, the document name, the taxed share of the value and the appeal
  // window all differ by province — and, across the border, by state. Null means
  // we have no rules for the region — every label below falls back to generic
  // copy rather than BC's.
  const jurisdiction = useResolvedJurisdiction(household);
  // Split the tagged union once. The two registries share no field names worth
  // confusing (`authorityName` vs `assessingBodyLabel`), so reading the wrong
  // country's record below is a compile error rather than a blank on screen.
  const ca = jurisdiction?.country === 'CA' ? jurisdiction.ca : null;
  const us = jurisdiction?.country === 'US' ? jurisdiction.us : null;
  const authorityLabel = assessmentAuthorityLabel(jurisdiction);
  const valueLabel = assessedValueLabel(jurisdiction);
  const noticeLabel = (ca ?? us)?.documentTypes[0] ?? 'assessment notice';
  // The same question, phrased the way each country answers it: Canada states a
  // valuation date, the US states a reappraisal cycle. California's "there is no
  // cycle — value moves only on a sale" is why an unchanged value there is the
  // system working rather than stale data.
  const valuationRule = ca ? ca.valuationDateRule : us?.revaluationNote ?? null;
  // A free province-wide lookup only exists in Canada. There is no national US
  // lookup and no URL naming pattern, so nothing is synthesised here — a guessed
  // link 404s and an owner following it to appeal can miss a statutory deadline.
  const lookupUrl = ca?.lookupUrl ?? null;
  // What the owner still has to know. In the US that is what the state agency
  // does *not* do: a Texan who escalates to the Comptroller instead of
  // protesting to the ARB has simply missed the deadline.
  const authorityHint = ca ? ca.lookupHint : us ? plainText(us.stateRole) : null;
  const appealBodyName = ca?.appealBodyName ?? us?.appealBodyName ?? null;
  // A US notice carries up to three different numbers and they are not
  // interchangeable. Only the capped rung is ever stored here, so the other two
  // are named and left to the notice rather than derived from figures we do not
  // hold. Null in Canada, where one number is the whole answer.
  const valueStack = us ? valueStackLabels(jurisdiction) : null;

  // The deadline the region's rule implies for one assessment year. Null where
  // only the notice can say — we show the rule then, rather than inventing BC's
  // January 31 for an owner in Alberta or Ontario.
  const appealHintFor = (assessmentYear: number): string | null => {
    const { date, note } = appealDeadlineDisplay(jurisdiction, assessmentYear);
    if (date) return `Usually ${formatSaleDate(date)} — confirm against your notice.`;
    return note;
  };

  const openPurchaseEditor = (prefill?: BCAssessmentSale | null) => {
    setShowPurchaseDatePicker(false);
    if (prefill) {
      setPurchasePriceInput(prefill.price != null ? String(prefill.price) : '');
      setPurchaseDateInput(prefill.date ?? '');
    } else {
      setPurchasePriceInput(household?.purchase_price != null ? String(household.purchase_price / 100) : '');
      setPurchaseDateInput(household?.purchase_date ?? '');
    }
    setPurchaseEditor(true);
  };

  const handleSavePurchase = async () => {
    const trimmedDate = purchaseDateInput.trim();
    if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      Alert.alert('Invalid date', 'Use the format YYYY-MM-DD (e.g. 2025-06-12).');
      return;
    }
    const priceNum = parseFloat(purchasePriceInput.replace(/[^0-9.]/g, ''));
    const priceCents = purchasePriceInput.trim() && !Number.isNaN(priceNum) ? Math.round(priceNum * 100) : null;
    setSavingPurchase(true);
    try {
      await householdsApi.update(householdId, {
        purchase_price: priceCents,
        purchase_date: trimmedDate || null,
      });
      updateHouseholdLocal(householdId, { purchase_price: priceCents, purchase_date: trimmedDate || null });
      showToast('success', 'Purchase price saved');
      setPurchaseEditor(false);
      onChanged();
    } catch (error) {
      console.error('[PropertyAssessmentTab] purchase save error:', error);
      Alert.alert('Error', 'Failed to save the purchase price.');
    } finally {
      setSavingPurchase(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const data = await utilitiesApi.getBCAssessments(householdId);
      setRows(data);
    } catch (error) {
      console.error('[PropertyAssessmentTab] load error:', error);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    load();
  }, [load]);

  // Shared extraction path for every source (camera / library / files / Drive).
  const extractAssessment = async (file: PickedDocument) => {
    setUploading(true);
    try {
      const res = await utilitiesApi.uploadAndExtractAssessment(householdId, file);
      const s: SuggestedBCAssessment = res.suggestedAssessment;
      const added = (res.historyBackfill?.created ?? 0) + (res.historyBackfill?.enriched ?? 0);
      setReviewError(null);
      setReview({
        documentUrl: res.documentUrl,
        existingId: res.duplicate && res.existingAssessment ? res.existingAssessment.id : null,
        manual: false,
        assessmentYear: s.assessmentYear,
        yearInput: String(s.assessmentYear),
        assessedValue: dollars(s.assessedValue),
        landValue: dollars(s.landValue),
        improvementValue: dollars(s.improvementValue),
        previousYearValue: s.previousYearValue,
        changePercent: s.changePercent,
        appealDeadline: s.appealDeadline || '',
        propertyClass: s.propertyClass,
        valueHistory: [...(res.extractedData?.valueHistory ?? [])].sort((a, b) => b.year - a.year),
        backfilledCount: added,
        salesHistory: [...(res.extractedData?.salesHistory ?? [])].sort((a, b) =>
          (a.date ?? '') < (b.date ?? '') ? 1 : -1
        ),
        suggestedPurchase: res.suggestedPurchase ?? null,
      });
      // Prior years are auto-saved from the notice's value history — refresh so
      // they show up right away behind the review sheet.
      if (added > 0) await load();
    } catch (error) {
      console.error('[PropertyAssessmentTab] upload error:', error);
      Alert.alert('Extraction failed', 'Could not read that notice. Try a clearer PDF or photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    const file = await pickPropertyDocument(`Add ${noticeLabel}`, {
      onGoogleDrive: () => setShowDrivePicker(true),
    });
    if (file) await extractAssessment(file);
  };

  // A file chosen from the saved "bc-assessments" Drive folder.
  const handleDriveFileSelected = async (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    await extractAssessment({
      uri: file.uri,
      name: file.name || 'assessment.pdf',
      type: 'application/pdf',
    });
  };

  const closeReview = () => {
    setReview(null);
    setReviewError(null);
  };

  // The fields a manual draft takes on for one assessment year. `bc_assessment_data`
  // is unique on (household, year), so a year we already hold can only be edited —
  // point the draft at that row instead of letting the create fail on the index.
  // Anything the user has already typed wins, so changing the year never wipes a
  // figure they entered.
  const manualDraftForYear = (
    year: number,
    current: ReviewState | null
  ): Pick<
    ReviewState,
    | 'assessmentYear'
    | 'yearInput'
    | 'existingId'
    | 'assessedValue'
    | 'landValue'
    | 'improvementValue'
    | 'appealDeadline'
  > => {
    const existing = rows.find((r) => r.assessment_year === year) ?? null;
    return {
      assessmentYear: year,
      yearInput: String(year),
      existingId: existing?.id ?? null,
      assessedValue: current?.assessedValue || dollars(existing?.assessed_value),
      landValue: current?.landValue || dollars(existing?.land_value ?? undefined),
      improvementValue: current?.improvementValue || dollars(existing?.improvement_value ?? undefined),
      appealDeadline:
        current?.appealDeadline ||
        existing?.appeal_deadline ||
        appealDeadlineDisplay(jurisdiction, year).date ||
        '',
    };
  };

  // Manual entry — the same review sheet opened on an empty draft. Extraction is
  // unavailable in private mode, so without this there is no way to record an
  // assessment at all.
  const openManualEntry = () => {
    setReviewError(null);
    setReview({
      documentUrl: '',
      manual: true,
      valueHistory: [],
      backfilledCount: 0,
      salesHistory: [],
      suggestedPurchase: null,
      ...manualDraftForYear(new Date().getFullYear(), null),
    });
  };

  const handleManualYearChange = (text: string) => {
    if (!review) return;
    setReviewError(null);
    const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
    const year = parseInt(digits, 10);
    // A partial year is not yet a year: hold the text, but drop any row the
    // previous value had latched onto so a stale id can never be saved into.
    if (!isSaneYear(year)) {
      setReview({ ...review, yearInput: digits, existingId: null });
      return;
    }
    setReview({ ...review, ...manualDraftForYear(year, review), yearInput: digits });
  };

  const handleSaveReview = async () => {
    if (!review) return;
    setReviewError(null);
    const year = parseInt(review.yearInput, 10);
    if (!isSaneYear(year)) {
      setReviewError('Enter a four-digit assessment year between 1900 and 2100.');
      return;
    }
    const assessedCents = Math.round(parseFloat(review.assessedValue || '0') * 100);
    if (!Number.isFinite(assessedCents) || assessedCents <= 0) {
      setReviewError(`Enter the total ${valueLabel.toLowerCase()} — it has to be more than zero.`);
      return;
    }
    const landCents = review.landValue ? Math.round(parseFloat(review.landValue) * 100) : undefined;
    const impCents = review.improvementValue
      ? Math.round(parseFloat(review.improvementValue) * 100)
      : undefined;
    // Last line of defence against the unique index: the year may have been
    // typed into a row we already hold without the field handler seeing it.
    const existingId = review.existingId ?? rows.find((r) => r.assessment_year === year)?.id ?? null;
    // A manual entry carries no history from a document, so year-over-year only
    // works if the preceding year is read out of what is already stored. A 0%
    // change is a real answer — Ontario is frozen at a 2016 valuation date and
    // Saskatchewan at 2023 — so these default with `??`, never `||`.
    const prior = rows.find((r) => r.assessment_year === year - 1) ?? null;
    const derivedPrevious = prior && prior.assessed_value > 0 ? prior.assessed_value : undefined;
    const derivedChange =
      derivedPrevious != null
        ? Math.round(((assessedCents - derivedPrevious) / derivedPrevious) * 1000) / 10
        : undefined;
    const previousYearValue = review.previousYearValue ?? derivedPrevious;
    const changePercent = review.changePercent ?? derivedChange;
    setSaving(true);
    try {
      if (existingId) {
        await utilitiesApi.updateBCAssessment(householdId, existingId, {
          assessedValue: assessedCents,
          landValue: landCents,
          improvementValue: impCents,
          previousYearValue,
          changePercent,
          appealDeadline: review.appealDeadline || undefined,
        });
      } else {
        await utilitiesApi.createBCAssessment(householdId, {
          assessmentYear: year,
          propertyClass: review.propertyClass,
          assessedValue: assessedCents,
          landValue: landCents,
          improvementValue: impCents,
          previousYearValue,
          changePercent,
          assessmentPdfKey: review.documentUrl || undefined,
          appealDeadline: review.appealDeadline || undefined,
        });
      }
      showToast('success', 'Assessment saved');
      closeReview();
      await load();
      onChanged();
    } catch (error) {
      console.error('[PropertyAssessmentTab] save error:', error);
      Alert.alert('Error', 'Failed to save the assessment record.');
    } finally {
      setSaving(false);
    }
  };

  const chartWidth = Dimensions.get('window').width - Spacing.xl * 2 - Spacing.base * 2;
  const ascending = [...rows].sort((a, b) => a.assessment_year - b.assessment_year);
  const chartData = ascending.map((r) => ({
    value: r.assessed_value / 100,
    label: `'${String(r.assessment_year).slice(2)}`,
  }));

  const latest = ascending.length ? ascending[ascending.length - 1] : null;
  // Only set where the region taxes a fraction of the assessed value (SK 80%,
  // MB 45%) — showing the assessed value alone overstates the tax base there.
  // In the US the same call frequently answers with an explanation instead of a
  // figure (Colorado assesses the same home at two rates in one year), which is
  // why the US rendering of it lives in the value-stack card rather than in a
  // one-line slot sized for "$944,000 (80% of assessed value)".
  const latestTaxableNote = taxableValueNote(jurisdiction, latest?.assessed_value);
  const latestAppealHint = appealHintFor(latest?.assessment_year ?? new Date().getFullYear());
  // The same note against the figure being reviewed, so the taxed base is visible
  // while it is still editable.
  const reviewAssessedCents = review ? Math.round(parseFloat(review.assessedValue || '0') * 100) : NaN;
  const reviewTaxableNote = taxableValueNote(
    jurisdiction,
    Number.isFinite(reviewAssessedCents) ? reviewAssessedCents : null
  );
  const reviewAppealHint = review ? appealHintFor(review.assessmentYear) : null;
  // Advisory only — a notice whose parts overshoot its own total is still the
  // notice the owner holds, so this warns and lets the save through.
  const reviewSplitWarning = review
    ? splitExceedsTotal(review.landValue, review.improvementValue, reviewAssessedCents)
    : false;
  // Naming the year makes the duplicate case legible: the sheet the user opened
  // to add 2026 says it is updating the 2026 they already have.
  const reviewTitle = review?.existingId
    ? `Update ${review.assessmentYear} assessment`
    : review?.manual
      ? 'Add assessment'
      : 'Review assessment';
  const showSplit = latest && latest.land_value != null && latest.improvement_value != null;
  const splitTotal = showSplit ? latest!.land_value! + latest!.improvement_value! : 0;
  const pieData = showSplit
    ? [
        { value: latest!.land_value!, color: colors.primary, text: 'Land' },
        { value: latest!.improvement_value!, color: colors.accent, text: 'Buildings' },
      ]
    : [];

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
        testID="property-assessment-upload"
      >
        {uploading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Typography variant="body" weight="semibold" color={colors.white}>
            + Upload {noticeLabel}
          </Typography>
        )}
      </TouchableOpacity>
      {/* Typing the figures in is a first-class path, not a fallback: reading a
          notice needs a server that can see the document, so in private mode
          this is the ONLY way an assessment gets recorded. It sits outside the
          empty/populated branch below so it is reachable in both. */}
      <TouchableOpacity
        style={[styles.manualButton, { borderColor: colors.primary }]}
        onPress={openManualEntry}
        activeOpacity={0.85}
        testID="property-assessment-add-manual"
      >
        <Typography variant="body" weight="semibold" color={colors.primary}>
          Enter manually
        </Typography>
      </TouchableOpacity>
      <Typography variant="caption2" color={colors.textTertiary} style={styles.hint}>
        Add your {noticeLabel} from your camera, files or Google Drive — we'll read the assessed value, land/building split and appeal deadline. Or enter the year and {valueLabel.toLowerCase()} yourself.
      </Typography>

      {/* Real purchase price — what the owner actually paid. Distinct from the
          assessed value; sets a true cost basis and a purchase-based tax rate. */}
      <TouchableOpacity activeOpacity={0.85} onPress={() => openPurchaseEditor()}>
        <Card variant="filled" style={[styles.purchaseCard, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={styles.purchaseLeft}>
            <Typography variant="footnote" color={colors.textSecondary}>
              Purchase price
            </Typography>
            {household?.purchase_price != null ? (
              <>
                <Typography variant="headline" weight="bold" color={colors.textPrimary}>
                  {formatMoney(household.purchase_price)}
                </Typography>
                {!!household.purchase_date && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    Bought {formatSaleDate(household.purchase_date)}
                  </Typography>
                )}
              </>
            ) : (
              <Typography variant="caption2" color={colors.textTertiary}>
                Add what you paid to track your true cost basis
              </Typography>
            )}
          </View>
          <Typography variant="footnote" weight="semibold" color={colors.primary}>
            {household?.purchase_price != null ? 'Edit' : 'Add'}
          </Typography>
        </Card>
      </TouchableOpacity>

      {/* Who assesses this property, when the value was struck, what is actually
          taxed and how long there is to appeal. Every line of it varies by
          province, so it is read from the jurisdiction, never hardcoded. */}
      <SectionCard title="About your assessment" testID="property-assessment-jurisdiction">
        {jurisdiction ? (
          <>
            {!!valuationRule && (
              <Typography variant="footnote" color={colors.textSecondary} style={styles.aboutBody}>
                {valuationRule}
              </Typography>
            )}
            {!!ca && !!latestTaxableNote && (
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {latestTaxableNote}
              </Typography>
            )}
            {lookupUrl ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(lookupUrl).catch(console.error)}
                activeOpacity={0.85}
                testID="property-assessment-authority-link"
              >
                <Typography variant="footnote" weight="semibold" color={colors.primary}>
                  Look up your property at {authorityLabel}
                </Typography>
              </TouchableOpacity>
            ) : (
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {authorityLabel}
              </Typography>
            )}
            {!!authorityHint && (
              <Typography variant="caption2" color={colors.textTertiary} style={styles.aboutBody}>
                {authorityHint}
              </Typography>
            )}
            {!!latestAppealHint && (
              <Typography variant="caption2" color={colors.textTertiary} style={styles.aboutBody}>
                {appealBodyName ? `${appealBodyName} · ` : ''}
                {latestAppealHint}
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="footnote" color={colors.textSecondary} style={styles.aboutBody}>
            We don't have assessment rules for this property's region yet. Check your notice for the
            valuation date, the share of the value that is taxed and the appeal deadline.
          </Typography>
        )}
      </SectionCard>

      {/* Three rungs, three different numbers, one of them stored. Reusing a
          single "Assessed value" label for all three is how a homeowner comes to
          believe the rate is applied to their market value — in Texas that
          overstates the bill by the whole homestead cap loss. */}
      {!!us && !!valueStack && (
        <SectionCard title="What your notice values" testID="property-assessment-value-stack">
          <Typography variant="caption2" color={colors.textTertiary} style={styles.aboutBody}>
            Your notice prints up to three different numbers. They are not interchangeable, and only
            the middle one is recorded here.
          </Typography>
          <View style={styles.stackRow}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.stackLabel}>
              {valueStack.market}
            </Typography>
            <Typography variant="caption2" color={colors.textTertiary}>
              On your notice
            </Typography>
          </View>
          <View style={styles.stackRow}>
            <Typography variant="footnote" color={colors.textPrimary} style={styles.stackLabel}>
              {valueStack.capped}
            </Typography>
            <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
              {latest ? formatMoney(latest.assessed_value) : 'Not recorded yet'}
            </Typography>
          </View>
          <View style={styles.stackRow}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.stackLabel}>
              {valueStack.taxable}
            </Typography>
            <Typography variant="caption2" color={colors.textTertiary}>
              After exemptions
            </Typography>
          </View>
          {/* Either the figure the state's own ratio implies, or — where the
              ratio depends on which district is levying — the reason there is
              no single figure. Never a number that quietly assumed one. */}
          {!!latestTaxableNote && (
            <Typography variant="caption2" color={colors.textSecondary} style={styles.aboutBody}>
              {latestTaxableNote}
            </Typography>
          )}
          {!!valueStack.capGap && (
            <Typography variant="caption2" color={colors.textTertiary} style={styles.aboutBody}>
              {valueStack.capGap} is the gap between the first two — a benefit you hold now and lose
              when the property changes hands.
            </Typography>
          )}
        </SectionCard>
      )}

      {/* Acquisition-value caps are why the neighbour who bought last year pays
          several times what a long-held owner does. Two facts each, not the
          statute. */}
      {!!us && us.caps.length > 0 && (
        <SectionCard title="Limits on your value" testID="property-assessment-caps">
          {us.caps.map((cap) => (
            <View key={cap.id} style={styles.reliefRow}>
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {cap.name}
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary} style={styles.reliefBody}>
                {capSummaryLine(cap)}
              </Typography>
              <TouchableOpacity
                onPress={() => Linking.openURL(cap.url).catch(console.error)}
                activeOpacity={0.85}
              >
                <Typography variant="caption2" weight="semibold" color={colors.primary}>
                  How this limit works
                </Typography>
              </TouchableOpacity>
            </View>
          ))}
        </SectionCard>
      )}

      {/* Exemptions the state offers, each with where the money lands and which
          levies it reaches. Both are load-bearing: a STAR credit never touches
          the bill, and Florida's second band skips the largest line on it. */}
      {!!us && us.homesteadExemptions.length > 0 && (
        <SectionCard title="Exemptions">
          {us.homesteadExemptions.map((exemption) => {
            const scope = usExemptionScopeLine(exemption);
            return (
              <View
                key={exemption.id}
                style={styles.reliefRow}
                testID={`property-assessment-relief-${exemption.id}`}
              >
                <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                  {exemption.name}
                </Typography>
                <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                  {usExemptionDeliveryLine(exemption)}
                </Typography>
                {!!scope && (
                  <Typography variant="caption2" weight="semibold" color={colors.textPrimary}>
                    {scope}
                  </Typography>
                )}
                <Typography variant="caption2" color={colors.textSecondary} style={styles.reliefBody}>
                  {plainText(exemption.summary)}
                </Typography>
                {!!exemption.applicationDeadline && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    Apply by {exemption.applicationDeadline}
                  </Typography>
                )}
                <TouchableOpacity
                  onPress={() => Linking.openURL(exemption.url).catch(console.error)}
                  activeOpacity={0.85}
                >
                  <Typography variant="caption2" weight="semibold" color={colors.primary}>
                    Learn more and apply
                  </Typography>
                </TouchableOpacity>
              </View>
            );
          })}
        </SectionCard>
      )}

      {/* Relief the owner may be entitled to where this property is. Alberta,
          Saskatchewan and Newfoundland have none, so nothing renders there. */}
      {!!ca && ca.reliefPrograms.length > 0 && (
        <SectionCard title="Relief programs">
          {ca.reliefPrograms.map((program) => (
            <View
              key={program.id}
              style={styles.reliefRow}
              testID={`property-assessment-relief-${program.id}`}
            >
              <View style={styles.reliefHeader}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textPrimary}
                  style={styles.reliefName}
                >
                  {program.name}
                </Typography>
                {program.applyMode === 'on-bill' && (
                  <View style={[styles.savedPill, { backgroundColor: colors.success + '22' }]}>
                    <Typography variant="caption2" weight="semibold" color={colors.success}>
                      Applied to your bill
                    </Typography>
                  </View>
                )}
              </View>
              <Typography variant="caption2" color={colors.textSecondary} style={styles.reliefBody}>
                {program.summary}
              </Typography>
              <TouchableOpacity
                onPress={() => Linking.openURL(program.url).catch(console.error)}
                activeOpacity={0.85}
              >
                <Typography variant="caption2" weight="semibold" color={colors.primary}>
                  {reliefActionLabel(program)}
                </Typography>
              </TouchableOpacity>
            </View>
          ))}
        </SectionCard>
      )}

      {chartData.length >= 2 && (
        <SectionCard title={`${valueLabel} by year`} testID="property-assessment-chart">
          <AppBarChart data={chartData} width={chartWidth} formatValue={(v) => formatMoneyShort(v * 100)} />
        </SectionCard>
      )}

      {showSplit && (
        <SectionCard title="Land vs. buildings" testID="property-assessment-split-chart">
          <View style={styles.pieRow}>
            <PieChart
              data={pieData}
              donut
              radius={80}
              innerRadius={50}
              innerCircleColor={colors.backgroundSecondary}
              centerLabelComponent={() => (
                <View style={styles.pieCenter}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    {latest!.assessment_year}
                  </Typography>
                  <Typography variant="body" weight="bold">
                    {formatMoneyShort(splitTotal)}
                  </Typography>
                </View>
              )}
            />
            <View style={styles.legend}>
              {pieData.map((d) => {
                const pct = ((d.value / splitTotal) * 100).toFixed(0);
                return (
                  <View key={d.text} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: d.color }]} />
                    <Typography variant="caption1" style={styles.legendLabel} color={colors.textPrimary}>
                      {d.text}
                    </Typography>
                    <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                      {pct}%
                    </Typography>
                  </View>
                );
              })}
            </View>
          </View>
        </SectionCard>
      )}

      {rows.length === 0 ? (
        <Card
          variant="filled"
          style={[styles.empty, { backgroundColor: colors.backgroundSecondary }]}
          testID="property-assessment-empty"
        >
          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
            No assessment notices yet
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.emptyBody}>
            Upload your {noticeLabel} — or tap Enter manually and type the year and{' '}
            {valueLabel.toLowerCase()} from it — to track how your property's value changes and
            whether it's worth appealing.
          </Typography>
        </Card>
      ) : (
        <View style={styles.list}>
          {rows.map((r) => {
            const up = (r.change_percent ?? 0) >= 0;
            // Canada only. There the note is one short line ("Taxable value:
            // $944,000 (80% of assessed value)"); the US answer is often a
            // paragraph explaining why no single figure exists, and repeating
            // that against every year in a right-aligned caption column is
            // unreadable. The US household gets it once, in the value stack.
            const taxableNote = ca ? taxableValueNote(jurisdiction, r.assessed_value) : null;
            return (
              <Card
                key={r.id}
                variant="filled"
                style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
                testID={`property-assessment-row-${r.assessment_year}`}
              >
                <View style={styles.rowMain}>
                  <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                    {r.assessment_year}
                  </Typography>
                  {!!r.property_class && (
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {r.property_class}
                    </Typography>
                  )}
                </View>
                <View style={styles.rowRight}>
                  <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                    {formatMoney(r.assessed_value)}
                  </Typography>
                  {r.change_percent != null && (
                    <Typography
                      variant="caption2"
                      weight="semibold"
                      color={up ? colors.success : colors.error}
                    >
                      {up ? '+' : ''}
                      {r.change_percent}% YoY
                    </Typography>
                  )}
                  {!!taxableNote && (
                    <Typography variant="caption2" color={colors.textTertiary} style={styles.rowNote}>
                      {taxableNote}
                    </Typography>
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Review sheet — large so it accommodates the full multi-year history. */}
      <BottomSheet
        visible={!!review}
        onClose={closeReview}
        height="full"
        title={reviewTitle}
        showCloseButton
        headerAction={{
          label: 'Save',
          onPress: handleSaveReview,
          loading: saving,
          testID: 'property-assessment-review-save',
        }}
      >
        {review && (
          <View style={styles.reviewContainer}>
            <ScrollView
              style={styles.reviewScroll}
              contentContainerStyle={styles.review}
              showsVerticalScrollIndicator={false}
              {...keyboardDismissScrollProps}
            >
              <Typography variant="caption1" color={colors.textSecondary}>
                {review.assessmentYear} assessment
                {review.existingId ? ' · updating existing record' : ''}
              </Typography>

              {!!reviewError && (
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.error}
                  testID="property-assessment-review-error"
                >
                  {reviewError}
                </Typography>
              )}

              {/* Only a manual draft needs the year: an extracted one already
                  read it off the notice, and retyping it would invite a
                  duplicate the unique index would reject. */}
              {review.manual && (
                <View style={styles.field}>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Assessment year
                  </Typography>
                  <TextInput
                    style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                    value={review.yearInput}
                    onChangeText={handleManualYearChange}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder={String(new Date().getFullYear())}
                    placeholderTextColor={colors.textTertiary}
                    testID="property-assessment-review-year"
                  />
                  {!!review.existingId && (
                    <Typography variant="caption2" color={colors.textTertiary}>
                      You already have {review.assessmentYear} saved — this updates it.
                    </Typography>
                  )}
                </View>
              )}

              <View style={styles.field}>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {valueLabel} · total
                </Typography>
                <TextInput
                  style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                  value={review.assessedValue}
                  onChangeText={numericTextHandler((t) => {
                    setReviewError(null);
                    setReview({ ...review, assessedValue: t });
                  })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                  testID="property-assessment-review-assessed"
                />
                {!!reviewTaxableNote && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    {reviewTaxableNote}
                  </Typography>
                )}
              </View>
              <View style={styles.fieldRow}>
                <View style={[styles.field, styles.fieldHalf]}>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Land value
                  </Typography>
                  <TextInput
                    style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                    value={review.landValue}
                    onChangeText={numericTextHandler((t) => setReview({ ...review, landValue: t }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textTertiary}
                    testID="property-assessment-review-land"
                  />
                </View>
                <View style={[styles.field, styles.fieldHalf]}>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Buildings value
                  </Typography>
                  <TextInput
                    style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                    value={review.improvementValue}
                    onChangeText={numericTextHandler((t) =>
                      setReview({ ...review, improvementValue: t })
                    )}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textTertiary}
                    testID="property-assessment-review-improvement"
                  />
                </View>
              </View>
              {reviewSplitWarning && (
                <Typography
                  variant="caption2"
                  color={colors.warning}
                  testID="property-assessment-review-split-warning"
                >
                  Land and buildings add up to more than the total {valueLabel.toLowerCase()}. Check
                  your notice — you can still save this.
                </Typography>
              )}
              <View style={styles.field}>
                <Typography variant="footnote" color={colors.textSecondary}>
                  Appeal deadline
                </Typography>
                <TextInput
                  style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                  value={review.appealDeadline}
                  onChangeText={(t) => setReview({ ...review, appealDeadline: maskDayKeyInput(t) })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  autoCorrect={false}
                />
                {/* The region's own rule — a real date only where one exists. */}
                {!!reviewAppealHint && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    {appealBodyName ? `${appealBodyName} · ` : ''}
                    {reviewAppealHint}
                  </Typography>
                )}
              </View>

              {/* Full multi-year history read from the document. Prior years are
                  already saved (backfilled); this is the confirmation of what we
                  captured, newest first. */}
              {review.valueHistory.length > 0 && (
                <View style={styles.historySection}>
                  <View style={styles.historyHeader}>
                    <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                      Value history · {review.valueHistory.length} year
                      {review.valueHistory.length === 1 ? '' : 's'}
                    </Typography>
                    {review.backfilledCount > 0 && (
                      <View style={[styles.savedPill, { backgroundColor: colors.success + '22' }]}>
                        <Typography variant="caption2" weight="semibold" color={colors.success}>
                          {review.backfilledCount} prior saved
                        </Typography>
                      </View>
                    )}
                  </View>

                  {review.valueHistory.map((h) => {
                    const isCurrent = h.year === review.assessmentYear;
                    const up = (h.changePercent ?? 0) >= 0;
                    const splitParts = [
                      h.landValue != null ? `Land ${formatMoneyShort(h.landValue * 100)}` : null,
                      h.improvementValue != null
                        ? `Bldg ${formatMoneyShort(h.improvementValue * 100)}`
                        : null,
                    ].filter(Boolean);
                    return (
                      <View
                        key={h.year}
                        style={[styles.historyRow, { borderBottomColor: colors.borderColor }]}
                      >
                        <View style={styles.historyLeft}>
                          <Typography
                            variant="body"
                            weight={isCurrent ? 'bold' : 'semibold'}
                            color={colors.textPrimary}
                          >
                            {h.year}
                          </Typography>
                          {splitParts.length > 0 && (
                            <Typography variant="caption2" color={colors.textTertiary}>
                              {splitParts.join(' · ')}
                            </Typography>
                          )}
                        </View>
                        <View style={styles.historyRight}>
                          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                            {h.totalValue != null ? formatMoney(h.totalValue * 100) : '—'}
                          </Typography>
                          {h.changePercent != null && (
                            <Typography
                              variant="caption2"
                              weight="semibold"
                              color={up ? colors.success : colors.error}
                            >
                              {up ? '+' : ''}
                              {h.changePercent}% YoY
                            </Typography>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Public sales printed on the notice. The most recent one is the
                  best guess for the owner's real purchase price. */}
              {review.salesHistory.length > 0 && (
                <View style={styles.historySection}>
                  <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                    Recent sales
                  </Typography>
                  {review.salesHistory.map((s, i) => (
                    <View
                      key={`${s.date ?? 'sale'}-${i}`}
                      style={[styles.historyRow, { borderBottomColor: colors.borderColor }]}
                    >
                      <Typography variant="body" color={colors.textPrimary}>
                        {formatSaleDate(s.date) || 'Unknown date'}
                      </Typography>
                      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                        {s.price != null ? formatMoney(s.price * 100) : '—'}
                      </Typography>
                    </View>
                  ))}
                  {review.suggestedPurchase?.price != null && (
                    <TouchableOpacity
                      style={[styles.usePurchaseButton, { borderColor: colors.primary }]}
                      onPress={() => openPurchaseEditor(review.suggestedPurchase)}
                      activeOpacity={0.85}
                    >
                      <Typography variant="footnote" weight="semibold" color={colors.primary}>
                        Set {formatMoney(review.suggestedPurchase.price * 100)} as purchase price
                      </Typography>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </BottomSheet>

      {/* Purchase-price editor — the real price the owner paid. */}
      <BottomSheet
        visible={purchaseEditor}
        onClose={() => setPurchaseEditor(false)}
        height="content"
        title="Purchase price"
        showCloseButton
        headerAction={{
          label: 'Save',
          onPress: handleSavePurchase,
          loading: savingPurchase,
          testID: 'property-purchase-price-save',
        }}
      >
        {/* No `reviewContainer` here: a content-sized sheet hugs its children,
            and a `flex: 1` wrapper inside an auto-height parent resolves to a
            basis of 0 — the body would measure to nothing. */}
        <View style={styles.review}>
            <Typography variant="caption1" color={colors.textSecondary}>
              What you actually paid for this property. Kept separate from the assessed value.
            </Typography>
            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary}>
                Price you paid
              </Typography>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                value={purchasePriceInput}
                onChangeText={numericTextHandler(setPurchasePriceInput)}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            <View style={styles.field}>
              <Typography variant="footnote" color={colors.textSecondary}>
                Purchase date
              </Typography>
              <TouchableOpacity
                style={[styles.input, styles.dateButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                onPress={() => setShowPurchaseDatePicker((v) => !v)}
                activeOpacity={0.85}
              >
                <Typography
                  variant="body"
                  color={purchaseDateInput ? colors.textPrimary : colors.textTertiary}
                >
                  {purchaseDateInput ? formatSaleDate(purchaseDateInput) : 'Select date'}
                </Typography>
                <Icon name="calendar-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              {showPurchaseDatePicker && (
                <View style={styles.datePickerContainer}>
                  <DateTimePicker
                    value={purchaseDateInput ? ymdToDate(purchaseDateInput) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    onChange={(_event, selectedDate) => {
                      if (Platform.OS === 'android') setShowPurchaseDatePicker(false);
                      if (selectedDate) setPurchaseDateInput(dateToYMD(selectedDate));
                    }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      onPress={() => setShowPurchaseDatePicker(false)}
                      style={styles.datePickerDone}
                    >
                      <Typography variant="body" weight="semibold" color={colors.primary}>
                        Done
                      </Typography>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
        </View>
      </BottomSheet>

      {/* Google Drive import — pins its own remembered folder, separate from
          property tax, so notices always come from the same place. */}
      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={PROPERTY_DOCUMENT_MIME_TYPES}
        rememberScope="property-assessments"
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
  manualButton: {
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  hint: { textAlign: 'center' },
  empty: { padding: Spacing.lg, borderRadius: CornerRadius.md, gap: Spacing.xs },
  emptyBody: { lineHeight: 18 },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  rowMain: { flex: 1, gap: Spacing.xxs },
  rowRight: { alignItems: 'flex-end', gap: Spacing.xxs },
  rowNote: { textAlign: 'right' },
  aboutBody: { lineHeight: 18 },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  stackLabel: { flex: 1 },
  reliefRow: { gap: Spacing.xxs },
  reliefHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reliefName: { flex: 1 },
  reliefBody: { lineHeight: 16 },
  pieRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  pieCenter: { alignItems: 'center' },
  legend: { flex: 1, gap: Spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1 },
  reviewContainer: { flex: 1 },
  reviewScroll: { flex: 1 },
  review: { gap: Spacing.base, paddingBottom: Spacing.xxl },
  purchaseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  purchaseLeft: { gap: 2, flex: 1 },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerContainer: { alignItems: 'center' },
  datePickerDone: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.base },
  usePurchaseButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
  },
  historySection: { gap: Spacing.xs, marginTop: Spacing.sm },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xxs,
  },
  savedPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyLeft: { gap: Spacing.xxs },
  historyRight: { alignItems: 'flex-end', gap: Spacing.xxs },
  field: { gap: Spacing.xs },
  fieldRow: { flexDirection: 'row', gap: Spacing.md },
  fieldHalf: { flex: 1 },
  input: {
    ...scaledFont('buttonLabel'),
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
});
